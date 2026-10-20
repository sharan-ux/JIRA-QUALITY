// Pure scoring helpers for the team assessment — extracted so they're unit-testable
// without the @forge runtime (index.js can't run under plain Node).

// bad events out of total → traffic-light grade. 0 total = not assessable (grey).
export const gradeFrom = (bad, total) =>
  total === 0 ? 'grey'
    : bad === 0 ? 'green'
      : bad <= Math.max(2, Math.ceil(total * 0.2)) ? 'amber'
        : 'red';

// on-time QA turnaround. ISO dates (YYYY-MM-DD) compare correctly as plain strings.
// null = not judgeable (missing due date or no QA-finish signal).
export const qaVerdict = (qaFinish, duedate) =>
  (!qaFinish || !duedate) ? null : (qaFinish <= duedate ? 'onTime' : 'late');

// person aggregate → displayed role + grade, judged against whichever role they do most.
// Ties fall to the earlier entry (dev > tester > reviewer > deployer) via stable sort.
export function roleAndGrade(p, reworks) {
  const topLabel = Object.entries(p.labels || {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  const [primaryRole, primaryCount] = [['dev', p.assigned], ['tester', p.tested], ['reviewer', p.reviewed], ['deployer', p.deployed]]
    .sort((a, b) => b[1] - a[1])[0];
  if (primaryCount === 0) return { role: '—', grade: 'grey' };
  if (primaryRole === 'tester') return { role: 'Tester (QA)', grade: gradeFrom(p.qaLate, p.qaOnTime + p.qaLate) };
  if (primaryRole === 'reviewer') return { role: 'Reviewer', grade: 'grey' };
  if (primaryRole === 'deployer') return { role: 'Deployer', grade: 'grey' };
  return { role: topLabel || 'Developer', grade: gradeFrom(reworks + p.late, p.assigned) };
}
