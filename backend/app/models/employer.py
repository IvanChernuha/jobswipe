from pydantic import BaseModel, field_validator, model_validator
from typing import Optional
from app.models.tag import Tag

MAX_NAME_LEN = 200
MAX_DESC_LEN = 5000


class EmployerProfileUpdate(BaseModel):
    company_name: Optional[str] = None
    description: Optional[str] = None
    industry: Optional[str] = None
    location: Optional[str] = None

    @field_validator("company_name")
    @classmethod
    def company_name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and len(v.strip()) == 0:
            raise ValueError("company_name cannot be empty")
        if v and len(v) > MAX_NAME_LEN:
            raise ValueError(f"company_name cannot exceed {MAX_NAME_LEN} characters")
        return v

    @field_validator("description")
    @classmethod
    def desc_length(cls, v: str | None) -> str | None:
        if v and len(v) > MAX_DESC_LEN:
            raise ValueError(f"description cannot exceed {MAX_DESC_LEN} characters")
        return v


class EmployerProfile(BaseModel):
    user_id: str
    company_name: Optional[str] = None
    description: Optional[str] = None
    industry: Optional[str] = None
    location: Optional[str] = None
    avatar_url: Optional[str] = None

    model_config = {"extra": "ignore"}


class JobPostingCreate(BaseModel):
    title: str
    description: str = ""
    skills_required: list[str] = []
    salary_min: int = 0
    salary_max: int = 0
    location: str = ""
    remote: bool = False
    tag_ids: list[str] = []              # backward compat — treated as 'nice'
    required_tag_ids: list[str] = []     # must have ALL
    preferred_tag_ids: list[str] = []    # must have at least 1
    expires_in_days: int = 30            # how many days until expiry (default 30)

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str) -> str:
        if len(v.strip()) == 0:
            raise ValueError("title cannot be empty")
        if len(v) > MAX_NAME_LEN:
            raise ValueError(f"title cannot exceed {MAX_NAME_LEN} characters")
        return v

    @field_validator("salary_min", "salary_max")
    @classmethod
    def salary_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("salary cannot be negative")
        return v

    @field_validator("expires_in_days")
    @classmethod
    def expires_in_days_valid(cls, v: int) -> int:
        if v < 1 or v > 365:
            raise ValueError("expires_in_days must be between 1 and 365")
        return v

    @model_validator(mode="after")
    def salary_range_valid(self):
        if self.salary_max > 0 and self.salary_min > self.salary_max:
            raise ValueError("salary_min cannot exceed salary_max")
        return self


class JobPosting(BaseModel):
    id: str
    employer_id: str
    title: str
    description: str = ""
    skills_required: list[str] = []
    salary_min: int = 0
    salary_max: int = 0
    location: str = ""
    remote: bool = False
    active: bool = True
    created_at: Optional[str] = None
    expires_at: Optional[str] = None
    tags: list[Tag] = []

    model_config = {"extra": "ignore"}


class JobPostingUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    skills_required: Optional[list[str]] = None
    salary_min: Optional[int] = None
    salary_max: Optional[int] = None
    location: Optional[str] = None
    remote: Optional[bool] = None
    tag_ids: Optional[list[str]] = None
    required_tag_ids: Optional[list[str]] = None
    preferred_tag_ids: Optional[list[str]] = None
    expires_in_days: Optional[int] = None

    @field_validator("title")
    @classmethod
    def title_not_empty(cls, v: str | None) -> str | None:
        if v is not None and len(v.strip()) == 0:
            raise ValueError("title cannot be empty")
        if v and len(v) > MAX_NAME_LEN:
            raise ValueError(f"title cannot exceed {MAX_NAME_LEN} characters")
        return v

    @field_validator("salary_min", "salary_max")
    @classmethod
    def salary_non_negative(cls, v: int | None) -> int | None:
        if v is not None and v < 0:
            raise ValueError("salary cannot be negative")
        return v

    @field_validator("expires_in_days")
    @classmethod
    def expires_in_days_valid(cls, v: int | None) -> int | None:
        if v is not None and (v < 1 or v > 365):
            raise ValueError("expires_in_days must be between 1 and 365")
        return v


class JobPostingWithStats(BaseModel):
    id: str
    employer_id: str
    title: str
    description: str = ""
    skills_required: list[str] = []
    salary_min: int = 0
    salary_max: int = 0
    location: str = ""
    remote: bool = False
    active: bool = True
    created_at: Optional[str] = None
    expires_at: Optional[str] = None
    tags: list[Tag] = []
    swipe_count: int = 0
    like_count: int = 0
    match_count: int = 0

    model_config = {"extra": "ignore"}


class MatchScore(BaseModel):
    matched: int = 0
    total: int = 0
    percentage: int = 0


class EmployerCard(BaseModel):
    """Job posting as shown in the worker feed."""
    id: str
    job_title: str
    description: str = ""
    skills_required: list[str] = []
    salary_min: int = 0
    salary_max: int = 0
    location: str = ""
    remote: bool = False
    company_name: str = ""
    industry: str = ""
    avatar_url: Optional[str] = None
    tags: list[Tag] = []
    match_score: Optional[MatchScore] = None

    model_config = {"extra": "ignore"}
