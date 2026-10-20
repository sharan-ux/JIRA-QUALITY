// test/qaloop-jira.test.js — unit tests for pure helpers in qaloop-jira.js
// Only pickTransitionId and mentionCommentAdf are pure and unit-testable.
// I/O functions (getContext, transitionTo, etc.) require a live Forge runtime and
// are tested in the Task 13 staging end-to-end run.
const { test } = require('node:test');
const assert = require('node:assert');
const { pickTransitionId, mentionCommentAdf } = require('../src/triggers/qaloop-jira');

test('pickTransitionId matches target status case-insensitively', () => {
  const tr = { transitions: [{ id: '31', to: { name: 'In Progress' } }, { id: '91', to: { name: 'QA Rework' } }] };
  assert.strictEqual(pickTransitionId(tr, 'qa rework'), '91');
  assert.strictEqual(pickTransitionId(tr, 'Ready for QA'), null);
});

test('mentionCommentAdf includes a mention node, or omits it when accountId is null', () => {
  const withM = mentionCommentAdf('acc-1', 'Danish', 'QA Failed round 2 — 1 item', ['boom']);
  const firstPara = withM.content[0].content;
  assert.strictEqual(firstPara[0].type, 'mention');
  assert.strictEqual(firstPara[0].attrs.id, 'acc-1');
  const noM = mentionCommentAdf(null, null, 'QA Failed round 2', ['boom']);
  assert.ok(!JSON.stringify(noM).includes('"type":"mention"'));
  assert.ok(JSON.stringify(noM).includes('assignee unset'));
});

test('mentionCommentAdf bulletList has one listItem per input item and each item text appears', () => {
  const items = ['boom', 'crash'];
  const adf = mentionCommentAdf('acc-2', 'Dev', 'QA Rework 1 — 2 items', items);

  // Second top-level node must be a bulletList.
  const bulletList = adf.content[1];
  assert.strictEqual(bulletList.type, 'bulletList');

  // One listItem per input item.
  assert.strictEqual(bulletList.content.length, items.length);

  // Each listItem type must be 'listItem'.
  for (const li of bulletList.content) {
    assert.strictEqual(li.type, 'listItem');
  }

  // Each input string must appear somewhere inside the bulletList content.
  const serialised = JSON.stringify(bulletList);
  for (const item of items) {
    assert.ok(serialised.includes(item), `expected "${item}" to appear in bulletList`);
  }
});
