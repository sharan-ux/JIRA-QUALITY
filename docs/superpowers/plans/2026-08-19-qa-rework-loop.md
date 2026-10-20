# QA Rework Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a multi-round QA-failure rework loop in the Quality Check Tracker Forge app: when QA fails an OCW story, the defect checklist is copied to the developer's story as "QA Rework N", statuses and @mention comments drive the hand-off both ways, and the loop repeats until QA passes.

**Architecture:** All logic lives in the Forge app. A new trigger (`qc-qa-loop`) on `avi:jira:updated:issue` detects two events — an In-QA phase-story moving to `QA Failed`, and a Development phase-story's `QA Rework N` checklist hitting 100%. Round state is held in `storage:app` (via `@forge/kvs`) keyed per epic. The checklist copy is pure ADF manipulation of `cf10051`. The risky, branch-heavy logic (ADF parsing, block identification, round math, completion detection) is factored into a **pure module** `qaloop-adf.js` that is unit-tested with `node:test`; the thin Jira I/O lives in `qaloop.js`.

**Tech Stack:** Forge (`@forge/api`, `@forge/kvs`), Node 24 runtime, Jira Cloud REST v3, Gebsun "Checklist for Jira Pro" (`cf10051`), `node:test` for unit tests.

**Spec:** `C:\Project Codes\JIRA-DASHBOARD\launch-dashboard\docs\specs\2026-08-19-qa-rework-loop-design.md`

## Global Constraints

- **OCW project only.** Every trigger branch must early-return unless the issue's project key is `OCW`.
- **Never auto-commit.** The user commits manually. Where a step says "Commit", the executor **stages** the files (`git add …`) and STOPS for the user to review and commit. Do not run `git commit`.
- **No Jira writes without user approval.** Tasks that write to real Jira (the staging spike in Task 1, the end-to-end run in Task 13) must pause and get explicit user approval before executing against staging. Unit tests (Tasks 2–10) hit no live Jira.
- **Checklist field:** `cf10051` = `customfield_10051` (Gebsun editable "Checklist Text", ADF). Live items are stored as text lines matching `/^\s*(?:[*+-]\s*)?\[(state)\]\s*(text)$/` where state is `open`/`done` (some deployments use ` ` / `x`); a header line is `# Header`. The existing `markChecklistItem` in `resolvers/compliance.js` is the reference implementation for this format.
- **Do not disturb existing checklists.** The In-QA story already carries its seeded phase checklist (header = the phase name, e.g. `In QA`). The defect block QA adds is a **separate** block. Copy/stamp logic must never touch the phase checklist or any other block.
- **Idempotency.** Forge product triggers are at-least-once and async (seconds). Every state-changing handler must be guarded so a duplicate event cannot double-copy, double-comment, or double-transition.
- **Jira REST call pattern:** `api.asApp().requestJira(route\`…\`, init)` — copy the `jira()` helper style from `provision.js`.

---

### Task 0: Inspect OCW Story workflow scheme (gating investigation — no code)

**Files:** none (investigation + short note appended to the spec's §4).

This decides whether the 3 new statuses can be OCW-only. Read-only; safe to run without approval.

- [ ] **Step 1: Find the workflow scheme bound to OCW's Story issue type**

Run (Bash, token from User env):
```bash
JIRA_API_TOKEN="$(powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('JIRA_API_TOKEN','User')" | tr -d '\r')"
U="sharanzilmoney@gmail.com:$JIRA_API_TOKEN"
# project -> workflow scheme
curl -s -u "$U" "https://zilmoney.atlassian.net/rest/api/3/workflowscheme/project?projectId=$(curl -s -u "$U" 'https://zilmoney.atlassian.net/rest/api/3/project/OCW' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(String(JSON.parse(d).id)))")" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(d))"
```

- [ ] **Step 2: List every project using that same workflow scheme**

Enumerate projects and their scheme; flag whether the OCW Story workflow is shared. Record the result.

- [ ] **Step 3: Write the finding + config recommendation into the spec**

Append to spec §4 a short block: scheme name, shared? (yes/no), and the concrete admin action — the 3 statuses (`QA Failed` = To-Do/red, `QA Rework` + `Ready for QA` = In-Progress) and the transitions (`In QA → QA Failed`, `QA Failed → In QA`, global `→ QA Rework`, `QA Rework → Ready for QA`). **STOP and report to the user** — the workflow edit is a Jira-admin action requiring approval; it is not performed by this plan.

- [ ] **Step 4: Commit (stage + hand off)**

```bash
git add docs/specs/2026-08-19-qa-rework-loop-design.md
# STOP — user reviews and commits manually
```

---

### Task 1: Gebsun multi-checklist + token-format spike (staging — REQUIRES APPROVAL)

**Files:** none kept (throwaway staging story). Output = a recorded finding that validates the data model.

**Why:** The whole copy design assumes one `cf10051` field can hold **multiple named checklists** (repeated `# header` + items) and that Gebsun renders them as distinct checklists, and it assumes the live token format. Both must be confirmed before building parse/copy code, or the module is built on sand.

- [ ] **Step 1: Get approval + a throwaway staging Story**

Ask the user for approval to write to a scratch OCW Story on staging (or create one). State the key you'll use.

- [ ] **Step 2: Write two named checklists into `cf10051`**

PUT an ADF doc with two blocks (`# Alpha` + 2 items, `# Bravo` + 2 items) using the `checklistAdf`-style paragraph format, then GET the story and read back `cf10051` **and** the rendered `cf10097`.

- [ ] **Step 3: Record the findings**

Confirm/deny: (a) Gebsun shows **two** separate checklists; (b) how a header is stored in `cf10051` after Gebsun processes it (plain `# Alpha` paragraph vs heading node vs orderedList); (c) the exact item token (`[open]` vs `[ ]`). Write the answers into a `## Spike findings` note at the bottom of the plan. If Gebsun collapses to a single checklist, **stop and escalate** — the design's "named blocks in one field" model needs revisiting (fallback: one appended block with a bold `QA Rework N —` prefix line per item).

- [ ] **Step 4: Delete the scratch data / story; no commit (findings recorded in the plan file)**

```bash
git add docs/superpowers/plans/2026-08-19-qa-rework-loop.md
# STOP — user commits
```

---

### Task 2: Test harness + pure module skeleton

**Files:**
- Create: `src/triggers/qaloop-adf.js`
- Create: `test/qaloop-adf.test.js`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces: `export function textLines(adf): {text, node}[]` — flattens an ADF doc to the ordered list of text-bearing nodes (so later functions operate on lines, mirroring how `markChecklistItem` walks nodes).

- [ ] **Step 1: Add the test script to `package.json`**

Add to `"scripts"`: `"test": "node --test"`.

- [ ] **Step 2: Write the failing test**

```javascript
// test/qaloop-adf.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { textLines } = require('../src/triggers/qaloop-adf');

test('textLines flattens ADF to ordered text nodes', () => {
  const adf = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] first item' }] },
  ]};
  const lines = textLines(adf).map((l) => l.text);
  assert.deepStrictEqual(lines, ['# In QA', '[open] first item']);
});
```

- [ ] **Step 3: Run it, verify it fails**

Run: `npm test`
Expected: FAIL — `textLines is not a function` / module not found.

- [ ] **Step 4: Implement `textLines`**

```javascript
// src/triggers/qaloop-adf.js
// Pure ADF helpers for the QA rework loop. No Forge/Jira imports — unit-testable.
// CommonJS so `node --test` runs it directly without a build step.

function textLines(adf) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'text' && typeof node.text === 'string') out.push({ text: node.text, node });
    if (node.content) walk(node.content);
  };
  walk(adf && adf.content);
  return out;
}

module.exports = { textLines };
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit (stage + hand off)**

```bash
git add package.json src/triggers/qaloop-adf.js test/qaloop-adf.test.js
# STOP — user commits
```

---

### Task 3: Parse `cf10051` into checklist blocks

**Files:**
- Modify: `src/triggers/qaloop-adf.js`
- Modify: `test/qaloop-adf.test.js`

**Interfaces:**
- Consumes: `textLines`.
- Produces: `export function parseBlocks(adf): Block[]` where `Block = { header: string, items: {text: string, done: boolean, node: object}[] }`. A line matching `/^#\s+(.+)$/` opens a new block (header = capture, trimmed). A line matching `ITEM_RE = /^\s*(?:[*+-]\s*)?\[([^\]]*)\]\s*(.*)$/` is an item of the current block; `done` = state trimmed-lowercase is `done` or `x`; `text` = the item text with any ` · 📝 …` note suffix stripped. Lines before the first header, and non-matching lines, are ignored.

- [ ] **Step 1: Write failing tests**

```javascript
test('parseBlocks splits headers and items, reads done state', () => {
  const { parseBlocks } = require('../src/triggers/qaloop-adf');
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
```

- [ ] **Step 2: Run, verify fail** — Run: `npm test` — Expected: FAIL (`parseBlocks` undefined).

- [ ] **Step 3: Implement `parseBlocks`**

```javascript
const HEADER_RE = /^#\s+(.+)$/;
const ITEM_RE = /^\s*(?:[*+-]\s*)?\[([^\]]*)\]\s*(.*)$/;
const NOTE_SEP = ' · 📝 ';
const ZWSP = /​/g;

function parseBlocks(adf) {
  const blocks = [];
  let cur = null;
  for (const { text, node } of textLines(adf)) {
    const clean = text.replace(ZWSP, '');
    const h = clean.match(HEADER_RE);
    if (h) { cur = { header: h[1].trim(), items: [] }; blocks.push(cur); continue; }
    const m = clean.match(ITEM_RE);
    if (m && cur) {
      const state = m[1].trim().toLowerCase();
      cur.items.push({ text: m[2].split(NOTE_SEP)[0].trim(), done: state === 'done' || state === 'x', node });
    }
  }
  return blocks;
}

module.exports = { textLines, parseBlocks };
```

- [ ] **Step 4: Run, verify pass** — Run: `npm test` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/triggers/qaloop-adf.js test/qaloop-adf.test.js` — STOP, user commits.

---

### Task 4: Identify the current-round defect block; round stamping

**Files:**
- Modify: `src/triggers/qaloop-adf.js`
- Modify: `test/qaloop-adf.test.js`

**Interfaces:**
- Consumes: `parseBlocks`.
- Produces:
  - `export const STAMP_RE = /^QA Failed (\d+)$/i;`
  - `export function currentRoundItems(adf, phaseName): string[]` — from all blocks, drop the phase block (`header === phaseName`) and drop already-stamped blocks (`STAMP_RE`); return the merged, de-duplicated item texts of the remaining (unstamped defect) blocks. Empty array if none.
  - `export function priorRounds(adf): number` — the highest N among headers matching `STAMP_RE` on this doc (0 if none).

- [ ] **Step 1: Write failing tests**

```javascript
test('currentRoundItems excludes phase block and stamped blocks, merges the rest', () => {
  const { currentRoundItems, priorRounds } = require('../src/triggers/qaloop-adf');
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
  const { currentRoundItems } = require('../src/triggers/qaloop-adf');
  const adf = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[open] phase item' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '# QA Failed 1' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[done] old defect' }] },
  ]};
  assert.deepStrictEqual(currentRoundItems(adf, 'In QA'), []);
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` — Expected FAIL.

- [ ] **Step 3: Implement**

```javascript
const STAMP_RE = /^QA Failed (\d+)$/i;

function currentRoundItems(adf, phaseName) {
  const seen = new Set(); const out = [];
  for (const b of parseBlocks(adf)) {
    if (b.header === phaseName || STAMP_RE.test(b.header)) continue;
    for (const it of b.items) { if (!seen.has(it.text)) { seen.add(it.text); out.push(it.text); } }
  }
  return out;
}

function priorRounds(adf) {
  let max = 0;
  for (const b of parseBlocks(adf)) { const m = b.header.match(STAMP_RE); if (m) max = Math.max(max, +m[1]); }
  return max;
}

module.exports = { textLines, parseBlocks, STAMP_RE, currentRoundItems, priorRounds };
```

- [ ] **Step 4: Run, verify pass** — `npm test` — Expected PASS.

- [ ] **Step 5: Commit** — `git add src/triggers/qaloop-adf.js test/qaloop-adf.test.js` — STOP.

---

### Task 5: Build blocks — stamp the QA header, build the QA-Rework block, append

**Files:**
- Modify: `src/triggers/qaloop-adf.js`
- Modify: `test/qaloop-adf.test.js`

**Interfaces:**
- Produces:
  - `export function blockParagraphs(header, items): object[]` — ADF paragraph nodes: `# header`, then one `[open] text` line per item (mirrors `checklistAdf`'s paragraph style so Gebsun parses it).
  - `export function stampQaHeader(adf, phaseName, round): {adf, itemTexts}` — returns a **new** ADF where each unstamped defect block header (not the phase, not already stamped) is renamed to `QA Failed <round>`; `itemTexts` = the merged current-round items. Non-defect blocks and all item nodes are left byte-for-byte unchanged.
  - `export function appendReworkBlock(devAdf, round, itemTexts): object` — returns a new dev ADF with `blockParagraphs('QA Rework <round>', itemTexts)` appended to `content`.

- [ ] **Step 1: Write failing tests**

```javascript
test('stampQaHeader renames unstamped defect headers to QA Failed N and returns items', () => {
  const { stampQaHeader } = require('../src/triggers/qaloop-adf');
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
  const { appendReworkBlock } = require('../src/triggers/qaloop-adf');
  const dev = { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# Development' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[done] Unit tests written' }] },
  ]};
  const out = appendReworkBlock(dev, 2, ['boom', 'crash']);
  const texts = out.content.map((n) => n.content[0].text);
  assert.deepStrictEqual(texts, ['# Development', '[done] Unit tests written', '# QA Rework 2', '[open] boom', '[open] crash']);
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` — Expected FAIL.

- [ ] **Step 3: Implement**

```javascript
function blockParagraphs(header, items) {
  return [`# ${header}`, ...items.map((t) => `[open] ${t}`)]
    .map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }));
}

function stampQaHeader(adf, phaseName, round) {
  const clone = JSON.parse(JSON.stringify(adf));
  const itemTexts = currentRoundItems(adf, phaseName);
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (node.type === 'text' && typeof node.text === 'string') {
      const m = node.text.replace(ZWSP, '').match(HEADER_RE);
      if (m) { const h = m[1].trim(); if (h !== phaseName && !STAMP_RE.test(h)) node.text = `# QA Failed ${round}`; }
    }
    if (node.content) walk(node.content);
  };
  walk(clone.content);
  return { adf: clone, itemTexts };
}

function appendReworkBlock(devAdf, round, itemTexts) {
  const clone = JSON.parse(JSON.stringify(devAdf));
  clone.content = (clone.content || []).concat(blockParagraphs(`QA Rework ${round}`, itemTexts));
  return clone;
}

module.exports = { textLines, parseBlocks, STAMP_RE, currentRoundItems, priorRounds, blockParagraphs, stampQaHeader, appendReworkBlock };
```

- [ ] **Step 4: Run, verify pass** — `npm test` — Expected PASS.

- [ ] **Step 5: Commit** — STOP.

---

### Task 6: Detect a QA-Rework round completion (100% ticked)

**Files:**
- Modify: `src/triggers/qaloop-adf.js`
- Modify: `test/qaloop-adf.test.js`

**Interfaces:**
- Produces: `export function reworkRoundComplete(devAdf, round): boolean` — true iff a `QA Rework <round>` block exists, has ≥1 item, and every item's `done` is true.

- [ ] **Step 1: Write failing tests**

```javascript
test('reworkRoundComplete true only when all items in the QA Rework N block are done', () => {
  const { reworkRoundComplete } = require('../src/triggers/qaloop-adf');
  const mk = (states) => ({ type: 'doc', version: 1, content: [
    { type: 'paragraph', content: [{ type: 'text', text: '# QA Rework 1' }] },
    ...states.map((s) => ({ type: 'paragraph', content: [{ type: 'text', text: `[${s}] item` }] })),
  ]});
  assert.strictEqual(reworkRoundComplete(mk(['done', 'done']), 1), true);
  assert.strictEqual(reworkRoundComplete(mk(['done', 'open']), 1), false);
  assert.strictEqual(reworkRoundComplete(mk([]), 1), false);
  assert.strictEqual(reworkRoundComplete(mk(['done']), 2), false); // wrong round
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` — Expected FAIL.

- [ ] **Step 3: Implement**

```javascript
function reworkRoundComplete(devAdf, round) {
  const block = parseBlocks(devAdf).find((b) => b.header.match(STAMP_RE) === null && b.header === `QA Rework ${round}`);
  if (!block || block.items.length === 0) return false;
  return block.items.every((i) => i.done);
}
// export it in module.exports
```
(Add `reworkRoundComplete` to `module.exports`.)

- [ ] **Step 4: Run, verify pass** — `npm test` — Expected PASS.

- [ ] **Step 5: Commit** — STOP.

---

### Task 7: Round state machine in `storage:app`

**Files:**
- Create: `src/triggers/qaloop-state.js`
- Create: `test/qaloop-state.test.js`

**Interfaces:**
- Consumes: an injected key-value store `kvs` with async `get(key)`/`set(key,val)` (real: `@forge/kvs`; test: an in-memory fake) — injected so the logic is testable without Forge.
- Produces:
  - `key(epicKey) => 'qaloop:' + epicKey`
  - `async loadState(kvs, epicKey) => {round, phase, qaStoryKey, devStoryKey}` (defaults `{round:0, phase:'idle'}`)
  - `async beginRound(kvs, epicKey, {qaStoryKey, devStoryKey}) => number | null` — increments round to N, sets `phase:'failed-copied'`; returns N. Returns `null` if `phase` is already `failed-copied` for the current round (idempotent guard: a re-fired QA-Failed event won't start a second round).
  - `async completeRound(kvs, epicKey) => boolean` — sets `phase:'rework-done'`; returns false if already `rework-done` (idempotent).
  - `async resolve(kvs, epicKey) => void` — sets `phase:'resolved'`.

- [ ] **Step 1: Write failing tests**

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { loadState, beginRound, completeRound } = require('../src/triggers/qaloop-state');
const fakeKvs = () => { const m = new Map(); return { async get(k){return m.get(k);}, async set(k,v){m.set(k,v);} }; };

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
```

- [ ] **Step 2: Run, verify fail** — `npm test` — Expected FAIL.

- [ ] **Step 3: Implement**

```javascript
// src/triggers/qaloop-state.js — pure state logic over an injected kvs (CommonJS).
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
```

- [ ] **Step 4: Run, verify pass** — `npm test` — Expected PASS.

- [ ] **Step 5: Commit** — STOP.

---

### Task 8: Jira I/O helpers (+ pure-bit tests)

**Files:**
- Create: `src/triggers/qaloop-jira.js`
- Create: `test/qaloop-jira.test.js`

**Interfaces:**
- Produces (pure, tested):
  - `export function pickTransitionId(transitions, statusName): string | null` — from a `/transitions` payload's `transitions[]`, the id whose `to.name` equals `statusName` (case-insensitive), else null.
  - `export function mentionCommentAdf(accountId, displayName, heading, items): object` — an ADF comment: a paragraph with a `mention` node (`{type:'mention', attrs:{id:accountId, text:'@'+displayName}}`) then the heading text, then a `bulletList` of the items. If `accountId` is null, omit the mention node and append " (assignee unset)" to the heading.
- Produces (I/O, thin — exercised in Task 13, not unit-tested):
  - `async function getContext(issueKey)` → `{key, projectKey, issuetype, labels, status, assignee, epicKey, adf}` (reads `project,issuetype,labels,status,assignee,parent,customfield_10051`).
  - `async function transitionTo(issueKey, statusName)` → boolean (GET transitions → `pickTransitionId` → POST).
  - `async function putChecklist(issueKey, adf)` → boolean (PUT `customfield_10051`).
  - `async function comment(issueKey, adf)` → boolean.
  - `async function epicTrack(epicKey)` → `'feature' | 'bug' | null` (from the epic's labels).

- [ ] **Step 1: Write failing tests (pure bits only)**

```javascript
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
```

- [ ] **Step 2: Run, verify fail** — `npm test` — Expected FAIL.

- [ ] **Step 3: Implement `qaloop-jira.js`**

```javascript
const api = require('@forge/api');
const { route } = api;
const jira = (url, init) => api.default.asApp().requestJira(url, init);
const CF = 'customfield_10051';

function pickTransitionId(payload, statusName) {
  const want = String(statusName).toLowerCase();
  const t = (payload.transitions || []).find((x) => x.to && x.to.name && x.to.name.toLowerCase() === want);
  return t ? t.id : null;
}

function mentionCommentAdf(accountId, displayName, heading, items) {
  const head = accountId
    ? [{ type: 'mention', attrs: { id: accountId, text: '@' + (displayName || 'user') } }, { type: 'text', text: '  ' + heading }]
    : [{ type: 'text', text: heading + ' (assignee unset)' }];
  return { type: 'doc', version: 1, content: [
    { type: 'paragraph', content: head },
    { type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })) },
  ] };
}

async function getContext(issueKey) {
  const r = await jira(route`/rest/api/3/issue/${issueKey}?fields=project,issuetype,labels,status,assignee,parent,${CF}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  const f = (await r.json()).fields || {};
  return {
    key: issueKey, projectKey: f.project && f.project.key, issuetype: f.issuetype && f.issuetype.name,
    labels: f.labels || [], status: f.status && f.status.name,
    assignee: f.assignee ? { id: f.assignee.accountId, name: f.assignee.displayName } : null,
    epicKey: f.parent && f.parent.key, adf: f[CF],
  };
}
async function transitionTo(issueKey, statusName) {
  const g = await jira(route`/rest/api/3/issue/${issueKey}/transitions`, { headers: { Accept: 'application/json' } });
  if (!g.ok) return false;
  const id = pickTransitionId(await g.json(), statusName);
  if (!id) { console.error('qaloop: no transition to', statusName, 'from', issueKey); return false; }
  const p = await jira(route`/rest/api/3/issue/${issueKey}/transitions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition: { id } }) });
  return p.status === 204;
}
async function putChecklist(issueKey, adf) {
  const r = await jira(route`/rest/api/3/issue/${issueKey}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { [CF]: adf } }) });
  return r.ok;
}
async function comment(issueKey, adf) {
  const r = await jira(route`/rest/api/3/issue/${issueKey}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: adf }) });
  return r.ok;
}
async function epicTrack(epicKey) {
  const r = await jira(route`/rest/api/3/issue/${epicKey}?fields=labels`, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  const labels = ((await r.json()).fields.labels || []).map((l) => l.toLowerCase());
  return labels.includes('feature') ? 'feature' : labels.includes('bug') ? 'bug' : null;
}
module.exports = { pickTransitionId, mentionCommentAdf, getContext, transitionTo, putChecklist, comment, epicTrack };
```

> Note: `@forge/api`'s default export exposes `asApp()`; adjust the `api.default`/`api` access to match the installed version's ESM/CJS interop if `npm test` (which doesn't load this file) is unaffected but the Forge bundler complains. The other tasks import only the pure exports.

- [ ] **Step 4: Run, verify pass** — `npm test` — Expected PASS (only the two pure tests run).

- [ ] **Step 5: Commit** — STOP.

---

### Task 9: Fail handler

**Files:**
- Create: `src/triggers/qaloop.js`
- Modify: `test/qaloop.test.js` (create)

**Interfaces:**
- Consumes: everything above.
- Produces: `async function handleQaFailed(ctx, deps)` where `ctx` = In-QA story context (from `getContext`) and `deps = {kvs, jira, adf, state}` are the four modules (injected for testability). Steps: resolve dev story key (the epic's Development/In-Progress phase-story) → `beginRound` (bail if null) → `currentRoundItems`; if empty, comment the QA story "no defect items for round N" and bail → `stampQaHeader` + `putChecklist`(QA) → `appendReworkBlock` + `putChecklist`(dev) → `transitionTo(dev,'QA Rework')` → `comment(dev, mention dev-assignee)`.
- Produces: `async function findDevStory(epicKey, track, deps): string | null` — searches `parent = epicKey AND labels = qc-phase AND labels = phase-development` (feature) or `phase-in-progress` (bug); returns the story key.

- [ ] **Step 1: Write a failing test for the empty-defects guard (pure-ish via injected deps)**

```javascript
const { test } = require('node:test');
const assert = require('node:assert');
const { handleQaFailed } = require('../src/triggers/qaloop');

function deps(overrides = {}) {
  const calls = { comments: [], transitions: [], puts: [] };
  const kvs = (() => { const m = new Map(); return { async get(k){return m.get(k);}, async set(k,v){m.set(k,v);} }; })();
  return { calls, kvs,
    jira: {
      async comment(k, adf){ calls.comments.push({ k, adf }); return true; },
      async transitionTo(k, s){ calls.transitions.push({ k, s }); return true; },
      async putChecklist(k, adf){ calls.puts.push({ k, adf }); return true; },
      async findDevStory(){ return 'OCW-DEV'; },
      ...overrides.jira },
  };
}

test('QA Failed with no defect items comments the QA story and does not touch dev', async () => {
  const d = deps();
  const ctx = { key: 'OCW-QA', epicKey: 'OCW-EPIC', status: 'QA Failed',
    adf: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: '# In QA' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '[open] phase item' }] },
    ]}, phaseName: 'In QA' };
  await handleQaFailed(ctx, d);
  assert.strictEqual(d.calls.transitions.length, 0);
  assert.strictEqual(d.calls.comments.length, 1);
  assert.match(JSON.stringify(d.calls.comments[0].adf), /no defect items/i);
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` — Expected FAIL.

- [ ] **Step 3: Implement `handleQaFailed`** (using the pure ADF + state modules; `phaseName` comes from the In-QA phase — `'In QA'`).

```javascript
const adfLib = require('./qaloop-adf');
const stateLib = require('./qaloop-state');

async function handleQaFailed(ctx, deps) {
  const { kvs, jira } = deps;
  const items = adfLib.currentRoundItems(ctx.adf, ctx.phaseName);
  if (items.length === 0) {
    await jira.comment(ctx.key, adfLib_mentionless('No defect items found for this QA Failed — add a checklist of defects, then set QA Failed again.'));
    return;
  }
  const devKey = await jira.findDevStory(ctx.epicKey);
  if (!devKey) { await jira.comment(ctx.key, adfLib_mentionless('QA rework loop: no Development phase-story found under this epic.')); return; }
  const round = await stateLib.beginRound(kvs, ctx.epicKey, { qaStoryKey: ctx.key, devStoryKey: devKey });
  if (round === null) return; // duplicate event

  const stamped = adfLib.stampQaHeader(ctx.adf, ctx.phaseName, round);
  await jira.putChecklist(ctx.key, stamped.adf);
  const devCtx = await jira.getContext(devKey);
  await jira.putChecklist(devKey, adfLib.appendReworkBlock(devCtx.adf, round, items));
  await jira.transitionTo(devKey, 'QA Rework');
  const a = devCtx.assignee || {};
  await jira.comment(devKey, require('./qaloop-jira').mentionCommentAdf(a.id || null, a.name || null, `QA Failed round ${round} — ${items.length} item(s) to rework`, items));
}

function adfLib_mentionless(text) {
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}
module.exports = { handleQaFailed };
```

> The test injects `deps.jira` with `comment/transitionTo/putChecklist/findDevStory` and a no-op `getContext`; add `async getContext(){return {adf:{type:'doc',version:1,content:[]}, assignee:null};}` to the test's `deps.jira` so the dev-append path is exercised in later tests.

- [ ] **Step 4: Run, verify pass** — `npm test` — Expected PASS.

- [ ] **Step 5: Commit** — STOP.

---

### Task 10: Done handler

**Files:**
- Modify: `src/triggers/qaloop.js`
- Modify: `test/qaloop.test.js`

**Interfaces:**
- Produces: `async function handleReworkDone(ctx, deps)` where `ctx` = Development story context with status `QA Rework`. Steps: `loadState` → if `reworkRoundComplete(ctx.adf, state.round)` is false, return → `completeRound` (bail if false) → `transitionTo(dev,'Ready for QA')` → look up the QA story (`state.qaStoryKey`) assignee → `comment(qaStory, mention qa-assignee, "QA Rework N complete — ready for retest")` → `transitionTo(qaStory,'In QA')`.

- [ ] **Step 1: Write failing test**

```javascript
const { handleReworkDone } = require('../src/triggers/qaloop');

test('rework 100% done transitions dev to Ready for QA, comments QA story, moves QA back to In QA', async () => {
  const d = deps({ jira: { async getContext(k){ return { key: k, assignee: { id: 'qa-1', name: 'Tester' } }; } } });
  // seed a round-1 open state
  await require('../src/triggers/qaloop-state').beginRound(d.kvs, 'OCW-EPIC', { qaStoryKey: 'OCW-QA', devStoryKey: 'OCW-DEV' });
  const ctx = { key: 'OCW-DEV', epicKey: 'OCW-EPIC', status: 'QA Rework',
    adf: { type: 'doc', version: 1, content: [
      { type: 'paragraph', content: [{ type: 'text', text: '# QA Rework 1' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '[done] boom' }] },
    ]}};
  await handleReworkDone(ctx, d);
  assert.ok(d.calls.transitions.find((t) => t.k === 'OCW-DEV' && t.s === 'Ready for QA'));
  assert.ok(d.calls.transitions.find((t) => t.k === 'OCW-QA' && t.s === 'In QA'));
  assert.ok(d.calls.comments.find((c) => c.k === 'OCW-QA'));
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` — Expected FAIL.

- [ ] **Step 3: Implement `handleReworkDone`** (append to `qaloop.js`, extend `module.exports`).

```javascript
async function handleReworkDone(ctx, deps) {
  const { kvs, jira } = deps;
  const st = await stateLib.loadState(kvs, ctx.epicKey);
  if (!adfLib.reworkRoundComplete(ctx.adf, st.round)) return;
  if (!(await stateLib.completeRound(kvs, ctx.epicKey))) return; // idempotent / not open
  await jira.transitionTo(ctx.key, 'Ready for QA');
  const qa = await jira.getContext(st.qaStoryKey);
  const a = (qa && qa.assignee) || {};
  const doneItems = adfLib.parseBlocks(ctx.adf).find((b) => b.header === `QA Rework ${st.round}`).items.map((i) => i.text);
  await jira.comment(st.qaStoryKey, require('./qaloop-jira').mentionCommentAdf(a.id || null, a.name || null, `QA Rework ${st.round} complete — ready for retest`, doneItems));
  await jira.transitionTo(st.qaStoryKey, 'In QA');
}
module.exports = { handleQaFailed, handleReworkDone };
```

- [ ] **Step 4: Run, verify pass** — `npm test` — Expected PASS.

- [ ] **Step 5: Commit** — STOP.

---

### Task 11: Trigger entry, dispatch, resolve-on-pass, manifest wiring

**Files:**
- Modify: `src/triggers/qaloop.js` (add `handler`)
- Modify: `manifest.yml` (register trigger + function)
- Modify: `test/qaloop.test.js` (dispatch tests)

**Interfaces:**
- Produces: `async function handler(event)` — the Forge trigger entry. Loads `getContext(event.issue.key)`; early-returns unless `projectKey === 'OCW'` and labels include `qc-phase`. Then:
  - if labels include `phase-in-qa` and `status === 'QA Failed'` → `handleQaFailed({...ctx, phaseName:'In QA'}, realDeps)`.
  - else if labels include `phase-development` or `phase-in-progress` and `status === 'QA Rework'` → `handleReworkDone(ctx, realDeps)`.
  - else if labels include `phase-in-qa` and `status === 'QA Pass'` → `resolve` + post the "closed after N round(s)" summary on the QA story (only if a loop was active).
  - `realDeps` wires the real `@forge/kvs` store and the `qaloop-jira` module (with `findDevStory` implemented via `searchAll`-style JQL).

- [ ] **Step 1: Write a failing dispatch test (inject deps; assert routing)**

```javascript
const qaloop = require('../src/triggers/qaloop');
test('dispatch routes QA Failed on an in-qa story to the fail handler', async () => {
  let routed = null;
  const testDeps = { /* as in deps() */ };
  // Use the exported _dispatch(ctx, deps) seam:
  await qaloop._dispatch({ projectKey: 'OCW', labels: ['qc-phase', 'phase-in-qa'], status: 'QA Failed',
    key: 'OCW-QA', epicKey: 'OCW-E', adf: { type:'doc', version:1, content:[
      { type:'paragraph', content:[{ type:'text', text:'# In QA' }] },
      { type:'paragraph', content:[{ type:'text', text:'# Defects' }] },
      { type:'paragraph', content:[{ type:'text', text:'[open] boom' }] }] } },
    { ...deps(), fail: async () => { routed = 'fail'; }, done: async () => { routed = 'done'; } });
  assert.strictEqual(routed, 'fail');
});
```

- [ ] **Step 2: Run, verify fail** — `npm test` — Expected FAIL.

- [ ] **Step 3: Implement `_dispatch` + `handler`** (the `_dispatch(ctx, deps)` seam keeps routing unit-testable; `deps.fail`/`deps.done` default to the real handlers).

```javascript
const IN_QA = 'phase-in-qa', DEV = 'phase-development', INPROG = 'phase-in-progress';

async function _dispatch(ctx, deps) {
  if (!ctx || ctx.projectKey !== 'OCW' || !ctx.labels.includes('qc-phase')) return;
  const fail = deps.fail || ((c, d) => handleQaFailed(c, d));
  const done = deps.done || ((c, d) => handleReworkDone(c, d));
  if (ctx.labels.includes(IN_QA) && ctx.status === 'QA Failed') return fail({ ...ctx, phaseName: 'In QA' }, deps);
  if ((ctx.labels.includes(DEV) || ctx.labels.includes(INPROG)) && ctx.status === 'QA Rework') return done(ctx, deps);
  if (ctx.labels.includes(IN_QA) && ctx.status === 'QA Pass') return resolveOnPass(ctx, deps);
}

async function resolveOnPass(ctx, deps) {
  const st = await stateLib.loadState(deps.kvs, ctx.epicKey);
  if (st.phase === 'idle' || st.phase === 'resolved' || st.round === 0) return;
  await stateLib.resolve(deps.kvs, ctx.epicKey);
  await deps.jira.comment(ctx.key, adfLib_mentionless(`QA rework loop closed after ${st.round} round(s) — QA passed.`));
}

async function handler(event) {
  const key = event && event.issue && event.issue.key;
  if (!key) return;
  const jiraMod = require('./qaloop-jira');
  const { kvs } = require('@forge/kvs');
  const deps = { kvs, jira: { ...jiraMod, findDevStory: (epicKey) => findDevStory(epicKey, jiraMod) } };
  const ctx = await jiraMod.getContext(key);
  await _dispatch(ctx, deps);
}

async function findDevStory(epicKey, jiraMod) {
  // reuse a searchAll-style JQL against parent + qc-phase + the dev phase label (feature or bug)
  const track = await jiraMod.epicTrack(epicKey);
  const phase = track === 'bug' ? INPROG : DEV;
  return jiraMod.firstStoryKey(`parent = "${epicKey}" AND labels = qc-phase AND labels = ${phase}`);
}
module.exports = { handler, _dispatch, handleQaFailed, handleReworkDone };
```

> Add `firstStoryKey(jql)` to `qaloop-jira.js` (a one-result `/search/jql` returning the first issue key or null), mirroring `searchAll` in `compliance.js`.

- [ ] **Step 4: Register the trigger in `manifest.yml`**

Under `modules.trigger:` add:
```yaml
    - key: qc-qa-loop
      function: qc-qa-loop-fn
      events:
        - avi:jira:updated:issue
```
Under `modules.function:` add:
```yaml
    - key: qc-qa-loop-fn
      handler: qaloop.handler
```
And create `src/qaloop.js` re-export: `export { handler } from './triggers/qaloop';` (matching the `provision.js` re-export pattern), OR point the handler at `triggers/qaloop.handler` directly if the bundler allows.

- [ ] **Step 5: Run tests, verify pass** — `npm test` — Expected PASS.

- [ ] **Step 6: Commit** — STOP.

---

### Task 12: Full unit-suite green + lint

**Files:** none new.

- [ ] **Step 1: Run the whole suite** — Run: `npm test` — Expected: all tests PASS. Paste the output.
- [ ] **Step 2: Lint** — Run: `npm run lint` — fix any errors in the new files.
- [ ] **Step 3: Commit** — STOP.

---

### Task 13: Staging end-to-end (REQUIRES APPROVAL + workflow config done)

**Files:** none (validation).

**Preconditions:** Task 0's workflow config approved and applied by a Jira admin (the 3 statuses + transitions on OCW's Story workflow). Task 1's spike confirmed the multi-checklist model.

- [ ] **Step 1: Deploy to the app's non-prod environment**

```bash
export PATH="/c/Users/Sharan/.config/herd/bin/nvm/v22.23.2:$PATH"
forge deploy -e development --no-verify   # or the team's staging env
```

- [ ] **Step 2: Get approval, then run one OCW epic through two rounds**

On a staging OCW feature epic: In-QA story → add a defect checklist → set **QA Failed**. Verify: dev story gets `QA Rework 1`, moves to **QA Rework**, dev-assignee is @mentioned. Tick all `QA Rework 1` items → verify dev auto-moves to **Ready for QA**, QA story gets the @mention comment and returns to **In QA**. Repeat for round 2 (`QA Failed 2` → `QA Rework 2`). Finally set the QA story to **QA Pass** → verify the "closed after 2 round(s)" summary.

- [ ] **Step 3: Record evidence**

Paste the observed status changes, the two `cf10051` blocks on the dev story, and the two comments. Per the unit-testing skill: list each checklist item covered / N/A with reason.

- [ ] **Step 4: Promote to production (REQUIRES APPROVAL)**

```bash
forge deploy -e production --no-verify
```
Only after the user approves. Then confirm the trigger is live on prod OCW.

---

## Self-Review

- **Spec coverage:** §2 goal → Tasks 9–11; §3 decisions (statuses/rounds/done-signal/pair/Forge-only) → Tasks 4–11; §4 workflow prereq → Task 0 + Task 13 precondition; §5.1 detection → Task 11; §5.2 state → Task 7; §5.3 copy → Tasks 4–5; §5.4 handlers → Tasks 9–10; §6 edge cases → Tasks 4 (multiple/empty blocks), 7 (idempotency), 8 (unassigned mention), 9 (no dev story / no defects), 11 (bug vs feature via `epicTrack`); §7 testing → Tasks 2–12 + 13; §8 files → all tasks; §9 out-of-scope respected (no dashboard badge, OCW-only, phase-story assignee not sub-tasks). **Gaps:** none identified.
- **Placeholder scan:** no "TBD"/"add error handling"/"write tests for the above" — every code and test step contains real content.
- **Type consistency:** `currentRoundItems`, `stampQaHeader` (`{adf,itemTexts}`), `appendReworkBlock`, `reworkRoundComplete`, `beginRound`(→ number|null), `completeRound`(→ bool), `pickTransitionId`, `mentionCommentAdf`, `getContext`(→ `{assignee:{id,name}}`), `_dispatch(ctx,deps)` are used with identical names/shapes across Tasks 4–11.

## Open risks (carry into execution)
- **Gebsun multi-checklist (Task 1)** is the top risk; if it fails, fall back to a single appended "QA Rework N" block with per-item bold prefixes and adjust Task 5/6 accordingly.
- **`@forge/kvs` API surface** — confirm `kvs.get/set` names against the installed `^2.0.3` (Task 7 isolates this behind the injected store; only `handler` binds the real one).
- **Transition availability** — `transitionTo` fails loudly (logs) if the workflow lacks the arrow; Task 13 is where that surfaces if the admin config is incomplete.

## Spike findings (2026-08-19, on scratch story OCW-22901)
- Gebsun **DOES support multiple named sections** in one `cf10051` — both `# Alpha` and `# Bravo` were preserved and rendered. The multi-block model holds.
- **Count `cf10094` is COMBINED across all sections** ("0/4" for 2+2), not per-section. Non-blocking: our completion check reads item `[done]` state directly, not the count.
- **CRITICAL — stored format after Gebsun normalization is NOT `# header` paragraphs.** Gebsun rewrites `cf10051` to:
  - **Header** = `orderedList` (attrs `{order:1}`) → `listItem` → `paragraph` → `text` = the header name **with the `# ` stripped** (e.g. `"Alpha"`).
  - **Items** = `bulletList` → `listItem` → `paragraph` → `text` = `"[open] item"` / `"[done] item"` (the `[state]` token is preserved).
  Freshly-written `cf10051` (provision seed / our `appendReworkBlock`) uses plain `# header` + `[open] item` paragraphs, which Gebsun converts to the above on its next process. So **any read of a QA/dev story authored through the Gebsun UI is in the orderedList/bulletList form.**
- **Impact:** `parseBlocks` (and `stampQaHeader`) must detect headers as **either** a `# ...` paragraph **or** an `orderedList` section, and items as `[state] ...` text in either a paragraph or a `bulletList`. Writing (`blockParagraphs` = `# header` + `[open]` paragraphs) is confirmed OK — Gebsun re-parses it into a proper section.
- Scratch story **OCW-22901** was created for this spike — **flagged for the user to delete** (labeled `[TEST-DELETE]`).
