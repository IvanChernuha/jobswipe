"""Job posting and job_posting_tags junction table."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Text, ARRAY, Enum, DateTime
from sqlmodel import SQLModel, Field


class JobPosting(SQLModel, table=True):
    __tablename__ = "job_postings"

    id: uuid.UUID = Field(default=None, primary_key=True)
    employer_id: uuid.UUID = Field(foreign_key="users.id")
    title: str
    description: Optional[str] = ""
    skills_required: Optional[list[str]] = Field(default_factory=list, sa_column=Column(ARRAY(Text)))
    salary_min: Optional[int] = 0
    salary_max: Optional[int] = 0
    location: Optional[str] = ""
    remote: Optional[bool] = False
    active: Optional[bool] = True
    # embedding: vector(1536) — skipped, handled by pgvector extension
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    expires_at: datetime = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=False))
    min_experience_years: Optional[int] = None


class JobPostingTag(SQLModel, table=True):
    __tablename__ = "job_posting_tags"

    job_posting_id: uuid.UUID = Field(foreign_key="job_postings.id", primary_key=True)
    tag_id: uuid.UUID = Field(foreign_key="tags.id", primary_key=True)
    requirement: str = Field(sa_column=Column(
        Enum("required", "preferred", "nice",
             name="tag_requirement_enum", create_type=False),
        nullable=False, server_default="nice"
    ))
