// src/triggers/qaloop-jira.js — Jira I/O helpers for the QA rework loop (CommonJS).
// Pure functions (pickTransitionId, mentionCommentAdf) are unit-tested via node --test.
// I/O functions (getContext, transitionTo, putChecklist, comment, epicTrack, firstStoryKey)
// use lazy require('@forge/api') so the module can be loaded in unit tests without the
// Forge runtime being present. Deviation from the plan's top-level require: intentional
// to keep node --test working.

const CF = 'customfield_10051';

// Lazy getter — only evaluated inside I/O functions, never at module load time.
function getApi() {
  const mod = require('@forge/api');
  // @forge/api CJS: exports asApp and route directly (and also as .default).
  return { asApp: mod.asApp, route: mod.route };
}

function jira(url, init) {
  const { asApp } = getApi();
  return asApp().requestJira(url, init);
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

function pickTransitionId(payload, statusName) {
  const want = String(statusName).toLowerCase();
  const t = (payload.transitions || []).find((x) => x.to && x.to.name && x.to.name.toLowerCase() === want);
  return t ? t.id : null;
}

function mentionCommentAdf(accountId, displayName, heading, items) {
  const head = accountId
    ? [{ type: 'mention', attrs: { id: accountId, text: '@' + (displayName || 'user') } }, { type: 'text', text: '  ' + heading }]
    : [{ type: 'text', text: heading + ' (assignee unset)' }];
  return {
    type: 'doc', version: 1, content: [
      { type: 'paragraph', content: head },
      { type: 'bulletList', content: items.map((t) => ({ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })) },
    ],
  };
}

// ---------------------------------------------------------------------------
// I/O helpers (thin wrappers around Jira REST — exercised in Task 13 e2e)
// ---------------------------------------------------------------------------

async function getContext(issueKey) {
  const { route } = getApi();
  const r = await jira(route`/rest/api/3/issue/${issueKey}?fields=project,issuetype,labels,status,assignee,parent,${CF}`, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  const f = (await r.json()).fields || {};
  return {
    key: issueKey, projectKey: f.project && f.project.key, issuetype: f.issuetype && f.issuetype.name,
    labels: f.labels || [], status: f.status && f.status.name,
    assignee: f.assignee ? { id: f.assignee.accountId, name: f.assignee.displayName } : null,
    epicKey: f.parent && f.parent.key, adf: f[CF],
  };
}

async function transitionTo(issueKey, statusName) {
  const { route } = getApi();
  const g = await jira(route`/rest/api/3/issue/${issueKey}/transitions`, { headers: { Accept: 'application/json' } });
  if (!g.ok) return false;
  const id = pickTransitionId(await g.json(), statusName);
  if (!id) { console.error('qaloop: no transition to', statusName, 'from', issueKey); return false; }
  const p = await jira(route`/rest/api/3/issue/${issueKey}/transitions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transition: { id } }) });
  return p.status === 204;
}

async function putChecklist(issueKey, adf) {
  const { route } = getApi();
  const r = await jira(route`/rest/api/3/issue/${issueKey}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { [CF]: adf } }) });
  return r.ok;
}

async function comment(issueKey, adf) {
  const { route } = getApi();
  const r = await jira(route`/rest/api/3/issue/${issueKey}/comment`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: adf }) });
  return r.ok;
}

async function epicTrack(epicKey) {
  const { route } = getApi();
  const r = await jira(route`/rest/api/3/issue/${epicKey}?fields=labels`, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  const labels = ((await r.json()).fields.labels || []).map((l) => l.toLowerCase());
  return labels.includes('feature') ? 'feature' : labels.includes('bug') ? 'bug' : null;
}

async function firstStoryKey(jql) {
  const { route } = getApi();
  // NOTE: /rest/api/3/search/jql omits `key` unless `fields` is requested — must pass fields=key.
  const r = await jira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=1&fields=key`, { headers: { Accept: 'application/json' } });
  if (!r.ok) return null;
  const issues = (await r.json()).issues || [];
  return issues.length ? issues[0].key : null;
}

module.exports = { pickTransitionId, mentionCommentAdf, getContext, transitionTo, putChecklist, comment, epicTrack, firstStoryKey };
