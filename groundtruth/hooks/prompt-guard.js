'use strict';
// UserPromptSubmit: warn (Claude AND user) when too much work has happened
// since the last checkpoint — i.e. when context loss would actually cost
// something. Escalates once at 2x threshold, then stays quiet until checkpoint.
const fs = require('fs');
const L = require('./lib');

const inp = L.readStdin();
const cwd = inp.cwd || process.cwd();
const map = L.loadJson(L.mapPath(cwd));
if (!map) process.exit(0);

const st = L.loadState(cwd);
const cfg = L.settings(map);
const msgs = [];

if (st.compaction_pending) {
  msgs.push('Context was compacted. Re-read .groundtruth/map.json before relying on memory of project state, make sure session_log reflects in-flight work, and run /groundtruth:checkpoint if any tasks were completed.');
  st.compaction_pending = false;
}

const baseTs = st.last_checkpoint_at || st.session_start;
const minutes = baseTs ? Math.floor((Date.now() - Date.parse(baseTs)) / 60000) : 0;
const ratios = [
  st.ops / cfg.ops_warn,
  st.files.length / cfg.files_warn,
  minutes / cfg.minutes_warn,
];
const level = Math.max(...ratios);
const detail = `${st.ops} operations, ${st.files.length} files touched, ${minutes} min since last checkpoint`;

if (level >= 2 && st.warned < 2) {
  msgs.push(`⚠ groundtruth: context degradation likely (${detail}). Checkpoint BEFORE continuing: /groundtruth:checkpoint.`);
  st.warned = 2;
} else if (level >= 1 && st.warned < 1) {
  msgs.push(`⚠ groundtruth: ${detail} — unrecorded work is at risk of context loss. Recommend /groundtruth:checkpoint.`);
  st.warned = 1;
}

const stale = L.daysSince(map.updated);
if (stale !== null && stale > cfg.stale_days && !st.stale_warned) {
  msgs.push(`groundtruth: map last updated ${stale}d ago — it may have drifted from the codebase. Recommend /groundtruth:sync.`);
  st.stale_warned = true;
}

L.saveState(cwd, st);
if (msgs.length) console.log('[groundtruth] ' + msgs.join('\n[groundtruth] '));
process.exit(0);
