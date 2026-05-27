from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import RegisterRequest, LoginRequest, AuthResponse
from app.db.client import get_auth_client
from app.db.session import get_session
from app.models.tables.user import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(body: RegisterRequest):
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
        raise HTTPException(status_code=400, detail=str(e))

    if not auth_res.user:
        raise HTTPException(status_code=400, detail="Registration failed")

    access_token = auth_res.session.access_token if auth_res.session else ""
    return AuthResponse(
        access_token=access_token,
        role=body.role,
        user_id=auth_res.user.id,
    )


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, session: AsyncSession = Depends(get_session)):
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
