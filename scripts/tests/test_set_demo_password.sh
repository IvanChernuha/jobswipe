#!/usr/bin/env bash
# set_demo_password.sh must only ever touch test accounts. These checks run
# the address guard only: the target "nowhere" stops the script before it
# contacts any server.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/set_demo_password.sh"
fails=0

expect() { # expect <exit code> <description> <email>
  local want="$1" desc="$2" email="$3" out code
  out="$(bash "$SCRIPT" nowhere "$email" 'longenough' 2>&1)"; code=$?
  if [ "$code" = "$want" ]; then echo "PASS  $desc"; else echo "FAIL  $desc (exit $code: $out)"; fails=$((fails+1)); fi
}

# 1 = refused as not a test account; 2 = accepted, then stopped at the target.
expect 1 "refuses a real user"                         "someone@gmail.com"
expect 1 "refuses other @jobswipe.com addresses"       "ivan@jobswipe.com"
expect 1 "refuses look-alikes of the demo employer"    "xdemo_employer@jobswipe.com"
expect 2 "accepts test domains"                        "alice.chen@demo.com"
expect 2 "accepts the named demo employer account"     "demo_employer@jobswipe.com"

[ "$fails" = 0 ] && echo "All set_demo_password tests passed." || exit 1
