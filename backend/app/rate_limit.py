from fastapi import Request
from jose import JWTError, jwt
from slowapi import Limiter
from slowapi.util import get_remote_address

from app.config import settings

# Shared rate limiter used by main.py (handler registration) and by every
# router that applies @limiter.limit(...).
#
# Redis-backed on purpose: the API runs behind an HPA (2-10 pods), so an
# in-memory limiter would keep separate counters per pod — a per-IP limit of N
# would effectively become N*replicas and a login lockout would not hold across
# pods. A shared Redis store makes the limits real cluster-wide.
#
# get_remote_address reads request.client.host; uvicorn must run with
# --proxy-headers --forwarded-allow-ips=* (see Dockerfile) so that host is the
# real client from X-Forwarded-For rather than the ingress/pod IP.
limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=settings.RATELIMIT_STORAGE_URL,
)


def user_or_ip(request: Request) -> str:
    """Rate-limit key for authenticated routes: the user id, else the client IP.

    Keying on the user (not the IP) means an office or campus NAT does not
    throttle everyone behind it. The JWT signature is verified with the same
    secret deps.get_current_user uses, so a forged `sub` cannot dodge a limit
    — an invalid token simply falls back to the IP key and then gets a 401
    from the auth dependency anyway. No DB hit: this runs on every request.
    """
    auth = request.headers.get("authorization", "")
    if auth[:7].lower() == "bearer " and settings.SUPABASE_JWT_SECRET:
        try:
            payload = jwt.decode(
                auth[7:],
                settings.SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except JWTError:
            pass
    return get_remote_address(request)
