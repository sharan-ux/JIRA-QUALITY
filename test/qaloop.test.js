// test/qaloop.test.js — unit tests for the QA rework loop handlers + dispatch
const { test } = require('node:test');
const assert = require('node:assert');
const { handleQaFailed, handleReworkDone, _dispatch, payloadSaysIrrelevant } = require('../src/triggers/qaloop');

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const fakeKvs = () => {
  const m = new Map();
  return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};

function deps(overrides = {}) {
  const calls = { comments: [], transitions: [], puts: [] };
  const kvs = fakeKvs();
  return {
    calls, kvs,
    jira: {
      async comment(k, adf) { calls.comments.push({ k, adf }); return true; },
      async transitionTo(k, s) { calls.transitions.push({ k, s }); return true; },
      async putChecklist(k, adf) { calls.puts.push({ k, adf }); return true; },
      async findDevStory() { return 'OCW-DEV'; },
      async getContext(k) { return { key: k, adf: { type: 'doc', version: 1, content: [] }, assignee: null }; },
      ...(overrides.jira || {}),
    },
    ...(overrides.top || {}),
  };
}

// ---------------------------------------------------------------------------
// Task 9: handleQaFailed — no-defects guard
// ---------------------------------------------------------------------------
test('QA Failed with no defect items comments the QA story and does not touch dev', async () => {
  const d = deps();
  const ctx = {
    key: 'OCW-QA', epicKey: 'OCW-EPIC', status: 'QA Failed',
    phaseName: 'In QA',
    adf: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '[open] phase item' }] },
    ]},
  };
  await handleQaFailed(ctx, d);
  assert.strictEqual(d.calls.transitions.length, 0);
  assert.strictEqual(d.calls.comments.length, 1);
  assert.match(JSON.stringify(d.calls.comments[0].adf), /no defect items/i);
});

// ---------------------------------------------------------------------------
// Task 10: handleReworkDone — rework 100% done
// ---------------------------------------------------------------------------
test('rework 100% done transitions dev to Ready for QA, comments QA story, moves QA back to In QA', async () => {
  const d = deps({ jira: { async getContext(k) { return { key: k, assignee: { id: 'qa-1', name: 'Tester' } }; } } });
  // seed a round-1 open state
  await require('../src/triggers/qaloop-state').beginRound(d.kvs, 'OCW-EPIC', { qaStoryKey: 'OCW-QA', devStoryKey: 'OCW-DEV' });
  const ctx = {
    key: 'OCW-DEV', epicKey: 'OCW-EPIC', status: 'QA Rework',
    adf: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: '# QA Rework 1' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '[done] boom' }] },
    ]},
  };
  await handleReworkDone(ctx, d);
  assert.ok(d.calls.transitions.find((t) => t.k === 'OCW-DEV' && t.s === 'Ready for QA'));
  assert.ok(d.calls.transitions.find((t) => t.k === 'OCW-QA' && t.s === 'In QA'));
  assert.ok(d.calls.comments.find((c) => c.k === 'OCW-QA'));
});

// ---------------------------------------------------------------------------
// Task 11: _dispatch routes correctly
// ---------------------------------------------------------------------------
test('dispatch routes QA Failed on an in-qa story to the fail handler', async () => {
  let routed = null;
  const d = deps();
  await _dispatch(
    {
      projectKey: 'OCW', labels: ['qc-phase', 'phase-in-qa'], status: 'QA Failed',
      key: 'OCW-QA', epicKey: 'OCW-E',
      adf: { type: 'doc', version: 1, content: [
        { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '# Defects' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '[open] boom' }] },
      ]},
    },
    { ...d, fail: async () => { routed = 'fail'; }, done: async () => { routed = 'done'; } },
  );
  assert.strictEqual(routed, 'fail');
});

test('dispatch ignores non-OCW projects', async () => {
  let routed = null;
  const d = deps();
  await _dispatch(
    { projectKey: 'OTHER', labels: ['qc-phase', 'phase-in-qa'], status: 'QA Failed', key: 'OTHER-1', epicKey: 'OTHER-E', adf: { type: 'doc', version: 1, content: [] } },
    { ...d, fail: async () => { routed = 'fail'; }, done: async () => { routed = 'done'; } },
  );
  assert.strictEqual(routed, null);
});

test('dispatch ignores issues without qc-phase label', async () => {
  let routed = null;
  const d = deps();
  await _dispatch(
    { projectKey: 'OCW', labels: ['phase-in-qa'], status: 'QA Failed', key: 'OCW-1', epicKey: 'OCW-E', adf: { type: 'doc', version: 1, content: [] } },
    { ...d, fail: async () => { routed = 'fail'; }, done: async () => { routed = 'done'; } },
  );
  assert.strictEqual(routed, null);
});

// ---------------------------------------------------------------------------
// resolveOnPass — dispatch routing for QA Pass
// ---------------------------------------------------------------------------
test('dispatch QA Pass with active loop comments "closed after 1 round" and sets state to resolved', async () => {
  const d = deps();
  // Seed an active round so resolveOnPass does not short-circuit.
  await require('../src/triggers/qaloop-state').beginRound(d.kvs, 'OCW-EPIC', { qaStoryKey: 'OCW-QA', devStoryKey: 'OCW-DEV' });

  await _dispatch(
    { projectKey: 'OCW', labels: ['qc-phase', 'phase-in-qa'], status: 'QA Pass', key: 'OCW-QA', epicKey: 'OCW-EPIC', adf: { type: 'doc', version: 1, content: [] } },
    d,
  );

  // A comment must have been posted on OCW-QA.
  const qaComment = d.calls.comments.find((c) => c.k === 'OCW-QA');
  assert.ok(qaComment, 'expected a comment on OCW-QA');
  assert.match(JSON.stringify(qaComment.adf), /closed after 1 round/i);

  // State must now be resolved.
  const st = await require('../src/triggers/qaloop-state').loadState(d.kvs, 'OCW-EPIC');
  assert.strictEqual(st.phase, 'resolved');
});

test('dispatch QA Pass with NO active loop (idle) posts no comment', async () => {
  // Fresh deps — kvs is empty so state is idle (round 0).
  const d = deps();
  await _dispatch(
    { projectKey: 'OCW', labels: ['qc-phase', 'phase-in-qa'], status: 'QA Pass', key: 'OCW-QA', epicKey: 'OCW-EPIC', adf: { type: 'doc', version: 1, content: [] } },
    d,
  );
  assert.strictEqual(d.calls.comments.length, 0, 'resolveOnPass should not post when loop is idle');
});

// ---------------------------------------------------------------------------
// handleQaFailed — "no dev story found" branch
// ---------------------------------------------------------------------------
test('handleQaFailed posts "no Development phase-story" comment and does not transition when findDevStory returns null', async () => {
  const d = deps({ jira: { async findDevStory() { return null; } } });
  const ctx = {
    key: 'OCW-QA', epicKey: 'OCW-EPIC', status: 'QA Failed',
    phaseName: 'In QA',
    adf: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '# Defects' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '[open] real defect item' }] },
    ]},
  };
  await handleQaFailed(ctx, d);
  assert.strictEqual(d.calls.transitions.length, 0, 'no transitions when dev story is missing');
  const qaComment = d.calls.comments.find((c) => c.k === 'OCW-QA');
  assert.ok(qaComment, 'expected a comment on OCW-QA');
  assert.match(JSON.stringify(qaComment.adf), /no Development phase-story/i);
});

// ---------------------------------------------------------------------------
// handleReworkDone — idempotency guard
// ---------------------------------------------------------------------------
test('handleReworkDone is idempotent: second call adds no new transitions or comments', async () => {
  const d = deps({ jira: { async getContext(k) { return { key: k, assignee: { id: 'qa-1', name: 'Tester' } }; } } });
  // Seed an active round.
  await require('../src/triggers/qaloop-state').beginRound(d.kvs, 'OCW-EPIC', { qaStoryKey: 'OCW-QA', devStoryKey: 'OCW-DEV' });
  const ctx = {
    key: 'OCW-DEV', epicKey: 'OCW-EPIC', status: 'QA Rework',
    adf: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: '# QA Rework 1' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '[done] all items fixed' }] },
    ]},
  };

  // First call — should succeed.
  await handleReworkDone(ctx, d);
  const transitionsAfterFirst = d.calls.transitions.length;
  const commentsAfterFirst = d.calls.comments.length;
  assert.ok(transitionsAfterFirst > 0, 'first call must produce transitions');
  assert.ok(commentsAfterFirst > 0, 'first call must produce comments');

  // Second call — completeRound returns false (phase is now rework-done, not failed-copied).
  await handleReworkDone(ctx, d);
  assert.strictEqual(d.calls.transitions.length, transitionsAfterFirst, 'second call must not add new transitions');
  assert.strictEqual(d.calls.comments.length, commentsAfterFirst, 'second call must not add new comments');
});

// ---------------------------------------------------------------------------
// payloadSaysIrrelevant — pre-filter unit tests
// ---------------------------------------------------------------------------
test('payloadSaysIrrelevant returns true when project.key is non-OCW', () => {
  assert.strictEqual(
    payloadSaysIrrelevant({ issue: { key: 'ZB-1', fields: { project: { key: 'ZB' } } } }),
    true,
  );
});

test('payloadSaysIrrelevant returns true when labels present but missing qc-phase', () => {
  assert.strictEqual(
    payloadSaysIrrelevant({ issue: { key: 'OCW-1', fields: { project: { key: 'OCW' }, labels: ['bug'] } } }),
    true,
  );
});

test('payloadSaysIrrelevant returns false when event.issue.fields is undefined', () => {
  assert.strictEqual(
    payloadSaysIrrelevant({ issue: { key: 'OCW-1' } }),
    false,
  );
});

test('payloadSaysIrrelevant returns false when project.key is OCW and labels include qc-phase', () => {
  assert.strictEqual(
    payloadSaysIrrelevant({ issue: { key: 'OCW-1', fields: { project: { key: 'OCW' }, labels: ['qc-phase', 'phase-in-qa'] } } }),
    false,
  );
});

test('payloadSaysIrrelevant returns false when fields present but project and labels both missing', () => {
  assert.strictEqual(
    payloadSaysIrrelevant({ issue: { key: 'OCW-1', fields: {} } }),
    false,
  );
});
