/**
 * objectiveKpis.js
 *
 * The Section 3.1 pipeline from TEXT to per-idea objective KPIs, as one pure
 * function so the page and the offline guard (tools/det-kpi-guard.mjs) run the
 * same code: which texts are measured, how ideas + R are vectorised, and the
 * per-idea Novelty / Distinctiveness / Score.
 *
 * An idea with no word the tokeniser reads (blank, "?", a one-letter answer, or
 * text in a script it does not read, such as Greek) has nothing to compare. It
 * used to score a perfect 1 on every KPI and top the ranking, because its TF-IDF
 * vector is all zeros and cosine 0 reads as "as different as possible". It is now
 * left unscored (null), kept out of every other idea's pool, and left out of the
 * TF-IDF corpus as well, so it cannot shift the other ideas' IDF weights either:
 * the real ideas get exactly the numbers they would get if it were not there.
 * A reference line with nothing to read is dropped the same way.
 *
 * Mirrored by compute_kpis in _idea-kpi-script/idea_kpis.py — keep in step.
 */
import { tfidfVectors, tokenize } from './tfidf.js'
import { computeDeterministicKpis } from './deterministicKpis.js'

/** True if the text has at least one term the TF-IDF tokeniser reads. */
export function isReadable(text) {
  return tokenize(text).length > 0
}

/**
 * @param ideaTexts string[]  one text per idea, in pool order
 * @param refTexts  string[]  the reference set R, one existing product per item
 * @param opts      passed to computeDeterministicKpis ({ tau, wNovelty, wDistinct })
 * @returns {
 *   error?:     string — set (and nothing else) when there is too little text,
 *   perIdea:    [{ novelty, distinctiveness, score }] (null for an unreadable idea),
 *   ideaVecs:   number[][] (all zeros for an unreadable idea; shared column space),
 *   refs:       string[] — the reference items actually used,
 *   measured, unmeasured: counts of ideas scored / left blank,
 * }
 */
export function objectiveKpisFromText(ideaTexts, refTexts, opts = {}) {
  const refs = (refTexts || []).map(s => String(s ?? '').trim()).filter(isReadable)
  if (!refs.length) {
    return { error: 'The reference set R is empty. Add the products that already exist (one per line).' }
  }
  const texts = (ideaTexts || []).map(t => String(t ?? ''))
  const readIdx = texts.map((_, i) => i).filter(i => isReadable(texts[i]))
  if (readIdx.length < 2) {
    return { error: 'At least two ideas need some text (a word of two or more letters or digits) to compute these KPIs.' }
  }
  // Ideas + R are vectorised TOGETHER so they share one vocabulary and IDF space —
  // required for the idea-vs-R cosine in Novelty to be meaningful.
  const { vectors, vocab } = tfidfVectors([...readIdx.map(i => texts[i]), ...refs])
  const blankVec = new Array(vocab.length).fill(0)
  const ideaVecs = texts.map(() => blankVec)
  readIdx.forEach((i, k) => { ideaVecs[i] = vectors[k] })
  const refVecs = vectors.slice(readIdx.length)
  const { perIdea, measured, unmeasured } = computeDeterministicKpis(ideaVecs, refVecs, opts)
  return { perIdea, ideaVecs, refs, measured, unmeasured }
}
