# JobSwipe — Next Session Plan

_Written 2026-09-22. Companion to the Claude memory worktrack; **for "what's next", this file wins.**_
_Latest commit on `main`: `c750a9f`. Read this file first, then run the commands in §7._

---

## 1. Where we are

| Area | Status |
|---|---|
| Launch-readiness Phase 0 (Sentry code, backups) | ✅ done — Sentry **DSN still unset** |
| Phase 1 (rate limits, login lockout, LLM cost cap) | ✅ done — CORS still `*` (no domain yet) |
| Phase 2 (report loop, blocks, content filter, admin **API**) | ✅ done — no admin **UI** |
| Polish audit (`docs/polish-checklist.md`) | 34/44 done; remaining 10 are P3 cosmetic |
| Hebrew UI + RTL | ✅ done (`react-i18next`, 357 keys) — user should skim `frontend/src/locales/he.json` |
| Friends beta | live at **https://glucose-nikon-grant-pond.trycloudflare.com** — **zero activity so far** |
| Android / PWA | not started (after web, after Hebrew — done) |

Local stack = `docker compose` on this box (LAN `http://192.168.2.42`). Tunnel URL changes if the tunnel restarts:
`docker logs jobswipe-tunnel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1`

Demo accounts: `demo_employer@jobswipe.com` / `Demo1234!` (owner, ~168 workers to swipe); workers like `alice.chen@demo.com` / `Demo1234!`.
Data caveat: 295 of 330 users are automated-test junk owning 173/180 jobs; cleanup deferred by the user (`scripts/cleanup_test_data.sql`, dry-run by default).

---

## 2. Open items that need the USER (not code)

- [ ] **Sentry DSN** — create project at sentry.io (free) → put `SENTRY_DSN=…` in root `.env` and `k8s/configmap.yaml` → `docker compose up -d backend celery`.
- [ ] **Stable public URL** — needs a domain; then a Cloudflare *named* tunnel (~15 min).
- [ ] **Real admin email** — `ADMIN_EMAILS` / `ADMIN_ALERT_EMAIL` are `demo_employer@jobswipe.com`; swap before launch.
- [ ] **Email** (Resend key + verified domain + real app URL) — unblocks email verification, match/digest emails.
- [ ] **Get 3–5 friends onto the link**; collect "first moment I was confused".
- [ ] **Decision needed for notifications:** should *workers* get "an employer liked you" before the match? (Tinder hides it; LinkedIn shows it.) Recommendation: employers only for now.

---

## 3. Agreed order of work

1. **Notifications** — in-app, per-type preferences, team notifications. ← **START HERE** (§4)
2. **Redesign / colors** — design canvas with 3 directions; current pink `#ec4899` reads "Tinder clone", vision is professional → calmer palette. Palette lives in `frontend/tailwind.config.js`. Fold the 10 P3 cosmetic items into this pass.
3. **Admin panel UI + liquidity dashboard** — one page: reports queue, suspend/unsuspend, hide/unhide, plus signups/day, employers with live jobs, % new users with ≥1 match, time-to-first-match, matches→first message. Admin API exists at `/api/admin/*` (Swagger `/docs`), gated by `ADMIN_EMAILS`.
4. **Employer "paste your job ad → live in 2 minutes"** (reuse `/api/cv/parse-job-files`) + job-expiry reminder ("expires in 3 days — renew?").
5. **PWA** (`vite-plugin-pwa`: manifest + service worker) + web push → **Android via Capacitor** (same React code; NO native rewrite). Play Store UGC review needs: report/block ✅, privacy policy URL, real in-app account deletion (GDPR delete needs the Phase-3 cleanup), data-safety form.
6. Feedback-driven fixes → seeded public job listings → solo-useful CV value (skill gap analysis).

**Parked by user decision:** junk-data cleanup + realistic seed, email verification, in-app feedback button, Phase 4 scale work, monetization, image scanning (`IMAGE_MODERATION=off`, Gemini scanner dormant), org-level blocks, backend error messages in Hebrew (need error codes).

---

## 4. Notifications — full build plan (play-by-play)

### 4.1 Types (each individually on/off per user, defaults ON)

| type | recipients | trigger | example |
|---|---|---|---|
| `match` | both sides | `swipes.record_swipe` creates a Match | "It's a match with Demo Tech Inc" |
| `like_received` | **employers only** (workers: pending user decision) | worker likes/super-likes a job | "3 candidates liked 'Frontend Engineer'" (batch per job) |
| `chat` | the other participant | `messages.send_message` | "New message from Alice" |
| `team` | other org members | teammate posts/edits/toggles a job, likes, matches, sends a chat | "Dana posted 'Junior QA'" |
| `account` | the user | CV extraction done/error; job expiring in 3 days | "CV analyzed — 5 skills added" |

**Team rules:** never notify a member of their own action; only for things their role can see (a Viewer gets no `chat` team notifications — use `has_permission(role, "chat")` etc. from `app/models/organization.py`); recipients = `OrgMember` rows of the actor's org minus the actor (`get_org_employer_ids` in `services/org_access.py` has the lookup).

### 4.2 Backend steps

1. **Migration** `supabase/migrations/012_notifications.sql` (additive):
   ```sql
   CREATE TABLE IF NOT EXISTS public.notifications (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
     type text NOT NULL CHECK (type IN ('match','like_received','chat','team','account')),
     title text NOT NULL, body text DEFAULT '', link text DEFAULT '',
     actor_id uuid NULL, created_at timestamptz DEFAULT now(), read_at timestamptz NULL);
   CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;
   CREATE TABLE IF NOT EXISTS public.notification_prefs (
     user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
     type text NOT NULL, enabled boolean NOT NULL DEFAULT true, PRIMARY KEY (user_id, type));
   ```
   Apply: `docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/migrations/012_notifications.sql`
   (also apply to prod DB if/when prod is live). Add SQLModel tables `app/models/tables/notification.py` + register in `tables/__init__.py`.
2. **Service** `app/services/notifications.py`:
   - `async def notify(session, user_id, type, title, body="", link="", actor_id=None)` — checks `notification_prefs` (missing row = enabled), inserts, does NOT commit (caller commits). Never raises to the caller (log + swallow) — notifications must not break the action.
   - `async def notify_team(session, actor_user, type, title, ...)` — resolves org members via `OrgMember`, skips actor, filters by permission, calls `notify` per member with type `team`.
   - Titles/bodies stored as **i18n keys + params** (e.g. `title_key="notif.match.title"`, `params={"name": …}`) so the frontend renders them in the active language. Store `params` as JSON text column → add `params jsonb DEFAULT '{}'` to the migration.
3. **Emit points** (each a 2–5 line addition; keep the existing behaviour intact):
   - `routers/swipes.py`: on match → `match` to both users; on like/super_like by a worker → `like_received` to the job's employer (batching can be v2: one row per like is fine at this scale); team fan-out for employer likes/matches.
   - `routers/messages.py send_message`: `chat` to the other participant; team fan-out for employer-side sender.
   - `routers/employers.py create_job / update_job / toggle_job_active`: team fan-out (`team`).
   - `tasks/cv_processing.py`: `account` on done/error (sync session — write a sync variant `notify_sync`).
   - Job expiry: no cron exists on compose (k8s CronJob references a missing `app.tasks.digest`). Create `app/tasks/digest.py` with a Celery beat task `job_expiry_reminders` (daily) → `account` notification to the employer for jobs expiring in ≤3 days; this also fixes the broken k8s CronJob.
4. **Router** `app/routers/notifications.py` (`/api/notifications`), all `get_current_user`, rate-limited lightly:
   - `GET /` (`?unread_only=&limit=`), `GET /unread-count`, `POST /{id}/read`, `POST /read-all`,
   - `GET /prefs` → `{type: enabled}` for all 5 types, `PUT /prefs` body `{type: bool}` (upsert).
   - Register in `main.py`.
5. **Tests** `tests/test_notifications.py`: prefs default/disable logic, team fan-out excludes actor + respects role, `notify` never raises. Run: `docker build ./backend` then pytest in the image (dummy env; see memory recipe). Extend the e2e harness if time.

### 4.3 Frontend steps

1. `lib/api.ts`: `getNotifications`, `getUnreadNotificationCount`, `markNotificationRead`, `markAllNotificationsRead`, `getNotificationPrefs`, `updateNotificationPrefs`; `Notification` type with `title_key/params`.
2. **Bell** in `components/Navbar.tsx`: reuse the existing 30 s poll (`getUnreadCounts` → also fetch unread notification count; one combined interval). Badge on the bell; click → dropdown on desktop / full page `/notifications` on phones. Row = icon per type, `t(title_key, params)`, relative time, link; clicking marks read + navigates.
3. **Preferences** on `pages/Profile.tsx`: "Notifications" card with 5 toggles (label + one-line description each); `team` toggle only shown for org members; `like_received` only for employers (until the worker decision).
4. **i18n**: add `notif.*` keys to `en.json` and `he.json` (titles per type + prefs labels/descriptions + "Mark all read", "No notifications yet"). Keep key parity (there's a parity check pattern from the Hebrew session).
5. Verify: `docker build ./frontend` (tsc), `docker compose up -d --build frontend backend celery`, then a Playwright subagent run: match → both bells; chat → recipient bell; team: manager posts a job → owner notified, manager not; prefs off → no row; phone + desktop; Hebrew titles render.

### 4.4 Acceptance
- A worker and an employer who match both see it in the bell within 30 s; opening it marks it read and goes to the chat.
- An org owner sees "X posted a job" when a manager posts; the manager does not; a viewer never gets `chat` team items.
- Turning a type off in Profile stops new rows of that type (existing rows stay).
- All in both languages; no console errors; 390 px no overflow; tests green; migration applied.

---

## 5. Redesign — how to run it (item 2)
- Use the `design` skill to publish a canvas with **3 artboards**: (a) calm professional (navy/teal + warm neutral), (b) modern startup (indigo/violet, soft cards), (c) current pink evolved (kept brand, toned down). Each shows Landing, Feed card, Chat, phone width.
- User picks → change `frontend/tailwind.config.js` `brand` scale + `index.css` base; sweep components for hard-coded colors (`grep -rn "pink\|#ec4899\|brand-" frontend/src`); include the 10 P3 items; verify both languages.

---

## 6. Conventions that saved time
- No local venv/pip/npm: verify inside Docker images (`docker build ./backend|./frontend`, pytest in the image, see memory "Local verification recipe"). Deploy locally with `docker compose up -d --build <svc>`.
- Browser verification = Playwright subagent (scripts live in the session scratchpad and are lost between sessions; it recreates them quickly). Give it the tunnel URL only when testing "outside" behaviour.
- Push to `main` triggers GitHub Actions → GKE. Prod reachability unknown (placeholder domain); frontend now expects `/supabase` on its own origin — GKE would need that ingress route or `VITE_SUPABASE_URL` at build.
- `[skip ci]` for docs/scripts-only commits. Migrations are hand-written SQL in `supabase/migrations/`, applied manually; never `alembic autogenerate`.
- Fable budget: `/model claude-sonnet-5` for mechanical work; keep Fable for design/decisions.
- Backups: `scripts/backup_db.sh` (cron lines installed but commented until release), `scripts/restore_drill.sh`.

---

## 7. First commands next session
```bash
cat docs/NEXT_SESSION_PLAN.md
git log --oneline -5 && docker ps --format '{{.Names}} {{.Status}}' | grep jobswipe
docker logs jobswipe-tunnel 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1
docker exec supabase-db psql -U postgres -d postgres -Atc "SELECT count(*) FROM users WHERE created_at > '2026-09-22' AND email NOT LIKE '%@test.local'"   # any friends yet?
```
Then confirm the `like_received`-for-workers decision (§2) and start §4.2 step 1.
