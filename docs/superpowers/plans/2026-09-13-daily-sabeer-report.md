# Daily Epic Progress Report for Sabeer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a daily ≤2-page branded PDF for Sabeer summarizing every active epic (1–3 sentences each), where AI drafts the per-epic update and Nihad edits it on the dashboard before export.

**Architecture:** New pure-logic module (`src/report/daily-format.js`, CommonJS, unit-tested) holds the char-cap, LLM prompt builder, and report-markdown builder. The Forge resolver (`compliance.js`) gains `computeDailyBoard`, `getDailyBoard`, `setDailyUpdate`, `generateDraft(s)` (OpenRouter claude-haiku via `@forge/api` fetch + encrypted `LLM_API_KEY`). A secret-keyed web-trigger returns the digest JSON. A local Node script (`tools/daily-report.js`) fetches the digest and renders the PDF via the existing `brief-to-pdf.js`. All new authoring UI lives in one isolated dashboard panel.

**Tech Stack:** Atlassian Forge (nodejs24.x, `@forge/resolver`, `@forge/api`, `@forge/bridge`), React (Vite) dashboard, `node --test`, OpenRouter (`anthropic/claude-3.5-haiku`), `brief-to-pdf.js` (headless Chrome).

**Spec:** `docs/superpowers/specs/2026-09-13-daily-sabeer-report-design.md`

## Global Constraints

- **Never run `git commit`.** The user commits manually. Every task ends by staging (`git add`) and showing the working-tree diff for review — NOT committing. (Overrides the writing-plans "commit" step.)
- **App:** `launch-dashboard`, deploy target is **production**: `forge deploy -e production --no-verify`.
- **Build the dashboard bundle before deploy** when `static/compliance/src/**` changes: `cd static/compliance && npm run build` (Node on PATH: `/c/Users/Sharan/.config/herd/bin/nvm/v22.23.2`).
- **Forge caches the UI bundle** — verify UI changes with a hard refresh (Ctrl+F5), not the in-app Refresh.
- **LLM model:** `anthropic/claude-3.5-haiku` via `https://openrouter.ai/api/v1/chat/completions`, `Authorization: Bearer ${process.env.LLM_API_KEY}`.
- **Per-update length cap:** 240 characters (word-safe), enforced server-side in `setDailyUpdate` and in the UI `maxLength`.
- **Active epic set:** `issuetype = Epic AND labels = EPIC AND statusCategory = "In Progress"`.
- **Secrets are encrypted Forge variables the USER sets** (Claude must not type keys): `LLM_API_KEY`, `DIGEST_KEY`.
- **Property key:** `daily-update` (separate from the existing `qc-compliance` property), shape `{ "YYYY-MM-DD": { draft, text, by, at } }`, pruned to the last 14 days.

---

### Task 1: Pure formatting module + tests

**Files:**
- Create: `src/report/daily-format.js` (CommonJS — matches the `node --test` convention used by `src/triggers/qaloop-state.js`)
- Test: `test/daily-format.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `capText(s, max=240) -> string` — collapse whitespace, trim, hard-cap word-safe with `…`.
  - `buildDraftPrompt(epic) -> string` where `epic = {key, name, phaseName, pct, signals:[{type, text}]}`.
  - `buildReportMarkdown(digest) -> string` where `digest = {date, preparedBy, generatedFor, active:[{key, name, phaseName, pct, text}], doneTail:[{key, name}]}`.
  - `MAX = 240`.

- [ ] **Step 1: Write the failing test**

```js
// test/daily-format.test.js — unit tests for the daily report formatter
const { test } = require('node:test');
const assert = require('node:assert');
const { capText, buildDraftPrompt, buildReportMarkdown, MAX } = require('../src/report/daily-format');

test('capText collapses whitespace and trims', () => {
  assert.strictEqual(capText('  a\n  b   c '), 'a b c');
});

test('capText passes short text through unchanged', () => {
  assert.strictEqual(capText('short update'), 'short update');
});

test('capText hard-caps to MAX word-safe with ellipsis', () => {
  const long = 'word '.repeat(80).trim(); // 399 chars
  const out = capText(long);
  assert.ok(out.length <= MAX, `len ${out.length} <= ${MAX}`);
  assert.ok(out.endsWith('…'));
  assert.ok(!out.includes('  '));
});

test('buildDraftPrompt includes epic identity, phase, pct and signals', () => {
  const p = buildDraftPrompt({ key: 'OCW-1', name: 'Thing', phaseName: 'Development', pct: 42,
    signals: [{ type: 'comment', text: 'BE merged' }] });
  assert.match(p, /OCW-1 — Thing/);
  assert.match(p, /Development \(42%/);
  assert.match(p, /BE merged/);
  assert.match(p, /max 240 characters/i);
});

test('buildDraftPrompt handles no signals', () => {
  const p = buildDraftPrompt({ key: 'OCW-2', name: 'X', phaseName: 'BA', pct: 0, signals: [] });
  assert.match(p, /no new activity/i);
});

test('buildReportMarkdown puts no table before the first numbered ## (metadata-block rule)', () => {
  const md = buildReportMarkdown({ date: '2026-09-13', preparedBy: 'Nihad', generatedFor: 'Sabeer',
    active: [{ key: 'OCW-1', name: 'Thing', phaseName: 'Development', pct: 42, text: 'Moved.' }],
    doneTail: [{ key: 'OCW-9', name: 'Old' }] });
  const firstTable = md.indexOf('\n|');
  const firstSection = md.indexOf('\n## ');
  assert.ok(firstSection !== -1 && firstTable > firstSection, 'first table must come after the first ## heading');
  assert.match(md, /Zil Money · Daily Epic Progress · Internal/);
  assert.match(md, /1 active/);
  assert.match(md, /\*\*OCW-1\*\* — Thing/);
  assert.match(md, /OCW-9 — Old/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/daily-format.test.js`
Expected: FAIL — `Cannot find module '../src/report/daily-format'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/report/daily-format.js — pure helpers for the daily Sabeer report (no Forge/network).
const MAX = 240;

function capText(s, max = MAX) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + '…';
}

function buildDraftPrompt(epic) {
  const e = epic || {};
  const signals = (e.signals || []).map((s) => `- [${s.type}] ${s.text}`).join('\n') || '- (no new activity since yesterday)';
  return [
    'You are writing a one-line status for an executive (Sabeer) about a software epic.',
    `Epic: ${e.key} — ${e.name}`,
    `Current phase: ${e.phaseName} (${e.pct}% checklist complete)`,
    'Recent activity since yesterday:',
    signals,
    '',
    'Write 1-2 plain sentences: what moved since yesterday and any blocker. No preamble, no markdown, max 240 characters.',
  ].join('\n');
}

function buildReportMarkdown(digest) {
  const d = digest || {};
  const active = d.active || [];
  const doneTail = d.doneTail || [];
  const updated = active.filter((a) => a.text && a.text.trim()).length;
  const rows = active.map((a) =>
    `| **${a.key}** — ${a.name} | ${a.phaseName} · ${a.pct}% | ${a.text ? a.text.replace(/\|/g, '\\|') : '—'} |`).join('\n');
  const done = doneTail.length
    ? doneTail.map((x) => `- ${x.key} — ${x.name}`).join('\n')
    : '- (none)';
  return [
    'Zil Money · Daily Epic Progress · Internal',
    '# Daily Epic Progress',
    `${d.date} · Prepared by ${d.preparedBy || 'Nihad'} · for ${d.generatedFor || 'Sabeer'}`,
    '',
    `**${active.length} active epics · ${updated} updated today**`,
    '',
    '## Active Epics',
    '| Epic | Phase · % | Update |',
    '| --- | --- | --- |',
    rows,
    '',
    '## Completed recently (7 days)',
    done,
    '',
  ].join('\n');
}

module.exports = { MAX, capText, buildDraftPrompt, buildReportMarkdown };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/daily-format.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npm test`
Expected: all existing `qaloop*` tests + the new file PASS. Paste the output.

- [ ] **Step 6: Stage for review (do NOT commit)**

```bash
git add src/report/daily-format.js test/daily-format.test.js
git --no-pager diff --staged --stat
```
Tell the user it's staged for their review + manual commit.

---

### Task 2: Resolver — daily-update property + board computation

**Files:**
- Modify: `src/resolvers/compliance.js` (add generic property helpers, `computeDailyBoard`, and two resolver endpoints; near the other `resolver.define` blocks and helpers)

**Interfaces:**
- Consumes: existing `jira()`, `searchAll(jql, fields)`, `CF`, `FEATURE_PHASES`, `BUG_PHASES` (already imported), and `capText` from Task 1.
- Produces (all `export`ed or `resolver.define`d):
  - `getProp(issueKey, prop) -> object` / `setProp(issueKey, prop, val) -> bool`.
  - `export async function computeDailyBoard() -> { date, preparedBy, generatedFor, active:[{key,name,phaseName,pct,text}], doneTail:[{key,name}] }` (consumed by Task 4 web-trigger).
  - resolver `getDailyBoard` → same object as `computeDailyBoard`.
  - resolver `setDailyUpdate({epicKey, text}) -> {ok, text}`.

- [ ] **Step 1: Add the import for the formatter**

At the top of `src/resolvers/compliance.js`, after the existing imports, add:
```js
import daily from '../report/daily-format.js';   // { capText, buildDraftPrompt, buildReportMarkdown, MAX }
```
Note: `daily-format.js` is CommonJS; Forge's webpack bundles it and exposes `module.exports` as the default import.

- [ ] **Step 2: Add generic property helpers + constant**

After the existing `PROP`/`FEATURE_JQL`/`BUG_JQL` constants (top of file) add:
```js
const DAILY_PROP = 'daily-update';
const ACTIVE_EPIC_JQL = 'issuetype = Epic AND labels = EPIC AND statusCategory = "In Progress" ORDER BY key ASC';
const today = () => new Date().toISOString().slice(0, 10);
```
Near `getEpicMeta`/`setEpicMeta` add:
```js
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
```

- [ ] **Step 3: Add `computeDailyBoard`**

Add this exported function (uses the phase-order arrays to pick the current phase = first non-done phase-story):
```js
// Build the daily digest: active (In Progress) epics with their current phase, % and today's update text,
// plus a short list of epics completed in the last 7 days. Shared by the getDailyBoard resolver + web-trigger.
export async function computeDailyBoard() {
  const epics = await searchAll(ACTIVE_EPIC_JQL, 'summary,labels');
  const active = [];
  if (epics.length) {
    const keyList = epics.map((e) => `"${e.key}"`).join(',');
    const kids = await searchAll(`parent in (${keyList}) AND labels = qc-phase`,
      `summary,labels,status,parent,${CF.pct},${CF.progress}`);
    const byParent = {};
    for (const c of kids) {
      const pk = c.fields?.parent?.key; if (!pk) continue;
      (byParent[pk] = byParent[pk] || []).push(c);
    }
    for (const e of epics) {
      const isBug = (e.fields?.labels || []).includes('bug');
      const order = (isBug ? BUG_PHASES : FEATURE_PHASES).map((p) => p.label);
      const nameByLabel = Object.fromEntries((isBug ? BUG_PHASES : FEATURE_PHASES).map((p) => [p.label, p.name]));
      const kidsE = (byParent[e.key] || []).map((c) => ({
        label: (c.fields?.labels || []).find((l) => l.startsWith('phase-')),
        done: c.fields?.status?.statusCategory?.key === 'done',
        pct: c.fields?.[CF.pct] || 0,
      })).filter((x) => x.label);
      kidsE.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
      const cur = kidsE.find((x) => !x.done) || kidsE[kidsE.length - 1] || null;
      const prop = await getProp(e.key, DAILY_PROP);
      const rec = prop[today()] || {};
      active.push({
        key: e.key, name: e.fields?.summary || e.key,
        phaseName: cur ? (nameByLabel[cur.label] || cur.label) : '—',
        pct: cur ? cur.pct : 0,
        text: rec.text || rec.draft || '',
      });
    }
  }
  // completed in the last 7 days
  const doneEpics = await searchAll(
    'issuetype = Epic AND labels = EPIC AND status CHANGED TO Done AFTER -7d ORDER BY key ASC', 'summary');
  const doneTail = doneEpics.map((e) => ({ key: e.key, name: e.fields?.summary || e.key }));
  return { date: today(), preparedBy: 'Nihad', generatedFor: 'Sabeer', active, doneTail };
}
```

- [ ] **Step 4: Add the two resolver endpoints**

Add near the other `resolver.define` calls (before `export const handler`):
```js
resolver.define('getDailyBoard', async () => computeDailyBoard());

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
  const keep = Object.keys(cur).sort().slice(-14);          // prune to last 14 days
  const pruned = {}; keep.forEach((k) => { pruned[k] = cur[k]; });
  await setProp(epicKey, DAILY_PROP, pruned);
  return { ok: true, text: cleaned };
});
```

- [ ] **Step 5: Lint (catches Forge-hook / syntax mistakes)**

Run: `npm run lint`
Expected: no errors from `src/resolvers/compliance.js`.

- [ ] **Step 6: Deploy and verify live** (unit tests N/A — these hit Jira via the Forge runtime; verified live)

Run: `forge deploy -e production --no-verify`
Then, in the dashboard's browser tab (a Jira work page), run in DevTools/`javascript_tool`:
```js
// invoke isn't reachable outside the iframe; instead verify the property write path via REST:
// 1) confirm ACTIVE_EPIC_JQL returns ~25
await fetch('/rest/api/3/search/jql',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({jql:'issuetype = Epic AND labels = EPIC AND statusCategory = "In Progress"',maxResults:1})}).then(r=>r.json()).then(d=>d.total)
```
Expected: total ≈ 25. (Full `getDailyBoard` output is verified through the UI in Task 5.)

- [ ] **Step 7: Stage for review (do NOT commit)**

```bash
git add src/resolvers/compliance.js
git --no-pager diff --staged --stat
```

---

### Task 3: LLM drafting — module + resolver endpoints + egress + variable

**Files:**
- Create: `src/report/llm.js`
- Modify: `src/resolvers/compliance.js` (add `generateDraft` + `generateDrafts`)
- Modify: `manifest.yml` (add `permissions.external.fetch.backend`)

**Interfaces:**
- Consumes: `process.env.LLM_API_KEY`, `daily.buildDraftPrompt`, `daily.capText`, `searchAll`, `jira`, `getProp`, `setProp`, `computeDailyBoard`.
- Produces:
  - `src/report/llm.js` → `export async function draftUpdate(prompt) -> string` (calls OpenRouter, returns capped text).
  - resolver `generateDraft({epicKey}) -> {ok, draft}`.
  - resolver `generateDrafts() -> {ok, drafted, skipped}`.

- [ ] **Step 1: Create the LLM module**

```js
// src/report/llm.js — OpenRouter (claude-haiku) call for daily-update drafts. Uses the Forge
// external fetch (egress declared in manifest). Key comes from the encrypted LLM_API_KEY variable.
import { fetch } from '@forge/api';
import daily from './daily-format.js';

export async function draftUpdate(prompt) {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('LLM_API_KEY is not set');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'anthropic/claude-3.5-haiku',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return daily.capText(text);
}
```

- [ ] **Step 2: Add egress to the manifest**

In `manifest.yml`, under `permissions:` (alongside `scopes:`), add:
```yaml
  external:
    fetch:
      backend:
        - "openrouter.ai"
```

- [ ] **Step 3: Add a signals helper + the two resolver endpoints in compliance.js**

Add the import near the Task-2 import:
```js
import { draftUpdate } from '../report/llm.js';
```
Add a helper that gathers cheap recent signal (last 3 epic comments) and the endpoints:
```js
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
  const draft = await draftUpdate(daily.buildDraftPrompt({ ...e, signals }));
  const cur = await getProp(epicKey, DAILY_PROP);
  const day = today();
  cur[day] = { ...(cur[day] || {}), draft };
  await setProp(epicKey, DAILY_PROP, cur);
  return { ok: true, draft };
});

resolver.define('generateDrafts', async () => {
  const board = await computeDailyBoard();
  let drafted = 0, skipped = 0;
  for (const e of board.active) {
    const cur = await getProp(e.key, DAILY_PROP);
    if (cur[today()] && cur[today()].text) { skipped++; continue; }   // don't overwrite a human edit
    try {
      const signals = await recentSignals(e.key);
      const draft = await draftUpdate(daily.buildDraftPrompt({ ...e, signals }));
      cur[today()] = { ...(cur[today()] || {}), draft };
      await setProp(e.key, DAILY_PROP, cur);
      drafted++;
    } catch (err) { console.error('generateDrafts failed', e.key, err && err.message); skipped++; }
  }
  return { ok: true, drafted, skipped };
});
```

- [ ] **Step 4: Tell the user to add the key (Claude must not type secrets)**

Instruct the user to run (their terminal or `!` in-session):
```
forge variables set --encrypt -e production LLM_API_KEY <their-openrouter-key>
```
Confirm with `forge variables list -e production` (shows the name, not the value).

- [ ] **Step 5: Deploy + reinstall (egress permission changed)**

```
forge deploy -e production --no-verify
forge install --upgrade -e production
```
The upgrade prompt will show the new "external fetch: openrouter.ai" permission — the user approves it.

- [ ] **Step 6: Live verify** (unit test N/A — network + Forge runtime; verified live in Task 5 via the "Generate drafts" button)

Confirm deploy succeeded and no manifest validation error. Full draft generation is exercised in Task 5.

- [ ] **Step 7: Stage for review (do NOT commit)**

```bash
git add src/report/llm.js src/resolvers/compliance.js manifest.yml
git --no-pager diff --staged --stat
```

---

### Task 4: Web-trigger for the digest JSON

**Files:**
- Create: `src/functions/daily-digest.js`
- Modify: `manifest.yml` (add `webtrigger` module + `function` entry)

**Interfaces:**
- Consumes: `computeDailyBoard` (Task 2), `process.env.DIGEST_KEY`.
- Produces: an HTTPS web-trigger URL (obtained post-deploy via `forge webtrigger`) that returns the digest JSON when `?key=<DIGEST_KEY>` matches.

- [ ] **Step 1: Create the web-trigger handler**

```js
// src/functions/daily-digest.js — secret-keyed web-trigger returning the daily digest JSON.
import { computeDailyBoard } from '../resolvers/compliance';

export async function handler(req) {
  const key = (req.queryParameters && req.queryParameters.key && req.queryParameters.key[0]) || '';
  if (!process.env.DIGEST_KEY || key !== process.env.DIGEST_KEY) {
    return { statusCode: 401, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: 'unauthorized' }) };
  }
  try {
    const board = await computeDailyBoard();
    return { statusCode: 200, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify(board) };
  } catch (e) {
    return { statusCode: 500, headers: { 'Content-Type': ['application/json'] }, body: JSON.stringify({ error: String(e && e.message || e) }) };
  }
}
```

- [ ] **Step 2: Register the module + function in manifest.yml**

Under `modules:` add:
```yaml
  webtrigger:
    - key: daily-digest
      function: daily-digest-fn
```
Under `modules.function:` (the existing list) add:
```yaml
    - key: daily-digest-fn
      handler: daily-digest.handler
```

- [ ] **Step 3: User adds the digest secret**

Instruct the user to run:
```
forge variables set --encrypt -e production DIGEST_KEY <a-long-random-string>
```

- [ ] **Step 4: Deploy + get the URL**

```
forge deploy -e production --no-verify
forge webtrigger
```
`forge webtrigger` is interactive: pick the installation → `daily-digest` → production; it prints the HTTPS URL. Save it for Task 6 (`DIGEST_URL`).

- [ ] **Step 5: Live verify the endpoint**

With the printed URL and the DIGEST_KEY value:
```bash
curl -s "<DIGEST_URL>?key=<DIGEST_KEY>" | head -c 400
curl -s -o /dev/null -w "%{http_code}\n" "<DIGEST_URL>?key=wrong"
```
Expected: first returns JSON with `"active":[...]`; second returns `401`.

- [ ] **Step 6: Stage for review (do NOT commit)**

```bash
git add src/functions/daily-digest.js manifest.yml
git --no-pager diff --staged --stat
```

---

### Task 5: Dashboard — Daily Report panel (author + edit + generate)

**Files:**
- Modify: `static/compliance/src/App.jsx` (add a `DailyReportPanel` component + a header button that opens it)

**Interfaces:**
- Consumes (via `invoke` from `@forge/bridge`): `getDailyBoard`, `setDailyUpdate`, `generateDrafts`.
- Produces: no exported API — self-contained UI.

- [ ] **Step 1: Add the panel component**

Add near the other components in `static/compliance/src/App.jsx` (uses the existing `invoke` import already present in the file):
```jsx
function DailyReportPanel({ onClose }) {
  const [rows, setRows] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);
  const load = React.useCallback(() => {
    setErr(null);
    return invoke("getDailyBoard").then((d) => setRows(d.active || [])).catch((e) => setErr(String(e)));
  }, []);
  React.useEffect(() => { load(); }, [load]);
  const genAll = async () => { setBusy(true); try { await invoke("generateDrafts"); await load(); } catch (e) { setErr(String(e)); } setBusy(false); };
  const save = async (key, text) => { await invoke("setDailyUpdate", { epicKey: key, text }); };
  return (
    <div className="drp-overlay" onClick={onClose}>
      <div className="drp" onClick={(e) => e.stopPropagation()}>
        <div className="drp-head">
          <strong>Daily Report — updates for Sabeer</strong>
          <div>
            <button disabled={busy} onClick={genAll}>{busy ? "Generating…" : "Generate drafts (AI)"}</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        {err && <div className="eb">⚠️ {err}</div>}
        {!rows ? <div>Loading…</div> : rows.length === 0 ? <div>No active epics.</div> : (
          <div className="drp-list">
            {rows.map((r) => (
              <div className="drp-row" key={r.key}>
                <div className="drp-meta"><strong>{r.key}</strong> — {r.name}<span className="muted"> · {r.phaseName} · {r.pct}%</span></div>
                <textarea defaultValue={r.text || ""} maxLength={240} rows={2}
                  onBlur={(e) => save(r.key, e.target.value)} placeholder="1–3 sentence update (auto-saves on blur, max 240 chars)…" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire a header button to open it**

Find the dashboard header/toolbar (near the "Refresh" control around the top of the main view) and add:
```jsx
{showDaily && <DailyReportPanel onClose={() => setShowDaily(false)} />}
<button className="btn" onClick={() => setShowDaily(true)}>Daily Report</button>
```
Add the `const [showDaily, setShowDaily] = React.useState(false);` state in the same component that renders the header.

- [ ] **Step 3: Add minimal styles**

In the dashboard CSS (the file imported by `App.jsx`, e.g. `static/compliance/src/index.css` — match the existing import), append:
```css
.drp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:flex-start;justify-content:center;z-index:50;padding:40px}
.drp{background:#fff;border-radius:8px;max-width:900px;width:100%;max-height:85vh;overflow:auto;padding:16px}
.drp-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px}
.drp-row{border-top:1px solid #eee;padding:8px 0}
.drp-row textarea{width:100%;margin-top:4px}
.drp-meta{font-size:13px}
```

- [ ] **Step 4: Build the bundle**

Run: `cd static/compliance && npm run build`
Expected: `✓ built` with no errors.

- [ ] **Step 5: Deploy + live verify**

Run: `forge deploy -e production --no-verify`
Then Ctrl+F5 the dashboard, click **Daily Report**:
- The panel lists ~25 active epics with phase + %.
- Click **Generate drafts (AI)** → after a moment, empty boxes fill with AI text.
- Edit a box, click elsewhere (blur) → reopen the panel → the edited text persisted.
Paste a screenshot / describe the result. (This is the live test for Tasks 2 + 3.)

- [ ] **Step 6: Stage for review (do NOT commit)**

```bash
git add static/compliance/src/App.jsx static/compliance/src/index.css static/compliance/dist
git --no-pager diff --staged --stat
```

---

### Task 6: Local renderer — `tools/daily-report.js`

**Files:**
- Create: `tools/daily-report.js` (CommonJS node script)

**Interfaces:**
- Consumes: `buildReportMarkdown` (Task 1), the web-trigger URL + key (Task 4), `brief-to-pdf.js` at `~/.claude/skills/qc-checklist/brief-to-pdf.js`.
- Produces: `Sabeer-Daily-YYYY-MM-DD.pdf` in the current directory.

- [ ] **Step 1: Write the script**

```js
#!/usr/bin/env node
// tools/daily-report.js — fetch the daily digest from the Forge web-trigger and render the
// branded ≤2-page PDF via the shared brief-to-pdf.js. Usage:
//   DIGEST_URL=<url> DIGEST_KEY=<key> node tools/daily-report.js
//   node tools/daily-report.js <url> <key>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildReportMarkdown } = require('../src/report/daily-format');

const URL_ = process.env.DIGEST_URL || process.argv[2];
const KEY = process.env.DIGEST_KEY || process.argv[3];
if (!URL_ || !KEY) { console.error('need DIGEST_URL and DIGEST_KEY (env or argv)'); process.exit(1); }

(async () => {
  const res = await fetch(`${URL_}?key=${encodeURIComponent(KEY)}`);
  if (!res.ok) { console.error('digest fetch failed', res.status, await res.text()); process.exit(1); }
  const digest = await res.json();
  const md = buildReportMarkdown(digest);
  const mdPath = path.join(os.tmpdir(), `sabeer-daily-${digest.date}.md`);
  fs.writeFileSync(mdPath, md, 'utf8');
  const out = path.resolve(`Sabeer-Daily-${digest.date}.pdf`);
  const brief = path.join(os.homedir(), '.claude', 'skills', 'qc-checklist', 'brief-to-pdf.js');
  execFileSync('node', [brief, mdPath, out, `Daily Epic Progress · ${digest.date}`], { stdio: 'inherit' });
  // page-count guard (spec: <= 2 pages)
  const buf = fs.readFileSync(out).toString('latin1');
  const pages = (buf.match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`PDF written: ${out} (~${pages} page(s))`);
  if (pages > 2) console.warn('WARNING: exceeds 2 pages — tighten updates or add a compact layout (see spec Risks).');
})();
```

- [ ] **Step 2: Run it against the live web-trigger**

Run (with the real values from Task 4):
```
DIGEST_URL="<url>" DIGEST_KEY="<key>" node tools/daily-report.js
```
Expected: `PDF written: .../Sabeer-Daily-YYYY-MM-DD.pdf (~N page(s))`.

- [ ] **Step 3: Verify the deliverable**

- Open the PDF: it is branded, titled "Daily Epic Progress", lists the active epics (Epic · Phase·% · Update) and a "Completed recently" tail.
- Confirm `~N page(s)` is **≤ 2**. If it warns >2 pages, record it and raise the compact-layout follow-up (spec Risks) — do not fake a pass.

- [ ] **Step 4: Stage for review (do NOT commit)**

```bash
git add tools/daily-report.js
git --no-pager diff --staged --stat
```

---

### Task 7: End-to-end dry run + handoff notes

**Files:**
- Create: `tools/README-daily-report.md` (the operator runbook for Nihad)

**Interfaces:**
- Consumes: everything above.
- Produces: a short runbook.

- [ ] **Step 1: Write the runbook**

```md
# Daily Sabeer Report — how to run

1. Open the Quality Check Tracker → **Daily Report**.
2. Click **Generate drafts (AI)** (fills empty updates from recent activity).
3. Review/edit each epic's box (max 240 chars). Edits auto-save on blur.
4. Render the PDF locally:
   `DIGEST_URL="<url>" DIGEST_KEY="<key>" node tools/daily-report.js`
5. `Sabeer-Daily-YYYY-MM-DD.pdf` appears in the folder — send to Sabeer.

Secrets (set once, by an admin):
- `forge variables set --encrypt -e production LLM_API_KEY <openrouter-key>`
- `forge variables set --encrypt -e production DIGEST_KEY <random-string>`
Get the web-trigger URL: `forge webtrigger` → pick `daily-digest` → production.
```

- [ ] **Step 2: Full dry run**

Do steps 1–5 of the runbook end-to-end. Confirm: drafts generate, an edit persists, the PDF renders ≤2 pages with real data.

- [ ] **Step 3: Stage for review (do NOT commit)**

```bash
git add tools/README-daily-report.md
git --no-pager diff --staged --stat
```

---

## Self-Review

**Spec coverage:**
- AI drafts → Nihad edits → Task 3 (`generateDrafts`) + Task 5 (panel edit/save). ✅
- Entry point in dashboard, stored in issue property → Task 2 (`daily-update` property) + Task 5. ✅
- Scope = 25 active + Done tail → Task 2 (`computeDailyBoard`: active JQL + `status CHANGED TO Done AFTER -7d`). ✅
- Manual export first → Task 6 local script (no scheduling). ✅
- ≤2 pages via 240-char cap + compact table → Task 1 (`capText`, table markdown) + Task 6 (page-count guard). ✅
- OpenRouter claude-haiku via encrypted `LLM_API_KEY` → Task 3. ✅
- Secret-keyed web-trigger → Task 4. ✅
- brief-to-pdf.js reuse → Task 6. ✅

**Placeholder scan:** No TBD/TODO; all code blocks are concrete. Live-verified steps are labeled where a `node --test` unit test isn't possible (Forge runtime/network/UI), per the unit-testing skill's "N/A + reason" rule.

**Type consistency:** `computeDailyBoard()` return shape `{date, preparedBy, generatedFor, active:[{key,name,phaseName,pct,text}], doneTail:[{key,name}]}` is produced in Task 2 and consumed identically by `buildReportMarkdown` (Task 1) and the web-trigger (Task 4). `daily.capText` / `daily.buildDraftPrompt` / `daily.buildReportMarkdown` names are consistent across Tasks 1–3, 6. Property shape `{YYYY-MM-DD:{draft,text,by,at}}` consistent in Tasks 2–3.

## Known follow-ups (Phase 2, not in this plan)
- Forge **scheduled trigger** to pre-draft at ~06:00 so boxes are pre-filled before Nihad logs in.
- Compact PDF layout (smaller font / dedicated template) if 25 epics + tail ever exceed 2 pages.
- Optional auto-render + email delivery.
