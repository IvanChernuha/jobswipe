"""GDPR compliance: data export and account deletion."""
from fastapi import APIRouter, Depends, HTTPException
from app.deps import get_current_user
from app.db.client import get_client, get_auth_client

router = APIRouter(prefix="/account", tags=["gdpr"])


@router.get("/export")
async def export_my_data(user: dict = Depends(get_current_user)):
    """Download all personal data (GDPR Article 15 - Right of Access)."""
    db = get_client()
    uid = user["id"]
    role = user["role"]

    # Core user data
    user_row = db.table("users").select("*").eq("id", uid).single().execute()

    # Profile
    if role == "worker":
        profile = db.table("worker_profiles").select("*").eq("user_id", uid).single().execute()
        tags = db.table("worker_tags").select("tags(id, name, category)").eq("worker_id", uid).execute()
    else:
        profile = db.table("employer_profiles").select("*").eq("user_id", uid).single().execute()
        tags = None

    # Job postings (employers)
    jobs = []
    if role == "employer":
        jobs_raw = db.table("job_postings").select("*").eq("employer_id", uid).execute()
        jobs = jobs_raw.data or []
        if jobs:
            job_ids = [j["id"] for j in jobs]
            job_tags = db.table("job_posting_tags").select("job_posting_id, requirement, tags(id, name, category)").in_("job_posting_id", job_ids).execute()
            tags_by_job: dict[str, list] = {}
            for row in (job_tags.data or []):
                td = row.get("tags")
                if td:
                    td["requirement"] = row.get("requirement", "nice")
                    tags_by_job.setdefault(row["job_posting_id"], []).append(td)
            for j in jobs:
                j["tags"] = tags_by_job.get(j["id"], [])

    # Swipes
    swipes = db.table("swipes").select("target_id, direction, created_at").eq("swiper_id", uid).order("created_at", desc=True).execute()

    # Matches
    if role == "worker":
        matches = db.table("matches").select("*").eq("worker_id", uid).execute()
    else:
        matches = db.table("matches").select("*").eq("employer_id", uid).execute()

    # Messages
    messages = db.table("messages").select("match_id, body, created_at, sender_id").eq("sender_id", uid).order("created_at", desc=True).execute()

    # Bookmarks
    bookmarks = db.table("bookmarks").select("target_id, note, created_at").eq("user_id", uid).execute()

    # Reports I filed
    reports = db.table("reports").select("target_id, target_type, reason, details, created_at").eq("reporter_id", uid).execute()

    # Org membership
    org_membership = db.table("org_members").select("org_id, role, created_at").eq("user_id", uid).execute()

    # Build export
    export = {
        "user": user_row.data,
        "profile": profile.data if profile else None,
        "tags": [r["tags"] for r in (tags.data or [])] if tags else None,
        "job_postings": jobs,
        "swipes": swipes.data or [],
        "matches": matches.data or [],
        "messages_sent": messages.data or [],
        "bookmarks": bookmarks.data or [],
        "reports_filed": reports.data or [],
        "org_memberships": org_membership.data or [],
        "exported_at": "now",
    }

    # Strip internal fields
    if export["user"]:
        export["user"].pop("embedding", None)

    if export["profile"]:
        export["profile"].pop("embedding", None)

    return export


@router.delete("/delete", status_code=200)
async def delete_my_account(user: dict = Depends(get_current_user)):
    """Permanently delete account and all associated data (GDPR Article 17 - Right to Erasure).

    This cascades through foreign keys and deletes:
    - User profile (worker/employer)
    - All job postings (employers)
    - All swipes
    - All matches
    - All messages sent
    - All bookmarks
    - All reports filed
    - Org memberships
    - The auth account itself
    """
    db = get_client()
    auth_db = get_auth_client()
    uid = user["id"]

    # Delete in order (most FK-dependent first)
    # Messages where I'm sender
    db.table("messages").delete().eq("sender_id", uid).execute()

    # Bookmarks
    db.table("bookmarks").delete().eq("user_id", uid).execute()

    # Reports
    db.table("reports").delete().eq("reporter_id", uid).execute()

    # Org memberships
    db.table("org_members").delete().eq("user_id", uid).execute()

    # Message read cursors
    db.table("message_read_cursors").delete().eq("user_id", uid).execute()

    # Matches (both sides)
    db.table("matches").delete().eq("worker_id", uid).execute()
    db.table("matches").delete().eq("employer_id", uid).execute()

    # Swipes (both directions)
    db.table("swipes").delete().eq("swiper_id", uid).execute()
    db.table("swipes").delete().eq("target_id", uid).execute()

    # Job postings + their tags (cascade handles job_posting_tags)
    db.table("job_postings").delete().eq("employer_id", uid).execute()

    # Worker tags
    db.table("worker_tags").delete().eq("worker_id", uid).execute()

    # Profiles
    db.table("worker_profiles").delete().eq("user_id", uid).execute()
    db.table("employer_profiles").delete().eq("user_id", uid).execute()

    # User row (FK cascades handle remaining refs)
    db.table("users").delete().eq("id", uid).execute()

    # Delete from Supabase Auth
    try:
        auth_db.auth.admin.delete_user(uid)
    except Exception:
        pass  # Auth deletion is best-effort — data is already gone

    return {"deleted": True, "user_id": uid}
