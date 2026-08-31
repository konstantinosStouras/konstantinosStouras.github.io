#!/usr/bin/env node
/*
 * The Lit — offline checks for the "What's new" review gate (lit/lit-news.js)
 * ==========================================================================
 *
 * No network, no Firebase, no credentials:
 *
 *     node lit/_scraper/news-selftest.mjs
 *
 * WHAT THIS PINS, and why each piece is here.
 *
 * lit/changelog.json says WHAT was announced. Firestore `newsOverrides/{id}`
 * says what the maintainer has DONE about it — published it, reworded it, or
 * taken it down. Three rules the owner asked for (2026-08-18), and they only
 * work together:
 *
 *   • a REMOVED entry leaves the list, for the maintainer too (the list is
 *     meant to get cleaner, not to fill with struck-through entries);
 *   • …and removing is still not a one-way door, so the removed ones sit in a
 *     collapsed panel below the list that only the maintainer sees;
 *   • a NEW entry is not public on sight: with no decision it is PENDING, so
 *     nobody but the maintainer sees it and nobody is e-mailed about it.
 *
 * The rules of that gate are pure and live in ONE file, which the About page,
 * the main page's alert preview and the alerts mailer all read through — so
 * what the site shows and what the inbox receives cannot mean different things.
 * What is checked here is the gate itself, the agreement between the module and
 * _firestore.rules about which keys a decision may carry, and that every
 * consumer really goes through it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIT = path.join(__dirname, '..');
const require = createRequire(import.meta.url);
const News = require(path.join(LIT, 'lit-news.js'));

const read = (...p) => fs.readFileSync(path.join(LIT, ...p), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) pass++; else { fail++; console.log('FAIL', name); } };
const eq = (name, got, want) => ok(`${name}\n      expected ${JSON.stringify(want)}\n      got      ${JSON.stringify(got)}`,
  JSON.stringify(got) === JSON.stringify(want));

/* ── the gate ─────────────────────────────────────────────────────────────── */

const e = (id, date) => ({ id, date, title: id, summary: 's', url: '' });
const before = e('before', '2026-08-01');      // predates the review gate
const after = e('after', '2026-09-01');        // does not

ok('ABSENCE MEANS WITHHOLD: an entry nobody reviewed is not public',
  News.statusOf(after, undefined) === News.PENDING);
ok('but the gate arriving is not a reason to retract what was already on the site',
  News.statusOf(before, undefined) === News.APPROVED);
ok('and that cut is the day the gate shipped, not an arbitrary date',
  News.REVIEW_FROM > '2026-08-17' && News.REVIEW_FROM < '2026-09-01');
ok('publishing one puts it on the site',
  News.statusOf(after, { status: News.APPROVED }) === News.APPROVED);
ok('and removing one takes it off, however old it is',
  News.statusOf(before, { status: News.REMOVED }) === News.REMOVED);

/* Documents written BEFORE the gate carry `hidden` and no `status`. They are
   read rather than migrated, so nothing has to run against the database. */
ok('a pre-gate {hidden:true} document still reads as removed',
  News.statusOf(before, { hidden: true }) === News.REMOVED);
ok('and a pre-gate restore still reads as published',
  News.statusOf(after, { hidden: false }) === News.APPROVED);
ok('a new decision keeps `hidden` in step, so an old cached page cannot disagree',
  News.patchFor(News.REMOVED).hidden === true && News.patchFor(News.APPROVED).hidden === false);
ok('an unknown status is not a decision — it can never publish by accident',
  News.statusOf(after, { status: 'whatever' }) === News.PENDING);

/* ── what is public ───────────────────────────────────────────────────────── */

const log = [after, e('draft', '2026-09-02'), before, e('gone', '2026-08-02')];
const docs = { after: { status: News.APPROVED }, gone: { status: News.REMOVED } };
eq('publicUpdates carries the published entries, newest first, and nothing else',
  News.publicUpdates(log, docs).map(u => u.id), ['after', 'before']);
const split = News.partition(log, docs);
eq('partition accounts for every entry exactly once',
  [split.approved.length, split.pending.length, split.removed.length], [2, 1, 1]);
ok('an entry with no id, title or date is not a row at all',
  News.partition([{ id: 'x' }, { title: 'y' }, null], {}).approved.length === 0);

/* An edit is a rewording laid over the entry, never a rewrite of
   changelog.json — which the mailer also reads, and which is the record of
   what actually shipped. */
const worded = News.applied(before, { title: 'Reworded' });
ok('an edited title is shown and the rest of the entry is left alone',
  worded.title === 'Reworded' && worded.summary === 's');
ok('an empty override is not an edit — it falls back to the entry itself',
  News.applied(before, { title: '' }).title === 'before');

/* ── the module and the rules agree about what may be written ─────────────── */

const rules = read('_firestore.rules');
const block = rules.slice(rules.indexOf('match /newsOverrides/'));
ok('the rules carry a newsOverrides block', block.startsWith('match /newsOverrides/'));
ok('a decision reaches EVERY visitor — the list is public, not a maintainer view',
  /allow read: if true;/.test(block.slice(0, 400)));
ok('and only the maintainer makes one',
  /allow write: if isFeedbackAdmin\(\)/.test(block.slice(0, 900)));
/* WITHOUT A DELETE A DECISION IS A ONE-WAY DOOR: `request.resource` is null on
   a delete, so an `allow write` condition that reads it errors and is false. */
ok('and can delete one, so a document written wrongly is not permanent',
  /allow delete: if isFeedbackAdmin\(\);/.test(block.slice(0, 2600)));

const allowed = new Set(
  (block.slice(block.indexOf('hasOnly(['), block.indexOf('])', block.indexOf('hasOnly([')))
    .match(/'[^']+'/g) || []).map(q => q.slice(1, -1)));
for (const key of News.DOC_KEYS) {
  ok(`lit-news.js may write "${key}", and the rules allow it`, allowed.has(key));
}
eq('and the rules allow nothing the module does not write',
  [...allowed].sort(), [...News.DOC_KEYS].sort());
for (const st of [News.APPROVED, News.PENDING, News.REMOVED]) {
  ok(`the rules name the "${st}" status`, block.slice(0, 1800).includes(`'${st}'`));
}
/* The client truncates to the same caps the rules enforce, or a long edit is a
   permission-denied the maintainer cannot debug. */
ok('the title cap matches the rules', block.includes(`title.size() <= ${News.TITLE_MAX}`));
ok('the summary cap matches the rules', block.includes(`summary.size() <= ${News.SUMMARY_MAX}`));
ok('and an over-long edit is cut before it is sent',
  News.patchFor(News.APPROVED, { title: 'x'.repeat(999) }).title.length === News.TITLE_MAX);

/* The client check that DRAWS the controls must name the same maintainer the
   rules authorise, or the buttons appear and every press bounces. */
ok('the module and the rules name the same maintainer',
  rules.includes(`request.auth.token.email == '${News.ADMIN_EMAIL}'`));

/* ── the file itself ──────────────────────────────────────────────────────── */

/* Nothing validated changelog.json before, and the gate gives that teeth: an
   entry with no usable `id` cannot be reviewed at all (the decision document is
   keyed on it, and the page skips such an entry while the mailer, which fills
   the id in from the title, would count it as unreviewed and hold every later
   announcement behind it — with nothing on any screen to publish). Two entries
   sharing an id would be decided together: one Remove taking down a second
   entry nobody touched. Both now fail here, where they are a one-line fix. */
const shipped = JSON.parse(read('changelog.json'));
const entries = shipped.updates || [];
ok('changelog.json carries entries', entries.length > 0);
const ids = new Set();
for (const u of entries) {
  ok(`every entry has an id — "${u.title || '(untitled)'}" does not`,
    typeof u.id === 'string' && u.id.trim().length > 0);
  ok(`and it is unique — "${u.id}" is used twice`, !ids.has(u.id));
  ids.add(u.id);
  ok(`every entry has a yyyy-mm-dd date — "${u.id}" has "${u.date}"`,
    /^\d{4}-\d{2}-\d{2}$/.test(String(u.date || '')));
  ok(`and a title — "${u.id}" has none`,
    typeof u.title === 'string' && u.title.trim().length > 0);
}
/* AND THE GATE READS THE REAL FILE THE WAY THE PAGES DO — if publicUpdates
   dropped an entry the About page renders, the mailer would announce a
   different list from the one on the site. */
eq('every pre-gate entry is public, and every entry since it is not',
  News.publicUpdates(entries, {}).length,
  entries.filter(u => String(u.date) < News.REVIEW_FROM).length);

/* ── every consumer goes through it ───────────────────────────────────────── */

const js = read('lit-news.js');
ok('lit-news.js is dual-mode, so the pages and the mailer cannot drift apart',
  js.includes('module.exports = factory()'));

const about = read('about', 'index.html');
ok("the About page loads the What's-new module", about.includes('../lit-news.js'));
ok('and renders its list through it', about.includes("LitNews.mount({ list: '#litWhatsNew'"));
ok('with no renderer of its own left — that is what would drift',
  !about.includes('changelog.json') || !/box\.innerHTML\s*=\s*'<ul/.test(about));

const main = read('index.html');
ok('the main page loads it too', main.includes('<script src="lit-news.js">'));
ok("and its alert preview shows only what has been published",
  main.includes('LitNews.publicUpdates('));
ok('the decisions are fetched only when the alerts panel opens — one read, not one per visit',
  main.includes('litNewsEnsure') && main.includes("id === 'litAlertsOverlay'"));

const publisher = read('_scraper', 'news-publish.mjs');
ok('the CI publisher goes through the module too', publisher.includes("'lit-news.js'"));
ok('…and writes only the module\'s own patch — never a hand-built decision',
  publisher.includes('LitNews.patchFor(') && !/status:\s*['"]approved['"]/.test(publisher));
ok('…and refuses an id the changelog does not carry', publisher.includes('not in changelog.json'));

const mailer = read('_scraper', 'alerts-mailer.mjs');
ok('the mailer reads the same decisions', mailer.includes("'lit-news.js'"));
ok('and sends only published entries — an e-mail cannot be recalled',
  mailer.includes('sendableChangelog(changelog, newsDecisions)'));
ok('the test-e-mail queue is held to the same rule',
  /sendableChangelog\(changelog, docs\)/.test(mailer));
ok('a decision read that fails withholds rather than killing the paper digests too',
  /catch \(err\) \{[\s\S]{0,300}newsDecisions = \{\}/.test(mailer));

/* ── the states have to look like something ───────────────────────────────── */

for (const cls of ['wn-item', 'is-pending', 'is-removed', 'wn-note', 'wn-bin', 'wn-admin', 'wn-edit']) {
  ok(`.${cls} is drawn, not just set`, about.includes(cls));
}

if (fail) {
  console.log(`\nnews-selftest: ${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
console.log(`news-selftest: ${pass} checks passed`);
