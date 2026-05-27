import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import require_employer
from app.db.session import get_session
from app.models.organization import (
    OrgCreate, OrgResponse, OrgMemberResponse,
    InviteCreate, InviteResponse, RoleUpdate,
    has_permission,
)
from app.models.tables.organization import Organization, OrgMember, OrgInvite
from app.models.tables.employer import EmployerProfile
from app.models.tables.user import User

router = APIRouter(prefix="/org", tags=["organizations"])


async def _get_user_membership(session: AsyncSession, uid: str) -> OrgMember | None:
    result = await session.execute(
        select(OrgMember).where(OrgMember.user_id == uuid.UUID(uid)).limit(1)
    )
    return result.scalars().first()


async def _require_org_permission(session: AsyncSession, uid: str, action: str) -> OrgMember:
    membership = await _get_user_membership(session, uid)
    if not membership:
        raise HTTPException(403, "You are not part of an organization")
    if not has_permission(membership.role, action):
        raise HTTPException(403, f"Your role ({membership.role}) cannot perform: {action}")
    return membership


# ── Organization CRUD ────────────────────────────────────────────────────────

@router.post("", response_model=OrgResponse, status_code=201)
async def create_org(body: OrgCreate, user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    uid = uuid.UUID(user["id"])

    existing = await _get_user_membership(session, user["id"])
    if existing:
        raise HTTPException(400, "You already belong to an organization")

    org = Organization(id=uuid.uuid4(), name=body.name, owner_id=uid, created_at=datetime.now(timezone.utc))
    session.add(org)
    await session.flush()

    session.add(OrgMember(id=uuid.uuid4(), org_id=org.id, user_id=uid, role="owner", created_at=datetime.now(timezone.utc)))

    profile = await session.get(EmployerProfile, uid)
    if profile:
        profile.org_id = org.id
        session.add(profile)

    await session.commit()
    return {"id": str(org.id), "name": org.name, "owner_id": str(org.owner_id), "created_at": str(org.created_at)}


@router.get("", response_model=OrgResponse)
async def get_my_org(user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    membership = await _get_user_membership(session, user["id"])
    if not membership:
        raise HTTPException(404, "You are not part of an organization")

    org = await session.get(Organization, membership.org_id)
    if not org:
        raise HTTPException(404, "Organization not found")
    return {"id": str(org.id), "name": org.name, "owner_id": str(org.owner_id), "created_at": str(org.created_at)}


@router.put("", response_model=OrgResponse)
async def update_org(body: OrgCreate, user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    membership = await _require_org_permission(session, user["id"], "manage_org")

    org = await session.get(Organization, membership.org_id)
    org.name = body.name
    session.add(org)
    await session.commit()
    await session.refresh(org)
    return {"id": str(org.id), "name": org.name, "owner_id": str(org.owner_id), "created_at": str(org.created_at)}


# ── Members ──────────────────────────────────────────────────────────────────

@router.get("/members", response_model=list[OrgMemberResponse])
async def list_members(user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    membership = await _require_org_permission(session, user["id"], "view")

    result = await session.execute(
        select(OrgMember).where(OrgMember.org_id == membership.org_id).order_by(OrgMember.created_at)
    )
    members = result.scalars().all()
    if not members:
        return []

    user_ids = [m.user_id for m in members]
    ur = await session.execute(select(User.id, User.email).where(User.id.in_(user_ids)))
    email_map = {r.id: r.email for r in ur.all()}

    return [{
        "id": str(m.id), "user_id": str(m.user_id), "role": m.role,
        "created_at": str(m.created_at) if m.created_at else None,
        "email": email_map.get(m.user_id, ""),
    } for m in members]


@router.patch("/members/{member_id}", response_model=OrgMemberResponse)
async def update_member_role(member_id: str, body: RoleUpdate, user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    membership = await _require_org_permission(session, user["id"], "manage_members")

    target = await session.get(OrgMember, uuid.UUID(member_id))
    if not target or target.org_id != membership.org_id:
        raise HTTPException(404, "Member not found")

    if target.role == "owner":
        raise HTTPException(400, "Cannot change the owner's role")
    if body.role == "owner":
        raise HTTPException(400, "Cannot promote to owner")
    if membership.role == "admin" and target.role == "admin":
        raise HTTPException(403, "Admins cannot change other admins' roles")

    target.role = body.role
    session.add(target)
    await session.commit()
    await session.refresh(target)

    u = await session.get(User, target.user_id)
    return {
        "id": str(target.id), "user_id": str(target.user_id), "role": target.role,
        "created_at": str(target.created_at) if target.created_at else None,
        "email": u.email if u else "",
    }


@router.delete("/members/{member_id}", status_code=204)
async def remove_member(member_id: str, user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    membership = await _require_org_permission(session, user["id"], "manage_members")

    target = await session.get(OrgMember, uuid.UUID(member_id))
    if not target or target.org_id != membership.org_id:
        raise HTTPException(404, "Member not found")

    if target.role == "owner":
        raise HTTPException(400, "Cannot remove the owner")
    if str(target.user_id) == user["id"]:
        raise HTTPException(400, "Cannot remove yourself")
    if membership.role == "admin" and target.role == "admin":
        raise HTTPException(403, "Admins cannot remove other admins")

    await session.delete(target)
    await session.commit()


# ── Invites ──────────────────────────────────────────────────────────────────

@router.post("/invites", response_model=InviteResponse, status_code=201)
async def create_invite(body: InviteCreate, user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    membership = await _require_org_permission(session, user["id"], "manage_members")

    # Check if already a member
    ur = await session.execute(select(User.id).where(User.email == body.email))
    existing_user = ur.first()
    if existing_user:
        mr = await session.execute(
            select(OrgMember.id).where(OrgMember.org_id == membership.org_id, OrgMember.user_id == existing_user.id)
        )
        if mr.first():
            raise HTTPException(400, "This user is already a member")

    # Check existing unused invite
    ir = await session.execute(
        select(OrgInvite.id).where(
            OrgInvite.org_id == membership.org_id, OrgInvite.email == body.email, OrgInvite.used == False
        )
    )
    if ir.first():
        raise HTTPException(400, "An active invite already exists for this email")

    import secrets
    invite = OrgInvite(
        id=uuid.uuid4(), org_id=membership.org_id, email=body.email, role=body.role,
        token=secrets.token_hex(32), created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + __import__('datetime').timedelta(days=7),
    )
    session.add(invite)
    await session.commit()

    return {
        "id": str(invite.id), "org_id": str(invite.org_id), "email": invite.email,
        "role": invite.role, "token": invite.token, "used": invite.used,
        "created_at": str(invite.created_at), "expires_at": str(invite.expires_at),
    }


@router.get("/invites", response_model=list[InviteResponse])
async def list_invites(user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    membership = await _require_org_permission(session, user["id"], "manage_members")

    result = await session.execute(
        select(OrgInvite)
        .where(OrgInvite.org_id == membership.org_id, OrgInvite.used == False)
        .order_by(OrgInvite.created_at.desc())
    )
    return [{
        "id": str(i.id), "org_id": str(i.org_id), "email": i.email,
        "role": i.role, "token": i.token, "used": i.used,
        "created_at": str(i.created_at), "expires_at": str(i.expires_at),
    } for i in result.scalars().all()]


@router.delete("/invites/{invite_id}", status_code=204)
async def revoke_invite(invite_id: str, user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    membership = await _require_org_permission(session, user["id"], "manage_members")

    invite = await session.get(OrgInvite, uuid.UUID(invite_id))
    if not invite or invite.org_id != membership.org_id:
        raise HTTPException(404, "Invite not found")

    await session.delete(invite)
    await session.commit()


# ── Join ──────────────────────────────────────────────────────────────────────

@router.post("/join", response_model=OrgMemberResponse)
async def join_org(token: str, user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    uid = uuid.UUID(user["id"])

    existing = await _get_user_membership(session, user["id"])
    if existing:
        raise HTTPException(400, "You already belong to an organization")

    result = await session.execute(
        select(OrgInvite).where(OrgInvite.token == token, OrgInvite.used == False)
    )
    invite = result.scalars().first()
    if not invite:
        raise HTTPException(404, "Invalid or expired invite")

    if invite.email.lower() != user.get("email", "").lower():
        raise HTTPException(403, "This invite was sent to a different email")

    if datetime.now(timezone.utc) > invite.expires_at:
        raise HTTPException(400, "Invite has expired")

    member = OrgMember(id=uuid.uuid4(), org_id=invite.org_id, user_id=uid, role=invite.role, created_at=datetime.now(timezone.utc))
    session.add(member)

    profile = await session.get(EmployerProfile, uid)
    if profile:
        profile.org_id = invite.org_id
        session.add(profile)

    invite.used = True
    session.add(invite)
    await session.commit()

    return {
        "id": str(member.id), "user_id": str(member.user_id), "role": member.role,
        "created_at": str(member.created_at), "email": user.get("email", ""),
    }


# ── My membership ────────────────────────────────────────────────────────────

@router.get("/me")
async def get_my_membership(user: dict = Depends(require_employer), session: AsyncSession = Depends(get_session)):
    membership = await _get_user_membership(session, user["id"])
    if not membership:
        return {"has_org": False, "role": None, "org_id": None}
    return {"has_org": True, "role": membership.role, "org_id": str(membership.org_id)}
