"""In-app notifications: list, unread count, mark read, per-type prefs.

Rows are created by app.services.notifications (called from swipes/messages/
employers routers and the cv_processing/digest Celery tasks) — this router is
read/ack only.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.db.session import get_session
from app.models.tables.notification import NOTIFICATION_TYPES, Notification, NotificationPref

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationResponse(BaseModel):
    id: str
    type: str
    title_key: str
    params: dict = {}
    link: str = ""
    actor_id: Optional[str] = None
    created_at: Optional[str] = None
    read_at: Optional[str] = None
    model_config = {"extra": "ignore"}


class UnreadCountResponse(BaseModel):
    count: int


class NotificationPrefUpdate(BaseModel):
    type: str
    enabled: bool

    @field_validator("type")
    @classmethod
    def type_valid(cls, v: str) -> str:
        if v not in NOTIFICATION_TYPES:
            raise ValueError(f"type must be one of {NOTIFICATION_TYPES}")
        return v


def _to_response(n: Notification) -> dict:
    return {
        "id": str(n.id), "type": n.type, "title_key": n.title_key,
        "params": n.params or {}, "link": n.link or "",
        "actor_id": str(n.actor_id) if n.actor_id else None,
        "created_at": str(n.created_at) if n.created_at else None,
        "read_at": str(n.read_at) if n.read_at else None,
    }


@router.get("", response_model=list[NotificationResponse])
async def list_notifications(
    unread_only: bool = False,
    limit: int = Query(50, ge=1, le=100),
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    query = select(Notification).where(Notification.user_id == uid)
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    query = query.order_by(Notification.created_at.desc()).limit(limit)
    result = await session.execute(query)
    return [_to_response(n) for n in result.scalars().all()]


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    count = await session.scalar(
        select(func.count()).select_from(Notification)
        .where(Notification.user_id == uid, Notification.read_at.is_(None))
    )
    return {"count": count or 0}


@router.post("/{notification_id}/read", response_model=NotificationResponse)
async def mark_read(
    notification_id: str,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    try:
        n = await session.get(Notification, uuid.UUID(notification_id))
    except ValueError:
        raise HTTPException(404, "Notification not found")
    if not n or n.user_id != uid:
        raise HTTPException(404, "Notification not found")

    if n.read_at is None:
        n.read_at = datetime.now(timezone.utc)
        session.add(n)
        await session.commit()
    return _to_response(n)


@router.post("/read-all")
async def mark_all_read(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    result = await session.execute(
        update(Notification)
        .where(Notification.user_id == uid, Notification.read_at.is_(None))
        .values(read_at=datetime.now(timezone.utc))
    )
    await session.commit()
    return {"marked": result.rowcount}


@router.get("/prefs")
async def get_prefs(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    uid = uuid.UUID(user["id"])
    result = await session.execute(select(NotificationPref).where(NotificationPref.user_id == uid))
    saved = {p.type: p.enabled for p in result.scalars().all()}
    return {t: saved.get(t, True) for t in NOTIFICATION_TYPES}


@router.put("/prefs")
async def update_prefs(
    body: NotificationPrefUpdate,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    uid = uuid.UUID(user["id"])
    pref = await session.get(NotificationPref, (uid, body.type))
    if pref:
        pref.enabled = body.enabled
    else:
        pref = NotificationPref(user_id=uid, type=body.type, enabled=body.enabled)
    session.add(pref)
    await session.commit()
    return {"type": body.type, "enabled": body.enabled}
