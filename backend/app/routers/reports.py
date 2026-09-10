import logging
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from typing import Literal, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.rate_limit import limiter, user_or_ip
from app.db.session import get_session
from app.models.tables.report import Report
from app.services.content_filter import assert_clean
from app.services.moderation import evaluate_after_report

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["reports"])


class ReportRequest(BaseModel):
    target_id: str
    target_type: Literal["user", "job"]
    reason: Literal["spam", "inappropriate", "fake", "harassment", "other"]
    details: str = ""

    @field_validator("details")
    @classmethod
    def details_clean(cls, v: str) -> str:
        if len(v) > 2000:
            raise ValueError("details cannot exceed 2000 characters")
        assert_clean(v, "details")
        return v


class ReportResponse(BaseModel):
    id: str
    reporter_id: str
    target_id: str
    target_type: str
    reason: str
    details: str
    status: str
    created_at: Optional[str] = None

    model_config = {"extra": "ignore"}


@router.post("", response_model=ReportResponse, status_code=201)
@limiter.limit("10/hour", key_func=user_or_ip)
async def submit_report(
    request: Request,
    body: ReportRequest,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    # Prevent duplicate reports
    existing = await session.execute(
        select(Report.id)
        .where(Report.reporter_id == uuid.UUID(user["id"]))
        .where(Report.target_id == uuid.UUID(body.target_id))
        .where(Report.target_type == body.target_type)
    )
    if existing.first():
        raise HTTPException(409, "You have already reported this")

    if body.target_id == user["id"]:
        raise HTTPException(400, "Cannot report yourself")

    report = Report(
        reporter_id=uuid.UUID(user["id"]),
        target_id=uuid.UUID(body.target_id),
        target_type=body.target_type,
        reason=body.reason,
        details=body.details,
        created_at=datetime.now(timezone.utc),
    )
    session.add(report)
    await session.commit()

    # The report is saved; the automated loop must never make submission fail.
    try:
        outcome = await evaluate_after_report(session, report)
        logger.warning(
            "report filed: %s %s reason=%s reporters=%s actioned=%s",
            body.target_type, body.target_id, body.reason, outcome["reporters"], outcome["actioned"],
        )
    except Exception:
        logger.exception("report loop failed for %s %s", body.target_type, body.target_id)

    return {
        "id": str(report.id),
        "reporter_id": str(report.reporter_id),
        "target_id": str(report.target_id),
        "target_type": report.target_type,
        "reason": report.reason,
        "details": report.details or "",
        "status": report.status,
        "created_at": str(report.created_at) if report.created_at else None,
    }


@router.get("", response_model=list[ReportResponse])
async def my_reports(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    """List reports filed by the current user."""
    result = await session.execute(
        select(Report)
        .where(Report.reporter_id == uuid.UUID(user["id"]))
        .order_by(Report.created_at.desc())
    )
    rows = result.scalars().all()
    return [
        {
            "id": str(r.id),
            "reporter_id": str(r.reporter_id),
            "target_id": str(r.target_id),
            "target_type": r.target_type,
            "reason": r.reason,
            "details": r.details or "",
            "status": r.status,
            "created_at": str(r.created_at) if r.created_at else None,
        }
        for r in rows
    ]
