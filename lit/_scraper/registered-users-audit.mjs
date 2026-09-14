#!/usr/bin/env node
/*
 * The Lit — registered-users reconcile (tally + roster vs Firebase Auth)
 * =======================================================================
 *
 * Two places say how many people have registered on The Lit, and they are fed
 * by two different browser writes:
 *
 *   registeredUsers/{uid}   the PUBLIC, contentless marker the "Registered
 *                           users" tile on stouras.com/lit/analytics/ counts —
 *                           written by lit/index.html on every signed-in visit
 *                           since the tally shipped;
 *   userDirectory/{uid}     the maintainer-only roster row (name, address,
 *                           first/last seen) the Feedback page lists — written
 *                           on a signed-in visit since the roster shipped
 *                           (2026-08-24), i.e. LATER than the tally.
 *
 * So an account that signed in between the two launches and has not been back
 * has a marker and no row, and the two figures disagree: the tile read 4 while
 * the roster listed 2 (owner report, 2026-09-14). Neither browser write can
 * close that gap — a row is only ever written by its own account, and nothing
 * happens until that person signs in again.
 *
 * Only the Admin SDK can see the whole truth: Firebase Auth's own list of
 * accounts, with each one's address, display name, creation and last sign-in
 * time. This job reads it and makes BOTH collections agree with it:
 *
 *   1. REMOVALS, unchanged and conservative — a marker or a row whose uid Auth
 *      answers `auth/user-not-found` for (an account merged away as a duplicate,
 *      or deleted from the console; deleting a Firebase sign-in does not delete
 *      its Firestore data) is deleted. Any OTHER answer — a network blip, a
 *      throttle, a permissions problem — leaves the document exactly where it
 *      is. A count is only ever corrected downwards by a proven-gone account.
 *
 *   2. ADDITIONS — for every real (non-anonymous) account Auth lists: a missing
 *      marker is seeded, a missing roster row is created from the Auth record
 *      (address, display name, `first` = the account's creation time, `seen`
 *      = its last sign-in or its marker's timestamp, whichever is later), and
 *      an existing row is HEALED in the safe directions only: `first` can only
 *      move earlier (to the creation time — "First seen" then means what it
 *      says), `seen` only later, and `email`/`name` are filled only when empty
 *      — a name the account wrote about itself is never overwritten. Seeding
 *      comes from a full listing of Auth, and a listing that fails half-way can
 *      only seed LESS, never remove anything.
 *
 * After a run, tile == roster == the number of accounts in Firebase Auth, and
 * the Feedback page can say so. A browser sign-in still writes its own row at
 * once, so nothing here is on the path of a visit.
 *
 * Env / secrets (via the workflow):
 *   FIREBASE_SERVICE_ACCOUNT   JSON of a Firebase service-account key (or set
 *                              GOOGLE_APPLICATION_CREDENTIALS to a file path).
 *
 * Modes:
 *   node registered-users-audit.mjs             reconcile (writes Firestore)
 *   node registered-users-audit.mjs --dry-run   report what it would change
 *   node registered-users-audit.mjs --scan      alias of --dry-run
 *   node registered-users-audit.mjs --selftest  offline unit checks, no network
 *
 * A no-op until FIREBASE_SERVICE_ACCOUNT is set, so it never fails pre-setup.
 */

const ARGV = process.argv.slice(2);
const DRY_RUN  = ARGV.includes('--dry-run') || ARGV.includes('--scan');
const SELFTEST = ARGV.includes('--selftest');

/* ───────────────────────────── the pure half ─────────────────────────────── */

/**
 * Decide what a pass over one collection found, from the answers Auth gave.
 *
 * @param {string[]} uids     every document id
 * @param {Object} verdicts   uid -> 'live' | 'gone' | 'unknown'
 * @returns {{live:string[], gone:string[], unknown:string[], count:number}}
 *          `count` is what the collection SHOULD hold once the gone ones are
 *          removed: the accounts proved to exist plus the ones we could not
 *          check, since an unchecked document is never assumed dead.
 */
export function auditMarkers(uids, verdicts) {
  const live = [], gone = [], unknown = [];
  for (const uid of uids) {
    const v = (verdicts && verdicts[uid]) || 'unknown';
    if (v === 'live') live.push(uid);
    else if (v === 'gone') gone.push(uid);
    else unknown.push(uid);
  }
  return { live, gone, unknown, count: live.length + unknown.length };
}

/** Is this Admin-SDK error a definite "no such account"? Anything else is not. */
export function isUserNotFound(err) {
  return !!err && (err.code === 'auth/user-not-found'
                   || err.errorInfo && err.errorInfo.code === 'auth/user-not-found');
}

/** An RFC-2822 date string from Auth's metadata, or nothing. */
function msOf(s) {
  const n = Date.parse(String(s || ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise an Admin-SDK UserRecord to what the plan below needs.
 * ANONYMOUS = no sign-in provider at all. The presence feature signs visitors
 * in anonymously in this same project, and those are not registered users —
 * the main page never writes a marker or a row for them, and neither may this.
 */
export function accountOf(u) {
  const md = (u && u.metadata) || {};
  return {
    uid: String(u && u.uid || ''),
    anonymous: !(u && u.providerData && u.providerData.length),
    email: String(u && u.email || '').trim().slice(0, 200),
    name: String(u && u.displayName || '').trim().slice(0, 200),
    created: msOf(md.creationTime),
    lastSignIn: msOf(md.lastSignInTime),
  };
}

/**
 * What one roster row should become, given the account behind it.
 *
 * @param {Object|null} row      the stored userDirectory row, or null if none
 * @param {Object} acct          accountOf(...)
 * @param {number|null} markerT  the account's registeredUsers `t` in ms, if any
 * @param {number} now
 * @returns {Object|null}  the fields to write (a whole row when there was none,
 *                         a merge patch otherwise), or null when nothing changes.
 *
 * Only the SAFE directions: `first` only ever moves EARLIER (to the account's
 * creation time), `seen` only LATER, and `email`/`name` are filled only where
 * the row is empty. The browser is the authority on what an account calls
 * itself; Auth is the authority on when it was created.
 */
export function rowPatch(row, acct, markerT, now) {
  const seenCandidates = [acct.lastSignIn, markerT].filter((n) => typeof n === 'number');
  const seen = seenCandidates.length ? Math.max(...seenCandidates) : (acct.created || now);
  const first = acct.created || seen;
  if (!row) {
    const r = { name: acct.name, first, seen };
    if (acct.email) r.email = acct.email;
    return r;
  }
  const p = {};
  if (typeof row.first !== 'number' || (typeof acct.created === 'number' && acct.created < row.first)) p.first = first;
  if (typeof row.seen !== 'number' || seen > row.seen) p.seen = seen;
  if (!row.email && acct.email) p.email = acct.email;
  if (!row.name && acct.name) p.name = acct.name;
  return Object.keys(p).length ? p : null;
}

/**
 * The additive half of a run: what to seed and heal so that both collections
 * carry every real account Auth lists.
 *
 * @param {Object[]} accounts   accountOf(...) for every Auth user
 * @param {Object} markers      uid -> marker `t` in ms (or null) for every
 *                              registeredUsers document
 * @param {Object} rows         uid -> stored row for every userDirectory document
 * @param {number} now
 * @returns {{seedMarkers:{uid:string,t:number}[], createRows:{uid:string,data:Object}[],
 *            patchRows:{uid:string,data:Object}[], accounts:number, anonymous:number}}
 */
export function planReconcile(accounts, markers, rows, now) {
  const plan = { seedMarkers: [], createRows: [], patchRows: [], accounts: 0, anonymous: 0 };
  for (const a of accounts || []) {
    if (!a || !a.uid) continue;
    if (a.anonymous) { plan.anonymous++; continue; }
    plan.accounts++;
    const hasMarker = Object.prototype.hasOwnProperty.call(markers || {}, a.uid);
    const markerT = hasMarker && typeof markers[a.uid] === 'number' ? markers[a.uid] : null;
    if (!hasMarker) plan.seedMarkers.push({ uid: a.uid, t: a.lastSignIn || a.created || now });
    const row = (rows && rows[a.uid]) || null;
    const patch = rowPatch(row, a, markerT, now);
    if (patch) (row ? plan.patchRows : plan.createRows).push({ uid: a.uid, data: patch });
  }
  return plan;
}

/* ───────────────────────────────── selftest ──────────────────────────────── */

function selftest() {
  let n = 0, bad = 0;
  const ok = (cond, what) => { n++; if (!cond) { bad++; console.error('FAIL:', what); } };

  const r = auditMarkers(['a', 'b', 'c', 'd'],
                         { a: 'live', b: 'gone', c: 'unknown', d: 'live' });
  ok(r.live.join(',') === 'a,d', 'live accounts kept');
  ok(r.gone.join(',') === 'b', 'a deleted account is the only removal');
  ok(r.unknown.join(',') === 'c', 'an unchecked marker is reported, not removed');
  ok(r.count === 3, 'the corrected count keeps the unchecked marker');

  // A uid Auth was never asked about must never be treated as gone.
  const r2 = auditMarkers(['x', 'y'], {});
  ok(r2.gone.length === 0 && r2.count === 2, 'no verdicts at all removes nothing');

  // Nothing to do is a clean answer, not an empty tally.
  const r3 = auditMarkers([], { a: 'gone' });
  ok(r3.count === 0 && r3.gone.length === 0, 'an empty collection audits to nothing');

  ok(isUserNotFound({ code: 'auth/user-not-found' }), 'the code is recognised');
  ok(isUserNotFound({ errorInfo: { code: 'auth/user-not-found' } }), 'nested errorInfo too');
  ok(!isUserNotFound({ code: 'auth/internal-error' }), 'an internal error is NOT a missing user');
  ok(!isUserNotFound(null), 'no error is not a missing user');

  /* ── the reconcile ── */
  const NOW = Date.parse('2026-09-14T12:00:00Z');
  const rec = (uid, extra) => Object.assign({
    uid, email: uid + '@example.com', displayName: 'Name ' + uid,
    providerData: [{ providerId: 'password' }],
    metadata: { creationTime: 'Mon, 01 Jun 2026 10:00:00 GMT', lastSignInTime: 'Tue, 01 Sep 2026 10:00:00 GMT' },
  }, extra || {});
  const CREATED = Date.parse('Mon, 01 Jun 2026 10:00:00 GMT');
  const SIGNED  = Date.parse('Tue, 01 Sep 2026 10:00:00 GMT');

  const a = accountOf(rec('u1'));
  ok(a.uid === 'u1' && !a.anonymous && a.email === 'u1@example.com' && a.name === 'Name u1',
    'a UserRecord is normalised');
  ok(a.created === CREATED && a.lastSignIn === SIGNED, 'Auth’s RFC-2822 dates become ms');
  ok(accountOf(rec('anon', { providerData: [], email: undefined, displayName: undefined })).anonymous,
    'no sign-in provider = anonymous');
  ok(accountOf({ uid: 'bare' }).created === null, 'missing metadata is null, never NaN');

  // THE REPORTED CASE: four accounts, four markers, two rows. Both missing rows
  // are created from Auth; the two existing ones are left alone.
  const accounts = ['u1', 'u2', 'u3', 'u4'].map((u) => accountOf(rec(u)));
  const markers = { u1: SIGNED, u2: SIGNED, u3: SIGNED, u4: SIGNED };
  const rows = {
    u1: { name: 'Konstantinos Stouras', email: 'u1@example.com', first: CREATED, seen: SIGNED },
    u2: { name: 'Zuzanna', email: 'u2@example.com', first: CREATED, seen: SIGNED },
  };
  const p = planReconcile(accounts, markers, rows, NOW);
  ok(p.accounts === 4 && p.anonymous === 0, 'four real accounts counted');
  ok(p.seedMarkers.length === 0, 'every account already has its marker — none seeded');
  ok(p.createRows.map((x) => x.uid).join(',') === 'u3,u4',
    'THE FIX: the two accounts with no roster row get one');
  ok(p.patchRows.length === 0, 'the two rows the browser wrote are untouched');
  const u3 = p.createRows[0].data;
  ok(u3.email === 'u3@example.com' && u3.name === 'Name u3' && u3.first === CREATED && u3.seen === SIGNED,
    'a seeded row carries the Auth address, display name, creation and last sign-in');
  ok(Object.keys(u3).sort().join(',') === 'email,first,name,seen',
    'and exactly the four fields the rules allow — nothing the roster does not show');

  // The other gap: an account with a row but no marker (a tally that undercounts).
  const p2 = planReconcile([accountOf(rec('u9'))], {}, { u9: { name: 'x', email: 'u9@example.com', first: CREATED, seen: SIGNED } }, NOW);
  ok(p2.seedMarkers.length === 1 && p2.seedMarkers[0].uid === 'u9' && p2.seedMarkers[0].t === SIGNED,
    'a missing marker is seeded, stamped with the last sign-in');
  ok(p2.createRows.length === 0 && p2.patchRows.length === 0, 'its complete row is left alone');

  // Anonymous accounts (presence) are never registered users.
  const p3 = planReconcile([accountOf(rec('an', { providerData: [] }))], {}, {}, NOW);
  ok(p3.anonymous === 1 && p3.accounts === 0 && !p3.seedMarkers.length && !p3.createRows.length,
    'an anonymous account seeds nothing');

  // Healing goes in the safe directions only.
  const acct = accountOf(rec('h'));
  ok(rowPatch({ name: 'Me', email: 'h@example.com', first: CREATED, seen: SIGNED }, acct, null, NOW) === null,
    'a complete, current row: nothing to write');
  const later = rowPatch({ name: 'Me', email: 'h@example.com', first: SIGNED, seen: CREATED }, acct, null, NOW);
  ok(later && later.first === CREATED && later.seen === SIGNED && !('name' in later) && !('email' in later),
    '`first` moves EARLIER to the creation time and `seen` LATER to the sign-in — and nothing else');
  ok(rowPatch({ name: 'Me', email: 'h@example.com', first: CREATED - 5, seen: SIGNED + 5 }, acct, null, NOW) === null,
    'a row already earlier/later than Auth is never moved the other way');
  const filled = rowPatch({ name: '', first: CREATED, seen: SIGNED }, acct, null, NOW);
  ok(filled && filled.name === 'Name h' && filled.email === 'h@example.com',
    'an empty name and a missing address are filled from Auth');
  ok(rowPatch({ name: 'What I call myself', email: 'h@example.com', first: CREATED, seen: SIGNED },
       accountOf(rec('h', { displayName: 'Auth Name' })), null, NOW) === null,
    'a name the account wrote is NEVER overwritten by Auth’s display name');
  const viaMarker = rowPatch({ name: 'Me', email: 'h@example.com', first: CREATED, seen: SIGNED }, acct, SIGNED + 1000, NOW);
  ok(viaMarker && viaMarker.seen === SIGNED + 1000,
    'the marker’s timestamp counts as a sighting — it is written on every visit, ' +
    'where Auth’s last sign-in moves only on a fresh authentication');

  // An ORCID sign-in carries no e-mail claim: a row with a name and dates, no address.
  const orcid = rowPatch(null, accountOf(rec('o', { email: undefined, providerData: [{ providerId: 'oidc.orcid' }] })), null, NOW);
  ok(orcid && !('email' in orcid) && orcid.name === 'Name o' && orcid.first === CREATED,
    'no address in Auth = no email field, never an empty string');

  // No dates at all (should not happen): the row still says something true.
  const bare = rowPatch(null, accountOf({ uid: 'b', providerData: [{ providerId: 'password' }] }), null, NOW);
  ok(bare && bare.first === NOW && bare.seen === NOW, 'with no dates in Auth, first = seen = now');

  console.log(`registered-users-audit selftest: ${n - bad}/${n} checks passed.`);
  if (bad) process.exitCode = 1;
}

/* ──────────────────────────────── the run ────────────────────────────────── */

/** Firestore Timestamp | number | anything → ms or null. */
function tMillis(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v.toMillis === 'function') { try { return v.toMillis(); } catch (e) { return null; } }
  return null;
}

async function commitAll(db, ops) {
  // ≤500 writes per batch; 400 leaves headroom.
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    ops.slice(i, i + 400).forEach((fn) => fn(batch));
    await batch.commit();
  }
}

async function run() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Registered-users reconcile: no Firebase credentials configured — nothing to do. '
              + 'Add the FIREBASE_SERVICE_ACCOUNT secret to enable.');
    return;
  }

  const { default: admin } = await import('firebase-admin');
  if (!admin.apps.length) {
    const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (sa) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(sa)) });
    else admin.initializeApp();
  }
  const db = admin.firestore();
  const auth = admin.auth();

  let mSnap, rSnap;
  try {
    [mSnap, rSnap] = await Promise.all([
      db.collection('registeredUsers').get(),
      db.collection('userDirectory').get(),
    ]);
  } catch (e) {
    console.error('Registered-users reconcile: could not read the collections:', e && e.message);
    process.exitCode = 1; return;
  }
  const markers = {};
  mSnap.docs.forEach((d) => { markers[d.id] = tMillis((d.data() || {}).t); });
  const rows = {};
  rSnap.docs.forEach((d) => { rows[d.id] = d.data() || {}; });
  const markerUids = Object.keys(markers), rowUids = Object.keys(rows);
  console.log(`${markerUids.length} marker(s) in registeredUsers, ${rowUids.length} row(s) in userDirectory.`);

  /* 1. Removals — one definite answer per uid, exactly as before. */
  const verdicts = {};
  for (const uid of new Set([...markerUids, ...rowUids])) {
    try {
      await auth.getUser(uid);
      verdicts[uid] = 'live';
    } catch (e) {
      if (isUserNotFound(e)) verdicts[uid] = 'gone';
      else {
        verdicts[uid] = 'unknown';
        console.warn(`  could not check ${uid}: ${e && (e.code || e.message)} — left in place.`);
      }
    }
  }
  const mAudit = auditMarkers(markerUids, verdicts);
  const rAudit = auditMarkers(rowUids, verdicts);
  console.log(`  markers: ${mAudit.live.length} live, ${mAudit.gone.length} with no sign-in behind them`
            + (mAudit.unknown.length ? `, ${mAudit.unknown.length} unchecked` : '') + '.');
  console.log(`  rows:    ${rAudit.live.length} live, ${rAudit.gone.length} with no sign-in behind them`
            + (rAudit.unknown.length ? `, ${rAudit.unknown.length} unchecked` : '') + '.');

  /* 2. Additions — every account Auth lists. A listing that fails half-way
        seeds only what it managed to list; it can never remove anything. */
  const accounts = [];
  let listedAll = true;
  try {
    let token;
    do {
      const page = await auth.listUsers(1000, token);
      page.users.forEach((u) => accounts.push(accountOf(u)));
      token = page.pageToken;
    } while (token);
  } catch (e) {
    listedAll = false;
    console.warn(`  could not list every account: ${e && (e.code || e.message)} — seeding only from the ${accounts.length} listed.`);
  }
  const plan = planReconcile(accounts, markers, rows, Date.now());
  console.log(`Firebase Auth lists ${plan.accounts} registered account(s)`
            + (plan.anonymous ? ` (+ ${plan.anonymous} anonymous, not counted)` : '')
            + (listedAll ? '.' : ' — listing incomplete.'));
  console.log(`  to seed: ${plan.seedMarkers.length} marker(s); to create: ${plan.createRows.length} roster row(s); `
            + `to heal: ${plan.patchRows.length} row(s).`);
  plan.createRows.forEach((w) => console.log(`    + row ${w.uid}: ${w.data.email || '(no address)'} · first ${new Date(w.data.first).toISOString().slice(0, 10)} · seen ${new Date(w.data.seen).toISOString().slice(0, 10)}`));
  plan.patchRows.forEach((w) => console.log(`    ~ row ${w.uid}: ${Object.keys(w.data).join(', ')}`));
  plan.seedMarkers.forEach((w) => console.log(`    + marker ${w.uid}`));

  const tileAfter = mAudit.count + plan.seedMarkers.length;
  const rosterAfter = rAudit.count + plan.createRows.length;
  const nothing = !mAudit.gone.length && !rAudit.gone.length && !plan.seedMarkers.length
               && !plan.createRows.length && !plan.patchRows.length;
  if (nothing) {
    console.log(`Nothing to change. The tile reads ${tileAfter}; the roster lists ${rosterAfter}.`);
    return;
  }
  if (DRY_RUN) {
    if (mAudit.gone.length) console.log('Dry run — would delete markers: ' + mAudit.gone.join(', '));
    if (rAudit.gone.length) console.log('Dry run — would delete rows: ' + rAudit.gone.join(', '));
    console.log(`Dry run — the tile would then read ${tileAfter} and the roster list ${rosterAfter}.`);
    return;
  }

  const ops = [];
  mAudit.gone.forEach((uid) => ops.push((b) => b.delete(db.collection('registeredUsers').doc(uid))));
  rAudit.gone.forEach((uid) => ops.push((b) => b.delete(db.collection('userDirectory').doc(uid))));
  plan.seedMarkers.forEach((w) => ops.push((b) => b.set(db.collection('registeredUsers').doc(w.uid),
    { t: admin.firestore.Timestamp.fromMillis(w.t) }, { merge: true })));
  plan.createRows.forEach((w) => ops.push((b) => b.set(db.collection('userDirectory').doc(w.uid), w.data)));
  plan.patchRows.forEach((w) => ops.push((b) => b.set(db.collection('userDirectory').doc(w.uid), w.data, { merge: true })));
  try {
    await commitAll(db, ops);
  } catch (e) {
    console.error('  a write failed:', e && e.message, '— re-run; every step is idempotent.');
    process.exitCode = 1; return;
  }
  console.log(`Done: removed ${mAudit.gone.length} marker(s) + ${rAudit.gone.length} row(s); `
            + `seeded ${plan.seedMarkers.length} marker(s); created ${plan.createRows.length} and healed ${plan.patchRows.length} row(s). `
            + `The tile now reads ${tileAfter}; the roster lists ${rosterAfter}.`);
}

if (SELFTEST) selftest();
else run().catch((e) => { console.error(e); process.exitCode = 1; });
