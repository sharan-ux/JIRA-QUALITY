# Quality Check Tracker ZilMoney — Team Handbook

How every epic flows through its Quality-Check (QC) phases, and how the team uses the
**Quality Check Tracker** (Jira → **Apps → Quality Check Tracker**).

It is built on the Zilmoney QC Compliance framework: every epic must clear each phase's
checklist (and its sign-offs) before it moves forward — the tracker makes that visible and hard to skip.

---

## 1. The two tracks

Every tracked item is an **Epic**, labelled as one of:

| Track | Epic label | Phases | Framework |
|---|---|---|---|
| **Feature** | `feature` | 16 | Product Development & Launch QC |
| **Bug** | `bug` | 7 | Bug-Fix QC |

**Feature phases (16):** Knowledge → BA → To Do → UI/UX → Development → QA Scheduled → In QA → QA Passed → Mgmt Approval → Approved → Compliance Sign-off → Deployment → Sales & Support Training → Marketing Training → Done → BA Review.

**Bug phases (7):** Triage / To Do → In Progress → QA Scheduled → In QA → QA Passed → Deployment → Done.

Each **phase is a Story** under the epic. Each phase-Story carries **that phase's checklist**
(the compliance items) and holds the **sub-tasks** for the actual work in that phase.

```
Epic (feature/bug)
 └─ Story  = one per phase   (carries the phase checklist)
      └─ Sub-tasks           = the individual work items in that phase
```

---

## 2. Reference — Labels

| Label | Put on | Meaning |
|---|---|---|
| `feature` | Epic | This epic follows the 16-phase Feature framework |
| `bug` | Epic | This epic follows the 7-phase Bug framework |
| `EPIC` | Epic | Legacy tracked-epic marker (kept; both old + new dashboards read it) |
| `qc-phase` | Story | Marks a story as a phase-story (the tracker reads these) |
| `phase-<x>` | Story | Which phase the story is. One per story. |

**Phase labels** (`phase-<x>`):

- **Feature:** `phase-knowledge` `phase-ba` `phase-todo` `phase-uiux` `phase-development` `phase-qa-scheduled` `phase-in-qa` `phase-qa-passed` `phase-mgmt-approval` `phase-approved` `phase-compliance` `phase-deployment` `phase-sales-support` `phase-marketing` `phase-done` `phase-ba-review`
- **Bug:** `phase-triage` `phase-in-progress` `phase-qa-scheduled` `phase-in-qa` `phase-qa-passed` `phase-deployment` `phase-done`

**Discipline labels** (used when mapping *existing* stories to a phase):

| If a story is labelled… | it maps to phase |
|---|---|
| `BusinessAnalyst` | `phase-ba` |
| `UI/UX` | `phase-uiux` |
| `Backend`, `Frontend`, `flutter` | `phase-development` |

> Labels are exact and cannot contain spaces.

---

## 3. Reference — Custom fields

**New fields created for QC sign-off** (on the phase-Story):

| Field | Field ID | Type | Used for |
|---|---|---|---|
| Sign-off By | `customfield_10603` | User | Who signed off this phase (generic) |
| Sign-off Date | `customfield_10604` | Date | When it was signed off |
| COO Sign-off By | `customfield_10605` | User | COO / delegate who signed off |
| COO Sign-off Date | `customfield_10606` | Date | When the COO signed off |

**Existing fields reused for specific phases:**

| Phase | Field reused |
|---|---|
| QA phases | **Tested By** (`customfield_10052`) |
| Deployment | **Deployment Person** (`customfield_10598`) + **Deployment Date** (`customfield_10065`) |
| Mgmt Approval | **Management Approval** (`customfield_10602`) |
| Bug severity | **Severity** (`customfield_10091`) |

**Checklist fields (Gebsun "Checklist for Jira | Pro"):** the tracker reads
`Checklist Progress %` (`customfield_10095`) and `Checklist Progress` "n/m" (`customfield_10094`);
checklists are written on story creation via **Checklist Text** (`customfield_10051`).

**Per-item mappings & notes** are stored as a JSON issue **property** `qc-compliance` on each epic
(not a custom field) — this is what powers "map a task to an item" and "add a note".

---

## 4. How the team uses it

### 4.1 Start a new feature or bug
1. Create an **Epic**.
2. **Add the label `feature` or `bug` when you create it.** ⚠️ The label must be present at creation.
3. Within seconds the system auto-creates **one Story per phase**, each with its **checklist** attached.

### 4.2 Existing epics (created before this system)
1. Add the `feature` / `bug` label to the epic (it then appears in the tracker).
2. It won't auto-create the phase-stories (only new epics do). Use the **`+ create phase`** button
   in the tracker (Section 5) to create any missing phase's story + checklist on demand.

### 4.3 Work a phase
- Open the phase-Story. Do the work as **sub-tasks** under it.
- **Complete each checklist item** one of these ways:
  1. **Tick it** in the Checklist panel on the story, **or**
  2. **Map a task** to the item in the tracker — when that task is *approved* (Done), the item is cleared and shows the approver, **or**
  3. **Add a note** to the item in the tracker → a popup asks *"Save the comment and mark this checklist item as completed?"* → choose **Save & mark completed** (clears the item, stamps your name + date) or **Just save comment** (evidence only, stays open). Every note is also posted as a **comment on the epic** for visibility.
- **Sign off** the phase in the sign-off fields (owner + COO where required).

### 4.4 The gate rule
A phase is not "done" until **every checklist item is complete AND the required sign-offs are recorded**
(owner sign-off; **COO sign-off** on every Feature phase, and on Critical/High Bug deployments).
Don't advance an item past a phase whose checklist/sign-offs are incomplete.

---

## 5. Reading the dashboard

Open **Jira → Apps → Quality Check Tracker** (star it ★ for one-click access in the sidebar).

**Tabs:** **Features · 16 phases** and **Bugs · 7 phases**.

**Tiles (top):** Total items · In progress · Blocked on a gate · Awaiting COO sign-off · Completed.

**Master Tracker (cockpit) — one row per item:**

| Column | What it tells you |
|---|---|
| Item | Epic key (click ↗ to open in Jira) + summary |
| Type | Feature, or Bug severity (Critical/High/Medium/Low) |
| Phase pipeline | One segment per phase — **green** = done, **amber** = current, **grey** = to-do, **red** = blocked |
| Current phase | The phase the item is sitting in |
| % complete | How many phases are done |
| Overall status | In Progress / Blocked / Complete |
| Next gate | Who owns the current phase (the next sign-off) |

**Click a row → the drill-down drawer** shows that item's full **Master Sign-off Tracker**:
- One block per phase: phase name, its **Story ID** (click ↗), % + status, **approver name + date**, **COO name + date**.
- Phases with no story yet show a **`+ create phase`** button.
- **Expand a phase** to see its **checklist items**, each with:
  - a **✓** when complete, the **owner** role, and who cleared it (approver / note author + date),
  - **🔗 map task** — link a task to the item,
  - **💬 add note** — add evidence / justification (with the complete-or-not popup).

---

## 6. Roles & who signs off

| Phase | Owner (sign-off) |
|---|---|
| Knowledge | Marketing / Sales / Support Leads |
| BA | BA |
| To Do | PM / Eng Lead |
| UI/UX | Design Lead |
| Development | Eng Lead |
| QA Scheduled / In QA / QA Passed | QA / QA Lead |
| Mgmt Approval | Management |
| Approved | Eng Lead |
| Compliance Sign-off | Compliance |
| Deployment | DevOps |
| Sales & Support Training | Sales Lead / Support Lead |
| Marketing Training | Marketing Lead |
| Done | PM |
| BA Review | BA |
| *(every Feature phase)* | **+ COO (or delegate) sign-off** |

Bug phases use the same names where they overlap; COO sign-off is required only for **Critical/High** bugs at Deployment.

---

## 7. FAQ / gotchas

- **The label must be added when the epic is created** for auto-provisioning. If you label an existing epic later, use **`+ create phase`** to backfill.
- **Notes stamp your name automatically** (read from your own Jira session) and post a comment on the epic.
- **An item counts as complete** if it's ticked in the checklist, **or** its mapped task is approved, **or** a note marked it completed.
- **Marking a note "completed"** shows it done in the dashboard and records who + when; it does not tick the Gebsun checkbox on the story panel itself (dashboard is the compliance view).
- **Bug epics that are "buckets"** of many unrelated fixes don't map cleanly to the 7-phase per-fix model — prefer one epic per real bug fix.
- **Phase labels are shared across tracks** (e.g. `phase-qa-scheduled` exists in both) — the checklist content differs by track and is set automatically per epic.
