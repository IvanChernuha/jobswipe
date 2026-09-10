"""Shared async Redis client for app-level counters (not the Celery broker).

Used for cheap cross-pod state: login lockout and the per-account LLM quota.
Lives on REDIS_URL; every key is namespaced ("auth:", "llm:") so nothing
collides with other users of that logical DB.
"""
from redis.asyncio import Redis, from_url

from app.config import settings

_client: Redis | None = None


def get_redis() -> Redis:
    global _client
    if _client is None:
        _client = from_url(settings.REDIS_URL, decode_responses=True)
    return _client


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
