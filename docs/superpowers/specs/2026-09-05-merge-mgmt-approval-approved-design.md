# Merge "Mgmt Approval" + "Approved" into a single "Management Approval" phase

**Status:** Approved (design) — ready for implementation planning
**Date:** 2026-09-05
**Scope:** launch-dashboard Forge app (Quality Check Tracker) — Feature QC framework only
**Author:** PM (Shaaran) + Claude

## 1. Problem / goal

The Feature QC framework has two adjacent late-stage phases that, in practice, are one
decision point at Zil Money:

- **Mgmt Approval** (`phase-mgmt-approval`, position 9, owner Management) — the management
  go/no-go review.
- **Approved** (`phase-approved`, position 10, owner Eng Lead) — release preparation.

Several of the "Approved" release-prep items (deployment runbook, change-management ticket) do
not fit the real OCW workflow, where **deployment is "merge to the production branch and the
CI/CD pipeline handles the rest"** (rollback = revert the merge commit + re-run the pipeline).

**Goal:** merge the two into a single **"Management Approval"** phase with a realistic 8-item
checklist, reducing the Feature framework from **16 → 15 phases**, and migrate the epics that are
already provisioned so the whole tracker is consistent.

## 2. Decisions (locked)

| Decision | Choice |
|----------|--------|
| Merged phase name | **Management Approval** |
| Surviving label | **`phase-mgmt-approval`** (retire `phase-approved`) |
| Owner | **Management / Eng Lead** |
| COO sign-off | keep **one** COO sign-off item |
| Existing epics | **Migrate all** provisioned feature epics |
| Retire the old Approved story | **Close + de-`qc-phase`-label** (NOT delete) |

## 3. Merged checklist (8 items)

| # | Item | Owner |
|---|------|-------|
| 1 | Business case and KPI targets reviewed against what was actually built | PM |
| 2 | Risk assessment reviewed | Eng Lead / PM |
| 3 | Budget / resourcing impacts reviewed, if applicable | Finance / PM |
| 4 | Go/no-go decision documented with a named approver | Management |
| 5 | Release notes drafted | PM |
| 6 | Release approach confirmed — merge to the production branch triggers the CI/CD pipeline (no manual runbook/change ticket); rollback = revert the merge commit + re-run the pipeline | Eng Lead |
| 7 | Final legal/compliance review scheduled, linked to Compliance Sign-off | PM / Legal |
| 8 | COO (or delegate) sign-off recorded — by name and date | COO |

**Dropped** from the raw union: "Deployment runbook prepared", "Change-management ticket filed".
**Merged**: old rollout-plan + rollback-plan → item 6.

## 4. Code changes

### 4.1 `static/compliance/src/framework.js`
- `FEATURE_PHASES`: remove the `{ name: 'Approved', … }` entry; change the `{ name: 'Mgmt Approval',
  owner: 'Management', … }` entry to `{ name: 'Management Approval', owner: 'Management / Eng Lead',
  items: [ …the 8 items… ] }`. (Each item is `{ txt, owner }`; item 8 is the shared `COO` constant.)
- `FEATURE_LABELS`: remove `"phase-approved"`; keep `"phase-mgmt-approval"` in its position.
- Both arrays end at **15** entries and remain index-aligned.
- **No other change.** `buildPhases` maps `defs[i] ↔ labels[i]` by position and looks up each story
  by `pbl[labels[i]]` (label-based). The synthetic QA-Rework phase is inserted with
  `out.findIndex(p => p.label === "phase-qa-passed")` (label-based) and sits *before* the merged
  phase, so it is unaffected. `awaitCOO` and the master-tracker rendering are label/derived — no
  numeric-index dependency on positions 9/10.

### 4.2 `src/triggers/provision.js`
- Apply the same edit to its `FEATURE_PHASES` array (drop `Approved`, rename Mgmt Approval →
  Management Approval, set the 8 items). New epics provision **15** phase-stories: one
  `phase-mgmt-approval` labelled story, no `phase-approved`.

### 4.3 qc-checklist skill (`~/.claude/skills/qc-checklist/SKILL.md`)
- "Framework — Feature (16 phases)" → **15**.
- Merge sections **9. Mgmt Approval** and **10. Approved** into a single **9. Management Approval**
  with the 8 items above (owner Management / Eng Lead).
- Renumber sections 11–16 → 10–15.
- Remove `phase-approved` from the "Phase labels (story → phase)" Feature list.
- Update any other "16 phases" references for Feature.

## 5. Migration of existing feature epics (one-time, dry-run first)

Target: every `labels = feature` epic that has both a `phase-mgmt-approval` and a `phase-approved`
`qc-phase` child story.

For each such epic:

1. **Fold Approved → Management Approval.** Rewrite the `phase-mgmt-approval` story:
   - Rename to `Management Approval — <epic summary>`.
   - Set the checklist (Gebsun `customfield_10051`) to the 8-item merged list, **carrying over
     state** via this mapping (0-indexed within each source story's parsed items):

     | Merged item | Source → state carried |
     |-------------|------------------------|
     | 1 Business case/KPI | Mgmt #0 |
     | 2 Risk | Mgmt #1 |
     | 3 Budget | Mgmt #2 |
     | 4 Go/no-go | Mgmt #3 |
     | 5 Release notes | Approved #0 |
     | 6 Release approach | `done` iff **both** Mgmt #4 (rollout) and Approved #1 (rollback) were done, else `open` (skipped iff both skipped) |
     | 7 Legal/compliance scheduled | Approved #4 |
     | 8 COO sign-off | `done` iff **either** Mgmt #5 or Approved #5 was done |

     Dropped source items (Approved #2 runbook, Approved #3 change-mgmt ticket) are discarded.
   - **Carry epic-meta notes/mappings.** In the epic's `qc-compliance` issue property, re-key any
     `"<mgmtStory>:<idx>"` and `"<approvedStory>:<idx>"` note/task entries to
     `"<mgmtStory>:<newIdx>"` per the mapping above (Approved-sourced notes move onto the merged
     story; dropped-item notes are discarded).
   - Write via the **safe path**: PUT `customfield_10051`, then let Gebsun regenerate
     `customfield_10097`; if Gebsun does not re-render, regenerate `10097` faithfully from `10051`
     (preserve `inlineCard`/link nodes as their issue key; each item one line). Verify per epic.

2. **Retire the Approved story:** transition it to a Done-category status and remove its `qc-phase`
   label so the dashboard ignores it. **Do not delete.** (Deletion only on explicit request.)

3. **Verify** the epic now shows 15 phases, Management Approval has the 8 items with carried state,
   and the Approved story is retired.

Migration is executed via the authenticated Jira REST API in-page (Atlassian MCP is ungranted this
session), mirroring the COO-cleanup method: **dry-run report first** (list epics + planned changes),
apply on approval, verify after.

## 6. Testing / verification

- **Unit-ish / smoke:** build (`npm run build` in `static/compliance`), `forge deploy -e production
  --no-verify`. Create a throwaway `feature` test epic → confirm it provisions **15** phase-stories,
  the `phase-mgmt-approval` story is "Management Approval" with the 8 items, there is no
  `phase-approved` story, and the QA-Rework synthetic phase still inserts between In QA and QA
  Passed when rework exists.
- **Migration:** dry-run output reviewed → apply → per-epic verification (15 phases, merged
  checklist + carried state, Approved retired). Spot-check one epic's notes carried across.
- **Regression:** confirm non-merged phases and Bug epics are unchanged; dashboard "phases
  complete" %, master-tracker rows, and per-item notes render.
- Clean up the throwaway test epic afterward.

## 7. Risks & rollout

- **Bug framework unaffected** — only the Feature framework/labels change.
- **Gebsun rendering fragility** — the migration edits Gebsun checklists; use the safe
  10051→render path and verify each epic (per the COO-cleanup lessons).
- **Display numbering shifts** (Compliance 11→10, etc.) — cosmetic; all logic is label-based.
- **`phase-approved` retired** — no known external consumer; orphaned old stories are closed +
  de-labelled, recoverable (not deleted).
- **Already-provisioned-but-empty epics** (e.g. OCW-23272 has `feature` but 0 phases) are not in
  scope for the fold step (nothing to migrate); they'll provision the new 15-phase shape when
  provisioned.

## 8. Out of scope

- Deleting the retired Approved stories (only on explicit request).
- Any Bug-framework change.
- The other open items from the same note ("checklists not visible to all members", "items not
  labelled For Management Review") — tracked separately.
