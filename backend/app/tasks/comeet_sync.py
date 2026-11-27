"""Daily Comeet sync, run on its own schedule like digest.py (no Celery beat here):

    docker compose exec -T backend python -m app.tasks.comeet_sync

On Oracle: a host cron line, e.g. `30 4 * * * cd ~/jobswipe && docker compose
exec -T backend python -m app.tasks.comeet_sync`. Opening Jobs a day after the
last sync also syncs, so this mainly keeps closed Comeet jobs from staying
live when the employer doesn't open JobSwipe. OpenProject #3297.
"""
import asyncio
import logging

from app.db.session import _get_async_sessionmaker
from app.services.ats_sync import sync_all

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    async with _get_async_sessionmaker()() as session:
        done = await sync_all(session)
    logger.info("comeet_sync: synced %d connection(s)", done)


if __name__ == "__main__":
    asyncio.run(main())
