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
- **Every new task gets a `verify` spec, sized to the work (proportionality).** Pick the cheapest check that genuinely proves the task — don't over-verify:
  - Behavioural/logic work → the repo's real test runner, **scoped to run in seconds** (`npm test -- --grep webhook`), not a whole multi-minute suite.
  - Build/integration work → a build or lint command.
  - **Visual/cosmetic/copy work (CSS, spacing, wording, layout) or anything with no behaviour to assert → `{ "method": "manual" }`.** This is a legitimate, proportionate choice, not a stigma — the report's "taken on trust" label is simply honest for work a machine can't judge. A one-line CSS change should be a one-line manual task, never a test suite.
- **NEVER write a change-detector verify spec** — one that asserts the *exact source text* of the file under change (e.g. "the CSS contains `padding: 6px 32px 0`"). It proves no behaviour and forces editing the test on every future tweak. If the only check you can devise is pinning the file's own contents, use `method: "manual"` instead.
- **"Stronger" = tests real behaviour, not tighter string matching.** If a single-case spec is weak because a stub could pass it, strengthen toward more *behaviour* (inputs/outputs). If there's no behaviour to test, the answer is `manual` — not a more elaborate source-text assertion.
- **`"audit": "required"` is for substantive logic only** (core/feature/security where a hollow implementation could hide). It adds an independent reviewer agent at checkpoint — never put it on cosmetic, UI, copy, config, or mechanical tasks; it's pure waste where there's nothing to fake.
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
