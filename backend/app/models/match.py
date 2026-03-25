from pydantic import BaseModel
from typing import Optional


class MatchEmployer(BaseModel):
    company_name: str = ""
    industry: str = ""
    avatar_url: Optional[str] = None
    job_title: str = ""
    location: str = ""


class MatchWorker(BaseModel):
    name: str = ""
    avatar_url: Optional[str] = None
    skills: list[str] = []
    experience_years: int = 0


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
