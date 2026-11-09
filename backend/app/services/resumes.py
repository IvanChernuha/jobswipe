"""Links to a worker's CV in the private 'resumes' bucket.

The link saved at upload time (worker_profiles.resume_url) is signed for 7
days and then stops working, so anyone opening a CV later gets a fresh one.
"""
from app.db.client import get_supabase_client
from app.services.storage import browser_url

# Long enough to open and read it, short enough that a shared link dies soon.
RESUME_LINK_SECONDS = 15 * 60


def fresh_resume_url(worker_id: str, client=None) -> str | None:
    """A short-lived link to the worker's CV, or None if they never uploaded one."""
    bucket = (client or get_supabase_client()).storage.from_("resumes")
    folder = f"resumes/{worker_id}"
    names = [f.get("name", "") for f in bucket.list(folder) or []]
    cv = next((n for n in names if n.startswith("resume.")), None)
    if not cv:
        return None
    signed = bucket.create_signed_url(f"{folder}/{cv}", RESUME_LINK_SECONDS)
    return browser_url(signed.get("signedURL") or signed.get("signedUrl") or "") or None
