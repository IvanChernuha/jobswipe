from fastapi import APIRouter, Query
from app.models.tag import Tag
from app.db.client import get_client

router = APIRouter(prefix="/tags", tags=["tags"])

VALID_CATEGORIES = {"language", "framework", "tool", "database", "cloud", "soft_skill", "certification", "other"}


@router.get("", response_model=list[Tag])
async def list_tags(
    category: str | None = Query(None),
    search: str | None = Query(None),
):
    """List all tags, optionally filtered by category or name search."""
    db = get_client()
    query = db.table("tags").select("id, name, category").order("name")

    if category:
        if category not in VALID_CATEGORIES:
            return []
        query = query.eq("category", category)
    if search:
        query = query.ilike("name", f"%{search}%")

    result = query.execute()
    return result.data or []


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
