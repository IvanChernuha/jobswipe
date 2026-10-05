"""Employer plan: current status and promo-code redemption."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.deps import require_employer
from app.rate_limit import limiter, user_or_ip
from app.services.plans import plan_summary, redeem_code

router = APIRouter(prefix="/plan", tags=["plan"])


class RedeemRequest(BaseModel):
    code: str

    @field_validator("code")
    @classmethod
    def code_shape(cls, v: str) -> str:
        v = v.strip()
        if not 4 <= len(v) <= 40:
            raise ValueError("Enter a valid code")
        return v


@router.get("")
async def get_plan(user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    return await plan_summary(session, user["id"])


@router.post("/redeem")
@limiter.limit("10/hour", key_func=user_or_ip)  # codes are guessable-length; slow down brute force
async def redeem(
    request: Request,
    body: RedeemRequest,
    user: dict = Depends(require_employer),
    session: AsyncSession = Depends(get_session),
):
    return await redeem_code(session, user["id"], body.code)
