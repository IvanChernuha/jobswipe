from pydantic import BaseModel, field_validator

MIN_JOB_TEXT = 20
MAX_JOB_TEXT = 20000


class ParseJobTextRequest(BaseModel):
    """A job posting typed or pasted into the form, for the AI to read."""
    text: str

    @field_validator("text")
    @classmethod
    def enough_text(cls, v: str) -> str:
        v = v.strip()
        if len(v) < MIN_JOB_TEXT:
            raise ValueError(f"write at least {MIN_JOB_TEXT} characters about the job first")
        if len(v) > MAX_JOB_TEXT:
            raise ValueError(f"text cannot exceed {MAX_JOB_TEXT} characters")
        return v
