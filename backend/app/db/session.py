"""Session factories for SQLModel — async (FastAPI) and sync (Celery).

Async usage (routers):
    from app.db.session import get_session
    async def endpoint(session: AsyncSession = Depends(get_session)):
        ...

Sync usage (Celery tasks):
    from app.db.session import get_sync_session
    with get_sync_session() as session:
        session.execute(...)
        session.commit()
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import AsyncIterator, Iterator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings
from app.db.engine import get_engine

# ── Async (FastAPI) ──────────────────────────────────────────────────────────

_async_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _get_async_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _async_sessionmaker
    if _async_sessionmaker is None:
        _async_sessionmaker = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )
    return _async_sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency that yields an AsyncSession."""
    async with _get_async_sessionmaker()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


# ── Sync (Celery) ────────────────────────────────────────────────────────────

_sync_engine = None
_sync_sessionmaker: sessionmaker | None = None


def _get_sync_sessionmaker() -> sessionmaker:
    global _sync_engine, _sync_sessionmaker
    if _sync_sessionmaker is None:
        if not settings.DATABASE_URL:
            raise RuntimeError("DATABASE_URL is not set")
        sync_url = settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)
        _sync_engine = create_engine(sync_url, pool_size=5, max_overflow=10, pool_pre_ping=True)
        _sync_sessionmaker = sessionmaker(bind=_sync_engine, expire_on_commit=False)
    return _sync_sessionmaker


@contextmanager
def get_sync_session() -> Iterator[Session]:
    """Context manager that yields a sync Session for Celery tasks."""
    session = _get_sync_sessionmaker()()
    try:
        yield session
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
