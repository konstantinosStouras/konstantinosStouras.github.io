/* ==========================================================================
   search-v2  ·  tools/data-audit.mjs
   Does the data that was GENERATED agree with the data that was LOGGED?

       node lab/search-v2/tools/data-audit.mjs

   smoke.mjs asks whether the app behaves; this asks whether the record of what
   happened is faithful. It plays one whole 28-round session at the default
   parameters with a deliberately varied script — different numbers of asks and
   reveals per round, a re-query, an immediate stop, a nomination on an untouched
   position, a nomination on a position known only from the AI — and keeps its
   OWN trace of everything the participant was shown, read out of the DOM at the
   moment it was shown.

   Then it compares four things that must agree:

     1. the UI trace          what the participant actually saw
     2. the raw event log     what the browser wrote down
     3. the frozen artifacts  the pool and specs the round was built from,
                              rebuilt here in Node from the same seeds
     4. the export            the rows admin/export.js derives for analysis

   Any disagreement is a data-integrity defect: the analysis would be describing
   a session that did not happen. Cross-checking against (3) is what makes this
   more than a tautology — the log is checked against the study's own frozen
   ground truth, not merely against itself.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const CFG = require('../config.js');
const Pool = require('../pool.js');
const Specs = require('../specs.js');
const Ai = require('../ai.js');
const X = require('../admin/export.js');

const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs';
const pw = await import(PW);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml'
};
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
const BASE = `http://127.0.0.1:${srv.address().port}/lab/search-v2/`;

let fails = 0, checks = 0;
const ok = (c, m, extra) => {
  checks++;
  if (c) console.log('  ok   — ' + m);
  else { fails++; console.log('  FAIL — ' + m + (extra ? '\n         ' + extra : '')); }
};
const head = t => console.log('\n' + t);

// ── the session ────────────────────────────────────────────────────────────
const CODE = 'AUDIT01';
const br = await pw.chromium.launch(
  { executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' }).catch(() => pw.chromium.launch());
const ctx = await br.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.route(/gstatic\.com|googleapis\.com|firebaseio\.com|firebaseapp\.com/, r => r.abort());
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', e => errors.push(String(e.message)));

async function screen() { return pg.evaluate(() => { const a = document.querySelector('.screen.active'); return a ? a.id : null; }); }
async function isOn(id) { return pg.evaluate(s => { const e = document.getElementById(s); return !!e && e.classList.contains('active'); }, id); }
async function quiz(which) {
  const picks = await pg.evaluate(w => (w === 'ai' ? window.SVContent.QUIZ_AI : window.SVContent.QUIZ_BASE)
    .map(q => ({ id: q.id, a: q.answer })), which);
  for (const q of picks) await pg.locator(`input[name="${q.id}"][value="${q.a}"]`).first().check();
}
// One number out of the flash line, which is the ONLY place the participant is
// told what they just bought.
function flashNumber(t) { const m = String(t).match(/(-?\d+)\s*(?:at position|$)|holds\s+(-?\d+)|says\s+(-?\d+)/); return m ? +(m[1] ?? m[2] ?? m[3]) : null; }

await pg.goto(BASE + `?code=AUDIT&pcode=${CODE}&PROLIFIC_PID=${CODE}`);
await pg.waitForSelector('#s-consent.active', { timeout: 20000 });
await pg.locator('#consent-box').check();
await pg.locator('#btn-consent').click();
// Registration sits between consent and the instructions (background, all
// optional); a standalone run like this one is asked, so click through it.
await pg.waitForSelector('#s-registration.active, #s-instructions.active');
if (await pg.locator('#s-registration.active').count()) await pg.locator('#btn-reg').click();
await pg.waitForSelector('#s-instructions.active');
const nInstr = await pg.evaluate(() => window.SVContent.INSTRUCTIONS.length);
for (let i = 0; i < nInstr; i++) await pg.locator('#btn-instr-next').click();
await pg.waitForSelector('#s-quiz.active');
await quiz('base');
await pg.locator('#btn-quiz').click();
await pg.waitForSelector('#s-blockintro.active, #s-round.active');

const plan = await pg.evaluate(() => window.SVApp.plan());
const sequence = (await pg.evaluate(() => window.SVApp.state())).sequence;

// The independent trace. One entry per round, appended AS IT HAPPENS.
const trace = [];

for (let i = 0; i < plan.length; i++) {
  if (await isOn('s-blockintro')) await pg.locator('#btn-bi').click();
  if (await isOn('s-aiinstructions')) {
    const n = await pg.evaluate(() => window.SVContent.AI_INSTRUCTIONS.length);
    for (let k = 0; k < n; k++) await pg.locator('#btn-ai-next').click();
    await pg.waitForSelector('#s-aiquiz.active');
    await quiz('ai');
    await pg.locator('#btn-aiquiz').click();
    await pg.waitForSelector('#s-blockintro.active, #s-round.active');
    if (await isOn('s-blockintro')) await pg.locator('#btn-bi').click();
  }
  if (await isOn('s-blockintro')) await pg.locator('#btn-bi').click();
  await pg.waitForSelector('#s-round.active', { timeout: 15000 });
  // A milestone pop-up can open with the round and would swallow every click.
  if (await pg.locator('#ov-encourage.show').count()) await pg.locator('#btn-enc-ok').click();

  const r = plan[i];
  const t = { round: i + 1, cond: r.cond, scored: r.scored, acts: [], nominated: null, shown: null, score: null };
  const aiOn = await pg.locator('#btn-ask').isVisible();

  // A varied script, so the audit covers the shapes a real session contains
  // rather than one well-behaved path repeated 28 times.
  const mode = i % 5;
  const asks = aiOn ? [0, 2, 1, 3, 0][mode] : 0;
  const reveals = [1, 2, 0, 1, 3][mode];
  const askAt = [17, 41, 63, 88, 5];
  const revAt = [24, 52, 71, 9, 95];

  for (let k = 0; k < asks; k++) {
    const pos = askAt[(i + k) % askAt.length];
    await pg.evaluate(p => window.SVApp.select(p), pos);
    await pg.waitForFunction(() => !document.getElementById('btn-ask').disabled, null, { timeout: 8000 });
    await pg.locator('#btn-ask').click();
    await pg.waitForSelector('.answer-flash.show', { timeout: 8000 });
    const txt = await pg.locator('#answer-flash').innerText();
    t.acts.push({ action: 'query', pos, shown: flashNumber(txt), text: txt.trim() });
  }
  // Re-query once, in the first AI round with any asks: the same position twice
  // must produce two rows and be charged twice.
  if (asks > 0 && !trace.some(x => x.acts.some(a => a.requery))) {
    const pos = askAt[i % askAt.length];
    await pg.evaluate(p => window.SVApp.select(p), pos);
    await pg.waitForFunction(() => !document.getElementById('btn-ask').disabled, null, { timeout: 8000 });
    await pg.locator('#btn-ask').click();
    await pg.waitForSelector('.answer-flash.show', { timeout: 8000 });
    const txt = await pg.locator('#answer-flash').innerText();
    t.acts.push({ action: 'query', pos, shown: flashNumber(txt), text: txt.trim(), requery: true });
  }
  // Reveal positions are CHOSEN, not fixed: a pre-opened position cannot be
  // revealed, and which positions start open moves whenever the specs are
  // regenerated. Wait out the latency (which disables every button), then take
  // the first candidate the app will actually let us pay for.
  const revealed = [];
  for (let k = 0; k < reveals; k++) {
    await pg.waitForFunction(() => !document.getElementById('btn-nominate').disabled, null, { timeout: 8000 });
    let pos = null;
    for (const cand of [revAt[(i + k) % revAt.length], 24, 52, 71, 9, 95, 33, 66, 12, 87]) {
      if (revealed.indexOf(cand) >= 0) continue;
      await pg.evaluate(p => window.SVApp.select(p), cand);
      if (!(await pg.locator('#btn-reveal').isDisabled())) { pos = cand; break; }
    }
    if (pos == null) break;
    await pg.locator('#btn-reveal').click();
    await pg.waitForSelector('.answer-flash.show', { timeout: 8000 });
    const txt = await pg.locator('#answer-flash').innerText();
    revealed.push(pos);
    t.acts.push({ action: 'reveal', pos, shown: flashNumber(txt), text: txt.trim() });
  }

  // Where they stop: a revealed position, an untouched one, or an AI-known one.
  let nomPos;
  if (revealed.length && mode !== 3) nomPos = revealed[0];
  else if (asks > 0) nomPos = askAt[i % askAt.length];
  else nomPos = 50;
  await pg.evaluate(p => window.SVApp.select(p), nomPos);
  await pg.waitForFunction(() => !document.getElementById('btn-nominate').disabled, null, { timeout: 8000 });
  await pg.locator('#btn-nominate').click();
  // The focus prompt can interpose once per half when a round is closed after
  // almost no searching; "Stop anyway" re-enters the normal path, so the
  // untouched-position confirmation below still applies.
  if (await pg.locator('#ov-encourage.show').count()) await pg.locator('#btn-enc-alt').click();
  if (await pg.locator('#ov-nominate.show').count()) await pg.locator('#btn-nom-ok').click();
  await pg.waitForSelector('#s-interstitial.active', { timeout: 15000 });

  // The running ledger, captured DURING the round (the browser is closed before
  // the checks run, so anything read from the DOM has to be taken here).
  if (i === 0) {
    trace.panel = await pg.evaluate(() => ({
      hasList: !!document.getElementById('touched-list'),
      net: (document.querySelector('.ss.net .ss-l') || {}).textContent || '',
      netVal: (document.getElementById('c-net') || {}).textContent || '',
      best: (document.getElementById('c-best') || {}).textContent || '',
      total: (document.getElementById('c-total-cost') || {}).textContent || '',
      bandNet: (document.getElementById('sb-net') || {}).textContent || '',
      bandBest: (document.getElementById('sb-best') || {}).textContent || '',
      bandReveal: (document.getElementById('sb-reveal') || {}).textContent || ''
    }));
  }
  // What the participant is told, itemised — checked on the first round.
  if (i === 0) {
    const led = await pg.locator('#inter-body .ledger').innerText();
    trace.ledger = led.replace(/\s+/g, ' ').trim();
  }
  const body = await pg.locator('#inter-body').innerText();
  t.nominated = nomPos;
  t.shown = (body.match(/position\s+\d+[^0-9-]*?(-?\d+)/) || [])[1];
  t.shown = t.shown == null ? null : +t.shown;
  const sm = body.match(/Round score[^0-9-]*(-?\d+)/i);
  t.score = sm ? +sm[1] : null;
  t.body = body.replace(/\s+/g, ' ').trim();
  trace.push(t);

  await pg.locator('#btn-continue').click();
  await pg.waitForTimeout(40);
}

await pg.waitForSelector('#s-survey.active', { timeout: 20000 });
await pg.evaluate(() => {
  // Answer whatever the page rendered — first option, text, a number — exactly
  // as smoke.mjs does, so the survey's own validation is satisfied.
  document.querySelectorAll('#survey-body .survey-q').forEach(q => {
    const radios = q.querySelectorAll('input[type=radio]');
    if (radios.length) radios[0].checked = true;
    const boxes = q.querySelectorAll('input[type=checkbox]');
    if (boxes.length) boxes[0].checked = true;
    q.querySelectorAll('textarea').forEach(t => { t.value = 'data audit'; });
    q.querySelectorAll('input[type=number]').forEach(n => { n.value = '1'; });
  });
});
await pg.locator('#btn-survey').click();
await pg.waitForSelector('#s-debrief.active, #s-done.active', { timeout: 20000 });
if (await isOn('s-debrief')) { await pg.locator('#btn-debrief').click(); }
await pg.waitForSelector('#s-done.active', { timeout: 20000 });

// The log, as the browser left it.
const events = await pg.evaluate(code => {
  const raw = localStorage.getItem('searchv2:log:' + code);
  return raw ? JSON.parse(raw) : [];
}, CODE);

await br.close();
srv.close();

// ── rebuild the frozen artifacts here, from the same seeds ────────────────
const P = Specs.withDefaults(null);
const pool = Pool.buildPool(P.env, P.env.generatorSeed);
const specs = Specs.buildSpecs(pool, P, null);
const sess = Specs.sessionPlan(specs, CODE, sequence, P);
const built = X.build(events, { id: null, params: P, code: 'AUDIT' });

const rows = ev => events.filter(e => e.event === ev);
const num = v => (v == null || v === '' ? null : +v);

console.log('\n═══ search-v2 · data audit ═══');
console.log(`sequence ${sequence} · ${events.length} logged rows · ${trace.length} rounds played`);

// ── 1 · the session skeleton ──────────────────────────────────────────────
head('1 · the session is logged end to end');
ok(rows('session_start').length === 1, 'exactly one session_start row');
ok(rows('session_end').length === 1, 'exactly one session_end row — the Simulation Platform joins on this');
ok(rows('session_end')[0] && rows('session_end')[0].pid === CODE,
  'and it carries the student id as pid', JSON.stringify(rows('session_end')[0] && rows('session_end')[0].pid));
ok(rows('round_start').length === 28, 'one round_start per round (28)', String(rows('round_start').length));
ok(rows('round_end').length === 28, 'one round_end per round (28)', String(rows('round_end').length));
// The survey is logged ONE ROW PER QUESTION, not one row per survey.
ok(rows('survey').length >= 10, 'the survey is logged, one row per question',
  rows('survey').length + ' rows');
ok(new Set(rows('survey').map(e => e.question_id)).size === rows('survey').length,
  'with no question logged twice');
ok(rows('comprehension').length >= 1, 'the comprehension gates are logged');
const seqSeen = new Set(events.map(e => e.seq));
ok(seqSeen.size === events.length, 'every row has a distinct sequence number — nothing overwrote anything',
  `${events.length} rows, ${seqSeen.size} distinct seq`);
ok(events.every(e => e.participant_code === CODE),
  'every row is attributed to this participant');
const ts = events.map(e => e.t);
ok(ts.every((v, i) => i === 0 || v >= ts[i - 1]), 'rows are in non-decreasing time order');

// ── 2 · every action taken is an action logged ────────────────────────────
head('2 · what the participant did is what the log says they did');
const uiActs = trace.flatMap(t => t.acts.map(a => ({ round: t.round, ...a })));
const logActs = events.filter(e => e.event === 'decision' && e.action !== 'stop')
  .map(e => ({ round: num(e.round_index), action: e.action, pos: num(e.position), val: num(e.value) }));
ok(logActs.length === uiActs.length,
  `every query and reveal reached the log exactly once (${uiActs.length} taken, ${logActs.length} logged)`,
  logActs.length !== uiActs.length ? JSON.stringify({ ui: uiActs.length, log: logActs.length }) : '');

let mismatch = [];
uiActs.forEach((a, i) => {
  const l = logActs[i];
  if (!l) { mismatch.push(`#${i} missing from the log`); return; }
  if (l.round !== a.round || l.action !== a.action || l.pos !== a.pos)
    mismatch.push(`#${i} ui=${a.round}/${a.action}/${a.pos} log=${l.round}/${l.action}/${l.pos}`);
  if (a.shown != null && l.val !== a.shown)
    mismatch.push(`#${i} round ${a.round} ${a.action} p${a.pos}: shown ${a.shown}, logged ${l.val}`);
});
ok(mismatch.length === 0, 'each row matches the action it records — round, kind, position and the number shown',
  mismatch.slice(0, 6).join(' | '));

const requery = uiActs.filter(a => a.requery);
ok(requery.length === 1 && logActs.filter(l => l.round === requery[0].round && l.action === 'query' && l.pos === requery[0].pos).length === 2,
  'a re-query of the same position is logged as two rows, not collapsed into one');

// ── 3 · the numbers shown were the TRUE numbers of the frozen round ───────
head('3 · what was shown agrees with the frozen artifacts');
let vBad = [], aBad = [];
trace.forEach(t => {
  const r = sess.rounds[t.round - 1];
  const map = pool[r.spec.mapping_index];
  const known = r.spec.pre_opened.slice();
  t.acts.forEach(a => {
    if (a.action === 'reveal') {
      if (a.shown !== map[a.pos - 1]) vBad.push(`round ${t.round} p${a.pos}: shown ${a.shown}, mapping says ${map[a.pos - 1]}`);
      known.push(a.pos);
    } else {
      const anchors = Ai.anchorSet(r.spec.ai_anchors, r.spec.pre_opened, known.filter(p => !r.spec.pre_opened.includes(p)), map);
      const want = Ai.aiAnswer(anchors, a.pos, P.ai.answerRounding);
      if (a.shown !== want) aBad.push(`round ${t.round} p${a.pos}: AI said ${a.shown}, rule gives ${want}`);
    }
  });
});
ok(vBad.length === 0, 'every revealed value is the true prize of that round’s mapping', vBad.slice(0, 5).join(' | '));
ok(aBad.length === 0, 'every AI answer is what §12’s rule gives for the anchor set at that moment',
  aBad.slice(0, 5).join(' | '));

const nomBad = trace.filter(t => {
  const map = pool[sess.rounds[t.round - 1].spec.mapping_index];
  return t.shown != null && t.shown !== map[t.nominated - 1];
});
ok(nomBad.length === 0, 'the prize revealed at the nominated position is the mapping’s own value',
  nomBad.slice(0, 4).map(t => `round ${t.round}: shown ${t.shown}, mapping ${pool[sess.rounds[t.round - 1].spec.mapping_index][t.nominated - 1]}`).join(' | '));

// ── 4 · the score the participant was told is the score in the data ───────
head('4 · the score shown is the score recorded');
const exp = built.rounds.slice().sort((a, b) => a.round_index - b.round_index);
ok(exp.length === 28, 'the export derives 28 round rows', String(exp.length));
let sBad = [], cBad = [], nBad = [];
trace.forEach((t, i) => {
  const e = exp[i];
  if (!e) { sBad.push(`round ${t.round} missing from the export`); return; }
  const nq = t.acts.filter(a => a.action === 'query').length;
  const nr = t.acts.filter(a => a.action === 'reveal').length;
  const cost = nq * P.costs.queryCost + nr * P.costs.revealCost;
  const map = pool[sess.rounds[t.round - 1].spec.mapping_index];
  const want = map[t.nominated - 1] - cost;
  if (t.score != null && t.score !== want) sBad.push(`round ${t.round}: shown ${t.score}, arithmetic gives ${want}`);
  if (e.final_score !== want) sBad.push(`round ${t.round}: export ${e.final_score}, arithmetic gives ${want}`);
  if (e.total_cost !== cost) cBad.push(`round ${t.round}: export cost ${e.total_cost}, actually ${cost}`);
  if (e.n_queries !== nq || e.n_reveals !== nr)
    cBad.push(`round ${t.round}: export ${e.n_queries}q/${e.n_reveals}r, actually ${nq}q/${nr}r`);
  if (e.nominated_position !== t.nominated) nBad.push(`round ${t.round}: export nominated ${e.nominated_position}, actually ${t.nominated}`);
  if (e.nominated_true_value !== map[t.nominated - 1])
    nBad.push(`round ${t.round}: export value ${e.nominated_true_value}, mapping ${map[t.nominated - 1]}`);
});
ok(sBad.length === 0, 'score = true prize at the nominated position − everything spent, in the UI and in the export',
  sBad.slice(0, 5).join(' | '));
ok(cBad.length === 0, 'the action counts and the total cost carry through', cBad.slice(0, 5).join(' | '));
ok(nBad.length === 0, 'the nominated position and its true value carry through', nBad.slice(0, 5).join(' | '));
const floorBad = exp.filter(e => e.final_score !== e.raw_score);
ok(floorBad.length === 0, 'no floor is applied — the raw score IS the score, so a negative round survives',
  floorBad.slice(0, 4).map(e => `round ${e.round_index}: final ${e.final_score} vs raw ${e.raw_score}`).join(' | '));
ok(exp.some(e => e.final_score < 0), 'and the script did produce at least one negative round to prove it',
  'scores: ' + exp.map(e => e.final_score).join(','));

// ── 5 · each row is filed under the round it belongs to ───────────────────
head('5 · every row is filed under the right round of the right block');
let fBad = [];
exp.forEach((e, i) => {
  const r = sess.rounds[i];
  if (e.spec_id !== r.spec.spec_id) fBad.push(`round ${i + 1}: spec ${e.spec_id} ≠ ${r.spec.spec_id}`);
  if (e.block !== r.block) fBad.push(`round ${i + 1}: block ${e.block} ≠ ${r.block}`);
  if (e.condition !== r.condition) fBad.push(`round ${i + 1}: condition ${e.condition} ≠ ${r.condition}`);
  if (e.seed_shape !== r.spec.seed_shape) fBad.push(`round ${i + 1}: shape ${e.seed_shape} ≠ ${r.spec.seed_shape}`);
  if (e.ai_density !== r.spec.ai_density) fBad.push(`round ${i + 1}: density ${e.ai_density} ≠ ${r.spec.ai_density}`);
});
ok(fBad.length === 0, 'spec id, block, condition, seed shape and AI density all match the frozen plan',
  fBad.slice(0, 5).join(' | '));
const aiOnRounds = exp.filter(e => e.condition === 'AI_ON');
ok(aiOnRounds.every(e => true) && exp.filter(e => e.condition === 'AI_OFF').every(e => e.n_queries === 0),
  'no query is recorded in an AI-off round — the button is not there to press');
ok(new Set(exp.map(e => e.mapping_index)).size === 28,
  'all 28 rounds used a different mapping, as the validation gate promises');

// ── 6 · the decision rows ─────────────────────────────────────────────────
head('6 · the per-decision rows');
const dec = built.decisions;
ok(dec.filter(d => d.action !== 'stop').length === uiActs.length,
  'one decision row per action taken', `${dec.filter(d => d.action !== 'stop').length} vs ${uiActs.length}`);
ok(dec.filter(d => d.action === 'stop').length === 28, 'plus one stop row per round');
ok(dec.filter(d => d.is_first_decision).length === 28,
  'exactly one first decision per round — the primary analysis moment');
let iBad = [];
dec.filter(d => d.action === 'reveal').forEach(d => {
  const r = sess.rounds[d.round_index - 1];
  const map = pool[r.spec.mapping_index];
  if (d.true_value_at_choice !== map[d.position - 1])
    iBad.push(`round ${d.round_index} p${d.position}: ${d.true_value_at_choice} ≠ ${map[d.position - 1]}`);
});
ok(iBad.length === 0, 'a reveal row carries the true prize at the position chosen', iBad.slice(0, 5).join(' | '));
let gBad = [];
dec.filter(d => d.action === 'query').forEach(d => {
  if (d.ai_prediction == null) gBad.push(`round ${d.round_index} p${d.position}: no ai_prediction`);
  if (d.choice_region == null) gBad.push(`round ${d.round_index} p${d.position}: no choice_region`);
  // dist_to_nearest_anchor is measured against the PARTICIPANT's known set, so
  // it is legitimately null before they know anything — and then the region must
  // say so rather than claiming a gap or a tail.
  if (d.dist_to_nearest_anchor == null && d.choice_region !== 'open')
    gBad.push(`round ${d.round_index} p${d.position}: null distance but region "${d.choice_region}"`);
  if (d.dist_to_nearest_anchor != null && d.choice_region === 'open')
    gBad.push(`round ${d.round_index} p${d.position}: region "open" but distance ${d.dist_to_nearest_anchor}`);
});
ok(gBad.length === 0, 'every query row carries its §16.8 geometry, null only where nothing is known yet',
  gBad.slice(0, 5).join(' | '));

// ── 7 · the participant row ───────────────────────────────────────────────
head('7 · the participant row');
const pr = built.participants[0];
ok(built.participants.length === 1, 'one participant row');
ok(pr && pr.participant_code === CODE, 'keyed by the participant code');
ok(pr && pr.sequence === sequence, 'carrying the sequence that was actually assigned');
ok(pr && pr.rounds_done === 28, 'and 28 rounds done', String(pr && pr.rounds_done));
ok(pr && pr.scored_rounds_done === 24, 'of which 24 are scored', String(pr && pr.scored_rounds_done));
const totalScore = exp.reduce((s, e) => s + (e.scored ? e.final_score : 0), 0);
ok(pr && pr.total_score === totalScore,
  'the participant total is the sum of the scored rounds only', `${pr && pr.total_score} vs ${totalScore}`);
ok(pr && pr.completed === true, 'and the row is marked completed');
const surveyCols = Object.keys(pr || {}).filter(k => k.indexOf('survey_') === 0 && pr[k] != null);
ok(surveyCols.length >= 10, 'the survey answers reach the participant row as columns',
  surveyCols.length + ' populated');

// ── 8 · the participant was told where their score went ───────────────────
head('8 · the running ledger on the round screen');
{
  const pnl = trace.panel || {};
  ok(pnl.hasList === false,
    'the list that repeated every mark in words is gone — the plot already carries them');
  ok(/stop right now/.test(pnl.net), 'the running score is labelled "if you stop right now"', pnl.net);
  ok(!/unknown/.test(pnl.netVal), 'and it never reads "unknown" — it is the best prize held minus what was spent', pnl.netVal);
  ok(/\d/.test(pnl.total), 'the total spent this round is on screen', pnl.total);
  ok(/\d/.test(pnl.best) || pnl.best.trim() === '—', 'so is the best prize found', pnl.best);
  // The headline band under the plot: the four numbers that decide the round.
  ok(/\d/.test(pnl.bandBest), 'the band under the plot shows the best prize found', pnl.bandBest);
  ok(/\d/.test(pnl.bandReveal), 'and what was spent revealing', pnl.bandReveal);
  ok(/\d/.test(pnl.bandNet) && /spent/.test(pnl.bandNet),
    'and the NET VALUE, with the arithmetic beside it', pnl.bandNet);
}

head('9 · the round result is itemised for the participant');
const led = trace.ledger || '';
ok(/Prize at position/.test(led), 'the prize won is named with its position', led.slice(0, 140));
ok(/Cost of revealing/.test(led), 'the cost of revealing is shown as its own line');
ok(/Round score/.test(led), 'and the round score closes the sum');
{
  const nums = (led.match(/[+−-]?\d+/g) || []).map(x => +x.replace('−', '-'));
  ok(nums.length >= 3, 'every line carries a number', led);
}

// ── 9 · nothing was invented ──────────────────────────────────────────────
head('10 · nothing in the log was invented');
const known = new Set(['session_start', 'session_end', 'round_start', 'round_end', 'decision',
  'comprehension', 'registration', 'survey', 'instructions', 'telemetry', 'slider', 'attention',
  'debrief', 'consent', 'block_start']);
const unknown = [...new Set(events.map(e => e.event))].filter(e => !known.has(e));
ok(unknown.length === 0, 'every row is of a known kind', unknown.join(', '));
ok(events.every(e => e.bot !== true), 'no bot rows contaminated a real session');
ok(errors.length === 0, 'no page errors during the whole session', errors.slice(0, 3).join(' | '));

// The evidence, so a failure can be read rather than re-run.
const outDir = process.env.SV_AUDIT_OUT || '';
if (outDir) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(outDir, 'audit-events.json'), JSON.stringify(events, null, 1));
  writeFileSync(join(outDir, 'audit-trace.json'), JSON.stringify(trace, null, 1));
  writeFileSync(join(outDir, 'audit-rounds.json'), JSON.stringify(built.rounds, null, 1));
  console.log('\nevidence written to ' + outDir);
}

console.log('');
if (fails) { console.log(`DATA AUDIT FAILED — ${fails} of ${checks} checks`); process.exit(1); }
console.log(`DATA AUDIT OK — all ${checks} checks passed; the log agrees with the session that was played.`);
