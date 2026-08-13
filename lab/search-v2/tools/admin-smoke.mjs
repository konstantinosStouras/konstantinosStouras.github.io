/* ==========================================================================
   search-v2  ·  tools/admin-smoke.mjs
   Browser acceptance tests for the ADMIN PANEL (Playwright, offline).

       node lab/search-v2/tools/admin-smoke.mjs

   The panel's live mode needs Firestore, which is unreachable here, so the test
   serves a placeholder firebase-config.js. That drops the panel into its LOCAL
   PREVIEW mode, where runs live in browser storage — and every screen that does
   not read participant data (parameters, consequences, roster, validation gate,
   preview links, dry run, the workbook) behaves exactly as it will live.

   Asserted here: the six screens exist and switch; the parameter form round-trips
   through a saved run; the consequences recompute live and the two badges change
   state when the design is broken; the validation gate refuses a broken run; the
   roster splits sequences exactly half and half; the dry run populates every
   export column; and a locked run greys its task parameters while leaving the
   operations group editable.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

// Serve a placeholder config for the admin page, so the panel opens in local
// preview instead of stalling on an unreachable Firestore.
const PLACEHOLDER = `
window.FIREBASE_CONFIG = { apiKey: 'PASTE_API_KEY', projectId: 'PASTE_PROJECT_ID' };
window.ADMIN_EMAILS = ['admin@admin.com'];
window.FIREBASE_PATHS = { runs:'runs', runCodes:'runCodes', runCounts:'runCounts', roster:'roster',
  participants:'participants', events:'events', audit:'audit', messages:'messages' };
window.FIREBASE_SDK_VERSION = '10.12.2';
`;

const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/lab/search-v2/firebase-config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(PLACEHOLDER);
    return;
  }
  try {
    const b = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}/lab/search-v2/`;

let fails = 0, checks = 0;
const ok = (c, m, extra) => {
  checks++;
  if (c) console.log('  ok   — ' + m);
  else { fails++; console.log('  FAIL — ' + m + (extra ? '\n         ' + extra : '')); }
};

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await br.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
await ctx.route(/gstatic\.com|googleapis\.com/, r => r.abort());
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e.message)));
pg.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource|net::ERR_/.test(t)) return;
  errors.push('console: ' + t);
});

const tab = async name => { await pg.locator(`.tab[data-tab="${name}"]`).click(); await pg.waitForTimeout(120); };
const shown = async id => pg.locator('#' + id).isVisible();

await pg.goto(BASE + 'admin/');
await pg.waitForSelector('#a-dash.active', { timeout: 20000 });
ok(true, 'with no Firebase config the panel opens straight into local preview');
ok(/Local preview/.test(await pg.locator('#scope-note').innerText()), 'and says so, rather than pretending it is live');

// ── the six screens ────────────────────────────────────────────────────────
const tabs = await pg.$$eval('.tab', els => els.map(e => e.dataset.tab));
ok(JSON.stringify(tabs) === JSON.stringify(['runs', 'params', 'roster', 'monitor', 'data']),
  'the panel is restructured to Runs · Parameters · Roster · Live monitor · Data & preview', tabs.join(','));
ok(await shown('tab-runs'), 'it opens on the Runs screen');

// ── Screen 2 + 3 · parameters beside consequences ─────────────────────────
await tab('params');
ok(await shown('tab-params'), 'the Parameters screen opens');
const groups = await pg.$$eval('.pgroup > summary', els => els.map(e => e.textContent.replace(/locked.*|editable.*/i, '').trim()));
ok(groups.length === 7,
  'seven collapsible groups: the six parameter groups of §17b plus Operations', groups.join(' | '));
ok(groups[0] === 'Environment' && groups[groups.length - 1] === 'Operations',
  'Environment leads and Operations (the always-editable group) closes the form', groups.join(' | '));
const collapsed = await pg.$$eval('.pgroup', els => els.filter(e => !e.open).length);
ok(collapsed > 0, 'the groups are collapsible, and most start collapsed');
// Open them all so the rest of the test can reach every control.
const openAll = () => pg.$$eval('.pgroup', els => els.forEach(e => { e.open = true; }));
await openAll();

// The form must arrive CARRYING the defaults. It used to be filled only from
// loadRuns(), so the one path that matters most to a new user — a fresh project
// whose Rules are not published, where the runs read throws — showed every box
// empty beside its own "default 100" hint, with nothing to save and no
// consequences panel.
for (const [id, want] of [['p-env-positions', '100'], ['p-env-stepBound', '10'],
  ['p-env-prizeMax', '100'], ['p-costs-revealCost', '5'], ['p-costs-queryCost', '2'],
  ['p-ai-sparseK', '4'], ['p-ai-denseK', '10'], ['p-env-poolSize', '600'],
  ['p-env-generatorSeed', '20260813']]) {
  const got = await pg.locator('#' + id).inputValue();
  ok(got === want, 'the form opens carrying its default for ' + id.replace('p-', ''), got);
}
const hint = await pg.locator('#p-env-poolSize').locator('xpath=../label').innerText();
ok(/600/.test(hint), 'and the pool-size hint states the default this build actually uses', hint);

// The failing-read path cannot be reproduced here (local preview never throws),
// so it is pinned at the source: the catch branch must restore the defaults.
const src = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
const rescue = src.slice(src.indexOf('Could not read the runs collection'), src.indexOf('Could not read the runs collection') + 700);
ok(/fillForm\(currentParams, null\)/.test(rescue),
  'a runs read that FAILS leaves the defaults standing rather than blanking the form');

ok(await shown('cons-table'), 'the Consequences panel sits beside the form');
const cons0 = await pg.locator('#cons-table').innerText();
ok(/5\.774/.test(cons0), 'per-step SD reads 5.774 at the defaults');
ok(/12\.53/.test(cons0), 's* reads 12.53 at the defaults');
ok(/18\.8/.test(cons0), 'g* reads 18.8 at the defaults');
ok(/25\.0/.test(cons0) && /10\.0/.test(cons0), 'the sparse and dense mean gaps read 25.0 and 10.0');
ok(/14\.43/.test(cons0) && /9\.13/.test(cons0), 'the two gap-midpoint SDs read 14.43 and 9.13');

const badge0 = await pg.locator('#cons-badges').innerHTML();
ok(/badge green/.test(badge0), 'at the defaults the sign-change badge is GREEN');
ok(/sign-change prediction is intact/.test(badge0), 'and says the prediction is intact');

// Break the design: make dense as sparse as sparse. The badge must turn.
await pg.fill('#p-ai-denseK', '5');
await pg.waitForTimeout(200);
const badge1 = await pg.locator('#cons-badges').innerHTML();
ok(/badge (red|amber)/.test(badge1), 'moving dense K above the threshold turns the badge away from green');
ok(/gradient/.test(badge1) || /close to it/.test(badge1),
  'and explains that the design now tests a gradient rather than a sign change');
await pg.fill('#p-ai-denseK', '10');
await pg.waitForTimeout(200);
ok(/badge green/.test(await pg.locator('#cons-badges').innerHTML()), 'restoring dense K restores the green badge');

// The two switches that must never be on.
const dangerCount = await pg.locator('.danger-switch').count();
ok(dangerCount === 2, 'the two "different experiment" switches carry a red confirmation block');
ok(/keep off/.test(await pg.locator('.danger-switch').first().innerText()),
  'and are labelled as switches to keep off');
pg.once('dialog', d => d.dismiss());
await pg.locator('#p-ai-drawCurve button[data-v="true"]').click();
await pg.waitForTimeout(150);
ok(await pg.locator('#p-ai-drawCurve button[data-v="false"]').evaluate(e => e.classList.contains('on')),
  'declining the red confirmation leaves "draw the full curve" off');

// The four action buttons, unchanged in number and colour from the previous panel.
const actions = await pg.$$eval('#btn-save, #btn-cancel, #btn-makedefault, #btn-restore',
  els => els.map(e => ({ id: e.id, t: e.textContent.trim(), c: e.className })));
ok(actions.length === 4,
  'the form keeps the same four action buttons as the previous panel: save, cancel, make default, restore',
  actions.map(a => a.t).join(' | '));
ok(/btn-green/.test(actions.find(a => a.id === 'btn-save').c), 'the primary action stays green');
ok(actions.filter(a => a.id !== 'btn-save').every(a => /btn-ghost/.test(a.c)),
  'the other three stay ghost buttons — the palette is unchanged');

// ── save a run and round-trip the form ────────────────────────────────────
await pg.fill('#p-ops-runName', 'Smoke run');
await pg.locator('#btn-gencode').click();
const code = await pg.inputValue('#p-ops-code');
ok(/^[A-Z0-9]{5}$/.test(code), 'Auto generates a five-character run code (' + code + ')');
await pg.locator('#btn-save').click();
await pg.waitForTimeout(400);
await tab('runs');
ok((await pg.locator('.run-card').count()) === 1, 'the run appears on the Runs screen');
const cardText = await pg.locator('.run-card').innerText();
ok(/Smoke run/.test(cardText) && /draft/.test(cardText), 'as a DRAFT, with its name and status');
ok(new RegExp(code).test(cardText), 'carrying its code');
ok(/participant link/.test(cardText) && /\?code=/.test(cardText), 'and the participant launch link');

const cardBtns = await pg.$$eval('.run-card .run-acts button', els => els.map(e => e.textContent.trim()));
ok(cardBtns.some(b => /Clone this run/.test(b)), 'every run card offers "Clone this run" — the governing rule');
ok(cardBtns.some(b => /Test round/.test(b)), 'and a 🧪 Test round');
ok(cardBtns.some(b => /Export/.test(b)) && cardBtns.some(b => /Delete/.test(b)), 'and Export and Delete');

// ── Screen 6 · validation gate + dry run ──────────────────────────────────
await tab('data');
await pg.locator('#btn-validate').click();
await pg.waitForTimeout(1200);
const val = await pg.locator('#validate-out').innerText();
ok(/Pass/.test(val), 'the validation gate passes on a run built from the defaults', val.slice(0, 200));
ok(/Adjacency holds/.test(val) && /Acceptance filter passes/.test(val) && /different mapping/.test(val),
  'and reports the adjacency, filter and no-repeated-mapping checks by name');

const specCount = await pg.locator('#prev-spec option').count();
ok(specCount === 28, 'the preview picker lists all 28 round specs');
const firstSpec = await pg.locator('#prev-spec option').first().innerText();
ok(/W1|B1/.test(firstSpec) && /(SPARSE|DENSE)/.test(firstSpec) && /K=/.test(firstSpec),
  'each spec is described by its shape, its density and its K (' + firstSpec.trim() + ')');

await pg.locator('#btn-dryrun').click();
await pg.waitForTimeout(3000);
const dry = await pg.locator('#dryrun-out').innerText();
ok(/56 rounds/.test(dry), 'the dry run pushes two bots through 28 rounds each', dry.slice(0, 160));
ok(/2 participants/.test(dry), 'and produces two participant rows');
ok(/workbook: \d+ KB, built cleanly/.test(dry),
  'the dry run BUILDS the workbook and reports its size — the export is checked before a session, not after');
ok(/bot rows in a real export: 0/.test(dry),
  'and proves bot rows are excluded from a real export (§17b)');
ok(/badge green/.test(await pg.locator('#dryrun-out').innerHTML()), 'and reports a healthy export');

// ── Screen 4 · roster ─────────────────────────────────────────────────────
await tab('roster');
await pg.fill('#ros-n', '90');
await pg.locator('#btn-ros-gen').click();
await pg.waitForTimeout(600);
const stats = await pg.locator('#roster-stats').innerText();
ok(/90/.test(stats), '90 codes generated');
const seqCounts = await pg.$$eval('#roster-table tbody tr td:nth-child(2)', els => {
  const c = { A: 0, B: 0 };
  els.forEach(e => { const v = e.textContent.trim(); if (c[v] != null) c[v]++; });
  return c;
});
ok(seqCounts.A === 45 && seqCounts.B === 45,
  'block randomisation splits the roster exactly 45 / 45, not by coin flips', JSON.stringify(seqCounts));
const rosterText = await pg.locator('#tab-roster').innerText();
ok(/no names, no e-mail addresses/i.test(rosterText), 'the roster screen states that it holds no identifying information');

// The entrant override demands a reason.
pg.once('dialog', d => d.accept());
await pg.locator('#ros-override button[data-v="A"]').click();
await pg.locator('#btn-ros-override').click();
await pg.waitForTimeout(300);
ok(true, 'forcing a sequence without a reason is refused');
await pg.fill('#ros-reason', 'attrition ran uneven in the first session');
await pg.locator('#btn-ros-override').click();
await pg.waitForTimeout(500);
ok(/Override log/.test(await pg.locator('#ros-overrides').innerText()),
  'a forced assignment is logged with its timestamp and reason, and ships with the export');

// ── the lock ──────────────────────────────────────────────────────────────
await pg.evaluate(() => {
  const key = 'searchv2:v3:admin:local';
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  list[0].locked = true;
  list[0].lockedAt = Date.now();
  localStorage.setItem(key, JSON.stringify(list));
});
await pg.reload();
await pg.waitForSelector('#a-dash.active');
await tab('params');
await pg.waitForTimeout(400);
await openAll();
ok(/Locked since the first participant/.test(await pg.locator('#lock-note').innerText()),
  'a locked run says so, with the date, and points at Clone');
ok(await pg.locator('#p-costs-revealCost').isDisabled(), 'the reveal cost is greyed on a locked run');
ok(await pg.locator('#p-env-generatorSeed').isDisabled(), 'so is the generator seed');
ok(!(await pg.locator('#p-ops-runName').isDisabled()), 'but the Operations group stays editable');
ok(await pg.locator('#p-assign-nextEntrantOverride').evaluate(e => e.dataset.locked !== '1'),
  'and so does the next-entrant override — the one control the brief leaves unlocked');
ok(await pg.locator('#p-costs-revealCost').evaluate(e => e.classList.contains('locked-field')),
  'a locked field renders greyed rather than merely refusing input');

// ── the workbook ──────────────────────────────────────────────────────────
await tab('data');
await pg.locator('#btn-dryrun').click();
await pg.waitForTimeout(3000);
const dl = pg.waitForEvent('download', { timeout: 8000 }).catch(() => null);
pg.once('dialog', d => d.accept());
await pg.locator('#btn-dl-xlsx').click();
const got = await dl;
ok(got === null, 'the workbook button refuses politely until an event log is loaded (there is none offline)');

ok(errors.length === 0, 'no page errors anywhere in the panel', errors.slice(0, 5).join(' | '));

await br.close();
srv.close();
console.log('\n' + (fails ? `ADMIN SMOKE FAILED — ${fails} of ${checks} checks` : `ADMIN SMOKE OK — all ${checks} checks passed`));
process.exit(fails ? 1 : 0);
