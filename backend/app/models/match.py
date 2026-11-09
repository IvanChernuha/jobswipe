from pydantic import BaseModel
from typing import Optional


class MatchEmployer(BaseModel):
    company_name: str = ""
    industry: str = ""
    avatar_url: Optional[str] = None
    job_title: str = ""
    location: str = ""
    # Full job (GET /matches/{id} only): what the worker matched for.
    company_description: str = ""
    description: str = ""
    salary_min: int = 0
    salary_max: int = 0
    remote: bool = False
    tags: list[dict] = []


class MatchWorker(BaseModel):
    name: str = ""
    avatar_url: Optional[str] = None
    skills: list[str] = []
    experience_years: int = 0
    # Full profile (GET /matches/{id} only). The CV itself: GET /matches/{id}/resume.
    bio: str = ""
    location: str = ""
    tags: list[dict] = []
    has_resume: bool = False


class MatchResponse(BaseModel):
    id: str
    worker_id: str
    employer_id: str
    job_posting_id: Optional[str] = None
    matched_at: str
    status: str
    employer: Optional[MatchEmployer] = None
    worker: Optional[MatchWorker] = None
    contact_email: Optional[str] = None

    model_config = {"extra": "ignore"}


class MoveMatchRequest(BaseModel):
    """Employer: put a match under another of the team's jobs."""
    job_posting_id: str
