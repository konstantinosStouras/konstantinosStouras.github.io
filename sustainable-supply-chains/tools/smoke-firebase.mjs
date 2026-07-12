/* ==========================================================================
   Sustainable Supply Chains — tools/smoke-firebase.mjs
   End-to-end test of the REAL Firebase code path against the official
   Firebase Emulator Suite (Auth + Firestore, enforcing the repo's actual
   firestore.rules). What demo-mode smoke.mjs can't cover, this does:

     · email/password admin sign-in, anonymous student sign-in
     · sessions + sscSessionCodes lookup flow, firms with memberUids,
       decisions, results, markets, messages, async instances — all through
       store.js's Firebase backend (SDK loaded via route-interception, since
       this environment blocks gstatic.com)
     · SECURITY: a hostile signed-in outsider must be DENIED: forging another
       firm's decision, updating the session doc, writing results, hijacking
       a firm, spoofing a message sender, and listing all sessions.

   Requirements: Java (Firestore emulator), firebase-tools, and the npm
   `firebase` package (its flat firebase-*.js browser bundles).
   Run:
     FIREBASE_BIN=/path/to/node_modules/.bin/firebase \
     FIREBASE_SDK_DIR=/path/to/node_modules/firebase \
     node sustainable-supply-chains/tools/smoke-firebase.mjs
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile, mkdtemp, writeFile, copyFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(ROOT, 'sustainable-supply-chains');
const FIREBASE_BIN = process.env.FIREBASE_BIN || 'firebase';
const SDK_DIR = process.env.FIREBASE_SDK_DIR || '';
const AUTH_PORT = 9199, FS_PORT = 8181, PROJECT = 'ssc-emutest';
const ADMIN_PASS = 'test-password-1';

function fail(msg) { console.error('FB-SMOKE FAIL: ' + msg); process.exit(1); }

// admin email comes from the shipped config so config/rules/test never drift
const cfgText = await readFile(join(APP, 'firebase-config.js'), 'utf8');
const adminEmail = (cfgText.match(/SSC_ADMIN_EMAILS\s*=\s*\['([^']+)'/) || [])[1];
if (!adminEmail) fail('could not parse SSC_ADMIN_EMAILS from firebase-config.js');
const rulesText = await readFile(join(APP, 'firestore.rules'), 'utf8');
if (rulesText.indexOf("'" + adminEmail + "'") === -1)
  fail('firestore.rules isAdmin() does not list ' + adminEmail + ' — config and rules drifted apart');

/* ---- 1 · start the emulators with the repo rules --------------------------- */
const work = await mkdtemp(join(tmpdir(), 'ssc-fbemu-'));
await copyFile(join(APP, 'firestore.rules'), join(work, 'firestore.rules'));
await writeFile(join(work, 'firebase.json'), JSON.stringify({
  firestore: { rules: 'firestore.rules' },
  emulators: {
    auth: { port: AUTH_PORT, host: '127.0.0.1' },
    firestore: { port: FS_PORT, host: '127.0.0.1' },
    ui: { enabled: false }
  }
}, null, 2));
async function up(port) {
  try { await fetch(`http://127.0.0.1:${port}/`); return true; } catch { return false; }
}
let emu = null, emuLog = '';
if (await up(AUTH_PORT) && await up(FS_PORT)) {
  console.log('· reusing already-running emulators (a previous run left them up)');
} else {
  emu = spawn(FIREBASE_BIN, ['emulators:start', '--only', 'auth,firestore', '--project', PROJECT],
    { cwd: work, stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, CI: 'true' } });
  emu.stdout.on('data', d => { emuLog += d; });
  emu.stderr.on('data', d => { emuLog += d; });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (await up(AUTH_PORT) && await up(FS_PORT)) { ready = true; break; }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!ready) { console.error(emuLog.slice(-3000)); fail('emulators did not start'); }
}
// clean slate: wipe both emulators' data (idempotent across runs)
await fetch(`http://127.0.0.1:${AUTH_PORT}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' }).catch(() => {});
await fetch(`http://127.0.0.1:${FS_PORT}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' }).catch(() => {});
console.log('· emulators up (auth :' + AUTH_PORT + ', firestore :' + FS_PORT + ') with repo firestore.rules, data wiped');

// admin auth user (EMAIL_EXISTS is fine if a wipe raced)
const su = await fetch(`http://127.0.0.1:${AUTH_PORT}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: adminEmail, password: ADMIN_PASS, returnSecureToken: true })
});
if (!su.ok) {
  const body = await su.text();
  if (!/EMAIL_EXISTS/.test(body)) fail('could not create admin auth user: ' + body);
}

/* ---- 2 · static server; firebase-config.js swapped for emulator config ------ */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const EMU_CONFIG = `window.SSC_FIREBASE_CONFIG = {
  apiKey: 'emu-fake-key', authDomain: '127.0.0.1', projectId: '${PROJECT}',
  storageBucket: '${PROJECT}.appspot.com', messagingSenderId: '0', appId: 'emu',
  emulators: { auth: 'http://127.0.0.1:${AUTH_PORT}', firestoreHost: '127.0.0.1', firestorePort: ${FS_PORT} }
};
window.SSC_ADMIN_EMAILS = ['${adminEmail}'];
window.SSC_PATHS = { sessions: 'sscSessions', codes: 'sscSessionCodes' };
window.SSC_FIREBASE_SDK_VERSION = '10.12.2';\n`;
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    if (/\/sustainable-supply-chains\/firebase-config\.js$/.test(p)) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(EMU_CONFIG);
      return;
    }
    const data = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/sustainable-supply-chains`;

/* ---- 3 · browser with gstatic route-interception ----------------------------- */
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox']
});
const ctx = await browser.newContext({ viewport: { width: 1360, height: 940 } });
await ctx.route('**://www.gstatic.com/firebasejs/**', async route => {
  const name = route.request().url().split('/').pop().split('?')[0];
  try {
    const body = await readFile(join(SDK_DIR, name));
    await route.fulfill({ status: 200, contentType: 'text/javascript', body });
  } catch { await route.fulfill({ status: 404, body: 'not found: ' + name }); }
});
const problems = [];
function watch(page, tag) {
  page.on('pageerror', e => problems.push(`[${tag}] pageerror: ${e.message}\n${(e.stack || '').split('\n').slice(0, 4).join('\n')}`));
  page.on('console', m => {
    const t = m.text();
    // 400s on WebChannel teardown are routine emulator noise
    if (m.type() === 'error' && !/net::ERR|favicon|fonts\.g|400 \(Bad Request\)/i.test(t)) problems.push(`[${tag}] console: ${t}`);
  });
}

try {
  /* ---- admin: sign in, create live session, add nash bot ---------------------- */
  const admin = await ctx.newPage(); watch(admin, 'admin');
  await admin.goto(BASE + '/admin/', { waitUntil: 'load' });
  await admin.waitForSelector('#a-login.active', { timeout: 15000 }).catch(() => fail('admin login screen did not appear (configured mode)'));
  await admin.fill('#in-email', adminEmail);
  await admin.fill('#in-pass', ADMIN_PASS);
  await admin.click('#btn-login');
  await admin.waitForSelector('#a-dash.active', { timeout: 15000 }).catch(() => fail('admin email/password sign-in failed'));
  console.log('· admin signed in (email/password)');
  await admin.waitForFunction(() => { var b = document.querySelector('#conn-banner'); return b && /connected/i.test(b.textContent); }, null, { timeout: 15000 })
    .catch(() => fail('admin connection self-check did not go green'));
  console.log('· admin connection self-check green (ping round-trip through sscSessionCodes)');
  await admin.fill('#f-code', 'FBLIVE');
  await admin.fill('#f-rounds', '2');
  await admin.click('#btn-save-session');
  await admin.waitForSelector('#btn-goto-ctrl', { timeout: 10000 }).catch(() => fail('session create failed (Firestore write)'));
  await admin.click('#btn-goto-ctrl');
  await admin.waitForSelector('#c-addbot', { timeout: 10000 }).catch(() => fail('control room did not render'));
  await admin.selectOption('#c-botprofile', 'nash');
  await admin.click('#c-addbot');
  await admin.waitForFunction(() => document.querySelectorAll('#ctrl-root tbody tr').length >= 1, null, { timeout: 10000 })
    .catch(() => fail('nash bot firm did not appear'));

  /* ---- student: anonymous join via code lookup, found firm --------------------- */
  const stu = await ctx.newPage(); watch(stu, 'student');
  await stu.goto(BASE + '/?code=FBLIVE', { waitUntil: 'load' });
  await stu.waitForSelector('#s-firm.active', { timeout: 20000 }).catch(() => fail('student join via sscSessionCodes lookup failed'));
  console.log('· student joined anonymously via code lookup');
  await stu.fill('#in-firmname', 'FB Test Firm');
  await stu.selectOption('#in-hub', 'europe');
  await stu.click('#btn-create-firm');
  await stu.waitForSelector('#s-lobby.active', { timeout: 10000 }).catch(() => fail('firm creation (memberUids rules) failed'));

  // admin session must SURVIVE the student page's anonymous sign-in (both in one browser)
  await admin.click('.tabs [data-tab="sessions"]');
  await admin.waitForSelector('#a-dash.active', { timeout: 5000 });
  const stillIn = await admin.evaluate(() => document.querySelector('#a-login').classList.contains('active') === false);
  if (!stillIn) fail('admin session was clobbered by the student page (authStateReady guard broken)');
  console.log('· admin session survived a student tab in the same browser');

  /* ---- play a round through Firestore ------------------------------------------- */
  await admin.click('.tabs [data-tab="control"]');
  await admin.waitForSelector('#c-start:not([disabled])', { timeout: 10000 }).catch(() => fail('start not ready'));
  await admin.click('#c-start');
  await stu.waitForSelector('#qty-battery-bat_gda', { timeout: 15000 }).catch(() => fail('decision form did not open'));
  await stu.fill('#qty-battery-bat_gda', '150');
  await stu.fill('#f-production', '200');
  await stu.click('#btn-submit');
  await stu.waitForSelector('#submitted-banner', { timeout: 10000 }).catch(() => fail('decision write (ownership rules) failed'));
  admin.on('dialog', d => d.accept());
  await admin.waitForSelector('#c-resolve', { timeout: 10000 });
  await admin.click('#c-resolve');
  await admin.waitForSelector('#c-next', { timeout: 15000 }).catch(() => fail('round resolution (results/markets writes) failed'));
  await stu.click('[data-tab="results"]');
  await stu.waitForFunction(() => /Profit/.test(document.querySelector('#tp-results').textContent), null, { timeout: 10000 })
    .catch(() => fail('student cannot read results'));
  console.log('· full round played through Firestore (decisions → resolve → results)');

  /* ---- messaging round-trip ------------------------------------------------------- */
  await stu.click('[data-tab="messages"]');
  await stu.waitForSelector('#msg-send', { timeout: 5000 });
  await stu.fill('#msg-text', 'hello from the firm');
  await stu.click('#msg-send');
  await admin.waitForFunction(() => /hello from the firm/.test(document.querySelector('#ctrl-root').textContent), null, { timeout: 10000 })
    .catch(() => fail('firm→instructor message did not arrive'));
  await admin.fill('#c-dm-text', 'hello back');
  await admin.click('#c-dm-send');
  await stu.waitForFunction(() => /hello back/.test(document.querySelector('#tp-messages').textContent), null, { timeout: 10000 })
    .catch(() => fail('instructor→firm reply did not arrive'));
  console.log('· messaging round-trip through Firestore OK');

  /* ---- async practice through Firestore -------------------------------------------- */
  await admin.click('.tabs [data-tab="sessions"]');
  await admin.fill('#f-code', 'FBASYNC');
  await admin.fill('#f-rounds', '2');
  await admin.evaluate(() => {
    const el = document.querySelector('#f-async');
    el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await admin.click('#btn-save-session');
  await admin.waitForSelector('#btn-goto-ctrl', { timeout: 8000 });
  const stu2 = await ctx.newPage(); watch(stu2, 'async-student');
  await stu2.goto(BASE + '/?code=FBASYNC', { waitUntil: 'load' });
  await stu2.waitForSelector('#s-firm.active', { timeout: 15000 });
  await stu2.fill('#in-firmname', 'FB Async Firm');
  await stu2.click('#btn-create-firm');
  await stu2.waitForSelector('#btn-endround', { timeout: 15000 }).catch(() => fail('async instance creation (async rules) failed'));
  await stu2.click('#btn-endround');
  await stu2.waitForSelector('#btn-nextround-res', { timeout: 15000 }).catch(() => fail('async round did not resolve/save'));
  console.log('· async practice instance created and resolved through Firestore');

  /* ---- SECURITY: a hostile signed-in outsider must be denied ------------------------ */
  const probe = await ctx.newPage(); // no watch(): we EXPECT denied-permission noise here
  await probe.goto(BASE + '/', { waitUntil: 'load' });
  const denials = await probe.evaluate(async (cfg) => {
    const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
    const appM = await import(base + 'firebase-app.js');
    const authM = await import(base + 'firebase-auth.js');
    const fsM = await import(base + 'firebase-firestore.js');
    const app = appM.initializeApp(cfg, 'probe');
    const auth = authM.getAuth(app);
    authM.connectAuthEmulator(auth, cfg.emulators.auth, { disableWarnings: true });
    // second Firestore instance in the page: force long polling — the default
    // WebChannel transport can report 'client is offline' for a second client
    const db = fsM.initializeFirestore(app, { experimentalForceLongPolling: true });
    fsM.connectFirestoreEmulator(db, cfg.emulators.firestoreHost, cfg.emulators.firestorePort);
    await authM.signInAnonymously(auth); // a signed-in user who belongs to NO firm
    // find the live session + victim firm through reads students are allowed
    let codeSnap = null, lastErr = null;
    for (let i = 0; i < 5 && !codeSnap; i++) {
      try { codeSnap = await fsM.getDoc(fsM.doc(db, 'sscSessionCodes', 'FBLIVE')); }
      catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 1500)); }
    }
    if (!codeSnap) return ['probe bootstrap failed: ' + (lastErr && (lastErr.code || lastErr.message))];
    const sid = codeSnap.data().sessionId;
    const firms = await fsM.getDocs(fsM.collection(db, 'sscSessions', sid, 'firms'));
    let victim = null;
    firms.forEach(d => { if (!d.data().isBot) victim = d.id; });
    async function attempt(name, fn) {
      try { await fn(); return name + ': ALLOWED (BAD)'; }
      catch (e) { return name + ': ' + (String(e.code || e.message).indexOf('permission') !== -1 ? 'denied' : 'error ' + (e.code || e.message)); }
    }
    return Promise.all([
      attempt('forge rival decision', () =>
        fsM.setDoc(fsM.doc(db, 'sscSessions', sid, 'decisions', victim + '_2'),
          { firmId: victim, round: 2, orders: {}, production: 0, prices: {}, submitted: true })),
      attempt('tamper session doc', () =>
        fsM.setDoc(fsM.doc(db, 'sscSessions', sid), { round: 99 }, { merge: true })),
      attempt('forge results', () =>
        fsM.setDoc(fsM.doc(db, 'sscSessions', sid, 'results', victim + '_1'), { profit: 1e9 })),
      attempt('hijack rival firm', () =>
        fsM.setDoc(fsM.doc(db, 'sscSessions', sid, 'firms', victim), { name: 'pwned' }, { merge: true })),
      attempt('spoof message sender', () =>
        fsM.addDoc(fsM.collection(db, 'sscSessions', sid, 'messages'),
          { from: victim, fromName: 'spoof', to: 'admin', text: 'x', at: 1, round: 1 })),
      attempt('list all sessions', async () => {
        const qs = await fsM.getDocs(fsM.collection(db, 'sscSessions'));
        if (qs.size >= 0) return;
      })
    ]);
  }, {
    apiKey: 'emu-fake-key', authDomain: '127.0.0.1', projectId: PROJECT,
    storageBucket: PROJECT + '.appspot.com', messagingSenderId: '0', appId: 'emu',
    emulators: { auth: 'http://127.0.0.1:' + AUTH_PORT, firestoreHost: '127.0.0.1', firestorePort: FS_PORT }
  });
  const bad = denials.filter(d => !/denied$/.test(d));
  denials.forEach(d => console.log('  security · ' + d));
  if (bad.length) fail('rules allowed forbidden operations:\n' + bad.join('\n'));
  console.log('· security rules verified: all six hostile operations denied');

  const benign = problems.filter(p => !/net::ERR|favicon/i.test(p));
  if (benign.length) fail('console/page errors:\n' + benign.join('\n'));
  console.log('\nFB-SMOKE OK — the full Firebase path (auth, code lookup, firms, decisions, resolve, messages, async) works against the emulator with the shipped firestore.rules.');
} finally {
  await browser.close();
  server.close();
  if (emu) {
    try { process.kill(-emu.pid, 'SIGTERM'); } catch (e) { try { emu.kill('SIGTERM'); } catch (e2) {} }
  }
}
