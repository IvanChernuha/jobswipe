"""Bookmark table."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime
from sqlmodel import SQLModel, Field


class Bookmark(SQLModel, table=True):
    __tablename__ = "bookmarks"

    id: uuid.UUID = Field(default=None, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id")
    target_id: uuid.UUID
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    expires_at: datetime = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=False))
    job_posting_id: Optional[uuid.UUID] = Field(default=None, foreign_key="job_postings.id")
    note: Optional[str] = ""
