from fastapi import APIRouter, HTTPException
from app.models.user import RegisterRequest, LoginRequest, AuthResponse
from app.db.client import get_client, get_auth_client

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=201)
async def register(body: RegisterRequest):
    """
    Register via the backend API (alternative to the frontend's direct Supabase signUp).
    The DB trigger on_auth_user_created handles public.users + empty profile creation,
    so we only call sign_up here and return the token.
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

    # The trigger handles public.users + empty profile rows automatically.
    # No manual inserts needed — they would conflict with the trigger.

    access_token = auth_res.session.access_token if auth_res.session else ""
    return AuthResponse(
        access_token=access_token,
        role=body.role,
        user_id=auth_res.user.id,
    )


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest):
    auth_db = get_auth_client()
    try:
        auth_res = auth_db.auth.sign_in_with_password({"email": body.email, "password": body.password})
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    if not auth_res.user or not auth_res.session:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_id = auth_res.user.id
    db = get_client()
    user_row = db.table("users").select("role").eq("id", user_id).single().execute()
    role = user_row.data["role"] if user_row.data else "worker"

    return AuthResponse(
        access_token=auth_res.session.access_token,
        role=role,
        user_id=user_id,
    )
