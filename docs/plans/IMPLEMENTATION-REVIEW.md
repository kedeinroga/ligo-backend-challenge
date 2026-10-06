# Implementation review

Verdict: VERIFIED
Audited: `876eb3b`, 2026-10-06, session different from the implementer: yes

Tree state: clean except the untracked `.claude/skills/validate-implementation/` (the skill that
ran this audit; not product code).

Sources read: `../challenge-statement.md`, `docs/plans/PLAN.md` (including sections 19 and 20),
`CLAUDE.md`, `README.md`, `docs/ai-log.md`, `git log`, and every product file under
`src/modules/cash-in/` that moves money (processor, the three handlers, aggregates, Mongo
repositories, unit of work, provider adapter and backend, controllers, DTOs, mappers, scheduler).

## Static gates

`.claude/skills/validate-implementation/checks.sh`: **0 FAIL, 0 WARN** (39 PASS).

| Block | Result |
|---|---|
| 1. Manual transaction, bounded retry, jitter | all PASS (no `withTransaction`; `startTransaction` / `abortTransaction` / `endSession`; transient error mapping; `retryWithBackoff` with `maxAttempts` and `Math.random`) |
| 2. Money: decimal strings, minor units, no floats | all PASS (no `parseFloat`, `Math.round`, `toFixed`, `*100`; commands carry `amount: string`; `String(body.amount)` in both controllers; mapper renders from `toDecimalString()`) |
| 3. HTTP contract | all PASS (no global prefix, no versioning, exact `@Post('cash-in')` / `@Post('webhooks/payment')`, no GET, guard on the webhook) |
| 4. No in-process state, no Redis | all PASS (no `Map`/`Set`, no module or static mutable state, only the scheduler's timer and skip flag, no Redis or cache dependency, in-memory doubles never wired) |
| 5. Money movement rules | all PASS (no deletes of operations, unique `(userId, idempotencyKey)`, claims filter `status: 'pending'`, provider call under `withTimeout`, provider keyed by `operationId`, simulated provider state in Mongo, no whole document `$set`, no `process.env` outside config, no `console.*`) |

No WARN to close.

## Suites

| Suite | Files | Tests | Duration | Result |
|---|---|---|---|---|
| `npm run check` (lint with layer rules, typecheck, unit, build) | 22 | 139 | 0.94 s (unit) | green, exit 0 |
| `npm run infra:up` | | | | exit 0 |
| `npm run test:e2e` run 1 | 6 | 48 | 7.03 s | green |
| `npm run test:e2e` run 2 | 6 | 48 | 7.94 s | green |

Flaky: none. The only `error` lines in the e2e output are the ones the tests provoke on purpose
(`Conflicting provider outcome` in the late `payment.failed` test, `Notification does not match`
in the mismatch test).

`grep -rnE "\.(skip|only)\(|\bxit\(|\bxdescribe\(" src test`: empty.

## Statement coverage

### Scenarios of slide 6

| # | Scenario | Code | Tests (all green above) |
|---|---|---|---|
| 1 | Double click | unique index `mongo-cash-in-operation.repository.ts:35`; loser replays `initiate-cash-in.handler.ts:51`, `:67`; lease claim `:99` | e2e `charges once when 5 requests share a key`; unit `answers pending without calling the provider when the key is in flight` |
| 2 | App automatic retry | replay `initiate-cash-in.handler.ts:85`; final answers stored result `:91`; pending re-submits with same id `:107` | e2e `returns the same body on a retry with the same key`; unit `replays a completed operation without calling the provider`, `re-submits a pending operation with the same operation id when the lease is free` |
| 3 | Concurrent pods | all state in Mongo: unique index, atomic `findOneAndUpdate` claim `mongo-cash-in-operation.repository.ts:128`, versioned transaction `mongo-cash-in.unit-of-work.ts:148`, `:171` | e2e `charges once when 5 requests share a key` (two app instances, `cash-in.e2e-spec.ts:38`, `:125`); e2e `grants the lease to exactly one of 5 parallel claims` |
| 4 | Provider timeout | `withTimeout` `simulated-payment-provider.ts:85`; timeout not retried `:50`; unknown keeps pending and releases lease `cash-in-processor.ts:77` | unit `returns unknown on timeout without retrying`, `leaves the operation pending and releases the lease when the outcome is unknown`; e2e `completes a timed out charge on retry without charging twice` |
| 5 | Duplicated webhook | notification inserted first in the same transaction `mongo-cash-in.unit-of-work.ts:103`, 11000 -> duplicate `:133`, handler answers `duplicate` `handle-payment-notification.handler.ts:63` | unit `answers duplicate for a repeated event id and credits once`; e2e `credits once when the same notification arrives twice`, `credits once when the same notification arrives 5 times in parallel` |
| 6 | Out of order webhook | absorbing terminal states `cash-in-operation.aggregate.ts:112`, `:127` | unit `ignores processing after completed`, `reports conflict for failed after completed and keeps the operation completed`, `reports conflict for succeeded after failed and does not credit`; e2e `keeps a completed operation when a failed notification arrives late` |
| 7 | Webhook before the API response | operation inserted before the provider call `initiate-cash-in.handler.ts:50`; API settlement reloads and gets `ignored` `cash-in-processor.ts:138`, `aggregate.ts:113` | unit `credits once when the notification settles before the provider answers`; e2e `credits once when the webhook arrives while the provider call is in flight` (asserts webhook `applied` and API 200 with `new_balance: 350`) |
| 8 | Temporary DB failure | before the provider: driver errors become `DataSourceException` and propagate (500) `initiate-cash-in.handler.ts:35`, `:50`; after: every settlement failure swallowed into 202 `cash-in-processor.ts:85` | unit `propagates a data source failure before calling the provider`, `answers pending when settlement cannot be persisted after an approval`; e2e `rolls back operation and wallet when the ledger entry already exists` |
| 9 | Restart mid operation | lease expiry + `claimNextStale` `mongo-cash-in-operation.repository.ts:91`; reconciler `reconcile-pending-operations.handler.ts:35` | e2e `reconciler completes an operation whose process died before calling the provider`, `reconciler completes a timed out operation`, `lets two concurrent runs share the work without processing an operation twice` |
| 10 | Race on the balance | wallet version check `mongo-cash-in.unit-of-work.ts:171`; bounded retry `cash-in-processor.ts:104` | e2e `applies 5 concurrent cash-ins of one user exactly once each` (two instances, 5 distinct `new_balance`, 5 ledger entries); unit `retries settlement on a concurrent wallet update` |

### Deliverables of slide 8

| Deliverable | Evidence |
|---|---|
| `POST /cash-in` and `POST /webhooks/payment` | `cash-in.controller.ts:65`, `payment-webhook.controller.ts:75`; e2e `api-docs.e2e-spec.ts:29-30` |
| Real multi pod idempotency | unique index + atomic claim in Mongo; e2e over two app instances; gate block 4 |
| Operation state machine | `cash-in-operation.aggregate.ts:112-138`; 16 aggregate unit tests; README "Operation state machine" |
| Duplicated and out of order webhooks | scenarios 5 and 6 above |
| Tests: idempotency, duplicity, success, provider failure | `returns the same body on a retry with the same key`; `charges once when 5 requests share a key` / `credits once when the same notification arrives twice`; `returns the statement contract for a completed cash-in`; `returns failed without new_balance when the provider declines`, `answers pending after the provider stays unavailable` |
| README with architecture and decisions | `README.md:42` onward |

### Red flags of slide 13 (evidence that the code does not have them)

| Red flag | Evidence of absence |
|---|---|
| Idempotency only in a memory variable | gate block 4 (no `Map`/`Set`/mutable fields); unique index `mongo-cash-in-operation.repository.ts:35` |
| Does not consider multiple pods | "5 pods" e2e over two `AppModule` instances (`cash-in.e2e-spec.ts:38`, `:125`); simulated provider state in Mongo (`simulated-provider.backend.ts:93`) so `calls === 1` is a cross pod proof |
| Accepts the agent's code without questioning | `docs/ai-log.md` entries 1 to 10, plan sections 19 and 20 |
| Cannot explain why the agent proposed something | `docs/ai-log.md` column "Why it was wrong here" |
| Indiscriminate retry on financial operations | timeout never retried in request (`simulated-payment-provider.ts:50`, predicate only `ProviderUnavailableError`); same key always; settlement retried only on `ConcurrencyException` (`cash-in-processor.ts:251`), bounded to 5 |
| Trusts webhooks arrive once | dedup by `event_id` in the same transaction; parallel duplicate e2e |
| Does not write tests | 139 unit + 48 e2e |

### README topics of slide 9 and defense questions of slide 14

| Topic | README section | True of the code? |
|---|---|---|
| Proposed architecture | "Proposed architecture" | yes: components and collections match `cash-in.module.ts` and the unit of work |
| Idempotency strategy | "Idempotency strategy" | yes: unique index, insert before call, key never deleted (gate), provider keyed by operation id |
| Concurrency handling | "Concurrency handling" | yes: lease 15 s default, versioned updates, 5 settlement attempts, manual transaction |
| Retry strategy | "Retry strategy" | yes: 3 attempts, 50 ms base / 1 s cap, timeout not retried, reconciler every 15 s and cap 10, boot rule `env.validation.ts:156` |
| Webhook handling | "Webhook handling" | yes: HMAC on raw body, 300 s tolerance, guard before validation, dedup, 404 / 422 not recorded, `@SkipThrottle` |
| What was asked of the agent and corrected | "Use of AI" + `docs/ai-log.md` | yes: entries reference real files and test names (`submits an operation whose outcome stays unknown once per run` exists) |
| Q "5 pods same key" | "Concurrency handling" first paragraph | yes, walked below |
| Q "what did the agent not solve well" | "Use of AI" | yes |
| Q "Redis vs database" | "Redis or database for idempotency?" | yes |
| Q "1 million operations a day" | "What changes at 1 million operations a day?" | mostly; see finding 2 (sharding sentence) |

### Contract of slide 5

`user_id`, `amount` (JSON number), `currency`, `payment_method`, header `Idempotency-Key` (UUID,
required, `idempotency-key.decorator.ts:7`); response `operation_id`, `status`, `amount`,
`new_balance` as JSON numbers (`cash-in.response.mapper.ts:22`). e2e
`returns the statement contract for a completed cash-in` reproduces 250 + 100 = 350 with
`toEqual({ operation_id, status: 'completed', amount: 100, new_balance: 350 })`.

## Plan conformance

### Files

Every path of plan section 14 exists. Files not listed in section 14 are explained in section 20:
`src/shared/infrastructure/mongo/mongo-errors.ts` (step 3), `api/decorators/idempotency-key.decorator.spec.ts`
(step 6). No unplanned file under `src/modules/cash-in/`. `main.ts` has no
`enableShutdownHooks()` because `app.setup.ts:30` already calls it (step 8 log).

### Tests

All 31 test names of the scenario matrix (section 11) were checked against the suite. 28 exist
verbatim. 3 exist with a longer name (finding 1). Every section 13 item is present, several as
`it.each` (`rejects a %s idempotency key`, `rejects %s` with 3 decimals / string amount / zero /
unknown currency / unknown fields, `rejects a malformed header (%s)`). Opened bodies of the
concurrency tests:

- `charges once when 5 requests share a key`: `Promise.all` over `[app, secondPod, app, secondPod, app]`,
  asserts one `operation_id`, at least one 202, completed bodies share `new_balance` 350,
  `simulated_provider_charges.calls === 1`, one ledger entry, balance 350.00.
- `applies 5 concurrent cash-ins of one user exactly once each`: `Promise.all` over both instances,
  all 200 completed, 5 distinct `new_balance`, balance 750.00, 5 ledger entries.
- `credits once when the webhook arrives while the provider call is in flight`: polls the operation
  while the request is open, asserts `applied`, then the API 200 with the same balance, one ledger entry.

Extra tests beyond the plan (not a finding): `credits once when the same notification arrives 5 times in parallel`,
`lets two concurrent runs share the work without processing an operation twice`, persistence
`settles operation, wallet and ledger entry together`, `rolls back operation and wallet when the ledger entry already exists`.

### Contract

| Plan item | Code |
|---|---|
| Request DTO limits (9.1) | `cash-in.request.dto.ts:17-40` matches field by field (`usr_` pattern, `maxDecimalPlaces: 2`, `@IsPositive`, `@Max(1_000_000)`, `@IsIn(CURRENCIES)`, payment method pattern) |
| 202 on pending, 200 otherwise | `cash-in.controller.ts:83` |
| `new_balance` only completed, `failure_reason` only failed (D7) | `cash-in.response.mapper.ts:12-17` |
| `@ApiDomainErrors` of `/cash-in` | `cash-in.controller.ts:57` equals plan 9.1 list |
| Webhook DTO (9.2) | `payment-webhook.request.dto.ts` matches; optional fields validated when present (section 20, step 7) |
| `@ApiDomainErrors` of `/webhooks/payment` | `payment-webhook.controller.ts:60` equals plan 9.2 list |
| `@SkipThrottle`, guard | `payment-webhook.controller.ts:73-74` |

### State machine

Every row of plan section 6 maps to the aggregate (`cash-in-operation.aggregate.ts:112-138`) or
the processor (`unknown` rows: `cash-in-processor.ts:77`, `releaseLease` filters `status: 'pending'`
at `mongo-cash-in-operation.repository.ts:111`) and has a unit test in
`cash-in-operation.aggregate.spec.ts` or `handle-payment-notification.handler.spec.ts`;
`does not let a released lease free a final operation` covers the terminal + unknown rows in e2e.

### Invariants and exceptions

All 15 exceptions of plan 5.1, 5.2 and 5.3 exist with the planned `staticCode` and base class
(`cash-in-operation.exceptions.ts`, `wallet.exceptions.ts`, `payment-notification.exceptions.ts`).
Every exception raised on the HTTP paths is in the endpoint's `@ApiDomainErrors` (directly or
through its base, e.g. `InvalidCashInAmountException` through `DataInputException`).

### Config

The 13 keys of plan section 12 are in `env.validation.ts` (defaults equal to the plan),
`AppConfigService` getters (`app-config.service.ts:53-101`), `.env.example`, `k8s/configmap.yaml`
(secret in `k8s/secret.example.yaml`, wired through `deployment.yaml:37`). E2E env in
`vitest.config.e2e.ts` matches the plan exactly, including `fileParallelism: false` and
`THROTTLE_LIMIT`. Lease rule at `env.validation.ts:156`; production secret rule at `:168`;
compose demo secret at `docker-compose.yml:11`.

### Commits

10 commits, one per plan step, messages identical to section 14 (step 0 to step 9).
`git log --format=%B | grep -iE "co-authored|claude|generated with"`: empty.

## Money movement walkthroughs

1. **5 pods, same key, same instant.** All miss `findByIdempotencyKey` (`initiate-cash-in.handler.ts:27`).
   Each upserts the wallet idempotently (`mongo-wallet.repository.ts:41`, `$setOnInsert`, 11000
   tolerated). One `insertOne` wins `uniq_user_idempotency_key` (`mongo-cash-in-operation.repository.ts:60`);
   four get 11000 -> `DuplicateCashInOperationException` (`:63`) -> `replayOnDuplicate`
   (`initiate-cash-in.handler.ts:67`) -> `assertSameRequest` -> `claim` (`:99`), an atomic
   `findOneAndUpdate` requiring `status: 'pending'` and a free or expired lease (`repository.ts:137-147`).
   The winner inserted with a 15 s lease, so the four get `null` and answer 202 with the snapshot
   (`handler.ts:105`) without calling the provider. Nothing on this path is in process memory
   (gate block 4). The provider is called once; even if the lease were outlived, the provider
   dedups by operation id (`simulated-provider.backend.ts:93`) and settlement is versioned.
2. **Provider timeout then client retry.** The operation is persisted before the call
   (`handler.ts:50`). Timeout -> `unknown` (`simulated-payment-provider.ts:99`), no in-request retry
   (`:50`), `releaseLease` (`cash-in-processor.ts:82`), 202. The key is never deleted (gate). The
   retry finds the operation (`handler.ts:31`), claims it, and `chargeAndSettle(claimed)` submits
   with `operationId: operation.id` (`cash-in-processor.ts:70`): the same key, the backend returns
   the recorded charge (`backend.ts:66`), settlement credits once. e2e asserts `calls === 2`, one
   charge, one ledger entry.
3. **Webhook before the API response, and both settling concurrently.** Both paths call
   `completeOnce` (`cash-in-processor.ts:133`), which reloads operation and wallet and commits with
   `{ _id, version }` filters (`unit-of-work.ts:149`, `:172`) plus the ledger insert with
   `_id = operationId` (`:194`). The loser gets 0 matched or a `TransientTransactionError` ->
   `CashInOperationConcurrentlyModifiedException` (`:228`) -> `retryWithBackoff`, at most
   `SETTLEMENT_MAX_ATTEMPTS` (5) with full jitter (`retry.ts:22-31`) -> reload sees `completed` ->
   `ignored`, no wallet change (`processor.ts:144-147`). The API answers 200 with the stored
   `balanceAfter`.
4. **Duplicated and out of order webhooks.** The notification insert is the first write of the
   same transaction (`unit-of-work.ts:103`); a committed duplicate is 11000 -> `duplicate`; an
   in-flight duplicate is a write conflict -> retry -> 11000 -> `duplicate` (e2e 5 in parallel).
   Late `payment.failed` on completed -> `conflict`, operation not written
   (`processor.ts:179`, only the notification is recorded); `payment.processing` is always
   `ignored`. Terminal states never move.
5. **DB failure before and after calling the provider.** Before: wallet lookup/upsert, the
   lookup, the insert and the claim run through `translateDriverErrors` (`mongo-errors.ts:23`) ->
   `DataSourceException` -> 500, nothing charged, the key may be reused as new (no operation
   exists, or it exists pending with a lease and is resumed). After: `chargeAndSettle` catches any
   settlement error (`processor.ts:88`) and any lease release error (`:229`) and returns the pending
   snapshot -> 202. The provider adapter never throws (`simulated-payment-provider.ts:58`). No
   path answers 4xx/5xx after the provider was called.
6. **Restart mid operation.** Died after insert: the operation is pending with a lease; after
   `OPERATION_LEASE_MS` a client retry claims it, or the reconciler claims it once older than
   `RECONCILER_MIN_AGE_MS` (`repository.ts:91-105`). Two pods never process one operation: the
   claim is one atomic `findOneAndUpdate`; within a run `excludedIds` avoids re-claiming
   (`reconcile-pending-operations.handler.ts:36-45`, D11). Died inside the transaction: nothing
   committed. e2e covers both reconciler cases and two concurrent runs.

`CLAUDE.md` section 5 rules 1 to 7 hold on every walkthrough; none of the "risks to watch" of plan
section 16 is present (gates 1, 2, 4, 5 and the reading above).

## Findings

| # | Severity | Where | What is wrong | Evidence | Proposed fix |
|---|---|---|---|---|---|
| 1 | minor | `handle-payment-notification.handler.spec.ts:152`, `:177`, `:192`; `simulated-payment-provider.spec.ts:80` | Three planned test names and one adapter test name were extended with a suffix (`... and credits once`, `... and keeps the operation completed`, `... and does not credit`, `..., then returns unknown`), so the plan's names are not verbatim. The bodies assert what both names claim. | Grep of the section 11 names against the suite: 4 misses, all prefixes of existing names. README already cites the long names. | Either rename the tests to the plan's names or note the rename in plan section 20. Doc only. |
| 2 | minor | `README.md` "What changes at 1 million operations a day?", last bullet | "sharded by `userId` ... keeps both unique indexes valid because they are prefixed by the user" is not accurate: the dedup keys `payment_notifications._id` (event id) and `ledger_entries._id` (operation id) are not user prefixed, and in a sharded collection `_id` uniqueness is only per shard unless `_id` is the shard key. Likely to be probed in the defense question about 1M ops/day. | `mongo-cash-in.unit-of-work.ts:124`, `:194`; the only user prefixed unique index is `uniq_user_idempotency_key`. | Reword: shard `cash_in_operations` and `wallets` by `userId` (the idempotency index stays valid), shard `payment_notifications` by `_id` (event id) and `ledger_entries` by `_id` or keep them unsharded; transactions then become cross shard, which is the real cost. |
| 3 | minor | `initiate-cash-in.handler.ts:103-105` | A replay that loses the claim because the operation became final between the lookup and the claim answers 202 `pending` from the stale snapshot instead of the final 200. Safe (no money impact, the next retry answers 200) and consistent with plan 10.2, but it makes a client poll one more time. | `claim` filters `status: 'pending'` (`mongo-cash-in-operation.repository.ts:140`), so `null` covers both "lease held" and "already final". | Optional: on `null`, reload by id and answer its current state. Not required by the plan; mention in the README if left as is. |
| 4 | minor | `README.md` "Decisions and trade-offs", first and last bullets | The per pod rate limit is stated twice in the same list. | Both bullets in the same section. | Drop one. |

Blocker: 0. Major: 0. Minor: 4.

### Resolution (same day, after the user chose to fix all four)

| # | Outcome | Commit |
|---|---|---|
| 1 | Kept the longer names (the README cites them) and recorded the mapping in plan section 20. | this docs commit |
| 2 | README sharding note rewritten: operations and wallets by `userId`, notifications and ledger by `_id`, cross shard transactions as the cost. | `acc0be4` |
| 3 | Test first (`answers the final result when the operation settles between the lookup and the claim`, red before the fix), then `initiate-cash-in.handler.ts` re-reads the operation when the claim returns `null`. README replay paragraph updated. `npm run check` 140 unit tests green, e2e 48 green. | `4dda34b` |
| 4 | Duplicated bullet merged into one. | `acc0be4` |

No `TODO(reto)` left; no em dash in `README.md`, `docs/`, `CLAUDE.md`, `k8s/`. No entry added to
`docs/ai-log.md`: the audit found no implementation mistake by the agent on a money path.

## Pending user smoke

Not run in this session (the e2e suite covers the behaviors; these prove the packaged artifact):

- `docker compose down -v && docker compose up -d --build --wait && npm run seed`, then the curl
  of the statement example: 200, `new_balance: 350` (boots with `NODE_ENV=production` and the
  compose demo secret).
- README "API examples": same key replay, 422 on another payload, `card_timeout` 202 then 200,
  `card_declined`, 5 parallel `card_slow` with `calls: 1`, the three `send-webhook.mjs` calls
  (`applied`, `duplicate`, `conflict`), 401 without signature.
- Reconciler in compose: a `card_timeout` cash-in left alone completes in about 30 to 45 s
  (`npm run logs`).
- `x-trace-id: demo-1` appears on every log line of the flow.
- CI green on GitHub after the push (the workflow runs the e2e job against compose Mongo).
