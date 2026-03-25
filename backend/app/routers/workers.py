from fastapi import APIRouter, Depends, HTTPException, Query
from app.deps import require_worker, require_employer
from app.models.worker import WorkerProfile, WorkerProfileUpdate, WorkerCard
from app.db.client import get_client
from app.services.scoring import expand_tags_with_implications, compute_match_score
from app.routers.employers import _get_org_employer_ids

router = APIRouter(prefix="/workers", tags=["workers"])


def _fetch_worker_tags(db, worker_id: str) -> list[dict]:
    """Fetch tags linked to a worker."""
    result = (
        db.table("worker_tags")
        .select("tag_id, tags(id, name, category)")
        .eq("worker_id", worker_id)
        .execute()
    )
    tags = []
    for row in (result.data or []):
        tag_data = row.get("tags")
        if tag_data:
            tags.append(tag_data)
    return tags


def _is_valid_uuid(s: str) -> bool:
    try:
        import uuid
        uuid.UUID(s)
        return True
    except (ValueError, AttributeError):
        return False


def _sync_worker_tags(db, worker_id: str, tag_ids: list[str]):
    """Replace all tags for a worker with the given tag_ids."""
    unique_ids = list(dict.fromkeys(tag_ids))
    unique_ids = [tid for tid in unique_ids if _is_valid_uuid(tid)]
    if unique_ids:
        valid = db.table("tags").select("id").in_("id", unique_ids).execute()
        valid_ids = {row["id"] for row in (valid.data or [])}
        unique_ids = [tid for tid in unique_ids if tid in valid_ids]
    db.table("worker_tags").delete().eq("worker_id", worker_id).execute()
    if unique_ids:
        rows = [{"worker_id": worker_id, "tag_id": tid} for tid in unique_ids]
        db.table("worker_tags").insert(rows).execute()


@router.get("/me", response_model=WorkerProfile)
async def get_my_profile(user: dict = Depends(require_worker)):
    db = get_client()
    result = db.table("worker_profiles").select("*").eq("user_id", user["id"]).single().execute()
    if not result.data:
        raise HTTPException(404, "Profile not found")
    profile = result.data
    profile["tags"] = _fetch_worker_tags(db, user["id"])
    return profile


@router.put("/me", response_model=WorkerProfile)
async def update_my_profile(body: WorkerProfileUpdate, user: dict = Depends(require_worker)):
    db = get_client()
    tag_ids = body.tag_ids
    updates = body.model_dump(exclude_none=True)
    updates.pop("tag_ids", None)

    if not updates and tag_ids is None:
        raise HTTPException(400, "No fields to update")

    if updates:
        result = (
            db.table("worker_profiles")
            .upsert({"user_id": user["id"], **updates})
            .execute()
        )
        profile_data = result.data[0]
    else:
        result = db.table("worker_profiles").select("*").eq("user_id", user["id"]).single().execute()
        if not result.data:
            raise HTTPException(404, "Profile not found")
        profile_data = result.data

    if tag_ids is not None:
        _sync_worker_tags(db, user["id"], tag_ids)

    profile_data["tags"] = _fetch_worker_tags(db, user["id"])
    return profile_data


@router.get("/feed", response_model=list[WorkerCard])
async def employer_feed(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=50),
    location: str = Query(None, description="Filter by worker location (substring match)"),
    experience_min: int = Query(None, ge=0, description="Minimum years of experience"),
    experience_max: int = Query(None, ge=0, description="Maximum years of experience"),
    user: dict = Depends(require_employer),
):
    """
    Return worker profiles the employer has not yet swiped on,
    scored and sorted by tag relevance (best matches first).
    """
    db = get_client()

    # 1. Get already-swiped targets
    swiped = (
        db.table("swipes")
        .select("target_id")
        .eq("swiper_id", user["id"])
        .execute()
    )
    swiped_ids = [s["target_id"] for s in (swiped.data or [])]

    # 2. Fetch all unswiped workers (paginate after scoring)
    query = (
        db.table("worker_profiles")
        .select("user_id, name, bio, location, skills, experience_years, avatar_url")
        .neq("name", "")
    )
    if swiped_ids:
        query = query.not_.in_("user_id", swiped_ids)
    if experience_min is not None:
        query = query.gte("experience_years", experience_min)
    if experience_max is not None:
        query = query.lte("experience_years", experience_max)
    raw = query.execute()
    workers = raw.data or []

    # Client-side location filter (substring, case-insensitive)
    if location:
        loc_lower = location.lower()
        workers = [w for w in workers if loc_lower in (w.get("location") or "").lower()]

    if not workers:
        return []

    # 3. Get all job posting IDs for this employer (or their whole org)
    org_employer_ids = _get_org_employer_ids(db, user)
    employer_jobs = (
        db.table("job_postings")
        .select("id")
        .in_("employer_id", org_employer_ids)
        .eq("active", True)
        .execute()
    )
    employer_job_ids = [j["id"] for j in (employer_jobs.data or [])]

    # Build per-job tag structures for filtering
    all_employer_tag_ids: set[str] = set()
    job_required: dict[str, set[str]] = {}   # job_id -> required tag IDs
    job_preferred: dict[str, set[str]] = {}  # job_id -> preferred tag IDs
    job_all_tags: dict[str, set[str]] = {}   # job_id -> all tag IDs

    if employer_job_ids:
        jt_rows = (
            db.table("job_posting_tags")
            .select("job_posting_id, tag_id, requirement")
            .in_("job_posting_id", employer_job_ids)
            .execute()
        )
        for r in (jt_rows.data or []):
            jid = r["job_posting_id"]
            tid = r["tag_id"]
            all_employer_tag_ids.add(tid)
            job_all_tags.setdefault(jid, set()).add(tid)
            req = r.get("requirement", "nice")
            if req == "required":
                job_required.setdefault(jid, set()).add(tid)
            elif req == "preferred":
                job_preferred.setdefault(jid, set()).add(tid)

    # Expand all employer tags for scoring
    employer_expanded = expand_tags_with_implications(db, all_employer_tag_ids)

    # Build implications map for per-job expansion
    emp_impl_map: dict[str, set[str]] = {}
    if all_employer_tag_ids:
        emp_impl_rows = (
            db.table("tag_implications")
            .select("parent_tag_id, implied_tag_id")
            .in_("parent_tag_id", list(all_employer_tag_ids))
            .execute()
        )
        for r in (emp_impl_rows.data or []):
            emp_impl_map.setdefault(r["parent_tag_id"], set()).add(r["implied_tag_id"])

    def expand_set(ids: set[str]) -> set[str]:
        expanded = set(ids)
        for tid in ids:
            expanded |= emp_impl_map.get(tid, set())
        return expanded

    # 4. Batch-fetch worker tags
    worker_ids = [w["user_id"] for w in workers]
    tag_rows = (
        db.table("worker_tags")
        .select("worker_id, tag_id, tags(id, name, category)")
        .in_("worker_id", worker_ids)
        .execute()
    )
    tags_by_worker: dict[str, list[dict]] = {}
    tag_ids_by_worker: dict[str, set[str]] = {}
    for row in (tag_rows.data or []):
        wid = row["worker_id"]
        tag_data = row.get("tags")
        if tag_data:
            tags_by_worker.setdefault(wid, []).append(tag_data)
        tag_ids_by_worker.setdefault(wid, set()).add(row["tag_id"])

    # 5. Expand worker tags with implications (batch)
    worker_expanded: dict[str, set[str]] = {}
    if tag_ids_by_worker:
        all_worker_tag_ids = set()
        for ids in tag_ids_by_worker.values():
            all_worker_tag_ids |= ids
        impl_rows = (
            db.table("tag_implications")
            .select("parent_tag_id, implied_tag_id")
            .in_("parent_tag_id", list(all_worker_tag_ids))
            .execute()
        )
        impl_map: dict[str, set[str]] = {}
        for r in (impl_rows.data or []):
            impl_map.setdefault(r["parent_tag_id"], set()).add(r["implied_tag_id"])

        for wid, tids in tag_ids_by_worker.items():
            expanded = set(tids)
            for tid in tids:
                expanded |= impl_map.get(tid, set())
            worker_expanded[wid] = expanded

    # 6. Filter + score
    # A worker passes if they qualify for AT LEAST ONE of the employer's jobs
    scored_items = []
    for row in workers:
        wid = row["user_id"]
        worker_tags_expanded = worker_expanded.get(wid, set())

        # Per-job qualification: worker must pass filters for at least one job
        qualifies = False
        if not employer_job_ids:
            qualifies = True  # no jobs = show all workers
        else:
            for jid in employer_job_ids:
                req_ids = job_required.get(jid, set())
                pref_ids = job_preferred.get(jid, set())

                # Required: worker must have ALL (expanded)
                if req_ids:
                    req_expanded = expand_set(req_ids)
                    if not req_expanded.issubset(worker_tags_expanded):
                        continue

                # Preferred: worker must have at least 1 (expanded)
                if pref_ids:
                    pref_expanded = expand_set(pref_ids)
                    if not (worker_tags_expanded & pref_expanded):
                        continue

                qualifies = True
                break

        if not qualifies:
            continue

        # Score: how well does this worker match what the employer needs?
        score = compute_match_score(worker_tags_expanded, employer_expanded)
        scored_items.append({
            "id": wid,
            "name": row["name"],
            "bio": row["bio"],
            "location": row["location"],
            "skills": row["skills"],
            "experience_years": row["experience_years"],
            "avatar_url": row["avatar_url"],
            "tags": tags_by_worker.get(wid, []),
            "match_score": score,
        })

    # 7. Sort by match percentage desc
    scored_items.sort(key=lambda x: (x["match_score"]["percentage"], x["match_score"]["matched"]), reverse=True)

    # 8. Paginate after sorting
    offset = (page - 1) * size
    return scored_items[offset:offset + size]
