"""Message and read cursor tables."""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime
from sqlmodel import SQLModel, Field


class Message(SQLModel, table=True):
    __tablename__ = "messages"

    id: uuid.UUID = Field(default=None, primary_key=True)
    match_id: uuid.UUID = Field(foreign_key="matches.id")
    sender_id: uuid.UUID = Field(foreign_key="users.id")
    body: str
    created_at: datetime = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=False))


class MessageReadCursor(SQLModel, table=True):
    __tablename__ = "message_read_cursors"

    match_id: uuid.UUID = Field(foreign_key="matches.id", primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="users.id", primary_key=True)
    last_read_at: datetime = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=False))
