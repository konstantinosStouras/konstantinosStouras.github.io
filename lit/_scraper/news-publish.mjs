#!/usr/bin/env node
/*
 * The Lit — publish (or remove) a "What's new" entry from CI
 * ==========================================================
 *
 * "Nothing on What's new publishes itself" (owner, 2026-08-18): an entry in
 * lit/changelog.json stays PENDING — invisible to visitors and withheld from
 * the feature-digest e-mails — until the maintainer's decision lands in the
 * Firestore `newsOverrides/{entry id}` collection. That decision is normally
 * pressed on the site (the Publish button lit-news.js draws for the
 * maintainer); this CLI writes the SAME document with the Admin SDK, so the
 * decision can also be made from a workflow_dispatch run
 * (.github/workflows/lit-news-publish.yml) when the maintainer asks for it.
 * It DECIDES NOTHING on its own: every id it publishes is named on the
 * command line, exactly as the button is pressed per entry — the review gate
 * is untouched, it just gains a second hand on the same lever.
 *
 * The document it writes is LitNews.patchFor(status) — the module the About
 * page, the main page's alert preview and the alerts mailer already share —
 * so the four consumers cannot disagree about what a decision looks like
 * (news-selftest.mjs pins that this file goes through the module).
 *
 * After writing it re-reads every decision and prints the whole log's state,
 * because the mailer HOLDS THE STREAM at the oldest unreviewed entry
 * (sendableChangelog): a published entry still reaches nobody while an OLDER
 * entry sits pending, and this report is what makes that visible in the run
 * log instead of silently delaying the digest.
 *
 * Env / secrets (via the workflow):
 *   FIREBASE_SERVICE_ACCOUNT   JSON of a Firebase service-account key (or set
 *                              GOOGLE_APPLICATION_CREDENTIALS to a file path).
 *
 * Modes:
 *   node news-publish.mjs <id> [<id> …]            publish the named entries
 *   node news-publish.mjs --status removed <id>    take one down instead
 *   node news-publish.mjs --list                   report every entry's state
 *   node news-publish.mjs --dry-run <id> …         print what would be written
 *   node news-publish.mjs --selftest               offline checks, no network
 *
 * A no-op until FIREBASE_SERVICE_ACCOUNT is set, so it never fails pre-setup.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LitNews = createRequire(import.meta.url)(path.join(__dirname, '..', 'lit-news.js'));
const CHANGELOG_FILE = path.join(__dirname, '..', 'changelog.json');

const ARGV = process.argv.slice(2);
const DRY_RUN = ARGV.includes('--dry-run');
const LIST = ARGV.includes('--list');
const SELFTEST = ARGV.includes('--selftest');
const statusIdx = ARGV.indexOf('--status');
const STATUS = statusIdx >= 0 ? String(ARGV[statusIdx + 1] || '') : LitNews.APPROVED;
const IDS = ARGV.filter((a, i) => !a.startsWith('--') && i !== statusIdx + 1);

/* ───────────────────────────── the pure half ─────────────────────────────── */

/**
 * Which of the requested ids may be written, against the changelog. An id the
 * changelog does not carry is REFUSED (a typo'd publish must fail loudly, not
 * mint a stray decision document nothing will ever read), and only the two
 * decisions the site's own buttons make are accepted.
 */
export function planWrites(ids, status, updates) {
  const known = new Set((Array.isArray(updates) ? updates : []).map(u => u && u.id).filter(Boolean));
  const bad = ids.filter(id => !known.has(id));
  if (bad.length) return { error: `not in changelog.json: ${bad.join(', ')}` };
  if (status !== LitNews.APPROVED && status !== LitNews.REMOVED) {
    return { error: `status must be '${LitNews.APPROVED}' or '${LitNews.REMOVED}', got '${status}'` };
  }
  if (!ids.length) return { error: 'no entry ids given' };
  return { writes: ids.map(id => ({ id, patch: LitNews.patchFor(status) })) };
}

/** One line per entry, newest first — the whole log's decision state. */
export function stateReport(updates, docs) {
  const split = LitNews.partition(updates, docs || {});
  const lines = [];
  const row = (r, mark) => `  ${mark} ${r.date}  ${r.id}  — ${r.title}`;
  split.pending.forEach(r => lines.push(row(r, 'PENDING ')));
  split.approved.forEach(r => lines.push(row(r, 'approved')));
  split.removed.forEach(r => lines.push(row(r, 'removed ')));
  // The mailer holds the feature stream at the OLDEST unreviewed entry —
  // say so when one is holding it, or a published entry silently waits.
  const oldest = split.pending.slice().sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (oldest) {
    lines.push(`  ⚠ the digest stream is HELD at ${oldest.date} (“${oldest.title}”) — entries dated after it wait until it is published or removed.`);
  }
  return lines.join('\n');
}

function loadChangelog() {
  const j = JSON.parse(fs.readFileSync(CHANGELOG_FILE, 'utf8'));
  return Array.isArray(j) ? j : (j && Array.isArray(j.updates) ? j.updates : []);
}

/* ────────────────────────────── the run ──────────────────────────────────── */

async function run() {
  const updates = loadChangelog();

  if (!process.env.FIREBASE_SERVICE_ACCOUNT && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('news-publish: no Firebase credentials configured — nothing to do. '
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

  const readDocs = async () => {
    const out = {};
    const snap = await db.collection(LitNews.COLLECTION).get();
    snap.forEach(d => { out[d.id] = d.data(); });
    return out;
  };

  if (LIST) {
    console.log('What\'s-new decision state:\n' + stateReport(updates, await readDocs()));
    return;
  }

  const plan = planWrites(IDS, STATUS, updates);
  if (plan.error) {
    console.error('news-publish: ' + plan.error);
    process.exitCode = 1;
    return;
  }

  for (const w of plan.writes) {
    if (DRY_RUN) {
      console.log(`dry run — would set ${LitNews.COLLECTION}/${w.id} to ${JSON.stringify(w.patch)}`);
      continue;
    }
    await db.collection(LitNews.COLLECTION).doc(w.id).set(w.patch, { merge: true });
    console.log(`${STATUS === LitNews.REMOVED ? 'removed' : 'published'}: ${w.id}`);
  }

  console.log('\nWhat\'s-new decision state now:\n' + stateReport(updates, await readDocs()));
  if (!DRY_RUN && STATUS === LitNews.APPROVED) {
    console.log('\nThe entry reaches feature subscribers on the next alerts-mailer run '
              + '(daily 08:30 UTC, or dispatch lit-alerts-mail.yml).');
  }
}

/* ───────────────────────────── the selftest ──────────────────────────────── */

function selftest() {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };
  const UPDATES = [
    { id: 'new-1', date: '2026-08-31', title: 'Newest, unreviewed' },
    { id: 'old-1', date: '2026-08-30', title: 'Older, unreviewed' },
    { id: 'pre-gate', date: '2026-08-01', title: 'Before the gate' },
  ];

  const p = planWrites(['new-1'], LitNews.APPROVED, UPDATES);
  ok('a known id plans a write', p.writes && p.writes.length === 1 && p.writes[0].id === 'new-1');
  ok('the write is the module\'s own patch (status + hidden kept in step)',
    p.writes[0].patch.status === LitNews.APPROVED && p.writes[0].patch.hidden === false
    && typeof p.writes[0].patch.t === 'number');
  ok('every patch key is one the rules allow',
    Object.keys(p.writes[0].patch).every(k => LitNews.DOC_KEYS.includes(k)));
  ok('an unknown id is refused whole', !!planWrites(['new-1', 'typo'], LitNews.APPROVED, UPDATES).error);
  ok('an empty id list is refused', !!planWrites([], LitNews.APPROVED, UPDATES).error);
  ok('only the site\'s own two decisions are accepted',
    !!planWrites(['new-1'], 'pending', UPDATES).error
    && !planWrites(['new-1'], LitNews.REMOVED, UPDATES).error);

  const rep = stateReport(UPDATES, {});
  ok('the report lists the pending entries', rep.includes('PENDING ') && rep.includes('new-1') && rep.includes('old-1'));
  ok('…and the pre-gate entry as approved', /approved.*pre-gate/.test(rep));
  ok('…and names the OLDEST pending entry as holding the digest stream',
    rep.includes('HELD at 2026-08-30'));
  const repDone = stateReport(UPDATES, { 'new-1': LitNews.patchFor(LitNews.APPROVED), 'old-1': LitNews.patchFor(LitNews.APPROVED) });
  ok('with everything decided, nothing is reported held', !repDone.includes('HELD'));

  // The real changelog must be publishable by id — every entry carries one.
  const real = loadChangelog();
  ok('every real changelog entry has an id to publish by', real.length > 0 && real.every(u => u && u.id));

  console.log(`\nnews-publish selftest: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

if (SELFTEST) selftest();
else run().catch(e => { console.error(e); process.exitCode = 1; });
