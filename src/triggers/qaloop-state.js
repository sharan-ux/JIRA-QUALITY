// src/triggers/qaloop-state.js — pure state logic over an injected kvs (CommonJS).
// The kvs parameter must be an object with async get(key) / set(key, val).
// In production: pass require('@forge/kvs').kvs. In tests: pass a Map-backed fake.

const key = (epicKey) => `qaloop:${epicKey}`;

async function loadState(kvs, epicKey) {
  return (await kvs.get(key(epicKey))) || { round: 0, phase: 'idle', qaStoryKey: null, devStoryKey: null };
}

async function beginRound(kvs, epicKey, { qaStoryKey, devStoryKey }) {
  const st = await loadState(kvs, epicKey);
  if (st.phase === 'failed-copied') return null; // already in an open round — duplicate event
  const next = { round: st.round + 1, phase: 'failed-copied', qaStoryKey, devStoryKey };
  await kvs.set(key(epicKey), next);
  return next.round;
}

async function completeRound(kvs, epicKey) {
  const st = await loadState(kvs, epicKey);
  if (st.phase !== 'failed-copied') return false; // already done / not open
  await kvs.set(key(epicKey), { ...st, phase: 'rework-done' });
  return true;
}

async function resolve(kvs, epicKey) {
  const st = await loadState(kvs, epicKey);
  await kvs.set(key(epicKey), { ...st, phase: 'resolved' });
}

module.exports = { key, loadState, beginRound, completeRound, resolve };
