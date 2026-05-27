"""Match table."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Enum, DateTime
from sqlmodel import SQLModel, Field


class Match(SQLModel, table=True):
    __tablename__ = "matches"

    id: uuid.UUID = Field(default=None, primary_key=True)
    worker_id: uuid.UUID = Field(foreign_key="users.id")
    employer_id: uuid.UUID = Field(foreign_key="users.id")
    job_posting_id: Optional[uuid.UUID] = Field(default=None, foreign_key="job_postings.id")
    status: Optional[str] = Field(sa_column=Column(
        Enum("active", "archived",
             name="match_status_enum", create_type=False),
        server_default="active"
    ))
    matched_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
