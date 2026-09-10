"""Block helpers shared by feeds, swipes and messaging.

Storage is one-directional (blocker -> blocked); enforcement is symmetric.
Limitation (v1): blocks are per user, not per organisation — an org member's
block does not hide the worker from their colleagues.
"""
import uuid

from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables.block import BlockedUser


async def blocked_ids_for(session: AsyncSession, uid: uuid.UUID) -> set[uuid.UUID]:
    """Users I've blocked plus users who blocked me."""
    result = await session.execute(
        select(BlockedUser.blocker_id, BlockedUser.blocked_id)
        .where(or_(BlockedUser.blocker_id == uid, BlockedUser.blocked_id == uid))
    )
    return {blocked if blocker == uid else blocker for blocker, blocked in result.all()}


async def is_blocked_pair(session: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    result = await session.execute(
        select(BlockedUser.blocker_id)
        .where(or_(
            and_(BlockedUser.blocker_id == a, BlockedUser.blocked_id == b),
            and_(BlockedUser.blocker_id == b, BlockedUser.blocked_id == a),
        ))
        .limit(1)
    )
    return result.first() is not None
