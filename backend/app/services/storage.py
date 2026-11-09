"""Storage links the browser and the app can actually reach."""
from urllib.parse import urlparse

from app.config import settings


def browser_url(url: str) -> str:
    """Storage URLs come back absolute on SUPABASE_URL (a LAN/internal host).

    The browser reaches Supabase through the app's own origin at
    PUBLIC_SUPABASE_PATH, so hand out an origin-relative path that works on the
    LAN, through a tunnel, or on a real domain alike.
    """
    if not url or not settings.PUBLIC_SUPABASE_PATH:
        return url
    p = urlparse(url)
    if not p.netloc:
        return url
    return f"{settings.PUBLIC_SUPABASE_PATH.rstrip('/')}{p.path}" + (f"?{p.query}" if p.query else "")
