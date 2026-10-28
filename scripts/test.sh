#!/usr/bin/env bash
# Run every test suite the project has, in Docker (no local Python/Node needed).
# Used by CI (.github/workflows/test.yml) and by scripts/deploy_oracle.sh,
# so "tests pass" means the same thing everywhere.
#
#   scripts/test.sh              # backend tests + frontend build + script tests
#   scripts/test.sh --backend    # backend tests only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ONLY="${1:-all}"

backend() {
  echo "==> Backend tests"
  docker build -q -t jobswipe-backend:test ./backend > /dev/null
  # Settings require these four values; the tests never reach a real Supabase.
  docker run --rm \
    -e SUPABASE_URL=http://supabase.invalid \
    -e SUPABASE_SERVICE_KEY=test \
    -e SUPABASE_ANON_KEY=test \
    -e SUPABASE_JWT_SECRET=test-jwt-secret-at-least-32-characters \
    jobswipe-backend:test python -m pytest -q -p no:warnings
}

frontend() {
  # No frontend tests yet (vitest arrives with Mobile P1); the production
  # build still catches type errors and broken imports.
  echo "==> Frontend build"
  docker build -q -t jobswipe-frontend:test ./frontend > /dev/null
}

scripts() {
  echo "==> Script tests"
  bash scripts/tests/test_deploy_oracle.sh
}

case "$ONLY" in
  all) backend; frontend; scripts ;;
  --backend) backend ;;
  --frontend) frontend ;;
  --scripts) scripts ;;
  *) echo "Usage: $0 [--backend|--frontend|--scripts]" >&2; exit 2 ;;
esac

echo "==> All checks passed"
