"""In-app feedback: anyone signed in can rate the app; admins read it."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.deps import get_current_user, require_admin
from app.models.feedback import FeedbackCreate
from app.models.tables.feedback import AppFeedback
from app.models.tables.user import User
from app.rate_limit import limiter, user_or_ip

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("", status_code=201)
@limiter.limit("10/hour", key_func=user_or_ip)
async def send_feedback(
    request: Request,
    body: FeedbackCreate,
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    session.add(AppFeedback(
        user_id=uuid.UUID(user["id"]), rating=body.rating, message=body.message,
        platform=body.platform, app_version=body.app_version, created_at=datetime.now(timezone.utc),
    ))
    await session.commit()
    return {"ok": True}


@router.get("")
async def list_feedback(
    user: dict = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Newest first, with who sent it."""
    rows = await session.execute(
        select(AppFeedback, User.email, User.role)
        .join(User, User.id == AppFeedback.user_id)
        .order_by(AppFeedback.created_at.desc())
        .limit(500)
    )
    return [
        {
            "id": str(f.id), "rating": f.rating, "message": f.message, "platform": f.platform,
            "app_version": f.app_version, "created_at": f.created_at.isoformat() if f.created_at else None,
            "email": email, "role": role,
        }
        for f, email, role in rows.all()
    ]
