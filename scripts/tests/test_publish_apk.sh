#!/usr/bin/env bash
# publish-apk.sh: puts the built app where the website's /app page offers it,
# and never publishes a debug-signed build. Runs locally into a temp folder
# with a fake signature checker; nothing is uploaded.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/mobile/publish-apk.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails+1)); }

VERSION="$(python3 -c "import json;print(json.load(open('$ROOT/mobile/app.json'))['expo']['version'])")"
head -c 3145728 /dev/urandom > "$T/app.apk"   # 3 MB
printf '#!/bin/sh\necho "Signer #1 certificate DN: CN=JobSwipe, O=JobSwipe, C=IL"\n' > "$T/release-signer"
printf '#!/bin/sh\necho "Signer #1 certificate DN: C=US, O=Android, CN=Android Debug"\n' > "$T/debug-signer"
chmod +x "$T/release-signer" "$T/debug-signer"

run() { APK_PATH="$T/app.apk" DOWNLOADS_DIR="$T/out" APKSIGNER="$1" NO_QR=1 bash "$SCRIPT" local 2>&1; }

out="$(run "$T/release-signer")"; code=$?
if [ $code = 0 ] && [ -f "$T/out/jobswipe.apk" ] && cmp -s "$T/app.apk" "$T/out/jobswipe.apk"; then pass "publishes the release-signed app as jobswipe.apk"; else fail "publish (exit $code): $out"; fi
if python3 - "$T/out/latest.json" "$VERSION" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
assert d["version"] == sys.argv[2], d
assert d["file"] == "jobswipe.apk", d
assert d["size_mb"] == 3.0, d
assert len(d["sha256"]) == 64 and d["updated_at"], d
PY
then pass "latest.json has version, size, file, checksum and date"; else fail "latest.json content"; fi

rm -rf "$T/out"
out="$(run "$T/debug-signer")"; code=$?
if [ $code != 0 ] && [ ! -e "$T/out/jobswipe.apk" ] && echo "$out" | grep -q "debug key"; then pass "refuses a debug-signed app"; else fail "debug-signed (exit $code): $out"; fi

out="$(APK_PATH="$T/nope.apk" DOWNLOADS_DIR="$T/out" APKSIGNER="$T/release-signer" NO_QR=1 bash "$SCRIPT" local 2>&1)"; code=$?
if [ $code != 0 ] && echo "$out" | grep -q "No app file"; then pass "says so when the app isn't built"; else fail "missing apk (exit $code): $out"; fi

[ "$fails" = 0 ] && echo "All publish-apk tests passed." || exit 1
