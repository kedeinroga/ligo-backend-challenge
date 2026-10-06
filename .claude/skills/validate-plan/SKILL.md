---
name: validate-plan
description: Adversarially interrogate docs/plans/PLAN.md against the statement, the codebase and the fintech checklist, until it has no ambiguity, then stamp it APPROVED FOR IMPLEMENTATION. Must run in a session different from the one that wrote the plan. Argument; plan path.
---

# Validate plan (interrogation)

Role: **adversarial auditor**. Break the plan before the evaluator breaks the code. You do not
polish the plan out of courtesy: you hunt every point where the implementer would have to assume,
guess or contradict a rule, and every place where money could move twice. Time box: about 10
minutes.

## Process

1. Read the plan, the original statement, `CLAUDE.md`, `README.md` and `docs/ai-log.md`.
2. **Re-verify every entry of "Verified facts"** by opening the cited `path:line`. A fact that is
   no longer true invalidates everything built on it.
3. Check statement coverage: every requirement, every scenario and every red flag of the statement
   maps to a section of the plan. List any with no mapping.
4. Run the checklist below. For each failing item write the exact gap.
5. Ambiguities only the user can decide: ask (AskUserQuestion). Gaps you can close from the
   statement or the code: fix them in the plan and log them.
6. Iterate until the checklist passes. Then set `Status: APPROVED FOR IMPLEMENTATION` and append
   a "Validation log" section (what was found, how it was resolved). Add to `docs/ai-log.md` any
   flaw the validation caught in the plan the agent wrote.
7. If the gaps are structural (wrong aggregate boundaries, missing flows), do not patch: set
   `Status: RETURNED` with the list, and tell the user to rerun `/challenge-plan`.

## Checklist

**Idempotency and concurrency (eliminatory in the rubric)**
- [ ] Idempotency guarantee lives in MongoDB (unique index), scoped per user; nothing relies on
      process memory. Walk through 5 pods receiving the same key at the same instant: exactly one
      calls the provider, and what each of the other four answers is specified.
- [ ] Same key with a different payload: detected (fingerprint) and its error defined.
- [ ] The key is never released once the provider may have been called.
- [ ] Our operation id is the provider's idempotency key; a repeated provider call cannot charge
      twice.
- [ ] Balance race: two different operations crediting the same wallet concurrently both land,
      exactly once each (transaction and/or optimistic version), and the conflict path is defined.
- [ ] Credit exactly once: unique ledger entry per operation id, written in the same transaction
      as the balance change and the operation's terminal state.

**Resilience**
- [ ] Provider timeout / unknown outcome: response to the client, persisted state, and how it is
      resolved later (webhook, retry with same key, reconciler).
- [ ] Process restart after each persisted step: the plan says how the operation finishes.
- [ ] Temporary DB failure before and after calling the provider: outcome for the client and for
      the money.
- [ ] Retry policy: only idempotent calls, bounded, backoff with jitter; what is never retried.
- [ ] Reconciler: what it selects, how two pods avoid processing the same operation twice.
- [ ] Every external call has a configured timeout.

**Webhooks**
- [ ] Signature verification and the response for an invalid signature.
- [ ] Deduplication by provider event id (unique index), and the response for a duplicate.
- [ ] Out of order: a stale or late event never moves a terminal operation; defined per transition.
- [ ] Webhook arriving before the API response: the API path and the webhook path both converge
      to one credit.
- [ ] Webhook for an unknown operation: response defined.

**Domain and money**
- [ ] Each invariant is protected by exactly one aggregate and has: the method that can break it,
      the exception subclass, the HTTP status and a named unit test.
- [ ] State machine table is complete: every (state, trigger) pair has a defined result.
- [ ] `Money` inside the service; the JSON number contract converted through a decimal string,
      max 2 decimals, positive, allowed currencies listed. No float arithmetic anywhere.

**Contract**
- [ ] Every endpoint: method, path, headers, DTO with validation limits, every response per
      operation state (200 completed, 202 pending, failure), every error with status and code.

**Tests and delivery**
- [ ] Tests required by the statement are named: idempotency, duplicity, success, provider failure.
- [ ] Every row of the scenario matrix has a test or a manual verification step.
- [ ] At least one e2e proves concurrency with real parallel requests against real Mongo.
- [ ] Implementation order: small steps, each with its tests, file paths and commit message.
- [ ] Local verification: each step has command and expected observable result.
- [ ] Fits the time left. If not, the plan says what is cut and the README says why.

**Standards** (`CLAUDE.md`)
- [ ] Every new file has its path, layer and role suffix (section 2); no layer rule is broken (section 1).
- [ ] Every command: `Command<R>`, `traceId` last, one handler (section 4).
- [ ] Every endpoint: the decorator block of section 7, DTOs with limits, response mapper.
- [ ] Every exception: base class and HTTP status from section 8.
- [ ] Nothing is planned without a caller (no dead code, no speculative ports or config).

**Ambiguity**
- [ ] No "etc.", no "and so on", no unnamed types, no unspecified order. Two implementers would
      write the same thing.

## Rules

- Never write product code here. Only edit the plan (and `docs/ai-log.md`).
- Never approve with open decisions.
