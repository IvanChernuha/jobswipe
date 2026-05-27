import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Literal, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user
from app.db.session import get_session
from app.models.tables.report import Report

router = APIRouter(prefix="/reports", tags=["reports"])


class ReportRequest(BaseModel):
    target_id: str
    target_type: Literal["user", "job"]
    reason: Literal["spam", "inappropriate", "fake", "harassment", "other"]
    details: str = ""


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
async def submit_report(
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
