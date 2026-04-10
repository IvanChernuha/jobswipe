from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from app.deps import require_employer, require_worker, require_employer_with_permission
from app.models.employer import (
    EmployerProfile, EmployerProfileUpdate, JobPostingCreate, JobPostingUpdate,
    JobPosting, JobPostingWithStats, EmployerCard,
)
from app.db.client import get_client
from app.services.scoring import expand_tags_with_implications, compute_match_score

router = APIRouter(prefix="/employers", tags=["employers"])


def _normalize_profile(row: dict) -> dict:
    """Map logo_url -> avatar_url for frontend consistency."""
    row["avatar_url"] = row.pop("logo_url", None)
    return row


def _is_valid_uuid(s: str) -> bool:
    try:
        import uuid
        uuid.UUID(s)
        return True
    except (ValueError, AttributeError):
        return False


def _validate_tag_ids(db, tag_ids: list[str]) -> list[str]:
    """Deduplicate, validate UUID format, and check existence."""
    unique = list(dict.fromkeys(tag_ids))
    unique = [tid for tid in unique if _is_valid_uuid(tid)]
    if not unique:
        return []
    valid = db.table("tags").select("id").in_("id", unique).execute()
    valid_ids = {row["id"] for row in (valid.data or [])}
    return [tid for tid in unique if tid in valid_ids]


def _fetch_job_tags(db, job_posting_id: str) -> list[dict]:
    """Fetch tags linked to a job posting, including requirement type."""
    result = (
        db.table("job_posting_tags")
        .select("tag_id, requirement, tags(id, name, category)")
        .eq("job_posting_id", job_posting_id)
        .execute()
    )
    tags = []
    for row in (result.data or []):
        tag_data = row.get("tags")
        if tag_data:
            tag_data["requirement"] = row.get("requirement", "nice")
            tags.append(tag_data)
    return tags


def _sync_job_tags(db, job_posting_id: str,
                   nice_ids: list[str],
                   required_ids: list[str],
                   preferred_ids: list[str]):
    """Replace all tags for a job posting with categorized requirement types."""
    nice = _validate_tag_ids(db, nice_ids)
    required = _validate_tag_ids(db, required_ids)
    preferred = _validate_tag_ids(db, preferred_ids)

    # Remove duplicates across lists (required wins over preferred wins over nice)
    required_set = set(required)
    preferred = [t for t in preferred if t not in required_set]
    preferred_set = set(preferred)
    nice = [t for t in nice if t not in required_set and t not in preferred_set]

    db.table("job_posting_tags").delete().eq("job_posting_id", job_posting_id).execute()

    rows = []
    for tid in required:
        rows.append({"job_posting_id": job_posting_id, "tag_id": tid, "requirement": "required"})
    for tid in preferred:
        rows.append({"job_posting_id": job_posting_id, "tag_id": tid, "requirement": "preferred"})
    for tid in nice:
        rows.append({"job_posting_id": job_posting_id, "tag_id": tid, "requirement": "nice"})

    if rows:
        db.table("job_posting_tags").insert(rows).execute()


# ── Profile endpoints ────────────────────────────────────────────────────────

@router.get("/me", response_model=EmployerProfile)
async def get_my_profile(user: dict = Depends(require_employer)):
    db = get_client()
    result = db.table("employer_profiles").select("*").eq("user_id", user["id"]).single().execute()
    if not result.data:
        raise HTTPException(404, "Profile not found")
    return _normalize_profile(result.data)


@router.put("/me", response_model=EmployerProfile)
async def update_my_profile(body: EmployerProfileUpdate, user: dict = Depends(require_employer)):
    db = get_client()
    updates = body.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(400, "No fields to update")
    result = (
        db.table("employer_profiles")
        .upsert({"user_id": user["id"], **updates})
        .execute()
    )
    return _normalize_profile(result.data[0])


# ── Job endpoints ────────────────────────────────────────────────────────────

@router.post("/jobs", response_model=JobPosting, status_code=201)
async def create_job(body: JobPostingCreate, user: dict = Depends(require_employer_with_permission("create_job"))):
    db = get_client()
    job_data = body.model_dump()
    # Remove tag fields from job_data (they go to junction table)
    for key in ("tag_ids", "required_tag_ids", "preferred_tag_ids", "expires_in_days"):
        job_data.pop(key, None)
    job_data["employer_id"] = user["id"]
    job_data["expires_at"] = (datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)).isoformat()

    result = db.table("job_postings").insert(job_data).execute()
    job = result.data[0]

    if body.tag_ids or body.required_tag_ids or body.preferred_tag_ids:
        _sync_job_tags(db, job["id"], body.tag_ids, body.required_tag_ids, body.preferred_tag_ids)

    job["tags"] = _fetch_job_tags(db, job["id"])
    return job


def _get_org_employer_ids(db, user: dict) -> list[str]:
    """Get all employer IDs in the user's org, or just the user's own ID."""
    org_id = user.get("org_id")
    if org_id:
        members = db.table("org_members").select("user_id").eq("org_id", org_id).execute()
        return [m["user_id"] for m in (members.data or [])]
    return [user["id"]]


def _verify_job_access(db, job_id: str, user: dict) -> dict:
    """Verify the job exists and belongs to the user or their org. Returns job row."""
    existing = db.table("job_postings").select("id, employer_id").eq("id", job_id).execute()
    if not existing.data:
        raise HTTPException(404, "Job not found")
    job = existing.data[0]
    allowed_ids = _get_org_employer_ids(db, user)
    if job["employer_id"] not in allowed_ids:
        raise HTTPException(403, "Not your job posting")
    return job


@router.get("/jobs", response_model=list[JobPostingWithStats])
async def list_my_jobs(user: dict = Depends(require_employer_with_permission("view"))):
    db = get_client()
    employer_ids = _get_org_employer_ids(db, user)
    result = (
        db.table("job_postings")
        .select("*")
        .in_("employer_id", employer_ids)
        .order("created_at", desc=True)
        .execute()
    )
    jobs = result.data or []
    if not jobs:
        return []

    job_ids = [j["id"] for j in jobs]

    # Batch-fetch tags
    tag_rows = (
        db.table("job_posting_tags")
        .select("job_posting_id, requirement, tags(id, name, category)")
        .in_("job_posting_id", job_ids)
        .execute()
    )
    tags_by_job: dict[str, list[dict]] = {}
    for row in (tag_rows.data or []):
        tag_data = row.get("tags")
        if tag_data:
            tag_data["requirement"] = row.get("requirement", "nice")
            tags_by_job.setdefault(row["job_posting_id"], []).append(tag_data)

    # Batch-fetch swipe stats
    swipe_rows = (
        db.table("swipes")
        .select("target_id, direction")
        .in_("target_id", job_ids)
        .execute()
    )
    swipe_counts: dict[str, int] = {}
    like_counts: dict[str, int] = {}
    for s in (swipe_rows.data or []):
        tid = s["target_id"]
        swipe_counts[tid] = swipe_counts.get(tid, 0) + 1
        if s["direction"] in ("like", "super_like"):
            like_counts[tid] = like_counts.get(tid, 0) + 1

    # Batch-fetch match counts
    match_rows = (
        db.table("matches")
        .select("job_posting_id")
        .in_("job_posting_id", job_ids)
        .eq("status", "active")
        .execute()
    )
    match_counts: dict[str, int] = {}
    for m in (match_rows.data or []):
        jid = m["job_posting_id"]
        match_counts[jid] = match_counts.get(jid, 0) + 1

    for job in jobs:
        jid = job["id"]
        job["tags"] = tags_by_job.get(jid, [])
        job["swipe_count"] = swipe_counts.get(jid, 0)
        job["like_count"] = like_counts.get(jid, 0)
        job["match_count"] = match_counts.get(jid, 0)

    return jobs


@router.put("/jobs/{job_id}", response_model=JobPosting)
async def update_job(job_id: str, body: JobPostingUpdate, user: dict = Depends(require_employer_with_permission("edit_job"))):
    db = get_client()
    _verify_job_access(db, job_id, user)

    # Build updates (exclude tag fields)
    updates = body.model_dump(exclude_none=True)
    tag_ids = updates.pop("tag_ids", None)
    required_tag_ids = updates.pop("required_tag_ids", None)
    preferred_tag_ids = updates.pop("preferred_tag_ids", None)
    expires_in_days = updates.pop("expires_in_days", None)

    if expires_in_days is not None:
        updates["expires_at"] = (datetime.now(timezone.utc) + timedelta(days=expires_in_days)).isoformat()

    # Validate salary range (guard against None from freshly-created rows)
    if "salary_min" in updates or "salary_max" in updates:
        current = db.table("job_postings").select("salary_min, salary_max").eq("id", job_id).single().execute().data
        s_min = updates.get("salary_min", current["salary_min"])
        s_max = updates.get("salary_max", current["salary_max"])
        if s_min is not None and s_max is not None and s_max > 0 and s_min > s_max:
            raise HTTPException(422, "salary_min cannot exceed salary_max")

    if updates:
        db.table("job_postings").update(updates).eq("id", job_id).execute()

    # Update tags if any were provided
    if tag_ids is not None or required_tag_ids is not None or preferred_tag_ids is not None:
        _sync_job_tags(db, job_id, tag_ids or [], required_tag_ids or [], preferred_tag_ids or [])

    job = db.table("job_postings").select("*").eq("id", job_id).single().execute().data
    job["tags"] = _fetch_job_tags(db, job_id)
    return job


@router.patch("/jobs/{job_id}/toggle", response_model=JobPosting)
async def toggle_job_active(job_id: str, user: dict = Depends(require_employer_with_permission("toggle_job"))):
    db = get_client()
    _verify_job_access(db, job_id, user)

    existing = db.table("job_postings").select("active").eq("id", job_id).single().execute()
    new_active = not existing.data["active"]
    db.table("job_postings").update({"active": new_active}).eq("id", job_id).execute()

    job = db.table("job_postings").select("*").eq("id", job_id).single().execute().data
    job["tags"] = _fetch_job_tags(db, job_id)
    return job


@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(job_id: str, user: dict = Depends(require_employer_with_permission("delete_job"))):
    db = get_client()
    _verify_job_access(db, job_id, user)

    db.table("job_postings").delete().eq("id", job_id).execute()


# ── Worker feed (jobs shown to workers) ──────────────────────────────────────

@router.get("/feed", response_model=list[EmployerCard])
async def worker_feed(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    location: str = Query(None, description="Filter by job location (substring match)"),
    salary_min: int = Query(None, ge=0, description="Minimum salary floor"),
    remote: bool = Query(None, description="Filter remote-only jobs"),
    user: dict = Depends(require_worker),
):
    """
    Return job postings the worker has not yet swiped on.
    Hard-filters by required/preferred tags, then scores and sorts by relevance.
    """
    db = get_client()

    # 1. Already-swiped targets
    swiped = (
        db.table("swipes")
        .select("target_id")
        .eq("swiper_id", user["id"])
        .execute()
    )
    swiped_ids = list({s["target_id"] for s in (swiped.data or [])})

    # 2. Fetch all unswiped active, non-expired jobs
    now_iso = datetime.now(timezone.utc).isoformat()
    query = (
        db.table("job_postings")
        .select("id, title, description, skills_required, salary_min, salary_max, location, remote, employer_id")
        .eq("active", True)
        .gte("expires_at", now_iso)
    )
    if swiped_ids:
        query = query.not_.in_("id", swiped_ids)
    if remote is not None:
        query = query.eq("remote", remote)
    if salary_min is not None:
        query = query.gte("salary_max", salary_min)
    jobs = query.execute().data or []

    # Client-side location filter (substring, case-insensitive)
    if location:
        loc_lower = location.lower()
        jobs = [j for j in jobs if loc_lower in (j.get("location") or "").lower()]

    if not jobs:
        return []

    # 3. Worker's tags expanded
    worker_tag_rows = (
        db.table("worker_tags")
        .select("tag_id")
        .eq("worker_id", user["id"])
        .execute()
    )
    worker_tag_ids = {r["tag_id"] for r in (worker_tag_rows.data or [])}
    worker_expanded = expand_tags_with_implications(db, worker_tag_ids)

    # 4. Batch-fetch employer profiles
    employer_ids = list({j["employer_id"] for j in jobs})
    ep_raw = (
        db.table("employer_profiles")
        .select("user_id, company_name, industry, logo_url")
        .in_("user_id", employer_ids)
        .execute()
    )
    ep_by_id = {row["user_id"]: row for row in (ep_raw.data or [])}

    # 5. Batch-fetch ALL job tags with requirement type
    job_ids = [j["id"] for j in jobs]
    tag_rows = (
        db.table("job_posting_tags")
        .select("job_posting_id, tag_id, requirement, tags(id, name, category)")
        .in_("job_posting_id", job_ids)
        .execute()
    )

    # Build per-job structures
    tags_by_job: dict[str, list[dict]] = {}        # display tags
    tag_ids_by_job: dict[str, set[str]] = {}       # all tag IDs (for scoring)
    required_by_job: dict[str, set[str]] = {}      # required tag IDs
    preferred_by_job: dict[str, set[str]] = {}     # preferred tag IDs

    for row in (tag_rows.data or []):
        jid = row["job_posting_id"]
        req = row.get("requirement", "nice")
        tag_data = row.get("tags")
        if tag_data:
            tag_data["requirement"] = req
            tags_by_job.setdefault(jid, []).append(tag_data)
        tag_ids_by_job.setdefault(jid, set()).add(row["tag_id"])
        if req == "required":
            required_by_job.setdefault(jid, set()).add(row["tag_id"])
        elif req == "preferred":
            preferred_by_job.setdefault(jid, set()).add(row["tag_id"])

    # 6. Batch-expand all job tags with implications
    all_job_tag_ids = set()
    for ids in tag_ids_by_job.values():
        all_job_tag_ids |= ids
    impl_map: dict[str, set[str]] = {}
    if all_job_tag_ids:
        impl_rows = (
            db.table("tag_implications")
            .select("parent_tag_id, implied_tag_id")
            .in_("parent_tag_id", list(all_job_tag_ids))
            .execute()
        )
        for r in (impl_rows.data or []):
            impl_map.setdefault(r["parent_tag_id"], set()).add(r["implied_tag_id"])

    def expand_ids(ids: set[str]) -> set[str]:
        expanded = set(ids)
        for tid in ids:
            expanded |= impl_map.get(tid, set())
        return expanded

    # 7. Filter + score
    scored_items = []
    for job in jobs:
        ep = ep_by_id.get(job["employer_id"], {})
        if not ep.get("company_name"):
            continue

        jid = job["id"]
        req_ids = required_by_job.get(jid, set())
        pref_ids = preferred_by_job.get(jid, set())

        # Hard filter: worker must have ALL required tags (expanded)
        if req_ids:
            req_expanded = expand_ids(req_ids)
            if not req_expanded.issubset(worker_expanded):
                continue

        # Hard filter: worker must have at least 1 preferred tag (expanded)
        if pref_ids:
            pref_expanded = expand_ids(pref_ids)
            if not (worker_expanded & pref_expanded):
                continue

        # Score against all job tags
        job_expanded = expand_ids(tag_ids_by_job.get(jid, set()))
        score = compute_match_score(worker_expanded, job_expanded)

        scored_items.append({
            "id": jid,
            "job_title": job["title"],
            "description": job["description"],
            "skills_required": job["skills_required"] or [],
            "salary_min": job["salary_min"],
            "salary_max": job["salary_max"],
            "location": job["location"],
            "remote": job["remote"],
            "company_name": ep.get("company_name", ""),
            "industry": ep.get("industry", ""),
            "avatar_url": ep.get("logo_url"),
            "tags": tags_by_job.get(jid, []),
            "match_score": score,
        })

    # 8. Sort by relevance
    scored_items.sort(key=lambda x: (x["match_score"]["percentage"], x["match_score"]["matched"]), reverse=True)

    # 9. Paginate
    offset = (page - 1) * size
    return scored_items[offset:offset + size]
