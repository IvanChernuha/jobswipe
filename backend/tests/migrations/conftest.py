"""Migration tests: apply the real supabase/migrations files, in order, to a
fresh database (one per test) inside the throwaway test Postgres.

Uses TEST_DATABASE_URL like tests/integration (skipped without it unless
REQUIRE_DB_TESTS=1). The image must have pgvector (001 creates `vector`).
"""
import os
import re
import uuid
from pathlib import Path

import asyncpg
import pytest
import pytest_asyncio

# scripts/test.sh mounts supabase/migrations here; the backend image only has backend/.
MIGRATIONS = Path(os.environ.get("MIGRATIONS_DIR", "/supabase/migrations"))
STUB = Path(__file__).with_name("supabase_stub.sql")
DB_URL = os.environ.get("TEST_DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")


def pytest_collection_modifyitems(config, items):
    if DB_URL:
        return
    if os.environ.get("REQUIRE_DB_TESTS") == "1":
        raise pytest.UsageError("REQUIRE_DB_TESTS=1 but TEST_DATABASE_URL is not set")
    skip = pytest.mark.skip(reason="TEST_DATABASE_URL not set (run scripts/test.sh)")
    for item in items:
        if "migrations" in str(item.fspath):
            item.add_marker(skip)


def migration_files(upto: str | None = None, start: str | None = None) -> list[Path]:
    """Migration files in order, by their numeric prefix (001, 002, ...)."""
    files = sorted(MIGRATIONS.glob("*.sql"))
    assert files, f"no migrations found in {MIGRATIONS}"
    num = lambda p: re.match(r"(\d+)", p.name).group(1)  # noqa: E731
    return [p for p in files if (upto is None or num(p) <= upto) and (start is None or num(p) >= start)]


async def apply(conn: asyncpg.Connection, files: list[Path]) -> None:
    for f in files:
        try:
            await conn.execute(f.read_text())
        except Exception as e:  # name the file that broke
            raise AssertionError(f"{f.name} failed: {e}") from e


@pytest_asyncio.fixture
async def db():
    """A brand-new database with the Supabase stub applied; dropped afterwards."""
    name = f"mig_{uuid.uuid4().hex[:12]}"
    admin = await asyncpg.connect(DB_URL)
    await admin.execute(f'CREATE DATABASE "{name}"')
    conn = await asyncpg.connect(DB_URL.rsplit("/", 1)[0] + f"/{name}")
    await conn.execute(STUB.read_text())
    try:
        yield conn
    finally:
        await conn.close()
        await admin.execute(f'DROP DATABASE "{name}" WITH (FORCE)')
        await admin.close()
