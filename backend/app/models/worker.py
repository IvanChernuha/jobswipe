from pydantic import BaseModel, ValidationInfo, field_validator
from typing import Optional
from app.models.tag import Tag
from app.services.content_filter import assert_clean

MAX_BIO_LEN = 5000
MAX_NAME_LEN = 200


class WorkerProfileUpdate(BaseModel):
    name: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    skills: Optional[list[str]] = None
    experience_years: Optional[int] = None
    tag_ids: Optional[list[str]] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and len(v.strip()) == 0:
            raise ValueError("name cannot be empty")
        if v and len(v) > MAX_NAME_LEN:
            raise ValueError(f"name cannot exceed {MAX_NAME_LEN} characters")
        return v

    @field_validator("bio")
    @classmethod
    def bio_length(cls, v: str | None) -> str | None:
        if v and len(v) > MAX_BIO_LEN:
            raise ValueError(f"bio cannot exceed {MAX_BIO_LEN} characters")
        return v

    @field_validator("experience_years")
    @classmethod
    def experience_non_negative(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("experience_years cannot be negative")
        if v is not None and v > 100:
            raise ValueError("experience_years cannot exceed 100")
        return v

    @field_validator("name", "bio", "location")
    @classmethod
    def no_prohibited_language(cls, v: str | None, info: ValidationInfo) -> str | None:
        if v:
            assert_clean(v, info.field_name or "text")
        return v


class WorkerProfile(BaseModel):
    user_id: str
    name: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    skills: Optional[list[str]] = None
    experience_years: Optional[int] = None
    resume_url: Optional[str] = None
    avatar_url: Optional[str] = None
    tags: list[Tag] = []

    model_config = {"extra": "ignore"}


class MatchScore(BaseModel):
    matched: int = 0
    total: int = 0
    percentage: int = 0


class WorkerCard(BaseModel):
    """Worker profile as shown in the employer feed."""
    id: str
    name: Optional[str] = None
    bio: Optional[str] = None
    location: Optional[str] = None
    skills: Optional[list[str]] = None
    experience_years: Optional[int] = None
    avatar_url: Optional[str] = None
    tags: list[Tag] = []
    match_score: Optional[MatchScore] = None

    model_config = {"extra": "ignore"}
