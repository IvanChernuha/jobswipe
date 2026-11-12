#!/usr/bin/env bash
# Build an installable Android APK of the mobile app, locally in Docker.
# No Expo account, no cloud: `expo prebuild` generates mobile/android, then
# Gradle builds a release APK with the JavaScript bundled inside, so the
# phone needs no dev server.
#
#   scripts/mobile/build-android.sh --host https://<host>             # test build
#   scripts/mobile/build-android.sh --host https://<host> --all-abis  # every CPU type
#   scripts/mobile/build-android.sh --host https://<host> --clean     # from scratch
#
# Test builds are fast: arm64 only (every current phone), and the previous
# build is reused. JS packages are reinstalled only when package-lock.json
# changes, and the Android project is regenerated from scratch only when the
# native setup (packages, app.json apart from the version) changes.
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
ABIS=arm64-v8a
CLEAN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 ;;
    --all-abis) ABIS=armeabi-v7a,arm64-v8a,x86,x86_64; shift ;;
    --clean) CLEAN=1; shift ;;
    -h|--help) sed -n '2,24p' "$0"; exit 0 ;;
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

echo "==> Building JobSwipe $VERSION for Android ($ABIS, server: $HOST)"
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
  -e VERSION="$VERSION" -e ABIS="$ABIS" -e CLEAN="$CLEAN" \
  "$IMAGE" bash -euo pipefail -c '
    # Files created as root inside the container go back to the host user.
    trap "chown -R $HOST_UID:$HOST_GID /repo/mobile/node_modules /repo/mobile/android /repo/mobile/build /repo/mobile/.expo 2>/dev/null || true" EXIT
    # JS packages: reinstall only when the lockfile changed.
    lock_hash=$(sha256sum package-lock.json | cut -d" " -f1)
    if [ "$CLEAN" = 1 ] || [ "$(cat node_modules/.jobswipe-lock-hash 2>/dev/null)" != "$lock_hash" ]; then
      echo "==> Installing JS packages"
      npm ci --no-audit --no-fund --loglevel=error
      echo "$lock_hash" > node_modules/.jobswipe-lock-hash
    fi
    # Android project: regenerate from scratch only when the native setup
    # changed (packages, or app.json apart from the version numbers); else
    # update it in place and keep the compiled native code.
    native_hash=$( { cat package-lock.json; node -e "
      const a = require(\"./app.json\"); delete a.expo.version; delete a.expo.android.versionCode
      process.stdout.write(JSON.stringify(a))"; } | sha256sum | cut -d" " -f1)
    if [ "$CLEAN" = 1 ] || [ "$(cat android/.jobswipe-native-hash 2>/dev/null)" != "$native_hash" ]; then
      echo "==> Generating the Android project from scratch"
      npx expo prebuild --platform android --clean --no-install
    else
      echo "==> Updating the Android project (keeping compiled code)"
      npx expo prebuild --platform android --no-install
    fi
    echo "$native_hash" > android/.jobswipe-native-hash
    cd android
    ./gradlew assembleRelease --no-daemon --build-cache -q \
      -PreactNativeArchitectures="$ABIS" \
      -Dorg.gradle.jvmargs="-Xmx6g -XX:MaxMetaspaceSize=1g"
    mkdir -p ../build
    cp app/build/outputs/apk/release/app-release.apk "../build/jobswipe-$VERSION.apk"
  '

APK="$ROOT/mobile/build/jobswipe-$VERSION.apk"
echo "==> Done: $APK ($(du -h "$APK" | cut -f1))"
