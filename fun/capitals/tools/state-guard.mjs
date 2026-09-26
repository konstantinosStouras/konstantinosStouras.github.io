/* ==========================================================================
   Capitals: game state, persistence and keyboard guard (offline, Playwright)
       node fun/capitals/tools/state-guard.mjs

   Each check is a defect a review found and reproduced on the real page:
     1. two tabs no longer erase each other's progress (or a profile);
     2. a nickname like "constructor" or "__proto__" no longer crashes the game;
     3. a stored profile missing fields (older version, cut-short save) plays;
     4. a reload re-asks the unanswered question instead of skipping it free;
     5. changing region with an unanswered question ends the streak;
     6. signing in keeps the question on screen (typed text included);
     7. Enter after a language flag moves on; Enter on a link opens the link;
     8. the feedback line follows a language switch;
     9. the letter-count hint does not count punctuation;
    10. the 14-day chart keeps the day the clocks go forward (Europe/Dublin);
    11. a guest never sees a real player called "Guest" marked as "you";
    12. the leaderboard's streak column is labelled as the BEST streak;
    13. "hidden" really hides (profile block, "No players yet", nickname wall);
    14. after a correct answer the verdict stays on screen, even with a long
        country profile below it;
    15. worldwide rows cannot inject markup; ties share a rank;
    16. the verdict reaches screen readers;
    17. long one-word capitals do not push the page sideways on a 320px phone;
    18. Enter behind the Log in dialog does nothing; the map says when it does
        not draw a country (Kosovo) rather than calling it too small;
    19. Greek plurals and tooltips;
    20. the header keeps one row count across languages at every width.
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
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('x'); }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${srv.address().port}/fun/capitals/`;
const KEY = 'capitals:v1:profiles';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok — ' : '  FAIL — ') + m); if (!c) fails++; };
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });

async function context(opts = {}) {
  const ctx = await br.newContext({ viewport: { width: 1100, height: 900 }, ...opts });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  return ctx;
}
async function open(ctx, init) {
  const pg = await ctx.newPage();
  pg.errors = []; pg.on('pageerror', (e) => pg.errors.push(String(e)));
  if (init) await pg.addInitScript(init);
  await pg.goto(URL_, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.querySelector('#qText .country') && document.querySelector('#qText .country').textContent.trim());
  return pg;
}
const country = (pg) => pg.locator('#qText .country').innerText();
// the question shows the English OR the Greek country name, depending on the language on screen
const capOf = (pg, c) => pg.evaluate((n) => { const G = window.COUNTRIES_EL || {}; const k = window.COUNTRIES.find((x) => x.c === n) ? n : Object.keys(G).find((e) => G[e].c === n); return window.COUNTRIES.find((x) => x.c === k).cap; }, c);
async function answerRight(pg) { const c = await country(pg); await pg.fill('#answerInput', await capOf(pg, c)); await pg.press('#answerInput', 'Enter'); await pg.click('#nextBtn'); }
const stored = (pg) => pg.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), KEY);
const seed = (profiles) => `localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(JSON.stringify(profiles))});`;
const guest = (extra) => ({ __guest__: Object.assign({ nick: 'Guest', guest: true, createdAt: Date.now(), lastSeen: Date.now(), answered: 0, correct: 0, revealed: 0, noHintCorrect: 0, hintCorrect: 0, wrongGuesses: 0, points: 0, currentStreak: 0, bestStreak: 0, byCountry: {}, history: [], pending: null }, extra || {}) });

console.log('1. Two tabs');
{
  const ctx = await context();
  const a = await open(ctx), b = await open(ctx);
  for (let i = 0; i < 3; i++) await answerRight(a);
  for (let i = 0; i < 2; i++) await answerRight(b);
  const s = await stored(a);
  ok(s.__guest__.answered === 5, `both tabs' answers are kept (answered ${s.__guest__.answered} of 5)`);
  await a.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: 'Alex' } })));
  await answerRight(a);
  await answerRight(b);
  const s2 = await stored(a);
  ok(!!s2.alex && s2.alex.answered === 1, 'a profile created in one tab survives an answer in the other');
  ok(a.errors.length + b.errors.length === 0, 'no page errors');
  await ctx.close();
}

console.log('\n2. Nicknames that are Object members');
for (const nick of ['Constructor', '__proto__', 'toString']) {
  const ctx = await context();
  const pg = await open(ctx);
  await pg.evaluate((n) => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: n } })), nick);
  await answerRight(pg);
  const polluted = await pg.evaluate(() => ({}).nick !== undefined || Object.nick !== undefined);
  ok(pg.errors.length === 0 && !polluted, `"${nick}" plays with no error and pollutes nothing`);
  await ctx.close();
}

console.log('\n3. A stored profile missing fields');
{
  const ctx = await context();
  const broken = { __guest__: { nick: 'Guest', guest: true, answered: 3 } };   // no history, no byCountry, no points
  const pg = await open(ctx, seed(broken));
  await answerRight(pg);
  const s = await stored(pg);
  ok(pg.errors.length === 0 && s.__guest__.answered === 4 && Array.isArray(s.__guest__.history), 'plays on, keeps what was there (answered 3 -> 4), fills the rest');
  await ctx.close();
  const ctx2 = await context();
  const pg2 = await open(ctx2, seed([]));
  await answerRight(pg2);
  const s2 = await stored(pg2);
  ok(pg2.errors.length === 0 && s2 && s2.__guest__ && s2.__guest__.answered === 1, 'a stored [] no longer stops every save');
  await ctx2.close();
}

console.log('\n4. A reload re-asks the unanswered question');
{
  const ctx = await context();
  const pg = await open(ctx);
  const first = await country(pg);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.querySelector('#qText .country').textContent.trim());
  ok((await country(pg)) === first, `same question after a reload (${first})`);
  await answerRight(pg);
  const next = await country(pg);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.querySelector('#qText .country').textContent.trim());
  ok((await country(pg)) === next, 'and after answering, the NEXT question is the one remembered');
  await ctx.close();
}

console.log('\n5. Changing region with an unanswered question ends the streak');
{
  const ctx = await context();
  const pg = await open(ctx);
  await answerRight(pg); await answerRight(pg);
  ok((await pg.textContent('#streakVal')) === '2', 'streak 2');
  await pg.selectOption('#regionSel', 'Europe');
  ok((await pg.textContent('#streakVal')) === '0', 'region change on an unanswered question: streak 0');
  await answerRight(pg);
  await pg.click('#revealBtn').catch(() => {});
  await ctx.close();
}

console.log('\n6. Signing in keeps the question on screen');
{
  const ctx = await context();
  const pg = await open(ctx);
  const c = await country(pg);
  await pg.fill('#answerInput', 'half-typ');
  await pg.click('#hintBtn');
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'm@x', nickname: 'Maria' } })));
  ok((await country(pg)) === c && (await pg.inputValue('#answerInput')) === 'half-typ', 'same country, typed text kept');
  ok((await pg.locator('#mask .tile').count()) > 0, 'the hint on screen is kept');
  await pg.click('#statsBtn');
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'y', email: 'n@x', nickname: 'Nikos' } })));
  ok((await pg.textContent('#statsNick')) === 'Nikos', 'an open My-progress panel follows the account');
  await ctx.close();
}

console.log('\n7. Enter after a language flag, and on a link');
{
  const ctx = await context();
  const pg = await open(ctx);
  const c = await country(pg);
  await pg.fill('#answerInput', await capOf(pg, c));
  await pg.press('#answerInput', 'Enter');
  await pg.click('#langEl');
  await pg.keyboard.press('Enter');
  ok((await country(pg)) !== c, 'Enter after clicking the language flag moves on');
  await pg.click('#langEn');
  const c2 = await country(pg);
  await pg.fill('#answerInput', await capOf(pg, c2));
  await pg.press('#answerInput', 'Enter');
  const link = pg.locator('footer a[href]').first();
  if (await link.count()) {
    const popup = pg.waitForEvent('popup', { timeout: 2000 }).catch(() => null);
    await link.focus(); await pg.keyboard.press('Enter');
    const pop = await popup;
    ok((await country(pg)) === c2, 'Enter on a footer link during the answer does not skip the question');
    if (pop) await pop.close();
  }
  await ctx.close();
}

console.log('\n8. The feedback line follows a language switch');
{
  const ctx = await context();
  const pg = await open(ctx);
  await pg.fill('#answerInput', 'Zzzzqq'); await pg.press('#answerInput', 'Enter');
  await pg.click('#langEl');
  ok(/Δοκίμασε/.test(await pg.textContent('#feedback')), 'wrong-answer line is re-translated to Greek');
  await pg.click('#hintBtn');
  await pg.click('#langEn');
  ok(/Hint/.test(await pg.textContent('#feedback')), 'hint line is re-translated to English');
  await ctx.close();
}

console.log('\n9. Letter count ignores punctuation');
{
  const ctx = await context();
  const pg = await open(ctx, seed(guest({ pending: 'United States' })));
  ok((await country(pg)) === 'United States', 'question is the United States (resumed)');
  await pg.click('#hintBtn');
  ok(/12 letters/.test(await pg.textContent('#maskNote')), '"Washington, D.C." has 12 letters (' + (await pg.textContent('#maskNote')) + ')');
  await ctx.close();
}

console.log('\n10. The 14-day chart keeps the day the clocks go forward');
{
  const ctx = await context({ timezoneId: 'Europe/Dublin' });
  const t0 = new Date('2027-04-02T12:00:00+01:00').getTime();
  const onDst = new Date('2027-03-28T15:00:00+01:00').getTime();
  const pg = await ctx.newPage();
  await pg.clock.setFixedTime(t0);
  await pg.addInitScript(seed(guest({ history: [{ t: onDst, c: 'France', r: 'correct', h: 0 }, { t: onDst + 60000, c: 'Spain', r: 'correct', h: 0 }] })));
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await pg.goto(URL_, { waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.querySelector('#qText .country').textContent.trim());
  await pg.click('#statsBtn');
  const labels = await pg.$$eval('#bars .tip', (xs) => xs.map((x) => x.textContent).join(' '));
  ok(/\b28\b/.test(labels) && labels.split(' ').length === 14, 'the chart shows 28 March (' + labels + ')');
  ok(/2 questions/.test(await pg.textContent('#barsLegend')), 'and counts its answers (' + (await pg.textContent('#barsLegend')) + ')');
  await ctx.close();
}

console.log('\n11. A guest is never "you" on the global board');
{
  const ctx = await context();
  const pg = await open(ctx, `window.CapitalsLeaderboard = { scope: 'global', submit() {}, subscribe(cb) { cb([{ key: 'guest', name: 'Guest', points: 50, accuracy: 100, answered: 1, mastered: 1, streak: 1 }]); } };`);
  await pg.click('#boardBtn');
  ok((await pg.locator('#boardBody tr.me').count()) === 0, 'a real player named Guest is not highlighted as the guest');
  await ctx.close();
}

console.log('\n12. Labels');
{
  const ctx = await context();
  const pg = await open(ctx);
  ok((await pg.$$eval('table.board th', (xs) => xs.map((x) => x.textContent).join('|'))).includes('Best streak'), 'the board column reads "Best streak"');
  ok(pg.errors.length === 0, 'no page errors');
  await ctx.close();
}

console.log('\n13. Hidden really means hidden');
{
  const ctx = await context();
  const pg = await open(ctx);
  ok(await pg.evaluate(() => getComputedStyle(document.getElementById('nickOverlay')).display === 'none'), 'the retired nickname wall is not shown on load');
  await pg.click('#revealBtn');
  const prof = await pg.evaluate(() => ({ d: getComputedStyle(document.getElementById('profile')).display, rows: document.querySelectorAll('#profileList dt').length }));
  ok(prof.rows > 0 ? prof.d !== 'none' : prof.d === 'none', 'the Country profile block shows only with content (rows ' + prof.rows + ', display ' + prof.d + ')');
  await pg.click('#nextBtn');
  await answerRight(pg);
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: 'Ana' } })));
  await answerRight(pg);
  await pg.click('#boardBtn');
  ok(await pg.evaluate(() => getComputedStyle(document.getElementById('boardEmpty')).display === 'none' && document.querySelectorAll('#boardBody tr').length > 0), '"No players yet" is hidden under a board with players');
  await ctx.close();
}

console.log('\n14. The verdict stays in view after a correct answer (long country profile)');
for (const [w, h] of [[1100, 900], [375, 667]]) {
  const ctx = await context({ viewport: { width: w, height: h } });
  const long = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(4);
  const pg = await open(ctx, `window.CAPITALS_PROFILES_EN = new Proxy({}, { get: function () { return { known: ${JSON.stringify(long)}, economy: ${JSON.stringify(long)}, business: ${JSON.stringify(long)}, tourism: ${JSON.stringify(long)}, history: ${JSON.stringify(long)} }; } });`);
  await answerRight(pg);
  const c = await country(pg);
  await pg.fill('#answerInput', (await capOf(pg, c)).replace(/.(.)$/, 'x$1'));
  await pg.press('#answerInput', 'Enter');
  const box = await pg.evaluate(() => { const r = document.getElementById('answerBanner').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, active: document.activeElement.id }; });
  ok(box.top >= 0 && box.bottom <= box.vh && box.active === 'nextBtn', w + 'px: the banner is on screen (top ' + Math.round(box.top) + ', bottom ' + Math.round(box.bottom) + ' of ' + box.vh + ') and Next has focus');
  await pg.keyboard.press('Enter');
  ok((await country(pg)) !== c, w + 'px: Enter still moves on');
  await ctx.close();
}

console.log('\n15. Worldwide rows cannot inject markup; ties share a rank; the empty board says so');
{
  const ctx = await context();
  const rows = [
    { key: 'eve', name: '<img src=x onerror="window.__xssName=1">', points: 10, accuracy: '<img src=x onerror="window.__xssAcc=1">', answered: '<b id=injected>boom</b>', mastered: 1, streak: 1 },
    { key: 'tiea', name: 'TieA', points: 500, accuracy: 90, answered: 10, mastered: 3, streak: 4 },
    { key: 'tieb', name: 'TieB', points: 500, accuracy: 90, answered: 10, mastered: 3, streak: 4 },
    { key: 'top', name: 'Top', points: 900, accuracy: 95, answered: 12, mastered: 5, streak: 6 },
  ];
  const pg = await open(ctx, `window.CapitalsLeaderboard = { scope: 'global', submit() {}, subscribe(cb) { cb(${JSON.stringify(rows)}); } };`);
  await pg.click('#boardBtn');
  await pg.waitForTimeout(200);
  const r = await pg.evaluate(() => ({ acc: !!window.__xssAcc, name: !!window.__xssName, inj: !!document.getElementById('injected'),
    ranks: Array.from(document.querySelectorAll('#boardBody tr')).map((tr) => tr.querySelector('td').textContent + ':' + tr.querySelector('td.name').textContent) }));
  ok(!r.acc && !r.name && !r.inj, 'no markup from a worldwide row runs or renders');
  ok(r.ranks.join(',') === '1:Top,2:TieA,2:TieB,4:<img src=x onerror="window.__xssName=1">', 'tied players share rank 2, the next is 4 (' + r.ranks.join(', ') + ')');
  await ctx.close();
  const ctx2 = await context();
  const pg2 = await open(ctx2, `window.CapitalsLeaderboard = { scope: 'global', submit() {}, subscribe(cb) { cb([]); } };`);
  await pg2.click('#boardBtn');
  ok(/No one has played yet/.test(await pg2.textContent('#boardSub')), 'an empty worldwide board does not say "on this device"');
  await ctx2.close();
}

console.log('\n16. Accessibility');
{
  const ctx = await context();
  const pg = await open(ctx);
  const a = await pg.evaluate(() => ({ fb: document.getElementById('feedback').getAttribute('aria-live'), fbRole: document.getElementById('feedback').getAttribute('role'),
    input: document.getElementById('answerInput').getAttribute('aria-describedby'), next: document.getElementById('nextBtn').getAttribute('aria-describedby') }));
  ok(a.fb === 'polite' && a.fbRole === 'status', 'the feedback line is a polite live region');
  ok(a.input === 'qText', 'the answer box is described by the question');
  ok(a.next === 'bannerLbl capLine capAlt', 'Next reads out the verdict and the notes');
  await ctx.close();
}

console.log('\n17. Long one-word capitals do not push the page sideways on phones');
for (const c of ['Haiti', 'Madagascar', 'Burkina Faso', 'Honduras']) {
  for (const l of ['en', 'el']) {
    const ctx = await context({ viewport: { width: 320, height: 640 }, isMobile: true });
    const pg = await open(ctx, seed(guest({ pending: c })) + ` localStorage.setItem('capitals:v1:lang', '${l}');`);
    await pg.click('#hintBtn');
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    ok(sw, c + ' (' + l + ') at 320px: the hint tiles stay inside the page');
    await ctx.close();
  }
}

console.log('\n18. The account dialog blocks Enter; the map explains countries it does not draw');
{
  const ctx = await context();
  const pg = await open(ctx, seed(guest({ pending: 'Kosovo' })));
  await pg.waitForFunction(() => window.Account && window.Account.ready, null, { timeout: 8000 });
  await pg.click('#revealBtn');
  await pg.waitForFunction(() => document.getElementById('mapNote').textContent.trim().length > 0, null, { timeout: 8000 }).catch(() => {});
  ok(/Not shown separately/.test(await pg.textContent('#mapNote')), 'Kosovo: "Not shown separately on this map", not "too small" (' + (await pg.textContent('#mapNote')) + ')');
  const c = await country(pg);
  await pg.evaluate(() => window.Account.openLogin());
  await pg.click('#acctRoot .acct-sub');
  await pg.keyboard.press('Enter');
  ok((await country(pg)) === c, 'Enter while the Log in dialog is open does not move the quiz on');
  await ctx.close();
}

console.log('\n19. Greek plurals');
{
  const ctx = await context();
  const pg = await open(ctx, `localStorage.setItem('capitals:v1:lang', 'el');`);
  await answerRight(pg);
  await pg.click('#revealBtn');
  await pg.click('#nextBtn');
  await pg.click('#statsBtn');
  ok(/^2 ερωτήσεις/.test(await pg.textContent('#barsLegend')), 'plural legend in Greek');
  const tip = await pg.$$eval('#bars .bar', (b) => b.map((x) => x.title).filter((t) => /απαντ/.test(t)));
  ok(tip.length === 14 && tip.some((t) => /2 απαντήσεις/.test(t)), 'the chart tooltips are in Greek (' + tip.filter((t) => !/^0/.test(t)).join(', ') + ')');
  await ctx.close();
}

console.log('\n20. Header: same number of rows in both languages (formerly broken widths)');
{
  const ctx = await context();
  const pg = await open(ctx);
  const bad = [];
  for (const w of [320, 329, 330, 340, 360, 361, 400, 475, 480, 485, 491, 492, 493, 600, 720, 721, 730, 743, 744, 745, 800, 1100]) {
    await pg.setViewportSize({ width: w, height: 800 });
    await pg.click('#langEn'); const en = await pg.evaluate(() => Math.round(document.querySelector('header.app').getBoundingClientRect().height));
    await pg.click('#langEl'); const el = await pg.evaluate(() => Math.round(document.querySelector('header.app').getBoundingClientRect().height));
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (en !== el || sw) bad.push(w + ':' + en + '/' + el + (sw ? ' hscroll' : ''));
  }
  ok(bad.length === 0, 'header height equal in English and Greek, no sideways scroll' + (bad.length ? ' — differs at ' + bad.join(' ') : ''));
  await ctx.close();
}

await br.close(); srv.close();
console.log('\n' + (fails ? `FAILED — ${fails} check(s)` : 'OK — state guard passed'));
process.exit(fails ? 1 : 0);
