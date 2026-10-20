// src/triggers/qaloop.js — QA rework loop: Forge trigger handler + business logic (CommonJS).
// Pure ADF logic lives in qaloop-adf.js; state in qaloop-state.js; Jira I/O in qaloop-jira.js.
// This module wires them together. Deps are injected for unit testability.

const adfLib = require('./qaloop-adf');
const stateLib = require('./qaloop-state');

const IN_QA = 'phase-in-qa';
const DEV = 'phase-development';
const INPROG = 'phase-in-progress';

// Minimal ADF paragraph doc — used for simple informational comments.
function mentionless(text) {
  return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] };
}

// ---------------------------------------------------------------------------
// Fail handler: In-QA story moved to "QA Failed"
// ---------------------------------------------------------------------------
async function handleQaFailed(ctx, deps) {
  const { kvs, jira } = deps;
  const items = adfLib.currentRoundItems(ctx.adf, ctx.phaseName);
  if (items.length === 0) {
    await jira.comment(ctx.key, mentionless('No defect items found for this QA Failed — add a checklist of defects, then set QA Failed again.'));
    return;
  }
  const devKey = await jira.findDevStory(ctx.epicKey);
  if (!devKey) {
    await jira.comment(ctx.key, mentionless('QA rework loop: no Development phase-story found under this epic.'));
    return;
  }
  const round = await stateLib.beginRound(kvs, ctx.epicKey, { qaStoryKey: ctx.key, devStoryKey: devKey });
  if (round === null) return; // duplicate event — idempotent

  const stamped = adfLib.stampQaHeader(ctx.adf, ctx.phaseName, round);
  await jira.putChecklist(ctx.key, stamped.adf);

  const devCtx = await jira.getContext(devKey);
  const devAdf = (devCtx && devCtx.adf) || { type: 'doc', version: 1, content: [] };
  await jira.putChecklist(devKey, adfLib.appendReworkBlock(devAdf, round, items));
  await jira.transitionTo(devKey, 'QA Rework');

  const a = (devCtx && devCtx.assignee) || {};
  // Lazy require qaloop-jira so the I/O module is only loaded when actually needed.
  const jiraMod = require('./qaloop-jira');
  await jira.comment(devKey, jiraMod.mentionCommentAdf(a.id || null, a.name || null, `QA Failed round ${round} — ${items.length} item(s) to rework`, items));
}

// ---------------------------------------------------------------------------
// Done handler: Development story's "QA Rework N" block fully ticked
// ---------------------------------------------------------------------------
async function handleReworkDone(ctx, deps) {
  const { kvs, jira } = deps;
  const st = await stateLib.loadState(kvs, ctx.epicKey);
  if (!adfLib.reworkRoundComplete(ctx.adf, st.round)) return;
  if (!(await stateLib.completeRound(kvs, ctx.epicKey))) return; // idempotent / not open

  await jira.transitionTo(ctx.key, 'Ready for QA');

  const qa = await jira.getContext(st.qaStoryKey);
  const a = (qa && qa.assignee) || {};
  const reworkBlock = adfLib.parseBlocks(ctx.adf).find((b) => b.header === `QA Rework ${st.round}`);
  const doneItems = reworkBlock ? reworkBlock.items.map((i) => i.text) : [];

  const jiraMod = require('./qaloop-jira');
  await jira.comment(st.qaStoryKey, jiraMod.mentionCommentAdf(a.id || null, a.name || null, `QA Rework ${st.round} complete — ready for retest`, doneItems));
  await jira.transitionTo(st.qaStoryKey, 'In QA');
}

// ---------------------------------------------------------------------------
// Resolve on QA pass
// ---------------------------------------------------------------------------
async function resolveOnPass(ctx, deps) {
  const { kvs, jira } = deps;
  const st = await stateLib.loadState(kvs, ctx.epicKey);
  if (st.phase === 'idle' || st.phase === 'resolved' || st.round === 0) return;
  await stateLib.resolve(kvs, ctx.epicKey);
  await jira.comment(ctx.key, mentionless(`QA rework loop closed after ${st.round} round(s) — QA passed.`));
}

// ---------------------------------------------------------------------------
// Dispatch — testable seam; deps.fail / deps.done override the real handlers
// ---------------------------------------------------------------------------
async function _dispatch(ctx, deps) {
  if (!ctx || ctx.projectKey !== 'OCW' || !ctx.labels.includes('qc-phase')) return;
  const fail = deps.fail || ((c, d) => handleQaFailed(c, d));
  const done = deps.done || ((c, d) => handleReworkDone(c, d));
  if (ctx.labels.includes(IN_QA) && ctx.status === 'QA Failed') return fail({ ...ctx, phaseName: 'In QA' }, deps);
  if ((ctx.labels.includes(DEV) || ctx.labels.includes(INPROG)) && ctx.status === 'QA Rework') return done(ctx, deps);
  if (ctx.labels.includes(IN_QA) && ctx.status === 'QA Pass') return resolveOnPass(ctx, deps);
}

// ---------------------------------------------------------------------------
// Cheap pre-filter: returns true ONLY when the event payload positively proves
// the issue is irrelevant (non-OCW project, or labels present but no qc-phase).
// Returns false whenever there is any doubt — fall through to getContext().
// ---------------------------------------------------------------------------
function payloadSaysIrrelevant(event) {
  const fields = event && event.issue && event.issue.fields;
  if (!fields) return false;

  const projectKey = fields.project && fields.project.key;
  if (projectKey !== undefined && projectKey !== 'OCW') return true;

  const labels = fields.labels;
  if (Array.isArray(labels) && !labels.includes('qc-phase')) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Forge trigger entry point
// ---------------------------------------------------------------------------
async function handler(event) {
  const issueKey = event && event.issue && event.issue.key;
  if (!issueKey) return;
  if (payloadSaysIrrelevant(event)) return;
  const jiraMod = require('./qaloop-jira');
  const { kvs } = require('@forge/kvs');
  const deps = {
    kvs,
    jira: {
      ...jiraMod,
      findDevStory: (epicKey) => findDevStory(epicKey, jiraMod),
      getContext: jiraMod.getContext,
    },
  };
  const ctx = await jiraMod.getContext(issueKey);
  await _dispatch(ctx, deps);
}

// Locate the development-phase story under an epic (feature: phase-development, bug: phase-in-progress).
async function findDevStory(epicKey, jiraMod) {
  const track = await jiraMod.epicTrack(epicKey);
  const phase = track === 'bug' ? INPROG : DEV;
  return jiraMod.firstStoryKey(`parent = "${epicKey}" AND labels = qc-phase AND labels = ${phase}`);
}

module.exports = { handler, _dispatch, handleQaFailed, handleReworkDone, payloadSaysIrrelevant };
