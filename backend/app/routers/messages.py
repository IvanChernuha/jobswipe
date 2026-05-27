import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.db.session import get_session
from app.models.message import MessageCreate, MessageResponse, UnreadCount
from app.models.tables.match import Match
from app.models.tables.message import Message, MessageReadCursor
from app.models.tables.organization import OrgMember
from app.models.organization import has_permission
from app.services.org_access import get_org_employer_ids

router = APIRouter(prefix="/matches/{match_id}/messages", tags=["messages"])


async def _verify_match_participant(
    session: AsyncSession, match_id: str, uid: str, user_role: str
) -> Match:
    """Verify user is a participant in the match (or org member). Returns match."""
    match = await session.get(Match, uuid.UUID(match_id))
    if not match:
        raise HTTPException(404, "Match not found")

    uid_uuid = uuid.UUID(uid)

    if user_role == "worker":
        if match.worker_id != uid_uuid:
            raise HTTPException(403, "Not a participant in this match")
    else:
        org_ids = await get_org_employer_ids(session, uid)
        if str(match.employer_id) not in org_ids:
            raise HTTPException(403, "Not a participant in this match")
        # Check chat permission for org members
        result = await session.execute(
            select(OrgMember.role).where(OrgMember.user_id == uid_uuid).limit(1)
        )
        row = result.first()
        if row and not has_permission(row.role, "chat"):
            raise HTTPException(403, "Your role does not allow chatting")

    if match.status != "active":
        raise HTTPException(400, "Match is no longer active")

    return match


@router.get("", response_model=list[MessageResponse])
async def list_messages(
    match_id: str,
    before: str | None = Query(None, description="Cursor: messages before this ID"),
    limit: int = Query(50, ge=1, le=100),
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = user["id"]
    uid_uuid = uuid.UUID(uid)
    await _verify_match_participant(session, match_id, uid, user.get("role", ""))

    mid_uuid = uuid.UUID(match_id)
    query = (
        select(Message)
        .where(Message.match_id == mid_uuid)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )

    if before:
        cursor_msg = await session.get(Message, uuid.UUID(before))
        if cursor_msg:
            query = query.where(Message.created_at < cursor_msg.created_at)

    result = await session.execute(query)
    messages = result.scalars().all()

    # Update read cursor
    existing_cursor = await session.execute(
        select(MessageReadCursor)
        .where(MessageReadCursor.match_id == mid_uuid, MessageReadCursor.user_id == uid_uuid)
    )
    cursor = existing_cursor.scalars().first()
    now = datetime.now(timezone.utc)
    if cursor:
        cursor.last_read_at = now
        session.add(cursor)
    else:
        session.add(MessageReadCursor(match_id=mid_uuid, user_id=uid_uuid, last_read_at=now))
    await session.commit()

    # Reverse to chronological and mark is_mine
    out = []
    for msg in reversed(messages):
        out.append({
            "id": str(msg.id),
            "match_id": str(msg.match_id),
            "sender_id": str(msg.sender_id),
            "body": msg.body,
            "created_at": str(msg.created_at) if msg.created_at else None,
            "is_mine": msg.sender_id == uid_uuid,
        })
    return out


@router.post("", response_model=MessageResponse, status_code=201)
async def send_message(
    match_id: str,
    payload: MessageCreate,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = user["id"]
    uid_uuid = uuid.UUID(uid)
    await _verify_match_participant(session, match_id, uid, user.get("role", ""))

    msg = Message(
        id=uuid.uuid4(),
        match_id=uuid.UUID(match_id),
        sender_id=uid_uuid,
        body=payload.body,
        created_at=datetime.now(timezone.utc),
    )
    session.add(msg)
    await session.commit()

    return {
        "id": str(msg.id),
        "match_id": str(msg.match_id),
        "sender_id": str(msg.sender_id),
        "body": msg.body,
        "created_at": str(msg.created_at),
        "is_mine": True,
    }
