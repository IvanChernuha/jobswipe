"""Report table."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime
from sqlmodel import SQLModel, Field


class Report(SQLModel, table=True):
    __tablename__ = "reports"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    reporter_id: uuid.UUID = Field(foreign_key="users.id")
    target_id: uuid.UUID
    target_type: str  # 'user' | 'job'
    reason: str  # 'spam' | 'inappropriate' | 'fake' | 'harassment' | 'other'
    details: Optional[str] = ""
    status: str = "pending"  # 'pending' | 'reviewed' | 'dismissed' | 'actioned'
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
