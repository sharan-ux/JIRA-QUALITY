// test/daily-format.test.js — unit tests for the daily CEO-brief formatter
const { test } = require('node:test');
const assert = require('node:assert');
const { capText, fmtDate, phasePct, statusOf, buildDraftPrompt, buildReportMarkdown, MAX } = require('../src/report/daily-format');

test('phasePct: done/total rounded; 0 when no total', () => {
  assert.strictEqual(phasePct(8, 15), 53);
  assert.strictEqual(phasePct(0, 6), 0);
  assert.strictEqual(phasePct(3, 0), 0);
});

test('statusOf: priority Delayed > Wrapping up > Live > Overdue > On track', () => {
  assert.strictEqual(statusOf({ delayed: true, deployed: true, due: '2026-01-01', phasesDone: 15, phasesTotal: 15, today: '2026-09-16' }), 'Delayed');
  assert.strictEqual(statusOf({ phasesDone: 6, phasesTotal: 6, deployed: true, due: '2026-01-01', today: '2026-09-16' }), 'Wrapping up');
  // deployed but not all-done and past due -> Live (shipped), not Overdue
  assert.strictEqual(statusOf({ deployed: true, due: '2026-09-01', phasesDone: 10, phasesTotal: 15, today: '2026-09-16' }), 'Live');
  assert.strictEqual(statusOf({ due: '2026-09-01', phasesDone: 3, phasesTotal: 15, today: '2026-09-16' }), 'Overdue');
  assert.strictEqual(statusOf({ due: '2026-12-01', phasesDone: 3, phasesTotal: 15, today: '2026-09-16' }), 'On track');
  assert.strictEqual(statusOf({ phasesDone: 1, phasesTotal: 15, today: '2026-09-16' }), 'On track'); // no due
});

test('capText collapses whitespace and trims', () => {
  assert.strictEqual(capText('  a\n  b   c '), 'a b c');
});

test('capText passes short text through unchanged', () => {
  assert.strictEqual(capText('short update'), 'short update');
});

test('capText hard-caps to MAX word-safe with ellipsis', () => {
  const long = 'word '.repeat(120).trim(); // ~599 chars > MAX
  const out = capText(long);
  assert.ok(out.length <= MAX, `len ${out.length} <= ${MAX}`);
  assert.ok(out.endsWith('…'));
  assert.ok(!out.includes('  '));
});

test('capText hard-caps a single long token with no spaces (else branch)', () => {
  const out = capText('x'.repeat(MAX + 120));
  assert.ok(out.length <= MAX);
  assert.ok(out.endsWith('…'));
});

test('fmtDate formats ISO date to "Mon D" and is null-safe', () => {
  assert.strictEqual(fmtDate('2026-09-26'), 'Sep 26');
  assert.strictEqual(fmtDate(null), null);
});

test('buildDraftPrompt: exec-facing, includes identity/stage/target/signals, forbids checklist+% jargon', () => {
  const p = buildDraftPrompt({ key: 'OCW-1', name: 'Thing', phaseName: 'Development', due: '2026-09-26',
    signals: [{ type: 'comment', text: 'BE merged' }] });
  assert.match(p, /OCW-1 — Thing/);
  assert.match(p, /Current open stage: Development/);
  assert.match(p, /target \/ go-live date IS set: 2026-09-26/i);
  assert.match(p, /BE merged/);
  assert.match(p, /No blockers/i);
  assert.match(p, /best-estimate|estimate/i);
  assert.match(p, /Do NOT mention checklists.*percentages/i);
  assert.match(p, /under 350 characters/i);
  assert.match(p, /System-computed status/i);
});

test('buildDraftPrompt: with today + past due, instructs OVERDUE handling', () => {
  const p = buildDraftPrompt({ key: 'OCW-3', name: 'Late', phaseName: 'Development', due: '2026-09-02',
    today: '2026-09-14', signals: [] });
  assert.match(p, /Today is 2026-09-14/);
  assert.match(p, /OVERDUE/);
  assert.match(p, /revised best-estimate/i);
});

test('buildDraftPrompt: no due date -> instructs "not set" + estimate', () => {
  const p = buildDraftPrompt({ key: 'OCW-2', name: 'X', phaseName: 'BA', due: null, signals: [] });
  assert.match(p, /No target date has been set/i);
  assert.match(p, /no recent activity found/i);
});

test('buildReportMarkdown: split Feature/Bug sections, status dots, phase %, summary', () => {
  const md = buildReportMarkdown({ date: '2026-09-16', generatedFor: 'Sabeer',
    active: [
      { key: 'OCW-1', name: 'Thing', kind: 'feature', phaseName: 'Development', due: '2026-09-26', phasesDone: 8, phasesTotal: 15, pctPhases: 53, status: 'On track', text: 'Build underway. No blockers.' },
      { key: 'OCW-2', name: 'LateBug', kind: 'bug', phaseName: 'In QA', due: '2026-09-01', phasesDone: 4, phasesTotal: 6, pctPhases: 67, status: 'Overdue', text: '' },
    ],
    doneTail: [{ key: 'OCW-9', name: 'Old' }] });
  assert.ok(!md.includes('\n| '), 'must not contain a markdown table row');
  assert.match(md, /Zil Money · Daily Epic Progress · Internal/);
  assert.match(md, /auto-generated/);
  // summary bar with counts
  assert.match(md, /2 initiatives — 🟢 1 on track · 🔴 1 overdue · 🟠 0 delayed/);
  // sections
  assert.match(md, /## Feature initiatives \(1\)/);
  assert.match(md, /## Bug fixes \(1\)/);
  // feature item: numbered + dot + status + stage + phase% + target
  assert.match(md, /\*\*1\. OCW-1 — Thing\*\* — 🟢 On track · Development · 8\/15 phases \(53%\) · Target Sep 26/);
  assert.match(md, /Build underway\. No blockers\./);
  // bug item: numbered (restarts per section) + overdue dot + placeholder body
  assert.match(md, /\*\*1\. OCW-2 — LateBug\*\* — 🔴 Overdue · In QA · 4\/6 phases \(67%\) · Target Sep 1/);
  assert.match(md, /_No update yet\._/);
  assert.match(md, /## Completed recently \(7 days\)/);
  assert.match(md, /OCW-9 — Old/);
});
