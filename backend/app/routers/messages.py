from fastapi import APIRouter, Depends, HTTPException, Query
from postgrest.exceptions import APIError
from app.deps import get_current_user
from app.models.message import MessageCreate, MessageResponse, UnreadCount
from app.db.client import get_client

router = APIRouter(prefix="/matches/{match_id}/messages", tags=["messages"])


def _get_org_match_employer_ids(db, uid: str) -> list[str]:
    """Get all employer IDs whose matches this user can access.
    Requires active org_members membership. Former members get nothing."""
    membership = db.table("org_members").select("org_id").eq("user_id", uid).limit(1).execute()
    if membership.data:
        org_id = membership.data[0]["org_id"]
        profiles = db.table("employer_profiles").select("user_id").eq("org_id", org_id).execute()
        ids = {p["user_id"] for p in (profiles.data or [])}
        ids.add(uid)
        return list(ids)

    # Former member check
    profile = db.table("employer_profiles").select("org_id").eq("user_id", uid).limit(1).execute()
    if profile.data and profile.data[0].get("org_id"):
        return []  # Former member — no access

    return [uid]  # Solo employer


def _verify_match_participant(db, match_id: str, uid: str, user_role: str) -> dict:
    """Verify user is a participant in the match (or org member). Returns match row."""
    try:
        match_raw = (
            db.table("matches")
            .select("id, worker_id, employer_id, status")
            .eq("id", match_id)
            .single()
            .execute()
        )
    except APIError:
        raise HTTPException(404, "Match not found")

    if not match_raw.data:
        raise HTTPException(404, "Match not found")

    match = match_raw.data

    if user_role == "worker":
        # Workers: direct participant only
        if uid != match["worker_id"]:
            raise HTTPException(403, "Not a participant in this match")
    else:
        # Employers: must be in the same org as the match's employer (or be the employer themselves if no org)
        org_ids = _get_org_match_employer_ids(db, uid)
        if match["employer_id"] not in org_ids:
            raise HTTPException(403, "Not a participant in this match")
        # Check chat permission for org members
        from app.models.organization import has_permission
        mem = db.table("org_members").select("role").eq("user_id", uid).limit(1).execute()
        if mem.data and not has_permission(mem.data[0]["role"], "chat"):
            raise HTTPException(403, "Your role does not allow chatting")

    if match["status"] != "active":
        raise HTTPException(400, "Match is no longer active")

    return match


@router.get("", response_model=list[MessageResponse])
async def list_messages(
    match_id: str,
    before: str | None = Query(None, description="Cursor: messages before this ID"),
    limit: int = Query(50, ge=1, le=100),
    user: dict = Depends(get_current_user),
):
    db = get_client()
    uid = user["id"]
    _verify_match_participant(db, match_id, uid, user.get("role", ""))

    query = (
        db.table("messages")
        .select("id, match_id, sender_id, body, created_at")
        .eq("match_id", match_id)
        .order("created_at", desc=True)
        .limit(limit)
    )

    if before:
        # Fetch the timestamp of the cursor message for keyset pagination
        try:
            cursor_msg = (
                db.table("messages")
                .select("created_at")
                .eq("id", before)
                .single()
                .execute()
            )
            if cursor_msg.data:
                query = query.lt("created_at", cursor_msg.data["created_at"])
        except APIError:
            pass  # Invalid cursor, just return from the top

    rows = query.execute()
    messages = rows.data or []

    # Update read cursor
    db.table("message_read_cursors").upsert(
        {"match_id": match_id, "user_id": uid, "last_read_at": "now()"},
        on_conflict="match_id,user_id",
    ).execute()

    # Mark is_mine and reverse to chronological order
    result = []
    for msg in reversed(messages):
        result.append({**msg, "is_mine": msg["sender_id"] == uid})

    return result


@router.post("", response_model=MessageResponse, status_code=201)
async def send_message(
    match_id: str,
    payload: MessageCreate,
    user: dict = Depends(get_current_user),
):
    db = get_client()
    uid = user["id"]
    _verify_match_participant(db, match_id, uid, user.get("role", ""))

    row = (
        db.table("messages")
        .insert({"match_id": match_id, "sender_id": uid, "body": payload.body})
        .execute()
    )

    if not row.data:
        raise HTTPException(500, "Failed to send message")

    msg = row.data[0]
    return {**msg, "is_mine": True}
