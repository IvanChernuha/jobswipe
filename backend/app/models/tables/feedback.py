"""In-app feedback (see supabase/migrations/017_app_feedback.sql)."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime, SmallInteger
from sqlmodel import SQLModel, Field


class AppFeedback(SQLModel, table=True):
    __tablename__ = "app_feedback"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id")
    rating: int = Field(sa_column=Column(SmallInteger, nullable=False))
    message: str = ""
    platform: str = "android"
    app_version: str = ""
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
