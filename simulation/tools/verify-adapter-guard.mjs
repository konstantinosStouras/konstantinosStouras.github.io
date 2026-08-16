/* Simulation Platform — offline BEHAVIOUR guard for the Ideation Challenge
   verify adapter (admin/verify.js). verify-guard.mjs checks the catalog ↔
   adapter WIRING; this one runs the adapter itself against a mocked Firestore
   and pins the rules that decide who gets a roster ✓:

     · a platform launch's participant matches on platform.studentId (and it
       always beats a differently-typed registration answer);
     · a DIRECT-LINK play (no platform block — sessions SGP2/SGP3/ATHENS,
       owner 2026-08) matches on the student ID typed into the session's OWN
       registration form: the default form's `ucdStudentId`, or any
       admin-added field whose label names a Student/Participant ID
       (registrationConfig), incl. a session with NO registrationConfig at
       all, which runs the default form;
     · "finished" is unchanged: status done / a stored survey, or — in a
       CLOSED session only — demonstrable participation (an authored idea or
       a cast vote), never idle attendance;
     · the ideas collection is read ONLY for closed sessions;
     · a participant with no student ID anywhere is skipped, not guessed —
       UNLESS a real e-mail identifies them (owner 2026-08-16: the roster
       join is student ID AND/OR e-mail), in which case they are reported in
       doneByEmail; the synthetic @simplatform throwaway logins never count
       as an identity, and marks carry the record's id/email/duration so
       admin/match.js can cross-join and judge a "super fast" play;
     · identityDocs REPORTS (read-only) every matched record still carrying
       the throwaway login's placeholders — finished or NOT (a name is a
       name) — so admin.js can fill the roster's real name/e-mail back onto
       them; a record already carrying real details is not reported.

   Run: node simulation/tools/verify-adapter-guard.mjs
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
vm.runInContext(readFileSync(join(SIM, 'admin', 'verify.js'), 'utf8'), sandbox,
  { filename: 'verify.js' });
const ADAPTERS = sandbox.window.SIMP_VERIFY;

/* ── Fixture: three sessions of one instructor ────────────────────────────── */
const UID = 'instructor-1';

const SESSIONS = [
  { id: 's1', code: 'sgp2', status: 'survey',            // OPEN
    registrationConfig: { fields: [
      { id: 'ucdStudentId', label: 'UCD Student ID' },
      { id: 'f_nm', label: 'Full Name' },
      { id: 'f_mail', label: 'E-mail address' },         // admin-added, label-matched
    ] } },
  { id: 's2', code: 'athens', status: 'done',            // CLOSED
    registrationConfig: { fields: [
      { id: 'f_x1', label: 'University Student ID' },    // admin-added, label-matched
    ] } },
  { id: 's3', code: 'legacy', status: 'survey' },        // no registrationConfig → default form
];

const PARTICIPANTS = {
  s1: [
    // platform launch, finished — carries its real identity in full, so the
    // backfill report must NOT list it (only the doc e-mail stays synthetic
    // by design of the throwaway login, and that IS reported)
    { id: 'pA', status: 'done', name: 'Anna Platform',
      email: 'student-aa11@simplatform.stouras.com',
      platform: { studentId: '11111111', name: 'Anna Platform',
                  email: 'anna@ucd.ie', source: 'simulation-platform' } },
    // direct link, finished (stored survey), ID typed into the form
    { id: 'pB', status: 'survey', surveyAnswers: { q: 1 },
      demographics: { ucdStudentId: '22222222', f_nm: 'Qi YuHao' } },
    // direct link, NOT finished, open session → no ✓
    { id: 'pC', status: 'individual', demographics: { ucdStudentId: '33333333' } },
    // finished but no student ID anywhere → skipped
    { id: 'pD', status: 'done', demographics: { f_nm: 'No Id Given' } },
    // both sources present → the platform's ID wins
    { id: 'pI', status: 'done', platform: { studentId: '99999999' },
      demographics: { ucdStudentId: '88888888' } },
    // direct link, finished, NO student ID anywhere — but a real e-mail typed
    // into an admin-added registration field identifies them (doneByEmail)
    { id: 'pJ', status: 'survey', surveyAnswers: { q: 2 },
      demographics: { f_mail: 'yu.hao@example.com' } },
    // an e-mail-shaped value in a field NOT labelled e-mail (a name field,
    // say) must never become the identity
    { id: 'pK', status: 'done',
      demographics: { ucdStudentId: '10101010', f_nm: 'stray@else.com' } },
  ],
  s2: [
    // closed session: a cast vote is demonstrable participation
    { id: 'pE', status: 'group', votedFor: ['i1'], votedAt: 1755300000000,
      demographics: { f_x1: '44444444' } },
    // closed session: idled — nothing authored, nothing voted → no ✓
    { id: 'pF', status: 'group', demographics: { f_x1: '55555555' } },
    // closed session: authored an idea (read from the ideas collection)
    { id: 'pG', status: 'individual', demographics: { f_x1: '66666666' } },
  ],
  s3: [
    // default form (no registrationConfig on the session doc); joinedAt +
    // surveyCompletedAt give the play DURATION (2 min here)
    { id: 'pH', status: 'survey', surveyCompletedAt: 1755300000000,
      joinedAt: 1755299880000,
      demographics: { ucdStudentId: '77777777' } },
  ],
};

const IDEAS = { s2: [{ id: 'i9', authorId: 'pG' }] };

/* ── Minimal Firestore mock (only what the adapter calls) ─────────────────── */
const ideasReads = [];
function snap(docs) {
  return {
    size: docs.length,
    forEach(fn) { docs.forEach(d => fn({ id: d.id, data: () => d })); },
  };
}
const D = {
  collection: (fs, ...path) => ({ path }),
  where: (f, op, v) => ({ f, op, v }),
  query: (col, ...clauses) => ({ col, clauses }),
  limit: n => ({ limit: n }),
  getDocs: q => {
    const col = q.col || q;                     // query(col, …) or bare collection
    const [root, sid, sub] = col.path;
    if (root === 'sessions' && !sid) {
      const w = (q.clauses || []).find(c => c.f === 'instructorId');
      if (!w || w.v !== UID) return Promise.resolve(snap([]));
      return Promise.resolve(snap(SESSIONS));
    }
    if (root === 'sessions' && sub === 'participants') {
      return Promise.resolve(snap(PARTICIPANTS[sid] || []));
    }
    if (root === 'sessions' && sub === 'ideas') {
      ideasReads.push(sid);
      return Promise.resolve(snap(IDEAS[sid] || []));
    }
    return Promise.resolve(snap([]));
  },
};

console.log('Simulation Platform — Ideation Challenge verify-adapter guard\n');

const result = await ADAPTERS.ideasearchlab({ D, fs: {}, uid: UID, sim: { key: 'ideasearchlab' } });
const done = result.doneById;
const ids = Object.keys(done).sort();

ok(result.records === 11, 'reads every participant record (records = 11, got ' + result.records + ')');

ok(!!done['11111111'], 'platform-launched finisher matches on platform.studentId');
ok(!!done['22222222'], 'direct-link finisher matches on the typed ucdStudentId (stored survey)');
ok(done['22222222'] && done['22222222'].session === 'SGP2',
   'the ✓ carries the session code it was earned in (SGP2)');
ok(!done['33333333'], 'an unfinished participant in an OPEN session earns no ✓');
ok(!done['88888888'] && !!done['99999999'],
   'when both sources exist the platform ID wins (no phantom second identity)');
ok(!!done['44444444'], 'CLOSED session: a cast vote counts as participation');
ok(!done['55555555'], 'CLOSED session: idle attendance never earns a ✓');
ok(!!done['66666666'], 'CLOSED session: an authored idea counts as participation');
ok(!!done['77777777'], 'a session with NO registrationConfig falls back to the default form’s ucdStudentId');
ok(!ids.includes(''), 'no empty-string identity ever enters the map');
ok(ids.length === 7, 'exactly the seven expected students match (got ' + ids.length + ': ' + ids.join(', ') + ')');

ok(ideasReads.length === 1 && ideasReads[0] === 's2',
   'the ideas collection is read ONLY for the closed session');

/* ── The e-mail identity map (owner 2026-08-16: join on ID and/or e-mail) ── */
const byEm = result.doneByEmail || {};
ok(byEm['anna@ucd.ie'] && byEm['anna@ucd.ie'].id === '11111111',
   'a platform launch’s real handoff e-mail joins doneByEmail, carrying its record’s student ID');
ok(!Object.keys(byEm).some(k => /@simplatform\.stouras\.com$/.test(k)),
   'the synthetic throwaway login address is NEVER an identity');
ok(byEm['yu.hao@example.com'] && byEm['yu.hao@example.com'].id === '',
   'an ID-less finisher is still reported through the e-mail typed into a registration field');
ok(!ids.includes('') && ids.length === 7,
   'the ID-less e-mail-only finisher never enters doneById');
ok(done['10101010'] && done['10101010'].email === '' && !byEm['stray@else.com'],
   'an e-mail-shaped value in a field NOT labelled e-mail (a name field) is never adopted as the identity');
ok(done['11111111'].email === 'anna@ucd.ie' && done['11111111'].id === '11111111',
   'marks carry BOTH identities, so match.js can cross-join and spot duplicates');
ok(done['77777777'].dur === 120000,
   'joined→survey span is reported as the play duration (2 min)');
ok(done['22222222'].dur === 0,
   'a record with no joinedAt reports duration 0 (unknown), never a guess');

/* ── The identity-backfill report ─────────────────────────────────────────── */
const idn = result.identityDocs || {};
ok(Array.isArray(idn['22222222']) && idn['22222222'][0].needName === true &&
   idn['22222222'][0].needEmail === true && idn['22222222'][0].sid === 's1' &&
   idn['22222222'][0].uid === 'pB',
   'a direct-link record with no name/e-mail is reported for the roster backfill (sid+uid carried)');
ok(Array.isArray(idn['33333333']) && idn['33333333'][0].needName === true,
   'an UNFINISHED matched student is reported too — a name is a name');
ok(idn['11111111'] && idn['11111111'][0].needName === false &&
   idn['11111111'][0].needPlatName === false && idn['11111111'][0].needPlatEmail === false &&
   idn['11111111'][0].needEmail === true && idn['11111111'][0].needPlatSource === false,
   'a platform-launched record is reported ONLY for its synthetic doc e-mail — real fields are never fill targets, and its handoff source is kept');
ok(Object.keys(idn).every(k => (idn[k] || []).every(t => t.sid && t.uid)),
   'every report entry names the exact doc to write (sid + uid)');

/* ── Answer Arena adapter: the e-mail leg reads the REAL field ────────────── */
console.log('\nAnswer Arena');
const ARENA_P = [
  // intake answers live under participant.registration (finishRegister in
  // arena-app.js) — an admin-added e-mail question lands there
  { id: 'a1', participantId: 'AA100', status: 'done', updatedAt: 1755300000000,
    createdAt: 1755299000000, completedSessions: { s9: 1755300000000 },
    registration: { q_mail: 'lena@ucd.ie', q_age: '18-24' } },
  // TWO different addresses in one intake → ambiguous, neither adopted; with
  // no participantId either, the record enters neither map
  { id: 'a2', participantId: '', status: 'done', updatedAt: 1755300000000,
    createdAt: 1755299000000, completedSessions: {},
    registration: { q1: 'x@y.ie', q2: 'other@z.ie' } },
];
const AD = {
  collection: (fs, name) => ({ path: [name] }),
  getDocs: col => Promise.resolve(snap(col.path[0] === 'participants' ? ARENA_P : [])),
};
const arena = await ADAPTERS.answerarena({ D: AD, fs: {}, uid: UID, sim: { key: 'answerarena' } });
ok(arena.records === 2, 'arena: reads every participant record');
ok(!!arena.doneById['aa100'], 'arena: the intake student ID still matches (folded)');
ok(arena.doneByEmail && arena.doneByEmail['lena@ucd.ie'] &&
   arena.doneByEmail['lena@ucd.ie'].id === 'aa100',
   'arena: an address typed into the intake (participant.registration) joins doneByEmail');
ok(arena.doneByEmail['lena@ucd.ie'].dur === 1000000,
   'arena: createdAt→completion span is the play duration');
ok(!arena.doneByEmail['x@y.ie'] && !arena.doneByEmail['other@z.ie'],
   'arena: TWO different addresses in one intake are ambiguous — neither is adopted');
ok(!('' in arena.doneById) && Object.keys(arena.doneById).length === 1,
   'arena: the ID-less ambiguous record enters neither map');

/* ── PortfolioFit adapter: same e-mail + duration legs ────────────────────── */
console.log('\nPortfolioFit');
const PF_P = [
  { id: 'p1', status: 'done', studentId: 'PF100', updatedAt: 1755300000000,
    createdAt: 1755299000000, sessionId: 'abc', registration: { em: 'pf@ucd.ie' } },
  { id: 'p2', status: 'playing', studentId: 'PF200' },   // not done → excluded
];
const PD = { collection: (fs, name) => ({ path: [name] }),
             getDocs: () => Promise.resolve(snap(PF_P)) };
const pf = await ADAPTERS.portfoliofit({ D: PD, fs: {}, uid: UID, sim: { key: 'portfoliofit' } });
ok(pf.records === 2 && pf.doneById['pf100'] && pf.doneById['pf100'].session === 'ABC',
   'portfoliofit: a done player matches by studentId, session upper-cased');
ok(!pf.doneById['pf200'], 'portfoliofit: an unfinished player earns no ✓');
ok(pf.doneByEmail && pf.doneByEmail['pf@ucd.ie'] && pf.doneByEmail['pf@ucd.ie'].id === 'pf100',
   'portfoliofit: an address in an admin-added registration question joins doneByEmail');
ok(pf.doneByEmail['pf@ucd.ie'].dur === 1000000,
   'portfoliofit: createdAt→updatedAt span is the play duration');

console.log('\n' + (fails ? 'GUARD FAILED — ' + fails + ' of ' + checks + ' checks'
                          : 'GUARD OK — ' + checks + ' checks'));
process.exit(fails ? 1 : 0);
