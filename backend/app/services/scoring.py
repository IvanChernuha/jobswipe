"""Tag-based match scoring with shadow tag expansion."""


def expand_tags_with_implications(db, tag_ids: set[str]) -> set[str]:
    """Expand a set of tag IDs with their implied (shadow) tags."""
    if not tag_ids:
        return tag_ids
    impl_rows = (
        db.table("tag_implications")
        .select("implied_tag_id")
        .in_("parent_tag_id", list(tag_ids))
        .execute()
    )
    implied = {r["implied_tag_id"] for r in (impl_rows.data or [])}
    return tag_ids | implied


def compute_match_score(
    my_tag_ids: set[str],
    their_tag_ids: set[str],
) -> dict:
    """Compute overlap score between two expanded tag sets.

    Returns {"matched": int, "total": int, "percentage": int}
    `total` = number of tags the *other* side requires/has.
    `matched` = how many of those the current user covers (via direct + shadow).
    """
    if not their_tag_ids:
        return {"matched": 0, "total": 0, "percentage": 0}
    overlap = my_tag_ids & their_tag_ids
    total = len(their_tag_ids)
    matched = len(overlap)
    pct = round(matched / total * 100) if total > 0 else 0
    return {"matched": matched, "total": total, "percentage": pct}
