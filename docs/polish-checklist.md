# Polish checklist — the launch "finish line"

Source: new-user audit on 2026-09-13 (fresh worker + employer accounts, desktop 1280x800 and phone 390x844).
Rule: when every P1 and P2 box is ticked, polish is DONE — no open-ended "make it better". P3 is optional.
Screenshots referenced in the audit live in the session scratchpad (`polish/`).

## P1 — broken / blocks the flow
- [x] Match modal never appears when the mutual like is on the LAST card (Feed.tsx early-returns EmptyState before `{match && <MatchModal/>}`); common with filters on.
- [x] Worker with zero skills sees only tagless junk — every job with required tags is hard-filtered with no explanation. Onboarding must require/strongly nudge ≥1 skill (suggested chips), and the feed must say "add skills to see matching jobs".
- [x] No swipe gesture on phone: SwipeCard has no pointer/touch handlers (buttons + desktop keys only). Add drag with LIKE/NOPE overlay.
- [x] Employer pages overflow horizontally on phone (429px on 390px): 6-item navbar pushes Sign-out off-screen; job-form modal clipped.
- [x] Job-creation errors swallowed (`catch { /* silent */ }` in Jobs.tsx): 422 (min>max salary) shows nothing.
- [x] New jobs show "Posted Jan 1, 1970" — `created_at` NULL for jobs created via the form (backend must set it / DB default).
- [x] Content-filter rejection invisible in chat: 422 "contains prohibited language" → no error shown, text stays, looks broken.
- [x] CV upload failure invisible: spinner → nothing. Show extraction failed / "we added N skills". (Local cause: celery LLM creds — see notes.)
- [x] Chat header shows "Employer"/"Worker" — `GET /api/matches/{id}` returns `employer:null, worker:null` (list endpoint is fine).
- [x] Expired/invalid session not handled: 401 renders "Failed to load matches — Invalid or expired token" forever. Global 401 → clear token → /login.

### Found during re-verification (2026-09-13)
- [x] `pointercancel` (browser claiming a vertical scroll) committed a PASS swipe — every scroll on a phone discarded a job. Fixed: cancel resets without committing.
- [x] LIKE stamp was top-right and left the screen during a right drag on phone. Fixed: LIKE top-left, NOPE top-right.
- [x] Job-form validation error rendered at the top of a modal scrolled to the bottom → invisible. Fix: place beside the submit button + scrollIntoView.
- [x] CV extraction overwrote user-typed location/experience/name/bio. Fixed: auto-fill only empty fields.
- [x] "Popular" onboarding chips were alphabetical (Assembly, Bash, C…). Fixed: curated list matched against the taxonomy.
- [x] Idle TagPicker dropdown ("Type to search…") covered the onboarding submit button. Fixed: dropdown only with a search term; Escape closes.
- [x] Filter error leaked the field name ("body contains prohibited language"). Fixed: "Your message contains language that isn't allowed on JobSwipe".
- [ ] Backend validation text is snake_case to the user ("salary_min cannot exceed salary_max") — map to friendly labels. (P3)
- [ ] MatchModal shows the employer's own avatar letter from their email ("D"), not company initials. (P3)

## P2 — confusing for a first-time user
- [ ] Onboarding is skippable by accident (full navbar visible during onboarding; tapping Feed exits with an empty profile).
- [ ] Onboarding "Pick your skills" is a lone search box: add suggested/popular chips, explain it gates the feed, set a minimum.
- [ ] All onboarding fields required with only native browser bubbles (Bio/Location/Years should be optional or inline-validated).
- [ ] Keyboard-shortcut strip (X/V/S/B/Z) and "Press the flag button or B" shown on touch devices — hide on touch.
- [ ] Mobile nav icon-only with unguessable icons (🔍 feed, ⚑ saved, 💙 matches): add labels; unread badge on Matches.
- [ ] Job card doesn't read as a job (company is the big title, job title small; no salary/description when empty; no tap-to-expand). Employer cards show "5 yrs experience" as the title.
- [ ] Super like has no distinct feedback and nothing explains it.
- [ ] Filters panel pushes the deck below the fold on phone — overlay/sheet instead.
- [ ] Employer post-onboarding lands on worker feed with no "post a job first" prompt; org/Team page unexplained.
- [ ] Job form jargon: three identical tag pickers (Required/Preferred/Nice), redundant inner labels, salaries default 0, "Listing duration (days)" unexplained, `*` legend missing, two "Create Job" buttons visible.
- [ ] Saved page "30d left" unexplained; raw "X" locations.
- [ ] Report & Block gives no confirmation toast after dropping you on Matches.
- [ ] Dev/junk seed data in the feed ("fdffdg gdgdfg", location "gay", "ExpireCo/Short7") — clean before any demo.
- [ ] Auth error placement (bare text above Email); no "Sign in instead" on duplicate email.
- [ ] Chat: no date separators ("Today").

## P3 — cosmetic
- [ ] Tap targets <44px on phone (nav 34x32, Filters/Undo pills 30px, "Report" link 35x16, Matches "Email" 53x28, report flag 32px).
- [ ] Jobs page phone header wraps ("Your Jobs" + "Upload Job / File").
- [ ] Job card meta wraps awkwardly on phone ("Tel / Aviv").
- [ ] Debug `console.log` in Jobs.tsx (~502/518/538) logs full job payloads.
- [ ] Register label "Password(min 8 characters)" missing space in accessible name.
- [ ] Avatar "Tap to add a photo" hover overlay never shows on touch.
- [ ] Matches list truncates titles at 390px; "Email" button over-prominent vs "Chat".
- [ ] Desktop job-form modal taller than viewport; header scrolls away on validation.
- [ ] `net::ERR_ABORTED` on GET /api/bookmarks/{id} after Like-from-Saved (harmless race).

## RTL / Hebrew hazards (for the localisation pass)
- ~8 physical-direction classes (`left-5`/`right-5` LIKE/NOPE overlays, `left-1/2 -translate-x-1/2` toast, `ml-*` in Register/Team) → logical (`start/end`, `ms/me`).
- Directional glyphs in text: "Next —", "↩ Undo", "▶" expander, "‹" back, sign-out arrow; hard-coded `$…k` salary format; chat bubbles aligned by physical side.
- No `dir` attribute, no i18n framework, all strings inline. Emoji nav icons are direction-neutral.

## Timings (baseline)
- Worker signup → first swipe: 8 taps + 7 fields, ≈2–3 min human time (but first swipe is junk without skills).
- Employer signup → job live: 7 steps, ≈3–4 min, mostly decoding the three tag pickers.

## Notes
- Local celery: `extract_cv_tags` fails with "default credentials were not found" — LLM provider/creds misconfigured on the compose instance (not a prod code bug per se; verify).
