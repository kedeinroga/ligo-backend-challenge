---
name: challenge-plan
description: First step of the challenge. Turn the challenge statement into a single brief + technical plan at docs/plans/PLAN.md (status DRAFT), asking the user every open decision. Does not write product code. Argument; path to the statement or the pasted statement.
---

# Challenge plan (brief + plan in one document)

Time box: about 20 minutes. Output: `docs/plans/PLAN.md` with status `DRAFT`.
Single quality bar: **if the implementer would have to assume something, the plan is incomplete.**
The plan will be attacked by `/validate-plan` in a fresh session; write it to survive that.

## Before writing

1. Read the full statement, `CLAUDE.md` (engineering rules, binding), `README.md` and
   `docs/ai-log.md`. The statement wins over any default; `CLAUDE.md` governs how code is written.
2. Read the code you will reuse and cite it as `path:line` in "Verified facts":
   `src/shared/{domain,application,infrastructure,api}/*`, `src/config/*`, `src/modules/health/*`.
   Never plan new code for something that already exists; never plan code with no caller.
3. Read the decisions already taken with the user (conversation, memory). Do not reopen them.
4. **Ask the user every decision the statement leaves open BEFORE writing** (AskUserQuestion, few
   per round, recommended option first). Never write the plan with open decisions.

## Document structure (all sections required)

```
# <Challenge name> - Plan
Status: DRAFT

## 1. Problem (statement summary in our words)
## 2. Decisions already taken (with the user, with date) and assumptions
   (each assumption: why, and what changes if it is wrong)
## 3. Out of scope (explicit)
## 4. Ubiquitous language (term -> meaning)
## 5. Domain model
   Per aggregate: id, fields, version, invariants (each one testable), methods,
   error per invariant violation (exception subclass, base class, HTTP status).
## 6. Operation state machine
   States, allowed transitions (table: from, trigger, to), what happens with a transition that is
   not allowed (rejected or ignored, and why), terminal states.
## 7. Persistence model
   Collections, document fields with types, indexes (unique ones and what each protects),
   which writes are one transaction, optimistic concurrency per collection.
## 8. External provider
   Port (methods, inputs, outputs, error types), how our operation id is sent as its idempotency
   key, timeout, the simulated adapter and its configurable behaviors.
## 9. API contract
   Per endpoint: method, path, headers, request DTO with validation limits, every response
   (status + body) per operation state, every error with status and code, example curl.
   Webhook: payload, signature scheme, deduplication key, response codes.
## 10. Flows step by step
   cash-in (new, replay, concurrent duplicate, provider approved / declined / timeout),
   webhook (new, duplicate, out of order, before the API response), reconciliation.
   For each step: what is persisted, what happens if the process dies right after it.
## 11. Scenario matrix
   One row per scenario of the statement -> mechanism that handles it -> test name.
## 12. Retry and timeout policy (what is retried, how many times, backoff, what is never retried)
## 13. Test plan (unit per invariant / transition / handler; e2e incl. real parallel requests)
## 14. Implementation order (small steps, each one = one Conventional Commit, with its tests and
   the full path of every file it creates; step 0 is the initial commit of the clean base,
   done by the user)
## 15. Local verification (command, expected observable result)
## 16. AI log entries to record (corrections already made, risks to watch in implementation)
## 17. Verified facts (path:line of everything reused)
## 18. Open decisions (must be empty before validation)
```

## Rules

- Every file the plan creates follows the folder layout and naming of `CLAUDE.md` section 2.
- Every exception: its base class (`CLAUDE.md` section 8) and `staticCode`.
- The money movement rules of `CLAUDE.md` section 5 are requirements: the plan shows how each
  one is met.
- Money: `Money` value object inside the service; the HTTP contract of the statement at the edge.
- Do not write product code in this step.
- End by telling the user: "Open a NEW session and run `/validate-plan docs/plans/PLAN.md`".
