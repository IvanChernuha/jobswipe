"""Unit tests for the Phase-1 abuse controls: per-user rate-limit key,
per-account login lockout, and the per-account LLM quota.

Redis is replaced with a tiny in-memory stub so these run without services.
"""
import asyncio

import pytest
from fastapi import HTTPException
from jose import jwt
from starlette.requests import Request

import app.db.redis as redis_mod
from app.config import settings
from app.rate_limit import user_or_ip
from app.services import login_guard, llm_quota


class FakeRedis:
    def __init__(self):
        self.store: dict[str, int] = {}

    async def get(self, key):
        v = self.store.get(key)
        return None if v is None else str(v)

    async def incr(self, key):
        return await self.incrby(key, 1)

    async def incrby(self, key, n):
        self.store[key] = int(self.store.get(key, 0)) + n
        return self.store[key]

    async def decrby(self, key, n):
        self.store[key] = int(self.store.get(key, 0)) - n
        return self.store[key]

    async def expire(self, key, ttl):
        return True

    async def delete(self, key):
        self.store.pop(key, None)
        return 1


@pytest.fixture
def fake_redis(monkeypatch):
    fr = FakeRedis()
    monkeypatch.setattr(redis_mod, "_client", fr)
    return fr


def _request(headers: dict | None = None, ip: str = "203.0.113.7") -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (ip, 1234),
    }
    return Request(scope)


def _token(sub: str, secret: str | None = None) -> str:
    return jwt.encode(
        {"sub": sub, "aud": "authenticated"},
        secret or settings.SUPABASE_JWT_SECRET,
        algorithm="HS256",
    )


class TestUserOrIpKey:
    def test_valid_token_keys_on_user(self):
        req = _request({"Authorization": f"Bearer {_token('user-123')}"})
        assert user_or_ip(req) == "user:user-123"

    def test_no_token_falls_back_to_ip(self):
        assert user_or_ip(_request(ip="198.51.100.9")) == "198.51.100.9"

    def test_forged_token_falls_back_to_ip(self):
        # Signed with the wrong secret -> signature check fails -> IP key.
        req = _request({"Authorization": f"Bearer {_token('victim', secret='not-the-secret')}"}, ip="198.51.100.9")
        assert user_or_ip(req) == "198.51.100.9"

    def test_garbage_header_falls_back_to_ip(self):
        req = _request({"Authorization": "Bearer nonsense"}, ip="198.51.100.9")
        assert user_or_ip(req) == "198.51.100.9"


class TestLoginGuard:
    def test_locks_after_max_failures_and_clears(self, fake_redis, monkeypatch):
        monkeypatch.setattr(settings, "LOGIN_MAX_FAILURES", 3)
        email = "Person@Example.com"

        async def run():
            for _ in range(2):
                await login_guard.record_failure(email)
            await login_guard.assert_not_locked(email)  # 2 < 3 -> still allowed

            await login_guard.record_failure(email)
            with pytest.raises(HTTPException) as exc:
                await login_guard.assert_not_locked(" person@example.com ")  # normalised key
            assert exc.value.status_code == 429

            await login_guard.clear_failures(email)
            await login_guard.assert_not_locked(email)

        asyncio.run(run())

    def test_fails_open_when_redis_down(self, monkeypatch):
        class Broken:
            async def get(self, *_):
                raise ConnectionError("redis down")

        monkeypatch.setattr(redis_mod, "_client", Broken())
        asyncio.run(login_guard.assert_not_locked("a@b.c"))  # must not raise


class TestLlmQuota:
    def test_consumes_up_to_limit_then_rejects_and_refunds(self, fake_redis, monkeypatch):
        monkeypatch.setattr(settings, "LLM_DAILY_UNITS_PER_ACCOUNT", 5)
        uid = "emp-1"

        async def run():
            await llm_quota.consume_llm_units(uid, 3)
            with pytest.raises(HTTPException) as exc:
                await llm_quota.consume_llm_units(uid, 3)  # 6 > 5
            assert exc.value.status_code == 429
            # Refunded: 3 used, so 2 more still fit exactly.
            await llm_quota.consume_llm_units(uid, 2)
            with pytest.raises(HTTPException):
                await llm_quota.consume_llm_units(uid, 1)

        asyncio.run(run())
        assert fake_redis.store[llm_quota._key(uid)] == 5

    def test_zero_units_is_noop(self, fake_redis):
        asyncio.run(llm_quota.consume_llm_units("emp-2", 0))
        assert fake_redis.store == {}

    def test_quota_is_per_account(self, fake_redis, monkeypatch):
        monkeypatch.setattr(settings, "LLM_DAILY_UNITS_PER_ACCOUNT", 2)

        async def run():
            await llm_quota.consume_llm_units("a", 2)
            await llm_quota.consume_llm_units("b", 2)  # independent budget

        asyncio.run(run())
