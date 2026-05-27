import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import require_employer, require_worker, require_employer_with_permission
from app.db.session import get_session
from app.models.employer import (
    EmployerProfile as EmployerProfileResponse, EmployerProfileUpdate, JobPostingCreate, JobPostingUpdate,
    JobPosting as JobPostingResponse, JobPostingWithStats, EmployerCard,
)
from app.models.tables.employer import EmployerProfile
from app.models.tables.job import JobPosting, JobPostingTag
from app.models.tables.tag import Tag
from app.models.tables.swipe import Swipe
from app.models.tables.match import Match
from app.models.tables.worker import WorkerProfile, WorkerTag
from app.models.tables.organization import OrgMember
from app.services.scoring import (
    expand_tags_with_implications_async, batch_expand_implications, compute_match_score,
)

router = APIRouter(prefix="/employers", tags=["employers"])


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _validate_tag_ids(session: AsyncSession, tag_ids: list[str]) -> list[uuid.UUID]:
    unique = []
    for tid in dict.fromkeys(tag_ids):
        try:
            unique.append(uuid.UUID(tid))
        except ValueError:
            continue
    if not unique:
        return []
    result = await session.execute(select(Tag.id).where(Tag.id.in_(unique)))
    existing = {row.id for row in result.all()}
    return [t for t in unique if t in existing]


async def _fetch_job_tags(session: AsyncSession, job_posting_id: uuid.UUID) -> list[dict]:
    result = await session.execute(
        select(JobPostingTag.tag_id, JobPostingTag.requirement, Tag.id, Tag.name, Tag.category)
        .join(Tag, Tag.id == JobPostingTag.tag_id)
        .where(JobPostingTag.job_posting_id == job_posting_id)
    )
    return [{"id": str(r.id), "name": r.name, "category": r.category, "requirement": r.requirement} for r in result.all()]


async def _sync_job_tags(session: AsyncSession, job_posting_id: uuid.UUID,
                         nice_ids: list[str], required_ids: list[str], preferred_ids: list[str]):
    nice = await _validate_tag_ids(session, nice_ids)
    required = await _validate_tag_ids(session, required_ids)
    preferred = await _validate_tag_ids(session, preferred_ids)

    required_set = set(required)
    preferred = [t for t in preferred if t not in required_set]
    preferred_set = set(preferred)
    nice = [t for t in nice if t not in required_set and t not in preferred_set]

    await session.execute(delete(JobPostingTag).where(JobPostingTag.job_posting_id == job_posting_id))
    for tid in required:
        session.add(JobPostingTag(job_posting_id=job_posting_id, tag_id=tid, requirement="required"))
    for tid in preferred:
        session.add(JobPostingTag(job_posting_id=job_posting_id, tag_id=tid, requirement="preferred"))
    for tid in nice:
        session.add(JobPostingTag(job_posting_id=job_posting_id, tag_id=tid, requirement="nice"))
    await session.commit()


async def _get_org_employer_ids(session: AsyncSession, user: dict) -> list[str]:
    org_id = user.get("org_id")
    if org_id:
        result = await session.execute(
            select(OrgMember.user_id).where(OrgMember.org_id == uuid.UUID(org_id))
        )
        return [str(m.user_id) for m in result.all()]
    return [user["id"]]


async def _verify_job_access(session: AsyncSession, job_id: str, user: dict) -> JobPosting:
    job = await session.get(JobPosting, uuid.UUID(job_id))
    if not job:
        raise HTTPException(404, "Job not found")
    allowed_ids = await _get_org_employer_ids(session, user)
    if str(job.employer_id) not in allowed_ids:
        raise HTTPException(403, "Not your job posting")
    return job


def _job_to_dict(job: JobPosting, tags: list[dict]) -> dict:
    return {
        "id": str(job.id), "employer_id": str(job.employer_id), "title": job.title,
        "description": job.description or "", "skills_required": job.skills_required or [],
        "salary_min": job.salary_min or 0, "salary_max": job.salary_max or 0,
        "location": job.location or "", "remote": job.remote or False,
        "active": job.active if job.active is not None else True,
        "created_at": str(job.created_at) if job.created_at else None,
        "expires_at": str(job.expires_at) if job.expires_at else None,
        "tags": tags,
    }


# ── Profile endpoints ────────────────────────────────────────────────────────

@router.get("/me", response_model=EmployerProfileResponse)
async def get_my_profile(user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    profile = await session.get(EmployerProfile, uuid.UUID(user["id"]))
    if not profile:
        raise HTTPException(404, "Profile not found")
    return {
        "user_id": str(profile.user_id), "company_name": profile.company_name,
        "description": profile.description, "industry": profile.industry,
        "location": profile.location, "avatar_url": profile.logo_url,
    }


@router.put("/me", response_model=EmployerProfileResponse)
async def update_my_profile(
    body: EmployerProfileUpdate, user: dict = Depends(require_employer),
    session: AsyncSession = Depends(get_session),
):
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(400, "No fields to update")

    uid = uuid.UUID(user["id"])
    profile = await session.get(EmployerProfile, uid)
    if not profile:
        raise HTTPException(404, "Profile not found")

    for key, val in updates.items():
        setattr(profile, key, val)
    session.add(profile)
    await session.commit()
    await session.refresh(profile)

    return {
        "user_id": str(profile.user_id), "company_name": profile.company_name,
        "description": profile.description, "industry": profile.industry,
        "location": profile.location, "avatar_url": profile.logo_url,
    }


# ── Job endpoints ────────────────────────────────────────────────────────────

@router.post("/jobs", response_model=JobPostingResponse, status_code=201)
async def create_job(
    body: JobPostingCreate, user: dict = Depends(require_employer_with_permission("create_job")),
    session: AsyncSession = Depends(get_session),
):
    job = JobPosting(
        id=uuid.uuid4(),
        employer_id=uuid.UUID(user["id"]),
        title=body.title,
        description=body.description,
        skills_required=body.skills_required,
        salary_min=body.salary_min,
        salary_max=body.salary_max,
        location=body.location,
        remote=body.remote,
        expires_at=datetime.now(timezone.utc) + timedelta(days=body.expires_in_days),
    )
    session.add(job)
    await session.commit()

    if body.tag_ids or body.required_tag_ids or body.preferred_tag_ids:
        await _sync_job_tags(session, job.id, body.tag_ids, body.required_tag_ids, body.preferred_tag_ids)

    tags = await _fetch_job_tags(session, job.id)
    return _job_to_dict(job, tags)


@router.get("/jobs", response_model=list[JobPostingWithStats])
async def list_my_jobs(
    user: dict = Depends(require_employer_with_permission("view")),
    session: AsyncSession = Depends(get_session),
):
    employer_ids = await _get_org_employer_ids(session, user)
    emp_uuids = [uuid.UUID(eid) for eid in employer_ids]

    result = await session.execute(
        select(JobPosting).where(JobPosting.employer_id.in_(emp_uuids)).order_by(JobPosting.created_at.desc())
    )
    jobs = result.scalars().all()
    if not jobs:
        return []

    job_ids = [j.id for j in jobs]

    # Batch tags
    tr = await session.execute(
        select(JobPostingTag.job_posting_id, JobPostingTag.requirement, Tag.id, Tag.name, Tag.category)
        .join(Tag, Tag.id == JobPostingTag.tag_id)
        .where(JobPostingTag.job_posting_id.in_(job_ids))
    )
    tags_by_job: dict[uuid.UUID, list[dict]] = {}
    for r in tr.all():
        tags_by_job.setdefault(r.job_posting_id, []).append(
            {"id": str(r.id), "name": r.name, "category": r.category, "requirement": r.requirement}
        )

    # Batch swipe stats
    sr = await session.execute(select(Swipe.target_id, Swipe.direction).where(Swipe.target_id.in_(job_ids)))
    swipe_counts: dict[uuid.UUID, int] = {}
    like_counts: dict[uuid.UUID, int] = {}
    for s in sr.all():
        swipe_counts[s.target_id] = swipe_counts.get(s.target_id, 0) + 1
        if s.direction in ("like", "super_like"):
            like_counts[s.target_id] = like_counts.get(s.target_id, 0) + 1

    # Batch match counts
    mr = await session.execute(
        select(Match.job_posting_id).where(Match.job_posting_id.in_(job_ids), Match.status == "active")
    )
    match_counts: dict[uuid.UUID, int] = {}
    for m in mr.all():
        match_counts[m.job_posting_id] = match_counts.get(m.job_posting_id, 0) + 1

    out = []
    for j in jobs:
        d = _job_to_dict(j, tags_by_job.get(j.id, []))
        d["swipe_count"] = swipe_counts.get(j.id, 0)
        d["like_count"] = like_counts.get(j.id, 0)
        d["match_count"] = match_counts.get(j.id, 0)
        out.append(d)
    return out


@router.put("/jobs/{job_id}", response_model=JobPostingResponse)
async def update_job(
    job_id: str, body: JobPostingUpdate,
    user: dict = Depends(require_employer_with_permission("edit_job")),
    session: AsyncSession = Depends(get_session),
):
    job = await _verify_job_access(session, job_id, user)

    updates = body.model_dump(exclude_none=True)
    tag_ids = updates.pop("tag_ids", None)
    required_tag_ids = updates.pop("required_tag_ids", None)
    preferred_tag_ids = updates.pop("preferred_tag_ids", None)
    expires_in_days = updates.pop("expires_in_days", None)

    if expires_in_days is not None:
        updates["expires_at"] = datetime.now(timezone.utc) + timedelta(days=expires_in_days)

    if "salary_min" in updates or "salary_max" in updates:
        s_min = updates.get("salary_min", job.salary_min)
        s_max = updates.get("salary_max", job.salary_max)
        if s_min is not None and s_max is not None and s_max > 0 and s_min > s_max:
            raise HTTPException(422, "salary_min cannot exceed salary_max")

    for key, val in updates.items():
        setattr(job, key, val)
    session.add(job)
    await session.commit()

    if tag_ids is not None or required_tag_ids is not None or preferred_tag_ids is not None:
        await _sync_job_tags(session, job.id, tag_ids or [], required_tag_ids or [], preferred_tag_ids or [])

    await session.refresh(job)
    tags = await _fetch_job_tags(session, job.id)
    return _job_to_dict(job, tags)


@router.patch("/jobs/{job_id}/toggle", response_model=JobPostingResponse)
async def toggle_job_active(
    job_id: str, user: dict = Depends(require_employer_with_permission("toggle_job")),
    session: AsyncSession = Depends(get_session),
):
    job = await _verify_job_access(session, job_id, user)
    job.active = not job.active
    session.add(job)
    await session.commit()
    await session.refresh(job)
    tags = await _fetch_job_tags(session, job.id)
    return _job_to_dict(job, tags)


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    job_id: str, user: dict = Depends(require_employer_with_permission("delete_job")),
    session: AsyncSession = Depends(get_session),
):
    job = await _verify_job_access(session, job_id, user)
    await session.delete(job)
    await session.commit()


# ── Worker feed (jobs shown to workers) ──────────────────────────────────────

@router.get("/feed", response_model=list[EmployerCard])
async def worker_feed(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    location: str = Query(None),
    salary_min: int = Query(None, ge=0),
    remote: bool = Query(None),
    user: dict = Depends(require_worker),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])

    # 1. Swiped targets
    result = await session.execute(select(Swipe.target_id).where(Swipe.swiper_id == uid))
    swiped_ids = [r.target_id for r in result.all()]

    # 2. Active non-expired jobs
    now = datetime.now(timezone.utc)
    query = select(JobPosting).where(JobPosting.active == True, JobPosting.expires_at >= now)
    if swiped_ids:
        query = query.where(JobPosting.id.not_in(swiped_ids))
    if remote is not None:
        query = query.where(JobPosting.remote == remote)
    if salary_min is not None:
        query = query.where(JobPosting.salary_max >= salary_min)

    result = await session.execute(query)
    jobs = result.scalars().all()

    if location:
        loc_lower = location.lower()
        jobs = [j for j in jobs if loc_lower in (j.location or "").lower()]

    if not jobs:
        return []

    # 3. Worker tags expanded
    wt_result = await session.execute(select(WorkerTag.tag_id).where(WorkerTag.worker_id == uid))
    worker_tag_ids = {str(r.tag_id) for r in wt_result.all()}
    worker_expanded = await expand_tags_with_implications_async(session, worker_tag_ids)

    # 4. Employer profiles
    employer_ids = list({j.employer_id for j in jobs})
    ep_result = await session.execute(select(EmployerProfile).where(EmployerProfile.user_id.in_(employer_ids)))
    ep_by_id = {ep.user_id: ep for ep in ep_result.scalars().all()}

    # 5. Job tags
    job_ids = [j.id for j in jobs]
    jt_result = await session.execute(
        select(JobPostingTag.job_posting_id, JobPostingTag.tag_id, JobPostingTag.requirement,
               Tag.id, Tag.name, Tag.category)
        .join(Tag, Tag.id == JobPostingTag.tag_id)
        .where(JobPostingTag.job_posting_id.in_(job_ids))
    )

    tags_by_job: dict[uuid.UUID, list[dict]] = {}
    tag_ids_by_job: dict[uuid.UUID, set[str]] = {}
    required_by_job: dict[uuid.UUID, set[str]] = {}
    preferred_by_job: dict[uuid.UUID, set[str]] = {}

    for r in jt_result.all():
        jid = r.job_posting_id
        tid = str(r.tag_id)
        tags_by_job.setdefault(jid, []).append(
            {"id": str(r.id), "name": r.name, "category": r.category, "requirement": r.requirement}
        )
        tag_ids_by_job.setdefault(jid, set()).add(tid)
        if r.requirement == "required":
            required_by_job.setdefault(jid, set()).add(tid)
        elif r.requirement == "preferred":
            preferred_by_job.setdefault(jid, set()).add(tid)

    # 6. Batch implications
    all_job_tag_ids = set()
    for ids in tag_ids_by_job.values():
        all_job_tag_ids |= ids
    impl_map = await batch_expand_implications(session, all_job_tag_ids)

    def expand_ids(ids: set[str]) -> set[str]:
        expanded = set(ids)
        for tid in ids:
            expanded |= impl_map.get(tid, set())
        return expanded

    # 7. Filter + score
    scored = []
    for job in jobs:
        ep = ep_by_id.get(job.employer_id)
        if not ep or not ep.company_name:
            continue

        jid = job.id
        req_ids = required_by_job.get(jid, set())
        pref_ids = preferred_by_job.get(jid, set())

        if req_ids and not expand_ids(req_ids).issubset(worker_expanded):
            continue
        if pref_ids and not (worker_expanded & expand_ids(pref_ids)):
            continue

        job_expanded = expand_ids(tag_ids_by_job.get(jid, set()))
        score = compute_match_score(worker_expanded, job_expanded)

        scored.append({
            "id": str(jid), "job_title": job.title, "description": job.description or "",
            "skills_required": job.skills_required or [],
            "salary_min": job.salary_min or 0, "salary_max": job.salary_max or 0,
            "location": job.location or "", "remote": job.remote or False,
            "company_name": ep.company_name, "industry": ep.industry or "",
            "avatar_url": ep.logo_url, "tags": tags_by_job.get(jid, []),
            "match_score": score,
        })

    scored.sort(key=lambda x: (x["match_score"]["percentage"], x["match_score"]["matched"]), reverse=True)
    offset = (page - 1) * size
    return scored[offset:offset + size]
