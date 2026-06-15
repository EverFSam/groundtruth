---
name: report
description: Generate a shareable visual report (self-contained HTML dashboard, optionally CSV for Excel) of all groundtruth-tracked projects — progress, phases, tasks, owners, and trust tiers. Use when the user wants an overview to share with stakeholders, an Excel/spreadsheet export, a dashboard, or to see all projects and who owns what in one place.
---

# groundtruth report

Builds a self-contained HTML dashboard across every tracked project on this machine: portfolio summary, per-project phase bars, a by-owner rollup, and a task table showing each task's owner and trust tier. Optionally also writes a CSV that opens in Excel.

gt.js lives at `<plugin root>/scripts/gt.js` (two levels above this SKILL.md; or `$env:CLAUDE_PLUGIN_ROOT/scripts/gt.js`).

## Steps

1. Decide outputs from the user's request:
   - HTML only (default): `node "<gt.js>" report`
   - HTML + CSV for Excel: `node "<gt.js>" report --csv`
   - Custom location: add `--out "<path>\report.html"` (the CSV, if requested, sits beside it).
2. Run the command. It reads every project in the registry, loading each project's `.groundtruth/map.json`.
3. Report the written file path(s) to the user and offer to open the HTML in their browser. The HTML is fully self-contained (no internet needed) — it can be emailed, dropped on a shared drive, or published to an intranet as-is.

## Rules
- Numbers and trust tiers come straight from the verified maps — do not recompute or editorialize them.
- **Owners are assignments, not evidence.** The report labels them as such; describe them that way too ("who is responsible", not "who has completed").
- If a registered project's map can't be read (e.g. a path that no longer exists), the command skips it and notes it — relay that note rather than hiding it.
- This is read-only: it never changes any map or status.
