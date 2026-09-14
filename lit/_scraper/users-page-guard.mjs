#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   Browser guard for the registered-users roster and the analytics tile
   (owner, 2026-09-14: "why do I see only 2 registered users in the 1st
   attachment but 4 in the 2nd? … Make sure they both read well from mobile").

       node lit/_scraper/users-page-guard.mjs
       (CHROMIUM=/path/to/chromium to override; PW=/path/to/playwright pkg)

   No network and no real project: the Firebase compat SDK is replaced by a
   stub that signs the MAINTAINER in and serves a fixture — FOUR public
   registeredUsers markers and TWO userDirectory rows, the exact state that was
   reported. It measures, in a real browser:

     · the Feedback roster says BOTH figures when they differ ("4 registered ·
       2 listed here") and explains the gap above the list;
     · at phone width the roster is one card per account — no sideways page
       scroll, the headings printed in front of each value, the sort moved to a
       chip row that still sorts — and at desktop width it is the table it was;
     · the Data Analytics "Registered users" tile draws the same 4 at phone
       width without overflowing its card or the page.

   Screenshots land in $GUARD_SHOTS_DIR when set (for a human to look at).
   --------------------------------------------------------------------------- */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
let chromium;
try { ({ chromium } = await import(PW)); }
catch {
  console.log('playwright is not installed — skipping the browser checks');
  process.exit(0);
}
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.GUARD_SHOTS_DIR || '';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
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

/* The reported state: four accounts have a marker, two have a roster row. */
const DAY = 86400000;
const NOW = Date.now();
const FIX = {
  registeredUsers: { u1: { t: NOW }, u2: { t: NOW - DAY }, u3: { t: NOW - 20 * DAY }, u4: { t: NOW - 25 * DAY } },
  userDirectory: {
    /* Zuzanna was seen LAST, so the default Last-seen order (Z, K) differs
       from Name A→Z (K, Z) — which is what lets the sort-chip check see a change. */
    u1: { name: 'Konstantinos Stouras', email: 'kstouras@example.com', first: NOW - 17 * DAY, seen: NOW - DAY },
    u2: { name: 'Zuzanna Piskorowska', email: 'zuzanna.piskorowska@example.ie', first: NOW - DAY, seen: NOW },
  },
  messages: {},
  feedback: {},
  paperSubmissions: {},
};

/* A minimal Firebase COMPAT stub (same shape as alerts-ui-guard.mjs): auth()
   resolves the MAINTAINER at once; a collection get() serves the fixture;
   writes resolve. Deliberately NO count() — the real compat SDK 10.12.5 has
   none either, so the page's fallback path is the one measured here. */
const stubJs = (fix) => `
(function () {
  var FIX = ${JSON.stringify(fix)};
  var noop = function () {};
  function docSnap(col, id) {
    var d = (FIX[col] || {})[id];
    return { id: id, exists: !!d, data: function () { return d ? JSON.parse(JSON.stringify(d)) : null; },
             ref: { delete: function () { return Promise.resolve(); } } };
  }
  function querySnap(col) {
    var ids = Object.keys(FIX[col] || {});
    var docs = ids.map(function (id) { return docSnap(col, id); });
    return { empty: !docs.length, size: docs.length, docs: docs, forEach: function (f) { docs.forEach(f); } };
  }
  function makeQ(col, id) {
    var q = {};
    ['where', 'orderBy', 'limit', 'limitToLast', 'startAfter', 'startAt', 'endAt', 'endBefore'].forEach(function (k) { q[k] = function () { return q; }; });
    q.collection = function (n) { return makeQ(id ? col + '/' + id + '/' + n : n, null); };
    q.doc = function (n) { return makeQ(col, n || 'auto'); };
    q.onSnapshot = function (cb) { setTimeout(function () { try { cb(id ? docSnap(col, id) : querySnap(col)); } catch (e) {} }, 0); return noop; };
    q.get = function () { return Promise.resolve(id ? docSnap(col, id) : querySnap(col)); };
    q.set = q.update = q.delete = function () { return Promise.resolve(); };
    q.add = function () { return Promise.resolve({ id: 'stub' }); };
    q.id = id || 'stub';
    return q;
  }
  var user = {
    uid: 'u1', email: 'kstouras@gmail.com', emailVerified: true,
    displayName: 'Konstantinos Stouras', photoURL: '', isAnonymous: false,
    providerData: [{ providerId: 'google.com', uid: 'kstouras@gmail.com' }],
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
      collection: function (n) { return makeQ(n, null); },
      collectionGroup: function (n) { return makeQ('cg/' + n, null); },
      doc: function (p) { var parts = String(p).split('/'); return makeQ(parts[0], parts[1] || 'auto'); },
      batch: function () { return { set: noop, update: noop, delete: noop, commit: function () { return Promise.resolve(); } }; },
      runTransaction: function () { return Promise.resolve(); },
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
  var app = { auth: authFn, firestore: fsFn };
  window.firebase = { initializeApp: function () { return app; }, app: function () { return app; }, auth: authFn, firestore: fsFn, apps: [] };
})();
`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });

async function stubbedPage(width, height) {
  const p = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  p.on('pageerror', e => { fails++; console.error('  FAIL — page error:', e.message); });
  await p.route('**://www.gstatic.com/firebasejs/**', r => r.fulfill({ contentType: 'text/javascript', body: stubJs(FIX) }));
  await p.route('**://*.googleapis.com/**', r => r.abort());
  await p.route('**://fonts.gstatic.com/**', r => r.abort());
  return p;
}
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, name), fullPage: false }); };
const noSidewaysScroll = (p) => p.evaluate(() =>
  document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth);

try {
  /* ── the Feedback roster, desktop ── */
  const desk = await stubbedPage(1280, 1200);
  await desk.goto(BASE + '/lit/feedback/', { waitUntil: 'domcontentloaded' });
  await desk.waitForSelector('#urAdmin:not([hidden]) .ur-table tbody tr', { timeout: 15000 });
  const sub = await desk.textContent('#urAdminSub');
  ok(/4 registered · 2 listed here/.test(sub), `the subtitle says BOTH figures when they differ — "${sub.trim()}"`);
  const note = await desk.textContent('.ur-note');
  ok(/counts 4/.test(note) && /holds 2/.test(note) && /2 accounts have signed in/.test(note),
    'a note above the list names the gap, its reason and what closes it');
  ok(await desk.$eval('.ur-table thead', n => getComputedStyle(n).display !== 'none'),
    'desktop: the column headings are drawn');
  ok(await desk.$eval('.ur-sortrow', n => getComputedStyle(n).display === 'none'),
    'desktop: the phone sort chips are not');
  ok((await desk.$$('.ur-table tbody tr')).length === 2, 'two roster rows');
  ok(await desk.$eval('.ur-table tbody td[data-label="E-mail"]', n => getComputedStyle(n, '::before').width === 'auto' || parseFloat(getComputedStyle(n, '::before').width) === 0),
    'desktop: no per-cell labels are printed');
  await desk.evaluate(() => document.getElementById('urAdmin').scrollIntoView());
  await shot(desk, 'feedback-roster-desktop.png');
  await desk.close();

  /* ── the Feedback roster, phone ── */
  const phone = await stubbedPage(390, 844);
  await phone.goto(BASE + '/lit/feedback/', { waitUntil: 'domcontentloaded' });
  await phone.waitForSelector('#urAdmin:not([hidden]) .ur-table tbody tr', { timeout: 15000 });
  ok(await noSidewaysScroll(phone), 'phone: the page does not scroll sideways');
  ok(await phone.$eval('.ur-table thead', n => getComputedStyle(n).display === 'none'),
    'phone: the seven-column heading row is gone');
  ok(await phone.$eval('.ur-sortrow', n => getComputedStyle(n).display === 'flex'),
    'phone: the sort is a row of chips instead');
  const cards = await phone.$$eval('.ur-table tbody tr', rows => rows.map(r => {
    const b = r.getBoundingClientRect();
    const tick = r.querySelector('.ur-tick input').getBoundingClientRect();
    const open = r.querySelector('.ur-act .fb-act').getBoundingClientRect();
    const labels = Array.from(r.querySelectorAll('td[data-label]')).map(td => {
      const cs = getComputedStyle(td, '::before');
      return { label: td.getAttribute('data-label'), w: parseFloat(cs.width) || 0, display: getComputedStyle(td).display };
    });
    return { display: getComputedStyle(r).display, w: b.width, x: b.left, right: b.right,
             tickIn: tick.left >= b.left && tick.right <= b.right && tick.top >= b.top,
             openW: open.width, labels };
  }));
  ok(cards.every(c => c.display === 'block' && c.w > 300 && c.w <= 390),
    `phone: each account is a card the width of the screen (${cards.map(c => Math.round(c.w)).join(', ')}px)`);
  ok(cards.every(c => c.labels.length === 4 && c.labels.every(l => l.display === 'flex' && l.w > 40)),
    'phone: E-mail, First seen, Last seen and Messages each carry a printed label');
  ok(cards.every(c => c.tickIn), 'phone: the tick box sits inside its card');
  ok(cards.every(c => c.openW > 250), 'phone: Open spans the foot of the card');
  const before = await phone.$$eval('.ur-table tbody td.ur-name', n => n.map(x => x.textContent.trim()));
  await phone.click('.ur-sortrow .ur-sort[data-sort="name"]');
  await phone.waitForTimeout(50);
  const after = await phone.$$eval('.ur-table tbody td.ur-name', n => n.map(x => x.textContent.trim()));
  ok(after.join('|') === 'Konstantinos Stouras|Zuzanna Piskorowska' && before.join('|') !== after.join('|'),
    'phone: the sort chips sort (Name A→Z from the Last-seen default)');
  ok(await phone.$eval('.ur-sortrow .ur-sort[data-sort="name"]', n => n.classList.contains('is-on') && /▲/.test(n.textContent)),
    'phone: the active chip shows the direction');
  ok(await noSidewaysScroll(phone), 'phone: still no sideways scroll after a re-render');
  await phone.evaluate(() => document.getElementById('urAdmin').scrollIntoView());
  await shot(phone, 'feedback-roster-phone.png');
  await phone.close();

  /* ── the Data Analytics tile, phone ── */
  const an = await stubbedPage(390, 844);
  await an.goto(BASE + '/lit/analytics/', { waitUntil: 'domcontentloaded' });
  await an.waitForSelector('#usersStat:not([style*="display: none"])', { timeout: 15000 });
  ok((await an.textContent('#statUsers')).trim() === '4', 'the tile reads the same 4 the roster now reports');
  const tile = await an.$eval('#usersStat', n => {
    const b = n.getBoundingClientRect();
    return { left: b.left, right: b.right, over: n.scrollWidth > n.clientWidth + 1, h: b.height,
             dir: getComputedStyle(n).flexDirection };
  });
  ok(tile.left >= 0 && tile.right <= 390 && !tile.over, 'phone: the tile fits the screen and nothing spills out of it');
  ok(tile.dir === 'column', 'phone: the number sits above its label (stacked layout)');
  ok(await noSidewaysScroll(an), 'phone: the analytics page does not scroll sideways');
  await shot(an, 'analytics-tile-phone.png');
  await an.close();

  /* ── the Data Analytics tile, desktop (unchanged, for the eye) ── */
  const anD = await stubbedPage(1280, 900);
  await anD.goto(BASE + '/lit/analytics/', { waitUntil: 'domcontentloaded' });
  await anD.waitForSelector('#usersStat:not([style*="display: none"])', { timeout: 15000 });
  ok((await anD.textContent('#statUsers')).trim() === '4', 'desktop: the tile reads 4');
  await shot(anD, 'analytics-tile-desktop.png');
  await anD.close();
} catch (e) {
  fails++;
  console.error('  FAIL —', e && e.message);
} finally {
  await browser.close();
  server.close();
}
console.log(fails ? `users-page-guard: ${fails} FAILURE(S)` : 'users-page-guard: all checks passed');
process.exit(fails ? 1 : 0);
