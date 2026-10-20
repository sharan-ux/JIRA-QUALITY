// test/qaloop-adf.test.js — unit tests for the pure ADF helpers in qaloop-adf.js
const { test } = require('node:test');
const assert = require('node:assert');
const { textLines, parseBlocks, currentRoundItems, priorRounds, stampQaHeader, appendReworkBlock, reworkRoundComplete } = require('../src/triggers/qaloop-adf');

// ---------------------------------------------------------------------------
// Task 2: textLines
// ---------------------------------------------------------------------------
test('textLines flattens ADF to ordered text nodes', () => {
  const adf = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] first item' }] },
  ]};
  const lines = textLines(adf).map((l) => l.text);
  assert.deepStrictEqual(lines, ['# In QA', '[open] first item']);
});

// ---------------------------------------------------------------------------
// Task 3: parseBlocks
// ---------------------------------------------------------------------------
test('parseBlocks splits headers and items, reads done state', () => {
  const adf = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[done] Every planned test case executed' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '# Defects' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] Save button 500s' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] Wrong total on summary' }] },
  ]};
  const blocks = parseBlocks(adf);
  assert.strictEqual(blocks.length, 2);
  assert.strictEqual(blocks[0].header, 'In QA');
  assert.strictEqual(blocks[0].items[0].done, true);
  assert.strictEqual(blocks[1].header, 'Defects');
  assert.deepStrictEqual(blocks[1].items.map((i) => i.text), ['Save button 500s', 'Wrong total on summary']);
});

// ---------------------------------------------------------------------------
// Task 4: currentRoundItems + priorRounds
// ---------------------------------------------------------------------------
test('currentRoundItems excludes phase block and stamped blocks, merges the rest', () => {
  const adf = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[done] phase item' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '# QA Failed 1' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] old defect' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '# Defects' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] new defect A' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] new defect B' }] },
  ]};
  assert.deepStrictEqual(currentRoundItems(adf, 'In QA'), ['new defect A', 'new defect B']);
  assert.strictEqual(priorRounds(adf), 1);
});

test('currentRoundItems returns [] when only phase + stamped blocks exist', () => {
  const adf = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] phase item' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '# QA Failed 1' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[done] old defect' }] },
  ]};
  assert.deepStrictEqual(currentRoundItems(adf, 'In QA'), []);
});

// ---------------------------------------------------------------------------
// Task 5: stampQaHeader + appendReworkBlock
// ---------------------------------------------------------------------------
test('stampQaHeader renames unstamped defect headers to QA Failed N and returns items', () => {
  const adf = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] phase item' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '# Defects' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] boom' }] },
  ]};
  const { adf: out, itemTexts } = stampQaHeader(adf, 'In QA', 2);
  const headers = out.content.map((n) => n.content[0].text).filter((t) => t.startsWith('#'));
  assert.ok(headers.includes('# QA Failed 2'));
  assert.ok(headers.includes('# In QA'));
  assert.deepStrictEqual(itemTexts, ['boom']);
});

test('appendReworkBlock adds a QA Rework N block with all-open items, preserving existing content', () => {
  const dev = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# Development' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[done] Unit tests written' }] },
  ]};
  const out = appendReworkBlock(dev, 2, ['boom', 'crash']);
  const texts = out.content.map((n) => n.content[0].text);
  assert.deepStrictEqual(texts, ['# Development', '[done] Unit tests written', '# QA Rework 2', '[open] boom', '[open] crash']);
});

// ---------------------------------------------------------------------------
// Task 6: reworkRoundComplete
// ---------------------------------------------------------------------------
test('reworkRoundComplete true only when all items in the QA Rework N block are done', () => {
  const mk = (states) => ({ type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# QA Rework 1' }] },
    ...states.map((s) => ({ type: 'paragraph', content: [{ type: 'text', text: `[${s}] item` }] })),
  ]});
  assert.strictEqual(reworkRoundComplete(mk(['done', 'done']), 1), true);
  assert.strictEqual(reworkRoundComplete(mk(['done', 'open']), 1), false);
  assert.strictEqual(reworkRoundComplete(mk([]), 1), false);
  assert.strictEqual(reworkRoundComplete(mk(['done']), 2), false); // wrong round
});

// ---------------------------------------------------------------------------
// Spike-fix: Gebsun (Checklist for Jira Pro) orderedList/bulletList form
// ---------------------------------------------------------------------------

// Helper: build the confirmed-live Gebsun cf10051 structure.
// orderedList → header name (plain text, no "# ")
// bulletList  → items as "[state] text"
function gebsunDoc(...sections) {
  // sections = [{header, items:[{state,text}]}]
  const content = [];
  for (const { header, items } of sections) {
    content.push({
      type: 'orderedList',
      attrs: { order: 1 },
      content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: header }] }] }],
    });
    content.push({
      type: 'bulletList',
      content: items.map(({ state, text }) => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: `[${state}] ${text}` }] }],
      })),
    });
  }
  return { type: 'doc', version: 1, content };
}

test('parseBlocks on Gebsun orderedList/bulletList form returns 2 blocks with correct headers and items', () => {
  // Exact structure from the spike (confirmed live)
  const adf = { type: 'doc', version: 1, content: [
    { type: 'orderedList', attrs: { order: 1 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] }] }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '[open] Alpha item one' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '[open] Alpha item two' }] }] },
    ]},
    { type: 'orderedList', attrs: { order: 1 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bravo' }] }] }] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '[done] Bravo item one' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '[open] Bravo item two' }] }] },
    ]},
  ]};

  const blocks = parseBlocks(adf);
  assert.strictEqual(blocks.length, 2, 'should have 2 blocks');
  assert.strictEqual(blocks[0].header, 'Alpha');
  assert.deepStrictEqual(blocks[0].items.map((i) => i.text), ['Alpha item one', 'Alpha item two']);
  assert.strictEqual(blocks[0].items[0].done, false);
  assert.strictEqual(blocks[0].items[1].done, false);
  assert.strictEqual(blocks[1].header, 'Bravo');
  assert.deepStrictEqual(blocks[1].items.map((i) => i.text), ['Bravo item one', 'Bravo item two']);
  assert.strictEqual(blocks[1].items[0].done, true,  'Bravo item one should be done');
  assert.strictEqual(blocks[1].items[1].done, false, 'Bravo item two should be open');
});

test('currentRoundItems on Gebsun-form doc excludes phase block and stamped blocks', () => {
  // phase = "In QA" as orderedList, then a stamped "QA Failed 1" orderedList, then "Defects" orderedList
  const adf = gebsunDoc(
    { header: 'In QA',      items: [{ state: 'done', text: 'phase item' }] },
    { header: 'QA Failed 1', items: [{ state: 'open', text: 'old defect' }] },
    { header: 'Defects',    items: [{ state: 'open', text: 'new defect A' }, { state: 'open', text: 'new defect B' }] },
  );
  assert.deepStrictEqual(currentRoundItems(adf, 'In QA'), ['new defect A', 'new defect B']);
});

test('reworkRoundComplete on Gebsun-form doc with all-done items returns true', () => {
  const allDone = gebsunDoc({ header: 'QA Rework 1', items: [{ state: 'done', text: 'fix A' }, { state: 'done', text: 'fix B' }] });
  assert.strictEqual(reworkRoundComplete(allDone, 1), true);
});

test('reworkRoundComplete on Gebsun-form doc with one open item returns false', () => {
  const oneOpen = gebsunDoc({ header: 'QA Rework 1', items: [{ state: 'done', text: 'fix A' }, { state: 'open', text: 'fix B' }] });
  assert.strictEqual(reworkRoundComplete(oneOpen, 1), false);
});

test('stampQaHeader on Gebsun-form doc renames Defects orderedList header to QA Failed 2', () => {
  const adf = gebsunDoc(
    { header: 'In QA',   items: [{ state: 'done', text: 'phase item' }] },
    { header: 'Defects', items: [{ state: 'open', text: 'boom' }] },
  );
  const { adf: out, itemTexts } = stampQaHeader(adf, 'In QA', 2);

  // The second top-level node (index 2 = orderedList for "Defects") should now say "QA Failed 2"
  const defectsOrderedList = out.content[2]; // index: 0=orderedList(In QA), 1=bulletList, 2=orderedList(Defects)
  assert.strictEqual(defectsOrderedList.type, 'orderedList');
  // Navigate: orderedList → listItem → paragraph → text node
  const textNode = defectsOrderedList.content[0].content[0].content[0];
  assert.strictEqual(textNode.type, 'text');
  assert.strictEqual(textNode.text, 'QA Failed 2', 'header text node should be renamed to QA Failed 2');

  // The phase orderedList (index 0) must be untouched
  const phaseTextNode = out.content[0].content[0].content[0].content[0];
  assert.strictEqual(phaseTextNode.text, 'In QA', 'phase header must not be renamed');

  // itemTexts must contain the defect items
  assert.deepStrictEqual(itemTexts, ['boom']);
});

// ---------------------------------------------------------------------------
// Regression: bulletList listItem with multiple text nodes (inline formatting)
// ---------------------------------------------------------------------------

test('parseBlocks bulletList item with multiple text nodes (bold inline) concatenates full text', () => {
  // Simulates a listItem whose paragraph contains THREE text nodes due to inline bold formatting:
  //   text:"[open] Save " + text:"button" (bold mark) + text:" 500s"
  // The defect text must be "Save button 500s", not just "Save " (truncated first fragment).
  const adf = {
    type: 'doc', version: 1,
    content: [
      {
        type: 'orderedList', attrs: { order: 1 },
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Defects' }] }] }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{
              type: 'paragraph',
              content: [
                { type: 'text', text: '[open] Save ' },
                { type: 'text', text: 'button', marks: [{ type: 'strong' }] },
                { type: 'text', text: ' 500s' },
              ],
            }],
          },
        ],
      },
    ],
  };

  const blocks = parseBlocks(adf);
  assert.strictEqual(blocks.length, 1, 'should have 1 block');
  assert.strictEqual(blocks[0].header, 'Defects');
  assert.strictEqual(blocks[0].items.length, 1, 'should have 1 item');
  assert.strictEqual(blocks[0].items[0].text, 'Save button 500s',
    'item text must be full concatenation of all text nodes, not just the first fragment');
  assert.strictEqual(blocks[0].items[0].done, false);
});

test('parseBlocks orderedList header with multiple text nodes concatenates full header text', () => {
  // Simulates an orderedList header whose listItem paragraph has TWO text nodes
  // (e.g. the header text was partly bolded in the source):
  //   text:"Unit " + text:"Tests" (bold mark)
  // The header must be "Unit Tests", not just "Unit ".
  const adf = {
    type: 'doc', version: 1,
    content: [
      {
        type: 'orderedList', attrs: { order: 1 },
        content: [{
          type: 'listItem',
          content: [{
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Unit ' },
              { type: 'text', text: 'Tests', marks: [{ type: 'strong' }] },
            ],
          }],
        }],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '[done] test passes' }] }],
          },
        ],
      },
    ],
  };

  const blocks = parseBlocks(adf);
  assert.strictEqual(blocks.length, 1, 'should have 1 block');
  assert.strictEqual(blocks[0].header, 'Unit Tests',
    'header must be full concatenation of all text nodes in the orderedList listItem');
  assert.strictEqual(blocks[0].items[0].text, 'test passes');
});
