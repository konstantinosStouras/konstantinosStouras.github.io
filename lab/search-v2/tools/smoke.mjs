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
      const ctx = await browser.newContext();
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
      const ctx = await browser.newContext();
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
      const ctx = await browser.newContext();
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
      await ctx.close();
    }

    // ---------------- TEST 9: Full playthrough + upload success ----------------
    console.log('\nTest 9 · Full playthrough, one event/action, upload in order');
    {
      const ctx = await browser.newContext();
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
      // CSV export works
      const csv = await page.evaluate(() => window.Logger.toCSV());
      ok('CSV export has header + one row per event', csv.split('\n').length >= ev.length + 1);
      await ctx.close();
    }

    // ---------------- TEST 9b: Endpoint failure -> download fallback ----------------
    console.log('\nTest 9b · Endpoint failure → download fallback note');
    {
      const ctx = await browser.newContext();
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
