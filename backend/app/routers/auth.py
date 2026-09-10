import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import RegisterRequest, LoginRequest, AuthResponse
from app.db.client import get_auth_client
from app.db.session import get_session
from app.models.tables.user import User
from app.rate_limit import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=201)
@limiter.limit("20/hour")
async def register(request: Request, body: RegisterRequest):
    """
    Register via the backend API.
    The DB trigger on_auth_user_created handles public.users + empty profile creation.
    """
    auth_db = get_auth_client()
    try:
        auth_res = auth_db.auth.sign_up({
            "email": body.email,
            "password": body.password,
            "options": {"data": {"role": body.role}},
        })
    except Exception as e:
        # Do NOT reflect the raw provider error — it enables email enumeration
        # ("user already registered" vs. other errors). Log server-side only.
        logger.warning("Registration failed for %s: %s", body.email, e)
        raise HTTPException(status_code=400, detail="Registration failed")

    if not auth_res.user:
        raise HTTPException(status_code=400, detail="Registration failed")

    access_token = auth_res.session.access_token if auth_res.session else ""
    return AuthResponse(
        access_token=access_token,
        role=body.role,
        user_id=auth_res.user.id,
    )


@router.post("/login", response_model=AuthResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginRequest, session: AsyncSession = Depends(get_session)):
    auth_db = get_auth_client()
    try:
        auth_res = auth_db.auth.sign_in_with_password({"email": body.email, "password": body.password})
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not auth_res.user or not auth_res.session:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_id = auth_res.user.id
    user = await session.get(User, user_id)
    role = user.role if user else "worker"

    return AuthResponse(
        access_token=auth_res.session.access_token,
        role=role,
        user_id=user_id,
    )
