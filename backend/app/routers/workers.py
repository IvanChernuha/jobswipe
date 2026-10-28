import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import require_worker, require_employer
from app.db.session import get_session
from app.models.worker import WorkerProfile as WorkerProfileResponse, WorkerProfileUpdate, WorkerCard
from app.models.tables.worker import WorkerProfile, WorkerTag
from app.models.tables.tag import Tag
from app.models.tables.swipe import Swipe
from app.models.tables.job import JobPosting, JobPostingTag
from app.models.tables.employer import EmployerProfile
from app.models.tables.organization import OrgMember
from app.models.tables.user import User
from app.services.blocks import blocked_ids_for
from app.services.scoring import batch_expand_implications, best_job_score

router = APIRouter(prefix="/workers", tags=["workers"])


async def _fetch_worker_tags(session: AsyncSession, worker_id: str) -> list[dict]:
    result = await session.execute(
        select(WorkerTag.tag_id, Tag.id, Tag.name, Tag.category)
        .join(Tag, Tag.id == WorkerTag.tag_id)
        .where(WorkerTag.worker_id == uuid.UUID(worker_id))
    )
    return [{"id": str(r.id), "name": r.name, "category": r.category} for r in result.all()]


async def _sync_worker_tags(session: AsyncSession, worker_id: str, tag_ids: list[str]):
    uid = uuid.UUID(worker_id)
    # Validate
    valid_ids = []
    for tid in dict.fromkeys(tag_ids):
        try:
            t = uuid.UUID(tid)
        except ValueError:
            continue
        valid_ids.append(t)

    if valid_ids:
        result = await session.execute(select(Tag.id).where(Tag.id.in_(valid_ids)))
        existing = {row.id for row in result.all()}
        valid_ids = [t for t in valid_ids if t in existing]

    await session.execute(delete(WorkerTag).where(WorkerTag.worker_id == uid))
    for tid in valid_ids:
        session.add(WorkerTag(worker_id=uid, tag_id=tid))
    await session.commit()


@router.get("/me", response_model=WorkerProfileResponse)
async def get_my_profile(
    user: dict = Depends(require_worker),
    session: AsyncSession = Depends(get_session),
):
    profile = await session.get(WorkerProfile, uuid.UUID(user["id"]))
    if not profile:
        raise HTTPException(404, "Profile not found")
    tags = await _fetch_worker_tags(session, user["id"])
    return {
        "user_id": str(profile.user_id),
        "name": profile.name,
        "bio": profile.bio,
        "location": profile.location,
        "skills": profile.skills or [],
        "experience_years": profile.experience_years,
        "avatar_url": profile.avatar_url,
        "resume_url": profile.resume_url,
        "tags": tags,
    }


@router.put("/me", response_model=WorkerProfileResponse)
async def update_my_profile(
    body: WorkerProfileUpdate,
    user: dict = Depends(require_worker),
    session: AsyncSession = Depends(get_session),
):
    tag_ids = body.tag_ids
    updates = body.model_dump(exclude_none=True)
    updates.pop("tag_ids", None)

    if not updates and tag_ids is None:
        raise HTTPException(400, "No fields to update")

    uid = uuid.UUID(user["id"])
    profile = await session.get(WorkerProfile, uid)
    if not profile:
        raise HTTPException(404, "Profile not found")

    if updates:
        for key, val in updates.items():
            setattr(profile, key, val)
        session.add(profile)
        await session.commit()

    if tag_ids is not None:
        await _sync_worker_tags(session, user["id"], tag_ids)

    await session.refresh(profile)
    tags = await _fetch_worker_tags(session, user["id"])
    return {
        "user_id": str(profile.user_id),
        "name": profile.name,
        "bio": profile.bio,
        "location": profile.location,
        "skills": profile.skills or [],
        "experience_years": profile.experience_years,
        "avatar_url": profile.avatar_url,
        "resume_url": profile.resume_url,
        "tags": tags,
    }


async def _get_org_employer_ids(session: AsyncSession, user: dict) -> list[str]:
    """Get all employer IDs in the user's org, or just the user's own ID."""
    uid = uuid.UUID(user["id"])
    result = await session.execute(
        select(OrgMember.org_id).where(OrgMember.user_id == uid).limit(1)
    )
    row = result.first()
    if row:
        members = await session.execute(
            select(OrgMember.user_id).where(OrgMember.org_id == row.org_id)
        )
        return [str(m.user_id) for m in members.all()]
    return [user["id"]]


@router.get("/feed", response_model=list[WorkerCard])
async def employer_feed(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    location: str = Query(None),
    experience_min: int = Query(None, ge=0),
    experience_max: int = Query(None, ge=0),
    user: dict = Depends(require_employer),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])

    # 1. Swiped targets
    result = await session.execute(select(Swipe.target_id).where(Swipe.swiper_id == uid))
    swiped_ids = [row.target_id for row in result.all()]

    # 2. Unswiped workers who are neither suspended nor blocked (either direction)
    hidden_ids = set(swiped_ids) | await blocked_ids_for(session, uid)
    query = (
        select(WorkerProfile)
        .join(User, User.id == WorkerProfile.user_id)
        .where(WorkerProfile.name != "", User.suspended_at.is_(None))
    )
    if hidden_ids:
        query = query.where(WorkerProfile.user_id.not_in(hidden_ids))
    if experience_min is not None:
        query = query.where(WorkerProfile.experience_years >= experience_min)
    if experience_max is not None:
        query = query.where(WorkerProfile.experience_years <= experience_max)

    result = await session.execute(query)
    workers = result.scalars().all()

    if location:
        loc_lower = location.lower()
        workers = [w for w in workers if loc_lower in (w.location or "").lower()]

    if not workers:
        return []

    # 3. The team's LIVE jobs (active and not expired), org-aware. Each worker
    #    is scored against each job separately; the card shows the best one.
    org_emp_ids = await _get_org_employer_ids(session, user)
    org_emp_uuids = [uuid.UUID(eid) for eid in org_emp_ids]
    result = await session.execute(
        select(JobPosting.id, JobPosting.title, JobPosting.created_at).where(
            JobPosting.employer_id.in_(org_emp_uuids),
            JobPosting.active == True,
            JobPosting.expires_at >= datetime.now(timezone.utc),
        )
    )
    live_jobs = {
        row.id: {"id": row.id, "title": row.title, "created_at": row.created_at,
                 "tags": set(), "required": set(), "preferred": set()}
        for row in result.all()
    }

    if live_jobs:
        result = await session.execute(
            select(JobPostingTag).where(JobPostingTag.job_posting_id.in_(list(live_jobs)))
        )
        for jt in result.scalars().all():
            job = live_jobs[jt.job_posting_id]
            tid = str(jt.tag_id)
            job["tags"].add(tid)
            if jt.requirement == "required":
                job["required"].add(tid)
            elif jt.requirement == "preferred":
                job["preferred"].add(tid)

        all_job_tag_ids = set().union(*(j["tags"] for j in live_jobs.values()))
        job_impl_map = await batch_expand_implications(session, all_job_tag_ids)

        def expand_set(ids: set[str]) -> set[str]:
            expanded = set(ids)
            for tid in ids:
                expanded |= job_impl_map.get(tid, set())
            return expanded

        for job in live_jobs.values():
            job["tags"], job["required"], job["preferred"] = (
                expand_set(job["tags"]), expand_set(job["required"]), expand_set(job["preferred"])
            )

    # 4. Batch-fetch worker tags
    worker_ids = [w.user_id for w in workers]
    result = await session.execute(
        select(WorkerTag.worker_id, WorkerTag.tag_id, Tag.id, Tag.name, Tag.category)
        .join(Tag, Tag.id == WorkerTag.tag_id)
        .where(WorkerTag.worker_id.in_(worker_ids))
    )
    tags_by_worker: dict[str, list[dict]] = {}
    tag_ids_by_worker: dict[str, set[str]] = {}
    for row in result.all():
        wid = str(row.worker_id)
        tags_by_worker.setdefault(wid, []).append({"id": str(row.id), "name": row.name, "category": row.category})
        tag_ids_by_worker.setdefault(wid, set()).add(str(row.tag_id))

    # 5. Expand worker tags
    all_worker_tag_ids = set()
    for ids in tag_ids_by_worker.values():
        all_worker_tag_ids |= ids
    worker_impl_map = await batch_expand_implications(session, all_worker_tag_ids)

    worker_expanded: dict[str, set[str]] = {}
    for wid, tids in tag_ids_by_worker.items():
        expanded = set(tids)
        for tid in tids:
            expanded |= worker_impl_map.get(tid, set())
        worker_expanded[wid] = expanded

    # 6. Filter + score
    scored = []
    for w in workers:
        wid = str(w.user_id)
        w_expanded = worker_expanded.get(wid, set())

        if live_jobs:
            # None = fits none of the live jobs (a required/preferred rule fails).
            score = best_job_score(w_expanded, list(live_jobs.values()))
            if score is None:
                continue
        else:
            # No live jobs: show everyone, with no % (nothing to measure against).
            score = None

        scored.append({
            "id": wid,
            "name": w.name,
            "bio": w.bio,
            "location": w.location,
            "skills": w.skills or [],
            "experience_years": w.experience_years,
            "avatar_url": w.avatar_url,
            "tags": tags_by_worker.get(wid, []),
            "match_score": score,
        })

    def sort_key(card: dict) -> tuple[int, int]:
        s = card["match_score"]
        return (s["percentage"], s["matched"]) if s else (-1, -1)

    scored.sort(key=sort_key, reverse=True)
    offset = (page - 1) * size
    return scored[offset:offset + size]
