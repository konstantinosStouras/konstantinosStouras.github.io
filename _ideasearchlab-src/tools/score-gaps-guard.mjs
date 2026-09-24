/**
 * score-gaps-guard.mjs — offline test (no network, no deps).
 *
 *   node _ideasearchlab-src/tools/score-gaps-guard.mjs
 *
 * Guards the Data Analytics 3.2 loop the owner asked for (2026-08-25):
 * **upload the whole dataset → see how many ideas have no AI Novelty / AI
 * Usefulness → press one button and have them filled.**
 *
 * Three things it pins, each a way the old page could report "nothing left to
 * do" over a dataset that plainly had empty cells:
 *
 *  1. `scoreGaps` counts the gap HONESTLY — an idea missing one column counts,
 *     and an idea with no text is counted APART (`unratable`), because no rater
 *     can ever fill it and lumping it in leaves a panel that never reaches zero.
 *  2. `mergeAiScoresIntoRows` tops a dataset up by **Idea ID** (title only as a
 *     fallback), fills blanks only, and NEVER appends an unmatched row.
 *  3. `shouldRunAnotherPass` keeps the fill run going while it is making
 *     progress and stops the moment it is not — so a transient rate-limit storm
 *     is worked through while a dead provider costs one extra attempt.
 */
import { readFileSync } from 'node:fs'
import {
  scoreGaps, gapSummary, ideaScoreState, shouldRunAnotherPass,
  mergeAiScoresIntoRows, hasIdeaText, isBlankScore, scorableText, MAX_RECOVERY_PASSES,
  pickScoredSheet,
} from '../src/utils/scoreGaps.js'
import { aiFieldsFor, UNRECORDED } from '../src/utils/aiScoreColumns.js'
import { normalizeImportedRows } from '../src/utils/analyticsData.js'
import { measureText } from '../src/utils/translation.js'

let failures = 0
function check(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); return }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── ideaScoreState ─────────────────────────────────────────────────────────
console.log('ideaScoreState — where one idea stands')
{
  const t = 'Thermo signal commuter jacket that shifts hue at 37C'
  check('both scores present → scored',
    ideaScoreState({ text: t, novelty: 4, usefulness: 3 }) === 'scored')
  check('a zero-ish score is still a score (0 is not blank)',
    ideaScoreState({ text: t, novelty: 1, usefulness: 1 }) === 'scored')
  check('only novelty → partial (the page still shows an empty cell)',
    ideaScoreState({ text: t, novelty: 5, usefulness: '' }) === 'partial')
  check('only usefulness → partial',
    ideaScoreState({ text: t, novelty: '', usefulness: 2 }) === 'partial')
  check('neither, but it has text → missing (a run can fill it)',
    ideaScoreState({ text: t, novelty: '', usefulness: '' }) === 'missing')
  check('neither and no text → unratable',
    ideaScoreState({ text: '   ', novelty: '', usefulness: '' }) === 'unratable')
  check('a title alone counts as text',
    ideaScoreState({ text: '', idea_title: 'Zone map top', novelty: '', usefulness: '' }) === 'missing')
  check('null and undefined read as blank, not as a score',
    isBlankScore(null) && isBlankScore(undefined) && isBlankScore('') && isBlankScore('  ')
    && !isBlankScore(0) && !isBlankScore(3))
  check('hasIdeaText ignores whitespace-only text',
    hasIdeaText({ text: 'a' }) && !hasIdeaText({ text: '\n\t ' }) && !hasIdeaText({}))
}

console.log('scorableText — the panel and the run must mean the same thing')
{
  check('`text` is used when it is there',
    scorableText({ text: 'the whole idea', idea_title: 'T' }) === 'the whole idea')
  check('a row with only a title is ratable — the fallback the panel relies on',
    scorableText({ text: '', idea_title: 'Zone map top' }) === 'Zone map top')
  check('title + description are joined the way every ingest joins them',
    scorableText({ text: '', idea_title: 'T', idea_description: 'D' }) === 'T: D')
  check('a description alone still gives the rater something',
    scorableText({ text: '', idea_description: 'D' }) === 'D')
  check('genuinely empty stays empty',
    scorableText({ text: '  ', idea_title: '', idea_description: '' }) === '')
  // The drift this pins: an idea the panel counts as fillable but the run sends
  // as an empty string is scored by nobody and stays empty for ever.
  const page = readFileSync(new URL('../src/pages/DataAnalytics.jsx', import.meta.url), 'utf8')
  // Since Step 1b, "Translate everything to English" (translation.js), the run sends
  // measureText(r): an idea's English version when it has one, else EXACTLY
  // scorableText(r) — so the invariant above still holds for every shape.
  check('DataAnalytics.jsx builds the rater\'s text with measureText, not its own rule',
    /\.map\(r => \(\{ rid: r\.rid, text: measureText\(r\) \}\)\)/.test(page),
    'the scoring run no longer routes through measureText')
  const shapes = [
    { text: 'Zone map top' }, { text: '', idea_title: 'Zone map top' },
    { text: '', idea_title: 'T', idea_description: 'D' }, { text: '', idea_description: 'D' },
    { text: '  ', idea_title: '', idea_description: '' }, { idea_title: 'T', text_en: '   ' },
  ]
  check('measureText is scorableText for every idea without an English version',
    shapes.every(r => measureText(r) === scorableText(r)))
  check('…and the English version when there is one',
    measureText({ text: '智能袜子', text_en: 'Smart socks: change colour' }) === 'Smart socks: change colour')
  const ratable = { text: '', idea_title: 'Zone map top', novelty: '', usefulness: '' }
  check('hasIdeaText agrees with scorableText on every shape',
    hasIdeaText(ratable) === !!scorableText(ratable) && ideaScoreState(ratable) === 'missing')
}

// ── scoreGaps ──────────────────────────────────────────────────────────────
console.log('scoreGaps — the coverage report the panel prints')
{
  const rows = [
    { idea_id: '1', text: 'aaa', novelty: 4, usefulness: 4, final_pick: 1 },
    { idea_id: '2', text: 'bbb', novelty: '', usefulness: '', final_pick: 1 },
    { idea_id: '3', text: 'ccc', novelty: 3, usefulness: '', final_pick: 0 },
    { idea_id: '4', text: '',    novelty: '', usefulness: '', final_pick: 0 },
    { idea_id: '5', text: 'eee', novelty: '', usefulness: 2, final_pick: 0 },
  ]
  const g = scoreGaps(rows)
  check('total counts every row', g.total === 5, `total=${g.total}`)
  check('scored = fully-scored ideas only', g.scored === 1, `scored=${g.scored}`)
  check('partial = exactly one column present', g.partial === 2, `partial=${g.partial}`)
  check('missing = no score but ratable', g.missing === 1, `missing=${g.missing}`)
  check('unratable = no score and no text', g.unratable === 1, `unratable=${g.unratable}`)
  check('missingNovelty counts every empty AI Novelty cell (2,4,5)',
    g.missingNovelty === 3, `missingNovelty=${g.missingNovelty}`)
  check('missingUsefulness counts every empty AI Usefulness cell (2,3,4)',
    g.missingUsefulness === 3, `missingUsefulness=${g.missingUsefulness}`)
  check('gaps = every idea with an empty cell', g.gaps === 4, `gaps=${g.gaps}`)
  check('fillable EXCLUDES the unratable idea — or the panel never reaches zero',
    g.fillable === 3, `fillable=${g.fillable}`)
  check('complete is false while any cell is empty', g.complete === false)
  check('ids lists the fillable gaps, in order',
    JSON.stringify(g.ids) === JSON.stringify(['2', '3', '5']), JSON.stringify(g.ids))

  // The scope toggle: the reading that misled — "0 final ideas to score" over a
  // dataset that still had unscored ideas.
  const gf = scoreGaps(rows, { onlyFinal: true })
  check('onlyFinal narrows the scope to Final Group Pick ideas',
    gf.total === 2 && gf.fillable === 1, `total=${gf.total} fillable=${gf.fillable}`)
  check('the whole-dataset count is still bigger, so the panel can say so',
    g.fillable > gf.fillable)

  const done = scoreGaps([{ idea_id: '1', text: 'a', novelty: 1, usefulness: 5 }])
  check('a fully-scored dataset is complete with no gaps',
    done.complete && done.gaps === 0 && done.fillable === 0)
  check('an empty dataset does not divide by zero',
    scoreGaps([]).total === 0 && scoreGaps(null).total === 0)
}

console.log('gapSummary — the sentence on the panel')
{
  const g = scoreGaps([
    { idea_id: '1', text: 'a', novelty: 1, usefulness: 1 },
    { idea_id: '2', text: 'b', novelty: '', usefulness: '' },
    { idea_id: '3', text: '',  novelty: '', usefulness: '' },
  ])
  const line = gapSummary(g)
  check('names the number still needing a score', line.includes('1 of 3'), line)
  check('names both columns',
    line.includes('missing AI Novelty') && line.includes('missing AI Usefulness'), line)
  check('says the unratable ones cannot be scored', line.includes('cannot be scored'), line)
  check('a complete dataset says so plainly',
    gapSummary(scoreGaps([{ text: 'a', novelty: 2, usefulness: 2 }])).startsWith('All 1 idea'),
    gapSummary(scoreGaps([{ text: 'a', novelty: 2, usefulness: 2 }])))
  check('no ideas loaded reads as such', gapSummary(scoreGaps([])) === 'No ideas loaded yet.')
}

// ── mergeAiScoresIntoRows ──────────────────────────────────────────────────
// Since 2026-09-24 every model has its own two columns (aiScoreColumns.js), so the
// merge is written against one model's pair, N / U below; `novelty` / `usefulness`
// are the derived means and are never merged into.
const N = aiFieldsFor('gpt-6-astra').novelty, U = aiFieldsFor('gpt-6-astra').usefulness
const GN = aiFieldsFor('gemini-3.8-flash').novelty, GU = aiFieldsFor('gemini-3.8-flash').usefulness
console.log('mergeAiScoresIntoRows — topping the loaded dataset up from a file')
{
  const rows = [
    { rid: 'r1', idea_id: 'i1', idea_title: 'Thermo jacket', text: 'Thermo jacket: hue at 37C', [N]: 4, [U]: 3 },
    { rid: 'r2', idea_id: 'i2', idea_title: 'Zone map top',  text: 'Zone map top: heat zones',  [N]: '', [U]: '' },
    { rid: 'r3', idea_id: 'i3', idea_title: 'Half scored',   text: 'Half scored: one column',   [N]: 5, [U]: '' },
  ]
  const incoming = [
    { idea_id: 'i1', idea_title: 'Thermo jacket', [N]: 1, [U]: 1 },
    { idea_id: 'i2', idea_title: 'Zone map top',  [N]: 2, [U]: 5 },
    { idea_id: 'i3', idea_title: 'Half scored',   [N]: 1, [U]: 4 },
    { idea_id: 'i9', idea_title: 'An idea nobody loaded', [N]: 3, [U]: 3 },
  ]
  const res = mergeAiScoresIntoRows(rows, incoming)
  const [a, b, c] = res.rows

  check('an already-scored idea keeps BOTH its scores',
    a[N] === 4 && a[U] === 3, `${a[N]}/${a[U]}`)
  check('an unscored idea gains the file\'s scores',
    b[N] === 2 && b[U] === 5, `${b[N]}/${b[U]}`)
  check('a half-scored idea keeps its score and gains only the missing one',
    c[N] === 5 && c[U] === 4, `${c[N]}/${c[U]}`)
  check('counts: matched=3, filled=2, kept=1, unmatched=1',
    res.matched === 3 && res.filled === 2 && res.kept === 1 && res.unmatched === 1,
    `matched=${res.matched} filled=${res.filled} kept=${res.kept} unmatched=${res.unmatched}`)
  check('per-column tallies: 1 novelty, 2 usefulness',
    res.gainedNovelty === 1 && res.gainedUsefulness === 2,
    `nov=${res.gainedNovelty} use=${res.gainedUsefulness}`)
  check('the models the file filled are reported',
    JSON.stringify(res.models) === JSON.stringify(['gpt_6_astra']), JSON.stringify(res.models))
  check('an unmatched file row is NEVER appended — the dataset keeps its length',
    res.rows.length === 3, `length=${res.rows.length}`)
  check('the input rows are not mutated',
    rows[1][N] === '' && rows[0][N] === 4)
}

console.log('mergeAiScoresIntoRows — one model never fills another')
{
  // The dataset carries GPT-6 Astra's ratings; the file carries Gemini's. Gemini's
  // go into Gemini's own columns, every idea of them, and Astra's are untouched —
  // the per-model rule the owner asked for ("append close to it the respective
  // columns for another AI provider's model").
  const rows = [
    { rid: 'r1', idea_id: 'i1', idea_title: 'One', text: 'One', [N]: 4, [U]: 3 },
    { rid: 'r2', idea_id: 'i2', idea_title: 'Two', text: 'Two', [N]: 2, [U]: 2 },
  ]
  const res = mergeAiScoresIntoRows(rows, [
    { idea_id: 'i1', [GN]: 5, [GU]: 1 },
    { idea_id: 'i2', [GN]: 3, [GU]: 3, [N]: 5 },
  ])
  check('the second model fills its own columns on every idea',
    res.rows[0][GN] === 5 && res.rows[0][GU] === 1 && res.rows[1][GN] === 3 && res.rows[1][GU] === 3)
  check('and the first model\'s scores are untouched, even where the file has one for it',
    res.rows[0][N] === 4 && res.rows[1][N] === 2)
  // A plain novelty / usefulness (no model name) goes under "model not recorded".
  const plain = mergeAiScoresIntoRows([{ rid: 'r1', idea_id: 'i1', idea_title: 'One', text: 'One' }], [{ idea_id: 'i1', novelty: 3, usefulness: 4 }])
  check('a file row with no model name fills "model not recorded"',
    plain.rows[0][aiFieldsFor(UNRECORDED).novelty] === 3 && plain.rows[0][aiFieldsFor(UNRECORDED).usefulness] === 4 && !('novelty' in plain.rows[0]))
}

console.log('mergeAiScoresIntoRows — matching rules')
{
  const rows = [
    { rid: 'r1', idea_id: 'i1', idea_title: 'Renamed since export', text: 'Renamed since export: x', [N]: '', [U]: '' },
    { rid: 'r2', idea_id: '',   idea_title: 'No id here',           text: 'No id here: y',           [N]: '', [U]: '' },
  ]
  const res = mergeAiScoresIntoRows(rows, [
    // Same Idea ID, DIFFERENT title — the id must win, or an edited title
    // silently orphans the score.
    { idea_id: 'i1', idea_title: 'What it was called before', [N]: 3, [U]: 3 },
    // No id at all — the title fallback is what carries an offline rating sheet.
    { idea_id: '', idea_title: 'no  id-HERE!!', [N]: 4, [U]: 4 },
  ])
  check('Idea ID wins over a changed title',
    res.rows[0][N] === 3, `got ${res.rows[0][N]}`)
  check('a file row with no id falls back to the normalised title',
    res.rows[1][N] === 4, `got ${res.rows[1][N]}`)

  // A duplicated file row must not be counted as a second match.
  const dup = mergeAiScoresIntoRows(
    [{ rid: 'r1', idea_id: 'i1', idea_title: 'One', text: 'One', [N]: '', [U]: '' }],
    [{ idea_id: 'i1', [N]: 2, [U]: 2 }, { idea_id: 'i1', [N]: 5, [U]: 5 }])
  check('a duplicate file row is reported unmatched, not matched twice',
    dup.matched === 1 && dup.unmatched === 1, `matched=${dup.matched} unmatched=${dup.unmatched}`)
  check('and the first row\'s values are the ones kept',
    dup.rows[0][N] === 2, `got ${dup.rows[0][N]}`)

  // Nothing usable in the file must never blank what is already there.
  const blanked = mergeAiScoresIntoRows(
    [{ rid: 'r1', idea_id: 'i1', idea_title: 'One', text: 'One', [N]: 4, [U]: 4 }],
    [{ idea_id: 'i1', [N]: '', [U]: 'n/a' }])
  check('an empty or unparseable file cell never blanks a stored score',
    blanked.rows[0][N] === 4 && blanked.rows[0][U] === 4)
  check('a row the file has nothing usable for counts as kept',
    blanked.kept === 1 && blanked.filled === 0)

  // Out-of-range values are clamped to the 1–5 rating scale.
  const clamped = mergeAiScoresIntoRows(
    [{ rid: 'r1', idea_id: 'i1', idea_title: 'One', text: 'One', [N]: '', [U]: '' }],
    [{ idea_id: 'i1', [N]: 9, [U]: -2 }])
  check('scores are clamped to 1–5',
    clamped.rows[0][N] === 5 && clamped.rows[0][U] === 1,
    `${clamped.rows[0][N]}/${clamped.rows[0][U]}`)

  // The 3.3 evaluator upload reuses the same matcher against ext_* columns.
  const ext = mergeAiScoresIntoRows(
    [{ rid: 'r1', idea_id: 'i1', idea_title: 'One', text: 'One', [N]: 4, [U]: 4, ext_novelty: '', ext_usefulness: '' }],
    [{ idea_id: 'i1', novelty: 2, usefulness: 2 }],
    { novelty: 'ext_novelty', usefulness: 'ext_usefulness' })
  check('`fields` retargets the merge without touching the AI columns',
    ext.rows[0].ext_novelty === 2 && ext.rows[0][N] === 4)
}

// ── shouldRunAnotherPass ───────────────────────────────────────────────────
console.log('shouldRunAnotherPass — one press keeps going while it is working')
{
  check('nothing left to fill → stop',
    shouldRunAnotherPass({ pass: 1, filled: 10, remaining: 0 }) === false)
  check('a pass that filled something and left gaps → go again',
    shouldRunAnotherPass({ pass: 1, filled: 10, remaining: 5 }) === true)
  check('a pass that reached every idea and filled nothing → stop (not aborted)',
    shouldRunAnotherPass({ pass: 1, filled: 0, remaining: 400, aborted: false }) === false)
  check('an ABORTED pass that filled nothing → one more go: the ideas were never sent',
    shouldRunAnotherPass({ pass: 1, filled: 0, remaining: 400, aborted: true, recoveries: 0 }) === true)
  check('but only a BOUNDED number of times, so a dead provider is not hammered',
    shouldRunAnotherPass({ pass: 3, filled: 0, remaining: 400, aborted: true, recoveries: 2 }) === false)
  check('a transient outage that still filled some → go again',
    shouldRunAnotherPass({ pass: 2, filled: 120, remaining: 260, aborted: true }) === true)
  check('the backstop caps the passes however well it is going',
    shouldRunAnotherPass({ pass: 4, maxPasses: 4, filled: 50, remaining: 50 }) === false)
  check('an unreadable-reply straggler earns a retry pass',
    shouldRunAnotherPass({ pass: 1, filled: 431, remaining: 4 }) === true)

  // The loop terminates: drive it the way the page does.
  let remaining = 100, pass = 0, guard = 0
  do {
    pass++; guard++
    const filled = Math.min(remaining, 40)
    remaining -= filled
    if (!shouldRunAnotherPass({ pass, maxPasses: 4, filled, remaining })) break
  } while (guard < 50)
  check('the fill loop terminates and clears the gap', remaining === 0 && pass === 3,
    `remaining=${remaining} passes=${pass}`)

  let deadPasses = 0, recoveries = 0
  for (let p = 1; p <= 20; p++) {
    deadPasses = p
    if (!shouldRunAnotherPass({ pass: p, filled: 0, remaining: 400, aborted: true, recoveries })) break
    recoveries++
  }
  check('a dead provider is bounded at 1 + MAX_RECOVERY_PASSES attempts',
    deadPasses === 1 + MAX_RECOVERY_PASSES, `passes=${deadPasses}`)
}

// ── End to end: the owner's scenario, driven through the REAL scoring engine ──
// A dataset of 741 ideas, 24 of them still empty, and one press of "Fill …".
// This drives `runScoring` from scoreBatch.js exactly as the page does, so it
// proves the loop as a whole — not each half in isolation.
console.log('one press fills the gap — the real engine, a fake model')
{
  const { runScoring } = await import('../src/utils/scoreBatch.js')

  const makeRows = () => Array.from({ length: 741 }, (_, i) => ({
    rid: `r${i}`, idea_id: `i${i}`, idea_title: `Idea ${i}`, text: `Idea ${i}: a colour-changing fabric concept`,
    // The reported state: 24 ideas left with no AI Novelty / AI Usefulness.
    novelty: i < 24 ? '' : 3, usefulness: i < 24 ? '' : 4, final_pick: i % 4 === 0 ? 1 : 0,
  }))

  // The page's own loop, transcribed: re-derive the gap each pass, score it,
  // fill blanks only, and ask `shouldRunAnotherPass` whether to go again.
  async function fillRun(rows, call, { maxPasses = 4 } = {}) {
    let working = rows, pass = 0, totalFilled = 0, aborted = false, recoveries = 0
    do {
      pass++
      const targets = working
        .filter(r => { const st = ideaScoreState(r); return st === 'missing' || st === 'partial' })
        .map(r => ({ rid: r.rid, text: scorableText(r) }))
      if (!targets.length) break
      const res = await runScoring({
        texts: targets.map(t => t.text), call, batchSize: 8, sleep: () => Promise.resolve(),
      })
      aborted = res.aborted
      const byRid = new Map(targets.map((t, k) => [t.rid, res.scores[k]]))
      let filled = 0
      working = working.map(r => {
        const sc = byRid.get(r.rid)
        if (!sc) return r
        const next = {
          ...r,
          novelty: r.novelty === '' && sc.novelty != null ? sc.novelty : r.novelty,
          usefulness: r.usefulness === '' && sc.usefulness != null ? sc.usefulness : r.usefulness,
        }
        if (next.novelty !== r.novelty || next.usefulness !== r.usefulness) filled++
        return next
      })
      totalFilled += filled
      if (!shouldRunAnotherPass({
        pass, maxPasses, filled, remaining: scoreGaps(working).fillable, aborted, recoveries,
      })) break
      if (filled === 0) recoveries++   // the page waits here; the guard does not need to
    } while (true)
    return { rows: working, pass, totalFilled, aborted, recoveries }
  }

  const reply = (texts, offs) =>
    JSON.stringify(offs.map((o, k) => ({ i: k, novelty: 3, usefulness: 4 })))

  // The state the owner saw before pressing anything.
  const before = scoreGaps(makeRows())
  check('the panel reads the reported state: 24 of 741 still empty',
    before.total === 741 && before.fillable === 24 && before.scored === 717,
    `total=${before.total} fillable=${before.fillable} scored=${before.scored}`)

  // 1. A healthy provider: one press, no gap left.
  const healthy = await fillRun(makeRows(), reply)
  check('healthy provider — one press clears all 24 in a single pass',
    healthy.totalFilled === 24 && healthy.pass === 1 && scoreGaps(healthy.rows).complete,
    `filled=${healthy.totalFilled} passes=${healthy.pass} left=${scoreGaps(healthy.rows).fillable}`)

  // 2. A TRANSIENT outage: the provider dies long enough to trip the circuit
  //    breaker, then recovers. The old page stopped there and left the rest
  //    empty; the pass loop is what finishes the job.
  let calls = 0
  const flaky = (texts, offs) => {
    calls++
    // Fail every call of the first pass hard enough to trip the breaker
    // (3 consecutive failed batches, each retried 3×), then recover.
    if (calls <= 9) return Promise.reject(new Error('429 rate limited'))
    return Promise.resolve(reply(texts, offs))
  }
  const recovered = await fillRun(makeRows(), flaky)
  check('a transient outage aborts a pass — and the next pass finishes the job',
    scoreGaps(recovered.rows).complete && recovered.pass > 1 && recovered.totalFilled === 24,
    `filled=${recovered.totalFilled} passes=${recovered.pass} left=${scoreGaps(recovered.rows).fillable}`)

  // 3. A DEAD provider: nothing is filled, and it must not grind through four
  //    passes of backoff before saying so.
  const dead = await fillRun(makeRows(), () => Promise.reject(new Error('503 service unavailable')))
  check('a dead provider fills nothing, aborts, and is bounded at 1 + 2 attempts',
    dead.totalFilled === 0 && dead.aborted && dead.pass === 1 + MAX_RECOVERY_PASSES,
    `filled=${dead.totalFilled} aborted=${dead.aborted} passes=${dead.pass}`)
  check('and it leaves every already-scored idea exactly as it was',
    scoreGaps(dead.rows).scored === 717, `scored=${scoreGaps(dead.rows).scored}`)

  // 4. A model that returns SHORT batches leaves stragglers; the retry pass
  //    picks up exactly those, and nothing already scored is touched.
  let short = 0
  const shortReply = (texts, offs) => {
    short++
    // On the first pass drop the last entry of each multi-idea batch; single-idea
    // retries (round 2 inside runScoring) answer normally.
    const keep = short <= 3 && offs.length > 1 ? offs.length - 1 : offs.length
    return Promise.resolve(JSON.stringify(
      Array.from({ length: keep }, (_, k) => ({ i: k, novelty: 2, usefulness: 5 }))))
  }
  const stragglers = await fillRun(makeRows(), shortReply)
  check('short replies still end with every idea scored',
    scoreGaps(stragglers.rows).complete, `left=${scoreGaps(stragglers.rows).fillable}`)
  check('a previously-scored idea is never overwritten by the fill run',
    stragglers.rows[700].novelty === 3 && stragglers.rows[700].usefulness === 4,
    `${stragglers.rows[700].novelty}/${stragglers.rows[700].usefulness}`)

  // 5. An unratable idea must not keep the loop running for ever.
  const withBlank = makeRows()
  withBlank[0] = { ...withBlank[0], text: '', idea_title: '', idea_description: '' }
  const withBlanks = await fillRun(withBlank, reply)
  const end = scoreGaps(withBlanks.rows)
  check('an idea with no text ends as unratable, and the fillable gap reaches zero',
    end.fillable === 0 && end.unratable === 1 && withBlanks.pass <= 4,
    `fillable=${end.fillable} unratable=${end.unratable} passes=${withBlanks.pass}`)
}

// ── The throw path: a pass that scored NOTHING ────────────────────────────
// `scoreIdeas` throws when a run came back with nothing at all, which is the
// exact case the recovery rule exists for — so it must not escape the fill loop.
// The end-to-end block above drives `runScoring` directly and therefore could
// not see this; these checks pin the page's own handling from its source.
console.log('a pass that scored nothing is recovered, not thrown away')
{
  const { isFatalScoringError } = await import('../src/utils/scoreBatch.js')
  const page = readFileSync(new URL('../src/pages/DataAnalytics.jsx', import.meta.url), 'utf8')

  check('a missing API key is fatal — it fails the same way every time',
    isFatalScoringError(Object.assign(new Error('No API key saved'), { fatal: true })) === true)
  check('a rejected key (401) is fatal', isFatalScoringError({ status: 401 }) === true)
  check('a refused request (400/403/404) is fatal',
    isFatalScoringError({ status: 400 }) && isFatalScoringError({ status: 403 })
    && isFatalScoringError({ status: 404 }))
  check('a rate limit (429) is NOT fatal — that is the one worth another go',
    isFatalScoringError({ status: 429 }) === false)
  check('a 5xx and a bare network error are NOT fatal',
    isFatalScoringError({ status: 503 }) === false && isFatalScoringError(new Error('fetch failed')) === false)
  check('an undefined error does not crash the test', isFatalScoringError(undefined) === false)

  check('the fill loop CATCHES around scoreIdeas rather than letting a pass throw out',
    /scores = await scoreIdeas\([\s\S]{0,600}?\} catch \(err\) \{[\s\S]{0,600}?isFatalScoringError\(err\)/.test(page),
    'scoreIdeas is not wrapped, so a scored-nothing pass aborts the whole run')
  check('a fatal error still stops the run at once',
    /if \(isFatalScoringError\(err\)\) throw err/.test(page))
  check('a thrown pass counts as aborted whatever the report said',
    /aborted = !!report\?\.aborted \|\| threw/.test(page),
    'the report can reset `aborted` to false and skip the recovery pass')
}

// ── Two false-positive traps ───────────────────────────────────────────────
console.log('a partial idea with no text is unratable, not fillable')
{
  // One score, no text: its other column can no more be filled than a blank
  // idea's, so counting it as fillable puts a number on the panel that pressing
  // the button can never bring down.
  const r = { idea_id: 'x', text: '', idea_title: '', novelty: 4, usefulness: '' }
  check('classified unratable', ideaScoreState(r) === 'unratable', ideaScoreState(r))
  const g = scoreGaps([r])
  check('it is NOT offered to the run', g.fillable === 0, `fillable=${g.fillable}`)
  check('but its empty cell is still reported', g.missingUsefulness === 1 && g.gaps === 1)
  check('a partial idea WITH text is still fillable',
    scoreGaps([{ ...r, text: 'a real idea' }]).fillable === 1)
}

console.log('an auto-generated import id never joins two unrelated files')
{
  // `normalizeImportedRows` invents `import_<n>` for a file with no Idea ID
  // column. Those are POSITIONS: joining on one writes the third row of one file
  // onto the third row of another.
  const rows = [{ rid: 'r1', idea_id: 'import_1', idea_title: 'Solar awning', text: 'Solar awning', novelty: '', usefulness: '' }]
  const wrong = mergeAiScoresIntoRows(rows, [{ idea_id: 'import_1', idea_title: 'A completely different idea', [N]: 5, [U]: 5 }])
  check('a positional id does NOT match a different idea',
    !wrong.rows[0][N] && wrong.unmatched === 1,
    `novelty=${wrong.rows[0][N]} unmatched=${wrong.unmatched}`)
  const right = mergeAiScoresIntoRows(rows, [{ idea_id: 'import_9', idea_title: 'Solar awning', [N]: 5, [U]: 5 }])
  check('the title still matches it, so a genuine top-up is not lost',
    right.rows[0][N] === 5 && right.matched === 1)
  check('a REAL Idea ID still joins',
    mergeAiScoresIntoRows(
      [{ rid: 'r1', idea_id: 'abc123', idea_title: 'One', text: 'One', novelty: '', usefulness: '' }],
      [{ idea_id: 'abc123', idea_title: 'Renamed', [N]: 2, [U]: 2 }]).rows[0][N] === 2)
}

// ── Which sheet of an uploaded workbook carries the scores ────────────────
// Shapes taken from the owner's own two exports (2026-08-25): a 13-tab aggregate
// whose `Ideas` tab holds 0 of 741 AI values and whose `Rankings` tab holds
// 741 of 741, and the plain two-tab `ideas_with_kpis`.
console.log('pickScoredSheet — the scores are not always on the sheet called Ideas')
{
  const aggregate = [
    { name: 'About', rows: [{ 'Ideation Challenge — aggregated research data export': 'x' }] },
    { name: 'Participants', rows: [{ 'Author ID': 'a1', 'Author Name': 'A' }] },
    // The real shape: identifiable rows, blind-rater columns, all empty.
    { name: 'Ideas', rows: [
      { 'Idea ID': 'i1', 'Session Code': 'SGP1', Title: 'One', 'Novelty (rater 1)': '', 'Usefulness (rater 1)': '' },
      { 'Idea ID': 'i2', 'Session Code': 'SGP1', Title: 'Two', 'Novelty (rater 1)': '', 'Usefulness (rater 1)': '' },
    ] },
    { name: 'Rankings', rows: [
      { 'Idea ID': 'i1', Condition: 'None', Title: 'One', Novelty: 3, Usefulness: 4, 'Novelty (objective)': '' },
      { 'Idea ID': 'i2', Condition: 'Solo', Title: 'Two', Novelty: 2, Usefulness: 5, 'Novelty (objective)': '' },
    ] },
  ]
  const got = pickScoredSheet(aggregate)
  check('the 13-tab aggregate resolves to Rankings, NOT Ideas',
    got && got.name === 'Rankings', got && got.name)
  check('and it counted the AI values it found', got.scored === 4, `scored=${got && got.scored}`)

  // The July export names them "AI Novelty" / "AI Usefulness".
  const july = [
    { name: 'Ideas', rows: [{ 'Idea ID': 'i1', Title: 'One', 'Novelty (rater 1)': '' }] },
    { name: 'Rankings', rows: [{ 'Idea ID': 'i1', Title: 'One', 'AI Novelty': 4, 'AI Usefulness': 4 }] },
  ]
  check('the "AI Novelty" spelling is recognised too',
    pickScoredSheet(july).name === 'Rankings', pickScoredSheet(july).name)

  // The plain ideas_with_kpis download: one sheet, scores on it.
  const simple = [{ name: 'ideas', rows: [
    { 'Idea ID': 'i1', Title: 'One', 'AI Novelty': 3, 'AI Usefulness': 3 },
  ] }]
  check('the plain ideas_with_kpis workbook still resolves to its own sheet',
    pickScoredSheet(simple).name === 'ideas')

  // Nothing scored anywhere → the identifiable "Ideas" sheet still wins, which
  // is the Step-1 behaviour and the right answer for a dataset with no scores.
  const unscored = [
    { name: 'Rankings', rows: [{ 'Idea ID': 'i1', Title: 'One', Novelty: '', Usefulness: '' }] },
    { name: 'Ideas', rows: [{ 'Idea ID': 'i1', Title: 'One', 'Session Code': 'SGP1' }] },
  ]
  check('with no scores anywhere, the Ideas sheet wins', pickScoredSheet(unscored).name === 'Ideas')

  // Guards against picking the wrong thing.
  check('a sheet that cannot identify its rows is never chosen',
    pickScoredSheet([{ name: 'AI Usage', rows: [{ Novelty: 5, Usefulness: 5 }] }]) === null)
  check('a preamble sheet with no rows is skipped',
    pickScoredSheet([{ name: 'About', rows: [] }, { name: 'ideas', rows: [{ 'Idea ID': 'i1' }] }]).name === 'ideas')
  check('blind-rater columns do not make a sheet the scores sheet',
    pickScoredSheet([
      { name: 'Ideas', rows: [{ 'Idea ID': 'i1', 'Novelty (rater 1)': 4, 'Usefulness (rater 2)': 5 }] },
    ]).scored === 0)
  check('the objective KPIs do not either',
    pickScoredSheet([
      { name: 'Ideas', rows: [{ 'Idea ID': 'i1', 'Novelty (objective)': 0.9, 'Pool distinctiveness': 0.8 }] },
    ]).scored === 0)
  check('an empty workbook returns null, it does not throw',
    pickScoredSheet([]) === null && pickScoredSheet(null) === null)
  // A column that only MENTIONS novelty is not an AI score (review finding,
  // 2026-09-24): the importer keeps "Embedding novelty" as an extra KPI, so a
  // sheet of them must not win the pick over the sheet with the AI scores, or
  // the top-up reads a sheet whose scores it will never find.
  const embed = [
    { name: 'Rankings', rows: [{ 'Idea ID': 'i1', Title: 'One', 'AI Novelty (GPT-6 Astra)': 4 }] },
    { name: 'Embeddings', rows: [{ 'Idea ID': 'i1', 'Embedding novelty': 0.3, 'Novelty SD': 0.7, 'Novelty rank': 3 }, { 'Idea ID': 'i2', 'Embedding novelty': 0.5 }] },
  ]
  check('"Embedding novelty", "Novelty SD", "Novelty rank" are not AI scores',
    pickScoredSheet(embed).name === 'Rankings' && pickScoredSheet([embed[1]]).scored === 0, JSON.stringify(pickScoredSheet(embed)?.name))
  // ...while a decorated score with no model name is one, as the importer reads it.
  check('"Novelty Rating" / "Usefulness (1-5)" are AI scores (no model name)',
    pickScoredSheet([{ name: 'Scores', rows: [{ 'Idea ID': 'i1', 'Novelty Rating': 4, 'Usefulness (1-5)': 3 }] }]).scored === 2)
}

// ── Ideas are numbered per session: the top-up joins on Idea ID WITHIN a session ──
console.log('\nIdea ID + session (review, 2026-09-24)')
{
  const rows = [
    { rid: 'a', idea_id: '1', session: 'S1', idea_title: 'Fever sock' },
    { rid: 'b', idea_id: '1', session: 'S2', idea_title: 'Heat cup' },
  ]
  const astra = aiFieldsFor('gpt-6-astra')
  const inc = normalizeImportedRows([
    { 'Idea ID': '1', 'Session Code': 'S2', Condition: 'Group', Title: 'Heat cup', 'AI Novelty (GPT-6 Astra)': 4, 'AI Usefulness (GPT-6 Astra)': 3 },
  ])
  const r = mergeAiScoresIntoRows(rows, inc)
  check('a file row for S2\'s idea 1 fills S2\'s idea 1, not S1\'s', r.rows[1][astra.novelty] === 4 && r.rows[0][astra.novelty] == null, JSON.stringify(r.rows))
  const amb = mergeAiScoresIntoRows(rows, normalizeImportedRows([
    { 'Idea ID': '1', Condition: 'Group', Title: 'Something else', 'AI Novelty (GPT-6 Astra)': 2, 'AI Usefulness (GPT-6 Astra)': 2 },
  ]))
  check('an id two sessions share, with no session in the file and no title match, is left unmatched (never guessed)',
    amb.matched === 0 && amb.unmatched === 1 && amb.rows.every(x => x[astra.novelty] == null))
  const one = mergeAiScoresIntoRows([rows[0]], inc)
  check('an id only one session uses still matches, whatever the file calls its session', one.matched === 1 && one.rows[0][astra.novelty] === 4)
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.')
process.exit(failures ? 1 : 0)
