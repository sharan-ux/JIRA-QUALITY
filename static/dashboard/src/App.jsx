import React, { useEffect, useMemo, useState } from "react";
import { invoke, router } from "@forge/bridge";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const fmt = (iso) => { if (!iso) return "—"; const [, m, d] = iso.split("-"); return `${MON[+m - 1]} ${+d}`; };
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };

const GROUP = { def: "purple", uiux: "purple", backend: "blue", frontend: "teal", complaints: "red", knowledge: "amber", bareview: "grey", untagged: "grey" };
const STATUS_GROUP = { "To Do": "grey", "In Progress": "blue", Done: "green" };
// status name -> pipeline colour
const STATUS_COLOR = {
  "To Do": "grey", Backlog: "grey", PLANNING: "grey", "Review Failed": "red",
  "In Progress": "blue", Completed: "blue", "On-Hold": "grey",
  Testing: "amber", "In QA": "amber", "QA Pass": "teal", Done: "green",
};

const Pill = ({ n, group }) => (n ? <span className={`pill pill-${group}`}>{n}</span> : <span className="dash">—</span>);
const StatusCell = ({ d }) =>
  d && d.parts && d.parts.length ? (
    <span className="cellparts">
      {d.parts.map((p, i) => (
        <span key={i} className={`pill pill-${STATUS_COLOR[p.status] || "grey"} sm`} title={`${p.count} · ${p.status}`}>{p.count}</span>
      ))}
    </span>
  ) : <span className="dash">—</span>;
const Tile = ({ label, value, tone }) => (
  <div className="tile"><div className="tile-label">{label}</div><div className={`tile-value ${tone}`}>{value}</div></div>
);

// per-table search + column sort
function useTable() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState({ col: null, dir: 1 });
  const toggle = (col) => setSort((s) => (s.col === col ? { col, dir: -s.dir } : { col, dir: 1 }));
  return { query, setQuery, sort, toggle };
}
function applyTable(epics, query, sort, getVal) {
  const q = query.trim().toLowerCase();
  let out = q ? epics.filter((e) => (e.summary || "").toLowerCase().includes(q) || (e.key || "").toLowerCase().includes(q)) : epics;
  if (sort.col) {
    out = [...out].sort((a, b) => {
      const va = getVal(a, sort.col), vb = getVal(b, sort.col);
      return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
    });
  }
  return out;
}
const Th = ({ col, label, sort, toggle, left }) => (
  <th className={`sortable ${left ? "left" : ""}`} onClick={() => toggle(col)} title="Click to sort">
    {label}<span className={`sortarrow ${sort.col === col ? "on" : ""}`}>{sort.col === col ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
  </th>
);
const stageVal = (e, col) =>
  col === "epic" ? (e.summary || "").toLowerCase() : col === "due" ? (e.duedate || "9999-12-31") : col === "total" ? (e.totalAll || 0) : ((e.pipe && e.pipe[col]) || 0);
const phaseVal = (e, col) =>
  col === "epic" ? (e.summary || "").toLowerCase() : (e.disc && e.disc[col] && e.disc[col].total) || 0;

export default function App() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [team, setTeam] = useState(null);
  const [teamErr, setTeamErr] = useState(null);
  const stageTable = useTable();
  const phaseTable = useTable();
  const teamTable = useTable();
  const [stageShowDone, setStageShowDone] = useState(false);
  const [phaseShowDone, setPhaseShowDone] = useState(false);

  useEffect(() => { invoke("getDashboard").then(setD).catch((e) => setErr(String(e))); }, []);
  useEffect(() => { invoke("getTeamAssessment").then(setTeam).catch((e) => setTeamErr(String(e))); }, []);

  const openEpic = (key) => {
    setSelected(key); setDetail(null); setDetailLoading(true);
    invoke("getEpicDetail", { key }).then(setDetail).catch((e) => setDetail({ error: String(e) })).finally(() => setDetailLoading(false));
  };

  if (err) return <div className="app"><div className="muted">Couldn't load: {err}</div></div>;
  if (!d) return <div className="app"><div className="muted">Loading launch status…</div></div>;

  const EpicCell = ({ e }) => (
    <td className={`left epic ${selected === e.key ? "sel" : ""}`}>{e.summary}</td>
  );
  const rowClass = (e) => `rowclick ${e.overdue ? "overdue" : ""} ${selected === e.key ? "rowsel" : ""}`;

  const completedCount = d.epics.filter((e) => e.completed).length;
  const stageSrc = stageShowDone ? d.epics : d.epics.filter((e) => !e.completed);
  const phaseSrc = phaseShowDone ? d.epics : d.epics.filter((e) => !e.completed);
  const stageEpics = applyTable(stageSrc, stageTable.query, stageTable.sort, stageVal);
  const phaseEpics = applyTable(phaseSrc, phaseTable.query, phaseTable.sort, phaseVal);

  return (
    <div className="app">
      {/* Tiles — full width, epic-level */}
      <div className="tiles">
        <Tile label="Epics" value={d.tiles.epics} tone="plain" />
        <Tile label="Completed" value={d.tiles.epicsDone} tone="green" />
        <Tile label="In progress" value={d.tiles.epicsOpen} tone="amber" />
        <Tile label="BA reviews pending" value={d.tiles.baPending} tone="blue" />
      </div>

      <div className="layout split">
        <div className="main">
          <div className="panel">
            <div className="panel-head">
              <h2>Epic progress by stage</h2>
              <label className="showdone"><input type="checkbox" checked={stageShowDone} onChange={(ev) => setStageShowDone(ev.target.checked)} /> Show completed ({completedCount})</label>
              <input className="tsearch" type="search" placeholder="Search epics…" value={stageTable.query} onChange={(ev) => stageTable.setQuery(ev.target.value)} />
            </div>
            <div className="panel-sub">rows: epic · columns: pipeline stage · click a header to sort, an epic for details</div>
            <div className="tscroll">
              <table className="grid">
                <thead><tr>
                  <Th col="epic" label="Epic" left sort={stageTable.sort} toggle={stageTable.toggle} />
                  <Th col="due" label="Due date" sort={stageTable.sort} toggle={stageTable.toggle} />
                  {d.pipeCols.map((c) => <Th key={c.key} col={c.key} label={c.label} sort={stageTable.sort} toggle={stageTable.toggle} />)}
                  <Th col="total" label="Total" sort={stageTable.sort} toggle={stageTable.toggle} />
                </tr></thead>
                <tbody>
                  {stageEpics.length === 0 && <tr><td className="left muted" colSpan={d.pipeCols.length + 3}>No epics match.</td></tr>}
                  {stageEpics.map((e) => (
                    <tr key={e.key} className={rowClass(e)} onClick={() => openEpic(e.key)}>
                      <EpicCell e={e} />
                      <td className={`due ${e.overdue ? "over" : ""}`}>{fmt(e.duedate)}</td>
                      {d.pipeCols.map((c) => <td key={c.key}><Pill n={e.pipe && e.pipe[c.key]} group={c.color} /></td>)}
                      <td className="total">{e.totalAll || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h2>Epic progress by phase</h2><span className="tag tag-new">New</span>
              <label className="showdone"><input type="checkbox" checked={phaseShowDone} onChange={(ev) => setPhaseShowDone(ev.target.checked)} /> Show completed ({completedCount})</label>
              <input className="tsearch" type="search" placeholder="Search epics…" value={phaseTable.query} onChange={(ev) => phaseTable.setQuery(ev.target.value)} />
            </div>
            <div className="panel-sub">rows: epic · columns: phase (dedicated task) · click a header to sort</div>
            <div className="tscroll">
              <table className="grid">
                <thead><tr>
                  <Th col="epic" label="Epic" left sort={phaseTable.sort} toggle={phaseTable.toggle} />
                  {d.stages.map((s) => <Th key={s.key} col={s.key} label={s.name} sort={phaseTable.sort} toggle={phaseTable.toggle} />)}
                </tr></thead>
                <tbody>
                  {phaseEpics.length === 0 && <tr><td className="left muted" colSpan={d.stages.length + 1}>No epics match.</td></tr>}
                  {phaseEpics.map((e) => (
                    <tr key={e.key} className={rowClass(e)} onClick={() => openEpic(e.key)}><EpicCell e={e} />{d.stages.map((s) => <td key={s.key}><StatusCell d={e.disc && e.disc[s.key]} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="legend">
              <span><i className="dot grey" /> To do</span><span><i className="dot blue" /> Dev</span>
              <span><i className="dot amber" /> QA</span><span><i className="dot teal" /> Ready to deploy</span>
              <span><i className="dot green" /> Done</span>
            </div>
          </div>

          <div className="row2">
            <div className="panel">
              <div className="panel-head"><h2>Due this week</h2></div>
              <div className="list scroll">
                {d.dueThisWeek.length === 0 && <div className="muted">Nothing due this week.</div>}
                {d.dueThisWeek.map((t) => (
                  <div className="list-row" key={t.key}><span className="li-key">{t.key}</span><span className="li-sum">{t.summary}</span><span className={`li-date ${t.overdue ? "over" : ""}`}>{fmt(t.duedate)}</span></div>
                ))}
              </div>
            </div>
            <div className="panel">
              <div className="panel-head"><h2>Upcoming BA reviews</h2><span className="tag tag-auto">Auto-created</span></div>
              <div className="list scroll">
                {d.baReviews.length === 0 && <div className="muted">None yet.</div>}
                {d.baReviews.map((t) => (
                  <div className="list-row" key={t.key}><span className="li-key">{t.key}</span><span className="li-sum">{t.summary}</span><span className="li-date">{fmt(t.duedate)}</span></div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="side">
          <div className="detail">
            {selected ? (
              <>
                <button className="d-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
                {detailLoading && <DetailSkeleton />}
                {!detailLoading && detail && detail.error && <div className="muted">Couldn't load: {detail.error}</div>}
                {!detailLoading && detail && !detail.error && <EpicDetail key={detail.key} detail={detail} />}
              </>
            ) : (
              <DetailSkeleton hint />
            )}
          </div>
          <TeamAssessment team={team} err={teamErr} table={teamTable} />
        </div>
      </div>
    </div>
  );
}

const GRADE_RANK = { green: 0, amber: 1, red: 2, grey: 3 };
const GRADE_LABEL = { green: "Good", amber: "Watch", red: "At risk", grey: "—" };
const teamVal = (p, col) =>
  col === "name" ? (p.name || "").toLowerCase() : col === "role" ? (p.role || "").toLowerCase() : col === "grade" ? GRADE_RANK[p.grade] : (p[col] || 0);
function applyTeam(people, query, sort) {
  const q = query.trim().toLowerCase();
  let out = q ? people.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.role || "").toLowerCase().includes(q)) : people;
  if (sort.col) out = [...out].sort((a, b) => { const va = teamVal(a, sort.col), vb = teamVal(b, sort.col); return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir; });
  return out;
}

function TeamAssessment({ team, err, table }) {
  const COLS = [
    { key: "assigned", label: "Assigned" }, { key: "clean", label: "✓ Clean" },
    { key: "reworks", label: "↻ Reworks" }, { key: "late", label: "⚠ Late" },
    { key: "tested", label: "Tested" }, { key: "qaLate", label: "⚠ Late QA" },
    { key: "reviewed", label: "Reviewed" }, { key: "deployed", label: "Deployed" },
  ];
  return (
    <div className="panel team-panel">
      <div className="panel-head">
        <h2>Team assessment</h2>
        {team && <input className="tsearch" type="search" placeholder="Search people…" value={table.query} onChange={(ev) => table.setQuery(ev.target.value)} />}
      </div>
      <div className="panel-sub">delivery quality of each member on tasks since Aug 1 · click a header to sort</div>
      {err && <div className="muted">Couldn't load: {err}</div>}
      {!err && !team && <div className="muted">Loading team assessment…</div>}
      {team && (
        <div className="tscroll">
          <table className="grid">
            <thead><tr>
              <Th col="name" label="Person" left sort={table.sort} toggle={table.toggle} />
              <Th col="role" label="Role" left sort={table.sort} toggle={table.toggle} />
              {COLS.map((c) => <Th key={c.key} col={c.key} label={c.label} sort={table.sort} toggle={table.toggle} />)}
              <Th col="grade" label="Grade" sort={table.sort} toggle={table.toggle} />
            </tr></thead>
            <tbody>
              {applyTeam(team.people, table.query, table.sort).length === 0 && <tr><td className="left muted" colSpan={COLS.length + 3}>No people match.</td></tr>}
              {applyTeam(team.people, table.query, table.sort).map((p) => (
                <tr key={p.accountId}>
                  <td className="left epic">{p.name}</td>
                  <td className="left"><span className="role-tag">{p.role}</span></td>
                  {COLS.map((c) => <td key={c.key} className={c.key === "clean" && p.clean ? "num-good" : (c.key === "reworks" || c.key === "late" || c.key === "qaLate") && p[c.key] ? "num-bad" : ""}>{p[c.key] || <span className="dash">—</span>}</td>)}
                  <td><span className={`pill pill-${p.grade}`}>{GRADE_LABEL[p.grade]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// same shape/height as EpicDetail so the card doesn't shrink→expand (jump) between empty, loading and loaded
function DetailSkeleton({ hint }) {
  return (
    <div className={`d-inner d-skel ${hint ? "is-hint" : ""}`}>
      <div className="d-head"><div className="sk sk-key" /><div className="sk sk-title" /></div>
      <div className="d-meta"><div className="sk sk-pill" /><div className="sk sk-m" /><div className="sk sk-m" /></div>
      <div className="skel-toggle"><div className="sk sk-tab-btn" /><div className="sk sk-tab-btn" /><div className="sk sk-tab-btn" /></div>
      <div className="donut-row"><div className="sk sk-donut" /><div><div className="sk sk-big" /><div className="sk sk-m2" /></div></div>
      <div className="tabs">{[0, 1, 2, 3].map((i) => <div key={i} className="sk sk-chip" />)}</div>
      <div className="d-tasks">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="sk sk-taskrow" />)}</div>
      {hint && (
        <div className="skel-hint">
          <div className="detail-empty-emoji">🖱️</div>
          <div className="detail-empty-title">No epic selected</div>
          <div className="detail-empty-sub">Click any epic on the left to see its phases, tasks and calendar here.</div>
        </div>
      )}
    </div>
  );
}

function EpicDetail({ detail }) {
  const [view, setView] = useState("phases");
  const byStage = useMemo(() => {
    const m = {};
    (detail.tasks || []).forEach((t) => { (m[t.stageKey] = m[t.stageKey] || []).push(t); });
    return m;
  }, [detail]);
  const tabs = [...detail.stages, ...(byStage.untagged ? [{ key: "untagged", name: "Untagged" }] : [])];
  const firstWithTasks = tabs.find((s) => (byStage[s.key] || []).length)?.key || (tabs[0] && tabs[0].key);
  const [stage, setStage] = useState(firstWithTasks);
  const pct = detail.total ? Math.round((detail.done / detail.total) * 100) : 0;

  const list = byStage[stage] || [];
  const stageDone = list.filter((t) => t.cat === "Done").length;
  const stagePct = list.length ? Math.round((stageDone / list.length) * 100) : 0;

  return (
    <div className="d-inner">
      <div className="d-head">
        <a className="d-key" onClick={() => router.open(`/browse/${detail.key}`)}>{detail.key} ↗</a>
        <div className="d-title">{detail.summary}</div>
      </div>
      <div className="d-meta">
        <span className={`pill pill-${STATUS_COLOR[detail.status] || "grey"}`}>{detail.status}</span>
        <span className="d-m">{detail.assignee}</span>
        <span className="d-m">Due {fmt(detail.duedate)}</span>
      </div>

      {detail.dueHistory && detail.dueHistory.length > 1 && (
        <div className="due-hist">
          <span className="due-hist-label">Due date changed:</span>
          <div className="due-hist-chain">
            {detail.dueHistory.map((h, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="due-hist-arrow">→</span>}
                <span
                  className={`due-hist-chip ${i === detail.dueHistory.length - 1 ? "cur" : ""}`}
                  title={h.changedAt ? `changed ${fmt(h.changedAt.slice(0, 10))}` : "original due date"}
                >
                  {h.date ? fmt(h.date) : "—"}
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="d-toggle">
        <button className={view === "phases" ? "on" : ""} onClick={() => setView("phases")}>Phases</button>
        <button className={view === "calendar" ? "on" : ""} onClick={() => setView("calendar")}>Calendar</button>
        <button className={view === "flow" ? "on" : ""} onClick={() => setView("flow")}>Flow</button>
      </div>

      {view === "phases" ? (
        <>
          <div className="donut-row">
            <Donut pct={pct} />
            <div><div className="d-big">{detail.done}/{detail.total}</div><div className="d-m">tasks done</div></div>
          </div>

          <div className="tabs">
            {tabs.map((s) => (
              <span key={s.key} className={`tab ${stage === s.key ? "on" : ""}`} onClick={() => setStage(s.key)}>
                <i className={`dot ${GROUP[s.key] || "grey"}`} /> {s.name}<span className="c">{(byStage[s.key] || []).length}</span>
              </span>
            ))}
          </div>

          <div className="phase-bar">
            <div className="d-bar"><div className="d-bar-fill" style={{ width: `${stagePct}%` }} /></div>
            <div className="d-m">{stageDone}/{list.length} done in this phase</div>
          </div>

          <div className="d-tasks scroll">
            {list.length === 0 && <div className="muted">No tasks in this phase.</div>}
            {list.map((t) => (
              <div className="d-task" key={t.key} onClick={() => router.open(`/browse/${t.key}`)}>
                <span className="d-task-key">{t.key}</span>
                <span className="d-task-sum">{t.summary}</span>
                <span className="d-task-due">{fmt(t.duedate)}</span>
                <span className={`pill pill-${STATUS_COLOR[t.status] || "grey"} sm`}>{t.status}</span>
              </div>
            ))}
          </div>
        </>
      ) : view === "flow" ? (
        <>
          <FlowChart stages={detail.stages} byStage={byStage} />
          <div className="d-section-label">Timeline</div>
          <Gantt tasks={detail.tasks || []} />
        </>
      ) : (
        <Calendar tasks={detail.tasks || []} />
      )}
    </div>
  );
}

function FlowChart({ stages, byStage }) {
  const all = [...stages, ...(byStage.untagged ? [{ key: "untagged", name: "Untagged" }] : [])];
  return (
    <div className="flow">
      {all.map((s, i) => {
        const list = byStage[s.key] || [];
        const total = list.length;
        const done = list.filter((t) => t.cat === "Done").length;
        const state = total === 0 ? "empty" : done === total ? "done" : "active";
        return (
          <React.Fragment key={s.key}>
            <div className={`flow-node ${state}`}>
              <span className="flow-count">{total}</span>
              <div className="flow-node-name">{s.name}</div>
              <div className="flow-node-meta">
                {total === 0 ? "no tasks" : state === "done" ? "✓ all done" : `${done}/${total} done`}
              </div>
            </div>
            {i < all.length - 1 && <div className="flow-arrow">→</div>}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Gantt({ tasks }) {
  const items = (tasks || []).filter((t) => t.duedate);
  if (!items.length) return <div className="muted" style={{ marginTop: 6 }}>No dated tasks to chart.</div>;

  const day = 86400000;
  const toTs = (d) => new Date(`${d}T00:00:00`).getTime();
  const isoOf = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const tISO = todayISO();
  const todayTs = toTs(tISO);

  const dues = items.map((t) => toTs(t.duedate));
  let lo = Math.min(...dues, todayTs);
  let hi = Math.max(...dues, todayTs);
  const minWin = 14 * day; // keep a readable window even when dates cluster
  if (hi - lo < minWin) { const mid = (lo + hi) / 2; lo = mid - minWin / 2; hi = mid + minWin / 2; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const span = Math.max(1, hi - lo);
  const pct = (ts) => Math.min(98, Math.max(2, ((ts - lo) / span) * 100));

  const sorted = [...items].sort((a, b) => (a.duedate < b.duedate ? -1 : a.duedate > b.duedate ? 1 : 0));

  return (
    <div className="gantt">
      <div className="gantt-axis">
        <span className="gantt-tick">{fmt(isoOf(lo))}</span>
        <span className="gantt-tick end">{fmt(isoOf(hi))}</span>
      </div>
      <div className="gantt-rows">
        {sorted.map((t) => {
          const overdue = t.duedate < tISO && t.cat !== "Done";
          const color = t.cat === "Done" ? "green" : overdue ? "red" : (GROUP[t.stageKey] || "grey");
          return (
            <div className="gantt-row" key={t.key} onClick={() => router.open(`/browse/${t.key}`)} title={`${t.key} · ${t.summary}\ndue ${fmt(t.duedate)}`}>
              <span className="gantt-label">{t.key}</span>
              <div className="gantt-track">
                <div className="gantt-today" style={{ left: `${pct(todayTs)}%` }} />
                <div className={`gantt-dot g-${color}`} style={{ left: `${pct(toTs(t.duedate))}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="gantt-legend"><span className="gantt-today-key" /> today · dot = due date</div>
    </div>
  );
}

function Donut({ pct, size = 66, stroke = 8 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  const cx = size / 2;
  return (
    <svg width={size} height={size}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(154,162,174,.2)" strokeWidth={stroke} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--green)" strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" transform={`rotate(-90 ${cx} ${cx})`} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="700" fill="var(--text)">{pct}%</text>
    </svg>
  );
}

function Calendar({ tasks }) {
  const withDue = tasks.filter((t) => t.duedate);
  const tISO = todayISO();
  const first = withDue.map((t) => t.duedate).sort()[0];
  const init = first ? { y: +first.slice(0, 4), m: +first.slice(5, 7) - 1 } : { y: +tISO.slice(0, 4), m: +tISO.slice(5, 7) - 1 };
  const [ym, setYm] = useState(init);

  const byDate = {};
  withDue.forEach((t) => { (byDate[t.duedate] = byDate[t.duedate] || []).push(t); });

  const startOffset = new Date(ym.y, ym.m, 1).getDay();
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(day);
  while (cells.length % 7) cells.push(null);
  const iso = (day) => `${ym.y}-${String(ym.m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const shift = (n) => setYm((p) => { const dt = new Date(p.y, p.m + n, 1); return { y: dt.getFullYear(), m: dt.getMonth() }; });

  return (
    <div className="cal">
      <div className="cal-head">
        <button onClick={() => shift(-1)}>‹</button>
        <div className="cal-title">{MONTHS[ym.m]} {ym.y}</div>
        <button onClick={() => shift(1)}>›</button>
      </div>
      <div className="cal-grid">
        {WD.map((w) => <div className="cal-wd" key={w}>{w}</div>)}
        {cells.map((day, i) => {
          if (!day) return <div className="cal-cell empty" key={i} />;
          const ds = iso(day);
          const items = byDate[ds] || [];
          return (
            <div className={`cal-cell ${ds === tISO ? "today" : ""}`} key={i}>
              <div className="cal-day">{day}</div>
              {items.slice(0, 3).map((t) => {
                const overdue = ds < tISO && t.cat !== "Done";
                return (
                  <span key={t.key} title={`${t.key} · ${t.summary}`} onClick={() => router.open(`/browse/${t.key}`)}
                    className={`cal-chip ${overdue ? "over" : `g-${GROUP[t.stageKey] || "grey"}`}`}>{t.key}</span>
                );
              })}
              {items.length > 3 && <span className="cal-more">+{items.length - 3}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
