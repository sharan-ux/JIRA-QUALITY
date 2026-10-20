import React, { useEffect, useState, useCallback } from "react";
import { invoke, router, requestJira } from "@forge/bridge";

const openIssue = (e, key) => { if (e) e.stopPropagation(); if (key) router.open(`/browse/${key}`); };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDT = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d.getTime()) ? "" : `${MON[d.getMonth()]} ${d.getDate()}`; };
// current user's display name (from their own session) — cached; used to stamp notes
let _myName;
async function getMyName() {
  if (_myName !== undefined) return _myName;
  try { const r = await requestJira("/rest/api/3/myself"); const d = await r.json(); _myName = d.displayName || null; }
  catch (e) { _myName = null; }
  return _myName;
}
import { buildPhases } from "./framework";

// Localizes a render error to a small inline message instead of blanking the whole dashboard.
class ErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("dashboard render error:", err, info); }
  render() {
    if (this.state.err) return <div className="eb">⚠️ Couldn't render this section — {String(this.state.err && this.state.err.message || this.state.err)}</div>;
    return this.props.children;
  }
}
// safe accessors — a checklist item may be a {text,loom} object or a plain string
const itText = (it) => (typeof it === "string" ? it : (it && it.text) || "");
const itLoom = (it) => (it && typeof it === "object" ? it.loom : null);

const SEVLBL = { crit: "Critical", high: "High", med: "Medium", low: "Low" };

const currentPhaseIdx = (it) => {
  const i = it.phases.findIndex((p) => p.state === "current" || p.state === "blocked");
  if (i >= 0) return i;
  return it.phases.every((p) => p.state === "done") ? it.phases.length - 1 : 0;
};
const overall = (it) => {
  if (it.phases.every((p) => p.state === "done")) return { t: "Complete", c: "green" };
  if (it.blocked || it.phases.some((p) => p.state === "blocked")) return { t: "Delayed", c: "amber" };
  return { t: "In Progress", c: "amber" };
};
const isBlocked = (it) => !!(it.blocked || it.phases.some((p) => p.state === "blocked"));
// % of ALL checklist items completed across every phase (not just fully-green phases),
// so partial progress inside in-flight phases is reflected. Falls back to phases-done if
// a phase has no checklist items (keeps a sensible number for unprovisioned epics).
const donePct = (it) => {
  let done = 0, total = 0;
  for (const p of it.phases) { total += p.checklist.length; done += p.checklist.filter((c) => c.done).length; }
  if (total) return Math.round((done / total) * 100);
  return Math.round((it.phases.filter((p) => p.state === "done").length / it.phases.length) * 100);
};
// Visual state class for a phase circle / rail segment — colored by real progress STATUS
// (not just the single sequential "current" phase): green=complete/done, orange=in-progress,
// red=delayed, grey=not-started. Keeps the circle + rail consistent with the "In Progress" chip.
const phaseCls = (p) => p.rework ? "rework"
  : p.skipped ? "skip"
  : (p.state === "done" || p.status === "Complete") ? "done"
  : (p.state === "blocked" || p.status === "Delayed") ? "blocked"
  : (p.status === "In Progress" || p.state === "current") ? "current"
  : "";
const Chip = ({ c, children }) => <span className={`chip ${c}`}>{children}</span>;
const TypeCell = ({ it }) => (it.type === "Bug" ? <Chip c="red">Bug</Chip> : <Chip c="blue">Feature</Chip>);
const blkLabel = (b) => (b && b.kind === "internal" ? "Internal" : "External");

// read-only blocked chip (used in the master table where there's no editing)
const BlockedChip = ({ b }) => (
  <span className="blk-chip">⚠️ Delayed · {blkLabel(b)}{b.reason ? " — " + b.reason : ""}{b.blocker ? " · ⛔ " + b.blocker : ""}</span>
);

// Due-date + blocked control. storyKey null => epic-level. Editable when `editable`.
// Internal delays REQUIRE a blocker task (map existing or create new) → native "is blocked by".
function DueBlocked({ epicKey, storyKey, due, blocked, editable = true }) {
  const [state, setState] = useState(blocked || null);
  const [open, setOpen] = useState(false);
  const [knd, setKnd] = useState("external");
  const [reason, setReason] = useState("");
  const [bmode, setBmode] = useState("create"); // 'create' | 'map'
  const [bval, setBval] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setErr(null);
    if (knd === "internal" && !bval.trim()) { setErr("Internal delay requires a blocker task."); return; }
    setBusy(true);
    const payload = { epicKey, storyKey: storyKey || null, kind: knd, reason: reason.trim(), byName: await getMyName() };
    if (knd === "internal") { if (bmode === "map") payload.blockerKey = bval.trim(); else payload.blockerSummary = bval.trim(); }
    const res = await invoke("setBlocked", payload);
    setBusy(false);
    if (res && res.ok) { setState({ kind: knd, reason: reason.trim(), byName: res.by, at: res.at, blocker: res.blocker }); setOpen(false); setReason(""); setBval(""); }
    else setErr((res && res.error) || "failed");
  };
  const unblock = async (e) => { e.stopPropagation(); setBusy(true); await invoke("setBlocked", { epicKey, storyKey: storyKey || null, kind: null }); setBusy(false); setState(null); };

  return (
    <span className="dueblk" onClick={(e) => e.stopPropagation()}>
      {state ? (
        <>
          <BlockedChip b={state} />
          {(state.byName || state.at) && <span className="blk-by"> {state.byName || ""}{state.at ? " · " + fmtDT(state.at) : ""}</span>}
          {editable && <span className="blk-x" onClick={unblock} title="Clear delay">clear ✕</span>}
        </>
      ) : (
        <>
          <span className={due ? "" : "muted"}>{due ? "Due " + fmtDT(due) : "No due date"}</span>
          {editable && <span className="blk-add" onClick={() => setOpen((o) => !o)}> · ⚠️ Mark as Delayed</span>}
        </>
      )}
      {open && !state && (
        <div className="notepop blkpop" onClick={(e) => e.stopPropagation()}>
          <div className="np-q">Mark delayed by a dependency</div>
          <div className="blk-kinds">
            <label><input type="radio" checked={knd === "external"} onChange={() => setKnd("external")} /> External</label>
            <label><input type="radio" checked={knd === "internal"} onChange={() => setKnd("internal")} /> Internal</label>
          </div>
          <textarea className="blk-reason" placeholder="Reason / what it's waiting on…" value={reason} onChange={(e) => setReason(e.target.value)} />
          {knd === "internal" && (
            <div className="blk-blocker">
              <div className="blk-blabel">Blocker task <span className="req">— required for internal</span></div>
              <div className="blk-kinds">
                <label><input type="radio" checked={bmode === "create"} onChange={() => setBmode("create")} /> Create new</label>
                <label><input type="radio" checked={bmode === "map"} onChange={() => setBmode("map")} /> Map existing</label>
              </div>
              <input className="blk-reason" style={{ minHeight: 0 }} placeholder={bmode === "map" ? "Existing task key e.g. OCW-1234" : "New blocker task summary…"} value={bval} onChange={(e) => setBval(e.target.value)} />
            </div>
          )}
          {err && <div className="im-err" style={{ marginTop: 6 }}>{err}</div>}
          <div className="blk-btns">
            <button className="blk-cancel" onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
            <button className="blk-save" onClick={save} disabled={busy}>{busy ? "…" : "Save"}</button>
          </div>
        </div>
      )}
    </span>
  );
}

// Skip-phase control — for phases a task doesn't need (no QA / no UX). Requires a reason, marks the
// whole phase complete, comments on the phase ticket + epic, and moves the ticket to Done. Reversible.
function SkipPhase({ epicKey, storyKey, skipped }) {
  const [state, setState] = useState(skipped || null);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const save = async () => {
    setErr(null);
    if (!reason.trim()) { setErr("A reason is required to skip a phase."); return; }
    setBusy(true);
    const res = await invoke("skipPhase", { epicKey, storyKey, reason: reason.trim(), skip: true, byName: await getMyName() });
    setBusy(false);
    if (res && res.ok) { setState({ reason: reason.trim(), byName: res.by, at: res.at }); setOpen(false); setReason(""); }
    else setErr((res && res.error) || "failed");
  };
  const unskip = async (e) => { e.stopPropagation(); setBusy(true); await invoke("skipPhase", { epicKey, storyKey, skip: false }); setBusy(false); setState(null); };

  return (
    <span className="skipctl" onClick={(e) => e.stopPropagation()}>
      {state ? (
        <>
          <span className="skip-tag">⏭️ Skipped{state.reason ? " — " + state.reason : ""}</span>
          {(state.byName || state.at) && <span className="blk-by"> {state.byName || ""}{state.at ? " · " + fmtDT(state.at) : ""}</span>}
          <span className="blk-x" onClick={unskip} title="Un-skip this phase">un-skip ✕</span>
        </>
      ) : (
        <span className="blk-add" onClick={() => setOpen((o) => !o)}> · ⏭️ Skip phase</span>
      )}
      {open && !state && (
        <div className="notepop blkpop" onClick={(e) => e.stopPropagation()}>
          <div className="np-q">Skip this phase — mark complete as not required</div>
          <textarea className="blk-reason" placeholder="Why is this phase not needed? (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {err && <div className="im-err" style={{ marginTop: 6 }}>{err}</div>}
          <div className="blk-btns">
            <button className="blk-cancel" onClick={() => { setOpen(false); setErr(null); }}>Cancel</button>
            <button className="blk-save" onClick={save} disabled={busy}>{busy ? "…" : "Skip phase"}</button>
          </div>
        </div>
      )}
    </span>
  );
}

function Loader({ dark }) {
  return (
    <div className={"app " + (dark ? "dark" : "light")}>
      <div className="loader">
        <img className="ld-logo" src="./zilmoney-jira.png" alt="ZIL MONEY Jira" />
        <div className="ld-orbit"><span className="ld-planet" /></div>
        <div className="ld-text">Loading Quality Check Tracker…</div>
      </div>
    </div>
  );
}

const PAGE_SIZE = 15;
function Pager({ total, page, setPage, pageSize = PAGE_SIZE }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <span className="pg-info">{from}–{to} of {total}</span>
      <button className="pg-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
      <span className="pg-cur">Page {page} / {pages}</span>
      <button className="pg-btn" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
    </div>
  );
}

const catColor = (c) => (c === "done" ? "green" : c === "indeterminate" ? "amber" : "grey");

function SimpleList({ showCompleted, kind }) {
  const isBug = kind === "bug";
  const invokeName = isBug ? "getBugList" : "getFeatureList";
  const noun = isBug ? "bug" : "feature";
  const label = isBug ? "label-only-bug" : "label-only-feature";
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [tech, setTech] = useState("");
  const [st, setSt] = useState("");
  const [pri, setPri] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { invoke(invokeName).then(setRows).catch((e) => setErr(String(e))); }, [invokeName]);
  useEffect(() => { setPage(1); }, [q, tech, st, pri, showCompleted]);
  if (err) return <div className="muted" style={{ padding: "20px 14px" }}>Couldn't load {noun}s: {err}</div>;
  if (!rows) return <div className="muted" style={{ padding: "20px 14px" }}>Loading simple {noun}s…</div>;
  if (!rows.length) return <div className="muted" style={{ padding: "20px 14px" }}>No {noun}s tagged {label} found.</div>;

  const uniq = (f) => [...new Set(rows.map(f).filter(Boolean))].sort();
  const techs = uniq((r) => r.assignee), statuses = uniq((r) => r.status), pris = uniq((r) => r.priority);
  const ql = q.trim().toLowerCase();
  const filtered = rows.filter((r) =>
    (!ql || r.key.toLowerCase().includes(ql) || (r.sum || "").toLowerCase().includes(ql)) &&
    (!tech || r.assignee === tech) && (!st || r.status === st) && (!pri || r.priority === pri) &&
    (showCompleted || !/^(done|completed|closed|resolved)$/i.test((r.status || "").trim())));   // hide Done simple items unless toggled on
  const dirty = q || tech || st || pri;
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <div className="bl-filters">
        <input className="bl-search" placeholder="Search key or title…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={tech} onChange={(e) => setTech(e.target.value)}><option value="">All technicians</option>{techs.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select value={st} onChange={(e) => setSt(e.target.value)}><option value="">All statuses</option>{statuses.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={pri} onChange={(e) => setPri(e.target.value)}><option value="">All priorities</option>{pris.map((p) => <option key={p} value={p}>{p}</option>)}</select>
        {dirty ? <button className="bl-clear" onClick={() => { setQ(""); setTech(""); setSt(""); setPri(""); }}>clear</button> : null}
        <span className="bl-count">{filtered.length} of {rows.length}</span>
      </div>
      <table>
        <thead><tr>
          <th>{isBug ? "Bug" : "Feature"}</th>
          <th className="hide-sm">Type</th>
          <th>Live Jira status</th>
          <th className="hide-sm">Priority</th>
          <th>Technician</th>
        </tr></thead>
        <tbody>
          {filtered.length === 0 && <tr><td colSpan={5} className="muted" style={{ padding: "16px 14px" }}>No {noun}s match these filters.</td></tr>}
          {paged.map((r) => (
            <tr key={r.key} onClick={(e) => openIssue(e, r.key)}>
              <td><span className="k klink">{r.key} ↗</span><div className="sum">{r.sum}</div></td>
              <td className="hide-sm owner">{r.type}</td>
              <td><Chip c={catColor(r.cat)}>{r.status}</Chip></td>
              <td className="hide-sm owner">{r.priority}</td>
              <td className="owner">{r.assignee || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager total={filtered.length} page={page} setPage={setPage} />
    </>
  );
}

// --- Daily report: client-side branded HTML for browser print-to-PDF (Forge can't render PDFs server-side) ---
import { ZM_LOGO } from "./logo";
const drEsc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const drFmtDate = (d) => { if (!d) return null; const p = String(d).split("-"); if (p.length < 3) return String(d); const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(+p[1]) - 1] || p[1]; return `${m} ${+p[2]}`; };
const DR_CHIP = { "On track": "ok", Live: "lv", Overdue: "od", Delayed: "bl", "Wrapping up": "wr" };
// strip stray markdown the model sometimes leaves in a brief (**bold**, # heading, `code`)
const drStripMd = (s) => String(s || "").replace(/^#{1,6}\s+/gm, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/`([^`]*)`/g, "$1").replace(/(^|\s)\*(\S.*?\S)\*(?=\s|$)/g, "$1$2").trim();
function buildReportHtml(date, active, doneTail) {
  const A = active || [];
  const feats = A.filter((a) => a.kind !== "bug");
  const bugs = A.filter((a) => a.kind === "bug");
  const countBy = (s) => A.filter((a) => a.status === s).length;
  const genAt = new Date().toLocaleString();
  const item = (a, i) => {
    const cls = DR_CHIP[a.status] || "";
    const tgt = a.due ? `Target ${drFmtDate(a.due)}` : "Target not set";
    const ph = a.phasesTotal ? `${a.phasesDone || 0}/${a.phasesTotal} phases · ${a.pctPhases || 0}%` : "—";
    const st = a.status ? `<span class="st ${cls}">${drEsc(a.status)}</span>` : "";
    const delay = a.delayed ? `<div class="delay">⚠ Delayed${a.delayKind ? ` (${drEsc(a.delayKind)})` : ""} — ${drEsc(drStripMd(a.delayReason) || "reason not recorded")}${a.delayBlocker ? ` · blocked by ${drEsc(a.delayBlocker)}` : ""}</div>` : "";
    const body = a.text && a.text.trim() ? drEsc(drStripMd(a.text)) : `<span class="noup">No update yet.</span>`;
    return `<div class="item ${cls}">
<div class="t"><span class="num">${i + 1}</span><span class="tt"><span class="k">${drEsc(a.key)}</span> ${drEsc(a.name)} ${st}</span></div>
<div class="m">${drEsc(a.phaseName || "—")} &nbsp;·&nbsp; ${drEsc(ph)} &nbsp;·&nbsp; ${drEsc(tgt)}</div>
${delay}<div class="b">${body}</div>
</div>`;
  };
  const section = (arr, empty) => (arr.length ? arr.map(item).join("") : `<p class="none">${empty}</p>`);
  const done = (doneTail && doneTail.length) ? doneTail.map((x) => `<li><span class="k">${drEsc(x.key)}</span> ${drEsc(x.name)}</li>`).join("") : "<li>(none)</li>";
  const wrap = countBy("Wrapping up");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Daily Epic Progress · ${drEsc(date)}</title>
<style>
@page{margin:16mm;}
*{box-sizing:border-box;}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#26313d;margin:0;padding:32px 34px;font-size:12.5px;line-height:1.55;}
.logo{height:32px;margin:0 0 10px;}
.kicker{color:#00a5b2;font-size:10px;letter-spacing:.24em;font-weight:700;text-transform:uppercase;}
h1{font-family:Georgia,'Times New Roman',serif;color:#073577;font-size:32px;margin:8px 0 4px;letter-spacing:-.01em;}
.lead{color:#6b7a89;margin:0 0 12px;font-size:12px;}
.rule{height:3px;width:60px;background:#073577;border-radius:2px;margin:12px 0 18px;}
.bar{font-size:12.5px;color:#26313d;margin:0 0 26px;}
.bar .tot{font-weight:700;color:#073577;}
.bar .c{font-weight:700;} .bar .ok{color:#0a7d3f;} .bar .lv{color:#0e7c86;} .bar .od{color:#b42318;} .bar .bl{color:#9a6700;} .bar .wr{color:#0369a1;}
h2{color:#073577;font-size:15px;font-weight:700;margin:30px 0 16px;padding-bottom:7px;border-bottom:2px solid #073577;}
h2:first-of-type{margin-top:8px;}
.item{position:relative;margin:0 0 20px;padding:2px 0 16px 40px;border-left:3px solid #cbd5e1;border-bottom:1px solid #eef1f4;page-break-inside:avoid;}
.item.ok{border-left-color:#2e9e5b;} .item.lv{border-left-color:#12a3ad;} .item.od{border-left-color:#d64535;} .item.bl{border-left-color:#e0a106;} .item.wr{border-left-color:#2b8fd6;}
.item .num{position:absolute;left:12px;top:1px;color:#073577;font-weight:800;font-size:15px;font-variant-numeric:tabular-nums;}
.item .t{font-size:14px;font-weight:600;color:#1c2733;}
.item .t .k{color:#073577;font-weight:700;}
.item .st{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-left:8px;white-space:nowrap;}
.item .st.ok{color:#0a7d3f;} .st.lv{color:#0e7c86;} .st.od{color:#b42318;} .st.bl{color:#9a6700;} .st.wr{color:#0369a1;}
.item .m{color:#7a8794;margin-top:4px;font-size:10.5px;letter-spacing:.01em;}
.item .delay{margin-top:6px;font-size:11px;font-weight:700;color:#9a6700;background:#fff6e5;border-left:3px solid #e0a106;padding:5px 9px;border-radius:3px;}
.item .b{margin-top:8px;font-size:12.5px;line-height:1.6;color:#2a3746;max-width:52em;}
.item .noup{color:#9aa7b4;font-style:italic;}
.none{color:#9aa7b4;font-style:italic;margin:0 0 8px;}
ul{margin:8px 0 0 4px;padding:0;list-style:none;}
ul li{margin:0 0 6px;color:#2a3746;} ul li .k{color:#073577;font-weight:700;}
.k{font-variant-numeric:tabular-nums;}
.footer{margin-top:28px;border-top:1px solid #e6ebf0;padding-top:10px;color:#9aa7b4;font-size:10px;display:flex;justify-content:space-between;}
@media print{body{padding:0;}}
</style></head><body>
<div class="kicker">Zil Money · Daily Epic Progress · Internal</div>
<img class="logo" src="${ZM_LOGO}" alt="Zil Money" />
<h1>Daily Epic Progress</h1>
<p class="lead">${drEsc(date)} · for Sabeer · auto-generated · generated ${drEsc(genAt)}</p>
<div class="rule"></div>
<div class="bar"><span class="tot">${A.length} initiatives</span> &nbsp;—&nbsp; <span class="c ok">${countBy("On track")} on track</span>${countBy("Live") ? ` &nbsp;·&nbsp; <span class="c lv">${countBy("Live")} live</span>` : ""} &nbsp;·&nbsp; <span class="c od">${countBy("Overdue")} overdue</span> &nbsp;·&nbsp; <span class="c bl">${countBy("Delayed")} delayed</span>${wrap ? ` &nbsp;·&nbsp; <span class="c wr">${wrap} wrapping up</span>` : ""}</div>
<h2>Feature initiatives (${feats.length})</h2>
${section(feats, "None.")}
<h2>Bug fixes (${bugs.length})</h2>
${section(bugs, "None selected.")}
<h2>Completed recently (7 days)</h2>
<ul>${done}</ul>
<div class="footer"><span>Zil Money — Confidential</span><span>Daily Epic Progress · ${drEsc(date)}</span></div>
</body></html>`;
}

function DailyReportPanel({ onClose }) {
  const [rows, setRows] = useState(null);
  const [doneTail, setDoneTail] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const load = useCallback(() => {
    setErr(null);
    return invoke("getDailyBoard").then((d) => { setRows(d.active || []); setDoneTail(d.doneTail || []); }).catch((e) => setErr(String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);
  const [bugKey, setBugKey] = useState("");
  const [adding, setAdding] = useState(false);
  const genAll = async () => { setBusy(true); try { await invoke("generateDrafts"); await load(); } catch (e) { setErr(String(e)); } finally { setBusy(false); } };
  const save = async (key, text) => { try { await invoke("setDailyUpdate", { epicKey: key, text }); } catch (e) { setErr(String(e)); } };
  const addBug = async () => {
    const k = bugKey.trim(); if (!k) return;
    setAdding(true); setErr(null);
    try { const res = await invoke("addReportBug", { key: k }); if (res && res.ok) { setBugKey(""); await load(); } else setErr((res && res.error) || "Couldn't add that bug."); }
    catch (e) { setErr(String(e)); } finally { setAdding(false); }
  };
  const removeBug = async (k) => { try { await invoke("removeReportBug", { key: k }); await load(); } catch (e) { setErr(String(e)); } };
  const [pdfBusy, setPdfBusy] = useState(false);
  // Self-contained one-click PDF via pdfmake (lazy-loaded; no print dialog, no external service).
  const downloadPdf2 = async () => {
    setPdfBusy(true); setErr(null);
    try {
      const date = new Date().toISOString().slice(0, 10);
      const { downloadReportPdf } = await import("./report-pdf");
      await downloadReportPdf({ date, active: rows || [], doneTail: doneTail || [] });
    } catch (e) { setErr("PDF generation failed: " + String(e)); }
    finally { setPdfBusy(false); }
  };
  const downloadPdf = () => {
    // Print via a hidden inline iframe (Forge's app iframe blocks window.open popups). The browser's
    // print dialog lets the user choose "Save as PDF".
    try {
      const date = new Date().toISOString().slice(0, 10);
      const html = buildReportHtml(date, rows || [], doneTail || []);
      const ifr = document.createElement("iframe");
      ifr.setAttribute("aria-hidden", "true");
      ifr.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0;";
      document.body.appendChild(ifr);
      const cw = ifr.contentWindow;
      cw.document.open(); cw.document.write(html); cw.document.close();
      setTimeout(() => {
        try { cw.focus(); cw.print(); }
        catch (e) { setErr("Couldn't open the print dialog: " + String(e)); }
        setTimeout(() => { try { ifr.remove(); } catch (e) { /* ignore */ } }, 1500);
      }, 400);
    } catch (e) { setErr(String(e)); }
  };
  return (
    <div className="drp-overlay" onClick={onClose}>
      <div className="drp" onClick={(e) => e.stopPropagation()}>
        <div className="drp-head">
          <strong>Daily Report — updates for Sabeer</strong>
          <div>
            <button disabled={busy} onClick={genAll}>{busy ? "Generating…" : "Generate drafts (AI)"}</button>
            <button disabled={pdfBusy || !rows || !rows.length} onClick={downloadPdf2} title="Download the branded PDF (one click)">{pdfBusy ? "Building…" : "Download PDF"}</button>
            <button disabled={!rows || !rows.length} onClick={downloadPdf} title="Print-to-PDF fallback (browser print dialog)">Print</button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>
        {err && <div className="eb">⚠️ {err}</div>}
        {!rows ? <div>Loading…</div> : (() => {
          const chipCls = (s) => DR_CHIP[s] || "wr";
          const rowEl = (r, extra) => (
            <div className="drp-row" key={r.key}>
              <div className="drp-meta"><strong>{r.key}</strong> — {r.name}
                {r.status && <span className={"drp-chip " + chipCls(r.status)}>{r.status}</span>}
                <span className="muted"> · {r.phaseName} · {r.phasesTotal ? `${r.phasesDone}/${r.phasesTotal} phases (${r.pctPhases}%)` : "—"} · {r.due ? `Target ${r.due}` : "no target set"}</span>
                {extra}
              </div>
              <textarea defaultValue={r.text || ""} maxLength={400} rows={3}
                onBlur={(e) => save(r.key, e.target.value)} placeholder="Executive brief (auto-saves on blur, max 400 chars)…" />
            </div>
          );
          const feats = rows.filter((r) => r.kind !== "bug");
          const bugs = rows.filter((r) => r.kind === "bug");
          return (
            <div className="drp-list">
              <div className="drp-sec">Feature initiatives ({feats.length})</div>
              {feats.length ? feats.map((r) => rowEl(r)) : <div className="muted">No active features.</div>}
              <div className="drp-sec">Bug fixes ({bugs.length}) · optional</div>
              <div className="drp-add">
                <input value={bugKey} onChange={(e) => setBugKey(e.target.value)} placeholder="Add a bug epic (e.g. OCW-23825)"
                  onKeyDown={(e) => { if (e.key === "Enter") addBug(); }} />
                <button disabled={adding || !bugKey.trim()} onClick={addBug}>{adding ? "Adding…" : "Add"}</button>
              </div>
              {bugs.map((r) => rowEl(r, <button className="drp-x" title="Remove from report" onClick={() => removeBug(r.key)}>×</button>))}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [kind, setKind] = useState("feature");
  const [selected, setSelected] = useState(null);
  const [dark, setDark] = useState(false);
  const [showDaily, setShowDaily] = useState(false);
  const [bugView, setBugView] = useState("phases"); // 'phases' | 'labelonly' (Bugs tab only)
  const [showCompleted, setShowCompleted] = useState(false); // off = hide fully-complete features/epics + Done simple bugs
  const [showBacklog, setShowBacklog] = useState(false); // off = hide epics the PM has parked (backlogged)
  const [fq, setFq] = useState(""); const [fstatus, setFstatus] = useState(""); const [fphase, setFphase] = useState("");
  const [descKeys, setDescKeys] = useState(null); // epic keys matched by descendant (sub-task / linked-ticket) search
  const [descMatches, setDescMatches] = useState({}); // epicKey -> matched descendant ticket keys (to show in the row)
  const [mpage, setMpage] = useState(1);
  useEffect(() => { setMpage(1); }, [fq, fstatus, fphase, kind, bugView, showCompleted, showBacklog]);
  // deep search: reach discipline stories / sub-tasks / linked tickets the dashboard doesn't load,
  // resolving them back to their epic on the server (debounced).
  useEffect(() => {
    const q = fq.trim();
    if (q.length < 2) { setDescKeys(null); setDescMatches({}); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      invoke("findEpicsByDescendant", { query: q, kind })
        .then((r) => { if (!cancelled) { setDescKeys(new Set((r && r.keys) || [])); setDescMatches((r && r.matches) || {}); } })
        .catch(() => { if (!cancelled) { setDescKeys(null); setDescMatches({}); } });
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [fq, kind]);

  const loadData = React.useCallback(() => {
    setErr(null); setRefreshing(true);
    return invoke("getComplianceData").then((d) => { setData(d); return d; }).catch((e) => { setErr(String(e)); return null; }).finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { loadData(); }, [loadData]);
  // Park/unpark an epic (dashboard display only — never touches Jira), then refresh.
  const toggleBacklog = React.useCallback(async (e, key, backlogged) => {
    e.stopPropagation();
    try { await invoke("setEpicBacklog", { key, backlogged }); await loadData(); } catch (err) { setErr(String(err)); }
  }, [loadData]);
  // Refresh the open epic side-panel: re-fetch, then re-point `selected` to the fresh epic (by key)
  // so a just-added comment / checkmark shows without reloading the tab.
  const refreshSelected = React.useCallback(async () => {
    const d = await loadData();
    if (!d || !selected) return;
    const raw = (kind === "feature" ? d.feature : d.bug) || [];
    const fresh = raw.find((r) => r.key === selected.key);
    setSelected(fresh ? { ...fresh, type: kind === "feature" ? "Feature" : "Bug", phases: buildPhases(kind, fresh) } : null);
  }, [loadData, selected, kind]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cls = "app " + (dark ? "dark" : "light");
  if (err) return <div className={cls}><div className="wrap"><div className="muted">Couldn't load: {err}</div></div></div>;
  if (!data) return <Loader dark={dark} />;

  const raw = kind === "feature" ? data.feature : data.bug;
  const items = (raw || []).map((r) => ({ ...r, type: kind === "feature" ? "Feature" : "Bug", phases: buildPhases(kind, r) }));
  const backlogCount = items.filter((i) => i.backlogged).length;
  const blocked = items.filter(isBlocked).length;
  const done = items.filter((i) => i.phases.every((p) => p.state === "done")).length;
  const awaitCOO = items.filter((i) => { const p = i.phases[currentPhaseIdx(i)]; return p && p.state !== "done" && p.checklist.some((x) => x.coo && !x.done) && p.pct >= 60; }).length;
  const tiles = [["Total items", items.length, ""], ["In progress", items.length - done - blocked, "amber"], ["Delayed", blocked, "amber"], ["Awaiting COO sign-off", awaitCOO, "violet"], ["Completed", done, "green"]];

  // main-table search + filters (phase-tracked view, both tabs)
  const fl = fq.trim().toLowerCase();
  const statusOpts = [...new Set(items.map((it) => overall(it).t))];
  const phaseOpts = [...new Set(items.map((it) => { const cp = it.phases[currentPhaseIdx(it)]; return cp && cp.name; }).filter(Boolean))];
  // Search haystack = the epic AND everything associated with it in the dashboard's model:
  // the epic key/title, each phase story key + name, each checklist item's text, and any
  // mapped/linked task key. So searching a child story, a mapped sub-task / linked ticket, or an
  // item's wording surfaces its parent epic — scoped to the current tab's list of epics.
  const epicHaystack = (it) => {
    const parts = [it.key, it.sum, it.assignee]; // include the responsible person (epic assignee)
    for (const p of (it.phases || [])) {
      if (p.storyKey) parts.push(p.storyKey);
      if (p.name) parts.push(p.name);
      for (const c of (p.checklist || [])) {
        if (c.txt) parts.push(c.txt);
        if (c.mappedTask && c.mappedTask.key) parts.push(c.mappedTask.key);
        if (c.note && c.note.noteByName) parts.push(c.note.noteByName); // who noted/completed an item
      }
    }
    return parts.filter(Boolean).join(" • ").toLowerCase();
  };
  const shown = items.filter((it) => {
    const cp = it.phases[currentPhaseIdx(it)];
    return (!fl || epicHaystack(it).includes(fl) || (descKeys && descKeys.has(it.key))) &&
      (!fstatus || overall(it).t === fstatus) && (!fphase || (cp && cp.name === fphase)) &&
      (showCompleted || !it.phases.every((p) => p.state === "done")) &&   // hide all-phases-complete unless toggled on
      (showBacklog || !it.backlogged);   // hide parked (backlogged) epics unless toggled on
  });
  const fdirty = fq || fstatus || fphase;
  const pagedItems = shown.slice((mpage - 1) * PAGE_SIZE, mpage * PAGE_SIZE);

  return (
    <div className={cls}>
      <div className="wrap">
        <div className="top">
          <div>
            <h1>Quality Check Tracker ZilMoney</h1>
            <div className="sub">Phase-gate compliance across every item — status, checklist % and sign-offs read live from each epic's phase-stories</div>
          </div>
          <div className="spacer" />
          <button className="toggle" onClick={() => setShowDaily(true)} title="Open Daily Report panel">📋 Daily Report</button>
          <button className="toggle" onClick={() => loadData()} disabled={refreshing} title="Reload live data from Jira">{refreshing ? "⏳ Refreshing…" : "🔄 Refresh"}</button>
          <button className={"toggle" + (showCompleted ? " on" : "")} onClick={() => setShowCompleted((s) => !s)} title="Show or hide fully-completed items (all phases done, and Done simple bugs)">{showCompleted ? "✓ Completed shown" : "Show completed"}</button>
          <button className={"toggle" + (showBacklog ? " on" : "")} onClick={() => setShowBacklog((s) => !s)} title="Show or hide epics you've parked (backlogged) so they don't clutter the tracker">{showBacklog ? `✓ Backlogged shown (${backlogCount})` : `Show backlogged${backlogCount ? ` (${backlogCount})` : ""}`}</button>
          <button className="toggle" onClick={() => setDark((d) => !d)}>{dark ? "☀️ Light" : "🌙 Dark"}</button>
        </div>

        <div className="tabs">
          <button className={kind === "feature" ? "on" : ""} onClick={() => setKind("feature")}>Features · {(data.feature || []).length}</button>
          <button className={kind === "bug" ? "on" : ""} onClick={() => setKind("bug")}>Bugs · {(data.bug || []).length}</button>
        </div>

        <div className="tiles">
          {tiles.map((t, i) => <div className="tile" key={i}><div className="l">{t[0]}</div><div className={`v ${t[2]}`}>{t[1]}</div></div>)}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h2>Master Tracker — {kind === "feature" ? "Features" : "Bugs"}</h2>
            <div className="subtabs">
              <button className={bugView === "phases" ? "on" : ""} onClick={() => setBugView("phases")}>Phase-tracked epics</button>
              <button className={bugView === "labelonly" ? "on" : ""} onClick={() => setBugView("labelonly")}>Simple</button>
            </div>
            <span className="hint">{bugView === "labelonly" ? `simple ${kind === "bug" ? "bugs" : "features"} — live Jira status, search & filter` : "click any row for its full sign-off tracker & checklists"}</span>
          </div>
          {bugView === "labelonly" ? <SimpleList kind={kind} showCompleted={showCompleted} /> : (
          <>
          <div className="bl-filters">
            <input className="bl-search" placeholder="Search epic, story, sub-task or linked key / text…" value={fq} onChange={(e) => setFq(e.target.value)} />
            <select value={fstatus} onChange={(e) => setFstatus(e.target.value)}><option value="">All statuses</option>{statusOpts.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <select value={fphase} onChange={(e) => setFphase(e.target.value)}><option value="">All phases</option>{phaseOpts.map((p) => <option key={p} value={p}>{p}</option>)}</select>
            {fdirty ? <button className="bl-clear" onClick={() => { setFq(""); setFstatus(""); setFphase(""); }}>clear</button> : null}
            <span className="bl-count">{shown.length} of {items.length}</span>
          </div>
          <table>
            <thead><tr>
              <th>Item</th>
              <th className="hide-sm">Type</th>
              <th className="hide-sm">Priority</th>
              <th className="hide-sm">Phase pipeline</th>
              <th>Current phase</th>
              <th className="hide-sm">% complete</th>
              <th>Overall status</th>
              <th className="hide-sm">Next gate</th>
            </tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: "20px 14px" }}>{items.length === 0 ? `No ${kind === "feature" ? "features" : "bugs"} found in this window.` : "No items match these filters."}</td></tr>}
              {pagedItems.map((it) => {
                const cp = it.phases[currentPhaseIdx(it)];
                const o = overall(it);
                return (
                  <tr key={it.key} className={it.backlogged ? "bl-parked" : undefined} onClick={() => setSelected(it)}>
                    <td><span className="k klink" onClick={(e) => openIssue(e, it.key)} title="Open in Jira">{it.key} ↗</span><div className="sum">{it.sum}</div><div className="epic-owner">{it.assignee || "Unassigned"}</div><div className={"li-due" + (it.due || isBlocked(it) ? "" : " none")}>{isBlocked(it) ? <span className="blk-tag">⚠️ Delayed</span> : it.due ? "Due " + fmtDT(it.due) : "No due date"}</div>{it.parked ? <button className="bl-park" title="Restore this epic to the tracker" onClick={(e) => toggleBacklog(e, it.key, false)}>↩ Restore</button> : it.backlogged ? <span className="bl-tag" title={"In Jira " + (it.statusName || "Backlog") + " status — move it out of Backlog in Jira to restore it"}>🗄 In Backlog</span> : <button className="bl-park" title="Backlog (park) this epic so it doesn't clutter the tracker" onClick={(e) => toggleBacklog(e, it.key, true)}>🗄 Backlog</button>}{descMatches[it.key] && descMatches[it.key].length > 0 && <div className="match-hits">↳ matched {descMatches[it.key].map((k) => <span key={k} className="match-hit" onClick={(e) => openIssue(e, k)} title="Open matched ticket in Jira">{k} ↗</span>)}</div>}</td>
                    <td className="hide-sm"><TypeCell it={it} /></td>
                    <td className="hide-sm owner">{it.priority || "—"}</td>
                    <td className="hide-sm"><div className="rail">{it.phases.map((p, i) => <span key={i} className={`seg ${phaseCls(p)}`} title={`${p.name}: ${p.status}`} />)}</div></td>
                    <td><Chip c={cp.state === "done" ? "green" : "amber"}>{cp.name}</Chip></td>
                    <td className="hide-sm"><span className="bar"><i style={{ width: donePct(it) + "%" }} /></span><span className="pctnum">{donePct(it)}%</span></td>
                    <td><Chip c={o.c}>{o.t}</Chip></td>
                    <td className="hide-sm owner">{o.t === "Complete" ? "—" : cp.owner}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager total={shown.length} page={mpage} setPage={setMpage} />
          </>
          )}
        </div>
      </div>

      {showDaily && <DailyReportPanel onClose={() => setShowDaily(false)} />}
      <div className={"scrim" + (selected ? " open" : "")} onClick={() => setSelected(null)} />
      <div className={"drawer" + (selected ? " open" : "")}>
        {selected && <DrawerBody item={selected} kind={kind} onClose={() => setSelected(null)} onRefresh={refreshSelected} refreshing={refreshing} />}
      </div>
    </div>
  );
}

function DedupeBtn({ epicKey }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const run = async () => {
    setBusy(true); setMsg(null);
    const res = await invoke("dedupePhases", { epicKey });
    setBusy(false);
    if (res && res.ok) {
      const d = res.deleted.length, s = res.skipped.length;
      setMsg(d ? `Removed ${d} duplicate${d > 1 ? "s" : ""}${s ? `, skipped ${s}` : ""} — reloading…` : (s ? `No safe dupes (skipped ${s})` : "No duplicates found"));
      if (d) setTimeout(() => window.location.reload(), 1200);
    } else setMsg((res && res.error) || "failed");
  };
  return <span className="dedupe" onClick={run} title="Delete duplicate phase-stories (keeps the original)">{busy ? "…cleaning" : "🧹 Clean duplicate phases"}{msg ? <span className="dedupe-msg"> — {msg}</span> : null}</span>;
}

function DrawerBody({ item, kind, onClose, onRefresh, refreshing }) {
  const o = overall(item);
  const dp = donePct(item);
  return (
    <>
      <div className="d-head">
        <button className="x" onClick={onClose} aria-label="Close">×</button>
        <div className="k klink" onClick={(e) => openIssue(e, item.key)} title="Open epic in Jira">{item.key} ↗</div>
        <div className="d-title">{item.sum}</div>
        <div className="d-meta"><TypeCell it={item} /> <Chip c={o.c}>{o.t}</Chip> <span className="owner">{item.phases.length} phases</span><span className="owner">· {isBlocked(item) && !item.blocked ? <span className="blk-tag">⚠️ Delayed</span> : <DueBlocked epicKey={item.key} storyKey={null} due={item.due} blocked={item.blocked} />}</span></div>
        <div className="d-actions"><button className="toggle" onClick={onRefresh} disabled={refreshing} title="Reload this epic from Jira">{refreshing ? "⏳ Refreshing…" : "🔄 Refresh"}</button><DedupeBtn epicKey={item.key} /></div>
      </div>
      <div className="d-body">
        <div className="d-overall">
          <div><div className="big">{dp}%</div><div className="owner">phases complete</div></div>
          <div style={{ flex: 1 }}>
            <span className="bar" style={{ width: "100%" }}><i style={{ width: dp + "%" }} /></span>
            <div className="owner" style={{ marginTop: 8 }}>Master Sign-off Tracker — one row per phase · expand for checklist</div>
          </div>
        </div>
        {(() => { const dev = item.phases.find((x) => x.label === "phase-development"); const devStoryKey = dev ? dev.storyKey : null;
          return item.phases.map((p, i) => <PhaseCard key={i} p={p} n={i + 1} epicKey={item.key} kind={kind} devStoryKey={devStoryKey} />); })()}
      </div>
    </>
  );
}

function ItemMap({ epicKey, storyKey, idx, mapped }) {
  const [state, setState] = useState(mapped || null);
  const [mode, setMode] = useState(null); // 'map' | 'add' | null
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const doMap = async () => {
    const taskKey = val.trim().toUpperCase();
    if (!taskKey) return;
    setBusy(true); setErr(null);
    const res = await invoke("mapTaskToItem", { epicKey, storyKey, itemIndex: idx, taskKey });
    setBusy(false);
    if (res && res.ok) { setState({ key: taskKey }); setMode(null); setVal(""); }
    else setErr((res && res.error) || "failed");
  };
  const doAdd = async () => {
    const summary = val.trim();
    if (!summary) return;
    setBusy(true); setErr(null);
    const res = await invoke("createTaskForItem", { epicKey, storyKey, itemIndex: idx, summary });
    setBusy(false);
    if (res && res.ok) { setState({ key: res.key }); setMode(null); setVal(""); }
    else setErr((res && res.error) || "failed");
  };
  const clear = async (e) => { e.stopPropagation(); setBusy(true); await invoke("mapTaskToItem", { epicKey, storyKey, itemIndex: idx, taskKey: "" }); setBusy(false); setState(null); };

  if (state && state.key) {
    return (
      <div className="itemmap" onClick={(e) => e.stopPropagation()}>
        <span className="im-link" onClick={(e) => openIssue(e, state.key)} title="Open mapped task">🔗 {state.key} ↗</span>
        <span className="im-due">· {state.due ? "due " + fmtDT(state.due) : "no due date"}</span>
        <span className="im-x" onClick={clear} title="Unlink this task from the checklist item">unlink ✕</span>
      </div>
    );
  }
  return (
    <div className="itemmap" onClick={(e) => e.stopPropagation()}>
      {mode === "map" ? (
        <>
          <input className="im-input" placeholder="Task key e.g. OCW-1234" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doMap(); }} autoFocus />
          <button className="im-btn" onClick={doMap} disabled={busy}>{busy ? "…" : "Map"}</button>
          <span className="im-cancel" onClick={() => { setMode(null); setErr(null); }}>cancel</span>
          {err && <span className="im-err">{err}</span>}
        </>
      ) : mode === "add" ? (
        <>
          <input className="im-input" placeholder="New task summary…" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doAdd(); }} autoFocus />
          <button className="im-btn" onClick={doAdd} disabled={busy}>{busy ? "…" : "Create"}</button>
          <span className="im-cancel" onClick={() => { setMode(null); setErr(null); }}>cancel</span>
          {err && <span className="im-err">{err}</span>}
        </>
      ) : (
        <>
          <span className="im-add" onClick={() => { setMode("map"); setVal(""); }}>🔗 map task</span>
          <span className="im-add" onClick={() => { setMode("add"); setVal(""); }}>➕ add task</span>
        </>
      )}
    </div>
  );
}

function ItemNote({ epicKey, storyKey, idx, phaseName, itemText, note }) {
  const [state, setState] = useState(note || null);
  const [editing, setEditing] = useState(false);
  const [ask, setAsk] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);

  const doSave = async (completed) => {
    const text = val.trim();
    if (!text) return;
    setBusy(true);
    const res = await invoke("setItemNote", { epicKey, storyKey, itemIndex: idx, note: text, completed, phaseName, itemText, byName: await getMyName() });
    setBusy(false);
    if (res && res.ok) { setState({ text, by: res.by, at: res.at, completed }); setAsk(false); setEditing(false); setVal(""); }
  };
  const clear = async (e) => { e.stopPropagation(); setBusy(true); await invoke("setItemNote", { epicKey, storyKey, itemIndex: idx, note: "" }); setBusy(false); setState(null); };

  if (state && state.text) {
    return (
      <div className="itemnote" onClick={(e) => e.stopPropagation()}>
        <span className="in-txt">📝 {state.text}{state.by ? <span className="in-by"> — {state.by}{state.at ? " · " + fmtDT(state.at) : ""}{state.completed ? " · ✓ completed" : ""}</span> : null}</span>
        <span className="im-x" onClick={clear} title="Remove note">✕</span>
      </div>
    );
  }
  return (
    <div className="itemmap" onClick={(e) => e.stopPropagation()}>
      {editing ? (
        <>
          <input className="im-input" placeholder="Note / evidence…" value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) setAsk(true); }} autoFocus />
          <button className="im-btn" onClick={() => val.trim() && setAsk(true)} disabled={busy}>Save</button>
          <span className="im-cancel" onClick={() => { setEditing(false); setAsk(false); }}>cancel</span>
        </>
      ) : (
        <span className="im-add" onClick={() => setEditing(true)}>💬 add note</span>
      )}
      {ask && (
        <div className="notepop" onClick={(e) => e.stopPropagation()}>
          <div className="np-q">Save the comment and mark this checklist item as completed?</div>
          <div className="np-btns">
            <button className="np-yes" onClick={() => doSave(true)} disabled={busy}>{busy ? "…" : "Save & mark completed"}</button>
            <button className="np-no" onClick={() => doSave(false)} disabled={busy}>Just save comment</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreatePhase({ epicKey, kind, label }) {
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(null);
  const [err, setErr] = useState(null);
  const create = async (e) => {
    e.stopPropagation();
    setBusy(true); setErr(null);
    const res = await invoke("createPhaseStory", { epicKey, kind, phaseLabel: label });
    setBusy(false);
    if (res && (res.ok || res.key)) setKey(res.key);
    else setErr((res && res.error) || "failed");
  };
  if (key) return <span className="ph-key" onClick={(e) => openIssue(e, key)} title="Open new phase story"> {key} ↗ <span className="ph-hint">(reload to see checklist)</span></span>;
  return <span className="ph-create" onClick={create} title="Create this phase story + checklist">{busy ? " …" : " + create phase"}{err ? <span className="im-err"> {err}</span> : null}</span>;
}

// Recursive tree node — a sub-task or a linked story, with its own children (deep breakdown is via
// linked Backend/Frontend stories). Collapsible; top level open by default.
// Push panel — the tech-lead triage: pick items, choose an existing/new dev target, set a compulsory
// due date, and COPY the selected items to the target as "QA Rework N". Split supported (push a subset,
// then push the rest elsewhere).
// Triage form for ONE checklist block — select items, choose target, set a compulsory due date, push.
// Push form — operates only on UNPUSHED open items (already-pushed ones are locked in the block view).
function PushForm({ pushable, roundN, epicKey, devStoryKey, qaKey, onDone }) {
  const [sel, setSel] = useState(() => pushable.map(() => true));
  const [mode, setMode] = useState("new");
  const [tgt, setTgt] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const chosen = pushable.filter((_, i) => sel[i]);
  const push = async () => {
    setErr(null);
    if (!chosen.length) { setErr("Select at least one item."); return; }
    if (!due) { setErr("Due date is required."); return; }
    if (mode === "existing" && !tgt.trim()) { setErr("Enter the existing task key."); return; }
    setBusy(true);
    const res = await invoke("pushRework", { epicKey, devStoryKey, qaKey, round: roundN, items: chosen.map(itText), targetKey: mode === "existing" ? tgt.trim() : "", dueDate: due });
    setBusy(false);
    if (res && res.ok) onDone(chosen.map(itText), res.target, `Pushed ${res.count} → ${res.target}${res.created ? " (new)" : ""} · due ${fmtDT(res.dueDate)}`);
    else setErr((res && res.error) || "push failed");
  };
  return (
    <div className="push" onClick={(e) => e.stopPropagation()}>
      <div className="push-items">
        {pushable.map((it, i) => (
          <label className="push-it" key={i}><input type="checkbox" checked={!!sel[i]} onChange={() => setSel((s) => s.map((v, j) => (j === i ? !v : v)))} /> <span>{itText(it)}</span>{itLoom(it) ? <span className="cb-loom sm" onClick={(e) => { e.stopPropagation(); router.open(itLoom(it)); }} title="Open Loom">▶</span> : null}</label>
        ))}
      </div>
      <div className="push-form">
        <span className="push-lbl">{chosen.length}/{pushable.length} → QA Rework {roundN}</span>
        <label className="push-r"><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> New</label>
        <label className="push-r"><input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> Existing</label>
        {mode === "existing" && <input className="push-in" placeholder="OCW-1234" value={tgt} onChange={(e) => setTgt(e.target.value)} />}
        <input className="push-in" type="date" value={due} onChange={(e) => setDue(e.target.value)} title="Due date (required)" />
        <button className="push-go" onClick={push} disabled={busy}>{busy ? "…" : "Push"}</button>
      </div>
      {err ? <div className="im-err">{err}</div> : null}
    </div>
  );
}

// A checklist block under a sub-task. Items track a local pushed-state so an item can't be pushed twice
// (it shows "→ target · undo" instead); undo frees it to push elsewhere. No duplicate checklists.
function ChecklistBlock({ block, epicKey, devStoryKey, canPush, qaKey }) {
  const [items, setItems] = useState(() => block.items || []);
  const [pushing, setPushing] = useState(false);
  const isDefect = block.isDefect;
  const roundN = (block.name.match(/(\d+)/) || [])[1] || 1;
  const pushable = items.filter((it) => it.state === "open" && !it.pushedTo);
  const openCount = items.filter((it) => it.state === "open").length;
  const doneCount = items.filter((it) => it.state !== "open").length;
  const canShowPush = canPush && isDefect && pushable.length > 0;
  const onPushed = (texts, target) => { setItems((arr) => arr.map((it) => texts.includes(itText(it)) ? { ...it, pushedTo: target } : it)); setPushing(false); };
  const undo = async (it) => {
    const res = await invoke("undoPush", { epicKey, qaKey, round: roundN, target: it.pushedTo });
    if (res && res.ok) setItems((arr) => arr.map((x) => (x.pushedTo === it.pushedTo ? { ...x, pushedTo: null } : x)));
  };
  return (
    <div className={"cb" + (isDefect ? " defect" : "")}>
      <div className="cb-head">
        <span className={"cb-name" + (isDefect ? " fail" : "")}>{block.name}</span>
        <span className="cb-count">{openCount ? openCount + " open · " : ""}{doneCount} done</span>
        {canShowPush ? <span className="cb-push" onClick={(e) => { e.stopPropagation(); setPushing((v) => !v); }}>{pushing ? "cancel" : "⇄ push"}</span> : null}
      </div>
      {pushing ? <PushForm pushable={pushable} roundN={roundN} epicKey={epicKey} devStoryKey={devStoryKey} qaKey={qaKey} onDone={onPushed} /> : (
        items.length ? <div className="cb-items">{items.map((it, i) => (
          <div className={"cb-item " + (it.state || "open") + (it.pushedTo ? " pushed" : "")} key={i}>
            <span className="cb-mk">{it.state === "done" ? "✓" : it.state === "skipped" ? "–" : it.pushedTo ? "➜" : "○"}</span>
            <span className="cb-tx">{itText(it)}</span>
            {it.pushedTo ? <span className="cb-pushed" onClick={(e) => openIssue(e, it.pushedTo)} title="Open the task it was pushed to">→ {it.pushedTo}</span> : null}
            {it.pushedTo ? <span className="cb-undo" onClick={(e) => { e.stopPropagation(); undo(it); }} title="Undo the push — frees this item to push to another task">undo</span> : null}
            {!it.pushedTo && itLoom(it) ? <span className="cb-loom sm" onClick={(e) => { e.stopPropagation(); router.open(itLoom(it)); }} title="Open Loom">▶</span> : null}
          </div>
        ))}</div> : null
      )}
    </div>
  );
}

// One tree node — loads its OWN children on first expand (lazy). Expanding also reveals its checklists.
function TreeNode({ node, depth, epicKey, devStoryKey, qaContext }) {
  const hasChecklists = node.blocks && node.blocks.length;
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState(null);
  const [busy, setBusy] = useState(false);
  const c = node.cat === "done" ? "ok" : node.cat === "indeterminate" ? "prog" : "todo";
  const canExpand = node.hasChildren || hasChecklists;
  const canPush = qaContext && !node.isStory;
  const toggle = async (e) => {
    e.stopPropagation();
    if (!canExpand) return;
    const willOpen = !open; setOpen(willOpen);
    if (willOpen && node.hasChildren && kids === null) {
      setBusy(true);
      const r = await invoke("getChildren", { parentKey: node.key, includeLinks: false, epicKey });
      setBusy(false);
      setKids(r && r.ok ? r.children : []);
    }
  };
  return (
    <div className="tn">
      <div className={"tn-row" + (node.isStory ? " story" : "")} style={{ paddingLeft: depth * 15 + "px" }}>
        <span className={"tn-c" + (canExpand ? "" : " dot")} onClick={toggle}>{canExpand ? (open ? "▾" : "▸") : "·"}</span>
        <span className={"tn-badge " + (node.isStory ? "story" : "sub")}>{node.isStory ? "Story" : "Sub"}</span>
        <span className="tn-key" onClick={(e) => openIssue(e, node.key)} title="Open in Jira">{node.key}</span>
        <span className="tn-sum">{node.sum}</span>
        {node.defectCount ? <span className="tn-fail" title="Open defect items (Defects N)">{node.defectCount} defects</span> : (node.openCount ? <span className="tn-open2" title="Open checklist items">{node.openCount} open</span> : null)}
        <span className={"tn-dot " + c} title={node.status}></span>
        <span className="tn-st">{node.resolved ? "✓ " + fmtDT(node.resolved) : node.status}{node.assignee ? " · " + node.assignee : ""}{node.due ? " · " + (node.resolved ? "rework " : "") + fmtDT(node.due) : ""}</span>
      </div>
      {open && hasChecklists ? (
        <div className="cb-wrap" style={{ paddingLeft: depth * 15 + 26 + "px" }}>
          {node.blocks.map((b, i) => <ChecklistBlock key={i} block={b} epicKey={epicKey} devStoryKey={devStoryKey} canPush={canPush} qaKey={node.key} />)}
        </div>
      ) : null}
      {open && busy ? <div className="st-empty" style={{ paddingLeft: depth * 15 + 26 + "px" }}>…</div> : null}
      {open && kids ? kids.map((ch) => <TreeNode key={ch.key} node={ch} depth={depth + 1} epicKey={epicKey} devStoryKey={devStoryKey} qaContext={qaContext} />) : null}
    </div>
  );
}
// Phase-story tree root — loads only its DIRECT children on first open; each node loads deeper on demand.
function SubtaskTree({ rootKey, epicKey, devStoryKey, qaContext }) {
  const [kids, setKids] = useState(null);
  const [selfBlocks, setSelfBlocks] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async (e) => {
    e.stopPropagation();
    if (kids !== null) { setOpen((o) => !o); return; }
    setBusy(true);
    const r = await invoke("getChildren", { parentKey: rootKey, includeLinks: true, epicKey });
    setBusy(false);
    setKids(r && r.ok ? r.children : []);
    // the phase-story's OWN defect blocks (defects added directly on it, no sub-task) — pushable at root
    setSelfBlocks(r && r.ok && r.self ? (r.self.blocks || []).filter((b) => b.isDefect) : []);
    setOpen(true);
  };
  const hasKids = kids && kids.length;
  return (
    <div className="subtree" onClick={(e) => e.stopPropagation()}>
      <span className="st-toggle" onClick={load}>{busy ? "… loading" : open ? "▾ Hide sub-stories & sub-tasks" : "▸ Show sub-stories & sub-tasks (tree)"}</span>
      {open && selfBlocks.length ? (
        <div className="st-self">
          <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, margin: "6px 0 2px" }} title="Defects added directly on this phase-story (no sub-task)">Defects on this task · {rootKey}</div>
          {selfBlocks.map((b, i) => <ChecklistBlock key={i} block={b} epicKey={epicKey} devStoryKey={devStoryKey} canPush={qaContext} qaKey={rootKey} />)}
        </div>
      ) : null}
      {open && kids ? (hasKids ? <div className="st-body">{kids.map((ch) => <TreeNode key={ch.key} node={ch} depth={0} epicKey={epicKey} devStoryKey={devStoryKey} qaContext={qaContext} />)}</div> : (selfBlocks.length ? null : <div className="st-empty">No sub-stories or sub-tasks under {rootKey}.</div>)) : null}
    </div>
  );
}

function PhaseCard({ p, n, epicKey, kind, devStoryKey }) {
  const [open, setOpen] = useState(false);
  const nCls = phaseCls(p);
  // Task progress = the phase's lifecycle/status (0 not-started · 50 in-progress · 100 done/skipped).
  const taskPct = p.skipped ? 100 : (p.state === "done" || p.status === "Complete") ? 100 : (p.status === "In Progress" || p.state === "current" || p.state === "blocked") ? 50 : 0;
  const taskCls = (p.state === "blocked" || p.status === "Delayed") ? "amber" : taskPct === 100 ? "done" : taskPct > 0 ? "prog" : "todo";
  const taskLbl = p.skipped ? "Skipped" : p.status;
  // Check progress = % of checklist items complete in this phase.
  const chkPct = p.pct || 0;
  return (
    <div className={"ph" + (p.state === "current" || p.state === "blocked" ? " cur" : "")}>
      <div className="ph-row" onClick={() => setOpen((o) => !o)}>
        <span className={`ph-n ${nCls}`}>{n}</span>
        <div>
          <div className="ph-name">{p.name}{p.storyKey ? <span className="ph-key" onClick={(e) => openIssue(e, p.storyKey)} title="Open phase story in Jira"> {p.storyKey} ↗</span> : <CreatePhase epicKey={epicKey} kind={kind} label={p.label} />}</div>
          <div className="ph-owner">{p.owner} · {p.rework ? <span className="muted">QA failed → rework loop</span> : p.storyKey ? <DueBlocked epicKey={epicKey} storyKey={p.storyKey} due={p.due} blocked={p.blocked} /> : (p.due ? "Due " + fmtDT(p.due) : "No due date")}{!p.rework && p.storyKey && (p.skipped || p.state !== "done") && <SkipPhase epicKey={epicKey} storyKey={p.storyKey} skipped={p.skipped} />}</div>
        </div>
        <div className="ph-right">
          <div className="ph-bars">
            <div className="pb"><span className="pb-l">Task</span><span className="pbar"><i className={"pbf " + taskCls} style={{ width: taskPct + "%" }} /></span><span className="pb-n">{taskLbl}</span></div>
            <div className="pb"><span className="pb-l">Check</span><span className="pbar"><i className="pbf chk" style={{ width: chkPct + "%" }} /></span><span className="pb-n">{chkPct}%</span></div>
          </div>
          <div className="signoff">
            {p.approver ? <><b>{p.approver}</b> · {p.approverDate}</> : <span style={{ color: "var(--subtle)" }}>— not signed —</span>}<br />
            {p.coo ? <><span className="coo">{p.coo}</span> · {p.cooDate}</> : <span style={{ color: "var(--subtle)" }}>COO —</span>}
          </div>
          <span className="caret">{open ? "▾" : "▸"}</span>
        </div>
      </div>
      <div className={"cl" + (open ? " open" : "")}>
        {p.rework ? <ReworkBody epicKey={epicKey} p={p} /> : <>
        {p.storyKey ? <ErrorBoundary><SubtaskTree rootKey={p.storyKey} epicKey={epicKey} devStoryKey={devStoryKey} qaContext={/qa/i.test(p.label || "")} /></ErrorBoundary> : null}
        {p.checklist.map((c, j) => (
          <div className={"cl-item" + (c.coo ? " coo" : "") + (c.skipped ? " skipped" : "")} key={j}>
            <span className={"box" + (c.done ? " done" : "") + (c.skipped ? " skip" : "")}>{c.skipped ? "–" : c.done ? "✓" : ""}</span>
            <div className="cl-txt">
              {c.txt}<div className="own">{c.owner}</div>
              {p.storyKey && <ItemMap epicKey={epicKey} storyKey={p.storyKey} idx={j} mapped={c.mappedTask} />}
              {p.storyKey && <ItemNote epicKey={epicKey} storyKey={p.storyKey} idx={j} phaseName={p.name} itemText={c.txt} note={c.note} />}
            </div>
            <div className="cl-by">{c.skipped ? "⏭️ skipped" : c.note ? (c.note.completed ? <>✓ {c.note.by || "done"}{c.note.at ? " · " + fmtDT(c.note.at) : ""}</> : <>💬 {c.note.by || "note"}</>) : c.mappedTask && c.mappedTask.approver ? <>{c.mappedTask.approved ? "✓ " : ""}{c.mappedTask.approver}</> : (c.done ? "✓" : "—")}</div>
          </div>
        ))}
        {p.notes ? <div className="notes"><b>Notes:</b> {p.notes}</div> : null}
        </>}
      </div>
    </div>
  );
}

// --- QA Rework loop panel (shown inside the synthetic "QA Rework" phase) ---
function ReworkDate({ epicKey, storyKey, round, value, by, at }) {
  const [val, setVal] = useState(value ? String(value).slice(0, 10) : "");
  const [saved, setSaved] = useState(value ? { by, at } : null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.stopPropagation(); setBusy(true);
    const res = await invoke("setReworkDate", { epicKey, storyKey, round, date: val || "", byName: await getMyName() });
    setBusy(false);
    if (res && res.ok) setSaved(val ? { by: res.by, at: new Date().toISOString() } : null);
  };
  return (
    <div className="rw-date" onClick={(e) => e.stopPropagation()}>
      <span className="de-label">Rework completion date{val ? "" : " (or target, if in progress)"}</span>
      <input type="date" value={val} onChange={(e) => setVal(e.target.value)} />
      <button className="im-btn" onClick={save} disabled={busy}>{busy ? "…" : "Save"}</button>
      {saved && saved.by ? <span className="blk-by">✓ {saved.by}{saved.at ? " · " + fmtDT(saved.at) : ""}</span> : null}
    </div>
  );
}

function PhaseDue({ label, storyKey, due }) {
  const [val, setVal] = useState(due ? String(due).slice(0, 10) : "");
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);
  const save = async (e) => {
    e.stopPropagation(); setBusy(true); setOk(false);
    const res = await invoke("setPhaseDue", { storyKey, due: val || "" });
    setBusy(false); setOk(!!(res && res.ok));
  };
  return (
    <div className="rw-date" onClick={(e) => e.stopPropagation()}>
      <span className="de-label">{label}</span>
      <input type="date" value={val} onChange={(e) => setVal(e.target.value)} />
      <button className="im-btn" onClick={save} disabled={busy}>{busy ? "…" : "Save"}</button>
      {ok ? <span className="blk-by">✓ saved</span> : null}
    </div>
  );
}

// One rework round — collapsed by default (a header you click to expand its defect items + date),
// so a multi-round loop stays compact instead of one long scroll.
function ReworkRound({ epicKey, devKey, r }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={"rw-round" + (r.complete ? " done" : "")}>
      <div className="rw-head" onClick={() => setOpen((o) => !o)}>
        <span className="rw-caret">{open ? "▾" : "▸"}</span> Round {r.n} — {r.complete ? "✓ complete" : "in progress"}
        <span className="rw-count"> · {r.items.length} item{r.items.length !== 1 ? "s" : ""}{r.completedDate ? " · done " + r.completedDate : ""}</span>
      </div>
      {open && <>
        <div className="rw-items">{r.items.map((it, i) => <div key={i} className={"rw-item" + (it.done ? " done" : "")}><span className="box2">{it.done ? "✓" : "○"}</span> {it.text}</div>)}</div>
        <ReworkDate epicKey={epicKey} storyKey={devKey} round={r.n} value={r.completedDate} by={r.dateBy} at={r.dateAt} />
      </>}
    </div>
  );
}

// QA Rework phase body — grouped by rework LOOP (one dev target ↔ one QA sub-task), loaded on demand from
// getReworkRounds(epicKey). Each loop shows the dev fix + the QA source (with retest state) and a strip of
// its own rounds 1..N. Grouping by loop (not by global round) avoids merging unrelated loops into one box.
function ReworkBody({ epicKey, p }) {
  const [loops, setLoops] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    invoke("getReworkRounds", { epicKey }).then((r) => { if (!live) return; if (r && r.ok) setLoops(r.loops || []); else setErr((r && r.error) || "failed to load"); }).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [epicKey]);
  if (err) return <div className="eb">⚠️ {err}</div>;
  if (loops === null) return <div className="st-empty">… loading rework loops</div>;
  if (!loops.length) return <div className="st-empty">No rework pushed yet.</div>;
  return (
    <div className="rework">
      {loops.map((lp) => {
        const last = lp.rounds[lp.rounds.length - 1] || {};
        // retest state of the latest round: retested → in progress (actively In QA, or a retest due set) → awaiting
        const inProg = !last.retested && (lp.qaCat === "indeterminate" || !!lp.qaDue);
        const rmk = last.retested ? "ok" : inProg ? "prog" : "open";
        const rsym = last.retested ? "✓" : inProg ? "◐" : "○";
        const rlbl = last.retested ? "retested ✓" : inProg ? "retest in progress" : "awaiting retest";
        return (
          <div className={"rwr" + (lp.done ? " done" : "")} key={(lp.devKey || "") + "|" + (lp.qaKey || "")}>
            <div className="rwr-head">Rework loop — <span className="tn-key" onClick={(e) => openIssue(e, lp.devKey)}>{lp.devKey}</span> ↔ <span className="tn-key" onClick={(e) => openIssue(e, lp.qaKey)}>{lp.qaKey}</span> <span className={"rwr-badge " + (lp.done ? "ok" : "act")}>{lp.done ? "✓ closed" : "active"}</span> <span className="rwr-badge">{lp.rounds.length} round{lp.rounds.length > 1 ? "s" : ""}</span></div>
            <div className="rwr-col">
              <div className="rwr-lbl">Dev fix</div>
              <div className="rwr-row">
                <span className={"rwr-mk " + (last.fixDone ? "ok" : "open")}>{last.fixDone ? "✓" : "○"}</span>
                <span className="tn-key" onClick={(e) => openIssue(e, lp.devKey)}>{lp.devKey}</span>
                <span className="rwr-sum">{lp.devSum}{lp.devOwner ? " · " + lp.devOwner : ""}</span>
                <span className="rwr-dt">{lp.devPrevDone ? "done " + fmtDT(lp.devPrevDone) + " · " : ""}{last.due ? "rework due " + fmtDT(last.due) : ""}</span>
              </div>
            </div>
            <div className="rwr-col">
              <div className="rwr-lbl">QA source</div>
              <div className="rwr-row">
                <span className={"rwr-mk " + rmk}>{rsym}</span>
                <span className="tn-key" onClick={(e) => openIssue(e, lp.qaKey)}>{lp.qaKey}</span>
                <span className="rwr-sum">{lp.qaSum}</span>
                <span className="rwr-dt">{rlbl}{lp.qaDue ? " · retest due " + fmtDT(lp.qaDue) : ""}</span>
              </div>
            </div>
            <div className="rwr-rounds">
              {lp.rounds.map((rd) => (
                <span className={"rwr-chip" + (rd.fixDone && rd.retested ? " done" : "")} key={rd.n} title={`Round ${rd.n}: ${rd.count} item(s)${rd.due ? " · rework due " + fmtDT(rd.due) : ""} · fix ${rd.fixDone ? "done" : "open"} · retest ${rd.retested ? "done" : "open"}`}>R{rd.n} · {rd.count} · fix {rd.fixDone ? "✓" : "○"} / retest {rd.retested ? "✓" : "○"}</span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
