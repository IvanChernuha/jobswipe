from pydantic import BaseModel
from typing import Literal, Optional


class SwipeRequest(BaseModel):
    target_id: str
    direction: Literal["like", "pass", "super_like"]


class SwipeResponse(BaseModel):
    matched: bool
    match_id: Optional[str] = None


class UndoResponse(BaseModel):
    undone: bool
    target_id: Optional[str] = None
