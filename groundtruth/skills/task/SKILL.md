---
name: task
description: Add, update, or block tasks and phases in the groundtruth map, or record decisions and blockers. Use when scope changes, new work is identified, a task gets blocked or unblocked, or the user wants to add/edit project tasks.
---

# groundtruth task

Tasks are edited directly in `.groundtruth/map.json` with the Edit tool. A validator hook checks every change.

## Task schema

```json
{ "id": "api-3", "desc": "Webhook signature validation", "status": "todo",
  "owner": "Alex",
  "audit": "required",
  "verify": { "method": "command", "run": "npm test -- --grep webhook", "expect": "exit_code_0" } }
```

The optional `owner` field records who is responsible for a task (free text — a name or handle). It is an assignment, not evidence; it appears in `/groundtruth:report` but never affects progress or trust tiers.

## Rules
- **Every new task MUST have a `verify` spec** — propose one from the repo's real test/build tooling and get the user's approval. `{ "method": "manual" }` is the explicit last resort and the user must accept that the task will be permanently flagged ⚠ unverified.
- **Flag weak verify specs.** If a proposed command only asserts a single case (one fixture, file-exists, exit-0 of a trivial script), tell the user a stub or hardcoded value could pass it, and propose a stronger multi-case test.
- **Recommend `"audit": "required"`** for feature/core-logic tasks: completion then needs the verify command to pass AND an independent reviewer agent to confirm the implementation is genuine (tier ✓✓). Skip it for mechanical tasks (renames, config, docs).
- Allowed status edits: `todo ↔ in_progress ↔ blocked`. Setting `done` (or `awaiting_audit`) here is FORBIDDEN — the validator hook will revert it. Completion happens only via /groundtruth:checkpoint.
- Never write or modify `evidence` or `audit_result` blocks.

## When the plan changes (the three options)
- **Goal changed, task lives on** → edit the task's `desc` and `verify.run` in place. The new verify command becomes the new "definition of done". If the task was already `done`, do NOT mutate it (its evidence would no longer match the new goal) — instead create a NEW task with a new id for the new goal and cancel or leave the old one as the honest record of what was built.
- **Task no longer wanted** → set `"status": "cancelled"` and add `"cancel_reason": "<why, dated>"`. Cancelled (descoped) tasks need NO evidence, are EXCLUDED from progress (so the project can still reach 100%), and show as `⊘ descoped` with their reason in status and reports. Prefer this over deletion — it keeps the audit trail of *why* scope was dropped.
- **Genuine mistake** → delete the task object entirely (only when it should never have existed).
- Record the surrounding decision in the `decisions` array regardless, so the *reasoning* for the change survives.
- When blocking a task, also add a line to the top-level `blockers` array (with date and who/what it's waiting on). Remove it when unblocked.
- Record significant decisions in the `decisions` array as one-liners with date and rationale.
- New phases need `id`, `name`, `weight` (relative importance, integer), `tasks`.
- Keep ids short, kebab-case, prefixed by phase (e.g. `api-3`).
