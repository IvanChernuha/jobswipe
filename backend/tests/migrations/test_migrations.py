"""Migrations: the whole history applies cleanly, and the profession layer
(015 tag categories, 016 professions) keeps every existing row and moves it to
"Software developer". docs/worklog/profession-layer.md §5.2, M1-M3.
"""
import uuid

import pytest

from .conftest import apply, migration_files

pytestmark = pytest.mark.asyncio


async def seed(conn):
    """A small realistic world on the pre-015 schema: users via the signup
    trigger, worker and job tags from the seeded taxonomy (incl. a soft skill)."""
    worker, employer = uuid.uuid4(), uuid.uuid4()
    await conn.execute(
        "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ($1, 'w@test.com', '{\"role\": \"worker\"}'), "
        "($2, 'e@test.com', '{\"role\": \"employer\"}')",
        worker, employer,
    )
    python = await conn.fetchval("SELECT id FROM tags WHERE name = 'Python'")
    react = await conn.fetchval("SELECT id FROM tags WHERE name = 'React'")
    soft = await conn.fetchval("SELECT id FROM tags WHERE category = 'soft_skill' LIMIT 1")
    await conn.execute("INSERT INTO worker_tags (worker_id, tag_id) VALUES ($1, $2), ($1, $3), ($1, $4)", worker, python, react, soft)
    job = await conn.fetchval(
        "INSERT INTO job_postings (employer_id, title) VALUES ($1, 'Backend dev') RETURNING id", employer,
    )
    await conn.execute(
        "INSERT INTO job_posting_tags (job_posting_id, tag_id, requirement) VALUES ($1, $2, 'required'), ($1, $3, 'nice')",
        job, python, soft,
    )
    return worker, employer, job


async def counts(conn):
    return {t: await conn.fetchval(f"SELECT count(*) FROM {t}") for t in
            ("users", "tags", "worker_tags", "job_postings", "job_posting_tags", "worker_profiles")}


async def test_all_migrations_apply_cleanly(db):
    await apply(db, migration_files())
    tables = {r["tablename"] for r in await db.fetch("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")}
    assert {"users", "tags", "job_postings", "pro_grants", "professions", "profession_tags"} <= tables


async def test_m1_existing_rows_kept_and_moved_to_software_dev(db):
    await apply(db, migration_files(upto="014"))
    worker, _, job = await seed(db)
    before = await counts(db)

    await apply(db, migration_files(start="015"))

    assert await counts(db) == before
    software = await db.fetchval("SELECT id FROM professions WHERE key = 'software_dev'")
    assert software is not None
    assert await db.fetchval("SELECT profession_id FROM worker_profiles WHERE user_id = $1", worker) == software
    assert await db.fetchval("SELECT profession_id FROM job_postings WHERE id = $1", job) == software
    assert await db.fetchval("SELECT count(*) FROM worker_profiles WHERE profession_id IS NULL") == 0
    assert await db.fetchval("SELECT count(*) FROM job_postings WHERE profession_id IS NULL") == 0


async def test_m1_new_jobs_and_profiles_default_to_software_dev(db):
    # The backend doesn't know about professions until step 3, so new rows
    # it creates in between must still get a profession.
    await apply(db, migration_files())
    software = await db.fetchval("SELECT id FROM professions WHERE key = 'software_dev'")
    _, employer, _ = await seed(db)  # signup trigger creates the profiles
    job = await db.fetchval("INSERT INTO job_postings (employer_id, title) VALUES ($1, 'New') RETURNING id", employer)
    assert await db.fetchval("SELECT profession_id FROM job_postings WHERE id = $1", job) == software
    assert await db.fetchval("SELECT count(*) FROM worker_profiles WHERE profession_id IS DISTINCT FROM $1", software) == 0
    row = await db.fetchrow("SELECT pay_type, extra FROM job_postings WHERE id = $1", job)
    assert (row["pay_type"], row["extra"]) == ("monthly", "{}")


async def test_m1_job_profession_is_required(db):
    await apply(db, migration_files())
    _, employer, _ = await seed(db)
    with pytest.raises(Exception, match="null value"):
        await db.execute("INSERT INTO job_postings (employer_id, title, profession_id) VALUES ($1, 'x', NULL)", employer)


async def test_m2_tech_tags_belong_to_software_dev_soft_skills_are_universal(db):
    await apply(db, migration_files())
    software = await db.fetchval("SELECT id FROM professions WHERE key = 'software_dev'")
    unlinked_tech = await db.fetchval(
        "SELECT count(*) FROM tags t WHERE t.category <> 'soft_skill' "
        "AND NOT EXISTS (SELECT 1 FROM profession_tags pt WHERE pt.tag_id = t.id AND pt.profession_id = $1)",
        software,
    )
    linked_soft = await db.fetchval(
        "SELECT count(*) FROM tags t JOIN profession_tags pt ON pt.tag_id = t.id WHERE t.category = 'soft_skill'"
    )
    assert unlinked_tech == 0
    assert linked_soft == 0
    assert await db.fetchval("SELECT count(*) FROM tags") > 250  # the seeded taxonomy is all there


async def test_m2_software_dev_is_the_only_enabled_profession_with_its_fields(db):
    await apply(db, migration_files())
    rows = await db.fetch("SELECT key, enabled, name, pay_type_default, categories, fields FROM professions")
    assert [r["key"] for r in rows] == ["software_dev"]
    p = rows[0]
    assert p["enabled"] is True
    assert p["pay_type_default"] == "monthly"
    assert '"he"' in p["name"] and '"en"' in p["name"]
    assert "language" in p["categories"] and "framework" in p["categories"]
    for key in ("github_url", "portfolio_url", "education", "projects", "army_role", "junior_friendly", "office_days"):
        assert f'"key": "{key}"' in p["fields"]


async def test_m3_new_tag_categories(db):
    await apply(db, migration_files())
    labels = {r["enumlabel"] for r in await db.fetch(
        "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'tag_category_enum'"
    )}
    assert {"spoken_language", "license", "shift"} <= labels


async def test_profession_migrations_can_run_twice(db):
    # They are applied by hand on dev and Oracle; a second run must be harmless.
    await apply(db, migration_files())
    before = await db.fetchval("SELECT count(*) FROM profession_tags")
    await apply(db, migration_files(start="015"))
    assert await db.fetchval("SELECT count(*) FROM professions") == 1
    assert await db.fetchval("SELECT count(*) FROM profession_tags") == before


async def test_every_model_column_exists_in_a_database_built_from_migrations(db):
    # Drift guard: a column added to the dev database by hand (not in a
    # migration file) would pass every other test and only break a fresh
    # server. 2026-11-08: bookmarks.note/expires_at/job_posting_id and
    # job_postings.min_experience_years were exactly that.
    from sqlmodel import SQLModel

    import app.models.tables  # noqa: F401 (registers every table)

    await apply(db, migration_files())
    have = {(r["table_name"], r["column_name"]) for r in await db.fetch(
        "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'"
    )}
    missing = sorted(
        f"{t.name}.{c.name}" for t in SQLModel.metadata.sorted_tables for c in t.columns if (t.name, c.name) not in have
    )
    assert missing == []
