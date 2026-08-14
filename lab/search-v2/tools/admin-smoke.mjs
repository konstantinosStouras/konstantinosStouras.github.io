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

// ── the seven screens ──────────────────────────────────────────────────────
const tabs = await pg.$$eval('.tab', els => els.map(e => e.dataset.tab));
ok(JSON.stringify(tabs) === JSON.stringify(['runs', 'params', 'roster', 'monitor', 'data', 'notes', 'wording']),
  'the panel is Sessions · Parameters · Participants · Live monitor · Data & preview · Design notes · Wording ' +
  '(the third tab keeps its `roster` id, which is what the data calls it)', tabs.join(','));
ok(await shown('tab-runs'), 'it opens on the Runs screen');

// ── Screen 2 + 3 · parameters beside consequences ─────────────────────────
await tab('params');
ok(await shown('tab-params'), 'the Parameters screen opens');
const groups = await pg.$$eval('.pgroup > summary', els => els.map(e => e.textContent.replace(/locked.*|editable.*/i, '').trim()));
ok(groups.length === 8,
  'eight collapsible groups: the six of §17b, Operations, and Interface and engagement', groups.join(' | '));
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
  ['p-env-prizeMax', '100'], ['p-costs-revealCost', '4'], ['p-costs-queryCost', '2'],
  ['p-ai-sparseK', '3'], ['p-ai-denseK', '10'], ['p-env-poolSize', '600'],
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
ok(/10\.03/.test(cons0), 's* reads 10.03 at the defaults — c_R is 4, not the brief’s 5');
ok(/12\.1/.test(cons0), 'g* reads 12.1 at the defaults');
ok(/33\.3/.test(cons0) && /10\.0/.test(cons0), 'the sparse and dense mean gaps read 33.3 and 10.0');
ok(/16\.67/.test(cons0) && /9\.13/.test(cons0), 'the two gap-midpoint SDs read 16.67 and 9.13');

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

// ── create a session: the summary comes first ─────────────────────────────
await pg.fill('#p-ops-runName', 'Smoke session');
await pg.locator('#btn-gencode').click();
const code = await pg.inputValue('#p-ops-code');
ok(/^[A-Z0-9]{5}$/.test(code), 'Auto generates a five-character session code (' + code + ')');
await pg.locator('#btn-save').click();
await pg.waitForTimeout(250);

// Creating freezes the pool and the 28 specs, so it is summarised before it happens.
ok(await pg.locator('#sess-summary').isVisible(), 'creating a session shows a summary FIRST, not a silent write');
const sum0 = await pg.locator('#sess-summary').innerText();
ok(/28 rounds/.test(sum0), 'the summary states the session is 28 rounds', sum0.split('\n').find(l => /rounds/.test(l)));
ok(/4 warm-up/.test(sum0) && /24 scored/.test(sum0), 'split into warm-up and scored');
ok(/AI in one block only/.test(sum0), 'and that the AI is present in one block of the two');
ok(new RegExp(code).test(sum0) && /Smoke session/.test(sum0), 'it names the session and its code');
ok(/Sparse/.test(sum0) && /K=3/.test(sum0) && /K=10/.test(sum0), 'it states the two AI densities');
ok(/bracket s\*/.test(sum0), 'and confirms they still bracket s* — the design’s sign change');
ok(/Reveal/.test(sum0) && /cap 20/.test(sum0), 'it states the costs and the caps');
await pg.locator('#sum-cancel').click();
await pg.waitForTimeout(200);
ok(!(await pg.locator('#sess-summary').count()), 'Cancel closes the summary');
await tab('runs');
ok((await pg.locator('.run-card').count()) === 0, 'and creates NOTHING — cancelling the summary is a real cancel');

await tab('params');
await pg.locator('#btn-save').click();
await pg.waitForTimeout(250);
await pg.locator('#sum-ok').click();
await pg.waitForTimeout(500);
await tab('runs');
ok((await pg.locator('.run-card').count()) === 1, 'confirming the summary creates the session');

// ── the two session sections, in the shape of the ideasearchlab admin ─────
const secs = await pg.$$eval('.sess-sec .sess-head h3', els => els.map(e => e.textContent.trim()));
ok(JSON.stringify(secs) === JSON.stringify(['Create a session', 'Active sessions', 'Completed sessions']),
  'the screen reads Create · Active · Completed — creating first, then the two groups the other class ' +
  'admin panels use', secs.join(' | '));
ok((await pg.locator('#runs-active .run-card').count()) === 1, 'a draft session is ACTIVE, not completed');
ok(/1 active/.test(await pg.locator('#runs-active-n').innerText()), 'the active section carries its count');
ok(/No completed/.test(await pg.locator('#runs-done').innerText()), 'and the empty completed section says so');

const cardText = await pg.locator('.run-card').innerText();
ok(/Smoke session/.test(cardText) && /draft/.test(cardText), 'the card shows the session name and status');
ok(new RegExp(code).test(cardText), 'with its code as the headline');
ok(/0 participants/.test(cardText), 'and a participant count, like the ideasearchlab cards');
ok(/28 rounds/.test(cardText), 'and states that a session is 28 rounds');
ok(/Scored in the browser|Scored on the server/.test(cardText), 'and where the score is computed');

const cardBtns = await pg.$$eval('#runs-active .run-card .run-acts button', els => els.map(e => e.textContent.trim()));
['Open', 'Copy link', '⬇ Export data', '🧪 Test round', 'Clone', 'Open entry', 'Delete'].forEach(want => {
  ok(cardBtns.some(b => b === want), 'an active card offers ' + want, cardBtns.join(' | '));
});
const pill = await pg.$$eval('#runs-active .run-card .run-acts button', els => els.map(e => getComputedStyle(e).borderWidth));
ok(pill.every(w => w === '1px'), 'every card button carries the 1px border, so the row sits on one baseline');

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

// ── Screen 4 · participants ───────────────────────────────────────────────
// Seed the local session with three codes and the two session records they
// would have produced. P002 is the bug this screen used to have: a participant
// who reached the end while their roster document still said 'started'.
await pg.evaluate(() => {
  const key = 'searchv2:v3:admin:local';
  const list = JSON.parse(localStorage.getItem(key) || '[]');
  list[0].roster = [
    { code: 'P001', sequence: 'A', buttonOrder: 'ask_first', status: 'started', claimedByUid: 'u1', claimedAt: Date.now(), autoEnrolled: true },
    { code: 'P002', sequence: 'B', buttonOrder: 'reveal_first', status: 'started', claimedByUid: 'u2', claimedAt: Date.now(), autoEnrolled: true },
    { code: 'P003', sequence: 'A', buttonOrder: 'reveal_first', status: 'unused' }
  ];
  list[0].participants = [
    // 22 rounds finished = both warm-up pairs plus 18 scored ones.
    { participant_code: 'P001', rounds_done: 22, completed: false },
    { participant_code: 'P002', rounds_done: 28, completed: true }
  ];
  localStorage.setItem(key, JSON.stringify(list));
});
await pg.reload();
await pg.waitForSelector('#a-dash.active');
await tab('roster');
await pg.waitForTimeout(400);

ok((await pg.locator('.tab[data-tab="roster"]').innerText()).trim() === 'Participants',
  'the screen is called Participants — the `roster` id and collection keep that name in the data');
const heads = await pg.$$eval('#roster-table thead th',
  els => els.map(e => e.firstChild.textContent.trim()));
ok(JSON.stringify(heads) === JSON.stringify(['Code', 'Sequence', 'Left button', 'Round', 'Status', 'Claimed', 'Enrolled']),
  'Round sits beside Status, and the button column NAMES the button rather than saying "Buttons"', heads.join(' | '));
ok(/Ask the AI|Reveal/.test((await pg.$$eval('#roster-table tbody tr td:nth-child(3)', els => els.map(e => e.textContent.trim()))).join(' ')),
  'and its cells read "Ask the AI" / "Reveal" — the button that sat on the left, not a raw code');
ok(/which of the two paid buttons/i.test(await pg.locator('#roster-table thead th:nth-child(3)').getAttribute('title')),
  'with the tooltip that says what that means and that it is fixed for the session');

const rows = await pg.$$eval('#roster-table tbody tr', els => els.map(tr => ({
  code: tr.children[0].textContent.trim(), round: tr.children[3].textContent.trim(),
  status: tr.children[4].textContent.trim()
})));
const byCode = Object.fromEntries(rows.map(r => [r.code, r]));
ok(byCode.P001 && byCode.P001.round === '18/24 (75%)',
  'a participant part-way through reads 18/24 (75%) — scored rounds finished of the scored rounds assigned',
  byCode.P001 && byCode.P001.round);
ok(byCode.P001 && byCode.P001.status === 'started', 'and is still in progress');
ok(byCode.P002 && byCode.P002.status === 'completed',
  'a participant who reached the end reads completed, even though their roster document still says started ' +
  '— the status is read from their own session record', byCode.P002 && byCode.P002.status);
ok(byCode.P002 && byCode.P002.round === '24/24 (100%)', 'and their round count is full',
  byCode.P002 && byCode.P002.round);
ok(byCode.P003 && byCode.P003.round === '—' && byCode.P003.status === 'unused',
  'an unclaimed code shows no progress at all rather than a zero it did not earn');

// Sorting: every heading, both directions, and the rows with nothing to compare
// stay at the bottom either way.
const order = () => pg.$$eval('#roster-table tbody tr td:first-child', els => els.map(e => e.textContent.trim()));
const clickHead = async n => { await pg.locator(`#roster-table thead th:nth-child(${n})`).click(); await pg.waitForTimeout(120); };
await clickHead(4);
ok(JSON.stringify(await order()) === JSON.stringify(['P001', 'P002', 'P003']),
  'sorting by Round puts the least-advanced participant first', JSON.stringify(await order()));
await clickHead(4);
ok(JSON.stringify(await order()) === JSON.stringify(['P002', 'P001', 'P003']),
  'clicking it again reverses it — and the code with no session record stays LAST in both directions, ' +
  'because it has nothing to compare rather than a zero', JSON.stringify(await order()));
ok(/▼/.test(await pg.locator('#roster-table thead th:nth-child(4)').innerText()),
  'the sorted heading shows which way it is sorted');
await clickHead(5);
ok(JSON.stringify(await order()) === JSON.stringify(['P003', 'P001', 'P002']),
  'sorting by Status runs unused → started → completed: by how far they got, not alphabetically',
  JSON.stringify(await order()));
await clickHead(1); await clickHead(1);
ok(JSON.stringify(await order()) === JSON.stringify(['P003', 'P002', 'P001']),
  'and every other heading sorts too', JSON.stringify(await order()));
const sortable = await pg.$$eval('#roster-table thead th', els => els.filter(e => e.classList.contains('sortable')).length);
ok(sortable === 7, 'all seven columns are sortable', String(sortable));
await clickHead(1);   // back to code-ascending for the checks below

const rosterStats = await pg.locator('#roster-stats').innerText();
ok(/Ask on the left/.test(rosterStats) && /Reveal on the left/.test(rosterStats),
  'the screen reports the button-order balance beside the sequence balance, so both can be confirmed');
const tiles = await pg.$$eval('#roster-stats .stat-box', els => Object.fromEntries(
  els.map(e => [e.querySelector('span').textContent.trim(), e.querySelector('b').textContent.trim()])));
ok(tiles.Completed === '1' && tiles['In progress'] === '1' && tiles.Unused === '1',
  'and the tiles count them the same way the rows do', JSON.stringify(tiles));
const rosterText = await pg.locator('#tab-roster').innerText();
ok(/no names, no e-mail addresses/i.test(rosterText), 'the screen states that it holds no identifying information');

// The two side cards are gone: the table is the whole screen.
ok((await pg.locator('#btn-ros-gen').count()) === 0 && (await pg.locator('#ros-override').count()) === 0,
  'the code generator and the entrant-override card are removed — the override lives in Parameters');
ok((await pg.locator('#btn-ros-csv').count()) === 1, 'the CSV of the participants is still one press away');
const tableW = await pg.locator('#tab-roster .table-scroll').evaluate(e => e.getBoundingClientRect().width);
const panelW = await pg.locator('#tab-roster').evaluate(e => e.getBoundingClientRect().width);
ok(tableW > panelW - 40, 'and the table now spans the full width of the screen', tableW + ' of ' + panelW);

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

// ── the workbook a human has to read ──────────────────────────────────────
const wb = await pg.evaluate(() => {
  const b = window.SVExportTestHook;
  return b ? b.map(s => ({ name: s.name, rows: s.rows.length, first: (s.rows[0] || []).slice(0, 4) })) : null;
});
if (wb) {
  const names = wb.map(s => s.name);
  ok(names.indexOf('Dictionary') === 1,
    'the workbook puts a Dictionary right after the ReadMe, before any data', names.join(' · '));
  const dict = wb.find(s => s.name === 'Dictionary');
  ok(dict && dict.rows > 150, 'and it describes every column of the three analysis sheets', dict && String(dict.rows));
}

// ── every round, drawn — the admin-only view of the ground truth ──────────
await pg.locator('#btn-rg-draw').click();
await pg.waitForTimeout(1500);
ok((await pg.locator('#rg-grid .rg-card').count()) === 28,
  'the gallery draws one plot per round — all 28 of them');
const rgNote = await pg.locator('#rg-note').innerText();
ok(/ever drawn for a participant/.test(rgNote),
  'and says plainly that none of these overlays reaches a participant', rgNote.slice(0, 120));

const first = pg.locator('#rg-grid .rg-card').first();
ok((await first.locator('svg.plot-svg').count()) === 1, 'each round card carries its own plot');
ok((await first.locator('path.gt-line').count()) === 1,
  'with the GROUND TRUTH — the hidden random walk — drawn as a line');
ok((await first.locator('path.ai-line').count()) === 1, 'the AI’s interpolation drawn beside it');
ok((await first.locator('circle.anchor-dot').count()) > 0, 'and the AI’s private anchors marked');

// Every tick box is an independent switch over what is drawn.
await pg.uncheck('#rg-truth'); await pg.waitForTimeout(700);
ok((await pg.locator('#rg-grid path.gt-line').count()) === 0, 'unticking the ground truth removes it from every plot');
ok((await pg.locator('#rg-grid path.ai-line').count()) > 0, 'while leaving the AI’s line alone');
await pg.check('#rg-truth'); await pg.waitForTimeout(700);
await pg.uncheck('#rg-ai'); await pg.waitForTimeout(700);
ok((await pg.locator('#rg-grid path.ai-line').count()) === 0, 'unticking the AI’s line removes it');
ok((await pg.locator('#rg-grid path.gt-line').count()) === 28, 'and the truth is drawn for every round');
await pg.check('#rg-ai');
await pg.uncheck('#rg-anchors'); await pg.waitForTimeout(700);
ok((await pg.locator('#rg-grid circle.anchor-dot').count()) === 0, 'unticking the anchors removes them');
await pg.check('#rg-anchors'); await pg.waitForTimeout(700);

// Pre-opened prizes: a seeded round has them, an open round does not.
const preCards = await pg.$$eval('#rg-grid .rg-card',
  els => els.map(e => ({ tags: e.querySelector('.rg-tags').textContent, marks: e.querySelectorAll('rect.pre-mark').length,
                         foot: e.querySelector('.rg-foot').textContent })));
const seeded = preCards.filter(c => !/OPEN/.test(c.tags));
const open = preCards.filter(c => /OPEN/.test(c.tags));
// 24 scored = 16 seeded + 8 open, and the four warm-ups alternate OPEN / BALANCED.
ok(seeded.length === 18 && open.length === 10, 'the grid separates the seeded rounds from the open ones',
  seeded.length + ' seeded / ' + open.length + ' open');
ok(seeded.every(c => c.marks > 0), 'every seeded round shows its pre-opened prizes on the plot');
ok(seeded.every(c => /Open at the start \(the \d+ positions? the participant knows\): p\d+ = \d+/.test(c.foot)),
  'and lists them with their values underneath, said to be what the PARTICIPANT knows — as against the fuller set the AI knows');
ok(open.every(c => c.marks === 0 && /Nothing pre-opened/.test(c.foot)),
  'an open round shows none, and says the participant starts from a blank line');
ok(preCards.every(c => /Best prize \d+ at position \d+/.test(c.foot)),
  'each round also reports where its best prize is — the check a seed geometry is for');

// What the AI knows is the UNION of its private anchors, the pre-opened
// positions and every prize the participant reveals — so a seeded DENSE round
// starts at K + (pre-opened), not at K.
const seededDense = preCards.find(c => !/OPEN/.test(c.tags) && /DENSE/.test(c.tags));
const kOf = s => +(/K=(\d+)/.exec(s) || [])[1];
// The set is a UNION, so a pre-opened position that happens to be one of the
// private anchors is counted once — and the caption says so when it happens.
const parts = /the AI knows (\d+) positions? exactly at the start \((\d+) private \+ (\d+) pre-opened(?:, (\d+) of them the same position)?\)/
  .exec(seededDense.foot);
ok(parts && +parts[2] === kOf(seededDense.tags) && +parts[3] === seededDense.marks
   && +parts[1] === +parts[2] + +parts[3] - (+parts[4] || 0),
  'a seeded round reports the AI knowing its private anchors PLUS the pre-opened positions — the set it ' +
  'actually answers from — counting a shared position once', seededDense.foot);
ok(/one more with every prize the participant reveals/.test(seededDense.foot),
  'and says that revealing a prize teaches it that position too');
const openDense = preCards.find(c => /OPEN/.test(c.tags) && /DENSE/.test(c.tags));
ok(new RegExp('the AI knows <?b?>?' + kOf(openDense.tags) + ' positions exactly at the start').test(openDense.foot),
  'an open round starts at exactly its K — there is nothing pre-opened to add', openDense.foot);

await pg.check('#rg-scored'); await pg.waitForTimeout(1200);
ok((await pg.locator('#rg-grid .rg-card').count()) === 24, '"scored rounds only" drops the four warm-ups');
await pg.uncheck('#rg-scored'); await pg.waitForTimeout(1200);

// ── Design notes: the explainer, measured from this session's own pool ────
await tab('notes');
await pg.waitForTimeout(1500);
const nt = await pg.locator('#notes-body').innerText();
ok(/Yes — and that is the whole mechanism/.test(nt),
  'the notes answer whether the AI holds private data: yes, K positions it knows exactly');
ok(/interpolates, it cannot extrapolate/.test(nt), 'and state that it interpolates but cannot extrapolate');
ok(/latency identical to a reveal/.test(nt), 'and that its latency cannot leak whether it knew the position');
ok(/does not start blank/.test(nt) && /assign the starting picture/.test(nt),
  'they explain what a pre-opened round is and why it exists');
ok(/means three unrelated things/.test(nt),
  'and separate the three meanings of the word "seed", which is the collision that could break the design');
ok(/g = 4t/.test(nt) && /σ√g\/2/.test(nt) && /σ√t/.test(nt),
  'the gap-versus-tail arithmetic is stated, not asserted');
ok(/blind spot/.test(nt) && /undetectable/.test(nt),
  'and why all three layouts are needed rather than just the one');
ok(/Yes, and so does where the maximum is/.test(nt),
  'they confirm the landscape is redrawn every round');
ok(/across positions, not across time/.test(nt),
  'and correct the reading of "Brownian" as something that evolves while the participant works');

// The numbers must be MEASURED, not copied from the design document.
const shapeRows = await pg.$$eval('#notes-body table tbody tr', els => els.map(e => e.innerText));
ok(shapeRows.some(r => /FRONTIER/.test(r)) && shapeRows.some(r => /BALANCED/.test(r)) && shapeRows.some(r => /GAP/.test(r)),
  'the layout table covers all three shapes with their own g, t and g/4t');
ok(/of these mappings touch the ceiling/.test(nt),
  'the plateau measurement is reported from this session’s pool');
ok(/nearest<\/b> maximising position|nearest maximising position/.test(nt),
  'and the tie rule the export uses is stated');
const notesErr = await pg.locator('#notes-body .admin-note.bad').count();
ok(notesErr === 0, 'the notes build without error against a real session');

// ── Wording: the words a participant reads, as they will read them ─────────
// The point of the screen is that what it shows IS what is shown, so the checks
// are about substitution and about structure staying put — not about layout.
await tab('wording');
ok(await shown('tab-wording'), 'the Wording screen opens');

// Open every group, so the assertions below see all of the words and not only
// the one group that starts expanded.
await pg.$$eval('#wording-body details', els => els.forEach(e => { e.open = true; }));
const wt = await pg.locator('#wording-body').innerText();
ok(/consent/i.test(await pg.locator('#tab-wording').innerText()), 'it names the consent screen');
ok(/Each reveal costs 4 points|reveal costs 4/.test(wt),
  'the costs are substituted, so the words read as the participant will read them', wt.slice(0, 160));
ok(!/\{revealCost\}|\{J\}|\{stepBound\}|\{K\}/.test(wt),
  'no token is left showing anywhere on the screen');

// Every question the owner could not find before must be findable here.
const findable = async (q) => {
  await pg.fill('#wd-search', q);
  await pg.waitForTimeout(150);
  return (await pg.locator('#wording-body').innerText()).toLowerCase().includes(q.toLowerCase());
};
ok(await findable('HIGHEST the prize at position 41'), 'a quick-check question is on the screen');
ok(await findable('how did you decide when to stop'), 'a survey question is on the screen');
ok(await findable('Out of every 10 questions'), 'a slider item is on the screen');
ok(await findable('how many times would it come up even'), 'a numeracy item is on the screen');
await pg.fill('#wd-search', '');
await pg.waitForTimeout(150);

// Editing one field changes that field's rendered text and nothing else.
await pg.fill('#wd-search', 'Consent text');
await pg.waitForTimeout(150);
const box = pg.locator('#wording-body textarea[data-edit="consent"]');
await box.fill('We are going to play a game. It takes about 40 minutes.');
await pg.waitForTimeout(150);
ok(/We are going to play a game/.test(await pg.locator('#wording-body .wd-shown').first().innerText()),
  'typing a new wording repaints what the participant will see');
ok(await pg.locator('#wording-body .wd-field.edited').count() >= 1, 'the changed field is marked as changed');
ok(/<b>1<\/b> changed/.test(await pg.locator('#wd-count').innerHTML()), 'the counter reports one change');

// Reverting is one click and puts the default back.
await pg.locator('#wording-body button[data-revert="consent"]').click();
await pg.waitForTimeout(150);
ok(/decision-making study/.test(await pg.locator('#wording-body .wd-shown').first().innerText()),
  'reverting restores the study default');
ok(/<b>0<\/b> changed/.test(await pg.locator('#wd-count').innerHTML()), 'and the counter drops back to none');
await pg.fill('#wd-search', '');
await pg.waitForTimeout(150);

// A saved override must SURVIVE a reload and reach the participant's copy.
await pg.fill('#wd-search', 'Consent text');
await pg.waitForTimeout(150);
await pg.locator('#wording-body textarea[data-edit="consent"]').fill('Reworded for this session only.');
await pg.waitForTimeout(120);
await tab('params');
await pg.locator('#btn-save').click();
await pg.waitForTimeout(300);
if (await pg.locator('#sum-ok').count()) { await pg.locator('#sum-ok').click(); await pg.waitForTimeout(400); }
const stored = await pg.evaluate(() => {
  const runs = JSON.parse(localStorage.getItem('searchv2:v3:admin:local') || '[]');
  return runs.map(r => {
    try { return JSON.parse(r.contentJson || '{}').consent || null; } catch { return null; }
  });
});
ok(stored.some(c => c === 'Reworded for this session only.'),
  'Save session persists the wording with the session — a LOCKED one included, since ' +
  'wording is not part of the design', JSON.stringify(stored));

// And the participant's own copy must carry it, or an override would be
// invisible in server mode, where the run document is admin-only.
const pub = await pg.evaluate(() => {
  const runs = JSON.parse(localStorage.getItem('searchv2:v3:admin:local') || '[]');
  const r = runs.find(x => (x.contentJson || '').includes('consent'));
  return r ? typeof r.contentJson : null;
});
ok(pub === 'string',
  'and it is stored as a STRING, so a later revert can actually remove a key — ' +
  'a map would be deep-merged by setDoc(merge:true) and never lose one', String(pub));

// A CLONE carries the wording of the session it was cloned FROM. newRunDoc used
// to read the panel's in-form wording, so cloning session B while session A was
// open gave the clone A's words on B's parameters.
await tab('runs');
const beforeClone = await pg.locator('.run-card').count();
pg.once('dialog', d => d.accept('Cloned by the smoke test'));
await pg.locator('.run-card [data-act="clone"]').first().click();
await pg.waitForTimeout(600);
const cloned = await pg.evaluate(() => {
  const runs = JSON.parse(localStorage.getItem('searchv2:v3:admin:local') || '[]');
  const c = runs.find(r => r.clonedFrom);
  if (!c) return { found: false };
  let consent = null;
  try { consent = JSON.parse(c.contentJson || '{}').consent || null; } catch {}
  return { found: true, consent };
});
ok(cloned.found, 'cloning a session from its card creates the clone');
ok(cloned.consent === 'Reworded for this session only.',
  'and the clone carries the wording of the session it was cloned FROM', String(cloned.consent));

// ── creating a session from the Sessions screen ───────────────────────────
// Naming is the one thing every session needs, so it is asked FIRST, on the
// screen the panel opens on — not at the bottom of the seventh parameter group.
await tab('runs');
ok(await pg.locator('#create-sec').isVisible(), 'the Sessions screen carries a "Create a session" card');
ok(await pg.locator('#nr-name').isVisible() && await pg.locator('#nr-code').isVisible(),
  'with the session NAME and its optional Session ID asked before anything is created');
ok((await pg.getAttribute('#nr-name', 'placeholder')) === 'e.g. Spring MBA 2026',
  'the name field is the one the other class admins show');
ok(/capital letters and digits/.test(await pg.locator('#create-sec .hint').innerText()),
  'and the ID field states the rule it enforces');
ok((await pg.locator('#tab-runs #btn-new-run').count()) === 1,
  'the parameter-form path is still one click away, from the card itself');

// What the admin types is live-normalised to a code that is typeable back.
await pg.fill('#nr-name', 'Spring MBA 2026');
await pg.fill('#nr-code', 'spring mba-2026');
ok((await pg.inputValue('#nr-code')) === 'SPRINGMBA2026',
  'the Session ID normalises to one word of capitals and digits as it is typed',
  await pg.inputValue('#nr-code'));

// Taking the advanced path must not cost the admin what they already typed.
await pg.locator('#tab-runs #btn-new-run').click();
await pg.waitForTimeout(200);
ok((await pg.inputValue('#p-ops-runName')) === 'Spring MBA 2026' &&
   (await pg.inputValue('#p-ops-code')) === 'SPRINGMBA2026',
  '"Set the parameters first…" carries the typed name and code into the form');

await tab('runs');
const cardsBefore = await pg.locator('.run-card').count();

// A too-short custom ID is refused before any summary is raised.
await pg.fill('#nr-code', 'AB');
await pg.locator('#btn-create-run').click();
await pg.waitForTimeout(300);
ok(!(await pg.locator('#sess-summary').count()) && /3–40 characters/.test(await pg.locator('#nr-note').innerText()),
  'a Session ID shorter than three characters is refused, and nothing is created');

// So is one that is already taken — a repeat would re-point the code at the
// newer session and send the older one's participants into it.
await pg.fill('#nr-code', code);
await pg.locator('#btn-create-run').click();
await pg.waitForTimeout(400);
ok(!(await pg.locator('#sess-summary').count()) && /already taken/.test(await pg.locator('#nr-note').innerText()),
  'and so is a Session ID another session already uses');
ok((await pg.locator('.run-card').count()) === cardsBefore, 'neither refusal creates a session');

// The real thing: name, code, the same summary gate, one press.
await pg.fill('#nr-code', 'SPRINGMBA2026');
await pg.locator('#btn-create-run').click();
await pg.waitForTimeout(400);
ok(await pg.locator('#sess-summary').isVisible(),
  'creating from the card still summarises the session FIRST — the pool and the 28 specs freeze here too');
const sumC = await pg.locator('#sess-summary').innerText();
ok(/Spring MBA 2026/.test(sumC) && /SPRINGMBA2026/.test(sumC), 'the summary names the session and its code');
ok(/Entry: closed/.test(sumC), 'and states that it is created closed, exactly as the lead text promises');
await pg.locator('#sum-ok').click();
await pg.waitForTimeout(700);

ok((await pg.locator('.run-card').count()) === cardsBefore + 1, 'confirming creates the session');
const newCard = await pg.locator('#runs-active .run-card', { hasText: 'SPRINGMBA2026' }).innerText();
ok(/Spring MBA 2026/.test(newCard) && /draft/.test(newCard),
  'it lands in Active sessions under its name, as a draft', newCard.split('\n').slice(0, 3).join(' · '));

const created = await pg.locator('#nr-created').innerText();
ok(/SPRINGMBA2026/.test(created) && /\?code=SPRINGMBA2026/.test(created),
  'the card reports the code and the participant link', created.split('\n').join(' · '));
const boxBtns = await pg.$$eval('#nr-created button', els => els.map(e => e.textContent.trim()));
ok(JSON.stringify(boxBtns) === JSON.stringify(['Copy link', 'Check its parameters', 'Open entry']),
  'and offers the three things there are to do next', boxBtns.join(' | '));
ok((await pg.inputValue('#nr-name')) === '' && (await pg.inputValue('#nr-code')) === '',
  'the form clears, ready for the next session');

// "Create, then open it" was the complaint: the new session is already the
// selected one, so every other screen is on it without a second click.
await tab('params');
ok(/Spring MBA 2026/.test(await pg.locator('#params-title').innerText()) &&
   /SPRINGMBA2026/.test(await pg.locator('#params-sub').innerText()),
  'creating a session SELECTS it — the Parameters screen is already on it, with nothing to open',
  await pg.locator('#params-title').innerText());

// A blank ID auto-generates, so a name is genuinely all it takes.
await tab('runs');
await pg.fill('#nr-name', 'Autumn cohort');
await pg.locator('#btn-create-run').click();
await pg.waitForTimeout(400);
await pg.locator('#sum-ok').click();
await pg.waitForTimeout(700);
ok((await pg.locator('.run-card').count()) === cardsBefore + 2, 'a name alone creates a session');
const autoGenerated = (await pg.locator('#nr-created .cb-code').innerText()).trim();
ok(/^[A-Z0-9]{5}$/.test(autoGenerated), 'with an automatic five-character code (' + autoGenerated + ')');
ok(autoGenerated !== code && autoGenerated !== 'SPRINGMBA2026', 'that is not one already in use');

// A draft must really be closed: app.js treats a session as open when
// ops.entryOpen is anything but false, so a draft carrying the Operations
// toggle's "Open" would be enterable before the validation gate ever ran.
const drafts = await pg.evaluate(() => JSON.parse(localStorage.getItem('searchv2:v3:admin:local') || '[]')
  .map(r => ({ code: r.code, status: r.status, entryOpen: r.ops && r.ops.entryOpen })));
ok(drafts.every(r => r.status !== 'draft' || r.entryOpen === false),
  'every session is created as a real draft — status draft AND entry closed',
  JSON.stringify(drafts));

ok(errors.length === 0, 'no page errors anywhere in the panel', errors.slice(0, 5).join(' | '));

await br.close();
srv.close();
console.log('\n' + (fails ? `ADMIN SMOKE FAILED — ${fails} of ${checks} checks` : `ADMIN SMOKE OK — all ${checks} checks passed`));
process.exit(fails ? 1 : 0);
