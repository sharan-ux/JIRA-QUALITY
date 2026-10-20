// test/qaloop-state.test.js — unit tests for the round state machine
const { test } = require('node:test');
const assert = require('node:assert');
const { loadState, beginRound, completeRound } = require('../src/triggers/qaloop-state');

const fakeKvs = () => {
  const m = new Map();
  return { async get(k) { return m.get(k); }, async set(k, v) { m.set(k, v); } };
};

test('beginRound increments and is idempotent within a round', async () => {
  const kvs = fakeKvs();
  assert.strictEqual(await beginRound(kvs, 'OCW-1', { qaStoryKey: 'OCW-2', devStoryKey: 'OCW-3' }), 1);
  assert.strictEqual(await beginRound(kvs, 'OCW-1', { qaStoryKey: 'OCW-2', devStoryKey: 'OCW-3' }), null); // duplicate event
  const st = await loadState(kvs, 'OCW-1');
  assert.strictEqual(st.round, 1);
  assert.strictEqual(st.phase, 'failed-copied');
});

test('completeRound then a new beginRound advances to round 2', async () => {
  const kvs = fakeKvs();
  await beginRound(kvs, 'OCW-1', { qaStoryKey: 'OCW-2', devStoryKey: 'OCW-3' });
  assert.strictEqual(await completeRound(kvs, 'OCW-1'), true);
  assert.strictEqual(await completeRound(kvs, 'OCW-1'), false); // idempotent
  assert.strictEqual(await beginRound(kvs, 'OCW-1', { qaStoryKey: 'OCW-2', devStoryKey: 'OCW-3' }), 2);
});
