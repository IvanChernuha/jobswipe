#!/usr/bin/env bash
# Publish the built Android app to the website's /app download page.
#
#   scripts/mobile/publish-apk.sh local                         # ./downloads (local site)
#   scripts/mobile/publish-apk.sh oracle --host https://<host>  # the live site
#
# Takes mobile/build/jobswipe-<version>.apk (version from mobile/app.json),
# refuses it unless it is signed with our release key (never the debug key:
# people who install it must be able to get updates), and writes next to it:
#   jobswipe.apk  latest.json (version, size, checksum, date)  qr.png (--host/app)
# On Oracle the files go to ~/jobswipe/downloads, which the frontend serves at
# /downloads (docker-compose volume); the deploy never touches that folder.
#
# Env overrides (used by scripts/tests/test_publish_apk.sh):
#   APK_PATH       the app file (default: mobile/build/jobswipe-<version>.apk)
#   DOWNLOADS_DIR  where "local" publishes (default: ./downloads)
#   APKSIGNER      command that prints an APK's signer certificates
#   NO_QR=1        skip the QR code
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-}"; shift || true
HOST=""
while [ $# -gt 0 ]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
HOST="${HOST%/}"
case "$TARGET" in
  local) ;;
  oracle) [ -n "$HOST" ] || { echo "oracle needs --host https://<host> (for the QR code)." >&2; exit 2; } ;;
  *) sed -n '2,6p' "$0"; exit 2 ;;
esac

VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/mobile/app.json'))['expo']['version'])")"
APK="${APK_PATH:-$ROOT/mobile/build/jobswipe-$VERSION.apk}"
[ -f "$APK" ] || { echo "No app file for $VERSION at $APK: build it first (scripts/mobile/build-android.sh)." >&2; exit 1; }

# Signed with our key, not the template's debug key?
apksigner_docker() {
  docker run --rm -v jobswipe-android-sdk:/opt/android -v "$(dirname "$1")":/apk:ro \
    reactnativecommunity/react-native-android:latest sh -c \
    "\$(ls -d /opt/android/build-tools/* | sort -V | tail -1)/apksigner verify --print-certs /apk/$(basename "$1")"
}
certs="$(${APKSIGNER:-apksigner_docker} "$APK")"
if echo "$certs" | grep -q "CN=Android Debug"; then
  echo "Refusing: $APK is signed with the debug key. Build with the release key (~/.config/jobswipe/signing)." >&2
  exit 1
fi
echo "$certs" | grep -q "CN=" || { echo "Couldn't read the app's signature." >&2; exit 1; }

STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
cp "$APK" "$STAGE/jobswipe.apk"
python3 - "$STAGE" "$VERSION" <<'PY'
import hashlib, json, os, sys
from datetime import datetime, timezone
stage, version = sys.argv[1], sys.argv[2]
apk = os.path.join(stage, "jobswipe.apk")
sha = hashlib.sha256(open(apk, "rb").read()).hexdigest()
json.dump({
    "version": version, "file": "jobswipe.apk", "sha256": sha,
    "size_mb": round(os.path.getsize(apk) / 1048576, 1),
    "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
}, open(os.path.join(stage, "latest.json"), "w"), indent=2)
PY
if [ "${NO_QR:-0}" != 1 ] && [ -n "$HOST" ]; then
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$STAGE":/out python:3.12-alpine sh -c \
    "pip install -q --user segno 2>/dev/null && python -c \"import segno; segno.make('$HOST/app', error='m').save('/out/qr.png', scale=8, border=2)\""
fi

case "$TARGET" in
  local)
    DEST="${DOWNLOADS_DIR:-$ROOT/downloads}"
    mkdir -p "$DEST"
    cp "$STAGE"/* "$DEST"/
    echo "==> Published $VERSION to $DEST"
    ;;
  oracle)
    # The app first (under a temporary name, then renamed), latest.json last,
    # so the page never offers a half-uploaded file.
    ssh jobswipe-oracle "mkdir -p ~/jobswipe/downloads"
    scp -q "$STAGE/jobswipe.apk" jobswipe-oracle:jobswipe/downloads/.jobswipe.apk.part
    ssh jobswipe-oracle "mv ~/jobswipe/downloads/.jobswipe.apk.part ~/jobswipe/downloads/jobswipe.apk"
    [ -f "$STAGE/qr.png" ] && scp -q "$STAGE/qr.png" jobswipe-oracle:jobswipe/downloads/qr.png
    scp -q "$STAGE/latest.json" jobswipe-oracle:jobswipe/downloads/latest.json
    echo "==> Published $VERSION: $HOST/app"
    ;;
esac
