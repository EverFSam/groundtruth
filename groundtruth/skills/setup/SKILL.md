---
name: setup
description: Set up / initialize groundtruth project tracking in the current repo — scan the codebase, interview the user to define phases and tasks (each with a verification command), and create .groundtruth/map.json. Use when the user wants to start tracking a project, set up or initialize groundtruth, or says "init the project map".
---

# groundtruth setup

The gt.js CLI lives at `<plugin root>/scripts/gt.js` — the `scripts/` directory two levels above this SKILL.md file. In shell commands you may also use the `CLAUDE_PLUGIN_ROOT` environment variable: `node "$env:CLAUDE_PLUGIN_ROOT/scripts/gt.js"` (PowerShell) or `node "$CLAUDE_PLUGIN_ROOT/scripts/gt.js"` (bash).

(The user-facing command is `/groundtruth:setup` to avoid clashing with Claude Code's built-in `/init`. The gt.js CLI subcommand is still `init`.)

## Steps

1. **Scan, don't assume.** Look at the repo: structure, package manifests, test setup, recent git log, TODO/FIXME comments. Build a *proposed* phase/task breakdown from what you find.
2. **Interview the user.** Present the proposal and ask them to confirm, correct, and weight the phases. The map is the user's plan, not your guess. Ask about known blockers and decisions worth recording.
3. **Give every task a verify spec — but match the spec to the work (proportionality).** The goal is a *trustworthy* "done", not maximal ceremony. Pick the cheapest check that genuinely proves the task, scaled to what the task is:
   - **Behavioural/logic work** (endpoints, parsing, business rules): the repo's real test runner, scoped where possible (`npm test -- --grep auth`, `pytest tests/auth`). Scope it so it runs in seconds, not a whole multi-minute suite.
   - **Build/integration work**: a build or lint command (`npm run build`, `dotnet build`).
   - **Visual / cosmetic / copy work** (CSS tweaks, spacing, wording, layout) and anything with **no meaningful behaviour to assert**: use `{ "method": "manual" }`. This is a legitimate, proportionate choice — **not** a failure or a stigma. The report labels it "taken on trust", which is the honest truth for work a machine can't judge. Do not contort a cosmetic change into a fake automated test.
   - **NEVER write a change-detector test** — a verify command that asserts the *exact source text* of the file you're changing (e.g. "the CSS file contains `padding: 6px 32px 0`"). It proves no behaviour, and it couples every future tweak to editing the test in lockstep. If the only "test" you can think of is pinning the file's own contents, that's the signal to use `method: "manual"` instead.
   - **"Stronger" means tests real behaviour, not tighter string matching.** If a spec is weak because a stub could pass it, strengthen it toward *behaviour* (more inputs/outputs). If there is no behaviour to test, the right answer is `manual` — never a more elaborate source-text assertion.
   - **Audit is for substantive logic only.** Recommend `"audit": "required"` (which adds an independent reviewer agent at checkpoint, ✓✓ tier) for core/feature/security logic where a hollow implementation could hide. Do **not** put it on cosmetic, UI, copy, config, or mechanical tasks — it spawns a whole extra review agent and is pure waste on changes with nothing to fake.
   The user approves each spec. The aim: a one-line CSS change should cost a one-line manual task, not a test suite.
4. **Create the map.** Run `node <gt.js> init --name "<project>"`, then Edit `.groundtruth/map.json` to add the agreed phases and tasks. Schema per task:
   ```json
   { "id": "api-1", "desc": "Port auth endpoints", "status": "todo", "owner": "Alex",
     "verify": { "method": "command", "run": "npm test -- --grep auth", "expect": "exit_code_0" } }
   ```
   The optional `owner` field records who is responsible (free text; shown in `/groundtruth:report`, never affects progress). Ask the user whether they want to assign owners.
   Statuses: `todo | in_progress | blocked | done`. Never set `done` here.
5. **Gitignore the runtime files.** Add `.groundtruth/.shadow.json` and `.groundtruth/.session-state.json` to .gitignore. `map.json` itself SHOULD be committed.
6. **Commit** the map (if the repo uses git) and show the user `node <gt.js> status`.

## Rules
- Never mark any task `done` during setup, even for work that looks finished — tell the user to run /groundtruth:checkpoint, which verifies it properly.
- Do not invent tasks the user didn't agree to.
