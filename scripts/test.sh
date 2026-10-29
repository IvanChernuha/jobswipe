#!/usr/bin/env bash
# Run every test suite the project has, in Docker (no local Python/Node needed).
# Used by CI (.github/workflows/test.yml) and by scripts/deploy_oracle.sh,
# so "tests pass" means the same thing everywhere.
#
#   scripts/test.sh              # backend, frontend, mobile and script tests
#   scripts/test.sh --backend    # backend tests only
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ONLY="${1:-all}"

TEST_NET=jobswipe-test-net
TEST_DB=jobswipe-test-db

stop_test_db() {
  docker rm -f "$TEST_DB" > /dev/null 2>&1 || true
  docker network rm "$TEST_NET" > /dev/null 2>&1 || true
}

start_test_db() {
  # Throwaway Postgres for tests/integration; never the dev or live database.
  stop_test_db
  trap stop_test_db EXIT
  docker network create "$TEST_NET" > /dev/null
  docker run -d --rm --name "$TEST_DB" --network "$TEST_NET" \
    -e POSTGRES_PASSWORD=test -e POSTGRES_DB=test postgres:16-alpine > /dev/null
  for _ in $(seq 1 60); do
    docker exec "$TEST_DB" pg_isready -U postgres -d test -q 2>/dev/null && return 0
    sleep 1
  done
  echo "Test database did not start" >&2
  exit 1
}

backend() {
  echo "==> Backend tests"
  docker build -q -t jobswipe-backend:test ./backend > /dev/null
  start_test_db
  # Settings require these four values; the tests never reach a real Supabase.
  docker run --rm --network "$TEST_NET" \
    -e SUPABASE_URL=http://supabase.invalid \
    -e SUPABASE_SERVICE_KEY=test \
    -e SUPABASE_ANON_KEY=test \
    -e SUPABASE_JWT_SECRET=test-jwt-secret-at-least-32-characters \
    -e TEST_DATABASE_URL="postgresql+asyncpg://postgres:test@$TEST_DB:5432/test" \
    -e REQUIRE_DB_TESTS=1 \
    jobswipe-backend:test python -m pytest -q -p no:warnings
  stop_test_db
}

frontend() {
  echo "==> Frontend tests"
  # --progress=plain so vitest's output (and any failure) is visible.
  docker build --progress=plain --target test ./frontend 2>&1 \
    | sed -n 's/^#[0-9]* [0-9.]* //p' | grep -E "✓|×|FAIL|Test Files|Tests |Error|error" || true
  docker build -q --target test ./frontend > /dev/null
  echo "==> Frontend build"
  # The production build also type-checks the test files (tsc).
  docker build -q -t jobswipe-frontend:test ./frontend > /dev/null
}

mobile() {
  echo "==> Mobile tests"
  docker build --progress=plain -f mobile/Dockerfile.test mobile 2>&1 \
    | sed -n 's/^#[0-9]* [0-9.]* //p' | grep -E "✓|✕|Tests:|error TS|FAIL" || true
  docker build -q -f mobile/Dockerfile.test mobile > /dev/null
}

scripts() {
  echo "==> Script tests"
  bash scripts/tests/test_deploy_oracle.sh
}

case "$ONLY" in
  all) backend; frontend; mobile; scripts ;;
  --backend) backend ;;
  --frontend) frontend ;;
  --mobile) mobile ;;
  --scripts) scripts ;;
  *) echo "Usage: $0 [--backend|--frontend|--mobile|--scripts]" >&2; exit 2 ;;
esac

echo "==> All checks passed"
