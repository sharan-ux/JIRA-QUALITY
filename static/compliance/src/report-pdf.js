// Client-side PDF generation for the Daily Epic Progress report via pdfmake (pure JS, no Chrome/print
// dialog/external service). Lazy-loaded — pdfmake + its fonts only download when Download PDF is clicked.
// Layout mirrors the report in report-html.js / App.jsx buildReportHtml (close, not pixel-identical).
import { ZM_LOGO_PNG } from "./logo-png";

const NAVY = "#073577", TEAL = "#00a5b2";
const STATUS_COLOR = { "On track": "#0a7d3f", Live: "#0e7c86", Overdue: "#b42318", Delayed: "#9a6700", "Wrapping up": "#0369a1" };
const ACCENT = { "On track": "#2e9e5b", Live: "#12a3ad", Overdue: "#d64535", Delayed: "#e0a106", "Wrapping up": "#2b8fd6" };

const fmtDate = (d) => { if (!d) return null; const p = String(d).split("-"); if (p.length < 3) return String(d); const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(+p[1]) - 1] || p[1]; return `${m} ${+p[2]}`; };
const stripMd = (s) => String(s || "").replace(/^#{1,6}\s+/gm, "").replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1").replace(/`([^`]*)`/g, "$1").replace(/(^|\s)\*(\S.*?\S)\*(?=\s|$)/g, "$1$2").trim();

function itemBlock(a, i) {
  const accent = ACCENT[a.status] || "#cbd5e1";
  const stColor = STATUS_COLOR[a.status] || "#7a8794";
  const tgt = a.due ? `Target ${fmtDate(a.due)}` : "Target not set";
  const ph = a.phasesTotal ? `${a.phasesDone || 0}/${a.phasesTotal} phases · ${a.pctPhases || 0}%` : "—";
  const brief = a.text && a.text.trim() ? stripMd(a.text) : "No update yet.";
  const briefItalics = !(a.text && a.text.trim());
  return {
    table: {
      widths: [16, "*"],
      body: [[
        { text: String(i + 1), color: NAVY, bold: true, fontSize: 12, margin: [0, 1, 0, 0] },
        {
          stack: [
            { text: [
              { text: `${a.key} `, bold: true, color: NAVY, fontSize: 10.5 },
              { text: a.name || "", bold: true, color: "#1c2733", fontSize: 10.5 },
              a.status ? { text: `   ${String(a.status).toUpperCase()}`, color: stColor, bold: true, fontSize: 7.5 } : "",
            ] },
            { text: `${a.phaseName || "—"}   ·   ${ph}   ·   ${tgt}`, color: "#7a8794", fontSize: 8, margin: [0, 3, 0, 0] },
            ...(a.delayed ? [{ text: `⚠ Delayed${a.delayKind ? ` (${a.delayKind})` : ""} — ${stripMd(a.delayReason) || "reason not recorded"}${a.delayBlocker ? ` · blocked by ${a.delayBlocker}` : ""}`, color: "#9a6700", bold: true, fontSize: 8.5, margin: [0, 5, 0, 0] }] : []),
            { text: brief, color: "#2a3746", italics: briefItalics, fontSize: 9.5, lineHeight: 1.35, margin: [0, 5, 0, 0] },
          ],
        },
      ]],
    },
    layout: {
      hLineWidth: (ri, node) => (ri === node.table.body.length ? 0.7 : 0),
      vLineWidth: (ci) => (ci === 0 ? 3 : 0),
      hLineColor: () => "#eef1f4",
      vLineColor: () => accent,
      paddingLeft: (ci) => (ci === 0 ? 8 : 4),
      paddingRight: () => 0,
      paddingTop: () => 3,
      paddingBottom: () => 12,
    },
    margin: [0, 0, 0, 8],
    unbreakable: true,
  };
}

function sectionHeader(title) {
  return [
    { text: title, fontSize: 13, bold: true, color: NAVY, margin: [0, 18, 0, 6] },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 2, lineColor: NAVY }], margin: [0, 0, 0, 12] },
  ];
}

function buildDoc(digest) {
  const A = (digest && digest.active) || [];
  const doneTail = (digest && digest.doneTail) || [];
  const date = (digest && digest.date) || "";
  const feats = A.filter((a) => a.kind !== "bug");
  const bugs = A.filter((a) => a.kind === "bug");
  const countBy = (s) => A.filter((a) => a.status === s).length;
  const genAt = new Date().toLocaleString();
  const live = countBy("Live"), wrap = countBy("Wrapping up");

  const summaryRuns = [
    { text: `${A.length} initiatives`, bold: true, color: NAVY },
    { text: "     —     " },
    { text: `${countBy("On track")} on track`, bold: true, color: STATUS_COLOR["On track"] },
    live ? { text: "   ·   " } : "", live ? { text: `${live} live`, bold: true, color: STATUS_COLOR.Live } : "",
    { text: "   ·   " }, { text: `${countBy("Overdue")} overdue`, bold: true, color: STATUS_COLOR.Overdue },
    { text: "   ·   " }, { text: `${countBy("Delayed")} delayed`, bold: true, color: STATUS_COLOR.Delayed },
    wrap ? { text: "   ·   " } : "", wrap ? { text: `${wrap} wrapping up`, bold: true, color: STATUS_COLOR["Wrapping up"] } : "",
  ];

  const featBody = feats.length ? feats.map(itemBlock) : [{ text: "None.", italics: true, color: "#9aa7b4", margin: [0, 0, 0, 8] }];
  const bugBody = bugs.length ? bugs.map(itemBlock) : [{ text: "None selected.", italics: true, color: "#9aa7b4", margin: [0, 0, 0, 8] }];
  const doneBody = doneTail.length
    ? doneTail.map((x) => ({ text: [{ text: `${x.key} `, bold: true, color: NAVY }, { text: x.name || "" }], margin: [0, 0, 0, 5], fontSize: 9.5 }))
    : [{ text: "(none)", color: "#9aa7b4", margin: [0, 0, 0, 5] }];

  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 46],
    defaultStyle: { fontSize: 10, color: "#26313d", lineHeight: 1.3 },
    footer: (cur, total) => ({
      margin: [40, 10, 40, 0],
      columns: [
        { text: "Zil Money — Confidential", fontSize: 8, color: "#9aa7b4" },
        { text: `Daily Epic Progress · ${date}    ${cur}/${total}`, alignment: "right", fontSize: 8, color: "#9aa7b4" },
      ],
    }),
    content: [
      { text: "ZIL MONEY · DAILY EPIC PROGRESS · INTERNAL", color: TEAL, bold: true, fontSize: 8, characterSpacing: 1.4, margin: [0, 0, 0, 6] },
      { image: ZM_LOGO_PNG, width: 155, margin: [0, 0, 0, 8] },
      { text: "Daily Epic Progress", fontSize: 26, bold: true, color: NAVY, margin: [0, 2, 0, 2] },
      { text: `${date} · for Sabeer · auto-generated · generated ${genAt}`, color: "#6b7a89", fontSize: 9, margin: [0, 0, 0, 10] },
      { canvas: [{ type: "rect", x: 0, y: 0, w: 54, h: 3, color: NAVY }], margin: [0, 0, 0, 14] },
      { text: summaryRuns.filter(Boolean), fontSize: 10.5, margin: [0, 0, 0, 20] },
      ...sectionHeader(`Feature initiatives (${feats.length})`), ...featBody,
      ...sectionHeader(`Bug fixes (${bugs.length})`), ...bugBody,
      ...sectionHeader("Completed recently (7 days)"), ...doneBody,
    ],
  };
}

export async function downloadReportPdf(digest) {
  const pdfMakeMod = await import("pdfmake/build/pdfmake");
  const pdfMake = pdfMakeMod.default || pdfMakeMod;
  const vfsMod = await import("pdfmake/build/vfs_fonts");
  const vfs = (vfsMod.default && (vfsMod.default.pdfMake ? vfsMod.default.pdfMake.vfs : vfsMod.default.vfs))
    || (vfsMod.pdfMake && vfsMod.pdfMake.vfs) || vfsMod.vfs;
  if (vfs) pdfMake.vfs = vfs;
  pdfMake.createPdf(buildDoc(digest)).download(`Sabeer-Daily-${(digest && digest.date) || "report"}.pdf`);
}
