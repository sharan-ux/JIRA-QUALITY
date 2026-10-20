// Run: node src/resolvers/scoring.test.mjs
import assert from 'node:assert/strict';
import { gradeFrom, qaVerdict, roleAndGrade } from './scoring.mjs';

let n = 0; const ok = (m) => { n++; console.log(`  ok ${n} - ${m}`); };

// --- gradeFrom thresholds ---
assert.equal(gradeFrom(0, 0), 'grey', 'no activity = grey');
assert.equal(gradeFrom(0, 10), 'green', 'zero bad = green');
assert.equal(gradeFrom(2, 10), 'amber', 'within 20% (or <=2) = amber');
assert.equal(gradeFrom(2, 3), 'amber', 'small volume floor of 2 = amber');
assert.equal(gradeFrom(3, 10), 'red', 'over threshold = red');
ok('gradeFrom traffic-light thresholds');

// --- qaVerdict: on-time QA turnaround via ISO string compare ---
assert.equal(qaVerdict('2026-08-01', '2026-08-02'), 'onTime', 'cleared before due');
assert.equal(qaVerdict('2026-08-02', '2026-08-02'), 'onTime', 'cleared on due date counts on-time');
assert.equal(qaVerdict('2026-08-03', '2026-08-02'), 'late', 'cleared after due');
assert.equal(qaVerdict(null, '2026-08-02'), null, 'no QA-finish signal = unjudged');
assert.equal(qaVerdict('2026-08-02', null), null, 'no due date = unjudged');
ok('qaVerdict on-time / late / unjudged');

// --- THE core fix: a tester with no assigned tasks is assessed, not greyed out ---
const tester = roleAndGrade({ labels: {}, assigned: 0, tested: 8, reviewed: 0, deployed: 0, qaOnTime: 8, qaLate: 0, late: 0 }, 0);
assert.equal(tester.role, 'Tester (QA)', 'pure tester gets a real role');
assert.equal(tester.grade, 'green', 'tester with all on-time QA = green (was grey before)');

const sloppyTester = roleAndGrade({ labels: {}, assigned: 0, tested: 10, reviewed: 0, deployed: 0, qaOnTime: 5, qaLate: 5, late: 0 }, 0);
assert.equal(sloppyTester.grade, 'red', 'tester with many late-QA = red');

const idleTester = roleAndGrade({ labels: {}, assigned: 0, tested: 3, reviewed: 0, deployed: 0, qaOnTime: 0, qaLate: 0, late: 0 }, 0);
assert.equal(idleTester.grade, 'grey', 'tested but no due dates to judge = honestly grey');
ok('tester is graded on on-time QA, not greyed out');

// --- role precedence: dev work outranks incidental testing on ties/higher counts ---
const dev = roleAndGrade({ labels: { Backend: 5 }, assigned: 5, tested: 5, reviewed: 0, deployed: 0, qaOnTime: 5, qaLate: 5, late: 0 }, 1);
assert.equal(dev.role, 'Backend', 'tie between dev and tester → dev role');
assert.equal(dev.grade, gradeFrom(1, 5), 'dev graded on reworks+late, not QA lateness');

const reviewer = roleAndGrade({ labels: {}, assigned: 0, tested: 0, reviewed: 4, deployed: 0, qaOnTime: 0, qaLate: 0, late: 0 }, 0);
assert.equal(reviewer.role, 'Reviewer', 'pure reviewer labelled Reviewer');

const nobody = roleAndGrade({ labels: {}, assigned: 0, tested: 0, reviewed: 0, deployed: 0, qaOnTime: 0, qaLate: 0, late: 0 }, 0);
assert.deepEqual(nobody, { role: '—', grade: 'grey' }, 'no activity at all = dash + grey');
ok('role precedence (dev > tester > reviewer) and empty person');

console.log(`\nAll ${n} groups passed.`);
