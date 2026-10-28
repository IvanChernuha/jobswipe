#!/usr/bin/env bash
# Tests for scripts/deploy_oracle.sh. Runs fully offline: the test runner,
# rsync and ssh are replaced with stubs that only record that they were called.
#
#   bash scripts/tests/test_deploy_oracle.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY="$ROOT/scripts/deploy_oracle.sh"
FAILS=0

setup() {
  WORK="$(mktemp -d)"
  CALLS="$WORK/calls.log"
  : > "$CALLS"
  mkdir -p "$WORK/bin"
  for cmd in rsync ssh; do
    printf '#!/usr/bin/env bash\necho "%s $*" >> "%s"\n' "$cmd" "$CALLS" > "$WORK/bin/$cmd"
    chmod +x "$WORK/bin/$cmd"
  done
  printf '#!/usr/bin/env bash\necho "tests" >> "%s"\nexit 0\n' "$CALLS" > "$WORK/pass.sh"
  printf '#!/usr/bin/env bash\necho "tests" >> "%s"\nexit 1\n' "$CALLS" > "$WORK/fail.sh"
  chmod +x "$WORK/pass.sh" "$WORK/fail.sh"
}

run_deploy() {
  PATH="$WORK/bin:$PATH" DEPLOY_ALLOW_DIRTY=1 "$DEPLOY" "$@" > "$WORK/out.log" 2>&1
}

check() {
  local name="$1" cond="$2"
  if eval "$cond"; then echo "PASS  $name"; else echo "FAIL  $name"; sed 's/^/      /' "$WORK/out.log"; FAILS=$((FAILS + 1)); fi
}

# 1. Failing tests block the deploy: non-zero exit, nothing copied, nothing restarted.
setup
TEST_CMD="$WORK/fail.sh" run_deploy; rc=$?
check "failing tests -> non-zero exit" "[ $rc -ne 0 ]"
check "failing tests -> tests were run" "grep -q '^tests' '$CALLS'"
check "failing tests -> no rsync" "! grep -q '^rsync' '$CALLS'"
check "failing tests -> no ssh" "! grep -q '^ssh' '$CALLS'"

# 2. Passing tests + --dry-run: tests run, nothing is copied or restarted.
setup
TEST_CMD="$WORK/pass.sh" run_deploy --dry-run; rc=$?
check "dry run -> exit 0" "[ $rc -eq 0 ]"
check "dry run -> tests were run" "grep -q '^tests' '$CALLS'"
check "dry run -> no rsync" "! grep -q '^rsync' '$CALLS'"
check "dry run -> no ssh" "! grep -q '^ssh' '$CALLS'"
check "dry run -> lists files it would copy" "grep -q 'docker-compose.yml' '$WORK/out.log'"

# 3. Server-only files are never in the copy list.
check "never copies .env" "! grep -qE '(^|/)\.env$' '$WORK/out.log'"
check "never copies the override file" "! grep -q 'docker-compose.override.yml' '$WORK/out.log'"
check "never copies credentials" "! grep -q 'backend/credentials/' '$WORK/out.log'"

# 4. Passing tests, real run (stubs): copies, then restarts app services but never the tunnel.
setup
TEST_CMD="$WORK/pass.sh" run_deploy --yes; rc=$?
check "deploy -> exit 0" "[ $rc -eq 0 ]"
check "deploy -> tests before rsync" "[ \"\$(grep -nE '^(tests|rsync)' '$CALLS' | head -1 | cut -d' ' -f1)\" = '1:tests' ]"
check "deploy -> rsync called" "grep -q '^rsync' '$CALLS'"
check "deploy -> compose up called over ssh" "grep -q '^ssh.*docker compose up -d --build' '$CALLS'"
check "deploy -> tunnel not restarted" "! grep -qE '^ssh.*(--profile tunnel|restart tunnel|up.*tunnel)' '$CALLS'"
check "deploy -> records deployed commit" "grep -q '^ssh.*\.deployed_commit' '$CALLS'"

# 5. Unknown flag is rejected before anything runs.
setup
TEST_CMD="$WORK/pass.sh" run_deploy --bogus; rc=$?
check "unknown flag -> non-zero exit" "[ $rc -ne 0 ]"
check "unknown flag -> tests not run" "! grep -q '^tests' '$CALLS'"

echo
if [ "$FAILS" -eq 0 ]; then echo "All deploy_oracle tests passed."; else echo "$FAILS failed."; exit 1; fi
