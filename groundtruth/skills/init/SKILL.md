---
name: init
description: Initialize groundtruth project tracking in the current repo — scan the codebase, interview the user to define phases and tasks (each with a mandatory verification command), and create .groundtruth/map.json. Use when the user wants to start tracking a project, set up groundtruth, or says "init the project map".
---

# groundtruth init

The gt.js CLI lives at `<plugin root>/scripts/gt.js` — the `scripts/` directory two levels above this SKILL.md file. In shell commands you may also use the `CLAUDE_PLUGIN_ROOT` environment variable: `node "$env:CLAUDE_PLUGIN_ROOT/scripts/gt.js"` (PowerShell) or `node "$CLAUDE_PLUGIN_ROOT/scripts/gt.js"` (bash).

## Steps

1. **Scan, don't assume.** Look at the repo: structure, package manifests, test setup, recent git log, TODO/FIXME comments. Build a *proposed* phase/task breakdown from what you find.
2. **Interview the user.** Present the proposal and ask them to confirm, correct, and weight the phases. The map is the user's plan, not your guess. Ask about known blockers and decisions worth recording.
3. **Verification specs are mandatory.** For every task, propose a concrete `verify` command (prefer the repo's real test runner, e.g. `npm test -- --grep auth`, `pytest tests/auth`, a build command, or a script). The user must approve each one. If a task genuinely cannot be machine-verified, it gets `{ "method": "manual" }` — tell the user the consequence: it will be permanently flagged "⚠ unverified" in every report and can only be completed via an explicit waiver.
   - **Flag weak specs**: if a command only asserts a single case, a hardcoded stub could pass it — say so and propose a stronger multi-case test.
   - **Recommend `"audit": "required"`** for feature/core-logic tasks: completion then also needs an independent reviewer agent to confirm the implementation is genuine (✓✓ tier). Mechanical tasks (renames, config, docs) don't need it.
4. **Create the map.** Run `node <gt.js> init --name "<project>"`, then Edit `.groundtruth/map.json` to add the agreed phases and tasks. Schema per task:
   ```json
   { "id": "api-1", "desc": "Port auth endpoints", "status": "todo",
     "verify": { "method": "command", "run": "npm test -- --grep auth", "expect": "exit_code_0" } }
   ```
   Statuses: `todo | in_progress | blocked | done`. Never set `done` here.
5. **Gitignore the runtime files.** Add `.groundtruth/.shadow.json` and `.groundtruth/.session-state.json` to .gitignore. `map.json` itself SHOULD be committed.
6. **Commit** the map (if the repo uses git) and show the user `node <gt.js> status`.

## Rules
- Never mark any task `done` during init, even for work that looks finished — tell the user to run /groundtruth:checkpoint, which verifies it properly.
- Do not invent tasks the user didn't agree to.
