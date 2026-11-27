"""Connections to employers' hiring systems (ATS), e.g. Comeet.

See supabase/migrations/018_ats_connections.sql and docs/worklog/comeet-import.md.
The token is a secret: only the API reads it, and no endpoint returns it.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime, UniqueConstraint
from sqlmodel import SQLModel, Field


class AtsConnection(SQLModel, table=True):
    __tablename__ = "ats_connections"
    __table_args__ = (UniqueConstraint("employer_id", "provider"),)

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    employer_id: uuid.UUID = Field(foreign_key="users.id")
    provider: str = "comeet"
    company_uid: str
    token: str
    company_name: str = ""
    status: str = "importing"  # importing | connected | error
    last_synced_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    last_error: Optional[str] = None
    # When the running (or last) sync was queued: an "importing" status older
    # than an hour means it died (e.g. a restart) and may be started again.
    sync_started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
