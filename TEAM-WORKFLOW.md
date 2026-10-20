# Launch Status Dashboard — Team Workflow & Label Guide

_For scrum masters to teach developers / QA / BA. Everything here is read **live** from Jira —
if the dashboard looks wrong, it's because a label, status, or date below is missing on a ticket._

---

## 0. The one rule that governs everything

The dashboard shows **Epics created on/after 2026-07-01 that carry the label `EPIC`**, and rolls up
the **child tasks** linked to each of those epics. If a ticket doesn't follow the three rules below,
it is **invisible** to the dashboard:

1. **Epics** must have issue type **Epic** + the label **`EPIC`** (all caps).
2. **Tasks** must be linked to their epic — either as a **child (parent = epic)** or via **Epic Link**.
3. Everything must be **created on/after 2026-07-01** (older tickets are intentionally excluded).

---

## 1. Labels to give the team

⚠️ **Labels are case-sensitive and exact.** `backend` ≠ `Backend`. Copy them exactly as written.
Jira labels **cannot contain spaces** — that's why "Complaints Check" is written with a hyphen.

### A. Epic marker (put on every epic)

| Label  | Where            | Purpose                              |
|--------|------------------|--------------------------------------|
| `EPIC` | On each **Epic** | Makes the epic appear on the board.  |

### B. Discipline labels (put **one** on each task)

Each task belongs to **one discipline**. The discipline label decides which **column / flow node /
detail tab** the task shows under. Use exactly one of the accepted spellings per row:

| Discipline (column)  | Accepted labels (exact case)              | Notes                          |
|----------------------|-------------------------------------------|--------------------------------|
| BA / Definition      | `BA` · `BusinessAnalyst`                   |                                |
| UI/UX                | `UI/UX`                                    |                                |
| Backend              | `Backend` · `Dev-A` · `Dev-B`             | Dev-A / Dev-B = sub-teams       |
| Frontend             | `Frontend` · `flutter`                     | `flutter` for the mobile app    |
| **Complaints Check** | **`Complaints-Check`** _(standardize on this one)_ | NEW gate — see §4     |
| Knowledge            | `knowledge`  _(lowercase)_                 |                                |
| BA Review            | `ba-review` · `stage9-ba-review`  _(lowercase)_ | Feeds the "BA review pending" tile |

> **If a task ever carries two discipline labels, the *later* stage wins** (e.g. a task with both
> `Backend` and `Complaints-Check` counts as Complaints Check). To keep counts clean, give each
> task exactly one discipline label — see §4 for the recommended approach.

---

## 2. The pipeline = the task's STATUS (not a label)

The **"Epic progress by stage"** columns are driven by each task's **workflow status**, not a label.
Use these **exact status names** in the project workflow so tasks land in the right column:

| Pipeline column     | Statuses that map to it              |
|---------------------|--------------------------------------|
| **To Do**           | `To Do` · `Backlog` · `PLANNING` · `Review Failed` |
| **In Progress**     | `In Progress` · `On-Hold`            |
| **QA scheduled**    | `Completed`                          |
| **In QA**           | `In QA` · `Testing`                  |
| **QA passed**       | `QA Pass`                            |
| **Mgmt approval**   | `Waiting for Management Approval`    |
| **Approved**        | `Management Approved`                |
| **Done**            | `Done`                               |

> Any status **not** in this list falls into **In Progress** (or **Done** if Jira marks its category
> as "done"). So stick to these names — inventing a new status silently dumps tasks into In Progress.

---

## 3. Standard task lifecycle (teach this to every developer)

For a normal feature task, front **and** back end, the status walk is:

```
To Do → In Progress → Completed → In QA → QA Pass → [Mgmt approval] → Done
         (dev work)   (dev done,  (QA is  (QA        (see §4a if       (deployed /
                       ready 4 QA) testing) passed)    required)         closed)
```

**Management-approval gate (§4a) sits between QA Pass and Done** for tasks that need sign-off.

Rules the developer owns on their own ticket:

1. **Add the discipline label** (`Backend`, `Frontend`, …) the moment the task is created.
2. **Set a Due date** on every task — the dashboard's "Due this week" tile and the Teams reminders
   both rely on it. No due date = the task is invisible to reminders.
3. **Move the status** as work progresses — don't leave a finished item sitting in "In Progress".
4. When you hand off for QA, move to **`Completed`** (shows as *QA scheduled*), then QA moves it to
   **`In QA`** → **`QA Pass`** → **`Done`**.
5. If a review bounces the task back, QA/lead sets **`Review Failed`** — this is what the scorecard
   counts as a **rework** against the assignee (see §6). Fix it and move it forward again.

---

## 3a. Management approval gate (between QA Pass and Done)

Every task has a **Management Approval** field, defaulting to **Not required**. It controls whether the
task must be signed off by a manager before it can be closed:

- **Not required (default):** the task skips the gate entirely and flows `QA Pass → Done` as normal.
- **Required:** when the task reaches **`QA Pass`**, it **auto-moves** to
  **`Waiting for Management Approval`** and the managers get pinged in Teams. A manager moves it to
  **`Management Approved`**, and only then can it go to **`Done`**. If anyone tries to mark it **Done**
  early, it's automatically **bounced back** to *Waiting for Management Approval* with a comment.

**To require sign-off on a task:** set **Management Approval = Required** (editable at any status —
in QA, QA Pass, anywhere). You can also flip it back to *Not required* mid-flight to release a gated task.

> Managers approve in Jira by moving the task **Waiting for Management Approval → Management Approved**.

---

## 4. Complaints Check — the new gate (after Backend/Frontend, before deploy)

**When:** after backend + frontend work is built and before it goes to deploy, the epic needs a
Complaints-Check pass.

**Recommended approach — a dedicated task per epic** (keeps the other discipline counts clean):

1. Create a task under the epic titled e.g. *"Complaints Check — <feature>"*.
2. Label it **`Complaints-Check`**.
3. Give it a **Due date** and an **Assignee** (whoever runs the check).
4. Walk it through the normal statuses (`To Do → In Progress → … → Done`).

It will then appear in the **Complaints Check** column, the **Flow** node (red), and the epic's
**detail tab**.

> Alternative: if you instead just **add** the `Complaints-Check` label to an existing Backend/Frontend
> task, that task will *move out* of the Backend/Frontend count into Complaints Check (later stage wins).
> Prefer the dedicated task so nothing disappears from earlier columns.

**Action for the team:** pick the single label spelling **`Complaints-Check`** and use it everywhere.
(The dashboard also accepts `ComplaintsCheck` / `Complaints_Check` as a safety net, but standardizing
on one keeps reports clean — tell me the final choice and I'll lock the code to just that one.)

---

## 5. Epic-level upkeep

- Each epic needs the **`EPIC`** label and a **Due date**.
- Changing an epic's due date is tracked automatically — the epic detail panel shows the full
  **due-date change history** (left → right). No action needed; just be aware changes are visible.
- An epic shows as **Done** only when Jira marks the epic itself done.

---

## 6. Team assessment (people scorecard) — what feeds each person's grade

The scorecard reads **all non-epic tasks created since 2026-07-01**. Everyone is graded
against **the role they do most** — developers on rework/lateness, **testers on on-time QA**.

| Metric      | How it's earned                                                        |
|-------------|------------------------------------------------------------------------|
| **Role**    | Auto-detected from activity: most **assigned** → their top label; most **tested** → **Tester (QA)**; most in Approvers → **Reviewer**. |
| **Assigned/Done** | Count of tasks where they are the **Assignee**.                  |
| **Clean**   | Done, on time, and never bounced to `Review Failed`.                    |
| **Reworks** | Number of times their task was moved into **`Review Failed`**.          |
| **Late**    | Done **after** the due date, or still open **past** the due date.       |
| **Tested**  | Tasks where they are set in the **"Tested By"** field.                  |
| **⚠ Late QA** | Tasks they tested that cleared QA **after** the due date (tester's yardstick). |
| **Reviewed**| Tasks where they are in the **"Approvers"** field.                      |
| **Deployed**| _Not live yet_ — needs a "Deployment Person" custom field (see §7).     |
| **Grade**   | Developers: 🟢 no reworks/late · 🟡 a few · 🔴 many. Testers: same, but on **Late QA**. |

**How a tester's grade is computed:** for each task they're set as **Tested By**, we compare when
it **cleared QA** (moved to **`QA Pass`**, or its resolution date) against the task's **due date**.
On/before due = on-time; after = a Late QA. Grade = 🟢 none late · 🟡 a few · 🔴 many.

So for accurate people data, the team must:
- Always set the **Assignee**.
- Set **due dates** on every task (drives Late **and** the tester's on-time QA).
- Use **`Review Failed`** when sending work back (drives Reworks).
- Move tasks to **`QA Pass`** when QA passes them (this timestamps QA turnaround for the tester grade).
- Fill **"Tested By"** (QA) and **"Approvers"** (reviewer) on each task — **without "Tested By", a tester earns nothing on the scorecard.**

---

## 7. Known gaps / admin to-dos

- **"Deployed" column is always 0** until a **"Deployment Person"** custom field is created in Jira and
  its field ID is added to the code. Create the field, tell me the ID, and I'll wire it in.
- Confirm the **exact Complaints-Check label** (§4) so I can trim the accepted spellings to one.
- Confirm the project's workflow actually has these statuses: `Completed`, `In QA`, `QA Pass`,
  `Review Failed`. If any are named differently, tell me and I'll remap (§2).

---

## 8. Scrum-master checklist (say this in standup)

- [ ] New epic? → type **Epic**, label **`EPIC`**, set a **due date**.
- [ ] Every task has **one discipline label** + an **assignee** + a **due date**.
- [ ] Statuses moved to match reality (esp. `Completed` → `In QA` → `QA Pass` → `Done`).
- [ ] Backend/Frontend built? → create/label the **`Complaints-Check`** task before deploy.
- [ ] Bounced work uses **`Review Failed`** (never a custom "rejected" status).
- [ ] QA fills **Tested By**; reviewer set in **Approvers**.
