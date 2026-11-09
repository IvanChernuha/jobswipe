"""Who already liked whom: the "Liked you" badge on both feeds."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables.swipe import Swipe

# Higher comes first in the feed; anything else (no swipe, a pass) is 0.
LIKE_RANK = {"super_like": 2, "like": 1}


async def likes_from(session: AsyncSession, swipers: list[uuid.UUID], targets) -> dict[str, str]:
    """{swiper id: "like" | "super_like"} for each of `swipers` who liked any of
    `targets` (a list of ids or a subquery). The strongest swipe wins."""
    if not swipers:
        return {}
    rows = await session.execute(
        select(Swipe.swiper_id, Swipe.direction).where(
            Swipe.swiper_id.in_(swipers),
            Swipe.target_id.in_(targets),
            Swipe.direction.in_(list(LIKE_RANK)),
        )
    )
    out: dict[str, str] = {}
    for r in rows.all():
        key = str(r.swiper_id)
        if LIKE_RANK[r.direction] > LIKE_RANK.get(out.get(key), 0):
            out[key] = r.direction
    return out
