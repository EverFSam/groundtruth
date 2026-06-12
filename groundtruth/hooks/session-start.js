'use strict';
// SessionStart: inject a compact, verified project summary so Claude starts
// every session already knowing the project state. Silent no-op if untracked.
const L = require('./lib');

const inp = L.readStdin();
const cwd = inp.cwd || process.cwd();
const map = L.loadJson(L.mapPath(cwd));
if (!map) process.exit(0);

const st = L.loadState(cwd);
st.session_start = new Date().toISOString();
st.warned = 0;
L.saveState(cwd, st);

const lines = [];
lines.push(`[groundtruth] ${map.project} — ${L.overallProgress(map)}% overall (verified state from .groundtruth/map.json)`);
for (const p of (map.phases || [])) {
  const c = L.statusCounts(p);
  const parts = [];
  if (c.done) parts.push(`${c.done} done`);
  if (c.awaiting_audit) parts.push(`${c.awaiting_audit} awaiting audit`);
  if (c.in_progress) parts.push(`${c.in_progress} in progress`);
  if (c.blocked) parts.push(`${c.blocked} BLOCKED`);
  if (c.todo) parts.push(`${c.todo} todo`);
  lines.push(`  ${p.name.padEnd(22)} ${L.bar(L.phaseProgress(p))} ${Math.round(100 * L.phaseProgress(p))}%  (${parts.join(', ') || 'no tasks'})`);
}
const blockers = map.blockers || [];
if (blockers.length) lines.push(`  Blockers (${blockers.length}): ${blockers.join(' | ')}`);
const cps = map.checkpoints || [];
if (cps.length) {
  const last = cps[cps.length - 1];
  const d = L.daysSince(last.date);
  lines.push(`  Last checkpoint: ${last.date} (${d === 0 ? 'today' : d + 'd ago'}) @ ${last.commit || 'no commit'} — "${last.summary}"`);
} else {
  lines.push('  No checkpoints recorded yet.');
}
const log = map.session_log || [];
if (log.length) lines.push(`  In-flight: ${log[log.length - 1]}`);
if (st.ops > 0) lines.push(`  ⚠ ${st.ops} operations from a previous session are unrecorded — run /groundtruth:checkpoint early.`);
const stale = L.daysSince(map.updated);
if (stale !== null && stale > L.settings(map).stale_days) {
  lines.push(`  ⚠ Map last updated ${stale}d ago — may be stale; consider /groundtruth:sync.`);
}
const foreign = L.allTasks(map).filter(t => t.status === 'done' && !L.validEvidence(t));
if (foreign.length) {
  lines.push(`  ⚠ ${foreign.length} done task(s) have evidence not valid on this machine (map cloned from elsewhere?) — run /groundtruth:sync to re-verify locally before trusting or changing statuses.`);
}
lines.push('  Rules: task status may only reach "done" via /groundtruth:checkpoint (it runs the task\'s verify command). Never hand-write evidence blocks.');

console.log(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: lines.join('\n') }
}));
process.exit(0);
