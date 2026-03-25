from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from app.deps import get_current_user
from app.models.match import MatchResponse
from app.models.message import UnreadCount
from app.db.client import get_client

router = APIRouter(prefix="/matches", tags=["matches"])


def _get_org_match_employer_ids(db, uid: str) -> list[str]:
    """Get all employer IDs whose matches this user can access.

    Requires active org_members membership. Uses employer_profiles.org_id
    to find ALL employers linked to the org (including former members).
    Former members (profile has org_id but not in org_members) get nothing.
    """
    membership = db.table("org_members").select("org_id").eq("user_id", uid).limit(1).execute()
    if membership.data:
        org_id = membership.data[0]["org_id"]
        # All employer profiles linked to this org (current + former members)
        profiles = db.table("employer_profiles").select("user_id").eq("org_id", org_id).execute()
        ids = {p["user_id"] for p in (profiles.data or [])}
        ids.add(uid)
        return list(ids)

    # Not in org_members. Check if they're a former member (profile still has org_id).
    # Former members should NOT see org matches — return empty list.
    profile = db.table("employer_profiles").select("org_id").eq("user_id", uid).limit(1).execute()
    if profile.data and profile.data[0].get("org_id"):
        return []  # Former member — no access to any matches

    return [uid]  # Solo employer — own matches only


@router.get("", response_model=list[MatchResponse])
async def list_matches(user: dict = Depends(get_current_user)):
    """
    List matches for the current user, enriched with counterpart profile data.
    Uses explicit queries instead of PostgREST embedded joins (no direct FK).
    """
    db = get_client()
    uid = user["id"]
    role = user["role"]

    if role == "worker":
        matches_raw = (
            db.table("matches")
            .select("id, worker_id, employer_id, job_posting_id, status, matched_at")
            .eq("worker_id", uid)
            .eq("status", "active")
            .order("matched_at", desc=True)
            .execute()
        )
    else:
        # Org-aware: see all matches from org members
        employer_ids = _get_org_match_employer_ids(db, uid)
        matches_raw = (
            db.table("matches")
            .select("id, worker_id, employer_id, job_posting_id, status, matched_at")
            .in_("employer_id", employer_ids)
            .eq("status", "active")
            .order("matched_at", desc=True)
            .execute()
        )

    matches = matches_raw.data or []
    if not matches:
        return []

    # Batch-fetch job postings
    job_ids = [m["job_posting_id"] for m in matches if m.get("job_posting_id")]
    jobs_by_id: dict = {}
    if job_ids:
        jobs_raw = db.table("job_postings").select("id, title, location").in_("id", job_ids).execute()
        jobs_by_id = {j["id"]: j for j in (jobs_raw.data or [])}

    # Batch-fetch the counterpart profiles
    if role == "worker":
        counterpart_ids = [m["employer_id"] for m in matches]
        ep_raw = (
            db.table("employer_profiles")
            .select("user_id, company_name, industry, logo_url")
            .in_("user_id", counterpart_ids)
            .execute()
        )
        counterparts = {r["user_id"]: r for r in (ep_raw.data or [])}
    else:
        counterpart_ids = [m["worker_id"] for m in matches]
        wp_raw = (
            db.table("worker_profiles")
            .select("user_id, name, avatar_url, skills, experience_years")
            .in_("user_id", counterpart_ids)
            .execute()
        )
        counterparts = {r["user_id"]: r for r in (wp_raw.data or [])}

    result = []
    for m in matches:
        job = jobs_by_id.get(m.get("job_posting_id"), {})
        if role == "worker":
            ep = counterparts.get(m["employer_id"], {})
            result.append({
                "id": m["id"],
                "worker_id": m["worker_id"],
                "employer_id": m["employer_id"],
                "job_posting_id": m["job_posting_id"],
                "matched_at": m["matched_at"],
                "status": m["status"],
                "employer": {
                    "company_name": ep.get("company_name", ""),
                    "industry": ep.get("industry", ""),
                    "avatar_url": ep.get("logo_url"),
                    "job_title": job.get("title", ""),
                    "location": job.get("location", ""),
                },
            })
        else:
            wp = counterparts.get(m["worker_id"], {})
            result.append({
                "id": m["id"],
                "worker_id": m["worker_id"],
                "employer_id": m["employer_id"],
                "job_posting_id": m["job_posting_id"],
                "matched_at": m["matched_at"],
                "status": m["status"],
                "worker": {
                    "name": wp.get("name", ""),
                    "avatar_url": wp.get("avatar_url"),
                    "skills": wp.get("skills", []),
                    "experience_years": wp.get("experience_years", 0),
                },
            })

    return result


@router.get("/unread", response_model=list[UnreadCount])
async def unread_counts(user: dict = Depends(get_current_user)):
    """Return unread message counts for all active matches."""
    db = get_client()
    uid = user["id"]
    role = user["role"]

    # Get all active match IDs for this user (org-aware for employers)
    if role == "worker":
        matches_raw = (
            db.table("matches")
            .select("id")
            .eq("worker_id", uid)
            .eq("status", "active")
            .execute()
        )
    else:
        employer_ids = _get_org_match_employer_ids(db, uid)
        matches_raw = (
            db.table("matches")
            .select("id")
            .in_("employer_id", employer_ids)
            .eq("status", "active")
            .execute()
        )
    match_ids = [m["id"] for m in (matches_raw.data or [])]
    if not match_ids:
        return []

    # Get read cursors for this user
    cursors_raw = (
        db.table("message_read_cursors")
        .select("match_id, last_read_at")
        .eq("user_id", uid)
        .in_("match_id", match_ids)
        .execute()
    )
    cursor_map = {r["match_id"]: r["last_read_at"] for r in (cursors_raw.data or [])}

    # Count messages after each cursor (or all messages if no cursor)
    result = []
    for mid in match_ids:
        query = (
            db.table("messages")
            .select("id", count="exact")
            .eq("match_id", mid)
            .neq("sender_id", uid)  # only count others' messages
        )
        last_read = cursor_map.get(mid)
        if last_read:
            query = query.gt("created_at", last_read)

        resp = query.execute()
        count = resp.count if resp.count is not None else len(resp.data or [])
        if count > 0:
            result.append({"match_id": mid, "count": count})

    return result


@router.get("/{match_id}", response_model=MatchResponse)
async def get_match(match_id: str, user: dict = Depends(get_current_user)):
    db = get_client()
    uid = user["id"]

    try:
        match_raw = (
            db.table("matches")
            .select("id, worker_id, employer_id, job_posting_id, status, matched_at")
            .eq("id", match_id)
            .single()
            .execute()
        )
    except APIError:
        raise HTTPException(404, "Match not found")
    if not match_raw.data:
        raise HTTPException(404, "Match not found")

    match = match_raw.data
    if user["role"] == "worker":
        if uid != match["worker_id"]:
            raise HTTPException(403, "Access denied")
    else:
        # Employers: org-aware access check
        org_ids = _get_org_match_employer_ids(db, uid)
        if match["employer_id"] not in org_ids:
            raise HTTPException(403, "Access denied")

    # Fetch contact emails
    worker_user = db.table("users").select("email").eq("id", match["worker_id"]).single().execute()
    employer_user = db.table("users").select("email").eq("id", match["employer_id"]).single().execute()

    # Return whichever side is the OTHER party's email
    if user["role"] == "worker":
        contact_email = employer_user.data["email"] if employer_user.data else None
    else:
        contact_email = worker_user.data["email"] if worker_user.data else None

    return {**match, "contact_email": contact_email}
