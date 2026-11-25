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
#     commit fixes some, lower the baseline in that same commit.
#  3. A file that does not parse (TS1xxx) fails on its own: with one, tsc stops
#     before checking types, reports only the syntax errors, and the count drops
#     under the baseline as if debt had been paid.
#
# The ingestor runs through tsx, which does not typecheck either, and the build
# does not include it: it gets the same two rules with its own tsconfig and
# baseline. It needs `npm ci` in ingestor/ first (its types come from there).
set -u

BASELINE=36
INGESTOR_BASELINE=1
CRASH_CODES='TS2304|TS2552|TS2307|TS2305|TS2724|TS2448'

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi
  echo "$1"
}

# check <name> <baseline> <baseline variable> <tsc args...>
check() {
  local name=$1 baseline=$2 var=$3
  shift 3
  local log total crash syntax
  log=$(mktemp)
  npx tsc "$@" > "$log" 2>&1
  total=$(grep -c "error TS" "$log")
  crash=$(grep -E "error ($CRASH_CODES):" "$log")
  syntax=$(grep -E "error TS1[0-9]{3}:" "$log")
  summary "$name: $total errors (baseline $baseline)"
  if [ -n "$syntax" ]; then
    echo "$syntax" | while IFS= read -r line; do echo "::error::$line"; done
    summary "FAIL ($name): a file does not parse, so the types were not checked at all (see above)."
    rm -f "$log"
    return 1
  fi
  if [ -n "$crash" ]; then
    echo "$crash" | while IFS= read -r line; do echo "::error::$line"; done
    summary "FAIL ($name): a name, module or declaration that does not exist at runtime (see above)."
    rm -f "$log"
    return 1
  fi
  if [ "$total" -gt "$baseline" ]; then
    grep "error TS" "$log"
    summary "FAIL ($name): $total type errors, more than the baseline of $baseline. Fix the new ones (git stash tells yours from the old debt)."
    rm -f "$log"
    return 1
  fi
  if [ "$total" -lt "$baseline" ]; then
    summary "Below the baseline: lower $var to $total in tools/typecheck-gate.sh."
  fi
  rm -f "$log"
  return 0
}

status=0
check "Typecheck" "$BASELINE" BASELINE -b --force || status=1
check "Typecheck (ingestor)" "$INGESTOR_BASELINE" INGESTOR_BASELINE -p ingestor --noEmit || status=1
exit $status
