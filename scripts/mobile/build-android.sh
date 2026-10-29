#!/usr/bin/env bash
# Build an installable Android APK of the mobile app, locally in Docker.
# No Expo account, no cloud: `expo prebuild` generates mobile/android, then
# Gradle builds a release APK with the JavaScript bundled inside, so the
# phone needs no dev server.
#
#   scripts/mobile/build-android.sh --api-url https://<host>/api
#
# Output: mobile/build/jobswipe-<version>.apk
# The API address is baked in at build time (EXPO_PUBLIC_API_URL). Until the
# real domain exists, use the current tunnel URL, which changes on restart.
# Release APKs are signed with the debug key from the template: fine for
# sideloading onto test phones, NOT for Google Play (Mobile P9 adds a real key).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_URL="${MOBILE_API_URL:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --api-url) API_URL="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

if [ -z "$API_URL" ]; then
  echo "Missing --api-url (e.g. https://<host>/api)." >&2
  exit 2
fi
case "$API_URL" in
  https://*) ;;
  *) echo "The API URL must be https:// (Android blocks plain http by default)." >&2; exit 2 ;;
esac

VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/mobile/app.json'))['expo']['version'])")"
IMAGE=reactnativecommunity/react-native-android:latest

echo "==> Building JobSwipe $VERSION for Android (API: $API_URL)"
# Named volumes keep the Gradle cache and any SDK/NDK downloads between builds.
docker run --rm \
  -v "$ROOT/mobile":/app -w /app \
  -v jobswipe-gradle:/root/.gradle \
  -v jobswipe-android-sdk:/opt/android \
  -e EXPO_PUBLIC_API_URL="$API_URL" \
  -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -e VERSION="$VERSION" \
  "$IMAGE" bash -euo pipefail -c '
    trap "chown -R $HOST_UID:$HOST_GID /app/android /app/build /app/.expo 2>/dev/null || true" EXIT
    npm ci --no-audit --no-fund --loglevel=error
    npx expo prebuild --platform android --clean --no-install
    cd android
    ./gradlew assembleRelease --no-daemon -q
    mkdir -p /app/build
    cp app/build/outputs/apk/release/app-release.apk "/app/build/jobswipe-$VERSION.apk"
  '

APK="$ROOT/mobile/build/jobswipe-$VERSION.apk"
echo "==> Done: $APK ($(du -h "$APK" | cut -f1))"
