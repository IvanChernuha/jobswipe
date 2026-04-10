from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from app.deps import require_employer
from app.models.organization import (
    OrgCreate, OrgResponse, OrgMemberResponse,
    InviteCreate, InviteResponse, RoleUpdate,
    has_permission,
)
from app.db.client import get_client

router = APIRouter(prefix="/org", tags=["organizations"])


def _get_user_membership(db, uid: str) -> dict | None:
    """Get the user's org membership (if any)."""
    try:
        row = (
            db.table("org_members")
            .select("id, org_id, user_id, role, created_at")
            .eq("user_id", uid)
            .limit(1)
            .execute()
        )
        return row.data[0] if row.data else None
    except Exception:
        return None


def _require_org_permission(db, uid: str, action: str) -> dict:
    """Verify user belongs to an org and has the required permission. Returns membership."""
    membership = _get_user_membership(db, uid)
    if not membership:
        raise HTTPException(403, "You are not part of an organization")
    if not has_permission(membership["role"], action):
        raise HTTPException(403, f"Your role ({membership['role']}) cannot perform: {action}")
    return membership


# ── Organization CRUD ────────────────────────────────────────────────────────

@router.post("", response_model=OrgResponse, status_code=201)
async def create_org(body: OrgCreate, user: dict = Depends(require_employer)):
    db = get_client()
    uid = user["id"]

    # Check if user already belongs to an org
    existing = _get_user_membership(db, uid)
    if existing:
        raise HTTPException(400, "You already belong to an organization")

    # Create org
    org_row = db.table("organizations").insert({
        "name": body.name,
        "owner_id": uid,
    }).execute()
    if not org_row.data:
        raise HTTPException(500, "Failed to create organization")
    org = org_row.data[0]

    # Add creator as owner member
    db.table("org_members").insert({
        "org_id": org["id"],
        "user_id": uid,
        "role": "owner",
    }).execute()

    # Link employer profile to org
    db.table("employer_profiles").update({
        "org_id": org["id"],
    }).eq("user_id", uid).execute()

    return org


@router.get("", response_model=OrgResponse)
async def get_my_org(user: dict = Depends(require_employer)):
    db = get_client()
    membership = _get_user_membership(db, user["id"])
    if not membership:
        raise HTTPException(404, "You are not part of an organization")

    try:
        org = db.table("organizations").select("*").eq("id", membership["org_id"]).single().execute()
    except APIError:
        raise HTTPException(404, "Organization not found")
    return org.data


@router.put("", response_model=OrgResponse)
async def update_org(body: OrgCreate, user: dict = Depends(require_employer)):
    db = get_client()
    membership = _require_org_permission(db, user["id"], "manage_org")

    db.table("organizations").update({"name": body.name}).eq("id", membership["org_id"]).execute()
    org = db.table("organizations").select("*").eq("id", membership["org_id"]).single().execute()
    return org.data


# ── Members ──────────────────────────────────────────────────────────────────

@router.get("/members", response_model=list[OrgMemberResponse])
async def list_members(user: dict = Depends(require_employer)):
    db = get_client()
    membership = _require_org_permission(db, user["id"], "view")

    members = (
        db.table("org_members")
        .select("id, user_id, role, created_at")
        .eq("org_id", membership["org_id"])
        .order("created_at")
        .execute()
    )

    if not members.data:
        return []

    # Batch-fetch emails
    user_ids = [m["user_id"] for m in members.data]
    users_raw = db.table("users").select("id, email").in_("id", user_ids).execute()
    email_map = {u["id"]: u["email"] for u in (users_raw.data or [])}

    result = []
    for m in members.data:
        result.append({**m, "email": email_map.get(m["user_id"], "")})
    return result


@router.patch("/members/{member_id}", response_model=OrgMemberResponse)
async def update_member_role(member_id: str, body: RoleUpdate, user: dict = Depends(require_employer)):
    db = get_client()
    membership = _require_org_permission(db, user["id"], "manage_members")

    # Fetch target member
    try:
        target = db.table("org_members").select("*").eq("id", member_id).single().execute()
    except APIError:
        raise HTTPException(404, "Member not found")
    if not target.data:
        raise HTTPException(404, "Member not found")

    target_data = target.data
    if target_data["org_id"] != membership["org_id"]:
        raise HTTPException(403, "Member not in your organization")

    # Can't change owner's role
    if target_data["role"] == "owner":
        raise HTTPException(400, "Cannot change the owner's role")

    # Can't promote to owner
    if body.role == "owner":
        raise HTTPException(400, "Cannot promote to owner")

    # Admins can't change other admins (only owner can)
    if membership["role"] == "admin" and target_data["role"] == "admin":
        raise HTTPException(403, "Admins cannot change other admins' roles")

    db.table("org_members").update({"role": body.role}).eq("id", member_id).execute()

    updated = db.table("org_members").select("*").eq("id", member_id).single().execute()
    email_row = db.table("users").select("email").eq("id", updated.data["user_id"]).single().execute()
    return {**updated.data, "email": email_row.data["email"] if email_row.data else ""}


@router.delete("/members/{member_id}", status_code=204)
async def remove_member(member_id: str, user: dict = Depends(require_employer)):
    db = get_client()
    membership = _require_org_permission(db, user["id"], "manage_members")

    try:
        target = db.table("org_members").select("*").eq("id", member_id).single().execute()
    except APIError:
        raise HTTPException(404, "Member not found")
    if not target.data:
        raise HTTPException(404, "Member not found")

    target_data = target.data
    if target_data["org_id"] != membership["org_id"]:
        raise HTTPException(403, "Member not in your organization")

    if target_data["role"] == "owner":
        raise HTTPException(400, "Cannot remove the owner")

    if target_data["user_id"] == user["id"]:
        raise HTTPException(400, "Cannot remove yourself")

    # Admins can't remove other admins
    if membership["role"] == "admin" and target_data["role"] == "admin":
        raise HTTPException(403, "Admins cannot remove other admins")

    db.table("org_members").delete().eq("id", member_id).execute()
    # NOTE: We keep employer_profiles.org_id so the org retains access to
    # matches/jobs created by this former member. The removed user loses access
    # because they're no longer in org_members (checked by all access functions).


# ── Invites ──────────────────────────────────────────────────────────────────

@router.post("/invites", response_model=InviteResponse, status_code=201)
async def create_invite(body: InviteCreate, user: dict = Depends(require_employer)):
    db = get_client()
    membership = _require_org_permission(db, user["id"], "manage_members")

    # Check if email is already a member
    existing_user = db.table("users").select("id").eq("email", body.email).execute()
    if existing_user.data:
        existing_member = (
            db.table("org_members")
            .select("id")
            .eq("org_id", membership["org_id"])
            .eq("user_id", existing_user.data[0]["id"])
            .execute()
        )
        if existing_member.data:
            raise HTTPException(400, "This user is already a member")

    # Check for existing unused invite
    existing_invite = (
        db.table("org_invites")
        .select("id")
        .eq("org_id", membership["org_id"])
        .eq("email", body.email)
        .eq("used", False)
        .execute()
    )
    if existing_invite.data:
        raise HTTPException(400, "An active invite already exists for this email")

    row = db.table("org_invites").insert({
        "org_id": membership["org_id"],
        "email": body.email,
        "role": body.role,
    }).execute()

    if not row.data:
        raise HTTPException(500, "Failed to create invite")
    return row.data[0]


@router.get("/invites", response_model=list[InviteResponse])
async def list_invites(user: dict = Depends(require_employer)):
    db = get_client()
    membership = _require_org_permission(db, user["id"], "manage_members")

    rows = (
        db.table("org_invites")
        .select("*")
        .eq("org_id", membership["org_id"])
        .eq("used", False)
        .order("created_at", desc=True)
        .execute()
    )
    return rows.data or []


@router.delete("/invites/{invite_id}", status_code=204)
async def revoke_invite(invite_id: str, user: dict = Depends(require_employer)):
    db = get_client()
    membership = _require_org_permission(db, user["id"], "manage_members")

    try:
        invite = db.table("org_invites").select("*").eq("id", invite_id).single().execute()
    except APIError:
        raise HTTPException(404, "Invite not found")
    if not invite.data or invite.data["org_id"] != membership["org_id"]:
        raise HTTPException(404, "Invite not found")

    db.table("org_invites").delete().eq("id", invite_id).execute()


# ── Accept invite (called by the invited user) ──────────────────────────────

@router.post("/join", response_model=OrgMemberResponse)
async def join_org(token: str, user: dict = Depends(require_employer)):
    db = get_client()
    uid = user["id"]

    # Check user isn't already in an org
    existing = _get_user_membership(db, uid)
    if existing:
        raise HTTPException(400, "You already belong to an organization")

    # Find invite
    invite_row = (
        db.table("org_invites")
        .select("*")
        .eq("token", token)
        .eq("used", False)
        .execute()
    )
    if not invite_row.data:
        raise HTTPException(404, "Invalid or expired invite")

    invite = invite_row.data[0]

    # Verify email matches (case-insensitive — invites may have been created
    # with mixed-case input before normalization was added).
    if invite["email"].lower() != user.get("email", "").lower():
        raise HTTPException(403, "This invite was sent to a different email")

    # Check expiry
    from datetime import datetime, timezone
    expires = datetime.fromisoformat(invite["expires_at"].replace("Z", "+00:00"))
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(400, "Invite has expired")

    # Add as member
    member = db.table("org_members").insert({
        "org_id": invite["org_id"],
        "user_id": uid,
        "role": invite["role"],
    }).execute()

    # Link employer profile to org
    db.table("employer_profiles").update({
        "org_id": invite["org_id"],
    }).eq("user_id", uid).execute()

    # Mark invite as used
    db.table("org_invites").update({"used": True}).eq("id", invite["id"]).execute()

    result = member.data[0]
    return {**result, "email": user.get("email", "")}


# ── Get my role ──────────────────────────────────────────────────────────────

@router.get("/me")
async def get_my_membership(user: dict = Depends(require_employer)):
    db = get_client()
    membership = _get_user_membership(db, user["id"])
    if not membership:
        return {"has_org": False, "role": None, "org_id": None}
    return {"has_org": True, "role": membership["role"], "org_id": membership["org_id"]}
