# TDP: profession-layer

**Status:** READY
**Created:** 2026-10-12
**Owner:** Ivan
**Slug:** `profession-layer`
**OpenProject:** under #568 (Expand beyond high-tech); includes #2259 (junior profile fields)
**Must land before:** Mobile P1 (`docs/worklog/mobile-app-expo.md`), so the shared types and screens are built for professions from the start.
**Method:** TDD. §5 tests are written first: the **characterization** tests must pass on today's code, and the **new** tests must fail. Then implement until everything is green.

---

## 1. Goal

Make professions **data, not code**. Each profession defines its skill tags, licences, shifts, pay type and extra profile/job fields. Web and mobile build their forms from that definition, and the existing matching handles licences and shifts as ordinary tags.

**At launch only "Software developer" is enabled, so users see no change.** The exception is the junior fields (GitHub, portfolio, projects, education, army tech role), which ship as the software profession's extra fields (#2259). Niche #2 later (nursing, trades, hourly) means **adding data and translations**, with no new screens on web or mobile.

## 2. Current state

| Area | Today |
|---|---|
| Tags | `tags(id, name, category tag_category_enum, created_at)`, 295 tags, all tech. Enum: `language` (meaning programming), `framework`, `tool`, `database`, `cloud`, `certification`, `soft_skill`, `other` |
| Related skills | `tag_implications(parent_tag_id, implied_tag_id)`, 174 rows; expanded for every user in `backend/app/services/scoring.py` |
| Worker tags | `worker_tags(worker_id, tag_id)`, 259 rows |
| Job tags | `job_posting_tags(job_posting_id, tag_id, requirement tag_requirement_enum: required\|preferred\|nice)`, 155 rows |
| **Hard filter** | **Already exists.** In `routers/employers.py` (about lines 400–432) a job is dropped unless the worker has **all** required tags and **at least one** preferred; `routers/workers.py` (about 185–251) does the same in reverse |
| Score | `compute_match_score` (`scoring.py:40-51`): overlap / job tag count |
| Worker profile | `worker_profiles(name, bio, location, skills[], experience_years, resume_url, avatar_url, embedding, cv_*)` |
| Job | `job_postings(title, description, skills_required[], salary_min, salary_max, location, remote, min_experience_years, expires_at, …)`, 189 rows |
| Employer | `employer_profiles(company_name, description, industry, location, logo_url, org_id)` |
| Tags API | `routers/tags.py`, filter by `category` (`VALID_CATEGORIES`) |
| CV AI vocabulary | `tasks/cv_processing.py:32` loads **all** tag names for the LLM |
| Web UI | `components/TagPicker.tsx` (groups by category, with special `language`/`framework` logic at `:84`); `pages/Onboarding.tsx` (fixed fields: bio, location, experience_years) |
| Migrations | `supabase/migrations/`, last is `014_plans.sql` |
| Backend tests | `backend/tests/` (9 files), run in Docker. **No web tests.** **`deploy.yml` doesn't run tests.** |

## 3. Scope

### In scope
- DB: `professions`, `profession_tags`, new tag categories, `profession_id` and `extra` on workers and jobs, `pay_type` on jobs, migrating existing data
- Backend: `GET /api/professions`, a profession filter in both feeds, checking `extra` fields, CV AI vocabulary per profession, tags API filtered by profession
- Web: profession step in onboarding (auto-skipped with one profession), TagPicker by profession categories, extra-field rendering in onboarding, profile and job forms, pay type on cards
- Software profession extra fields = the junior fields (#2259)
- **Step 0:** a "tests before deploy" gate in `deploy.yml`

### Out of scope
- Defining and enabling other professions (nursing etc.): later, as data
- Multiple professions per worker (one primary for now; the schema allows more later)
- Mobile screens (built on this in Mobile P2+)
- Changing the match % formula

## 4. Design

### 4.1 Schema (migration `015_professions.sql`)
```sql
create table professions (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,                 -- 'software_dev'
  name jsonb not null,                      -- {"en": "Software developer", "he": "מפתח/ת תוכנה"}
  pay_type_default text not null default 'monthly',   -- monthly | hourly | per_shift
  categories text[] not null,               -- tag categories shown, in order
  fields jsonb not null default '[]',       -- extra-field definitions (§4.2)
  enabled boolean not null default false,
  sort int not null default 0,
  created_at timestamptz default now()
);
create table profession_tags (profession_id uuid references professions on delete cascade,
                              tag_id uuid references tags on delete cascade,
                              primary key (profession_id, tag_id));
-- universal tags (spoken languages, driving licence, shifts, soft skills) = tags with NO profession_tags rows

alter type tag_category_enum add value 'spoken_language';
alter type tag_category_enum add value 'license';
alter type tag_category_enum add value 'shift';

alter table worker_profiles add column profession_id uuid references professions,
                            add column extra jsonb not null default '{}';
alter table job_postings    add column profession_id uuid references professions,
                            add column pay_type text not null default 'monthly'
                              check (pay_type in ('monthly','hourly','per_shift')),
                            add column extra jsonb not null default '{}';
create index on worker_profiles (profession_id);
create index on job_postings (profession_id) where active;
```
**Moving existing data (same migration):**
- Insert `software_dev` (enabled).
- Link every existing non-`soft_skill` tag to it; soft skills stay universal.
- Set `profession_id = software_dev` on every worker and job.
- Then set `profession_id` NOT NULL on `job_postings`. Workers stay nullable until onboarding sets it.

Postgres `ALTER TYPE … ADD VALUE` can't be used in the same transaction as the new value, so the enum additions go in `015a_tag_categories.sql`. **[ASSUMPTION: check how migrations are applied]**

### 4.2 Extra-field definitions (`professions.fields`)
```json
[
  {"key":"github_url",    "type":"url",    "label":{"en":"GitHub","he":"GitHub"}, "for":"worker"},
  {"key":"portfolio_url", "type":"url",    "label":{"en":"Portfolio","he":"תיק עבודות"}, "for":"worker"},
  {"key":"education",     "type":"list",   "for":"worker", "max":3,
   "item":[{"key":"kind","type":"select","options":["degree","bootcamp","course","self_taught"]},
           {"key":"institution","type":"text","max":80},
           {"key":"grad_year","type":"int","min":1980,"max":2035}]},
  {"key":"projects",      "type":"list",   "for":"worker", "max":3,
   "item":[{"key":"title","type":"text","max":60},
           {"key":"stack","type":"tags"},
           {"key":"url","type":"url","optional":true}]},
  {"key":"army_role",     "type":"text",   "for":"worker", "optional":true, "max":80},
  {"key":"junior_friendly","type":"bool",  "for":"job"},
  {"key":"office_days",   "type":"int",    "for":"job", "min":0, "max":5, "optional":true}
]
```
Field types: `text`, `url`, `int`, `bool`, `select`, `tags`, `list`. A single validator, `app/services/profession_fields.py`, checks `extra` against these definitions.

### 4.3 Backend
- `GET /api/professions`: enabled professions with `name`, `pay_type_default`, `categories`, `fields`, and tags grouped by category (profession tags plus universal ones). Cached in Redis and invalidated on change.
- `GET /api/tags?profession=<key>` adds a filter; existing callers are unchanged.
- Worker and job create/update accept `profession_id`, `extra`, `pay_type`. `extra` is checked by the validator (422 on unknown keys or bad values). Tags must belong to the profession or be universal (422 otherwise).
- **Feeds:** add `profession_id` equality to the job query (`routers/employers.py` `worker_feed`) and the worker query (`routers/workers.py` `employer_feed`). The existing required/preferred filter and score stay **unchanged**.
- **CV and job AI:** `tasks/cv_processing.py:32` loads only the profession's tags plus universal tags, for both worker CVs and job extraction (still Pro-gated per #2254). AI skill expansion for jobs and workers is a separate ticket (#2263).
- Response models: add `profession_key`, `pay_type`, `extra` to cards and profiles.

### 4.4 Web
- `Onboarding.tsx`: step 0 "What do you do?" from `GET /api/professions`; **skipped automatically when only one profession is enabled**.
- `TagPicker.tsx`: categories and order come from the profession. The `language`/`framework` special case (`:84`) becomes driven by the profession.
- New `ExtraFields.tsx`: renders the field definitions (text, url, int, bool, select, tags, list), used in onboarding, Profile and Jobs.
- Job form: pay type selector, with salary labels per type ("₪/month", "₪/hour", "₪/shift"). Cards show the formatted pay.
- Feed card for workers: a "Junior-friendly" badge when `extra.junior_friendly` is set or `min_experience_years = 0`.
- en/he strings for new labels; field labels come from profession data.

## 5. Tests (write first)

### 5.0 "Tests before deploy" gate (step 0, separate ticket)
- `deploy.yml` gets a `test` job (backend pytest in Docker) that the build/deploy jobs `need`. A red test blocks the deploy.
  *Test:* a deliberately failing test on a branch shows the deploy skipped.

### 5.1 Characterization tests (must pass on TODAY's code, before any change)
`backend/tests/test_feed_characterization.py`
- C1: worker feed: a job with required tags {A,B} is hidden from a worker with {A}, shown to one with {A,B}
- C2: worker feed: a job with preferred tags {C,D} is hidden from a worker with neither
- C3: implications: a worker with CUDA (which implies C++) passes a job that requires C++
- C4: score: overlap / job tag count, sorted by % then matched
- C5: employer feed: the mirror of C1–C4
- C6: create and update job and worker with tags still work (existing payloads)

### 5.2 New behavior (fail first)
`backend/tests/test_professions_migration.py`
- M1: after the migration, every existing worker and job has `profession_id = software_dev`; counts are unchanged (259 worker tags / 155 job tags / 189 jobs on a dev snapshot fixture)
- M2: every non-soft-skill tag is linked to software_dev; soft skills have no links (universal)
- M3: the new enum values exist

`backend/tests/test_professions_api.py`
- P1: `GET /api/professions` returns only enabled professions, with fields and tags grouped by category, universal tags included
- P2: a disabled profession is hidden; enabling it makes it appear (cache invalidated)
- P3: `GET /api/tags?profession=software_dev` excludes another profession's tags and includes universal ones

`backend/tests/test_profession_fields.py`
- F1: valid software `extra` (github_url, 3 projects, education) → 200, stored as-is
- F2: bad URL, unknown key, list over max, int out of range, wrong type → 422 naming the field
- F3: a `job` field sent on a worker → 422
- F4: a tag from another profession on a worker or job → 422; universal tag → OK

`backend/tests/test_feed_professions.py`
- X1: a worker in profession P never sees jobs in profession Q, even with 100% tag overlap
- X2: an employer feed for a job in P never shows workers in Q
- X3: a licence tag marked **required** on a job hides workers without it (reusing the existing filter, with a seeded test profession)
- X4: a shift tag works the same way
- X5: C1–C5 still pass unchanged for software_dev

`backend/tests/test_cv_vocabulary.py`
- V1: the CV extraction prompt contains only the worker's profession tags plus universal tags (LLM mocked)
- V2: the job tag extraction prompt (`extract_job_tags`, `extract_job_tags_bulk`, parse-job-files) contains only the job's profession tags plus universal tags

Web (vitest + RTL, setup arrives with Mobile P1 or earlier if needed): `frontend/src/__tests__/`
- W1: `ExtraFields` renders every field type from a definition and emits the right `extra` object
- W2: with one enabled profession, onboarding skips the profession step; with two it shows it
- W3: TagPicker shows the profession's categories in the given order
- W4: pay formatting: monthly → "₪18,000/month", hourly → "₪55/hour" (en and he)

### 5.3 Commands
```bash
# Backend
docker build -t jobswipe-backend:test ./backend
docker run --rm --env-file .env jobswipe-backend:test python -m pytest -q \
  tests/test_feed_characterization.py tests/test_professions_migration.py tests/test_professions_api.py \
  tests/test_profession_fields.py tests/test_feed_professions.py tests/test_cv_vocabulary.py
docker run --rm --env-file .env jobswipe-backend:test python -m pytest -q      # full suite

# Web
docker run --rm -v "$PWD":/repo -w /repo/frontend node:22 sh -c "npm ci && npx vitest run && npm run build"
```
**[ASSUMPTION]** The migration tests need a throwaway DB. Use a disposable Postgres container seeded from a dev `pg_dump` of the public schema, rather than the live dev DB.

### 5.4 Manual checks
- [ ] Existing dev accounts: the feed shows the same jobs in the same order as before (compare against a saved list)
- [ ] New worker onboarding: no profession step; junior fields shown; GitHub link saved and shown on the employer's card
- [ ] Job form: junior-friendly toggle, pay type; the badge shows in the worker feed
- [ ] Hebrew: new labels translated and RTL correct

## 6. Steps (TDD order)
0. `deploy.yml` test gate (§5.0)
1. Characterization tests C1–C6, green on current code; commit
2. Migration tests M1–M3 (red) → `015a`, `015` → green
3. API and validator tests P*, F* (red) → `professions` router, `profession_fields.py`, model and schema changes → green
4. Feed tests X1–X5 (red) → feed filters → green; C* still green
5. V1 (red) → CV vocabulary → green
6. Web tests W1–W4 (red) → `ExtraFields`, onboarding step, TagPicker, pay format → green
7. Full suite, manual checks, update `docs/worklog/mobile-app-expo.md` (shared types include profession, extra, pay_type)

## 7. Risks
| Risk | Mitigation |
|---|---|
| The feed changes for existing users | C1–C6 written first; manual feed comparison against a saved list |
| Enum migration in a transaction | Split into `015a` |
| `extra` JSON grows messy | One validator, definitions in the DB, unknown keys rejected |
| Hidden tech assumptions elsewhere (e.g. LLM prompts say "developer") | grep prompts in `services/llm/*`; V1 test |
| Feed performance with the extra filter | Index on `profession_id`; it's an equality filter, so it's cheap |

## 8. Open questions
None blocking. Later: which profession is niche #2 (decided after the no-code interviews with contractors and care homes).

## 9. Work log

### 2026-10-28: Step 0, "tests before deploy" gate (#2273)
**Findings first:**
- GKE was never used. `deploy.yml` fired on every push to `main` against a cluster that doesn't exist.
- Production is the Oracle box, deployed by hand.
- Backend tests need only four dummy Supabase settings, no real DB: 81 pass.

**Changes:**
- `scripts/test.sh` (new): one runner used by CI and by deploy. It runs the backend pytest in Docker with dummy settings, the frontend production build, and the script tests.
- `scripts/deploy_oracle.sh` (new): refuses uncommitted changes, runs `scripts/test.sh`, and aborts before copying anything if tests fail. It shows commits and migrations since the last deploy, asks for confirmation, rsyncs git-tracked files only (never `.env`, `docker-compose.override.yml` or `backend/credentials/`), rebuilds backend, celery, frontend and caddy, never touches the tunnel or Supabase, records `.deployed_commit`, and waits for the backend health check. Flags: `--dry-run`, `--yes`.
- `scripts/tests/test_deploy_oracle.sh` (new, written first, red → green): 20 offline checks with stubbed rsync, ssh and test runner.
- `.github/workflows/test.yml` (new): `scripts/test.sh` on every push and PR.
- `.github/workflows/deploy.yml`: GKE deploy is now `workflow_dispatch` only (kept as the scale-up path), with a `test` job that `build-and-deploy` needs.

**Verification:**
| Check | Result |
|---|---|
| `bash scripts/tests/test_deploy_oracle.sh` before the script existed | FAIL as expected (9 failed) |
| same, after writing the script | **PASS**: 20/20 |
| `scripts/test.sh` | **PASS**: backend 81 passed, frontend build OK, script tests OK |
| Gate: a deliberately failing `backend/tests/test_zz_gate_check.py` plus `deploy_oracle.sh --dry-run` | **PASS**: exit 1, "1 failed, 81 passed", "Tests failed. Nothing was deployed." (temporary test removed) |
| Workflow YAML parse | **PASS**: test.yml on push/pull_request; deploy.yml on workflow_dispatch, `build-and-deploy` needs `test` |
| GitHub Actions run after push | PENDING (needs a push) |
| First real `deploy_oracle.sh` to Oracle | PENDING (by the user, when ready) |
