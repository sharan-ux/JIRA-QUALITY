#!/usr/bin/env node
// tools/daily-report.js — fetch the daily digest from the Forge web-trigger and render the branded
// Daily Epic Progress PDF via headless Chrome (same layout as the dashboard's Download-PDF, but with
// no browser header/footer and colors forced on). Usage:
//   DIGEST_URL=<url> DIGEST_KEY=<key> node tools/daily-report.js [YYYY-MM-DD]
//   node tools/daily-report.js <url> <key> [YYYY-MM-DD]
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildReportHtml } = require('../src/report/report-html');

const URL_ = process.env.DIGEST_URL || process.argv[2];
const KEY = process.env.DIGEST_KEY || process.argv[3];
// optional: a past date (YYYY-MM-DD) to re-render that day's stored briefs; else today
const DATE = process.env.DIGEST_DATE || (/^\d{4}-\d{2}-\d{2}$/.test(process.argv[4] || '') ? process.argv[4] : '');
if (!URL_ || !KEY) { console.error('need DIGEST_URL and DIGEST_KEY (env or argv)'); process.exit(1); }

// Zil Money logo as a data URI (shared with the dashboard build).
function readLogo() {
  try {
    const txt = fs.readFileSync(path.join(__dirname, '..', 'static', 'compliance', 'src', 'logo.js'), 'utf8');
    return (txt.match(/"(data:image\/svg\+xml;base64,[^"]+)"/) || [])[1] || '';
  } catch (e) { return ''; }
}

function findChrome() {
  const c = [
    (process.env['ProgramFiles'] || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    (process.env['LOCALAPPDATA'] || '') + '\\Google\\Chrome\\Application\\chrome.exe',
    (process.env['ProgramFiles'] || '') + '\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return c.find((p) => { try { return fs.existsSync(p); } catch (e) { return false; } });
}

(async () => {
  const res = await fetch(`${URL_}?key=${encodeURIComponent(KEY)}${DATE ? `&date=${encodeURIComponent(DATE)}` : ''}`);
  if (!res.ok) { console.error('digest fetch failed', res.status, await res.text()); process.exit(1); }
  const digest = await res.json();
  const html = buildReportHtml(digest.date, digest.active, digest.doneTail, { logo: readLogo(), genAt: new Date().toLocaleString() });
  const htmlPath = path.join(os.tmpdir(), `sabeer-daily-${digest.date}.html`);
  fs.writeFileSync(htmlPath, html, 'utf8');
  const out = path.resolve(`Sabeer-Daily-${digest.date}.pdf`);
  const chrome = findChrome();
  if (!chrome) { console.error(`No Chrome/Edge found; HTML written at ${htmlPath} — print it to PDF manually.`); process.exit(2); }
  const udd = path.join(os.tmpdir(), 'dailyreport_' + process.pid);
  execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--no-first-run',
    '--user-data-dir=' + udd, '--print-to-pdf=' + out, 'file:///' + htmlPath.replace(/\\/g, '/')], { stdio: 'ignore' });
  const pages = (fs.readFileSync(out).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  console.log(`PDF written: ${out} (~${pages} page(s))`);
})();
