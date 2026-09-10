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
