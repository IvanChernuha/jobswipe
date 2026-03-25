from pydantic import BaseModel
from typing import Optional


class Tag(BaseModel):
    id: str
    name: str
    category: str
    requirement: Optional[str] = None  # 'required', 'preferred', 'nice' — only on job posting tags


class TagUpdate(BaseModel):
    tag_ids: list[str]
