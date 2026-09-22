"""Notification and notification_prefs tables."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import SQLModel, Field

NOTIFICATION_TYPES = ("match", "like_received", "chat", "team", "account")


class Notification(SQLModel, table=True):
    __tablename__ = "notifications"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id")
    type: str  # 'match' | 'like_received' | 'chat' | 'team' | 'account'
    title_key: str
    params: dict = Field(default_factory=dict, sa_column=Column(JSONB))
    link: Optional[str] = ""
    actor_id: Optional[uuid.UUID] = None
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    read_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class NotificationPref(SQLModel, table=True):
    __tablename__ = "notification_prefs"

    user_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    type: str = Field(primary_key=True)
    enabled: bool = True
