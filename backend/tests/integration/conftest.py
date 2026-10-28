"""Fixtures for tests that need a real Postgres.

The schema is built from the SQLModel tables (not the Supabase migrations), in
a throwaway database that scripts/test.sh starts. Every test gets empty tables.

TEST_DATABASE_URL must point at that database, e.g.
    postgresql+asyncpg://postgres:test@jobswipe-test-db:5432/test
Without it these tests are skipped, unless REQUIRE_DB_TESTS=1 (CI and the
deploy script), in which case a missing database is an error.
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import Enum as SAEnum, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool
from sqlmodel import SQLModel

import app.models.tables  # noqa: F401 (registers every table on SQLModel.metadata)
from app.models.tables import (
    EmployerProfile, JobPosting, JobPostingTag, Tag, TagImplication, User, WorkerProfile, WorkerTag,
)

DB_URL = os.environ.get("TEST_DATABASE_URL", "")


def pytest_collection_modifyitems(config, items):
    if DB_URL:
        return
    if os.environ.get("REQUIRE_DB_TESTS") == "1":
        raise pytest.UsageError("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set")
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL not set (run scripts/test.sh)")
    for item in items:
        if "integration" in str(item.fspath):
            item.add_marker(skip)


def _enum_types() -> dict[str, list[str]]:
    types: dict[str, list[str]] = {}
    for table in SQLModel.metadata.sorted_tables:
        for col in table.columns:
            if isinstance(col.type, SAEnum) and col.type.name:
                types[col.type.name] = list(col.type.enums)
    return types


@pytest_asyncio.fixture
async def session():
    # NullPool + a fresh engine per test: asyncpg connections are tied to the
    # event loop, and pytest-asyncio gives each test its own loop.
    engine = create_async_engine(DB_URL, poolclass=NullPool)
    async with engine.begin() as conn:
        # The models declare their enums with create_type=False (the Supabase
        # migrations own them), so create_all would not; create them here.
        for name, labels in _enum_types().items():
            values = ", ".join("'" + v.replace("'", "''") + "'" for v in labels)
            await conn.execute(text(
                f"DO $$ BEGIN CREATE TYPE {name} AS ENUM ({values}); "
                f"EXCEPTION WHEN duplicate_object THEN NULL; END $$"
            ))
        await conn.run_sync(SQLModel.metadata.create_all)
        tables = ", ".join(f'"{t.name}"' for t in SQLModel.metadata.sorted_tables)
        await conn.execute(text(f"TRUNCATE {tables} CASCADE"))
    async with AsyncSession(engine, expire_on_commit=False) as s:
        yield s
    await engine.dispose()


class World:
    """Small builder for feed scenarios: users, profiles, tags, jobs."""

    def __init__(self, session: AsyncSession):
        self.s = session
        self.tags: dict[str, uuid.UUID] = {}

    async def tag(self, name: str, category: str = "language") -> uuid.UUID:
        if name not in self.tags:
            t = Tag(id=uuid.uuid4(), name=name, category=category)
            self.s.add(t)
            # Flush now: there are no ORM relationships, so the unit of work
            # won't order this INSERT before rows that reference the tag.
            await self.s.flush()
            self.tags[name] = t.id
        return self.tags[name]

    async def implies(self, parent: str, implied: str) -> None:
        self.s.add(TagImplication(parent_tag_id=await self.tag(parent), implied_tag_id=await self.tag(implied)))

    async def user(self, role: str, **user_kw) -> uuid.UUID:
        uid = uuid.uuid4()
        self.s.add(User(id=uid, email=f"{uid.hex[:8]}@test.invalid", role=role, **user_kw))
        return uid

    async def worker(self, tags: list[str] = (), name: str = "Worker", **profile_kw) -> uuid.UUID:
        uid = await self.user("worker")
        await self.s.flush()
        self.s.add(WorkerProfile(user_id=uid, name=name, **profile_kw))
        for t in tags:
            self.s.add(WorkerTag(worker_id=uid, tag_id=await self.tag(t)))
        return uid

    async def employer(self, company: str = "Startup", **user_kw) -> uuid.UUID:
        uid = await self.user("employer", **user_kw)
        await self.s.flush()
        self.s.add(EmployerProfile(user_id=uid, company_name=company))
        return uid

    async def job(
        self,
        employer_id: uuid.UUID,
        required: list[str] = (),
        preferred: list[str] = (),
        nice: list[str] = (),
        title: str = "Job",
        active: bool = True,
        expires_in_days: int = 30,
        **job_kw,
    ) -> uuid.UUID:
        jid = uuid.uuid4()
        now = datetime.now(timezone.utc)
        await self.s.flush()
        self.s.add(JobPosting(
            id=jid, employer_id=employer_id, title=title, active=active,
            created_at=now, updated_at=now, expires_at=now + timedelta(days=expires_in_days), **job_kw,
        ))
        await self.s.flush()
        for level, names in (("required", required), ("preferred", preferred), ("nice", nice)):
            for t in names:
                self.s.add(JobPostingTag(job_posting_id=jid, tag_id=await self.tag(t), requirement=level))
        return jid

    async def commit(self) -> None:
        await self.s.commit()


@pytest_asyncio.fixture
async def world(session):
    return World(session)
