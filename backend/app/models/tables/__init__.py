"""SQLModel table definitions — import all so Alembic sees them."""

from app.models.tables.user import User
from app.models.tables.worker import WorkerProfile, WorkerTag
from app.models.tables.employer import EmployerProfile
from app.models.tables.tag import Tag, TagImplication
from app.models.tables.job import JobPosting, JobPostingTag
from app.models.tables.swipe import Swipe
from app.models.tables.match import Match
from app.models.tables.message import Message, MessageReadCursor
from app.models.tables.bookmark import Bookmark
from app.models.tables.organization import Organization, OrgMember, OrgInvite
from app.models.tables.report import Report

__all__ = [
    "User",
    "WorkerProfile", "WorkerTag",
    "EmployerProfile",
    "Tag", "TagImplication",
    "JobPosting", "JobPostingTag",
    "Swipe",
    "Match",
    "Message", "MessageReadCursor",
    "Bookmark",
    "Organization", "OrgMember", "OrgInvite",
    "Report",
]
