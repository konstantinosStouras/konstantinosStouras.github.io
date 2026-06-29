/**
 * tfidf.js
 *
 * Deterministic, in-browser TF-IDF vectoriser for the Section 3.1 objective KPIs.
 * NO API key, NO model download, NO network — pure arithmetic over the loaded
 * idea texts, so the cosine-based KPIs (Novelty / Distinctiveness / Unique
 * fraction) are fully reproducible from the Step-2 aggregate data alone.
 *
 * It mirrors scikit-learn's TfidfVectorizer defaults so the numbers are familiar
 * and defensible:
 *   - lowercase; tokens = runs of 2+ alphanumeric characters,
 *   - term frequency = raw in-document count,
 *   - smoothed IDF: idf(t) = ln((1 + N) / (1 + df(t))) + 1,
 *   - per-document L2 normalisation (so a dot product IS the cosine similarity).
 *
 * CRITICAL: every text that will be compared by cosine MUST be vectorised
 * together in ONE call, because TF-IDF vectors are only comparable when they
 * share the same vocabulary AND the same IDF weights. Novelty compares each idea
 * against the reference set R, so ideas + R are vectorised as a single corpus.
 */

// Applied after lowercasing — runs of 2+ word characters (sklearn-style tokens).
const TOKEN_RE = /[a-z0-9]{2,}/g

/** Lowercase + tokenise one text into an array of terms (2+ alphanumerics). */
export function tokenize(text) {
  return String(text || '').toLowerCase().match(TOKEN_RE) || []
}

/**
 * Vectorise a corpus of texts into dense, L2-normalised TF-IDF vectors.
 * @param texts string[]
 * @returns { vectors: number[][], vocab: string[] }
 *   vectors are in input order and share one column space:
 *   vectors[i][k] is the TF-IDF weight of vocab[k] in text i.
 */
export function tfidfVectors(texts) {
  const docs = texts.map(tokenize)
  const N = docs.length

  // Document frequency df(t) = number of docs containing term t.
  const df = new Map()
  for (const toks of docs) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1)
  }
  // Sorted vocabulary → stable, deterministic column ordering.
  const vocab = [...df.keys()].sort()
  const index = new Map(vocab.map((t, k) => [t, k]))

  // Smoothed IDF, exactly as sklearn's default (smooth_idf=True).
  const idf = vocab.map(t => Math.log((1 + N) / (1 + df.get(t))) + 1)

  const vectors = docs.map(toks => {
    const vec = new Array(vocab.length).fill(0)
    // Raw term counts → tf, then weight by idf.
    const tf = new Map()
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1)
    for (const [t, c] of tf) {
      const k = index.get(t)
      vec[k] = c * idf[k]
    }
    // L2-normalise (a zero vector — empty / all-out-of-vocab text — stays zero).
    let norm = 0
    for (const x of vec) norm += x * x
    norm = Math.sqrt(norm)
    if (norm > 0) for (let k = 0; k < vec.length; k++) vec[k] /= norm
    return vec
  })

  return { vectors, vocab }
}
