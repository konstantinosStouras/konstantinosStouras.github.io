#!/usr/bin/env node
/*
 * The Lit — registered-users tally audit
 * ======================================
 *
 * The "Registered users" tile on stouras.com/lit/analytics/ counts the public
 * `registeredUsers` collection: one contentless marker document per account
 * (just a coarse `t` timestamp — see lit/index.html and lit/_firestore.rules).
 * Counting DOCUMENTS is only the same as counting PEOPLE while every marker
 * still has a sign-in behind it, and two things break that:
 *
 *   1. the duplicate-account MERGE deletes the account it merges away, and
 *      deleting a Firebase sign-in does not delete its Firestore data — so the
 *      merged-away account's marker survived and one person went on being
 *      counted as two;
 *   2. an account deleted from the Firebase console leaves its marker behind
 *      for the same reason.
 *
 * The page half of the fix retires the marker during a merge (and the rules now
 * let the OWNER delete their own). This job is the other half: it is the only
 * place that can see whether a uid still exists in Firebase Auth, and it is
 * what repairs the markers left by merges that happened BEFORE that fix. It
 * reads every marker, asks Auth about each uid with the Admin SDK, and DELETES
 * the ones whose account is gone (`auth/user-not-found`).
 *
 * It is deliberately conservative: a uid is removed only on a definite
 * "this user does not exist" from Auth. Any other error — a network blip, a
 * throttle, a permissions problem — leaves the marker exactly where it is, so
 * the worst a bad run can do is nothing at all. The tally can only ever be
 * corrected downwards by a proven-gone account, never by a failure to look.
 *
 * Env / secrets (via the workflow):
 *   FIREBASE_SERVICE_ACCOUNT   JSON of a Firebase service-account key (or set
 *                              GOOGLE_APPLICATION_CREDENTIALS to a file path).
 *
 * Modes:
 *   node registered-users-audit.mjs             delete the orphaned markers
 *   node registered-users-audit.mjs --dry-run   report what it would delete
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
 * Decide what a pass over the markers found, from the answers Auth gave.
 *
 * @param {string[]} uids     every marker document id
 * @param {Object} verdicts   uid -> 'live' | 'gone' | 'unknown'
 * @returns {{live:string[], gone:string[], unknown:string[], count:number}}
 *          `count` is what the tile SHOULD read once the gone ones are removed:
 *          the accounts proved to exist plus the ones we could not check, since
 *          an unchecked marker is never assumed dead.
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

  console.log(`registered-users-audit selftest: ${n - bad}/${n} checks passed.`);
  if (bad) process.exitCode = 1;
}

/* ──────────────────────────────── the run ────────────────────────────────── */

async function run() {
  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('Registered-users audit: no Firebase credentials configured — nothing to do. '
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

  let snap;
  try {
    snap = await db.collection('registeredUsers').get();
  } catch (e) {
    console.error('Registered-users audit: could not read the collection:', e && e.message);
    process.exitCode = 1; return;
  }
  const uids = snap.docs.map(d => d.id);
  console.log(`${uids.length} marker document(s) in registeredUsers.`);

  const verdicts = {};
  for (const uid of uids) {
    try {
      await admin.auth().getUser(uid);
      verdicts[uid] = 'live';
    } catch (e) {
      if (isUserNotFound(e)) verdicts[uid] = 'gone';
      else {
        verdicts[uid] = 'unknown';
        console.warn(`  could not check ${uid}: ${e && (e.code || e.message)} — left in place.`);
      }
    }
  }

  const res = auditMarkers(uids, verdicts);
  console.log(`  ${res.live.length} live account(s), ${res.gone.length} with no sign-in behind them`
            + (res.unknown.length ? `, ${res.unknown.length} unchecked` : '') + '.');

  if (!res.gone.length) {
    console.log(`Nothing to remove. The tile reads ${res.count} registered user(s).`);
    return;
  }
  if (DRY_RUN) {
    console.log('Dry run — would delete: ' + res.gone.join(', '));
    console.log(`The tile would then read ${res.count} registered user(s).`);
    return;
  }
  for (const uid of res.gone) {
    try { await db.collection('registeredUsers').doc(uid).delete(); }
    catch (e) { console.warn(`  could not delete ${uid}: ${e && e.message}`); }
  }
  console.log(`Removed ${res.gone.length} orphaned marker(s). `
            + `The tile now reads ${res.count} registered user(s).`);
}

if (SELFTEST) selftest();
else run().catch(e => { console.error(e); process.exitCode = 1; });
