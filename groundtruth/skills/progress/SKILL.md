---
name: progress
description: Show the verified progress report for the current project from its groundtruth map. Use when the user asks how far along the project is, for project progress or a status update, what's left, or where things stand.
---

# groundtruth progress

Run from the repo root (gt.js lives at `<plugin root>/scripts/gt.js`, two levels above this SKILL.md; or use `$env:CLAUDE_PLUGIN_ROOT/scripts/gt.js`):

```
node "<plugin root>/scripts/gt.js" status
```

(The CLI subcommand is `status`; the user-facing command is `/groundtruth:progress` to avoid clashing with Claude Code's built-in `/status`.)

## Rules
- Show the script output to the user **verbatim in a code block**. Do not recompute, round, or "correct" any number — the script is the source of truth, not your memory of the session.
- Never describe a task as done unless the report marks it ✓. Tasks under "⚠ unverified" must be described as "claimed done, not verified". Tasks marked ⏳ are "verified but awaiting independent audit" — not done. The trust tiers are: ✓✓ verified + independently audited, ✓ verified (command passed), ⚠ manual waiver.
- After the report, add at most 3 sentences of interpretation: the biggest current risk, the next milestone, and any recommended action (e.g. re-verify candidates → suggest /groundtruth:sync).
- If the script reports there is no map, suggest /groundtruth:init.
- In GUI surfaces, you may additionally render the same data as a visual widget (progress bars per phase, blocker badges, ✓/⚠ markers) — but only from the script's output, never from conversation memory.
