#!/usr/bin/env bash
# Typecheck gate. Same script in CI and locally: `bash tools/typecheck-gate.sh`.
#
# `npm run build` uses esbuild, which never typechecks, and `tsc --noEmit`
# checks nothing in this repo (the root tsconfig is a solution file). This runs
# the real checker, `tsc -b --force` (without --force the incremental cache can
# report 0), and applies two rules:
#
#  1. Zero tolerance for the errors that crash at runtime: a name or module that
#     does not exist (TS2304, TS2552, TS2307, TS2305, TS2724) or a variable used
#     before its declaration (TS2448). A missing import once replaced the whole
#     map with the error screen while the build and every test were green.
#  2. Everything else is known debt: the count may go down, never up. When a
#     commit fixes some, lower BASELINE in that same commit.
set -u

BASELINE=107
CRASH_CODES='TS2304|TS2552|TS2307|TS2305|TS2724|TS2448'

log=$(mktemp)
npx tsc -b --force > "$log" 2>&1
total=$(grep -c "error TS" "$log")
crash=$(grep -E "error ($CRASH_CODES):" "$log")

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi
  echo "$1"
}

summary "Typecheck: $total errors (baseline $BASELINE)"

if [ -n "$crash" ]; then
  echo "$crash" | while IFS= read -r line; do echo "::error::$line"; done
  summary "FAIL: a name, module or declaration that does not exist at runtime (see above)."
  rm -f "$log"
  exit 1
fi

if [ "$total" -gt "$BASELINE" ]; then
  grep "error TS" "$log" | while IFS= read -r line; do echo "$line"; done
  summary "FAIL: $total type errors, more than the baseline of $BASELINE. Fix the new ones (git stash tells yours from the old debt)."
  rm -f "$log"
  exit 1
fi

if [ "$total" -lt "$BASELINE" ]; then
  summary "Below the baseline: lower BASELINE to $total in tools/typecheck-gate.sh."
fi

rm -f "$log"
exit 0
