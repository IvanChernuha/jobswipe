"""Promo codes and Pro grants (see supabase/migrations/014_plans.sql)."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime
from sqlmodel import SQLModel, Field


class PromoCode(SQLModel, table=True):
    __tablename__ = "promo_codes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    code: str
    duration_days: Optional[int] = None  # None = forever
    max_uses: int = 1
    uses: int = 0
    redeem_by: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    note: str = ""
    active: bool = True
    created_by: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class ProGrant(SQLModel, table=True):
    __tablename__ = "pro_grants"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    subject_type: str  # 'org' | 'user'
    subject_id: uuid.UUID
    source: str = "code"  # 'code' | 'admin' | 'billing'
    promo_code_id: Optional[uuid.UUID] = Field(default=None, foreign_key="promo_codes.id")
    redeemed_by: Optional[uuid.UUID] = Field(default=None, foreign_key="users.id")
    starts_at: datetime = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=False))
    ends_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
