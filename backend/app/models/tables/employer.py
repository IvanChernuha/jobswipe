"""Employer profile table."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime
from sqlmodel import SQLModel, Field


class EmployerProfile(SQLModel, table=True):
    __tablename__ = "employer_profiles"

    user_id: uuid.UUID = Field(primary_key=True, foreign_key="users.id")
    company_name: str = ""
    description: Optional[str] = ""
    industry: Optional[str] = ""
    location: Optional[str] = ""
    logo_url: Optional[str] = ""
    updated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    org_id: Optional[uuid.UUID] = Field(default=None, foreign_key="organizations.id")
