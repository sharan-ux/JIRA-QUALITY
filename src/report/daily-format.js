// src/report/daily-format.js — pure helpers for the daily CEO status brief (no Forge/network).
// The brief is an AUTOMATED, AI-generated executive summary: plain-English progress per initiative,
// timeline/blocker status and an expected go-live date — deliberately NO checklist items or percentages
// (the CEO does not track those).
const MAX = 400;

function capText(s, max = MAX) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

// 'YYYY-MM-DD' -> 'Sep 26' (null-safe)
function fmtDate(d) {
  if (!d) return null;
  const p = String(d).split('-');
  if (p.length < 3) return String(d);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(+p[1]) - 1] || p[1];
  return `${mon} ${+p[2]}`;
}

// The executive prompt. epic = {key, name, phaseName, pct?, due, signals:[{type,text}]}.
function buildDraftPrompt(epic) {
  const e = epic || {};
  const signals = (e.signals || []).map((s) => `- [${s.type}] ${s.text}`).join('\n') || '- (no recent activity found)';
  const nowLine = e.today ? `Today is ${e.today}. ` : '';
  const target = e.due
    ? `${nowLine}A target / go-live date IS set: ${e.due}. If that target is on or before today and the work is clearly not finished, state plainly that it is OVERDUE and give a revised best-estimate date.`
    : `${nowLine}No target date has been set by the team yet.`;
  const done = (e.donePhases && e.donePhases.length) ? e.donePhases.join(', ') : 'none';
  const pending = (e.pendingPhases && e.pendingPhases.length) ? e.pendingPhases.join(', ') : 'none';
  const deployedLine = e.deployed
    ? 'CRITICAL: the Deployment phase is COMPLETE — this feature is ALREADY LIVE in production. The initiative is still open ONLY because of the remaining gates under "Still pending" (e.g. compliance sign-off), NOT because the product is unfinished. Lead with the fact that it has shipped / gone live, then say which gate(s) remain.'
    : '';
  const delayLine = e.delayed
    ? `CRITICAL: this initiative is marked DELAYED${e.delayKind ? ` (${e.delayKind} dependency)` : ''}${e.delayReason ? ` — reason: ${e.delayReason}` : ''}${e.delayBlocker ? ` (blocked by ${e.delayBlocker})` : ''}. LEAD the brief with the delay and its reason, then the impact on go-live.`
    : '';
  return [
    'You are the automated status writer for the CEO, who does NOT know our internal QC checklist, phase names, or percentages. The team has full access to the complete workflow; produce a fully AI-generated executive brief, not a manual note.',
    `Initiative: ${e.key} — ${e.name}`,
    `System-computed status: ${e.status || 'On track'}. Your brief MUST be consistent with this status — never contradict it.`,
    `Current open stage: ${e.phaseName}`,
    `Completed phases: ${done}.`,
    `Still pending: ${pending}.`,
    deployedLine,
    delayLine,
    target,
    'Recent activity (comments) since the last update:',
    signals,
    '',
    'VELOCITY — CRITICAL, override your defaults: this team ships with world-class AI tooling (Claude, Manus, etc.). Each remaining phase takes about ONE day, not a sprint. So the go-live estimate is roughly (number of still-pending phases) days from today — typically 2-3 days, and essentially NEVER more than ~1-2 weeks. NEVER estimate in months or quarters. NEVER write "months", "4-5 months", "several months", "Q4", "next quarter", "late <month>", or any multi-week horizon. If your instinct says months, it is WRONG for this team — convert it to a few days and give a concrete near-term date. The ONLY exception: a comment names a hard EXTERNAL dependency (a bank / vendor / customer sign-off) that genuinely blocks longer — then say so and name it.',
    '',
    'Write 2-3 plain-English sentences for the CEO, in this order:',
    '1) the TRUE current state based on the completed vs pending phases above (NOT just the "current open stage") — if Deployment is done, say it is live/shipped even though a later gate remains; never describe it as early/in-development when later phases are already complete; if DELAYED, lead with the delay + reason;',
    '2) timeline: ONLY say the target is at risk / slipping / unachievable, or give a revised date, if the status is "Overdue" or "Delayed" OR a comment explicitly states a delay. If the target date is in the FUTURE and the status is "On track", treat the set target as the go-live date and do NOT speculate that it will be missed — low % completion alone is NOT a reason to predict a slip;',
    '3) an explicit blocker/delay status — write "No blockers." if none is evident, or the delay reason if delayed;',
    '4) the expected go-live date — the set target if on track; a revised estimate (in days, per the velocity note) only if overdue/delayed; or (if already live) what remains before the epic can close.',
    'Do NOT mention checklists, phase jargon, story keys, or percentages. No preamble. Keep it under 350 characters.',
  ].filter(Boolean).join('\n');
}

// strip stray markdown the model sometimes leaves in a brief (**bold**, # heading, `code`)
function stripMd(s) {
  return String(s || '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1').replace(/`([^`]*)`/g, '$1').trim();
}

// Phase-completion % from done vs total provisioned phase-stories.
function phasePct(done, total) { return total > 0 ? Math.round(((done || 0) / total) * 100) : 0; }

// Executive status (priority: Delayed > Wrapping up > Live > Overdue > On track).
// "Delayed" = the dashboard's "Mark as Delayed" (blocked-* label or a :blocked record with a reason).
// "Live" = the Deployment phase is done (shipped) while the epic is still open on a remaining gate.
// row = {delayed, deployed, due, phasesDone, phasesTotal, today} — dates 'YYYY-MM-DD' (lexical = chrono).
function statusOf(row) {
  const r = row || {};
  const allDone = (r.phasesTotal || 0) > 0 && (r.phasesDone || 0) >= (r.phasesTotal || 0);
  if (r.delayed) return 'Delayed';
  if (allDone) return 'Wrapping up';
  if (r.deployed) return 'Live';
  if (r.due && r.today && r.due < r.today) return 'Overdue';
  return 'On track';
}
const STATUS_DOT = { 'On track': '🟢', Live: '✅', Overdue: '🔴', Delayed: '🟠', 'Wrapping up': '🔵' };

// Briefed-list layout, split into Feature initiatives + Bug fixes, with a phase-% and status dot per
// item. digest = {date, generatedFor, active:[{key,name,kind,phaseName,due,phasesDone,phasesTotal,
// pctPhases,status,text}], doneTail:[{key,name}]}.
function buildReportMarkdown(digest) {
  const d = digest || {};
  const active = d.active || [];
  const doneTail = d.doneTail || [];
  const feats = active.filter((a) => a.kind !== 'bug');
  const bugs = active.filter((a) => a.kind === 'bug');
  const countBy = (s) => active.filter((a) => a.status === s).length;
  const block = (a, i) => {
    const tgt = a.due ? `Target ${fmtDate(a.due)}` : 'Target: not set yet';
    const ph = a.phasesTotal ? `${a.phasesDone || 0}/${a.phasesTotal} phases (${a.pctPhases || 0}%)` : '—';
    const dot = STATUS_DOT[a.status] || '';
    const delay = a.delayed ? `\n\n> ⚠ **Delayed${a.delayKind ? ` (${a.delayKind})` : ''}** — ${stripMd(a.delayReason) || 'reason not recorded'}${a.delayBlocker ? ` · blocked by ${a.delayBlocker}` : ''}` : '';
    const body = a.text && a.text.trim() ? stripMd(a.text) : '_No update yet._';
    return `**${i + 1}. ${a.key} — ${a.name}** — ${dot} ${a.status || ''} · ${a.phaseName || '—'} · ${ph} · ${tgt}${delay}\n\n${body}`;
  };
  const section = (arr, empty) => (arr.length ? arr.map(block).join('\n\n') : empty);
  const done = doneTail.length ? doneTail.map((x) => `- ${x.key} — ${x.name}`).join('\n') : '- (none)';
  const wrap = countBy('Wrapping up');
  const live = countBy('Live');
  const delayed = countBy('Delayed');
  const summary = `**${active.length} initiatives — 🟢 ${countBy('On track')} on track${live ? ` · ✅ ${live} live` : ''} · 🔴 ${countBy('Overdue')} overdue · 🟠 ${delayed} delayed${wrap ? ` · 🔵 ${wrap} wrapping up` : ''}**`;
  return [
    'Zil Money · Daily Epic Progress · Internal',
    '# Daily Epic Progress',
    `${d.date} · for ${d.generatedFor || 'Sabeer'} · auto-generated`,
    '',
    summary,
    '',
    `## Feature initiatives (${feats.length})`,
    section(feats, '_None._'),
    '',
    `## Bug fixes (${bugs.length})`,
    section(bugs, '_None selected._'),
    '',
    '## Completed recently (7 days)',
    done,
    '',
  ].join('\n');
}

module.exports = { MAX, capText, fmtDate, stripMd, phasePct, statusOf, buildDraftPrompt, buildReportMarkdown };
