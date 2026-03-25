from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from app.routers import auth, workers, employers, swipes, matches, uploads, tags, messages, organizations, bookmarks, gdpr, reports, cv
from app.db.client import get_client

limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="JobSwipe API", version="0.1.0")

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — tighten in production (replace * with your domain)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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


@app.on_event("startup")
async def ensure_storage_buckets():
    """Create required storage buckets if they don't exist."""
    db = get_client()
    existing = {b.name for b in db.storage.list_buckets()}
    if "avatars" not in existing:
        db.storage.create_bucket("avatars", options={"public": True})
    if "resumes" not in existing:
        db.storage.create_bucket("resumes", options={"public": False})


@app.get("/health")
async def health():
    return {"status": "ok"}
