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
//   report [--csv] [--out <path>]        HTML dashboard (+ optional CSV) of all projects
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

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Load every registered project's map. Returns {name, path, map, missing}.
function loadAllProjects() {
  const reg = L.loadJson(L.registryPath()) || { projects: [] };
  return reg.projects.map(p => {
    const m = L.loadJson(path.join(p.path, '.groundtruth', 'map.json'));
    return { name: p.name, path: p.path, map: m, missing: !m };
  });
}

function reportRows(projects) {
  const rows = [];
  for (const proj of projects) {
    if (proj.missing) continue;
    for (const ph of (proj.map.phases || [])) {
      for (const t of (ph.tasks || [])) {
        const tier = L.trustTier(t);
        rows.push({
          project: proj.name, phase: ph.name, id: t.id, desc: t.desc,
          owner: t.owner || '', status: t.status, tier: tier.label, tierKey: tier.key,
          cancel_reason: t.cancel_reason || '',
          verified_at: (t.evidence && t.evidence.verified_at) ? t.evidence.verified_at.slice(0, 10) : '',
        });
      }
    }
  }
  return rows;
}

function toCsv(rows) {
  const cols = ['project', 'phase', 'id', 'desc', 'owner', 'status', 'tier', 'cancel_reason', 'verified_at'];
  const cell = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\r\n') + '\r\n';
}

function buildHtml(projects, generatedAt) {
  const rows = reportRows(projects);
  const live = projects.filter(p => !p.missing);
  // Owner rollup — cancelled (descoped) tasks are not anyone's outstanding work.
  const byOwner = {};
  for (const r of rows) {
    if (r.status === 'cancelled') continue;
    const o = r.owner || '(unassigned)';
    byOwner[o] = byOwner[o] || { total: 0, done: 0 };
    byOwner[o].total++;
    if (r.status === 'done') byOwner[o].done++;
  }
  const tierColor = {
    audited: '#16a34a', verified: '#65a30d', manual: '#d97706', awaiting: '#0891b2',
    in_progress: '#2563eb', blocked: '#dc2626', todo: '#9ca3af', cancelled: '#94a3b8',
  };
  const projectCard = proj => {
    const m = proj.map;
    const phaseRows = (m.phases || []).map(ph => {
      const pct = Math.round(L.phaseProgress(ph) * 100);
      const owners = [...new Set((ph.tasks || []).map(t => t.owner).filter(Boolean))];
      return `<tr><td>${esc(ph.name)}</td><td class="num">w${ph.weight || 1}</td>
        <td class="barcell"><div class="bar"><div class="fill" style="width:${pct}%"></div></div><span class="pct">${pct}%</span></td>
        <td>${esc(owners.join(', ') || '—')}</td></tr>`;
    }).join('');
    const taskRows = L.allTasks(m).map(t => {
      const tier = L.trustTier(t);
      const cancelled = t.status === 'cancelled';
      const reason = cancelled && t.cancel_reason ? ` <span class="muted small">— ${esc(t.cancel_reason)}</span>` : '';
      return `<tr${cancelled ? ' class="struck"' : ''}><td class="mono">${esc(t.id)}</td><td>${esc(t.desc)}${reason}</td>
        <td>${esc(t.owner || '—')}</td>
        <td><span class="tier" style="background:${tierColor[tier.key] || '#9ca3af'}">${esc(tier.label)}</span></td>
        <td class="mono small">${esc(t.evidence && t.evidence.verified_at ? t.evidence.verified_at.slice(0, 10) : '')}</td></tr>`;
    }).join('');
    const cps = m.checkpoints || [];
    const last = cps.length ? cps[cps.length - 1] : null;
    const blockers = (m.blockers || []).map(b => `<li>${esc(b)}</li>`).join('') || '<li class="muted">none</li>';
    return `<section class="project">
      <h2>${esc(m.project)} <span class="big">${L.overallProgress(m)}%</span></h2>
      <p class="meta">${esc(proj.path)} · last checkpoint: ${last ? esc(last.date.slice(0, 10)) : 'never'}${last && last.commit ? ' @ ' + esc(last.commit) : ''}</p>
      <table class="phases"><thead><tr><th>Phase</th><th>Weight</th><th>Progress</th><th>Owners</th></tr></thead><tbody>${phaseRows || '<tr><td colspan=4 class="muted">no phases</td></tr>'}</tbody></table>
      <details><summary>Tasks (${L.allTasks(m).length})</summary>
        <table class="tasks"><thead><tr><th>ID</th><th>Task</th><th>Owner</th><th>Status / trust tier</th><th>Verified</th></tr></thead><tbody>${taskRows}</tbody></table>
      </details>
      <p class="blockers"><strong>Blockers:</strong></p><ul>${blockers}</ul>
    </section>`;
  };
  const portfolioRows = live.map(p => {
    const m = p.map;
    const cps = m.checkpoints || [];
    const last = cps.length ? cps[cps.length - 1].date : null;
    const d = last ? L.daysSince(last) : null;
    const stale = d === null ? '<span class="warn">never</span>' : d > 5 ? `<span class="warn">${d}d ago</span>` : `${d}d ago`;
    const pct = L.overallProgress(m);
    return `<tr><td>${esc(m.project)}</td>
      <td class="barcell"><div class="bar"><div class="fill" style="width:${pct}%"></div></div><span class="pct">${pct}%</span></td>
      <td class="num">${(m.blockers || []).length}</td><td>${stale}</td></tr>`;
  }).join('');
  const ownerRows = Object.entries(byOwner).sort((a, b) => b[1].total - a[1].total).map(([o, s]) =>
    `<tr><td>${esc(o)}</td><td class="num">${s.total}</td><td class="num">${s.done}</td><td class="num">${s.total - s.done}</td></tr>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>groundtruth — project report</title>
<style>
  :root{--fg:#1f2937;--muted:#6b7280;--line:#e5e7eb;--bg:#f9fafb;--card:#fff;}
  *{box-sizing:border-box}
  body{font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg);margin:0;padding:32px;max-width:1100px;margin:0 auto}
  h1{font-size:24px;margin:0 0 4px} h2{font-size:18px;margin:0 0 2px}
  .sub{color:var(--muted);margin:0 0 24px}
  .big{color:#2563eb;font-weight:700} .muted{color:var(--muted)} .warn{color:#dc2626;font-weight:600}
  table{border-collapse:collapse;width:100%;margin:8px 0 16px;background:var(--card)}
  th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  td.num{text-align:right;font-variant-numeric:tabular-nums} td.mono{font-family:ui-monospace,Consolas,monospace} td.small{font-size:12px;color:var(--muted)}
  .bar{display:inline-block;width:140px;height:10px;background:var(--line);border-radius:5px;overflow:hidden;vertical-align:middle}
  .fill{height:100%;background:linear-gradient(90deg,#3b82f6,#2563eb)}
  .barcell{white-space:nowrap} .pct{margin-left:8px;font-variant-numeric:tabular-nums;color:var(--muted)}
  .tier{display:inline-block;color:#fff;border-radius:4px;padding:2px 8px;font-size:12px;white-space:nowrap}
  tr.struck td:first-child,tr.struck td:nth-child(2){text-decoration:line-through;color:var(--muted)}
  section.project{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:18px 20px;margin:16px 0}
  section.project .meta{color:var(--muted);font-size:12px;margin:0 0 12px}
  details summary{cursor:pointer;color:#2563eb;margin:4px 0 8px} ul{margin:4px 0 0;padding-left:20px}
  .note{background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 14px;font-size:13px;color:#92400e;margin:8px 0 20px}
  footer{color:var(--muted);font-size:12px;margin-top:32px;border-top:1px solid var(--line);padding-top:12px}
</style></head><body>
<h1>groundtruth — project report</h1>
<p class="sub">Generated ${esc(generatedAt)} · ${live.length} project(s) tracked</p>
<div class="note"><strong>Progress &amp; trust tiers are evidence-based</strong> (a task is only "done" when its verification — and independent audit, where required — passed). <strong>Owners are assignments, not verified facts</strong> — they show who is responsible, not that work is done.</div>
<h2>Portfolio</h2>
<table><thead><tr><th>Project</th><th>Progress</th><th>Blockers</th><th>Last checkpoint</th></tr></thead><tbody>${portfolioRows || '<tr><td colspan=4 class="muted">no projects</td></tr>'}</tbody></table>
<h2>By owner</h2>
<table><thead><tr><th>Owner</th><th>Tasks</th><th>Done</th><th>Outstanding</th></tr></thead><tbody>${ownerRows || '<tr><td colspan=4 class="muted">no owners assigned</td></tr>'}</tbody></table>
<h2>Projects</h2>
${live.map(projectCard).join('') || '<p class="muted">No tracked projects. Run /groundtruth:init in a repo.</p>'}
<footer>groundtruth · trust tiers: ✓✓ verified + independently audited · ✓ verified (command passed) · ⏳ awaiting audit · ⚠ manual waiver (taken on trust) · ⊘ descoped (excluded from progress)</footer>
</body></html>`;
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
  const cancelled = [];
  for (const p of (map.phases || [])) {
    const c = L.statusCounts(p);
    const frac = L.phaseProgress(p);
    const canc = c.cancelled ? `  ${c.cancelled}⊘` : '';
    lines.push(`  ${p.name.padEnd(24)} (w${p.weight || 1})  ${L.bar(frac)}  ${String(Math.round(frac * 100)).padStart(3)}%   ${c.done}✓  ${c.awaiting_audit}⏳  ${c.in_progress}▶  ${c.blocked}✋  ${c.todo}·${canc}`);
    for (const t of (p.tasks || [])) {
      if (t.status === 'done' && (t.verify || {}).method === 'manual') manual.push(t.id);
      if (t.status === 'done' && L.auditRequired(t) && L.validAudit(t)) audited.push(t.id);
      if (t.status === 'awaiting_audit') awaiting.push(t.id);
      if (t.status === 'cancelled') cancelled.push({ id: t.id, reason: t.cancel_reason || 'no reason given' });
    }
  }
  lines.push('');
  lines.push('  Legend: ✓ done (verified)  ⏳ verified, awaiting independent audit  ▶ in progress  ✋ blocked  · todo  ⊘ descoped');
  lines.push('  Trust tiers: ✓✓ verified + independently audited · ✓ verified (command passed) · ⚠ manual waiver, taken on trust');
  if (audited.length) lines.push(`  ✓✓ verified + audited: ${audited.join(', ')}`);
  if (awaiting.length) lines.push(`  ⏳ awaiting audit (NOT yet done): ${awaiting.join(', ')} — run gt.js audit <id>`);
  if (manual.length) lines.push(`  ⚠ unverified (manual waiver, taken on trust): ${manual.join(', ')}`);
  if (cancelled.length) {
    lines.push(`  ⊘ descoped (excluded from progress):`);
    for (const c of cancelled) lines.push(`    - ${c.id}: ${c.reason}`);
  }
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
  case 'report': {
    const projects = loadAllProjects();
    const live = projects.filter(p => !p.missing);
    if (!live.length) die('no tracked projects with a readable map — run /groundtruth:init in a repo first.');
    const stamp = opt('now') || now(); // skills pass --now so the timestamp is real
    const outHtml = opt('out') || path.join(cwd, 'groundtruth-report.html');
    fs.writeFileSync(outHtml, buildHtml(projects, stamp));
    const written = [outHtml];
    if (flag('csv')) {
      const outCsv = outHtml.replace(/\.html?$/i, '') + '.csv';
      fs.writeFileSync(outCsv, toCsv(reportRows(projects)));
      written.push(outCsv);
    }
    const missing = projects.filter(p => p.missing).map(p => p.name);
    console.log(`[groundtruth] report written (${live.length} project(s)):`);
    for (const w of written) console.log(`  ${w}`);
    if (missing.length) console.log(`  note: ${missing.length} registered project(s) had no readable map and were skipped: ${missing.join(', ')}`);
    break;
  }
  default:
    die('unknown command "' + (cmd || '') + '". Commands: init, status, verify, audit, waive, checkpoint, sync, report, portfolio');
}
