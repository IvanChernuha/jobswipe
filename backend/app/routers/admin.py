"""Minimal moderation endpoints — no UI, drive them from Swagger (/docs) or curl.

Gated by ADMIN_EMAILS. These exist so a false positive from the automated
report loop is a one-call undo, not a database session.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import require_admin
from app.db.session import get_session
from app.models.tables.job import JobPosting
from app.models.tables.report import Report
from app.models.tables.user import User
from app.services.moderation import apply_action

router = APIRouter(prefix="/admin", tags=["admin"])


class ReportRow(BaseModel):
    id: str
    reporter_id: str
    target_id: str
    target_type: str
    reason: str
    details: str
    status: str
    created_at: Optional[str] = None
    actioned_at: Optional[str] = None


class ActionNote(BaseModel):
    note: str = ""


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        raise HTTPException(400, "Invalid id")


@router.get("/moderation/status")
async def moderation_status(user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    pending = await session.scalar(select(func.count()).select_from(Report).where(Report.status == "pending"))
    suspended = await session.scalar(select(func.count()).select_from(User).where(User.suspended_at.is_not(None)))
    hidden = await session.scalar(
        select(func.count()).select_from(JobPosting).where(JobPosting.moderation_note.is_not(None), JobPosting.active == False)
    )
    return {
        "auto_actions": settings.MODERATION_AUTO_ACTIONS,
        "threshold": settings.REPORT_AUTO_ACTION_THRESHOLD,
        "image_moderation": settings.IMAGE_MODERATION,
        "pending_reports": pending or 0,
        "suspended_users": suspended or 0,
        "hidden_jobs": hidden or 0,
    }


@router.get("/reports", response_model=list[ReportRow])
async def list_reports(
    status: str = Query("pending"),
    limit: int = Query(100, ge=1, le=500),
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(Report).where(Report.status == status).order_by(Report.created_at.desc()).limit(limit)
    )
    return [
        {
            "id": str(r.id), "reporter_id": str(r.reporter_id), "target_id": str(r.target_id),
            "target_type": r.target_type, "reason": r.reason, "details": r.details or "",
            "status": r.status,
            "created_at": str(r.created_at) if r.created_at else None,
            "actioned_at": str(r.actioned_at) if r.actioned_at else None,
        }
        for r in result.scalars().all()
    ]


@router.post("/reports/{report_id}/dismiss")
async def dismiss_report(report_id: str, user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    report = await session.get(Report, _uuid(report_id))
    if not report:
        raise HTTPException(404, "Report not found")
    report.status = "dismissed"
    session.add(report)
    await session.commit()
    return {"id": report_id, "status": "dismissed"}


@router.post("/reports/{report_id}/action")
async def action_report(
    report_id: str, body: ActionNote,
    user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session),
):
    """Hide the job / suspend the user this report targets, regardless of the threshold."""
    report = await session.get(Report, _uuid(report_id))
    if not report:
        raise HTTPException(404, "Report not found")
    changed = await apply_action(session, report.target_type, report.target_id, body.note or f"manual by {user['email']}")
    if not changed:
        raise HTTPException(404, "Report target no longer exists")
    return {"id": report_id, "target_type": report.target_type, "target_id": str(report.target_id), "actioned": True}


@router.post("/users/{user_id}/unsuspend")
async def unsuspend_user(user_id: str, user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    target = await session.get(User, _uuid(user_id))
    if not target:
        raise HTTPException(404, "User not found")
    target.suspended_at = None
    target.suspended_reason = None
    session.add(target)
    await session.commit()
    return {"id": user_id, "suspended": False}


@router.post("/jobs/{job_id}/unhide")
async def unhide_job(job_id: str, user: dict = Depends(require_admin), session: AsyncSession = Depends(get_session)):
    job = await session.get(JobPosting, _uuid(job_id))
    if not job:
        raise HTTPException(404, "Job not found")
    job.active = True
    job.moderation_note = None
    session.add(job)
    await session.commit()
    return {"id": job_id, "active": True}
