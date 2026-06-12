'use strict';
// PostToolUse gate: any change to map.json (via any tool, including shell) is
// validated against the shadow copy. Tasks marked "done" without signed
// verification evidence are reverted and the edit is reported back to Claude.
// This is the anti-hallucination enforcement layer — a script, not an instruction.
const fs = require('fs');
const L = require('./lib');

const inp = L.readStdin();
const cwd = inp.cwd || process.cwd();
const mp = L.mapPath(cwd);
const sp = L.shadowPath(cwd);
if (!fs.existsSync(mp)) process.exit(0);

const shadow = L.loadJson(sp);
let map = null;
try { map = JSON.parse(fs.readFileSync(mp, 'utf8')); } catch { /* corrupted */ }

if (!map) {
  if (shadow) {
    L.saveJson(mp, shadow);
    console.error('[groundtruth] BLOCKED: map.json was corrupted by the last edit. It has been restored from the last valid state (.groundtruth/.shadow.json). Re-apply your change as valid JSON.');
    process.exit(2);
  }
  process.exit(0);
}

// First sighting of a valid map (e.g. just created by /groundtruth:init): adopt it.
if (!shadow) { L.saveJson(sp, map); process.exit(0); }

// Fast path: nothing changed.
if (JSON.stringify(map) === JSON.stringify(shadow)) process.exit(0);

const prevTasks = new Map(L.allTasks(shadow).map(t => [t.id, t]));
const reverted = [];
const restored = [];
const warnings = [];

for (const t of L.allTasks(map)) {
  const prev = prevTasks.get(t.id);
  const prevGood = prev && prev.status === 'done' && L.validEvidence(prev);
  if (t.status === 'done' && !L.validEvidence(t)) {
    if (prevGood) {
      // The task WAS legitimately done and its evidence got altered (hand edit,
      // JSON reformat) — self-heal from the last valid state instead of demoting.
      t.evidence = prev.evidence;
      if (prev.audit_result) t.audit_result = prev.audit_result; else delete t.audit_result;
      restored.push(`"${t.id}"`);
    } else {
      // Fresh unevidenced done — revert and strip fake evidence.
      t.status = prev && prev.status !== 'done' ? prev.status : 'in_progress';
      delete t.evidence;
      delete t.audit_result;
      reverted.push(`"${t.id}" (no valid verification evidence)`);
    }
  } else if (t.status === 'done' && L.auditRequired(t) && !L.validAudit(t)) {
    if (prevGood && L.validAudit(prev)) {
      t.audit_result = prev.audit_result;
      restored.push(`"${t.id}" (audit block)`);
    } else {
      // Verified but the required independent audit is missing, forged, or stale.
      t.status = 'awaiting_audit';
      reverted.push(`"${t.id}" (audit required but missing/invalid — run gt.js audit ${t.id})`);
    }
  }
  if (!t.verify || !t.verify.method) {
    warnings.push(`task "${t.id}" has no verify spec — add { method, run } (or method:"manual") so it can ever be completed`);
  }
}

if (reverted.length || restored.length) {
  map.updated = new Date().toISOString();
  L.saveJson(mp, map);
  L.saveJson(sp, map);
  const msg = ['[groundtruth]'];
  if (reverted.length) msg.push(`BLOCKED: ${reverted.join(', ')} — status reverted. To complete a task, run /groundtruth:checkpoint — it executes the task's verify command (and independent audit where required) and records signed evidence. Never hand-write or copy evidence/audit blocks.`);
  if (restored.length) msg.push(`RESTORED: evidence/audit blocks of ${restored.join(', ')} were altered by the last edit and have been restored from the last valid state. Never modify evidence blocks; when editing map.json preserve them byte-for-byte (use the Edit tool, not JSON re-serialization).`);
  if (warnings.length) msg.push('Also: ' + warnings.join('; ') + '.');
  console.error(msg.join(' '));
  process.exit(2);
}

L.saveJson(sp, map);
if (warnings.length) {
  console.error('[groundtruth] WARNING: ' + warnings.join('; ') + '.');
  process.exit(2); // surfaces the warning to Claude; the edit itself stands
}
process.exit(0);
