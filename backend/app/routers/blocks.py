"""Block / unblock users.

Blocking archives any active match between the two and makes them invisible
to each other in feeds, swipes and chat (see services/blocks.py). Unblocking
lifts the visibility rules but does not restore archived matches.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select, update, delete, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.db.session import get_session
from app.models.tables.block import BlockedUser
from app.models.tables.match import Match
from app.models.tables.user import User
from app.rate_limit import limiter, user_or_ip

router = APIRouter(prefix="/blocks", tags=["blocks"])


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(400, "Invalid user id")


@router.get("", response_model=list[str])
async def list_blocks(user: dict = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(BlockedUser.blocked_id).where(BlockedUser.blocker_id == uuid.UUID(user["id"]))
    )
    return [str(r.blocked_id) for r in result.all()]


@router.post("/{user_id}", status_code=201)
@limiter.limit("30/hour", key_func=user_or_ip)
async def block_user(
    request: Request, user_id: str,
    user: dict = Depends(get_current_user), session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    target = _uuid(user_id)
    if target == uid:
        raise HTTPException(400, "Cannot block yourself")
    if not await session.get(User, target):
        raise HTTPException(404, "User not found")

    if not await session.get(BlockedUser, (uid, target)):
        session.add(BlockedUser(blocker_id=uid, blocked_id=target, created_at=datetime.now(timezone.utc)))

    archived = await session.execute(
        update(Match)
        .where(or_(
            and_(Match.worker_id == uid, Match.employer_id == target),
            and_(Match.worker_id == target, Match.employer_id == uid),
        ))
        .where(Match.status == "active")
        .values(status="archived")
    )
    await session.commit()
    return {"blocked": True, "user_id": user_id, "matches_archived": archived.rowcount}


@router.delete("/{user_id}")
async def unblock_user(user_id: str, user: dict = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    await session.execute(
        delete(BlockedUser).where(BlockedUser.blocker_id == uuid.UUID(user["id"]), BlockedUser.blocked_id == _uuid(user_id))
    )
    await session.commit()
    return {"blocked": False, "user_id": user_id}
