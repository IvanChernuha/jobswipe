"""Async session factory and FastAPI dependency for SQLModel.

Usage in a router (after Phase 4 of the refactor):

    from fastapi import Depends
    from sqlmodel.ext.asyncio.session import AsyncSession
    from app.db.session import get_session

    @router.get("/things")
    async def list_things(session: AsyncSession = Depends(get_session)):
        result = await session.exec(select(Thing))
        return result.all()

Handlers are responsible for calling `await session.commit()` themselves.
The dependency only rolls back on unhandled exceptions.
"""
from __future__ import annotations

from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.db.engine import get_engine

_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
        )
    return _sessionmaker


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency that yields an AsyncSession.

    Commits are explicit — handlers call `await session.commit()` themselves.
    Rolls back and re-raises on any unhandled exception.
    """
    async with _get_sessionmaker()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
