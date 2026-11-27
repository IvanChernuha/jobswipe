"""Comeet import, the pure parts (OpenProject #3297; plan docs/worklog/comeet-import.md).

Employers paste their Comeet company UID + Token once; we read their published
jobs through Comeet's official Careers API. The fixture is a real response from
Comeet's public sandbox company ("Careers API Sandbox", 2026-11-26).
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import httpx
import pytest

from app.services.comeet import (
    ComeetError, fetch_positions, html_to_text, parse_credentials, position_to_job,
)

POSITIONS = json.loads((Path(__file__).parent / "fixtures" / "comeet_positions.json").read_text())
ANDROID = POSITIONS[0]
SANDBOX_TOKEN = "5E7236A0BCE5E7295111B55E70BCE"


# --- one paste: the UID and the Token, however they were copied ---------------

@pytest.mark.parametrize("text", [
    f"UID: E5.007\nToken: {SANDBOX_TOKEN}",
    f"uid E5.007   token {SANDBOX_TOKEN}",
    f"E5.007\n{SANDBOX_TOKEN}",
    f"{SANDBOX_TOKEN} E5.007",
    f"  Company UID = E5.007 , Token = {SANDBOX_TOKEN}  ",
    f"https://www.comeet.co/careers-api/2.0/company/E5.007/positions?token={SANDBOX_TOKEN}&details=true",
])
def test_reads_the_uid_and_token_from_one_paste(text):
    assert parse_credentials(text) == ("E5.007", SANDBOX_TOKEN)


@pytest.mark.parametrize("text", ["", "hello", "E5.007", SANDBOX_TOKEN, "UID: E5.007 Token:"])
def test_a_paste_without_both_is_refused(text):
    assert parse_credentials(text) is None


# --- Comeet's HTML -> readable text ------------------------------------------

def test_html_becomes_plain_text_with_bullets():
    text = html_to_text("<p><strong>What you'll do:</strong></p><ul><li>Build apps</li><li>Fix bugs &amp; test</li></ul>")
    assert text == "What you'll do:\n• Build apps\n• Fix bugs & test"


def test_empty_html_is_empty_text():
    assert html_to_text(None) == ""
    assert html_to_text("<p> </p>") == ""


# --- a Comeet position -> a JobSwipe job --------------------------------------

def test_a_position_becomes_a_job():
    job = position_to_job(ANDROID)
    assert job["title"] == "Android Developer"
    assert job["source_id"] == "E8.91F"
    assert job["source_url"] == "https://www.comeet.com/jobs/careersapi-sandbox/E5.007/android-developer/E8.91F"
    assert job["source_updated_at"] == datetime(2020, 10, 8, 16, 19, 6, tzinfo=timezone.utc)
    assert job["location"] == "Brooklyn, US"     # outside Israel: city + country
    assert job["remote"] is False                # On-site
    assert job["min_experience_years"] == 0      # Entry-level
    assert job["description"].startswith("What you'll be doing:\n• Develops different layers of Android apps")
    assert "Helpful Skills & Experience" in job["description"]
    # The AI gets everything that helps it pick skills.
    for part in ("Android Developer", "Engineering", "Full-time", "Entry-level", "Java"):
        assert part in job["ai_text"]


def test_israeli_jobs_show_just_the_city_and_hybrid_counts_as_remote():
    job = position_to_job({**ANDROID, "location": {"city": "Tel Aviv-Yafo", "country": "IL"},
                           "workplace_type": "Hybrid", "experience_level": "Senior"})
    assert job["location"] == "Tel Aviv-Yafo"
    assert job["remote"] is True
    assert job["min_experience_years"] == 5


def test_missing_fields_do_not_break_it():
    job = position_to_job({"uid": "X1.ABC", "name": "Tester"})
    assert job["title"] == "Tester"
    assert job["location"] == ""
    assert job["description"] == ""
    assert job["min_experience_years"] is None
    assert job["source_updated_at"] is None


# --- calling Comeet ------------------------------------------------------------

def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_fetches_published_positions_with_details():
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        return httpx.Response(200, json=POSITIONS)

    async with _client(handler) as client:
        positions = await fetch_positions("E5.007", SANDBOX_TOKEN, client=client)
    assert [p["name"] for p in positions] == ["Android Developer", "Machine Learning Engineer", "Marketing Manager"]
    assert seen["url"].startswith("https://www.comeet.co/careers-api/2.0/company/E5.007/positions?")
    assert "details=true" in seen["url"] and f"token={SANDBOX_TOKEN}" in seen["url"]


@pytest.mark.asyncio
async def test_wrong_credentials_say_so():
    def handler(request):
        return httpx.Response(400, json={"status": 400, "message": "Account uid or token are not valid"})

    async with _client(handler) as client:
        with pytest.raises(ComeetError, match="UID or Token"):
            await fetch_positions("E5.007", "WRONG", client=client)


@pytest.mark.asyncio
async def test_comeet_being_down_says_try_later():
    def handler(request):
        raise httpx.ConnectError("down")

    async with _client(handler) as client:
        with pytest.raises(ComeetError, match="try again"):
            await fetch_positions("E5.007", SANDBOX_TOKEN, client=client)
