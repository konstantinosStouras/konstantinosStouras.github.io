/**
 * carry-forward-page-guard.mjs — offline browser test (Playwright, no network).
 *
 *   node _ideasearchlab-src/tools/carry-forward-page-guard.mjs
 *   PW=/path/to/playwright CHROMIUM=/path/to/chromium node …   (overrides)
 *
 * Plays the individual phase in the 🧪 Test-round sandbox (nothing is saved)
 * over a local static server serving the SHIPPED bundle, and pins the
 * carry-forward rule the owner asked for on 2026-09-28 as a participant meets
 * it: whoever wrote at least the cap's worth of ideas carries exactly the cap,
 * their own picks first and the computer filling the rest at random, each of
 * those badged "Computer selected to group stage".
 *
 *   A. cap 3, 5 ideas written, 1 chosen  → 3 carried: 1 own + 2 computer;
 *      after the hold the group phase lists those 3 and shows no such tag
 *      to the group (the tag is for the participant, the admin and the data).
 *   B. cap 3, 2 ideas written, 1 chosen  → both carried, 1 by the computer
 *      (fewer ideas than the cap: all of them go).
 *   C. cap 3, 4 ideas written, 3 chosen  → 3 carried, nothing added.
 *   D. cap 2, 3 ideas written, NONE chosen and the selection clock (3 s)
 *      runs out → auto-submitted with 2 computer picks and the sentence that
 *      says so.
 *   E. cap 3, 4 ideas written, 1 ticked, then the participant is FORCE-
 *      ADVANCED into the group phase without submitting (the sandbox's
 *      test-only hook flips their status, as the instructor's Advance does):
 *      the group page lists exactly 3 of their ideas, and their own client
 *      writes the 2 computer picks back to the documents with the tag.
 * After every submit the DOCUMENTS are read back through the same hook: the
 * participant's picks carry selectedBy 'participant', the computer's
 * 'computer', the rest selected false — what the confirmation screen shows is
 * what was persisted, not only what the page remembers.
 * Plus: the selection stage TELLS the participant fewer picks are filled in.
 */
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const TAG = 'Computer selected to group stage';
// The sandbox's documents (previewDb.js exposes them in preview only).
const readDocs = p => p.evaluate(() => window.__islPreview.docs('sessions/PREVIEW/ideas').map(d => ({ title: d.title, selected: !!d.selected, selectedBy: d.selectedBy === undefined ? null : d.selectedBy })));
const docCheck = (label, docs, own, auto) => {
  const byTitle = Object.fromEntries(docs.map(d => [d.title, d]));
  const okOwn = own.every(t => byTitle[t] && byTitle[t].selected && byTitle[t].selectedBy === 'participant');
  const okAuto = auto.every(t => byTitle[t] && byTitle[t].selected && byTitle[t].selectedBy === 'computer');
  const rest = docs.filter(d => !own.includes(d.title) && !auto.includes(d.title));
  const okRest = rest.every(d => !d.selected && d.selectedBy === null);
  check(`${label}: the documents say the same — ${own.length} participant, ${auto.length} computer, ${rest.length} left`, okOwn && okAuto && okRest, JSON.stringify(docs));
};

let fails = 0;
const check = (n, c, d) => { console.log((c ? '  ok   ' : '  FAIL ') + n + (c || !d ? '' : ' — ' + d)); if (!c) fails++; };
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });

// A fresh page is a fresh sandbox: the preview store lives in the page's own
// module scope, so every scenario starts from nothing.
async function openIndividual(cfg) {
  const p = await br.newPage({ viewport: { width: 1320, height: 950 } });
  p.on('pageerror', e => { console.log('  [pageerror]', e.message); fails++; });
  await p.addInitScript(cfg => {
    localStorage.setItem('ideasearchlab-preview-config', JSON.stringify({
      phaseConfig: { individualPhaseActive:true, groupPhaseActive:true, phaseOrder:'individual_first',
        maxIdeasIndividual:10, groupSize:1,
        individualGenerationDuration:300, individualSelectionDuration:300,
        groupIdeationDuration:300, groupVotingDuration:300, ...cfg },
      aiConfig: { individualAI:false, groupAI:false },
    }));
  }, cfg);
  const btn = t => p.getByRole('button', { name: t }).first();
  const clickIf = async (t, ms=500) => { const b = btn(t); if (await b.count() && await b.isVisible().catch(()=>false)) { await b.click(); await p.waitForTimeout(ms); return true; } return false; };
  await p.goto(B + 'session/PREVIEW/welcome?preview=1&key=stouras', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  await clickIf(/agree|continue/i, 1200);
  await clickIf(/skip/i, 900);
  await clickIf(/continue|submit|join|start/i, 1600);
  await clickIf(/^start$/i, 1200);
  return { p, clickIf };
}
async function writeIdeas(p, n) {
  const titles = [];
  for (let i = 1; i <= n; i++) {
    const t = `Idea ${String.fromCharCode(64 + i)}`;
    titles.push(t);
    await p.getByPlaceholder('Idea title').first().fill(t);
    await p.getByPlaceholder(/^Description/).first().fill(`description of ${t.toLowerCase()}`);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
  }
  return titles;
}
async function choose(p, titles) {
  for (const t of titles) { await p.locator('h3', { hasText: new RegExp(`^${t}$`) }).first().dblclick(); await p.waitForTimeout(350); }
}
// What the confirmation screen shows: the summary line and the badge per idea.
const readConfirmation = p => p.evaluate(TAG => {
  const body = document.body.innerText || '';
  // Each confirmation item is <div confirmItem><div confirmItemHead><h3/><span badge/></div>…</div>:
  // the badge is the h3's sibling inside the head row. (Not `h.closest(…)` —
  // the h3's own class name contains "confirmItem" and would match itself.)
  const cards = [...document.querySelectorAll('h3')].map(h => {
    const head = h.parentElement;
    const badge = head ? [...head.querySelectorAll('span')].map(s => s.textContent.trim()).find(t => /carried to group|computer selected/i.test(t)) : null;
    return { title: h.textContent.trim(), badge: badge || '' };
  }).filter(c => /^Idea [A-Z]$/.test(c.title));
  return { body, cards };
}, TAG);

try {
  /* ── A. 5 written, 1 chosen, cap 3 ──────────────────────────────────── */
  console.log('\n=== A. cap 3 · 5 ideas · 1 chosen ===');
  {
    const { p, clickIf } = await openIndividual({ ideasCarriedToGroup: 3 });
    const titles = await writeIdeas(p, 5);
    await clickIf(/Proceed to Selection/i, 900);
    const selText = await p.innerText('body');
    check('the selection stage says at least one is needed and the remaining places are filled at random', /choose at least one; if you choose fewer than 3, the computer fills the remaining places at random from your other ideas/i.test(selText));
    check('…and the note under the list says so too', /Choose at least one; if you choose fewer than 3, the computer fills the remaining places at random from your other ideas\./i.test(selText));
    check('no computer tag before submit', !selText.includes(TAG));
    await choose(p, [titles[3]]);   // "Idea D"
    check('1 / 3 selected', /Selected ideas:\s*1\s*\/\s*3/.test(await p.innerText('body')));
    await clickIf(/Finish & Submit/i, 2500);
    const c = await readConfirmation(p);
    check('the submission summary is shown', /Your ideas are submitted/i.test(c.body));
    check('it says 3 carry: 1 chosen + 2 by the computer', c.body.includes('3 ideas carry into the group phase: 1 you chose and 2 the computer selected at random.'), (c.body.match(/You submitted[^\n]*/) || [''])[0]);
    const own = c.cards.filter(x => /^carried to group$/i.test(x.badge));
    const auto = c.cards.filter(x => x.badge === TAG);
    check('the chosen idea is badged "Carried to group"', own.length === 1 && own[0].title === 'Idea D', JSON.stringify(c.cards));
    check(`two OTHER ideas are badged "${TAG}"`, auto.length === 2 && auto.every(x => x.title !== 'Idea D'), JSON.stringify(c.cards));
    check('the remaining two carry no badge', c.cards.filter(x => !x.badge).length === 2);
    const carriedA = new Set([...own, ...auto].map(x => x.title));
    docCheck('A', await readDocs(p), own.map(x => x.title), auto.map(x => x.title));
    await p.waitForTimeout(16000);
    check('it advanced to the group phase after the hold', /\/group/.test(p.url()), p.url());
    await clickIf(/^start$/i, 1500);
    const g = await p.evaluate(() => {
      const body = document.body.innerText || '';
      const titles = [...document.querySelectorAll('h3, h4')].map(h => h.textContent.trim()).filter(t => /^Idea [A-Z]$/.test(t));
      return { body, titles };
    });
    check('the group phase lists exactly the 3 carried ideas', g.titles.length === 3 && g.titles.every(t => carriedA.has(t)), g.titles.join(', '));
    check('the group phase shows the group no computer tag', !g.body.includes(TAG));
    await p.close();
  }

  /* ── B. 2 written, 1 chosen, cap 3 ──────────────────────────────────── */
  console.log('\n=== B. cap 3 · 2 ideas · 1 chosen ===');
  {
    const { p, clickIf } = await openIndividual({ ideasCarriedToGroup: 3 });
    const titles = await writeIdeas(p, 2);
    await clickIf(/Proceed to Selection/i, 900);
    await choose(p, [titles[0]]);
    await clickIf(/Finish & Submit/i, 2500);
    const c = await readConfirmation(p);
    check('both ideas carry, one by the computer', c.body.includes('2 ideas carry into the group phase: 1 you chose and 1 the computer selected at random.'), (c.body.match(/You submitted[^\n]*/) || [''])[0]);
    check('Idea A is the participant\'s, Idea B the computer\'s',
      c.cards.find(x => x.title === 'Idea A')?.badge.toLowerCase() === 'carried to group' && c.cards.find(x => x.title === 'Idea B')?.badge === TAG, JSON.stringify(c.cards));
    docCheck('B', await readDocs(p), ['Idea A'], ['Idea B']);
    await p.close();
  }

  /* ── C. 4 written, 3 chosen, cap 3 ──────────────────────────────────── */
  console.log('\n=== C. cap 3 · 4 ideas · 3 chosen ===');
  {
    const { p, clickIf } = await openIndividual({ ideasCarriedToGroup: 3 });
    const titles = await writeIdeas(p, 4);
    await clickIf(/Proceed to Selection/i, 900);
    await choose(p, titles.slice(0, 3));
    await clickIf(/Finish & Submit/i, 2500);
    const c = await readConfirmation(p);
    check('3 carry and nothing is added', c.body.includes('3 ideas carry into the group phase.') && !c.body.includes('computer'), (c.body.match(/You submitted[^\n]*/) || [''])[0]);
    check('no computer badge anywhere', c.cards.every(x => x.badge !== TAG) && c.cards.filter(x => /carried to group/i.test(x.badge)).length === 3, JSON.stringify(c.cards));
    docCheck('C', await readDocs(p), ['Idea A', 'Idea B', 'Idea C'], []);
    await p.close();
  }

  /* ── D. timer runs out with nothing chosen ───────────────────────────── */
  console.log('\n=== D. cap 2 · 3 ideas · none chosen · selection clock 3 s ===');
  {
    const { p, clickIf } = await openIndividual({ ideasCarriedToGroup: 2, individualSelectionDuration: 3 });
    await writeIdeas(p, 3);
    await clickIf(/Proceed to Selection/i, 600);
    const finish = p.getByRole('button', { name: /Finish & Submit/i }).first();
    check('Finish & Submit stays disabled with nothing chosen', await finish.isDisabled().catch(() => false));
    check('…and says why', (await finish.getAttribute('title')) === 'Choose at least one idea first');
    await p.waitForTimeout(6500);
    const c = await readConfirmation(p);
    check('the clock auto-submitted', /Your ideas are submitted/i.test(c.body), c.body.slice(0, 160));
    check('2 carry, both chosen by the computer, and the sentence says why', c.body.includes('2 ideas carry into the group phase, selected by the computer at random because you chose none.'), (c.body.match(/You submitted[^\n]*/) || [''])[0]);
    check('two computer badges, one idea left', c.cards.filter(x => x.badge === TAG).length === 2 && c.cards.filter(x => !x.badge).length === 1, JSON.stringify(c.cards));
    docCheck('D', await readDocs(p), [], c.cards.filter(x => x.badge === TAG).map(x => x.title));
    await p.close();
  }

  /* ── E. force-advanced before submitting ─────────────────────────────── */
  console.log('\n=== E. cap 3 · 4 ideas · 1 ticked · force-advanced without Finish & Submit ===');
  {
    const { p, clickIf } = await openIndividual({ ideasCarriedToGroup: 3 });
    const titles = await writeIdeas(p, 4);
    await clickIf(/Proceed to Selection/i, 900);
    await choose(p, [titles[1]]);   // "Idea B", persisted by toggleSelect
    const before = await readDocs(p);
    check('before the advance: only the ticked idea is on the documents', before.filter(d => d.selected).length === 1 && before.find(d => d.title === 'Idea B').selectedBy === 'participant', JSON.stringify(before));
    // The instructor's Advance, as the sandbox can express it: the participant's
    // status flips to 'group' with no submit and no individualComplete.
    await p.evaluate(() => window.__islPreview.setParticipant({ status: 'group' }));
    await p.waitForTimeout(2500);
    check('the participant lands on the group page', /\/group/.test(p.url()), p.url());
    const after = await readDocs(p);
    const auto = after.filter(d => d.selectedBy === 'computer').map(d => d.title);
    check('their own client wrote 2 computer picks back to the documents', auto.length === 2 && !auto.includes('Idea B'), JSON.stringify(after));
    docCheck('E', after, ['Idea B'], auto);
    await clickIf(/^start$/i, 1500);
    const g = await p.evaluate(() => {
      const body = document.body.innerText || '';
      const titles = [...document.querySelectorAll('h3, h4')].map(h => h.textContent.trim()).filter(t => /^Idea [A-Z]$/.test(t));
      return { body, titles };
    });
    check('the group page lists exactly those 3 ideas', g.titles.length === 3 && g.titles.includes('Idea B') && auto.every(t => g.titles.includes(t)), g.titles.join(', '));
    check('and shows the group no computer tag', !g.body.includes(TAG));
    // Nothing more is written once the picks are recorded (no write loop).
    await p.waitForTimeout(1500);
    const again = await readDocs(p);
    check('the documents are stable afterwards', JSON.stringify(again) === JSON.stringify(after));
    await p.close();
  }
} catch (e) {
  console.log('  [error]', e.message); fails++;
} finally {
  await br.close(); srv.close();
}
console.log(fails ? `\n${fails} check(s) FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
