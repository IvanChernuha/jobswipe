"""Blocked users table."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime
from sqlmodel import SQLModel, Field


class BlockedUser(SQLModel, table=True):
    __tablename__ = "blocked_users"

    blocker_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    blocked_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
