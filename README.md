# JIRA Quality Check Tracker

An [Atlassian **Forge**](https://developer.atlassian.com/platform/forge) app that turns a Jira project into a **Quality-Check (QC) delivery tracker**. Every feature/bug **Epic** is auto-provisioned with a set of **phase stories** (a checklist per phase), and the app renders a dashboard that rolls those phases up into one at-a-glance board — stage progress, checklist completion, sign-offs, blockers/ETAs, and a daily digest.

> This repo is the tracker **code only**. It is designed so you can clone it, point it at **your own Atlassian/Jira site**, and run your own instance. Nothing here is site-specific except a few custom-field IDs you remap (see **Configure → Jira custom fields**).

---

## What's in the box

| Module (manifest) | What it is | Resource / handler |
|---|---|---|
| `jira:globalPage` — **Quality Check Tracker** | The main dashboard (Custom UI, React + Vite) | `static/compliance/` → `compliance-resolver` (`src/resolvers/compliance.js`) |
| `jira:dashboardGadget` | Epic launch-status gadget for a Jira dashboard | `static/dashboard/` → `resolver` (`src/index.js`) |
| `trigger` **qc-provision** | On Epic create/update, provisions the phase stories + checklists | `src/triggers/provision.js` |
| `trigger` **qc-qa-rename** | QA status-rename automation | `src/triggers/qarename.js` |
| `webtrigger` **daily-digest** | Generates the daily status digest | `src/report/*` |

**Phase model.** New epics are provisioned with the **4-phase model — Define → Build → Deploy → Verify** (for both `feature` and `bug`). The legacy 16-phase (feature) / 7-phase (bug) definitions are retained so epics created before the switch still render correctly; `static/compliance/src/framework.js` picks the model per-epic from its phase labels.

---

## Prerequisites

- **Node.js** — a Forge-CLI-supported version. ⚠️ The Forge CLI currently **rejects Node 24.17.0**; use **Node 20.18.x–22.x** (e.g. 22.x LTS).
- **Forge CLI** — `npm install -g @forge/cli`
- An **Atlassian account** with admin on a **Jira Cloud** site, and a Forge API token (`forge login`).
- *(Optional)* The **"Checklist for Jira Pro" (Gebsun)** Marketplace app if you want the rich checklist rendering on the phase stories. The app also works with the plain checklist-text field.

---

## Setup (clone → your own site)

```bash
# 1. Clone
git clone https://github.com/sharan-ux/JIRA-QUALITY.git
cd JIRA-QUALITY

# 2. Install app deps
npm install

# 3. Log in to YOUR Atlassian account
forge login

# 4. Register the app under YOUR account.
#    This creates a NEW app id and rewrites `app.id` in manifest.yml.
#    (The committed manifest points at the original author's app — you MUST re-register.)
forge register

# 5. Build the Custom UI bundles (they are NOT committed — see .gitignore)
cd static/compliance && npm install && npm run build && cd ../..
cd static/dashboard  && npm install && npm run build && cd ../..

# 6. Deploy + install
forge deploy -e development
forge install -e development          # choose Jira → pick your site
```

Then in Jira: open **Apps → Quality Check Tracker** for the dashboard, and add the **Epic launch-status gadget** to any Jira dashboard.

> **Deploy gotcha:** the dashboard is a **Vite Custom UI**. After editing anything under `static/compliance/src` or `static/dashboard/src`, you must **re-run `npm run build`** in that folder *before* `forge deploy` — Forge ships the pre-built `dist/`, so skipping the build deploys stale UI.

---

## Configure

### Jira custom fields (required — these are per-site)
The resolver reads/writes Jira custom fields **by ID**, and those IDs differ on every Jira site. Map them to **your** field IDs:

- **`src/resolvers/compliance.js`** → the `CF` map:
  `text` (checklist text, `customfield_10051`), `progress` (`…10094`), `pct` (`…10095`), `tested` (`…10052`), `deployPerson` (`…10598`), `deployDate` (`…10065`), `mgmt` (`…10602`), `severity` (`…10091`), `approvers` (`…10003`).
- **`src/triggers/provision.js`** → `CHECKLIST_TEXT` (`customfield_10051`).

Find your IDs in Jira: **Settings → Issues → Custom fields** (or `GET /rest/api/3/field`), then update the constants above.

### How provisioning triggers
Label an **Epic** `feature` or `bug` → the `qc-provision` trigger creates the phase stories (each labelled `qc-phase` + its `phase-*` label) and writes the phase checklist into the checklist-text field. Idempotent via the `qc-provisioned` issue property.

### Optional: daily-digest LLM
The daily digest can draft summaries via OpenRouter (external fetch is allowlisted to `openrouter.ai` in `manifest.yml`). Provide the key as a **Forge environment variable**, never in the repo:
```bash
forge variables set --encrypt OPENROUTER_API_KEY <your-key>
```

---

## Project layout

```
manifest.yml                     # Forge modules, resources, permissions, app id
src/
  index.js                       # dashboard-gadget resolver
  resolvers/compliance.js        # main dashboard resolver (phases, notes, blockers, digest)
  resolvers/checklist-parse.mjs  # pure checklist parser (+ .test.mjs)
  triggers/provision.js          # phase definitions + epic auto-provisioning
  triggers/qarename.js           # QA status rename automation
  report/                        # daily digest (format + LLM draft)
static/
  compliance/                    # Custom UI — the Quality Check Tracker (React + Vite)
  dashboard/                     # Custom UI — the dashboard gadget
test/                            # tests  (run: npm test)
docs/                            # design specs / plans
```

## Tests
```bash
npm test          # node --test (includes the checklist-parse unit tests)
```

---

## Notes
- **Permissions** (see `manifest.yml`): `read/write:jira-work`, `read:jira-user`, `storage:app`, external fetch → `openrouter.ai`.
- App data (per-item notes, task mappings, blocked/skip state, digest history) is stored in **Jira issue properties** + **Forge storage** — no external DB.
- Secrets never live in this repo: `.env`, `.forge/`, and build `dist/` are git-ignored.
