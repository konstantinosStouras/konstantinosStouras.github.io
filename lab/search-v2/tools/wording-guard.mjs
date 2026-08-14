/* ==========================================================================
   search-v2  ·  tools/wording-guard.mjs
   The wording a session carries is the wording its participants read.

       node lab/search-v2/tools/wording-guard.mjs

   The Wording screen in the admin panel is only worth having if the words it
   shows are the words that reach the screen. admin-smoke.mjs proves the panel
   stores an override; this proves the participant app APPLIES it — consent,
   instructions, both quick checks and the survey — and that rewording a
   question does not disturb how it is graded or exported.

   Firebase is unreachable here, and without it the participant app never reads
   a run document at all, so `svfirebase.js` is served as a stub that hands back
   a run carrying overrides. Everything downstream of that is the real app.

   It also holds the DRIFT GUARD: app.js must read participant-facing content
   only through the resolved copy. A single `Content.SURVEY` slipping back in
   would silently ignore a session's own wording for that one screen, which is
   exactly the sort of thing that is invisible until an instructor asks why
   their edit did nothing.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

let fails = 0, checks = 0;
const ok = (c, m, extra) => {
  checks++;
  if (c) console.log('  ok   — ' + m);
  else { fails++; console.log('  FAIL — ' + m + (extra ? '\n         ' + extra : '')); }
};

// ======================================================================
console.log('\n1 · app.js reads content only through the resolved copy');
// ======================================================================
{
  const app = readFileSync(join(HERE, '..', 'app.js'), 'utf8');
  const refs = app.match(/Content\.[A-Za-z_]+/g) || [];
  const bad = refs.filter(r => r !== 'Content.resolve');
  ok(bad.length === 0,
    'every participant-facing read goes through CT, not the defaults directly',
    bad.length ? 'still reading: ' + [...new Set(bad)].join(', ') : '');
  ok(/CT = Content\.resolve\(/.test(app), 'the resolved copy is built from the run’s own content');
  ok(/pub && \(pub\.contentJson \|\| pub\.content\)/.test(app),
    'and it is read from the public copy too, which is all a server-mode participant can see');

  const admin = readFileSync(join(HERE, '..', 'admin', 'admin.js'), 'utf8');
  ok(/contentJson: Content\.stringifyOverrides\(run\.contentJson/.test(admin),
    'the redacted public document carries the wording');
  ok((admin.match(/contentJson: Content\.stringifyOverrides\(currentContent\)/g) || []).length >= 3,
    'creating, saving and saving-while-locked all persist it');
  // Stored as a STRING on purpose: both writers use setDoc(merge:true), which
  // deep-merges a map, so a reverted key would survive the write.
  ok(!/\bcontent: Content\./.test(admin),
    'and none of them writes it as a map, which merge would never let a revert delete');
}

// ======================================================================
console.log('\n2 · a session’s wording reaches its participants');
// ======================================================================

// The overrides this run carries. One per screen, so a screen that quietly
// stopped consulting the run would show up here as a default.
const OV = {
  consent: 'CONSENT-OVERRIDE: this session wrote its own consent text.',
  'instr.i1.title': 'INSTR-TITLE-OVERRIDE',
  'instr.i1.body': 'INSTR-BODY-OVERRIDE for the first screen.',
  'quiz.q_cost.prompt': 'QUIZ-PROMPT-OVERRIDE: what does one reveal cost?',
  'quiz.q_cost.opt.2': 'QUIZ-OPTION-OVERRIDE',
  'reg.f_year.prompt': 'REG-PROMPT-OVERRIDE: how far through are you?',
  'reg.f_year.opt.0': 'REG-OPT-OVERRIDE',
  'enc.rush.title': 'ENC-RUSH-OVERRIDE',
  'ai.a1.title': 'AI-TITLE-OVERRIDE',
  'aiquiz.qai_score.prompt': 'AIQUIZ-PROMPT-OVERRIDE',
  'survey.s01.prompt': 'SURVEY-PROMPT-OVERRIDE: how did you choose?',
  'part.A.title': 'PART-A-OVERRIDE',
  debrief: 'DEBRIEF-OVERRIDE.',
  thanks: 'THANKS-OVERRIDE.'
};

const STUB = `
/* served in place of svfirebase.js — hands the app a run carrying overrides */
window.SVFirebase = (function () {
  var RUN = {
    id: 'guard-run', name: 'Wording guard', code: 'WORD', status: 'open',
    serverMode: false, ops: {}, params: null,
    contentJson: ${JSON.stringify(JSON.stringify(OV))}
  };
  return {
    isConfigured: function () { return true; },
    signInAnon: function () { return Promise.resolve({ uid: 'guard' }); },
    getRunByCode: function () { return Promise.resolve(RUN); },
    getRunPublic: function () { return Promise.resolve(null); },
    getRunPublicByCode: function () { return Promise.resolve(null); },
    claimCode: function () { return Promise.resolve({ ok: true }); },
    saveParticipant: function () { return Promise.resolve(); },
    writeEvent: function () { return Promise.resolve(); },
    watchMessages: function () { return function () {}; }
  };
})();
`;

const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  if (p === '/lab/search-v2/svfirebase.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(STUB);
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

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await br.newContext({ viewport: { width: 1500, height: 1000 } });
await ctx.route(/gstatic\.com|googleapis\.com/, r => r.abort());
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e.message)));

await pg.goto(BASE + '?code=WORD&pcode=WORD001&PROLIFIC_PID=WORD001');
await pg.waitForSelector('#s-consent.active', { timeout: 20000 });

// ---- consent -------------------------------------------------------------
ok(/CONSENT-OVERRIDE/.test(await pg.locator('#consent-body').innerText()),
  'the consent screen shows this session’s own words');
await pg.locator('#consent-box').check();
await pg.locator('#btn-consent').click();

// ---- registration --------------------------------------------------------
// Background, between consent and the instructions. Its wording is overridable
// like everything else a participant reads.
await pg.waitForSelector('#s-registration.active', { timeout: 15000 });
ok(/REG-PROMPT-OVERRIDE/.test(await pg.locator('#reg-body').innerText()),
  'a registration question shows this session’s own words');
ok(/REG-OPT-OVERRIDE/.test(await pg.locator('#reg-body').innerText()),
  'and so does one of its answers');
await pg.locator('#btn-reg').click();

// ---- instructions --------------------------------------------------------
await pg.waitForSelector('#s-instructions.active');
ok((await pg.locator('#instr-title').innerText()).includes('INSTR-TITLE-OVERRIDE'),
  'an instruction heading is overridden');
ok(/INSTR-BODY-OVERRIDE/.test(await pg.locator('#instr-body').innerText()),
  'and so is its text');
for (let i = 0; i < 5; i++) { await pg.locator('#btn-instr-next').click(); await pg.waitForTimeout(80); }

// ---- the quick check -----------------------------------------------------
await pg.waitForSelector('#s-quiz.active');
const quizText = await pg.locator('#quiz-body').innerText();
ok(/QUIZ-PROMPT-OVERRIDE/.test(quizText), 'a comprehension question is overridden');
ok(/QUIZ-OPTION-OVERRIDE/.test(quizText), 'and so is one of its answer options');
ok(!/\{revealCost\}|\{stepBound\}/.test(quizText),
  'no token is left showing to the participant', quizText.slice(0, 200));

// Rewording must not disturb grading: the overridden option is still the
// correct one, because the answer key is an index the session cannot move.
const answered = await pg.evaluate(() => {
  const C = window.SVContent;
  const q = C.QUIZ_BASE.find(x => x.id === 'q_cost');
  document.querySelectorAll('#quiz-body .quiz-q').forEach(el => {
    const id = el.dataset.q;
    const want = C.QUIZ_BASE.find(x => x.id === id).answer;
    const input = el.querySelector('input[value="' + want + '"]');
    if (input) input.checked = true;
  });
  return q.answer;
});
ok(answered === 2, 'the answer key for the reworded question is where it always was');
await pg.locator('#btn-quiz').click();
await pg.waitForTimeout(400);
ok(!(await pg.locator('#s-quiz').evaluate(el => el.classList.contains('active'))),
  'answering by the UNCHANGED key passes the gate, so rewording did not break grading');

ok(errors.length === 0, 'no page errors while the overridden session ran', errors.slice(0, 4).join(' | '));

await br.close();
srv.close();
console.log('\n' + (fails
  ? `WORDING GUARD FAILED — ${fails} of ${checks} checks`
  : `WORDING GUARD OK — all ${checks} checks passed; a session’s words reach its participants.`));
process.exit(fails ? 1 : 0);
