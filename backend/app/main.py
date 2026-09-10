from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.observability import init_observability
from app.rate_limit import limiter
from app.routers import auth, workers, employers, swipes, matches, uploads, tags, messages, organizations, bookmarks, gdpr, reports, cv, blocks, admin
from app.db.client import get_supabase_client
from app.db.engine import dispose_engine
from app.db.redis import close_redis

# Initialise logging + Sentry as early as possible — before the app and its
# routers are built — so import/startup errors are captured too.
init_observability()

app = FastAPI(title="JobSwipe API", version="0.1.0")

# Rate limiting. The limiter is defined in app/rate_limit.py (Redis-backed) so
# routers can share it and the limits hold across all pods behind the HPA.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS. Set CORS_ORIGINS to your real domain(s) in production; "*" is dev-only.
_cors_origins = (
    ["*"]
    if settings.CORS_ORIGINS.strip() == "*"
    else [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(auth.router, prefix="/api")
app.include_router(workers.router, prefix="/api")
app.include_router(employers.router, prefix="/api")
app.include_router(swipes.router, prefix="/api")
app.include_router(matches.router, prefix="/api")
app.include_router(uploads.router, prefix="/api")
app.include_router(tags.router, prefix="/api")
app.include_router(messages.router, prefix="/api")
app.include_router(organizations.router, prefix="/api")
app.include_router(bookmarks.router, prefix="/api")
app.include_router(gdpr.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(cv.router, prefix="/api")
app.include_router(blocks.router, prefix="/api")
app.include_router(admin.router, prefix="/api")


@app.on_event("startup")
async def ensure_storage_buckets():
    """Create required storage buckets if they don't exist."""
    sb = get_supabase_client()
    existing = {b.name for b in sb.storage.list_buckets()}
    if "avatars" not in existing:
        sb.storage.create_bucket("avatars", options={"public": True})
    if "resumes" not in existing:
        sb.storage.create_bucket("resumes", options={"public": False})


@app.on_event("shutdown")
async def shutdown():
    """Release database connection pool and the app Redis client."""
    await dispose_engine()
    await close_redis()


@app.get("/health")
async def health():
    return {"status": "ok"}
