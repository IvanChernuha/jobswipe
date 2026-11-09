"""Shared org-aware access helpers used by matches and messages routers."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import HTTPException

from app.models.organization import has_permission
from app.models.tables.organization import OrgMember
from app.models.tables.employer import EmployerProfile


async def get_org_employer_ids(session: AsyncSession, uid: str) -> list[str]:
    """Get all employer user_ids whose matches this user can access.
    Requires active org_members membership. Former members get nothing."""
    uid_uuid = uuid.UUID(uid)

    # Check org membership
    result = await session.execute(
        select(OrgMember.org_id).where(OrgMember.user_id == uid_uuid).limit(1)
    )
    row = result.first()

    if row:
        org_id = row.org_id
        profiles = await session.execute(
            select(EmployerProfile.user_id).where(EmployerProfile.org_id == org_id)
        )
        ids = {str(p.user_id) for p in profiles.all()}
        ids.add(uid)
        return list(ids)

    # Former member check — profile has org_id but not in org_members
    profile = await session.execute(
        select(EmployerProfile.org_id).where(EmployerProfile.user_id == uid_uuid).limit(1)
    )
    p_row = profile.first()
    if p_row and p_row.org_id:
        return []  # Former member — no access

    return [uid]  # Solo employer


async def require_team_permission(session: AsyncSession, uid: str, action: str) -> None:
    """403 if the user is on a team whose role doesn't allow `action`.
    Solo employers (no team) may do everything."""
    result = await session.execute(
        select(OrgMember.role).where(OrgMember.user_id == uuid.UUID(uid)).limit(1)
    )
    row = result.first()
    if row and not has_permission(row.role, action):
        raise HTTPException(403, f"Your role ({row.role}) cannot perform: {action}")
