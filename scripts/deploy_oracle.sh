#!/usr/bin/env bash
# Deploy the current commit to the Oracle box. Tests run first; any failure
# stops the deploy before a single file is copied.
#
#   scripts/deploy_oracle.sh             # test, show what changes, ask, deploy
#   scripts/deploy_oracle.sh --dry-run   # test and list files, copy nothing
#   scripts/deploy_oracle.sh --yes       # no confirmation prompt
#
# Copies only git-tracked files (like the original setup), so the server-only
# .env, docker-compose.override.yml and backend/credentials/ are never touched.
# The Supabase stack and the tunnel container are not restarted (restarting
# the quick tunnel would change the public URL).
#
# Env overrides (used by scripts/tests/test_deploy_oracle.sh):
#   TEST_CMD            test runner (default: scripts/test.sh)
#   DEPLOY_HOST         ssh host (default: jobswipe-oracle)
#   DEPLOY_DIR          remote dir (default: ~/jobswipe)
#   DEPLOY_ALLOW_DIRTY  1 = allow uncommitted changes
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

TEST_CMD="${TEST_CMD:-$ROOT/scripts/test.sh}"
HOST="${DEPLOY_HOST:-jobswipe-oracle}"
DIR="${DEPLOY_DIR:-~/jobswipe}"
DRY_RUN=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --yes) ASSUME_YES=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Files that exist only on the server and must never be overwritten.
EXCLUDE_RE='(^|/)\.env$|^docker-compose\.override\.yml$|^backend/credentials/'

if [ "${DEPLOY_ALLOW_DIRTY:-0}" != "1" ] && [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Uncommitted changes. Commit first, so the server runs a known commit." >&2
  echo "(Set DEPLOY_ALLOW_DIRTY=1 to override.)" >&2
  exit 1
fi

COMMIT="$(git rev-parse --short HEAD)"

echo "==> Running tests before deploying $COMMIT"
if ! "$TEST_CMD"; then
  echo "Tests failed. Nothing was deployed." >&2
  exit 1
fi

FILES="$(git ls-files | grep -vE "$EXCLUDE_RE")"

if [ "$DRY_RUN" = "1" ]; then
  echo "==> Dry run: would copy $(echo "$FILES" | wc -l) files to $HOST:$DIR"
  echo "$FILES"
  exit 0
fi

# Show what changed since the last deploy, and flag migrations: they are
# applied by hand and must run before the new code starts.
LAST="$(ssh "$HOST" "cat $DIR/.deployed_commit 2>/dev/null" || true)"
if [ -n "$LAST" ] && git cat-file -e "$LAST^{commit}" 2>/dev/null; then
  echo "==> Changes since last deploy ($LAST):"
  git log --oneline "$LAST..HEAD" | sed 's/^/    /'
  MIGRATIONS="$(git diff --name-only "$LAST" HEAD -- supabase/migrations)"
  if [ -n "$MIGRATIONS" ]; then
    echo "!!  New or changed migrations. Apply them on the server first:"
    echo "$MIGRATIONS" | sed 's/^/    /'
  fi
else
  echo "==> No record of the last deployed commit; deploying $COMMIT."
fi

if [ "$ASSUME_YES" != "1" ]; then
  read -r -p "Deploy $COMMIT to $HOST? [y/N] " answer
  [ "$answer" = "y" ] || [ "$answer" = "Y" ] || { echo "Cancelled."; exit 1; }
fi

echo "==> Copying files"
echo "$FILES" | rsync -az --files-from=- ./ "$HOST:$DIR/"

echo "==> Rebuilding and restarting app services"
ssh "$HOST" "cd $DIR && docker compose up -d --build backend celery frontend caddy"

ssh "$HOST" "echo $COMMIT > $DIR/.deployed_commit"

echo "==> Health check"
if ssh "$HOST" "for i in \$(seq 1 30); do docker inspect -f '{{.State.Health.Status}}' jobswipe-backend 2>/dev/null | grep -q healthy && exit 0; sleep 2; done; exit 1"; then
  echo "==> Deployed $COMMIT. Backend is healthy."
else
  echo "!!  Deployed $COMMIT, but the backend isn't healthy. Check: ssh $HOST 'docker logs jobswipe-backend'" >&2
  exit 1
fi
