from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.deps import get_current_user
from app.db.client import get_client
from app.models.tag import Tag
from app.services.scoring import expand_tags_with_implications, compute_match_score

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


class BookmarkRequest(BaseModel):
    target_id: str
    note: str = ""


class BookmarkMoveRequest(BaseModel):
    job_posting_id: Optional[str] = None  # None = unsorted


class BookmarkNoteRequest(BaseModel):
    note: str


class BookmarkTarget(BaseModel):
    """Enriched bookmark with resolved target details."""
    id: str
    user_id: str
    target_id: str
    created_at: Optional[str] = None
    expires_at: Optional[str] = None
    job_posting_id: Optional[str] = None
    note: str = ""
    # Resolved fields (worker targets)
    name: Optional[str] = None
    avatar_url: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    experience_years: Optional[int] = None
    skills: Optional[list[str]] = None
    # Resolved fields (job targets)
    job_title: Optional[str] = None
    company_name: Optional[str] = None
    description: Optional[str] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    remote: Optional[bool] = None
    tags: list[Tag] = []

    model_config = {"extra": "ignore"}


class BookmarkBasic(BaseModel):
    id: str
    user_id: str
    target_id: str
    job_posting_id: Optional[str] = None
    note: str = ""
    created_at: Optional[str] = None
    expires_at: Optional[str] = None

    model_config = {"extra": "ignore"}


class BookmarkGroup(BaseModel):
    """A group of bookmarks under one job posting."""
    job_posting_id: Optional[str] = None
    job_title: str  # "Unsorted" for null
    bookmarks: list[BookmarkTarget] = []

    model_config = {"extra": "ignore"}


def _auto_assign_job(db, employer_id: str, worker_target_id: str) -> Optional[str]:
    """Find the best-fit job posting for a worker based on tag overlap."""
    # Get worker tags
    wt_rows = (
        db.table("worker_tags")
        .select("tag_id")
        .eq("worker_id", worker_target_id)
        .execute()
    )
    worker_tag_ids = {r["tag_id"] for r in (wt_rows.data or [])}
    if not worker_tag_ids:
        return None

    worker_expanded = expand_tags_with_implications(db, worker_tag_ids)

    # Get employer's active jobs
    jobs = (
        db.table("job_postings")
        .select("id")
        .eq("employer_id", employer_id)
        .eq("active", True)
        .execute()
    )
    job_ids = [j["id"] for j in (jobs.data or [])]
    if not job_ids:
        return None

    # Get tags for all jobs
    jt_rows = (
        db.table("job_posting_tags")
        .select("job_posting_id, tag_id")
        .in_("job_posting_id", job_ids)
        .execute()
    )
    tags_by_job: dict[str, set[str]] = {}
    for r in (jt_rows.data or []):
        tags_by_job.setdefault(r["job_posting_id"], set()).add(r["tag_id"])

    # Fetch ALL implications in a single query (not per-job — avoids N+1).
    all_job_tag_ids = set()
    for jtags in tags_by_job.values():
        all_job_tag_ids.update(jtags)
    all_impl_rows = (
        db.table("tag_implications")
        .select("parent_tag_id, implied_tag_id")
        .in_("parent_tag_id", list(all_job_tag_ids))
        .execute()
    ) if all_job_tag_ids else type("R", (), {"data": []})()
    implications: dict[str, set[str]] = {}
    for r in (all_impl_rows.data or []):
        implications.setdefault(r["parent_tag_id"], set()).add(r["implied_tag_id"])

    # Score each job, pick best
    best_job = None
    best_pct = 0
    for jid, jtags in tags_by_job.items():
        job_expanded = set(jtags)
        for tid in jtags:
            job_expanded.update(implications.get(tid, set()))
        score = compute_match_score(worker_expanded, job_expanded)
        if score["percentage"] > best_pct:
            best_pct = score["percentage"]
            best_job = jid

    return best_job if best_pct > 0 else None


def _get_employer_job_ids(db, user: dict) -> list[str]:
    """Get job IDs for employer (org-aware)."""
    from app.routers.employers import _get_org_employer_ids
    employer_ids = _get_org_employer_ids(db, user)
    jobs = (
        db.table("job_postings")
        .select("id")
        .in_("employer_id", employer_ids)
        .execute()
    )
    return [j["id"] for j in (jobs.data or [])]


@router.get("", response_model=list[BookmarkGroup])
async def list_bookmarks_grouped(user: dict = Depends(get_current_user)):
    db = get_client()
    uid = user["id"]
    role = user["role"]

    now_iso = datetime.now(timezone.utc).isoformat()
    result = (
        db.table("bookmarks")
        .select("*")
        .eq("user_id", uid)
        .gte("expires_at", now_iso)
        .order("created_at", desc=True)
        .execute()
    )
    bookmarks = result.data or []
    if not bookmarks:
        return []

    target_ids = [b["target_id"] for b in bookmarks]

    # ── Resolve targets ──
    if role == "worker":
        # Worker bookmarks = job postings
        jobs_raw = (
            db.table("job_postings")
            .select("id, title, description, salary_min, salary_max, location, remote, employer_id")
            .in_("id", target_ids)
            .execute()
        )
        jobs_by_id = {j["id"]: j for j in (jobs_raw.data or [])}

        employer_ids = list({j["employer_id"] for j in (jobs_raw.data or [])})
        ep_by_id = {}
        if employer_ids:
            ep_raw = (
                db.table("employer_profiles")
                .select("user_id, company_name, logo_url")
                .in_("user_id", employer_ids)
                .execute()
            )
            ep_by_id = {r["user_id"]: r for r in (ep_raw.data or [])}

        tags_by_job: dict[str, list[dict]] = {}
        if target_ids:
            tag_rows = (
                db.table("job_posting_tags")
                .select("job_posting_id, requirement, tags(id, name, category)")
                .in_("job_posting_id", target_ids)
                .execute()
            )
            for row in (tag_rows.data or []):
                td = row.get("tags")
                if td:
                    td["requirement"] = row.get("requirement", "nice")
                    tags_by_job.setdefault(row["job_posting_id"], []).append(td)

        enriched = []
        for bm in bookmarks:
            job = jobs_by_id.get(bm["target_id"])
            ep = ep_by_id.get(job["employer_id"], {}) if job else {}
            enriched.append({
                **bm,
                "job_title": job["title"] if job else None,
                "description": job["description"] if job else None,
                "company_name": ep.get("company_name"),
                "avatar_url": ep.get("logo_url"),
                "salary_min": job["salary_min"] if job else None,
                "salary_max": job["salary_max"] if job else None,
                "location": job["location"] if job else None,
                "remote": job["remote"] if job else None,
                "tags": tags_by_job.get(bm["target_id"], []),
            })

        # Workers don't group — just return one "All" group
        return [BookmarkGroup(job_posting_id=None, job_title="All Saved", bookmarks=enriched)]

    else:
        # Employer bookmarks = workers, grouped by job_posting_id
        wp_raw = (
            db.table("worker_profiles")
            .select("user_id, name, avatar_url, bio, location, experience_years, skills")
            .in_("user_id", target_ids)
            .execute()
        )
        wp_by_id = {w["user_id"]: w for w in (wp_raw.data or [])}

        tags_by_worker: dict[str, list[dict]] = {}
        if target_ids:
            tag_rows = (
                db.table("worker_tags")
                .select("worker_id, tags(id, name, category)")
                .in_("worker_id", target_ids)
                .execute()
            )
            for row in (tag_rows.data or []):
                td = row.get("tags")
                if td:
                    tags_by_worker.setdefault(row["worker_id"], []).append(td)

        # Get job titles for grouping
        job_posting_ids = list({bm["job_posting_id"] for bm in bookmarks if bm.get("job_posting_id")})
        job_titles: dict[str, str] = {}
        if job_posting_ids:
            jt_raw = (
                db.table("job_postings")
                .select("id, title")
                .in_("id", job_posting_ids)
                .execute()
            )
            job_titles = {j["id"]: j["title"] for j in (jt_raw.data or [])}

        # Build enriched bookmarks
        groups_map: dict[Optional[str], list[dict]] = {}
        for bm in bookmarks:
            wp = wp_by_id.get(bm["target_id"], {})
            enriched_bm = {
                **bm,
                "name": wp.get("name"),
                "avatar_url": wp.get("avatar_url"),
                "bio": wp.get("bio"),
                "location": wp.get("location"),
                "experience_years": wp.get("experience_years"),
                "skills": wp.get("skills"),
                "tags": tags_by_worker.get(bm["target_id"], []),
            }
            jpid = bm.get("job_posting_id")
            groups_map.setdefault(jpid, []).append(enriched_bm)

        # Build response groups, sorted: named groups first, unsorted last
        result_groups = []
        for jpid, bms in groups_map.items():
            if jpid is not None:
                title = job_titles.get(jpid, "Unknown Job")
                result_groups.append(BookmarkGroup(job_posting_id=jpid, job_title=title, bookmarks=bms))

        # Unsorted at the end
        if None in groups_map:
            result_groups.append(BookmarkGroup(job_posting_id=None, job_title="Unsorted", bookmarks=groups_map[None]))

        return result_groups


@router.post("", response_model=BookmarkBasic, status_code=201)
async def add_bookmark(body: BookmarkRequest, user: dict = Depends(get_current_user)):
    db = get_client()

    existing = (
        db.table("bookmarks")
        .select("id")
        .eq("user_id", user["id"])
        .eq("target_id", body.target_id)
        .execute()
    )
    if existing.data:
        raise HTTPException(409, "Already bookmarked")

    # Auto-assign to best-fit job (employers only)
    job_posting_id = None
    if user["role"] == "employer":
        job_posting_id = _auto_assign_job(db, user["id"], body.target_id)

    result = db.table("bookmarks").insert({
        "user_id": user["id"],
        "target_id": body.target_id,
        "job_posting_id": job_posting_id,
        "note": body.note,
    }).execute()
    return result.data[0]


@router.patch("/{target_id}/move", response_model=BookmarkBasic)
async def move_bookmark(target_id: str, body: BookmarkMoveRequest, user: dict = Depends(get_current_user)):
    """Move a bookmark to a different job posting group."""
    db = get_client()

    # Verify bookmark exists
    bm = (
        db.table("bookmarks")
        .select("id")
        .eq("user_id", user["id"])
        .eq("target_id", target_id)
        .execute()
    )
    if not bm.data:
        raise HTTPException(404, "Bookmark not found")

    # Verify job posting belongs to this employer (if provided)
    if body.job_posting_id:
        job = (
            db.table("job_postings")
            .select("id, employer_id")
            .eq("id", body.job_posting_id)
            .execute()
        )
        if not job.data:
            raise HTTPException(404, "Job posting not found")
        # Check ownership (simplified — not org-aware for now)

    result = (
        db.table("bookmarks")
        .update({"job_posting_id": body.job_posting_id})
        .eq("user_id", user["id"])
        .eq("target_id", target_id)
        .execute()
    )
    return result.data[0]


@router.patch("/{target_id}/note", response_model=BookmarkBasic)
async def update_note(target_id: str, body: BookmarkNoteRequest, user: dict = Depends(get_current_user)):
    db = get_client()

    result = (
        db.table("bookmarks")
        .update({"note": body.note})
        .eq("user_id", user["id"])
        .eq("target_id", target_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Bookmark not found")
    return result.data[0]


@router.delete("/{target_id}", status_code=204)
async def remove_bookmark(target_id: str, user: dict = Depends(get_current_user)):
    db = get_client()
    result = (
        db.table("bookmarks")
        .delete()
        .eq("user_id", user["id"])
        .eq("target_id", target_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(404, "Bookmark not found")
