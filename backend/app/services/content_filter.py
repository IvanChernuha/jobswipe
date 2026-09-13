"""Denylist content filter for user-written text (the real #464).

Two passes over a normalised form of the text (lower-case, accents stripped,
common leet substitutions undone):

  1. token match    every letter-run token against the list, so "retard" hits
                    but "class" / "assassin" never do;
  2. squeezed match all non-letters removed, so "k.y.s" / "kill  your self"
                    are caught. Only terms of 5+ letters are checked this way
                    to keep short words from matching inside longer ones.

Terms come from content_denylist.txt plus CONTENT_DENYLIST_EXTRA. Two entry
points: assert_clean() for API input (raises -> 422) and sanitize() for
machine-written fields such as the CV auto-fill, where dropping the value
beats failing the whole job.
"""
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from app.config import settings

_LEET = str.maketrans({
    "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t",
    "@": "a", "$": "s", "!": "i", "|": "i", "+": "t",
})
_NON_LETTER = re.compile(r"[^a-z]+")
_DENYLIST_FILE = Path(__file__).with_name("content_denylist.txt")
_SQUEEZE_MIN_LEN = 5


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return text.lower().translate(_LEET)


@lru_cache(maxsize=1)
def _terms() -> tuple[frozenset[str], tuple[str, ...]]:
    raw: set[str] = set()
    if _DENYLIST_FILE.exists():
        for line in _DENYLIST_FILE.read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if line:
                raw.add(line)
    for extra in settings.CONTENT_DENYLIST_EXTRA.split(","):
        if extra.strip():
            raw.add(extra.strip())
    squeezed = {_NON_LETTER.sub("", normalize(w)) for w in raw}
    squeezed.discard("")
    return frozenset(squeezed), tuple(sorted(w for w in squeezed if len(w) >= _SQUEEZE_MIN_LEN))


def find_prohibited(text: str | None) -> str | None:
    """Return the matched term, or None if the text is clean."""
    if not text:
        return None
    tokens, squeezed_terms = _terms()
    norm = normalize(text)
    for tok in _NON_LETTER.split(norm):
        if not tok:
            continue
        if tok in tokens:
            return tok
        # Simple plurals ("retards", "fags") without listing every form.
        for suffix in ("es", "s"):
            stem = tok[: -len(suffix)]
            if tok.endswith(suffix) and len(stem) >= 3 and stem in tokens:
                return stem
    squeezed = _NON_LETTER.sub("", norm)
    for term in squeezed_terms:
        if term in squeezed:
            return term
    return None


def assert_clean(text: str | None, field: str = "text") -> str | None:
    """Validator helper for request models: raise ValueError on a hit."""
    if find_prohibited(text):
        raise ValueError(f"Your {field} contains language that isn't allowed on JobSwipe")
    return text


def sanitize(text: str | None) -> str | None:
    """For machine-written fields: drop the value (None) instead of failing."""
    return None if find_prohibited(text) else text
