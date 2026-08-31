/* ==========================================================================
   The Lit — the E-mail alerts modal's editorial pickers, in a real browser
   (Playwright + a local static server over the repo root; no network, the
   Firebase compat SDK replaced by a stub that signs a fake user straight in).

       node lit/_scraper/alerts-ui-guard.mjs
       (CHROMIUM=/path/to/chromium to override; PW=/path/to/playwright pkg)

   alerts-mailer.mjs --selftest pins the MATCHING rules (an editor criterion
   matches the acceptance sentence, an area normalizes, SE/AE split on ';').
   What is pinned HERE is the half a unit test cannot see — that a subscriber
   can actually COMPOSE such a criterion (owner request 2026-08-31: "for some
   journals, including Management Science, we collect editors and/or areas
   information, but currently I can't create a targeted email alert for it"):

     • with no relevant journal chip the section says HOW to get the pickers
       (add MS / ISR / MkSc under Journals) instead of silently offering
       nothing — the old modal only ever showed values carried over from the
       page's filters, with no way to add or edit them;
     • adding Management Science reveals Accepting Editor + Area, collapsed
       ("Choose editors…" — merely revealing them downloads nothing);
     • opening a picker loads the journal's papers file on demand and lists
       the normalized values with paper counts — the SAME values sel.editor
       filters on and the mailer's vendored normalizer computes;
     • ticking a value chips it, counts it, and reaches the alert's criteria
       (the live preview's Criteria line names it);
     • adding ISR reveals Senior + Associate Editor; Marketing Science alone
       reveals Senior Editor only — the main filter bar's own gating;
     • removing the journal chip keeps a chosen value VISIBLE and removable
       (the "Kept from this alert" block) — an edited alert is never silently
       rewritten — and the criterion still matches (only that journal's
       papers carry the field);
     • no page errors anywhere along the way.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch {
  console.log('playwright is not installed — skipping the browser checks');
  process.exit(process.env.CI ? 1 : 0);
}
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  let file = join(ROOT, decodeURIComponent(path));
  if (path.endsWith('/')) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let fails = 0;
const ok = (cond, msg) => { if (cond) console.log('  ok —', msg); else { fails++; console.error('  FAIL —', msg); } };

/* A minimal Firebase COMPAT stub: auth() resolves a fake signed-in user at
   once; every Firestore chain absorbs its calls — onSnapshot never fires (an
   empty account), reads resolve empty, writes resolve. Enough for the
   accounts script to reach state.user and render the alerts form, with no
   network and no real project. */
const FIREBASE_STUB = `
(function () {
  var noop = function () {};
  var emptyDocSnap = { exists: false, id: 'stub', data: function () { return null; }, get: function () { return undefined; } };
  var emptyQuerySnap = { empty: true, size: 0, docs: [], forEach: noop };
  function makeQ() {
    var q = {};
    var self = function () { return q; };
    ['doc', 'collection', 'where', 'orderBy', 'limit', 'limitToLast', 'startAfter', 'startAt', 'endAt', 'endBefore'].forEach(function (k) { q[k] = self; });
    // Fire once with an EMPTY snapshot (a brand-new account): the profile
    // listener needs a first snapshot before the Default-filters modal opens
    // (acctOpenDefaults defers on !state.profile). No handler on the page
    // reads docChanges()/metadata, so the merged doc/query shape suffices.
    q.onSnapshot = function (cb) {
      setTimeout(function () { try { cb(Object.assign({}, emptyDocSnap, emptyQuerySnap)); } catch (e) {} }, 0);
      return noop;
    };
    q.get = function () { return Promise.resolve(Object.assign({}, emptyDocSnap, emptyQuerySnap)); };
    q.set = q.update = q.delete = function () { return Promise.resolve(); };
    q.add = function () { return Promise.resolve({ id: 'stub' }); };
    q.id = 'stub';
    return q;
  }
  var user = {
    uid: 'guard-user', email: 'guard@example.com', emailVerified: true,
    displayName: 'Guard User', photoURL: '', isAnonymous: false,
    providerData: [{ providerId: 'password', uid: 'guard@example.com' }],
    getIdToken: function () { return Promise.resolve('stub'); },
    reload: function () { return Promise.resolve(); },
  };
  var authObj = {
    currentUser: user,
    onAuthStateChanged: function (cb) { setTimeout(function () { cb(user); }, 0); return noop; },
    signOut: function () { return Promise.resolve(); },
    signInAnonymously: function () { return Promise.resolve({ user: user }); },
    setPersistence: function () { return Promise.resolve(); },
    useDeviceLanguage: noop,
  };
  var fsFn = function () {
    return {
      collection: function () { return makeQ(); },
      collectionGroup: function () { return makeQ(); },
      doc: function () { return makeQ(); },
      batch: function () { var b = { set: noop, update: noop, delete: noop, commit: function () { return Promise.resolve(); } }; return b; },
      runTransaction: function (fn) { return Promise.resolve(); },
      enablePersistence: function () { return Promise.resolve(); },
    };
  };
  fsFn.FieldValue = {
    serverTimestamp: function () { return { __ts: 1 }; },
    delete: function () { return { __del: 1 }; },
    arrayUnion: function () { return Array.prototype.slice.call(arguments); },
    arrayRemove: function () { return Array.prototype.slice.call(arguments); },
    increment: function (n) { return n; },
  };
  var authFn = function () { return authObj; };
  ['GoogleAuthProvider', 'OAuthProvider', 'EmailAuthProvider', 'GithubAuthProvider', 'TwitterAuthProvider', 'FacebookAuthProvider'].forEach(function (p) {
    authFn[p] = function () { this.addScope = noop; this.setCustomParameters = noop; };
    authFn[p].credential = function () { return {}; };
    authFn[p].PROVIDER_ID = p;
  });
  authFn.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
  var app = { auth: authFn, firestore: fsFn, database: function () { throw new Error('no rtdb in the guard'); } };
  window.firebase = {
    initializeApp: function () { return app; },
    app: function () { return app; },
    auth: authFn,
    firestore: fsFn,
    apps: [],
  };
})();
`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
page.on('pageerror', e => { fails++; console.error('  FAIL — page error:', e.message); });
// The four compat SDK scripts become the stub; everything else off-repo aborts.
await page.route('**://www.gstatic.com/firebasejs/**', r =>
  r.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB }));
await page.route('**://*.googleapis.com/**', r => r.abort());
await page.route('**://fonts.gstatic.com/**', r => r.abort());

try {
  await page.goto(BASE + '/lit/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.litAlertsOpen && document.body.classList.contains('ms-signed-in'), null, { timeout: 30000 });
  ok(true, 'the stub signs the guard user in');

  // The empty profile snapshot has landed, so the SITE DEFAULT (Management
  // Science + its area) applies to the page's filters — wait for it, so the
  // modal's pre-fill below is deterministic.
  await page.waitForFunction(() => typeof sel !== 'undefined' && sel.journal && sel.journal.has('ms'), null, { timeout: 15000 });

  await page.evaluate(() => window.litAlertsOpen());
  await page.waitForSelector('#litAlertsForm .alert-crit', { timeout: 15000 });
  ok(true, 'the alerts form renders for a signed-in user');

  // 0. The modal PRE-FILLS from the page's live filters — here the site
  //    default's MS + area — and a dimension arriving WITH a value opens
  //    expanded, its value already a chip: the captured criterion is visible
  //    and editable instead of a read-only "carried over" line.
  ok(/Area \(MS\)/.test(await page.$eval('#litAlertEditorial', el => el.textContent)),
    'the modal pre-fills the page\'s MS + area filters into the editorial section');
  ok(!!(await page.$('#litAlertChips-area .alert-chip')),
    'the captured area value arrives as a removable chip');
  ok(!!(await page.$('#litAlertEd-area')),
    'a dimension that arrives with a value opens EXPANDED');

  // 1. From a clean slate (no relevant journal chip) the section TELLS the
  //    user how to get the pickers, instead of silently offering nothing.
  await page.evaluate(() => { clearFilters(); window.litAlertReload(); });
  await page.waitForFunction(() => /under Journals/.test((document.getElementById('litAlertEditorial') || {}).textContent || ''));
  const hint = await page.$eval('#litAlertEditorial', el => el.textContent || '');
  ok(/Management Science/.test(hint) && /accepting editor/i.test(hint),
    'with no MS/ISR/MkSc chip the section says how to reveal the editorial filters');
  ok(!(await page.$('#litAlertEd-editor')), 'no picker is offered before its journal is in scope');

  // 2. Adding Management Science reveals Accepting Editor + Area, collapsed.
  await page.evaluate(() => {
    const inp = document.getElementById('litAlertJournalInput');
    inp.value = 'Management Science';
    window.litAlertAddJournal('litAlertJournalInput');
  });
  await page.waitForFunction(() => /Accepting Editor/.test(document.getElementById('litAlertEditorial').textContent));
  ok(/Area \(MS\)/.test(await page.$eval('#litAlertEditorial', el => el.textContent)),
    'adding Management Science reveals Accepting Editor + Area');
  ok((await page.$$('#litAlertEditorial .pref-ed-open')).length === 2,
    'both pickers arrive COLLAPSED (choose-… buttons; nothing downloads yet)');
  ok(!(await page.$('#litAlertEditorial [id^="litAlertEd-se"]')),
    'SE/AE stay hidden while only MS is chosen');

  // 3. Opening the editor picker loads the papers file on demand and lists
  //    normalized values with counts; ticking one chips it and reaches the
  //    criteria (the preview's Criteria line).
  await page.evaluate(() => window.litAlertEdOpen('editor'));
  await page.waitForSelector('#litAlertEd-editor .pref-jrow', { timeout: 120000 });
  const firstVal = await page.$eval('#litAlertEd-editor .pref-jrow', el => el.textContent.replace(/\s*\(\d+\)\s*$/, '').trim());
  ok(firstVal.length > 0, 'the opened picker lists editor values from the loaded papers');
  ok(!/accepted by/i.test(firstVal), 'listed values are normalized names, never the raw acceptance sentence');
  await page.evaluate(() => {
    const row = document.querySelector('#litAlertEd-editor .pref-jrow input');
    row.click();
  });
  await page.waitForFunction(() => (document.getElementById('litAlertChips-editor') || {}).textContent);
  const chip = await page.$eval('#litAlertChips-editor', el => el.textContent);
  ok(chip.indexOf(firstVal) >= 0, 'ticking a value chips it under the picker');
  ok(/\(1 chosen\)/.test(await page.$eval('#litAlertEdCount-editor', el => el.textContent)),
    'the dimension head counts the chosen value');
  const preview = await page.$eval('#litAlertPreview', el => el.textContent);
  ok(preview.indexOf('editor: ' + firstVal) >= 0,
    'the live preview\'s Criteria line carries the editor criterion');

  // 4. The area picker draws the SAME normalized values sel.area filters on.
  await page.evaluate(() => window.litAlertEdOpen('area'));
  await page.waitForSelector('#litAlertEd-area .pref-jrow', { timeout: 30000 });
  const areas = await page.$$eval('#litAlertEd-area .pref-jrow', els => els.map(el => el.textContent));
  ok(areas.some(a => /entrepreneurship and innovation/.test(a)), 'the area picker lists the normalized areas');

  // 5. ISR reveals SE + AE; with MS still chosen that is four dimensions.
  await page.evaluate(() => {
    const inp = document.getElementById('litAlertJournalInput');
    inp.value = 'Information Systems Research';
    window.litAlertAddJournal('litAlertJournalInput');
  });
  await page.waitForFunction(() => /Senior Editor/.test(document.getElementById('litAlertEditorial').textContent));
  ok(/Associate Editor/.test(await page.$eval('#litAlertEditorial', el => el.textContent)),
    'adding ISR reveals Senior + Associate Editor');

  // 6. Removing the MS chip keeps the chosen editor VISIBLE and removable —
  //    never silently dropped — under the "Kept from this alert" note.
  await page.evaluate(() => window.litAlertRemove('journal', 'ms'));
  await page.waitForFunction(() => /Kept from this alert/.test(document.getElementById('litAlertEditorial').textContent));
  ok((await page.$eval('#litAlertChips-editor', el => el.textContent)).indexOf(firstVal) >= 0,
    'a chosen editor survives its journal chip\'s removal, as a removable chip');
  ok(!(await page.$('#litAlertEd-editor')), 'its picker is withdrawn with the journal');
  await page.evaluate((v) => window.litAlertRemove('editor', v), firstVal);
  await page.waitForFunction(() => !/Kept from this alert/.test(document.getElementById('litAlertEditorial').textContent));
  ok(true, 'removing the kept chip retires the block');

  // 7. Marketing Science ALONE reveals Senior Editor only (no AE) — the main
  //    filter bar's own gating, through the shared edDim* helpers.
  await page.evaluate(() => {
    window.litAlertRemove('journal', 'isre');
    const inp = document.getElementById('litAlertJournalInput');
    inp.value = 'Marketing Science';
    window.litAlertAddJournal('litAlertJournalInput');
  });
  await page.waitForFunction(() => /Senior Editor/.test(document.getElementById('litAlertEditorial').textContent));
  ok(!/Associate Editor/.test(await page.$eval('#litAlertEditorial', el => el.textContent)),
    'Marketing Science alone offers Senior Editor and not Associate Editor');

  // 8. The Default-filters modal — whose prefEd* functions now delegate to the
  //    SAME shared edDim* helpers — still reveals its own pickers: ticking MS
  //    shows Accepting Editor + Area, and the already-loaded values list.
  await page.evaluate(() => window.acctOpenDefaults());
  await page.waitForSelector('#acctDefaultsOverlay.open', { timeout: 15000 });
  await page.evaluate(() => window.acctPrefToggleJournal('ms'));
  await page.waitForFunction(() => {
    const sec = document.getElementById('prefEditorialSec');
    return sec && sec.style.display !== 'none' && /Accepting Editor/.test(sec.textContent);
  });
  ok(true, 'Default filters: ticking MS still reveals Accepting Editor + Area');
  await page.evaluate(() => window.litPrefEdOpen('editor'));
  await page.waitForSelector('#prefEd-editor .pref-jrow', { timeout: 30000 });
  ok((await page.$$('#prefEd-editor .pref-jrow')).length > 0,
    'Default filters: the editor picker still lists values through the shared helpers');
} catch (e) {
  fails++;
  console.error('  FAIL —', e.message);
} finally {
  await browser.close();
  server.close();
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall alerts-editorial browser checks passed');
process.exit(fails ? 1 : 0);
