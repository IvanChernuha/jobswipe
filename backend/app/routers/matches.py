import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.db.session import get_session
from app.models.match import MatchResponse
from app.models.message import UnreadCount
from app.models.tables.match import Match
from app.models.tables.job import JobPosting
from app.models.tables.employer import EmployerProfile
from app.models.tables.worker import WorkerProfile
from app.models.tables.user import User
from app.models.tables.message import Message, MessageReadCursor
from app.services.org_access import get_org_employer_ids

router = APIRouter(prefix="/matches", tags=["matches"])


@router.get("", response_model=list[MatchResponse])
async def list_matches(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = user["id"]
    role = user["role"]
    uid_uuid = uuid.UUID(uid)

    if role == "worker":
        result = await session.execute(
            select(Match)
            .where(Match.worker_id == uid_uuid, Match.status == "active")
            .order_by(Match.matched_at.desc())
        )
    else:
        employer_ids = await get_org_employer_ids(session, uid)
        emp_uuids = [uuid.UUID(eid) for eid in employer_ids]
        result = await session.execute(
            select(Match)
            .where(Match.employer_id.in_(emp_uuids), Match.status == "active")
            .order_by(Match.matched_at.desc())
        )

    matches = result.scalars().all()
    if not matches:
        return []

    # Batch-fetch job postings
    job_ids = [m.job_posting_id for m in matches if m.job_posting_id]
    jobs_by_id = {}
    if job_ids:
        jr = await session.execute(select(JobPosting).where(JobPosting.id.in_(job_ids)))
        jobs_by_id = {j.id: j for j in jr.scalars().all()}

    # Batch-fetch counterpart profiles
    if role == "worker":
        cp_ids = [m.employer_id for m in matches]
        cr = await session.execute(select(EmployerProfile).where(EmployerProfile.user_id.in_(cp_ids)))
        counterparts = {ep.user_id: ep for ep in cr.scalars().all()}
    else:
        cp_ids = [m.worker_id for m in matches]
        cr = await session.execute(select(WorkerProfile).where(WorkerProfile.user_id.in_(cp_ids)))
        counterparts = {wp.user_id: wp for wp in cr.scalars().all()}

    out = []
    for m in matches:
        job = jobs_by_id.get(m.job_posting_id)
        base = {
            "id": str(m.id),
            "worker_id": str(m.worker_id),
            "employer_id": str(m.employer_id),
            "job_posting_id": str(m.job_posting_id) if m.job_posting_id else None,
            "matched_at": str(m.matched_at) if m.matched_at else None,
            "status": m.status,
        }
        if role == "worker":
            ep = counterparts.get(m.employer_id)
            base["employer"] = {
                "company_name": ep.company_name if ep else "",
                "industry": ep.industry if ep else "",
                "avatar_url": ep.logo_url if ep else None,
                "job_title": job.title if job else "",
                "location": job.location if job else "",
            }
        else:
            wp = counterparts.get(m.worker_id)
            base["worker"] = {
                "name": wp.name if wp else "",
                "avatar_url": wp.avatar_url if wp else None,
                "skills": wp.skills if wp else [],
                "experience_years": wp.experience_years if wp else 0,
            }
        out.append(base)

    return out


@router.get("/unread", response_model=list[UnreadCount])
async def unread_counts(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = user["id"]
    role = user["role"]
    uid_uuid = uuid.UUID(uid)

    if role == "worker":
        result = await session.execute(
            select(Match.id).where(Match.worker_id == uid_uuid, Match.status == "active")
        )
    else:
        employer_ids = await get_org_employer_ids(session, uid)
        emp_uuids = [uuid.UUID(eid) for eid in employer_ids]
        result = await session.execute(
            select(Match.id).where(Match.employer_id.in_(emp_uuids), Match.status == "active")
        )

    match_ids = [row.id for row in result.all()]
    if not match_ids:
        return []

    # Read cursors
    cr = await session.execute(
        select(MessageReadCursor)
        .where(MessageReadCursor.user_id == uid_uuid, MessageReadCursor.match_id.in_(match_ids))
    )
    cursor_map = {c.match_id: c.last_read_at for c in cr.scalars().all()}

    out = []
    for mid in match_ids:
        q = (
            select(func.count(Message.id))
            .where(Message.match_id == mid, Message.sender_id != uid_uuid)
        )
        last_read = cursor_map.get(mid)
        if last_read:
            q = q.where(Message.created_at > last_read)

        result = await session.execute(q)
        count = result.scalar() or 0
        if count > 0:
            out.append({"match_id": str(mid), "count": count})

    return out


@router.get("/{match_id}", response_model=MatchResponse)
async def get_match(
    match_id: str,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = user["id"]
    match = await session.get(Match, uuid.UUID(match_id))
    if not match:
        raise HTTPException(404, "Match not found")

    if user["role"] == "worker":
        if uid != str(match.worker_id):
            raise HTTPException(403, "Access denied")
    else:
        org_ids = await get_org_employer_ids(session, uid)
        if str(match.employer_id) not in org_ids:
            raise HTTPException(403, "Access denied")

    # Contact emails
    worker_user = await session.get(User, match.worker_id)
    employer_user = await session.get(User, match.employer_id)

    if user["role"] == "worker":
        contact_email = employer_user.email if employer_user else None
    else:
        contact_email = worker_user.email if worker_user else None

    return {
        "id": str(match.id),
        "worker_id": str(match.worker_id),
        "employer_id": str(match.employer_id),
        "job_posting_id": str(match.job_posting_id) if match.job_posting_id else None,
        "matched_at": str(match.matched_at) if match.matched_at else None,
        "status": match.status,
        "contact_email": contact_email,
    }
