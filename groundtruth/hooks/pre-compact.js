'use strict';
// PreCompact: compaction is the moment in-flight detail dies. Flag it so the
// next prompt-guard injection tells Claude to rehydrate from the map, and
// drop a durable marker into session_log.
const fs = require('fs');
const L = require('./lib');

const inp = L.readStdin();
const cwd = inp.cwd || process.cwd();
if (!fs.existsSync(L.mapPath(cwd))) process.exit(0);

const st = L.loadState(cwd);
st.compaction_pending = true;
L.saveState(cwd, st);

const map = L.loadJson(L.mapPath(cwd));
if (map) {
  L.pushSessionLog(map, `${new Date().toISOString()}: context compaction occurred (${st.ops} ops unrecorded at the time)`);
  map.updated = new Date().toISOString();
  L.saveJson(L.mapPath(cwd), map);
  L.saveJson(L.shadowPath(cwd), map); // keep shadow in sync — this write is trusted
}

console.log('[groundtruth] Compaction occurring — project state is preserved in .groundtruth/map.json. After compaction, re-read the map before relying on memory.');
process.exit(0);
