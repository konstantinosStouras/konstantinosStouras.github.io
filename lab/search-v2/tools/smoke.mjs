/* ==========================================================================
   search-v2  ·  tools/smoke.mjs
   Headless-browser acceptance tests (the ones selftest.js can't do in Node):
     4 · Arm isolation in the live DOM
     8 · Resume mid-round (no double-logging)
     9 · Scripted playthrough → one event per action, in order; upload success
         and simulated endpoint-failure → download fallback

   Requires a Chromium and Playwright. In this repo's dev container:
     SCRATCH node_modules has playwright-core; Chromium lives in /opt/pw-browsers.
     node --experimental-vm-modules is not needed.

   Run from lab/search-v2/:
     CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
     NODE_PATH=<dir-with-playwright-core> node tools/smoke.mjs
   ========================================================================== */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..'); // .../ (repo root)
const PORT = 8123;
const APP = `http://localhost:${PORT}/lab/search-v2/`;
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let passed = 0, failed = 0;
const ok = (name, cond, extra) => {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- static file server ----------------------------------------------------
function startServer() {
  const p = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO_ROOT, stdio: 'ignore' });
  return p;
}

// The committed firebase-config.js may hold a real project, which would flip the
// app + admin into configured mode (needs live Firebase). These acceptance tests
// validate the deterministic UNCONFIGURED code paths, so every context serves a
// placeholder firebase-config.js. (The real config is exercised on the live site.)
const PLACEHOLDER_FBCONFIG =
  "window.FIREBASE_CONFIG={apiKey:'PASTE_API_KEY',projectId:'PASTE_PROJECT'};" +
  "window.ADMIN_EMAILS=['admin@example.com'];" +
  "window.FIREBASE_PATHS={events:'events',configDoc:'config/study'};" +
  "window.FIREBASE_SDK_VERSION='10.12.2';";
async function newCtx(browser) {
  const ctx = await browser.newContext();
  await ctx.route('**/firebase-config.js', function (route) {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: PLACEHOLDER_FBCONFIG });
  });
  return ctx;
}

// ---- flow helpers ----------------------------------------------------------
const CORRECT = { q1: '60', q2: '52', q3: 'It says it has no data there', q4: 'An estimate that can be wrong' };

async function consentInstructionsQuiz(page, arm) {
  await page.waitForSelector('#s-consent.active', { timeout: 8000 });
  await page.check('#consent-box');
  await page.click('#btn-consent');
  await page.waitForSelector('#s-instructions.active');
  await page.click('#btn-instructions');
  await page.waitForSelector('#s-quiz.active');
  await page.check(`input[name="q1"][value="${CORRECT.q1}"]`);
  await page.check(`input[name="q2"][value="${CORRECT.q2}"]`);
  if (arm === 'B') {
    await page.check(`input[name="q3"][value="${CORRECT.q3}"]`);
    await page.check(`input[name="q4"][value="${CORRECT.q4}"]`);
  }
  await page.click('#btn-quiz');
  await page.waitForSelector('#s-round.active');
}

async function playRound(page, reveals = 1) {
  await page.waitForSelector('#s-round.active');
  for (let i = 0; i < reveals; i++) {
    await page.fill('#pos-input', String(40 + i * 5));
    await page.dispatchEvent('#pos-input', 'change');
    await page.click('#btn-reveal');
  }
  await page.click('#btn-stop');
  await page.waitForSelector('#ov-stop.show');
  await page.click('#btn-stop-ok');
  await page.waitForSelector('#s-interstitial.active');
  await page.click('#btn-continue');
}

async function getEvents(page) { return page.evaluate(() => window.Logger.getEvents()); }

// ==========================================================================
async function main() {
  const server = startServer();
  await sleep(900);
  const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

  try {
    // ---------------- TEST 4: Arm A isolation ----------------
    console.log('\nTest 4 · Arm isolation (Arm A live DOM)');
    {
      const ctx = await newCtx(browser);
      const page = await ctx.newPage();
      await page.goto(APP + '?arm=A&SESSION_ID=smokeA', { waitUntil: 'networkidle' });
      await consentInstructionsQuiz(page, 'A');
      const bodyText = (await page.innerText('body')).toLowerCase();
      ok('Arm A DOM has no "assistant" text', !bodyText.includes('assistant'), bodyText.match(/assistant/)?.[0]);
      ok('Arm A DOM has no "coverage" text', !bodyText.includes('coverage'));
      ok('Arm A has no assistant panel content', (await page.innerText('#aux-panel')).trim() === '');
      const bandCount = await page.locator('.cov-band').count();
      const diamondCount = await page.locator('.est-diamond').count();
      ok('Arm A chart draws no coverage band', bandCount === 0);
      ok('Arm A chart draws no estimate diamonds', diamondCount === 0);
      ok('Arm A never requested assistant.js',
        await page.evaluate(() => !window.Assistant));
      await ctx.close();
    }

    // ---------------- TEST 4b + Arm B behaviour ----------------
    console.log('\nTest 4b · Arm B panel, estimate, refusal');
    {
      const ctx = await newCtx(browser);
      const page = await ctx.newPage();
      await page.goto(APP + '?arm=B&SESSION_ID=smokeB', { waitUntil: 'networkidle' });
      await consentInstructionsQuiz(page, 'B');
      ok('Arm B shows the side panel', (await page.locator('#btn-ask').count()) === 1);
      const band = await page.locator('.cov-band').count();
      ok('Arm B chart draws the coverage band', band === 1);
      // ask inside coverage -> estimate + diamond
      await page.fill('#ai-pos', '50');
      await page.click('#btn-ask');
      await page.waitForSelector('.ai-msg');
      const est = (await page.innerText('#ai-log')).toLowerCase();
      ok('Arm B estimate reply mentions "estimate"', est.includes('estimate'));
      ok('Arm B ask plots a diamond', (await page.locator('.est-diamond').count()) === 1);
      // ask outside coverage -> refusal
      await page.fill('#ai-pos', '90');
      await page.click('#btn-ask');
      const log2 = (await page.innerText('#ai-log')).toLowerCase();
      ok('Arm B refuses outside coverage', log2.includes('no data'));
      ok('refusal does not add a diamond', (await page.locator('.est-diamond').count()) === 1);
      await ctx.close();
    }

    // ---------------- TEST 8: Resume mid-round ----------------
    console.log('\nTest 8 · Resume mid-round (no double-logging)');
    {
      const ctx = await newCtx(browser);
      const page = await ctx.newPage();
      await page.goto(APP + '?arm=B&SESSION_ID=smokeResume', { waitUntil: 'networkidle' });
      await consentInstructionsQuiz(page, 'B');
      // in the practice round: reveal two, ask one
      await page.fill('#pos-input', '45'); await page.dispatchEvent('#pos-input', 'change'); await page.click('#btn-reveal');
      await page.fill('#pos-input', '60'); await page.dispatchEvent('#pos-input', 'change'); await page.click('#btn-reveal');
      await page.fill('#ai-pos', '50'); await page.click('#btn-ask');
      const before = await getEvents(page);
      const revealsBefore = before.filter(e => e.event === 'reveal').length;
      const startsBefore = before.filter(e => e.event === 'round_start').length;
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#s-round.active');
      const cReveals = await page.innerText('#c-reveals');
      ok('resume restores reveal count', cReveals.trim() === '2', 'got ' + cReveals);
      ok('resume restores estimate diamond', (await page.locator('.est-diamond').count()) === 1);
      const after = await getEvents(page);
      ok('resume does not re-log round_start',
        after.filter(e => e.event === 'round_start').length === startsBefore, 'starts=' + after.filter(e => e.event === 'round_start').length);
      ok('resume does not duplicate reveals',
        after.filter(e => e.event === 'reveal').length === revealsBefore, 'reveals=' + after.filter(e => e.event === 'reveal').length);

      // 8b: refresh on the interstitial must NOT re-enter/re-score the finished round
      await page.click('#btn-stop'); await page.waitForSelector('#ov-stop.show'); await page.click('#btn-stop-ok');
      await page.waitForSelector('#s-interstitial.active');
      const endsBefore = (await getEvents(page)).filter(e => e.event === 'round_end').length;
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#s-interstitial.active', { timeout: 8000 }).catch(() => {});
      ok('refresh on interstitial stays on the interstitial (not the round)',
        await page.isVisible('#s-interstitial') && !(await page.isVisible('#s-round')));
      const endsAfter = (await getEvents(page)).filter(e => e.event === 'round_end').length;
      ok('refresh on interstitial does not duplicate round_end', endsAfter === endsBefore, 'ends ' + endsBefore + '->' + endsAfter);
      await page.click('#btn-continue');
      await page.waitForSelector('#s-round.active');
      ok('continue after interstitial-refresh advances to the next round',
        (await page.innerText('#round-label')).includes('Round 1'));
      await ctx.close();
    }

    // ---------------- TEST 9: Full playthrough + upload success ----------------
    console.log('\nTest 9 · Full playthrough, one event/action, upload in order');
    {
      const ctx = await newCtx(browser);
      const page = await ctx.newPage();
      const received = [];
      await page.route('**/__collect*', async route => {
        try { received.push(JSON.parse(route.request().postData() || '{}')); } catch (e) {}
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      });
      const ep = encodeURIComponent(`http://localhost:${PORT}/__collect`);
      await page.goto(APP + `?arm=A&debug=1&key=stouras&SESSION_ID=smokeFull&endpoint=${ep}`, { waitUntil: 'networkidle' });
      await consentInstructionsQuiz(page, 'A');
      for (let r = 0; r < 11; r++) await playRound(page, 1 + (r % 3)); // practice + 10 real
      await page.waitForSelector('#s-finish.active', { timeout: 10000 });

      const code = (await page.innerText('#completion-code')).trim();
      ok('finish shows a completion code', code.length > 0);
      ok('finish shows a bonus in dollars', /\$\d+\.\d\d/.test(await page.innerText('#finish-body')));

      const ev = await getEvents(page);
      const types = ev.map(e => e.event);
      ok('logged session_start once', types.filter(t => t === 'session_start').length === 1);
      ok('logged consent', types.includes('consent'));
      ok('logged 11 round_start (practice + 10)', types.filter(t => t === 'round_start').length === 11);
      ok('logged 11 round_end', types.filter(t => t === 'round_end').length === 11);
      ok('logged paid_rounds_drawn once', types.filter(t => t === 'paid_rounds_drawn').length === 1);
      ok('logged session_end once', types.filter(t => t === 'session_end').length === 1);
      const ts = ev.map(e => e.t);
      ok('event timestamps are non-decreasing (in order)', ts.every((t, i) => i === 0 || t >= ts[i - 1]));
      // uploads happened and carried events in order
      await page.evaluate(() => window.Logger.flush());
      await sleep(600);
      const uploaded = received.flatMap(b => b.events || []);
      ok('upload delivered events to the endpoint', uploaded.length > 0, 'got ' + uploaded.length);
      const upTs = uploaded.map(e => e.t);
      ok('uploaded events are in order', upTs.every((t, i) => i === 0 || t >= upTs[i - 1]));
      // meta events are mirrored locally but NEVER uploaded (no self-perpetuating loop)
      ok('upload_ok/upload_fail are NOT uploaded to the endpoint',
        uploaded.every(e => e.event !== 'upload_ok' && e.event !== 'upload_fail'));
      ok('upload_ok IS recorded in the local mirror', types.includes('upload_ok'));
      // no duplicate rows: a real re-send (the beacon bug) uploads a byte-identical
      // event object twice, so key on the full event (distinct events never match:
      // they differ in qid/position/counters/t, and selects/reveals can't repeat).
      const seen = new Set();
      let dup = 0; uploaded.forEach(e => { const k = JSON.stringify(e); if (seen.has(k)) dup++; seen.add(k); });
      ok('no duplicate events uploaded', dup === 0, dup + ' dups');
      // rt_ms of a subject action is not clobbered by a meta event (meta events carry rt but
      // do not advance the subject clock): every reveal has a positive/def rt_ms
      ok('reveal events carry rt_ms (subject clock intact)',
        ev.filter(e => e.event === 'reveal').every(e => e.rt_ms === null || typeof e.rt_ms === 'number'));
      // CSV export works
      const csv = await page.evaluate(() => window.Logger.toCSV());
      ok('CSV export has header + one row per event', csv.split('\n').length >= ev.length + 1);
      await ctx.close();
    }

    // ---------------- TEST 9b: Endpoint failure -> download fallback ----------------
    console.log('\nTest 9b · Endpoint failure → download fallback note');
    {
      const ctx = await newCtx(browser);
      const page = await ctx.newPage();
      await page.route('**/__collect*', route => route.abort());
      const ep = encodeURIComponent(`http://localhost:${PORT}/__collect`);
      await page.goto(APP + `?arm=A&debug=1&key=stouras&SESSION_ID=smokeFail&endpoint=${ep}`, { waitUntil: 'networkidle' });
      await consentInstructionsQuiz(page, 'A');
      for (let r = 0; r < 11; r++) await playRound(page, 1);
      await page.waitForSelector('#s-finish.active', { timeout: 10000 });
      // completion code still shown despite upload failure
      ok('completion code shown even when endpoint is down', (await page.innerText('#completion-code')).trim().length > 0);
      await page.waitForSelector('#upload-note', { state: 'visible', timeout: 12000 }).catch(() => {});
      const noteVisible = await page.isVisible('#upload-note');
      ok('fallback download note appears when endpoint unreachable', noteVisible);
      await ctx.close();
    }

    // ---------------- TEST 10: Debug pre-fills the quiz answers ----------------
    console.log('\nTest 10 · Debug mode pre-selects correct quiz answers');
    {
      const ctx = await newCtx(browser);
      const page = await ctx.newPage();
      await page.goto(APP + '?arm=B&debug=1&key=stouras&SESSION_ID=smokeDbg', { waitUntil: 'networkidle' });
      await page.waitForSelector('#s-consent.active');
      await page.check('#consent-box'); await page.click('#btn-consent');
      await page.waitForSelector('#s-instructions.active'); await page.click('#btn-instructions');
      await page.waitForSelector('#s-quiz.active');
      ok('all quiz questions are pre-answered in debug', (await page.locator('input[type=radio]:checked').count()) === 4);
      // submit WITHOUT manually selecting anything -> should pass straight into the round
      await page.click('#btn-quiz');
      await page.waitForSelector('#s-round.active', { timeout: 6000 }).catch(() => {});
      ok('submitting the pre-filled quiz passes into the game', await page.isVisible('#s-round'));
      // and a real subject (no debug) gets NO pre-filled answers
      const ctx2 = await newCtx(browser);
      const p2 = await ctx2.newPage();
      await p2.goto(APP + '?arm=B&SESSION_ID=smokeNoDbg', { waitUntil: 'networkidle' });
      await p2.waitForSelector('#s-consent.active');
      await p2.check('#consent-box'); await p2.click('#btn-consent');
      await p2.waitForSelector('#s-instructions.active'); await p2.click('#btn-instructions');
      await p2.waitForSelector('#s-quiz.active');
      ok('non-debug subject sees no pre-selected answers', (await p2.locator('input[type=radio]:checked').count()) === 0);
      await ctx.close(); await ctx2.close();
    }

    // ---------------- TEST 11: Admin panel (local-preview mode) ----------------
    console.log('\nTest 11 · Admin panel renders in local mode + reads local data');
    {
      const ctx = await newCtx(browser);
      const page = await ctx.newPage();
      // play a short session so this origin has local log data for the admin to show
      await page.goto(APP + '?arm=A&SESSION_ID=smokeAdmin', { waitUntil: 'networkidle' });
      await consentInstructionsQuiz(page, 'A');
      await playRound(page, 1); // practice
      await playRound(page, 2); // round 1
      // now open the admin panel in the SAME origin/context
      await page.goto(APP + 'admin/', { waitUntil: 'networkidle' });
      ok('admin opens straight to the dashboard when Firebase is unconfigured', await page.isVisible('#a-dash'));
      ok('admin shows the local-preview banner', /local preview/i.test(await page.innerText('#dash-banner')));
      ok('conditions Save is disabled in local mode', await page.locator('#btn-save').isDisabled());
      // Data tab
      await page.click('.tab[data-tab="data"]');
      ok('data tab shows a stat grid', (await page.locator('#stat-grid .stat-box').count()) >= 3);
      ok('data tab lists at least one session', (await page.locator('#sessions-table tbody tr').count()) >= 1);
      ok('data tab lists events', (await page.locator('#events-table tbody tr').count()) >= 1);
      // Setup tab has the Firebase steps
      await page.click('.tab[data-tab="setup"]');
      ok('setup tab documents Firebase steps', /firebase/i.test(await page.innerText('#setup-body')));
      await ctx.close();
    }

    // ---------------- TEST 12: Admin login is not clobbered (Firebase mock) ----------------
    // Regression guard: getStudyConfig() must NOT sign in anonymously when an admin
    // is already signed in, or it would replace the admin session and bounce them
    // back to the login screen. Uses the REAL firebase-config.js (configured mode)
    // with a mocked Firebase SDK routed in for the gstatic imports.
    console.log('\nTest 12 · Admin login survives getStudyConfig (no anon clobber)');
    {
      const MOCK_APP = `export function initializeApp(cfg){ if(!globalThis.__fb) globalThis.__fb={user:null,listeners:[],docs:{},anonCount:0}; return { cfg }; }`;
      const MOCK_AUTH = `const S=()=>globalThis.__fb;
function notify(){ S().listeners.slice().forEach(cb=>{try{cb(S().user)}catch(e){}}); }
export function getAuth(){ return { get currentUser(){ return S().user; } }; }
export function signInAnonymously(){ S().anonCount++; S().user={uid:'anon'+S().anonCount,email:null,isAnonymous:true}; notify(); return Promise.resolve({user:S().user}); }
export function signInWithEmailAndPassword(a,email,pw){ if(pw==='bad') return Promise.reject({code:'auth/wrong-password'}); S().user={uid:'admin1',email:email,isAnonymous:false}; notify(); return Promise.resolve({user:S().user}); }
export function onAuthStateChanged(a,cb){ S().listeners.push(cb); Promise.resolve().then(()=>cb(S().user)); return ()=>{}; }
export function signOut(){ S().user=null; notify(); return Promise.resolve(); }`;
      const MOCK_FS = `const S=()=>globalThis.__fb;
export function getFirestore(){ return {}; }
export function doc(db,col,id){ return { path: col+'/'+id }; }
export function getDoc(ref){ const d=S().docs[ref.path]; return Promise.resolve({ exists:()=>!!d, data:()=>d }); }
export function setDoc(ref,data){ S().docs[ref.path]=Object.assign({}, S().docs[ref.path]||{}, data); return Promise.resolve(); }
export function collection(db,name){ return { name }; }
export function query(col){ return { col }; }
export function orderBy(){ return {}; }
export function limit(){ return {}; }
export function getDocs(){ const rows=Object.entries(S().docs).filter(([k])=>k.startsWith('events/')).map(([k,v])=>({data:()=>v})); return Promise.resolve({ forEach:f=>rows.forEach(f) }); }`;
      // Real config (configured mode) — do NOT use newCtx() here (it stubs the
      // config to a placeholder); the committed firebase-config.js loads as-is.
      const ctx = await browser.newContext();
      await ctx.route('**/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: MOCK_APP }));
      await ctx.route('**/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: MOCK_AUTH }));
      await ctx.route('**/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: MOCK_FS }));
      const page = await ctx.newPage();
      await page.goto(APP + 'admin/', { waitUntil: 'domcontentloaded' });
      const gotLogin = await page.waitForSelector('#a-login.active', { timeout: 8000 }).then(() => true).catch(() => false);
      ok('configured admin shows the sign-in screen', gotLogin);
      await page.fill('#in-email', 'admin@admin.com');
      await page.fill('#in-pass', 'goodpass');
      await page.click('#btn-login');
      await sleep(1200); // onAuth -> enterAdmin -> loadConditions(getStudyConfig) -> loadData
      ok('admin reaches the dashboard after sign-in', await page.isVisible('#a-dash'));
      ok('admin is NOT bounced back to the login screen', !(await page.isVisible('#a-login')));
      ok('getStudyConfig did not sign the admin in anonymously',
        (await page.evaluate(() => globalThis.__fb && globalThis.__fb.anonCount)) === 0);
      ok('admin session preserved (still the admin email)',
        (await page.evaluate(() => globalThis.__fb && globalThis.__fb.user && globalThis.__fb.user.email)) === 'admin@admin.com');
      await ctx.close();
    }

  } finally {
    await browser.close();
    server.kill('SIGKILL');
  }

  console.log('\n' + '='.repeat(50));
  console.log(`SMOKE  PASS ${passed}  FAIL ${failed}`);
  console.log('='.repeat(50));
  process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(2); });
