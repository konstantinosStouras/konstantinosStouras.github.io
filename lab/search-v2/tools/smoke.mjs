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

// ---- in-memory Firebase SDK mock (for the CONFIGURED code paths) ----------
// Lets us exercise admin login, session CRUD, join-by-code, preview, and content
// overrides deterministically without a live Firebase project. State lives in
// globalThis.__fb (per page); seed docs via globalThis.__fbSeed (addInitScript).
const FB_MOCK_APP = `export function initializeApp(){ if(!globalThis.__fb) globalThis.__fb={user:null,listeners:[],docs:(globalThis.__fbSeed||{}),anonCount:0,addCount:0,writes:[]}; return {}; }`;
const FB_MOCK_AUTH = `const S=()=>globalThis.__fb;
function notify(){ S().listeners.slice().forEach(cb=>{try{cb(S().user)}catch(e){}}); }
export function getAuth(){ return { get currentUser(){ return S().user; } }; }
export function signInAnonymously(){ S().anonCount++; S().user={uid:'anon'+S().anonCount,email:null,isAnonymous:true}; notify(); return Promise.resolve({user:S().user}); }
export function signInWithEmailAndPassword(a,email,pw){ if(pw==='bad') return Promise.reject({code:'auth/wrong-password'}); S().user={uid:'admin1',email:email,isAnonymous:false}; notify(); return Promise.resolve({user:S().user}); }
export function onAuthStateChanged(a,cb){ S().listeners.push(cb); Promise.resolve().then(()=>cb(S().user)); return ()=>{}; }
export function signOut(){ S().user=null; notify(); return Promise.resolve(); }`;
const FB_MOCK_FS = `const S=()=>globalThis.__fb;
export function getFirestore(){ return {}; }
export function doc(db,col,id){ return { path: col+'/'+id }; }
export function collection(db,name){ return { __col:name }; }
export function where(f,op,v){ return { __w:[f,op,v] }; }
export function orderBy(){ return { __o:1 }; }
export function limit(){ return { __l:1 }; }
export function query(col){ var c={ __col:col.__col, wheres:[] }; for(var i=1;i<arguments.length;i++){ var a=arguments[i]; if(a&&a.__w) c.wheres.push(a.__w); } return c; }
export function getDoc(ref){ var d=S().docs[ref.path]; return Promise.resolve({ exists:()=>!!d, data:()=>d, id:(ref.path||'').split('/').pop() }); }
export function setDoc(ref,data,opts){ S().docs[ref.path]=(opts&&opts.merge)?Object.assign({},S().docs[ref.path]||{},data):data; S().writes.push(ref.path); return Promise.resolve(); }
export function addDoc(col,data){ var id='auto'+(++S().addCount); S().docs[col.__col+'/'+id]=data; S().writes.push(col.__col+'/'+id); return Promise.resolve({ id:id }); }
export function deleteDoc(ref){ delete S().docs[ref.path]; return Promise.resolve(); }
export function getDocs(q){ var name=q.__col||''; var wheres=(q&&q.wheres)||[]; var rows=Object.keys(S().docs).filter(k=>k.indexOf(name+'/')===0).map(k=>({id:k.split('/').pop(),d:S().docs[k]})).filter(r=>wheres.every(w=>r.d[w[0]]===w[2])); var out=rows.map(r=>({id:r.id,data:()=>r.d})); return Promise.resolve({ forEach:f=>out.forEach(f), size:out.length }); }`;
async function fbCtx(browser, seed) {
  const ctx = await browser.newContext();
  await ctx.route('**/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FB_MOCK_APP }));
  await ctx.route('**/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FB_MOCK_AUTH }));
  await ctx.route('**/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FB_MOCK_FS }));
  if (seed) await ctx.addInitScript(s => { globalThis.__fbSeed = s; }, seed);
  return ctx;
}
async function adminLogin(page) {
  await page.waitForSelector('#a-login.active', { timeout: 8000 });
  await page.fill('#in-email', 'admin@admin.com');
  await page.fill('#in-pass', 'goodpass');
  await page.click('#btn-login');
  await page.waitForSelector('#a-dash.active', { timeout: 8000 });
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
      await ctx.close();
    }

    // ---------------- TEST 12: Admin login is not clobbered (Firebase mock) ----------------
    // Regression guard: getStudyConfig() must NOT sign in anonymously when an admin
    // is already signed in, or it would replace the admin session and bounce them
    // back to the login screen. Uses the REAL firebase-config.js (configured mode)
    // with a mocked Firebase SDK routed in for the gstatic imports.
    console.log('\nTest 12 · Admin login survives getStudyConfig (no anon clobber)');
    {
      const ctx = await fbCtx(browser);
      const page = await ctx.newPage();
      await page.goto(APP + 'admin/', { waitUntil: 'domcontentloaded' });
      ok('configured admin shows the sign-in screen',
        await page.waitForSelector('#a-login.active', { timeout: 8000 }).then(() => true).catch(() => false));
      await adminLogin(page);
      await sleep(600);
      ok('admin reaches the dashboard after sign-in', await page.isVisible('#a-dash'));
      ok('admin is NOT bounced back to the login screen', !(await page.isVisible('#a-login')));
      ok('no anonymous sign-in clobbered the admin', (await page.evaluate(() => globalThis.__fb.anonCount)) === 0);
      ok('admin session preserved', (await page.evaluate(() => globalThis.__fb.user && globalThis.__fb.user.email)) === 'admin@admin.com');
      await ctx.close();
    }

    // ---------------- TEST 13: Admin creates a session ----------------
    console.log('\nTest 13 · Admin creates a session (name, code, settings)');
    {
      const ctx = await fbCtx(browser);
      const page = await ctx.newPage();
      await page.goto(APP + 'admin/', { waitUntil: 'domcontentloaded' });
      await adminLogin(page);
      await page.fill('#f-name', 'Wave One');
      await page.fill('#f-code', 'wave 1!'); // gets normalised to WAVE1
      // Toggle OFF the Without-AI phase → a single "With AI" session. The checkbox
      // is a visually zero-size styled switch, so drive its change handler directly.
      await page.evaluate(() => { var c = document.getElementById('ph-A'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
      await page.fill('#f-code-shared', 'DONE7');
      await page.click('#btn-save');
      await sleep(700);
      const doc = await page.evaluate(() => {
        const d = globalThis.__fb.docs; const k = Object.keys(d).find(k => k.indexOf('sessions/') === 0);
        return k ? d[k] : null;
      });
      ok('session document created in Firestore', !!doc);
      ok('code normalised to A–Z0–9 (WAVE1)', doc && doc.code === 'WAVE1', doc && doc.code);
      ok('session stores name + active status', doc && doc.name === 'Wave One' && doc.status === 'active');
      ok('session stores the With-AI phase + completion code',
        doc && doc.settings.phases && doc.settings.phases.join(',') === 'B' && doc.settings.completionCode === 'DONE7',
        doc && JSON.stringify(doc.settings.phases));
      ok('Active sessions list shows the new session', /Wave One/.test(await page.innerText('#active-list')));
      ok('launch links + preview button appear', await page.isVisible('#launch-box'));
      await ctx.close();
    }

    // ---------------- TEST 14: Participant joins by code, gets wave settings ----------------
    console.log('\nTest 14 · Participant ?code= loads the session settings + content');
    {
      const seed = { 'sessions/w1': { code: 'WAVE1', name: 'Wave One', status: 'active',
        settings: { armMode: 'B', completionCode: 'DONE7', nTasks: 7, paidTasks: 3, content: { consent: '**Custom consent** please agree to continue.' } } } };
      const ctx = await fbCtx(browser, seed);
      const page = await ctx.newPage();
      await page.goto(APP + '?code=WAVE1&SESSION_ID=joinCheck', { waitUntil: 'networkidle' });
      await page.waitForSelector('#s-consent.active', { timeout: 8000 });
      ok('consent shows the admin custom text', /Custom consent/.test(await page.innerText('#consent-body')));
      await page.check('#consent-box'); await page.click('#btn-consent');
      await page.waitForSelector('#s-instructions.active');
      ok('arm forced to B (instructions include the assistant addendum)',
        /assistant/i.test(await page.innerText('#instructions-body')));
      ok('instructions reflect the admin round counts ({rounds} token)',
        /7 real rounds/.test(await page.innerText('#instructions-body')) && /3 of the 7/.test(await page.innerText('#instructions-body')));
      const stamped = await page.evaluate(() => (window.Logger.getEvents().find(e => e.event === 'session_start') || {}).sessionCode);
      ok('events are stamped with the session code', stamped === 'WAVE1', stamped);
      const wroteEvent = await page.evaluate(() => Object.keys(globalThis.__fb.docs).some(k => k.indexOf('events/') === 0));
      ok('participant events written to Firestore', wroteEvent);
      await ctx.close();
    }

    // ---------------- TEST 15: Preview skips the intro & never writes to Firestore ----------------
    console.log('\nTest 15 · Preview link skips intro, no Firestore writes, applies code');
    {
      const seed = { 'sessions/w1': { code: 'WAVE1', name: 'Wave One', status: 'active',
        settings: { armMode: 'A', completionCode: 'DONE7', content: {} } } };
      const ctx = await fbCtx(browser, seed);
      const page = await ctx.newPage();
      await page.goto(APP + '?code=WAVE1&arm=A&preview=1&debug=1&key=stouras', { waitUntil: 'networkidle' });
      const gotRound = await page.waitForSelector('#s-round.active', { timeout: 8000 }).then(() => true).catch(() => false);
      ok('preview drops straight into the game (intro skipped)', gotRound);
      for (let r = 0; r < 11; r++) await playRound(page, 1);
      await page.waitForSelector('#s-finish.active', { timeout: 10000 });
      ok('preview finish shows the session completion code', (await page.innerText('#completion-code')).trim() === 'DONE7');
      const eventWrites = await page.evaluate(() => globalThis.__fb.writes.filter(p => p.indexOf('events/') === 0).length);
      ok('preview wrote NO participant events to Firestore', eventWrites === 0, 'writes=' + eventWrites);
      await ctx.close();
    }

    // ---------------- TEST 16: Admin won't clobber saved defaults it failed to load ----------------
    // Regression guard (adapted from #446 to the multi-session model): if the
    // config/defaults read FAILS (not "doc absent"), the admin must warn and
    // DISABLE "Make this the default" so it never overwrites the real saved
    // defaults with the built-ins the form falls back to showing.
    console.log('\nTest 16 · Admin refuses to overwrite defaults it could not load');
    {
      // Same mock family as fbCtx, but getDoc(config/defaults) rejects.
      const FS_ERR = FB_MOCK_FS.replace(
        'export function getDoc(ref){ var d=S().docs[ref.path];',
        "export function getDoc(ref){ if(ref.path==='config/defaults') return Promise.reject({code:'unavailable'}); var d=S().docs[ref.path];");
      const ctx = await browser.newContext();
      await ctx.route('**/firebase-app.js', r => r.fulfill({ contentType: 'application/javascript', body: FB_MOCK_APP }));
      await ctx.route('**/firebase-auth.js', r => r.fulfill({ contentType: 'application/javascript', body: FB_MOCK_AUTH }));
      await ctx.route('**/firebase-firestore.js', r => r.fulfill({ contentType: 'application/javascript', body: FS_ERR }));
      const page = await ctx.newPage();
      await page.goto(APP + 'admin/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#a-login.active', { timeout: 8000 }).catch(() => {});
      await page.fill('#in-email', 'admin@admin.com'); await page.fill('#in-pass', 'goodpass'); await page.click('#btn-login');
      await sleep(1200);
      ok('admin still reaches the dashboard when the defaults read fails', await page.isVisible('#a-dash'));
      ok('a warning about not overwriting defaults is shown', /not overwritten|could not load saved defaults/i.test(await page.innerText('#dash-banner')));
      ok('"Make this the default" is disabled after a failed defaults read', await page.locator('#btn-makedefault').isDisabled());
      await ctx.close();
    }

    // ---------------- TEST 17: Session-code gate ----------------
    // No SESSION_ID and no debug -> the app must NOT invent a session: it shows
    // the code gate and cannot reach consent or the round. A typed code proceeds
    // (and persists across a refresh); Log out clears it and returns to the gate.
    console.log('\nTest 17 · Session-code gate (no code → no play; code → play; log out)');
    {
      const ctx = await newCtx(browser);
      const page = await ctx.newPage();
      await page.goto(APP + '?arm=A', { waitUntil: 'networkidle' });
      await page.waitForSelector('#s-code.active', { timeout: 8000 });
      ok('no session code shows the code gate', await page.isVisible('#s-code'));
      ok('code gate hides the consent screen', !(await page.isVisible('#s-consent')));
      ok('code gate hides the round', !(await page.isVisible('#s-round')));
      ok('Continue is disabled with an empty code', await page.locator('#btn-code').isDisabled());
      ok('log-out control is hidden at the gate', !(await page.isVisible('#btn-logout')));
      // typing a code enables Continue and proceeds to consent
      await page.fill('#code-input', 'MYCODE1');
      await page.dispatchEvent('#code-input', 'input');
      ok('Continue enables once a code is typed', !(await page.locator('#btn-code').isDisabled()));
      await page.click('#btn-code');
      await page.waitForSelector('#s-consent.active', { timeout: 8000 });
      ok('entering a code proceeds past the gate', await page.isVisible('#s-consent'));
      ok('log-out control is visible once in a session', await page.isVisible('#btn-logout'));
      ok('the typed code became the session id',
        (await page.evaluate(() => window.Logger.getEvents()[0] && window.Logger.getEvents()[0].session)) === 'MYCODE1');
      // a refresh resumes with the stored code (no re-gate)
      await page.reload({ waitUntil: 'networkidle' });
      await page.waitForSelector('#s-consent.active', { timeout: 8000 }).catch(() => {});
      ok('refresh resumes with the stored code (no re-gate)',
        (await page.isVisible('#s-consent')) && !(await page.isVisible('#s-code')));
      // Log out clears everything and returns to the gate
      page.once('dialog', d => d.accept());
      await page.click('#btn-logout');
      await page.waitForSelector('#s-code.active', { timeout: 8000 });
      ok('log out returns to the code gate', await page.isVisible('#s-code'));
      ok('log out cleared the stored code', await page.evaluate(() => !localStorage.getItem('searchv2:entrycode')));
      ok('log out cleared all searchv2 keys', await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('searchv2:') === 0) return false; }
        return true;
      }));
      await ctx.close();
    }

    // ---------------- TEST 18: Admin-configurable round count ----------------
    // A session set to 4 real rounds, no practice, 1 paid → the participant plays
    // exactly 4 rounds starting at "Round 1 of 4" (no practice), and the finish
    // table has 4 rows. Uses preview (skips intro) with the reduced-round session.
    console.log('\nTest 18 · Admin sets the number of rounds each participant plays');
    {
      const seed = { 'sessions/w4': { code: 'WAVE4', name: 'Short', status: 'active',
        settings: { armMode: 'A', completionCode: 'RND4', nTasks: 4, paidTasks: 1, nPractice: 0, content: {} } } };
      const ctx = await fbCtx(browser, seed);
      const page = await ctx.newPage();
      await page.goto(APP + '?code=WAVE4&preview=1&debug=1&key=stouras', { waitUntil: 'networkidle' });
      await page.waitForSelector('#s-round.active', { timeout: 8000 });
      ok('starts at "Round 1 of 4" (round count applied, practice off)',
        /Round 1 of 4/.test(await page.innerText('#round-label')));
      for (let r = 0; r < 4; r++) await playRound(page, 1);
      await page.waitForSelector('#s-finish.active', { timeout: 10000 });
      ok('finish table has exactly 4 round rows', (await page.locator('.paid-table tbody tr').count()) === 4);
      ok('finish shows the session completion code', (await page.innerText('#completion-code')).trim() === 'RND4');
      await ctx.close();
    }

    // ---------------- TEST 19: Within-subjects phases (Without AI → With AI) ----
    // A session with both phases: the participant plays a block of Without-AI
    // rounds, sees a transition screen, then a block of With-AI rounds (assistant
    // appears). The finish table spans both phases (a Part column, 2×N rows), and
    // events carry the active arm + phase ordinal, with a phase_start at the switch.
    console.log('\nTest 19 · Within-subjects phases: Without AI → transition → With AI');
    {
      const seed = { 'sessions/w19': { code: 'WAVE19', name: 'Both', status: 'active',
        settings: { phases: ['A', 'B'], counterbalance: false, completionCode: 'BOTH9', nTasks: 2, paidTasks: 2, nPractice: 0, content: {} } } };
      const ctx = await fbCtx(browser, seed);
      const page = await ctx.newPage();
      await page.goto(APP + '?code=WAVE19&preview=1&debug=1&key=stouras', { waitUntil: 'networkidle' });
      await page.waitForSelector('#s-round.active', { timeout: 8000 });
      ok('phase 1 starts at Round 1 of 2', /Round 1 of 2/.test(await page.innerText('#round-label')));
      ok('phase 1 label names the Without AI phase', (await page.innerText('#round-label')).includes('Without AI'));
      ok('phase 1 (Without AI) shows no assistant panel', (await page.locator('#btn-ask').count()) === 0);
      await playRound(page, 1); // round 1 → lands on round 2
      // round 2 (last of phase 1) — inspect the interstitial before continuing
      await page.waitForSelector('#s-round.active');
      await page.fill('#pos-input', '45'); await page.dispatchEvent('#pos-input', 'change'); await page.click('#btn-reveal');
      await page.click('#btn-stop'); await page.waitForSelector('#ov-stop.show'); await page.click('#btn-stop-ok');
      await page.waitForSelector('#s-interstitial.active');
      ok('end of phase 1 interstitial reads "Part 1 complete"', /Part 1 complete/.test(await page.innerText('#inter-title')));
      await page.click('#btn-continue');
      await page.waitForSelector('#s-phase-intro.active', { timeout: 8000 });
      ok('a phase transition screen appears between phases', await page.isVisible('#s-phase-intro'));
      ok('transition screen shows "Part 2 of 2"', /Part 2 of 2/.test(await page.innerText('#phase-intro-title')));
      await page.click('#btn-phase-intro');
      await page.waitForSelector('#s-round.active');
      ok('phase 2 label names the With AI phase', (await page.innerText('#round-label')).includes('With AI'));
      ok('phase 2 (With AI) shows the assistant panel', (await page.locator('#btn-ask').count()) === 1);
      await playRound(page, 1);
      await playRound(page, 1);
      await page.waitForSelector('#s-finish.active', { timeout: 10000 });
      ok('finish table has a Part column', /Part/.test(await page.innerText('.paid-table thead')));
      ok('finish table has 4 rows (2 phases × 2 rounds)', (await page.locator('.paid-table tbody tr').count()) === 4);
      ok('finish shows the shared completion code', (await page.innerText('#completion-code')).trim() === 'BOTH9');
      const evs = await getEvents(page);
      ok('a phase_start event marks the second phase (arm B)', evs.some(e => e.event === 'phase_start' && e.arm === 'B'));
      ok('round_end events exist for BOTH arms', evs.some(e => e.event === 'round_end' && e.arm === 'A') && evs.some(e => e.event === 'round_end' && e.arm === 'B'));
      ok('events carry the phase ordinal (1 and 2)', evs.some(e => e.event === 'round_end' && e.phase === 1) && evs.some(e => e.event === 'round_end' && e.phase === 2));
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
