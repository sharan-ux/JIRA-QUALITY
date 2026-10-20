# Daily Sabeer Report — how to run

A ≤2-page branded PDF summarizing every active epic (1–3 sentences each) for Sabeer.
AI drafts each update from recent Jira activity; Nihad reviews/edits; then render the PDF.

## Daily flow (Nihad)
1. Open the **Quality Check Tracker** dashboard → click **📋 Daily Report**.
2. Click **Generate drafts (AI)** — fills empty update boxes with an executive brief per initiative
   (progress · timeline/overdue · blocker · expected go-live) from each epic's recent activity + due date.
   Re-clicking regenerates AI drafts but never overwrites a box you've hand-edited today.
3. Review/edit each epic's box (max 320 chars). Edits **auto-save on blur** (click away).
4. Get the PDF, either:
   - **Locally (recommended, cleanest):**
     ```
     DIGEST_URL="<url>" DIGEST_KEY="<key>" node tools/daily-report.js
     ```
     (run from the `launch-dashboard` folder) → `Sabeer-Daily-YYYY-MM-DD.pdf`. Renders the branded
     report via headless Chrome — logo, colored status chips, numbered initiatives, no browser header/footer.
   - **From the dashboard (quick):** click **Download PDF** → a print-ready tab opens → in the print
     dialog set **Background graphics ON** and **Headers/footers OFF** → **Save as PDF**. Same layout.

## Past-day report
Updates are retained **60 days**. Re-render any past day (shows that day's saved briefs against the
current initiative list):
```
node tools/daily-report.js "<url>" "<key>" 2026-09-10
```
The dated PDFs you keep are the exact per-day snapshots.

## One-time setup (admin)
Set the secrets as encrypted Forge variables (values are never printed back):
```
forge variables set --encrypt -e production LLM_API_KEY <openrouter-key>
forge variables set --encrypt -e production DIGEST_KEY <a-long-random-string>
```
Get the web-trigger URL (interactive — pick the installation → `daily-digest` → production):
```
forge webtrigger
```
Use that URL as `DIGEST_URL` and the same `DIGEST_KEY` value in step 4 above.

## How it fits together
- **Dashboard panel** (`static/compliance/src/App.jsx`) → resolver `getDailyBoard` / `setDailyUpdate` / `generateDrafts`.
- **AI drafts** → `src/report/llm.js` (OpenRouter `anthropic/claude-3.5-haiku`, key = `LLM_API_KEY`).
- **Digest JSON** → secret-keyed web-trigger `src/functions/daily-digest.js` (`?key=DIGEST_KEY`).
- **PDF** → `tools/daily-report.js` builds markdown via `src/report/daily-format.js` and renders with `~/.claude/skills/qc-checklist/brief-to-pdf.js`.

## Notes
- Updates are stored per-epic in the Jira `daily-update` issue property, keyed by date (last 14 days kept).
- "Generate drafts" never overwrites an update Nihad has already edited that day.
- Phase 2 (not yet built): a scheduled ~06:00 pre-draft so boxes are pre-filled before Nihad logs in.
