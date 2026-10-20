// qarename.js — narrow, single-purpose trigger: when a QA sub-task's status becomes "QA Failed"
// (a sub-task under an In-QA phase-story), rename its "Defect N" checklist header(s) to "QA Failed N".
// It ONLY renames — it never copies or routes (that is the dashboard's manual triage/push). Idempotent:
// re-firing is a no-op once nothing named "Defect N" remains. Replaces the removed copy-everything loop.

import api, { route } from '@forge/api';

const jira = (url, init) => api.asApp().requestJira(url, init);
const ZWSP = /​/g;
// tester authors the checklist as "Defect N"; on QA-Failed we relabel to "QA Failed N".
const DEFECT_HEADER = /^(#\s*)?Defect\s+(\d+)\s*$/i;
const isFailedStatus = (s) => /^(qa\s*failed|review\s*failed)$/i.test((s || '').trim());
const isSubtask = (t) => /sub-?task/i.test(t || '');

// Rename "Defect N" → "QA Failed N" in the Gebsun checklist ADF. Handles BOTH forms Gebsun uses:
// the paragraph form (a text node "# Defect 1") and the orderedList form (first text node "Defect 1").
function renameDefectHeaders(adf) {
  if (!adf || !Array.isArray(adf.content)) return { adf, changed: false };
  const clone = JSON.parse(JSON.stringify(adf));
  let changed = false;
  for (const top of clone.content) {
    if (!top) continue;
    if (top.type === 'orderedList') {
      let tn = null;
      const find = (n) => { if (tn || !n) return; if (Array.isArray(n)) { n.forEach(find); return; } if (n.type === 'text' && typeof n.text === 'string') { tn = n; return; } if (n.content) find(n.content); };
      find(top.content);
      if (tn) { const m = tn.text.replace(ZWSP, '').match(DEFECT_HEADER); if (m) { tn.text = `QA Failed ${m[2]}`; changed = true; } }
      continue;
    }
    const walk = (n) => {
      if (!n) return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.type === 'text' && typeof n.text === 'string') { const m = n.text.replace(ZWSP, '').match(DEFECT_HEADER); if (m) { n.text = `# QA Failed ${m[2]}`; changed = true; } }
      if (n.content) walk(n.content);
    };
    walk(top);
  }
  return { adf: clone, changed };
}

export async function handler(event) {
  const key = event && event.issue && event.issue.key;
  if (!key) return;
  // Fetch authoritative fields (payload may be partial).
  const r = await jira(route`/rest/api/3/issue/${key}?fields=status,issuetype,parent,project,customfield_10051`, { headers: { Accept: 'application/json' } });
  if (!r.ok) return;
  const f = (await r.json()).fields || {};
  if (f.project && f.project.key && f.project.key !== 'OCW') return;
  if (!isFailedStatus(f.status && f.status.name)) return;
  if (!isSubtask(f.issuetype && f.issuetype.name)) return;
  // must be a sub-task under an In-QA phase-story
  const parentKey = f.parent && f.parent.key;
  if (!parentKey) return;
  const pr = await jira(route`/rest/api/3/issue/${parentKey}?fields=labels`, { headers: { Accept: 'application/json' } });
  if (!pr.ok) return;
  const plabels = ((await pr.json()).fields || {}).labels || [];
  if (!plabels.includes('phase-in-qa')) return;
  // rename, only writing when something actually changed (idempotent)
  const { adf, changed } = renameDefectHeaders(f.customfield_10051);
  if (!changed) return;
  await jira(route`/rest/api/3/issue/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { customfield_10051: adf } }) });
}
