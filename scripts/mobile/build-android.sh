#!/usr/bin/env bash
# Build an installable Android APK of the mobile app, locally in Docker.
# No Expo account, no cloud: `expo prebuild` generates mobile/android, then
# Gradle builds a release APK with the JavaScript bundled inside, so the
# phone needs no dev server.
#
#   scripts/mobile/build-android.sh --host https://<host>
#
# The app then talks to <host>/api (backend) and <host>/supabase (login),
# the same paths the website uses. Until the real domain exists, use the
# current tunnel URL, which changes on restart.
# The Supabase anon key (public by design: the website ships it too) comes
# from MOBILE_SUPABASE_ANON_KEY, else frontend/.env (VITE_SUPABASE_ANON_KEY).
#
# Output: mobile/build/jobswipe-<version>.apk
# Release APKs are signed with the debug key from the template: fine for
# sideloading onto test phones, NOT for Google Play (Mobile P9 adds a real key).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="${MOBILE_HOST:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

HOST="${HOST%/}"
if [ -z "$HOST" ]; then
  echo "Missing --host (e.g. https://<host>)." >&2
  exit 2
fi
case "$HOST" in
  https://*) ;;
  *) echo "The host must be https:// (Android blocks plain http by default)." >&2; exit 2 ;;
esac

ANON_KEY="${MOBILE_SUPABASE_ANON_KEY:-$(grep -E '^VITE_SUPABASE_ANON_KEY=' "$ROOT/frontend/.env" 2>/dev/null | cut -d= -f2- || true)}"
if [ -z "$ANON_KEY" ]; then
  echo "No Supabase anon key: set MOBILE_SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY in frontend/.env." >&2
  exit 2
fi

VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/mobile/app.json'))['expo']['version'])")"
IMAGE=reactnativecommunity/react-native-android:latest

echo "==> Building JobSwipe $VERSION for Android (server: $HOST)"
# The whole repo is mounted because the app imports packages/shared.
# Named volumes keep the Gradle cache and any SDK/NDK downloads between builds.
docker run --rm \
  -v "$ROOT":/repo -w /repo/mobile \
  -v jobswipe-gradle:/root/.gradle \
  -v jobswipe-android-sdk:/opt/android \
  -e EXPO_PUBLIC_API_URL="$HOST/api" \
  -e EXPO_PUBLIC_SUPABASE_URL="$HOST/supabase" \
  -e EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -e VERSION="$VERSION" \
  "$IMAGE" bash -euo pipefail -c '
    # Files created as root inside the container go back to the host user.
    trap "chown -R $HOST_UID:$HOST_GID node_modules android build .expo 2>/dev/null || true" EXIT
    npm ci --no-audit --no-fund --loglevel=error
    npx expo prebuild --platform android --clean --no-install
    cd android
    ./gradlew assembleRelease --no-daemon -q
    mkdir -p ../build
    cp app/build/outputs/apk/release/app-release.apk "../build/jobswipe-$VERSION.apk"
  '

APK="$ROOT/mobile/build/jobswipe-$VERSION.apk"
echo "==> Done: $APK ($(du -h "$APK" | cut -f1))"
