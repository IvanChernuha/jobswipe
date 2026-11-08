#!/usr/bin/env bash
# Give a TEST account a known password, so the app can be tried as that user.
# Refuses any address outside the test domains: never real users.
#
#   scripts/set_demo_password.sh local  alice.chen@demo.com 'Password1!'
#   scripts/set_demo_password.sh oracle alice.chen@demo.com 'Password1!'
#
# Runs inside the backend container (it has SUPABASE_URL and the service key)
# and calls Supabase's admin API.
set -euo pipefail

TARGET="${1:-}" EMAIL="${2:-}" PASSWORD="${3:-}"
if [ -z "$TARGET" ] || [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  sed -n '2,9p' "$0"; exit 2
fi
case "$EMAIL" in
  *@demo.com|*@test.com|*@jobswipe.dev) ;;
  *) echo "Refusing: $EMAIL is not a test account (@demo.com, @test.com, @jobswipe.dev)." >&2; exit 1 ;;
esac
[ "${#PASSWORD}" -ge 8 ] || { echo "Password must be at least 8 characters." >&2; exit 1; }

PY='
import json, os, sys, urllib.request
email, password = sys.argv[1], sys.argv[2]
base, key = os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_KEY"]
h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
def call(method, path, body=None):
    req = urllib.request.Request(base + path, method=method, headers=h,
                                 data=json.dumps(body).encode() if body else None)
    return json.load(urllib.request.urlopen(req))
page = 1
while True:
    users = call("GET", f"/auth/v1/admin/users?page={page}&per_page=200").get("users", [])
    match = [u for u in users if u.get("email") == email]
    if match or not users:
        break
    page += 1
if not match:
    sys.exit(f"No account {email}")
uid = match[0]["id"]
call("PUT", f"/auth/v1/admin/users/{uid}", {"password": password, "email_confirm": True})
print(f"Password set for {email}")
'

case "$TARGET" in
  local)  docker exec -i jobswipe-backend python -c "$PY" "$EMAIL" "$PASSWORD" ;;
  oracle) ssh jobswipe-oracle "docker exec -i jobswipe-backend python -c $(printf '%q' "$PY") $(printf '%q' "$EMAIL") $(printf '%q' "$PASSWORD")" ;;
  *) echo "Target must be local or oracle." >&2; exit 2 ;;
esac
