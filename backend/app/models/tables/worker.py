"""Worker profile and worker_tags junction table."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Text, ARRAY, Integer, DateTime
from sqlmodel import SQLModel, Field


class WorkerProfile(SQLModel, table=True):
    __tablename__ = "worker_profiles"

    user_id: uuid.UUID = Field(primary_key=True, foreign_key="users.id")
    name: str = ""
    bio: Optional[str] = ""
    location: Optional[str] = ""
    skills: Optional[list[str]] = Field(default_factory=list, sa_column=Column(ARRAY(Text)))
    experience_years: Optional[int] = 0
    resume_url: Optional[str] = ""
    avatar_url: Optional[str] = ""
    # embedding: vector(1536) — skipped, handled by pgvector extension
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    cv_extraction_status: Optional[str] = None
    cv_extracted_tag_count: Optional[int] = 0


class WorkerTag(SQLModel, table=True):
    __tablename__ = "worker_tags"

    worker_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    tag_id: uuid.UUID = Field(foreign_key="tags.id", primary_key=True)
