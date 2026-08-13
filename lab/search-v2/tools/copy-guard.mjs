/* ==========================================================================
   Search-v2 — PARTICIPANT-COPY guard (offline, Playwright; no network)
       node lab/search-v2/tools/copy-guard.mjs

   The contract this pins down: EVERY word a participant can see is defined in
   copy.js, is listed in the admin panel's "Page text & content" editors, and an
   admin override actually reaches the screen.

   That contract exists because it was once broken in a way nobody could see
   from the admin panel: the participant copy lived in three places (prose in
   app.js, headings/buttons hard-coded in index.html, and an abridged
   "…(built-in default)" mirror in admin.js used only as placeholders), so the
   Quick-check comprehension questions, the exit survey and every heading,
   button, counter label and dialog were neither shown nor editable there.

   Asserted here:
     A. STATIC — every data-copy* key in index.html exists in copy.js and is
        offered as an admin field; no copy.js string is missing from the admin;
        both pages load copy.js; admin.js is driven by it and keeps no private
        mirror of the wording.
     B. NORMALIZERS — a half-edited or hostile quiz/survey override can never
        break the study (bad rows dropped, correct-answer index repaired, an
        empty group honoured as "ask nothing").
     C. LIVE — with a stubbed session whose settings.content overrides one
        string on every screen (plus a custom Quick-check question and a custom
        survey question), a full two-phase playthrough shows the ADMIN's words,
        not the built-ins, on all eleven screens.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const ROOT = resolve(APP, '..', '..');
const CP = require('../copy.js');

let fails = 0;
const ok = (c, m) => { console.log((c ? '  ok — ' : '  FAIL — ') + m); if (!c) fails++; };
const read = (p) => readFile(join(APP, p), 'utf8');

// ── A. Static: markup ↔ copy.js ↔ admin panel ─────────────────────────────
console.log('\nA · Every participant string is defined once and editable');
const indexHtml = await read('index.html');
const adminHtml = await read('admin/index.html');
const adminJs = await read('admin/admin.js');
const appJs = await read('app.js');

const editable = new Set(CP.allKeys());
const markupKeys = [...indexHtml.matchAll(/data-copy(?:-title|-ph)?="([^"]+)"/g)].map(m => m[1]);
ok(markupKeys.length >= 40, `index.html marks up its static copy (${markupKeys.length} data-copy hooks)`);
const undefinedKeys = markupKeys.filter(k => CP.TEXT[k] === undefined);
ok(undefinedKeys.length === 0, 'every data-copy key in the markup is defined in copy.js' + (undefinedKeys.length ? ` — missing: ${undefinedKeys}` : ''));
const unEditable = markupKeys.filter(k => !editable.has(k));
ok(unEditable.length === 0, 'every data-copy key is offered as an admin field' + (unEditable.length ? ` — not in GROUPS: ${unEditable}` : ''));

const orphanText = Object.keys(CP.TEXT).filter(k => !editable.has(k));
ok(orphanText.length === 0, 'no copy.js string is missing from the admin editors' + (orphanText.length ? ` — orphans: ${orphanText}` : ''));
const noDefault = CP.stringKeys().filter(k => CP.TEXT[k] === undefined);
ok(noDefault.length === 0, 'every admin field has a built-in default' + (noDefault.length ? ` — ${noDefault}` : ''));
const all = CP.allKeys();
ok(new Set(all).size === all.length, 'no key is offered twice');
ok(all.length > 100, `the admin covers the whole study (${all.length} fields + 2 structured editors)`);

// The two screens the report was about are covered as STRUCTURED editors.
const structured = CP.GROUPS.flatMap(g => g.fields).filter(f => f.type === 'quiz' || f.type === 'survey').map(f => f.type);
ok(structured.includes('quiz'), 'the Quick-check questions have a structured editor (prompt, options, answer key)');
ok(structured.includes('survey'), 'the exit-survey questions have a structured editor');

ok(/<script src="copy\.js">/.test(indexHtml), 'the participant page loads copy.js');
ok(/<script src="\.\.\/copy\.js">/.test(adminHtml), 'the admin page loads copy.js');
ok(/CP\s*=\s*window\.SVCopy/.test(adminJs) && /CP\.GROUPS/.test(adminJs) && /CP\.stringKeys\(\)/.test(adminJs),
  'the admin editors are built FROM copy.js (not a private list)');
ok(!/\bvar BUILTIN\s*=/.test(adminJs), 'the admin keeps no abridged mirror of the participant wording');
ok(!/\bvar BUILTIN\s*=/.test(appJs) && /CP\.resolve/.test(appJs), 'the app reads its copy through copy.js too');

// Prose the participant reads must survive a hostile override: the app escapes
// everything and only re-introduces <b> from **bold**.
ok(/function inline\(/.test(appJs) && /function renderProse\(/.test(appJs),
  'admin-supplied copy is escaped before it reaches innerHTML');

// ── B. Normalizers: a half-edited override can never break the study ───────
console.log('\nB · A broken or hostile override degrades safely');
{
  const junk = CP.normalizeQuizList([{ prompt: '', options: ['a', 'b'] }, { prompt: 'ok?', options: ['only-one'] }], CP.QUIZ.common);
  ok(JSON.stringify(junk) === JSON.stringify(CP.QUIZ.common), 'unusable questions fall back to the built-in set');

  const repaired = CP.normalizeQuizList([{ id: 'a b/c', prompt: 'P', options: ['x', 'y'], correct: 9 }], []);
  ok(repaired[0].correct === 0, 'an out-of-range answer key is repaired, never left dangling');
  ok(/^[A-Za-z0-9_-]+$/.test(repaired[0].id), 'a question id is sanitised (it becomes a radio name + CSS selector)');

  // Dropping a blank option shifts the later indices — the answer key has to
  // travel with the OPTION, not with its old position.
  const shifted = CP.normalizeQuizList([{ prompt: 'P', options: ['A', '', 'C'], correct: 2 }], []);
  ok(shifted[0].options[shifted[0].correct] === 'C', 'a blank option in the middle does not move the correct answer');
  const keyBlanked = CP.normalizeQuizList([{ prompt: 'P', options: ['A', '', 'C'], correct: 1 }], []);
  ok(keyBlanked[0].correct === 0 && keyBlanked[0].options.length === 2, 'blanking the option that WAS correct falls back to the first, never out of range');

  const off = CP.quizFor({ quiz: { common: [], ai: [] } });
  ok(off.common.length === 0 && off.ai.length === 0, 'deleting every question turns the Quick check off (not back to the built-ins)');
  const untouched = CP.quizFor({});
  ok(untouched.common.length === CP.QUIZ.common.length && untouched.ai.length === CP.QUIZ.ai.length,
    'a session that never edited the questions follows copy.js');

  const sv = CP.normalizeSurvey([{ prompt: 'Q', type: 'nonsense' }], CP.SURVEY);
  ok(sv[0].type === 'likert', 'an unknown survey question type falls back to the agree/disagree scale');
  ok(CP.surveyFor({}).length === CP.SURVEY.length, 'an unedited survey follows copy.js');

  ok(CP.lines('  \n a \n\n b \n', 'nudges').join('|') === 'a|b', 'list fields ignore blank lines and stray spaces');
  ok(CP.lines('', 'surveyLikert').length === 5, 'an emptied list field falls back to the built-in scale');
}

// ── C. Live: an admin edit reaches every screen ───────────────────────────
console.log('\nC · An admin override reaches all eleven participant screens');

const OVERRIDE = {
  consentTitle: 'ZZ-consent-title', consent: 'ZZ-consent-body **bold**', consentAgree: 'ZZ-agree', consentBtn: 'ZZ-consent-go',
  instructionsTitle: 'ZZ-instr-title', instructions: 'ZZ-instr-body {rounds}', instructionsBtn: 'ZZ-instr-go',
  quizTitle: 'ZZ-quiz-title', quizIntro: 'ZZ-quiz-intro', quizBtn: 'ZZ-quiz-go',
  phaseIntroTitle: 'ZZ-part {part}/{parts}', phaseIntroB: 'ZZ-into-ai', phaseIntroBtn: 'ZZ-phase-go',
  phaseLabelA: 'ZZ-solo', phaseLabelB: 'ZZ-assisted',
  roundLabelReal: 'ZZ-round {round}/{nTasks}', counterBest: 'ZZ-best', counterReveals: 'ZZ-reveals',
  counterCost: 'ZZ-cost', counterNet: 'ZZ-net', posLabel: 'ZZ-position',
  revealBtn: 'ZZ-reveal {fee}', stopBtn: 'ZZ-stop', legendRevealed: 'ZZ-legend-revealed',
  stopTitle: 'ZZ-stop-title', stopMsg: 'ZZ-stop-msg {net}', stopOk: 'ZZ-stop-ok', stopCancel: 'ZZ-keep-going',
  aiTitle: 'ZZ-ai-title', aiIntro: 'ZZ-ai-intro', aiAskBtn: 'ZZ-ask {cost}', aiEmptyLog: 'ZZ-ai-empty',
  aiAnswer: 'ZZ-ai-answer at {pos} is {est}',
  interRound: 'ZZ-round-done', interPart: 'ZZ-part-done', resReveals: 'ZZ-res-reveals', resNet: 'ZZ-res-net', interBtn: 'ZZ-inter-go',
  compareTitle: 'ZZ-results-title', compareIntroMulti: 'ZZ-results-intro', cmpAvgNet: 'ZZ-avg-net', compareBtn: 'ZZ-results-go',
  surveyTitle: 'ZZ-survey-title', surveyIntro: 'ZZ-survey-intro', surveyBtn: 'ZZ-survey-go',
  surveyLikert: 'ZZ-no way\nZZ-nope\nZZ-meh\nZZ-yep\nZZ-oh yes',
  finishTitle: 'ZZ-finish-title', finish: 'ZZ-finish-body', thRound: 'ZZ-th-round', finishBonus: 'ZZ-bonus',
  finishCodeLabel: 'ZZ-code-label', brand: 'ZZ-brand',
  quiz: {
    common: [{ id: 'zc1', prompt: 'ZZ-common-question?', options: ['ZZ-wrong', 'ZZ-right'], correct: 1 }],
    ai: [{ id: 'za1', prompt: 'ZZ-ai-question?', options: ['ZZ-ai-wrong', 'ZZ-ai-right'], correct: 1 }]
  },
  survey: [{ id: 'zs1', type: 'likert', prompt: 'ZZ-survey-question' }, { id: 'zs2', type: 'text', prompt: 'ZZ-survey-text' }]
};
const SETTINGS = {
  phases: ['A', 'B'], counterbalance: false, nTasks: 1, paidTasks: 1, nPractice: 0,
  coveragePatches: [{ a: 30, b: 70 }],
  ai: { baselineCost: 2, baselineData: 'few', frontier: false, frontierCost: 4, frontierData: 'lots' },
  completionCode: 'ZZCODE', content: OVERRIDE
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
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
const BASE = `http://127.0.0.1:${srv.address().port}/lab/search-v2/`;

const PW = process.env.PW || 'playwright';
const { chromium } = await import(PW).catch(() => import('playwright-core'));
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await br.newContext({ viewport: { width: 1280, height: 960 } });
await ctx.route('**/gstatic.com/firebasejs/**', r => r.abort());
// Stand in for the real Firestore: serve the app a session whose settings carry
// the overrides above. Everything else about the study runs for real.
await ctx.route(`${BASE}firebase.js`, r => r.fulfill({
  contentType: 'text/javascript',
  body: `window.SVFirebase = {
    isConfigured: function () { return true; },
    getSessionByCode: function () { return Promise.resolve({ code: 'ZZ', name: 'copy-guard', status: 'active', settings: ${JSON.stringify(SETTINGS)} }); },
    getStudyConfig: function () { return Promise.resolve(null); },
    signInAnon: function () { return Promise.resolve(null); },
    writeEvent: function () { return Promise.resolve(false); },
    watchMessages: function () {}, adminEmails: [], paths: {}
  };`
}));

const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e.message)));
const text = async (sel) => (await pg.textContent(sel)) || '';
const bodyText = () => pg.evaluate(() => document.body.innerText);
const seen = async (needle, where) => ok((await bodyText()).includes(needle), `${where}: “${needle}”`);

await pg.goto(BASE + '?code=ZZ&SESSION_ID=zzguard');

// 1 · consent
await pg.waitForSelector('#s-consent.active', { timeout: 15000 });
await seen('ZZ-consent-title', 'consent heading');
await seen('ZZ-consent-body', 'consent body');
await seen('ZZ-agree', 'consent checkbox');
ok((await text('#btn-consent')).includes('ZZ-consent-go'), 'consent: button');
ok((await text('.brand')).includes('ZZ-brand'), 'header: study name');
ok(await pg.evaluate(() => !!document.querySelector('#consent-body b')), 'consent: **bold** still renders as bold');

// 2 · instructions
await pg.click('#consent-box'); await pg.click('#btn-consent');
await pg.waitForSelector('#s-instructions.active');
await seen('ZZ-instr-title', 'instructions heading');
await seen('ZZ-instr-body', 'instructions body');
await seen('You play 1 rounds in each of 2 parts', 'instructions: {rounds} expands with the session settings');

// 3 · quick check — the screen the report was about
await pg.click('#btn-instructions');
await pg.waitForSelector('#s-quiz.active');
await seen('ZZ-quiz-title', 'quick check heading');
await seen('ZZ-quiz-intro', 'quick check intro');
await seen('ZZ-common-question?', 'quick check: the ADMIN’s question');
await seen('ZZ-right', 'quick check: the admin’s answer options');
ok(!(await bodyText()).includes('highest possible value at position 52'), 'quick check: the built-in question is gone');
// The answer key travels with the text: the admin's "correct" option passes.
await pg.click('.quiz-opt:has-text("ZZ-right") input');
await pg.click('#btn-quiz');

// 4 · round (phase 1, Without AI)
await pg.waitForSelector('#s-round.active');
await seen('ZZ-round 1/1', 'round label');
await seen('ZZ-solo', 'round label: the admin’s name for the Without-AI part');
await seen('ZZ-best', 'round counters');
await seen('ZZ-position', 'position picker');
ok((await text('#btn-reveal')).includes('ZZ-reveal 5'), 'round: reveal button ({fee} expanded)');
ok((await text('#btn-stop')).includes('ZZ-stop'), 'round: stop button');
await seen('ZZ-legend-revealed', 'plot legend');
ok(await pg.evaluate(() => document.querySelector('.counter.cost').title.includes('per reveal')), 'round: counter tooltips are painted from copy.js');

// 5 · stop dialog
await pg.click('#btn-reveal');
await pg.click('#btn-stop');
await pg.waitForSelector('#ov-stop.show');
await seen('ZZ-stop-title', 'stop dialog heading');
ok((await text('#stop-msg')).startsWith('ZZ-stop-msg'), 'stop dialog: message ({net} expanded)');
ok((await text('#btn-stop-cancel')).includes('ZZ-keep-going'), 'stop dialog: cancel button');
await pg.click('#btn-stop-ok');

// 6 · end-of-round card
await pg.waitForSelector('#s-interstitial.active');
await seen('ZZ-part-done', 'round result heading');
await seen('ZZ-res-reveals', 'round result rows');
ok((await text('#btn-continue')).includes('ZZ-inter-go'), 'round result: button');

// 7 · phase transition
await pg.click('#btn-continue');
await pg.waitForSelector('#s-phase-intro.active');
await seen('ZZ-part 2/2', 'phase transition heading ({part}/{parts} expanded)');
await seen('ZZ-into-ai', 'phase transition body');

// 8 · quick check, second helping (the With-AI questions)
await pg.click('#btn-phase-intro');
await pg.waitForSelector('#s-quiz.active');
await seen('ZZ-ai-question?', 'quick check: the admin’s With-AI question');
await pg.click('.quiz-opt:has-text("ZZ-ai-right") input');
await pg.click('#btn-quiz');

// 9 · round (phase 2, With AI) + the assistant panel
await pg.waitForSelector('#s-round.active');
await seen('ZZ-assisted', 'round label: the admin’s name for the With-AI part');
await seen('ZZ-ai-title', 'assistant panel heading');
await seen('ZZ-ai-intro', 'assistant panel intro');
await seen('ZZ-ai-empty', 'assistant panel: empty question log');
ok((await text('#btn-ask')).includes('ZZ-ask 2¢'), 'assistant panel: ask button ({cost} expanded)');
await pg.click('#btn-ask');
ok((await text('#ai-log')).includes('ZZ-ai-answer at'), 'the assistant answers in the admin’s words');
await pg.click('#btn-reveal');
await pg.click('#btn-stop'); await pg.waitForSelector('#ov-stop.show'); await pg.click('#btn-stop-ok');

// 10 · debrief
await pg.waitForSelector('#s-interstitial.active');
await pg.click('#btn-continue');
await pg.waitForSelector('#s-compare.active');
await seen('ZZ-results-title', 'debrief heading');
await seen('ZZ-results-intro', 'debrief intro');
await seen('ZZ-avg-net', 'debrief stat labels');

// 11 · exit survey — the other screen that was invisible in the admin
await pg.click('#btn-compare-next');
await pg.waitForSelector('#s-survey.active');
await seen('ZZ-survey-title', 'survey heading');
await seen('ZZ-survey-question', 'survey: the ADMIN’s question');
await seen('ZZ-oh yes', 'survey: the admin’s agree/disagree scale');
ok(!(await bodyText()).includes('Strongly agree'), 'survey: the built-in scale is gone');
ok(!(await bodyText()).includes('I had a clear strategy'), 'survey: the built-in questions are gone');

// 12 · finish
await pg.click('#btn-survey-submit');
await pg.waitForSelector('#s-finish.active');
await seen('ZZ-finish-title', 'finish heading');
await seen('ZZ-finish-body', 'finish body');
await seen('ZZ-th-round', 'finish results table headers');
await seen('ZZ-bonus', 'finish bonus line');
await seen('ZZ-code-label', 'finish completion-code label');
ok((await text('#completion-code')).trim() === 'ZZCODE', 'finish: the session’s completion code');

ok(errors.length === 0, 'no page errors during the whole overridden playthrough' + (errors.length ? ` — ${errors[0]}` : ''));

// ── D. The admin panel's editors, in a browser ────────────────────────────
// The real panel needs Firebase (unreachable offline), so it is run in its own
// local-preview mode: enterLocalMode() builds and fills exactly the same
// editors, which is what we are checking.
console.log('\nD · The admin panel renders the editors and round-trips an edit');
const actx = await br.newContext({ viewport: { width: 1400, height: 1000 } });
await actx.route('**/gstatic.com/firebasejs/**', r => r.abort());
await actx.route(`${BASE}firebase.js`, r => r.fulfill({
  contentType: 'text/javascript',
  body: 'window.SVFirebase = { isConfigured: function () { return false; }, adminEmails: [], paths: {} };'
}));
const ap = await actx.newPage();
const aerrors = [];
ap.on('pageerror', e => aerrors.push(String(e.message)));
await ap.goto(BASE + 'admin/');
await ap.waitForSelector('#content-editors .accordion', { timeout: 15000 });

const groups = await ap.$$eval('#content-editors .accordion .acc-head', els => els.map(e => e.textContent.trim()));
ok(groups.length === CP.GROUPS.length, `one accordion per screen (${groups.length})`);
ok(groups.some(t => /Quick check/i.test(t)), 'there is a "Quick check (comprehension questions)" section');
ok(groups.some(t => /Exit survey/i.test(t)), 'there is an "Exit survey" section');

// The exact built-in words are the placeholder, not a "…(built-in default)" stub.
const phQuizIntro = await ap.getAttribute('#ce-quizIntro', 'placeholder');
ok(phQuizIntro === CP.TEXT.quizIntro, 'a field placeholder is the VERBATIM built-in wording');
// …and it is rendered against the settings currently in the form, so what the
// researcher reads is what their participants will read.
const formSettings = await ap.evaluate(() => window.SVAdminTest.collect());
const formCtx = {
  nTasks: formSettings.nTasks, paidTasks: formSettings.paidTasks, nPractice: formSettings.nPractice,
  nPhases: formSettings.phases.length, fee: 5, nPositions: 100, ai: formSettings.ai
};
const phInstr = await ap.getAttribute('#ce-instructions', 'placeholder');
ok(phInstr === CP.preview('instructions', formCtx), 'placeholders expand tokens against the settings in the form');
const allPh = await ap.$$eval('#content-editors [placeholder]', els => els.map(e => e.placeholder).join(' '));
ok(!/\{[a-zA-Z]+\}/.test(allPh), 'no placeholder leaves a raw {token} on screen');
ok(!/built-in default/i.test(allPh), 'no placeholder is an abridged stub any more');

// Change a setting and the wording follows it, live.
await ap.fill('#f-ntasks', '7');
await ap.dispatchEvent('#f-ntasks', 'input');
ok((await ap.getAttribute('#ce-instructions', 'placeholder')).includes('You play 7 rounds'),
  'changing a setting re-renders the built-in wording immediately');
await ap.fill('#f-ntasks', String(formSettings.nTasks));
await ap.dispatchEvent('#f-ntasks', 'input');

// The comprehension questions the report could not find are on screen, verbatim,
// with their answer key.
await ap.click('#content-editors .accordion[data-g="quiz"] .acc-head');
const quizPrompts = await ap.$$eval('#ce-quiz [data-ce-act="qprompt"]', els => els.map(e => e.value));
ok(quizPrompts.length === CP.QUIZ.common.length + CP.QUIZ.ai.length, `all ${quizPrompts.length} Quick-check questions are listed`);
ok(quizPrompts[0] === CP.QUIZ.common[0].prompt, 'the first question is shown verbatim: “' + quizPrompts[0].slice(0, 46) + '…”');
const optVals = await ap.$$eval('#ce-quiz [data-ce-act="qopt"]', els => els.map(e => e.value));
ok(CP.QUIZ.common[0].options.every(o => optVals.includes(o)), 'its answer options are all editable');
const checked = await ap.$$eval('#ce-quiz [data-ce-act="qcorrect"]', els => els.filter(e => e.checked).length);
ok(checked === quizPrompts.length, 'every question shows which answer is the correct one');

// And the exit survey.
await ap.click('#content-editors .accordion[data-g="survey"] .acc-head');
const svPrompts = await ap.$$eval('#ce-survey [data-ce-act="sprompt"]', els => els.map(e => e.value));
ok(svPrompts.length === CP.SURVEY.length && svPrompts[0] === CP.SURVEY[0].prompt, 'all exit-survey questions are listed verbatim');

// An edit is picked up: the panel stores it, and a session that changed nothing
// stores nothing (so it keeps following copy.js).
const clean = await ap.evaluate(() => JSON.stringify(window.SVAdminTest.collect().content));
ok(clean === '{}', 'an untouched form stores no copy override at all');
await ap.fill('#ce-quizTitle', 'Comprehension check');
await ap.locator('#ce-quiz [data-ce-act="qprompt"]').first().fill('My own question?');
const edited = await ap.evaluate(() => window.SVAdminTest.collect().content);
ok(edited.quizTitle === 'Comprehension check', 'a plain field edit is collected into settings.content');
ok(edited.quiz && edited.quiz.common[0].prompt === 'My own question?', 'a question edit is collected too');
ok(edited.quiz.common[0].correct === CP.QUIZ.common[0].correct, 'the answer key survives the edit');
const badge = await ap.textContent('#ce-count-quiz');
ok(/edited/.test(badge), 'the section head badges how many fields you changed');

// A blank question would be DROPPED on save (the safety rule), which silently
// loses work the admin thought they had saved — so saving says so instead.
// (Save itself is disabled in local preview, so the check is called directly.)
ok(await ap.evaluate(() => !window.SVAdminTest.validateCopy()), 'the built-in questions pass validation');
await ap.locator('#ce-quiz [data-ce-act="qadd"]').first().click();
const blankMsg = await ap.evaluate(() => window.SVAdminTest.validateCopy());
ok(/Quick check/.test(blankMsg) && /no question text/.test(blankMsg),
  'a blank question is reported before saving, not dropped silently: “' + blankMsg + '”');
ok(/copyErr\s*=\s*validateCopy\(\)/.test(adminJs) && /if \(copyErr\)/.test(adminJs),
  'Create/Save session runs that check and refuses to save');
ok(aerrors.length === 0, 'no page errors in the admin panel' + (aerrors.length ? ` — ${aerrors[0]}` : ''));

await br.close();
srv.close();
console.log(fails ? `\nSV COPY GUARD — ${fails} FAILURE(S)` : '\nSV COPY GUARD OK — every participant word is defined in copy.js, editable in the admin, and reaches the screen.');
process.exit(fails ? 1 : 0);
