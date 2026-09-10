"""Unit tests for Phase-2 trust & safety pieces that need no DB or network:
content filter, request-model validators, image-moderation mode resolution,
and the admin allowlist.
"""
import asyncio

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.config import settings
from app.deps import require_admin
from app.models.employer import JobPostingCreate
from app.models.message import MessageCreate
from app.models.worker import WorkerProfileUpdate
from app.services import content_filter, image_moderation


class TestContentFilter:
    def test_clean_text_passes(self):
        for text in [
            "Senior Python engineer, 8 years, FastAPI + PostgreSQL",
            "Class of 2019; assistant manager at Assassin's Games Ltd",  # substrings only
            "Summa cum laude, MSc",
            "",
        ]:
            assert content_filter.find_prohibited(text) is None, text

    def test_token_and_squeezed_matches(self):
        assert content_filter.find_prohibited("what a RETARD") == "retard"
        assert content_filter.find_prohibited("just kys already") == "kys"       # token
        assert content_filter.find_prohibited("k.y.s") is None                  # 3-letter terms: token-only by design
        assert content_filter.find_prohibited("kill   your self") == "killyourself"  # squeezed
        assert content_filter.find_prohibited("héil hìtler") == "heilhitler"    # accents
        assert content_filter.find_prohibited("r3t4rd") == "retard"             # leet

    def test_extra_terms_from_settings(self, monkeypatch):
        monkeypatch.setattr(settings, "CONTENT_DENYLIST_EXTRA", "zorblax, ")
        content_filter._terms.cache_clear()
        try:
            assert content_filter.find_prohibited("hello Zorblax") == "zorblax"
        finally:
            content_filter._terms.cache_clear()

    def test_sanitize_drops_dirty_keeps_clean(self):
        assert content_filter.sanitize("Jane Doe") == "Jane Doe"
        assert content_filter.sanitize("Jane kys Doe") is None
        assert content_filter.sanitize(None) is None


class TestValidators:
    def test_message_rejected(self):
        with pytest.raises(ValidationError):
            MessageCreate(body="you absolute retard")
        assert MessageCreate(body="  hello  ").body == "hello"

    def test_profile_and_job_rejected(self):
        with pytest.raises(ValidationError):
            WorkerProfileUpdate(bio="kill yourself")
        with pytest.raises(ValidationError):
            JobPostingCreate(title="Hiring", description="no fags please")
        assert JobPostingCreate(title="Hiring", description="Python dev").title == "Hiring"


class TestImageModerationMode:
    def test_auto_follows_api_key(self, monkeypatch):
        monkeypatch.setattr(settings, "IMAGE_MODERATION", "auto")
        monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
        assert image_moderation.resolve_mode() == "block"
        monkeypatch.setattr(settings, "GEMINI_API_KEY", "k")
        assert image_moderation.resolve_mode() == "gemini"

    def test_block_and_off(self, monkeypatch):
        monkeypatch.setattr(settings, "IMAGE_MODERATION", "block")
        with pytest.raises(HTTPException) as exc:
            asyncio.run(image_moderation.check_image(b"x", "image/png"))
        assert exc.value.status_code == 503
        monkeypatch.setattr(settings, "IMAGE_MODERATION", "off")
        asyncio.run(image_moderation.check_image(b"x", "image/png"))  # no-op


class TestAdminAllowlist:
    def test_deny_all_when_unset(self, monkeypatch):
        monkeypatch.setattr(settings, "ADMIN_EMAILS", "")
        with pytest.raises(HTTPException) as exc:
            asyncio.run(require_admin({"email": "a@b.c"}))
        assert exc.value.status_code == 403

    def test_allowlisted_case_insensitive(self, monkeypatch):
        monkeypatch.setattr(settings, "ADMIN_EMAILS", "Founder@Example.com, ops@example.com")
        assert asyncio.run(require_admin({"email": "founder@example.com"}))["email"] == "founder@example.com"
        with pytest.raises(HTTPException):
            asyncio.run(require_admin({"email": "intruder@example.com"}))
