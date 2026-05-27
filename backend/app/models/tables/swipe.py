"""Swipe table."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Enum, DateTime
from sqlmodel import SQLModel, Field


class Swipe(SQLModel, table=True):
    __tablename__ = "swipes"

    id: uuid.UUID = Field(default=None, primary_key=True)
    swiper_id: uuid.UUID = Field(foreign_key="users.id")
    swiper_type: str = Field(sa_column=Column(
        Enum("worker", "employer",
             name="swiper_type_enum", create_type=False),
        nullable=False
    ))
    target_id: uuid.UUID
    direction: str = Field(sa_column=Column(
        Enum("like", "pass", "super_like",
             name="swipe_direction_enum", create_type=False),
        nullable=False
    ))
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
