/* ==========================================================================
   Simulation Platform — offline smoke test (Playwright + a local static
   server over the repo root; no network, LOCAL mode forced).
       node simulation/tools/smoke.mjs
       (CHROMIUM=/path/to/chromium to override; PW=/path/to/playwright pkg)
   Drives the real flow end to end: one-time registration → empty state →
   admin gate + activation draft → student cards → launch URL + handoff +
   storage seeds → the prefill.js drop-in on a fixture form.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

// Force LOCAL mode regardless of whether the shipped config was filled in.
const LOCAL_CONFIG = `window.SIMP_FIREBASE_CONFIG = { apiKey: 'PASTE_API_KEY', projectId: 'PASTE_PROJECT_ID' };
window.SIMP_ADMIN_EMAILS = ['admin@admin.com'];`;

// A fake simulation registration form exercising every prefill mechanism:
// wrapped labels, sibling labels, selects, radio groups, placeholders.
const FIXTURE = `<!doctype html><html><body>
  <label>University Student ID <input id="x-sid"></label>
  <div class="field"><label>Age *</label><input type="number" id="x-age"></div>
  <label>Gender <select id="x-gender"><option value=""></option><option>Male</option><option>Female</option></select></label>
  <p><label><input type="radio" name="gender" value="Female"> Female</label>
     <label><input type="radio" name="gender" value="Male"> Male</label></p>
  <input id="x-email" placeholder="Personal E-mail address">
  <input id="x-session" placeholder="Session code">
  <input id="x-explicit" data-simp="name">
  <input id="x-untouched" value="keep-me" placeholder="University Student ID">
  <script src="/simulation/prefill.js" defer></script>
</body></html>`;

const server = createServer(async (req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/__fixture') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(FIXTURE); }
  if (path === '/simulation/firebase-config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(LOCAL_CONFIG); }
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

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on('pageerror', e => { fails++; console.error('  FAIL — page error:', e.message); });

try {
  // ---- 1. Student page: one-time registration --------------------------
  await page.goto(BASE + '/simulation/');
  ok(await page.isVisible('#s-register'), 'first visit shows the registration form');
  await page.fill('#f-name', 'Test Student');
  await page.fill('#f-email', 'test@example.com');
  await page.fill('#f-sid', 'S123');
  await page.fill('#f-age', '30');
  await page.selectOption('#f-gender', 'Male');
  await page.click('#btn-save');
  await page.waitForSelector('#s-sims:not([hidden])');
  await page.waitForSelector('#empty:not([hidden])');
  ok(true, 'after saving, the sims view shows the empty state (nothing active yet)');
  await page.reload();
  await page.waitForSelector('#s-sims:not([hidden])');
  ok(await page.isHidden('#s-register'), 'registration is one-time — a reload goes straight to the sims view');

  // ---- 2. Admin: gate + activation draft -------------------------------
  await page.goto(BASE + '/simulation/admin/');
  await page.waitForSelector('#gate-local:not([hidden])');
  ok(await page.isHidden('#s-admin'), 'admin panel is gated without the maintainer key');
  await page.goto(BASE + '/simulation/admin/?key=stouras');
  await page.waitForSelector('#s-admin:not([hidden])');
  const rows = await page.locator('#simtab tbody tr').count();
  const catN = await page.evaluate(() => window.SIMP_CATALOG.length);
  ok(rows === catN, `activation table lists the whole catalog (${rows}/${catN})`);
  const conN = await page.locator('#con-pick option').count();
  const catAdminN = await page.evaluate(() => window.SIMP_CATALOG.filter(s => s.adminUrl).length);
  ok(conN === catAdminN, `consoles picker lists every sim with an admin panel (${conN}/${catAdminN})`);
  // The checkbox itself is visually hidden inside the .switch — click the slider.
  await page.click('tr[data-key="ssc"] .switch .sl');
  await page.fill('tr[data-key="ssc"] .c-session', 'TEST1');
  await page.fill('tr[data-key="ssc"] .c-note', 'Play after the break');
  await page.click('tr[data-key="knapsack-game"] .switch .sl');
  await page.click('#btn-savecfg');
  await page.waitForFunction(() => document.getElementById('save-note').textContent.includes('Draft saved'));
  ok(true, 'activation saved as a local draft');

  // ---- 3. Student cards + launch ---------------------------------------
  await page.goto(BASE + '/simulation/');
  await page.waitForSelector('.sim-card');
  ok(await page.locator('.sim-card').count() === 2, 'exactly the two activated sims render as cards');
  ok((await page.textContent('#cfg-src')).includes('local draft'), 'draft-source pill is shown');
  ok((await page.textContent('.sim-card .note')).includes('Play after the break'), 'card note from the admin shows');
  await page.click('.sim-card:has-text("Sustainable Supply Chains")');
  await page.waitForSelector('#modal:not([hidden])');
  ok(await page.inputValue('#m-session') === 'TEST1', 'pinned Session ID pre-fills the launch dialog');
  const [pop] = await Promise.all([ctx.waitForEvent('page'), page.click('#m-launch')]);
  ok(pop.url().includes('/sustainable-supply-chains/?code=TEST1'), 'SSC launches with ?code= (auto-join URL): ' + pop.url());
  await pop.close();
  const handoff = await page.evaluate(() => JSON.parse(localStorage.getItem('simp:handoff:v1')));
  ok(handoff && handoff.sim === 'ssc' && handoff.session === 'TEST1' && handoff.profile.studentId === 'S123',
     'launch wrote the same-origin handoff (sim + session + profile)');

  // ---- 4. prefill.js drop-in on a fixture form -------------------------
  await page.goto(BASE + '/__fixture');
  await page.waitForFunction(() => document.getElementById('x-sid').value !== '');
  ok(await page.inputValue('#x-sid') === 'S123', 'prefill: wrapped label → student ID');
  ok(await page.inputValue('#x-age') === '30', 'prefill: sibling label → age');
  ok(await page.inputValue('#x-gender') === 'Male', 'prefill: select matched by option text');
  ok(await page.isChecked('input[type="radio"][value="Male"]'), 'prefill: radio group picked the right option');
  ok(!(await page.isChecked('input[type="radio"][value="Female"]')), 'prefill: "Male" never matches the Female radio');
  ok(await page.inputValue('#x-email') === 'test@example.com', 'prefill: placeholder text → e-mail');
  ok(await page.inputValue('#x-session') === 'TEST1', 'prefill: session code from the handoff');
  ok(await page.inputValue('#x-explicit') === 'Test Student', 'prefill: explicit data-simp attribute');
  ok(await page.inputValue('#x-untouched') === 'keep-me', 'prefill: never overwrites a non-empty field');

  // ---- 5. Storage seeds (knapsack) -------------------------------------
  await page.goto(BASE + '/simulation/');
  await page.click('.sim-card:has-text("Knapsack Game")');
  await page.waitForSelector('#modal:not([hidden])');
  const [pop2] = await Promise.all([ctx.waitForEvent('page'), page.click('#m-launch')]);
  ok(pop2.url().includes('/lab/knapsack-game/'), 'Knapsack Game launches (optional session left blank)');
  await pop2.close();
  ok(await page.evaluate(() => localStorage.getItem('knapsack_session')) === 'simp-S123',
     'launch seeded knapsack_session with the student ID');
} finally {
  await browser.close();
  server.close();
}

if (fails) { console.error(`\nSMOKE FAILED — ${fails} check(s) failed.`); process.exit(1); }
console.log('\nSMOKE OK — registration, admin activation draft, cards, launch handoff/seeds, prefill drop-in.');
