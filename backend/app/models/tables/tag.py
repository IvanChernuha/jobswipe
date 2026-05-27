"""Tag, tag_implications, and tag enums."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, Enum, DateTime
from sqlmodel import SQLModel, Field


class Tag(SQLModel, table=True):
    __tablename__ = "tags"

    id: uuid.UUID = Field(default=None, primary_key=True)
    name: str
    category: str = Field(sa_column=Column(
        Enum("language", "framework", "tool", "database", "cloud",
             "soft_skill", "certification", "other",
             name="tag_category_enum", create_type=False),
        nullable=False, server_default="other"
    ))
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class TagImplication(SQLModel, table=True):
    __tablename__ = "tag_implications"

    parent_tag_id: uuid.UUID = Field(foreign_key="tags.id", primary_key=True)
    implied_tag_id: uuid.UUID = Field(foreign_key="tags.id", primary_key=True)
