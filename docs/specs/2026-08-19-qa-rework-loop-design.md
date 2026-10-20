# QA Rework Loop — Design Spec

**Date:** 2026-08-19
**App:** Quality Check Tracker (Forge) — `ari:cloud:ecosystem::app/e3c9c070-2b19-4f78-a633-52657ad68faf`
**Scope:** OCW project only
**Status:** Approved design — pending spec review, then implementation plan.

---

## 1. Problem

When QA tests a story and it fails, there is today no structured hand-back to the developer. The team wants a
tracked, multi-round loop: QA records the defects as a checklist, the system hands those defects to the
developer as rework, notifies the right people at each hop, and repeats until QA passes — with the round
history preserved on both stories.

## 2. Goal / expected behavior

A closed loop between the epic's **In-QA phase-story** (QA side) and its **Development phase-story** (dev
side; for a Bug epic the dev side is the **In Progress** phase-story):

1. QA writes the defects as a fresh checklist block on the In-QA story and sets its status to **QA Failed**.
2. The system copies that block to the Dev story as **QA Rework N**, moves the Dev story to **QA Rework**,
   and comments the Dev story mentioning the **developer** (Dev story assignee).
3. The developer fixes each item and ticks all items in the `QA Rework N` block. Hitting 100% auto-transitions
   the Dev story to **Ready for QA**.
4. The system comments the In-QA story mentioning the **QA tester** (In-QA story assignee) that round N is
   done, and moves the In-QA story back to **In QA** for retest.
5. Retest fails → round **N+1** repeats the loop. Retest passes → QA moves the story to **QA Pass** (existing
   flow); the system posts a short "closed after N rounds" summary and clears the loop state.

Round numbering is owned by the system, not the tester — a wrong/missing number in the tester's heading cannot
break the loop.

## 3. Decisions (locked)

- **Real Jira statuses**, not labels. Three new: `QA Failed`, `QA Rework`, `Ready for QA`. OCW only.
- **Round numbering:** automation-owned, tracked in `storage:app` keyed per epic. Tester's numbering ignored.
- **Done signal:** ticking all `QA Rework N` items → auto-transition Dev story to `Ready for QA` (checklist
  completion drives the status change).
- **Pair:** In-QA phase-story ↔ Development phase-story (Bug: In-QA ↔ In Progress). Mentions target each
  story's own **assignee**, posted in each story's own comment section.
- **Implementation:** entirely inside the Forge app (only Forge can copy a Gebsun checklist block via ADF
  manipulation). No native Jira Automation rules.
- **Dashboard rework-round badge:** deferred to v1+.

## 4. Prerequisite — workflow configuration (Jira admin, one-time)

Forge can *move* an issue into a status only if the workflow has a transition into it; it cannot create
statuses or transition arrows. So before the app can run, OCW's **Story** workflow must gain:

| New status | Category | Transitions to add |
|---|---|---|
| **QA Failed** | To Do (red) | `In QA → QA Failed` (manual, tester); `QA Failed → In QA` (system, retest loop-back) |
| **QA Rework** | In Progress | **global transition → QA Rework** (system can set from any dev state) |
| **Ready for QA** | In Progress | `QA Rework → Ready for QA` (system) |

**Task 0 finding (2026-08-19):** OCW's Story issue type runs on the **"Zil Money Workflow"** (scheme
**"Zil Money Workflow Scheme"**, id 10005), which is **shared by 6 projects: ZB, MLAP, PA, OCW, OV2, ZRV**.
All OCW issue types map to that single workflow. Phase-stories are `Story` type — same as ordinary stories —
so the loop cannot be isolated by issue type. Options for the admin config (user decides):

- **Option A — add the 3 statuses + transitions to the shared "Zil Money Workflow".** Lowest admin effort;
  OCW stays on the shared workflow. Cost: the 3 statuses appear in the status list for all 6 projects (unused
  there — the Forge trigger acts on OCW only). Boards don't break automatically (new statuses land unmapped
  until a board admin maps a column), but the statuses are visible cross-project.
- **Option B — give OCW its own workflow scheme** (a copy of "Zil Money Workflow" + the 3 statuses), remapped
  for OCW's Story type only. Clean isolation; cost: OCW diverges from the shared workflow, so future shared
  changes won't auto-apply to OCW, and existing OCW issues migrate to the new scheme.

No workflow change is made without explicit user approval; this is a Jira-admin action, not performed by the
implementation plan.

## 5. Architecture

New trigger module `qc-qa-loop` on `avi:jira:updated:issue`, handler in `src/triggers/qaloop.js`. It reuses
the existing `cf10051` ADF read/append/flip helpers (today in `provision.js` / `compliance.js`).

### 5.1 Detection (per event)
Load the issue (key, project, issuetype, labels, status, parent epic, assignee, `cf10051`). Proceed only for
OCW `qc-phase` stories. Then:

- **FAIL branch** — labels include `phase-in-qa` **and** status is now `QA Failed` → fail handler.
- **DONE branch** — labels include `phase-development` (Bug: `phase-in-progress`) **and** status is
  `QA Rework` **and** the `QA Rework N` block is **100% ticked** → done handler.
- Otherwise ignore.

Dev-side label is chosen from the epic's `feature` / `bug` label.

### 5.2 State model — `storage:app`
Key `qaloop:<epicKey>` →
```
{ round: N, phase: 'idle'|'failed-copied'|'rework-done'|'resolved',
  qaStoryKey, devStoryKey, history: [{ round, items[], failedAt, reworkDoneAt }] }
```
Idempotency guards (separate keys) `qaloop:<epic>:<round>:failed` and `qaloop:<epic>:<round>:reworkdone`
prevent a duplicate / at-least-once event from double-copying or double-commenting.

### 5.3 Checklist copy
`cf10051` is one ADF doc holding repeated **heading + item-list** blocks.
1. Read the In-QA story's `cf10051`. Identify the **current-round block** = the newest checklist group whose
   items are not yet round-stamped. If several unstamped blocks exist, **merge** their items into round N.
2. **Stamp** it: rename that heading on the In-QA story to `QA Failed N` (write back `cf10051`).
3. Build a `QA Rework N` block (same item texts, all `[open]`) and **append** it to the Dev story's
   `cf10051`, preserving the original Development checklist and any prior rework blocks.

### 5.4 Handlers
- **Fail handler:** copy block → transition Dev story **→ QA Rework** → ADF comment on the **Dev story**
  mentioning `@dev-assignee`: "QA Failed round N — {k} items to rework" + the list. Record round in storage.
- **Done handler:** transition Dev story **→ Ready for QA** → ADF comment on the **In-QA story** mentioning
  `@qa-assignee`: "QA Rework N complete — ready for retest" + the list → transition In-QA story
  **QA Failed → In QA**. Mark round rework-done in storage.
- **Resolve (retest pass):** when the In-QA story reaches `QA Pass` with an active loop, post a short
  "Closed after N round(s)" summary comment on the **In-QA story** and set loop `phase: 'resolved'`.

Transitions are resolved dynamically (look up the transition whose `to.name` matches the target); mentions use
each story's assignee `accountId` via an ADF mention node.

## 6. Edge cases (explicit, none silent)

| Case | Handling |
|---|---|
| No Dev story under the epic | Comment on In-QA story flagging misconfiguration; abort round. |
| Dev story unassigned | Post the rework comment **without** a mention + note "unassigned". |
| QA Failed set with **no** new checklist block | Comment "no defect items found for round N"; abort (don't touch Dev story). |
| Multiple unstamped blocks | Merge all into round N. |
| Duplicate / at-least-once events | Idempotency guards in storage. |
| Gebsun count recompute lag | Non-blocking; detection reads item `[done]` state directly, not the count field. |
| Bug vs Feature | Dev-side phase label chosen from the epic's `feature` / `bug` label. |

## 7. Testing (per the unit-testing skill)

Unit tests with mocked Jira REST for: current-round block extraction, round stamping, copy/append into an
existing `cf10051`, 100%-tick detection, idempotency guards, and each edge case above. Then a **staging run of
a real OCW epic through two full rounds** (fail → rework → retest-fail → rework → retest-pass) before the
feature is called done. Evidence (commands + output) pasted per the skill.

## 8. Files touched

- `manifest.yml` — add `qc-qa-loop` trigger module + function. (Statuses/transitions are Jira config, not
  manifest.)
- `src/triggers/qaloop.js` — **new**: detection, state machine, ADF copy, handlers.
- `src/triggers/provision.js` — export the ADF helpers (`checklistAdf`, block parse) for reuse; no behavior
  change.
- (Deferred v1+) `src/resolvers/compliance.js` + `static/compliance` — a "rework round N" badge on the
  dashboard.

## 9. Out of scope (v1)

- Dashboard rework-round badge (deferred).
- Any project other than OCW.
- Routing defects to individual developer **sub-tasks** (we route to the Development phase-story assignee).
- Auto-creating the empty `QA Failed N` block for the tester (the tester authors the defect items).
