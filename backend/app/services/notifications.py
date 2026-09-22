"""Notification creation service.

notify()/notify_team() are called from routers (async session) right before
or after the caller's own session.commit(); they only session.add() — the
caller commits. notify_sync() is the same logic for Celery tasks that use a
sync Session (see app.db.session.get_sync_session).

Every function here swallows its own exceptions: a notification failure must
never break the action that triggered it (a swipe, a message, a job post).
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.models.organization import has_permission
from app.models.tables.notification import Notification, NotificationPref
from app.models.tables.organization import OrgMember

logger = logging.getLogger(__name__)


def _is_enabled(pref: NotificationPref | None) -> bool:
    """Missing pref row = enabled (default ON)."""
    return pref is None or pref.enabled


def _make_notification(
    user_id: uuid.UUID, type: str, title_key: str,
    params: dict | None, link: str, actor_id: uuid.UUID | None,
) -> Notification:
    # created_at is set explicitly: the ORM would otherwise INSERT NULL and
    # bypass the DB default (same fix used for JobPosting/Swipe/BlockedUser).
    return Notification(
        user_id=user_id, type=type, title_key=title_key,
        params=params or {}, link=link, actor_id=actor_id,
        created_at=datetime.now(timezone.utc),
    )


def _filter_team_recipients(
    actor_user_id: uuid.UUID,
    members: list[tuple[uuid.UUID, str]],
    permission: str | None,
) -> list[uuid.UUID]:
    """Pure filter: drop the actor, and (if `permission` given) members whose
    org role can't perform it. `members` is a list of (user_id, role)."""
    out = []
    for user_id, role in members:
        if user_id == actor_user_id:
            continue
        if permission and not has_permission(role, permission):
            continue
        out.append(user_id)
    return out


async def notify(
    session: AsyncSession,
    user_id: uuid.UUID,
    type: str,
    title_key: str,
    params: dict | None = None,
    link: str = "",
    actor_id: uuid.UUID | None = None,
) -> None:
    """Insert one notification row if the user hasn't disabled this type.
    Does NOT commit — the caller controls the transaction. Never raises."""
    try:
        pref = await session.get(NotificationPref, (user_id, type))
        if not _is_enabled(pref):
            return
        session.add(_make_notification(user_id, type, title_key, params, link, actor_id))
    except Exception:
        logger.warning("notify failed for user=%s type=%s", user_id, type, exc_info=True)


async def notify_team(
    session: AsyncSession,
    actor_user_id: uuid.UUID,
    title_key: str,
    params: dict | None = None,
    link: str = "",
    permission: str | None = None,
) -> None:
    """Fan out a 'team' notification to the actor's org members (excluding
    the actor). No-op if the actor isn't in an org (solo employer)."""
    try:
        result = await session.execute(
            select(OrgMember.org_id).where(OrgMember.user_id == actor_user_id).limit(1)
        )
        row = result.first()
        if not row:
            return
        members_result = await session.execute(
            select(OrgMember.user_id, OrgMember.role).where(OrgMember.org_id == row.org_id)
        )
        recipients = _filter_team_recipients(
            actor_user_id, [(m.user_id, m.role) for m in members_result.all()], permission,
        )
        for recipient_id in recipients:
            await notify(session, recipient_id, "team", title_key, params, link, actor_id=actor_user_id)
    except Exception:
        logger.warning("notify_team failed for actor=%s", actor_user_id, exc_info=True)


def notify_sync(
    session: Session,
    user_id: uuid.UUID,
    type: str,
    title_key: str,
    params: dict | None = None,
    link: str = "",
    actor_id: uuid.UUID | None = None,
) -> None:
    """Sync variant of notify() for Celery tasks (get_sync_session()). Never raises."""
    try:
        pref = session.get(NotificationPref, (user_id, type))
        if not _is_enabled(pref):
            return
        session.add(_make_notification(user_id, type, title_key, params, link, actor_id))
    except Exception:
        logger.warning("notify_sync failed for user=%s type=%s", user_id, type, exc_info=True)
