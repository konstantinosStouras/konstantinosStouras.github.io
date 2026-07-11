/* ==========================================================================
   search-v2  ·  tools/smoke.mjs
   Headless-browser acceptance tests for the runtime-truth model (the checks
   selftest.js can't do in Node): the live arm-B playthrough, AI-consultation
   cost flowing into the net, the interpolation/extrapolation overlays drawing,
   deterministic truth in-browser, and strict Arm-A isolation.

   The committed firebase-config.js holds a real project; these tests serve a
   PLACEHOLDER config so the app runs in its deterministic, unconfigured path.

   Requires Chromium + Playwright. In this dev container:
     CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tools/smoke.mjs
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, join, normalize, dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PORT = 8123;
const BASE = `http://localhost:${PORT}/lab/search-v2/`;
const EXE = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const { chromium } = await import('playwright').catch(() => import('playwright-core'));

let passed = 0, failed = 0;
const ok = (name, cond, extra) => { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); } };

const PLACEHOLDER_FBCONFIG =
  "window.FIREBASE_CONFIG={apiKey:'PASTE_API_KEY',projectId:'PASTE_PROJECT'};" +
  "window.ADMIN_EMAILS=['admin@example.com'];" +
  "window.FIREBASE_PATHS={events:'events',configDoc:'config/study'};";

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const buf = await readFile(join(REPO_ROOT, normalize(p)));
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(buf);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

async function newPage() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/firebase-config.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: PLACEHOLDER_FBCONFIG }));
  page._errs = errors;
  return page;
}
async function through(page, phases) {
  await page.goto(`${BASE}?debug=1&key=stouras&phases=${phases}`, { waitUntil: 'load' });
  await page.waitForSelector('#s-consent.active', { timeout: 8000 });
  await page.click('#consent-box'); await page.click('#btn-consent');
  await page.click('#btn-instructions');
  await page.waitForSelector('#s-quiz.active', { timeout: 8000 });
  await page.click('#btn-quiz');                       // debug pre-selects correct answers
  await page.waitForSelector('#s-round.active', { timeout: 8000 });
}

try {
  // ---- Arm B: playthrough, AI cost, overlays ------------------------------
  console.log('\nArm B · playthrough, AI cost, interpolation overlays');
  {
    const page = await newPage();
    await through(page, 'B');
    for (const id of ['#tv-truth', '#tv-region', '#tv-dots', '#tv-interp']) await page.click(id);
    await page.fill('#ai-pos', '90'); await page.click('#btn-ask');   // ask in an extrapolation zone (costs)
    await page.fill('#pos-input', '50'); await page.dispatchEvent('#pos-input', 'change');
    await page.click('#btn-reveal');                                  // reveal (costs 5¢)
    const s = await page.evaluate(() => {
      const svg = document.querySelector('#plot svg'), c = q => svg.querySelectorAll(q).length;
      const cents = id => parseInt(document.getElementById(id).textContent, 10);
      return { cost: cents('c-cost'), best: cents('c-best'), net: cents('c-net'), reveals: cents('c-reveals'),
        gt: c('.gt-line'), interp: c('.interp-seg'), extrap: c('.extrap-line'), zone: c('.extrap-zone'),
        dot: c('.train-dot'), est: c('.est-diamond') };
    });
    ok('no JS errors during the arm-B flow', page._errs.length === 0, page._errs.join(' | '));
    ok('cost = 1 reveal (5¢) + 1 AI question (2¢) = 7¢', s.cost === 7, 'got ' + s.cost);
    ok('net = best − 7¢ (AI fee subtracted)', s.net === s.best - 7, `best ${s.best}, net ${s.net}`);
    ok('overlays draw: blue truth, green interp, amber extrap, shaded zones, red dots', s.gt === 1 && s.interp === 1 && s.extrap === 2 && s.zone === 2 && s.dot >= 2);
    ok('the AI estimate diamond is shown', s.est === 1);
    await page.close();
  }

  // ---- deterministic truth + two-region geometry (in-page) ----------------
  console.log('\nDeterministic truth + geometry (module level)');
  {
    const page = await newPage();
    await page.goto(`${BASE}?debug=1&key=stouras&phases=B`, { waitUntil: 'load' });
    const d = await page.evaluate(() => {
      const L = window.Landscape, seed = (a, r) => L.hashSeed(window.CONFIG.TRUTH_SEED + ':' + a + ':r' + r);
      const s = x => JSON.stringify(x);
      const a1 = L.makeWalk(seed('A', 1));
      const g2 = L.geometry(L.makeDots(L.makeWalk(seed('B', 1)), [[15, 40], [60, 85]], 'standard', 1));
      return {
        determ: s(a1) === s(L.makeWalk(seed('A', 1))),
        armDiff: s(a1) !== s(L.makeWalk(seed('B', 1))),
        roundDiff: s(a1) !== s(L.makeWalk(seed('A', 2))),
        twoZones: g2.zones.length, twoInterp: g2.interp.length
      };
    });
    ok('same (arm,round) → identical curve for everyone', d.determ);
    ok('Without-AI and With-AI curves differ', d.armDiff);
    ok('rounds within a phase are independent draws', d.roundDiff);
    ok('two regions → 3 extrapolation zones + 2 interpolation polylines', d.twoZones === 3 && d.twoInterp === 2);
    await page.close();
  }

  // ---- Arm A isolation ----------------------------------------------------
  console.log('\nArm A · isolation (no assistant DOM)');
  {
    const page = await newPage();
    await through(page, 'A');
    const iso = await page.evaluate(() => ({
      aux: (document.getElementById('aux-panel').innerHTML || '').trim().length,
      askBtn: !!document.getElementById('btn-ask'),
      body: /assistant/i.test(document.body.innerHTML)
    }));
    ok('no JS errors during the arm-A flow', page._errs.length === 0, page._errs.join(' | '));
    ok('the assistant side panel is empty in Arm A', iso.aux === 0);
    ok('no "Ask" control and no "assistant" text in Arm A', !iso.askBtn && !iso.body);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log('\n' + (failed === 0 ? 'ALL PASS' : (failed + ' FAILED')) + '  (' + passed + ' passed)');
process.exit(failed === 0 ? 0 : 1);
