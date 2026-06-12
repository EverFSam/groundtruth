'use strict';
// SessionEnd: if work happened that was never checkpointed, leave a durable
// note in session_log so the next session (and the next human) knows.
const fs = require('fs');
const L = require('./lib');

const inp = L.readStdin();
const cwd = inp.cwd || process.cwd();
if (!fs.existsSync(L.mapPath(cwd))) process.exit(0);

const st = L.loadState(cwd);
if ((st.ops || 0) > 0) {
  const map = L.loadJson(L.mapPath(cwd));
  if (map) {
    L.pushSessionLog(map, `${new Date().toISOString()}: session ended with ${st.ops} unrecorded operations (${st.files.length} files) — run /groundtruth:checkpoint`);
    map.updated = new Date().toISOString();
    L.saveJson(L.mapPath(cwd), map);
    L.saveJson(L.shadowPath(cwd), map); // trusted write
  }
  console.log(`[groundtruth] Session ended with ${st.ops} unrecorded operations — checkpoint next session or state may be lost.`);
}
process.exit(0);
