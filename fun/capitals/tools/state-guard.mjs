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
    20. the header keeps one row count across languages at every width;
 21-24. account menu, phones and long nicknames;
    25. phones: the leaderboard fits, its table scrolls inside it;
    26. a panel taller than the screen scrolls;
    27. a hint's result is brought into view (and no keyboard over it);
    28. a wrong answer's shake does not replay on later questions;
    29. a guest is told why they are not on the leaderboard;
    30. registering keeps this session's guest progress;
    31. two tabs cannot score one question twice;
    32. the Region choice survives a reload;
    33. dialogs take focus, keep Tab inside and never stack;
    34. the map marker lands on the country (and Fiji says it is not drawn);
    35. English sentences say "the Netherlands"; Greek tooltips;
    36. a long nickname keeps its "you" tag;
    37. no country is asked twice in one visit until the Region's round is done;
    38. Learn shows study cards that score nothing;
    39. a test asks each learned country once and ends on a summary;
    40. Learn and a test in progress survive a reload;
    41. Learn, the test and its summary follow the language.
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
// the stored (English) name of the country asked, whatever the sentence on screen says
const country = (pg) => pg.evaluate(() => document.getElementById('qText').getAttribute('data-c'));
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
  // Alex is new on this device, so the account starts with the guest's five answers
  // (+1), and the guest starts afresh; the other tab, still a guest, answers once.
  ok(!!s2.alex && s2.alex.answered === 6, 'a profile created in one tab survives an answer in the other, with the guest progress it took over (' + (s2.alex && s2.alex.answered) + ' of 6)');
  ok(s2.__guest__.answered === 1, 'the guest the progress moved out of starts afresh (' + s2.__guest__.answered + ')');
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
  // Argentina: a long capital, so the one-letter slip below is always tolerated
  // (a random country with a 3-letter capital allows no slip, and the test flaked).
  const pg = await open(ctx, seed(guest({ pending: 'Argentina' })) + `window.CAPITALS_PROFILES_EN = new Proxy({}, { get: function () { return { known: ${JSON.stringify(long)}, economy: ${JSON.stringify(long)}, business: ${JSON.stringify(long)}, tourism: ${JSON.stringify(long)}, history: ${JSON.stringify(long)} }; } });`);
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

console.log('\n21. A signed-in reload re-asks the ACCOUNT\'s own question, and cannot farm points');
{
  const ctx = await context();
  const signIn = (pg) => pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: 'Alex' } })));
  const pg = await open(ctx);
  await signIn(pg);
  await answerRight(pg); await answerRight(pg);
  const left = await country(pg);                              // Alex leaves this one unanswered
  const before = (await stored(pg)).alex.points;
  await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForFunction(() => document.querySelector('#qText .country').textContent.trim());
  await signIn(pg);
  ok((await country(pg)) === left, 'after a reload the account is asked its own unanswered question (' + left + ')');
  const seen = new Set();
  for (let i = 0; i < 4; i++) {                                 // answer, reload, sign in: every visit a NEW question
    const c = await country(pg); seen.add(c);
    await pg.fill('#answerInput', await capOf(pg, c)); await pg.press('#answerInput', 'Enter');
    await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForFunction(() => document.querySelector('#qText .country').textContent.trim());
    await signIn(pg);
  }
  const after = (await stored(pg)).alex;
  ok(seen.size === 4 && after.points === before + 400, 'four reload cycles asked four different countries, +100 each (' + [...seen].join(', ') + ')');
  await ctx.close();
}

console.log('\n22. Hints taken stay taken after a reload');
{
  const ctx = await context();
  const pg = await open(ctx);
  const c = await country(pg);
  await pg.click('#hintBtn'); await pg.click('#hintBtn');
  await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForFunction(() => document.querySelector('#qText .country').textContent.trim());
  ok((await country(pg)) === c && (await pg.locator('#mask .tile').count()) > 0 && /Hint 3/.test(await pg.textContent('#hintBtn')), 'same question, the letters still shown, the next hint is Hint 3');
  await pg.fill('#answerInput', await capOf(pg, c)); await pg.press('#answerInput', 'Enter');
  ok(/with hints/.test(await pg.textContent('#bannerLbl')) && (await pg.textContent('#awardPts')) === '+30', 'and it scores as answered with hints (+30), not a no-hint +100');
  await ctx.close();
}

console.log('\n23. Blocked storage: progress is kept for the session across sign-in and sign-out');
{
  const ctx = await context();
  const pg = await open(ctx, `Storage.prototype.setItem = function () { throw new Error('blocked'); };`);
  await answerRight(pg); await answerRight(pg);
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: 'Alex' } })));
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: null })));
  await pg.click('#statsBtn');
  ok((await pg.textContent('#sAnswered')) === '2', 'the guest\'s 2 answers are still there (' + (await pg.textContent('#sAnswered')) + ')');
  await ctx.close();
}

console.log('\n24. Phones: the account menu opens under its button; a long nickname does not change the header');
{
  const ctx = await context({ viewport: { width: 390, height: 800 } });
  const pg = await open(ctx);
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: 'Maria' } })));
  await pg.click('#whoPill');
  const r = await pg.evaluate(() => { const a = document.getElementById('whoPill').getBoundingClientRect(), m = document.getElementById('accountMenu').getBoundingClientRect(); return { pl: a.left, pr: a.right, ml: m.left, mr: m.right }; });
  ok(r.ml <= r.pl + 1 && r.mr >= r.pr - 1, 'at 390px the menu opens under the pill (pill ' + Math.round(r.pl) + '-' + Math.round(r.pr) + ', menu ' + Math.round(r.ml) + '-' + Math.round(r.mr) + ')');
  await ctx.close();
  const ctx2 = await context();
  const pg2 = await open(ctx2);
  await pg2.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: 'Konstantinos1234' } })));
  const bad = [];
  for (const w of [480, 497, 498, 556, 557, 600, 720, 745, 748, 800]) {
    await pg2.setViewportSize({ width: w, height: 800 });
    await pg2.click('#langEn'); const en = await pg2.evaluate(() => Math.round(document.querySelector('header.app').getBoundingClientRect().height));
    await pg2.click('#langEl'); const el = await pg2.evaluate(() => Math.round(document.querySelector('header.app').getBoundingClientRect().height));
    if (en !== el) bad.push(w + ':' + en + '/' + el);
  }
  ok(bad.length === 0, 'signed in as a 16-letter nickname: header rows equal in both languages' + (bad.length ? ' — differs at ' + bad.join(' ') : ''));
  await ctx2.close();
}

console.log('\n25. Phones: the leaderboard fits the screen, its table scrolls inside it');
{
  const many = {};
  for (let i = 0; i < 12; i++) many['player' + i] = Object.assign({}, guest().__guest__, { nick: 'LongPlayerName' + i, guest: false, answered: 20 + i, correct: 15, points: 1000 * i, bestStreak: i });
  for (const [w, h] of [[320, 640], [390, 844]]) {
    const ctx = await context({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    const pg = await open(ctx, seed(Object.assign(many, guest())));
    await pg.click('#boardBtn');
    const r = await pg.evaluate(() => {
      const m = document.querySelector('#boardOverlay .modal').getBoundingClientRect(), x = document.getElementById('boardClose').getBoundingClientRect();
      const sc = document.querySelector('#boardOverlay .board-scroll');
      return { mr: m.right, xr: x.right, iw: innerWidth, sw: sc.scrollWidth, cw: sc.clientWidth, page: document.documentElement.scrollWidth };
    });
    ok(r.mr <= r.iw && r.xr <= r.iw, w + 'px: the panel and its close button are on screen (panel right ' + Math.round(r.mr) + ', × ' + Math.round(r.xr) + ', screen ' + r.iw + ')');
    ok(r.sw > r.cw, w + 'px: the table scrolls sideways inside the panel (' + r.sw + ' > ' + r.cw + ')');
    await pg.click('#boardClose');
    ok(await pg.evaluate(() => document.getElementById('boardOverlay').classList.contains('hidden')), w + 'px: the close button closes it');
    await ctx.close();
  }
}

console.log('\n26. Small phones and landscape: a panel taller than the screen scrolls');
for (const [w, h] of [[320, 640], [844, 390]]) {
  const ctx = await context({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  const pg = await open(ctx);
  await pg.click('#statsBtn');
  const r = await pg.evaluate(() => { const o = document.getElementById('statsOverlay'); o.scrollTop = o.scrollHeight; const b = document.getElementById('resetBtn').getBoundingClientRect(); return { sh: o.scrollHeight, ch: o.clientHeight, top: o.scrollTop, bb: b.bottom, ih: innerHeight }; });
  ok(r.sh > r.ch && r.top > 0, w + 'x' + h + ': the progress panel scrolls (' + r.sh + ' > ' + r.ch + ')');
  ok(r.bb <= r.ih + 1, w + 'x' + h + ': the reset button can be reached (bottom ' + Math.round(r.bb) + ' of ' + r.ih + ')');
  await ctx.close();
}

console.log('\n27. Small phones: a hint shows its result where the player is looking');
for (const [w, h] of [[320, 640], [844, 390]]) {
  const ctx = await context({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  const pg = await open(ctx);
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.click('#hintBtn');
  await pg.waitForTimeout(700);
  const r = await pg.evaluate(() => { const n = document.getElementById('maskNote').getBoundingClientRect(); return { b: n.bottom, t: n.top, ih: innerHeight, focused: document.activeElement && document.activeElement.id }; });
  ok(r.t >= 0 && r.b <= r.ih + 1, w + 'x' + h + ': the letter count is on screen after Hint 1 (' + Math.round(r.t) + '-' + Math.round(r.b) + ' of ' + r.ih + ')');
  ok(r.focused !== 'answerInput', w + 'x' + h + ': on a touch screen the keyboard is not re-opened over it');
  await ctx.close();
}

console.log('\n28. A wrong answer shakes the box once, not every question after it');
{
  const ctx = await context();
  const pg = await open(ctx);
  await pg.fill('#answerInput', 'Nowhere'); await pg.press('#answerInput', 'Enter');
  ok(await pg.evaluate(() => document.getElementById('answerInput').classList.contains('shake')), 'the wrong answer shakes');
  await pg.waitForTimeout(600);
  ok(!(await pg.evaluate(() => document.getElementById('answerInput').classList.contains('shake'))), 'and the shake (with its red border) ends with its animation');
  await pg.fill('#answerInput', 'Nowhere'); await pg.press('#answerInput', 'Enter');
  await answerRight(pg);
  ok(!(await pg.evaluate(() => document.getElementById('answerInput').classList.contains('shake'))), 'the next question starts with a calm box');
  await ctx.close();
}

console.log('\n29. The leaderboard tells a guest why they are not on it');
{
  const ctx = await context();
  const pg = await open(ctx);
  await answerRight(pg);
  await pg.click('#boardBtn');
  ok(await pg.isVisible('#boardGuest') && /guests are not ranked/i.test(await pg.textContent('#boardGuestText')), 'a guest sees "guests are not ranked" with Log in and Register');
  ok(!/Answer a few questions to get on the board/.test(await pg.textContent('#boardEmpty')), 'and is not told that answering puts them on the board');
  await pg.evaluate(() => document.getElementById('langEl').click());   // the open panel covers the header
  ok(/επισκέπτ/.test(await pg.textContent('#boardGuestText')), 'in Greek too');
  await pg.evaluate(() => document.getElementById('langEn').click());
  await pg.click('#boardClose');
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: 'Rena' } })));
  await pg.click('#boardBtn');
  ok(!(await pg.isVisible('#boardGuest')), 'a signed-in player does not see the guest note');
  await ctx.close();
}

console.log('\n30. Registering keeps the progress made as a guest');
{
  const ctx = await context();
  const pg = await open(ctx);
  for (let i = 0; i < 3; i++) await answerRight(pg);
  const streak = await pg.textContent('#streakVal');
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'n@x', nickname: 'Nora' } })));
  let s = await stored(pg);
  ok(s.nora && s.nora.answered === 3 && s.nora.points === 300 && !s.nora.guest, 'the new account Nora starts with the 3 answers and 300 points (' + (s.nora && s.nora.answered) + ', ' + (s.nora && s.nora.points) + ')');
  ok((await pg.textContent('#streakVal')) === streak, 'the streak carries over (' + streak + ')');
  ok(s.__guest__.answered === 0, 'and the guest starts afresh, so nothing is counted twice');
  await ctx.close();
  // An account that already exists on this device is never overwritten by a guest.
  const ctx2 = await context();
  const nora = Object.assign({}, guest().__guest__, { nick: 'Nora', guest: false, answered: 40, correct: 30, points: 3000 });
  const pg2 = await open(ctx2, seed(Object.assign({ nora }, guest())));
  await answerRight(pg2);
  await pg2.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'n@x', nickname: 'Nora' } })));
  s = await stored(pg2);
  ok(s.nora.answered === 40 && s.__guest__.answered === 1, 'an account already on this device keeps its own record (' + s.nora.answered + '), the guest keeps its answer');
  await ctx2.close();
}

console.log('\n31. Two tabs: one question cannot be scored twice');
{
  const ctx = await context();
  const a = await open(ctx), b = await open(ctx);
  const qa = await country(a), qb = await country(b);
  ok(qa === qb, 'both tabs ask the same stored question (' + qa + ')');
  await b.click('#revealBtn');
  await a.waitForTimeout(150);
  ok((await country(a)) !== qa && /other tab/.test(await a.textContent('#feedback')), 'tab A moves on and says why (' + (await a.textContent('#feedback')) + ')');
  const cap = await capOf(a, qa);
  await a.fill('#answerInput', cap); await a.press('#answerInput', 'Enter');
  let s = await stored(a);
  ok(s.__guest__.correct === 0 && s.__guest__.byCountry[qa] && !s.__guest__.byCountry[qa].bestNoHint, 'the answer shown in tab B earns nothing in tab A');
  // both tabs answer the same question right: it counts once
  await b.click('#nextBtn');
  await a.waitForTimeout(150);
  const q = await country(b);
  ok((await country(a)) === q, 'tab A follows the question tab B moved to (' + q + ')');
  const before = (await stored(a)).__guest__.answered;
  await b.fill('#answerInput', await capOf(b, q)); await b.press('#answerInput', 'Enter');
  await a.waitForTimeout(150);
  await a.fill('#answerInput', await capOf(a, q)); await a.press('#answerInput', 'Enter');
  s = await stored(a);
  ok(s.__guest__.answered === before + 1 && s.__guest__.byCountry[q].correct === 1, 'answered right in both tabs, it counts once (' + (s.__guest__.answered - before) + ')');
  ok(a.errors.length + b.errors.length === 0, 'no page errors');
  await ctx.close();
}

console.log('\n31b. Two tabs: an open dialog keeps its focus; the Region follows');
{
  const ctx = await context();
  const a = await open(ctx), b = await open(ctx);
  await b.click('#statsBtn');
  const q = await country(a);
  await a.fill('#answerInput', await capOf(a, q)); await a.press('#answerInput', 'Enter'); await a.click('#nextBtn');
  await b.waitForTimeout(200);
  ok(await b.evaluate(() => document.getElementById('statsOverlay').contains(document.activeElement)), 'the other tab moved on, and focus stayed in the open "My progress" panel');
  await b.keyboard.press('Escape');
  await a.selectOption('#regionSel', 'Asia');
  await b.waitForTimeout(200);
  ok((await b.inputValue('#regionSel')) === 'Asia', 'a Region chosen in one tab shows in the other');
  const rb = await b.evaluate((n) => window.COUNTRIES.find((x) => x.c === n).region, await country(b));
  ok(rb === 'Asia', 'and the other tab now asks from that Region (' + rb + ')');
  ok(a.errors.length + b.errors.length === 0, 'no page errors');
  await ctx.close();
}

console.log('\n31c. Logging out and back in never re-asks the country just answered');
{
  const ctx = await context();
  const pg = await open(ctx);
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: 'Alex' } })));
  const x = await country(pg);
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: null })));
  await pg.fill('#answerInput', await capOf(pg, x)); await pg.press('#answerInput', 'Enter');
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: 'Alex' } })));
  await pg.click('#nextBtn');
  ok((await country(pg)) !== x, 'Next asks a new country, not ' + x + ' again');
  await ctx.close();
}

console.log('\n30b. A guest record someone else left on this device is not taken by a new account');
{
  const ctx = await context();
  const pg = await open(ctx, seed(guest({ answered: 50, correct: 40, points: 4200, bestStreak: 20 })));
  await answerRight(pg);
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'z@x', nickname: 'Zoe' } })));
  const s = await stored(pg);
  ok(s.zoe && s.zoe.answered === 0 && s.zoe.points === 0, 'the new account Zoe starts at 0, not with the 51 answers already there (' + (s.zoe && s.zoe.answered) + ')');
  ok(s.__guest__.answered === 51, 'and the guest record keeps them (' + s.__guest__.answered + ')');
  await ctx.close();
}

console.log('\n32. The Region choice survives a reload');
{
  const ctx = await context();
  const pg = await open(ctx);
  await pg.selectOption('#regionSel', 'Africa');
  const q = await country(pg);
  await pg.reload({ waitUntil: 'domcontentloaded' }); await pg.waitForFunction(() => document.querySelector('#qText .country').textContent.trim());
  ok((await pg.inputValue('#regionSel')) === 'Africa', 'the Region box still says Africa');
  ok((await country(pg)) === q, 'and the same African question is asked again (' + q + ')');
  await answerRight(pg);
  const r = await pg.evaluate((n) => window.COUNTRIES.find((x) => x.c === n).region, await country(pg));
  ok(r === 'Africa', 'the next question is African too (' + r + ')');
  await ctx.close();
}

console.log('\n33. Dialogs take focus, keep Tab inside, and never stack');
{
  const ctx = await context();
  const pg = await open(ctx);
  await pg.focus('#statsBtn'); await pg.keyboard.press('Enter');
  ok(await pg.evaluate(() => document.activeElement.id) === 'statsClose', 'opening My progress puts focus on its close button');
  let outside = 0;
  for (let i = 0; i < 12; i++) { await pg.keyboard.press('Tab'); if (!(await pg.evaluate(() => document.getElementById('statsOverlay').contains(document.activeElement)))) outside++; }
  ok(outside === 0, 'Tab never leaves the open panel (' + outside + ' escapes)');
  await pg.evaluate(() => document.getElementById('boardBtn').click());
  ok(await pg.evaluate(() => document.getElementById('boardOverlay').classList.contains('hidden')), 'the leaderboard does not open on top of it');
  await pg.keyboard.press('Escape');
  ok(await pg.evaluate(() => document.getElementById('statsOverlay').classList.contains('hidden')), 'Escape closes it');
  ok(await pg.evaluate(() => document.activeElement.id) === 'answerInput', 'and focus goes back to the answer box');
  const box = await pg.evaluate(() => { const x = document.getElementById('statsClose').getBoundingClientRect(), m = document.querySelector('#statsOverlay .modal').getBoundingClientRect(); return { x, m }; });
  await pg.click('#statsBtn');
  const xy = await pg.evaluate(() => { const x = document.getElementById('statsClose').getBoundingClientRect(), m = document.querySelector('#statsOverlay .modal').getBoundingClientRect(); return { in: x.top >= m.top && x.right <= m.right, w: x.width }; });
  ok(xy.in && xy.w >= 32, 'the × sits inside the panel with a finger-sized target (' + Math.round(xy.w) + 'px)');
  await ctx.close();
}

console.log('\n34. The map marker lands on the country itself');
{
  const ctx = await context();
  const bad = [];
  for (const c of ['Norway', 'Chile', 'Vietnam', 'Greece', 'Japan', 'Philippines', 'Cuba', 'Croatia', 'Italy', 'France']) {
    const pg = await open(ctx, seed(guest({ pending: c })));
    await pg.click('#revealBtn');
    await pg.waitForFunction(() => document.querySelector('#mapBox .map-dot'), null, { timeout: 5000 }).catch(() => {});
    const inside = await pg.evaluate(() => {
      const svg = document.querySelector('#mapBox svg'), dot = document.querySelector('#mapBox .map-dot');
      if (!svg || !dot) return null;
      const pt = svg.createSVGPoint(); pt.x = +dot.getAttribute('cx'); pt.y = +dot.getAttribute('cy');
      const paths = [...svg.querySelectorAll('.hl')].flatMap((n) => n.tagName.toLowerCase() === 'path' ? [n] : [...n.querySelectorAll('path')]);
      return paths.some((p) => p.isPointInFill(pt));
    });
    if (inside !== true) bad.push(c + ':' + inside);
    await pg.close();
  }
  ok(bad.length === 0, 'the marker is inside the highlighted shape for Norway, Chile, Vietnam, Greece, Japan, the Philippines, Cuba and more' + (bad.length ? ' — not for ' + bad.join(' ') : ''));
  const pg = await open(ctx, seed(guest({ pending: 'Fiji' })));
  await pg.click('#revealBtn');
  await pg.waitForFunction(() => document.getElementById('mapNote').textContent.trim(), null, { timeout: 5000 }).catch(() => {});
  ok(/does not show it/.test(await pg.textContent('#mapNote')), 'Fiji: "This map does not show it" (' + (await pg.textContent('#mapNote')) + ')');
  await ctx.close();
}

console.log('\n35. English sentences name a country with "the" where English does');
{
  const ctx = await context();
  const pg = await open(ctx, seed(guest({ pending: 'Netherlands' })));
  ok((await pg.textContent('#qText')) === 'What is the capital of the Netherlands?', 'question: ' + (await pg.textContent('#qText')));
  await pg.click('#revealBtn');
  ok(/is the capital of the Netherlands/.test(await pg.textContent('#capLine')), 'banner: ' + (await pg.textContent('#capLine')));
  ok(/the Netherlands/.test(await pg.textContent('#seenNote')), 'seen line: ' + (await pg.textContent('#seenNote')));
  await pg.click('#langEl');
  ok(/Ολλανδία/.test(await pg.textContent('#capLine')), 'Greek unchanged: ' + (await pg.textContent('#capLine')));
  ok((await pg.getAttribute('#streakPill', 'title')) === 'Σωστές απαντήσεις στη σειρά' && (await pg.getAttribute('#statsClose', 'aria-label')) === 'Κλείσιμο', 'tooltips and the × follow the language');
  await ctx.close();
}

console.log('\n36. A long nickname keeps its "you" tag on the leaderboard');
{
  const ctx = await context();
  const pg = await open(ctx);
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('account-changed', { detail: { uid: 'x', email: 'a@x', nickname: 'TheGreatGeographerOfAll' } })));
  await answerRight(pg);
  await pg.click('#boardBtn');
  const r = await pg.evaluate(() => { const t = document.querySelector('#boardBody .youtag'), c = t && t.closest('td'); if (!t) return null; const a = t.getBoundingClientRect(), b = c.getBoundingClientRect(); return { tr: a.right, cr: b.right, w: a.width }; });
  ok(r && r.w > 10 && r.tr <= r.cr + 1, 'the tag is drawn inside its cell (' + JSON.stringify(r) + ')');
  await ctx.close();
}

const REGION = (r) => `localStorage.setItem('capitals:v1:region', ${JSON.stringify(r)});`;
async function reveal(pg) { await pg.click('#revealBtn'); await pg.click('#nextBtn'); }

console.log('\n37. No country is asked twice in one visit (South America, 12 countries)');
{
  const ctx = await context();
  const pg = await open(ctx, REGION('South America'));
  const seen = [];
  ok(/^Question 1 of 12 in this round$/.test(await pg.textContent('#qRound')), 'round line: ' + (await pg.textContent('#qRound')));
  for (let i = 0; i < 5; i++) { seen.push(await country(pg)); await reveal(pg); }
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.getElementById('qText').getAttribute('data-c'));
  // the reload re-asks nothing already asked (the open question was drawn after the fifth)
  for (let i = 5; i < 12; i++) { seen.push(await country(pg)); if (i === 11) ok((await pg.textContent('#qRound')) === 'Question 12 of 12 in this round', 'the last one: ' + (await pg.textContent('#qRound'))); await reveal(pg); }
  ok(new Set(seen).size === 12, 'twelve questions, twelve different countries, a reload in between (' + seen.join(', ') + ')');
  ok((await pg.textContent('#qRound')) === 'Question 1 of 12 in this round' && /new round/.test(await pg.textContent('#feedback')), 'then a new round starts, and says so: ' + (await pg.textContent('#feedback')));
  ok(!seen.slice(-1).includes(await country(pg)), 'the new round does not open on the country just asked');
  // the region "All" counts every country, and one asked already stays asked there
  await pg.selectOption('#regionSel', 'all');
  ok(/^Question \d+ of \d{3} in this round$/.test(await pg.textContent('#qRound')), 'All regions: ' + (await pg.textContent('#qRound')));
  ok(pg.errors.length === 0, 'no page errors');
  await ctx.close();
}

console.log('\n38. Learn: study cards, nothing scored');
{
  const ctx = await context();
  const pg = await open(ctx, REGION('Europe'));
  const before = (await stored(pg)).__guest__;
  await pg.click('#modeLearn');
  ok(await pg.evaluate(() => document.getElementById('quizCard').classList.contains('learn-on')), 'the card switches to study mode');
  ok(await pg.isVisible('#capLine') && !(await pg.isVisible('#answerInput')) && !(await pg.isVisible('#nextBtn')), 'the capital is shown, with no answer box and no quiz Next button');
  ok((await pg.textContent('#learnCount')) === 'Card 1 of 10', 'count: ' + (await pg.textContent('#learnCount')));
  ok(await pg.isDisabled('#learnPrev'), 'Previous is off on the first card');
  const cards = [await country(pg)];
  for (let i = 1; i < 10; i++) { await pg.click('#learnNext'); cards.push(await country(pg)); }
  ok(new Set(cards).size === 10, 'ten different countries');
  ok(await pg.isDisabled('#learnNext'), 'Next is off on the last card');
  const regionsOk = await pg.evaluate((cs) => cs.every((c) => window.COUNTRIES.find((e) => e.c === c).region === 'Europe'), cards);
  ok(regionsOk, 'all from the Region chosen (Europe)');
  await pg.click('#learnPrev');
  await pg.keyboard.press('ArrowLeft');
  ok((await country(pg)) === cards[7], 'Previous and the left arrow step back');
  await pg.locator('body').click({ position: { x: 5, y: 5 } });
  await pg.keyboard.press('ArrowRight');
  ok((await country(pg)) === cards[8], 'the right arrow steps forward');
  ok(await pg.isVisible('#fact1') && (await pg.textContent('#fact1')).length > 20, 'the facts are shown');
  const after = (await stored(pg)).__guest__;
  ok(after.answered === before.answered && after.points === before.points, 'learning scores nothing');
  ok(/^The capital of /.test(await pg.textContent('#qText')), 'heading: ' + (await pg.textContent('#qText')));
  await pg.click('#learnNew');
  const fresh = await country(pg);
  ok(!cards.includes(fresh) && (await pg.textContent('#learnCount')) === 'Card 1 of 10', 'Show me different ones: a new set of countries not studied yet (' + fresh + ')');
  await pg.click('#modeQuiz');
  ok(await pg.isVisible('#answerInput') && !(await pg.evaluate(() => document.getElementById('quizCard').classList.contains('learn-on'))), 'Quiz brings the question back');
  ok(pg.errors.length === 0, 'no page errors');
  await ctx.close();
}

console.log('\n39. A test on the learned set, then a summary');
{
  const ctx = await context();
  const pg = await open(ctx, REGION('Oceania'));
  await pg.click('#modeLearn');
  const deck = await pg.evaluate(() => JSON.parse(sessionStorage.getItem('capitals:v1:mode')).deck);
  ok(deck.length === 10, 'a set of ten');
  await pg.click('#learnTest');
  ok(await pg.isVisible('#answerInput'), 'the test asks with the answer box');
  ok((await pg.textContent('#qRound')) === 'Test: question 1 of 10', 'line: ' + (await pg.textContent('#qRound')));
  const asked = [];
  for (let i = 0; i < 10; i++) {
    const c = await country(pg); asked.push(c);
    if (i === 0) { await pg.fill('#answerInput', 'Qwertyville'); await pg.press('#answerInput', 'Enter'); await pg.fill('#answerInput', await capOf(pg, c)); await pg.press('#answerInput', 'Enter'); await pg.click('#nextBtn'); }
    else if (i === 1) await reveal(pg);
    else await answerRight(pg);
  }
  ok(asked.length === 10 && new Set(asked).size === 10 && asked.every((c) => deck.includes(c)), 'each learned country asked once, and only those');
  ok(await pg.isVisible('#testSummary') && !(await pg.isVisible('#answerInput')), 'the summary replaces the card');
  ok((await pg.textContent('#testText')) === 'You got 8 of 10 right on the first try, without a hint.', 'summary: ' + (await pg.textContent('#testText')));
  const res = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#testList li')].map((li) => [li.getAttribute('data-c'), li.querySelector('.tres').className.split(' ')[1]])));
  ok(res[asked[0]] === 'help' && res[asked[1]] === 'shown' && res[asked[2]] === 'first', 'a wrong try counts as "with help", a shown answer as "shown"');
  ok((await stored(pg)).__guest__.answered === 10, 'the test answers count on the profile like any answer');
  await pg.keyboard.press('Enter');
  ok(await pg.isVisible('#testSummary'), 'a stray Enter does not leave the summary');
  await pg.click('#testRetry');
  ok((await pg.textContent('#learnCount')) === 'Card 1 of 2', 'Study the ones I missed: the two missed ones (' + (await pg.textContent('#learnCount')) + ')');
  const again = [await country(pg)]; await pg.click('#learnNext'); again.push(await country(pg));
  ok(again.includes(asked[0]) && again.includes(asked[1]), 'they are the two missed');
  await pg.click('#learnTest');
  await answerRight(pg); await answerRight(pg);
  ok((await pg.textContent('#testText')) === 'You got 2 of 2 right on the first try, without a hint.' && !(await pg.isVisible('#testRetry')), 'all right: no "missed" button');
  await pg.click('#testToQuiz');
  ok(await pg.isVisible('#answerInput') && /in this round$/.test(await pg.textContent('#qRound')), 'Back to the quiz');
  const c = await country(pg);
  ok(!asked.includes(c), 'the quiz does not ask again a country the test asked this visit (' + c + ')');
  ok(pg.errors.length === 0, 'no page errors');
  await ctx.close();
}

console.log('\n40. Learn and a test survive a reload');
{
  const ctx = await context();
  const pg = await open(ctx, REGION('Asia'));
  await pg.click('#modeLearn');
  await pg.click('#learnNext'); await pg.click('#learnNext');
  const c3 = await country(pg);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.getElementById('learnCount').textContent);
  ok((await pg.textContent('#learnCount')) === 'Card 3 of 10' && (await country(pg)) === c3 && await pg.evaluate(() => document.getElementById('modeLearn').classList.contains('active')), 'Learn: the same card after a reload');
  await pg.click('#learnTest');
  await answerRight(pg); await answerRight(pg);
  const open3 = await country(pg);
  await pg.reload({ waitUntil: 'domcontentloaded' });
  await pg.waitForFunction(() => document.getElementById('qRound').textContent);
  ok((await pg.textContent('#qRound')) === 'Test: question 3 of 10' && (await country(pg)) === open3, 'test: the same question, still question 3 of 10');
  ok(pg.errors.length === 0, 'no page errors');
  await ctx.close();
}

console.log('\n41. Learn and the test in Greek');
{
  const ctx = await context();
  const pg = await open(ctx, REGION('Europe'));
  await pg.click('#modeLearn');
  await pg.click('#langEl');
  ok(/^Η πρωτεύουσα της χώρας /.test(await pg.textContent('#qText')) && /^Κάρτα 1 από 10$/.test(await pg.textContent('#learnCount')), 'study card: ' + (await pg.textContent('#qText')) + ' / ' + (await pg.textContent('#learnCount')));
  ok((await pg.textContent('#modeLearn')).includes('Μάθηση') && (await pg.textContent('#learnTest')).includes('10'), 'buttons: ' + (await pg.textContent('#learnTest')));
  await pg.click('#learnTest');
  ok(/^Τεστ: ερώτηση 1 από 10$/.test(await pg.textContent('#qRound')), 'test line: ' + (await pg.textContent('#qRound')));
  for (let i = 0; i < 10; i++) await reveal(pg);
  ok(/^Βρήκες 0 από 10/.test(await pg.textContent('#testText')) && (await pg.textContent('#testList')).includes('Δόθηκε'), 'summary in Greek');
  await pg.click('#langEn');
  ok(/^You got 0 of 10/.test(await pg.textContent('#testText')) && (await pg.textContent('#testList')).includes('Shown'), 'and back in English');
  ok(pg.errors.length === 0, 'no page errors');
  await ctx.close();
}

await br.close(); srv.close();
console.log('\n' + (fails ? `FAILED — ${fails} check(s)` : 'OK — state guard passed'));
process.exit(fails ? 1 : 0);
