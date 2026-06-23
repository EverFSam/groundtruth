# groundtruth — Quickstart

## 0. Check it's installed (once per machine)

```
claude plugin list
```

Look for `groundtruth@groundtruth-dev — Status: ✓ enabled`. If missing:

```
claude plugin marketplace add <marketplace repo URL or local path>
claude plugin install groundtruth@groundtruth-dev
```

Quick in-session check: type `/groundtruth` in any Claude Code chat — the seven commands should autocomplete.

## 1. Start tracking a project

1. `git init` your project folder (recommended — evidence pins against commits).
2. Open Claude Code **in that folder** (tracking is per-repo).
3. Run `/groundtruth:setup` and do the interview properly:
   - Confirm/correct the proposed phases and tasks; weight phases by importance.
   - **Size each verify spec to the work.** Logic → a scoped test (seconds, not a full suite); build work → a build/lint check; **visual/cosmetic/copy work → `method: "manual"`** (a legitimate choice, not a stigma). Never pin exact source text — it's a brittle change-detector.
   - **Use `"audit": "required"`** only for core/feature/security logic (✓✓ tier: an independent reviewer confirms the implementation is genuine). Skip it for cosmetic, config, and mechanical tasks.
4. Commit `.groundtruth/map.json`. Gitignore `.groundtruth/.shadow.json` and `.groundtruth/.session-state.json` (setup reminds you).

## 2. Day-to-day

| Moment | What to do |
|---|---|
| Session start | Nothing — the verified project summary is auto-injected |
| Working | Nothing — operations are counted silently |
| ⚠ "unrecorded work" warning appears | `/groundtruth:checkpoint` |
| Finished a piece of work / ending the day | `/groundtruth:checkpoint` |
| Want to see where things stand | `/groundtruth:progress` |

Checkpoint runs the verify commands, spawns the independent auditor where required, records signed evidence, and shows the updated map with trust tiers:
`✓✓ verified + audited · ✓ verified · ⏳ awaiting audit · ⚠ manual waiver (taken on trust)`

## 3. Occasional

- `/groundtruth:sync` — weekly, after pulls, **and always after cloning a tracked repo onto a new machine** (evidence is machine-local and re-earned by re-running the verifications). Demotes anything that no longer passes; finds unmapped work in git history.
- `/groundtruth:task` — scope changes: add tasks (verify spec mandatory), block/unblock, record decisions.
- `/groundtruth:portfolio` — all tracked projects on this machine, from anywhere.
- `/groundtruth:report` — shareable HTML dashboard (+ `--csv` for Excel) across all tracked projects, with owners & trust tiers.

## The one rule

**Nobody marks anything done — not you, not Claude.** "Mark X as done" triggers verification; if the tests fail, it stays in progress and you see the failure verbatim. The map can only say what the code can prove.
