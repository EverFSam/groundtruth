---
name: sync
description: Reconcile the groundtruth map with codebase reality — re-run all verifications, demote regressed tasks, and find unmapped work in git history. Use when the map may be stale, after pulling changes, weekly on long projects, or when the user asks "is the map accurate?".
---

# groundtruth sync

gt.js lives at `<plugin root>/scripts/gt.js` (two levels above this SKILL.md; or `$env:CLAUDE_PLUGIN_ROOT/scripts/gt.js`). Run from the repo root.

## Steps

1. **Re-verify everything marked done:**
   ```
   node "<gt.js>" verify --all
   ```
   Any task whose evidence no longer holds is automatically DEMOTED to in_progress with a regression note in session_log. Audit-required tasks whose code changed since their audit drop to `awaiting_audit` (a stale audit does not vouch for new code) — re-run the audit flow from /groundtruth:checkpoint step 3b for them. This is the only tracker behaviour that moves progress backwards — and that is a feature. Report demotions to the user prominently.
2. **Find unmapped work.** Compare git history since the last checkpoint (`git log --oneline --stat` since the last checkpoint's commit) against the map. Significant work with no corresponding task → propose new tasks to the user (each with a verify spec). Do not add them without agreement.
3. **Find dead tasks.** Tasks whose target code/feature no longer exists → propose removal or rewording to the user.
4. **Report drift explicitly**, e.g.: "Map said 42%; verified reality is 38%. 1 regression (api-1 tests now failing), 2 unmapped work streams found." Then show `node "<gt.js>" status` verbatim.

## Hard rules
- Never re-promote a demoted task by editing the map — fix the underlying failure, then /groundtruth:checkpoint verifies it again.
- Drift findings are reported to the user; the user decides on map changes (except automatic demotions, which are evidence-driven).
