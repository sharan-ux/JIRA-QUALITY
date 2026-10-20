# Daily Epic Progress Report for Sabeer — Design

| Field | Value |
| --- | --- |
| Author | Muhammed Shaaran (PM) |
| Date | 2026-09-13 |
| Status | DRAFT — awaiting approval |
| App | launch-dashboard (Forge) + local render |

## Goal
A **≤2-page branded PDF, daily**, so Sabeer sees every active epic and its progress at a glance — **1–3 sentences per epic**. Nihad owns the updates; AI drafts them so his job is editing, not writing 25 from scratch.

## Decisions (locked)
- **Authoring:** AI drafts → **Nihad reviews/edits** before it ships.
- **Entry point:** in the **QC dashboard** (a per-epic "Daily update" box), stored in a Jira issue property. No Jira hunting.
- **Scope:** the **25 active (In Progress) epics** in full + a compact **"Completed recently (last 7d)"** tail. Backlog excluded.
- **Cadence:** **manual "Export Daily PDF"** first; schedule later.

## Why this fits our setup
- The Forge **resolver already reads every OCW epic + phase progress** (it draws the tracker) — so the data pull is authorized inside the app. This sidesteps the API-token account having no OCW access.
- **`brief-to-pdf.js`** already renders branded PDFs — reused for the report (with a compact layout; see Risks).
- Forge **cannot run headless Chrome**, so Forge produces *data*; a **local Node script** renders the PDF.

## Architecture
```
[Forge scheduled/on-demand]  draftDailyUpdates  --(LLM via existing gateway)-->  issue property (draft)
[Dashboard UI]  Daily-update box per active epic  --edit-->  setDailyUpdate -> issue property (text)
[Forge web-trigger]  dailyDigest  -->  JSON {date, active[], doneTail[]}
[Local]  tools/daily-report.js  --fetch digest-->  build markdown  -->  brief-to-pdf.js  -->  Sabeer-Daily-YYYY-MM-DD.pdf
```

### Data model — issue property `daily-update` on each epic
```json
{ "2026-09-13": { "draft": "AI text", "text": "Nihad-edited text", "by": "Nihad", "at": "ISO" } }
```
`text` (edited) wins; falls back to `draft`. Keep last ~14 days, prune older. **Char cap ~240** per update (≈2–3 sentences) — guarantees the 2-page fit at the UI layer.

### Resolver functions (src/resolvers/compliance.js)
- `getDailyBoard()` → active epics (statusCategory `indeterminate`) with `{key, name, phaseName, pct, todayText, hasEdit}` + `doneTail` (done in last 7d).
- `setDailyUpdate({epicKey, text})` → write today's `text` to the property.
- `generateDraft({epicKey})` (on-demand button) and `generateDrafts()` (all) → gather recent signal, call LLM, write `draft` only if no `text` yet.

### AI drafting input (cheap signal, per epic)
Epic summary + current phase + % + the **last ~3 comments** across the epic and its dev sub-tasks **since the previous digest**, and any **phase/status changes** since then. Model: **claude-haiku via the existing OpenRouter gateway** (fallback already configured). Prompt: "In 1–2 sentences, plain status for an exec: what moved since yesterday, and any blocker. No fluff." Needs manifest `permissions.external.fetch.backend` for the gateway host.

### Web-trigger `dailyDigest`
Returns the `getDailyBoard()` JSON. Protected by a shared secret query key (internal use). Local script holds the URL+key.

### Local renderer — `tools/daily-report.js`
Fetch digest → build markdown:
- Header: `Zil Money · Daily Epic Progress · Internal`, date, "Prepared by Nihad · for Sabeer".
- One line: `25 active · N updated today`.
- **Active Epics** — compact rows: **KEY — Name** *(Phase · NN%)* — update sentence.
- **Completed recently (7d)** — KEY — Name, one line each.
Then `node brief-to-pdf.js <md> Sabeer-Daily-YYYY-MM-DD.pdf "Daily Epic Progress · <date>"`.

## Phasing
- **Phase 1 (this build):** `getDailyBoard` + `setDailyUpdate` + dashboard Daily-update box (char-capped) + `dailyDigest` web-trigger + `daily-report.js` + compact PDF layout. On-demand **"Generate drafts"** button (LLM). Manual export.
- **Phase 2 (later):** Forge **scheduled** trigger to pre-draft at ~6am; optional auto-render/email; per-day history view.

## Risks / open items
- **2-page density:** 25 active epics is tight. `brief-to-pdf.js` is spacious by default — needs a **compact mode** (smaller font, tight rows) or a dedicated template. The 240-char cap + one-line-per-epic layout is the primary control; validate on real data.
- **Forge egress to the LLM gateway** must be declared; confirm the gateway row/key exists (per change-management setup).
- **LLM cost/latency** for 25 epics on-demand — batch, and only (re)draft epics with new activity.
- **Web-trigger exposure** — secret-key gate; digest carries only internal summaries, no secrets.
