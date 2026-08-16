/* Simulation Platform — offline guard for the roster ↔ simulation MATCHING
   and duplicate-registration logic (admin/match.js). No network, no browser.

   WHAT IT PROTECTS (owner 2026-08-16). The "⟲ Verify from …" reconciliation
   used to join on the university student ID alone, so one typo (or a student
   who re-registered with slightly different details) lost the match for good
   — the simulation's own admin showed the play while the roster kept reading
   "—" however often Verify was pressed (the reported Qiu Taoyi case). The
   join is now STUDENT ID AND/OR E-MAIL, and the same cross-identity view
   surfaces DUPLICATE registrations to the admin in a pop-up with a per-entry
   removal suggestion. These checks pin:

     · the two-pass join: ID first, then the record's e-mail rescues an ID
       typo; an e-mail-only record still finds its student; a stranger stays
       unmatched; nothing ever fuses two different students;
     · one record answering to TWO roster rows (ID→A, e-mail→B) is reported
       as duplicate evidence (links) — and clustered with same-e-mail rows;
     · the removal suggestions follow the owner's two patterns and ONLY
       those: a profile that merely registered while its duplicate carries
       the play data, and a super-fast play made before re-registering to
       play properly (the fast-play profile goes, the fresh one stays);
       anything ambiguous gets NO suggestion, and a suggestion never covers
       a whole cluster;
     · the e-mail rule matches admin/verify.js's private copy (that file is
       loaded standalone by its own guard, so it cannot import match.js);
     · the wiring: the admin page loads match.js, admin.js joins through it,
       auto-verification exists and can never prompt for a password.

   Run: node simulation/tools/match-guard.mjs
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
for (const f of [join(SIM, 'completions.js'), join(SIM, 'admin', 'match.js')]) {
  vm.runInContext(readFileSync(f, 'utf8'), sandbox, { filename: f });
}
const C = sandbox.window.SIMP_COMPLETIONS;
const M = sandbox.window.SIMP_MATCH;

console.log('Simulation Platform — match / duplicates guard\n');
ok(M && typeof M.joinRecords === 'function', 'match.js defines SIMP_MATCH');

/* --- the e-mail join key -------------------------------------------------- */
console.log('\nE-mail key');
ok(M.emailKey(' Foo@QQ.com ') === 'foo@qq.com', 'trimmed + lower-cased');
ok(M.emailKey('not-an-email') === '', 'a non-address is never a key');
ok(M.emailKey('') === '' && M.emailKey(null) === '', 'empty/absent is empty');
ok(M.emailKey('student-ab12@simplatform.stouras.com') === '',
   'the synthetic throwaway login domain is never an identity');

/* verify.js keeps a private copy of the same rule (it must load standalone
   for its own guard) — the two sources may not drift apart. */
const matchSrc = readFileSync(join(SIM, 'admin', 'match.js'), 'utf8');
const verifySrc = readFileSync(join(SIM, 'admin', 'verify.js'), 'utf8');
const emailRx = src => (src.match(/\/\^\[\^\\s@\]\+@[^/]*\$\//) || [])[0] || null;
ok(!!emailRx(matchSrc) && emailRx(matchSrc) === emailRx(verifySrc),
   'match.js and verify.js apply the SAME e-mail shape rule');
ok(matchSrc.includes('@simplatform\\.stouras\\.com') &&
   verifySrc.includes('@simplatform\\.stouras\\.com'),
   'both sources exclude the synthetic throwaway domain');

/* --- fixtures ------------------------------------------------------------- */
const row = (uid, studentId, email, updatedAt, completed, name) =>
  ({ uid, studentId, email, updatedAt, createdAt: updatedAt, completed: completed || {},
     name: name || '' });

const ROWS = [
  row('u-ann', '11111111', 'ann@x.ie', '2026-08-10T09:00:00Z'),
  row('u-bob', '22222222', 'bob@x.ie', '2026-08-10T10:00:00Z'),
  /* one person, two registrations sharing an e-mail — different IDs, so the
     roster's same-ID collapse cannot fuse them */
  row('u-c1', '33333333', 'cara@qq.com', '2026-08-01T09:00:00Z'),
  row('u-c2', '33333999', 'cara@qq.com', '2026-08-12T09:00:00Z'),
  /* one person, two registrations with DIFFERENT e-mails — linked only by a
     simulation record whose ID matches one and whose e-mail the other */
  row('u-d1', '44444444', 'dan@x.ie', '2026-08-05T09:00:00Z'),
  row('u-d2', '44440000', 'dan2@x.ie', '2026-08-11T09:00:00Z'),
  /* matched by BOTH identities at once — ID must win, no double-stamp */
  row('u-e', '55555555', 'eve@x.ie', '2026-08-10T11:00:00Z'),
  /* the owner's canonical fast-play pattern: gina rushed through under her
     FIRST registration (the record's own ID pins the play to it), then
     re-registered with a corrected ID to play properly */
  row('u-g1', '12121212', 'gina@x.ie', '2026-08-02T09:00:00Z'),
  row('u-g2', '12129999', 'gina@x.ie', '2026-08-13T09:00:00Z'),
  /* the pass-2 subtlety: the sim holds TWO records under one typo'd ID, and
     only the OLDER record's e-mail is the one the roster knows — doneById
     keeps the newest record per ID, so that address survives only in
     doneByEmail and must still find fred */
  row('u-f', '88888888', 'fred@x.ie', '2026-08-10T12:00:00Z'),
];
const groups = C.groupByStudent(ROWS);

const markBob = { ts: 6, session: 'S1', id: '99999999', email: 'bob@x.ie', dur: 0 };
const markDan = { ts: 8, session: 'S1', id: '44444444', email: 'dan2@x.ie', dur: 0 };
const markEve = { ts: 3, session: 'S1', id: '55555555', email: 'eve@x.ie', dur: 0 };
const doneById = {
  '11111111': { ts: 5, session: 'S1', id: '11111111', email: '', dur: 0 },
  '99999999': markBob,          // ID typo — its e-mail still identifies bob
  '77777777': { ts: 7, session: 'S1', id: '77777777', email: '', dur: 0 },   // true stranger
  '44444444': markDan,
  '55555555': markEve,
  /* gina's FIRST registration played — 1 minute, pinned by its own ID */
  '12121212': { ts: 10, session: 'S1', id: '12121212', email: 'gina@x.ie', dur: 60 * 1000 },
  /* fred's typo'd ID: the NEWEST of his two records has an e-mail nobody on
     the roster carries — the older record's address (below) must rescue him */
  '80808080': { ts: 12, session: 'S1', id: '80808080', email: 'unknown@else.ie', dur: 0 },
};
const doneByEmail = {
  'bob@x.ie': markBob,
  'dan2@x.ie': markDan,
  'eve@x.ie': markEve,
  /* an e-mail-only record (no student ID anywhere) — a SUPER FAST play */
  'cara@qq.com': { ts: 9, session: 'S1', id: '', email: 'cara@qq.com', dur: 2 * 60 * 1000 },
  'unknown@else.ie': { ts: 12, session: 'S1', id: '80808080', email: 'unknown@else.ie', dur: 0 },
  'fred@x.ie': { ts: 4, session: 'S1', id: '80808080', email: 'fred@x.ie', dur: 0 },
};

/* --- the two-pass join ---------------------------------------------------- */
console.log('\nJoin (ID and/or e-mail)');
const j = M.joinRecords(groups, doneById, doneByEmail);
ok(!!j.matched['11111111'] && j.via['11111111'] === 'id', 'a plain student-ID match still works');
ok(!!j.matched['22222222'] && j.via['22222222'] === 'email',
   'THE FIX: an ID typed differently in the two forms is rescued by the record’s e-mail');
ok(j.unmatched.length === 1 && j.unmatched[0] === '77777777',
   'a rescued ID is NOT reported as “not in this roster” — only the true stranger is');
ok(!!j.matched['33333999'] && j.matched['33333999'].dur === 120000,
   'an e-mail-only record matches, and stamps the most recently active of the rows sharing the address');
ok(!j.matched['33333333'], 'the OLDER row sharing that address is not silently stamped too');
ok(j.via['55555555'] === 'id', 'a record carrying both identities matches by ID (never counted twice)');
ok(!!j.matched['88888888'] && j.via['88888888'] === 'email',
   'with several records under one typo’d ID, an OLDER record’s address still rescues the student ' +
   '(doneById keeps only the newest record — pass 2 must not skip an unmatched ID’s other addresses)');
ok(j.unmatched.indexOf('80808080') < 0, 'that rescued ID is not reported as a stranger either');
ok(!j.matched['66666666'] && Object.keys(j.matched).length === 7,
   'exactly the seven expected students match — no invented matches');
const linkSigs = j.links.map(l => l.slice().sort().join('|')).sort();
ok(linkSigs.length === 2 && linkSigs.indexOf('44440000|44444444') >= 0 &&
   linkSigs.indexOf('12121212|12129999') >= 0,
   'a record answering to TWO roster rows (ID→one, e-mail→the other) is reported as duplicate evidence');

/* Different students never fuse, however the maps arrive. */
{
  const j2 = M.joinRecords(groups, { '11111111': doneById['11111111'] }, {});
  ok(Object.keys(j2.matched).length === 1, 'a single-record read matches a single student');
}

/* --- duplicate clusters --------------------------------------------------- */
console.log('\nDuplicate registrations');
const clusters = M.findDuplicateClusters(groups, j, { isDone: C.isDone, simTitle: 'TestSim' });
ok(clusters.length === 3, 'three duplicate clusters found (two shared e-mails; one sim-record link)');
const byKeys = c => c.entries.map(e => e.key).sort().join('|');
const cCara = clusters.find(c => byKeys(c) === '33333333|33333999');
const cDan = clusters.find(c => byKeys(c) === '44440000|44444444');
const cGina = clusters.find(c => byKeys(c) === '12121212|12129999');
ok(!!cCara, 'the same-e-mail pair clusters together');
ok(!!cDan, 'the sim-linked pair clusters together');
ok(!!cGina, 'the fast-then-re-register pair clusters together');

/* gina: her 1-minute play is pinned to her FIRST registration by the
   record's own student ID → THAT profile is the suggested removal and the
   fresh registration is kept for the proper play (the owner's pattern). */
{
  const fast = cGina.entries.find(e => e.key === '12121212');
  const fresh = cGina.entries.find(e => e.key === '12129999');
  ok(fast.role === 'fast' && fast.attributed === true && fast.suggest === true,
     'an ID-attributed 1-minute play is judged super fast and suggested for removal');
  ok(/super fast/.test(fast.why) && /1 min/.test(fast.evidence),
     'the suggestion says WHY, with the duration');
  ok(fresh.role === 'registered' && fresh.suggest === false,
     'the fresh registration is kept so the student can play properly');
}
/* cara: her super-fast play matched by E-MAIL ALONE — the shared address
   cannot pin it to either profile (its placement on the newest row is only
   the join's newest-pick), so the NEWEST registration (the one the student
   is using) is kept and the older duplicate is the suggested removal. */
{
  const marked = cCara.entries.find(e => e.key === '33333999');
  const older = cCara.entries.find(e => e.key === '33333333');
  ok(marked.role === 'fast' && marked.attributed === false && marked.suggest === false,
     'an e-mail-only fast play cannot be pinned to a profile — the newest registration is kept');
  ok(older.suggest === true && /cannot be pinned/.test(older.why),
     'the OLDER duplicate is the suggested removal, and the why says the play was super fast');
}
/* dan: one row completed (duration unknown → proper), the other only
   registered → the registered-only profile is the suggested removal (the
   owner's first pattern). */
{
  const played = cDan.entries.find(e => e.key === '44444444');
  const regd = cDan.entries.find(e => e.key === '44440000');
  ok(played.role === 'played' && played.suggest === false, 'the profile carrying the play is kept');
  ok(regd.role === 'registered' && regd.suggest === true &&
     /never played/.test(regd.why),
     'the profile that only registered is the suggested removal');
}
ok(clusters.every(c => c.entries.some(e => !e.suggest)),
   'a suggestion NEVER covers a whole cluster (something is always kept)');

/* --- the suggestion rules, in isolation ----------------------------------- */
console.log('\nSuggestion rules');
const g0 = k => groups[k];
const E = (key, role) => ({ key, group: g0(key) || { rows: [{ updatedAt: '2026-08-0' + (1 + (key.length % 8)) }] }, role });
{
  const out = M.suggestRemovals([E('11111111', 'played'), E('22222222', 'played')]);
  ok(out.length === 0, 'two proper plays: genuinely ambiguous — NO suggestion, the admin decides');
}
{
  const out = M.suggestRemovals([E('11111111', 'played'), E('22222222', 'fast')]);
  ok(out.length === 1 && out[0].key === '22222222', 'proper play beside a fast play: the fast one goes');
}
{
  const out = M.suggestRemovals([E('33333333', 'fast'), E('44444444', 'fast')]);
  ok(out.length === 0, 'two fast plays and nothing else: ambiguous — no suggestion');
}
{
  const out = M.suggestRemovals([
    { key: 'old', role: 'registered', group: { rows: [{ updatedAt: '2026-08-01T00:00:00Z' }] } },
    { key: 'new', role: 'registered', group: { rows: [{ updatedAt: '2026-08-12T00:00:00Z' }] } },
  ]);
  ok(out.length === 1 && out[0].key === 'old',
     'two registered-only rows: keep the newest (the one the student is using), suggest the older');
}
/* An UNATTRIBUTED fast play (e-mail-only match) beside a registered-only row:
   the play cannot be pinned to either profile, so the NEWEST registration is
   kept whichever row carries the mark. */
{
  const out = M.suggestRemovals([
    { key: 'newest-fast', role: 'fast', attributed: false,
      group: { rows: [{ updatedAt: '2026-08-12T00:00:00Z' }] } },
    { key: 'older-reg', role: 'registered',
      group: { rows: [{ updatedAt: '2026-08-01T00:00:00Z' }] } },
  ]);
  ok(out.length === 1 && out[0].key === 'older-reg',
     'an unattributed fast play never dooms the newest registration — the older duplicate is suggested');
}

/* --- the differing-names caution ---------------------------------------- */
console.log('\nDiffering-names caution');
{
  /* Two REAL students sharing a family mailbox must not get pre-ticked
     removals — the caution clears every suggestion and says why. */
  const sibs = C.groupByStudent([
    row('u-s1', '70000001', 'family@qq.com', '2026-08-01T00:00:00Z', {}, 'Ann Chen'),
    row('u-s2', '70000002', 'family@qq.com', '2026-08-10T00:00:00Z', {}, 'Bob Doyle'),
  ]);
  const jj = M.joinRecords(sibs, { '70000001': { ts: 1, session: null, id: '70000001', email: '', dur: 0 } }, {});
  const cs = M.findDuplicateClusters(sibs, jj, { isDone: C.isDone, simTitle: 'TestSim' });
  ok(cs.length === 1 && !!cs[0].caution && cs[0].entries.every(e => !e.suggest),
     'two rows whose names share nothing keep NO pre-ticks and carry a caution');
}
{
  /* The same person under a re-ordered / re-cased name keeps the suggestion. */
  const same = C.groupByStudent([
    row('u-t1', '70000003', 'tao@qq.com', '2026-08-01T00:00:00Z', {}, 'Qiu Taoyi'),
    row('u-t2', '70000004', 'tao@qq.com', '2026-08-10T00:00:00Z', {}, 'TAOYI QIU'),
  ]);
  const jj = M.joinRecords(same, { '70000003': { ts: 1, session: null, id: '70000003', email: '', dur: 0 } }, {});
  const cs = M.findDuplicateClusters(same, jj, { isDone: C.isDone, simTitle: 'TestSim' });
  ok(cs.length === 1 && !cs[0].caution && cs[0].entries.some(e => e.suggest),
     'a re-ordered/re-cased same name raises no caution — the suggestion stands');
}
ok(M.nameTokens({ rows: [{ name: '' }] }).length === 0,
   'a missing name stays neutral (no tokens, no caution from it)');

/* A ✓ on ANOTHER simulation still counts as having played — such a profile
   is never a "registered only" removal candidate. */
{
  const gDone = C.groupByStudent([row('u-z', '66666666', 'z@x.ie', '2026-08-10T00:00:00Z',
    { portfoliofit: { ts: 4, session: 'X' } })])['66666666'];
  ok(M.roleOf(gDone, null, C.isDone, M.FAST_PLAY_MS) === 'played',
     'a roster ✓ for another simulation protects a profile from the registered-only suggestion');
  const gTomb = C.groupByStudent([row('u-y', '66666667', 'y@x.ie', '2026-08-10T00:00:00Z',
    { portfoliofit: { revoked: 1, rts: 9 } })])['66666667'];
  ok(M.roleOf(gTomb, null, C.isDone, M.FAST_PLAY_MS) === 'registered',
     'a revoked ✓ (tombstone) does not — the student no longer counts as having played it');
}

/* --- wiring --------------------------------------------------------------- */
console.log('\nWiring');
const adminHtml = readFileSync(join(SIM, 'admin', 'index.html'), 'utf8');
ok(/match\.js/.test(adminHtml), 'the admin page loads match.js');
ok(adminHtml.indexOf('match.js') < adminHtml.indexOf('./admin.js'),
   'it loads BEFORE admin.js');
const adminSrc = readFileSync(join(SIM, 'admin', 'admin.js'), 'utf8');
ok(/window\.SIMP_MATCH/.test(adminSrc), 'admin.js reads SIMP_MATCH');
ok(/joinRecords\(groups, doneById, doneByEmail\)/.test(adminSrc),
   'the reconciliation joins by ID and/or e-mail through match.js');
ok(/findDuplicateClusters/.test(adminSrc) && /showDuplicatesDialog/.test(adminSrc),
   'duplicates are clustered and raised in the pop-up dialog');
ok(/maybeAutoVerify/.test(adminSrc) && /opts\.auto/.test(adminSrc),
   'the unattended verification pass exists');
ok(/if \(opts && opts\.auto\) return null;/.test(adminSrc),
   'the unattended pass can NEVER pop a password prompt (sharedCreds declines without the locker)');
ok(/if \(opts\.auto && revokes\.length\)/.test(adminSrc),
   'the unattended pass never revokes — removals stay behind the button’s confirm');
ok(/opts\.auto && cur && cur\.revoked/.test(adminSrc),
   'the unattended pass never re-stamps over a ✓ the instructor removed (unless the play post-dates the removal)');
ok(/inDupCluster\[k\]/.test(adminSrc),
   'a ✓ on a possible duplicate row is never proposed for removal — the pop-up owns that decision');
ok(/unmatched\.length \|\| idJoinDegraded/.test(adminSrc),
   'a mass removal is also refused when the records carry no student IDs at all (degraded ID join)');
ok(/verifyBusy/.test(adminSrc) && /if \(verifyBusy\) return;/.test(adminSrc),
   'one verification at a time — a button click cannot race the unattended chain');
ok(/c\.caution/.test(adminSrc),
   'the dialog shows the differing-names caution');
ok(/dupeQueue/.test(adminSrc),
   'a second simulation’s duplicates are QUEUED behind an open dialog, never replacing it mid-decision');
ok(!/style\.cssText = '[^']*inset:/.test(adminSrc),
   'the overlay uses long-hand offsets, not the inset shorthand (browser-compat rule)');
ok(/deleteStudents/.test(adminSrc.slice(adminSrc.indexOf('function showDuplicatesDialog'),
                                        adminSrc.indexOf('function maybeAutoVerify'))),
   'the dialog deletes through the same admin delete as the row button');
ok(/doneByEmail/.test(verifySrc), 'the adapters report the e-mail identity map');
ok(/emailInAnswers\(x\.registration \|\| x\.answers\)/.test(verifySrc),
   'the Answer Arena adapter scans the intake answers under their REAL field (participant.registration)');

console.log('\n' + (fails ? '✗ ' + fails + ' of ' + checks + ' checks FAILED'
                          : '✓ all ' + checks + ' checks passed'));
process.exit(fails ? 1 : 0);
