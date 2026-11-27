# Comeet import: connect once, jobs sync automatically (OpenProject #3297)

## Why
Many Israeli startups (our launch pond) post jobs in Comeet (now "Spark Hire Recruit").
The user (2026-11-26): employers on Comeet should bring their jobs into JobSwipe easily,
"brain-dead, just tap and go", with no scraping.

## Options found (2026-11-26)
- **Careers API (chosen now):** official, self-serve. Each company has a UID + Token
  (Comeet → Company Settings → Careers Website; Owner/Admin/IT Admin only).
  - `GET https://www.comeet.co/careers-api/2.0/company/{uid}/positions?token={token}&details=true`
    returns published positions only.
  - Each position has: uid, name, department, employment_type, experience_level,
    workplace_type, location{city,country,...}, details[{name: Description|Requirements,
    value: HTML}], url_active_page (apply link), time_updated. No salary field.
  - IP throttling, no number given; the docs say to use a 60 s timeout.
  - Public sandbox company in the docs (UID `E5.007`, "Careers API Sandbox", 3 mock jobs)
    is used for development. No Comeet account needed (Comeet has no free trial).
- **Job-board partner program (later):** a toggle inside Comeet, "post to JobSwipe";
  Comeet gives us an XML feed. Needs approval: email partners@comeet.co with a logo and a
  ≤120-character summary. Apply once the permanent domain is live.

## Decisions
- **One paste, then automatic.** The employer pastes the UID and Token together (any form:
  labelled, two lines, or a careers-API URL); the server splits them. All published jobs
  are imported and go live; there is no picking step. Any job can be switched off later.
- **Pro only,** like the AI: the import reads every job with the AI, and companies usually
  have more jobs than the Free plan's 1 live job. If Pro lapses, the sync adds new jobs
  switched off rather than going over the Free limit.
- **Async:** connecting checks the credentials (one API call) and answers at once; the
  import runs in the background (FastAPI BackgroundTasks with its own DB session). The app
  polls the connection status.
- **Sync rules** (per employer, matched on the Comeet position uid):
  - new in Comeet → new job, live, AI-tagged;
  - changed (`time_updated`) → text/location updated and re-tagged; on/off is left alone
    (an employer who switched a job off keeps it off);
  - gone from Comeet → switched off;
  - still there → expiry pushed forward, so live Comeet jobs don't expire.
  - If the AI fails or is paused, the job is still imported without skills and gets
    re-read on the next sync.
- **When it syncs:** after connecting; "Sync now"; when the employer opens Jobs and the
  last sync is >24 h old; and a daily script (`python -m app.tasks.comeet_sync`, like
  `digest.py`) for a host cron on Oracle (installing it needs the user's OK).
- **Disconnect** switches off the imported jobs (they would go stale) and deletes the
  stored token.
- **Token:** kept only on the server (RLS on, API only), never returned to clients.
- **Description:** Comeet's Description + Requirements HTML → plain text (paragraphs,
  "• " bullets). Location: the city (plus the country outside Israel). Remote = Remote or
  Hybrid. Experience: the AI's reading, else Entry-level → 0, Intermediate → 2,
  Senior → 5.

## Changes
- `supabase/migrations/018_ats_connections.sql`: `ats_connections` table;
  `job_postings.source`, `source_id`, `source_url`, `source_updated_at` + a unique index.
- `services/comeet.py`: parse the paste, fetch positions, position → job fields.
- `services/ats_sync.py`: sync one connection (the rules above).
- `routers/integrations.py`: `GET/POST/DELETE /integrations/comeet`,
  `POST /integrations/comeet/sync`.
- `tasks/comeet_sync.py`: daily sync script.
- Web Jobs page and app Jobs tab: an "Import from Comeet" card with a 3-step guide, one
  paste box, a progress state, and a connected state (company, job count, last sync,
  Sync now, Disconnect).

## Test plan
- `scripts/test.sh` (all suites).
- Backend unit: paste parsing (labelled, two lines, URL, junk), HTML → text,
  position → job, fetch errors.
- Backend integration (real test DB):
  - connect validates and queues;
  - Free → 402;
  - sync adds, updates, closes, extends, keeps the employer's off switch, imports
    untagged when the AI fails, respects the Free limit;
  - status, disconnect, and the token is never returned.
- Web and app: the connect card states (guide, connecting, importing, connected, error).
- Live: one real call to the Comeet sandbox (done 2026-11-26: HTTP 200, 3 positions).

## Work log
- 2026-11-26: research and plan; sandbox call works (HTTP 200, 3 positions). Wrong UID or
  token → HTTP 400 `{"message": "Account uid or token are not valid"}`.
- 2026-11-26: built, test-first:
  - backend: migration 018, `AtsConnection` model, `services/comeet.py`,
    `services/ats_sync.py`, `routers/integrations.py`, `tasks/comeet_sync.py`;
  - website `ComeetCard` on Jobs;
  - app `ComeetCard` on the Jobs tab (also on the empty screen).
  - `sync_started_at`: an "importing" status older than 1 h counts as stuck and may
    restart (otherwise every 3-second status poll could start a new sync).
  - Re-reading an untagged job doesn't count as "updated".
- **Live check (local stack, real Comeet sandbox, real DB with 018, real sync code):**
  - 3 jobs imported with clean text, locations, experience and apply links.
  - Untagged, because the local copy still uses the out-of-credit Gemini key; re-read on
    the next sync as designed.
  - Switched off, because the local test employer isn't Pro (the Free limit works).
  - Test rows deleted afterwards.
- **Tests:** backend unit 18 (`test_comeet.py`) + integration 18
  (`test_comeet_import.py`); website `ComeetCard` 7; app `comeet.test.tsx` 5.
- **Verification (`scripts/test.sh`, all PASS):** backend 224, website, app 150,
  scripts.
- **Gaps:**
  - the daily cron on Oracle isn't installed (needs the user's OK; opening Jobs a day
    later also syncs);
  - "Download my data" doesn't list the connection (it holds company credentials, not
    personal data; account deletion removes it);
  - the apply link (`source_url`) is stored but not shown to workers yet.

## Re-verified before commit (2026-11-27)
`scripts/test.sh`: all PASS (backend 244, website 104, app 153, scripts). Committed together with the job check work, since both change the same files.

## Connect popup (2026-11-27)
User: "i want ppl just to click and make the connect to their comeet ... make it insta",
then "at least add popup ... click here to add uid / and token". Comeet has no
"sign in with Comeet" (OAuth) for outside apps; only the job board partner program
removes the copy step (asked for in the partner email). So, until then:
- "Import from Comeet" opens a popup (web dialog / app bottom sheet) with a **UID** box
  and a **Token** box, each with a **Paste** button, the "Open Comeet settings" link,
  and a line that the token only reads published jobs.
- Whatever is pasted is sorted into the right box: both at once, labelled, the API
  link, or one value in the wrong box (`packages/shared/src/comeet` `readComeetPaste`,
  same patterns as backend `parse_credentials`). Connect sends "UID Token"; no backend
  change.
- If the browser blocks the Paste button, or the phone's clipboard is empty, it says
  how to paste by hand. App uses `expo-clipboard` (new native module: needs a new build).
- Tests: shared `comeet/__tests__/paste.test.ts` (8), web `ComeetCard` (13), app
  `comeet.test.tsx` (7). `scripts/test.sh` all PASS: backend 244, website 117, app 155.

### Coming back from Comeet keeps the popup (2026-11-27)
User: "for phones make sure it doesn't reset the windows once they open web". Found two
ways it reset:
- Website: when a phone came back to the tab, the login refresh changed the token, the
  Jobs page reloaded and swapped the whole page for a spinner, unmounting the popup
  (and any open job form). Now only the first load shows the spinner.
- Phones reload/close backgrounded tabs and apps. The popup and what was typed are now
  remembered: website in `sessionStorage` (this tab only), app in the encrypted
  `secureSessionStorage` (same as the login). Cancel and Connect forget it; saves run
  one at a time so a slow save can't bring it back after Cancel.
- App opens Comeet in an in-app browser (`expo-web-browser`), closing with ✕ back to the
  popup; falls back to the phone browser.
- Tests: web `ComeetCard` +2, `Jobs.test` +1; app `comeet.test.tsx` +4.
  `scripts/test.sh` all PASS: backend 244, website 120, app 159.
