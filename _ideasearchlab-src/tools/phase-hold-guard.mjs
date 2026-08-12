/**
 * phase-hold-guard.mjs — offline test (Playwright, no network).
 *
 *   node _ideasearchlab-src/tools/phase-hold-guard.mjs
 *   PW=/path/to/playwright CHROMIUM=/path/to/chromium node …   (overrides)
 *
 * Plays the whole participant flow in the 🧪 Test-round sandbox (nothing is
 * saved anywhere) over a local static server, and pins the two CONFIRMATION
 * HOLDS — the moments a participant is shown what they just produced before the
 * app moves them on (owner 2026-08):
 *
 *   1. INDIVIDUAL — "Your ideas are submitted": the ideas they wrote, the ones
 *      carried to the group, and a 15 s countdown. The header must carry NO
 *      phase timer: this screen comes after the submit, so the selection
 *      stage's clock no longer governs anything (it used to keep ticking there,
 *      beside the hold's own countdown, and its expiry re-fired autoFinish).
 *   2. GROUP — "Your group has voted": the group's final selected ideas with
 *      their vote counts, held the same 15 s. Same rule about the header.
 *
 * Both holds park the phase change rather than delaying the write, so the test
 * also checks the app actually advances once each hold elapses — a hold that
 * never releases would strand a whole class.
 *
 * It also pins the HEADER CONTROLS (theme toggle + account menu) to the right
 * edge on EVERY screen of the flow. They are the one piece of furniture present
 * throughout, so they must not move between steps — and they did: the phase
 * headers relied on the timer's `margin-left: auto` to push them right, so the
 * two confirmation screens (correctly timer-less) left them beside the wordmark.
 */
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// The site repo root (…/_ideasearchlab-src/tools/ → two levels up), so the
// server below serves the BUILT bundle in lab/ideasearchlab/ from anywhere.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const T = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json' };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let f = join(ROOT, decodeURIComponent(u.pathname));
  if (u.pathname.endsWith('/')) f = join(f, 'index.html');
  try { const b = await readFile(f); res.writeHead(200,{'content-type':T[extname(f)]||'application/octet-stream'}); res.end(b); }
  catch { const b = await readFile(join(ROOT,'lab/ideasearchlab/index.html')); res.writeHead(200,{'content-type':'text/html'}); res.end(b); }
});
await new Promise(r => srv.listen(0, r));
const B = `http://localhost:${srv.address().port}/lab/ideasearchlab/`;

// Screenshots land in the OS temp dir — this is a check, not an artefact build.
const SHOT = n => join(process.env.TMPDIR || '/tmp', `isl-phase-hold-${n}.png`);

let fails = 0;
const check = (n, c, d) => { console.log((c ? '  ok   ' : '  FAIL ') + n + (c || !d ? '' : ' — ' + d)); if (!c) fails++; };
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await br.newPage({ viewport: { width: 1320, height: 950 } });
p.on('pageerror', e => { console.log('  [pageerror]', e.message); fails++; });
await p.addInitScript(() => {
  localStorage.setItem('ideasearchlab-preview-config', JSON.stringify({
    phaseConfig: { individualPhaseActive:true, groupPhaseActive:true, phaseOrder:'individual_first',
      maxIdeasIndividual:10, ideasCarriedToGroup:2, groupSize:1,
      individualGenerationDuration:300, individualSelectionDuration:300,
      groupIdeationDuration:300, groupVotingDuration:300 },
    aiConfig: { individualAI:false, groupAI:false },
  }));
});
const btn = t => p.getByRole('button', { name: t }).first();
const clickIf = async (t, ms=500) => { const b = btn(t); if (await b.count() && await b.isVisible().catch(()=>false)) { await b.click(); await p.waitForTimeout(ms); return true; } return false; };
// Right edge of the header controls, and how far it sits from the viewport's
// right edge — the number that must not change from screen to screen.
const controlsRight = () => p.evaluate(() => {
  const el = document.querySelector('[class*="_controls_"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { right: Math.round(r.right), gap: Math.round(window.innerWidth - r.right), top: Math.round(r.top) };
});
const seenControls = [];
const noteControls = async where => {
  const c = await controlsRight();
  if (c) seenControls.push({ where, ...c });
  return c;
};

const headerClock = () => p.evaluate(() => {
  const h = document.querySelector('header') || document.body;
  const m = (h.innerText || '').match(/\b\d{1,2}:\d{2}\b/); return m ? m[0] : null;
});

try {
  await p.goto(B + 'session/PREVIEW/welcome?preview=1&key=stouras', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await noteControls('welcome');
  await clickIf(/agree|continue/i, 1200);
  await clickIf(/skip/i, 900);
  await noteControls('registration');
  await clickIf(/continue|submit|join|start/i, 1600);
  console.log('\n=== INDIVIDUAL PHASE ===', p.url().split('/').pop());
  await noteControls('individual instructions');
  await clickIf(/^start$/i, 1200);
  await noteControls('individual workspace');

  // Write 3 ideas
  for (const [t, d] of [['Alpha jacket','turns blue at 37C'],['Beta shirt','heat map panels'],['Gamma cap','colour shift brim']]) {
    await p.getByPlaceholder('Idea title').first().fill(t);
    await p.getByPlaceholder(/^Description/).first().fill(d);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(500);
  }
  await clickIf(/Proceed to Selection/i, 900);
  await noteControls('individual selection');
  const clockDuringSelection = await headerClock();
  console.log('  (selection stage header clock:', clockDuringSelection + ')');

  // Select 2 ideas by double-click
  const cards = p.locator('h3', { hasText: /Alpha jacket|Beta shirt/ });
  for (let i = 0; i < 2; i++) { await cards.nth(i).dblclick(); await p.waitForTimeout(400); }
  await clickIf(/Finish & Submit/i, 2500);

  console.log('\n--- Individual confirmation screen ---');
  await p.screenshot({ path: SHOT('individual-confirm') });
  await noteControls('individual confirmation');
  const body1 = await p.innerText('body');
  check('the submission summary is shown', /Your ideas are submitted/i.test(body1), body1.slice(0,120));
  check('it lists the carried ideas', /CARRIED TO GROUP|Carried to group/i.test(body1));
  const holdLine = (body1.match(/starts in (\d+)s/i) || [])[1];
  check('the 15s hold countdown is running', Number(holdLine) > 0 && Number(holdLine) <= 15, `line="${(body1.match(/.*starts in.*/i)||[''])[0]}"`);
  const clock1 = await headerClock();
  check('NO phase timer is left ticking in the header', clock1 === null,
    `header still shows "${clock1}" (was the selection stage's clock)`);

  // Wait out the hold → group phase
  await p.waitForTimeout(16000);
  console.log('\n=== GROUP PHASE ===', p.url().split('/').pop());
  check('it advanced to the group phase after the hold', /\/group/.test(p.url()), p.url());
  await noteControls('group instructions');
  await clickIf(/^start$/i, 1500);
  await noteControls('group ideation');
  await clickIf(/Proceed to Voting/i, 1500);
  await clickIf(/Got it/i, 800);   // "Reach consensus" modal
  await noteControls('group voting');
  await p.screenshot({ path: SHOT('voting') });

  // Vote for the required number of ideas, then submit
  // Vote on the PILL (the dblclick handler is on the card, not the title).
  const pills = p.locator('[class*="ideaPillClickable"]');
  const n = await pills.count();
  console.log('  (votable pills:', n + ')');
  for (let i = 0; i < n; i++) { await pills.nth(i).dblclick(); await p.waitForTimeout(450); }
  await clickIf(/Submit Votes/i, 3000);

  console.log('\n--- Group result screen ---');
  await p.screenshot({ path: SHOT('group-result') });
  await noteControls('group result');
  const body2 = await p.innerText('body');
  check('the group result summary is shown', /Your group has voted/i.test(body2), body2.slice(0,160));
  check('it lists the selected ideas with their votes', /\d+ votes?/i.test(body2));
  const hold2 = (body2.match(/starts in (\d+)s/i) || [])[1];
  check('the 15s hold countdown is running', Number(hold2) > 0 && Number(hold2) <= 15, `line="${(body2.match(/.*starts in.*/i)||[''])[0]}"`);
  const clock2 = await headerClock();
  check('NO phase timer is left ticking in the header', clock2 === null, `header shows "${clock2}"`);

  await p.waitForTimeout(16500);
  await noteControls('survey');
  console.log('\n=== AFTER HOLD ===', p.url().split('/').pop());
  check('it advanced past the group phase after the hold', !/\/group$/.test(p.url()), p.url());
  console.log('\n--- Header controls (theme + account) across the flow ---');
  for (const c of seenControls) console.log(`      ${c.where.padEnd(26)} right=${String(c.right).padStart(5)}  gap=${c.gap}`);
  const gaps = [...new Set(seenControls.map(c => c.gap))];
  check(`the controls stay hard right on all ${seenControls.length} screens`,
    seenControls.length >= 8 && gaps.length === 1,
    `distinct right-edge gaps: ${gaps.join(', ')} — they move between steps`);
  const offscreenish = seenControls.filter(c => c.gap > 120);
  check('they are never left stranded beside the wordmark', offscreenish.length === 0,
    offscreenish.map(c => `${c.where} gap=${c.gap}`).join('; '));
} catch (e) {
  console.log('  [error]', e.message); fails++;
  await p.screenshot({ path: SHOT('error') }).catch(()=>{});
}
await br.close(); srv.close();
console.log(fails ? `\n${fails} check(s) FAILED` : '\nPHASE-HOLD GUARD OK — both confirmation summaries show, hold 15s with no stale phase timer, and release.');
process.exit(fails ? 1 : 0);
