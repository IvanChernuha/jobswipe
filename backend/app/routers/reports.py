from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Literal, Optional
from app.deps import get_current_user
from app.db.client import get_client

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
async def submit_report(body: ReportRequest, user: dict = Depends(get_current_user)):
    db = get_client()

    # Prevent duplicate reports
    existing = (
        db.table("reports")
        .select("id")
        .eq("reporter_id", user["id"])
        .eq("target_id", body.target_id)
        .eq("target_type", body.target_type)
        .execute()
    )
    if existing.data:
        raise HTTPException(409, "You have already reported this")

    # Can't report yourself
    if body.target_id == user["id"]:
        raise HTTPException(400, "Cannot report yourself")

    result = db.table("reports").insert({
        "reporter_id": user["id"],
        "target_id": body.target_id,
        "target_type": body.target_type,
        "reason": body.reason,
        "details": body.details,
    }).execute()

    return result.data[0]


@router.get("", response_model=list[ReportResponse])
async def my_reports(user: dict = Depends(get_current_user)):
    """List reports filed by the current user."""
    db = get_client()
    result = (
        db.table("reports")
        .select("*")
        .eq("reporter_id", user["id"])
        .order("created_at", desc=True)
        .execute()
    )
    return result.data or []
