/* ==========================================================================
   PortfolioFit — FULL-COVERAGE PROMPT guard (offline, Playwright; no network)
       node lab/portfoliofit/tools/fullcover-guard.mjs

   Participants were covering the frame once and pressing "next" after ~1 minute
   of a 10-minute puzzle. The moment coverage hits 100% the game now emits
   `full_cover` and the experiment layer pops a centred choice. This guard pins
   the whole contract:

     1. nothing before the frame is full — the prompt is not on screen mid-play;
     2. on the FIRST cover it appears, reporting the player's own net value and
        naming it as their best so far (never the puzzle optimum);
     3. the green button reads out the time left in THIS puzzle and keeps
        counting down (the clock runs on behind the prompt);
     4. green dismisses it and play continues from where it was left — the round
        is still live and the board untouched;
     5. covering the frame AGAIN re-prompts (removing a brick re-arms it), and
        an equal cover is not an improvement, so the second prompt quotes the
        best-of-run wording instead;
     6. the orange button says what it does: "Continue to the game" in training,
        "Next puzzle" mid-set, "Finish" on the LAST puzzle — and pressing it
        ends the round exactly like the green submit pill.

   Runs inside the ?preview=1 test-round sandbox, so it writes nothing: any
   request to the Firebase SDK is aborted AND counted.
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

// Two main puzzles from the built-in pool (no frozen set), registration off so
// training hands straight over to the main game.
const SEED = {
  ts: 1, code: 'FCPF',
  session: {
    texts: {},
    settings: {
      registrationEnabled: false,
      puzzlesPerUser: { easy: 1, hard: 1 },
      activePuzzleIds: [],
      randomizeOrder: false,
    },
    registrationQuestions: null, registrationConsents: [], surveyQuestions: null,
  },
  puzzles: [],
};

// ---- helpers ------------------------------------------------------------
const metrics = () => pg.evaluate(() => { try { return window.PFGame.getMetrics(); } catch { return null; } });
const promptUp = () => pg.evaluate(() => !!document.querySelector('.pfx-fc'));
const promptText = () => pg.evaluate(() => (document.querySelector('.pfx-fc-card p')?.textContent || ''));
const goText = () => pg.evaluate(() => (document.querySelector('.pfx-fc-go')?.textContent || ''));
const nextText = () => pg.evaluate(() => (document.querySelector('.pfx-fc-next')?.textContent || ''));
const clickIn = sel => pg.evaluate(s => { const b = document.querySelector(s); if (b) b.click(); }, sel);
// Drive the frame to 100% through the game's OWN hint path — hint() places one
// solution brick and calls checkWin(), the same function a board click reaches,
// so the trigger under test is exercised exactly as a participant reaches it.
async function coverFrame() {
  for (let i = 0; i < 12; i++) {
    const m = await metrics();
    if (m && m.coverage === 100) return true;
    await clickIn('#hintBtn');
    await pg.waitForTimeout(60);
  }
  return (await metrics())?.coverage === 100;
}
const overlayTitle = () => pg.evaluate(() => (document.querySelector('.pfx-ov .pfx-card h2')?.textContent || ''));

// ---- boot the sandbox ---------------------------------------------------
await pg.goto(BASE);
await pg.evaluate(() => localStorage.clear());
await pg.evaluate(s => localStorage.setItem('pfx-preview-config', JSON.stringify(s)), SEED);
await pg.goto(BASE + '?preview=1&key=stouras&session=FCPF');
await pg.waitForSelector('.pfx-card', { timeout: 15000 });
await pg.locator('.pfx-card button').first().click();          // Start → training intro
await pg.waitForTimeout(600);
await pg.locator('.pfx-card button').first().click();          // Begin training
await pg.waitForFunction(() => document.body.classList.contains('pf-playing'), null, { timeout: 15000 });
const skipTour = pg.getByText('Skip tour').first();
if (await skipTour.isVisible().catch(() => false)) { await skipTour.click(); await pg.waitForTimeout(400); }

// ---- 1. nothing while the frame is still partial ------------------------
await clickIn('#hintBtn');
await pg.waitForTimeout(120);
const partial = await metrics();
ok(partial && partial.coverage > 0 && partial.coverage < 100, `the frame is partially covered (${partial?.coverage}%)`);
ok(!(await promptUp()), 'no prompt while the frame is only partly covered');

// ---- 2. the first full cover raises it ----------------------------------
ok(await coverFrame(), 'the frame reaches 100% coverage');
await pg.waitForTimeout(200);
ok(await promptUp(), 'the prompt appears the moment the frame is fully covered');
const m1 = await metrics();
const t1 = await promptText();
ok(t1.includes('fully covered the frame'), 'it congratulates the player on covering the frame');
ok(t1.includes('$' + m1.net), `it reports the player's OWN net value ($${m1.net})`);
ok(t1.includes('best full cover you have found'), 'the FIRST cover is named as their best so far');
ok(!t1.includes('$' + m1.bestValue) || m1.net === m1.bestValue,
  'the puzzle optimum is never revealed in the prompt');
ok(m1.fullCovers === 1 && m1.bestFullNet === m1.net,
  `the round tracks the cover (fullCovers=${m1.fullCovers}, bestFullNet=$${m1.bestFullNet})`);

// ---- 3. the green button counts this puzzle's time down -----------------
const g1 = await goText();
ok(/^Let’s try! There (is|are) (\d+ min )?\d+ sec left\.$/.test(g1.trim()), `green button reads "${g1.trim()}"`);
ok((await nextText()).trim() === 'Continue to the game',
  'during TRAINING the orange button hands over to the main game');
await pg.waitForTimeout(1700);
const g2 = await goText();
ok(g1 !== g2, `the countdown updates live ("${g1.trim()}" → "${g2.trim()}")`);
const mid = await metrics();
ok(mid && !mid.ended && await pg.evaluate(() => document.body.classList.contains('pf-playing')),
  'the round is still live behind the prompt — the clock keeps running');

// ---- 4. green dismisses it, play continues ------------------------------
await clickIn('.pfx-fc-go');
await pg.waitForTimeout(150);
ok(!(await promptUp()), 'the green button removes the whole box');
const after = await metrics();
ok(after && !after.ended && after.coverage === 100,
  'play continues from where it was left — same board, round still running');

// ---- 5. covering the frame again re-prompts, with the best-of-run wording
await pg.evaluate(() => { const c = document.querySelector('#board .cell.filled'); if (c) c.click(); });
await pg.waitForTimeout(150);
ok((await metrics()).coverage < 100, 'removing a brick drops the coverage below 100%');
ok(!(await promptUp()), 'removing a brick does not itself raise the prompt');
ok(await coverFrame(), 'the frame is covered a second time');
await pg.waitForTimeout(200);
ok(await promptUp(), 'the SECOND full cover raises the prompt again');
const m2 = await metrics(), t2 = await promptText();
ok(m2.fullCovers === 2, `the second cover is counted (fullCovers=${m2.fullCovers})`);
ok(m2.bestFullNet === Math.max(m1.bestFullNet, m2.net), 'the best-of-run net value never falls');
ok(t2.includes('The best of all such values you obtained in this run is $' + m2.bestFullNet),
  'an equal cover is not an improvement, so it quotes the best of the run');

// ---- 6. the orange button, on to the main game --------------------------
await clickIn('.pfx-fc-next');
await pg.waitForFunction(() => {
  const h = document.querySelector('.pfx-ov .pfx-card h2');
  return h && !/training/i.test(h.textContent || '');
}, null, { timeout: 20000 });
ok(!(await promptUp()), 'the orange button ends the round and takes the prompt with it');
ok(/game/i.test(await overlayTitle()), `training handed over to the main game ("${await overlayTitle()}")`);

// Puzzle 1 of 2 → "Next puzzle"
await pg.locator('.pfx-ov .pfx-card button').first().click();      // Start puzzle 1 of 2
await pg.waitForFunction(() => document.body.classList.contains('pf-playing'), null, { timeout: 15000 });
ok(await coverFrame(), 'main puzzle 1: the frame is covered');
await pg.waitForTimeout(200);
ok(await promptUp(), 'main puzzle 1: the prompt appears');
ok((await nextText()).trim() === 'Next puzzle',
  'with a puzzle still to come the orange button says "Next puzzle"');
await clickIn('.pfx-fc-next');
await pg.waitForFunction(() => {
  const h = document.querySelector('.pfx-ov .pfx-card h2');
  return h && /complete/i.test(h.textContent || '');
}, null, { timeout: 20000 });
ok(/Puzzle 1 of 2 complete/i.test(await overlayTitle()),
  `"Next puzzle" submits the round like the green pill ("${await overlayTitle()}")`);

// Puzzle 2 of 2 → "Finish"
await pg.locator('.pfx-ov .pfx-card button').first().click();      // Continue to the 2nd puzzle
await pg.waitForFunction(() => document.body.classList.contains('pf-playing'), null, { timeout: 15000 });
ok(await coverFrame(), 'main puzzle 2: the frame is covered');
await pg.waitForTimeout(200);
ok((await nextText()).trim() === 'Finish',
  'on the LAST puzzle the orange button says "Finish"');
await clickIn('.pfx-fc-next');
await pg.waitForFunction(() => {
  const b = document.querySelector('.pfx-ov .pfx-card button');
  return b && /survey/i.test(b.textContent || '');
}, null, { timeout: 20000 });
ok(true, '"Finish" closes the last puzzle and leads on to the survey');

// ---- nothing leaked -----------------------------------------------------
ok(sdkHits === 0, 'the Firebase SDK is never fetched (the whole guard writes nothing)');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

await br.close(); srv.close();
console.log(fails ? `\nPF FULL-COVERAGE GUARD FAILED (${fails})`
  : '\nPF FULL-COVERAGE GUARD OK — prompt on every cover, live countdown, keep-playing, and the right way out.');
process.exit(fails ? 1 : 0);
