/* ==========================================================================
   PortfolioFit — TEST-ROUND (preview) guard (offline, Playwright; no network)
       node lab/portfoliofit/tools/preview-guard.mjs

   The admin's 🧪 Test round opens the participant app at
   ?preview=1&key=stouras&session=CODE. That sandbox must:
     1. never load Firebase (so no participant doc / event / round can reach
        the research project),
     2. still be PLAYABLE — the normal offline mode blocks play because a
        session cannot be validated, and the sandbox is the one exception,
     3. show the "nothing is saved" ribbon,
     4. run on the seeded session snapshot (its texts/settings/questions) and
        its frozen puzzle specs,
     5. arrive at the registration form with random test data filled in and
        any consent statements ticked,
     6. and be inert without the key: a plain visit is NOT a sandbox.

   Runs fully offline: any request to the Firebase SDK is aborted AND counted,
   so a regression that re-enables Firebase in preview fails loudly.
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
const BASE = `http://127.0.0.1:${srv.address().port}/lab/portfoliofit/`;
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok — ' : '  FAIL — ') + m); if (!c) fails++; };

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await br.newContext({ viewport: { width: 1400, height: 1000 } });
let sdkHits = 0;
await ctx.route('**/gstatic.com/firebasejs/**', r => { sdkHits++; r.abort(); });
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e.message)));

// The seed the admin's launchTestRound writes: this session's own snapshot
// (here with a consent statement, which the built-in default does not have) and
// one frozen puzzle spec, so both seeded paths are exercised.
const SEED = {
  ts: 1, code: 'TESTPF',
  session: {
    texts: { welcomeTitle: 'PortfolioFit (rehearsal)' },
    settings: { registrationEnabled: true, puzzlesPerUser: { easy: 1, hard: 0 }, activePuzzleIds: ['seeded-1'] },
    registrationQuestions: null,
    registrationConsents: ['I agree to take part in this rehearsal.'],
    surveyQuestions: null,
  },
  puzzles: [{ id: 'seeded-1', spec: { diff: 'easy', rows: 4, cols: 4, bricks: [] } }],
};

await pg.goto(BASE);
await pg.evaluate(() => localStorage.clear());
await pg.evaluate(s => localStorage.setItem('pfx-preview-config', JSON.stringify(s)), SEED);
await pg.goto(BASE + '?preview=1&key=stouras&session=TESTPF');
await pg.waitForSelector('.pfx-card', { timeout: 15000 });

ok(sdkHits === 0, 'the Firebase SDK is never fetched in a test round');
ok(await pg.locator('#pfx-ribbon').isVisible(), 'the "nothing is saved" ribbon is shown');
ok(!(await pg.getByText(/appear to be offline/).isVisible().catch(() => false)),
  'the sandbox is playable — the offline "please reconnect" block is not shown');
const title = await pg.locator('.pfx-card h2').first().innerText();
ok(title === 'PortfolioFit (rehearsal)', `the SEEDED session config is in force (welcome title: "${title}")`);
const code = await pg.locator('.pfx-card input[type=text]').first().inputValue();
ok(code === 'TESTPF', 'the session code arrives prefilled from the launch link');

// Start → training (the game really runs), then jump to registration.
await pg.locator('.pfx-card button').first().click();
await pg.waitForTimeout(800);
const trainTitle = await pg.locator('.pfx-card h2').first().innerText().catch(() => '');
ok(/training/i.test(trainTitle), 'Start leads into the training phase');
await pg.locator('.pfx-card button').first().click();          // Begin training
await pg.waitForFunction(() => document.body.classList.contains('pf-playing'), null, { timeout: 15000 });
ok(true, 'the game itself is playable in the sandbox');
const skipTour = pg.getByText('Skip tour').first();
if (await skipTour.isVisible().catch(() => false)) { await skipTour.click(); await pg.waitForTimeout(400); }
// The "Continue to the game" pill pulses, so click it through the DOM.
await pg.evaluate(() => { const b = document.querySelector('.pfx-submit'); if (b) b.click(); });
await pg.waitForFunction(() => {
  const h = document.querySelector('.pfx-card h2');
  return h && /registration/i.test(h.textContent || '');
}, null, { timeout: 20000 });

// ── The registration form must arrive filled in ────────────────────────────
const reg = await pg.evaluate(() => {
  const fields = [];
  document.querySelectorAll('.pfx-card .pfx-field').forEach(f => {
    const inp = f.querySelector('input,select,textarea');
    if (!inp) return;
    fields.push({ label: (f.querySelector('label')?.textContent || '').trim(), value: inp.value });
  });
  const consents = [];
  document.querySelectorAll('.pfx-card input[type=checkbox]').forEach(cb => consents.push(cb.checked));
  return { fields, consents };
});
const blanks = reg.fields.filter(f => !f.value);
ok(reg.fields.length > 0, `the registration form rendered ${reg.fields.length} fields`);
ok(blanks.length === 0, 'every registration field arrived pre-filled with random test data'
  + (blanks.length ? ' — blank: ' + blanks.map(b => b.label).join(', ') : ''));
ok(reg.consents.length > 0 && reg.consents.every(Boolean),
  `the seeded consent statement(s) arrive ticked (${reg.consents.length})`);
const sid = reg.fields.find(f => /student id/i.test(f.label));
ok(!sid || /^\d{6,}$/.test(sid.value), 'the Student-ID field gets digits, not filler text');

// ── Nothing was persisted anywhere but the seed (+ the game's own best score)
const keys = await pg.evaluate(() => Object.keys(localStorage).sort());
const unexpected = keys.filter(k => k !== 'pfx-preview-config' && !/^portfoliofit\./.test(k) && k !== 'pfx-layout');
ok(unexpected.length === 0, 'the sandbox stores no participant state locally'
  + (unexpected.length ? ' — found: ' + unexpected.join(', ') : ''));

// ── Inert without the key ─────────────────────────────────────────────────
await pg.goto(BASE + '?preview=1');
await pg.waitForTimeout(500);
const noKey = await pg.evaluate(() => !!document.getElementById('pfx-ribbon'));
ok(!noKey, '?preview=1 without the key is NOT a sandbox');

ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await br.close(); srv.close();
console.log(fails ? `\nPF PREVIEW GUARD FAILED (${fails})` : '\nPF PREVIEW GUARD OK — no Firebase, playable, seeded config, pre-filled registration.');
process.exit(fails ? 1 : 0);
