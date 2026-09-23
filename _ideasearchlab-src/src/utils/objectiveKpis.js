/**
 * objectiveKpis.js
 *
 * The Section 3.1 pipeline from TEXT to per-idea objective KPIs, as one pure
 * function so the page and the offline guard (tools/det-kpi-guard.mjs) run the
 * same code: which texts are measured, how ideas + R are vectorised, and the
 * per-idea Novelty / Distinctiveness / NoveltyScore (their mean).
 *
 * An idea needs at least TWO MEANINGFUL WORDS to be scored: two different words
 * of two or more letters/digits that are not common English words ("the", "and",
 * "it" ... — COMMON_WORDS below). This is the "cannot be scored" rule of
 * Bouschery et al. (2024), who drop single-word ideas; the Productivity count
 * already drops them. Anything less — blank, "?", a single letter, a single word
 * ("Zorblax", "Thermochromic"), only common words ("The: and it is"), or text in
 * a script the tokeniser does not read, such as Greek — has too little to compare:
 * a blank idea's TF-IDF vector is all zeros, and a lone word that appears nowhere
 * else is orthogonal to everything, so both read as "as different as possible"
 * and used to score a perfect 1 on every KPI and top the ranking. Such an idea is
 * now left unscored (null), kept out of every other idea's pool, and left out of
 * the TF-IDF corpus as well, so it cannot shift the other ideas' IDF weights
 * either: the scored ideas get exactly the numbers they would get if it were not
 * there. A reference line with no word at all is dropped (a one-word reference
 * product such as "Hypercolor" is kept: R is a list of product names).
 *
 * The common-word list is used ONLY for this rule; the TF-IDF vectors of the
 * scored ideas are unchanged (common words still count there, as before).
 *
 * Mirrored by compute_kpis in _idea-kpi-script/idea_kpis.py — keep in step.
 */
import { tfidfVectors, tokenize } from './tfidf.js'
import { computeDeterministicKpis } from './deterministicKpis.js'

/**
 * Common English words that do not count toward the two meaningful words: NLTK's
 * English stop-word list (nltk_data corpora/stopwords, "english"), keeping the
 * entries the tokeniser can produce — two or more letters and no apostrophe (it
 * splits "don't" into "don" + "t", and "don" is on the list). Mirrored as
 * COMMON_WORDS in _idea-kpi-script/idea_kpis.py; det-kpi-guard.mjs checks the two
 * are identical.
 */
export const COMMON_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'ain', 'all', 'am', 'an', 'and',
  'any', 'are', 'aren', 'as', 'at', 'be', 'because', 'been', 'before', 'being',
  'below', 'between', 'both', 'but', 'by', 'can', 'couldn', 'did', 'didn', 'do',
  'does', 'doesn', 'doing', 'don', 'down', 'during', 'each', 'few', 'for', 'from',
  'further', 'had', 'hadn', 'has', 'hasn', 'have', 'haven', 'having', 'he', 'her',
  'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'if', 'in', 'into', 'is',
  'isn', 'it', 'its', 'itself', 'just', 'll', 'ma', 'me', 'mightn', 'more', 'most',
  'mustn', 'my', 'myself', 'needn', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
  'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  're', 'same', 'shan', 'she', 'should', 'shouldn', 'so', 'some', 'such', 'than',
  'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 've',
  'very', 'was', 'wasn', 'we', 'were', 'weren', 'what', 'when', 'where', 'which',
  'while', 'who', 'whom', 'why', 'will', 'with', 'won', 'wouldn', 'you', 'your',
  'yours', 'yourself', 'yourselves'
])

/** An idea needs at least this many different meaningful words to be scored. */
export const MIN_MEANINGFUL_WORDS = 2

/** The distinct words of a text that count as meaningful (not COMMON_WORDS). */
export function meaningfulWords(text) {
  return [...new Set(tokenize(text).filter(t => !COMMON_WORDS.has(t)))]
}

/** True if the idea has enough meaningful words to be scored (see above). */
export function isMeasurable(text) {
  return meaningfulWords(text).length >= MIN_MEANINGFUL_WORDS
}

/** True if the text has at least one term the TF-IDF tokeniser reads (used for R). */
export function isReadable(text) {
  return tokenize(text).length > 0
}

/**
 * @param ideaTexts string[]  one text per idea, in pool order
 * @param refTexts  string[]  the reference set R, one existing product per item
 * @param opts      passed to computeDeterministicKpis ({ tau, wNovelty, wDistinct })
 * @returns {
 *   error?:     string — set (and nothing else) when there is too little text,
 *   perIdea:    [{ novelty, distinctiveness, score }] (null for an idea with fewer
 *               than MIN_MEANINGFUL_WORDS meaningful words),
 *   ideaVecs:   number[][] (all zeros for such an idea; shared column space),
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
  const readIdx = texts.map((_, i) => i).filter(i => isMeasurable(texts[i]))
  if (readIdx.length < 2) {
    return { error: 'At least two ideas need two or more meaningful words each (not just "the", "and", …) to compute these KPIs.' }
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
