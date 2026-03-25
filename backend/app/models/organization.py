from pydantic import BaseModel, field_validator
from typing import Optional

VALID_ORG_ROLES = {"owner", "admin", "manager", "viewer"}

# Permission matrix: which role can do what
PERMISSIONS = {
    "owner":   {"manage_org", "manage_members", "create_job", "edit_job", "toggle_job", "delete_job", "chat", "swipe", "swipe_pass", "bookmark", "view"},
    "admin":   {"manage_members", "create_job", "edit_job", "toggle_job", "delete_job", "chat", "swipe", "swipe_pass", "bookmark", "view"},
    "manager": {"create_job", "edit_job", "toggle_job", "delete_job", "chat", "swipe", "swipe_pass", "bookmark", "view"},
    "viewer":  {"bookmark", "swipe_pass", "view"},
}


def has_permission(role: str, action: str) -> bool:
    return action in PERMISSIONS.get(role, set())


class OrgCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Organization name cannot be empty")
        return v.strip()


class OrgResponse(BaseModel):
    id: str
    name: str
    owner_id: str
    created_at: str
    model_config = {"extra": "ignore"}


class OrgMemberResponse(BaseModel):
    id: str
    user_id: str
    email: str = ""
    role: str
    created_at: str
    model_config = {"extra": "ignore"}


class InviteCreate(BaseModel):
    email: str
    role: str = "viewer"

    @field_validator("email")
    @classmethod
    def email_valid(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v:
            raise ValueError("Invalid email")
        return v

    @field_validator("role")
    @classmethod
    def role_valid(cls, v: str) -> str:
        if v not in VALID_ORG_ROLES or v == "owner":
            raise ValueError("Role must be admin, manager, or viewer")
        return v


class InviteResponse(BaseModel):
    id: str
    email: str
    role: str
    token: str
    used: bool
    expires_at: str
    model_config = {"extra": "ignore"}


class RoleUpdate(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def role_valid(cls, v: str) -> str:
        if v not in VALID_ORG_ROLES or v == "owner":
            raise ValueError("Role must be admin, manager, or viewer")
        return v
