#!/usr/bin/env bash
# Leak scanner for a PUBLIC repository. One script, three gates:
#
#   tools/security-scan.sh staged        pre-commit hook: added lines in the index
#   tools/security-scan.sh tree          CI: every tracked file
#   tools/security-scan.sh msg <file>    commit-msg hook: infrastructure words
#
# Exit 1 on any hit, printing the offending line, so the gate actually BLOCKS.
# A scan whose output is merely printed and never read is how "nginx" once
# reached a public commit message.
#
# What it looks for, and why each pattern exists:
#   - RFC1918 addresses              two hosts were scrubbed from history once (filter-repo); never again
#   - Telegram chat ids / bot tokens the maintainer's chat id sat in an n8n export for months
#   - private key blocks, JWTs, cloud/API tokens, DB URLs carrying a password
#   - password= / secret= / api_key= assignments with a real-looking value
#
# Allowlist: three tokens are PUBLIC by design (extracted from public web
# clients, documented next to each use) and one config file may carry a LAN
# range. Everything else that matches is a finding.
set -u

MODE="${1:-staged}"

# A line containing any of these is never a finding.
ALLOW='e1f10a1e78|a21bd737-|eyJ4NXQiOiJObUU1|your_|_here|REPLACE_WITH|<internal-address>|example\.com|placeholder'

# Paths the content scan skips: generated, binary, or lockfiles full of hashes.
SKIP_PATH='(^|/)(package-lock\.json|.*\.map|.*\.min\.js|.*\.png|.*\.jpg|.*\.webp|.*\.woff2?|.*\.ico|.*\.svg|.*\.pdf)$|^dist/'
LAN_OK='^nginx\.conf$'   # the only tracked file allowed to name a LAN range

# Content patterns. Keep them SPECIFIC: a scanner that cries wolf gets bypassed.
PATTERNS=(
  '192\.168\.[0-9]{1,3}\.[0-9]{1,3}'
  '\b10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b'
  '\b172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3}\b'
  "chat_?[iI]d[\"']?[[:space:]]*[:=][[:space:]]*[\"']?[0-9]{6,}"
  '\b[0-9]{8,10}:[A-Za-z0-9_-]{30,}\b'
  'BEGIN (RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY'
  'eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}'
  '\bAKIA[0-9A-Z]{16}\b'
  '\bghp_[A-Za-z0-9]{36}\b'
  '\bsk-[A-Za-z0-9]{32,}\b'
  'postgres(ql)?://[^:/@[:space:]]+:[^@[:space:]]+@'
  "(password|passwd|secret|api[_-]?key|token)[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9+/=_.-]{12,}[\"']"
)

# Words that must never appear in a PUBLIC commit message. Deploy topology is
# not the reader's business: say "the deploy host" or "the reverse proxy".
MSG_WORDS='\bLXC\b|\bnginx\b|systemctl|192\.168\.|/opt/|/var/(log|www)|meteomap-update|proxmox|\bpve\b'

# Filters "path:line:content" rows through the allowlist and prints survivors.
# It runs inside a pipeline (a subshell), so it must not try to COUNT: the
# caller counts the lines it printed. The first version kept a counter in
# here and the gate never fired.
survivors() {
  while IFS= read -r row; do
    path="${row%%:*}"
    rest="${row#*:}"
    content="${rest#*:}"
    if printf '%s' "$content" | grep -qE "$ALLOW"; then continue; fi
    if printf '%s' "$path" | grep -qE "$LAN_OK" \
       && printf '%s' "$content" | grep -qE '192\.168\.[0-9]{1,3}\.0/24'; then continue; fi
    printf '  %s\n' "$row"
  done
}

found=""
case "$MODE" in
  staged)
    # Only ADDED lines of the files in the index. Removing a secret is fine.
    files=$(git diff --cached --name-only --diff-filter=ACMR | grep -vE "$SKIP_PATH" || true)
    if [ -n "$files" ]; then
      # shellcheck disable=SC2086
      added=$(git diff --cached --unified=0 -- $files \
        | awk '/^\+\+\+ b\//{f=substr($0,7)} /^@@/{split($3,a,","); n=substr(a[1],2)} /^\+[^+]/{print f":"n":"substr($0,2); n++}')
      for p in "${PATTERNS[@]}"; do
        out=$(printf '%s\n' "$added" | grep -E "$p" | survivors)
        [ -n "$out" ] && found="$found$out"$'\n'
      done
    fi
    ;;
  tree)
    files=$(git ls-files | grep -vE "$SKIP_PATH" || true)
    for p in "${PATTERNS[@]}"; do
      # shellcheck disable=SC2086
      out=$(grep -nIE "$p" $files 2>/dev/null | survivors)
      [ -n "$out" ] && found="$found$out"$'\n'
    done
    ;;
  msg)
    file="${2:?commit message file}"
    found=$(grep -vE '^#' "$file" | grep -nE "$MSG_WORDS" | sed 's/^/  message:/' || true)
    ;;
  *)
    echo "usage: $0 staged|tree|msg <file>" >&2
    exit 2
    ;;
esac

hits=$(printf '%s' "$found" | grep -c .)
if [ "$hits" -gt 0 ]; then
  printf '%s' "$found"
  echo "security-scan ($MODE): $hits hit(s) above. This repository is public." >&2
  echo "Fix the content, or add a documented allowlist entry in tools/security-scan.sh." >&2
  exit 1
fi
exit 0
