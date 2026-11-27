# The job check: every way of adding a job says what's missing (OpenProject #3298)

## Why
The user (2026-11-26): "if we add a job via any possible way and it doesn't meet the
requirements/fields, or he sent the wrong file, it lets him know and check".

## Rules (backend `services/job_quality.py`; forms: `packages/shared/src/jobs`, same cases)
- **Must have before going live:** a title, a description (≥ 30 characters), a location
  or remote, at least one skill.
- **Suggestions (don't block):** must-have skills, a salary.
- **Wrong text or file:** Claude's job reading returns `kind` (`job_post` | `cv` |
  `other`). "Fill with AI" and job files refuse a CV or anything that isn't a job post,
  with a clear reason. A file with under 20 characters of text says "couldn't find any
  text… if it's a scan or a photo, upload the original". A file that can't be opened
  says so.

## Where it applies
- **Server:**
  - create → 422 with one sentence of what's missing;
  - edit of a live job → 422 if it would become incomplete (a switched-off job may be
    saved as a draft);
  - switch on → 422 if incomplete;
  - every job in responses carries `issues`, `source` and `held_reason`.
- **Comeet:** imported jobs go live only once they pass the check; otherwise they're
  off with `held_reason = "incomplete"` and switch on by themselves when a later sync
  completes them (e.g. once the AI can tag them). Switching on by hand clears it.
- **Website:**
  - live checklist in the job form ("Before it can go live: …" / "Ready to go live" +
    tips), Create disabled until complete;
  - file results show what's missing, with "Create" only for complete ones (the others
    must be edited first); "Create all" skips incomplete ones;
  - job list: a "Needs a check" badge and what's missing;
  - Comeet card: "N imported jobs need a check".
- **App:** the same checklist in the job form (Create disabled until complete), list
  badge + missing items, Comeet card count; wrong-file messages come from the server.
- **Also fixed:** the website showed salaries as "$…k" and labelled them "$/yr"
  (6 places) while the data and the AI use ₪ per month. Now `shekels()` (shared),
  "₪/month" labels, and the feed's salary filter goes up to ₪50k by ₪1k.

## Tests
- Backend: `test_job_quality.py` (6), `integration/test_job_check.py` (13), Claude
  `kind` (1).
- Shared `jobs/__tests__/quality.test.ts` (6).
- Website: `JobChecklist` (3), `pages/__tests__/Jobs.test.tsx` (6), `ComeetCard` +1.
- App: `jobs.test.tsx` checklist, remote, wrong file, list badge.
- Verification (`scripts/test.sh`, all PASS): backend 244, website 104, app 153, scripts.

## Live check (local stack, 2026-11-26)
Comeet sandbox import with the AI unavailable: 3 jobs came in off with
`held_reason=incomplete`, and the list showed `skills` (+ the `salary` tip). Migration 018
(now with `held_reason`) re-applied cleanly (`IF NOT EXISTS`).

## Gaps
- Server messages are English only (like the other server errors).
- "Kind" detection needs the Claude provider (Gemini doesn't return it).

## Re-verified before commit (2026-11-27)
`scripts/test.sh`: all PASS (backend 244, website 104, app 153, scripts). Committed together with the Comeet import work, since both change the same files.
