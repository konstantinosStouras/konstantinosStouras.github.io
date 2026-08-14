/* Simulation Platform — offline guard for the roster's completion reading.
   No network, no browser: loads simulation/completions.js against a tiny
   window shim and pins the rules the ✓ / — cell and the "Verify from …"
   reconciliation BOTH decide by.

   WHAT IT PROTECTS. A student can back several roster docs (every
   registration mints a fresh anonymous uid), and their own browser pushes its
   play-once markers only to the doc it is signed into. So the newest doc —
   the one the row is built from — can be missing a ✓ that a collapsed
   duplicate carries. Reading the newest doc alone showed "—" for a student
   the simulation's own admin showed as done, and the reconciliation, which
   asked a DIFFERENT question ("does ANY doc have it?"), then counted that
   student as already matched and wrote nothing — so the cell never healed.
   One merged reading fixes both halves; these checks stop it drifting apart
   again.

   Run: node simulation/tools/completion-guard.mjs
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIM = join(HERE, '..');

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log('  ok — ' + msg);
  else { fails++; console.log('  FAIL — ' + msg); }
}

const sandbox = { window: {} };
vm.createContext(sandbox);
const src = join(SIM, 'completions.js');
vm.runInContext(readFileSync(src, 'utf8'), sandbox, { filename: src });
const C = sandbox.window.SIMP_COMPLETIONS;

console.log('Simulation Platform — completion-map guard\n');
ok(C && typeof C.groupByStudent === 'function', 'completions.js defines SIMP_COMPLETIONS');

/* --- the join key ------------------------------------------------------- */
console.log('\nStudent key');
ok(C.studentKey({ studentId: ' 25262368 ' }) === '25262368', 'trimmed');
ok(C.studentKey({ studentId: 'AB12' }) === 'ab12', 'lower-cased');
ok(C.studentKey({}) === '', 'no ID on record → empty');
ok(C.rowKey({ uid: 'u1' }) === 'uid:u1', 'an ID-less registration keys on its uid, so it stays its own row');
ok(C.rowKey({ studentId: '25262368', uid: 'u1' }) === '25262368', 'an ID keys on the ID');

/* --- merging a student's docs ------------------------------------------- */
console.log('\nMerged completion map');
const newest = { uid: 'u2', studentId: '25262368', email: 'a@b.c', updatedAt: '2026-08-14T04:00:00Z', completed: {} };
const older = { uid: 'u1', studentId: '25262368', email: 'a@b.c', updatedAt: '2026-08-10T09:00:00Z',
                completed: { portfoliofit: { ts: 5, session: 'SGP1', src: 'client' } } };

let g = C.groupByStudent([older, newest]);
let one = g['25262368'];
ok(Object.keys(g).length === 1, 'two docs of one student collapse into one group');
ok(one.rows[0].uid === 'u2', 'the group is newest-first (rows[0] is the row on screen)');
ok(one.uids.join(',') === 'u2,u1', 'every uid behind the row is kept, so a write fans out to all of them');
ok(one.refs.every(r => r.email === 'a@b.c'), 'refs carry the e-mail — the recovery replica is keyed by address');
ok(C.isDone(one.completed.portfoliofit),
   'THE BUG: a ✓ pushed to a duplicate is visible on the row (newest doc has none)');

/* Order must not matter to the caller — the group sorts by itself. */
ok(C.isDone(C.groupByStudent([newest, older])['25262368'].completed.portfoliofit),
   'same result whatever order the snapshot arrives in');

/* Newest-wins, so a revocation stays authoritative. */
const revoked = { uid: 'u3', studentId: '25262368', updatedAt: '2026-08-15T09:00:00Z',
                  completed: { portfoliofit: { revoked: 1, rts: 9 } } };
ok(!C.isDone(C.groupByStudent([older, revoked])['25262368'].completed.portfoliofit),
   'a tombstone on the current doc still hides an older mark (the instructor removed the ✓ on purpose)');
const retaken = { uid: 'u4', studentId: '25262368', updatedAt: '2026-08-16T09:00:00Z',
                  completed: { portfoliofit: { ts: 99, session: 'SGP2', src: 'client' } } };
ok(C.isDone(C.groupByStudent([older, revoked, retaken])['25262368'].completed.portfoliofit),
   'a retake after the revocation counts again');

/* Keys are decided independently of one another. */
const mixed = C.groupByStudent([
  { uid: 'a', studentId: 'x1', updatedAt: '2026-08-14T00:00:00Z', completed: { ideasearchlab: { ts: 2 } } },
  { uid: 'b', studentId: 'x1', updatedAt: '2026-08-01T00:00:00Z', completed: { portfoliofit: { ts: 1 }, ideasearchlab: { ts: 1 } } }
])['x1'].completed;
ok(C.isDone(mixed.portfoliofit) && mixed.ideasearchlab.ts === 2,
   'per simulation key: the newest statement wins, keys nobody newer mentions fall back');

/* Different students never fuse, however similar. */
const two = C.groupByStudent([
  { uid: 'a', studentId: '25259607', updatedAt: '2026-08-14T00:00:00Z' },
  { uid: 'b', studentId: '25259623', updatedAt: '2026-08-14T00:00:00Z' }
]);
ok(Object.keys(two).length === 2, 'two different student IDs stay two rows');

/* Inputs are never mutated (the roster re-renders from the same objects). */
const raw = { uid: 'z', studentId: 'z9', updatedAt: '2026-08-14T00:00:00Z', completed: { a: { ts: 1 } } };
C.groupByStudent([raw, { uid: 'y', studentId: 'z9', updatedAt: '2026-08-01T00:00:00Z', completed: { b: { ts: 1 } } }]);
ok(Object.keys(raw.completed).join(',') === 'a', 'the snapshot rows are left untouched');

/* --- the two halves ask the SAME question ------------------------------- */
console.log('\nRoster cell and reconciliation agree');
{
  /* What the cell shows for the displayed row … */
  const grp = C.groupByStudent([older, newest]);
  const shown = C.isDone(grp[C.rowKey(newest)].completed.portfoliofit);
  /* … and what the reconciliation concludes for the same student. */
  const alreadyMatched = C.isDone(grp['25262368'].completed.portfoliofit);
  ok(shown === alreadyMatched,
     'a student the pass skips as "already matched" is one the roster really shows as ✓');
}
{
  const only = [{ uid: 'u9', studentId: 'q1', updatedAt: '2026-08-14T00:00:00Z', completed: {} }];
  const grp = C.groupByStudent(only);
  ok(!C.isDone(grp.q1.completed.portfoliofit),
     'a student with no marker anywhere is stamped, not skipped');
}

/* --- admin.js still uses it -------------------------------------------- */
console.log('\nWiring');
const admin = readFileSync(join(SIM, 'admin', 'admin.js'), 'utf8');
ok(/window\.SIMP_COMPLETIONS/.test(admin), 'admin.js reads SIMP_COMPLETIONS');
ok(/C\.groupByStudent\(rows\)/.test(admin), 'renderRoster groups the snapshot');
ok(/C\.groupByStudent\(rosterRows\)/.test(admin), 'the reconciliation groups its fresh roster read');
ok(!/uidsByKey|rowsByKey/.test(admin), 'no leftover per-doc grouping in admin.js');
ok(/_merged/.test(admin), 'the displayed row carries the merged map');
const adminHtml = readFileSync(join(SIM, 'admin', 'index.html'), 'utf8');
ok(/completions\.js/.test(adminHtml), 'the admin page loads completions.js');
ok(adminHtml.indexOf('completions.js') < adminHtml.indexOf('admin/admin.js') ||
   adminHtml.indexOf('completions.js') < adminHtml.indexOf('./admin.js'),
   'it loads BEFORE admin.js');

/* A verified/manual ✓ must reach the e-mail recovery replica, or it is lost
   the moment the student logs in on another device (their new registration
   becomes the newest roster doc and nothing restores the mark onto it). */
const platform = readFileSync(join(SIM, 'platform.js'), 'utf8');
const stamp = platform.slice(platform.indexOf('stampCompleted: function'),
                             platform.indexOf('revokeCompletion: function'));
ok(/PATHS\.recovery/.test(stamp), 'stampCompleted writes the e-mail recovery replica too');
ok(/typeof r === 'string'/.test(stamp), 'it still accepts bare uid strings');
ok(!/F\.stampCompleted\(uids/.test(admin), 'admin.js passes {uid,email} rows so the replica can be written');

console.log('\n' + (fails ? '✗ ' + fails + ' of ' + checks + ' checks FAILED'
                          : '✓ all ' + checks + ' checks passed'));
process.exit(fails ? 1 : 0);
