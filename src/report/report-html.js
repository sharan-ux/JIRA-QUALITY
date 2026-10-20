// src/report/report-html.js (CommonJS) — the branded Daily Epic Progress report as a standalone HTML
// document, rendered to PDF by tools/daily-report.js via headless Chrome. Keep the layout in sync with
// the dashboard's Download-PDF builder in static/compliance/src/App.jsx (buildReportHtml).
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (d) => { if (!d) return null; const p = String(d).split('-'); if (p.length < 3) return String(d); const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][(+p[1]) - 1] || p[1]; return `${m} ${+p[2]}`; };
const CHIP = { 'On track': 'ok', Live: 'lv', Overdue: 'od', Delayed: 'bl', 'Wrapping up': 'wr' };
const stripMd = (s) => String(s || '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/(^|\s)\*(\S.*?\S)\*(?=\s|$)/g, '$1$2').trim();

function buildReportHtml(date, active, doneTail, opts) {
  const A = active || [];
  const logo = (opts && opts.logo) || '';
  const genAt = (opts && opts.genAt) || '';
  const feats = A.filter((a) => a.kind !== 'bug');
  const bugs = A.filter((a) => a.kind === 'bug');
  const countBy = (s) => A.filter((a) => a.status === s).length;
  const item = (a, i) => {
    const cls = CHIP[a.status] || '';
    const tgt = a.due ? `Target ${fmtDate(a.due)}` : 'Target not set';
    const ph = a.phasesTotal ? `${a.phasesDone || 0}/${a.phasesTotal} phases · ${a.pctPhases || 0}%` : '—';
    const st = a.status ? `<span class="st ${cls}">${esc(a.status)}</span>` : '';
    const delay = a.delayed ? `<div class="delay">⚠ Delayed${a.delayKind ? ` (${esc(a.delayKind)})` : ''} — ${esc(stripMd(a.delayReason) || 'reason not recorded')}${a.delayBlocker ? ` · blocked by ${esc(a.delayBlocker)}` : ''}</div>` : '';
    const body = a.text && a.text.trim() ? esc(stripMd(a.text)) : '<span class="noup">No update yet.</span>';
    return `<div class="item ${cls}">
<div class="t"><span class="num">${i + 1}</span><span class="tt"><span class="k">${esc(a.key)}</span> ${esc(a.name)} ${st}</span></div>
<div class="m">${esc(a.phaseName || '—')} &nbsp;·&nbsp; ${esc(ph)} &nbsp;·&nbsp; ${esc(tgt)}</div>
${delay}<div class="b">${body}</div>
</div>`;
  };
  const section = (arr, empty) => (arr.length ? arr.map(item).join('') : `<p class="none">${empty}</p>`);
  const done = (doneTail && doneTail.length) ? doneTail.map((x) => `<li><span class="k">${esc(x.key)}</span> ${esc(x.name)}</li>`).join('') : '<li>(none)</li>';
  const wrap = countBy('Wrapping up');
  const live = countBy('Live');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Daily Epic Progress · ${esc(date)}</title>
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
${logo ? `<img class="logo" src="${logo}" alt="Zil Money" />` : ''}
<h1>Daily Epic Progress</h1>
<p class="lead">${esc(date)} · for Sabeer · auto-generated${genAt ? ` · generated ${esc(genAt)}` : ''}</p>
<div class="rule"></div>
<div class="bar"><span class="tot">${A.length} initiatives</span> &nbsp;—&nbsp; <span class="c ok">${countBy('On track')} on track</span>${live ? ` &nbsp;·&nbsp; <span class="c lv">${live} live</span>` : ''} &nbsp;·&nbsp; <span class="c od">${countBy('Overdue')} overdue</span> &nbsp;·&nbsp; <span class="c bl">${countBy('Delayed')} delayed</span>${wrap ? ` &nbsp;·&nbsp; <span class="c wr">${wrap} wrapping up</span>` : ''}</div>
<h2>Feature initiatives (${feats.length})</h2>
${section(feats, 'None.')}
<h2>Bug fixes (${bugs.length})</h2>
${section(bugs, 'None selected.')}
<h2>Completed recently (7 days)</h2>
<ul>${done}</ul>
<div class="footer"><span>Zil Money — Confidential</span><span>Daily Epic Progress · ${esc(date)}</span></div>
</body></html>`;
}

module.exports = { buildReportHtml };
