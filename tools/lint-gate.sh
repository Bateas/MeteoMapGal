#!/usr/bin/env bash
# Lint gate. Same script in CI and locally: `bash tools/lint-gate.sh`.
#
# `npm run lint` existed but nothing ran it, so lint errors only grew. The known
# ones are debt: the count may go down, never up. When a commit fixes some,
# lower BASELINE in that same commit.
#
# It lints only the files git tracks: `eslint .` also reads local, ignored files,
# so the count would differ between a working copy and CI. xargs may split the
# list into several eslint runs; the count adds up every error line, so it does
# not matter. eslint is called through node in batches of 150: on Windows `npx`
# goes through cmd.exe, whose 8 KB line limit made the first batch fail and its
# errors vanish from the count.
set -u

BASELINE=183

log=$(mktemp)
git ls-files -z -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' \
  | xargs -0 -n 150 node node_modules/eslint/bin/eslint.js --no-warn-ignored > "$log" 2>&1
total=$(grep -cE "^ +[0-9]+:[0-9]+ +error " "$log")

# A batch that never ran (line too long, eslint crash) would hide its errors
if grep -qiE "too long|demasiado larga|Oops! Something went wrong" "$log"; then
  grep -iE -m 5 "too long|demasiado larga|Oops" "$log"
  summary_early="FAIL: some eslint runs did not start (see above)."
  echo "$summary_early"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$summary_early" >> "$GITHUB_STEP_SUMMARY"; fi
  rm -f "$log"
  exit 1
fi

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi
  echo "$1"
}

# A config or parser failure reports no rule and would hide every real error
if grep -q "Parsing error" "$log"; then
  grep -m 5 "Parsing error" "$log"
  summary "FAIL: eslint could not read some files (see above)."
  rm -f "$log"
  exit 1
fi

summary "Lint: $total errors (baseline $BASELINE)"

if [ "$total" -gt "$BASELINE" ]; then
  cat "$log"
  summary "FAIL: $total lint errors, more than the baseline of $BASELINE. Fix the new ones."
  rm -f "$log"
  exit 1
fi

if [ "$total" -lt "$BASELINE" ]; then
  summary "Below the baseline: lower BASELINE to $total in tools/lint-gate.sh."
fi

rm -f "$log"
exit 0
