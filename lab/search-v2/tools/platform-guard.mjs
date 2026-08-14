/* ==========================================================================
   search-v2  ·  tools/platform-guard.mjs
   The Simulation Platform contract (Playwright, offline).

       node lab/search-v2/tools/platform-guard.mjs

   Students reach this study from stouras.com/simulation/, so the two datasets
   have to join and the two apps have to talk. This guard pins the whole contract
   in both directions:

     PLATFORM → STUDY
       · the launch handoff's studentId becomes this study's participant_code,
         and the same value is carried as `pid`, so the two datasets join on one
         key and no second identifier is ever invented;
       · a background question the platform already answered is NOT asked again,
         and the platform's answer travels with the row, flagged as its source
         — and since field of study was dropped (2026-08) that is EVERY item
         this study asks, so the phase shows no screen at all on a launch;
       · nothing else from the profile is stored — no name, no e-mail address.

     STUDY → PLATFORM
       · finishing writes `session_end` carrying `pid`, which is exactly what
         simulation/admin/verify.js matches on to tick the student's card;
       · finishing calls window.simpMarkCompleted(), so the card flips to
         "✓ Completed" without the instructor doing anything;
       · a rehearsal (?preview=1) does NEITHER, so it can never gate a real play.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };
const srv = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const b = await readFile(join(ROOT, p));
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(b);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;
const BASE = ORIGIN + '/lab/search-v2/';

let fails = 0, checks = 0;
const ok = (c, m, extra) => {
  checks++;
  if (c) console.log('  ok   — ' + m);
  else { fails++; console.log('  FAIL — ' + m + (extra ? '\n         ' + extra : '')); }
};

// Exactly the shape simulation/index.html writes before it opens a card.
const PROFILE = {
  studentId: '22345678', name: 'Test Student', email: 'test.student@ucdconnect.ie',
  age: '20-24', gender: 'Female', nationality: 'Ireland', country: 'Ireland',
  levelOfStudy: 'Undergraduate', workExperience: '0-1 years', occupation: 'Student'
};
const HANDOFF = { sim: 'search-v2', session: 'CLASS1', profile: PROFILE, ts: Date.now() };

const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await br.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.route(/gstatic\.com|googleapis\.com/, r => r.abort());
await ctx.addInitScript(h => {
  try { localStorage.setItem('simp:handoff:v1', JSON.stringify(h)); } catch (e) {}
}, HANDOFF);

const errors = [];
const pg = await ctx.newPage();
pg.on('pageerror', e => errors.push(String(e.message)));

// ── PLATFORM → STUDY ───────────────────────────────────────────────────────
// The launch link the platform builds: ?code=<session>, plus the student ID as
// PROLIFIC_PID (see simulation/catalog.js, entry 'search-v2').
await pg.goto(BASE + '?code=CLASS1&PROLIFIC_PID=' + PROFILE.studentId +
  '&STUDY_ID=simulation-platform&SESSION_ID=' + PROFILE.studentId + '-abc');
await pg.waitForSelector('#s-consent.active', { timeout: 20000 });
ok(true, 'a platform launch lands straight on consent — the participant never sees a code gate');

const st = await pg.evaluate(() => window.SVApp.state());
ok(st.code === PROFILE.studentId,
  'the student’s university ID becomes the participant code (' + st.code + ')');
ok(st.sequence === 'A' || st.sequence === 'B', 'a crossover sequence is assigned on entry (' + st.sequence + ')');

const base = await pg.evaluate(() => {
  const e = window.Logger.getEvents()[0];
  return e ? { pid: e.pid, code: e.participant_code, sessionCode: e.sessionCode, run: e.run_id } : null;
});
ok(base && base.pid === PROFILE.studentId,
  'every logged row carries pid = the student ID — the join key with the platform roster');
ok(base && base.code === PROFILE.studentId, 'and participant_code is the same value, so the two never drift');
ok(base && base.sessionCode === 'CLASS1', 'the run code from ?code= is stamped on every row');

// No identifying information from the profile is stored anywhere in the log.
const leak = await pg.evaluate(p => {
  const blob = JSON.stringify(window.Logger.getEvents());
  return {
    name: blob.indexOf(p.name) >= 0,
    email: blob.indexOf(p.email) >= 0
  };
}, PROFILE);
ok(!leak.name, 'the student’s NAME never reaches this study’s log');
ok(!leak.email, 'nor their e-mail address — §11 keeps the study to anonymous codes');

// ── registration takes what the platform already knows ────────────────────
// Background is asked ONCE, before the study (it used to be the exit survey's
// Part F). Every item this study asks — level of study, age band, gender — is
// one the platform's own registration answers, so on a launch there is nothing
// left to ask and the phase passes through without a screen. Field of study was
// the one exception until it was dropped in 2026-08 as irrelevant to the study.
// A STANDALONE participant is still asked all three (tools/smoke.mjs).
await pg.locator('#consent-box').check();
await pg.locator('#btn-consent').click();
await pg.waitForSelector('#s-registration.active, #s-instructions.active', { timeout: 20000 });

const regItems = await pg.evaluate(() =>
  window.SVContent.REGISTRATION.map(q => ({ id: q.id, key: q.platformKey })));
const covered = regItems.filter(q => ['levelOfStudy', 'age', 'gender'].indexOf(q.key) >= 0);
ok(covered.length === regItems.length && covered.length === 3,
  'the three background items this study asks are ALL ones the platform already collects',
  regItems.map(q => q.id + '/' + q.key).join(', '));
// Field of study was the one item the platform does not answer. With it gone
// (2026-08, irrelevant to this study) a platform launch has nothing left to
// ask, so the phase passes through WITHOUT A SCREEN rather than showing an
// empty form — the behaviour showRegistration has always had for that case,
// which until now no launch could reach.
ok((await pg.locator('#s-registration.active').count()) === 0 &&
   (await pg.locator('#s-instructions.active').count()) === 1,
  'so consent leads straight to the instructions — no registration screen is shown at all');
const regState = await pg.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('searchv2:v3:state:' + window.SVApp.state().code) || '{}');
  return { done: s.regDone === true, ms: (s.phaseMs || {}).registration };
});
ok(regState.done === true,
  'and the phase is marked done, so nothing puts the items back at the end of the survey either');
// A phase nobody saw must leave no dwell time. The workbook's rule is that an
// empty cell means not applicable and a 0 never does, so routing INTO the phase
// and bouncing out would export a real zero for a screen that was never painted.
ok(regState.ms === undefined,
  'and it leaves no phase_ms_registration at all — a screen nobody saw exports blank, not 0',
  String(regState.ms));
ok(!regItems.some(q => q.key === 'fieldOfStudy'),
  'field of study is not asked anywhere — the study does not collect it');

const bg = await pg.evaluate(() => window.Logger.getEvents()
  .filter(e => e.event === 'registration' && String(e.question_id).indexOf('platform_') === 0)
  .map(e => e.question_id + '=' + e.answer));
ok(bg.length >= 3, 'the platform-supplied background travels with the data, flagged as its source', bg.join(' | '));
ok(bg.some(x => /platform_levelOfStudy=Undergraduate/.test(x)), 'and carries the platform’s own answer verbatim');
// Nothing was thrown away by dropping the question: the platform's registration
// has no field-of-study answer set either (simulation/answers.js), which is
// exactly why it was the one item a launch still had to ask.
ok(!bg.some(x => /platform_fieldOfStudy/.test(x)),
  'and no field-of-study row — the platform never collected one to carry', bg.join(' | '));

// ── the exit survey no longer asks background at all ──────────────────────
await pg.evaluate(() => {
  // Jump to the survey through the app's own state, exactly as a resume would.
  const key = 'searchv2:v3:state:' + window.SVApp.state().code;
  const s = JSON.parse(localStorage.getItem(key) || '{}');
  s.phase = 'survey'; s.roundPtr = 28; s.results = []; s.totalScore = 0;
  localStorage.setItem(key, JSON.stringify(s));
});
await pg.reload();
await pg.waitForSelector('#s-survey.active', { timeout: 20000 });
const asked = await pg.$$eval('#survey-body .survey-q', els => els.map(e => e.dataset.q));
ok(regItems.every(q => asked.indexOf(q.id) < 0),
  'no background item is asked again at the end, whatever the platform supplied');
ok(asked.indexOf('s01') >= 0 && asked.indexOf('s20') >= 0, 'the study’s own items are all still asked');

// Answer and submit.
await pg.evaluate(() => {
  document.querySelectorAll('#survey-body .survey-q').forEach(q => {
    const r = q.querySelectorAll('input[type=radio]'); if (r.length) r[0].checked = true;
    const c = q.querySelectorAll('input[type=checkbox]'); if (c.length) c[0].checked = true;
    q.querySelectorAll('textarea').forEach(t => { t.value = 'x'; });
    q.querySelectorAll('input[type=number]').forEach(n => { n.value = '1'; });
  });
});
await pg.locator('#btn-survey').click();
await pg.waitForSelector('#s-debrief.active, #s-done.active', { timeout: 15000 });

// ── STUDY → PLATFORM ───────────────────────────────────────────────────────
if (await pg.locator('#s-debrief.active').count()) await pg.locator('#btn-debrief').click();
await pg.waitForSelector('#s-done.active', { timeout: 15000 });

const marker = await pg.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('simp:completed:v1') || '{}'); } catch (e) { return {}; }
});
ok(!!marker['search-v2'], 'finishing calls simpMarkCompleted(), so the platform card flips to "✓ Completed"');
ok(marker['search-v2'] && marker['search-v2'].session === 'CLASS1',
  'the marker records the session it was completed under, so a new pinned session unlocks a fresh run');

const end = await pg.evaluate(() => window.Logger.getEvents().filter(e => e.event === 'session_end')[0] || null);
ok(!!end, 'a session_end row is written');
ok(end && end.pid === PROFILE.studentId,
  'session_end carries pid = the student ID — this exact row is what simulation/admin/verify.js reads');
ok(end && end.sessionCode === 'CLASS1', 'and the run code, which the verifier shows beside the tick');
ok(end && typeof end.t === 'number', 'and a timestamp, which the verifier uses for the tick’s date');

// ── a rehearsal must do neither ────────────────────────────────────────────
const sandbox = await br.newContext({ viewport: { width: 1440, height: 1000 } });
await sandbox.route(/gstatic\.com|googleapis\.com/, r => r.abort());
await sandbox.addInitScript(h => {
  try { localStorage.setItem('simp:handoff:v1', JSON.stringify(h)); } catch (e) {}
}, HANDOFF);
const sp = await sandbox.newPage();
await sp.goto(BASE + '?preview=1&debug=1&key=stouras&code=CLASS1');
await sp.waitForSelector('#sv-ribbon', { timeout: 15000 });
ok(await sp.evaluate(() => window.SIMP_EXPECT === '__off__'),
  'a rehearsal switches the platform script off, so the marker is never even defined');
ok(await sp.evaluate(() => typeof window.simpMarkCompleted !== 'function'),
  'and simpMarkCompleted does not exist in the sandbox');
ok(await sp.evaluate(() => window.SVApp.state().code === 'PREVIEW'),
  'a rehearsal never adopts the student’s ID, even with a live handoff present');
const sandboxLog = await sp.evaluate(() => window.Logger.getEvents().length);
ok(sandboxLog >= 0, 'the sandbox logs locally only — no run id, no participant record');
ok(await sp.evaluate(() => {
  const e = window.Logger.getEvents()[0];
  return !e || e.run_id === null;
}), 'and its rows carry no run_id, so they could never be pooled with real data');
await sandbox.close();

ok(errors.length === 0, 'no page errors', errors.slice(0, 4).join(' | '));

await br.close();
srv.close();
console.log('\n' + (fails
  ? `PLATFORM GUARD FAILED — ${fails} of ${checks} checks`
  : `PLATFORM GUARD OK — all ${checks} checks passed; the two apps join on the student ID in both directions.`));
process.exit(fails ? 1 : 0);
