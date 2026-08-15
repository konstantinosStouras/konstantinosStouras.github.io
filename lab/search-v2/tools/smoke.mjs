/* ==========================================================================
   search-v2  ·  tools/smoke.mjs
   Browser acceptance tests (Playwright, offline — the Firebase SDK and every
   other external host are blocked, so this exercises the app exactly as it
   behaves when the network is unavailable).

       node lab/search-v2/tools/smoke.mjs
       CHROMIUM=/path/to/chrome node lab/search-v2/tools/smoke.mjs
       SV_BROWSERS=chromium,firefox,webkit node lab/search-v2/tools/smoke.mjs

   It plays a WHOLE session — consent, the five instruction screens, both
   comprehension gates, all 28 rounds, the exit survey, the debrief and the done
   screen — and asserts, along the way, the things the design brief is strict
   about: that the "Ask the AI" button is ABSENT (not disabled) in an AI-off
   round, that a query never reveals the truth, that a reveal cannot be charged
   twice, that the score is the true prize at the nominated position minus what
   was spent, and that every decision reaches the log with its full information
   state.

   Only the engines actually installed are run; the rest are reported as skipped.
   ========================================================================== */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  if (c) console.log('    ok   — ' + m);
  else { fails++; console.log('    FAIL — ' + m + (extra ? '\n           ' + extra : '')); }
};

const WANTED = (process.env.SV_BROWSERS || 'chromium,firefox,webkit').split(',').map(s => s.trim());
const EXEC = { chromium: process.env.CHROMIUM || '/opt/pw-browsers/chromium' };

async function launch(name) {
  const type = pw[name];
  if (!type) return null;
  try {
    return await type.launch(EXEC[name] ? { executablePath: EXEC[name] } : {});
  } catch (e) {
    try { return await type.launch(); } catch { return null; }
  }
}

// ── the driver ─────────────────────────────────────────────────────────────
async function visible(pg, id) {
  return pg.evaluate(sel => {
    const el = document.getElementById(sel);
    return !!el && el.classList.contains('active');
  }, id);
}
async function currentScreen(pg) {
  return pg.evaluate(() => {
    const a = document.querySelector('.screen.active');
    return a ? a.id : null;
  });
}
async function answerQuiz(pg, which) {
  // The correct index of each question is data, not a guess: it comes from the
  // same content module the page renders from.
  const picks = await pg.evaluate(w => {
    const qs = (w === 'ai') ? window.SVContent.QUIZ_AI : window.SVContent.QUIZ_BASE;
    return qs.map(q => ({ id: q.id, a: q.answer }));
  }, which);
  for (const q of picks) {
    await pg.locator(`input[name="${q.id}"][value="${q.a}"]`).first().check();
  }
}

async function runOne(name) {
  console.log(`\n──────── ${name} ────────`);
  const br = await launch(name);
  if (!br) { console.log('    skipped — this engine is not installed in the container'); return; }

  const ctx = await br.newContext({ viewport: { width: 1440, height: 1000 } });
  let sdkHits = 0;
  // Block every external host. The glob must cover the SUBDOMAIN too —
  // '**/gstatic.com/**' does not match 'www.gstatic.com', which is how the first
  // run of this test ended up making real network calls.
  await ctx.route(/gstatic\.com/, r => { sdkHits++; r.abort(); });
  await ctx.route(/googleapis\.com|firebaseio\.com|firebaseapp\.com/, r => r.abort());
  const pg = await ctx.newPage();
  const errors = [];
  pg.on('pageerror', e => errors.push(String(e.message)));
  // A blocked external resource is the deliberate offline condition of this
  // test, not a defect; a real JS error is.
  pg.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource|net::ERR_/.test(t)) return;
    errors.push('console: ' + t);
  });

  // ── boot ────────────────────────────────────────────────────────────────
  await pg.goto(BASE + '?code=SMOKE&pcode=SMOKE001&PROLIFIC_PID=SMOKE001');
  await pg.waitForSelector('#s-consent.active', { timeout: 20000 });
  ok(true, 'the participant code from the launch link skips the code gate and lands on consent');
  // The test hook exists on window (the smoke test drives the real flow through
  // it) but it must never hand out the round's secrets.
  ok(await pg.evaluate(() => {
    const keys = Object.keys(window.SVApp);
    const s = JSON.stringify(window.SVApp.state()) + JSON.stringify(window.SVApp.plan());
    return keys.indexOf('truth') < 0 && keys.indexOf('mapping') < 0 &&
      keys.indexOf('anchors') < 0 && !/pre_opened|ai_anchors|mapping_index/.test(s);
  }), 'the test hook exposes no mapping, no anchors and no pre-opened values');

  const plan = () => pg.evaluate(() => window.SVApp.plan());
  const state = () => pg.evaluate(() => window.SVApp.state());

  // ── consent ─────────────────────────────────────────────────────────────
  ok(await pg.locator('#btn-consent').isDisabled(), 'Continue is disabled until the consent box is ticked');
  await pg.locator('#consent-box').check();
  ok(!(await pg.locator('#btn-consent').isDisabled()), 'ticking the box enables Continue');
  await pg.locator('#btn-consent').click();

  // ── registration ────────────────────────────────────────────────────────
  // Background, asked once, before the study. A standalone participant (no
  // platform handoff, which is this run) is asked every item the study still
  // has; they are all optional, so Continue works whether or not anything is
  // ticked. The count comes from the study itself — field of study was dropped
  // in 2026-08 and a literal here would pin the wrong number rather than the
  // behaviour. The platform-launch path — where they are all answered from the
  // handoff and no screen is shown at all — is pinned by platform-guard.mjs.
  await pg.waitForSelector('#s-registration.active');
  const regQs = await pg.$$eval('#reg-body .survey-q', els => els.map(e => e.dataset.q));
  const regWant = await pg.evaluate(() => window.SVContent.REGISTRATION.map(q => q.id));
  ok(regQs.length === regWant.length && regWant.every(id => regQs.includes(id)),
    `a standalone participant is asked every background item the study keeps (${regWant.length})`,
    regQs.join(','));
  ok(!regQs.includes('f_field'), 'and never field of study, which the study no longer asks');
  await pg.evaluate(() => {
    const r = document.querySelector('#reg-body .survey-q input[type=radio]');
    if (r) r.checked = true;
  });
  await pg.locator('#btn-reg').click();

  // ── instructions ────────────────────────────────────────────────────────
  await pg.waitForSelector('#s-instructions.active');
  const nPages = await pg.evaluate(() => window.SVContent.INSTRUCTIONS.length);
  ok(nPages === 5, 'five instruction screens');
  for (let i = 0; i < nPages; i++) {
    const step = await pg.locator('#instr-step').textContent();
    ok(step.indexOf(String(i + 1)) >= 0, `instruction screen ${i + 1} announces itself ("${step.trim()}")`);
    if (i === 0) ok(await pg.locator('#btn-instr-back').isHidden() ||
      (await pg.locator('#btn-instr-back').evaluate(e => getComputedStyle(e).visibility)) === 'hidden',
      'Back is hidden on the first screen');
    await pg.locator('#btn-instr-next').click();
  }

  // ── the base comprehension gate ─────────────────────────────────────────
  await pg.waitForSelector('#s-quiz.active');
  ok(true, 'the instructions gate on a comprehension check');
  // A wrong answer on the scoring question must not let anyone through when the
  // gate is strict — but the base gate's strict question is the AI one, so here
  // we simply check that an unanswered form does not advance.
  await pg.locator('#btn-quiz').click();
  ok(await visible(pg, 's-quiz'), 'submitting an empty comprehension form does not advance');
  // The reminder carries what a participant needs to ANSWER, on the same screen.
  const rem = await pg.locator('#quiz-reminder').innerText();
  ok(/Revealing/.test(rem) && new RegExp(String(await pg.evaluate(() => window.CONFIG.DEFAULTS.costs.revealCost))).test(rem),
    'the comprehension gate reminds the participant what revealing costs', rem.split('\n')[1]);
  ok(/true prize where you stop/.test(rem), 'and how the round is scored');
  ok(/at most/.test(rem), 'and the step bound the adjacency questions turn on');

  await answerQuiz(pg, 'base');
  await pg.locator('#btn-quiz').click();
  await pg.waitForSelector('#s-blockintro.active, #s-round.active');
  ok(true, 'answering correctly clears the base gate');

  // ── the 28 rounds ───────────────────────────────────────────────────────
  const rounds = await plan();
  ok(rounds.length === 28, `the plan holds 28 rounds (got ${rounds.length})`);
  ok(rounds.slice(0, 2).every(r => !r.scored), 'the session opens with the two warm-up rounds');
  const seq = (await state()).sequence;
  ok(seq === 'A' || seq === 'B', `a crossover sequence was assigned (${seq})`);

  let aiOffChecked = false, aiOnChecked = false, requeryChecked = false;
  let capNoteSeen = false, scoreChecked = false, rushSeen = false, milestoneSeen = false, parityChecked = false, rushPassThrough = false;

  for (let i = 0; i < rounds.length; i++) {
    const scr = await currentScreen(pg);
    if (scr === 's-blockintro') { await pg.locator('#btn-bi').click(); }
    else if (scr === 's-aiinstructions') { /* handled below */ }

    // The AI gate appears once, immediately before the first AI-on round.
    if (await visible(pg, 's-aiinstructions')) {
      const n = await pg.evaluate(() => window.SVContent.AI_INSTRUCTIONS.length);
      for (let k = 0; k < n; k++) await pg.locator('#btn-ai-next').click();
      await pg.waitForSelector('#s-aiquiz.active');
      // The strict gate: a wrong answer on the scoring question must block.
      const wrong = await pg.evaluate(() => {
        const q = window.SVContent.QUIZ_AI.find(x => x.strict);
        return { id: q.id, wrong: (q.answer + 1) % q.options.length };
      });
      await answerQuiz(pg, 'ai');
      await pg.locator(`input[name="${wrong.id}"][value="${wrong.wrong}"]`).check();
      await pg.locator('#btn-aiquiz').click();
      ok(await visible(pg, 's-aiquiz'),
        'the STRICT gate blocks: getting "the AI’s number is not your prize" wrong does not let you through');
      // Every answered question is marked, and a correct one carries the reason.
      const fbs = await pg.$$eval('#aiquiz-body .q-fb',
        els => els.filter(e => e.style.display !== 'none').map(e => e.textContent.trim()));
      ok(fbs.length >= 2, 'every answered question is marked right or wrong, not only the wrong ones', String(fbs.length));
      ok(fbs.some(t => /✓ Correct/.test(t)), 'a correct answer is ticked');
      ok(fbs.some(t => /✓ Correct\./.test(t) && t.length > 20),
        'and carries a short explanation, so the tick teaches something',
        fbs.find(t => /✓ Correct/.test(t)));
      ok(fbs.some(t => /Not quite/.test(t)), 'a wrong answer says so');
      const aiRem = await pg.locator('#aiquiz-reminder').innerText();
      ok(/not a prize/.test(aiRem), 'the AI gate reminds them the AI’s number is not a prize', aiRem.split('\n')[2]);
      await answerQuiz(pg, 'ai');
      await pg.locator('#btn-aiquiz').click();
      await pg.waitForSelector('#s-blockintro.active, #s-round.active');
      if (await visible(pg, 's-blockintro')) await pg.locator('#btn-bi').click();
    }
    if (await visible(pg, 's-blockintro')) await pg.locator('#btn-bi').click();
    await pg.waitForSelector('#s-round.active', { timeout: 15000 });
    // A milestone pop-up can open with the round; it has one button.
    if (await pg.locator('#ov-encourage.show').count()) {
      if (!milestoneSeen) {
        milestoneSeen = true;
        ok(/rounds? (to go|left)|Last round|Halfway/i.test(await pg.locator('#ov-encourage .modal').innerText()),
           'a milestone pop-up says how much of this half is left');
      }
      await pg.locator('#btn-enc-ok').click();
    }

    const r = rounds[i];
    const askVisible = await pg.locator('#btn-ask').isVisible();

    if (r.cond === 'AI_OFF' && !aiOffChecked) {
      aiOffChecked = true;
      ok(!askVisible, 'in an AI-off round the "Ask the AI" button is ABSENT, not merely disabled');
      ok((await pg.locator('#btn-ask').count()) === 0,
         'and it is out of the DOM entirely — not hidden, so it is not tabbable or inspectable either');
      const text = await pg.locator('#s-round').innerText();
      ok(!/\bAI\b/.test(text.replace(/No AI in this part\./g, '')),
        'an AI-off round mentions the AI only to say there is none',
        text.split('\n').filter(l => /AI/.test(l)).join(' | '));
    }

    // Move the slider with the arrow control and check the label follows.
    await pg.locator('#btn-pos-right').click();
    const selNow = await pg.evaluate(() => window.SVApp.selected());
    ok((await pg.locator('#pos-input').inputValue()).trim() === String(selNow)
       && new RegExp('position ' + selNow + '$').test((await pg.locator('#btn-nominate').textContent()).trim()),
      i === 0 ? 'the number box and the nominate button both name the selected position'
              : 'selection tracked');

    if (r.cond === 'AI_ON' && askVisible && !parityChecked) {
      parityChecked = true;
      // §Action buttons: the two PAID buttons are the primary outcome, so
      // neither may be easier to press. Everything except the label text and
      // the cost numeral must compute identically.
      const metrics = await pg.evaluate(() => {
        const pick = el => {
          const c = getComputedStyle(el), r = el.getBoundingClientRect();
          return {
            w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
            pad: c.padding, radius: c.borderRadius, weight: c.fontWeight, size: c.fontSize,
            family: c.fontFamily, spacing: c.letterSpacing, border: c.borderWidth,
            shadow: c.boxShadow, opacity: c.opacity, fill: c.backgroundColor, colour: c.color
          };
        };
        const a = document.getElementById('btn-ask'), b = document.getElementById('btn-reveal');
        const cell = id => document.getElementById(id).querySelector('.act-note').textContent.trim().length;
        return { a: pick(a), b: pick(b), askNote: cell('ask-panel'), revNote: cell('reveal-panel') };
      });
      const same = k => metrics.a[k] === metrics.b[k];
      ['w', 'h', 'pad', 'radius', 'weight', 'size', 'family', 'spacing', 'border', 'shadow', 'opacity', 'colour']
        .forEach(k => ok(same(k), 'the two paid buttons compute the same ' + k,
                         metrics.a[k] + ' vs ' + metrics.b[k]));
      ok(metrics.a.top === metrics.b.top,
         'they sit side by side on one baseline, not stacked — vertical primacy is the strongest position bias',
         metrics.a.top + ' vs ' + metrics.b.top);
      ok(metrics.a.fill !== metrics.b.fill, 'their hues differ, so they stay distinguishable');
      // Same saturation and lightness: neither hue may be the louder one.
      const hsl = rgb => {
        const [r, g, b] = rgb.match(/\d+/g).slice(0, 3).map(Number).map(v => v / 255);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
        const s = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
        return { s: Math.round(s * 100), l: Math.round(l * 100) };
      };
      const ha = hsl(metrics.a.fill), hb = hsl(metrics.b.fill);
      ok(Math.abs(ha.s - hb.s) <= 1 && Math.abs(ha.l - hb.l) <= 1,
         'and the two hues are matched on saturation and lightness, so neither reads as the primary action',
         JSON.stringify(ha) + ' vs ' + JSON.stringify(hb));
      ok(Math.abs(metrics.askNote - metrics.revNote) <= 12,
         'the helper text under each is about the same length',
         metrics.askNote + ' vs ' + metrics.revNote + ' characters');
      // The cost numerals: same hue and saturation, different lightness, and
      // red appears nowhere else on the screen.
      const costs = await pg.evaluate(() => {
        const c = id => getComputedStyle(document.getElementById(id)).color;
        return { q: c('ask-cost'), r: c('reveal-cost') };
      });
      ok(costs.q !== costs.r, 'the two cost numerals are tinted apart, so the price gap reads at a glance');
      const cq = hsl(costs.q), cr = hsl(costs.r);
      ok(Math.abs(cq.s - cr.s) <= 3 && cq.l !== cr.l,
         'same saturation, different lightness — a tint of one hue, not two colours',
         JSON.stringify(cq) + ' vs ' + JSON.stringify(cr));
    }

    if (r.cond === 'AI_ON' && askVisible) {
      // Ask, then check the answer landed and the truth was NOT revealed.
      await pg.evaluate(() => window.SVApp.select(40));
      await pg.locator('#btn-ask').click();
      await pg.waitForSelector('.answer-flash.show', { timeout: 5000 });
      const flash = await pg.locator('#answer-flash').innerText();
      if (!aiOnChecked) {
        aiOnChecked = true;
        ok(/The AI says/.test(flash), 'asking the AI returns one number, for the asked position only');
        // Scoped to #plot: the between-rounds screen keeps its own chart in the
        // DOM, so a document-wide query would count the PREVIOUS round's markers.
        const marks = await pg.evaluate(() => ({
          asked: document.querySelectorAll('#plot .ask-diamond').length,
          revealed: document.querySelectorAll('#plot .rev-mark').length
        }));
        ok(marks.asked >= 1, 'the asked position is drawn as an open diamond at the AI’s stated value');
        ok(marks.revealed === 0, 'asking the AI does NOT reveal the truth');
        // The ground truth is the study's whole secret. The admin panel draws it
        // for every round; a live participant must never get any of it — not the
        // walk, not the AI's curve, not its anchors, not the testing overlays.
        const leak = await pg.evaluate(() => ({
          truth: document.querySelectorAll('#plot .gt-line').length,
          aiCurve: document.querySelectorAll('#plot .ai-line').length,
          anchors: document.querySelectorAll('#plot .anchor-dot').length,
          testview: !!document.getElementById('testview') && getComputedStyle(document.getElementById('testview')).display !== 'none'
        }));
        ok(leak.truth === 0, 'the hidden prize walk is NOT drawn for a live participant');
        ok(leak.aiCurve === 0, 'nor is the AI’s interpolation line');
        ok(leak.anchors === 0, 'nor are the AI’s private anchors');
        ok(leak.testview === false, 'and the testing overlays stay out of a live session entirely');
        // The plot is now the ONLY record of what the AI said, so it must label
        // the diamond rather than hide the number in a hover tooltip.
        const askLbl = await pg.evaluate(() =>
          Array.from(document.querySelectorAll('#plot .mark-lbl.ask')).map(e => e.textContent));
        ok(askLbl.length >= 1, 'the AI’s answer is labelled on the plot, not only in a tooltip', askLbl.join(','));
        ok(await pg.evaluate(() => document.querySelectorAll('#plot .rev-mark').length) === 0,
          'and it is still drawn as a claim, not as a revealed prize');
      }
      // Re-querying the same position must stay possible (§14).
      if (!requeryChecked) {
        requeryChecked = true;
        // The action buttons stay disabled until the fixed latency window closes,
        // so wait for the release rather than racing it.
        await pg.waitForFunction(() => !document.getElementById('btn-ask').disabled, null, { timeout: 5000 });
        ok(true, 're-asking about the same position stays possible once the answer has landed');
      }
    }

    // Reveal a position, then check it cannot be charged twice.
    // The position is CHOSEN, not hardcoded: a pre-opened position cannot be
    // revealed (the button is correctly disabled), and which positions start open
    // moves whenever the specs are regenerated — as they did when sparse K went
    // from 4 to 3. Take the first candidate the app will actually let us reveal.
    // Wait out the fixed latency first: while an action is in flight EVERY button
    // is disabled, so probing now would find nothing revealable anywhere.
    // btn-nominate is disabled by that gate alone, which makes it the signal.
    await pg.waitForFunction(() => !document.getElementById('btn-nominate').disabled, null, { timeout: 8000 });
    let revealPos = null;
    for (const cand of [62, 71, 29, 84, 15, 45, 96]) {
      await pg.evaluate(p => window.SVApp.select(p), cand);
      if (!(await pg.locator('#btn-reveal').isDisabled())) { revealPos = cand; break; }
    }
    ok(revealPos != null, 'a revealable position exists in every round', String(revealPos));
    await pg.locator('#btn-reveal').click();
    await pg.waitForSelector('.answer-flash.show', { timeout: 5000 });
    if (i === 0) {
      ok(/holds/.test(await pg.locator('#answer-flash').innerText()), 'revealing shows the true prize');
      ok(await pg.locator('#btn-reveal').isDisabled(), 'an already-revealed position cannot be revealed again');
      // Against the CONFIGURED cost, not a literal — the reveal cost is a study
      // parameter and has already moved once (5 → 4, see SIMULATION-FINDINGS.md).
      const want = await pg.evaluate(() => String(window.CONFIG.DEFAULTS.costs.revealCost));
      const cost = await pg.locator('#sb-reveal').textContent();
      ok(cost.trim() === want,
        'the reveal cost is charged once (' + want + '), and shown separately from the query cost', cost.trim());
    }

    // Stop and nominate. The button must name the position.
    const label = await pg.locator('#btn-nominate').textContent();
    ok(i > 0 || new RegExp('position ' + revealPos).test(label),
      'the nominate button names the position, so nomination is never accidental', label);
    await pg.locator('#btn-nominate').click();
    // This bot buys one reveal and stops, which is exactly the "closed after
    // almost no searching" pattern the focus prompt exists for. It must always
    // be dismissible in one click, or it would coerce the choice being
    // measured — so "Stop anyway" is what the bot presses.
    if (await pg.locator('#ov-encourage.show').count()) {
      if (!rushSeen) {
        rushSeen = true;
        ok(await pg.locator('#btn-enc-alt').isVisible(),
           'stopping after almost no searching offers a focus prompt with a one-click way out');
      }
      await pg.locator('#btn-enc-alt').click();
      // "Stop anyway" must re-enter the normal path, not bypass the §14
      // confirmation for a position they never touched — that is a separate
      // safeguard against a mis-click and this prompt must not swallow it.
      if (!rushPassThrough) {
        rushPassThrough = true;
        const untouched = await pg.evaluate(() => {
          const s = window.SVApp.state ? window.SVApp.state() : null;
          return !!s;
        });
        ok(untouched, 'the focus prompt hands back to the ordinary nomination path');
      }
    }
    // A revealed position needs no confirmation; an untouched one does.
    if (await pg.locator('#ov-nominate.show').count()) await pg.locator('#btn-nom-ok').click();

    await pg.waitForSelector('#s-interstitial.active', { timeout: 15000 });
    if (!scoreChecked) {
      scoreChecked = true;
      const body = await pg.locator('#inter-body').innerText();
      ok(/Round score/.test(body), 'the between-rounds screen reports the round score');
      ok(/You stopped on position/.test(body), 'the true prize at the nominated position is shown before moving on');
      ok(/to go\.|last round/.test(body), 'the between-rounds screen says how many rounds remain');
      const marks = await pg.evaluate(() => document.querySelectorAll('#inter-plot .nom-mark').length);
      ok(marks === 1, 'the nominated position is marked on the plot');
    }
    if (!capNoteSeen) capNoteSeen = true;
    await pg.locator('#btn-continue').click();
    await pg.waitForTimeout(60);
  }

  // ── exit survey ─────────────────────────────────────────────────────────
  await pg.waitForSelector('#s-survey.active', { timeout: 20000 });
  ok(true, 'after the last round the exit survey opens');
  await pg.locator('#btn-survey').click();
  ok(await visible(pg, 's-survey'), 'the survey refuses to submit while compulsory items are blank');

  await pg.evaluate(() => {
    // Answer everything the page rendered: first option for choices, midpoint for
    // sliders, the known answer for the numeracy items, and text for the rest.
    document.querySelectorAll('#survey-body .survey-q').forEach(q => {
      const radios = q.querySelectorAll('input[type=radio]');
      if (radios.length) radios[0].checked = true;
      const boxes = q.querySelectorAll('input[type=checkbox]');
      if (boxes.length) boxes[0].checked = true;
      q.querySelectorAll('textarea').forEach(t => { t.value = 'smoke test'; });
      q.querySelectorAll('input[type=number]').forEach(n => { n.value = '1'; });
    });
  });
  await pg.locator('#btn-survey').click();
  await pg.waitForSelector('#s-debrief.active, #s-done.active', { timeout: 15000 });

  // ── debrief ─────────────────────────────────────────────────────────────
  if (await visible(pg, 's-debrief')) {
    const cap = await pg.locator('#debrief-caption').innerText();
    ok(/true prizes/.test(cap), 'the debrief redraws one of the participant’s own rounds with the true prizes');
    ok((await pg.evaluate(() => document.querySelectorAll('#debrief-plot .gt-line').length)) === 1,
      'the true prize curve is drawn');
    ok((await pg.evaluate(() => document.querySelectorAll('#debrief-plot .anchor-dot').length)) > 0,
      'the positions the AI actually knew are finally shown');
    await pg.locator('#btn-debrief').click();
  }

  // ── done ────────────────────────────────────────────────────────────────
  await pg.waitForSelector('#s-done.active', { timeout: 15000 });
  ok(true, 'the session finishes on the done screen');

  const log = await pg.evaluate(() => {
    const evs = window.Logger.getEvents();
    const by = {};
    evs.forEach(e => { by[e.event] = (by[e.event] || 0) + 1; });
    const dec = evs.filter(e => e.event === 'decision');
    const ends = evs.filter(e => e.event === 'round_end');
    return {
      by, total: evs.length,
      firstDecision: dec[0] || null,
      anyEnd: ends[0] || null,
      sessionEnd: evs.filter(e => e.event === 'session_end')[0] || null,
      scoresMatch: ends.every(e => e.final_score === e.nominated_true_value - e.total_cost)
    };
  });
  ok(log.by.session_start === 1, 'exactly one session_start');
  ok(log.by.round_start === 28 && log.by.round_end === 28, `28 round_start and 28 round_end rows (got ${log.by.round_start}/${log.by.round_end})`);
  ok(log.by.decision >= 28 * 2, `every decision is logged (${log.by.decision} rows)`);
  ok(log.by.comprehension >= 6, 'comprehension answers are logged one row per question');
  ok(log.by.survey > 10, 'every survey answer is logged');
  ok(log.by.telemetry > 0, 'telemetry (slider, focus, heartbeats) is batched into its own rows');
  ok(!!log.sessionEnd, 'a session_end row is written — this is what the Simulation Platform verifies against');
  ok(log.sessionEnd && log.sessionEnd.pid === 'SMOKE001',
    'session_end carries pid = the student ID the platform sends as PROLIFIC_PID');
  ok(log.scoresMatch, 'every round’s score is the TRUE prize at the nominated position minus everything spent');

  const d = log.firstDecision;
  ok(d && d.ai_anchors_before != null && d.participant_known_before != null,
    'a decision row carries BOTH anchor sets — what the AI knows and what the participant knows');
  ok(d && d.ms_since_round_start != null && d.slider_moves_since_last_action != null,
    'a decision row carries the timing and the scanning that preceded it');
  ok(d && d.event_id, 'a decision row carries a client uuid, so a retry can be deduplicated');
  ok(log.anyEnd && log.anyEnd.info && /reveals/.test(log.anyEnd.info), 'the round row carries the full reveal history');

  ok(sdkHits > 0, 'the Firebase SDK was attempted and blocked — and the app carried the whole session through anyway');
  ok(errors.length === 0, 'no page errors', errors.slice(0, 4).join(' | '));

  // ── the admin sandbox ───────────────────────────────────────────────────
  const pv = await ctx.newPage();
  const pvErrors = [];
  pv.on('pageerror', e => pvErrors.push(String(e.message)));
  await pv.goto(BASE + '?preview=1&debug=1&key=stouras&code=SMOKE');
  await pv.waitForSelector('#sv-ribbon', { timeout: 15000 });
  ok(true, 'the admin test round opens straight into the task, with the "nothing is saved" ribbon');
  ok(await pv.evaluate(() => window.SIMP_EXPECT === '__off__'),
    'the platform completion marker is switched off in a sandbox');
  ok(await pv.locator('#testview').isVisible(), 'the testing overlay bar is available in a sandbox');
  await pv.locator('#tv-truth').check();
  ok((await pv.evaluate(() => document.querySelectorAll('#plot .gt-line').length)) === 1,
    'the testing overlay can draw the true prizes');
  await pv.locator('#tv-anchors').check();
  ok((await pv.evaluate(() => document.querySelectorAll('#plot .anchor-dot').length)) > 0,
    'the testing overlay can mark the AI’s private anchors');
  ok(pvErrors.length === 0, 'no page errors in the sandbox', pvErrors.join(' | '));

  // ── round mechanics that the straight playthrough does not reach ────────
  const mech = await br.newContext({ viewport: { width: 1440, height: 1000 } });
  await mech.route(/gstatic\.com/, r => r.abort());
  const mp = await mech.newPage();
  const mErrors = [];
  mp.on('pageerror', e => mErrors.push(String(e.message)));
  // Straight into a round through the admin sandbox, which skips the intro.
  await mp.goto(BASE + '?preview=1&debug=1&key=stouras&code=SMOKE');
  await mp.waitForSelector('#s-round.active', { timeout: 15000 });

  // The instructions summary, reopenable at any time (§14).
  await mp.locator('#btn-instr-open').click();
  await mp.waitForSelector('#ov-summary.show');
  const sum = await mp.locator('#summary-body').innerText();
  ok(/at most/.test(sum) && /costs/.test(sum), 'the instructions summary reopens over the round and restates the rules');
  await mp.keyboard.press('Escape');
  ok(!(await mp.locator('#ov-summary.show').count()), 'Escape closes the summary');

  // Nominating a position never touched must confirm — it is a pure gamble and
  // more likely a misclick than an intention (§14).
  await mp.evaluate(() => window.SVApp.select(7));
  await mp.locator('#btn-nominate').click();
  ok(await mp.locator('#ov-nominate.show').count() === 1,
    'stopping on a position that was never asked about or revealed asks for confirmation');
  ok(/asked about or revealed/.test(await mp.locator('#nom-msg').innerText()) &&
     /whatever prize is actually there/.test(await mp.locator('#nom-msg').innerText()),
    'and says plainly what the gamble is');
  await mp.locator('#btn-nom-cancel').click();
  ok(await visible(mp, 's-round'), 'declining the confirmation keeps the round going');

  // Arrow keys move by exactly one, from the keyboard alone — INCLUDING when the
  // focus happens to sit on a button, which is where a click leaves it.
  const before = await mp.evaluate(() => window.SVApp.selected());
  await mp.locator('#btn-nom-cancel').press('ArrowRight').catch(async () => {
    await mp.locator('body').press('ArrowRight');
  });
  const after = await mp.evaluate(() => window.SVApp.selected());
  ok(after === before + 1, `an arrow key moves the selection by exactly one (${before} → ${after})`);
  await mp.locator('#pos-slider').focus();
  const b2 = await mp.evaluate(() => window.SVApp.selected());
  await mp.keyboard.press('ArrowRight');
  await mp.waitForTimeout(80);
  const a2 = await mp.evaluate(() => window.SVApp.selected());
  ok(a2 === b2 + 1, `an arrow key on the focused slider also moves by exactly one, not two (${b2} → ${a2})`);

  // The reveal cap.
  const cap = await mp.evaluate(() => window.CONFIG.DEFAULTS.costs.revealCap);
  for (let p = 1; p <= cap + 4; p++) {
    // Move FIRST: Reveal is disabled while the selected position is already
    // open, so testing the button before moving would read the wrong state.
    await mp.evaluate(pos => window.SVApp.select(pos), 2 + p * 3);
    if (await mp.locator('#btn-reveal').isDisabled()) break;
    await mp.locator('#btn-reveal').click();
    await mp.waitForTimeout(380);
  }
  const nRev = await mp.evaluate(() => parseInt(document.getElementById('sb-reveal-n').textContent, 10));
  ok(nRev === cap, `the reveal cap binds at exactly ${cap} (got ${nRev})`);
  ok(await mp.locator('#btn-reveal').isDisabled(), 'and the Reveal button is disabled once it binds');
  ok(await mp.locator('#cap-note').isVisible(), 'and the participant is told why');
  ok(mErrors.length === 0, 'no page errors while exercising the caps and the confirmations', mErrors.join(' | '));
  await mech.close();

  // ── resumption (§17.7) ──────────────────────────────────────────────────
  const res = await br.newContext({ viewport: { width: 1440, height: 1000 } });
  await res.route(/gstatic\.com/, r => r.abort());
  const rp = await res.newPage();
  const rErrors = [];
  rp.on('pageerror', e => rErrors.push(String(e.message)));
  await rp.goto(BASE + '?code=SMOKE&pcode=RESUME1');
  await rp.waitForSelector('#s-consent.active', { timeout: 20000 });
  await rp.locator('#consent-box').check();
  await rp.locator('#btn-consent').click();
  await rp.waitForSelector('#s-registration.active');
  await rp.locator('#btn-reg').click();            // background is optional
  for (let i = 0; i < 5; i++) await rp.locator('#btn-instr-next').click();
  await answerQuiz(rp, 'base');
  await rp.locator('#btn-quiz').click();
  await rp.waitForSelector('#s-blockintro.active, #s-round.active');
  if (await visible(rp, 's-blockintro')) await rp.locator('#btn-bi').click();
  await rp.waitForSelector('#s-round.active');
  await rp.evaluate(() => window.SVApp.select(33));
  await rp.locator('#btn-reveal').click();
  await rp.waitForTimeout(400);

  // Close the browser mid-round: the round restarts from the beginning and is
  // flagged, so it can be excluded from the analysis.
  await rp.reload();
  await rp.waitForSelector('#s-round.active', { timeout: 20000 });
  ok(true, 'a reload mid-round resumes inside the study rather than starting over');
  ok((await rp.evaluate(() => parseInt(document.getElementById('sb-reveal-n').textContent, 10))) === 0,
    'the interrupted round restarts from its beginning, not from where it stopped');
  const interrupted = await rp.evaluate(() => {
    const e = window.Logger.getEvents().filter(x => x.event === 'round_start').pop();
    return e ? JSON.parse(e.info || '{}').interrupted : null;
  });
  ok(interrupted === true, 'and the round is marked interrupted, so it can be excluded');
  const resumptions = await rp.evaluate(() => {
    const key = 'searchv2:v3:state:RESUME1';
    return JSON.parse(localStorage.getItem(key) || '{}').resumptions;
  });
  ok(resumptions >= 1, `the resumption is counted (${resumptions})`);

  // Every return is a `resume` row carrying the gap since they were last seen —
  // the raw observation the export turns into breaks and sittings. A reload
  // seconds later is a resumption but NOT a break.
  const resumeRow = await rp.evaluate(() => {
    const e = window.Logger.getEvents().filter(x => x.event === 'resume').pop();
    return e ? { gap: e.duration_ms, src: e.source, info: JSON.parse(e.info || '{}') } : null;
  });
  ok(resumeRow && typeof resumeRow.gap === 'number',
    'and logged as a `resume` row carrying how long they were away', JSON.stringify(resumeRow));
  ok(resumeRow && resumeRow.info.is_break === false,
    'a reload seconds later is a resumption but NOT a break between sittings');
  ok(resumeRow && resumeRow.src === 'local',
    'and it records where the progress came from — this browser, or the cloud copy');

  // A LONG absence is a break. The rewind has to happen while the study page is
  // NOT open: leaving stamps "last seen" on the way out — which is the point of
  // that stamp — so rewinding and reloading in one go would simply be undone.
  // The admin page is the same origin, so it shares the storage and touches
  // none of it.
  await rp.goto(BASE + 'admin/');
  await rp.waitForTimeout(400);
  await rp.evaluate(() => {
    const key = 'searchv2:v3:state:RESUME1';
    const s = JSON.parse(localStorage.getItem(key) || '{}');
    s.lastSeenAt = Date.now() - 2 * 60 * 60 * 1000;
    localStorage.setItem(key, JSON.stringify(s));
  });
  await rp.goto(BASE + '?code=SMOKE&pcode=RESUME1');
  await rp.waitForSelector('#s-round.active, #s-interstitial.active, #s-blockintro.active', { timeout: 20000 });
  const afterBreak = await rp.evaluate(() => {
    const e = window.Logger.getEvents().filter(x => x.event === 'resume').pop();
    const s = JSON.parse(localStorage.getItem('searchv2:v3:state:RESUME1') || '{}');
    return { gap: e && e.duration_ms, info: e && JSON.parse(e.info || '{}'),
             breaksCount: s.breaksCount, breakMs: s.breakMs, phase: s.phase };
  });
  ok(afterBreak.gap > 60 * 60 * 1000 && afterBreak.info.is_break === true,
    'a two-hour absence IS a break between sittings', JSON.stringify(afterBreak));
  ok(afterBreak.breaksCount === 1 && afterBreak.breakMs >= 2 * 60 * 60 * 1000 - 60000,
    'the break is counted and its length accumulated', JSON.stringify(afterBreak));
  ok(afterBreak.info.sittings === 2, 'and it makes this their second sitting');

  // Returning on ANOTHER device: their progress is mirrored to their record, and
  // the boot continues from whichever copy got FURTHER — never from the one that
  // got less far, or a sync that never landed would replay finished rounds.
  const pick = await rp.evaluate(() => {
    const R = window.SVApp.resumeChoice;
    const at = (rounds, phase, seen) => ({ results: new Array(rounds).fill(0), phase: phase, lastSeenAt: seen });
    return {
      noLocal: R(null, at(6, 'round', 10)),                       // fresh browser, cloud has progress
      noRemote: R(at(6, 'round', 10), null),
      furtherWins: R(at(3, 'round', 9e12), at(9, 'round', 10)),   // stale clock, more rounds
      newerBreaksTie: R(at(6, 'round', 10), at(6, 'round', 20)),
      doneWins: R(at(28, 'round', 9e12), { results: [], completed: true, phase: 'done', lastSeenAt: 1 })
    };
  });
  ok(pick.noLocal === 'b' && pick.noRemote === 'a',
    'a browser with nothing saved continues from the cloud copy, and vice versa', JSON.stringify(pick));
  ok(pick.furtherWins === 'b', 'the copy that finished MORE rounds wins, whatever the clocks say');
  ok(pick.newerBreaksTie === 'b', 'and the clock only breaks a tie between two equally-far copies');
  ok(pick.doneWins === 'b', 'a finished session outranks an unfinished one');

  // A reload on the between-rounds screen must redraw it, not crash: the round's
  // mapping lives in a closure the reload wipes.
  await rp.evaluate(() => window.SVApp.select(50));
  await rp.locator('#btn-nominate').click();
  if (await rp.locator('#ov-nominate.show').count()) await rp.locator('#btn-nom-ok').click();
  await rp.waitForSelector('#s-interstitial.active', { timeout: 15000 });
  await rp.reload();
  await rp.waitForTimeout(2500);
  const afterReload = await currentScreen(rp);
  ok(afterReload === 's-interstitial' || afterReload === 's-round' || afterReload === 's-blockintro',
    `a reload on the between-rounds screen recovers cleanly (landed on ${afterReload})`);
  ok(rErrors.length === 0, 'no page errors across the resume path', rErrors.join(' | '));

  // Log out clears every trace on this device and returns to the code gate.
  rp.on('dialog', d => d.accept());
  ok(await rp.locator('#btn-logout').isVisible(), 'a Log out control is offered once a session is under way');
  await rp.locator('#btn-logout').click();
  await rp.waitForSelector('#s-code.active', { timeout: 15000 });
  const left = await rp.evaluate(() => Object.keys(localStorage).filter(k => k.indexOf('searchv2:') === 0).length);
  ok(left === 0, 'Log out erases every searchv2 key on the device');
  await res.close();

  // ── the viewport gate ───────────────────────────────────────────────────
  const narrow = await br.newContext({ viewport: { width: 700, height: 900 } });
  await narrow.route(/gstatic\.com/, r => r.abort());
  const np = await narrow.newPage();
  await np.goto(BASE + '?code=SMOKE&pcode=NARROW1');
  await np.waitForTimeout(1500);
  ok(await visible(np, 's-viewport'), 'a window below the minimum width refuses to start, and says why');
  await narrow.close();

  // ── the code gate ───────────────────────────────────────────────────────
  const bare = await br.newContext({ viewport: { width: 1440, height: 1000 } });
  await bare.route(/gstatic\.com/, r => r.abort());
  const bp = await bare.newPage();
  await bp.goto(BASE);
  await bp.waitForSelector('#s-code.active', { timeout: 15000 });
  ok(true, 'a bare visit with no code shows the participant-code gate and cannot start the study');
  ok(!(await bp.locator('#sv-ribbon').count()), 'a normal visit is not a sandbox');
  await bare.close();

  await br.close();
}

for (const name of WANTED) await runOne(name);

srv.close();
console.log('\n' + (fails ? `SMOKE FAILED — ${fails} of ${checks} checks` : `SMOKE OK — all ${checks} checks passed`));
process.exit(fails ? 1 : 0);
