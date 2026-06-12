---
name: portfolio
description: Show all groundtruth-tracked projects across the machine — progress, blockers, and staleness for each. Use when the user asks about all their projects, a portfolio view, or which project needs attention.
---

# groundtruth portfolio

Run (from anywhere — no repo needed; gt.js lives at `<plugin root>/scripts/gt.js`, two levels above this SKILL.md, or `$env:CLAUDE_PLUGIN_ROOT/scripts/gt.js`):

```
node "<plugin root>/scripts/gt.js" portfolio
```

Show the output verbatim in a code block. Projects are sorted most-stale first. Add at most 2 sentences: which project most needs attention and why (stale map, blockers, or never checkpointed). Numbers come from each project's last verified checkpoint — note that a stale project's % may be out of date and suggest running /groundtruth:sync inside it.
