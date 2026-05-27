"""User table — maps to public.users."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime
from sqlmodel import SQLModel, Field


class User(SQLModel, table=True):
    __tablename__ = "users"

    id: uuid.UUID = Field(primary_key=True)
    email: str
    role: str  # 'worker' | 'employer'
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
