#!/usr/bin/env bash
# Leak scanner for a PUBLIC repository. One script, every gate:
#
#   tools/security-scan.sh staged        pre-commit hook: added lines in the index
#   tools/security-scan.sh msg <file>    commit-msg hook: the message being written
#   tools/security-scan.sh push <range>  pre-push hook: added lines, messages and author
#                                        emails of every commit about to be published
#   tools/security-scan.sh tree          CI: every tracked file as it is now
#   tools/security-scan.sh history       CI: every line ever added on this branch
#   tools/security-scan.sh log [range]   CI: commit messages (whole branch by default)
#
# Exit 1 on any hit, printing the offending line, so the gate actually BLOCKS.
# A scan whose output is printed and never read is how infrastructure words
# once reached public commit messages.
#
# Two lists:
#   - the generic patterns below (addresses, logins, local paths, keys, personal
#     data), safe to publish because they name nothing of ours;
#   - a PRIVATE list of our real names (machines, networks, local folders, the
#     stack) that must never be written here, because this file is public too.
#     One fixed string per line, case-insensitive, '#' for comments:
#       $METEOMAP_LEAK_WORDS, or ~/.config/meteomap/leak-words.txt
#     The local hooks warn when it is missing; CI runs without it.
#
# Allowlist: three tokens are PUBLIC by design (extracted from public web
# clients, documented next to each use) and the placeholders used in examples.
set -u

MODE="${1:-staged}"

# A line containing any of these is never a finding.
ALLOW='e1f10a1e78|a21bd737-|eyJ4NXQiOiJObUU1|your_|_here|tu_[a-z_]*_aqui|REPLACE_WITH|<internal-address>|\[internal-ip\]|REDACTED_|USUARIO@SERVIDOR|example\.(com|org)|placeholder|noreply\.github\.com'

# Paths the content scans skip: generated, binary, or lockfiles full of hashes.
SKIP_PATH='(^|/)(package-lock\.json|.*\.map|.*\.min\.js|.*\.png|.*\.jpg|.*\.jpeg|.*\.webp|.*\.woff2?|.*\.ico|.*\.svg|.*\.pdf|.*\.geojson)$|^dist/'

# Content patterns. Keep them SPECIFIC: a scanner that cries wolf gets bypassed.
PATTERNS=(
  # private network addresses
  '192\.168\.[0-9]{1,3}\.[0-9]{1,3}'
  '\b10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b'
  '\b172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}\b'
  # logins to a machine, and absolute paths of a personal computer
  '\b(root|admin|ubuntu|debian|pi|postgres|ec2-user)@[A-Za-z0-9<>_.-]+'
  '\b(ssh|scp|rsync)\b[^|;]*[A-Za-z0-9_.-]+@[A-Za-z0-9<>_.-]+'
  '\b[A-Za-z]:\\[A-Za-z0-9 _.-]+\\'
  '(/home/|/Users/|\\Users\\)[A-Za-z0-9_.-]+'
  # the workstation, described
  '\bRTX ?[0-9]{4}\b|\b[0-9]{2,3} ?GB (V?RAM|DDR[0-9])\b'
  # chat ids and bot tokens
  "chat_?[iI]d[\"']?[[:space:]]*[:=][[:space:]]*[\"']?-?[0-9]{6,}"
  '\b[0-9]{8,10}:[A-Za-z0-9_-]{30,}\b'
  # keys and credentials
  'BEGIN (RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY'
  '\bssh-(rsa|ed25519|dss|ecdsa) AAAA'
  'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}'
  '\bAKIA[0-9A-Z]{16}\b'
  '\bghp_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{20,}'
  '\bsk-[A-Za-z0-9]{32,}\b|\bxox[abpr]-[A-Za-z0-9-]{10,}'
  'postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@'
  "(password|passwd|secret|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9+/=_.-]{12,}[\"']"
  "(^|[:[:space:]])[A-Z0-9_]*(PASSWORD|PASSWD|SECRET|TOKEN|API_KEY)=[^[:space:]\$<{\"']{6,}"
  # personal data
  '[A-Za-z0-9._%+-]+@(gmail|hotmail|outlook|yahoo|icloud|protonmail)\.[a-z]{2,}'
  '\+34[ .-]?[6-9][0-9]{2}[ .-]?[0-9]{3}[ .-]?[0-9]{3}'
  '\bES[0-9]{2}( ?[0-9]{4}){5}\b'
  '\b[0-9]{8}[A-HJ-NP-TV-Z]\b|\b[A-HJNPQRSUVW]-?[0-9]{7}[0-9A-J]\b'
)

# Generic deployment words that must never appear in a PUBLIC commit message:
# say "the deploy host" or "the reverse proxy". Our own machine and stack names
# are in the private list, which is applied to messages too.
MSG_WORDS='\bnginx\b|systemctl|/opt/|/var/(log|www)|meteomap-update'

WORDS_FILE="${METEOMAP_LEAK_WORDS:-$HOME/.config/meteomap/leak-words.txt}"
PRIVATE=()
if [ -r "$WORDS_FILE" ]; then
  while IFS= read -r w; do
    w="${w%$'\r'}"
    case "$w" in ''|'#'*) continue ;; esac
    # As a case-insensitive regex, escaped. Only a LETTER next to the word
    # cancels the match (a short word inside a longer one); a digit, "_",
    # "-" or a written regex word boundary does not.
    re=$(printf '%s' "$w" | sed 's/[][\.*^$+?(){}|/]/\\&/g')
    case "$w" in [A-Za-z]*) re="(^|[^A-Za-z]|\\\\b)$re" ;; esac
    case "$w" in *[A-Za-z]) re="$re(\$|[^A-Za-z]|\\\\b)" ;; esac
    PRIVATE+=("$re")
  done < "$WORDS_FILE"
elif [ "${CI:-}" != "true" ]; then
  echo "security-scan: private word list not found ($WORDS_FILE); only the generic patterns run." >&2
fi

# Filters "where:content" rows through the allowlist and prints survivors.
# It runs inside a pipeline (a subshell), so it must not try to COUNT: the
# caller counts the lines it printed. The first version kept a counter in
# here and the gate never fired.
survivors() {
  while IFS= read -r row; do
    if printf '%s' "$row" | grep -qE "$ALLOW"; then continue; fi
    printf '  %s\n' "$row"
  done
}

# Every pattern and private word over a stream of "where:content" rows.
scan_rows() {
  local rows="$1" out p w
  [ -n "$rows" ] || return 0
  for p in "${PATTERNS[@]}"; do
    out=$(printf '%s\n' "$rows" | grep -E -- "$p" | survivors)
    [ -n "$out" ] && printf '%s\n' "$out"
  done
  for w in "${PRIVATE[@]}"; do
    out=$(printf '%s\n' "$rows" | grep -iE -- "$w" | survivors | sed 's/^  /  [private word] /')
    [ -n "$out" ] && printf '%s\n' "$out"
  done
}

# Messages (and author emails) of the commits in a rev-list spec, as rows.
message_rows() {
  # One record per commit, ended by the ASCII record separator: any awk takes
  # a one-character RS, and mawk (the CI runners' awk) does not take NUL.
  git log --format='%h%x09%ae%x09%ce%n%B%x1e' "$@" | awk -v RS='\036' '
    { n = split($0, L, "\n"); k = 1; while (k <= n && L[k] == "") k++
      if (k > n) next
      split(L[k], H, "\t"); c = H[1]
      print c ":author " H[2] " committer " H[3]
      for (i = k + 1; i <= n; i++) if (L[i] != "") print c ":" L[i] }'
}

# Lines ADDED by the commits in a rev-list spec, as "commit path:content" rows.
added_rows() {
  git log -p --no-color --no-renames --format='@@commit %h' "$@" -- . \
    | skip="$SKIP_PATH" awk 'BEGIN { skip = ENVIRON["skip"] }
      /^@@commit /{c=$2; next}
      /^\+\+\+ b\//{f=substr($0,7); s=(f ~ skip); next}
      /^\+\+\+ /{s=1; next}
      /^\+/{ if (!s) print c " " f ":" substr($0,2) }'
}

msg_scan() {
  local rows="$1" out w
  [ -n "$rows" ] || return 0
  out=$(printf '%s\n' "$rows" | grep -E -- "$MSG_WORDS")
  [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/  message /'
  for w in "${PRIVATE[@]}"; do
    out=$(printf '%s\n' "$rows" | grep -iE -- "$w" | survivors | sed 's/^  /  [private word] message /')
    [ -n "$out" ] && printf '%s\n' "$out"
  done
  out=$(printf '%s\n' "$rows" | grep -E ':author ' | grep -vE 'noreply\.github\.com' | grep -E '@(gmail|hotmail|outlook|yahoo|icloud|protonmail)\.' | sed 's/^/  personal email /')
  [ -n "$out" ] && printf '%s\n' "$out"
  return 0
}

# A range that does not resolve must fail, not pass with zero commits scanned.
resolve() {
  if ! git rev-list "$@" >/dev/null 2>&1; then
    echo "security-scan ($MODE): cannot resolve '$*' - refusing to pass an unscanned history." >&2
    exit 2
  fi
}

found=""
case "$MODE" in
  staged)
    # Only ADDED lines of the files in the index. Removing a secret is fine.
    files=$(git diff --cached --name-only --diff-filter=ACMR | grep -vE "$SKIP_PATH" || true)
    if [ -n "$files" ]; then
      # shellcheck disable=SC2086
      rows=$(git diff --cached --unified=0 -- $files \
        | awk '/^\+\+\+ b\//{f=substr($0,7)} /^@@/{split($3,a,","); n=substr(a[1],2)} /^\+[^+]/{print f":"n":"substr($0,2); n++}')
      found=$(scan_rows "$rows")
    fi
    ;;
  msg)
    file="${2:?commit message file}"
    rows=$(grep -vE '^#' "$file" | sed 's/^/message:/')
    found=$(msg_scan "$rows")
    ;;
  push)
    shift; [ $# -gt 0 ] || { echo "usage: $0 push <rev-list args, e.g. origin/master..HEAD>" >&2; exit 2; }
    resolve "$@"
    content=$(scan_rows "$(added_rows "$@")")
    messages=$(msg_scan "$(message_rows "$@")")
    found="$content"$'\n'"$messages"
    ;;
  tree)
    files=$(git ls-files | grep -vE "$SKIP_PATH" || true)
    # shellcheck disable=SC2086
    rows=$(grep -nIH '' $files 2>/dev/null)
    found=$(scan_rows "$rows")
    ;;
  history)
    shift; [ $# -gt 0 ] || set -- HEAD
    resolve "$@"
    found=$(scan_rows "$(added_rows "$@")")
    ;;
  log)
    # The whole branch by default: since the 5-oct-2026 rewrite the history is
    # clean, so there is no accepted debt left to skip.
    shift; [ $# -gt 0 ] || set -- HEAD
    resolve "$@"
    found=$(msg_scan "$(message_rows "$@")")
    ;;
  *)
    echo "usage: $0 staged|msg <file>|push <range>|tree|history [range]|log [range]" >&2
    exit 2
    ;;
esac

hits=$(printf '%s' "$found" | grep -c .)
if [ "$hits" -gt 0 ]; then
  printf '%s\n' "$found"
  echo "security-scan ($MODE): $hits hit(s) above. This repository is public." >&2
  echo "Fix the content, or add a documented allowlist entry in tools/security-scan.sh." >&2
  exit 1
fi
exit 0
