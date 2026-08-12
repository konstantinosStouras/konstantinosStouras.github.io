/* ==========================================================================
   Problem Solving — TEST-ROUND (preview) guard (offline, Playwright; no network)
       node lab/problem-solving/tools/preview-guard.mjs

   The admin panel's 🧪 Test round opens the game at ?preview=1&key=stouras.
   That sandbox must:
     1. play the REAL game (not the older ?preview results simulation),
     2. never POST the submission to the Google Apps Script — the app's only
        write,
     3. never tell the Simulation Platform the run completed (a test round must
        not gate a student's real play),
     4. show the "nothing is saved" ribbon,
     5. and be inert without the key: ?preview alone keeps its old meaning (the
        auto-simulated results preview), and a plain visit still logs normally.

   Offline notes: Chart.js is loaded from a CDN and its `Chart.defaults` lines
   run at the TOP LEVEL of the page's inline script, so without the CDN the
   script dies there and nothing after it executes. The test therefore serves a
   tiny Chart stub — only so the page can boot here; the shipped app is
   untouched. Google endpoints are aborted AND counted.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const b = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('x'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}/lab/problem-solving/`;
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok — ' : '  FAIL — ') + m); if (!c) fails++; };

const CHART_STUB = `
window.Chart = function () { return { destroy: function () {}, update: function () {} }; };
window.Chart.register = function () {};
window.Chart.defaults = { devicePixelRatio: 1, maintainAspectRatio: true, interaction: {}, hover: {},
  font: {}, color: '#000', plugins: { tooltip: {}, legend: { labels: {} } },
  elements: { point: {}, line: {}, bar: {} }, scale: { grid: {}, ticks: {} } };`;

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await br.newContext({ viewport: { width: 1200, height: 1000 } });
await ctx.route('**/cdn.jsdelivr.net/**chart**', r => r.fulfill({ contentType: 'text/javascript', body: CHART_STUB }));
let posts = 0, gets = 0;
await ctx.route('**/script.google.com/**', r => { if (r.request().method() === 'POST') posts++; else gets++; r.abort(); });
await ctx.route('**/docs.google.com/**', r => { gets++; r.abort(); });

const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e.message)));

// ── The test round ─────────────────────────────────────────────────────────
await pg.goto(BASE + '?preview=1&key=stouras');
await pg.waitForFunction(() => typeof IS_TEST_ROUND !== 'undefined', null, { timeout: 15000 });
ok(await pg.evaluate(() => IS_TEST_ROUND === true), 'the test-round flag is on for ?preview=1&key=stouras');
ok(await pg.evaluate(() => IS_PREVIEW === false), 'it does NOT fall into the old results-simulation preview');
ok(await pg.locator('#ps-ribbon').isVisible(), 'the "nothing is saved" ribbon is shown');
ok(await pg.evaluate(() => typeof window.simpMarkCompleted !== 'function'),
  'the platform completion marker is NOT wired (a test round can never gate a real play)');
ok(await pg.locator('#input-section').isVisible(), 'the real game is playable (inputs shown, not a simulated result)');

// Play a guess, then submit a rule with a confidence rating.
const boxes = await pg.locator('#input-section input').all();
ok(boxes.length === 3, 'the guess row renders three number boxes');
await boxes[0].fill('2'); await boxes[1].fill('4'); await boxes[2].fill('9');
await pg.getByRole('button', { name: /check/i }).first().click();
await pg.waitForTimeout(400);
const guessRows = await pg.locator('#guesses-list .guess-row').count();
ok(guessRows >= 1, `a guess was evaluated in the sandbox (${guessRows} row(s))`);

await pg.locator('#rule-input').fill('any three increasing numbers');
await pg.evaluate(() => {
  const r = document.querySelectorAll('#rule-section input[type=radio]');
  if (r.length) r[r.length - 1].click();
});
await pg.waitForTimeout(300);
ok(!(await pg.locator('#submit-btn').isDisabled()), 'Submit unlocks once a rule + confidence are given');
await pg.evaluate(() => document.getElementById('submit-btn').click());
await pg.waitForTimeout(1200);

ok(posts === 0, `the submission was NOT written to the Apps Script (POSTs: ${posts})`);
ok(await pg.evaluate(() => submitted === true), 'the app still records the submit locally (results screen reached)');
ok(await pg.locator('#outcome-section').isVisible(), 'the results/outcome screen is shown, as a student would see it');

// ── A normal visit still logs ─────────────────────────────────────────────
const pg2 = await ctx.newPage();
await pg2.goto(BASE);
await pg2.waitForFunction(() => typeof IS_TEST_ROUND !== 'undefined', null, { timeout: 15000 });
ok(await pg2.evaluate(() => IS_TEST_ROUND === false && typeof logToSheet === 'function'
  && !/NOT saved/.test(logToSheet.toString())),
  'a plain visit keeps the real logging path (the sandbox never leaks into normal play)');
ok(!(await pg2.locator('#ps-ribbon').count()), 'no ribbon on a normal visit');

// ── ?preview without the key keeps its old meaning ────────────────────────
const pg3 = await ctx.newPage();
await pg3.goto(BASE + '?preview');
await pg3.waitForFunction(() => typeof IS_PREVIEW !== 'undefined', null, { timeout: 15000 });
ok(await pg3.evaluate(() => IS_PREVIEW === true && IS_TEST_ROUND === false),
  '?preview without the key is still the old results-simulation preview');

// ── The admin panel offers the button ─────────────────────────────────────
const pg4 = await ctx.newPage();
await pg4.goto(BASE + '?admin');
await pg4.waitForSelector('#admin-testround', { timeout: 15000 });
ok(await pg4.locator('#admin-testround').isVisible(), 'the admin panel has a 🧪 Test round button');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await br.close(); srv.close();
console.log(fails ? `\nPS PREVIEW GUARD FAILED (${fails})` : '\nPS PREVIEW GUARD OK — real game, nothing logged, ribbon, admin button.');
process.exit(fails ? 1 : 0);
