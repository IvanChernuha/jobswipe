"""Bookmark note table — threaded, signed notes on a (possibly team-shared) bookmark."""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Column, DateTime
from sqlmodel import SQLModel, Field


class BookmarkNote(SQLModel, table=True):
    __tablename__ = "bookmark_notes"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    bookmark_id: uuid.UUID = Field(foreign_key="bookmarks.id")
    author_id: uuid.UUID = Field(foreign_key="users.id")
    body: str
    created_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
