import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { qaVerdict, roleAndGrade } from './scoring.mjs';

const resolver = new Resolver();

const TRACKED_JQL = 'issuetype = Epic AND labels = EPIC AND created >= "2026-07-01"';

// Disciplines = dedicated phase-tasks, identified by label. Pipeline stage (dev/QA/deploy)
// is read from each task's STATUS, not a separate column.
const STAGES = [
  { key: 'def',       name: 'BA / Definition', labels: ['BA', 'BusinessAnalyst'] },
  { key: 'uiux',      name: 'UI/UX',           labels: ['UI/UX'] },
  { key: 'backend',   name: 'Backend',         labels: ['Backend', 'Dev-A', 'Dev-B'] },
  { key: 'frontend',  name: 'Frontend',        labels: ['Frontend', 'flutter'] },
  // ponytail: Jira labels can't contain spaces, so match the likely no-space variants of "Complaints Check"
  { key: 'complaints', name: 'Complaints Check', labels: ['Complaints-Check', 'ComplaintsCheck', 'Complaints_Check'] },
  { key: 'knowledge', name: 'Knowledge',       labels: ['knowledge'] },
  { key: 'bareview',  name: 'BA Review',       labels: ['ba-review', 'stage9-ba-review'] },
];
const LABEL_TO_STAGE = {};
STAGES.forEach((s, i) => s.labels.forEach((l) => { LABEL_TO_STAGE[l] = i; }));
const stageIndexFor = (labels = []) => {
  let best = -1;
  for (const l of labels) { const i = LABEL_TO_STAGE[l]; if (i !== undefined && i > best) best = i; }
  return best;
};

// pipeline order of statuses — lower = earlier. A discipline shows its LEAST-advanced task's
// status (the bottleneck); only shows Done when every task in it is Done.
const STATUS_RANK = {
  'Backlog': 0, 'PLANNING': 0, 'To Do': 0, 'Review Failed': 0,
  'On-Hold': 1, 'In Progress': 1, 'Completed': 2,
  'Testing': 3, 'In QA': 3, 'QA Pass': 4,
  'Waiting for Management Approval': 5, 'Management Approved': 6, 'Done': 7,
};

const STATUS_COLS = ['To Do', 'In Progress', 'Done'];

// pipeline columns for the "by stage" table — rank buckets (see STATUS_RANK) collapsed to 6 stages.
// rank 0=To Do, 1=In Progress, 2=Completed(=QA scheduled), 3=In QA/Testing, 4=QA Pass(=Deploy scheduled), 5=Done
const PIPE_COLS = [
  { key: 'todo',     label: 'To Do',            color: 'grey' },
  { key: 'inprog',   label: 'In Progress',      color: 'blue' },
  { key: 'qasched',  label: 'QA scheduled',     color: 'purple' },
  { key: 'inqa',     label: 'In QA',            color: 'amber' },
  { key: 'deploy',   label: 'QA passed',        color: 'teal' },
  { key: 'mgmtwait', label: 'Mgmt approval',    color: 'red' },
  { key: 'mgmtok',   label: 'Approved',         color: 'teal' },
  { key: 'done',     label: 'Done',             color: 'green' },
];
const PIPE_BUCKET_KEY = ['todo', 'inprog', 'qasched', 'inqa', 'deploy', 'mgmtwait', 'mgmtok', 'done'];
const emptyPipe = () => ({ todo: 0, inprog: 0, qasched: 0, inqa: 0, deploy: 0, mgmtwait: 0, mgmtok: 0, done: 0 });

async function searchAll(jql, fields, expand) {
  const out = [];
  let token;
  for (let p = 0; p < 40; p++) {
    let url;
    if (expand) {
      url = token
        ? route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&expand=${expand}&maxResults=100&nextPageToken=${token}`
        : route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&expand=${expand}&maxResults=100`;
    } else {
      url = token
        ? route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100&nextPageToken=${token}`
        : route`/rest/api/3/search/jql?jql=${jql}&fields=${fields}&maxResults=100`;
    }
    const res = await api.asApp().requestJira(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    (data.issues || []).forEach((i) => out.push(i));
    token = data.nextPageToken;
    if (!token) break;
  }
  return out;
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const endOfWeek = () => {
  const d = new Date();
  const e = new Date();
  e.setDate(d.getDate() + ((7 - d.getDay()) % 7));
  e.setHours(23, 59, 59, 999);
  return e;
};

resolver.define('getDashboard', async () => {
  const epics = (await searchAll(TRACKED_JQL, 'summary,status,duedate')).slice(0, 50);
  const keys = epics.map((e) => e.key);
  const rows = {};
  epics.forEach((e) => { rows[e.key] = { cat: {}, phase: {}, disc: {}, pipe: emptyPipe(), totalOpen: 0, totalAll: 0 }; });

  let children = [];
  if (keys.length) {
    const list = keys.map((k) => `"${k}"`).join(',');
    children = await searchAll(`(parent in (${list}) OR "Epic Link" in (${list}))`, 'status,labels,parent,customfield_10014,duedate,summary');
  }

  const now = startOfToday();
  const eow = endOfWeek();
  let tTotal = 0, tDone = 0, tDue = 0, tBa = 0;
  const dueThisWeek = [];
  const baReviews = [];

  for (const c of children) {
    const epicKey = c.fields?.parent?.key || c.fields?.customfield_10014;
    const r = rows[epicKey];
    const cat = c.fields?.status?.statusCategory?.name || 'To Do';
    const isDone = c.fields?.status?.statusCategory?.key === 'done';
    const idx = stageIndexFor(c.fields?.labels);
    const isBa = idx >= 0 && STAGES[idx].key === 'bareview';
    const due = c.fields?.duedate ? new Date(`${c.fields.duedate}T00:00:00`) : null;

    tTotal += 1;
    if (isDone) tDone += 1;
    if (!isDone && due && due <= eow) { tDue += 1; dueThisWeek.push({ key: c.key, summary: c.fields?.summary, duedate: c.fields.duedate, overdue: due < now }); }
    if (!isDone && isBa) { tBa += 1; baReviews.push({ key: c.key, summary: c.fields?.summary, duedate: c.fields?.duedate || null }); }

    if (r) {
      r.totalAll += 1;
      r.cat[cat] = (r.cat[cat] || 0) + 1;
      const status = c.fields?.status?.name || '';
      let bucket = STATUS_RANK[status];
      if (bucket === undefined) bucket = isDone ? 7 : 1;
      r.pipe[PIPE_BUCKET_KEY[bucket]] += 1;
      if (!isDone) { r.totalOpen += 1; const sk = idx >= 0 ? STAGES[idx].key : 'untagged'; r.phase[sk] = (r.phase[sk] || 0) + 1; }
      if (idx >= 0) {
        const dk = STAGES[idx].key;
        const st = c.fields?.status?.name || 'Unknown';
        const cur = r.disc[dk] || (r.disc[dk] = { byStatus: {}, total: 0 });
        cur.byStatus[st] = (cur.byStatus[st] || 0) + 1;
        cur.total += 1;
      }
    }
  }

  dueThisWeek.sort((a, b) => (a.duedate || '').localeCompare(b.duedate || ''));
  baReviews.sort((a, b) => (a.duedate || 'zzzz').localeCompare(b.duedate || 'zzzz'));

  const epicsDone = epics.filter((e) => e.fields?.status?.statusCategory?.key === 'done').length;

  return {
    tiles: {
      epics: epics.length,
      epicsDone,
      epicsOpen: epics.length - epicsDone,
      baPending: tBa,
      total: tTotal, done: tDone, dueThisWeek: tDue,
    },
    statusCols: STATUS_COLS,
    pipeCols: PIPE_COLS,
    stages: STAGES.map((s) => ({ key: s.key, name: s.name })),
    epics: epics.map((e) => {
      const total = rows[e.key].totalAll;
      const doneCount = rows[e.key].cat['Done'] || 0;
      const due = e.fields?.duedate ? new Date(`${e.fields.duedate}T00:00:00`) : null;
      const epicDone = e.fields?.status?.statusCategory?.key === 'done';
      const statusName = e.fields?.status?.name || '';
      // "completed" (hideable) = epic's OWN status is truly Done (NOT "Completed", which is mid-pipeline)
      // AND every child story/task is Done — or the epic has no children at all.
      const epicClosed = epicDone || statusName === 'Done';
      const childrenAllDone = total === 0 || doneCount === total;
      return {
        key: e.key,
        summary: e.fields?.summary || e.key,
        cat: rows[e.key].cat,
        pipe: rows[e.key].pipe,
        phase: rows[e.key].phase,
        disc: Object.fromEntries(
          Object.entries(rows[e.key].disc).map(([k, v]) => [k, {
            total: v.total,
            parts: Object.entries(v.byStatus)
              .map(([status, count]) => ({ status, count, rank: STATUS_RANK[status] ?? 1 }))
              .sort((a, b) => a.rank - b.rank),
          }])
        ),
        totalOpen: rows[e.key].totalOpen,
        totalAll: total,
        allDone: total > 0 && doneCount === total,
        completed: epicClosed && childrenAllDone,
        duedate: e.fields?.duedate || null,
        overdue: !!(due && due < now && !epicDone),
      };
    }),
    dueThisWeek: dueThisWeek.slice(0, 8),
    baReviews: baReviews.slice(0, 8),
  };
});

resolver.define('getEpicDetail', async (req) => {
  const key = req.payload?.key;
  if (!key) throw new Error('missing epic key');

  const epicRes = await api.asApp().requestJira(
    route`/rest/api/3/issue/${key}?fields=summary,status,assignee,duedate&expand=changelog`,
    { headers: { Accept: 'application/json' } }
  );
  if (!epicRes.ok) throw new Error(`Epic ${epicRes.status}`);
  const epic = await epicRes.json();

  // due-date change history (left→right chain of values, last = current)
  const dueChanges = [];
  (epic.changelog?.histories || []).forEach((h) => {
    (h.items || []).forEach((it) => {
      if (it.field === 'duedate' || it.fieldId === 'duedate' || it.field === 'Due date') {
        // Jira returns e.g. "2026-07-30 00:00:00.0" — normalize to YYYY-MM-DD
        dueChanges.push({ created: h.created, from: it.fromString ? it.fromString.slice(0, 10) : null, to: it.toString ? it.toString.slice(0, 10) : null });
      }
    });
  });
  dueChanges.sort((a, b) => new Date(a.created) - new Date(b.created));
  const dueHistory = [];
  if (dueChanges.length) {
    dueHistory.push({ date: dueChanges[0].from, changedAt: null });
    dueChanges.forEach((c) => dueHistory.push({ date: c.to, changedAt: c.created }));
  }

  const children = await searchAll(`(parent = "${key}" OR "Epic Link" = "${key}") ORDER BY status`, 'summary,status,labels,assignee,duedate,created');

  let done = 0;
  const tasks = children.map((c) => {
    const isDone = c.fields?.status?.statusCategory?.key === 'done';
    if (isDone) done += 1;
    const idx = stageIndexFor(c.fields?.labels);
    return {
      key: c.key,
      summary: c.fields?.summary || c.key,
      status: c.fields?.status?.name || '',
      cat: c.fields?.status?.statusCategory?.name || 'To Do',
      stageKey: idx >= 0 ? STAGES[idx].key : 'untagged',
      stageName: idx >= 0 ? STAGES[idx].name : 'Untagged',
      assignee: c.fields?.assignee?.displayName || 'Unassigned',
      duedate: c.fields?.duedate || null,
      start: c.fields?.created ? c.fields.created.slice(0, 10) : null,
    };
  });

  return {
    key: epic.key,
    summary: epic.fields?.summary || epic.key,
    status: epic.fields?.status?.name || '',
    cat: epic.fields?.status?.statusCategory?.name || 'To Do',
    assignee: epic.fields?.assignee?.displayName || 'Unassigned',
    duedate: epic.fields?.duedate || null,
    dueHistory,
    done,
    total: tasks.length,
    stages: STAGES.map((s) => ({ key: s.key, name: s.name })),
    tasks,
  };
});

// ---- Team assessment (people scorecard) ----
const TEAM_JQL = 'issuetype != Epic AND created >= "2026-08-01"';
const TESTED_BY = 'customfield_10052';   // "Tested By" (single user)
const APPROVERS = 'customfield_10003';   // "Approvers" (user array) = reviewer
const DEPLOYER_FIELD = 'customfield_10598'; // "Deployment Person" (single user picker) — live 2026-08-02

const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

resolver.define('getTeamAssessment', async () => {
  const baseFields = ['assignee', 'status', 'resolutiondate', 'duedate', 'labels', TESTED_BY, APPROVERS];
  if (DEPLOYER_FIELD) baseFields.push(DEPLOYER_FIELD);
  // changelog gives us rework bounces AND the QA-pass timestamp in one pass (no second query)
  const tasks = await searchAll(TEAM_JQL, baseFields.join(','), 'changelog');

  const today = todayStr();
  const people = {};
  const ensure = (u) => {
    if (!u || !u.accountId) return null;
    if (!people[u.accountId]) people[u.accountId] = { accountId: u.accountId, name: u.displayName || 'Unknown', labels: {}, assigned: 0, done: 0, clean: 0, late: 0, tested: 0, reviewed: 0, deployed: 0, qaOnTime: 0, qaLate: 0 };
    return people[u.accountId];
  };
  const reworkByAcct = {};

  for (const t of tasks) {
    const f = t.fields || {};
    const isDone = f.status?.statusCategory?.key === 'done';
    const resolvedStr = f.resolutiondate ? f.resolutiondate.slice(0, 10) : null;
    const lateResolved = isDone && f.duedate && resolvedStr && resolvedStr > f.duedate;
    const overdueOpen = !isDone && f.duedate && f.duedate < today;

    // one changelog pass: count "Review Failed" bounces + earliest "QA Pass" date
    let reworks = 0, qaPass = null;
    (t.changelog?.histories || []).forEach((h) => (h.items || []).forEach((it) => {
      if (it.field !== 'status') return;
      if (it.toString === 'Review Failed') reworks += 1;
      if (it.toString === 'QA Pass') { const d = h.created.slice(0, 10); if (!qaPass || d < qaPass) qaPass = d; }
    }));
    // when QA finished for this task: the QA-pass transition, else its resolution date if done
    const qaFinish = qaPass || (isDone ? resolvedStr : null);

    const dev = ensure(f.assignee);
    if (dev) {
      dev.assigned += 1;
      (f.labels || []).forEach((l) => { dev.labels[l] = (dev.labels[l] || 0) + 1; });
      if (isDone) dev.done += 1;
      if (lateResolved || overdueOpen) dev.late += 1;
      if (isDone && !lateResolved && reworks === 0) dev.clean += 1;
      if (reworks) reworkByAcct[f.assignee.accountId] = (reworkByAcct[f.assignee.accountId] || 0) + reworks;
    }

    const tester = ensure(f[TESTED_BY]);
    if (tester) {
      tester.tested += 1;
      // on-time QA turnaround: did testing clear on/before the task's due date?
      const v = qaVerdict(qaFinish, f.duedate);
      if (v === 'onTime') tester.qaOnTime += 1; else if (v === 'late') tester.qaLate += 1;
    }

    const revs = f[APPROVERS];
    (Array.isArray(revs) ? revs : revs ? [revs] : []).forEach((u) => { const r = ensure(u); if (r) r.reviewed += 1; });

    if (DEPLOYER_FIELD && f[DEPLOYER_FIELD]) { const d = ensure(f[DEPLOYER_FIELD]); if (d) d.deployed += 1; }
  }

  const out = Object.values(people).map((p) => {
    const reworks = reworkByAcct[p.accountId] || 0;
    const { role, grade } = roleAndGrade(p, reworks);
    return { accountId: p.accountId, name: p.name, role, assigned: p.assigned, done: p.done, clean: p.clean, reworks, late: p.late, tested: p.tested, reviewed: p.reviewed, deployed: p.deployed, qaLate: p.qaLate, grade };
  });
  out.sort((a, b) => (b.reworks + b.late + b.qaLate) - (a.reworks + a.late + a.qaLate) || b.assigned - a.assigned);
  return { people: out, since: '2026-08-01' };
});

export const handler = resolver.getDefinitions();
