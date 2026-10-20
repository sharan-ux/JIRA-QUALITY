import api, { route } from '@forge/api';

// Auto-provision phase stories under an Epic when it's created, and auto-attach
// each phase's checklist (written to Gebsun's "Checklist Text" field cf10051 as ADF;
// Gebsun parses it into a real checklist). NEW epics provision the 4-phase model
// (Define -> Build -> Deploy -> Verify) for BOTH feature and bug (FEATURE_PHASES_V2 /
// BUG_PHASES_V2). The legacy 16-phase (feature) / 7-phase (bug) arrays below are kept
// unchanged for epics already provisioned before this change — the dashboard renders
// those as-is. Idempotent via the qc-provisioned issue property.

const CHECKLIST_TEXT = 'customfield_10051';

// LEGACY (pre-4-phase) — retained ONLY so epics provisioned before the 4-phase switch
// keep rendering their original phases. New epics use FEATURE_PHASES_V2 / BUG_PHASES_V2.
export const FEATURE_PHASES = [
  { name: 'Knowledge', label: 'phase-knowledge', items: [
    'Product/feature brief exists (succinct, not limited to one page; translates business goals into product/technical requirements for product, marketing, sales & compliance), is approved, and is attached to the epic',
    'Target customer segment(s) and primary use case(s) are documented',
    'Marketing has received a written briefing (feature + value proposition)',
    'Sales has received a written briefing with talking points',
    'Support has received a written briefing (functionality, limits, ticket impact)',
    'Each of Marketing, Sales, Support has a named point of contact',
    'Competitive positioning / differentiation is documented, if applicable',
    'An internal FAQ for anticipated customer questions is drafted',
    'Marketing, Sales, Support leads each explicitly acknowledged the briefing',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'BA', label: 'phase-ba', items: [
    'Primary KPI(s) defined with explicit target values and timeframe',
    'Guardrail metrics defined (things that must not get worse)',
    'Baseline / current-state value captured before any code ships',
    'Data source and measurement method identified and confirmed trackable',
    'Any data the dashboard needs but does not yet capture is identified (missing-data gap list)',
    'Missing dashboard data flagged to Development and confirmed it will be available in the live environment',
    'Required analytics events / instrumentation written as engineering requirements',
    'KPI targets reviewed and approved by PM and a business stakeholder',
    'A post-launch KPI review date is scheduled and linked to BA Review',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'To Do', label: 'phase-todo', items: [
    'User stories / tasks have clear, testable acceptance criteria',
    'Design / UX mockups are attached and approved, where applicable',
    'Technical approach / architecture reviewed for non-trivial stories',
    'Dependencies (APIs, integrations, other teams) identified and unblocked',
    'Stories are sized/estimated by the delivery team',
    'A Definition of Done is explicitly agreed for the epic',
    'Security/privacy flagged if the story touches payment or personal data',
    'KPI instrumentation tasks from BA appear as explicit backlog items',
  ]},
  { name: 'UI/UX', label: 'phase-uiux', items: [
    'Approved hi-fi mockups for every screen & state, from the design system + tokens',
    'Visual hierarchy makes financial data instantly scannable',
    'Review + confirmation + receipt on money-moving flows; no dark patterns',
    'Loading / empty / error / success states specified per screen',
    'Desktop + <=785px, Light + Dark, using real theme tokens',
    'WCAG 2.2 AA: contrast, focus, keyboard, adjustable text, SR labels',
    'Plain-language microcopy; fees/rates/timing/disclosures inline',
    'Consistent currency/date formatting; data-viz per design system',
    'Trust & security affordances + human-escalation path',
    'Design review done; Design Lead signs off + handoff to Dev',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'Compliance Sign-off', label: 'phase-compliance', items: [
    'Compliance sign-off request sent',
    'Data-privacy impact reviewed for new personal or financial data',
    'Security review complete: encryption, access controls, key management',
    'Applicable regulations reviewed (PCI DSS, NACHA/ACH, money-transmitter, GLBA)',
    'Audit logging in place for compliance/regulatory-relevant actions',
    'Terms of Service / customer agreements updated if what customers agree to changed',
    'Accessibility compliance (ADA/WCAG) confirmed for customer-facing changes',
    'A named compliance officer/approver sign-off recorded, with date',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'Development', label: 'phase-development', items: [
    "Code follows the team's coding standards / style guide, enforced via CI",
    'Unit tests written alongside code, meeting minimum coverage',
    'Code is peer-reviewed and approved before merge — no self-merges',
    'Sensitive-data handling (encryption, PCI/PII) reviewed',
    'A feature flag or safe-rollback mechanism implemented for risky changes',
    'Analytics/KPI instrumentation implemented and verified locally',
    'Notification content (email, in-app) drafted and implemented',
    'Documentation (API docs, runbooks) updated alongside the code',
    'Ticket status accurately reflects real progress at each standup',
  ]},
  { name: 'QA Scheduled', label: 'phase-qa-scheduled', items: [
    'A test plan / test cases exist covering every acceptance criterion',
    'Test cases include edge cases and negative/failure scenarios',
    'Regression scope is defined',
    'Test data and environment prepared and available',
    'Security/compliance test cases included for payments or PII',
    'QA effort estimated, a tester assigned, and a timeline set',
  ]},
  { name: 'In QA', label: 'phase-in-qa', items: [
    'Every planned test case executed and the result logged',
    'Defects logged with severity/priority and reproducible steps',
    'The regression suite is executed in full',
    'Critical/High defects triaged with engineering within SLA',
    'Performance/load testing completed where relevant',
    'Accessibility (WCAG) checked for any customer-facing UI change',
    'Security/vulnerability scan run for payments, auth, or PII',
    'Notification triggers tested for content, timing, and audience',
  ]},
  { name: 'QA Passed', label: 'phase-qa-passed', items: [
    'A test summary report exists with pass/fail counts and defect summary',
    'Zero open Critical/High defects remain, or documented exceptions approved',
    'The full regression suite passed',
    'The QA lead signs off by name and date in the ticket',
    'Any deferred defects logged in the backlog with owner and priority',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'Deployment', label: 'phase-deployment', items: [
    'Deployment executed following the documented runbook',
    'Deployment happens inside an approved change window',
    'Smoke tests run in production immediately after deploy',
    'Monitoring and alerting confirmed active for the new functionality',
    'The rollback path validated (dry run or staging), not just documented',
    'Feature-flag state confirmed correct (e.g. internal/beta only)',
    'Deployment logged: who deployed, when, and which version',
    'Notification system config updated and triggers enabled for this release',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'Sales & Support Training', label: 'phase-sales-support', items: [
    'Training meeting scheduled',
    'A hands-on training/demo conducted for Sales on the live feature',
    'A hands-on training/demo conducted for Support on the live feature',
    'Sales collateral / battlecards finalized and distributed',
    'Support macros, knowledge-base articles, and runbooks published',
    'An escalation path defined for issues Support cannot resolve',
    'Pricing/packaging changes communicated and confirmed understood',
    'Sales Lead and Support Lead each explicitly sign off that their team is ready',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'Marketing Training', label: 'phase-marketing', items: [
    'Training meeting scheduled',
    'Marketing briefed hands-on on the actual working feature',
    'Messaging and positioning reviewed and approved',
    'Launch assets (site, email, social, blog) drafted and fact-checked',
    'Legal/compliance reviews all marketing claims, especially regulated ones',
    'Launch timing coordinated with Deployment and Done',
    'Marketing Lead signs off that team and assets are ready to launch',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'Live BA Dashboard Preview', label: 'phase-ba-dashboard', items: [
    'BA-defined KPIs are live on a real dashboard with actual data (not a mockup/sample)',
    'Live dashboard demoed to PM, BA, and the management stakeholder',
    'Baseline and current values shown and reconcile with the BA baseline',
    'Guardrail metrics are visible and instrumented on the live dashboard',
    'Any instrumentation gaps vs the BA spec are logged with an owner',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'Management Approval', label: 'phase-mgmt-approval', items: [
    'Business case and KPI targets reviewed against what was actually built',
    'A risk assessment is reviewed',
    'Budget or resourcing impacts reviewed, if applicable',
    'A go/no-go decision documented with a named approver',
    'Release notes are drafted',
    'Release approach confirmed — merge to the production branch triggers the CI/CD pipeline (no manual runbook/change ticket); rollback = revert the merge commit + re-run the pipeline',
    'Final legal/compliance review scheduled and linked to Compliance Sign-off',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'Done', label: 'phase-done', items: [
    'The feature is live for its full intended audience',
    'Every prior-phase sign-off is present and linked in the epic',
    'Customer-facing documentation / help-center articles updated',
    'No open Critical/High defect remains linked to this epic',
    'A post-launch monitoring dashboard is live and watched 48-72h',
    'Notifications confirmed actually delivered to the intended audience',
    'The epic is formally closed with a written completion summary',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
  { name: 'BA Review', label: 'phase-ba-review', items: [
    'Actual KPI results measured against baseline and original target',
    'Guardrail metrics reviewed to confirm nothing regressed',
    'A review meeting held with PM, BA, and relevant stakeholders',
    "Findings documented — what worked, what didn't, and why",
    'Follow-up backlog items created for any identified gaps',
    'Learnings shared back to Marketing, Sales, and Support',
    'The next KPI review interval scheduled if continued tracking is needed',
    'COO (or delegate) sign-off recorded — by name and date',
  ]},
];

export const BUG_PHASES = [
  { name: 'Triage / To Do', label: 'phase-triage', items: [
    'Bug reproduced with clear, written steps to reproduce',
    'Severity assigned using the rubric: Critical, High, Medium, or Low',
    'Root cause hypothesis or affected component/system identified',
    'Customer/business impact documented (users, revenue, compliance, data)',
    'Bug linked to its originating source (ticket, alert, customer report)',
    'If a regression of a fixed bug, that is flagged and the test gap noted',
    'Critical: Eng Lead / on-call notified and fast-track triggered',
  ]},
  { name: 'In Progress', label: 'phase-in-progress', items: [
    'The fix addresses the root cause, not just the symptom — reasoning documented',
    'A regression test is added that would have caught this bug',
    'Code is peer-reviewed and approved before merge — no self-merges',
    'Fixes touching payment/PII/security get a second senior/security review',
    'Blast radius assessed — what else could this change affect',
    'A feature flag or kill switch used for any fix carrying meaningful risk',
  ]},
  { name: 'QA Scheduled', label: 'phase-qa-scheduled', items: [
    'A tester is assigned',
    'Test scope defined: the bug itself plus the related regression area',
    'Critical/High: tester engaged immediately, in parallel with the fix',
  ]},
  { name: 'In QA', label: 'phase-in-qa', items: [
    'Original reproduction steps no longer reproduce the bug',
    'A targeted regression check on the affected area is completed',
    'Medium/Low: full regression. Critical/High: targeted, scope documented',
    'Fix verified in a staging/pre-prod environment matching production',
  ]},
  { name: 'QA Passed', label: 'phase-qa-passed', items: [
    'QA Lead sign-off recorded, by name and date',
    'Any residual risk or known limitation is documented',
  ]},
  { name: 'Deployment & Done', label: 'phase-deployment', items: [
    'Fix merged to master (staging to master PR) - triggers the deploy pipeline',
    'Pipeline build passed - green, no failures',
    'Smoke-tested in production',
    'Issue watched post-deploy - no regression',
    'Rollback ready - revert commit + re-run pipeline',
    'Deploy logged - PR # + build',
    'Fix confirmed resolved in production, not just staging',
    'Original reporter / support ticket / customer notified, where applicable',
    'Bug ticket closed with root cause and fix summary documented',
    'If a systemic gap let this through, a follow-up improvement ticket created',
    'Critical: no related incident/defect reopens within 48-72h post-deploy',
    'Sign-off recorded - COO if Critical/High, otherwise PM',
  ]},
];

// ---------------------------------------------------------------------------
// 4-PHASE MODEL (current) — every NEW epic, feature and bug, provisions these four.
// Philosophy: Define -> Build -> Deploy (go live ASAP, contained) -> Verify (on the
// live feature; unlocks full rollout). Each phase carries a time benchmark and a
// standing "blocker + revised ETA" row so a slip is flagged early (not discovered late).
// Labels are shared across both tracks: phase-define / phase-build / phase-deploy / phase-verify.
// ---------------------------------------------------------------------------
export const FEATURE_PHASES_V2 = [
  { name: 'Define', label: 'phase-define', items: [
    'What it does, who it is for, and the primary use case are documented in one place',
    'Primary KPI defined with a target value and how it will be measured',
    'Acceptance criteria written and testable',
    'UX / design attached and approved where there is a UI (else marked N/A)',
    'Money / PII / compliance impact flagged for Verify, if applicable',
    'Scope and dependencies agreed — what is in, what is out, blockers identified',
    'On track vs the 3-day benchmark — if not, the blocker and a revised ETA are recorded here',
  ]},
  { name: 'Build', label: 'phase-build', items: [
    'Built to the agreed acceptance criteria',
    'Unit tests written alongside the code; peer-reviewed, no self-merge',
    'KPI instrumentation implemented so the feature is measurable once live',
    'Feature flag or safe-rollback mechanism in place for money-moving or risky changes',
    'Notification content (email, in-app) implemented where applicable',
    'Documentation / runbook updated alongside the code',
    'On track vs the agreed build benchmark — if not, the blocker and a revised ETA are recorded here',
  ]},
  { name: 'Deploy', label: 'phase-deploy', items: [
    'Merged to production via the CI/CD pipeline',
    'Live behind a feature flag or to a limited audience — real but contained',
    'Production smoke test passed',
    'Monitoring and alerting active for the new functionality',
    'One-action rollback confirmed (revert the merge + re-run the pipeline)',
    'Deployment logged: who deployed, when, and which version',
    'On track vs the 2-day benchmark — if not, the blocker and a revised ETA are recorded here',
  ]},
  { name: 'Verify', label: 'phase-verify', items: [
    'QA executed against production; defects logged with severity and repro steps',
    'Compliance and security confirmed on the live behaviour (PCI/NACHA/PII as applicable)',
    'No open Critical/High defects remain, or documented exceptions approved',
    'Management go/no-go for full rollout recorded — by name and date',
    'KPI measured against baseline/target; guardrail metrics confirmed not regressed',
    'Sales, Support, and Marketing briefed on the live feature',
    'Flag opened to the full audience; epic closed with a written completion summary',
    'On track vs the 3-day benchmark — if not, the blocker and a revised ETA are recorded here',
  ]},
];

export const BUG_PHASES_V2 = [
  { name: 'Define', label: 'phase-define', items: [
    'Bug reproduced with clear, written steps to reproduce',
    'Severity assigned: Critical, High, Medium, or Low',
    'Root-cause hypothesis or affected component/system identified',
    'Customer / business impact documented (users, revenue, compliance, data)',
    'Linked to its originating source (ticket, alert, customer report)',
    'If a regression of a fixed bug, that is flagged and the test gap noted',
    'On track vs the triage benchmark — if not, the blocker and a revised ETA are recorded here',
  ]},
  { name: 'Build', label: 'phase-build', items: [
    'The fix addresses the root cause, not the symptom — reasoning documented',
    'A regression test added that would have caught this bug',
    'Peer-reviewed and approved before merge — no self-merge',
    'Payment / PII / security fixes get a second senior/security review',
    'Blast radius assessed — what else this change could affect',
    'A feature flag or kill switch used for any fix carrying meaningful risk',
    'On track vs the fix benchmark — if not, the blocker and a revised ETA are recorded here',
  ]},
  { name: 'Deploy', label: 'phase-deploy', items: [
    'Fix merged to master (staging to master PR) — triggers the deploy pipeline',
    'Pipeline build passed — green, no failures',
    'Smoke-tested in production',
    'Rollback ready — revert commit + re-run pipeline',
    'Deployment logged — PR # + build',
    'On track vs the deploy benchmark — if not, the blocker and a revised ETA are recorded here',
  ]},
  { name: 'Verify', label: 'phase-verify', items: [
    'Original reproduction steps no longer reproduce the bug',
    'A targeted regression check on the affected area is completed',
    'Fix confirmed resolved in production, not just staging',
    'Original reporter / support ticket / customer notified, where applicable',
    'Bug ticket closed with root cause and fix summary documented',
    'Critical: no related incident/defect reopens within 48-72h post-deploy',
    'Sign-off recorded — COO if Critical/High, otherwise PM',
  ]},
];

const jira = (url, init) => api.asApp().requestJira(url, init);

// Gebsun parses the "Checklist Text" field: "# name" line = checklist header, each
// other line = an item. On API v3 this rich-text field must be sent as ADF.
export function checklistAdf(name, items) {
  const lines = [`# ${name}`, ...items];
  return {
    type: 'doc',
    version: 1,
    content: lines.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })),
  };
}

export async function handler(event) {
  const issueKey = event?.issue?.key;
  if (!issueKey) return;

  const res = await jira(route`/rest/api/3/issue/${issueKey}?fields=issuetype,labels,summary,project`, { headers: { Accept: 'application/json' } });
  if (!res.ok) { console.error('provision: fetch issue failed', issueKey, res.status); return; }
  const issue = await res.json();

  if (issue.fields?.issuetype?.name !== 'Epic') return;
  const labels = (issue.fields?.labels || []).map((l) => l.toLowerCase());
  const track = labels.includes('feature') ? 'feature' : labels.includes('bug') ? 'bug' : null;
  if (!track) return;

  const prop = await jira(route`/rest/api/3/issue/${issueKey}/properties/qc-provisioned`);
  if (prop.status === 200) return; // already provisioned

  // Guard against duplicates: epics provisioned BEFORE this property existed (e.g. onboarded
  // manually, or provisioned by the create-trigger) already have qc-phase child stories. Without
  // this check the update-trigger would re-create a full second set. If children exist, just
  // backfill the marker and stop.
  const existingJql = `parent = "${issueKey}" AND labels = qc-phase`;
  const existing = await jira(route`/rest/api/3/search/jql?jql=${existingJql}&maxResults=1`, { headers: { Accept: 'application/json' } });
  if (existing.ok && (((await existing.json()).issues) || []).length > 0) {
    await jira(route`/rest/api/3/issue/${issueKey}/properties/qc-provisioned`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ track, backfilled: true }),
    });
    console.log(`provision: ${issueKey} already has phase stories — backfilled marker, skipped`);
    return;
  }

  const phases = track === 'feature' ? FEATURE_PHASES_V2 : BUG_PHASES_V2;
  const projectKey = issue.fields?.project?.key;
  const epicSummary = issue.fields?.summary || issueKey;

  let created = 0;
  for (const ph of phases) {
    const r = await jira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          issuetype: { name: 'Story' },
          summary: `${ph.name} — ${epicSummary}`,
          parent: { key: issueKey },
          labels: ['qc-phase', ph.label],
        },
      }),
    });
    if (!r.ok) { console.error('provision: create story failed', ph.label, r.status, (await r.text()).slice(0, 200)); continue; }
    created += 1;
    const { key } = await r.json();
    // set the checklist in a SEPARATE update — Gebsun parses Checklist Text -> checklist
    // reliably on an update event (setting it during create is not always parsed).
    const cw = await jira(route`/rest/api/3/issue/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: { [CHECKLIST_TEXT]: checklistAdf(ph.name, ph.items) } }),
    });
    if (!cw.ok) console.error('provision: checklist set failed', key, cw.status, (await cw.text()).slice(0, 160));
  }

  await jira(route`/rest/api/3/issue/${issueKey}/properties/qc-provisioned`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ track, count: created }),
  });
  console.log(`provision: ${issueKey} (${track}) -> created ${created}/${phases.length} phase stories w/ checklists`);
}
