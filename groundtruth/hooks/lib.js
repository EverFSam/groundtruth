'use strict';
// Shared helpers for groundtruth hooks and CLI. Zero external dependencies.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8')); } catch { return {}; }
}

function gtDir(cwd) { return path.join(cwd, '.groundtruth'); }
function mapPath(cwd) { return path.join(gtDir(cwd), 'map.json'); }
function shadowPath(cwd) { return path.join(gtDir(cwd), '.shadow.json'); }
function statePath(cwd) { return path.join(gtDir(cwd), '.session-state.json'); }

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function saveJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function homeDir() { return path.join(os.homedir(), '.claude', 'groundtruth'); }
function registryPath() { return path.join(homeDir(), 'registry.json'); }

// Evidence blocks are signed with a machine-local secret so a hand-written
// (hallucinated) evidence block fails validation. Defense-in-depth, not crypto:
// see README "Honest limits".
function getSecret() {
  const f = path.join(homeDir(), 'secret');
  if (!fs.existsSync(f)) {
    fs.mkdirSync(homeDir(), { recursive: true });
    fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'));
  }
  return fs.readFileSync(f, 'utf8').trim();
}

function evidenceSig(taskId, evidence) {
  return crypto.createHash('sha256')
    .update([getSecret(), taskId, evidence.verified_at, String(evidence.exit_code)].join('|'))
    .digest('hex').slice(0, 16);
}

function validEvidence(task) {
  const e = task.evidence;
  if (!e) return false;
  if ((task.verify || {}).method === 'manual') return e.waiver === true && !!e.verified_at;
  return e.exit_code === 0 && !!e.verified_at && e.sig === evidenceSig(task.id, e);
}

function auditRequired(task) { return task.audit === 'required'; }

function auditSig(taskId, a) {
  return crypto.createHash('sha256')
    .update([getSecret(), taskId, a.audited_at, a.verdict].join('|'))
    .digest('hex').slice(0, 16);
}

// A valid audit: verdict "pass", signed, and matching the commit the evidence
// was recorded at (an audit of older code does not vouch for newer code).
function validAudit(task) {
  const a = task.audit_result;
  if (!a) return false;
  if (a.verdict !== 'pass' || !a.audited_at) return false;
  if (a.sig !== auditSig(task.id, a)) return false;
  const e = task.evidence || {};
  if (a.commit && e.commit && a.commit !== e.commit) return false;
  return true;
}

function allTasks(map) {
  return (map.phases || []).flatMap(p => (p.tasks || []));
}

// Cancelled (descoped) tasks are deliberate non-work — excluded from progress
// so a project can reach 100% after dropping scope, instead of being held
// below by tasks nobody will ever finish.
function activeTasks(phase) {
  return (phase.tasks || []).filter(t => t.status !== 'cancelled');
}

function phaseProgress(phase) {
  const ts = activeTasks(phase);
  if (!ts.length) return 0;
  return ts.filter(t => t.status === 'done').length / ts.length;
}

function overallProgress(map) {
  // Phases with no active (non-cancelled) tasks drop out of the weighting entirely.
  const ph = (map.phases || []).filter(p => activeTasks(p).length);
  const totalW = ph.reduce((s, p) => s + (p.weight || 1), 0);
  if (!totalW) return 0;
  return Math.round(100 * ph.reduce((s, p) => s + (p.weight || 1) * phaseProgress(p), 0) / totalW);
}

function bar(frac, width = 10) {
  const filled = Math.max(0, Math.min(width, Math.round(frac * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function settings(map) {
  return Object.assign(
    { ops_warn: 40, files_warn: 10, minutes_warn: 45, stale_days: 5 },
    (map && map.settings) || {}
  );
}

function daysSince(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

function loadState(cwd) {
  return Object.assign(
    { ops: 0, files: [], warned: 0, stale_warned: false, compaction_pending: false,
      session_start: null, last_checkpoint_at: null },
    loadJson(statePath(cwd)) || {}
  );
}
function saveState(cwd, st) { saveJson(statePath(cwd), st); }

function pushSessionLog(map, entry, cap = 10) {
  map.session_log = (map.session_log || []).concat(entry).slice(-cap);
}

function statusCounts(phase) {
  const c = { done: 0, awaiting_audit: 0, in_progress: 0, blocked: 0, todo: 0, cancelled: 0 };
  for (const t of (phase.tasks || [])) c[t.status] = (c[t.status] || 0) + 1;
  return c;
}

// Human-facing trust tier for a single task. Reflects HOW completion was
// established — never the model's say-so.
function trustTier(task) {
  if (task.status === 'done') {
    if ((task.verify || {}).method === 'manual') return { key: 'manual', label: '⚠ manual waiver' };
    if (auditRequired(task) && validAudit(task)) return { key: 'audited', label: '✓✓ verified + audited' };
    return { key: 'verified', label: '✓ verified' };
  }
  if (task.status === 'cancelled') return { key: 'cancelled', label: '⊘ descoped' };
  if (task.status === 'awaiting_audit') return { key: 'awaiting', label: '⏳ awaiting audit' };
  if (task.status === 'blocked') return { key: 'blocked', label: '✋ blocked' };
  if (task.status === 'in_progress') return { key: 'in_progress', label: '▶ in progress' };
  return { key: 'todo', label: '· todo' };
}

module.exports = {
  readStdin, gtDir, mapPath, shadowPath, statePath, loadJson, saveJson,
  homeDir, registryPath, getSecret, evidenceSig, validEvidence, allTasks,
  auditRequired, auditSig, validAudit, trustTier, activeTasks,
  phaseProgress, overallProgress, bar, settings, daysSince,
  loadState, saveState, pushSessionLog, statusCounts,
};
