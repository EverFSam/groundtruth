#!/usr/bin/env node
'use strict';
// groundtruth CLI — the only legitimate path to "done".
// Commands:
//   init --name <project>                create a skeleton map in the current repo
//   status                               verified progress report (reads map only)
//   verify <taskId...> | --all           run verify commands; pass => signed evidence + done
//                                        (audit-required tasks become awaiting_audit instead)
//   audit <taskId>                       print audit packet (changed files + smell scan)
//   audit <taskId> --verdict pass|refuted --reasons "<cited findings>"
//                                        record the independent reviewer's verdict (signed)
//   waive <taskId> --note "<reason>"     complete a method:"manual" task (flagged unverified)
//   checkpoint --summary "<text>" [--log "<in-flight note>"]
//   portfolio                            all registered projects at a glance
const fs = require('fs');
const path = require('path');
const { spawnSync, execSync } = require('child_process');
const L = require(path.join(__dirname, '..', 'hooks', 'lib.js'));

const cwd = process.cwd();
const [, , cmd, ...args] = process.argv;

function opt(name) {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
}
function flag(name) { return args.includes('--' + name); }
function ids() { return args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))); }
function die(msg) { console.error('[groundtruth] ERROR: ' + msg); process.exit(1); }
function now() { return new Date().toISOString(); }

function loadMap() {
  const m = L.loadJson(L.mapPath(cwd));
  if (!m) die('no .groundtruth/map.json in ' + cwd + ' — run /groundtruth:init first.');
  return m;
}
// All gt.js writes are trusted: shadow is updated in lockstep so the validator
// hook recognizes them as legitimate.
function saveMap(map) {
  map.updated = now();
  L.saveJson(L.mapPath(cwd), map);
  L.saveJson(L.shadowPath(cwd), map);
}
function gitShort() {
  try { return execSync('git rev-parse --short HEAD', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
}
function findTask(map, id) {
  for (const p of (map.phases || [])) {
    for (const t of (p.tasks || [])) if (t.id === id) return { phase: p, task: t };
  }
  return null;
}
function updateRegistry(map) {
  const reg = L.loadJson(L.registryPath()) || { projects: [] };
  const cps = map.checkpoints || [];
  const entry = {
    name: map.project,
    path: cwd,
    progress: L.overallProgress(map),
    last_checkpoint: cps.length ? cps[cps.length - 1].date : null,
    blockers: (map.blockers || []).length,
  };
  const i = reg.projects.findIndex(p => p.path === cwd);
  if (i >= 0) reg.projects[i] = entry; else reg.projects.push(entry);
  L.saveJson(L.registryPath(), reg);
}

function tryGit(cmdline) {
  try {
    return execSync(cmdline, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim().split(/\r?\n/).filter(Boolean);
  } catch { return null; }
}

// Files plausibly touched by recent work: diff since the last checkpoint's
// commit, falling back to recent history, plus anything currently uncommitted.
function changedFiles(map) {
  const cps = map.checkpoints || [];
  const since = cps.length ? cps[cps.length - 1].commit : null;
  let files = since ? tryGit(`git diff --name-only ${since}..HEAD`) : null;
  if (!files || !files.length) files = tryGit('git diff --name-only HEAD~5..HEAD') || [];
  const dirty = tryGit('git status --porcelain -uall') || [];
  files.push(...dirty.map(l => l.slice(3).trim().replace(/^"|"$/g, '')).filter(Boolean));
  return [...new Set(files)].filter(f => !f.startsWith('.groundtruth')).slice(0, 50);
}

const SMELLS = [
  { re: /\b(TODO|FIXME|HACK|XXX)\b/, label: 'todo/fixme marker' },
  { re: /not.?implemented|placeholder|\bstub(bed)?\b/i, label: 'stub marker' },
  { re: /return\s+(['"`])[^'"`]{0,80}\1\s*;?\s*$/, label: 'hardcoded string return' },
  { re: /\b(mock|fake|dummy)[A-Z_]?\w*\s*[=(:]/, label: 'mock/fake/dummy value' },
];

function smellScan(files) {
  const findings = [];
  for (const f of files) {
    const p = path.join(cwd, f);
    let text;
    try {
      if (!fs.statSync(p).isFile() || fs.statSync(p).size > 200 * 1024) continue;
      text = fs.readFileSync(p, 'utf8');
      if (text.includes('\u0000')) continue; // binary
    } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && findings.length < 40; i++) {
      for (const s of SMELLS) {
        if (s.re.test(lines[i])) {
          findings.push({ file: f, line: i + 1, label: s.label, text: lines[i].trim().slice(0, 100) });
          break;
        }
      }
    }
    if (findings.length >= 40) break;
  }
  return findings;
}

function renderStatus(map) {
  const lines = [];
  const cps = map.checkpoints || [];
  const last = cps[cps.length - 1];
  const lastStr = last ? `${last.date.slice(0, 10)} @ ${last.commit || 'no commit'}` : 'never';
  lines.push(`${map.project} — ${L.overallProgress(map)}% overall — last checkpoint: ${lastStr}`);
  lines.push('');
  const manual = [];
  const audited = [];
  const awaiting = [];
  for (const p of (map.phases || [])) {
    const c = L.statusCounts(p);
    const frac = L.phaseProgress(p);
    lines.push(`  ${p.name.padEnd(24)} (w${p.weight || 1})  ${L.bar(frac)}  ${String(Math.round(frac * 100)).padStart(3)}%   ${c.done}✓  ${c.awaiting_audit}⏳  ${c.in_progress}▶  ${c.blocked}✋  ${c.todo}·`);
    for (const t of (p.tasks || [])) {
      if (t.status === 'done' && (t.verify || {}).method === 'manual') manual.push(t.id);
      if (t.status === 'done' && L.auditRequired(t) && L.validAudit(t)) audited.push(t.id);
      if (t.status === 'awaiting_audit') awaiting.push(t.id);
    }
  }
  lines.push('');
  lines.push('  Legend: ✓ done (verified)  ⏳ verified, awaiting independent audit  ▶ in progress  ✋ blocked  · todo');
  lines.push('  Trust tiers: ✓✓ verified + independently audited · ✓ verified (command passed) · ⚠ manual waiver, taken on trust');
  if (audited.length) lines.push(`  ✓✓ verified + audited: ${audited.join(', ')}`);
  if (awaiting.length) lines.push(`  ⏳ awaiting audit (NOT yet done): ${awaiting.join(', ')} — run gt.js audit <id>`);
  if (manual.length) lines.push(`  ⚠ unverified (manual waiver, taken on trust): ${manual.join(', ')}`);
  const blockers = map.blockers || [];
  if (blockers.length) {
    lines.push(`  Blockers (${blockers.length}):`);
    for (const b of blockers) lines.push(`    - ${b}`);
  }
  const st = L.loadState(cwd);
  const staleDays = L.daysSince(map.updated);
  lines.push(`  Health: ${st.ops} ops since last checkpoint · map updated ${staleDays === 0 ? 'today' : staleDays + 'd ago'}`);
  const reverify = L.allTasks(map).filter(t =>
    t.status === 'done' && t.evidence && t.evidence.verified_at && (L.daysSince(t.evidence.verified_at) || 0) > 7);
  if (reverify.length) lines.push(`  Re-verify candidates (evidence >7d old): ${reverify.map(t => t.id).join(', ')} — run /groundtruth:sync`);
  return lines.join('\n');
}

function runVerify(map, id, { demoteOnFail = false } = {}) {
  const found = findTask(map, id);
  if (!found) return { id, result: 'not_found' };
  const t = found.task;
  const v = t.verify || {};
  if (v.method === 'manual') return { id, result: 'manual', note: 'manual task — use: gt.js waive ' + id + ' --note "<who confirmed and how>"' };
  if (!v.run) return { id, result: 'no_command' };
  const r = spawnSync(v.run, { shell: true, cwd, encoding: 'utf8', timeout: 180000 });
  const exit = r.status === null ? -1 : r.status;
  const out = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  if (exit === 0) {
    const lines = out.split(/\r?\n/).filter(s => s.trim());
    const evidence = {
      verified_at: now(),
      commit: gitShort(),
      exit_code: 0,
      output_digest: (lines[lines.length - 1] || 'ok').slice(0, 120),
    };
    evidence.sig = L.evidenceSig(t.id, evidence);
    t.evidence = evidence;
    if (L.auditRequired(t)) {
      // An audit recorded at a different commit no longer vouches for this code.
      if (t.audit_result && t.audit_result.commit && evidence.commit && t.audit_result.commit !== evidence.commit) {
        delete t.audit_result;
      }
      t.status = L.validAudit(t) ? 'done' : 'awaiting_audit';
      return { id, result: 'pass', digest: evidence.output_digest, awaiting_audit: t.status === 'awaiting_audit' };
    }
    t.status = 'done';
    return { id, result: 'pass', digest: evidence.output_digest };
  }
  if (demoteOnFail && t.status === 'done') {
    t.status = 'in_progress';
    delete t.evidence;
    L.pushSessionLog(map, `${now()}: REGRESSION — "${id}" failed re-verification (exit ${exit}), demoted to in_progress`);
  }
  return { id, result: 'fail', exit, output: out.split(/\r?\n/).slice(-20).join('\n') };
}

switch (cmd) {
  case 'init': {
    const name = opt('name') || path.basename(cwd);
    if (fs.existsSync(L.mapPath(cwd))) die('map already exists at ' + L.mapPath(cwd));
    const map = {
      schema: 1, project: name, created: now(), updated: now(),
      settings: {}, phases: [], decisions: [], blockers: [], checkpoints: [], session_log: [],
    };
    L.saveJson(L.mapPath(cwd), map);
    L.saveJson(L.shadowPath(cwd), map);
    updateRegistry(map);
    console.log('[groundtruth] Initialized ' + L.mapPath(cwd) + '\nAdd phases/tasks (every task needs a verify spec), then commit .groundtruth/map.json.\nNote: .groundtruth/.shadow.json and .session-state.json should be gitignored.');
    break;
  }
  case 'status': {
    console.log(renderStatus(loadMap()));
    break;
  }
  case 'verify': {
    const map = loadMap();
    const all = flag('all');
    const targets = all
      ? L.allTasks(map).filter(t => t.status === 'done' && (t.verify || {}).method !== 'manual').map(t => t.id)
      : ids();
    if (!targets.length) die(all ? 'no verified-done tasks to re-check.' : 'usage: gt.js verify <taskId...> | --all');
    let failed = 0;
    for (const id of targets) {
      const res = runVerify(map, id, { demoteOnFail: all });
      if (res.result === 'pass' && res.awaiting_audit) console.log(`  PASS  ${id}  (${res.digest}) — AWAITING INDEPENDENT AUDIT before it can be done: gt.js audit ${id}`);
      else if (res.result === 'pass') console.log(`  PASS  ${id}  (${res.digest})`);
      else if (res.result === 'fail') { failed++; console.log(`  FAIL  ${id}  (exit ${res.exit})${all ? ' — DEMOTED to in_progress' : ''}\n${res.output.replace(/^/gm, '        ')}`); }
      else { failed++; console.log(`  SKIP  ${id}  (${res.result}${res.note ? ': ' + res.note : ''})`); }
    }
    saveMap(map);
    updateRegistry(map);
    console.log(failed ? `\n[groundtruth] ${failed} task(s) NOT verified — statuses unchanged or demoted. Report failures to the user verbatim.` : '\n[groundtruth] all verifications passed; evidence recorded.');
    process.exit(failed ? 1 : 0);
    break;
  }
  case 'audit': {
    const map = loadMap();
    const id = ids()[0];
    if (!id) die('usage: gt.js audit <taskId> [--verdict pass|refuted --reasons "<cited findings>"]');
    const found = findTask(map, id);
    if (!found) die('task not found: ' + id);
    const t = found.task;
    const verdict = opt('verdict');

    if (!verdict) {
      // Packet mode: deterministic groundwork for the independent reviewer.
      if (!L.validEvidence(t)) die(`task "${id}" has no valid verification evidence yet — run gt.js verify ${id} first. Audit comes AFTER verification.`);
      const files = changedFiles(map);
      const smells = smellScan(files);
      const out = [];
      out.push(`[groundtruth] AUDIT PACKET — task "${id}": ${t.desc}`);
      out.push(`  Verified: ${t.evidence.verified_at} @ ${t.evidence.commit || 'no commit'}  (verify: ${(t.verify || {}).run || 'n/a'})`);
      out.push(`  Files changed since last checkpoint (${files.length}):`);
      for (const f of files.slice(0, 20)) out.push(`    ${f}`);
      if (files.length > 20) out.push(`    ... and ${files.length - 20} more`);
      out.push(`  Deterministic smell scan: ${smells.length} finding(s)${smells.length ? '' : ' — none detected'}`);
      for (const s of smells) out.push(`    ${s.file}:${s.line}  [${s.label}]  ${s.text}`);
      out.push('');
      out.push('  -- Reviewer instructions --');
      out.push('  Spawn an INDEPENDENT reviewer agent (fresh context, no memory of writing this code).');
      out.push('  Give it: this packet, the task description, and the repo path. Its job is to REFUTE');
      out.push('  completion: read the implementation and hunt for hardcoded return values, stubs,');
      out.push('  unused parameters, test-only code paths, silently swallowed errors, and logic that');
      out.push('  cannot satisfy the task description in the general case. Every claim must cite file:line.');
      out.push('  Then record its verdict (the AUTHOR of the code must never grade its own work):');
      out.push(`    gt.js audit ${id} --verdict pass|refuted --reasons "<auditor's cited findings>"`);
      console.log(out.join('\n'));
      break;
    }

    if (!['pass', 'refuted'].includes(verdict)) die('--verdict must be "pass" or "refuted"');
    const reasons = opt('reasons');
    if (!reasons) die('--reasons "<auditor findings with file:line citations>" is required');
    if (!L.validEvidence(t)) die(`cannot record an audit for "${id}" before valid verification evidence exists — run gt.js verify ${id} first.`);
    const a = { verdict, reasons, audited_at: now(), commit: t.evidence.commit || gitShort() };
    a.sig = L.auditSig(t.id, a);
    t.audit_result = a;
    if (verdict === 'pass') {
      if (t.status === 'awaiting_audit') t.status = 'done';
      console.log(`[groundtruth] ${id} audit PASS recorded — status: ${t.status} (✓✓ verified + independently audited at ${a.commit || 'no commit'}).`);
    } else {
      t.status = 'in_progress';
      delete t.evidence; // a hollow implementation must re-earn both verification and audit
      L.pushSessionLog(map, `${now()}: AUDIT REFUTED — "${id}" demoted to in_progress: ${reasons.slice(0, 140)}`);
      console.log(`[groundtruth] ${id} audit REFUTED — demoted to in_progress, evidence cleared. Findings recorded:\n  ${reasons}\nReport these findings to the user verbatim.`);
    }
    saveMap(map);
    updateRegistry(map);
    break;
  }
  case 'waive': {
    const map = loadMap();
    const id = ids()[0];
    const note = opt('note');
    if (!id || !note) die('usage: gt.js waive <taskId> --note "<who confirmed completion and how>"');
    const found = findTask(map, id);
    if (!found) die('task not found: ' + id);
    if ((found.task.verify || {}).method !== 'manual') die(`task "${id}" has a machine verify spec — use gt.js verify ${id} instead. Waivers are only for method:"manual" tasks.`);
    found.task.evidence = { waiver: true, verified_at: now(), commit: gitShort(), note };
    found.task.status = 'done';
    saveMap(map);
    updateRegistry(map);
    console.log(`[groundtruth] ${id} waived as done (UNVERIFIED — will be permanently flagged ⚠ in reports). Note: ${note}`);
    break;
  }
  case 'checkpoint': {
    const map = loadMap();
    const summary = opt('summary');
    if (!summary) die('usage: gt.js checkpoint --summary "<2-3 factual lines>" [--log "<in-flight note>"]');
    const unverifiedDone = L.allTasks(map).filter(t => t.status === 'done' && !L.validEvidence(t));
    if (unverifiedDone.length) die('cannot checkpoint: task(s) ' + unverifiedDone.map(t => t.id).join(', ') + ' are done without evidence valid on THIS machine. If this map was cloned/pulled from another machine, that is expected — evidence is re-earned locally: run /groundtruth:sync (gt.js verify --all). Otherwise run gt.js verify for the listed tasks.');
    const unaudited = L.allTasks(map).filter(t => t.status === 'done' && L.auditRequired(t) && !L.validAudit(t));
    if (unaudited.length) die('cannot checkpoint: task(s) ' + unaudited.map(t => t.id).join(', ') + ' require an independent audit. Run gt.js audit <id> and record the reviewer verdict.');
    const cps = map.checkpoints || [];
    const prev = cps.length ? cps[cps.length - 1].progress : 0;
    const progress = L.overallProgress(map);
    const entry = { date: now(), progress, commit: gitShort(), summary };
    map.checkpoints = cps.concat(entry);
    const logNote = opt('log');
    if (logNote) L.pushSessionLog(map, `${now()}: ${logNote}`);
    saveMap(map);
    updateRegistry(map);
    const st = L.loadState(cwd);
    const opsRecorded = st.ops;
    st.ops = 0; st.files = []; st.warned = 0; st.stale_warned = false;
    st.last_checkpoint_at = now();
    L.saveState(cwd, st);
    console.log(renderStatus(map));
    console.log(`\n  Checkpoint recorded: ${prev}% -> ${progress}% (${progress - prev >= 0 ? '+' : ''}${progress - prev}) · ${opsRecorded} operations recorded · counters reset`);
    break;
  }
  case 'portfolio': {
    const reg = L.loadJson(L.registryPath());
    if (!reg || !reg.projects.length) { console.log('[groundtruth] no tracked projects yet — run /groundtruth:init inside a repo.'); break; }
    console.log('Tracked projects:');
    const sorted = [...reg.projects].sort((a, b) => (L.daysSince(b.last_checkpoint) || 999) - (L.daysSince(a.last_checkpoint) || 999));
    for (const p of sorted) {
      const d = p.last_checkpoint ? L.daysSince(p.last_checkpoint) : null;
      const staleFlag = d === null ? ' ⚠ never checkpointed' : d > 5 ? ` ⚠ stale (${d}d)` : '';
      console.log(`  ${p.name.padEnd(28)} ${L.bar(p.progress / 100)} ${String(p.progress).padStart(3)}%  blockers: ${p.blockers}  last checkpoint: ${p.last_checkpoint ? p.last_checkpoint.slice(0, 10) : 'never'}${staleFlag}\n    ${p.path}`);
    }
    break;
  }
  default:
    die('unknown command "' + (cmd || '') + '". Commands: init, status, verify, audit, waive, checkpoint, portfolio');
}
