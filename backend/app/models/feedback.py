from typing import Literal

from pydantic import BaseModel, Field, field_validator

MAX_FEEDBACK = 5000


class FeedbackCreate(BaseModel):
    rating: int = Field(ge=1, le=5)
    message: str = ""
    platform: Literal["android", "ios", "web"] = "android"
    app_version: str = Field(default="", max_length=32)

    @field_validator("message")
    @classmethod
    def trimmed(cls, v: str) -> str:
        v = v.strip()
        if len(v) > MAX_FEEDBACK:
            raise ValueError(f"message cannot exceed {MAX_FEEDBACK} characters")
        return v
