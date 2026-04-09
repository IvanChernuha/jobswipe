"""Alembic migration environment for JobSwipe.

Alembic runs with a SYNC driver even though the FastAPI app runs async —
this is standard and recommended (async driver in env.py is fragile and
offers no benefit during offline schema generation).

The async `postgresql+asyncpg://...` URL from app config is rewritten here
to the sync `postgresql://...` form for migration execution.
"""
from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from app.config import settings

# Import every SQLModel module here so SQLModel.metadata is populated before
# autogenerate runs. Models will be added in Phase 2 of the refactor.
# Example (uncomment as models are converted):
#
#   from app.models import organization  # noqa: F401
#   from app.models import worker        # noqa: F401
#   from app.models import employer      # noqa: F401
#   ...

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ---------------------------------------------------------------------------
# Resolve the database URL from runtime settings (single source of truth).
# alembic.ini intentionally leaves sqlalchemy.url empty.
# ---------------------------------------------------------------------------
db_url = settings.DATABASE_URL
if not db_url:
    raise RuntimeError(
        "DATABASE_URL is not set — Alembic requires it to run migrations. "
        "Configure it in .env as postgresql+asyncpg://user:pass@host:5432/dbname"
    )
sync_url = db_url.replace("postgresql+asyncpg://", "postgresql://", 1)
config.set_main_option("sqlalchemy.url", sync_url)

target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emits SQL without a DB connection."""
    context.configure(
        url=sync_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode — connects to the DB and applies changes."""
    configuration = config.get_section(config.config_ini_section) or {}
    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
