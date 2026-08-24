#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Offline checks for the registered-users roster and the maintainer<->account
   message threads (owner, 2026-08-24). No network, no credentials.

       node lit/_scraper/users-selftest.mjs

   WHAT THIS IS FOR. Two collections were added that the maintainer can read
   and that carry a person's name and address, plus a two-way thread with a
   reply the rules must bound very precisely. None of that is provable by
   reading the page: what matters is that the RULES and the PAGES agree, and
   they are three separate files that nothing else holds together.

   It also closes a pinning gap this change would otherwise have widened:
   `lit/lit-news.js`'s copy of the maintainer's address is pinned against
   isFeedbackAdmin() by news-selftest.mjs, but `lit/feedback/index.html`'s copy
   — which now gates THREE admin sections rather than two — was pinned by
   nothing at all. Change the address in the rules and those panels would have
   gone on drawing for an account the rules no longer authorise.
   --------------------------------------------------------------------------- */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIT = path.join(HERE, '..');
const read = (p) => readFileSync(path.join(LIT, p), 'utf8');

let pass = 0;
const fails = [];
const ok = (cond, what) => { if (cond) pass++; else fails.push(what); };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${what}\n      expected ${JSON.stringify(b)}\n      got      ${JSON.stringify(a)}`);

const rules = read('_firestore.rules');
const main = read('index.html');
const fb = read('feedback/index.html');
const nav = read('lit-acct-nav.js');

/* ---------------------------------------------------- the maintainer, pinned */

const adminInRules = (rules.match(/request\.auth\.token\.email == '([^']+)'/) || [])[1];
ok(!!adminInRules, 'the rules name a maintainer address');

const fbAdmin = (fb.match(/var ADMIN_EMAIL = '([^']+)'/) || [])[1];
eq(fbAdmin, adminInRules,
  'THE GAP THIS CLOSES: the Feedback page draws its admin sections for the same ' +
  'address isFeedbackAdmin() authorises. Nothing pinned this before, and it now ' +
  'gates three panels — change one and the buttons appear while every press bounces');

const newsAdmin = (read('lit-news.js').match(/var ADMIN_EMAIL = '([^']+)'/) || [])[1];
eq(newsAdmin, adminInRules, '…and so does lit-news.js (news-selftest pins this too)');

/* isFeedbackAdmin() must be declared BEFORE the blocks that call it: the roster
   and the threads sit above the feedback inbox it was first written for. */
ok(rules.indexOf('function isFeedbackAdmin()') < rules.indexOf('match /userDirectory/'),
  'isFeedbackAdmin() is declared before the first block that calls it — a rule ' +
  'calling a function declared after it is not something to leave to chance');

/* -------------------------------------------------------------- the roster */

const dir = rules.slice(rules.indexOf('match /userDirectory/'), rules.indexOf('match /messages/'));
ok(dir.length > 200, 'the rules carry a userDirectory block');
ok(/allow read: if isFeedbackAdmin\(\)/.test(dir),
  'the maintainer reads the roster');
ok(/request\.auth\.uid == userId/.test(dir.slice(0, dir.indexOf('allow create'))),
  '…and a person reads the ONE row about themselves, which is what lets the ' +
  'browser send `first` back unchanged');
ok(/request\.resource\.data\.email == request\.auth\.token\.email/.test(dir),
  'THE ADDRESS CANNOT BE FORGED: `email` is pinned to the caller’s own auth token');
ok(/request\.resource\.data\.first == resource\.data\.first/.test(dir),
  '`first` is write-once — nobody can back-date themselves in the roster');
ok(/allow delete: if request\.auth != null && request\.auth\.uid == userId;/.test(dir),
  'an account retires its OWN row, as it retires its registeredUsers marker');

const dirKeys = (dir.slice(dir.indexOf('hasOnly(['), dir.indexOf('])', dir.indexOf('hasOnly([')))
  .match(/'[^']+'/g) || []).map((q) => q.slice(1, -1));
eq(dirKeys.slice().sort(), ['email', 'first', 'name', 'seen'],
  'the roster row is exactly those four fields');
/* Against the WRITER's own source, not the whole 300 KB page. Searching the
   file for "name:" proves nothing — it occurs 29 times in lit/index.html for
   reasons that have nothing to do with the roster, and a check that cannot
   fail is worse than no check: gutting syncDirectoryRow's row object left this
   suite green. */
const syncSrc = main.slice(main.indexOf('function syncDirectoryRow'),
  main.indexOf('function deleteOwnDirectoryRow'));
ok(syncSrc.length > 200, 'the roster writer is where this thinks it is');
for (const k of dirKeys) {
  ok(new RegExp('(^|[{;\\s])' + k + ':|row\\.' + k + '\\s*=').test(syncSrc),
    `syncDirectoryRow writes userDirectory."${k}" — and the rules allow it`);
}

/* Identity may NEVER join registeredUsers — it is publicly readable here. */
const reg = rules.slice(rules.indexOf('match /registeredUsers/'), rules.indexOf('match /userDirectory/'));
ok(/allow read: if true;/.test(reg) && /hasOnly\(\['t'\]\)/.test(reg),
  'registeredUsers stays PUBLIC and contentless — which is exactly why the ' +
  'roster is a collection of its own rather than fields added to it');

/* -------------------------------------------------------------- the threads */

const thr = rules.slice(rules.indexOf('match /messages/{userId}'), rules.indexOf('match /accountKeys/'));
ok(thr.length > 400, 'the rules carry a messages block');
ok(/allow read: if isFeedbackAdmin\(\)/.test(thr), 'a thread is readable by its two parties');

const headKeys = (thr.slice(thr.indexOf('hasOnly(['), thr.indexOf('])', thr.indexOf('hasOnly([')))
  .match(/'[^']+'/g) || []).map((q) => q.slice(1, -1));
eq(headKeys.slice().sort(), ['lastAt', 'lastFrom', 'needsAdmin', 'uid', 'userUnread'],
  'the thread head is exactly those five fields');

const itemsAt = thr.indexOf('match /items/');
ok(itemsAt > 0, 'the messages are a subcollection of their thread');
const itemKeys = (thr.slice(thr.indexOf('hasOnly([', itemsAt), thr.indexOf('])', thr.indexOf('hasOnly([', itemsAt)))
  .match(/'[^']+'/g) || []).map((q) => q.slice(1, -1));
eq(itemKeys.slice().sort(), ['body', 'from', 't'], 'a message is exactly {from, body, t}');

const items = thr.slice(itemsAt);
ok(/isFeedbackAdmin\(\) && request\.resource\.data\.from == 'admin'/.test(items)
  && /request\.resource\.data\.from == 'user'/.test(items),
  '`from` is pinned to whoever is actually writing — neither side can put words ' +
  'in the other’s mouth');
ok(/allow update, delete: if isFeedbackAdmin\(\);/.test(items),
  'only the maintainer may retract a message: a thread whose history either party ' +
  'can rewrite is not a record of anything');
ok(/request\.resource\.data\.body\.size\(\) <= 5000/.test(items)
  && /maxlength="5000"/.test(main) && /maxlength="5000"/.test(fb),
  'the body cap in the rules and the one both compose boxes enforce are the same number');

ok(/hasOnly\(\['userUnread'\]\)/.test(thr) && /request\.resource\.data\.userUnread == 0/.test(thr),
  'the owner may mark their thread read — userUnread to zero and nothing else');
ok(/hasOnly\(\['lastAt', 'lastFrom', 'needsAdmin'\]\)/.test(thr)
  && /request\.resource\.data\.lastFrom == 'user'/.test(thr)
  && /request\.resource\.data\.needsAdmin == true/.test(thr),
  'and may record a reply, which must say it came from them and must RAISE the ' +
  'maintainer’s flag — the queue cannot be emptied by the person waiting in it');

ok(/exists\(\/databases\/\$\(database\)\/documents\/messages\/\$\(userId\)\)/.test(items),
  'A REPLY NEEDS A THREAD TO REPLY TO — without it an owner could write ' +
  'unbounded documents under their own uid that no thread head points at, ' +
  'invisible on a page that lists threads. It is also what makes "only the ' +
  'maintainer opens a conversation" true in the rules and not just in the copy');
ok(/allow delete: if isFeedbackAdmin\(\);/.test(thr.slice(0, itemsAt))
  && /ur-del/.test(fb) && /function urDeleteThread/.test(fb),
  'the maintainer can remove an orphaned conversation, and the button the ghost ' +
  'panel promises actually exists');
ok(/\(!\('email' in request\.resource\.data\)/.test(dir),
  'an ORCID sign-in, which carries no e-mail claim, still gets a roster row — ' +
  'demanding one would silently omit exactly those accounts');
ok(dir.indexOf('function dirRowOk()') < dir.indexOf('allow create'),
  'dirRowOk() is declared before the allow statements that call it');
ok(/needsAdmin: !!\(prev && prev\.needsAdmin\)/.test(fb),
  'A BROADCAST IS NOT AN ANSWER: sending to somebody who has replied leaves them ' +
  'in the queue — only reading the thread and marking it answered clears it');
ok(/db\.batch\(\)/.test(fb),
  'the message and its bookkeeping are ONE write — half of them landing would ' +
  'leave a message the roster does not know about');
ok(/var draft = \(\$\('urBody'\) \|\| \{\}\)\.value/.test(fb),
  'and ticking a recipient does not throw away the message already typed');
ok(/urLoaded = false;/.test(fb.slice(fb.indexOf('function urLoad'))),
  'a refused first load drops its latch, so the panel can retry once the rules ' +
  'are deployed instead of staying broken until a reload');
ok(/Number\(p\.msgUnread\)/.test(nav),
  'the sub-page badge COERCES the count it interpolates — the profile doc is ' +
  'written by its own owner and the value reaches innerHTML');
ok(/function maybeCacheMsgUnread/.test(main)
  && (main.match(/maybeCacheMsgUnread\(\)/g) || []).length >= 3,
  'the profile cache the sub-pages read is written from MORE THAN the thread ' +
  'read: that read fires one line before the profile listener is attached, with ' +
  'state.profile just reset, so on nearly every sign-in it resolves with nothing ' +
  'to write onto — onData() must call it again once the profile lands');
ok(/if \(!state\.user \|\| state\.user\.uid !== uid\) return;/.test(main),
  'a message read that lands after the account changed is dropped — the older ' +
  'read would otherwise paint the previous person’s count on this account');

ok(/id="litMsgSend"/.test(main),
  'the reader’s Send button is addressable, so it can be disabled while a reply ' +
  'is in flight and a double-click cannot post it twice');

ok(!/match \/users\/\{userId\}\/messages/.test(rules),
  'the threads are TOP-LEVEL: under users/{userId} the blanket owner-write could ' +
  'only ever be widened, and a reply-only constraint would be unenforceable');

/* ---------------------------------------------------------------- the pages */

ok(/function syncDirectoryRow/.test(main) && /lastRosterUid/.test(main),
  'the main page writes the roster row, once per uid, once the profile has landed');
ok(/deleteOwnRegistryMark\)\.then\(deleteOwnDirectoryRow\)/.test(main),
  'the merge retires the roster row beside the registry marker — or one person is ' +
  'listed twice for ever');
ok(/syncDirectoryRow\(state\.user && state\.user\.uid, acctRosterName\(\)\)/.test(main),
  '…and puts it back on the failure branch, where the account lives on');

ok(/acctOpenMessages\(\)/.test(main) && /id="litMessagesOverlay"/.test(main),
  'the account menu opens a Messages card');
ok(/'#lit-messages'/.test(main), 'and #lit-messages deep-links to it');
ok(/litMessagesOverlay/.test(main.slice(main.indexOf("['acctProfileOverlay'"))),
  'which is dismissed on sign-out with every other account card');
ok(/#lit-messages/.test(nav),
  'the sub-pages carry the same menu row — a menu change missed in ' +
  'lit-acct-nav.js means the card differs between pages');
ok(/p\.msgUnread/.test(nav) && /msgUnread: msgUnread/.test(main),
  '…and read its badge from the profile doc they already fetch, rather than ' +
  'paying a read of their own on every page');

ok(/id="urAdmin"/.test(fb) && /function urMaybeShow/.test(fb),
  'the Feedback page carries the roster panel');
ok(/urMaybeShow\(u\)/.test(fb.slice(fb.indexOf('onAuthStateChanged'))),
  '…shown from the one auth callback, like the two inboxes beside it');
ok(/collection\('userDirectory'\)/.test(fb) && /collection\('messages'\)/.test(fb),
  '…and reads both collections');
ok(/from: 'admin'/.test(fb), 'the maintainer’s message is stamped from: admin');
ok(/from: 'user'/.test(main), 'and the reader’s reply from: user');

/* A CSV cell a spreadsheet cannot be tricked into executing. Both sites carry
   the same guard; this pins the Lit's copy by running it. */
const cellSrc = fb.slice(fb.indexOf('function urCsvCell'), fb.indexOf('function urDownloadCsv'));
ok(/\^\[=\+\\-@\\t\\r\]/.test(cellSrc),
  'the CSV cell defuses a leading =, +, - or @ — these are names people typed, ' +
  'and a spreadsheet would otherwise EXECUTE one');
ok(/replace\(\/"\/g, '""'\)/.test(cellSrc), '…and doubles an internal quote');

/* Everything user- or admin-authored is escaped before it is rendered. */
ok(/esc\(String\(m\.body \|\| ''\)\)/.test(fb) && /esc\(String\(m\.body \|\| ''\)\)/.test(main),
  'a message body is escaped on BOTH sides — a reply box is a two-way injection ' +
  'surface, so the maintainer’s text is escaped too');

/* ------------------------------------------------------------- disclosed */

/* The roster is identity the maintainer can read. A site that collects it and
   says so nowhere is wrong, whatever the rules allow — the sibling
   operationsacademia.org discloses the same pair in its Privacy Policy, and
   The Lit's equivalent is the About page's account section. */
const about = read('about/index.html');
ok(/e-mail address you sign in with, and when the account was first and last seen/.test(about),
  'the About page discloses what the maintainer can see about an account — the ' +
  'roster collects a name and an address, and saying so nowhere is not an option');
ok(/readable by me alone/.test(about) && /library[\s\S]{0,120}private to you/.test(about),
  '…and says who can read it, and that it is not the private library');
ok(/Messages/.test(about), '…and that messages exist at all');

if (fails.length) {
  console.log(`\n${fails.length} FAILED, ${pass} passed\n`);
  for (const f of fails) console.log('  FAIL  ' + f);
  process.exit(1);
}
console.log(`users-selftest: ${pass} checks passed`);
