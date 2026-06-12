'use strict';
// PostToolUse: count mutating operations since the last checkpoint. Feeds the
// context-degradation warnings in prompt-guard.js. Persists across sessions —
// unrecorded work from a previous session still counts.
const fs = require('fs');
const L = require('./lib');

const inp = L.readStdin();
const cwd = inp.cwd || process.cwd();
if (!fs.existsSync(L.mapPath(cwd))) process.exit(0);

const st = L.loadState(cwd);
st.ops = (st.ops || 0) + 1;
const fp = inp.tool_input && inp.tool_input.file_path;
if (fp && !st.files.includes(fp)) st.files.push(fp);
L.saveState(cwd, st);
process.exit(0);
