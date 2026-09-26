/* ==========================================================================
   Capitals — browser smoke test (offline, Playwright Chromium; no network)
       node fun/capitals/tools/smoke.mjs

   Plays the real page from a local static server with every external host
   (Google Fonts, Firebase) aborted, and checks the things a player sees:
     1. a wrong answer — the COUNTRY's own name, or "constructor" — is refused
        and the question stays put;
     2. the capital is accepted, from the Check button AND from the Enter key,
        and the reveal is shown for THAT country (Enter must not also advance);
     3. Enter on the reveal advances exactly ONE country (the Next button and
        the document-level Enter used to both fire);
     4. Bolivia: "Bolivia" refused, "La Paz" accepted with the line
        "Your answer La Paz is also accepted." under "Sucre is the capital of
        Bolivia" — in both languages, surviving a language switch;
     5. "Show the answer" draws no such line;
     6. no uncaught page error anywhere in the run.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const b = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('x'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${srv.address().port}/fun/capitals/`;
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok — ' : '  FAIL — ') + m); if (!c) fails++; };

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await br.newContext({ viewport: { width: 1100, height: 900 } });
await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(String(e)));

const entryOf = (name) => pg.evaluate((n) => { const e = window.COUNTRIES.find((x) => x.c === n); const g = (window.COUNTRIES_EL || {})[n] || {}; return { c: e.c, cap: e.cap, alt: e.alt, cap_el: g.cap, region: e.region }; }, name);
const country = () => pg.locator('#qText .country').innerText();
const answer = async (text, viaEnter) => {
  await pg.fill('#answerInput', text);
  if (viaEnter) await pg.press('#answerInput', 'Enter'); else await pg.click('#submitBtn');
};
const revealVisible = () => pg.evaluate(() => !document.getElementById('reveal').classList.contains('hidden'));

await pg.goto(BASE, { waitUntil: 'domcontentloaded' });
await pg.waitForFunction(() => document.querySelector('#qText .country') && document.querySelector('#qText .country').textContent.trim().length > 0);
ok(await pg.evaluate(() => document.documentElement.lang) === 'en', 'page boots in English');

console.log('\n1. Wrong answers are refused');
let name = await country();
let e = await entryOf(name);
await answer(e.c, false);
ok(await pg.locator('#feedback').getAttribute('class') === 'feedback no', `"${e.c}" (the country) is refused for ${e.c}`);
ok(!(await revealVisible()) && (await country()) === name, 'question unchanged after a wrong answer');
await answer('constructor', true);
ok(await pg.locator('#feedback').getAttribute('class') === 'feedback no', '"constructor" is refused');
ok(!(await revealVisible()) && (await country()) === name, 'question unchanged after "constructor" + Enter');

console.log('\n2. The capital is accepted (Check button)');
await answer(e.cap, false);
ok(await revealVisible(), `reveal shown after "${e.cap}"`);
ok((await pg.locator('#capLine').innerText()).includes(e.cap), 'banner names the capital');
ok((await pg.locator('#capAlt').innerText()).trim() === '', 'no "also accepted" line for the capital itself');
ok((await pg.locator('#bannerLbl').innerText()).toLowerCase().startsWith('correct'), 'banner says Correct');
ok((await country()) === name, 'still the same country on the reveal');

console.log('\n3. Enter on the reveal advances exactly one country');
await pg.evaluate(() => { window.__q = []; new MutationObserver(() => window.__q.push(document.querySelector('#qText .country').textContent)).observe(document.getElementById('qText'), { childList: true, subtree: true, characterData: true }); });
await pg.keyboard.press('Enter');
await pg.waitForTimeout(150);
const seen = await pg.evaluate(() => Array.from(new Set(window.__q)));
ok(!(await revealVisible()), 'reveal hidden, new question shown');
ok(seen.length === 1, `exactly one new country (saw ${JSON.stringify(seen)})`);

console.log('\n4. The capital is accepted (Enter key) and the reveal stays');
name = await country();
e = await entryOf(name);
await answer(e.cap, true);
await pg.waitForTimeout(100);
ok(await revealVisible(), `reveal shown after "${e.cap}" + Enter`);
ok((await country()) === name, 'Enter did not also advance to the next country');
await pg.click('#nextBtn');
ok(!(await revealVisible()) && (await country()) !== name, 'Next button advances');

console.log('\n5. Bolivia: La Paz is accepted and SAID to be an alternative');
await pg.selectOption('#regionSel', 'South America');
let tries = 0;
while ((await country()) !== 'Bolivia' && tries++ < 200) {
  // skip a country: show its answer, then move on (Next is only visible on the reveal)
  if (!(await revealVisible())) await pg.click('#revealBtn', { timeout: 2000 });
  await pg.click('#nextBtn', { timeout: 2000 });
}
ok((await country()) === 'Bolivia', `reached Bolivia after ${tries} skips`);
if ((await country()) === 'Bolivia') {
  await answer('Bolivia', false);
  ok(await pg.locator('#feedback').getAttribute('class') === 'feedback no', '"Bolivia" refused');
  await answer('Santa Cruz', false);
  ok(await pg.locator('#feedback').getAttribute('class') === 'feedback no', '"Santa Cruz" refused');
  await answer('la paz', true);
  ok(await revealVisible(), '"la paz" accepted');
  const line = await pg.locator('#capLine').innerText();
  const note = await pg.locator('#capAlt').innerText();
  ok(line.includes('Sucre'), 'banner: Sucre is the capital of Bolivia');
  ok(/La Paz/.test(note) && /also accepted/.test(note), `note under it: "${note}"`);
  ok(await pg.evaluate(() => getComputedStyle(document.getElementById('capAlt')).display !== 'none'), 'note is visible');
  await pg.click('#langEl');
  const noteEl = await pg.locator('#capAlt').innerText();
  ok(/La Paz/.test(noteEl) && /δεκτή/.test(noteEl) && (await pg.locator('#capLine').innerText()).includes('Σούκρε'), `note survives the switch to Greek: "${noteEl}"`);
  await pg.click('#langEn');
  ok(/also accepted/.test(await pg.locator('#capAlt').innerText()), 'and back to English');
  await pg.click('#nextBtn');
}

console.log('\n6. A small misspelling is accepted AND pointed out');
tries = 0;
let cap = '';
while (tries++ < 200) {
  if (await revealVisible()) await pg.click('#nextBtn', { timeout: 2000 });
  cap = (await entryOf(await country())).cap;
  if (cap.replace(/[^A-Za-z]/g, '').length >= 6) break;
  await pg.click('#revealBtn', { timeout: 2000 });
}
{
  const i = Math.floor(cap.length / 2);
  const typo = cap.slice(0, i) + (cap[i].toLowerCase() === 'x' ? 'q' : 'x') + cap.slice(i + 1);
  await answer(typo, true);
  ok(await revealVisible(), `"${typo}" accepted for ${await country()}`);
  const note = await pg.locator('#capAlt .typo').innerText().catch(() => '');
  ok(note.includes(typo) && note.includes(cap) && /misspelling/i.test(note), `misspelling pointed out: "${note}"`);
  ok((await pg.locator('#bannerLbl').innerText()).toLowerCase().startsWith('correct'), 'still counted as correct');
  await pg.click('#langEl');
  ok(/ορθογραφικό/.test(await pg.locator('#capAlt .typo').innerText()), 'the note is translated on a language switch');
  await pg.click('#langEn');
  await pg.click('#nextBtn');
}

console.log('\n6b. The country profile under the facts');
await pg.waitForFunction(() => !!window.CAPITALS_PROFILES_EN, null, { timeout: 5000 }).catch(() => {});
const haveProfiles = await pg.evaluate(() => !!window.CAPITALS_PROFILES_EN);
if (!haveProfiles) {
  ok(true, 'profiles.en.js not built yet: the section must simply stay hidden');
}
await pg.click('#revealBtn');
if (haveProfiles) {
  const rows = await pg.locator('#profileList dt').count();
  ok(rows === 5, `five profile rows (${rows})`);
  ok(await pg.evaluate(() => getComputedStyle(document.getElementById('profile')).display !== 'none'), 'profile section visible');
  const text = await pg.locator('#profileList').innerText();
  ok(/Known for/.test(text) && /History/.test(text), 'English labels');
  await pg.click('#langEl');
  await pg.waitForFunction(() => !!window.CAPITALS_PROFILES_EL, null, { timeout: 5000 }).catch(() => {});
  await pg.waitForTimeout(200);
  const el = await pg.locator('#profileList').innerText();
  ok(/Γνωστή για/.test(el) && /[α-ω]{4}/.test(el.split('\n')[1] || ''), 'switching to Greek loads and shows the Greek profile');
  await pg.click('#langEn');
} else {
  ok(await pg.evaluate(() => getComputedStyle(document.getElementById('profile')).display === 'none'), 'no profile data: section not displayed (computed style, not just the class)');
}
await pg.click('#nextBtn');

console.log('\n6c. "Show the answer" draws no "also accepted" line');
await pg.click('#revealBtn');
ok(await revealVisible(), 'answer shown');
ok((await pg.locator('#capAlt').innerText()).trim() === '', 'no note after a reveal');
ok(await pg.evaluate(() => getComputedStyle(document.getElementById('capAlt')).display === 'none'), 'the empty note takes no space');

console.log('\n6d. Greek on screen, the capital typed in English: correct, with no note');
if (await revealVisible()) await pg.click('#nextBtn');
await pg.click('#langEl');
{
  const g = await pg.evaluate(() => document.querySelector('#qText .country').textContent);
  const e = await pg.evaluate((gname) => { const G = window.COUNTRIES_EL; const k = Object.keys(G).find((n) => G[n].c === gname); const en = window.COUNTRIES.find((x) => x.c === k); return { c: k, cap: en.cap, capEl: G[k].cap }; }, g);
  await answer(e.cap, true);
  ok(await revealVisible(), `Greek question "${g}", English answer "${e.cap}" is accepted`);
  ok((await pg.locator('#capLine').innerText()).includes(e.capEl), `the banner names the capital in Greek (${e.capEl})`);
  ok((await pg.locator('#capAlt').innerText()).trim() === '', 'no misspelling or "also accepted" note: it is simply right');
  ok(/Σωστά/.test(await pg.locator('#bannerLbl').textContent()), 'the banner says Σωστά (correct)');
  await pg.click('#nextBtn');
  const g2 = await pg.evaluate(() => document.querySelector('#qText .country').textContent);
  const e2 = await pg.evaluate((gname) => { const G = window.COUNTRIES_EL; const k = Object.keys(G).find((n) => G[n].c === gname); return { capEl: G[k].cap }; }, g2);
  await answer(e2.capEl, true);
  ok(await revealVisible(), `and the Greek answer "${e2.capEl}" is accepted too`);
  await pg.click('#nextBtn');
}
await pg.click('#langEn');

console.log('\n7. No page errors');
ok(errors.length === 0, errors.length ? 'page errors: ' + errors.join(' | ') : 'none');

await br.close(); srv.close();
console.log('\n' + (fails ? `FAILED — ${fails} check(s)` : 'OK — smoke passed'));
process.exit(fails ? 1 : 0);
