// The QC compliance frameworks (static — the source of truth is Justin's tracker).
// CURRENT model = 4 phases (Define -> Build -> Deploy -> Verify) for BOTH feature and bug;
// see FEATURE_PHASES_V2 / BUG_PHASES_V2 / LABELS_V2 below. The LEGACY 16-phase (feature) /
// 7-phase (bug) arrays here are retained ONLY so epics provisioned before the switch keep
// rendering their original phases — buildPhases() picks the model per epic from its own labels.
// Each item: { txt, owner }. The resolver returns only the LIVE per-issue data (which phase,
// done); this file supplies the phase/checklist structure, and buildPhases() merges the two.

const COO = { txt: 'COO (or delegate) sign-off recorded — by name and date', owner: 'COO' };

// ---- LEGACY (pre-4-phase) feature/bug definitions — do not extend; new work goes in *_V2 ----
export const FEATURE_PHASES = [
  { name: 'Knowledge', owner: 'Marketing / Sales / Support Leads', items: [
    { txt: 'Product/feature brief exists (succinct, not limited to one page; translates business goals into product/technical requirements for product, marketing, sales & compliance), is approved, and is attached to the epic', owner: 'PM' },
    { txt: 'Target customer segment(s) and primary use case(s) are documented', owner: 'PM / BA' },
    { txt: 'Marketing has received a written briefing (feature + value proposition)', owner: 'PM' },
    { txt: 'Sales has received a written briefing with talking points', owner: 'PM' },
    { txt: 'Support has received a written briefing (functionality, limits, ticket impact)', owner: 'PM' },
    { txt: 'Each of Marketing, Sales, Support has a named point of contact', owner: 'PM' },
    { txt: 'Competitive positioning / differentiation is documented, if applicable', owner: 'PM / Marketing' },
    { txt: 'An internal FAQ for anticipated customer questions is drafted', owner: 'PM / Support' },
    { txt: 'Marketing, Sales, Support leads each explicitly acknowledged the briefing', owner: 'Marketing / Sales / Support Leads' },
    COO,
  ]},
  { name: 'BA', owner: 'BA', items: [
    { txt: 'Primary KPI(s) defined with explicit target values and timeframe', owner: 'BA' },
    { txt: 'Guardrail metrics defined (things that must not get worse)', owner: 'BA' },
    { txt: 'Baseline / current-state value captured before any code ships', owner: 'BA / Analytics' },
    { txt: 'Data source and measurement method identified and confirmed trackable', owner: 'BA / Engineering' },
    { txt: 'Any data the dashboard needs but does not yet capture is identified (missing-data gap list)', owner: 'BA' },
    { txt: 'Missing dashboard data flagged to Development and confirmed it will be available in the live environment', owner: 'BA / Eng Lead' },
    { txt: 'Required analytics events / instrumentation written as engineering requirements', owner: 'BA / Eng Lead' },
    { txt: 'KPI targets reviewed and approved by PM and a business stakeholder', owner: 'PM' },
    { txt: 'A post-launch KPI review date is scheduled and linked to BA Review', owner: 'BA' },
    COO,
  ]},
  { name: 'To Do', owner: 'PM / Eng Lead', items: [
    { txt: 'User stories / tasks have clear, testable acceptance criteria', owner: 'PM' },
    { txt: 'Design / UX mockups are attached and approved, where applicable', owner: 'Design' },
    { txt: 'Technical approach / architecture reviewed for non-trivial stories', owner: 'Eng Lead' },
    { txt: 'Dependencies (APIs, integrations, other teams) identified and unblocked', owner: 'Eng Lead' },
    { txt: 'Stories are sized/estimated by the delivery team', owner: 'Dev Team' },
    { txt: 'A Definition of Done is explicitly agreed for the epic', owner: 'PM / Eng Lead' },
    { txt: 'Security/privacy flagged if the story touches payment or personal data', owner: 'Eng Lead / Security' },
    { txt: 'KPI instrumentation tasks from BA appear as explicit backlog items', owner: 'PM' },
  ]},
  { name: 'UI/UX', owner: 'Design Lead', items: [
    { txt: 'Approved hi-fi mockups for every screen & state, from the design system + tokens', owner: 'Design' },
    { txt: 'Visual hierarchy makes financial data instantly scannable', owner: 'Design' },
    { txt: 'Review + confirmation + receipt on money-moving flows; no dark patterns', owner: 'Design / PM' },
    { txt: 'Loading / empty / error / success states specified per screen', owner: 'Design' },
    { txt: 'Desktop + ≤785px, Light + Dark, using real theme tokens', owner: 'Design' },
    { txt: 'WCAG 2.2 AA: contrast, focus, keyboard, adjustable text, SR labels', owner: 'Design / Accessibility' },
    { txt: 'Plain-language microcopy; fees/rates/timing/disclosures inline', owner: 'UX Writer / PM' },
    { txt: 'Consistent currency/date formatting; data-viz per design system', owner: 'Design' },
    { txt: 'Trust & security affordances + human-escalation path', owner: 'Design / PM' },
    { txt: 'Design review done; Design Lead signs off + handoff to Dev', owner: 'Design Lead' },
    COO,
  ]},
  { name: 'Compliance Sign-off', owner: 'Compliance', items: [
    { txt: 'Compliance sign-off request sent', owner: 'PM' },
    { txt: 'Data-privacy impact reviewed for new personal or financial data', owner: 'Legal / Compliance' },
    { txt: 'Security review complete: encryption, access controls, key management', owner: 'Security' },
    { txt: 'Applicable regulations reviewed (PCI DSS, NACHA/ACH, money-transmitter, GLBA)', owner: 'Compliance' },
    { txt: 'Audit logging in place for compliance/regulatory-relevant actions', owner: 'Eng / Compliance' },
    { txt: 'Terms of Service / customer agreements updated if what customers agree to changed', owner: 'Legal' },
    { txt: 'Accessibility compliance (ADA/WCAG) confirmed for customer-facing changes', owner: 'Compliance / QA' },
    { txt: 'A named compliance officer/approver sign-off recorded, with date', owner: 'Compliance' },
    COO,
  ]},
  { name: 'Development', owner: 'Eng Lead', items: [
    { txt: "Code follows the team's coding standards / style guide, enforced via CI", owner: 'Dev' },
    { txt: 'Unit tests written alongside code, meeting minimum coverage', owner: 'Dev' },
    { txt: 'Code is peer-reviewed and approved before merge — no self-merges', owner: 'Dev / Reviewer' },
    { txt: 'Sensitive-data handling (encryption, PCI/PII) reviewed', owner: 'Security / Eng Lead' },
    { txt: 'A feature flag or safe-rollback mechanism implemented for risky changes', owner: 'Dev' },
    { txt: 'Analytics/KPI instrumentation implemented and verified locally', owner: 'Dev' },
    { txt: 'Notification content (email, in-app) drafted and implemented', owner: 'Dev / PM' },
    { txt: 'Documentation (API docs, runbooks) updated alongside the code', owner: 'Dev' },
    { txt: 'Ticket status accurately reflects real progress at each standup', owner: 'Dev / PM' },
  ]},
  { name: 'QA Scheduled', owner: 'QA Lead', items: [
    { txt: 'A test plan / test cases exist covering every acceptance criterion', owner: 'QA' },
    { txt: 'Test cases include edge cases and negative/failure scenarios', owner: 'QA' },
    { txt: 'Regression scope is defined', owner: 'QA' },
    { txt: 'Test data and environment prepared and available', owner: 'QA / DevOps' },
    { txt: 'Security/compliance test cases included for payments or PII', owner: 'QA / Security' },
    { txt: 'QA effort estimated, a tester assigned, and a timeline set', owner: 'QA Lead' },
  ]},
  { name: 'In QA', owner: 'QA', items: [
    { txt: 'Every planned test case executed and the result logged', owner: 'QA' },
    { txt: 'Defects logged with severity/priority and reproducible steps', owner: 'QA' },
    { txt: 'The regression suite is executed in full', owner: 'QA' },
    { txt: 'Critical/High defects triaged with engineering within SLA', owner: 'QA / Eng Lead' },
    { txt: 'Performance/load testing completed where relevant', owner: 'QA / Eng' },
    { txt: 'Accessibility (WCAG) checked for any customer-facing UI change', owner: 'QA' },
    { txt: 'Security/vulnerability scan run for payments, auth, or PII', owner: 'Security' },
    { txt: 'Notification triggers tested for content, timing, and audience', owner: 'QA' },
  ]},
  { name: 'QA Passed', owner: 'QA Lead', items: [
    { txt: 'A test summary report exists with pass/fail counts and defect summary', owner: 'QA' },
    { txt: 'Zero open Critical/High defects remain, or documented exceptions approved', owner: 'QA Lead' },
    { txt: 'The full regression suite passed', owner: 'QA' },
    { txt: 'The QA lead signs off by name and date in the ticket', owner: 'QA Lead' },
    { txt: 'Any deferred defects logged in the backlog with owner and priority', owner: 'QA / PM' },
    COO,
  ]},
  { name: 'Deployment', owner: 'DevOps', items: [
    { txt: 'Deployment executed following the documented runbook', owner: 'DevOps' },
    { txt: 'Deployment happens inside an approved change window', owner: 'DevOps' },
    { txt: 'Smoke tests run in production immediately after deploy', owner: 'QA / DevOps' },
    { txt: 'Monitoring and alerting confirmed active for the new functionality', owner: 'DevOps / Eng' },
    { txt: 'The rollback path validated (dry run or staging), not just documented', owner: 'DevOps' },
    { txt: 'Feature-flag state confirmed correct (e.g. internal/beta only)', owner: 'Eng Lead' },
    { txt: 'Deployment logged: who deployed, when, and which version', owner: 'DevOps' },
    { txt: 'Notification system config updated and triggers enabled for this release', owner: 'Eng / DevOps' },
    COO,
  ]},
  { name: 'Sales & Support Training', owner: 'Sales Lead / Support Lead', items: [
    { txt: 'Training meeting scheduled', owner: 'PM' },
    { txt: 'A hands-on training/demo conducted for Sales on the live feature', owner: 'PM / Sales Enablement' },
    { txt: 'A hands-on training/demo conducted for Support on the live feature', owner: 'PM / Support Lead' },
    { txt: 'Sales collateral / battlecards finalized and distributed', owner: 'Marketing / Sales' },
    { txt: 'Support macros, knowledge-base articles, and runbooks published', owner: 'Support Lead' },
    { txt: 'An escalation path defined for issues Support cannot resolve', owner: 'Support Lead / Eng' },
    { txt: 'Pricing/packaging changes communicated and confirmed understood', owner: 'Sales / Finance' },
    { txt: 'Sales Lead and Support Lead each explicitly sign off that their team is ready', owner: 'Sales Lead / Support Lead' },
    COO,
  ]},
  { name: 'Marketing Training', owner: 'Marketing Lead', items: [
    { txt: 'Training meeting scheduled', owner: 'PM' },
    { txt: 'Marketing briefed hands-on on the actual working feature', owner: 'PM / Marketing' },
    { txt: 'Messaging and positioning reviewed and approved', owner: 'Marketing / PM' },
    { txt: 'Launch assets (site, email, social, blog) drafted and fact-checked', owner: 'Marketing' },
    { txt: 'Legal/compliance reviews all marketing claims, especially regulated ones', owner: 'Legal / Marketing' },
    { txt: 'Launch timing coordinated with Deployment and Done', owner: 'Marketing / PM' },
    { txt: 'Marketing Lead signs off that team and assets are ready to launch', owner: 'Marketing Lead' },
    COO,
  ]},
  { name: 'Live BA Dashboard Preview', owner: 'BA / PM', items: [
    { txt: 'BA-defined KPIs are live on a real dashboard with actual data (not a mockup/sample)', owner: 'BA / Eng' },
    { txt: 'Live dashboard demoed to PM, BA, and the management stakeholder', owner: 'PM / BA' },
    { txt: 'Baseline and current values shown and reconcile with the BA baseline', owner: 'BA' },
    { txt: 'Guardrail metrics are visible and instrumented on the live dashboard', owner: 'BA / Eng' },
    { txt: 'Any instrumentation gaps vs the BA spec are logged with an owner', owner: 'BA / Eng Lead' },
    COO,
  ]},
  { name: 'Management Approval', owner: 'Management / Eng Lead', items: [
    { txt: 'Business case and KPI targets reviewed against what was actually built', owner: 'PM' },
    { txt: 'A risk assessment is reviewed', owner: 'Eng Lead / PM' },
    { txt: 'Budget or resourcing impacts reviewed, if applicable', owner: 'Finance / PM' },
    { txt: 'A go/no-go decision documented with a named approver', owner: 'Management' },
    { txt: 'Release notes are drafted', owner: 'PM' },
    { txt: 'Release approach confirmed — merge to the production branch triggers the CI/CD pipeline (no manual runbook/change ticket); rollback = revert the merge commit + re-run the pipeline', owner: 'Eng Lead' },
    { txt: 'Final legal/compliance review scheduled and linked to Compliance Sign-off', owner: 'PM / Legal' },
    COO,
  ]},
  { name: 'Done', owner: 'PM', items: [
    { txt: 'The feature is live for its full intended audience', owner: 'Eng / PM' },
    { txt: 'Every prior-phase sign-off is present and linked in the epic', owner: 'PM' },
    { txt: 'Customer-facing documentation / help-center articles updated', owner: 'Support / Marketing' },
    { txt: 'No open Critical/High defect remains linked to this epic', owner: 'QA' },
    { txt: 'A post-launch monitoring dashboard is live and watched 48–72h', owner: 'Eng / DevOps' },
    { txt: 'Notifications confirmed actually delivered to the intended audience', owner: 'PM / Support' },
    { txt: 'The epic is formally closed with a written completion summary', owner: 'PM' },
    COO,
  ]},
  { name: 'BA Review', owner: 'BA', items: [
    { txt: 'Actual KPI results measured against baseline and original target', owner: 'BA' },
    { txt: 'Guardrail metrics reviewed to confirm nothing regressed', owner: 'BA' },
    { txt: 'A review meeting held with PM, BA, and relevant stakeholders', owner: 'BA / PM' },
    { txt: "Findings documented — what worked, what didn't, and why", owner: 'BA' },
    { txt: 'Follow-up backlog items created for any identified gaps', owner: 'PM' },
    { txt: 'Learnings shared back to Marketing, Sales, and Support', owner: 'PM / BA' },
    { txt: 'The next KPI review interval scheduled if continued tracking is needed', owner: 'BA' },
    COO,
  ]},
];

export const BUG_PHASES = [
  { name: 'Triage / To Do', owner: 'Eng Lead / QA Lead', items: [
    { txt: 'Bug reproduced with clear, written steps to reproduce', owner: 'Dev / QA' },
    { txt: 'Severity assigned using the rubric: Critical, High, Medium, or Low', owner: 'Eng Lead / QA Lead' },
    { txt: 'Root cause hypothesis or affected component/system identified', owner: 'Dev' },
    { txt: 'Customer/business impact documented (users, revenue, compliance, data)', owner: 'PM / Support' },
    { txt: 'Bug linked to its originating source (ticket, alert, customer report)', owner: 'Support / PM' },
    { txt: 'If a regression of a fixed bug, that is flagged and the test gap noted', owner: 'QA' },
    { txt: 'Critical: Eng Lead / on-call notified and fast-track triggered', owner: 'Eng Lead' },
  ]},
  { name: 'In Progress', owner: 'Dev', items: [
    { txt: 'The fix addresses the root cause, not just the symptom — reasoning documented', owner: 'Dev' },
    { txt: 'A regression test is added that would have caught this bug', owner: 'Dev' },
    { txt: 'Code is peer-reviewed and approved before merge — no self-merges', owner: 'Dev / Reviewer' },
    { txt: 'Fixes touching payment/PII/security get a second senior/security review', owner: 'Security / Senior Eng' },
    { txt: 'Blast radius assessed — what else could this change affect', owner: 'Dev / Eng Lead' },
    { txt: 'A feature flag or kill switch used for any fix carrying meaningful risk', owner: 'Dev' },
  ]},
  { name: 'QA Scheduled', owner: 'QA Lead', items: [
    { txt: 'A tester is assigned', owner: 'QA Lead' },
    { txt: 'Test scope defined: the bug itself plus the related regression area', owner: 'QA' },
    { txt: 'Critical/High: tester engaged immediately, in parallel with the fix', owner: 'QA Lead' },
  ]},
  { name: 'In QA', owner: 'QA', items: [
    { txt: 'Original reproduction steps no longer reproduce the bug', owner: 'QA' },
    { txt: 'A targeted regression check on the affected area is completed', owner: 'QA' },
    { txt: 'Medium/Low: full regression. Critical/High: targeted, scope documented', owner: 'QA Lead' },
    { txt: 'Fix verified in a staging/pre-prod environment matching production', owner: 'QA' },
  ]},
  { name: 'QA Passed', owner: 'QA Lead', items: [
    { txt: 'QA Lead sign-off recorded, by name and date', owner: 'QA Lead' },
    { txt: 'Any residual risk or known limitation is documented', owner: 'QA' },
  ]},
  { name: 'Deployment & Done', owner: 'Eng Lead / PM', items: [
    { txt: 'Fix merged to master (staging to master PR) - triggers the deploy pipeline', owner: 'Dev / Eng Lead' },
    { txt: 'Pipeline build passed - green, no failures', owner: 'Eng Lead' },
    { txt: 'Smoke-tested in production', owner: 'QA / Dev' },
    { txt: 'Issue watched post-deploy - no regression', owner: 'Dev' },
    { txt: 'Rollback ready - revert commit + re-run pipeline', owner: 'Dev / Eng Lead' },
    { txt: 'Deploy logged - PR # + build', owner: 'Eng Lead' },
    { txt: 'Fix confirmed resolved in production, not just staging', owner: 'Eng / QA' },
    { txt: 'Original reporter / support ticket / customer notified, where applicable', owner: 'Support / PM' },
    { txt: 'Bug ticket closed with root cause and fix summary documented', owner: 'Dev / PM' },
    { txt: 'If a systemic gap let this through, a follow-up improvement ticket created', owner: 'Eng Lead / QA Lead' },
    { txt: 'Critical: no related incident/defect reopens within 48–72h post-deploy', owner: 'Eng / QA' },
    { txt: 'Sign-off recorded - COO if Critical/High, otherwise PM', owner: 'COO / PM' },
  ]},
];

// phase labels (order matches FEATURE_PHASES / BUG_PHASES) — used to match a story to its phase
const FEATURE_LABELS = ["phase-knowledge", "phase-ba", "phase-todo", "phase-uiux", "phase-compliance", "phase-development", "phase-qa-scheduled", "phase-in-qa", "phase-qa-passed", "phase-deployment", "phase-sales-support", "phase-marketing", "phase-ba-dashboard", "phase-mgmt-approval", "phase-done", "phase-ba-review"];
const BUG_LABELS = ["phase-triage", "phase-in-progress", "phase-qa-scheduled", "phase-in-qa", "phase-qa-passed", "phase-deployment"];

// ---- CURRENT (4-phase) definitions — every new epic (feature and bug) uses these ----
// Define -> Build -> Deploy (go live ASAP, contained) -> Verify (on the live feature; unlocks
// full rollout). Shared labels across both tracks. Keep index-aligned with LABELS_V2. The last
// item of each phase is the benchmark/ETA row — the directive's "flag the blocker + revised ETA early".
export const FEATURE_PHASES_V2 = [
  { name: 'Define', owner: 'PM', items: [
    { txt: 'What it does, who it is for, and the primary use case are documented in one place', owner: 'PM' },
    { txt: 'Primary KPI defined with a target value and how it will be measured', owner: 'PM / BA' },
    { txt: 'Acceptance criteria written and testable', owner: 'PM' },
    { txt: 'UX / design attached and approved where there is a UI (else marked N/A)', owner: 'Design' },
    { txt: 'Money / PII / compliance impact flagged for Verify, if applicable', owner: 'Eng Lead / Compliance' },
    { txt: 'Scope and dependencies agreed — what is in, what is out, blockers identified', owner: 'PM / Eng Lead' },
    { txt: 'On track vs the 3-day benchmark — if not, the blocker and a revised ETA are recorded here', owner: 'PM' },
  ]},
  { name: 'Build', owner: 'Eng Lead', items: [
    { txt: 'Built to the agreed acceptance criteria', owner: 'Dev' },
    { txt: 'Unit tests written alongside the code; peer-reviewed, no self-merge', owner: 'Dev / Reviewer' },
    { txt: 'KPI instrumentation implemented so the feature is measurable once live', owner: 'Dev' },
    { txt: 'Feature flag or safe-rollback mechanism in place for money-moving or risky changes', owner: 'Dev' },
    { txt: 'Notification content (email, in-app) implemented where applicable', owner: 'Dev / PM' },
    { txt: 'Documentation / runbook updated alongside the code', owner: 'Dev' },
    { txt: 'On track vs the agreed build benchmark — if not, the blocker and a revised ETA are recorded here', owner: 'Eng Lead' },
  ]},
  { name: 'Deploy', owner: 'DevOps / Eng Lead', items: [
    { txt: 'Merged to production via the CI/CD pipeline', owner: 'Eng Lead' },
    { txt: 'Live behind a feature flag or to a limited audience — real but contained', owner: 'Eng Lead' },
    { txt: 'Production smoke test passed', owner: 'QA / DevOps' },
    { txt: 'Monitoring and alerting active for the new functionality', owner: 'DevOps / Eng' },
    { txt: 'One-action rollback confirmed (revert the merge + re-run the pipeline)', owner: 'Eng Lead' },
    { txt: 'Deployment logged: who deployed, when, and which version', owner: 'DevOps' },
    { txt: 'On track vs the 2-day benchmark — if not, the blocker and a revised ETA are recorded here', owner: 'DevOps / Eng Lead' },
  ]},
  { name: 'Verify', owner: 'QA Lead', items: [
    { txt: 'QA executed against production; defects logged with severity and repro steps', owner: 'QA' },
    { txt: 'Compliance and security confirmed on the live behaviour (PCI/NACHA/PII as applicable)', owner: 'Compliance / Security' },
    { txt: 'No open Critical/High defects remain, or documented exceptions approved', owner: 'QA Lead' },
    { txt: 'Management go/no-go for full rollout recorded — by name and date', owner: 'Management' },
    { txt: 'KPI measured against baseline/target; guardrail metrics confirmed not regressed', owner: 'BA' },
    { txt: 'Sales, Support, and Marketing briefed on the live feature', owner: 'PM' },
    { txt: 'Flag opened to the full audience; epic closed with a written completion summary', owner: 'PM' },
    { txt: 'On track vs the 3-day benchmark — if not, the blocker and a revised ETA are recorded here', owner: 'QA Lead' },
  ]},
];

export const BUG_PHASES_V2 = [
  { name: 'Define', owner: 'Eng Lead / QA Lead', items: [
    { txt: 'Bug reproduced with clear, written steps to reproduce', owner: 'Dev / QA' },
    { txt: 'Severity assigned: Critical, High, Medium, or Low', owner: 'Eng Lead / QA Lead' },
    { txt: 'Root-cause hypothesis or affected component/system identified', owner: 'Dev' },
    { txt: 'Customer / business impact documented (users, revenue, compliance, data)', owner: 'PM / Support' },
    { txt: 'Linked to its originating source (ticket, alert, customer report)', owner: 'Support / PM' },
    { txt: 'If a regression of a fixed bug, that is flagged and the test gap noted', owner: 'QA' },
    { txt: 'On track vs the triage benchmark — if not, the blocker and a revised ETA are recorded here', owner: 'Eng Lead' },
  ]},
  { name: 'Build', owner: 'Dev', items: [
    { txt: 'The fix addresses the root cause, not the symptom — reasoning documented', owner: 'Dev' },
    { txt: 'A regression test added that would have caught this bug', owner: 'Dev' },
    { txt: 'Peer-reviewed and approved before merge — no self-merge', owner: 'Dev / Reviewer' },
    { txt: 'Payment / PII / security fixes get a second senior/security review', owner: 'Security / Senior Eng' },
    { txt: 'Blast radius assessed — what else this change could affect', owner: 'Dev / Eng Lead' },
    { txt: 'A feature flag or kill switch used for any fix carrying meaningful risk', owner: 'Dev' },
    { txt: 'On track vs the fix benchmark — if not, the blocker and a revised ETA are recorded here', owner: 'Dev' },
  ]},
  { name: 'Deploy', owner: 'Eng Lead', items: [
    { txt: 'Fix merged to master (staging to master PR) — triggers the deploy pipeline', owner: 'Dev / Eng Lead' },
    { txt: 'Pipeline build passed — green, no failures', owner: 'Eng Lead' },
    { txt: 'Smoke-tested in production', owner: 'QA / Dev' },
    { txt: 'Rollback ready — revert commit + re-run pipeline', owner: 'Dev / Eng Lead' },
    { txt: 'Deployment logged — PR # + build', owner: 'Eng Lead' },
    { txt: 'On track vs the deploy benchmark — if not, the blocker and a revised ETA are recorded here', owner: 'Eng Lead' },
  ]},
  { name: 'Verify', owner: 'QA / PM', items: [
    { txt: 'Original reproduction steps no longer reproduce the bug', owner: 'QA' },
    { txt: 'A targeted regression check on the affected area is completed', owner: 'QA' },
    { txt: 'Fix confirmed resolved in production, not just staging', owner: 'Eng / QA' },
    { txt: 'Original reporter / support ticket / customer notified, where applicable', owner: 'Support / PM' },
    { txt: 'Bug ticket closed with root cause and fix summary documented', owner: 'Dev / PM' },
    { txt: 'Critical: no related incident/defect reopens within 48-72h post-deploy', owner: 'Eng / QA' },
    { txt: 'Sign-off recorded — COO if Critical/High, otherwise PM', owner: 'COO / PM' },
  ]},
];

// Shared 4-phase labels (index-aligned with *_V2). An epic is "V2" if any of these appear on its stories.
const LABELS_V2 = ["phase-define", "phase-build", "phase-deploy", "phase-verify"];

// Merge live per-issue data with the static framework into the phase objects the UI renders.
// item.phaseByLabel (real child-story data, keyed by phase label) → real status/checklist/sign-off.
// Otherwise fall back to coarse item.phaseIndex/item.done (epic not yet provisioned into phase stories).
export function buildPhases(kind, item) {
  const pbl = item && item.phaseByLabel;
  // Per-epic model selection: an epic provisioned under the current 4-phase model carries a
  // phase-define/build/deploy/verify label; legacy epics carry the old labels. An unprovisioned
  // epic (no stories yet) defaults to the 4-phase model, since that is what new epics now get.
  const isV2 = pbl ? LABELS_V2.some((l) => pbl[l]) : true;
  const defs = isV2 ? (kind === "feature" ? FEATURE_PHASES_V2 : BUG_PHASES_V2)
                    : (kind === "feature" ? FEATURE_PHASES : BUG_PHASES);
  const labels = isV2 ? LABELS_V2 : (kind === "feature" ? FEATURE_LABELS : BUG_LABELS);

  if (pbl) {
    let curFound = false;
    const out = defs.map((pd, i) => {
      const s = pbl[labels[i]];
      const storyDone = !!(s && s.done);
      const skipped = s ? (s.skipped || null) : null;
      const blocked = s ? (s.blocked || null) : null;
      let state;
      if (skipped || storyDone) state = "done";
      else if (!curFound) { state = blocked ? "blocked" : "current"; curFound = true; }
      else state = blocked ? "blocked" : "todo";

      // real checklist items (open/complete) zipped with framework owners by index; else framework text.
      // The Gebsun tick is AUTHORITATIVE for done-ness: completing an item via a dashboard note already
      // ticks the Gebsun box (setItemNote -> markChecklistItem), so note-completions still show done via
      // ri.done — but an explicit UNtick in Gebsun now correctly clears it (we no longer OR in note.completed).
      // A mapped approved task (which never touches Gebsun) still counts; a skipped phase marks all done.
      const checklist = (s && s.items && s.items.length)
        ? s.items.map((ri, idx) => ({ txt: ri.text, owner: (pd.items[idx] && pd.items[idx].owner) || pd.owner, done: !!skipped || !!ri.done || !!(ri.mappedTask && ri.mappedTask.approved), skipped: !!skipped, coo: /COO/i.test(ri.text), mappedTask: ri.mappedTask || null, note: ri.note || null }))
        : pd.items.map((it) => ({ txt: it.txt, owner: it.owner, done: !!skipped, skipped: !!skipped, coo: /COO/.test(it.txt), mappedTask: null, note: null }));

      // completion % counts ALL methods above (not just Gebsun's own count)
      const total = checklist.length || (s && s.total) || pd.items.length;
      const doneN = checklist.filter((c) => c.done).length;
      const pct = total ? Math.round((doneN / total) * 100) : 0;
      // TASK status reflects the phase-story's REAL Jira status category (not just the checklist):
      // a story that is "In Progress" in Jira must not read "Not Started" because its checklist is 0.
      // CHECK % (pct, below) stays purely checklist-driven.
      const cat = s ? s.cat : null;   // 'done' | 'indeterminate' (In Progress) | 'new' (To Do/Backlog)
      const status = skipped ? "Skipped"
        : (state === "blocked") ? "Delayed"
        : (storyDone || cat === "done" || (total > 0 && doneN >= total)) ? "Complete"
        : (cat === "indeterminate" || doneN > 0 || state === "current") ? "In Progress"
        : "Not Started";

      // phase-appropriate sign-off (reuse existing role fields where they apply)
      let approver = null, approverDate = null;
      if (s) {
        const L = labels[i];
        if (L === "phase-qa-passed" || L === "phase-in-qa" || L === "phase-qa-scheduled") { approver = s.tested || s.signBy; approverDate = s.signDate; }
        else if (L === "phase-deployment" || L === "phase-deploy") { approver = s.deployPerson || s.signBy; approverDate = s.deployDate || s.signDate; }
        else if (L === "phase-mgmt-approval") { approver = s.mgmtApproval || s.signBy; approverDate = s.signDate; }
        else if (L === "phase-verify") { approver = s.mgmtApproval || s.tested || s.signBy; approverDate = s.signDate; }
        else { approver = s.signBy; approverDate = s.signDate; }
      }
      return {
        name: pd.name, owner: pd.owner, label: labels[i], state, pct, status,
        approver: approver || null, approverDate: approverDate || null,
        coo: s ? (s.cooBy || null) : null, cooDate: s ? (s.cooDate || null) : null,
        due: s ? (s.due || null) : null, blocked, skipped,
        notes: "", storyKey: s ? s.key : null, checklist,
      };
    });

    // Insert the synthetic "QA Rework" phase — between In QA and QA Passed — whenever the epic has any
    // pushed rework (records stored on push). The round-grouped detail loads on demand from
    // getReworkRounds(epicKey); here we only need the summary to place + label the phase.
    if (!isV2 && item && item.rework && item.rework.count > 0) {
      const rw = item.rework;
      const reworkPhase = {
        name: "QA Rework", owner: "Dev / QA", label: "phase-qa-rework",
        rework: { epicKey: item.key, rounds: rw.rounds || [], count: rw.count },
        state: "current",
        pct: 0,
        status: `${(rw.rounds || []).length} round${(rw.rounds || []).length === 1 ? "" : "s"}`,
        approver: null, approverDate: null, coo: null, cooDate: null,
        due: null, blocked: null, skipped: null, storyKey: null,
        checklist: [],
      };
      const at = out.findIndex((p) => p.label === "phase-qa-passed");
      out.splice(at >= 0 ? at : out.length, 0, reworkPhase);
    }
    return out;
  }

  // fallback: epic NOT provisioned into phase stories yet — show an honest empty
  // state. Never fabricate completion from Jira status/phaseIndex: with no phase
  // stories there is zero checklist evidence, so nothing is "done".
  return defs.map((pd, i) => ({
    name: pd.name, owner: pd.owner, label: labels[i],
    state: i === 0 ? "current" : "todo",
    pct: 0,
    status: "Not provisioned",
    approver: null, approverDate: null, coo: null, cooDate: null, due: null, notes: "", storyKey: null,
    checklist: pd.items.map((it) => ({ txt: it.txt, owner: it.owner, done: false, coo: /COO/.test(it.txt) })),
  }));
}
