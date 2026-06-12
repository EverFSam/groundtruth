# groundtruth

Evidence-based project tracking for Claude Code that survives context loss.
No task is "done" until its verification command passes.

Full design rationale: see `groundtruth-plugin.md` in `~/.claude`.

## Commands
| Command | What it does |
|---|---|
| `/groundtruth:init` | Scan repo + interview user → create `.groundtruth/map.json` |
| `/groundtruth:status` | Verified progress report (bars, ✓/⚠, blockers, health) |
| `/groundtruth:checkpoint` | Run verify commands → signed evidence → checkpoint entry |
| `/groundtruth:sync` | Re-verify all done tasks (demotes regressions), find unmapped work |
| `/groundtruth:task` | Add/edit tasks (verify spec mandatory; `done` forbidden here) |
| `/groundtruth:portfolio` | All tracked projects on this machine at a glance |

## How "done" is enforced
1. Every task declares a `verify` command at creation.
2. `scripts/gt.js verify` runs it; pass ⇒ evidence block `{verified_at, commit, exit_code, output_digest, sig}` where `sig` is keyed by a machine-local secret (`~/.claude/groundtruth/secret`).
3. Tasks with `"audit": "required"` then become `awaiting_audit`, not done. `gt.js audit <id>` emits an audit packet (changed files + deterministic smell scan for TODO/stub markers, hardcoded string returns, mock values); an **independent reviewer agent** (fresh context) tries to refute completion; its verdict is recorded signed. `pass` ⇒ done (✓✓). `refuted` ⇒ demoted, evidence cleared.
4. A PostToolUse hook (`hooks/map-validator.js`) compares every map change to a shadow copy and **reverts** any `done` lacking valid signed evidence (and audit, where required) — even if written via shell.
5. `/groundtruth:sync` re-runs evidence and demotes regressions; an audit recorded at an older commit no longer vouches for newer code.

## Trust tiers
| Tier | Meaning |
|---|---|
| ✓✓ | verify command passed AND an independent reviewer agent failed to refute the implementation |
| ✓ | verify command passed |
| ⏳ | verified, awaiting independent audit — NOT done |
| ⚠ | manual waiver — taken on trust, permanently flagged |

## Honest limits
- Evidence proves *the command passed*, not that the command was a good test — the user approves verify specs at creation, and weak single-case specs are flagged.
- The audit verdict is **model judgment, not deterministic proof** — a fresh-context adversarial reviewer is far harder to fool than the author grading its own work, but it is a different trust class than an exit code; that's why the tiers are displayed.
- `method: "manual"` tasks are completed by waiver only and are permanently flagged ⚠ unverified.
- A user (or a determined agent reading the secret file) can forge a signature; the gate is designed to stop *hallucinated* completions, not malicious ones.

## Per-repo files
- `.groundtruth/map.json` — the project map. **Commit this.**
- `.groundtruth/.shadow.json`, `.groundtruth/.session-state.json` — runtime state. **Gitignore these.**

## Team use
- Install once per developer: `claude plugin marketplace add <marketplace repo>` then `claude plugin install groundtruth@groundtruth-dev`.
- The map travels in git. Evidence signatures are **machine-local by design**: after cloning or pulling a tracked project, run `/groundtruth:sync` to re-verify everything locally — don't trust another machine's claims, re-earn them. Checkpoints refuse until this is done, and the session-start summary will remind you.
- Map merge conflicts are resolved like any code conflict, then `/groundtruth:sync` re-establishes ground truth.
- **CI (optional but recommended):** have CI run each task's verify command so the map can never drift unnoticed. The simplest portable form is a job that checks out the repo and runs the `verify.run` commands from `.groundtruth/map.json` — e.g. `node -e "const m=require('./.groundtruth/map.json'); let f=0; for (const p of m.phases) for (const t of p.tasks||[]) if (t.status==='done' && t.verify?.run) { try { require('child_process').execSync(t.verify.run,{stdio:'inherit'}) } catch { f++; console.error('REGRESSED: '+t.id) } } process.exit(f?1:0)"`. CI failure = the map claims something the code no longer does.
