import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.rate_limit import limiter, user_or_ip
from app.services.blocks import is_blocked_pair
from app.db.session import get_session
from app.models.swipe import SwipeRequest, SwipeResponse, UndoResponse
from app.models.organization import has_permission
from app.models.tables.swipe import Swipe
from app.models.tables.match import Match
from app.models.tables.job import JobPosting
from app.models.tables.worker import WorkerProfile
from app.models.tables.employer import EmployerProfile
from app.models.tables.user import User
from app.models.tables.organization import OrgMember
from app.services.notifications import notify, notify_team
from app.tasks.notifications import send_match_email

router = APIRouter(prefix="/swipes", tags=["swipes"])


async def _match_display_names(session: AsyncSession, employer_id: uuid.UUID, worker_id: uuid.UUID) -> tuple[str, str]:
    """(company_name, worker_name) for match notification text."""
    emp_profile = await session.get(EmployerProfile, employer_id)
    worker_profile = await session.get(WorkerProfile, worker_id)
    company = (emp_profile.company_name if emp_profile else "") or "an employer"
    worker_name = (worker_profile.name if worker_profile else "") or "a candidate"
    return company, worker_name


async def _check_org_permission(session: AsyncSession, user: dict, action: str):
    """Check org permission for employer users. Workers skip."""
    if user["role"] != "employer":
        return
    result = await session.execute(
        select(OrgMember.role).where(OrgMember.user_id == uuid.UUID(user["id"])).limit(1)
    )
    row = result.first()
    if row:
        if not has_permission(row.role, action):
            raise HTTPException(403, f"Your role ({row.role}) cannot perform: {action}")


def _fire_match_email(worker_email: str, emp_email: str, title: str) -> None:
    try:
        send_match_email.delay(worker_email, emp_email, title)
    except Exception:
        pass


@router.post("", response_model=SwipeResponse, status_code=201)
@limiter.limit("120/minute", key_func=user_or_ip)
async def record_swipe(
    request: Request,
    body: SwipeRequest,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    role = user["role"]

    if body.direction == "pass":
        await _check_org_permission(session, user, "swipe_pass")
    else:
        await _check_org_permission(session, user, "swipe")

    # Prevent duplicate
    existing = await session.execute(
        select(Swipe.id).where(Swipe.swiper_id == uid, Swipe.target_id == uuid.UUID(body.target_id))
    )
    if existing.first():
        raise HTTPException(409, "Already swiped on this target")

    # Validate target
    target_uuid = uuid.UUID(body.target_id)
    if role == "worker":
        job = await session.get(JobPosting, target_uuid)
        if not job:
            raise HTTPException(400, "Target must be a valid job posting")
        other_user_id = job.employer_id
    else:
        wp = await session.get(WorkerProfile, target_uuid)
        if not wp:
            raise HTTPException(400, "Target must be a valid worker profile")
        other_user_id = target_uuid

    # A pass on a blocked user is fine (it just clears the card); a like is not.
    if body.direction != "pass" and await is_blocked_pair(session, uid, other_user_id):
        raise HTTPException(403, "You can't interact with this user")

    # Insert swipe
    swipe = Swipe(
        id=uuid.uuid4(),
        swiper_id=uid,
        swiper_type=role,
        target_id=target_uuid,
        direction=body.direction,
        created_at=datetime.now(timezone.utc),
    )
    session.add(swipe)
    await session.commit()

    if body.direction == "pass":
        return SwipeResponse(matched=False)

    if role == "worker":
        # A like/super_like on a job notifies the employer (never workers — confirmed decision).
        await notify(
            session, job.employer_id, "like_received",
            "notif.like_received.title", params={"title": job.title or "a job"}, link="/jobs",
        )
        await notify_team(
            session, job.employer_id, "notif.like_received.title",
            params={"title": job.title or "a job"}, permission="view", link="/jobs",
        )
        await session.commit()

    # Mutual matching: only create a match when BOTH sides have liked
    matched = False
    match_id = None

    if role == "worker":
        # Worker liked a job posting — check if employer already liked this worker
        job = await session.get(JobPosting, target_uuid)
        if not job:
            return SwipeResponse(matched=False)

        employer_id = job.employer_id

        reverse = await session.execute(
            select(Swipe.id)
            .where(Swipe.swiper_id == employer_id, Swipe.target_id == uid)
            .where(Swipe.direction.in_(["like", "super_like"]))
        )
        if reverse.first():
            new_match = Match(
                id=uuid.uuid4(),
                worker_id=uid,
                employer_id=employer_id,
                job_posting_id=target_uuid,
                matched_at=datetime.now(timezone.utc),
            )
            session.add(new_match)
            try:
                await session.commit()
                matched = True
                match_id = str(new_match.id)

                emp_user = await session.get(User, employer_id)
                _fire_match_email(user.get("email", ""), emp_user.email if emp_user else "", job.title or "a job")

                company_name, worker_name = await _match_display_names(session, employer_id, uid)
                chat_link = f"/chat/{match_id}"
                await notify(session, uid, "match", "notif.match.title", params={"name": company_name}, actor_id=employer_id, link=chat_link)
                await notify(session, employer_id, "match", "notif.match.title", params={"name": worker_name}, actor_id=uid, link=chat_link)
                await notify_team(session, employer_id, "notif.match.title", params={"name": worker_name}, permission="view", link=chat_link)
                await session.commit()
            except Exception:
                await session.rollback()

    else:
        # Employer liked a worker — check if worker already liked any of employer's jobs
        result = await session.execute(
            select(JobPosting.id).where(JobPosting.employer_id == uid)
        )
        job_ids = [row.id for row in result.all()]

        if job_ids:
            reverse = await session.execute(
                select(Swipe.target_id)
                .where(Swipe.swiper_id == target_uuid)
                .where(Swipe.direction.in_(["like", "super_like"]))
                .where(Swipe.target_id.in_(job_ids))
            )
            reverse_row = reverse.first()
            if reverse_row:
                matched_job_id = reverse_row.target_id
                new_match = Match(
                    id=uuid.uuid4(),
                    worker_id=target_uuid,
                    employer_id=uid,
                    job_posting_id=matched_job_id,
                    matched_at=datetime.now(timezone.utc),
                )
                session.add(new_match)
                try:
                    await session.commit()
                    matched = True
                    match_id = str(new_match.id)

                    j = await session.get(JobPosting, matched_job_id)
                    job_title = j.title if j else "a job"
                    w_user = await session.get(User, target_uuid)
                    _fire_match_email(w_user.email if w_user else "", user.get("email", ""), job_title)

                    company_name, worker_name = await _match_display_names(session, uid, target_uuid)
                    chat_link = f"/chat/{match_id}"
                    await notify(session, target_uuid, "match", "notif.match.title", params={"name": company_name}, actor_id=uid, link=chat_link)
                    await notify(session, uid, "match", "notif.match.title", params={"name": worker_name}, actor_id=target_uuid, link=chat_link)
                    await notify_team(session, uid, "notif.match.title", params={"name": worker_name}, permission="view", link=chat_link)
                    await session.commit()
                except Exception:
                    await session.rollback()

    return SwipeResponse(matched=matched, match_id=match_id)


@router.delete("/last", response_model=UndoResponse)
@limiter.limit("60/minute", key_func=user_or_ip)
async def undo_last_swipe(
    request: Request,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    await _check_org_permission(session, user, "swipe_pass")

    # Most recent swipe
    result = await session.execute(
        select(Swipe)
        .where(Swipe.swiper_id == uid)
        .order_by(Swipe.created_at.desc())
        .limit(1)
    )
    swipe = result.scalars().first()
    if not swipe:
        raise HTTPException(404, "No swipes to undo")

    target_id = str(swipe.target_id)

    # Clean up match if it was a like/super_like
    if swipe.direction in ("like", "super_like"):
        role = user["role"]
        if role == "worker":
            mr = await session.execute(
                select(Match)
                .where(Match.worker_id == uid, Match.job_posting_id == swipe.target_id)
                .order_by(Match.matched_at.desc())
                .limit(1)
            )
        else:
            mr = await session.execute(
                select(Match)
                .where(Match.employer_id == uid, Match.worker_id == swipe.target_id)
                .order_by(Match.matched_at.desc())
                .limit(1)
            )
        match = mr.scalars().first()
        if match:
            await session.delete(match)

    await session.delete(swipe)
    await session.commit()

    return UndoResponse(undone=True, target_id=target_id)
