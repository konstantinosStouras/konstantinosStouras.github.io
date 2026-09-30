#!/usr/bin/env node
/* SEMFE Alumni: sign-in, account, members and admin flows in CONFIGURED mode.

   tools/smoke.mjs covers the site with sign-in switched OFF (config.js still
   holding PASTE_ values). This test switches it ON without a real Firebase
   project: it serves a copy of assets/js/config.js with a test config appended
   (apiKey 'test-key', projectId 'demo-semfe') and answers the three gstatic
   compat-SDK URLs with tools/firebase-fake.js, an in-memory fake of exactly the
   SDK surface the site calls, which logs every call (window.__fb.calls) and lets
   a scenario script the next outcome (e.g. a popup that fails with
   auth/account-exists-with-different-credential). The site's own auth.js,
   account.js, members.js and admin.js run unchanged.

   Every Firestore write the pages make is also checked against a JavaScript
   mirror of firestore.rules, whose key lists, stage/status lists, admin e-mails
   and length limits are READ from the rules file, so the test notices when the
   page and the rules drift apart (the real rules are exercised against the
   emulator elsewhere; here the question is "does the page send what they accept").

     A. header + dialog; Google / Facebook / LinkedIn(OIDC) providers; new user
        -> account/#apply; name chip + menu; sign out
     B. the admin menu item: verified admin e-mail only
     C. "account exists with a different credential" -> sign in the first way ->
        the second provider is linked
     D. e-mail registration: validation, create + name + verification e-mail
     E. e-mail sign-in: wrong password, forgotten password
     F. account page: signed out, application (create / validate / refused write /
        edit), unverified e-mail, directory listing, linking, deletion
     G. members page: signed out / no application / pending / rejected / active,
        accent-insensitive directory search
     H. admin page: access, approve, dues, reject, CSV export
     I. LinkedIn through the Cloud Function (mode 'function') and its callback
     J. stored XSS: hostile names on the admin, members and account pages

   Usage: node tools/auth-flow.mjs [--only=A,F] [--headed]
   Needs Playwright (Chromium) and python3. No network: every third-party
   request is answered locally. */
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, symlinkSync, unlinkSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw; for (const id of ['playwright', '/opt/node22/lib/node_modules/playwright']) { try { pw = require(id); break; } catch {} }
if (!pw) { console.error('playwright is not installed: npm install playwright'); process.exit(1); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SUB = '/semfealumni/';
const read = f => readFileSync(path.join(ROOT, f), 'utf8');
const ARGS = process.argv.slice(2);
const ONLY = (ARGS.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const HEADED = ARGS.includes('--headed');

/* ---- the site's settings and rules ------------------------------------------ */
const FAKE = read('tools/firebase-fake.js');
const CONFIG_SRC = read('assets/js/config.js');
const C = new Function('window', CONFIG_SRC + '; return window.SEMFE;')({});
const SDK = C.FIREBASE_SDK || '12.19.0';
const ADMIN = String((C.ADMIN_EMAILS || [])[0] || '').toLowerCase();
const YEAR = new Date().getFullYear();
const TEST_FIREBASE = { apiKey: 'test-key', authDomain: 'demo-semfe.firebaseapp.com', projectId: 'demo-semfe',
  storageBucket: 'demo-semfe.firebasestorage.app', messagingSenderId: '1234567890', appId: '1:1234567890:web:0123456789abcdef' };
const FN_URL = 'https://europe-west1-demo-semfe.cloudfunctions.net/linkedinSignIn';
const LI_ID = (C.LINKEDIN && C.LINKEDIN.providerId) || 'oidc.linkedin';
function configFor(kind) {
  let li = null;
  if (kind === 'oidc') li = { mode: 'oidc', providerId: LI_ID, clientId: 'unused', functionUrl: 'unused' };
  if (kind === 'function') li = { mode: 'function', providerId: LI_ID, clientId: 'li-client-123', functionUrl: FN_URL };
  // 'shipped': the LINKEDIN block exactly as committed
  return CONFIG_SRC + '\n/* auth-flow.mjs: sign-in switched on with a test project */\n' +
    'window.SEMFE.FIREBASE = ' + JSON.stringify(TEST_FIREBASE) + ';\n' +
    (li ? 'window.SEMFE.LINKEDIN = ' + JSON.stringify(li) + ';\n' : '');
}

const RULES = read('firestore.rules');
const strList = s => [...String(s || '').matchAll(/'([^']*)'/g)].map(m => m[1]);
const grab = (re, what) => { const m = RULES.match(re); if (!m) throw new Error('firestore.rules: cannot find ' + what); return m; };
const dirBlock = grab(/match \/directory\/\{uid\}\s*\{[\s\S]*?\n    \}/, 'the directory block')[0];
const R = {
  profileKeys: strList(grab(/function profileKeys\(\)\s*\{\s*return\s*\[([\s\S]*?)\]/, 'profileKeys()')[1]),
  adminKeys: strList(grab(/function adminKeys\(\)\s*\{\s*return\s*\[([\s\S]*?)\]/, 'adminKeys()')[1]),
  stages: strList(grab(/d\.stage in \[([^\]]*)\]/, 'the stage list')[1]),
  statuses: strList(grab(/data\.status in \[([^\]]*)\]/, 'the status list')[1]),
  admins: strList(grab(/\.lower\(\) in \[([^\]]*)\]/, 'isAdmin() e-mails')[1]),
  nameMax: +grab(/function name\(v\)[^}]*?v\.size\(\) <= (\d+)/, 'name()')[1],
  year: grab(/function year\(v\)[^}]*?v >= (\d+) && v <= (\d+)/, 'year()').slice(1, 3).map(Number),
  max: Object.fromEntries([...grab(/function validProfile\(d\)[\s\S]*?;\s*\n    \}/, 'validProfile()')[0].matchAll(/str\(d\.(\w+),\s*(\d+)\)/g)].map(m => [m[1], +m[2]])),
  dirKeys: strList(grab(/match \/directory\/\{uid\}[\s\S]*?keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/, 'directory keys')[1]),
  dirMax: Object.fromEntries([...dirBlock.matchAll(/str\(request\.resource\.data\.(\w+),\s*(\d+)\)/g)].map(m => [m[1], +m[2]])),
  dirNameMax: +(dirBlock.match(/data\.name\.size\(\) <= (\d+)/) || [0, 161])[1]
};

/* ---- a JavaScript mirror of the write rules, over the RECORDED payloads -------
   (serverTimestamp() is recorded as {__fv:'serverTimestamp'}, arrayUnion as
   {__fv:'arrayUnion', els:[…]}; stored Timestamps as {__ts: ms}) */
const isST = v => !!v && v.__fv === 'serverTimestamp';
const js = v => JSON.stringify(v);
function profileProblems(d) {
  const p = [];
  for (const k of ['firstName', 'lastName']) if (!(typeof d[k] === 'string' && d[k].length > 0 && d[k].length <= R.nameMax)) p.push(`${k} must be a 1..${R.nameMax} string (${js(d[k])})`);
  for (const [k, n] of Object.entries(R.max)) if (!(typeof d[k] === 'string' && d[k].length <= n)) p.push(`${k} must be a string <= ${n} (${js(d[k])})`);
  if (!R.stages.includes(d.stage)) p.push(`stage ${js(d.stage)} not in ${js(R.stages)}`);
  for (const k of ['entryYear', 'gradYear']) if (!(d[k] === null || (Number.isInteger(d[k]) && d[k] >= R.year[0] && d[k] <= R.year[1]))) p.push(`${k} must be null or an int ${R.year.join('..')} (${js(d[k])})`);
  for (const k of ['consentNewsletter', 'consentJobs', 'consentDirectory']) if (typeof d[k] !== 'boolean') p.push(`${k} must be a bool (${js(d[k])})`);
  if (d.acceptedPrivacy !== true) p.push('acceptedPrivacy must be true');
  return p;
}
function createProblems(d) {
  const keys = Object.keys(d), allowed = [...R.profileKeys, 'status'];
  const p = [];
  const extra = keys.filter(k => !allowed.includes(k)), missing = R.profileKeys.filter(k => !keys.includes(k));
  if (extra.length) p.push('keys the rules do not allow: ' + extra.join(', '));
  if (missing.length) p.push('keys the rules require but missing: ' + missing.join(', '));
  p.push(...profileProblems(d));
  if (d.status !== 'pending') p.push('status must be "pending"');
  if (!isST(d.createdAt)) p.push('createdAt must be serverTimestamp()');
  if (!isST(d.updatedAt)) p.push('updatedAt must be serverTimestamp()');
  return p;
}
const changed = (before, patch) => Object.keys(patch).filter(k => js(before[k]) !== js(patch[k]));
function ownerUpdateProblems(before, patch) {
  const merged = { ...before, ...patch }, p = [];
  const extra = Object.keys(merged).filter(k => ![...R.profileKeys, ...R.adminKeys].includes(k));
  if (extra.length) p.push('keys the rules do not allow: ' + extra.join(', '));
  p.push(...profileProblems(merged));
  const bad = changed(before, patch).filter(k => [...R.adminKeys, 'createdAt'].includes(k));
  if (bad.length) p.push('an owner may not change: ' + bad.join(', '));
  if (!isST(patch.updatedAt)) p.push('updatedAt must be serverTimestamp()');
  return p;
}
function adminUpdateProblems(before, patch, email) {
  const p = [];
  const bad = changed(before, patch).filter(k => !R.adminKeys.includes(k));
  if (bad.length) p.push('an admin may only change admin fields, not: ' + bad.join(', '));
  const status = 'status' in patch ? patch.status : before.status;
  if (!R.statuses.includes(status)) p.push(`status ${js(status)} not in ${js(R.statuses)}`);
  if ('duesYears' in patch && !(Array.isArray(patch.duesYears) || (patch.duesYears && /^array(Union|Remove)$/.test(patch.duesYears.__fv)))) p.push('duesYears must be a list');
  if (!isST(patch.reviewedAt)) p.push('reviewedAt must be serverTimestamp()');
  if (patch.reviewedBy !== email) p.push(`reviewedBy must equal the token e-mail ${email} (${js(patch.reviewedBy)})`);
  return p;
}
function dirProblems(d) {
  const p = [];
  const extra = Object.keys(d).filter(k => !R.dirKeys.includes(k));
  if (extra.length) p.push('keys the rules do not allow: ' + extra.join(', '));
  if (!(typeof d.name === 'string' && d.name.length > 0 && d.name.length <= R.dirNameMax)) p.push('name must be a 1..' + R.dirNameMax + ' string');
  if (!(d.gradYear === null || (Number.isInteger(d.gradYear) && d.gradYear >= R.year[0] && d.gradYear <= R.year[1]))) p.push('gradYear must be null or an int');
  for (const [k, n] of Object.entries(R.dirMax)) if (!(typeof d[k] === 'string' && d[k].length <= n)) p.push(`${k} must be a string <= ${n}`);
  if (!isST(d.updatedAt)) p.push('updatedAt must be serverTimestamp()');
  return p;
}

/* ---- the server: GitHub Pages under /semfealumni/ ----------------------------- */
const PY = String.raw`
import http.server, sys
root = sys.argv[1]
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=root, **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
class S(http.server.ThreadingHTTPServer):
    daemon_threads = True
    def handle_error(self, request, client_address): pass
srv = S(('127.0.0.1', 0), H)
print(srv.server_address[1], flush=True)
srv.serve_forever()
`;
const TMP = mkdtempSync(path.join(os.tmpdir(), 'semfe-authflow-'));
const LINK = path.join(TMP, 'semfealumni');
symlinkSync(ROOT, LINK, 'dir');
const srv = spawn('python3', ['-c', PY, TMP], { stdio: ['ignore', 'pipe', 'inherit'] });
const cleanup = () => { try { srv.kill(); } catch {} try { unlinkSync(LINK); rmdirSync(TMP); } catch {} };
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
const PORT = await new Promise((resolve, reject) => {
  let buf = '';
  srv.stdout.on('data', d => { buf += d; const m = buf.match(/^(\d+)\s/); if (m) resolve(+m[1]); });
  srv.on('exit', c => reject(new Error('python3 server exited with ' + c)));
  setTimeout(() => reject(new Error('python3 server did not start')), 10000);
});
const ORIGIN = `http://127.0.0.1:${PORT}`;
const URL_ = p => ORIGIN + SUB + p;

/* ---- reporting ------------------------------------------------------------------ */
let fails = 0, passes = 0;
const failed = [];
let current = '';
const t = (c, m) => { console.log((c ? 'ok    ' : 'FAIL  ') + m); if (c) passes++; else { fails++; failed.push(current + ': ' + m); } return !!c; };
const note = m => console.log('note  ' + m);
const list = (a, n = 5) => a.length ? ': ' + a.slice(0, n).map(String).join(' | ') + (a.length > n ? ` | … +${a.length - n} more` : '') : '';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- fixtures ------------------------------------------------------------------- */
const HOUR = 3600e3, DAY = 24 * HOUR;
const ts = ms => ({ __ts: ms });
function acct(uid, o) {
  return { uid, email: o.email, displayName: o.name == null ? null : o.name, photoURL: o.photo || null,
    emailVerified: o.verified == null ? true : o.verified, password: o.password,
    providers: (o.providers || ['google.com']).map(p => ({ providerId: p, uid: p + ':' + o.email, email: o.email })),
    created: Date.now() - 40 * DAY, lastSignIn: o.lastSignIn || Date.now() - 2 * HOUR, claims: o.claims || {} };
}
function member(o) {
  return Object.assign({ firstName: 'Όνομα', lastName: 'Επώνυμο', email: 'x@example.com', phone: '', stage: 'graduate', entryYear: 2005, gradYear: 2010,
    direction: 'Εφαρμοσμένη Φυσική', employer: '', position: '', city: 'Αθήνα', linkedin: '', note: '',
    consentNewsletter: true, consentJobs: false, consentDirectory: false, acceptedPrivacy: true, provider: 'google.com',
    status: 'pending', createdAt: ts(Date.now() - 10 * DAY), updatedAt: ts(Date.now() - 10 * DAY) }, o);
}
function dirEntry(o) {
  return Object.assign({ name: 'Όνομα Επώνυμο', gradYear: 2010, direction: '', employer: '', position: '', city: '', linkedin: '', updatedAt: ts(Date.now() - DAY) }, o);
}
const MARIA = { uid: 'u-maria', email: 'maria@example.com', name: 'Μαρία Παπαδοπούλου' };
const XSS = '<img src=x onerror=window.__xss=1>';

/* ---- one scenario = one fresh browser context ------------------------------------ */
const browser = await pw.chromium.launch({ headless: !HEADED });
async function scenario(id, title, opts, fn) {
  if (ONLY.length && !ONLY.includes(id[0])) return;
  current = id;
  console.log(`\n== ${id}. ${title}`);
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, acceptDownloads: true, locale: 'el-GR',
    viewport: opts.viewport || { width: 1280, height: 900 } });
  const env = { sdkUrls: [], external: [], dialogs: [], dialogPolicy: 'accept', onExternal: null, fnRequests: [] };
  await ctx.route(u => !u.href.startsWith(ORIGIN + '/'), async route => {
    const url = route.request().url();
    if (/^https:\/\/www\.gstatic\.com\/firebasejs\//.test(url)) {
      env.sdkUrls.push(url);
      if (opts.sdkDelayMs) await sleep(opts.sdkDelayMs);
      if (/\/firebase-(app|auth|firestore)-compat\.js$/.test(url)) return route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: FAKE });
      return route.fulfill({ status: 404, body: '' });
    }
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (env.onExternal && await env.onExternal(route, url)) return;
    env.external.push(url);
    return route.fulfill({ status: 204, body: '' });
  });
  await ctx.route(u => u.href.startsWith(ORIGIN + SUB + 'assets/js/config.js'), route =>
    route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body: configFor(opts.cfg || 'oidc') }));
  const seed = Object.assign({ accounts: {}, docs: {}, currentUid: null, queue: [], calls: [] }, opts.seed || {});
  await ctx.addInitScript(s => { try { if (!localStorage.getItem('__fbfake')) localStorage.setItem('__fbfake', JSON.stringify(s)); } catch (e) {} }, seed);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { env.dialogs.push({ type: d.type(), message: d.message() }); if (env.dialogPolicy === 'accept') await d.accept(); else await d.dismiss(); });
  try { await fn(page, env, ctx); }
  catch (e) { t(false, 'scenario threw: ' + String(e && e.stack || e).split('\n').slice(0, 3).join(' / ')); }
  t(errors.length === 0, 'no script errors on the page' + list(errors));
  await ctx.close();
}

/* ---- page helpers ------------------------------------------------------------------ */
const fbState = page => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('__fbfake') || '{}'); } catch (e) { return {}; } });
const calls = async (page, api) => { const c = (await fbState(page)).calls || []; return api ? c.filter(x => x.api === api) : c; };
const docOf = async (page, p) => { const d = (await fbState(page)).docs || {}; return d[p] === undefined ? null : d[p]; };
const server = (page, method, ...args) => page.evaluate(([m, a]) => window.__fb.server[m].apply(null, a), [method, args]);
const queue = (page, op, spec) => page.evaluate(([o, s]) => window.__fb.queue(o, s), [op, spec]);
async function waitFor(page, fn, arg, ms = 6000) { try { await page.waitForFunction(fn, arg, { timeout: ms }); return true; } catch { return false; } }
async function visible(loc, ms = 6000) { try { await loc.first().waitFor({ state: 'visible', timeout: ms }); return true; } catch { return false; } }
async function hidden(loc, ms = 6000) { try { await loc.first().waitFor({ state: 'hidden', timeout: ms }); return true; } catch { return false; } }
async function text(loc) { try { return (await loc.first().innerText({ timeout: 3000 })).replace(/\s+/g, ' ').trim(); } catch { return null; } }
async function hasText(loc, s, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) { const x = await text(loc); if (x != null && x.indexOf(s) !== -1) return true; if (Date.now() > end) return false; await sleep(60); }
}
const sdkReady = page => waitFor(page, () => !!(window.__fb && window.firebase && window.firebase.apps && window.firebase.apps.length && window.firebase.auth), null, 8000);
async function waitCalls(page, api, n = 1, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) { const c = await calls(page, api); if (c.length >= n) return c; if (Date.now() > end) return c; await sleep(50); }
}
async function openDialog(page, mode) {
  await page.click('#acct-slot [data-signin]');
  const ok = await visible(page.locator('.modal-backdrop'));
  if (mode === 'register') await page.click('#tab-register');
  await sdkReady(page);
  await sleep(30);
  return ok;
}
const status = page => text(page.locator('.modal [data-status]'));
const dialogOpen = page => page.evaluate(() => { const b = document.querySelector('.modal-backdrop'); return !!b && !b.hidden; });
const chipName = page => text(page.locator('#acct-slot .acct-chip .nm'));
const flashText = page => page.evaluate(() => Array.from(document.querySelectorAll('body > .notice.ok[role=status]')).map(e => e.textContent).join(' | '));
const xssFired = page => page.evaluate(() => window.__xss !== undefined);
const signedInSeed = (a, extra) => Object.assign({ accounts: { [a.uid]: a }, currentUid: a.uid }, extra || {});

/* ================================================================================== */
await scenario('A', 'header, dialog, providers, a new Google user, the menu, signing out', { cfg: 'oidc' }, async (page, env) => {
  await page.goto(URL_(''));
  t(await visible(page.locator('#acct-slot [data-signin]')), 'header shows the «Σύνδεση» button');
  t((await text(page.locator('#acct-slot [data-signin]'))) === 'Σύνδεση', 'its label is «Σύνδεση»');
  t(await openDialog(page), 'clicking it opens the sign-in dialog');
  t(env.sdkUrls.some(u => u === `https://www.gstatic.com/firebasejs/${SDK}/firebase-app-compat.js`) &&
    env.sdkUrls.some(u => u === `https://www.gstatic.com/firebasejs/${SDK}/firebase-auth-compat.js`),
    `the compat SDK ${SDK} (app + auth) is loaded from gstatic` + list(env.sdkUrls));
  t(!env.sdkUrls.some(u => /firestore/.test(u)), 'the home page does not load Firestore');
  const init = await calls(page, 'app.initializeApp');
  t(init.length === 1 && init[0].args[0].apiKey === 'test-key' && init[0].args[0].projectId === 'demo-semfe', 'initializeApp is called once, with the config from config.js');
  t((await calls(page, 'auth.languageCode=')).some(c => c.args[0] === 'el'), 'auth.languageCode is set to el');
  t((await text(page.locator('#auth-title'))) === 'Σύνδεση', 'the dialog title is «Σύνδεση»');
  t(!(await page.locator('.modal [data-offline]').count()), 'no "opens soon" notice when configured');
  const provs = await page.$$eval('.modal [data-provider]', bs => bs.map(b => ({ k: b.getAttribute('data-provider'), dis: b.disabled })));
  t(js(provs.map(p => p.k)) === js(['google', 'facebook', 'linkedin']), 'Google, Facebook and LinkedIn buttons, in config order' + list(provs.map(p => p.k)));
  t(provs.length && provs.every(p => !p.dis), 'every provider button is enabled');
  t(!(await page.$eval('.modal [data-submit]', b => b.disabled)), 'the e-mail submit button is enabled');

  // LinkedIn (OIDC mode) — and a popup the person closes shows nothing
  await queue(page, 'signInWithPopup', { provider: LI_ID, reject: { code: 'auth/popup-closed-by-user' } });
  await page.click('.modal [data-provider="linkedin"]');
  let c = await waitCalls(page, 'auth.signInWithPopup', 1);
  const li = c[0] && c[0].args[0];
  t(li && li.__provider === 'oidc.linkedin', 'LinkedIn uses the OIDC provider id "oidc.linkedin"' + list([js(li && li.__provider)]));
  t(li && ['openid', 'profile', 'email'].every(s => li.scopes.includes(s)), 'LinkedIn asks for the scopes openid, profile, email' + list([js(li && li.scopes)]));
  t(c[0] && c[0].userActivation === true, 'signInWithPopup is called inside the click (user activation still active)');
  await sleep(150);
  t((await status(page)) === '', 'auth/popup-closed-by-user shows no error');
  t(await page.$eval('.modal [data-link-notice]', e => e.hidden), '… and no notice');
  t(!(await page.$eval('.modal [data-provider="linkedin"]', b => b.disabled)) && (await text(page.locator('.modal [data-provider="linkedin"] span'))) === 'Συνέχεια με LinkedIn',
    '… and the LinkedIn button is enabled again with its label restored');

  // Facebook: the email scope
  await queue(page, 'signInWithPopup', { provider: 'facebook.com', reject: { code: 'auth/cancelled-popup-request' } });
  await page.click('.modal [data-provider="facebook"]');
  c = await waitCalls(page, 'auth.signInWithPopup', 2);
  const fb = c[1] && c[1].args[0];
  t(fb && fb.__provider === 'facebook.com' && fb.scopes.includes('email'), 'Facebook uses facebook.com with the scope "email"' + list([js(fb)]));
  await sleep(100);
  t((await status(page)) === '', 'auth/cancelled-popup-request shows no error either');

  // Google, a first-time user
  await queue(page, 'signInWithPopup', { provider: 'google.com', resolve: { uid: MARIA.uid, email: MARIA.email, displayName: MARIA.name, emailVerified: true } });
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'account/', { timeout: 8000 }).catch(() => {}), page.click('.modal [data-provider="google"]')]);
  c = await calls(page, 'auth.signInWithPopup');
  const g = c[2] && c[2].args[0];
  t(g && g.__provider === 'google.com' && g.customParameters.prompt === 'select_account', 'Google uses google.com with prompt=select_account' + list([js(g)]));
  const u = new URL(page.url());
  t(u.pathname === SUB + 'account/' && u.hash === '#apply', 'a new user lands on account/#apply' + list([page.url()]));
  t(await visible(page.locator('#account-app form[data-apply]')), 'the account page shows the membership application');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), MARIA.name), 'the header chip shows the name «' + MARIA.name + '»');
  t((await page.inputValue('#f-firstName')) === 'Μαρία' && (await page.inputValue('#f-lastName')) === 'Παπαδοπούλου' && (await page.inputValue('#f-email')) === MARIA.email,
    'the form is prefilled with the first name, last name and e-mail from Google');

  // the account menu
  const menu = page.locator('#acct-menu');
  t(await menu.isHidden(), 'the account menu starts closed');
  await page.click('#acct-slot .acct-chip');
  t(await menu.isVisible(), 'clicking the chip opens the menu');
  t((await page.getAttribute('#acct-slot .acct-chip', 'aria-expanded')) === 'true', '… and sets aria-expanded=true');
  const items = await page.$$eval('#acct-menu a, #acct-menu button', es => es.map(e => e.textContent.trim()));
  t(items.includes('Ο λογαριασμός μου') && items.includes('Περιοχή μελών') && items.includes('Αποσύνδεση'), 'the menu lists account, members area and sign out' + list(items));
  t(!items.some(x => /Διαχείριση/.test(x)), 'no «Διαχείριση» item for a non-admin');
  t(await hasText(page.locator('#acct-menu .who'), MARIA.email), 'the menu says who is signed in (e-mail)');
  await page.mouse.click(5, 450);
  t(await menu.isHidden(), 'a click outside closes the menu');
  await page.click('#acct-slot .acct-chip');
  await page.keyboard.press('Escape');
  t(await menu.isHidden(), 'Escape closes the menu');
  t(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('acct-chip')), '… and returns focus to the chip');
  t(await page.evaluate(() => !!localStorage.getItem('semfe:auth-hint')), 'a header hint is kept for the next page');

  // signing out (on the account page the page reloads)
  await page.click('#acct-slot .acct-chip');
  await Promise.all([page.waitForEvent('load', { timeout: 8000 }).catch(() => {}), page.click('#acct-menu [data-signout]')]);
  t((await calls(page, 'auth.signOut')).length === 1, 'Αποσύνδεση calls auth.signOut()');
  t(await visible(page.locator('#acct-slot [data-signin]')), 'after signing out the header shows «Σύνδεση» again');
  t(await hasText(page.locator('#account-app'), 'Συνδεθείτε ή δημιουργήστε λογαριασμό'), 'the account page shows its signed-out state');
  t(await page.evaluate(() => !localStorage.getItem('semfe:auth-hint')), 'the header hint is cleared');

  // links that open the dialog
  await page.goto(URL_('?signin'));
  t(await visible(page.locator('.modal-backdrop')) && (await text(page.locator('#auth-title'))) === 'Σύνδεση', '?signin opens the dialog in sign-in mode');
  await page.goto(URL_('#register'));
  t(await visible(page.locator('.modal-backdrop')) && (await text(page.locator('#auth-title'))) === 'Νέος λογαριασμός', '#register opens it in register mode');
  await page.keyboard.press('Escape');
  t(await hidden(page.locator('.modal-backdrop')), 'Escape closes the dialog');
});

/* ================================================================================== */
await scenario('B', 'the «Διαχείριση» menu item appears only for a VERIFIED admin e-mail', { cfg: 'oidc',
  seed: signedInSeed(acct('u-admin', { email: ADMIN, name: 'Διαχειριστής', verified: true, providers: ['google.com'] })) }, async (page) => {
  t(ADMIN && R.admins.map(x => x.toLowerCase()).includes(ADMIN), `ADMIN_EMAILS[0] (${ADMIN}) is also in isAdmin() of firestore.rules`);
  await page.goto(URL_(''));
  t(await visible(page.locator('#acct-slot .acct-chip'), 8000), 'a returning signed-in admin gets the name chip');
  await page.click('#acct-slot .acct-chip');
  const link = page.locator('#acct-menu a[href$="admin/"]');
  t(await link.count() === 1 && /Διαχείριση/.test(await text(link)), 'a verified admin e-mail sees «Διαχείριση μελών»');
  // sign out on a normal page: no reload, header back to Σύνδεση
  await page.click('#acct-menu [data-signout]');
  t(await visible(page.locator('#acct-slot [data-signin]')), 'signing out on the home page puts «Σύνδεση» back');
  t(page.url() === URL_(''), '… without leaving the page');
  // the same address, NOT verified (an e-mail + password account that never confirmed)
  await server(page, 'setAccount', 'u-admin2', acct('u-admin2', { email: ADMIN.toUpperCase(), name: 'Ψεύτικος Διαχειριστής', verified: false, providers: ['password'], password: 'pass-word-123' }));
  await server(page, 'setAccount', 'u-admin', { email: 'old-' + ADMIN });   // free the address for the unverified one
  await openDialog(page);
  await page.fill('#auth-email', ADMIN.toUpperCase());
  await page.fill('#auth-pass', 'pass-word-123');
  await page.click('.modal [data-submit]');
  t(await visible(page.locator('#acct-slot .acct-chip')), 'the unverified account signs in');
  await page.click('#acct-slot .acct-chip');
  t(await page.locator('#acct-menu a[href$="admin/"]').count() === 0, 'the same admin address, unverified, gets NO «Διαχείριση» item');
});

/* ================================================================================== */
await scenario('C', 'same e-mail, second provider: sign in the first way, then the second is linked', { cfg: 'oidc',
  seed: { accounts: { [MARIA.uid]: acct(MARIA.uid, { email: MARIA.email, name: MARIA.name, providers: ['google.com'] }) } } }, async (page) => {
  await page.goto(URL_(''));
  await openDialog(page);
  const cred = { providerId: 'facebook.com', signInMethod: 'facebook.com', accessToken: 'fb-access-token-123' };
  await queue(page, 'signInWithPopup', { provider: 'facebook.com', reject: { code: 'auth/account-exists-with-different-credential', credential: cred, email: MARIA.email } });
  await page.click('.modal [data-provider="facebook"]');
  const notice = page.locator('.modal [data-link-notice]');
  t(await visible(notice), 'the «you already have an account» notice appears');
  t(await hasText(notice, 'Έχετε ήδη λογαριασμό με το ' + MARIA.email), '… naming the address');
  t(await hasText(notice, 'Facebook'), '… and the provider it will link afterwards');
  t((await page.inputValue('#auth-email')) === MARIA.email, 'the e-mail field is prefilled with that address');
  t((await status(page)) === '', 'no error text besides the notice');
  await queue(page, 'signInWithPopup', { provider: 'google.com', resolve: { email: MARIA.email } });
  await page.click('.modal [data-provider="google"]');
  const lk = await waitCalls(page, 'user.linkWithCredential', 1);
  t(lk.length === 1 && js(lk[0].args[0]) === js(cred), 'after the Google sign-in, linkWithCredential() gets the SAVED Facebook credential' + list(lk.map(x => js(x.args[0]))));
  const all = await calls(page);
  const gi = all.findIndex(x => x.api === 'auth.signInWithPopup' && x.args[0].__provider === 'google.com');
  t(gi !== -1 && lk[0] && gi < lk[0].i, '… after, not before, signing in');
  t(await waitFor(page, () => /Το Facebook συνδέθηκε με τον λογαριασμό σας/.test(Array.from(document.querySelectorAll('body > .notice.ok[role=status]')).map(e => e.textContent).join(' '))),
    'a success toast says Facebook is now linked' + list([await flashText(page)]));
  t(!(await dialogOpen(page)), 'the dialog closes');
  t(new URL(page.url()).pathname === SUB, 'an existing user stays on the page');
  const a = (await fbState(page)).accounts[MARIA.uid];
  t(a && a.providers.map(p => p.providerId).sort().join() === 'facebook.com,google.com', 'the ONE account now opens with Google and Facebook');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), MARIA.name), 'the header chip shows the name');
});

/* ================================================================================== */
await scenario('D', 'e-mail registration: validation, account, name, verification e-mail', { cfg: 'oidc',
  seed: { accounts: { 'u-taken': acct('u-taken', { email: 'taken@example.com', providers: ['password'], password: 'whatever-123' }) } } }, async (page) => {
  await page.goto(URL_(''));
  await openDialog(page, 'register');
  t((await text(page.locator('#auth-title'))) === 'Νέος λογαριασμός', 'the «Εγγραφή» tab switches to «Νέος λογαριασμός»');
  t(await page.locator('#auth-first').isVisible() && await page.locator('#auth-last').isVisible(), 'first and last name fields appear');
  t((await text(page.locator('.modal [data-submit]'))) === 'Δημιουργία λογαριασμού', 'the button says «Δημιουργία λογαριασμού»');
  t(await page.locator('.modal [data-forgot]').isHidden(), '«Ξεχάσατε τον κωδικό;» is hidden while registering');
  t((await page.getAttribute('#auth-pass', 'autocomplete')) === 'new-password', 'the password field asks the browser for a NEW password');
  const submit = () => page.click('.modal [data-submit]');
  const inval = sel => page.getAttribute(sel, 'aria-invalid');
  await submit();
  t((await status(page)) === 'Γράψτε το όνομά σας.' && (await inval('#auth-first')) === 'true', 'empty first name: «Γράψτε το όνομά σας.»');
  await page.fill('#auth-first', 'Γιώργος');
  await submit();
  t((await status(page)) === 'Γράψτε το επώνυμό σας.' && (await inval('#auth-last')) === 'true', 'empty last name: «Γράψτε το επώνυμό σας.»');
  await page.fill('#auth-last', 'Νικολάου');
  await page.fill('#auth-email', 'not-an-email');
  await submit();
  t((await status(page)) === 'Γράψτε μια έγκυρη διεύθυνση e-mail.' && (await inval('#auth-email')) === 'true', 'invalid e-mail: «Γράψτε μια έγκυρη διεύθυνση e-mail.»');
  await page.fill('#auth-email', 'giorgos@example.com');
  await submit();
  t((await status(page)) === 'Γράψτε τον κωδικό σας.', 'no password: «Γράψτε τον κωδικό σας.»');
  await page.fill('#auth-pass', 'short1');
  await submit();
  t((await status(page)) === 'Ο κωδικός χρειάζεται τουλάχιστον 8 χαρακτήρες.' && (await inval('#auth-pass')) === 'true', 'a 6-character password: «… τουλάχιστον 8 χαρακτήρες.»');
  t((await calls(page, 'auth.createUserWithEmailAndPassword')).length === 0, 'nothing reaches Firebase while the form is invalid');
  await page.click('.modal [data-pw]');
  t((await page.getAttribute('#auth-pass', 'type')) === 'text' && (await page.getAttribute('.modal [data-pw]', 'aria-pressed')) === 'true', 'the «Εμφάνιση» button shows the password');
  await page.click('.modal [data-pw]');
  // an address that already has an account
  await page.fill('#auth-email', 'taken@example.com');
  await page.fill('#auth-pass', 'correct-horse-9');
  await submit();
  t(await hasText(page.locator('.modal [data-status]'), 'Υπάρχει ήδη λογαριασμός με αυτό το e-mail'), 'an address in use gives the Greek «already in use» message');
  // the real thing
  await page.fill('#auth-email', 'giorgos@example.com');
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'account/', { timeout: 8000 }).catch(() => {}), submit()]);
  const all = await calls(page);
  const cr = all.filter(x => x.api === 'auth.createUserWithEmailAndPassword').pop();
  const up = all.filter(x => x.api === 'user.updateProfile').pop();
  const ve = all.filter(x => x.api === 'user.sendEmailVerification').pop();
  t(cr && cr.args[0] === 'giorgos@example.com' && cr.args[1] === 'correct-horse-9', 'createUserWithEmailAndPassword(e-mail, password)');
  t(up && up.args[0].displayName === 'Γιώργος Νικολάου', 'updateProfile({displayName: "First Last"})' + list([js(up && up.args[0])]));
  t(ve && ve.args[0] && ve.args[0].url === ORIGIN + SUB + 'account/', 'sendEmailVerification() with a continue URL back to /semfealumni/account/' + list([js(ve && ve.args[0])]));
  t(cr && up && ve && cr.i < up.i && up.i < ve.i, '… in that order: create, name, verification e-mail');
  const u = new URL(page.url());
  t(u.pathname === SUB + 'account/' && u.hash === '#apply', 'the new account lands on account/#apply');
  t(await hasText(page.locator('#account-app'), 'Επιβεβαιώστε το e-mail σας'), 'it is asked to confirm the e-mail');
  t(await visible(page.locator('#account-app form[data-apply]')) && await page.$eval('#account-app form[data-apply] [type=submit]', b => b.disabled), 'the application form is there but its submit button is disabled');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), 'Γιώργος Νικολάου'), 'the header chip shows the new name');
});

/* ================================================================================== */
await scenario('E', 'e-mail sign-in: wrong password, forgotten password, success', { cfg: 'oidc',
  seed: { accounts: { 'u-eleni': acct('u-eleni', { email: 'eleni@example.com', name: 'Ελένη Σταύρου', providers: ['password'], password: 'right-password-1' }) } } }, async (page) => {
  await page.goto(URL_(''));
  await openDialog(page);
  await page.fill('#auth-email', 'eleni@example.com');
  await page.fill('#auth-pass', 'wrong-password');
  await page.click('.modal [data-submit]');
  t(await hasText(page.locator('.modal [data-status]'), 'Λάθος e-mail ή κωδικός. Αν δημιουργήσατε τον λογαριασμό σας με Google, Facebook ή LinkedIn'),
    'a wrong password gives the Greek auth/invalid-credential message' + list([await status(page)]));
  t(!(await page.$eval('.modal [data-submit]', b => b.disabled)), 'the button is enabled again for another try');
  await page.fill('#auth-email', '');
  await page.click('.modal [data-forgot]');
  t((await status(page)) === 'Γράψτε πρώτα το e-mail σας παραπάνω και πατήστε ξανά «Ξεχάσατε τον κωδικό;».', 'forgot password with no e-mail asks for the e-mail first');
  t((await page.getAttribute('#auth-email', 'aria-invalid')) === 'true', '… and marks the e-mail field');
  t((await calls(page, 'auth.sendPasswordResetEmail')).length === 0, '… without calling Firebase');
  await page.fill('#auth-email', 'eleni@example.com');
  await page.click('.modal [data-forgot]');
  const rs = await waitCalls(page, 'auth.sendPasswordResetEmail', 1);
  t(rs.length === 1 && rs[0].args[0] === 'eleni@example.com' && rs[0].args[1] && rs[0].args[1].url === ORIGIN + SUB + 'account/', 'with an e-mail it calls sendPasswordResetEmail(e-mail, {url: …/semfealumni/account/})' + list(rs.map(x => js(x.args))));
  t(await hasText(page.locator('.modal .form-ok[data-status]'), 'σας στείλαμε σύνδεσμο για νέο κωδικό'), '… and says a link was sent (green)');
  await page.fill('#auth-pass', 'right-password-1');
  await page.click('.modal [data-submit]');
  t(await hidden(page.locator('.modal-backdrop')), 'the right password signs in and closes the dialog');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), 'Ελένη Σταύρου'), 'the header chip shows the name');
  t(new URL(page.url()).pathname === SUB, 'an existing account stays on the page');
});

/* ================================================================================== */
await scenario('F1', 'account page, signed out', { cfg: 'oidc' }, async (page) => {
  await page.goto(URL_('account/'));
  const app = page.locator('#account-app');
  t(await hasText(app, 'Συνδεθείτε ή δημιουργήστε λογαριασμό'), 'the signed-out panel');
  await page.click('#account-app [data-open="register"]');
  t(await visible(page.locator('.modal-backdrop')) && (await text(page.locator('#auth-title'))) === 'Νέος λογαριασμός', '«Νέος λογαριασμός» opens the dialog in register mode');
  await page.click('.modal [data-close]');
  await page.click('#account-app [data-open="signin"]');
  t(await visible(page.locator('.modal-backdrop')) && (await text(page.locator('#auth-title'))) === 'Σύνδεση', '«Έχω ήδη λογαριασμό» opens it in sign-in mode');
  await page.goto(URL_(''));                        // a fresh load, not a same-page #hash change
  await page.goto(URL_('account/#apply'));
  t(await visible(page.locator('.modal-backdrop')) && (await text(page.locator('#auth-title'))) === 'Νέος λογαριασμός', 'account/#apply, signed out, opens the register dialog');
});

const mariaAcct = (o) => acct(MARIA.uid, Object.assign({ email: MARIA.email, name: MARIA.name, providers: ['google.com'] }, o || {}));
await scenario('F2', 'account page: the application (validate, refused write, create, edit), linking a provider', { cfg: 'oidc', seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('account/'));
  const form = page.locator('#account-app form[data-apply]');
  t(await visible(form), 'signed in with no application: the form is shown');
  t(await hasText(page.locator('#account-app .profile-head'), 'Χωρίς αίτηση'), '… with the «Χωρίς αίτηση» badge');
  const msg = page.locator('#account-app [data-form-msg]');
  const submit = () => page.click('#account-app form[data-apply] [type=submit]');
  const good = { firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: MARIA.email, phone: '6900000000', stage: 'graduate', direction: 'Εφαρμοσμένα Μαθηματικά',
    entryYear: '2008', gradYear: '2013', position: 'Data Scientist', employer: 'ACME', city: 'Αθήνα', linkedin: 'linkedin.com/in/maria-p', note: 'Γεια σας' };
  async function fill(v) {
    for (const [k, val] of Object.entries(v)) {
      if (k === 'stage' || k === 'direction') await page.selectOption('#f-' + k, val);
      else await page.fill('#f-' + k, val);
    }
  }
  const bad = async (patch, check, expect, label) => {
    await fill(Object.assign({}, good, patch));
    await page.setChecked('#f-acceptedPrivacy', check);
    await submit();
    const m = await text(msg);
    t(m === expect, label + ': «' + expect + '»' + (m === expect ? '' : list([m])));
  };
  await bad({ firstName: '' }, true, 'Γράψτε το όνομά σας.', 'missing first name');
  t((await page.getAttribute('#f-firstName', 'aria-invalid')) === 'true', '… and the field is marked');
  await bad({ lastName: '   ' }, true, 'Γράψτε το επώνυμό σας.', 'missing last name');
  await bad({ email: 'nope' }, true, 'Γράψτε μια έγκυρη διεύθυνση e-mail.', 'bad e-mail');
  await bad({ stage: '' }, true, 'Επιλέξτε την ιδιότητά σας.', 'no stage');
  await bad({ linkedin: 'https://example.com/in/maria' }, true, 'Γράψτε τη διεύθυνση του προφίλ σας στο LinkedIn (linkedin.com/in/…).', 'a LinkedIn URL that is not linkedin.com');
  await bad({ entryYear: '2015', gradYear: '2010' }, true, 'Το έτος αποφοίτησης είναι πριν από το έτος εισαγωγής.', 'graduation before entry');
  await bad({ entryYear: '1850' }, true, 'Το έτος εισαγωγής δεν φαίνεται σωστό.', 'an impossible entry year');
  await bad({}, false, 'Για να υποβάλετε αίτηση, χρειάζεται να συμφωνήσετε με την πολιτική απορρήτου.', 'privacy not accepted');
  t((await calls(page, 'fs.set')).length === 0, 'no write while the form is invalid');

  // the server refuses the write (e.g. rules not published): the person must be TOLD
  await queue(page, 'fs.set', { path: 'members/', reject: { code: 'permission-denied', message: 'Missing or insufficient permissions.' } });
  await fill(good);
  await page.setChecked('#f-consentNewsletter', true);
  await page.setChecked('#f-acceptedPrivacy', true);
  await submit();
  await waitCalls(page, 'fs.set', 1);
  await sleep(400);
  const refusedMsg = await text(msg);
  const still = (await page.locator('#f-employer').count()) ? await page.inputValue('#f-employer') : null;
  t(refusedMsg && refusedMsg.indexOf('Δεν έχετε δικαίωμα για αυτή την ενέργεια') !== -1,
    'a refused application shows the Greek permission-denied message' + list([js(refusedMsg)]));
  t(still === 'ACME', '… and keeps what the person typed' + list([js(still)]));
  t(!(await docOf(page, 'members/' + MARIA.uid)), 'nothing was stored');

  // the real submission
  await fill(good);
  await page.setChecked('#f-consentNewsletter', true);
  await page.setChecked('#f-consentJobs', false);
  await page.setChecked('#f-consentDirectory', true);
  await page.setChecked('#f-acceptedPrivacy', true);
  const nBefore = (await calls(page, 'fs.set')).length;
  await submit();
  const sets = await waitCalls(page, 'fs.set', nBefore + 1);
  const w = sets[nBefore];
  t(w && w.args[0] === 'members/' + MARIA.uid, 'the application is written with set() to members/{uid}' + list([w && w.args[0]]));
  const d = (w && w.args[1]) || {};
  t(js(Object.keys(d).sort()) === js([...R.profileKeys, 'status'].sort()), 'set() carries EXACTLY the keys the create rule requires (profileKeys + status)' +
    list([...Object.keys(d).filter(k => ![...R.profileKeys, 'status'].includes(k)).map(k => '+' + k), ...[...R.profileKeys, 'status'].filter(k => !(k in d)).map(k => '-' + k)]));
  const probs = createProblems(d);
  t(probs.length === 0, 'the payload passes the create rule (types, lengths, status, timestamps)' + list(probs));
  t(d.status === 'pending' && isST(d.createdAt) && isST(d.updatedAt), 'status "pending", createdAt/updatedAt = serverTimestamp()');
  t(d.entryYear === 2008 && d.gradYear === 2013, 'the years are integers');
  t(d.consentNewsletter === true && d.consentJobs === false && d.consentDirectory === true && d.acceptedPrivacy === true, 'the consents are booleans');
  t(d.linkedin === 'https://linkedin.com/in/maria-p', 'a bare linkedin.com/in/… is stored as https://' + list([d.linkedin]));
  t(d.provider === 'google.com', 'provider records how they signed in');
  t(await waitFor(page, () => /Η αίτησή σας υποβλήθηκε/.test(Array.from(document.querySelectorAll('body > .notice.ok[role=status]')).map(e => e.textContent).join(' '))),
    'a toast confirms the submission («Η αίτησή σας υποβλήθηκε. Ευχαριστούμε!»)' + list([js(await flashText(page))]));
  t(await hasText(page.locator('#account-app'), 'Λάβαμε την αίτησή σας.') && await hasText(page.locator('#account-app .profile-head'), 'Η αίτηση εκκρεμεί'), 'the page switches to «Λάβαμε την αίτησή σας.» / pending');
  const stored = await docOf(page, 'members/' + MARIA.uid);
  t(stored && stored.createdAt && stored.createdAt.__ts, 'the stored document gets its server timestamp');

  // editing: update(), never the admin fields
  await server(page, 'setDoc', 'members/' + MARIA.uid, Object.assign({}, stored, { status: 'pending', duesYears: [YEAR - 1], adminNote: 'σημείωση' }));
  await sleep(100);
  await page.click('#account-app [data-edit]');
  t(await visible(page.locator('#account-app form[data-apply]')) && (await text(page.locator('#account-app form[data-apply] [type=submit]'))) === 'Αποθήκευση', '«Επεξεργασία στοιχείων» opens the form with «Αποθήκευση»');
  t((await page.inputValue('#f-employer')) === 'ACME' && (await page.inputValue('#f-gradYear')) === '2013', 'the form holds the saved values');
  await page.fill('#f-city', 'Θεσσαλονίκη');
  await page.fill('#f-gradYear', '');
  const before = await docOf(page, 'members/' + MARIA.uid);
  await page.click('#account-app form[data-apply] [type=submit]');
  const ups = await waitCalls(page, 'fs.update', 1);
  const up = ups[0];
  const pd = (up && up.args[1]) || {};
  t(up && up.args[0] === 'members/' + MARIA.uid, 'saving an existing application uses update()');
  t((await calls(page, 'fs.set')).length === nBefore + 1, '… not set()');
  const forbidden = Object.keys(pd).filter(k => [...R.adminKeys, 'createdAt'].includes(k));
  t(forbidden.length === 0, 'update() never touches status / duesYears / adminNote / reviewedAt / reviewedBy / createdAt' + list(forbidden));
  const up2 = ownerUpdateProblems(before, pd);
  t(up2.length === 0, 'the update passes the owner-update rule' + list(up2));
  t(pd.gradYear === null && pd.city === 'Θεσσαλονίκη', 'an emptied year is stored as null');
  t(await hasText(page.locator('#account-app'), 'Θεσσαλονίκη') && !(await page.locator('#account-app form[data-apply]').count()), 'after saving, the page shows the details again (not the form)');
  const after = await docOf(page, 'members/' + MARIA.uid);
  t(after && after.status === 'pending' && js(after.duesYears) === js([YEAR - 1]) && after.adminNote === 'σημείωση', 'status, duesYears and adminNote are unchanged');
  await page.click('#account-app [data-edit]');
  await page.click('#account-app [data-cancel]');
  t(!(await page.locator('#account-app form[data-apply]').count()), '«Ακύρωση» closes the form');

  // sign-in methods: Google linked, Facebook can be added
  const methods = page.locator('#account-app .linked');
  t(await hasText(methods, 'Google') && (await page.locator('#account-app .linked .badge.ok').count()) === 1, '«Τρόποι σύνδεσης» shows Google as connected');
  await page.click('#account-app [data-link="facebook"]');
  const lp = await waitCalls(page, 'user.linkWithPopup', 1);
  t(lp[0] && lp[0].args[0].__provider === 'facebook.com' && lp[0].args[0].scopes.includes('email'), '«Σύνδεση» next to Facebook calls linkWithPopup(Facebook)');
  t(await waitFor(page, () => document.querySelectorAll('#account-app .linked .badge.ok').length === 2), '… and Facebook is then shown as connected' +
    list([(await page.$$eval('#account-app .linked .row', rs => rs.map(r => r.textContent.trim()))).join(' / '), 'toast: ' + (await flashText(page))]));
  await queue(page, 'linkWithPopup', { reject: { code: 'auth/credential-already-in-use' } });
  await page.click('#account-app [data-link="linkedin"]');
  t(await hasText(page.locator('#account-app [data-methods-msg]'), 'χρησιμοποιείται ήδη από άλλον λογαριασμό'), 'a LinkedIn already used elsewhere: the Greek message');
});

await scenario('F3', 'account page: an e-mail + password account that has not confirmed its address', { cfg: 'oidc',
  seed: signedInSeed(acct('u-pw', { email: 'nikos@example.com', name: 'Νίκος Κάραλης', verified: false, providers: ['password'], password: 'pass-word-123' })) }, async (page) => {
  await page.goto(URL_('account/'));
  const app = page.locator('#account-app');
  t(await hasText(app, 'Επιβεβαιώστε το e-mail σας'), 'the verification notice is shown');
  t(await visible(page.locator('#account-app form[data-apply]')), 'the form is shown');
  t(await page.$eval('#account-app form[data-apply] [type=submit]', b => b.disabled), '… with a DISABLED submit button');
  t(await hasText(page.locator('#account-app [data-form-msg]'), 'Επιβεβαιώστε πρώτα το e-mail σας'), '… and a line saying why');
  await page.click('#account-app [data-resend]');
  const sv = await waitCalls(page, 'user.sendEmailVerification', 1);
  t(sv.length === 1, '«Αποστολή ξανά» sends the verification e-mail again');
  t(await hasText(page.locator('#account-app [data-verify-msg]'), 'Σας στείλαμε e-mail επιβεβαίωσης'), '… and says «Σας στείλαμε e-mail επιβεβαίωσης…»');
  await page.click('#account-app [data-verified]');
  const tok = await waitCalls(page, 'user.getIdToken', 1);
  const all = await calls(page);
  const rl = all.filter(x => x.api === 'user.reload');
  t(rl.length === 1 && tok.length >= 1 && rl[0].i < tok[tok.length - 1].i, '«Το επιβεβαίωσα» calls reload() THEN getIdToken()');
  t(tok.some(x => x.args[0] === true), '… getIdToken(true), forcing a fresh token for the rules');
  t(await hasText(page.locator('#account-app [data-verify-msg]'), 'Δεν έχει επιβεβαιωθεί ακόμα'), 'still unconfirmed: «Δεν έχει επιβεβαιωθεί ακόμα…»');
  await server(page, 'verify', 'u-pw', true);       // the person clicks the link in the e-mail
  await page.click('#account-app [data-verified]');
  t(await waitFor(page, () => !/Επιβεβαιώστε το e-mail σας/.test(document.getElementById('account-app').textContent)), 'once confirmed, the notice disappears');
  t(await waitFor(page, () => { const b = document.querySelector('#account-app form[data-apply] [type=submit]'); return !!b && !b.disabled; }), '… and the submit button is enabled');
  t((await text(page.locator('#account-app [data-form-msg]'))) === '', '… and the "confirm first" line is gone');
});

await scenario('F4', 'account page: an active member and the members directory', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: {
    ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: MARIA.email, status: 'active', duesYears: [YEAR], consentDirectory: false,
      gradYear: 2013, employer: 'ACME', position: 'Data Scientist', city: 'Αθήνα', linkedin: 'https://www.linkedin.com/in/maria-p', reviewedBy: ADMIN, reviewedAt: ts(Date.now() - DAY) })
  } }) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await hasText(page.locator('#account-app .profile-head'), 'Ενεργό μέλος'), 'an active member sees «Ενεργό μέλος»');
  t(await hasText(page.locator('#account-app'), 'Συνδρομές που έχουμε καταγράψει: ' + YEAR), '… and the recorded dues');
  const box = page.locator('#account-app [data-dir]');
  t(await visible(box), 'the directory checkbox is shown');
  t(!(await box.isChecked()), '… unticked (not listed)');
  const before = await docOf(page, 'members/' + MARIA.uid);
  await box.check();
  const ds = await waitCalls(page, 'fs.set', 1);
  const dw = ds.find(x => x.args[0] === 'directory/' + MARIA.uid);
  t(!!dw, 'ticking it writes directory/{uid}');
  const dp = dirProblems((dw && dw.args[1]) || {});
  t(dw && dp.length === 0, 'with only the keys (and types) the directory rule allows' + list(dp.length ? dp : Object.keys((dw && dw.args[1]) || {})));
  t(dw && dw.args[1].name === 'Μαρία Παπαδοπούλου' && dw.args[1].gradYear === 2013, '… name and year taken from the application');
  const mu = (await waitCalls(page, 'fs.update', 1)).find(x => x.args[0] === 'members/' + MARIA.uid);
  t(mu && js(Object.keys(mu.args[1]).sort()) === js(['consentDirectory', 'updatedAt']) && mu.args[1].consentDirectory === true, 'the choice is remembered on the application (consentDirectory, updatedAt)');
  const op = ownerUpdateProblems(before, (mu && mu.args[1]) || {});
  t(op.length === 0, '… an update the owner rule accepts' + list(op));
  t(await waitFor(page, () => { const b = document.querySelector('#account-app [data-dir]'); return b && b.checked && !b.disabled; }), 'after the page redraws, the box is ticked');
  t(!!(await docOf(page, 'directory/' + MARIA.uid)), 'the directory entry exists');
  await sleep(300);
  t(await hasText(page.locator('#account-app [data-dir-msg]'), 'Εμφανίζεστε στον κατάλογο μελών.', 1500), 'the page confirms «Εμφανίζεστε στον κατάλογο μελών.»' +
    list([js(await text(page.locator('#account-app [data-dir-msg]')))]));
  // unticking removes it
  await page.locator('#account-app [data-dir]').uncheck();
  t(await waitFor(page, () => !JSON.parse(localStorage.getItem('__fbfake')).docs['directory/u-maria']), 'unticking deletes the directory entry');
  t((await calls(page, 'fs.delete')).some(x => x.args[0] === 'directory/' + MARIA.uid), '… with delete()');
  // editing the application of an active, listed member refreshes the listing too
  await page.locator('#account-app [data-dir]').check();
  await waitFor(page, () => !!JSON.parse(localStorage.getItem('__fbfake')).docs['directory/u-maria']);
  await sleep(200);
  const n0 = (await calls(page, 'fs.set')).length;
  await page.click('#account-app [data-edit]');
  await page.fill('#f-employer', 'Νέος Εργοδότης');
  await page.click('#account-app form[data-apply] [type=submit]');
  const up = (await waitCalls(page, 'fs.update', 4)).filter(x => x.args[0] === 'members/' + MARIA.uid && 'firstName' in x.args[1]).pop();
  t(up && !('status' in up.args[1]) && !('duesYears' in up.args[1]), 'an active member\'s edit never sends status or duesYears');
  t(await waitFor(page, n => JSON.parse(localStorage.getItem('__fbfake')).calls.filter(c => c.api === 'fs.set').length > n, n0), 'the directory card is rewritten after the edit');
  const last = (await calls(page, 'fs.set')).pop();
  t(last && last.args[0] === 'directory/' + MARIA.uid && last.args[1].employer === 'Νέος Εργοδότης' && dirProblems(last.args[1]).length === 0, '… with the new employer, within the directory rule');
  const st = await docOf(page, 'members/' + MARIA.uid);
  t(st.status === 'active' && js(st.duesYears) === js([YEAR]), 'status and dues are untouched');
});

await scenario('F5', 'account page: approved while asking to be listed -> listed once', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: { ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', status: 'active', consentDirectory: true }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  const s = await waitCalls(page, 'fs.set', 1);
  t(s.length === 1 && s[0].args[0] === 'directory/' + MARIA.uid && dirProblems(s[0].args[1]).length === 0, 'the directory entry is written automatically, within the rule');
  t(await waitFor(page, () => { const b = document.querySelector('#account-app [data-dir]'); return b && b.checked; }), 'and the box shows ticked');
  await sleep(300);
  t((await calls(page, 'fs.set')).length === 1, 'only once');
});

await scenario('F6', 'account page: deleting the account (Google)', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct({ lastSignIn: Date.now() - 3 * HOUR }), { docs: {
    ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', status: 'active' }), ['directory/' + MARIA.uid]: dirEntry({ name: 'Μαρία Παπαδοπούλου' })
  } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await visible(page.locator('#account-app [data-del-open]'));
  t(await page.locator('#account-app [data-del-box]').isHidden(), 'the deletion box starts closed');
  await page.click('#account-app [data-del-open]');
  t(await page.locator('#account-app [data-del-box]').isVisible(), '«Διαγραφή λογαριασμού» opens it');
  t(!(await page.locator('#del-pass').count()), 'a Google account is not asked for a password');
  await page.click('#account-app [data-del-go]');
  t((await text(page.locator('#account-app [data-del-msg]'))) === 'Γράψτε ΔΙΑΓΡΑΦΗ για επιβεβαίωση.', 'without typing ΔΙΑΓΡΑΦΗ: «Γράψτε ΔΙΑΓΡΑΦΗ για επιβεβαίωση.»');
  await page.fill('#del-confirm', 'ΔΙΑΓΡΑΦ');
  await page.click('#account-app [data-del-go]');
  t((await text(page.locator('#account-app [data-del-msg]'))) === 'Γράψτε ΔΙΑΓΡΑΦΗ για επιβεβαίωση.', 'a near miss is refused too');
  t((await calls(page)).every(x => !/reauth|user\.delete|fs\.delete/.test(x.api)), 'nothing is called before the word is typed');
  // the popup is closed: nothing is deleted
  await page.fill('#del-confirm', 'ΔΙΑΓΡΑΦΗ');
  await queue(page, 'reauthenticateWithPopup', { reject: { code: 'auth/popup-closed-by-user' } });
  await page.click('#account-app [data-del-go]');
  t(await hasText(page.locator('#account-app [data-del-msg]'), 'Η διαγραφή ακυρώθηκε.'), 'closing the re-authentication popup: «Η διαγραφή ακυρώθηκε.»');
  t(!!(await docOf(page, 'members/' + MARIA.uid)) && !!(await docOf(page, 'directory/' + MARIA.uid)) && !!(await fbState(page)).accounts[MARIA.uid], '… and nothing is deleted');
  t(!(await page.$eval('#account-app [data-del-go]', b => b.disabled)), '… and the button works again');
  // the real thing
  await page.click('#account-app [data-del-go]');
  t(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.'), 'the «account deleted» message is shown');
  await sleep(400);
  t(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.') && !(await hasText(page.locator('#account-app'), 'Συνδεθείτε ή δημιουργήστε', 300)),
    '… and STAYS (not replaced by the signed-out screen when auth reports no user)');
  const all = await calls(page);
  const re = all.filter(x => x.api === 'user.reauthenticateWithPopup'), last = re[re.length - 1];
  const after = all.filter(x => last && x.i > last.i);
  const dDir = after.find(x => x.api === 'fs.delete' && x.args[0] === 'directory/' + MARIA.uid);
  const dMem = after.find(x => x.api === 'fs.delete' && x.args[0] === 'members/' + MARIA.uid);
  const dUser = after.find(x => x.api === 'user.delete');
  t(last && last.args[0].__provider === 'google.com', 're-authentication uses a Google popup (the account\'s own provider)');
  t(last && last.userActivation === true, '… opened inside the click');
  t(!!(last && dDir && dMem && dUser && last.i < dDir.i && dDir.i < dMem.i && dMem.i < dUser.i),
    'order: re-authenticate, delete directory, delete members, delete the sign-in account' + list([last, dDir, dMem, dUser].map(x => x ? x.api + '#' + x.i : '—')));
  t(!(await docOf(page, 'members/' + MARIA.uid)) && !(await docOf(page, 'directory/' + MARIA.uid)), 'the application and the directory entry are gone');
  t(!(await fbState(page)).accounts[MARIA.uid], 'the sign-in account is gone');
  t(await visible(page.locator('#acct-slot [data-signin]')), 'the header shows «Σύνδεση»');
  t(await page.evaluate(() => !localStorage.getItem('semfe:auth-hint')), 'the header hint is removed');
});

await scenario('F7', 'account page: deleting an e-mail + password account', { cfg: 'oidc',
  seed: signedInSeed(acct('u-pw', { email: 'nikos@example.com', name: 'Νίκος Κάραλης', providers: ['password'], password: 'pass-word-123', lastSignIn: Date.now() - 3 * HOUR }),
    { docs: { 'members/u-pw': member({ firstName: 'Νίκος', lastName: 'Κάραλης' }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-del-open]');
  t(await page.locator('#del-pass').isVisible(), 'a password-only account is asked for its password');
  await page.fill('#del-confirm', 'διαγραφη');
  await page.fill('#del-pass', 'wrong-one');
  await page.click('#account-app [data-del-go]');
  t(await hasText(page.locator('#account-app [data-del-msg]'), 'Λάθος e-mail ή κωδικός'), 'a wrong password: the Greek message (typing «διαγραφη» in lower case is accepted)');
  t(!!(await docOf(page, 'members/u-pw')) && !!(await fbState(page)).accounts['u-pw'], '… and nothing is deleted');
  await page.fill('#del-pass', 'pass-word-123');
  // this time the auth listeners hear of the sign-out only AFTER delete() has resolved (the other order from F6)
  await queue(page, 'delete', { lateNotifyMs: 250 });
  await page.click('#account-app [data-del-go]');
  t(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.'), 'the right password deletes the account');
  await sleep(600);
  t(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.', 300) && !(await hasText(page.locator('#account-app'), 'Συνδεθείτε ή δημιουργήστε', 300)),
    'the «deleted» message survives a sign-out notice that arrives after delete() resolved');
  t(await visible(page.locator('#acct-slot [data-signin]')), 'the header shows «Σύνδεση»');
  const rc = (await calls(page, 'user.reauthenticateWithCredential')).pop();
  t(rc && rc.args[0].providerId === 'password' && rc.args[0].email === 'nikos@example.com' && rc.args[0].password === 'pass-word-123', 'via reauthenticateWithCredential(EmailAuthProvider.credential(e-mail, password))');
  t(!(await docOf(page, 'members/u-pw')) && !(await fbState(page)).accounts['u-pw'], 'application and account are gone');
});

/* ================================================================================== */
const DIR_DOCS = {
  'directory/d1': dirEntry({ name: 'Νίκος Κάραλης', gradYear: 2001, employer: 'ΔΕΗ', city: 'Πάτρα', linkedin: 'https://www.linkedin.com/in/karalis' }),
  'directory/d2': dirEntry({ name: 'Ελένη Σταύρου', gradYear: 2015, employer: 'CERN', city: 'Γενεύη', direction: 'Εφαρμοσμένη Φυσική', linkedin: 'javascript:alert(1)' }),
  'directory/d3': dirEntry({ name: 'Άννα Ζαφειρίου', gradYear: 2020, position: 'Αναλύτρια', city: 'Αθήνα' })
};
await scenario('G1', 'members page: signed out', { cfg: 'oidc' }, async (page) => {
  await page.goto(URL_('members/'));
  t(await hasText(page.locator('#members-app'), 'Μόνο για μέλη'), '«Μόνο για μέλη»');
  await page.click('#members-app [data-open="signin"]');
  t(await visible(page.locator('.modal-backdrop')), 'its «Σύνδεση» opens the dialog');
  t((await calls(page, 'fs.list')).length === 0 && (await calls(page, 'fs.get')).length === 0, 'nothing is read from Firestore');
});
await scenario('G2', 'members page: signed in, no application', { cfg: 'oidc', seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('members/'));
  t(await hasText(page.locator('#members-app'), 'Δεν έχετε κάνει ακόμα αίτηση μέλους'), '«Δεν έχετε κάνει ακόμα αίτηση μέλους»');
  t((await page.getAttribute('#members-app a.btn-primary', 'href')) === '../account/#apply', 'with a link to account/#apply');
  t((await calls(page, 'fs.list')).length === 0, 'the directory is not requested');
});
await scenario('G3', 'members page: pending and rejected applications', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: { ['members/' + MARIA.uid]: member({ status: 'pending' }) } }) }, async (page) => {
  await page.goto(URL_('members/'));
  t(await hasText(page.locator('#members-app'), 'Η αίτησή σας εκκρεμεί'), 'pending: «Η αίτησή σας εκκρεμεί»');
  t((await calls(page, 'fs.list')).length === 0, 'the directory is not requested (the rules would refuse it)');
  await server(page, 'setDoc', 'members/' + MARIA.uid, member({ status: 'rejected' }));
  await page.reload();
  t(await hasText(page.locator('#members-app'), 'Η αίτησή σας δεν εγκρίθηκε'), 'rejected: «Η αίτησή σας δεν εγκρίθηκε»');
});
await scenario('G4', 'members page: an active member, the directory and its search', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: Object.assign({ ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', status: 'active', duesYears: [YEAR], consentDirectory: true, gradYear: 2013 }) }, DIR_DOCS) }) }, async (page) => {
  await page.goto(URL_('members/'));
  const cards = page.locator('#dir-list .card');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length > 0), 'directory cards are rendered');
  const own = (await calls(page, 'fs.set')).find(x => x.args[0] === 'directory/' + MARIA.uid);
  t(own && dirProblems(own.args[1]).length === 0, 'an active member who asked to be listed is listed (within the directory rule)');
  t(await cards.count() === 4, 'four cards: three members + herself' + list([await cards.count()]));
  t(await hasText(page.locator('#members-app'), 'Η συνδρομή ' + YEAR + ' είναι τακτοποιημένη'), 'this year\'s dues show as paid');
  const names = await page.$$eval('#dir-list .card h3', hs => hs.map(h => h.textContent));
  t(js(names) === js(names.slice().sort((a, b) => a.localeCompare(b, 'el'))), 'cards are in Greek alphabetical order' + list(names));
  await page.fill('#dir-q', 'καραλης');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 1) && /Κάραλης/.test(await text(cards)), '«καραλης» finds «Κάραλης» (accents and case ignored)');
  await page.fill('#dir-q', 'ΣΤΑΥΡΟΥ');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 1) && /Σταύρου/.test(await text(cards)), '«ΣΤΑΥΡΟΥ» finds «Σταύρου»');
  await page.fill('#dir-q', 'γενευη');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 1), 'the city is searched too («γενευη» → Γενεύη)');
  await page.fill('#dir-q', '2001');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 1), 'and the graduation year («2001»)');
  await page.fill('#dir-q', 'ζζζζ');
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 0 && !document.getElementById('dir-empty').hidden), 'no match: «Δεν βρέθηκαν μέλη.»');
  await page.fill('#dir-q', '');
  const links = await page.$$eval('#dir-list a.linkedin-btn', as => as.map(a => a.getAttribute('href')));
  t(links.includes('https://www.linkedin.com/in/karalis') && !links.some(h => /^javascript:/i.test(h)), 'only real linkedin.com URLs become links (a javascript: URL does not)' + list(links));
});
await scenario('G5', 'members page: an admin who is not a member sees the directory', { cfg: 'oidc',
  seed: signedInSeed(acct('u-admin', { email: ADMIN, name: 'Διαχειριστής' }), { docs: DIR_DOCS }) }, async (page) => {
  await page.goto(URL_('members/'));
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length === 3), 'the three directory cards');
  t(await hasText(page.locator('#members-app'), 'Διαχειριστής'), 'with the «Διαχειριστής» badge');
});

/* ================================================================================== */
await scenario('H1', 'admin page: signed out / not an admin / an unverified admin address', { cfg: 'oidc',
  seed: { accounts: { 'u-x': acct('u-x', { email: 'someone@gmail.com', name: 'Κάποιος' }), 'u-ua': acct('u-ua', { email: ADMIN, name: 'Όχι ακόμα', verified: false, providers: ['password'], password: 'pass-word-123' }) } } }, async (page) => {
  await page.goto(URL_('admin/'));
  t(await hasText(page.locator('#admin-app'), 'Μόνο για διαχειριστές'), 'signed out: «Μόνο για διαχειριστές»');
  await sdkReady(page);
  await queue(page, 'signInWithPopup', { provider: 'google.com', resolve: { uid: 'u-x', email: 'someone@gmail.com' } });
  await page.click('#admin-app [data-open]');
  await page.click('.modal [data-provider="google"]');
  t(await hasText(page.locator('#admin-app'), 'Δεν έχετε πρόσβαση σε αυτή τη σελίδα.'), 'a non-admin: «Δεν έχετε πρόσβαση σε αυτή τη σελίδα.»');
  t((await calls(page, 'fs.onSnapshot')).every(x => x.kind !== 'col') && (await calls(page, 'fs.list')).length === 0, '… and the members list is never requested');
  await page.click('#acct-slot .acct-chip');
  await Promise.all([page.waitForEvent('load').catch(() => {}), page.click('#acct-menu [data-signout]')]);
  await openDialog(page);
  await page.fill('#auth-email', ADMIN);
  await page.fill('#auth-pass', 'pass-word-123');
  await page.click('.modal [data-submit]');
  t(await hasText(page.locator('#admin-app'), 'το e-mail δεν έχει επιβεβαιωθεί'), 'the admin address, unconfirmed: no access, «(το e-mail δεν έχει επιβεβαιωθεί)»');
});

const ADMIN_SEED = signedInSeed(acct('u-admin', { email: ADMIN, name: 'Διαχειριστής' }), { docs: {
  'members/p1': member({ firstName: 'Νίκος', lastName: 'Κάραλης', email: 'nikos@example.com', status: 'pending', createdAt: ts(Date.now() - 2 * DAY), consentNewsletter: true }),
  'members/p2': member({ firstName: XSS, lastName: 'Σταύρου', email: 'eleni@example.com', city: '=HYPERLINK("http://evil.example","x")', employer: '+cmd', note: '@SUM(1)', status: 'pending', createdAt: ts(Date.now() - DAY) }),
  'members/a1': member({ firstName: 'Άννα', lastName: 'Ζαφειρίου', email: 'anna@example.com', status: 'active', duesYears: [YEAR - 1], consentJobs: true, createdAt: ts(Date.now() - 30 * DAY) }),
  'directory/a1': dirEntry({ name: 'Άννα Ζαφειρίου' })
} });
await scenario('H2', 'admin page: tiles, approve, dues, reject, CSV, hostile values', { cfg: 'oidc', seed: ADMIN_SEED }, async (page, env) => {
  await page.goto(URL_('admin/'));
  t(await waitFor(page, () => document.querySelectorAll('#admin-app .tile').length === 4), 'four summary tiles');
  const tiles = async () => page.$$eval('#admin-app .tile', ts => Object.fromEntries(ts.map(x => [x.querySelector('.l').textContent, +x.querySelector('.v').textContent])));
  let tl = await tiles();
  t(tl['Αιτήσεις συνολικά'] === 3 && tl['Σε αναμονή'] === 2 && tl['Ενεργά μέλη'] === 1 && tl['Συνδρομή ' + YEAR] === 0, 'tiles: 3 applications, 2 pending, 1 active, 0 paid this year' + list([js(tl)]));
  const ids = () => page.$$eval('#admin-app tr[data-id]', rs => rs.map(r => r.getAttribute('data-id')));
  t(js(await ids()) === js(['p2', 'p1']), 'the «Σε αναμονή» filter lists the two pending applications, newest first' + list(await ids()));
  t(!(await xssFired(page)), 'a first name that is an <img onerror> does not run');
  t(await hasText(page.locator('#admin-app tr[data-id="p2"]'), XSS), '… it is shown as text');
  t(await page.locator('#admin-app tr[data-id="p2"] img').count() === 0, '… and no <img> element is created');
  // approve
  const before = await docOf(page, 'members/p1');
  await page.click('#admin-app tr[data-id="p1"] [data-act="approve"]');
  const ap = (await waitCalls(page, 'fs.update', 1))[0];
  t(ap && ap.args[0] === 'members/p1' && ap.args[1].status === 'active' && ap.args[1].reviewedBy === ADMIN && isST(ap.args[1].reviewedAt), 'Έγκριση: update({status: active, reviewedBy: <admin e-mail>, reviewedAt: serverTimestamp()})' + list([js(ap && ap.args[1])]));
  const ap2 = adminUpdateProblems(before, (ap && ap.args[1]) || {}, ADMIN);
  t(ap2.length === 0, '… which the admin-update rule accepts' + list(ap2));
  t(await waitFor(page, () => !document.querySelector('#admin-app tr[data-id="p1"]')), 'the approved application leaves the pending list');
  tl = await tiles();
  t(tl['Ενεργά μέλη'] === 2 && tl['Σε αναμονή'] === 1, 'the tiles follow (2 active, 1 pending)');
  // dues
  await page.click('#admin-app [data-filter="active"]');
  t((await page.getAttribute('#admin-app [data-filter="active"]', 'aria-pressed')) === 'true', 'the «Ενεργά» filter is pressed');
  t(js((await ids()).sort()) === js(['a1', 'p1']), '… and lists the two active members');
  const duesBtn = page.locator('#admin-app tr[data-id="p1"] [data-act="dues"]');
  t((await text(duesBtn)) === 'Πλήρωσε ' + YEAR && (await duesBtn.getAttribute('aria-pressed')) === 'false', 'the dues button reads «Πλήρωσε ' + YEAR + '», not pressed');
  const b2 = await docOf(page, 'members/p1');
  await duesBtn.click();
  let du = (await waitCalls(page, 'fs.update', 2))[1];
  t(du && du.args[1].duesYears && du.args[1].duesYears.__fv === 'arrayUnion' && js(du.args[1].duesYears.els) === js([YEAR]), 'Πλήρωσε: duesYears arrayUnion(' + YEAR + ')' + list([js(du && du.args[1])]));
  t(adminUpdateProblems(b2, du.args[1], ADMIN).length === 0, '… within the admin-update rule' + list(adminUpdateProblems(b2, du.args[1], ADMIN)));
  t(await waitFor(page, y => { const b = document.querySelector('#admin-app tr[data-id="p1"] [data-act="dues"]'); return b && b.getAttribute('aria-pressed') === 'true' && b.textContent === '✓ Πλήρωσε ' + y; }, YEAR), 'it then reads «✓ Πλήρωσε ' + YEAR + '», pressed');
  t(js((await docOf(page, 'members/p1')).duesYears) === js([YEAR]), 'the year is stored');
  t((await tiles())['Συνδρομή ' + YEAR] === 1, 'the «Συνδρομή» tile counts it');
  await page.click('#admin-app tr[data-id="p1"] [data-act="dues"]');
  du = (await waitCalls(page, 'fs.update', 3))[2];
  t(du && du.args[1].duesYears && du.args[1].duesYears.__fv === 'arrayRemove' && js(du.args[1].duesYears.els) === js([YEAR]), 'pressing it again: arrayRemove(' + YEAR + ')');
  t(await waitFor(page, () => (JSON.parse(localStorage.getItem('__fbfake')).docs['members/p1'].duesYears || []).length === 0), 'the year is removed');
  // reject: cancelled, then accepted
  env.dialogPolicy = 'dismiss';
  const nUp = (await calls(page, 'fs.update')).length;
  await page.click('#admin-app tr[data-id="a1"] [data-act="reject"]');
  await sleep(200);
  t(env.dialogs.length === 1 && /Απόρριψη της αίτησης του\/της Άννα Ζαφειρίου/.test(env.dialogs[0].message), 'Απόρριψη asks for confirmation, naming the person');
  t((await calls(page, 'fs.update')).length === nUp, 'a cancelled confirmation changes nothing');
  env.dialogPolicy = 'accept';
  const b3 = await docOf(page, 'members/a1');
  await page.click('#admin-app tr[data-id="a1"] [data-act="reject"]');
  const rj = (await waitCalls(page, 'fs.update', nUp + 1))[nUp];
  t(rj && rj.args[0] === 'members/a1' && rj.args[1].status === 'rejected' && rj.args[1].reviewedBy === ADMIN, 'accepted: update({status: rejected, reviewedBy})');
  t(rj && adminUpdateProblems(b3, rj.args[1], ADMIN).length === 0, '… within the admin-update rule');
  t(await waitFor(page, () => !JSON.parse(localStorage.getItem('__fbfake')).docs['directory/a1']), '… and the directory entry is deleted');
  t((await calls(page, 'fs.delete')).some(x => x.args[0] === 'directory/a1'), '… with delete(directory/{uid})');
  // CSV of everything
  await page.click('#admin-app [data-filter="all"]');
  t(await waitFor(page, () => document.querySelectorAll('#admin-app tr[data-id]').length === 3), '«Όλες» lists all three');
  t(await hasText(page.locator('#admin-app [data-csv]'), 'Εξαγωγή CSV (3)'), 'the CSV button counts the rows it will export');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#admin-app [data-csv]')]);
  const buf = readFileSync(await dl.path());
  const csv = buf.toString('utf8');
  t(buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, 'the CSV starts with a UTF-8 BOM (Excel reads the Greek correctly)');
  t(/^semfe-members-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), 'file name semfe-members-YYYY-MM-DD.csv' + list([dl.suggestedFilename()]));
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  t(lines[0].startsWith('"Όνομα","Επώνυμο","E-mail","Τηλέφωνο","Κατάσταση"'), 'Greek column headers' + list([lines[0].slice(0, 80)]));
  t(lines.length === 4, 'a header and three rows, CRLF line ends' + list([lines.length]));
  t(csv.includes('"\'=HYPERLINK(""http://evil.example"",""x"")"'), 'a value starting with "=" is neutralised with a leading apostrophe (and quotes doubled)');
  t(csv.includes('"\'+cmd"') && csv.includes('"\'@SUM(1)"'), '… and so are values starting with "+" and "@"');
  t(csv.includes('"ναι"') && csv.includes('"όχι"'), 'booleans export as ναι / όχι');
  // delete an application
  const nDel = (await calls(page, 'fs.delete')).length;
  await page.click('#admin-app tr[data-id="p2"] [data-act="delete"]');
  t(await waitFor(page, () => !JSON.parse(localStorage.getItem('__fbfake')).docs['members/p2']), 'Διαγραφή (confirmed) deletes the application');
  const dels = (await calls(page, 'fs.delete')).slice(nDel).map(x => x.args[0]);
  t(js(dels) === js(['directory/p2', 'members/p2']), '… its directory entry first, then the application' + list(dels));
  t(!(await xssFired(page)), 'no injected script ran on the admin page');
});

/* ================================================================================== */
await scenario('I1', 'LinkedIn with the shipped settings (Cloud Function, not filled in yet): button hidden', { cfg: 'shipped' }, async (page) => {
  await page.goto(URL_(''));
  await openDialog(page);
  const provs = await page.$$eval('.modal [data-provider]', bs => bs.map(b => b.getAttribute('data-provider')));
  const shippedMode = (C.LINKEDIN || {}).mode;
  const filled = !String((C.LINKEDIN || {}).clientId + (C.LINKEDIN || {}).functionUrl).includes('PASTE_');
  if (shippedMode === 'oidc' || filled) note('config.js already has LinkedIn configured (mode ' + shippedMode + '); the hidden-button check does not apply');
  else t(!provs.includes('linkedin') && provs.includes('google') && provs.includes('facebook'), 'without clientId/functionUrl the LinkedIn button is hidden, the others shown' + list(provs));
});
await scenario('I2', 'LinkedIn through the Cloud Function: authorize, callback, sign in', { cfg: 'function' }, async (page, env) => {
  let authUrl = null;
  env.onExternal = async (route, url) => {
    if (url.startsWith('https://www.linkedin.com/oauth/v2/authorization')) {
      authUrl = new URL(url);
      const back = authUrl.searchParams.get('redirect_uri') + '?code=li-code-42&state=' + encodeURIComponent(authUrl.searchParams.get('state'));
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>LinkedIn</title><script>location.replace(' + JSON.stringify(back) + ')</script>' });
      return true;
    }
    if (url === FN_URL) {
      const req = route.request();
      const cors = { 'access-control-allow-origin': ORIGIN, 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'POST' };
      if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return true; }
      env.fnRequests.push({ method: req.method(), body: req.postData(), headers: req.headers() });
      await route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ token: 'custom-token-xyz', isNew: true }) });
      return true;
    }
    return false;
  };
  await page.goto(URL_(''));
  await openDialog(page);
  t(await page.locator('.modal [data-provider="linkedin"]').count() === 1, 'with clientId and functionUrl filled in, the LinkedIn button is shown');
  await page.evaluate(() => window.__fb.queue('signInWithCustomToken', { resolve: { uid: 'u-li', email: 'lina@example.com', displayName: 'Λίνα Ιωάννου', claims: { li: true } } }));
  await Promise.all([page.waitForURL(u => u.pathname === SUB + 'account/', { timeout: 10000 }).catch(() => {}), page.click('.modal [data-provider="linkedin"]')]);
  t(!!authUrl, 'the button goes to LinkedIn\'s authorization page (a full-page visit, no popup)');
  if (authUrl) {
    const q = authUrl.searchParams;
    t(q.get('response_type') === 'code' && q.get('client_id') === 'li-client-123', 'response_type=code, client_id from config.js');
    t(q.get('redirect_uri') === ORIGIN + SUB + 'auth/linkedin/', 'redirect_uri is <site>/semfealumni/auth/linkedin/' + list([q.get('redirect_uri')]));
    t(q.get('scope') === 'openid profile email', 'scope "openid profile email"');
    t(/^[0-9a-f]{32}$/.test(q.get('state') || ''), 'a random 128-bit state');
  }
  const fr = env.fnRequests[0];
  let body = null; try { body = JSON.parse(fr && fr.body); } catch {}
  t(fr && fr.method === 'POST' && body && body.code === 'li-code-42' && body.redirectUri === ORIGIN + SUB + 'auth/linkedin/', 'the callback page POSTs {code, redirectUri} to the Cloud Function' + list([fr && fr.body]));
  t(fr && !fr.headers.authorization, '… with no Authorization header when signing in (not linking)');
  const ct = await calls(page, 'auth.signInWithCustomToken');
  t(ct.length === 1 && ct[0].args[0] === 'custom-token-xyz', 'the returned token goes to signInWithCustomToken()');
  const u = new URL(page.url());
  t(u.pathname === SUB + 'account/' && u.hash === '#apply', 'a new LinkedIn member lands on account/#apply' + list([page.url()]));
  t(await waitFor(page, () => [...document.querySelectorAll('#account-app .linked .row')].some(r => /LinkedIn/.test(r.textContent) && r.querySelector('.badge.ok'))),
    '«Τρόποι σύνδεσης» shows LinkedIn as connected (read from the token\'s li claim)');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), 'Λίνα Ιωάννου'), 'the header chip shows the LinkedIn name');
});
await scenario('I3', 'LinkedIn callback: a forged / stale state, and a cancelled login', { cfg: 'function' }, async (page) => {
  await page.goto(URL_('auth/linkedin/?code=abc&state=not-ours'));
  t(await hasText(page.locator('#li-app'), 'Ο σύνδεσμος σύνδεσης δεν ισχύει'), 'a callback with no saved state is refused');
  t(!/code=/.test(page.url()), 'the code is removed from the address bar');
  const saveState = (st, age) => page.evaluate(([s, a]) => sessionStorage.setItem('semfe:li', JSON.stringify({ state: s, mode: 'signin', returnTo: location.origin + '/semfealumni/', t: Date.now() - a })), [st, age]);
  await saveState('a'.repeat(32), 0);
  await page.goto(URL_('auth/linkedin/?code=abc&state=' + 'b'.repeat(32)));
  t(await hasText(page.locator('#li-app'), 'Ο σύνδεσμος σύνδεσης δεν ισχύει'), 'a state that differs from the one this browser saved is refused');
  t(await page.evaluate(() => sessionStorage.getItem('semfe:li') === null), '… and the saved state is single-use (removed)');
  await saveState('c'.repeat(32), 25 * 60 * 1000);
  await page.goto(URL_('auth/linkedin/?code=abc&state=' + 'c'.repeat(32)));
  t(await hasText(page.locator('#li-app'), 'Ο σύνδεσμος σύνδεσης δεν ισχύει'), 'a matching state older than 20 minutes is refused');
  t((await calls(page, 'auth.signInWithCustomToken')).length === 0 && !(await page.evaluate(() => JSON.parse(localStorage.getItem('__fbfake') || '{}').calls || [])).some(c => c.api === 'auth.signInWithCustomToken'),
    'nothing is signed in');
  await page.goto(URL_('auth/linkedin/?error=user_cancelled_login&error_description=The+user+cancelled'));
  t(await hasText(page.locator('#li-app'), 'Η σύνδεση ακυρώθηκε'), 'a cancelled LinkedIn login: «Η σύνδεση ακυρώθηκε»');
});

/* ================================================================================== */
await scenario('J', 'stored XSS on the account and members pages, and in the header', { cfg: 'oidc',
  seed: signedInSeed(acct('u-evil', { email: 'evil@example.com', name: XSS }), { docs: {
    'members/u-evil': member({ firstName: XSS, lastName: '"><svg onload=window.__xss=2>', email: 'evil@example.com', status: 'active', city: '<b>x</b>', note: '</textarea><img src=x onerror=window.__xss=3>',
      linkedin: 'https://www.linkedin.com/in/x" onmouseover="window.__xss=4', consentDirectory: false, adminNote: '<img src=x onerror=window.__xss=5>' }),
    'directory/d9': dirEntry({ name: XSS + ' Κακός', employer: '<img src=x onerror=window.__xss=6>', city: '<script>window.__xss=7</script>' })
  } }) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await visible(page.locator('#account-app [data-edit]')), 'the account page renders');
  await sleep(300);
  t(!(await xssFired(page)), 'account page: no injected script ran');
  t(await hasText(page.locator('#account-app .kv'), XSS), '… the hostile name is shown as text');
  t(await hasText(page.locator('#acct-slot .acct-chip .nm'), XSS), 'the header chip shows the hostile display name as text');
  t(await page.locator('#account-app img, #acct-slot img').count() === 0, 'no <img> was created');
  await page.click('#account-app [data-edit]');
  await sleep(200);
  t(!(await xssFired(page)), 'the edit form: no injected script ran');
  t((await page.inputValue('#f-firstName')) === XSS && (await page.inputValue('#f-note')) === '</textarea><img src=x onerror=window.__xss=3>', '… the values round-trip exactly into the inputs');
  await page.click('#acct-slot .acct-chip');
  t(!(await xssFired(page)), 'the open account menu: no injected script ran');
  await page.goto(URL_('members/'));
  t(await waitFor(page, () => document.querySelectorAll('#dir-list .card').length >= 1), 'the members page renders the directory');
  await page.hover('#dir-list .card').catch(() => {});
  await sleep(300);
  t(!(await xssFired(page)), 'members page: no injected script ran');
  t(await page.locator('#members-app img, #members-app script, #members-app svg[onload]').count() === 0, '… and no injected element exists');
});

/* ================================================================================== */
await scenario('K1', 'account page: what is typed survives a redraw (approval while editing) and the reviewed name stays frozen', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: { ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: MARIA.email, status: 'pending', city: 'Αθήνα', employer: '' }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-edit]');
  await page.fill('#f-lastName', 'Παπαδοπούλου-Νέα');
  await page.fill('#f-city', 'Βόλος');
  await page.fill('#f-employer', 'Νέος Εργοδότης');
  await page.focus('#f-employer');
  // the admin approves while the member is typing: the listener redraws the page
  const cur = await docOf(page, 'members/' + MARIA.uid);
  await server(page, 'setDoc', 'members/' + MARIA.uid, Object.assign({}, cur, { status: 'active', reviewedBy: ADMIN, reviewedAt: ts(Date.now()) }));
  t(await hasText(page.locator('#account-app .profile-head'), 'Ενεργό μέλος'), 'the approval arrives while the form is open');
  t((await page.inputValue('#f-city')) === 'Βόλος' && (await page.inputValue('#f-employer')) === 'Νέος Εργοδότης', 'what was typed is still in the form after the redraw');
  t(await page.evaluate(() => document.activeElement && document.activeElement.id) === 'f-employer', '… and the cursor is still in the same field');
  t((await page.inputValue('#f-lastName')) === 'Παπαδοπούλου' && await page.$eval('#f-lastName', e => e.readOnly), 'the now-reviewed surname shows the stored one and is read-only');
  await page.click('#account-app form[data-apply] [type=submit]');
  const up = (await waitCalls(page, 'fs.update', 1)).filter(x => x.args[0] === 'members/' + MARIA.uid).pop();
  t(up && up.args[1].lastName === 'Παπαδοπούλου' && up.args[1].city === 'Βόλος', 'saving sends the stored surname (the rules freeze it) and the new city');
  t(await waitFor(page, () => !document.querySelector('#account-app form[data-apply]')), 'the form closes after a successful save');
});

await scenario('K2', 'account page: an unconfirmed e-mail account keeps its typing when it confirms', { cfg: 'oidc',
  seed: signedInSeed(acct('u-pw2', { email: 'eleni@example.com', name: 'Ελένη Σταύρου', verified: false, providers: ['password'], password: 'pass-word-123' })) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.fill('#f-employer', 'CERN');
  await page.fill('#f-city', 'Γενεύη');
  await page.selectOption('#f-stage', 'graduate');
  await server(page, 'verify', 'u-pw2', true);
  await page.click('#account-app [data-verified]');
  t(await waitFor(page, () => !/Επιβεβαιώστε το e-mail σας/.test(document.getElementById('account-app').textContent)), 'the address is confirmed');
  t((await page.inputValue('#f-employer')) === 'CERN' && (await page.inputValue('#f-city')) === 'Γενεύη' && (await page.inputValue('#f-stage')) === 'graduate',
    'the fields typed before confirming are still filled in');
});

await scenario('K3', 'account page: a mistyped year is refused, not saved as empty', { cfg: 'oidc', seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.fill('#f-firstName', 'Μαρία'); await page.fill('#f-lastName', 'Παπαδοπούλου');
  await page.selectOption('#f-stage', 'graduate');
  await page.setChecked('#f-acceptedPrivacy', true);
  await page.focus('#f-gradYear');
  await page.keyboard.type('2013-');
  await page.click('#account-app form[data-apply] [type=submit]');
  t(await hasText(page.locator('#account-app [data-form-msg]'), 'Το έτος αποφοίτησης δεν φαίνεται σωστό'), '«2013-» in the graduation year: «Το έτος αποφοίτησης δεν φαίνεται σωστό.»');
  t((await calls(page, 'fs.set')).length === 0, '… and nothing is written');
});

await scenario('K4', 'account page: an active, listed member who unticks the directory in the edit form is removed', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct(), { docs: {
    ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', email: MARIA.email, status: 'active', consentDirectory: true }),
    ['directory/' + MARIA.uid]: dirEntry({ name: 'Μαρία Παπαδοπούλου' }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-edit]');
  t(await hasText(page.locator('#account-app form[data-apply]'), 'Θέλω να εμφανίζομαι στον κατάλογο μελών'), 'for an active member the box reads «Θέλω να εμφανίζομαι…»');
  await page.setChecked('#f-consentDirectory', false);
  await page.click('#account-app form[data-apply] [type=submit]');
  t(await waitFor(page, () => !JSON.parse(localStorage.getItem('__fbfake')).docs['directory/u-maria']), 'the directory entry is deleted');
  t(await waitFor(page, () => { const b = document.querySelector('#account-app [data-dir]'); return b && !b.checked; }), '… and the directory box shows unticked');
});

await scenario('K5', 'account page: a password account with LinkedIn (Cloud Function) is asked for its password to delete', { cfg: 'function',
  seed: signedInSeed(acct('u-pl', { email: 'giorgos@example.com', name: 'Γιώργος Νικολάου', providers: ['password'], password: 'pass-word-123', claims: { li: true }, lastSignIn: Date.now() - 3 * HOUR })) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await waitFor(page, () => /Συνδεδεμένο/.test((document.querySelector('#methods') || {}).textContent || '')), 'LinkedIn shows as connected');
  await page.click('#account-app [data-del-open]');
  t(await page.locator('#del-pass').isVisible(), 'the delete box asks for the password (the only way it can re-prove who it is)');
});

await scenario('K6', 'account page: another sign-in method can be linked only once the e-mail is confirmed', { cfg: 'oidc',
  seed: signedInSeed(acct('u-fb', { email: 'kostas@example.com', name: 'Κώστας Ιωάννου', verified: false, providers: ['facebook.com'] })) }, async (page) => {
  await page.goto(URL_('account/'));
  t(await waitFor(page, () => !!document.querySelector('#account-app [data-link="google"]')), 'the Google «Σύνδεση» button is shown');
  t(await page.$eval('#account-app [data-link="google"]', b => b.disabled), '… disabled while the e-mail is unconfirmed');
  t(await hasText(page.locator('#link-needs-email'), 'χρειάζεται επιβεβαιωμένο e-mail'), '… with a line saying why, and how to confirm');
  await page.click('#account-app [data-send-verify]');
  t((await waitCalls(page, 'user.sendEmailVerification', 1)).length === 1, '«Στείλτε μου e-mail επιβεβαίωσης» sends it');
  await server(page, 'verify', 'u-fb', true);
  await page.click('#account-app [data-verified-li]');
  t(await waitFor(page, () => { const b = document.querySelector('#account-app [data-link="google"]'); return b && !b.disabled; }), 'once confirmed, the button is enabled');
  t(await page.evaluate(() => document.activeElement && document.activeElement.closest && !!document.activeElement.closest('#methods')), '… and keyboard focus stays in «Τρόποι σύνδεσης»');
});

await scenario('K7', 'account page: after deleting, signing in again on the same page shows the new account', { cfg: 'oidc',
  seed: signedInSeed(mariaAcct({ lastSignIn: Date.now() - 60e3 }), { docs: { ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου' }) } }) }, async (page) => {
  await page.goto(URL_('account/'));
  await page.click('#account-app [data-del-open]');
  await page.fill('#del-confirm', 'ΔΙΑΓΡΑΦΗ');
  await page.click('#account-app [data-del-go]');
  t(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.'), 'the account is deleted');
  await page.click('#acct-slot [data-signin]');
  await sdkReady(page);
  await queue(page, 'signInWithPopup', { provider: 'google.com', resolve: { uid: 'u-new', email: 'new@example.com', displayName: 'Νέος Χρήστης', isNewUser: true } });
  await page.click('.modal [data-provider="google"]');
  t(await waitFor(page, () => !!document.querySelector('#account-app form[data-apply]')), 'signing in again shows the new account and its application form');
  t(!(await hasText(page.locator('#account-app'), 'Ο λογαριασμός σας διαγράφηκε.', 200)), '… not the old «deleted» message');
});

await scenario('K8', 'header: «Αποσύνδεση» pressed before the sign-in service has loaded really signs out', { cfg: 'oidc', sdkDelayMs: 1500,
  seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.addInitScript(() => { try { localStorage.setItem('semfe:auth-hint', JSON.stringify({ n: 'Μαρία Παπαδοπούλου', p: '', e: 'maria@example.com' })); } catch (e) {} });
  await page.goto(URL_('blog/'));
  t(await visible(page.locator('#acct-slot .acct-chip'), 1000), 'the header shows the member from the saved hint at once');
  await page.click('#acct-slot .acct-chip');
  await page.click('#acct-slot [data-signout]');
  t(await visible(page.locator('#acct-slot [data-signin]'), 1000), 'the header shows «Σύνδεση» straight away');
  await sleep(2500);
  t((await calls(page, 'auth.signOut')).length === 1, 'once the SDK arrives, auth.signOut() is called');
  t(await visible(page.locator('#acct-slot [data-signin]')) && !(await page.locator('#acct-slot .acct-chip').count()), 'and the session does not come back');
});

await scenario('K9', '?signin while already signed in does not open the dialog', { cfg: 'oidc', seed: signedInSeed(mariaAcct()) }, async (page) => {
  await page.goto(URL_('blog/?signin'));
  t(await visible(page.locator('#acct-slot .acct-chip')), 'the member is signed in');
  await sleep(400);
  t(!(await dialogOpen(page)), 'no sign-in dialog opens over them');
});

await scenario('K10', 'LinkedIn callback: an error text in a hand-made link is not shown', { cfg: 'function' }, async (page) => {
  await page.goto(URL_('auth/linkedin/?error=server_error&error_description=Ο+λογαριασμός+σας+ανεστάλη,+τηλεφωνήστε+στο+210'));
  t(await hasText(page.locator('#li-app'), 'Το LinkedIn δεν ολοκλήρωσε τη σύνδεση'), 'the generic failure message is shown');
  t(!(await hasText(page.locator('#li-app'), 'ανεστάλη', 200)), '… and not the text from the address');
});

await scenario('K11', 'admin page: keyboard focus stays on the same control after a redraw', { cfg: 'oidc', seed: ADMIN_SEED }, async (page) => {
  await page.goto(URL_('admin/'));
  await page.click('[data-filter="all"]');
  const row = page.locator('#admin-app tr[data-id]').first();
  const id = await row.getAttribute('data-id');
  await row.locator('[data-act="dues"]').focus();
  await page.keyboard.press('Enter');
  t(await waitFor(page, i => { const a = document.activeElement; const tr = a && a.closest && a.closest('tr'); return !!tr && tr.getAttribute('data-id') === i && a.getAttribute('data-act') === 'dues'; }, id),
    'after recording dues, focus is on the same row\'s dues button');
});

await scenario('K12', 'admin page: typing in the search box with an input method (a word composed over several steps) works', { cfg: 'oidc', seed: ADMIN_SEED }, async (page) => {
  await page.goto(URL_('admin/'));
  await page.click('[data-filter="all"]');
  await page.focus('#adm-q');
  const cdp = await page.context().newCDPSession(page);
  for (const t of ['κ', 'κα', 'καρ']) await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
  await cdp.send('Input.insertText', { text: 'καρ' });
  await sleep(200);
  t((await page.inputValue('#adm-q')) === 'καρ', 'the search box holds exactly «καρ»' + list([await page.inputValue('#adm-q')]));
  t(await page.evaluate(() => document.activeElement && document.activeElement.id === 'adm-q'), '… and keeps focus');
});

await scenario('K13', 'account page: #delete (from the data-deletion page) scrolls to the delete panel', { cfg: 'oidc', viewport: { width: 390, height: 844 },
  seed: signedInSeed(mariaAcct(), { docs: { ['members/' + MARIA.uid]: member({ firstName: 'Μαρία', lastName: 'Παπαδοπούλου', status: 'active' }) } }) }, async (page) => {
  await page.goto(URL_('account/#delete'));
  t(await waitFor(page, () => { const h = document.querySelector('#delete h2'); if (!h) return false; const r = h.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }), 'the delete panel is on screen');
  t(await page.evaluate(() => document.activeElement && document.activeElement.closest && !!document.activeElement.closest('#delete')), '… with keyboard focus on its heading');
});

await browser.close();
console.log(`\n${passes} passed, ${fails} failed`);
if (fails) { console.log('\nFailures:\n  ' + failed.join('\n  ')); }
process.exit(fails ? 1 : 0);
