import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { FEATURE_PHASES, BUG_PHASES, FEATURE_PHASES_V2, BUG_PHASES_V2, checklistAdf } from '../triggers/provision';

// Phase labels are disjoint between the legacy (16/7-phase) and current (4-phase) models,
// so a MERGED label->name map / order list resolves BOTH an old epic and a new epic without
// needing to know which model a given epic was provisioned under.
const ALL_FEATURE_PHASES = [...FEATURE_PHASES, ...FEATURE_PHASES_V2];
const ALL_BUG_PHASES = [...BUG_PHASES, ...BUG_PHASES_V2];
import daily from '../report/daily-format.js';   // { capText, buildDraftPrompt, buildReportMarkdown, MAX }
import { kvs } from '@forge/kvs';
import { draftUpdate } from '../report/llm.js';
import { parseChecklist, toLines } from './checklist-parse.mjs';

// ---------------------------------------------------------------------------
// QC Compliance Tracker resolver.
// Per-item compliance metadata (task mapping + note) is stored as a SINGLE JSON
// issue property `qc-compliance` on each EPIC — keyed "<storyKey>:<itemIndex>".
// This lives in Jira (portable, no app-storage quota) and is read one-per-epic
// (scales with epics on screen, not total tasks). Notes are also mirrored as a
// comment on the epic for visibility.
// ---------------------------------------------------------------------------

const PROP = 'qc-compliance';
const FEATURE_JQL = 'issuetype = Epic AND labels = feature ORDER BY key ASC';
const BUG_JQL = 'issuetype = Epic AND labels = bug ORDER BY key ASC';
const DAILY_PROP = 'daily-update';
// Default report set = active FEATURE epics only. Bug epics are opt-in via a standing include-list
// (Forge KVS) — the user adds a bug epic by key in the modal and it joins the Bug fixes section.
const ACTIVE_EPIC_JQL = 'issuetype = Epic AND labels = feature AND statusCategory = "In Progress" ORDER BY key ASC';
const isBlockedLabel = (l) => l === 'blocked-external' || l === 'blocked-internal';
const REPORT_BUGS_KEY = 'daily-report-bugs';
async function getReportBugKeys() { try { return (await kvs.get(REPORT_BUGS_KEY)) || []; } catch (e) { console.error('getReportBugKeys', e && e.message); return []; } }
async function setReportBugKeys(list) { try { await kvs.set(REPORT_BUGS_KEY, list); return true; } catch (e) { console.error('setReportBugKeys', e && e.message); return false; } }

// Epics the PM has "backlogged" — a dashboard display flag only (parks an epic so it doesn't clutter the
// tracker). Stored in app storage; the epic is never touched in Jira. Hidden unless "Show backlogged" is on.
const BACKLOG_EPICS_KEY = 'backlog-epics';
async function getBacklogEpicKeys() { try { return (await kvs.get(BACKLOG_EPICS_KEY)) || []; } catch (e) { console.error('getBacklogEpicKeys', e && e.message); return []; } }
async function setBacklogEpicKeys(list) { try { await kvs.set(BACKLOG_EPICS_KEY, list); return true; } catch (e) { console.error('setBacklogEpicKeys', e && e.message); return false; } }
const today = () => new Date().toISOString().slice(0, 10);

const CF = {
  progress: 'customfield_10094', pct: 'customfield_10095', text: 'customfield_10051',
  tested: 'customfield_10052', deployPerson: 'customfield_10598', deployDate: 'customfield_10065',
  mgmt: 'customfield_10602', severity: 'customfield_10091', approvers: 'customfield_10003',
};
const CHILD_FIELDS = ['summary', 'status', 'labels', 'assignee', 'parent', 'duedate',
  CF.progress, CF.pct, CF.text, CF.tested, CF.deployPerson, CF.deployDate, CF.mgmt].join(',');

const SEV = { Critical: 'crit', High: 'high', Medium: 'med', Low: 'low', Lowest: 'low', Highest: 'crit' };
const userName = (u) => (u && (u.displayName || u.name)) || null;
const parseProgress = (s) => { const m = (s || '').match(/(\d+)\s*\/\s*(\d+)/); return m ? { done: +m[1], total: +m[2] } : null; };
const jira = (url, init) => api.asApp().requestJira(url, init);

async function searchAll(jql, fields) {
  const out = [];
  let token;
  for (let p = 0; p < 40; p++) {
    const url = token
      ? route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100&nextPageToken=${token}`
      : route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100`;
    const res = await jira(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    (data.issues || []).forEach((i) => out.push(i));
    token = data.nextPageToken;
    if (!token) break;
  }
  return out;
}

// parseChecklist now lives in ./checklist-parse.mjs (pure + unit-tested) so it can read
// BOTH the flat-paragraph shape we write AND the Gebsun/Checklist-for-Jira-Pro normalised
// list shape. It is imported at the top of this file.

// Extract the QA-rework loop rounds from a phase-story's checklist field. The QA-rework automation
// appends "# QA Rework N" blocks (with the round's defect items) to the DEVELOPMENT phase-story.
// parseChecklist deliberately skips these; here we capture them so the dashboard can show the loop.
// Returns [{ n, items:[{text,done}], complete }] sorted by round number.
function parseReworkRounds(adf) {
  if (!adf || !adf.content) return [];
  const rounds = [];
  let cur = null;
  for (let { text, header } of toLines(adf)) {   // toLines reads flat + normalised (list) ADF
    text = text.replace(/​/g, '').trim();
    if (!text) continue;
    if (header || text.startsWith('#')) {
      const h = text.replace(/^#\s*/, '').trim();
      const m = h.match(/^QA Rework\s+(\d+)$/i);
      if (m) { cur = { n: +m[1], items: [] }; rounds.push(cur); } else cur = null;
      continue;
    }
    if (!cur) continue;
    const im = text.match(/^[*+-]?\s*\[([^\]]*)\]\s*(.*)$/);   // bullet optional (list items carry none)
    if (im) { const st = im[1].trim().toLowerCase(); cur.items.push({ text: im[2].split(' · 📝 ')[0].trim(), done: st === 'complete' || st === 'done' || st === 'x' }); }
    else cur.items.push({ text: text.replace(/^[*+-]\s*/, '').trim(), done: false });
  }
  rounds.forEach((r) => { r.complete = r.items.length > 0 && r.items.every((i) => i.done); });
  return rounds.sort((a, b) => a.n - b.n);
}

// For the tree view: pull a ticket's OPEN (unresolved / failed) checklist items and any Loom link.
// Captures every open item (including QA-Failed / QA-Rework blocks — we do NOT skip them here), and
// the first loom.com URL found anywhere in the checklist (teams paste one per checklist, optionally).
// Loom links are pasted bare (loom.com/share/…) or with a protocol — match both.
const LOOM_RE = /(?:https?:\/\/)?(?:www\.)?loom\.com\/[^\s)"'<>]+/i;
const withProto = (u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u);
const cleanItemText = (s) => s.replace(LOOM_RE, '').replace(/·\s*📝.*/, '').replace(/[\s·:–—-]+$/, '').trim();

// Parse a ticket's checklist field into BLOCKS (one per checklist). Each block has a name; each ITEM
// carries its OWN Loom link (teams paste one per item). A block header is a "# ..." line.
function parseChecklistBlocks(adf) {
  if (!adf || !adf.content) return { blocks: [], openCount: 0, round: 1 };
  const blocks = []; let curB = null; let round = 0;
  const ensure = () => { if (!curB) { curB = { name: 'Checklist', loom: null, items: [], openCount: 0, doneCount: 0 }; blocks.push(curB); } };
  for (let { text: ln, header } of toLines(adf)) {   // toLines reads flat + normalised (list) ADF
    ln = ln.replace(/​/g, '').trim();
    if (!ln) continue;
    if (header || ln.startsWith('#')) {
      const name = ln.replace(/^#\s*/, '').trim();
      curB = { name, loom: null, items: [], openCount: 0, doneCount: 0 }; blocks.push(curB);
      const rm = name.match(/(?:Defects?|QA\s+(?:Failed|Rework))\s+(\d+)/i); if (rm) round = Math.max(round, +rm[1]);
      continue;
    }
    const m = ln.match(/^[*+-]?\s*\[([^\]]*)\]\s*(.*)$/);   // bullet optional (list items carry none)
    if (!m) { // a non-item line carrying a loom → block-level fallback
      const bl = ln.match(LOOM_RE); if (bl) { ensure(); if (!curB.loom) curB.loom = withProto(bl[0]); }
      continue;
    }
    ensure();
    const st = m[1].trim().toLowerCase();
    const state = (st === 'complete' || st === 'done' || st === 'x') ? 'done'
      : (st === 'skipped' || st === 'skip' || st === 'na' || st === 'n/a' || st === '-' || st === '~') ? 'skipped' : 'open';
    const lm = m[2].match(LOOM_RE);
    const loom = lm ? withProto(lm[0]) : null;
    const text = cleanItemText(m[2]);
    if (curB.items.length < 40) curB.items.push({ text, loom, state });
    if (state === 'open') curB.openCount += 1; else curB.doneCount += 1;
  }
  let openCount = 0, defectCount = 0;
  // A pushable "defect" block is the tester's "Defect N" OR its post-QA-Failed rename "QA Failed N".
  for (const b of blocks) { b.isDefect = /defect|qa\s*failed/i.test(b.name); openCount += b.openCount; if (b.isDefect) defectCount += b.openCount; }
  const nonEmpty = blocks.filter((b) => b.items.length > 0);
  return { blocks: nonEmpty, openCount, defectCount, round: round || 1 };
}

// Build a Gebsun-style checklist block (paragraph form): "# Header" then "[open] item" per line.
function checklistBlockParas(header, items) {
  return [{ type: 'paragraph', content: [{ type: 'text', text: `# ${header}` }] },
    ...items.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: `[open] ${String(t).replace(/\s+/g, ' ').trim()}` }] }))];
}

// concatenated text of one ADF top-level node
function adfNodeText(node) {
  const parts = []; const walk = (n) => { if (!n) return; if (Array.isArray(n)) return n.forEach(walk); if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text); if (n.content) walk(n.content); };
  walk(node && node.content); return parts.join('').replace(/​/g, '').trim();
}
// Remove a whole named block ("QA Rework N") + its items from a checklist ADF. Handles the paragraph
// form ("# Header" + "[open] item" paragraphs) and the Gebsun orderedList(header)+bulletList(items) form.
function removeNamedBlock(adf, name) {
  if (!adf || !Array.isArray(adf.content)) return { adf, changed: false };
  const clone = JSON.parse(JSON.stringify(adf));
  const re = new RegExp('^#?\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i');
  const out = []; let skipping = false; let changed = false;
  for (const node of clone.content) {
    const txt = adfNodeText(node);
    if (node && node.type === 'orderedList') { if (re.test(txt)) { skipping = true; changed = true; continue; } skipping = false; out.push(node); continue; }
    if (node && node.type === 'bulletList') { if (skipping) { changed = true; continue; } out.push(node); continue; }
    const isHeader = /^#\s+/.test(txt);
    if (isHeader) { if (re.test(txt)) { skipping = true; changed = true; continue; } skipping = false; out.push(node); continue; }
    if (skipping) { if (/^\[|^\s*[*+-]\s*\[/.test(txt)) { changed = true; continue; } skipping = false; out.push(node); continue; }
    out.push(node);
  }
  clone.content = out; return { adf: clone, changed };
}

// per-epic compliance metadata (issue property) — never throws
async function getEpicMeta(epicKey) {
  try {
    const r = await jira(route`/rest/api/3/issue/${epicKey}/properties/${PROP}`, { headers: { Accept: 'application/json' } });
    if (r.status !== 200) return {};
    const d = await r.json();
    return d.value || {};
  } catch (e) { console.error('getEpicMeta failed', epicKey, e && e.message); return {}; }
}
async function setEpicMeta(epicKey, meta) {
  const r = await jira(route`/rest/api/3/issue/${epicKey}/properties/${PROP}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(meta),
  });
  return r.ok;
}

async function getProp(issueKey, prop) {
  try {
    const r = await jira(route`/rest/api/3/issue/${issueKey}/properties/${prop}`, { headers: { Accept: 'application/json' } });
    if (r.status !== 200) return {};
    return (await r.json()).value || {};
  } catch (e) { console.error('getProp failed', issueKey, prop, e && e.message); return {}; }
}
async function setProp(issueKey, prop, val) {
  const r = await jira(route`/rest/api/3/issue/${issueKey}/properties/${prop}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(val) });
  return r.ok;
}
// keep only the most recent N date-keyed entries (ISO date keys sort chronologically)
const DAILY_KEEP = 60;
const pruneDays = (obj, keep = DAILY_KEEP) => {
  const days = Object.keys(obj || {}).sort();
  if (days.length <= keep) return obj;
  const out = {};
  days.slice(-keep).forEach((k) => { out[k] = obj[k]; });
  return out;
};

// set/clear the blocked-external|internal label on an issue (story or epic) — read-modify-write
async function setBlockedLabel(issueKey, kind) {
  try {
    const r = await jira(route`/rest/api/3/issue/${issueKey}?fields=labels`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return;
    let labels = ((await r.json()).fields?.labels || []).filter((l) => l !== 'blocked-external' && l !== 'blocked-internal');
    if (kind === 'external') labels.push('blocked-external');
    else if (kind === 'internal') labels.push('blocked-internal');
    await jira(route`/rest/api/3/issue/${issueKey}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { labels } }) });
  } catch (e) { console.error('setBlockedLabel failed', issueKey, e && e.message); }
}

async function postEpicComment(epicKey, text) {
  const body = { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
  try { await jira(route`/rest/api/3/issue/${epicKey}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }); }
  catch (e) { console.error('blocked comment failed', e && e.message); }
}

// Best-effort transition an issue to a "done"-category status (used when a phase is skipped, so the
// Jira board matches the dashboard). Never throws; returns false if no done-transition is available
// from the issue's current workflow state.
async function transitionToDone(issueKey) {
  try {
    const r = await jira(route`/rest/api/3/issue/${issueKey}/transitions`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return false;
    const trs = (await r.json()).transitions || [];
    const t = trs.find((x) => x.to?.statusCategory?.key === 'done')
      || trs.find((x) => /^(done|complete|completed|closed|resolved)$/i.test(x.to?.name || ''))
      || trs.find((x) => /^(done|complete|completed|close|resolve)$/i.test(x.name || ''));
    if (!t) return false;
    const pr = await jira(route`/rest/api/3/issue/${issueKey}/transitions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition: { id: t.id } }) });
    return pr.ok;
  } catch (e) { console.error('transitionToDone failed', issueKey, e && e.message); return false; }
}

async function fetchApprovals(taskKeys) {
  const info = {};
  const keys = [...new Set(taskKeys)].filter(Boolean);
  if (!keys.length) return info;
  const issues = await searchAll(`key in (${keys.map((k) => `"${k}"`).join(',')})`, `status,assignee,summary,duedate,${CF.approvers}`);
  for (const it of issues) {
    const f = it.fields || {};
    const approvers = f[CF.approvers];
    const approver = (Array.isArray(approvers) && approvers.length ? userName(approvers[0]) : null) || userName(f.assignee);
    info[it.key] = { key: it.key, summary: f.summary || it.key, approved: f.status?.statusCategory?.key === 'done', status: f.status?.name || '', approver, due: f.duedate || null };
  }
  return info;
}

async function fetchEpics(jql, backlogSet = []) {
  // Epics in Jira "Backlog" status are flagged backlogged (below), NOT dropped — so they can be revealed
  // via the dashboard's "Show backlogged" toggle instead of vanishing entirely. Hidden by default.
  const epics = (await searchAll(jql, `summary,status,duedate,priority,assignee,${CF.severity}`))
    .slice(0, 60);
  if (!epics.length) return [];
  const keyList = epics.map((e) => `"${e.key}"`).join(',');
  const children = await searchAll(`parent in (${keyList}) AND labels = qc-phase`, CHILD_FIELDS);

  const byParent = {};
  for (const c of children) {
    const pk = c.fields?.parent?.key;
    if (!pk) continue;
    const label = (c.fields?.labels || []).find((l) => l.startsWith('phase-'));
    if (!label) continue;
    const f = c.fields || {};
    const prog = parseProgress(f[CF.progress]);
    (byParent[pk] = byParent[pk] || {})[label] = {
      key: c.key,
      due: f.duedate || null,
      done: f.status?.statusCategory?.key === 'done',
      cat: f.status?.statusCategory?.key || null,   // 'done' | 'indeterminate' (In Progress) | 'new' (To Do/Backlog)
      pct: f[CF.pct] || 0,
      total: prog ? prog.total : null,
      doneCount: prog ? prog.done : null,
      items: parseChecklist(f[CF.text]).map((it) => ({ ...it, mappedTask: null, note: null })),
      reworkRounds: parseReworkRounds(f[CF.text]),
      assignee: userName(f.assignee),
      tested: userName(f[CF.tested]),
      deployPerson: userName(f[CF.deployPerson]), deployDate: f[CF.deployDate] || null,
      mgmtApproval: f[CF.mgmt]?.value || null,
    };
  }

  return epics.map((e) => ({
    key: e.key,
    sum: e.fields?.summary || e.key,
    priority: e.fields?.priority?.name || null,
    assignee: userName(e.fields?.assignee) || null,
    sev: SEV[e.fields?.[CF.severity]?.value] || 'med',
    provisioned: !!byParent[e.key],
    due: e.fields?.duedate || null,
    phaseByLabel: byParent[e.key] || null,
    phaseIndex: e.fields?.status?.statusCategory?.key === 'done' ? 99 : 2,
    done: e.fields?.status?.statusCategory?.key === 'done',
    parked: backlogSet.includes(e.key),   // parked via the dashboard toggle (display-only)
    backlogged: backlogSet.includes(e.key) || e.fields?.status?.name === 'Backlog',   // hidden unless "Show backlogged"
    statusName: e.fields?.status?.name || null,
  }));
}

const collectTaskKeys = (epics) => epics.flatMap((ep) => ep.phaseByLabel ? Object.values(ep.phaseByLabel).flatMap((s) => s.items.map((i) => i.mappedTask?.key)) : []);

// Build the daily digest: active (In Progress) epics with their current phase, % and today's update text,
// plus a short list of epics completed in the last 7 days. Shared by the getDailyBoard resolver + web-trigger.
// prettify a leftover raw phase label (e.g. 'phase-approved' -> 'Approved') for CEO-facing display
const prettyStage = (n) => (n && n.startsWith('phase-')
  ? n.slice(6).replace(/(^|-)([a-z])/g, (_, sep, ch) => (sep ? ' ' : '') + ch.toUpperCase())
  : n);

// child phase-stories grouped by parent epic key, for a set of epic keys.
async function childrenByParent(epicKeys) {
  const byParent = {};
  if (!epicKeys.length) return byParent;
  const kids = await searchAll(`parent in (${epicKeys.map((k) => `"${k}"`).join(',')}) AND labels = qc-phase`,
    `summary,labels,status,parent,${CF.pct},${CF.progress}`);
  for (const c of kids) { const pk = c.fields?.parent?.key; if (pk) (byParent[pk] = byParent[pk] || []).push(c); }
  return byParent;
}

// Build one initiative row (feature or bug) from an epic issue + the phase-story children map.
async function buildEpicRow(e, byParent, day) {
  const isBug = (e.fields?.labels || []).includes('bug');
  const order = (isBug ? ALL_BUG_PHASES : ALL_FEATURE_PHASES).map((p) => p.label);
  const nameByLabel = Object.fromEntries((isBug ? ALL_BUG_PHASES : ALL_FEATURE_PHASES).map((p) => [p.label, p.name]));
  const rawKids = byParent[e.key] || [];
  // A phase counts as done if its Jira status is done-category OR its checklist is fully complete
  // (matches the dashboard rail — phases are often checklist-complete before the story status flips).
  const kidsE = rawKids.map((c) => {
    const f = c.fields || {};
    const prog = parseProgress(f[CF.progress]);
    const checklistComplete = !!(prog && prog.total > 0 && prog.done >= prog.total);
    return {
      label: (f.labels || []).find((l) => l.startsWith('phase-')),
      done: f.status?.statusCategory?.key === 'done' || checklistComplete,
      pct: f[CF.pct] || 0,
    };
  }).filter((x) => x.label);
  kidsE.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  const cur = kidsE.find((x) => !x.done) || kidsE[kidsE.length - 1] || null;
  const phasesTotal = kidsE.length;
  const phasesDone = kidsE.filter((x) => x.done).length;
  // full phase breakdown for the brief writer (so it sees Deployment done even when Compliance is open)
  const nm = (x) => prettyStage(nameByLabel[x.label] || x.label);
  const donePhases = kidsE.filter((x) => x.done).map(nm);
  const pendingPhases = kidsE.filter((x) => !x.done).map(nm);
  // deployed/live = the Deployment phase is done (shipped to prod) — the epic may still be open on a gate
  const deployed = kidsE.some((x) => x.label === 'phase-deployment' && x.done);
  // delayed = the dashboard's "Mark as Delayed": a blocked-* label OR a :blocked record (with a reason)
  // on the epic or any of its phase-stories (stored in the qc-compliance property by setBlocked).
  const meta = await getEpicMeta(e.key);
  const delayRec = meta['epic:blocked'] || rawKids.map((c) => meta[`${c.key}:blocked`]).find(Boolean) || null;
  const hasBlockedLabel = (e.fields?.labels || []).some(isBlockedLabel)
    || rawKids.some((c) => (c.fields?.labels || []).some(isBlockedLabel));
  const delayed = hasBlockedLabel || !!delayRec;
  const delayReason = (delayRec && delayRec.reason) || '';
  const delayKind = (delayRec && delayRec.kind) || '';
  const delayBlocker = (delayRec && delayRec.blocker) || '';
  const due = e.fields?.duedate || null;
  const prop = await getProp(e.key, DAILY_PROP);
  const rec = prop[day] || {};
  return {
    key: e.key, name: e.fields?.summary || e.key,
    kind: isBug ? 'bug' : 'feature',
    phaseName: cur ? prettyStage(nameByLabel[cur.label] || cur.label) : '—',
    pct: cur ? cur.pct : 0,
    phasesDone, phasesTotal, pctPhases: daily.phasePct(phasesDone, phasesTotal),
    donePhases, pendingPhases, deployed,
    delayed, delayReason, delayKind, delayBlocker,
    status: daily.statusOf({ delayed, deployed, due, phasesDone, phasesTotal, today: day }),
    due,
    text: rec.text || rec.draft || '',
  };
}

export async function computeDailyBoard(dateArg) {
  // dateArg (YYYY-MM-DD) lets the web-trigger re-render a past day's stored briefs; defaults to today.
  // Note: the initiative list + stages are always LIVE (current); only the per-epic update text is
  // historical. Default set = active FEATURE epics + the opt-in Bug include-list (KVS).
  const day = /^\d{4}-\d{2}-\d{2}$/.test(dateArg || '') ? dateArg : today();
  const featureEpics = await searchAll(ACTIVE_EPIC_JQL, 'summary,labels,duedate');
  const bugKeys = await getReportBugKeys();
  let bugEpics = [];
  if (bugKeys.length) {
    bugEpics = (await searchAll(`issuetype = Epic AND key in (${bugKeys.map((k) => `"${k}"`).join(',')})`, 'summary,labels,duedate'))
      .filter((e) => (e.fields?.labels || []).includes('bug'));
  }
  const epics = [...featureEpics, ...bugEpics];
  const byParent = await childrenByParent(epics.map((e) => e.key));
  const active = await Promise.all(epics.map((e) => buildEpicRow(e, byParent, day)));
  // completed in the last 7 days (feature or bug epics)
  const doneEpics = await searchAll(
    'issuetype = Epic AND (labels = feature OR labels = bug) AND status CHANGED TO Done AFTER -7d ORDER BY key ASC', 'summary');
  const doneTail = doneEpics.map((e) => ({ key: e.key, name: e.fields?.summary || e.key }));
  return { date: day, preparedBy: 'Nihad', generatedFor: 'Sabeer', active, doneTail };
}

const resolver = new Resolver();

resolver.define('getComplianceData', async () => {
  const backlog = await getBacklogEpicKeys();
  const [feature, bug] = await Promise.all([fetchEpics(FEATURE_JQL, backlog), fetchEpics(BUG_JQL, backlog)]);
  const all = [...feature, ...bug];
  // attach per-item task/note from each epic's qc-compliance property (one read per epic)
  await Promise.all(all.map(async (ep) => {
    const meta = await getEpicMeta(ep.key);
    ep.blocked = meta['epic:blocked'] || null;
    const rr = Array.isArray(meta.qarework) ? meta.qarework : [];
    if (rr.length) ep.rework = { count: rr.length, rounds: [...new Set(rr.map((r) => r.round || 1))].sort((a, b) => a - b) };
    if (!ep.phaseByLabel) return;
    for (const s of Object.values(ep.phaseByLabel)) {
      s.blocked = meta[`${s.key}:blocked`] || null;
      s.skipped = meta[`${s.key}:skipped`] || null;
      if (s.reworkRounds && s.reworkRounds.length) {
        for (const r of s.reworkRounds) {
          const rm = meta[`${s.key}:rework:${r.n}`];
          if (rm) { r.completedDate = rm.date || null; r.dateBy = rm.byName || null; r.dateAt = rm.at || null; }
        }
      }
      s.items.forEach((it, idx) => {
        const m = meta[`${s.key}:${idx}`];
        if (!m) return;
        if (m.task) it.mappedTask = { key: m.task };
        if (m.note) it.note = { text: m.note, by: m.noteByName || null, byAcct: m.noteBy || null, at: m.noteAt || null, completed: !!m.noteCompleted };
      });
    }
  }));
  // resolve note authors we only have an accountId for (older notes) -> display name
  const acctSet = new Set();
  for (const ep of all) if (ep.phaseByLabel) for (const s of Object.values(ep.phaseByLabel)) for (const it of s.items) if (it.note && !it.note.by && it.note.byAcct) acctSet.add(it.note.byAcct);
  if (acctSet.size) {
    const nameByAcct = {};
    await Promise.all([...acctSet].map(async (a) => { try { const r = await jira(route`/rest/api/3/user?accountId=${a}`, { headers: { Accept: 'application/json' } }); if (r.ok) nameByAcct[a] = (await r.json()).displayName; } catch (e) { /* ignore */ } }));
    for (const ep of all) if (ep.phaseByLabel) for (const s of Object.values(ep.phaseByLabel)) for (const it of s.items) if (it.note && !it.note.by && it.note.byAcct) it.note.by = nameByAcct[it.note.byAcct] || null;
  }

  const approvals = await fetchApprovals([...collectTaskKeys(feature), ...collectTaskKeys(bug)]);
  const enrich = (epics) => { for (const ep of epics) { if (!ep.phaseByLabel) continue; for (const s of Object.values(ep.phaseByLabel)) for (const it of s.items) if (it.mappedTask && approvals[it.mappedTask.key]) it.mappedTask = { ...it.mappedTask, ...approvals[it.mappedTask.key] }; } };
  enrich(feature); enrich(bug);
  return { feature, bug, backlog };
});

// Park/unpark an epic on the dashboard (display-only; never touches Jira). Backlogged epics are hidden
// from the tracker unless the "Show backlogged" toggle is on.
resolver.define('setEpicBacklog', async (req) => {
  const key = req.payload?.key;
  const backlogged = !!req.payload?.backlogged;
  if (!key) return { ok: false, error: 'missing key' };
  let list = await getBacklogEpicKeys();
  if (backlogged) { if (!list.includes(key)) list.push(key); }
  else { list = list.filter((k) => k !== key); }
  await setBacklogEpicKeys(list);
  return { ok: true, backlog: list };
});

// Search that reaches DESCENDANTS the dashboard doesn't load (discipline stories, their sub-tasks,
// and Relates-linked tasks). Given a query, find matching issues and walk UP to their epic via
// `parent` AND the hierarchy-ish links (Polaris work-item link / Relates) — because attachment is
// inconsistent across epics (some discipline stories are parented to the epic, others are only
// link-attached to the phase-story). Returns the epic keys (within the current tab) to surface.
resolver.define('findEpicsByDescendant', async (req) => {
  const { query, kind } = req.payload || {};
  const q = String(query || '').trim();
  if (q.length < 2) return { keys: [], matches: {} };
  const epicSet = new Set((await searchAll(kind === 'bug' ? BUG_JQL : FEATURE_JQL, 'summary')).map((e) => e.key));
  const page = async (jql, fields, max) => {
    const r = await jira(route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=${max}`, { headers: { Accept: 'application/json' } });
    return r.ok ? ((await r.json()).issues || []) : [];
  };
  const isKey = /^[A-Za-z]+-\d+$/.test(q);
  const esc = q.replace(/["\\]/g, '\\$&');
  let matchIssues = [];
  try {
    if (isKey) {
      matchIssues = await page(`key = "${q.toUpperCase()}"`, 'issuetype', 5);
    } else {
      matchIssues = await page(`(summary ~ "${esc}*" OR text ~ "${esc}")`, 'issuetype', 60);
      // member search: resolve the typed name -> users -> issues assigned to them
      try {
        const ur = await jira(route`/rest/api/3/user/search?query=${q}&maxResults=5`, { headers: { Accept: 'application/json' } });
        if (ur.ok) {
          const ids = (await ur.json()).map((u) => u.accountId).filter(Boolean);
          if (ids.length) matchIssues = matchIssues.concat(await page(`assignee in (${ids.map((i) => `"${i}"`).join(',')})`, 'issuetype', 80));
        }
      } catch (e) { /* ignore user-search failures */ }
    }
  } catch (e) { return { keys: [], matches: {} }; }

  // Walk UP from each match to its epic, tracking which original match(es) led to each node,
  // so we can show the exact descendant ticket that surfaced an epic.
  const found = new Set();            // epic keys
  const matches = {};                 // epicKey -> Set(matchKey)  (the descendant tickets)
  const origin = new Map();           // nodeKey -> Set(matchKey)
  const seen = new Set();
  let frontier = [];
  for (const m of [...new Set(matchIssues.map((i) => i.key))]) {
    origin.set(m, new Set([m]));
    if (epicSet.has(m)) { found.add(m); matches[m] = matches[m] || new Set(); } // epic matched directly → no descendant hint
    else if (!seen.has(m)) { seen.add(m); frontier.push(m); }
  }
  for (let hop = 0; hop < 4 && frontier.length; hop++) {
    const inList = frontier.slice(0, 100).map((k) => `"${k}"`).join(',');
    let nodes;
    try { nodes = await page(`key in (${inList})`, 'issuetype,parent,issuelinks', 100); } catch (e) { break; }
    const next = [];
    for (const n of nodes) {
      const f = n.fields || {};
      const ups = [];
      if (f.parent?.key) ups.push(f.parent.key);
      for (const l of (f.issuelinks || [])) {
        const t = (l.type?.name || '').toLowerCase();
        if (t.includes('polaris') || t.includes('relates')) { const o = l.outwardIssue || l.inwardIssue; if (o?.key) ups.push(o.key); }
      }
      const orig = origin.get(n.key) || new Set();
      for (const u of ups) {
        let s = origin.get(u); if (!s) { s = new Set(); origin.set(u, s); } for (const x of orig) s.add(x);
        if (epicSet.has(u)) { found.add(u); const ms = matches[u] = matches[u] || new Set(); for (const x of orig) ms.add(x); }
        else if (!seen.has(u)) { seen.add(u); next.push(u); }
      }
    }
    frontier = next;
  }
  const matchesOut = {};
  for (const k of Object.keys(matches)) matchesOut[k] = [...matches[k]].slice(0, 6);
  return { keys: [...found], matches: matchesOut };
});

// map (or clear) a task on a checklist item
resolver.define('mapTaskToItem', async (req) => {
  const { epicKey, storyKey, itemIndex, taskKey } = req.payload || {};
  if (!epicKey || !storyKey || itemIndex == null) return { ok: false, error: 'missing epicKey/storyKey/itemIndex' };
  const k = `${storyKey}:${itemIndex}`;
  const meta = await getEpicMeta(epicKey);
  const entry = meta[k] || {};
  if (!taskKey) { delete entry.task; }
  else {
    const r = await jira(route`/rest/api/3/issue/${taskKey}?fields=summary`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return { ok: false, error: `Task ${taskKey} not found` };
    entry.task = taskKey;
  }
  if (Object.keys(entry).length) meta[k] = entry; else delete meta[k];
  await setEpicMeta(epicKey, meta);
  return { ok: true, taskKey: taskKey || null };
});

// Reflect a *completion* (and its note) into the Gebsun checklist on the phase story's editable
// field (customfield_10051). Gebsun is a FLAT list with no per-item note field (a sub-line just
// becomes another checklist item), so the note rides inline on the item's own line after a
// " · 📝 " marker — this keeps the item count correct. Surgical: fetch the ADF, on ONLY the
// matching item set the marker to [done] and (re)write its inline note; every other item/line is
// preserved, and the item's own base text is kept, so no existing/human-entered data is removed.
// Idempotent: re-marking replaces its own " · 📝 …" segment instead of stacking. Match is by the
// item's base text (note stripped) — if a human renamed the item, it won't match and we skip.
// Gebsun recomputes its rendered field (10097) + count (10094) on its own (verified).
const NOTE_SEP = ' · 📝 ';
async function markChecklistItem(storyKey, itemText, note, byName) {
  const base = String(itemText || '').replace(/​/g, '').split(NOTE_SEP)[0].trim();
  if (!storyKey || !base) return false;
  const suffix = note ? `${NOTE_SEP}${String(note).replace(/\s+/g, ' ').trim()}${byName ? ` — ${byName}` : ''}` : '';
  try {
    const r = await jira(route`/rest/api/3/issue/${storyKey}?fields=customfield_10051`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return false;
    const adf = (await r.json()).fields?.customfield_10051;
    if (!adf || !adf.content) return false;
    let hit = false;
    const walk = (node) => {
      if (hit || !node) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type === 'text' && node.text) {
        const m = node.text.replace(/​/g, '').match(/^(\s*(?:[*+-]\s*)?)\[([^\]]*)\](\s*)(.*)$/);
        if (m && m[4].split(NOTE_SEP)[0].trim() === base) {
          node.text = `${m[1]}[done]${m[3]}${base}${suffix}`;   // done + single inline note; base text preserved, other items untouched
          hit = true; return;
        }
      }
      if (node.content) walk(node.content);
    };
    walk(adf.content);
    if (!hit) return false;
    const pr = await jira(route`/rest/api/3/issue/${storyKey}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { customfield_10051: adf } }) });
    return pr.ok;
  } catch (e) { console.error('markChecklistItem failed', storyKey, e && e.message); return false; }
}

// add (or clear) a note on a checklist item — stored in the property AND mirrored as an epic comment
resolver.define('setItemNote', async (req) => {
  const { epicKey, storyKey, itemIndex, note, completed, phaseName, itemText } = req.payload || {};
  if (!epicKey || !storyKey || itemIndex == null) return { ok: false, error: 'missing epicKey/storyKey/itemIndex' };
  const acct = req.context?.accountId;
  // prefer the name the frontend resolved from the user's own session; fall back to asUser /myself.
  let name = (req.payload && req.payload.byName) || null;
  if (!name && acct) { try { const ur = await api.asUser().requestJira(route`/rest/api/3/myself`, { headers: { Accept: 'application/json' } }); if (ur.ok) name = (await ur.json()).displayName; } catch (e) { /* ignore */ } }
  const at = new Date().toISOString();
  const k = `${storyKey}:${itemIndex}`;
  const meta = await getEpicMeta(epicKey);
  const entry = meta[k] || {};
  if (!note) { delete entry.note; delete entry.noteBy; delete entry.noteByName; delete entry.noteAt; delete entry.noteCompleted; }
  else { entry.note = note; entry.noteBy = acct || null; entry.noteByName = name; entry.noteAt = at; entry.noteCompleted = !!completed; }
  if (Object.keys(entry).length) meta[k] = entry; else delete meta[k];
  await setEpicMeta(epicKey, meta);

  // NEW: reflect a completion into the Gebsun checklist on the story itself (open -> done only;
  // never reverts, never rewrites other items). Only on a fresh mark-complete with item text.
  let gebsun = null;
  if (note && completed && itemText) gebsun = await markChecklistItem(storyKey, itemText, note, name);

  // mirror to an epic comment for visibility (only when adding a note)
  if (note) {
    const header = `QC note — ${phaseName || storyKey}${itemText ? ` · "${String(itemText).slice(0, 80)}"` : ''}`;
    const body = { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: header, marks: [{ type: 'strong' }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: note }] },
      { type: 'paragraph', content: [{ type: 'text', text: `— ${name || 'unknown'}`, marks: [{ type: 'em' }] }] },
    ] };
    try { await jira(route`/rest/api/3/issue/${epicKey}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }); } catch (e) { console.error('note comment failed', e && e.message); }
  }
  return { ok: true, by: name, at, completed: !!completed, gebsun };
});

// Flat list of the ATS "label-only" bugs (non-epic issues carrying the ats-bug-report
// label) with their LIVE Jira status — for the Bugs tab's "Label-only" toggle. These
// aren't phase-tracked (only epics are), so they don't appear in the main tracker.
const simpleList = async (jql) => {
  const issues = await searchAll(jql, 'summary,status,priority,assignee,issuetype,duedate');
  return issues.slice(0, 400).map((i) => {
    const f = i.fields || {};
    return {
      key: i.key, sum: f.summary || i.key,
      status: f.status?.name || '—', cat: f.status?.statusCategory?.key || '',
      priority: f.priority?.name || '—', assignee: userName(f.assignee) || '',
      type: f.issuetype?.name || '', due: f.duedate || null,
    };
  });
};
resolver.define('getBugList', async () => simpleList('labels = bug AND labels = label-only-bug AND issuetype != Epic ORDER BY created DESC'));
// Simple (label-only) features — small features that skip the full phase ceremony; mirrors getBugList.
resolver.define('getFeatureList', async () => simpleList('labels = feature AND labels = label-only-feature AND issuetype != Epic ORDER BY created DESC'));

// mark (or clear) a blocked-by-dependency state on an epic (storyKey null) or phase-story.
// Stores {kind, reason, by, at} in the epic property, sets a blocked-* Jira label on the
// target, and posts an epic comment (updates append → the comment thread is the history).
resolver.define('setBlocked', async (req) => {
  const { epicKey, storyKey, kind, reason } = req.payload || {};
  if (!epicKey) return { ok: false, error: 'missing epicKey' };
  const acct = req.context?.accountId;
  let name = (req.payload && req.payload.byName) || null;
  if (!name && acct) { try { const ur = await api.asUser().requestJira(route`/rest/api/3/myself`, { headers: { Accept: 'application/json' } }); if (ur.ok) name = (await ur.json()).displayName; } catch (e) { /* ignore */ } }
  const target = storyKey || epicKey;
  const k = storyKey ? `${storyKey}:blocked` : 'epic:blocked';
  const meta = await getEpicMeta(epicKey);

  if (!kind) { // unblock
    delete meta[k];
    await setEpicMeta(epicKey, meta);
    await setBlockedLabel(target, null);
    await postEpicComment(epicKey, `✅ Delay cleared — ${target}${name ? ` — by ${name}` : ''}`);
    return { ok: true, cleared: true };
  }
  // Internal delay REQUIRES a blocker task (map an existing one or create a new one) plus a
  // native "is blocked by" link (target is blocked by blocker). External delays need no task.
  let blocker = null;
  if (kind === 'internal') {
    const bk = (req.payload.blockerKey || '').trim().toUpperCase();
    const bs = (req.payload.blockerSummary || '').trim();
    if (bk) {
      const r = await jira(route`/rest/api/3/issue/${bk}?fields=summary`, { headers: { Accept: 'application/json' } });
      if (!r.ok) return { ok: false, error: `Blocker task ${bk} not found` };
      blocker = bk;
    } else if (bs) {
      const er = await jira(route`/rest/api/3/issue/${epicKey}?fields=project`, { headers: { Accept: 'application/json' } });
      const proj = er.ok ? (await er.json()).fields?.project?.key : null;
      if (!proj) return { ok: false, error: 'could not resolve project for blocker task' };
      const body = { fields: { project: { key: proj }, issuetype: { name: 'Task' }, summary: bs.slice(0, 240), labels: ['delay-blocker'],
        description: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: `Internal blocker for ${target}${reason ? `: ${reason}` : ''}.` }] }] } } };
      const cr = await jira(route`/rest/api/3/issue`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
      if (!cr.ok) return { ok: false, error: 'blocker create failed: ' + (await cr.text()).slice(0, 150) };
      blocker = (await cr.json()).key;
    } else {
      return { ok: false, error: 'Internal delay requires a blocker task — map an existing one or create a new one.' };
    }
    // native dependency: blocker "blocks" target  ⇒  target "is blocked by" blocker
    try { await jira(route`/rest/api/3/issueLink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: { name: 'Blocks' }, inwardIssue: { key: blocker }, outwardIssue: { key: target } }) }); }
    catch (e) { console.error('block link failed', e && e.message); }
  }
  const at = new Date().toISOString();
  meta[k] = { kind, reason: reason || '', by: acct || null, byName: name, at, blocker };
  await setEpicMeta(epicKey, meta);
  await setBlockedLabel(target, kind);
  const lbl = kind === 'internal' ? 'Internal' : 'External';
  await postEpicComment(epicKey, `⚠️ Delayed (${lbl} dependency) — ${target}${reason ? `: ${reason}` : ''}${blocker ? ` — blocked by ${blocker}` : ''}${name ? ` — by ${name}` : ''}`);
  return { ok: true, kind, reason: reason || '', by: name, at, blocker };
});

// Skip a whole phase that a task doesn't need (e.g. no QA / no UX) — instead of hand-ticking every
// item. Stores {reason, by, at} in the epic property as `<storyKey>:skipped`, posts the reason as a
// comment on the PHASE ticket + a one-line note on the epic timeline, and best-effort transitions the
// phase story to Done so the Jira board matches. Reason is mandatory. `skip:false` reverses it.
resolver.define('skipPhase', async (req) => {
  const { epicKey, storyKey, reason, skip } = req.payload || {};
  if (!epicKey || !storyKey) return { ok: false, error: 'missing epicKey/storyKey' };
  const acct = req.context?.accountId;
  let name = (req.payload && req.payload.byName) || null;
  if (!name && acct) { try { const ur = await api.asUser().requestJira(route`/rest/api/3/myself`, { headers: { Accept: 'application/json' } }); if (ur.ok) name = (await ur.json()).displayName; } catch (e) { /* ignore */ } }
  const k = `${storyKey}:skipped`;
  const meta = await getEpicMeta(epicKey);

  if (skip === false) { // un-skip
    delete meta[k];
    await setEpicMeta(epicKey, meta);
    await postEpicComment(storyKey, `↩️ Phase skip reversed — this phase is active again${name ? ` — by ${name}` : ''}. (Its Jira status was not changed back automatically.)`);
    await postEpicComment(epicKey, `↩️ Phase un-skipped — ${storyKey}${name ? ` — by ${name}` : ''}`);
    return { ok: true, cleared: true };
  }

  const why = String(reason || '').trim();
  if (!why) return { ok: false, error: 'A reason is required to skip a phase.' };
  const at = new Date().toISOString();
  meta[k] = { reason: why, by: acct || null, byName: name, at };
  await setEpicMeta(epicKey, meta);

  // rich comment on the phase ticket itself
  const body = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '⏭️ Phase skipped — not required for this task', marks: [{ type: 'strong' }] }] },
    { type: 'paragraph', content: [{ type: 'text', text: why }] },
    { type: 'paragraph', content: [{ type: 'text', text: `— ${name || 'unknown'}`, marks: [{ type: 'em' }] }] },
  ] };
  try { await jira(route`/rest/api/3/issue/${storyKey}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) }); }
  catch (e) { console.error('skip comment failed', e && e.message); }

  // one-line note on the epic timeline
  await postEpicComment(epicKey, `⏭️ Phase skipped — ${storyKey}: ${why}${name ? ` — by ${name}` : ''}`);

  // best-effort: move the phase story to Done so the Jira board matches the dashboard
  const moved = await transitionToDone(storyKey);
  return { ok: true, skipped: true, reason: why, by: name, at, moved };
});

// Save (or clear) the completion date for a QA-rework round — stored on the epic property keyed
// `<devStoryKey>:rework:<round>`. Drives the "rework completion date" the team fills in the dashboard.
resolver.define('setReworkDate', async (req) => {
  const { epicKey, storyKey, round, date } = req.payload || {};
  if (!epicKey || !storyKey || round == null) return { ok: false, error: 'missing epicKey/storyKey/round' };
  const acct = req.context?.accountId;
  let name = (req.payload && req.payload.byName) || null;
  if (!name && acct) { try { const ur = await api.asUser().requestJira(route`/rest/api/3/myself`, { headers: { Accept: 'application/json' } }); if (ur.ok) name = (await ur.json()).displayName; } catch (e) { /* ignore */ } }
  const k = `${storyKey}:rework:${round}`;
  const meta = await getEpicMeta(epicKey);
  if (!date) delete meta[k];
  else meta[k] = { date, byName: name, at: new Date().toISOString() };
  await setEpicMeta(epicKey, meta);
  return { ok: true, date: date || null, by: name };
});

// Update the due date on a phase-story (used by the QA-rework panel to push out the Development
// due date and the In-QA retest due date when a rework happens). Writes the real Jira `duedate`.
resolver.define('setPhaseDue', async (req) => {
  const { storyKey, due } = req.payload || {};
  if (!storyKey) return { ok: false, error: 'missing storyKey' };
  const r = await jira(route`/rest/api/3/issue/${storyKey}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { duedate: due || null } }),
  });
  if (!r.ok) return { ok: false, error: `due update failed: ${(await r.text()).slice(0, 150)}` };
  return { ok: true, due: due || null };
});

// Remove duplicate phase-stories under an epic (a phase provisioned more than once).
// Keeps the OLDEST story per phase label; deletes only the newer ones that are empty
// (no comments, 0 checklist progress) — anything with activity is skipped and reported.
// Runs as the app (write:jira-work covers delete), so it works regardless of the
// caller's personal Delete-Issues permission.
resolver.define('dedupePhases', async (req) => {
  const { epicKey } = req.payload || {};
  if (!epicKey) return { ok: false, error: 'missing epicKey' };
  const children = await searchAll(`parent = "${epicKey}" AND labels = qc-phase`, `summary,labels,created,status,comment,${CF.progress}`);
  const byLabel = {};
  for (const c of children) {
    const lbl = (c.fields?.labels || []).find((l) => l.startsWith('phase-'));
    if (!lbl) continue;
    (byLabel[lbl] = byLabel[lbl] || []).push(c);
  }
  const deleted = [], kept = [], skipped = [];
  for (const lbl of Object.keys(byLabel)) {
    const arr = byLabel[lbl];
    if (arr.length < 2) { if (arr[0]) kept.push(arr[0].key); continue; }
    arr.sort((a, b) => (a.fields?.created || '').localeCompare(b.fields?.created || '')); // oldest first
    kept.push(arr[0].key);
    for (const d of arr.slice(1)) {
      const comments = (d.fields?.comment?.comments || []).length;
      const prog = parseProgress(d.fields?.[CF.progress]);
      const empty = comments === 0 && (!prog || prog.done === 0);
      if (!empty) { skipped.push(`${d.key} (has activity)`); continue; }
      const r = await jira(route`/rest/api/3/issue/${d.key}`, { method: 'DELETE' });
      if (r.status === 204) deleted.push(d.key); else skipped.push(`${d.key} (${r.status})`);
    }
  }
  return { ok: true, deleted, kept, skipped };
});

// create a NEW sub-task under the phase-story and map it to the checklist item
resolver.define('createTaskForItem', async (req) => {
  const { epicKey, storyKey, itemIndex, summary } = req.payload || {};
  if (!epicKey || !storyKey || itemIndex == null) return { ok: false, error: 'missing epicKey/storyKey/itemIndex' };
  const sr = await jira(route`/rest/api/3/issue/${storyKey}?fields=project`, { headers: { Accept: 'application/json' } });
  if (!sr.ok) return { ok: false, error: 'story fetch failed' };
  const proj = (await sr.json()).fields?.project?.key;
  const cr = await jira(route`/rest/api/3/issue`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ fields: { project: { key: proj }, issuetype: { name: 'Sub-task' }, parent: { key: storyKey }, summary: (summary || 'QC task').slice(0, 240), labels: ['qc-task'] } }),
  });
  if (!cr.ok) return { ok: false, error: 'create failed: ' + (await cr.text()).slice(0, 150) };
  const key = (await cr.json()).key;
  const k = `${storyKey}:${itemIndex}`;
  const meta = await getEpicMeta(epicKey);
  meta[k] = { ...(meta[k] || {}), task: key };
  await setEpicMeta(epicKey, meta);
  return { ok: true, key };
});

// create the phase-story for a phase that doesn't have one yet (+ attach its checklist)
resolver.define('createPhaseStory', async (req) => {
  const { epicKey, kind, phaseLabel } = req.payload || {};
  if (!epicKey || !phaseLabel) return { ok: false, error: 'missing epicKey/phaseLabel' };
  const ph = (kind === 'feature' ? ALL_FEATURE_PHASES : ALL_BUG_PHASES).find((p) => p.label === phaseLabel);
  if (!ph) return { ok: false, error: 'unknown phase' };
  const existing = await searchAll(`parent = "${epicKey}" AND labels = "${phaseLabel}"`, 'summary');
  if (existing.length) return { ok: false, error: 'already exists', key: existing[0].key };
  const er = await jira(route`/rest/api/3/issue/${epicKey}?fields=project,summary`, { headers: { Accept: 'application/json' } });
  if (!er.ok) return { ok: false, error: 'epic fetch failed' };
  const ef = (await er.json()).fields;
  const cr = await jira(route`/rest/api/3/issue`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ fields: { project: { key: ef.project.key }, issuetype: { name: 'Story' }, summary: `${ph.name} — ${ef.summary || epicKey}`, parent: { key: epicKey }, labels: ['qc-phase', phaseLabel] } }),
  });
  if (!cr.ok) return { ok: false, error: 'create failed: ' + (await cr.text()).slice(0, 150) };
  const key = (await cr.json()).key;
  await jira(route`/rest/api/3/issue/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { customfield_10051: checklistAdf(ph.name, ph.items) } }) });
  return { ok: true, key };
});

// One level of a phase-story's tree, loaded ON DEMAND when a node is expanded (not the whole tree
// upfront — faster). Children = sub-tasks (parent) + linked stories (relates/blocks/polaris). Each
// child reports whether IT has further children, so the UI shows an expand caret without pre-fetching.
// Deep breakdown is via LINKED stories (Jira nests only Epic→Story→Sub-task). Read-only.
resolver.define('getChildren', async (req) => {
  const { parentKey, includeLinks, epicKey } = req.payload || {};
  if (!parentKey) return { ok: false, error: 'missing parentKey' };
  const F = 'summary,status,assignee,duedate,resolutiondate,issuetype,issuelinks,customfield_10051';
  const linkKeys = (f) => (f.issuelinks || []).map((l) => { const o = l.outwardIssue || l.inwardIssue; const t = (l.type?.name || '').toLowerCase(); return o && (t.includes('relat') || t.includes('block') || t.includes('polaris')) ? o.key : null; }).filter(Boolean);

  // Fixed shape: phase-story → (linked sub-stories + direct sub-tasks); sub-story → sub-tasks ONLY.
  // So linked stories are pulled at the ROOT only (includeLinks); deeper levels are sub-tasks only.
  let keys = [];
  try { keys = (await searchAll(`parent = "${parentKey}" ORDER BY created ASC`, 'summary')).map((s) => s.key); } catch (e) { /* ignore */ }
  // Root call (includeLinks): gather linked stories AND the phase-story's OWN checklist blocks, so
  // defects added directly on the phase-story (no sub-task) are visible + pushable at the tree root.
  let self = null;
  if (includeLinks) {
    const pr = await jira(route`/rest/api/3/issue/${parentKey}?fields=issuelinks,customfield_10051`, { headers: { Accept: 'application/json' } });
    const pf = pr.ok ? ((await pr.json()).fields || {}) : {};
    keys = [...new Set([...keys, ...linkKeys(pf)])];
    const scl = parseChecklistBlocks(pf.customfield_10051);
    self = { key: parentKey, blocks: scl.blocks, defectCount: scl.defectCount, round: scl.round };
  }
  keys = keys.filter((k) => k && k !== parentKey).slice(0, 60);

  let children = [];
  if (keys.length) {
    const issues = await searchAll(`key in (${keys.map((k) => `"${k}"`).join(',')})`, F);
    children = issues.map((it) => {
      const f = it.fields || {};
      const cl = parseChecklistBlocks(f.customfield_10051);
      const type = f.issuetype?.name || '';
      const isStory = /story|epic/i.test(type) && !/sub-?task/i.test(type);
      return { key: it.key, sum: f.summary || it.key, type, isStory, status: f.status?.name || '', cat: f.status?.statusCategory?.key || '', assignee: userName(f.assignee) || null, due: f.duedate || null, resolved: f.resolutiondate || null, blocks: cl.blocks, openCount: cl.openCount, defectCount: cl.defectCount, round: cl.round };
    });
    // A sub-story expands to its sub-tasks; a sub-task is a leaf. Count sub-tasks only (no deeper links).
    const storyKeys = children.filter((c) => c.isStory).map((c) => c.key);
    if (storyKeys.length) {
      try {
        const subs = await searchAll(`parent in (${storyKeys.map((k) => `"${k}"`).join(',')})`, 'parent');
        const cnt = {};
        for (const s of subs) { const pk = s.fields?.parent?.key; if (pk) cnt[pk] = (cnt[pk] || 0) + 1; }
        for (const c of children) c.hasChildren = c.isStory && (cnt[c.key] || 0) > 0;
      } catch (e) { for (const c of children) c.hasChildren = false; }
    } else { for (const c of children) c.hasChildren = false; }
  }

  // annotate items already pushed (so the UI can lock them + offer undo) — from the epic's push records.
  // Applies to children AND the phase-story's own blocks (self), matched by qaKey === node.key.
  if (epicKey) {
    try {
      const meta = await getEpicMeta(epicKey);
      const recs = Array.isArray(meta.qarework) ? meta.qarework : [];
      if (recs.length) for (const c of [...children, ...(self ? [self] : [])]) {
        for (const b of (c.blocks || [])) {
          const rn = (b.name.match(/(\d+)/) || [])[1]; if (!rn) continue;
          for (const it of (b.items || [])) {
            const rec = recs.find((r) => String(r.qaKey) === String(c.key) && String(r.round) === String(rn) && Array.isArray(r.items) && r.items.includes(it.text));
            if (rec) it.pushedTo = rec.target;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }
  return { ok: true, children, self };
});

// Push (COPY) selected QA-Failed items onto a Development target as a "QA Rework N" block. The tech
// lead triages from the dashboard: select all/some items → push to an EXISTING task or a NEW sub-task
// under a "QA Re-work" story (linked to the Development story). Due date is COMPULSORY. The QA sub-task
// keeps its own "QA Failed N" (copy, not move). The target keeps its previous completion date
// (resolutiondate) and gets the new rework due date — the dashboard shows both.
resolver.define('pushRework', async (req) => {
  const { epicKey, devStoryKey, round, items, targetKey, dueDate, qaKey } = req.payload || {};
  if (!items || !items.length) return { ok: false, error: 'Select at least one item to push.' };
  if (!dueDate) return { ok: false, error: 'A due date is required to push.' };
  const n = round || 1;
  let target = (targetKey || '').trim().toUpperCase();
  let created = null;
  let prevDone = null;

  if (!target) {
    if (!devStoryKey) return { ok: false, error: 'No Development story to attach the QA Re-work story to.' };
    const er = await jira(route`/rest/api/3/issue/${epicKey}?fields=project,summary`, { headers: { Accept: 'application/json' } });
    if (!er.ok) return { ok: false, error: 'epic fetch failed' };
    const ef = (await er.json()).fields; const proj = ef.project.key;
    // reuse an existing "QA Re-work" story under this epic, else create one + link to the dev story
    let reworkKey = null;
    try {
      const found = await searchAll(`parent = "${epicKey}" AND summary ~ "QA Re-work"`, 'summary');
      const hit = (found || []).find((s) => /qa\s*re-?work/i.test(s.fields?.summary || ''));
      reworkKey = hit && hit.key;
    } catch (e) { /* ignore */ }
    if (!reworkKey) {
      const cr = await jira(route`/rest/api/3/issue`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ fields: { project: { key: proj }, issuetype: { name: 'Story' }, summary: `QA Re-work — ${ef.summary || epicKey}`, parent: { key: epicKey }, labels: ['qa-rework'] } }) });
      if (!cr.ok) return { ok: false, error: 'QA Re-work story create failed: ' + (await cr.text()).slice(0, 150) };
      reworkKey = (await cr.json()).key;
      try { await jira(route`/rest/api/3/issueLink`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: { name: 'Relates' }, inwardIssue: { key: reworkKey }, outwardIssue: { key: devStoryKey } }) }); } catch (e) { /* ignore */ }
    }
    const cr2 = await jira(route`/rest/api/3/issue`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ fields: { project: { key: proj }, issuetype: { name: 'Sub-task' }, parent: { key: reworkKey }, summary: `QA Rework ${n} — ${items.length} item(s)`, labels: ['qa-rework'], duedate: dueDate } }) });
    if (!cr2.ok) return { ok: false, error: 'rework sub-task create failed: ' + (await cr2.text()).slice(0, 150) };
    target = (await cr2.json()).key; created = target;
  } else {
    // existing target — capture its previous completion date (before rework), then set the new due date
    const tr = await jira(route`/rest/api/3/issue/${target}?fields=resolutiondate,duedate`, { headers: { Accept: 'application/json' } });
    if (tr.ok) { const tf = (await tr.json()).fields || {}; prevDone = tf.resolutiondate || tf.duedate || null; }
    const ur = await jira(route`/rest/api/3/issue/${target}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { duedate: dueDate } }) });
    if (!ur.ok) return { ok: false, error: `due-date set failed on ${target}: ${(await ur.text()).slice(0, 120)}` };
  }

  // append the "QA Rework N" block (copy of the selected items) to the target's editable checklist
  const gr = await jira(route`/rest/api/3/issue/${target}?fields=customfield_10051`, { headers: { Accept: 'application/json' } });
  let adf = gr.ok ? (await gr.json()).fields?.customfield_10051 : null;
  if (!adf || !adf.content) adf = { type: 'doc', version: 1, content: [] };
  adf.content = adf.content.concat(checklistBlockParas(`QA Rework ${n}`, items));
  const pr = await jira(route`/rest/api/3/issue/${target}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { customfield_10051: adf } }) });
  if (!pr.ok) return { ok: false, error: 'checklist write failed: ' + (await pr.text()).slice(0, 150) };

  // record the push on the epic — powers the round-grouped QA Rework phase (reliable target↔source
  // link, round, due date, and the initial completion date preserved for the dual-date display)
  try {
    const meta = await getEpicMeta(epicKey);
    meta.qarework = Array.isArray(meta.qarework) ? meta.qarework : [];
    meta.qarework.push({ round: n, qaKey: qaKey || null, target, items, count: items.length, dueDate, prevDone, at: new Date().toISOString() });
    await setEpicMeta(epicKey, meta);
  } catch (e) { console.error('rework record store failed', e && e.message); }

  return { ok: true, target, created, count: items.length, dueDate };
});

// Undo a push: remove the "QA Rework N" block from the target task and drop the record, so the
// defect items become pushable again (and aren't duplicated across tasks).
resolver.define('undoPush', async (req) => {
  const { epicKey, qaKey, round, target } = req.payload || {};
  if (!epicKey || !target || round == null) return { ok: false, error: 'missing epicKey/target/round' };
  // remove the "QA Rework N" block from the target's checklist
  const gr = await jira(route`/rest/api/3/issue/${target}?fields=customfield_10051`, { headers: { Accept: 'application/json' } });
  if (gr.ok) {
    const adf = (await gr.json()).fields?.customfield_10051;
    const { adf: cleaned, changed } = removeNamedBlock(adf, `QA Rework ${round}`);
    if (changed) await jira(route`/rest/api/3/issue/${target}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { customfield_10051: cleaned } }) });
  }
  // drop the matching record(s)
  const meta = await getEpicMeta(epicKey);
  const before = Array.isArray(meta.qarework) ? meta.qarework : [];
  meta.qarework = before.filter((r) => !(String(r.target) === String(target) && String(r.round) === String(round) && (!qaKey || String(r.qaKey) === String(qaKey))));
  await setEpicMeta(epicKey, meta);
  return { ok: true, removed: before.length - meta.qarework.length };
});

// Round-grouped roll-up for the QA Rework phase. Reads the push records on the epic, then live-checks
// each dev target's "QA Rework N" (fix side) and each QA sub-task's "QA Failed N" (retest side).
// Returns rounds: [{ n, targets[], sources[], done }].
resolver.define('getReworkRounds', async (req) => {
  const { epicKey } = req.payload || {};
  if (!epicKey) return { ok: false, error: 'missing epicKey' };
  const meta = await getEpicMeta(epicKey);
  const recs = Array.isArray(meta.qarework) ? meta.qarework : [];
  if (!recs.length) return { ok: true, rounds: [] };
  const keys = [...new Set(recs.flatMap((r) => [r.target, r.qaKey]).filter(Boolean))];
  const info = {};
  if (keys.length) {
    const issues = await searchAll(`key in (${keys.map((k) => `"${k}"`).join(',')})`, 'summary,status,assignee,duedate,resolutiondate,customfield_10051');
    for (const it of issues) {
      const f = it.fields || {};
      info[it.key] = { sum: f.summary || it.key, status: f.status?.name || '', cat: f.status?.statusCategory?.key || null, assignee: userName(f.assignee) || null, due: f.duedate || null, resolved: f.resolutiondate || null, blocks: parseChecklistBlocks(f.customfield_10051).blocks };
    }
  }
  const blockDone = (key, prefix, n) => {
    const inf = info[key]; if (!inf) return false;
    // prefix may be an alternation ("QA Failed|Defects?"); allow a trailing suffix after the
    // round number ("Defects 1 - Payee Module") but not a longer number ("Defects 10" for n=1).
    const re = new RegExp('^(?:' + prefix + ')\\s+' + n + '(?!\\d)', 'i');
    const b = inf.blocks.find((x) => re.test(x.name));
    return b ? (b.openCount === 0 && b.doneCount > 0) : false;
  };
  // Group by rework LOOP (one dev target ↔ one QA sub-task) — NOT by global round number. Each loop numbers
  // its rounds independently (from that QA sub-task's own "QA Failed N" blocks), so grouping by round merged
  // unrelated loops into the same box (the "duplicate rounds" bug). Each loop now lists its own rounds 1..N.
  const byLoop = {};
  for (const r of recs) {
    const lk = (r.qaKey || '?') + '|' + (r.target || '?');
    const lp = byLoop[lk] = byLoop[lk] || { qaKey: r.qaKey || null, target: r.target || null, rounds: {} };
    const n = r.round || 1;
    // last write wins for a given round number (defensive against a duplicate push of the same round)
    lp.rounds[n] = { n, count: r.count || (Array.isArray(r.items) ? r.items.length : 0), due: r.dueDate || null, prevDone: r.prevDone || null };
  }
  const loops = Object.values(byLoop).map((lp) => {
    const qi = info[lp.qaKey] || {};
    const ti = info[lp.target] || {};
    const rounds = Object.values(lp.rounds).sort((a, b) => a.n - b.n).map((rd) => ({
      n: rd.n, count: rd.count, due: rd.due, prevDone: rd.prevDone || ti.resolved || null,
      fixDone: blockDone(lp.target, 'QA Rework', rd.n),
      retested: blockDone(lp.qaKey, 'QA Failed|Defects?', rd.n),
    }));
    const last = rounds[rounds.length - 1] || {};
    return {
      qaKey: lp.qaKey, qaSum: qi.sum || lp.qaKey, qaStatus: qi.status || '', qaCat: qi.cat || null, qaDue: qi.due || null,
      devKey: lp.target, devSum: ti.sum || lp.target, devOwner: ti.assignee || null, devPrevDone: ti.resolved || null,
      rounds, latest: last.n || 0,
      done: !!(last.fixDone && last.retested),   // loop closed only when its most-recent round is fixed AND retested
    };
  }).sort((a, b) => (a.devKey || '').localeCompare(b.devKey || ''));
  return { ok: true, loops };
});

resolver.define('getDailyBoard', async () => computeDailyBoard());

// Add a bug epic (by key) to the standing report include-list, and auto-generate its brief.
resolver.define('addReportBug', async (req) => {
  const key = String((req.payload && req.payload.key) || '').trim().toUpperCase();
  if (!key) return { ok: false, error: 'Enter a bug epic key.' };
  const r = await jira(route`/rest/api/3/issue/${key}?fields=summary,labels,issuetype`, { headers: { Accept: 'application/json' } });
  if (!r.ok) return { ok: false, error: `${key} not found.` };
  const f = (await r.json()).fields || {};
  if ((f.issuetype && f.issuetype.name) !== 'Epic') return { ok: false, error: `${key} is not an Epic.` };
  if (!(f.labels || []).includes('bug')) return { ok: false, error: `${key} is not a bug epic (needs the "bug" label).` };
  const list = await getReportBugKeys();
  if (!list.includes(key)) { list.push(key); await setReportBugKeys(list); }
  // auto-fill: generate the AI brief now (unless a human already wrote one today)
  let draft = null;
  try {
    const board = await computeDailyBoard();
    const e = board.active.find((x) => x.key === key);
    const cur = await getProp(key, DAILY_PROP);
    const d = today();
    if (e && !(cur[d] && cur[d].text)) {
      const signals = await recentSignals(key);
      draft = await draftUpdate(daily.buildDraftPrompt({ ...e, signals, today: d }));
      cur[d] = { ...(cur[d] || {}), draft };
      await setProp(key, DAILY_PROP, pruneDays(cur));
    }
  } catch (err) { console.error('addReportBug draft failed', key, err && err.message); }
  return { ok: true, key, draft };
});

// Remove a bug epic from the report include-list.
resolver.define('removeReportBug', async (req) => {
  const key = String((req.payload && req.payload.key) || '').trim().toUpperCase();
  const list = (await getReportBugKeys()).filter((k) => k !== key);
  await setReportBugKeys(list);
  return { ok: true };
});

resolver.define('setDailyUpdate', async (req) => {
  const { epicKey, text } = req.payload || {};
  if (!epicKey) return { ok: false, error: 'missing epicKey' };
  const acct = req.context?.accountId;
  let name = (req.payload && req.payload.byName) || null;
  if (!name && acct) { try { const ur = await api.asUser().requestJira(route`/rest/api/3/myself`, { headers: { Accept: 'application/json' } }); if (ur.ok) name = (await ur.json()).displayName; } catch (e) { /* ignore */ } }
  const cur = await getProp(epicKey, DAILY_PROP);
  const cleaned = daily.capText(text || '');
  const day = today();
  cur[day] = { ...(cur[day] || {}), text: cleaned, by: name, at: new Date().toISOString() };
  await setProp(epicKey, DAILY_PROP, pruneDays(cur));
  return { ok: true, text: cleaned };
});

async function recentSignals(epicKey) {
  try {
    const r = await jira(route`/rest/api/3/issue/${epicKey}/comment?orderBy=-created&maxResults=3`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return [];
    const cs = (await r.json()).comments || [];
    const flat = (adf) => (adf?.content || []).map((b) => (b.content || []).map((n) => n.text || '').join(' ')).join(' ').trim();
    return cs.map((c) => ({ type: 'comment', text: flat(c.body).slice(0, 160) })).filter((s) => s.text);
  } catch (e) { return []; }
}

resolver.define('generateDraft', async (req) => {
  const { epicKey } = req.payload || {};
  if (!epicKey) return { ok: false, error: 'missing epicKey' };
  const board = await computeDailyBoard();
  const e = board.active.find((x) => x.key === epicKey);
  if (!e) return { ok: false, error: 'epic not active' };
  const signals = await recentSignals(epicKey);
  const day = today();
  const draft = await draftUpdate(daily.buildDraftPrompt({ ...e, signals, today: day }));
  const cur = await getProp(epicKey, DAILY_PROP);
  cur[day] = { ...(cur[day] || {}), draft };
  await setProp(epicKey, DAILY_PROP, pruneDays(cur));
  return { ok: true, draft };
});

resolver.define('generateDrafts', async () => {
  // Forge UI-invoked functions hard-timeout at 25s, so the 25 epics can't be drafted sequentially
  // (each = a Jira fetch + an OpenRouter call). Run a bounded worker pool; each epic's draft is
  // committed independently, so a partial run still saves progress and re-clicking resumes the rest.
  const board = await computeDailyBoard();
  const day = today();
  let drafted = 0, skipped = 0;
  const queue = board.active.slice();
  const worker = async () => {
    while (queue.length) {
      const e = queue.shift();
      if (!e) break;
      const cur = await getProp(e.key, DAILY_PROP);
      if (cur[day] && cur[day].text) { skipped++; continue; }   // don't overwrite a human edit
      try {
        const signals = await recentSignals(e.key);
        const draft = await draftUpdate(daily.buildDraftPrompt({ ...e, signals, today: day }));
        cur[day] = { ...(cur[day] || {}), draft };
        await setProp(e.key, DAILY_PROP, pruneDays(cur));
        drafted++;
      } catch (err) { console.error('generateDrafts failed', e.key, err && err.message); skipped++; }
    }
  };
  const CONC = 8;
  await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, worker));
  return { ok: true, drafted, skipped };
});

export const handler = resolver.getDefinitions();
