---
name: checkpoint
description: Record a verified project checkpoint — run verification commands for completed tasks, record signed evidence, append a checkpoint entry, and show the progress report. Use when work has been completed, before ending a session, when the context-degradation warning fires, or when the user says "checkpoint" or "save progress".
---

# groundtruth checkpoint

gt.js lives at `<plugin root>/scripts/gt.js` (two levels above this SKILL.md; or `$env:CLAUDE_PLUGIN_ROOT/scripts/gt.js`). Run everything from the repo root.

## Steps

1. **Identify candidates.** From the session, list tasks that may have been completed since the last checkpoint. If a piece of completed work has no task in the map, add the task first (with a verify spec) via the rules in /groundtruth:task — then verify it.
2. **Verify — never assert.** For each candidate:
   ```
   node "<gt.js>" verify <taskId> [<taskId> ...]
   ```
   The script runs each task's verify command and writes signed evidence only on pass. Tasks with `"audit": "required"` become `awaiting_audit` instead of done — proceed to the audit step.
3. **Report failures verbatim.** If a verification FAILS, show the user the failure output exactly as printed. Never soften it, summarize it away, or re-run repeatedly hoping for green. A failed task stays in_progress — that is correct behaviour, not an error to fix by editing the map.
3b. **Independent audit (for tasks now awaiting_audit).** Verification proves the command passed; the audit checks the implementation is genuine (not a hardcoded value, stub, or test-only path).
   - Run `node "<gt.js>" audit <taskId>` to get the audit packet (changed files + deterministic smell scan).
   - Spawn an **independent reviewer agent via the Agent tool** (fresh context — it must NOT be you, and must have no memory of writing the code). Give it the packet, the task description, and the repo path, with instructions to REFUTE completion: hunt for hardcoded returns, stubs, unused parameters, swallowed errors, logic that can't satisfy the task in the general case. Every claim must cite file:line.
   - Record the agent's verdict exactly as it returned it:
     `node "<gt.js>" audit <taskId> --verdict pass|refuted --reasons "<the agent's cited findings>"`
   - HARD RULE: the verdict comes from the independent agent's output, never from your own judgment of your own work. A "refuted" verdict demotes the task and clears its evidence — report the findings to the user verbatim; that is the system working.
4. **Manual tasks** can only be completed by an explicit waiver, and only with the user's confirmation in this conversation:
   ```
   node "<gt.js>" waive <taskId> --note "<who confirmed and how>"
   ```
5. **Record the checkpoint:**
   ```
   node "<gt.js>" checkpoint --summary "<2-3 factual lines of what verifiably changed>" --log "<1-line in-flight note: current task, exact stopping point, next step>"
   ```
   The summary must only claim what verification proved. The --log note is the lifeboat the next session rehydrates from — make it specific.
6. **Show the output verbatim** (it includes the visual progress report and the delta since the last checkpoint).

## Hard rules
- NEVER edit `status: "done"` or `evidence` blocks into map.json by hand — a validator hook will revert it and flag you.
- If `gt.js checkpoint` refuses because of unevidenced done tasks, run `verify` for them; do not work around it.
- Update `blockers` and `decisions` arrays in map.json (via Edit) as part of the checkpoint if they changed — those are free-text and not gated.
