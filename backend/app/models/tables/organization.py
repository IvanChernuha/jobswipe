"""Organization, member, and invite tables."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Enum, DateTime
from sqlmodel import SQLModel, Field


class Organization(SQLModel, table=True):
    __tablename__ = "organizations"

    id: uuid.UUID = Field(default=None, primary_key=True)
    name: str
    owner_id: uuid.UUID = Field(foreign_key="users.id")
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class OrgMember(SQLModel, table=True):
    __tablename__ = "org_members"

    id: uuid.UUID = Field(default=None, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    user_id: uuid.UUID = Field(foreign_key="users.id")
    role: str = Field(sa_column=Column(
        Enum("owner", "admin", "manager", "viewer",
             name="org_role", create_type=False),
        nullable=False, server_default="viewer"
    ))
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class OrgInvite(SQLModel, table=True):
    __tablename__ = "org_invites"

    id: uuid.UUID = Field(default=None, primary_key=True)
    org_id: uuid.UUID = Field(foreign_key="organizations.id")
    email: str
    role: str = Field(sa_column=Column(
        Enum("owner", "admin", "manager", "viewer",
             name="org_role", create_type=False),
        nullable=False, server_default="viewer"
    ))
    token: str
    used: bool = False
    created_at: datetime = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=False))
    expires_at: datetime = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=False))
