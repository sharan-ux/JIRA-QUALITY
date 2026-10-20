// Run: node src/resolvers/checklist-parse.test.mjs   (or: npm test)
import assert from 'node:assert/strict';
import { parseChecklist, nodeText, toLines } from './checklist-parse.mjs';

let n = 0; const ok = (m) => { n++; console.log(`  ok ${n} - ${m}`); };

// ---- ADF builders ----
const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
const li = (t) => ({ type: 'listItem', content: [para(t)] });
const oList = (...t) => ({ type: 'orderedList', attrs: { order: 1 }, content: t.map(li) });
const bList = (...t) => ({ type: 'bulletList', content: t.map(li) });
const doc = (...blocks) => ({ type: 'doc', version: 1, content: blocks });

// ======================================================================
// REGRESSION: the Gebsun-normalised LIST shape (exactly what broke OCW-23577).
// orderedList header "BA" + bulletList of "[done] ..." items. The old parser
// only read top-level text nodes, so it returned [] here -> dashboard fell back
// to the framework list at 0% while the ticket showed 8/8.
// ======================================================================
const BA = [
  'Primary KPI(s) defined with explicit target values and timeframe',
  'Guardrail metrics defined (things that must not get worse)',
  'Baseline / current-state value captured before any code ships',
  'Data source and measurement method identified and confirmed trackable',
  'Required analytics events / instrumentation written as engineering requirements',
  'KPI targets reviewed and approved by PM and a business stakeholder',
  'A post-launch KPI review date is scheduled and linked to BA Review',
  'COO (or delegate) sign-off recorded — by name and date',
];
const listShape = doc(
  oList('BA'),
  bList(...BA.map((t) => `[done] ${t}`)),
  // user-added second block — must be ignored (first native block only)
  oList('QA Rework 1'),
  bList('[open] Fix the broken thing'),
);
{
  const items = parseChecklist(listShape);
  assert.equal(items.length, 8, 'list shape: 8 native items parsed (not 0, not incl. rework)');
  assert.ok(items.every((i) => i.done), 'list shape: every item marked done');
  assert.equal(items[0].text, BA[0], 'list shape: first item text');
  assert.equal(items[4].text, BA[4], 'list shape: 5th item = Required analytics events (the real #5)');
  assert.equal(items[7].text, BA[7], 'list shape: COO row preserved');
  assert.ok(!items.some((i) => /Fix the broken thing/.test(i.text)), 'list shape: user-added QA Rework block excluded');
}
ok('Gebsun-normalised list shape parses to the real items + done state');

// ======================================================================
// NO-REGRESSION: the flat-paragraph shape provision.js writes.
// "# BA" header paragraph + one "[state] item" paragraph each; stop at next "# ".
// ======================================================================
const flatShape = doc(
  para('# BA'),
  para('[done] First item'),
  para('[open] Second item'),
  para('# QA Rework 1'),        // second block header -> stop here
  para('[open] later block item'),
);
{
  const items = parseChecklist(flatShape);
  assert.equal(items.length, 2, 'flat shape: only first block (2 items)');
  assert.deepEqual(items[0], { text: 'First item', done: true }, 'flat: done item');
  assert.deepEqual(items[1], { text: 'Second item', done: false }, 'flat: open item');
}
ok('flat-paragraph shape still parses (no regression)');

// Bullet-prefixed flat items ("* [done] ...") still parse.
{
  const items = parseChecklist(doc(para('# H'), para('* [done] a'), para('- [open] b'), para('+ [x] c')));
  assert.deepEqual(items.map((i) => i.done), [true, false, true], 'bullet-prefixed states');
  assert.equal(items[0].text, 'a', 'bullet stripped from text');
}
ok('bullet-prefixed flat items parse with optional bullet');

// ======================================================================
// Mixed done states + odd markers.
// ======================================================================
{
  const items = parseChecklist(doc(oList('H'), bList('[done] d', '[complete] c', '[x] x', '[open] o', '[] blank', 'no brackets')));
  assert.deepEqual(items.map((i) => i.done), [true, true, true, false, false, false], 'done/complete/x = done; open/blank/none = not');
  assert.equal(items[5].text, 'no brackets', 'line without brackets kept as text');
}
ok('state markers: done/complete/x true; open/empty/none false');

// ======================================================================
// First block with NO header (bulletList first) reads all its items, stops at a header.
// ======================================================================
{
  const items = parseChecklist(doc(bList('[done] only a', '[open] only b'), oList('Next block'), bList('[open] ignored')));
  assert.equal(items.length, 2, 'headerless first block: 2 items, stops at next header');
  assert.equal(items[1].text, 'only b', 'second item text');
}
ok('headerless first block parses and stops at next header');

// ======================================================================
// Edge cases: empty / null / no content.
// ======================================================================
assert.deepEqual(parseChecklist(null), [], 'null -> []');
assert.deepEqual(parseChecklist(undefined), [], 'undefined -> []');
assert.deepEqual(parseChecklist({ type: 'doc' }), [], 'no content -> []');
assert.deepEqual(parseChecklist({ type: 'doc', content: [] }), [], 'empty content -> []');
assert.deepEqual(parseChecklist(doc(oList('H'))), [], 'header only, no items -> []');
ok('empty / null / no-content / header-only -> []');

// nodeText recurses nested list -> paragraph -> text.
assert.equal(nodeText(li('[done] hello')), '[done] hello', 'nodeText extracts nested list-item text');
ok('nodeText recurses into nested structures');

// ======================================================================
// toLines tagging — the mechanism parseReworkRounds / parseChecklistBlocks rely on.
// Normalised (list): orderedList item = header; bulletList item = content.
// Flat: header carried as "# ..." text (header flag false, detected by the callers' startsWith('#')).
// ======================================================================
{
  const norm = toLines(doc(oList('QA Rework 1'), bList('[done] a', '[open] b')));
  assert.deepEqual(norm, [
    { text: 'QA Rework 1', header: true },
    { text: '[done] a', header: false },
    { text: '[open] b', header: false },
  ], 'normalised rework: orderedList header flagged, bulletList items not');

  const flat = toLines(doc(para('# Defects 2'), para('[open] bug')));
  assert.deepEqual(flat, [
    { text: '# Defects 2', header: false },
    { text: '[open] bug', header: false },
  ], 'flat: header kept as "# ..." text for startsWith(#) detection');
}
ok('toLines tags headers/items for both shapes (rework + defect parsers)');

// ======================================================================
// ">>" annotation lines are team comments on the item above — NOT rows.
// ======================================================================
{
  const items = parseChecklist(doc(oList('Marketing Training'), bList(
    '[done] Marketing briefed hands-on on the actual working feature',
    '[done] COO (or delegate) sign-off recorded — by name and date',
    '>> We are marking this as completed because we have already completed the marketing and sales training.',
  )));
  assert.equal(items.length, 2, '">>" annotation line is skipped, not a separate row');
  assert.ok(!items.some((i) => /We are marking this/.test(i.text)), '">>" comment does not appear as an item');
  assert.equal(items[1].text, 'COO (or delegate) sign-off recorded — by name and date', 'real items intact');
}
ok('">>" annotation lines are skipped (not separate checklist rows)');

console.log(`\n${n} test groups passed.`);
