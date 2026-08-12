/**
 * score-batch-guard.mjs — offline test (no network, no deps).
 *
 *   node _ideasearchlab-src/tools/score-batch-guard.mjs
 *
 * Reproduces, against a FAKE model, every way the Data Analytics AI rater used
 * to finish a long run with empty rows (owner report 2026-08: "uploaded 435
 * ideas, asked for AI scores, some rows were empty"), and pins the fixes in
 * `src/utils/scoreBatch.js`. Each case here failed before that module existed.
 *
 * The rule the whole file is really guarding: **a run never silently loses an
 * idea.** Either it is scored, or it is counted in `unscored` so the page can
 * say so and the user can press Score again.
 */
import {
  runScoring, extractScoreObjects, assignScores, withRetry, clamp1to5, isScoredEntry,
} from '../src/utils/scoreBatch.js'

let failures = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}
const nosleep = () => Promise.resolve()
const texts = n => Array.from({ length: n }, (_, i) => `idea number ${i}`)
const reply = (count, offset = 0) => JSON.stringify(
  Array.from({ length: count }, (_, i) => ({ i, novelty: 3, usefulness: 4, tag: offset + i })))

// ── The parser ─────────────────────────────────────────────────────────────
console.log('extractScoreObjects — what the model actually sends back')
{
  check('a clean array parses',
    extractScoreObjects('[{"i":0,"novelty":3,"usefulness":4}]').length === 1)
  check('a ```json fenced array parses',
    extractScoreObjects('```json\n[{"i":0,"novelty":3,"usefulness":4}]\n```').length === 1)
  check('prose around the array is ignored',
    extractScoreObjects('Sure! Here you go:\n[{"i":0,"novelty":3,"usefulness":4}]\nHope that helps')
      .length === 1)
  // THE regression: a reply cut off by the token limit has no closing "]" —
  // the old array-only parser returned null and lost all 8 ideas of the batch.
  const truncated = '[{"i":0,"novelty":3,"usefulness":4},{"i":1,"novelty":5,"usefulness":2},{"i":2,"nove'
  check('a reply TRUNCATED mid-array still yields its complete objects',
    extractScoreObjects(truncated).length === 2, JSON.stringify(extractScoreObjects(truncated)))
  check('newline-delimited objects (no array at all) parse',
    extractScoreObjects('{"i":0,"novelty":3,"usefulness":4}\n{"i":1,"novelty":2,"usefulness":2}').length === 2)
  check('an empty or junk reply yields nothing, never throws',
    extractScoreObjects('').length === 0 && extractScoreObjects('I cannot do that').length === 0)
}

// ── Slot assignment ────────────────────────────────────────────────────────
console.log('assignScores — one score per idea, whatever indices come back')
{
  const inOrder = assignScores([{ novelty: 1, usefulness: 2 }, { novelty: 3, usefulness: 4 }], 2)
  check('objects with no "i" fill the slots in order',
    inOrder[0].novelty === 1 && inOrder[1].novelty === 3)

  // THE regression: two objects claiming the same index overwrote one slot and
  // left another idea empty.
  const dup = assignScores(
    [{ i: 1, novelty: 1, usefulness: 1 }, { i: 1, novelty: 5, usefulness: 5 }, { i: 0, novelty: 2, usefulness: 2 }], 3)
  check('a DUPLICATE "i" does not clobber a sibling — every idea still gets a score',
    dup.every(Boolean), JSON.stringify(dup))
  check('the first claim on an index wins, the duplicate takes a free slot',
    dup[1].novelty === 1 && dup[0].novelty === 2, JSON.stringify(dup))

  const oob = assignScores([{ i: 99, novelty: 4, usefulness: 4 }], 2)
  check('an out-of-range "i" falls back to a free slot instead of vanishing',
    oob[0] && oob[0].novelty === 4, JSON.stringify(oob))

  const partial = assignScores([{ i: 0, novelty: 'n/a', usefulness: 4 }], 1)
  check('a non-numeric rating is null, and the entry counts as UNSCORED (so it retries)',
    partial[0].novelty === null && !isScoredEntry(partial[0]))
  check('clamp1to5 keeps ratings on the scale', clamp1to5(9) === 5 && clamp1to5(0) === 1 && clamp1to5('x') === null)
}

// ── Retry ──────────────────────────────────────────────────────────────────
console.log('withRetry — transient failures are retried, fatal ones are not')
{
  let calls = 0
  const flaky = async () => { calls++; if (calls < 3) { const e = new Error('429'); e.status = 429; throw e } return 'ok' }
  const got = await withRetry(flaky, { attempts: 3, sleep: nosleep })
  check('a call that succeeds on the 3rd attempt returns its value', got === 'ok' && calls === 3, `calls=${calls}`)

  let fatalCalls = 0
  const badKey = async () => { fatalCalls++; const e = new Error('401'); e.status = 401; throw e }
  await withRetry(badKey, { attempts: 3, sleep: nosleep, isFatal: e => e.status === 401 }).catch(() => {})
  check('a FATAL error is not retried (a rejected key fails the same way every time)',
    fatalCalls === 1, `calls=${fatalCalls}`)
}

// ── The whole run ──────────────────────────────────────────────────────────
console.log('runScoring — a long run keeps every score it can get')
{
  // A model that returns only 6 entries for every batch of 8: the 2 left over
  // used to stay empty for good. They must now be retried one at a time.
  let batchCalls = 0, singleCalls = 0
  const short = async ts => { ts.length === 1 ? singleCalls++ : batchCalls++; return reply(Math.min(6, ts.length)) }
  const r = await runScoring({ texts: texts(16), call: short, batchSize: 8, sleep: nosleep })
  check('a SHORT reply (6 of 8) leaves nobody unscored', r.unscored === 0, `unscored=${r.unscored}`)
  check('the missing ideas were retried individually', singleCalls === 4, `single calls=${singleCalls}`)
  check('every returned score is complete', r.scores.every(isScoredEntry))
}
{
  // THE big one: one failing call used to throw away every score already
  // collected (54 good batches lost to a 429 on the 55th).
  let n = 0
  const flakyBatch = async ts => {
    n++
    if (n === 3) { const e = new Error('rate limited'); e.status = 429; throw e }
    return reply(ts.length)
  }
  const r = await runScoring({ texts: texts(40), call: flakyBatch, batchSize: 8, sleep: nosleep })
  check('a transient failure mid-run is retried and costs nothing',
    r.unscored === 0 && r.scores.every(isScoredEntry), `unscored=${r.unscored}`)
}
{
  // A batch whose calls never succeed: its ideas stay null, but every OTHER
  // batch keeps its scores and the run reports the shortfall.
  const deadBatch = async ts => {
    if (ts.some(t => t.includes('idea number 1') && t.length === 'idea number 1x'.length - 1)) { /* noop */ }
    if (ts.every(t => Number(t.split(' ')[2]) >= 8 && Number(t.split(' ')[2]) < 16)) {
      const e = new Error('server error'); e.status = 500; throw e
    }
    return reply(ts.length)
  }
  const r = await runScoring({ texts: texts(24), call: deadBatch, batchSize: 8, sleep: nosleep })
  check('a permanently failing batch does not cost the other batches their scores',
    r.scores.filter(isScoredEntry).length === 16, `scored=${r.scores.filter(isScoredEntry).length}`)
  check('the failed ideas are REPORTED, not silently empty', r.unscored === 8, `unscored=${r.unscored}`)
  check('the failure is exactly the ideas of that batch',
    r.scores.slice(8, 16).every(s => s === null), 'wrong ideas went missing')
}
{
  // A fatal error aborts the run rather than burning the whole catalogue
  // against a key the provider has already rejected.
  const badKey = async () => { const e = new Error('invalid x-api-key'); e.status = 401; throw e }
  let threw = null
  await runScoring({ texts: texts(24), call: badKey, batchSize: 8, sleep: nosleep, isFatal: e => e.status === 401 })
    .catch(e => { threw = e })
  check('a fatal API error aborts the run', threw !== null && /invalid x-api-key/.test(threw.message))
}
{
  // Ideas with no text can never be rated — they must not burn retries, and
  // they must be reported separately from ideas the model failed on.
  const all = ['real idea', '   ', 'another real one', '']
  let calls = 0
  const r = await runScoring({ texts: all, call: async ts => { calls++; return reply(ts.length) }, batchSize: 8, sleep: nosleep })
  check('blank ideas are never sent to the model', calls === 1, `calls=${calls}`)
  check('blank ideas are counted apart from failures', r.blank === 2 && r.unscored === 0,
    `blank=${r.blank} unscored=${r.unscored}`)
  check('the real ideas are scored', isScoredEntry(r.scores[0]) && isScoredEntry(r.scores[2]))
}
{
  // The reported case, end to end: 435 ideas (55 batches) against a model that
  // rate-limits now and then and truncates long replies — truncation is a
  // function of reply LENGTH, so a batch of 8 can be cut off while the
  // one-idea retries come back whole.
  let n = 0
  const messy = async ts => {
    n++
    if (n % 11 === 0) { const e = new Error('429'); e.status = 429; throw e }
    const full = reply(ts.length)
    return (ts.length > 1 && n % 3 === 0) ? full.slice(0, Math.floor(full.length * 0.7)) : full
  }
  const seen = []
  const r = await runScoring({
    texts: texts(435), call: messy, batchSize: 8, sleep: nosleep,
    onProgress: p => seen.push(p.done),
  })
  check('435 ideas: every one comes back with a score', r.unscored === 0, `unscored=${r.unscored}`)
  check('progress reaches the full total', seen[seen.length - 1] === 435, `last=${seen[seen.length - 1]}`)
  check('no score is half-filled', r.scores.filter(Boolean).every(isScoredEntry))
}
{
  // Worst case: the model cannot handle ONE idea however often it is asked
  // (some text it always answers with prose). That idea must not be silently
  // empty — it is reported — and pressing "Score" again must pick up exactly
  // it, which is what the page does by re-targeting ideas with no score.
  const cursed = 'idea number 5'
  // Rates everything EXCEPT the cursed idea — whose index is simply absent from
  // the batch reply, and whose solo call comes back as prose.
  const picky = async ts => {
    const objs = ts.map((t, i) => ({ t, i })).filter(x => x.t !== cursed)
      .map(x => ({ i: x.i, novelty: 3, usefulness: 4 }))
    return objs.length ? JSON.stringify(objs) : 'I am not able to rate that one.'
  }
  const r = await runScoring({ texts: texts(16), call: picky, batchSize: 8, sleep: nosleep })
  check('one unratable idea costs only itself', r.unscored === 1, `unscored=${r.unscored}`)
  check('the other 15 are scored', r.scores.filter(isScoredEntry).length === 15)

  // The press-again path: re-run over just the ideas still missing a score.
  const stillEmpty = texts(16).filter((t, i) => !isScoredEntry(r.scores[i]))
  const r2 = await runScoring({ texts: stillEmpty, call: async ts => reply(ts.length), sleep: nosleep })
  check('pressing Score again scores exactly those, with no other work',
    r2.unscored === 0 && stillEmpty.length === 1 && isScoredEntry(r2.scores[0]),
    `retried ${stillEmpty.length}`)
}

{
  // A provider that is simply down: the run must give up quickly instead of
  // grinding every remaining batch (and then every idea inside them) through
  // the backoff — 435 ideas would otherwise take the user an hour to be told
  // nothing worked.
  let calls = 0
  const dead = async () => { calls++; const e = new Error('503'); e.status = 503; throw e }
  const r = await runScoring({ texts: texts(400), call: dead, batchSize: 8, sleep: nosleep })
  check('a dead provider aborts after a few failed batches', r.aborted === true)
  check('it does not attempt all 50 batches', r.failedBatches === 3, `failedBatches=${r.failedBatches}`)
  check('and does not fan out to per-idea calls when the transport is down',
    calls === 9, `calls=${calls} (3 batches x 3 transport attempts)`)
  check('the shortfall is still reported honestly', r.unscored === 400, `unscored=${r.unscored}`)
}

console.log(failures
  ? `\n${failures} check(s) FAILED`
  : '\nSCORE-BATCH GUARD OK — truncated, short, duplicate-indexed and rate-limited replies all still score every idea.')
process.exit(failures ? 1 : 0)
