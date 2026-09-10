"""Automated report loop.

After every report: count DISTINCT reporters for the target. At
REPORT_AUTO_ACTION_THRESHOLD a job is hidden (active = false) or a user is
suspended, the target's pending reports flip to 'actioned', and the founder
is alerted. Harassment reports alert immediately regardless of count.

MODERATION_AUTO_ACTIONS=false is the kill switch: alerts still go out, nothing
is hidden or suspended. Manual overrides (dismiss, action, unsuspend, unhide)
live in routers/admin.py and reuse apply_action().
"""
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.tables.job import JobPosting
from app.models.tables.report import Report
from app.models.tables.user import User
from app.tasks.notifications import send_admin_alert

logger = logging.getLogger(__name__)


def alert_founder(subject: str, body: str) -> None:
    # ERROR level so it lands in Sentry even before email is configured.
    logger.error("MODERATION ALERT: %s — %s", subject, body)
    try:
        send_admin_alert.delay(subject, body)
    except Exception as e:  # broker down: the Sentry event above still fires
        logger.error("could not enqueue admin alert: %s", e)


async def distinct_reporters(session: AsyncSession, target_type: str, target_id: uuid.UUID) -> int:
    result = await session.execute(
        select(func.count(func.distinct(Report.reporter_id)))
        .where(Report.target_id == target_id, Report.target_type == target_type)
        .where(Report.status.in_(("pending", "actioned")))
    )
    return int(result.scalar() or 0)


async def apply_action(session: AsyncSession, target_type: str, target_id: uuid.UUID, note: str) -> bool:
    """Hide the job / suspend the user and action its pending reports.

    Returns False if the target no longer exists.
    """
    now = datetime.now(timezone.utc)
    if target_type == "job":
        job = await session.get(JobPosting, target_id)
        if not job:
            return False
        job.active = False
        job.moderation_note = note
        session.add(job)
    else:
        user = await session.get(User, target_id)
        if not user:
            return False
        if user.suspended_at is None:
            user.suspended_at = now
        user.suspended_reason = note
        session.add(user)

    await session.execute(
        update(Report)
        .where(Report.target_id == target_id, Report.target_type == target_type, Report.status == "pending")
        .values(status="actioned", actioned_at=now)
    )
    await session.commit()
    return True


async def evaluate_after_report(session: AsyncSession, report: Report) -> dict:
    """Run the loop for a freshly committed report. Never raises past the caller's guard."""
    n = await distinct_reporters(session, report.target_type, report.target_id)
    label = f"{report.target_type} {report.target_id}"
    threshold = settings.REPORT_AUTO_ACTION_THRESHOLD

    if report.reason == "harassment":
        alert_founder(
            f"Harassment report on {label}",
            f"Details: {report.details or '-'}\nDistinct reporters so far: {n} (threshold {threshold}).",
        )

    if n < threshold:
        return {"reporters": n, "actioned": False}

    if not settings.MODERATION_AUTO_ACTIONS:
        alert_founder(
            f"Threshold reached on {label} — auto-actions are OFF",
            f"{n} distinct reporters; nothing was hidden or suspended. Review via GET /api/admin/reports.",
        )
        return {"reporters": n, "actioned": False}

    changed = await apply_action(session, report.target_type, report.target_id, f"auto: {n} reports ({report.reason})")
    if changed:
        if report.target_type == "job":
            what, undo = "hidden job", f"POST /api/admin/jobs/{report.target_id}/unhide"
        else:
            what, undo = "suspended user", f"POST /api/admin/users/{report.target_id}/unsuspend"
        alert_founder(
            f"Auto-{what} {report.target_id}",
            f"{n} distinct reporters (latest reason: {report.reason}).\nUndo: {undo}",
        )
    return {"reporters": n, "actioned": changed}
