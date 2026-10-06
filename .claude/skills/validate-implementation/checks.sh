#!/usr/bin/env bash
# Static gates of /validate-implementation. Deterministic, no network, no Docker.
# Each gate maps to a rule of CLAUDE.md section 5 or to a risk of PLAN.md section 16.
# FAIL = hard error (exit 1). WARN = the agent must read the lines and judge them.
# Usage: .claude/skills/validate-implementation/checks.sh   (from the repo root)

set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2

CTX=src/modules/cash-in
fails=0
warns=0

# Product code only: specs and test doubles are allowed to hold state in memory.
src_lines() {
  grep -rnE "$1" src --include='*.ts' \
    | grep -v '\.spec\.ts:' \
    | grep -v '/in-memory/' \
    || true
}

fail() { echo "FAIL  $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/      /'; fails=$((fails + 1)); }
warn() { echo "WARN  $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/      /'; warns=$((warns + 1)); }
pass() { echo "PASS  $1"; }

require() { # require <description> <pattern> <file>
  if grep -qE "$2" "$3" 2>/dev/null; then pass "$1"; else fail "$1" "missing /$2/ in $3"; fi
}

forbid() { # forbid <description> <pattern>
  local hits
  hits=$(src_lines "$2")
  if [ -z "$hits" ]; then pass "$1"; else fail "$1" "$hits"; fi
}

echo "== 1. Transactions: manual session, bounded retry =="
forbid "no session.withTransaction (unbounded 120 s retry loop)" '\.withTransaction\('
UOW=$CTX/infrastructure/mongo-cash-in.unit-of-work.ts
require "unit of work starts the transaction by hand" 'startTransaction\(' "$UOW"
require "unit of work aborts on error" 'abortTransaction\(' "$UOW"
require "unit of work ends the session" 'endSession\(' "$UOW"
require "unit of work maps write conflicts (TransientTransactionError)" 'isTransientTransactionError|TransientTransactionError' "$UOW"
require "settlement retries are bounded (retryWithBackoff in the processor)" 'retryWithBackoff\(' "$CTX/application/cash-in-processor.ts"
require "retry policy has maxAttempts" 'maxAttempts' src/shared/application/retry.ts
require "retry policy uses jitter" 'Math\.random' src/shared/application/retry.ts

echo
echo "== 2. Money: decimal strings in, minor units inside, never floats =="
forbid "no parseFloat / parseInt" 'parseFloat|parseInt\('
forbid "no Math.round/floor/ceil/trunc on values" 'Math\.(round|floor|ceil|trunc)\('
forbid "no toFixed" '\.toFixed\('
forbid "no x100 or /100 scaling" '[*/] *100([^0-9]|$)'
require "cash-in command carries amount as string" 'readonly amount: string' \
  "$CTX/application/commands/initiate-cash-in/initiate-cash-in.command.ts"
require "notification command carries amount as string" 'readonly amount: string' \
  "$CTX/application/commands/handle-payment-notification/handle-payment-notification.command.ts"
require "cash-in controller converts amount with String()" 'String\(body\.amount\)' "$CTX/api/cash-in.controller.ts"
require "webhook controller converts amount with String()" 'String\(body\.amount\)' "$CTX/api/payment-webhook.controller.ts"
require "response mapper renders from toDecimalString()" 'Number\([a-z]+\.toDecimalString\(\)\)' \
  "$CTX/api/mappers/cash-in.response.mapper.ts"
hits=$(src_lines 'Money\.ofMinor\(' | grep -v '/infrastructure/mappers/' | grep -v 'src/shared/domain/money.ts')
[ -z "$hits" ] && pass "Money.ofMinor only in persistence mappers and Money" || fail "Money.ofMinor outside persistence mappers" "$hits"
hits=$(src_lines '(^|[^A-Za-z])Number\(' | grep "^$CTX" | grep -v 'toDecimalString()' | grep -v 'Number(timestamp)')
[ -z "$hits" ] && pass "no other Number() conversion in the cash-in context" || warn "Number() in the cash-in context: confirm none touches money" "$hits"

echo
echo "== 3. HTTP contract: exact paths, no version prefix =="
forbid "no global prefix" 'setGlobalPrefix\('
forbid "no URI versioning" 'enableVersioning\(|@Version\(|VERSION_NEUTRAL'
require "POST /cash-in" "@Post\\('cash-in'\\)" "$CTX/api/cash-in.controller.ts"
require "POST /webhooks/payment" "@Post\\('webhooks/payment'\\)" "$CTX/api/payment-webhook.controller.ts"
hits=$(grep -nE "@Controller\(.+\)" "$CTX"/api/*.controller.ts || true)
[ -z "$hits" ] && pass "cash-in controllers have no path prefix" || fail "cash-in controller with a path prefix" "$hits"
hits=$(grep -nE "@(Get|Put|Patch|Delete)\(" "$CTX"/api/*.controller.ts || true)
[ -z "$hits" ] && pass "no endpoints beyond the two POSTs (D4)" || fail "extra endpoints in cash-in (D4 says none)" "$hits"
require "webhook route is guarded by the signature guard" 'UseGuards\(WebhookSignatureGuard\)' "$CTX/api/payment-webhook.controller.ts"

echo
echo "== 4. No in-process state for correctness, no Redis =="
hits=$(src_lines 'new (Map|Set|WeakMap|WeakSet)\b' | grep -v 'src/shared/api/decorators/api-domain-errors.decorator.ts')
[ -z "$hits" ] && pass "no Map/Set in product code (test doubles excluded)" || fail "Map/Set in product code" "$hits"
forbid "no module level mutable variables" '^(export )?let '
hits=$(src_lines 'static [a-zA-Z]+ *[:=]' | grep -v 'static readonly' | grep -v 'static override readonly')
[ -z "$hits" ] && pass "no static mutable fields" || fail "static mutable fields" "$hits"
hits=$(src_lines 'private [a-zA-Z]+ *[:=]' | grep -v 'private readonly' | grep -v '/reconciliation.scheduler.ts:')
[ -z "$hits" ] && pass "no mutable instance fields (scheduler timer/skip flag allowed, plan 10.5)" \
  || warn "mutable instance fields: confirm none is used for idempotency, locking or dedup" "$hits"
hits=$( (grep -nE '"(redis|ioredis|cache-manager|@nestjs/cache-manager|lru-cache|node-cache|keyv)"' package.json; \
  src_lines "from '(redis|ioredis|cache-manager|@nestjs/cache-manager|lru-cache|node-cache|keyv)") || true)
[ -z "$hits" ] && pass "no Redis or cache dependency (D1)" || fail "Redis or cache dependency (D1 says none)" "$hits"
hits=$(grep -rnE "from '.*/in-memory/" src --include='*.ts' | grep -v '\.spec\.ts:' | grep -v '/in-memory/' || true)
[ -z "$hits" ] && pass "test doubles are never wired into the app" || fail "in-memory double imported by product code" "$hits"

echo
echo "== 5. Money movement rules (CLAUDE.md section 5) =="
forbid "operations are never deleted (key never released)" 'delete(One|Many)\(|findOneAndDelete\('
REPO=$CTX/infrastructure/mongo-cash-in-operation.repository.ts
require "unique index on (userId, idempotencyKey)" 'unique: true' "$REPO"
require "claims filter status pending" "status: 'pending'" "$REPO"
require "provider call is wrapped in withTimeout" 'withTimeout\(' "$CTX/infrastructure/simulated-payment-provider.ts"
require "provider receives our operation id" 'operationId' "$CTX/application/ports/payment-provider.port.ts"
require "simulated provider keeps its state in Mongo" 'findOneAndUpdate\(' \
  "$CTX/infrastructure/simulated-provider/simulated-provider.backend.ts"
hits=$(grep -nE '\$set: *[a-zA-Z]+ *[,}]' "$UOW" "$REPO" $CTX/infrastructure/mongo-wallet.repository.ts || true)
[ -z "$hits" ] && pass "no whole-document \$set (leaseUntil/providerCallCount never overwritten)" \
  || warn "\$set of a whole object: confirm it cannot overwrite lease fields" "$hits"
hits=$(grep -rnE 'process\.env' src --include='*.ts' | grep -v '\.spec\.ts:' | grep -v '^src/config/' | grep -v '^src/main.ts:' || true)
[ -z "$hits" ] && pass "config only through AppConfigService" || fail "process.env outside src/config" "$hits"
forbid "no console.*" 'console\.'

echo
echo "== Summary: $fails FAIL, $warns WARN =="
[ "$fails" -eq 0 ]
