/* ==========================================================================
   Sustainable Supply Chains — tools/smoke.mjs
   Headless end-to-end smoke test of the DEMO-mode app (no Firebase needed):
   serves the repo, then in one browser context (shared localStorage):
     admin tab:   create session → control room → add 2 bot firms → start
     student tab: join by code → found a firm → order/produce/price → submit
     admin tab:   resolve every round to the end
     student tab: results, standings and final debrief render
   Fails on any page error / console error and on missing UI states.

   Run:  node sustainable-supply-chains/tools/smoke.mjs
         (CHROMIUM=/path/to/chromium to override; PW=/path/to/playwright pkg)
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const data = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(0, r));
const BASE = `http://127.0.0.1:${server.address().port}/sustainable-supply-chains`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium',
  args: ['--no-sandbox']
});
const ctx = await browser.newContext({ viewport: { width: 1360, height: 940 } });
const problems = [];
function watch(page, tag) {
  page.on('pageerror', e => problems.push(`[${tag}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') problems.push(`[${tag}] console: ${m.text()}`); });
}
const shots = process.env.SHOTS_DIR || null;
async function shot(page, name) { if (shots) await page.screenshot({ path: join(shots, name), fullPage: true }); }
function fail(msg) { console.error('SMOKE FAIL: ' + msg); if (problems.length) console.error(problems.join('\n')); process.exit(1); }

try {
  /* ---- admin: create session ------------------------------------------------ */
  const admin = await ctx.newPage(); watch(admin, 'admin');
  await admin.goto(BASE + '/admin/', { waitUntil: 'load' });
  await admin.waitForSelector('#a-dash.active', { timeout: 8000 }).catch(() => fail('admin dashboard did not open (demo mode)'));
  await admin.fill('#f-code', 'TESTGAME');
  await admin.fill('#f-rounds', '4');
  await admin.click('#btn-save-session');
  await admin.waitForSelector('#btn-goto-ctrl', { timeout: 5000 }).catch(() => fail('session was not created'));
  await shot(admin, '1-admin-created.png');
  await admin.click('#btn-goto-ctrl');
  await admin.waitForSelector('#c-addbot', { timeout: 5000 }).catch(() => fail('control room did not render'));
  await admin.click('#c-addbot');
  await admin.selectOption('#c-botprofile', 'green');
  await admin.click('#c-addbot');
  await admin.waitForFunction(() => document.querySelectorAll('#ctrl-root tbody tr').length >= 2, null, { timeout: 5000 })
    .catch(() => fail('bot firms did not appear'));

  /* ---- student: join + found firm -------------------------------------------- */
  const stu = await ctx.newPage(); watch(stu, 'student');
  await stu.goto(BASE + '/?code=TESTGAME', { waitUntil: 'load' });
  await stu.waitForSelector('#s-firm.active', { timeout: 8000 }).catch(() => fail('student did not reach firm setup'));
  await stu.fill('#in-firmname', 'Human Test Firm');
  await stu.selectOption('#in-hub', 'europe');
  await stu.fill('#in-members', 'Alice, Bob');
  await stu.click('#btn-create-firm');
  await stu.waitForSelector('#s-lobby.active', { timeout: 5000 }).catch(() => fail('student did not reach the lobby'));
  await shot(stu, '2-student-lobby.png');

  /* ---- admin: start round 1 ---------------------------------------------------- */
  await admin.waitForSelector('#c-start:not([disabled])', { timeout: 6000 }).catch(() => fail('start button not ready'));
  await admin.click('#c-start');

  /* ---- student: decide + submit ------------------------------------------------- */
  await stu.waitForSelector('#s-game.active', { timeout: 8000 }).catch(() => fail('student did not enter the game'));
  await stu.waitForSelector('#qty-battery-bat_gda', { timeout: 8000 }).catch(() => fail('decision form did not render'));
  await stu.fill('#qty-battery-bat_gda', '250');
  await stu.fill('#qty-frame-frm_por', '250');
  await stu.fill('#qty-drive-drv_stu', '250');
  await stu.fill('#qty-electronics-ele_ein', '250');
  await stu.selectOption('#mode-electronics-ele_ein', 'air');
  await stu.fill('#f-production', '300');
  await stu.fill('#price-europe', '1200');
  const preview = await stu.textContent('#plan-preview');
  if (!/Cash after/.test(preview)) fail('plan preview did not compute');
  await shot(stu, '3-student-decide.png');
  await stu.click('#btn-submit');
  await stu.waitForSelector('#submitted-banner', { timeout: 5000 }).catch(() => fail('submit did not register'));

  /* ---- teammate on a second device: sees the submit, reopen syncs back -------------- */
  const mate = await ctx.newPage(); watch(mate, 'teammate');
  await mate.goto(BASE + '/?code=TESTGAME', { waitUntil: 'load' });
  await mate.waitForSelector('#s-game.active', { timeout: 8000 }).catch(() => fail('teammate did not rejoin the firm by uid'));
  await mate.waitForSelector('#submitted-banner', { timeout: 8000 }).catch(() => fail('teammate does not see the submitted state'));
  await mate.click('#btn-reopen');
  // first tab must adopt the teammate's reopen instead of clobbering it later
  await stu.waitForSelector('#submitted-banner', { state: 'detached', timeout: 8000 })
    .catch(() => fail('first tab did not sync the teammate reopen'));
  await stu.waitForSelector('#btn-submit', { state: 'visible', timeout: 5000 });
  await stu.click('#btn-submit');
  await stu.waitForSelector('#submitted-banner', { timeout: 5000 }).catch(() => fail('re-submit after sync failed'));
  await mate.waitForSelector('#submitted-banner', { timeout: 8000 }).catch(() => fail('teammate did not sync the re-submit'));
  await mate.close();

  /* ---- admin: resolve all rounds --------------------------------------------------- */
  admin.on('dialog', d => d.accept());
  for (let r = 1; r <= 4; r++) {
    await admin.waitForSelector('#c-resolve', { timeout: 8000 }).catch(() => fail(`resolve button missing in round ${r}`));
    await admin.click('#c-resolve');
    if (r < 4) {
      await admin.waitForSelector('#c-next', { timeout: 8000 }).catch(() => fail(`round ${r} did not resolve`));
      await admin.click('#c-next');
    }
  }
  await admin.waitForFunction(() => /Game over/.test(document.querySelector('#ctrl-root').textContent), null, { timeout: 8000 })
    .catch(() => fail('game did not finish'));
  await shot(admin, '4-admin-final.png');

  /* ---- student: results & debrief ---------------------------------------------------- */
  await stu.waitForSelector('#tab-debrief-btn', { state: 'visible', timeout: 8000 }).catch(() => fail('debrief tab did not unlock'));
  await stu.click('[data-tab="results"]');
  await stu.waitForFunction(() => /Profit/.test(document.querySelector('#tp-results').textContent), null, { timeout: 5000 })
    .catch(() => fail('results tab empty'));
  await shot(stu, '5-student-results.png');
  await stu.click('[data-tab="debrief"]');
  await stu.waitForFunction(() => /bullwhip/i.test(document.querySelector('#tp-debrief').textContent), null, { timeout: 5000 })
    .catch(() => fail('debrief did not render'));
  await shot(stu, '6-student-debrief.png');

  /* ---- admin: data tab + export sanity ----------------------------------------------- */
  await admin.click('[data-tab="data"]');
  await admin.waitForFunction(() => document.querySelectorAll('#data-root tbody tr').length >= 8, null, { timeout: 6000 })
    .catch(() => fail('data tab has no result rows'));
  const xlsxOk = await admin.evaluate(() => {
    const bytes = window.SSCXlsx.build([{ name: 'T', rows: [['a'], [1]] }]);
    return bytes.length > 400 && bytes[0] === 0x50;
  });
  if (!xlsxOk) fail('xlsx build failed in browser');
  await shot(admin, '7-admin-data.png');

  const benign = problems.filter(p => !/net::ERR|favicon|fonts\.g/i.test(p));
  if (benign.length) fail('console/page errors:\n' + benign.join('\n'));
  console.log('SMOKE OK — full demo game played end-to-end (4 rounds, 2 bots + 1 human firm).');
} finally {
  await browser.close();
  server.close();
}
