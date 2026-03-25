from pydantic import BaseModel, field_validator
from typing import Optional


class MessageCreate(BaseModel):
    body: str

    @field_validator("body")
    @classmethod
    def body_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Message body cannot be empty")
        if len(v) > 5000:
            raise ValueError("Message body cannot exceed 5000 characters")
        return v


class MessageResponse(BaseModel):
    id: str
    match_id: str
    sender_id: str
    body: str
    created_at: str
    is_mine: bool = False

    model_config = {"extra": "ignore"}


class UnreadCount(BaseModel):
    match_id: str
    count: int
