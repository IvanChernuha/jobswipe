from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_session
from app.models.tables.user import User
from app.models.tables.organization import OrgMember

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Verify the Supabase JWT signature and return the user dict."""
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not settings.SUPABASE_JWT_SECRET:
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

    try:
        user = await session.get(User, user_id)
    except Exception:
        raise credentials_error
    if not user:
        raise credentials_error

    return {"id": str(user.id), "email": user.email, "role": user.role, "token": token}


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
    async def dependency(
        user: dict = Depends(require_employer),
        session: AsyncSession = Depends(get_session),
    ) -> dict:
        from app.models.organization import has_permission

        result = await session.execute(
            select(OrgMember.role, OrgMember.org_id)
            .where(OrgMember.user_id == user["id"])
            .limit(1)
        )
        row = result.first()

        if row:
            role = row.role
            if not has_permission(role, action):
                raise HTTPException(403, f"Your role ({role}) cannot perform: {action}")
            user["org_role"] = role
            user["org_id"] = str(row.org_id)
        else:
            user["org_role"] = "owner"
            user["org_id"] = None
        return user
    return dependency
