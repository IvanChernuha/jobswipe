"""Async SQLAlchemy engine for SQLModel.

Part of the Supabase -> SQLModel refactor (OpenProject #571).

Lazy-initialized so the FastAPI app can start during early refactor phases
where DATABASE_URL may not yet be configured. The engine is only built on
first call to `get_engine()` — until routers actually use it, nothing
touches a live Postgres connection here.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.config import settings

_engine: AsyncEngine | None = None


def get_engine() -> AsyncEngine:
    """Return the lazily-initialized async engine.

    Raises:
        RuntimeError: if DATABASE_URL is not configured in the environment.
    """
    global _engine
    if _engine is None:
        if not settings.DATABASE_URL:
            raise RuntimeError(
                "DATABASE_URL is not set. Configure it in .env as "
                "postgresql+asyncpg://user:pass@host:5432/dbname to use SQLModel."
            )
        _engine = create_async_engine(
            settings.DATABASE_URL,
            echo=False,
            pool_size=20,
            max_overflow=40,
            pool_pre_ping=True,
        )
    return _engine


async def dispose_engine() -> None:
    """Dispose the engine. Call on FastAPI shutdown to release pool connections."""
    global _engine
    if _engine is not None:
        await _engine.dispose()
        _engine = None
