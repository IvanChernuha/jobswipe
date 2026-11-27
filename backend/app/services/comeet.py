"""Comeet's official Careers API (OpenProject #3297; docs/worklog/comeet-import.md).

An employer gives us their company UID and Token once (Comeet → Company
Settings → Careers Website). We read their published positions and turn each
into JobSwipe job fields. No scraping: this is the API Comeet provides for it.
"""
import re
from datetime import datetime
from html.parser import HTMLParser

import httpx

API = "https://www.comeet.co/careers-api/2.0"
TIMEOUT_SECONDS = 60  # Comeet's docs: use a 60 s timeout for the positions list

# Experience level → minimum years, used only when the AI doesn't say.
_LEVEL_YEARS = {
    "internship": 0, "entry-level": 0, "entry level": 0, "junior": 0,
    "intermediate": 2, "mid-level": 2, "mid level": 2,
    "senior": 5, "expert": 8, "executive": 8,
}

_UID = re.compile(r"^[A-Za-z0-9]{1,4}\.[A-Za-z0-9]{2,6}$")
_TOKEN = re.compile(r"^[A-Za-z0-9]{16,}$")
_FROM_URL = re.compile(r"/company/([A-Za-z0-9.]+)/positions[^\s]*?[?&]token=([A-Za-z0-9]+)")


class ComeetError(Exception):
    """Something the employer should see, e.g. wrong credentials or Comeet down."""


def parse_credentials(text: str) -> tuple[str, str] | None:
    """(uid, token) from one paste: labelled, two values in any order, or an API URL."""
    text = (text or "").strip()
    m = _FROM_URL.search(text)
    if m:
        return m.group(1), m.group(2)
    words = re.split(r"[\s,;:=]+", text)
    uid = next((w for w in words if _UID.match(w)), None)
    token = next((w for w in words if _TOKEN.match(w) and w.lower() not in {"token", "company"}), None)
    if uid and token:
        return uid, token
    return None


class _TextParser(HTMLParser):
    """Paragraphs and line breaks become new lines, list items become "• " bullets."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self.current = ""

    def _break(self):
        if self.current.strip():
            self.lines.append(" ".join(self.current.split()))
        self.current = ""

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "div", "br", "ul", "ol", "h1", "h2", "h3", "h4", "tr"):
            self._break()
        elif tag == "li":
            self._break()
            self.current = "• "

    def handle_endtag(self, tag):
        if tag in ("p", "div", "li", "ul", "ol", "h1", "h2", "h3", "h4", "tr"):
            self._break()

    def handle_data(self, data):
        self.current += data

    def text(self) -> str:
        self._break()
        return "\n".join(line for line in self.lines if line.strip("• ").strip())


def html_to_text(value: str | None) -> str:
    if not value:
        return ""
    parser = _TextParser()
    parser.feed(value)
    parser.close()
    return parser.text().strip()  # convert_charrefs already decoded &amp; etc.


def _detail(position: dict, name: str) -> str:
    for d in position.get("details") or []:
        if (d.get("name") or "").strip().lower() == name.lower():
            return html_to_text(d.get("value"))
    return ""


def _when(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def position_to_job(position: dict) -> dict:
    """JobSwipe job fields for one Comeet position, plus `ai_text` for the AI to read."""
    location = position.get("location") or {}
    city = (location.get("city") or location.get("name") or "").strip()
    country = (location.get("country") or "").strip()
    place = city if country in ("", "IL") or not city else f"{city}, {country}"
    workplace = (position.get("workplace_type") or "").strip()
    level = (position.get("experience_level") or "").strip()
    description = "\n\n".join(p for p in (_detail(position, "Description"), _detail(position, "Requirements")) if p)
    facts = ", ".join(x for x in (position.get("employment_type"), level, workplace) if x)
    ai_text = "\n".join(x for x in (
        position.get("name"), position.get("department"), place, facts, "", description,
    ) if x is not None)
    return {
        "title": (position.get("name") or "").strip(),
        "description": description,
        "location": place,
        "remote": workplace.lower() in ("remote", "hybrid"),
        "min_experience_years": _LEVEL_YEARS.get(level.lower()),
        "source_id": position.get("uid"),
        "source_url": position.get("url_active_page") or position.get("url_comeet_hosted_page"),
        "source_updated_at": _when(position.get("time_updated")),
        "ai_text": ai_text,
    }


async def fetch_positions(uid: str, token: str, client: httpx.AsyncClient | None = None) -> list[dict]:
    """The company's published positions, with details. Raises ComeetError."""
    url = f"{API}/company/{uid}/positions"
    params = {"token": token, "details": "true"}
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=TIMEOUT_SECONDS)
    try:
        response = await client.get(url, params=params)
    except httpx.HTTPError:
        raise ComeetError("Comeet isn't answering right now. Please try again in a few minutes.")
    finally:
        if own_client:
            await client.aclose()
    if response.status_code in (400, 401, 403, 404):
        raise ComeetError("Comeet didn't accept this UID or Token. Copy both again from Company Settings → Careers Website.")
    if response.status_code >= 300:
        raise ComeetError("Comeet isn't answering right now. Please try again in a few minutes.")
    data = response.json()
    if not isinstance(data, list):
        raise ComeetError("Comeet sent something unexpected. Please try again in a few minutes.")
    return data
