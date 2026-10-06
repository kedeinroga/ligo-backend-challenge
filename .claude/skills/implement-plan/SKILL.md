---
name: implement-plan
description: Implement an APPROVED docs/plans/PLAN.md literally, step by step, with tests and one Conventional Commit per step, closing each block with a verification report. Pushes are done by the user. Argument; plan path.
---

# Implement approved plan

Execute the plan **literally**. It passed `/validate-plan` so nothing is decided here: **if you
reach a point where you would have to assume or improvise, STOP** and report it as a plan gap.
Small, obvious gaps (a missing import, a name implied by the plan) can be closed and logged in the
plan's "Implementation log"; anything that changes behavior or contract goes to the user.

## Preconditions (verify, do not trust)

- The plan header says `Status: APPROVED FOR IMPLEMENTATION`. If not, stop and say so.
- The repository exists and the clean base is committed (step 0 of the plan, done by the user).
- `git status` is clean. If not, ask before continuing.

Write every line following `CLAUDE.md`. When the plan and `CLAUDE.md` seem to disagree, stop and
ask: do not pick one silently.

## Per step of "Implementation order"

1. Write the code and its tests in the same step (domain test for each invariant and transition,
   handler test with the in-memory doubles of the context and `NoopLogsService`).
2. Review your own output against `CLAUDE.md` section 5 (money movement rules) before running
   anything: in-memory state, released keys, blind retries, missing timeouts.
3. Run `npm run check` (its lint enforces the layer rules). It must be green before committing.
4. Commit with the message given in the plan. Conventional Commits, lowercase subject, no trailing
   period. **No Co-Authored-By or any AI attribution line.**
5. Never `git push` (blocked by the guard). The user pushes.

When the user or a test catches a mistake you made, fix it and add an entry to `docs/ai-log.md`
(what was asked, what the agent produced, why it was wrong, how it was corrected).

## Closing a block (every 3 or 4 steps, and at the end)

Run the e2e tests if infrastructure changed (`npm run infra:up && npm run test:e2e`), execute the
plan's local verification steps you can, and report:

| Item | Verified by tests | Verified by Claude (command + result) | Pending user smoke |
|---|---|---|---|

Then list: plan gaps found, decisions taken and logged, time spent vs plan, and what is next.

## At the end

- Fill every `TODO(reto)` section of `README.md` from the plan and `docs/ai-log.md`.
- Final `npm run check` and `npm run test:e2e` green, and `docker compose up --build` healthy.
- Report the final table and remind the user to push from their own terminal.
