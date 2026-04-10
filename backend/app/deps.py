from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

from app.config import settings
from app.db.client import get_client

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """Verify the Supabase JWT signature and return the user dict.

    Previously this used `jwt.get_unverified_claims()`, trusting whatever sub
    the client provided — a complete auth bypass because all DB queries use
    the service-role client (which ignores RLS). Now we verify the HS256
    signature against SUPABASE_JWT_SECRET and validate the audience claim,
    matching how supabase-auth issues tokens.
    """
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not settings.SUPABASE_JWT_SECRET:
        # Fail closed: misconfiguration must not silently accept forged tokens.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server auth misconfigured",
        )

    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )
        user_id: str = payload.get("sub")
        if not user_id:
            raise credentials_error
    except JWTError:
        raise credentials_error

    db = get_client()
    try:
        result = db.table("users").select("id, email, role").eq("id", user_id).single().execute()
    except Exception:
        raise credentials_error
    if not result.data:
        raise credentials_error

    return {**result.data, "token": token}


async def require_worker(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "worker":
        raise HTTPException(status_code=403, detail="Workers only")
    return user


async def require_employer(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] != "employer":
        raise HTTPException(status_code=403, detail="Employers only")
    return user


def require_employer_with_permission(action: str):
    """Dependency factory: checks employer has org permission for the given action.
    If user has no org, they're treated as a solo employer with full permissions."""
    async def dependency(user: dict = Depends(require_employer)) -> dict:
        from app.models.organization import has_permission
        db = get_client()
        membership = (
            db.table("org_members")
            .select("role, org_id")
            .eq("user_id", user["id"])
            .limit(1)
            .execute()
        )
        if membership.data:
            role = membership.data[0]["role"]
            if not has_permission(role, action):
                raise HTTPException(403, f"Your role ({role}) cannot perform: {action}")
            user["org_role"] = role
            user["org_id"] = membership.data[0]["org_id"]
        else:
            # Solo employer — full permissions
            user["org_role"] = "owner"
            user["org_id"] = None
        return user
    return dependency
