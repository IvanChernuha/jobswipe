"""Tag-based match scoring with shadow tag expansion.

Supports both async (SQLModel session) and sync (Supabase client) callers.
Routers migrated to SQLModel use the async version; Celery tasks still use sync.
"""

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables.tag import TagImplication


async def expand_tags_with_implications_async(session: AsyncSession, tag_ids: set[str]) -> set[str]:
    """Expand a set of tag IDs with their implied (shadow) tags. Async version."""
    if not tag_ids:
        return tag_ids
    tag_uuids = [uuid.UUID(t) for t in tag_ids]
    result = await session.execute(
        select(TagImplication.implied_tag_id)
        .where(TagImplication.parent_tag_id.in_(tag_uuids))
    )
    implied = {str(r.implied_tag_id) for r in result.all()}
    return tag_ids | implied


async def batch_expand_implications(session: AsyncSession, all_tag_ids: set[str]) -> dict[str, set[str]]:
    """Fetch all implications for a set of tag IDs in one query. Returns {parent_id: {implied_ids}}."""
    if not all_tag_ids:
        return {}
    tag_uuids = [uuid.UUID(t) for t in all_tag_ids]
    result = await session.execute(
        select(TagImplication.parent_tag_id, TagImplication.implied_tag_id)
        .where(TagImplication.parent_tag_id.in_(tag_uuids))
    )
    impl_map: dict[str, set[str]] = {}
    for row in result.all():
        impl_map.setdefault(str(row.parent_tag_id), set()).add(str(row.implied_tag_id))
    return impl_map



def compute_match_score(
    my_tag_ids: set[str],
    their_tag_ids: set[str],
) -> dict:
    """Compute overlap score between two expanded tag sets."""
    if not their_tag_ids:
        return {"matched": 0, "total": 0, "percentage": 0}
    overlap = my_tag_ids & their_tag_ids
    total = len(their_tag_ids)
    matched = len(overlap)
    pct = round(matched / total * 100) if total > 0 else 0
    return {"matched": matched, "total": total, "percentage": pct}
