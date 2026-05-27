from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.models.tag import Tag as TagResponse
from app.models.tables.tag import Tag

router = APIRouter(prefix="/tags", tags=["tags"])

VALID_CATEGORIES = {"language", "framework", "tool", "database", "cloud", "soft_skill", "certification", "other"}


@router.get("", response_model=list[TagResponse])
async def list_tags(
    category: str | None = Query(None),
    search: str | None = Query(None),
    session: AsyncSession = Depends(get_session),
):
    """List all tags, optionally filtered by category or name search."""
    query = select(Tag).order_by(Tag.name)

    if category:
        if category not in VALID_CATEGORIES:
            return []
        query = query.where(Tag.category == category)
    if search:
        query = query.where(Tag.name.ilike(f"%{search}%"))

    result = await session.execute(query)
    rows = result.scalars().all()
    return [{"id": str(r.id), "name": r.name, "category": r.category} for r in rows]


@router.get("/categories")
async def list_categories():
    """Return available tag categories."""
    return [
        {"value": "language", "label": "Languages"},
        {"value": "framework", "label": "Frameworks & Libraries"},
        {"value": "tool", "label": "Tools & Platforms"},
        {"value": "database", "label": "Databases"},
        {"value": "cloud", "label": "Cloud & DevOps"},
        {"value": "soft_skill", "label": "Soft Skills"},
        {"value": "certification", "label": "Certifications"},
        {"value": "other", "label": "Other"},
    ]
