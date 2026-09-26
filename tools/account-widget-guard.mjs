/* ==========================================================================
   Shared account widget — guard (offline)
       node tools/account-widget-guard.mjs            static checks + browser flow
       node tools/account-widget-guard.mjs --static   static checks only (no Playwright)

   Eight pages carry a copy of the same Login / Register widget, all signing in
   to ONE Firebase project (stouras-snake): /fun/snake, /fun/sudoku, /fun/rooks,
   /fun/nomoi, /fun/capitals, /fun/portfoliofitgame, /lab/portfoliofit and
   /lab/portfoliofit-testing. An account made in one works in all of them, so
   the copies must offer the same ways in: a player who registered with Google
   on Capitals and then meets an email-only box on Snake is locked out.

   Static: every copy's script is byte-identical and carries the Google button.
   Browser (Playwright, Firebase replaced by a local stub, no network):
     1. register with Google + a typed nickname -> the nickname is used;
     2. a NEW Google account with no nickname -> only the first name, never the
        full Google name (nicknames are shown on public leaderboards), and the
        app hears ONE account-changed event, with the final nickname;
     3. an existing Google account keeps its stored nickname;
     4. closing the Google window shows nothing; a blocked pop-up and a
        project where Google is not switched on explain themselves;
     5. Firebase unreachable: the button says Google is unavailable, and the
        page does not throw.
   ========================================================================== */
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = ['fun/snake/index.html', 'fun/sudoku/index.html', 'fun/rooks/index.html', 'fun/nomoi/index.html', 'fun/capitals/index.html',
  'fun/portfoliofitgame/index.html', 'lab/portfoliofit/index.html', 'lab/portfoliofit-testing/index.html'];
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) fails++; console.log((c ? '  ok — ' : '  FAIL — ') + m); };

console.log('1. Every copy of the widget is the same, and offers Google');
const scripts = [];
for (const p of PAGES) {
  const s = readFileSync(join(ROOT, p), 'utf8');
  const a = s.indexOf('<!-- ============================================================\n     Account widget');
  const b = s.indexOf('<!-- ===== end Account widget ===== -->');
  ok(a >= 0 && b > a, p + ': has the account widget');
  const blk = s.slice(a, b);
  const m = blk.match(/<script type="module">[\s\S]*?<\/script>/);
  ok(!!m, p + ': widget script found');
  if (!m) continue;
  scripts.push([p, m[0]]);
  ok(blk.includes('data-act="google"') && blk.includes('Continue with Google'), p + ': shows "Continue with Google"');
  ok(/if\(holdAuth\)\{ heldUser = u \|\| null; return; \}/.test(m[0]), p + ': holds the auth event while a sign-in is still naming the account');
  ok(m[0].includes('fns.signInWithPopup(auth, provider)') && m[0].includes('new fns.GoogleAuthProvider()'), p + ': signs in with the Google provider');
  let parses = true; try { new Function(m[0].replace(/^<script type="module">/, '').replace(/<\/script>$/, '')); } catch { parses = false; }
  ok(parses, p + ': widget script parses');
}
ok(scripts.length === PAGES.length && scripts.every(([, x]) => x === scripts[0][1]), 'all ' + PAGES.length + ' copies of the widget script are byte-identical');

if (!process.argv.includes('--static')) {
  const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
  let chromium = null;
  try { ({ chromium } = await import(PW)); } catch { console.log('\n(Playwright not found: browser checks skipped; run with --static to silence)'); }
  if (chromium) await browserChecks(chromium);
}
console.log('\n' + (fails ? 'FAILED — ' + fails + ' of ' + checks + ' checks failed' : 'OK — all ' + checks + ' checks passed'));
process.exit(fails ? 1 : 0);

async function browserChecks(chromium) {
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };
  const srv = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
    catch { res.writeHead(404); res.end('x'); }
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${srv.address().port}/`;
  const APP_STUB = `export function getApps(){ return []; } export function getApp(){ return {}; } export function initializeApp(){ return {}; }`;
  // A stand-in for firebase-auth that behaves like the real one in the ways that matter:
  // the auth-state listener fires BEFORE signInWithPopup resolves.
  const AUTH_STUB = `
    const ctl = window.__fb = window.__fb || { next: null, updates: [], popups: 0 };
    let current = null; const ls = [];
    export function getAuth(){ return {}; }
    export function onAuthStateChanged(a, cb){ ls.push(cb); setTimeout(() => cb(current), 0); return () => {}; }
    export class GoogleAuthProvider { setCustomParameters(p){ this.params = p; } }
    export async function signInWithPopup(a, prov){
      ctl.popups++; ctl.lastParams = prov.params;
      const n = ctl.next || {};
      if (n.error) { const e = new Error(n.error); e.code = n.error; throw e; }
      current = { uid: n.uid || 'u1', email: n.email || 'kostas@example.com', displayName: n.displayName ?? 'Konstantinos Stouras' };
      ls.forEach((cb) => cb(current));
      return { user: current, _new: !!n.isNew };
    }
    export function getAdditionalUserInfo(c){ return { isNewUser: !!c._new }; }
    export async function updateProfile(u, p){ ctl.updates.push(p.displayName); u.displayName = p.displayName; }
    export async function signOut(){ current = null; ls.forEach((cb) => cb(null)); }
    export async function createUserWithEmailAndPassword(a, email){
      if (ctl.next && ctl.next.error) { const e = new Error(ctl.next.error); e.code = ctl.next.error; throw e; }
      current = { uid: 'u2', email, displayName: null };   // like Firebase: signed in, observer fired, no name yet
      ls.forEach((cb) => cb(current));
      return { user: current };
    }
    export async function signInWithEmailAndPassword(){ throw Object.assign(new Error('x'), { code: 'auth/invalid-credential' }); }`;

  for (const page of ['fun/capitals/', 'fun/snake/']) {
    console.log('\n2. Google sign-in on /' + page);
    const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
    const ctx = await br.newContext({ viewport: { width: 1000, height: 800 } });
    // Playwright tries the LAST-registered matching route first: the catch-all goes in first.
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    await ctx.route(/firebasejs\/[\d.]+\/firebase-app\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: APP_STUB }));
    await ctx.route(/firebasejs\/[\d.]+\/firebase-auth\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: AUTH_STUB }));
    const pg = await ctx.newPage();
    const errors = []; pg.on('pageerror', (e) => errors.push(String(e)));
    await pg.addInitScript(() => { window.__events = []; window.addEventListener('account-changed', (e) => window.__events.push(e.detail ? e.detail.nickname : null)); });
    await pg.goto(BASE + page, { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.Account && window.Account.ready, null, { timeout: 8000 });
    const reset = () => pg.evaluate(async () => { await window.Account.logout(); window.__events = []; window.__fb.updates = []; });
    const err = () => pg.evaluate(() => { const e = document.querySelector('#acctRoot .acct-err'); return e && !e.hidden ? e.textContent : ''; });
    const modalOpen = () => pg.evaluate(() => !document.querySelector('#acctRoot [data-modal]').hidden);

    // register + typed nickname
    await pg.evaluate(() => { window.__events = []; window.__fb.next = { isNew: true }; window.Account.openRegister(); });
    ok(await pg.isVisible('#acctRoot .acct-google'), 'the register box shows "Continue with Google"');
    ok((await pg.textContent('#acctRoot .acct-or-txt')) === 'or register with your email', 'divider reads "or register with your email"');
    await pg.fill('#acctRoot .f-nick', 'Kosta');
    await pg.click('#acctRoot .acct-google');
    await pg.waitForFunction(() => window.__events.length > 0);
    let ev = await pg.evaluate(() => window.__events.slice());
    ok(JSON.stringify(ev) === '["Kosta"]', 'register: the app hears one account-changed, nickname "Kosta" (' + JSON.stringify(ev) + ')');
    ok((await pg.evaluate(() => window.__fb.updates.slice())).join() === 'Kosta', 'the typed nickname is saved to the account');
    ok(!(await modalOpen()), 'the box closes');
    ok((await pg.evaluate(() => window.__fb.lastParams && window.__fb.lastParams.prompt)) === 'select_account', 'Google asks which account to use');

    // new Google account, no nickname typed: first name only
    await reset();
    await pg.evaluate(() => { window.__fb.next = { isNew: true, displayName: 'Konstantinos Stouras' }; window.Account.openLogin(); });
    ok((await pg.textContent('#acctRoot .acct-or-txt')) === 'or log in with your email', 'divider reads "or log in with your email"');
    await pg.click('#acctRoot .acct-google');
    await pg.waitForFunction(() => window.__events.length > 0);
    ev = await pg.evaluate(() => window.__events.slice());
    ok(JSON.stringify(ev) === '["Konstantinos"]', 'new Google account: first name only, never the full name (' + JSON.stringify(ev) + ')');
    ok(!ev.includes('Konstantinos Stouras'), 'the full Google name never reaches the app');

    // existing account keeps its nickname
    await reset();
    await pg.evaluate(() => { window.__fb.next = { isNew: false, displayName: 'Kos' }; window.Account.openLogin(); });
    await pg.click('#acctRoot .acct-google');
    await pg.waitForFunction(() => window.__events.length > 0);
    ev = await pg.evaluate(() => window.__events.slice());
    ok(JSON.stringify(ev) === '["Kos"]' && (await pg.evaluate(() => window.__fb.updates.length)) === 0, 'existing account: stored nickname kept, nothing rewritten');

    // errors
    await reset();
    for (const [code, want, label] of [
      ['auth/popup-closed-by-user', '', 'closing the Google window shows no error'],
      ['auth/popup-blocked', 'blocked the Google window', 'a blocked pop-up is explained'],
      ['auth/operation-not-allowed', 'switched on', 'Google not switched on in Firebase is explained'],
      ['auth/unauthorized-domain', 'switched on', 'a domain missing from Firebase is explained the same way'],
      ['auth/account-exists-with-different-credential', 'email and password', 'an email already registered with a password is explained'],
    ]) {
      await pg.evaluate((c) => { window.__events = []; window.__fb.next = { error: c }; window.Account.openLogin(); }, code);
      await pg.click('#acctRoot .acct-google');
      await pg.waitForTimeout(120);
      const e = await err();
      ok(want ? e.includes(want) : e === '', label + (e ? ' ("' + e + '")' : ''));
      ok((await pg.evaluate(() => window.__events.length)) === 0, '  …and no account-changed event');
      ok(await pg.isEnabled('#acctRoot .acct-google'), '  …and the button is usable again');
      await pg.keyboard.press('Escape');
    }
    // e-mail registration: the observer fires before the nickname is saved
    await reset();
    await pg.evaluate(() => { window.__fb.next = {}; window.Account.openRegister(); });
    await pg.fill('#acctRoot .f-nick', 'Jane');
    await pg.fill('#acctRoot .f-email', 'jane.doe.1984@example.com');
    await pg.fill('#acctRoot .f-pass', 'secret123');
    await pg.click('#acctRoot .acct-submit');
    await pg.waitForFunction(() => window.__events.length > 0);
    await pg.waitForTimeout(100);
    ev = await pg.evaluate(() => window.__events.slice());
    ok(JSON.stringify(ev) === '["Jane"]', 'e-mail registration: one account-changed, with the chosen nickname, never the e-mail\'s local part (' + JSON.stringify(ev) + ')');
    await pg.keyboard.press('Escape');
    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await br.close();
  }

  console.log('\n3. Firebase unreachable');
  {
    const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
    const ctx = await br.newContext();
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const pg = await ctx.newPage();
    const errors = []; pg.on('pageerror', (e) => errors.push(String(e)));
    await pg.goto(BASE + 'fun/capitals/', { waitUntil: 'domcontentloaded' });
    await pg.waitForFunction(() => window.Account && window.Account.ready, null, { timeout: 8000 });
    await pg.evaluate(() => window.Account.openLogin());
    await pg.click('#acctRoot .acct-google');
    await pg.waitForTimeout(100);
    const e = await pg.evaluate(() => document.querySelector('#acctRoot .acct-err').textContent);
    ok(/isn.t available right now/.test(e), 'the button says Google is unavailable ("' + e + '")');
    ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
    await br.close();
  }
  srv.close();
}
