# TDP: mobile-app-expo

**Status:** READY for Phase 1. Decisions are in §10. Release builds wait for the domain (a few days); development doesn't.
**Created:** 2026-10-11
**Owner:** Ivan
**Slug:** `mobile-app-expo`
**Replaces:** `mobile-app-capacitor` (dropped: a wrapped website doesn't feel native enough for a swipe app, and risks Apple's 4.2 rejection)

---

## 1. Goal

A **real native mobile app** for JobSwipe, built with **React Native and Expo**. Android ships first. **iOS is built from the same code** through Expo's cloud build service (EAS) when the Apple account exists, so no Mac is needed.

- **Same backend, Supabase auth and database as web.** A user logs in on the phone and sees exactly their web data.
- **Same look:** the Harbor palette, Fraunces and IBM Plex type, the icons, and Hebrew RTL plus English.
- **Native feel:** gesture-driven swipe cards at 60fps, native navigation and transitions, haptics, push, the native keyboard and share sheet.
- **Shared logic:** the API client, types, translations and design tokens live in one package that both web and mobile use. There's one source of truth, and the two apps can't drift apart.
- **Built test-first:** each phase starts with failing tests.

## 2. Current state

| Area | Today | Effect on mobile |
|---|---|---|
| Web stack | React 18 + Vite + Tailwind, 13 pages, about 8k lines | Screens are rebuilt in React Native; logic is shared |
| API client | `frontend/src/lib/api.ts` (939 lines, about 70 functions, all types) | Moves to `packages/shared`. Three web-only bits must be injected: `import.meta.env` (`:176`), `window.dispatchEvent` on 401 (`:227`), and `File` for uploads (`:400,412,445`) |
| Auth | Supabase email/password (`Login.tsx:24`, `Register.tsx:30`), Bearer tokens | `supabase-js` works in React Native; the session needs native storage |
| Translations | `frontend/src/locales/en.json`, `he.json` (react-i18next) | Shared as-is. Hebrew means **RTL**, which is harder in React Native (see Risks) |
| Design tokens | `frontend/tailwind.config.js` (brand teal, warm-gray and navy, fonts, keyframes) | Shared as a JS tokens file; mobile uses NativeWind (Tailwind classes in React Native) |
| Swipe | `components/SwipeCard.tsx` (314 lines), `hooks/useSwipe.ts`, `pages/Feed.tsx` (806 lines: undo, bookmark-swipe, filters, MatchModal) | Rebuilt on Gesture Handler and Reanimated; the feed logic moves to a shared hook-free module |
| Realtime | Polling (chat, a 30s badge, CV status) | Same polling while the app is in the foreground; push covers the background |
| Notifications | In-app DB rows (`backend/app/services/notifications.py`, `notifications` table, 5 types, per-type prefs) and Resend email | **Add a mobile push channel** |
| Storage URLs | Backend returns relative `/supabase/...` (`backend/app/routers/uploads.py:21-34`, `PUBLIC_SUPABASE_PATH` in `config.py:29`) | Mobile makes them absolute with a shared `mediaUrl()` helper |
| CORS | `CORS_ORIGINS="*"` | Native apps aren't subject to CORS, so no change |
| Supabase auth emails | `SITE_URL=http://localhost:3000`, no redirect allowlist | Confirm and reset flows need a real host (Phase 0) |
| Web build | `docker build ./frontend` (`deploy.yml:43`), `frontend/Dockerfile` copies only `frontend/` | Must change to the repo-root context so it can see `packages/shared` |
| Frontend tests | vitest + React Testing Library since 2026-10-28 (`frontend/src/**/*.test.tsx`, Dockerfile `test` stage) | Shared and mobile get their own suites from the start |
| Toolchain | No Node or JDK on the dev box; everything runs in Docker | Expo dev server and local Android builds run in Docker |
| Hosting | Oracle A1 behind a Cloudflare **quick tunnel whose URL rotates**; the domain (`jobswipe.com`) is coming in a few days | Development uses the current tunnel URL (read when the dev server starts). Preview and production builds wait for the domain. **No ports get opened.** |
| Plans | `pro_grants.source` already allows `'billing'` (`backend/app/models/tables/plan.py:32`); promo codes and admin grants work; no payment provider yet | Store subscriptions map onto `pro_grants` with `source='billing'` |

## 3. Scope

### In scope
| Phase | What |
|---|---|
| 0 | Expo account, dev workflow in Docker (dev server picks up the current tunnel URL), then the domain setup when it's bought |
| 1 | `packages/shared`: API client, types, translations, tokens and pure feed logic. **The web app switches to it with no behavior change.** |
| 2 | Expo app skeleton: navigation, theme, fonts, translations with RTL, auth (login, register, session restore, sign-out) |
| 3 | Onboarding (worker and employer): profile, tags, avatar from camera or gallery |
| 4 | **Feed with native swipe cards**: undo, bookmark, filters, match modal, haptics |
| 5 | Matches and chat |
| 6 | Profile: CV upload and status, notification prefs, language, data export (share sheet), **account deletion**, block and report |
| 7 | Employer screens: job postings (create, edit, toggle, delete, parse a job file), bookmarks and notes, team (members, invites, join with a code), plan status |
| 8 | **Notifications v2**: a fine-grained event catalog (every activity), per-event × per-channel (in-app, push, email) prefs on web and mobile, a device-token table, a Celery push sender, grouping and throttling, and the mobile permission and tap-to-open flow |
| 9 | Release: Android internal testing on Play, plus the iOS EAS profile ready to run |
| 10 | **Pro subscriptions in the app**: Google Play Billing and Apple in-app purchase through RevenueCat, mapped to `pro_grants`. Pro is sold everywhere. |

### Out of scope
- **Admin page.** It stays web-only.
- **Web payments** (an Israeli payment provider or Paddle). Separate TDP; Phase 10 builds the entitlement layer it will reuse.
- **Universal Links and App Links verification.** That needs the real domain; it's in the §11 checklist.
- Offline mode, Supabase Realtime and tablet layouts.
- Changing the web UI. The web only switches its imports to `packages/shared`.

## 4. Repo layout (target)

```
jobswipe/
  package.json                 ← NEW: npm workspaces ["frontend", "mobile", "packages/*"]
  packages/shared/             ← NEW
    src/api/client.ts          createApiClient({ baseUrl, onUnauthorized, appVersion })
    src/api/*.ts               endpoint functions (moved from frontend/src/lib/api.ts), grouped by domain
    src/api/upload.ts          UploadFile = Blob | { uri, name, type } → FormData (web + RN)
    src/types.ts               all API types
    src/i18n/locales/{en,he}.json   (moved from frontend/src/locales)
    src/theme/tokens.ts        colors, fonts, radii, spacing (Tailwind config imports these)
    src/feed/                  pure feed state: queue, undo, bookmark-swipe rules (no React)
    src/media.ts               mediaUrl(path, publicBase)
    src/__tests__/             vitest
  frontend/                    web; imports @jobswipe/shared; UI unchanged
  mobile/                      ← NEW Expo app
    app/                       Expo Router (file-based routes)
      (auth)/login.tsx, register.tsx
      (onboarding)/...
      (tabs)/_layout.tsx       tab bar: Feed, Matches, Bookmarks*, Jobs*, Profile   (*employer)
      (tabs)/feed.tsx, matches.tsx, bookmarks.tsx, jobs.tsx, profile.tsx
      chat/[matchId].tsx, team.tsx, join.tsx, notifications.tsx
    src/components/SwipeDeck.tsx, SwipeCard.tsx, MatchModal.tsx, ...
    src/lib/api.ts             createApiClient(...) with mobile config
    src/lib/supabase.ts        supabase-js + native session storage
    src/lib/push.ts
    app.config.ts              reads MOBILE_PUBLIC_HOST, bundle id, versions
    eas.json                   development / preview / production profiles (android + ios)
    __tests__/ + .maestro/     jest-expo + RNTL unit tests; Maestro end-to-end flows
backend/app/
  models/tables/device_token.py, routers/devices.py,
  services/push.py, tasks/push.py              ← NEW (Phase 8)
supabase/migrations/0XX_device_tokens.sql     ← NEW
scripts/mobile/                               ← NEW: Docker wrappers (dev server, tests, local Android build)
```

## 5. Key technical choices

| Concern | Choice | Why |
|---|---|---|
| Framework | **Expo** (managed, current SDK pinned at start), React Native new architecture | Cloud iOS builds from Linux, OTA updates, good library support |
| Navigation | **Expo Router** | File-based like web routes; deep links for free |
| Styling | **NativeWind** + shared `tokens.ts` | Reuses the Harbor tokens and the same Tailwind mental model |
| Swipe | **react-native-gesture-handler + Reanimated** | Gestures and animations run on the UI thread, so 60fps on mid-range Androids |
| Lists | **FlashList** | Smooth chat, matches and bookmark lists |
| Images | **expo-image** | Caching and placeholders for avatars and logos |
| Session storage | supabase-js with **AsyncStorage**, with the session encrypted by a key held in **expo-secure-store** | SecureStore alone has a ~2KB value limit, and Supabase sessions can exceed it |
| Files | expo-image-picker (avatar/logo), expo-document-picker (CV, job files), expo-sharing + expo-file-system (data export) | Native pickers and the share sheet |
| Haptics | expo-haptics | On swipe commit, match, undo |
| i18n | react-i18next + expo-localization; RTL via `I18nManager` | Same JSON as web |
| Push | **expo-notifications** on device; backend sends through the **Expo Push API** from Celery | One API for Android (FCM) and iOS (APNs); credentials live in EAS |
| Subscriptions | **RevenueCat** (`react-native-purchases`) over Google Play Billing and Apple in-app purchase; a RevenueCat webhook → backend → `pro_grants` | One SDK for both stores, receipt validation handled, free at low revenue |
| Crash reporting | **Sentry** (`@sentry/react-native`), source maps uploaded by EAS | Know about crashes before users tell you |
| Builds | EAS Build: Android **locally in Docker** (`eas build --local`) to save cloud quota; **iOS on EAS cloud** | No Mac needed |
| Updates | **EAS Update** (OTA) for JS-only fixes | Ship bug fixes without store review |
| Config | `MOBILE_PUBLIC_HOST` → `apiUrl`, `supabaseUrl`, `webUrl` in `app.config.ts` `extra` | Swapping to the real domain changes one setting |
| Tests | **vitest** (shared), **jest-expo + React Native Testing Library** (mobile), **Maestro** (end-to-end on the Android emulator), pytest (backend) | Each layer is tested where it lives |

### Decision 2026-10-28: no Expo account / EAS cloud
User: React Native, Android now, iOS later on their own Mac. So we keep the **Expo toolkit** (open-source modules, Expo Router, `expo prebuild`) but **don't depend on Expo's account or cloud**:
- **Android builds:** `npx expo prebuild` + Gradle, **locally in Docker** (`scripts/mobile/build-android.sh`), with no EAS login.
- **Push:** `expo-notifications` with **native device tokens** (`getDevicePushTokenAsync`). The backend sends through **Firebase Cloud Messaging HTTP v1** directly, not the Expo Push API, so a Firebase project is needed (free). AC8.5/8.7 change accordingly: the device-token table stores the FCM token, and errors handle `UNREGISTERED`.
- **iOS (later):** on the user's Mac, `npx expo run:ios` / Xcode from the same code (bundle id `com.jobswipe.app`). APNs goes through FCM.
- **OTA updates (EAS Update):** out of scope; optional later if an Expo account is ever created.
- Everything else in this plan (shared package, no Android-only code, tests) is unchanged.

## 6. Acceptance criteria

**[NC]** marks one that needs confirmation and **[ASSUMPTION]** one that's still unverified.

### Phase 0: foundations (no ports opened; domain in a few days)
- **AC0.1** The API host lives only in `MOBILE_PUBLIC_HOST`: `mobile/.env` for development, and EAS env for preview and production builds.
  *Test:* `scripts/mobile/check_hardcoded_hosts.sh` fails if `trycloudflare`, `ts.net`, `duckdns` or an IP appears in `mobile/` or `packages/`.
- **AC0.2** `scripts/mobile/dev.sh` runs the Expo dev server in Docker (tunnel mode, since the dev box is remote). On start it reads the **current** Cloudflare quick-tunnel URL from `docker logs jobswipe-tunnel` and sets `MOBILE_PUBLIC_HOST` from it, so the rotating URL only costs a dev-server restart. **[ASSUMPTION: `expo start --tunnel` works from the container]**
- **AC0.3** A development build of the app on the Galaxy S26 Ultra connects to the dev server and reaches the API through the tunnel.
- **AC0.4 (when the domain is bought)** Point `jobswipe.com` at the box through a **Cloudflare named tunnel**; no ports get opened. `https://jobswipe.com/api/health` returns 200 before and after a restart. Supabase `SITE_URL` and `ADDITIONAL_REDIRECT_URLS` are set to it. **Preview and production builds are blocked until this is done.**

### Phase 1: shared package (web must not change)
- **AC1.1** All of `frontend/src/lib/api.ts` moves to `packages/shared/src/api/*`, and `frontend/src/lib/api.ts` becomes a thin `createApiClient(...)` setup that re-exports. Every web import site still compiles.
  *Test:* web `tsc` passes.
- **AC1.2** `createApiClient` sends `Authorization: Bearer`, sets JSON `Content-Type` except for FormData, flattens FastAPI `detail` errors the same way as today, calls `onUnauthorized` on a 401 with a token, and returns `undefined` on 204.
  *Test:* `packages/shared/src/__tests__/client.test.ts`, with fetch mocked. These tests are written **before** moving the code and must pass against the current behavior first.
- **AC1.3** Upload helpers accept a web `Blob`/`File` **or** a React Native `{ uri, name, type }`, and build the correct `FormData`.
  *Test:* `upload.test.ts`
- **AC1.4** `mediaUrl('/supabase/x', base)` returns an absolute URL. A path that's already absolute is returned unchanged.
  *Test:* `media.test.ts`
- **AC1.5** Translations live in `packages/shared/src/i18n/locales`, and the web loads them from there. The en and he files have the same key set.
  *Test:* `i18n.test.ts` (key parity; fails on any key missing from either file)
- **AC1.6** Tailwind's `colors` and `fontFamily` come from `packages/shared/src/theme/tokens.ts`.
  *Test:* the web build CSS contains `#0E7C7B`; `tokens.test.ts` snapshots the tokens.
- **AC1.7** The feed queue logic is pure functions in `packages/shared/src/feed`: next card, undo stack, bookmark-without-swipe, no double swipe. Web `Feed.tsx` uses them.
  *Test:* `feed.test.ts`, covering the cases currently inlined in `Feed.tsx:54-240`
- **AC1.8** The web Docker build uses the repo-root context (`docker build -f frontend/Dockerfile .`). `deploy.yml` is updated, and the image works the same.
  *Test:* local `docker build` passes, and a manual smoke test of the web app covers login, feed swipe, chat and profile upload.

### Phase 2: app skeleton and auth
- **AC2.1** `mobile/` Expo app with Expo Router, NativeWind using the shared tokens, and the Fraunces and IBM Plex fonts loaded with `expo-font`. The splash screen stays up until fonts and the session are ready.
- **AC2.2** Login and register work against the same Supabase instance. A web-created account logs in on mobile and sees the same profile.
  *Test:* `auth.test.tsx` (RNTL, Supabase mocked); Maestro `login.yaml`
- **AC2.3** The session persists across app restarts, stored encrypted (AC under §5). Sign-out clears it and returns to login.
  *Test:* `session.test.ts`
- **AC2.4** A 401 from the API signs the user out (`onUnauthorized`).
  *Test:* `auth.test.tsx`
- **AC2.5** The language follows the device on first run, can be switched in the app, and persists. Hebrew lays out RTL after the required restart, with a prompt and `Updates.reloadAsync()`.
  *Test:* `i18n.test.tsx`; manual RTL check
- **AC2.6** Routing guards match web: logged out → auth; logged in with no profile → onboarding; otherwise → tabs.
  *Test:* `routing.test.tsx`
- **AC2.7** Sentry is wired from day one: JS and native crashes are reported with release and version tags, source maps are uploaded on EAS builds, and no personal data is sent (user id only, no email or message text).
  *Test:* a debug-only "crash test" button in a dev build shows up in Sentry with a readable stack trace.

### Phase 3: onboarding
- **AC3.1** Worker and employer onboarding have the same fields and validation as `Onboarding.tsx`, with the tag picker using `getTags` and `getTagCategories`.
- **AC3.2** An avatar or logo can come from the camera or the gallery, is resized and compressed before upload (max 1024px, JPEG), and asks for permission with a clear explanation.
  *Test:* `onboarding.test.tsx` (picker mocked, asserts the upload FormData shape); Maestro `onboarding.yaml`

### Phase 4: feed (the core)
- **AC4.1** Cards drag with the finger and rotate in proportion. Releasing past the threshold, or flicking past the velocity threshold, commits left or right; otherwise the card springs back. The **next card is pre-rendered** underneath.
  *Test:* `SwipeDeck.test.tsx` (threshold and velocity logic as pure functions); manual 60fps check on a low-end Android using the perf monitor
- **AC4.2** Like and pass buttons trigger the same animation as the gesture. Undo restores the last card (shared feed logic).
- **AC4.3** Bookmark saves and advances without creating a swipe, matching web behavior.
- **AC4.4** A match opens the MatchModal with a haptic. "Send message" goes to the chat.
- **AC4.5** Filters match web `FeedFilters`.
- **AC4.6** Empty, loading and error states are present and translated. Pull to refresh works.
  *Test:* `feed.test.tsx`; Maestro `swipe.yaml` (swipe 3 cards, undo 1, bookmark 1)

### Phase 5: matches and chat
- **AC5.1** The matches list shows unread counts (`getUnreadCounts`).
- **AC5.2** Chat uses an inverted FlashList, polls in the foreground only (it pauses in the background through `AppState`), sends optimistically and retries on failure. The input stays above the keyboard on both platforms.
  *Test:* `chat.test.tsx` (polling pauses on background; failed sends show retry); Maestro `chat.yaml`

### Phase 6: profile and account
- **AC6.1** View and edit the profile. CV upload uses the document picker, and the CV status polls as on web.
- **AC6.2** Notification preferences (5 types) match web.
- **AC6.3** "Export my data" writes JSON to a file and opens the share sheet.
- **AC6.4** **Delete account** is reachable within two taps from Profile, with confirmation (`deleteMyAccount`). Both stores require it.
- **AC6.5** Block and report a user (`ReportModal` equivalent).
  *Test:* `profile.test.tsx`; Maestro `delete-account.yaml` (on a throwaway user)

### Phase 7: employer screens
- **AC7.1** Job postings: list, create, edit, toggle active, delete, and **parse a job from a file** (document picker → `parseJobFiles`).
- **AC7.2** Bookmarks grouped by job posting, with move, notes, and remove.
- **AC7.3** Team: members, roles, invites. The invite link uses `webUrl` and is shared through the native share sheet. Joining works from a pasted token or code; deep links come later.
- **AC7.4** Plan screen: show the current plan, limits and expiry, **redeem a promo code** on both platforms, and an **Upgrade** button that opens the Phase 10 paywall.
  *Test:* `jobs.test.tsx`, `team.test.tsx`, `bookmarks.test.tsx`; Maestro `employer-post-job.yaml`

### Phase 8: notifications v2 (catalog, prefs per channel, push)
User requirement: **a choice for every possible activity** (a like, a message, a match, each kind of team activity, and so on), on every channel. This changes **web and mobile together**.

**Event catalog.** These replace today's 5 coarse types (`match`, `like_received`, `chat`, `team`, `account`; `backend/app/models/tables/notification.py:11`).

| Group | Event key | Who gets it | Push | Email | Today |
|---|---|---|---|---|---|
| Matches | `match.new` | both | on | on | `match` |
| Messages | `chat.message` | both | on | off | `chat` |
| Likes | `like.received` | **employers only** (decided earlier) | on | off | `like_received` |
| Team | `team.job_posted` | employer org | on | off | `team` |
| Team | `team.job_edited` | employer org | off | off | `team` |
| Team | `team.job_closed` | employer org | off | off | `team` (new trigger) |
| Team | `team.like_received` | employer org | off | off | `team` |
| Team | `team.match` | employer org | on | off | `team` |
| Team | `team.chat` | employer org | off | off | `team` |
| Team | `team.member_joined` | employer org | on | off | new |
| Team | `team.note_added` | employer org | on | off | new (bookmark note thread) |
| Jobs | `job.expiring` | employer | on | on | new (3 days before `expires_at`) |
| Jobs | `job.expired` | employer | on | on | new |
| Profile | `cv.processed` / `cv.failed` | worker | on | off | `account` |
| Discovery | `digest.new_jobs` | worker | on | on | `account` (digest) |
| Plan | `plan.expiring` / `plan.expired` | employer | on | on | new |
| Security | `account.security` | both | **always** | **always** | new; can't be turned off |

The defaults in the table are proposals. **[NC: confirm the defaults]**

- **AC8.1** `NOTIFICATION_EVENTS` is a single catalog (`backend/app/notifications/catalog.py`) holding the key, group, audience, default per channel, and whether it can be disabled. The API exposes it as `GET /api/notifications/catalog`, so web and mobile render the prefs screen **from the catalog** instead of a hardcoded list (today it's hardcoded at `frontend/src/pages/Profile.tsx:503-509`).
  *Test:* `test_notification_catalog.py` (every `notify()` call site uses a catalog key; there are en and he strings for every key)
- **AC8.2** Prefs become a per-event, per-channel matrix: migration `0XX_notification_prefs_v2.sql` replaces `notification_prefs(user_id, type, enabled)` with `(user_id, event, channel, enabled)`, where the channel is `in_app`, `push` or `email`. **Existing prefs are migrated:** a disabled `team` becomes all `team.*` disabled on every channel, and the same for the others. A missing row means the catalog default.
  *Test:* `test_notification_prefs_migration.py` (a fixture with old prefs → the expected new rows)
- **AC8.3** The prefs UI on web and mobile is grouped by section, with an in-app/push/email toggle per event, a per-group "turn all off" switch, and **quiet hours** (e.g. 22:00–08:00, push held, nothing lost). Security events show as locked on.
  *Test:* `NotificationPrefs.test.tsx` (web, vitest) and `notification-prefs.test.tsx` (mobile); Maestro `notification-prefs.yaml`
- **AC8.4** Migration: `device_tokens` (`id`, `user_id` FK, `platform`, `expo_token` unique, `locale`, `app_version`, `created_at`, `last_seen_at`), with RLS so a user sees only their own rows. `POST /api/devices` upserts a token and is idempotent; `DELETE /api/devices/{token}` is owner-only. Both require auth.
  *Test:* `backend/tests/test_device_tokens.py`
- **AC8.5** `notify()` writes the in-app row, then enqueues **Celery** tasks for push and email if the matrix allows them, so the request never blocks (async-first). Push text comes from `title_key` plus params in the device's `locale`, and `data.link` gives the deep-link route.
  *Test:* `backend/tests/test_push.py` (Expo API mocked)
- **AC8.6** **No spam:**
  - Chat pushes **collapse per conversation**, showing "3 new messages from X".
  - `like.received` and `team.*` are **batched over a 10-minute window**, showing "5 new likes on 'Barista'".
  - Quiet hours are respected.
  - Nothing gets pushed while the recipient has that chat open: the app reports the active screen, and the backend skips the push.

  *Test:* `test_push_batching.py`
- **AC8.7** Push errors: `DeviceNotRegistered` deletes the token, other errors retry with backoff (max 3), and sends are batched up to 100 per request.
  *Test:* `test_push.py`
- **AC8.8** The app **asks for push permission at a meaningful moment**: after the first swipe session or first match, with a pre-prompt screen explaining why, before the system dialog. If the user declines, the prefs screen shows "Push is off, open settings". The app registers the token on login and removes it on sign-out. Tapping a push opens the right screen, whether the app is cold-started or in the background.
  *Test:* `push.test.ts` (expo-notifications mocked; link → route mapping); manual test on a device
- **AC8.9** Android notification **channels** per group (Matches, Messages, Likes, Team, Jobs, Account), so system-level muting also works.
- **AC8.10** New triggers are implemented: `team.job_closed`, `team.member_joined`, `team.note_added`, plus Celery beat jobs for `job.expiring` and `job.expired`, `plan.expiring` and `plan.expired`, and `account.security` (password or email change).
  *Test:* one test per trigger in `test_notification_triggers.py`

### Phase 9: release
- **AC9.1** `eas.json` has `development`, `preview` (internal APK) and `production` (AAB / IPA) profiles for **both** android and ios. `production` reads the host from EAS env.
- **AC9.2** `scripts/mobile/build-android.sh` runs `eas build --local -p android --profile preview` in Docker and outputs an APK.
- **AC9.3** Play Console: app created, **Play App Signing** enabled, upload key backed up off-box, store listing in en and he, privacy policy URL, the data-safety form filled in, and the **internal testing** track live.
- **AC9.4** iOS: `ios.bundleIdentifier` is set, the `eas build -p ios --profile production` config validates, and `eas submit` is configured. It runs once the Apple account exists.
- **AC9.5** Version gate: the app sends `X-App-Version`, and the backend can return `426` with a minimum version; the app then shows an "Update required" screen.
  *Test:* `client.test.ts`, `test_app_version.py`

### Phase 10: Pro subscriptions in the app (Pro is sold everywhere)
Both stores **require their own billing** for digital subscriptions bought inside the app, with fees as of 2026-10: **Apple** 15% under $1M a year in proceeds (Small Business Program; enroll before launch), above that 30% in a subscriber's first year and 15% after; **Google** 15% on subscriptions at any size, falling to a 10% service fee plus a billing fee as the post-Epic structure rolls out by Sept 2027. Pro also stays redeemable with promo codes, and later purchasable on the web. Once in-app purchase exists, both stores allow access to Pro bought elsewhere.
- **AC10.1** Products: `pro_monthly` (and `pro_yearly` **[NC]**) are set up in Play Console and App Store Connect and grouped in RevenueCat under the entitlement `pro`. In-app prices may differ from web prices. **[NC: price]**
- **AC10.2** The paywall screen shows Free vs Pro limits (from `getPlan`), localized store prices, purchase, **restore purchases** (required by Apple), and links to the terms and privacy pages.
  *Test:* `paywall.test.tsx` (RevenueCat SDK mocked: success, cancel, pending, error)
- **AC10.3** Purchases are tied to the **org** (team plan) or the solo employer. The RevenueCat app user id is the subject id, so a teammate's purchase gives the whole org Pro on web and mobile.
- **AC10.4** `POST /api/billing/revenuecat/webhook` (shared-secret auth) handles INITIAL_PURCHASE, RENEWAL, CANCELLATION, EXPIRATION and BILLING_ISSUE, and upserts `pro_grants` with `source='billing'` plus `store` and `store_txn_id`. It's idempotent on the event id.
  *Test:* `backend/tests/test_billing_webhook.py` (fixture events → grant state)
- **AC10.5** Plan resolution takes the **most generous** active grant from promo codes, admin grants and billing. Promo-code Pro and paid Pro don't conflict.
  *Test:* `test_plan_resolution.py`
- **AC10.6** The app never trusts the client: Pro features are enforced by the backend only, and the app just re-fetches `getPlan` after a purchase.
- **AC10.7** Store-review requirements are met:
  - auto-renew disclosure text,
  - a manage-subscription link (the Play or App Store subscription page),
  - no mention of cheaper web prices inside the iOS app.
- **AC10.9 Worker plan (job seekers, about $3–5 a month; user decision 2026-10-11).** A second entitlement, `worker_pro`, with its own products. The paywall is role-aware. **BLOCKED until an Israeli legal opinion:** the Employment Service Law (1959, §69C and the 2006 payment regulations) bars a private placement agency from charging a job seeker for job placement, "directly or indirectly". Whether JobSwipe's matching counts as job brokerage (תיווך עבודה), and which perks (if any) can be sold, is a question for an employment lawyer. Build the plumbing generically; ship the worker products only after that opinion.
  **Worker Pro contents (user decision 2026-10-11): the AI system is premium-only.**
  - **Free workers:** swipe, match and chat; enter skill tags by hand (TagPicker); upload a CV as a file only, with **no AI extraction**.
  - **Worker Pro:**
    - AI CV extraction (auto-fills tags),
    - **AI skill expansion** (CUDA → C++, GPU programming, parallel computing…), with suggestions the worker confirms before they count,
    - match insights.
  - **New backend work:** gate `routers/cv.py` and `tasks/cv_processing.py` on `pro_status` (today they're free for all, with only a daily quota), plus a 402 response and an upsell in web and mobile.
  - **Employers too (decided 2026-10-11):** job-file and description AI parsing (`parseJobFiles`, `routers/cv.py:109,180`) is **Pro-only**. Free employers write the job by hand and keep **1 free live job** (`FREE_LIVE_JOBS=1`, permanent; no longer "flip to 0 when billing lands"). Making AI Pro-only means bots and fake accounts can't burn LLM budget, and the 1-job limit caps spam per account.
  - **Tests:** `test_ai_gating.py`: a free worker or employer calling any LLM endpoint gets 402 `pro_required` and no LLM call is made (quota untouched); a Pro user gets it, still within the daily quota.
- **AC10.8** Sandbox test purchase on Play (license tester) end to end: purchase, then Pro on mobile **and on web** for the same org.

### Quality bar (applies to every phase)
- **Q1** Hebrew RTL is correct on every screen: icons that should flip do, and numbers and Latin text don't break the layout.
- **Q2** Light theme only for v1, because the web has no dark mode. All colors come from `tokens.ts`, so dark mode can be added later in one place.
- **Q3** Touch targets are at least 44pt. Screen-reader labels mirror the web `aria-label`s.
- **Q4** Cold start under 2.5s. The main device is a **Galaxy S26 Ultra**, plus one **low-end emulator profile** (2–3 GB RAM, older Android) run before each release, since many Israeli users are on Galaxy A-series phones.
- **Q5** No crash in Maestro flows; Sentry is in from Phase 2 (AC2.7).

## 7. Test plan

### Commands (everything runs in Docker; no local Node)
```bash
# Shared package (vitest)
scripts/mobile/run.sh "npm -w packages/shared test"

# Web still builds and typechecks after the move
scripts/mobile/run.sh "npm -w frontend run build"
docker build -f frontend/Dockerfile -t jobswipe-frontend:test .

# Mobile unit and component tests (jest-expo + RNTL)
scripts/mobile/run.sh "npm -w mobile test"

# Mobile typecheck and lint
scripts/mobile/run.sh "npm -w mobile run typecheck && npm -w mobile run lint"

# Dev server for the phone (development build installed on the device)
scripts/mobile/dev.sh            # expo start --dev-client --tunnel

# Local Android build (preview APK)
scripts/mobile/build-android.sh

# End-to-end on the Android emulator (needs KVM on the dev box) [ASSUMPTION]
scripts/mobile/e2e.sh            # maestro test mobile/.maestro/

# Backend (existing recipe, docs/NEXT_SESSION_PLAN.md:185-200)
docker build -t jobswipe-backend:test ./backend
docker run --rm --env-file .env jobswipe-backend:test python -m pytest -q
```
`scripts/mobile/run.sh` is a thin wrapper: `docker run --rm -v $PWD:/repo -w /repo node:22 sh -c "npm ci && $1"` (Node version to match Expo SDK). **[ASSUMPTION]**

### TDD loop per phase
1. Write failing unit and component tests for the phase's ACs, plus the Maestro flow.
2. Implement until they pass.
3. Run the full shared, web and mobile suites and the backend suite.
4. Run the device checklist on a **real Android phone** (one mid-range model) plus the emulator.

### Device checklist (per release)
- [ ] Fresh install → register → confirm email → onboarding with a camera photo → feed
- [ ] Swipe is smooth (no dropped frames visible); undo, bookmark and match modal all work
- [ ] Chat in both directions with the keyboard open; the app goes to the background and polling stops
- [ ] Push arrives with the app backgrounded and when it's killed; tapping it opens the right chat or match
- [ ] Employer: post a job from a PDF, bookmark a worker, invite a teammate through the share sheet
- [ ] Hebrew RTL on every tab; switch language and back
- [ ] Delete account works, and that user can't log in afterwards
- [ ] The same account on web shows identical data

## 8. Pointers

- `frontend/src/lib/api.ts` (all; `:176` base URL, `:200-235` request core, `:400-460` uploads)
- `frontend/src/lib/supabase.ts`, `frontend/src/context/AuthContext.tsx`, `frontend/src/hooks/useAuth.ts`
- `frontend/src/locales/{en,he}.json`, `frontend/src/i18n.ts`
- `frontend/tailwind.config.js` (tokens and keyframes)
- `frontend/src/pages/Feed.tsx:54-240`, `frontend/src/components/SwipeCard.tsx`, `frontend/src/hooks/useSwipe.ts`, `frontend/src/components/MatchModal.tsx`
- `frontend/src/pages/{Onboarding,Matches,Chat,Profile,Jobs,Bookmarks,Team,JoinOrg}.tsx`: screen specs to mirror
- `frontend/src/components/{Navbar,NotificationBell,TagPicker,ReportModal,PlanCard,Icon}.tsx`
- `frontend/Dockerfile`, `frontend/vite.config.ts`, `.github/workflows/deploy.yml:41-47` (build context)
- `backend/app/services/notifications.py`, `backend/app/models/tables/notification.py`, `backend/app/tasks/notifications.py`: push hook
- `backend/app/routers/uploads.py:21-34`, `backend/app/config.py:22-29`
- `backend/app/routers/gdpr.py`: account deletion and export
- `/home/ivan/supabase/docker/.env:119-120`: `SITE_URL`, redirect allowlist

## 9. Risks

| Risk | Mitigation |
|---|---|
| **Hebrew RTL in React Native**: `I18nManager.forceRTL` needs an app reload, and some components don't mirror | Switch language → prompt → `reloadAsync()`. Use logical styles (`start`/`end`, `ms`/`me` in NativeWind). RTL is in the checklist for every screen. |
| Moving `api.ts` breaks the web | Characterization tests (AC1.2) are written **before** the move. Phase 1 ships alone, and web is smoke-tested before any mobile work. |
| Two UIs drift apart in features | Shared API, types and feed logic. A new feature's TDP must say "web + mobile" or explicitly "web only". |
| **Store billing rules and the 15% fee** | Use the stores' own billing in the app (Phase 10), as both require. Promo codes and web purchases stay valid because in-app purchase exists. App Review rejects missing restore or disclosure text, so AC10.7 is a checklist. |
| Store merchant setup from Israel | Play Console payments profile plus Apple Paid Apps agreement, bank and tax forms. Start these early; they can take days. |
| Notification migration loses user choices | AC8.2 migration test; old `type` prefs map onto every new event in their group |
| Old app versions after API changes | Backward-compatible API changes, `X-App-Version` plus the 426 gate (AC9.5), and EAS Update for JS fixes |
| EAS free tier limits | Android builds run locally in Docker; only iOS uses cloud builds |
| Domain delayed | Phases 1–8 run on development builds over the tunnel; only Phase 9+ needs the domain |
| Losing the Android upload key | Play App Signing, plus a key backup off-box (password manager) |
| Emulator / Maestro needs KVM on the dev box | Check `/dev/kvm`. Fallback: run Maestro against a USB phone, or Maestro Cloud. |
| Workload for a solo dev | Phases are shippable increments. An internal test build is possible after Phase 5 (worker flow complete). |

## 10. Decisions (2026-10-11)

| # | Question | Decision |
|---|---|---|
| 1 | Temporary host | **None.** No ports opened; wait for the domain (a few days). Development uses the quick tunnel. |
| 2 | Domain and app ID | **`jobswipe.com`** (planned purchase). App and bundle ID **`com.jobswipe.app`**. |
| 3 | Pro in the app | **Sold everywhere**, including inside the app (Phase 10, store billing). Promo codes on both platforms. |
| 4 | Notifications | Ask for push permission (at a meaningful moment). **A choice for every activity** on every channel (Phase 8 catalog). |
| 5 | Employer scope v1 | **All of it** (Phase 7). |
| 6 | Sentry | **Yes** (AC2.7). |
| 7 | Test device | **Galaxy S26 Ultra**, plus a low-end emulator profile. |
| – | Dark mode | Light only for v1, because the web has none. |

### Still open (needed before the phase noted, not before Phase 1)
- **Phase 0.4:** check that `jobswipe.com` is actually available. If it's taken, only `MOBILE_PUBLIC_HOST` changes; the app ID can stay `com.jobswipe.app`.
- **Phase 8:** confirm the default on/off values in the event catalog table.
- **Phase 10:** Pro price (₪/month, and yearly?), and whether in-app prices match the web.

## 11. Domain checklist (when `jobswipe.com` is bought)

- [ ] DNS and a named Cloudflare tunnel → `/api/health` OK
- [ ] `MOBILE_PUBLIC_HOST` in EAS env set to `jobswipe.com` (unblocks preview and production builds)
- [ ] Supabase `SITE_URL` and `ADDITIONAL_REDIRECT_URLS`
- [ ] Android App Links: `intentFilters` in `app.config.ts` plus `/.well-known/assetlinks.json` (Play signing fingerprint)
- [ ] iOS Universal Links: `associatedDomains` plus `/.well-known/apple-app-site-association`
- [ ] Invite and email links open the app (`/join`, `/login`)
- [ ] Web `CORS_ORIGINS` and Caddy include `https://jobswipe.com`


## Work log

### 2026-10-29: P0 done, P1 mostly done
**P0 (#2242, closed):**
- `mobile/` Expo SDK 58 / RN 0.88 app; start screen loads the skill categories from the real API; 5 tests written first.
- `scripts/mobile/build-android.sh` builds a sideloadable release APK in Docker (no Expo account).
- Installed on the user's Galaxy S26 Ultra: "Connected… 8 skill categories loaded".

**P1 (#2243), test-first at every step:**
1. `28d98c0`: 13 characterization tests for the web API client.
2. `4833b64`: the API client moves to `packages/shared/src/api`.
   - `configureApi({ baseUrl, onUnauthorized })` replaces `import.meta.env` and the window event.
   - Uploads accept a browser File or React Native `{ uri, name, type }`.
   - The web `src/lib/api.ts` is a small setup that re-exports. The 13 tests pass unchanged, and there are 5 new shared tests.
   - The web image builds from the repo root, with a root `.dockerignore` allowlist (frontend/, packages/ only).
3. `271c5f7`: en/he translations move to `packages/shared/src/i18n/locales`. The parity test passes, so the translations are complete.
4. this commit: Harbor colors and fonts become `packages/shared/src/theme`, and Tailwind reads them. The built CSS is byte-identical.

**Changed scope:**
- The pure feed logic (AC1.7: undo, bookmark-swipe, no double swipe) moves to **P4**, where the mobile feed is built, with characterization tests on `Feed.tsx` first. Extracting it now, with no second user, would be a refactor without a consumer.
- The mobile app starts importing `@jobswipe/shared` in **P2** (Metro/Jest/TS alias).
