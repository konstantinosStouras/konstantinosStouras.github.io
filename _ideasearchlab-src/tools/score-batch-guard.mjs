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
  runScoring, extractScoreObjects, assignScores, withRetry, wholeRating, isScoredEntry, isFatalApiError,
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
  // The API's ratings must be whole numbers from 1 to 5; nothing is rounded or held
  // to the scale (owner, 2026-09-24).
  check('wholeRating accepts a whole number from 1 to 5 and nothing else',
    wholeRating(1) === 1 && wholeRating(5) === 5 && wholeRating('4') === 4 && wholeRating(4.0) === 4 && wholeRating(' 3 ') === 3
    && wholeRating(3.5) === null && wholeRating('2.5') === null && wholeRating(0) === null && wholeRating(6) === null && wholeRating(9) === null
    && wholeRating(-1) === null && wholeRating('x') === null && wholeRating('') === null && wholeRating(null) === null && wholeRating(true) === null)
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

// ── A rating that is not a whole number from 1 to 5 ───────────────────────────
console.log('runScoring — only whole-number ratings from 1 to 5 are kept, none is rounded')
{
  // The batch answers 3.5 / 0 / 7 for three ideas; asked again one at a time, the
  // model answers whole numbers. Those are what is kept, exactly as given.
  const asked = []
  const call = async ts => {
    asked.push(ts.length)
    if (ts.length > 1) return JSON.stringify(ts.map((_, i) => ({ i, novelty: i === 1 ? 3.5 : i === 2 ? 0 : 2, usefulness: i === 3 ? 7 : 4 })))
    return JSON.stringify([{ i: 0, novelty: 5, usefulness: 1 }])
  }
  const r = await runScoring({ texts: texts(6), call, batchSize: 6, sleep: nosleep })
  check('the three ideas with a fractional or off-scale rating are asked again, one at a time',
    asked[0] === 6 && asked.slice(1).length === 3 && asked.slice(1).every(n => n === 1), JSON.stringify(asked))
  check('every kept rating is exactly what the model said, a whole number from 1 to 5 (nothing rounded)',
    r.unscored === 0 && r.scores.every(e => [e.novelty, e.usefulness].every(v => Number.isInteger(v) && v >= 1 && v <= 5))
    && r.scores[0].novelty === 2 && r.scores[0].usefulness === 4 && [1, 2, 3].every(i => r.scores[i].novelty === 5 && r.scores[i].usefulness === 1),
    JSON.stringify(r.scores))
  // A model that keeps answering 3.5 leaves the idea unscored rather than rounded.
  const stubborn = async ts => JSON.stringify(ts.map((_, i) => ({ i, novelty: 3.5, usefulness: 4 })))
  const s2 = await runScoring({ texts: texts(2), call: stubborn, batchSize: 2, sleep: nosleep })
  check('a model that only answers 3.5 leaves the idea unscored, never rounded to 4',
    s2.unscored === 2 && s2.scores.every(e => e == null || e.novelty == null), JSON.stringify(s2.scores))
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

// ── A reply problem (the provider answered, but gave no rating) ────────────
{
  // A refusal about ONE idea's content: the batch call throws a
  // `replyProblem` error with `retryable: false` (providerRequest.js). The
  // batch-mates must still be scored one by one — under the transport-failure
  // path a thrown batch skipped round 2 and the same batch re-formed on every
  // pass, so one refused idea cost its seven neighbours their scores for good.
  const refusal = () => Object.assign(new Error('Claude (claude-sonnet-5) declined to rate this batch (refusal: cyber)'), { replyProblem: 'refusal', retryable: false })
  let calls = 0
  const refusing = async ts => {
    calls++
    if (ts.length > 1 || ts[0] === 'idea number 3') throw refusal()
    return reply(1)
  }
  const r = await runScoring({ texts: texts(8), call: refusing, batchSize: 8, sleep: nosleep })
  check('a refused batch still scores its batch-mates one by one', r.scores.filter(isScoredEntry).length === 7 && r.scores[3] === null)
  check('the refused idea is counted, not the whole batch', r.unscored === 1 && r.failedBatches === 0 && r.aborted === false)
  check('the cause reaches lastError', /refusal: cyber/.test(r.lastError?.message || ''))
  check('a refusal is not transport-retried (1 batch call + 8 single calls)', calls === 9, `calls=${calls}`)
}
{
  // The ceiling spent on hidden thinking (`retryable: true`) IS worth another
  // go — thinking length varies — so the transport retry handles it.
  const exhausted = () => Object.assign(new Error('spent its whole ceiling on thinking and returned no text'), { replyProblem: 'exhausted', retryable: true })
  let n = 0
  const flaky = async ts => { n++; if (n <= 2) throw exhausted(); return reply(ts.length) }
  const r = await runScoring({ texts: texts(8), call: flaky, batchSize: 8, sleep: nosleep })
  check('a thinking-exhausted reply is retried and the batch scores in full', r.scores.every(isScoredEntry) && n === 3 && r.failedBatches === 0)
}
{
  // Three refusals in a row must NOT trip the circuit breaker — the provider
  // is answering, it is the content it declines.
  const refusal = () => Object.assign(new Error('declined'), { replyProblem: 'refusal', retryable: false })
  const r = await runScoring({ texts: texts(32), call: async ts => { if (ts.length > 1) throw refusal(); return reply(1) }, batchSize: 8, sleep: nosleep })
  check('refusals never trip the breaker; every idea is scored singly', r.aborted === false && r.scores.every(isScoredEntry))
}

{
  // A request the provider rejects as INVALID fails identically every time:
  // 422 (DeepSeek's "Invalid Parameters", Mistral's request validation) is
  // fatal like 400. It used to be retried: 27 calls over 52.8 s, then "check
  // the API key and quota", which is not the cause.
  check('422 and 400 are fatal; 429 and 503 are not',
    isFatalApiError({ status: 422 }) && isFatalApiError({ status: 400 }) && !isFatalApiError({ status: 429 }) && !isFatalApiError({ status: 503 }))
  let calls = 0
  const invalid = async () => { calls++; const e = new Error('422 Invalid Parameters'); e.status = 422; throw e }
  let threw = null
  await runScoring({ texts: texts(24), call: invalid, batchSize: 8, sleep: nosleep, isFatal: isFatalApiError }).catch(e => { threw = e })
  check('a 422 stops the run on its first call', threw?.status === 422 && calls === 1, `calls=${calls}`)
}
{
  // What the Data Analytics page reads when a pass scored NOTHING because the
  // provider answered every call without a rating (here: every reply spent its
  // ceiling on thinking). scoreIdeas throws this run's lastError; the page must
  // be able to tell it from a transport failure, so it has to carry the
  // replyProblem, and the report must show no failed batch and no abort.
  const exhausted = () => Object.assign(new Error('spent its whole token ceiling on reasoning and returned no text'), { replyProblem: 'exhausted', retryable: true })
  const r = await runScoring({ texts: texts(16), call: async () => { throw exhausted() }, batchSize: 8, sleep: nosleep, isFatal: isFatalApiError })
  check('every call exhausted: nothing scored, but no failed batch and no abort',
    r.unscored === 16 && r.failedBatches === 0 && r.aborted === false, `unscored=${r.unscored} failedBatches=${r.failedBatches} aborted=${r.aborted}`)
  check('…and lastError is the provider\'s own error, replyProblem and retryable intact',
    r.lastError?.replyProblem === 'exhausted' && r.lastError?.retryable === true && r.lastError?.status === undefined)
  const refusal = () => Object.assign(new Error('declined to rate this batch'), { replyProblem: 'refusal', retryable: false })
  const rr = await runScoring({ texts: texts(16), call: async () => { throw refusal() }, batchSize: 8, sleep: nosleep, isFatal: isFatalApiError })
  check('every call refused: the same, with retryable false',
    rr.unscored === 16 && rr.failedBatches === 0 && rr.aborted === false && rr.lastError?.replyProblem === 'refusal' && rr.lastError?.retryable === false)
}

// ── A model that answers every call without a rating stops early ────────────
// Review, 2026-09-24: a model that always spent its ceiling on thinking was sent
// every idea of the run, each call retried: ~2,500 paid calls for 741 ideas. Two
// batches in a row that come back with nothing but such answers now stop the run.
console.log('answered without a rating, batch after batch')
{
  const exhausted = () => Object.assign(new Error('spent its whole token ceiling on thinking and returned no text'), { replyProblem: 'exhausted', retryable: true })
  let calls = 0
  const r = await runScoring({ texts: texts(741), call: async () => { calls++; throw exhausted() }, batchSize: 8, sleep: nosleep, isFatal: isFatalApiError })
  check('741 ideas, every call exhausted: the run stops after two such batches', r.stoppedOnReply === true && calls <= 54, `calls=${calls}`)
  check('…reported honestly: nothing scored, no failed batch, not "aborted"', r.unscored === 741 && r.failedBatches === 0 && r.aborted === false)
  // A batch whose batch call is refused but whose ideas score one by one is not
  // "nothing but refusals": it resets the count.
  let n = 0
  const r2 = await runScoring({
    texts: texts(40), batchSize: 8, sleep: nosleep, isFatal: isFatalApiError,
    call: async ts => { n++; if (ts.length > 1) throw Object.assign(new Error('declined'), { replyProblem: 'refusal', retryable: false }); return reply(1) },
  })
  check('batch calls refused but singles scoring: never stops, every idea scored', r2.stoppedOnReply === false && r2.scores.every(isScoredEntry), `calls=${n}`)
  // Reply-only, good, reply-only: not two IN A ROW.
  let b = 0
  const r3 = await runScoring({
    texts: texts(24), batchSize: 8, sleep: nosleep, isFatal: isFatalApiError,
    call: async ts => {
      const batch = Math.floor(Number(ts[0].match(/\d+/)[0]) / 8)
      b++
      if (batch !== 1) throw exhausted()
      return reply(ts.length)
    },
  })
  check('reply-only, good, reply-only batches: the run goes to the end', r3.stoppedOnReply === false && r3.scores.slice(8, 16).every(isScoredEntry) && r3.unscored === 16, `unscored=${r3.unscored}`)
}

console.log(failures
  ? `\n${failures} check(s) FAILED`
  : '\nSCORE-BATCH GUARD OK — truncated, short, duplicate-indexed and rate-limited replies all still score every idea.')
process.exit(failures ? 1 : 0)
