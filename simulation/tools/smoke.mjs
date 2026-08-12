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
import { readFileSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* ---- Registration-bucket parity preflight (no browser) -------------------
   The platform's answer sets must stay identical to the sims' default
   registration forms (formDefaults.js / pf-defaults.js / arena-data.js) —
   a drifted bucket stops the silent registration from covering that field.
   Compared as SETS (order may differ). Fails the smoke on any mismatch. */
{
  const plat = readFileSync(join(ROOT, 'simulation/index.html'), 'utf8');
  const strs = (txt) => (txt.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g) || [])
    .map(s => s.slice(1, -1).replace(/\\(['"])/g, '$1'));
  const jsList = (src, name) => {
    const m = src.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:=]\\s*\\[([\\s\\S]*?)\\]'));
    return m ? strs(m[1]) : null;
  };
  const selList = (id) => {
    const m = plat.match(new RegExp('<select id="' + id + '">([\\s\\S]*?)</select>'));
    return (m[1].match(/<option>[^<]*<\/option>/g) || []).map(s => s.slice(8, -9));
  };
  const qOptions = (src, id) => {
    const m = src.match(new RegExp(`['"]?id['"]?\\s*:\\s*['"]${id}['"][\\s\\S]{0,1200}?['"]?options['"]?\\s*:\\s*\\[([\\s\\S]*?)\\]`));
    return m ? strs(m[1]) : null;
  };
  const sims = {
    ideasearchlab: readFileSync(join(ROOT, '_ideasearchlab-src/src/data/formDefaults.js'), 'utf8'),
    portfoliofit: readFileSync(join(ROOT, 'lab/portfoliofit/pf-defaults.js'), 'utf8'),
    answerarena: readFileSync(join(ROOT, 'lab/answerarena/arena-data.js'), 'utf8'),
  };
  const platSets = {
    age: jsList(plat, 'var AGE_BANDS'),
    occupation: jsList(plat, 'var OCCUPATIONS'),
    industry: jsList(plat, 'var INDUSTRIES'),
    gender: selList('f-gender'),
    levelOfStudy: selList('f-level'),
    englishFluency: selList('f-english'),
  };
  let parityFails = 0;
  const same = (a, b) => [...a].sort().join('') === [...b].sort().join('');
  for (const [field, platList] of Object.entries(platSets)) {
    for (const [sim, src] of Object.entries(sims)) {
      const opts = qOptions(src, field);
      if (!opts) { console.error(`PARITY FAIL — ${sim} has no '${field}' question`); parityFails++; continue; }
      if (!same(platList, opts)) {
        console.error(`PARITY FAIL — ${field}: platform [${platList.join(', ')}] vs ${sim} [${opts.join(', ')}]`);
        parityFails++;
      }
    }
  }
  const platCountries = jsList(plat, 'var COUNTRIES');
  const countryLists = {
    ideasearchlab: jsList(sims.ideasearchlab, 'COUNTRIES'),
    portfoliofit: jsList(sims.portfoliofit, 'countries'),
    answerarena: jsList(sims.answerarena, 'window.ARENA_COUNTRIES'),
  };
  for (const [sim, list] of Object.entries(countryLists)) {
    if (!list || !same(platCountries, list)) {
      console.error(`PARITY FAIL — country list differs: platform ${platCountries.length} vs ${sim} ${list ? list.length : 'none'}`);
      parityFails++;
    }
  }
  if (parityFails) { console.error(`\nPARITY PREFLIGHT FAILED — ${parityFails} mismatch(es).`); process.exit(1); }
  console.log('  ok — registration buckets identical across platform + ideasearchlab + portfoliofit + answerarena');

  /* Completion-marker drift guard: every instrumented sim must still call
     simpMarkCompleted at its done screen (and the shipped ideasearchlab
     bundle must carry it). ssc (rejoin-by-design), newsvendor (cross-origin)
     and jagged (free-play teaching game) are deliberately NOT instrumented. */
  const markers = [
    'lab/portfoliofit/experiment.js',
    'lab/answerarena/arena-app.js',
    'lab/problem-solving/index.html',
    'lab/search-v2/app.js',
    '_ideasearchlab-src/src/pages/Survey.jsx',
  ];
  let markerFails = 0;
  for (const f of markers) {
    if (!readFileSync(join(ROOT, f), 'utf8').includes('simpMarkCompleted')) {
      console.error(`MARKER FAIL — ${f} no longer calls simpMarkCompleted`);
      markerFails++;
    }
  }
  const { readdirSync } = await import('node:fs');
  const bundle = readdirSync(join(ROOT, 'lab/ideasearchlab/assets')).find(n => /^index-.*\.js$/.test(n));
  if (!bundle || !readFileSync(join(ROOT, 'lab/ideasearchlab/assets', bundle), 'utf8').includes('simpMarkCompleted')) {
    console.error('MARKER FAIL — the shipped ideasearchlab bundle lacks simpMarkCompleted (rebuild needed)');
    markerFails++;
  }
  if (markerFails) { console.error(`\nMARKER PREFLIGHT FAILED — ${markerFails} file(s).`); process.exit(1); }
  console.log('  ok — completion markers present in all five instrumented sims (+ built bundle)');
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };

// Force LOCAL mode regardless of whether the shipped config was filled in.
const LOCAL_CONFIG = `window.SIMP_FIREBASE_CONFIG = { apiKey: 'PASTE_API_KEY', projectId: 'PASTE_PROJECT_ID' };
window.SIMP_ADMIN_EMAILS = ['admin@admin.com'];`;

// A fake simulation registration form exercising every prefill mechanism:
// wrapped labels, sibling labels, selects, radio groups, placeholders.
const FIXTURE = `<!doctype html><html><body>
  <label>University Student ID <input id="x-sid"></label>
  <div class="field"><label>Age *</label><select id="x-age"><option value=""></option><option>18-24</option><option>25-34</option><option>35-44</option></select></div>
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
  ok(await page.isHidden('#s-welcome'), 'LOCAL mode skips the Log in / Register choice (no central roster to log in against)');
  ok(await page.isHidden('#recover-box'), 'the "log in instead" nudge stays hidden in LOCAL mode');
  await page.fill('#f-name', 'Test Student');
  await page.fill('#f-email', 'test@example.com');
  await page.fill('#f-sid', 'S123');
  await page.click('#btn-save');
  await page.waitForFunction(() => document.getElementById('reg-err').textContent !== '');
  ok(await page.isVisible('#s-register'), 'incomplete registration is rejected (every field is compulsory)');
  ok(await page.locator('#f-nationality option').count() > 150, 'nationality select carries the full country list');
  ok(await page.locator('#f-occupation option').nth(1).textContent() === 'Student', 'occupation select puts Student first');
  ok(await page.locator('#f-age option').count() === 7, 'age select carries the sims’ six bands');
  await page.selectOption('#f-age', '25-34');
  await page.selectOption('#f-gender', 'Male');
  await page.selectOption('#f-nationality', 'Ireland');
  await page.selectOption('#f-country', 'Ireland');
  await page.selectOption('#f-level', 'MBA');
  await page.fill('#f-workexp', '5');
  await page.selectOption('#f-occupation', 'Student');
  await page.selectOption('#f-industry', 'Consulting');
  await page.selectOption('#f-english', 'Fluent');
  await page.click('#btn-save');
  await page.waitForSelector('#s-sims:not([hidden])');
  await page.waitForSelector('#empty:not([hidden])');
  ok(true, 'after saving, the sims view shows the empty state (nothing active yet)');
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('cfg-src')).display) === 'none',
     'hidden source pill renders as truly hidden (no ghost box)');
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
  ok((await page.textContent('#admin-who')).includes('LOCAL mode'), 'admin bar states LOCAL mode (no sign-in to sign out of)');
  ok(await page.isHidden('#btn-signout'), 'Sign out button hidden in LOCAL mode');
  // The checkbox itself is visually hidden inside the .switch — click the slider.
  await page.click('tr[data-key="ssc"] .switch .sl');
  await page.fill('tr[data-key="ssc"] .c-session', 'TEST1');
  await page.fill('tr[data-key="ssc"] .c-note', 'Play after the break');
  await page.click('tr[data-key="answerarena"] .switch .sl');
  await page.click('tr[data-key="problem-solving"] .switch .sl');
  await page.click('#btn-savecfg');
  await page.waitForFunction(() => document.getElementById('btn-savecfg').textContent.includes('Saved'));
  ok(true, 'Save button confirms the press (✓ Saved)');
  await page.waitForFunction(() => document.getElementById('save-note').textContent.includes('Draft saved'));
  ok(true, 'activation saved as a local draft');
  ok(await page.locator('#simtab tbody tr').first().getAttribute('data-key') === 'answerarena',
     'active sims float to the top of the admin table after Save');

  // ---- 3. Student cards + launch ---------------------------------------
  await page.goto(BASE + '/simulation/');
  await page.waitForSelector('.sim-card');
  ok(await page.locator('.sim-card').count() === 3, 'exactly the three activated sims render as cards');
  ok((await page.locator('.sim-card .ti').first().textContent()) === 'Answer Arena',
     'student cards follow the curated catalog order');
  ok((await page.textContent('#cfg-src')).includes('local draft'), 'draft-source pill is shown');
  ok((await page.textContent('.sim-card .note')).includes('Play after the break'), 'card note from the admin shows');
  ok((await page.locator('.sim-card:has-text("Sustainable Supply Chains") .pill').textContent()) === 'Session ready',
     'a pinned-code card reads "Session ready" — never "Session ID required"');
  const [pop] = await Promise.all([ctx.waitForEvent('page'),
    page.click('.sim-card:has-text("Sustainable Supply Chains")')]);
  ok(pop.url().includes('/sustainable-supply-chains/?code=TEST1'), 'pinned Session ID launches DIRECTLY with ?code= — the student never sees the code: ' + pop.url());
  await pop.close();
  ok(page.url().replace(/\?.*/, '').endsWith('/simulation/'), 'platform tab stays put — exactly ONE copy opens (double-open regression)');
  ok(await page.isHidden('#modal'), 'no session dialog was shown for the pinned code');
  const handoff = await page.evaluate(() => JSON.parse(localStorage.getItem('simp:handoff:v1')));
  ok(handoff && handoff.sim === 'ssc' && handoff.session === 'TEST1' && handoff.profile.studentId === 'S123',
     'launch wrote the same-origin handoff (sim + session + profile)');

  // ---- 4. prefill.js drop-in on a fixture form -------------------------
  await page.goto(BASE + '/__fixture');
  await page.waitForFunction(() => document.getElementById('x-sid').value !== '');
  ok(await page.inputValue('#x-sid') === 'S123', 'prefill: wrapped label → student ID');
  ok(await page.inputValue('#x-age') === '25-34', 'prefill: sibling label → age band select');
  ok(await page.inputValue('#x-gender') === 'Male', 'prefill: select matched by option text');
  ok(await page.isChecked('input[type="radio"][value="Male"]'), 'prefill: radio group picked the right option');
  ok(!(await page.isChecked('input[type="radio"][value="Female"]')), 'prefill: "Male" never matches the Female radio');
  ok(await page.inputValue('#x-email') === 'test@example.com', 'prefill: placeholder text → e-mail');
  ok(await page.inputValue('#x-session') === 'TEST1', 'prefill: session code from the handoff');
  ok(await page.inputValue('#x-explicit') === 'Test Student', 'prefill: explicit data-simp attribute');
  ok(await page.inputValue('#x-untouched') === 'keep-me', 'prefill: never overwrites a non-empty field');

  // ---- 5. Optional-session sim (Answer Arena, ?s= prefill) -------------
  await page.goto(BASE + '/simulation/');
  await page.click('.sim-card:has-text("Answer Arena")');
  await page.waitForSelector('#modal:not([hidden])');
  await page.fill('#m-session', 'ARENA1');
  const [pop2] = await Promise.all([ctx.waitForEvent('page'), page.click('#m-launch')]);
  ok(pop2.url().includes('/lab/answerarena/?s=ARENA1'), 'Answer Arena launches with ?s= prefill: ' + pop2.url());
  await pop2.close();

  // ---- 6. No-input sims launch directly (no dialog) --------------------
  const [pop3] = await Promise.all([ctx.waitForEvent('page'), page.click('.sim-card:has-text("Problem Solving")')]);
  ok(pop3.url().includes('/lab/problem-solving/'), 'a no-input sim launches straight into a new tab (no dialog)');
  // Before closing the sim tab, complete the run the way the sim itself does:
  // prefill.js (fresh handoff) defines simpMarkCompleted; the done screen calls it.
  await pop3.waitForFunction(() => typeof window.simpMarkCompleted === 'function');
  await pop3.evaluate(() => window.simpMarkCompleted());
  await pop3.close();
  ok(await page.isHidden('#modal'), 'no dialog was shown for the no-input sim');

  // ---- 6b. Completed runs: badge + play-once gate ----------------------
  // The sim tab's marker write fires a storage event → the card flips live.
  await page.waitForSelector('.sim-card.done', { timeout: 5000 });
  ok((await page.textContent('.sim-card.done .pill')).includes('✓ Completed'),
     'completed sim card flips to "✓ Completed" the moment the sim finishes');
  let popped = false;
  const popWatch = () => { popped = true; };
  ctx.once('page', popWatch);
  await page.click('.sim-card.done');
  await page.waitForSelector('#donemodal:not([hidden])');
  ok(true, 'clicking a completed card shows the already-completed notice instead of launching');
  ok((await page.textContent('#dm-body')).includes('already completed'),
     'the notice says the simulation was already completed');
  await page.waitForTimeout(400);
  ok(!popped, 'no new tab opens for a completed simulation');
  ctx.off('page', popWatch);
  await page.click('#dm-close');
  ok(await page.isHidden('#donemodal'), 'the notice closes');
  // A NEW pinned Session ID unlocks the card (different run ≠ replay): SSC is
  // pinned TEST1 in the draft config, so a completion under OLD1 must not gate.
  await page.evaluate(() => localStorage.setItem('simp:completed:v1',
    JSON.stringify({ ssc: { ts: Date.now(), session: 'OLD1' } })));
  await page.reload();
  await page.waitForSelector('.sim-card');
  ok(await page.locator('.sim-card:has-text("Sustainable Supply Chains").done').count() === 0,
     'a completion under an OLD session does not gate the newly pinned session');
  await page.evaluate(() => localStorage.setItem('simp:completed:v1',
    JSON.stringify({ ssc: { ts: Date.now(), session: 'TEST1' } })));
  await page.reload();
  await page.waitForSelector('.sim-card');
  ok(await page.locator('.sim-card:has-text("Sustainable Supply Chains").done').count() === 1,
     'a completion under the CURRENT pinned session gates the card');

  // ---- 7. Student log out ----------------------------------------------
  page.once('dialog', d => d.accept());
  await page.click('#who button:nth-of-type(2)');
  await page.waitForSelector('#s-register:not([hidden])');
  ok(await page.evaluate(() => localStorage.getItem('simp:profile:v1')) === null,
     'Log out clears the saved registration and returns to the form');
  ok(await page.evaluate(() => localStorage.getItem('simp:completed:v1')) === null,
     'Log out clears the completion markers (next student starts fresh)');
} finally {
  await browser.close();
  server.close();
}

if (fails) { console.error(`\nSMOKE FAILED — ${fails} check(s) failed.`); process.exit(1); }
console.log('\nSMOKE OK — registration, admin activation draft, cards, launch handoff/seeds, prefill drop-in, completed-run gating.');
