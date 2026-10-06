#!/usr/bin/env bash
# Security gate. Runs in CI (.github/workflows/ci.yml, job "security") and locally with the same result.
#   Usage: .github/scripts/security-gate.sh            (needs gitleaks, osv-scanner, semgrep, jq, git)
# Checks (all run, then one verdict):
#   1. secrets over the whole git history (gitleaks)
#   2. dependency vulnerabilities on package-lock.json (osv-scanner), blocks on CVSS >= 9
#   3. SAST (semgrep), blocks on ERROR
# Exceptions live in the repo: .gitleaksignore, osv-scanner.toml and inline `nosemgrep` comments,
# always with a reason.
set -uo pipefail

CRITICAL_CVSS=9.0
LOCKFILE=package-lock.json
fail=0
say() { printf '%s\n' "$*"; }
bad() { say "FAIL: $*"; fail=1; }

say "### Secrets (gitleaks, full history)"
if gitleaks git . --no-banner --redact -l warn --exit-code 1; then say "ok"; else bad "gitleaks found secrets"; fi

say "### Dependencies (osv-scanner on $LOCKFILE, blocks on CVSS >= $CRITICAL_CVSS)"
osv_args=(scan source --format json --lockfile "$LOCKFILE")
[ -f osv-scanner.toml ] && osv_args+=(--config osv-scanner.toml)
osv-scanner "${osv_args[@]}" > osv-report.json 2> osv-stderr.txt
osv_rc=$?
if [ "$osv_rc" -ne 0 ] && [ "$osv_rc" -ne 1 ]; then
  bad "osv-scanner failed (exit $osv_rc): $(tail -3 osv-stderr.txt)"
else
  crit=$(jq -r --argjson t "$CRITICAL_CVSS" '[.results[]?.packages[]? | .package as $p | .groups[]? | select(((.max_severity // "0") | tonumber) >= $t) | "\(.ids[0]) \($p.name)@\($p.version) cvss=\(.max_severity)"] | .[]' osv-report.json)
  high=$(jq -r --argjson t "$CRITICAL_CVSS" '[.results[]?.packages[]?.groups[]? | select(((.max_severity // "0") | tonumber) >= 7 and ((.max_severity // "0") | tonumber) < $t)] | length' osv-report.json)
  say "HIGH (7.0-8.9, informational, not blocking): $high"
  if [ -n "$crit" ]; then bad "CRITICAL vulnerabilities:"; echo "$crit" | while IFS= read -r l; do say "  - $l"; done; else say "ok (no CRITICAL)"; fi
fi
rm -f osv-report.json osv-stderr.txt

say "### SAST (semgrep, blocks on ERROR)"
if semgrep scan --config p/typescript --config p/nodejs --config p/security-audit \
     --metrics=off --quiet --severity ERROR --error --exclude node_modules --exclude dist .; then
  say "ok"
else
  bad "semgrep found ERROR level issues"
fi

say "### Verdict: $([ "$fail" = 0 ] && echo PASS || echo FAIL)"
exit "$fail"
