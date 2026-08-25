/**
 * scoreBatch.js
 *
 * The batching, parsing and retry logic behind the Data Analytics AI rater,
 * split out of `llmClient.js` so it holds no Firebase/`fetch` dependency and can
 * be tested offline against a fake model (`tools/score-batch-guard.mjs`).
 *
 * WHY THIS EXISTS (owner report 2026-08: "uploaded 435 ideas, asked for AI
 * scores, some rows were empty"). Scoring 435 ideas is ~55 sequential API calls,
 * and the original loop lost work in four different ways, all of them silent —
 * the progress bar still ran to 435/435 and no error was shown:
 *
 *  1. **One failed call threw away every score already collected.** The loop
 *     re-threw, so the caller's `setRows` never ran: 54 good batches discarded
 *     because the 55th hit a 429. Now a batch that cannot be scored is recorded
 *     and the run CONTINUES; only a fatal error (a bad API key) aborts, and
 *     partial work is always returned.
 *  2. **A truncated reply dropped a whole batch of 8.** The array parser needs a
 *     closing `]`; a reply cut off by the token limit has none, so it returned
 *     null and all 8 ideas stayed empty. `extractScoreObjects` now recovers the
 *     complete `{...}` objects out of an unterminated array.
 *  3. **A short reply left the missing ideas empty for good** — a model that
 *     returned 6 entries for 8 ideas simply lost 2. Ideas still unscored after
 *     the batch call are now retried ONE AT A TIME, so a single idea the model
 *     chokes on can no longer take its 7 neighbours down with it.
 *  4. **A repeated `"i"` clobbered a sibling.** Two objects claiming index 3
 *     wrote to the same slot and left another empty; duplicate/garbage indices
 *     now fall through to the next free slot instead.
 *
 * Everything here is pure or injected (`call`, `sleep`, `isFatal`), so the guard
 * can reproduce each of those failures deterministically with no network.
 */

/** Coerce a model's rating to the 1–5 scale, or null when it isn't a number. */
export function clamp1to5(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(1, Math.min(5, Math.round(n * 10) / 10))
}

/** A usable score = BOTH dimensions present (an idea missing one still shows an
 *  empty cell on the page, so it is worth retrying). */
export function isScoredEntry(e) {
  return !!e && e.novelty != null && e.usefulness != null
}

/** Ideas with no text at all can never be rated — don't spend calls on them. */
export function isBlankText(t) {
  return !String(t ?? '').trim()
}

/**
 * Pull rating objects out of a model reply. Tries the well-formed cases first
 * (fenced JSON, a bare array) and falls back to scanning for individual
 * `{...}` objects, which is what rescues a reply truncated mid-array — the
 * failure that used to cost a whole batch.
 */
export function extractScoreObjects(text) {
  if (!text) return []
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : String(text)

  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(body.slice(start, end + 1))
      if (Array.isArray(arr)) return arr.filter(o => o && typeof o === 'object')
    } catch { /* fall through to the object scan */ }
  }

  // Object scan: every balanced, brace-delimited chunk that parses. Handles a
  // truncated array (no closing `]`), newline-delimited objects, and prose
  // around the JSON. The trailing partial object simply fails to parse.
  const out = []
  for (const m of body.matchAll(/\{[^{}]*\}/g)) {
    try {
      const o = JSON.parse(m[0])
      if (o && typeof o === 'object') out.push(o)
    } catch { /* not an object we can use */ }
  }
  return out
}

/**
 * Map a batch's parsed objects onto `count` slots.
 *
 * The model is asked to echo each idea's index as `"i"`, so that is preferred —
 * but only when it is in range AND not already taken: a duplicate index used to
 * overwrite a sibling's score and leave another idea empty. Anything with an
 * unusable or duplicate index falls through to the next free slot in order,
 * which is the right reading of a model that just returned the ratings in the
 * order asked.
 */
export function assignScores(parsed, count) {
  const out = new Array(count).fill(null)
  const leftovers = []
  const write = (idx, item) => {
    out[idx] = { novelty: clamp1to5(item.novelty), usefulness: clamp1to5(item.usefulness) }
  }
  for (const item of parsed || []) {
    if (!item || typeof item !== 'object') continue
    const idx = Number(item.i)
    if (Number.isInteger(idx) && idx >= 0 && idx < count && out[idx] == null) write(idx, item)
    else leftovers.push(item)
  }
  let free = 0
  for (const item of leftovers) {
    while (free < count && out[free] != null) free++
    if (free >= count) break
    write(free, item)
  }
  return out
}

/**
 * An error the run should give up on rather than retry: a rejected or missing
 * API key, or a request the provider refuses outright, fails identically every
 * time. Everything else (429 rate limits, 5xx, dropped connections) is worth
 * another go — those are exactly what made a long 435-idea run lose batches.
 */
export function isFatalApiError(err) {
  const s = err?.status
  if (s === 401 || s === 403 || s === 404) return true
  if (s === 400) return true
  return false
}

/**
 * Is this error worth giving up the WHOLE run on, rather than trying again?
 *
 * The Data Analytics fill loop needs this because `scoreIdeas` THROWS when a
 * pass scored nothing at all — and that is the same shape for two opposite
 * situations: a rejected key (trying again is pointless and only makes the
 * admin sit through the pauses before being told what is actually wrong) and a
 * provider that refused every batch for a minute (trying again is the fix).
 * Only the first is fatal: a `.fatal` flag the caller set deliberately, or a
 * status that fails identically every time.
 *
 * It lives HERE rather than beside the fetch code so it can be tested offline —
 * the same reason the batching and retry logic was split out of `llmClient.js`,
 * which imports Firebase and cannot be loaded by a guard.
 */
export function isFatalScoringError(err) {
  return err?.fatal === true || isFatalApiError(err)
}

/**
 * Call `fn`, retrying transient failures with exponential backoff. `isFatal`
 * decides what is NOT worth retrying (a rejected API key fails the same way
 * every time — retrying it just makes the user wait three times as long).
 */
export async function withRetry(fn, opts = {}) {
  const attempts = opts.attempts ?? 3
  const sleep = opts.sleep || (ms => new Promise(r => setTimeout(r, ms)))
  const isFatal = opts.isFatal || (() => false)
  let last
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      if (isFatal(err) || i === attempts - 1) throw err
      if (opts.onRetry) opts.onRetry({ attempt: i + 1, error: err })
      await sleep(opts.backoffMs ? opts.backoffMs(i) : 700 * 2 ** i)
    }
  }
  throw last
}

/**
 * Score every text, in batches, losing nothing it can avoid losing.
 *
 * @param texts      idea texts, in the caller's order
 * @param call       async (texts, offsets) => raw model reply (string)
 * @param batchSize  ideas per call (default 8)
 * @param onProgress ({done, total}) => void
 * @param isFatal    (err) => true to abort the whole run (e.g. a bad key)
 * @returns { scores, unscored, blank, failedBatches, aborted, lastError } —
 *          `scores` is the same length/order as `texts`, holding
 *          {novelty,usefulness}|null. `aborted` is true when the run stopped
 *          early because the provider kept failing.
 */
export async function runScoring({
  texts, call, batchSize = 8, onProgress, sleep, isFatal, retryAttempts = 3, singleTries = 2,
  maxConsecutiveFailures = 3,
}) {
  const scores = new Array(texts.length).fill(null)
  const blankIdx = new Set()
  texts.forEach((t, i) => { if (isBlankText(t)) blankIdx.add(i) })

  let done = 0
  let failedBatches = 0
  let consecutiveFailures = 0
  let lastError = null
  const attempt = fn => withRetry(fn, { attempts: retryAttempts, sleep, isFatal })

  for (let start = 0; start < texts.length; start += batchSize) {
    const idx = []
    for (let i = start; i < Math.min(start + batchSize, texts.length); i++) {
      if (!blankIdx.has(i)) idx.push(i)
    }

    if (idx.length) {
      // Round 1 — the whole batch in one call.
      let batchThrew = false
      try {
        const raw = await attempt(() => call(idx.map(i => texts[i]), idx))
        assignScores(extractScoreObjects(raw), idx.length)
          .forEach((s, k) => { if (isScoredEntry(s)) scores[idx[k]] = s })
        consecutiveFailures = 0
      } catch (err) {
        if (isFatal && isFatal(err)) throw err
        lastError = err
        failedBatches++
        batchThrew = true
        // The provider itself is failing (already retried with backoff), so
        // stop rather than grinding through every remaining batch — and every
        // idea inside them — against something that is plainly down. Whatever
        // was scored before this point is still returned.
        if (++consecutiveFailures >= maxConsecutiveFailures) break
      }

      // A thrown batch means the transport is unhealthy, not that the model
      // mishandled these particular ideas: single calls would fail the same way
      // (and cost 8× the wait), so only an unreadable REPLY earns round 2.
      // Round 2 — anything still unscored, one idea per call, so a single idea
      // the model mishandles cannot cost its neighbours their scores. Each gets
      // `singleTries` goes, because the failure here is usually an UNREADABLE
      // REPLY rather than a thrown error — the transport retry above never sees
      // those, and one unlucky reply should not write an idea off for the run.
      for (const i of batchThrew ? [] : idx) {
        for (let t = 0; t < singleTries && !isScoredEntry(scores[i]); t++) {
          try {
            const raw = await attempt(() => call([texts[i]], [i]))
            const [s] = assignScores(extractScoreObjects(raw), 1)
            if (isScoredEntry(s)) scores[i] = s
          } catch (err) {
            if (isFatal && isFatal(err)) throw err
            lastError = err
            break   // the transport already retried; don't hammer it further
          }
        }
      }
    }

    done += Math.min(batchSize, texts.length - start)
    if (onProgress) onProgress({ done, total: texts.length })
  }

  const unscored = scores.filter((s, i) => !isScoredEntry(s) && !blankIdx.has(i)).length
  const aborted = consecutiveFailures >= maxConsecutiveFailures
  return { scores, unscored, blank: blankIdx.size, failedBatches, aborted, lastError }
}
