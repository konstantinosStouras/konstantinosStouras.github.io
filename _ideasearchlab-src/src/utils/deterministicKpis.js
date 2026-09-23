/**
 * deterministicKpis.js
 *
 * The objective, deterministic idea-ranking KPIs for Section 3.1, implemented
 * exactly per the two specs:
 *   • idea_ranking_kpis_llm_guide.md (Lee & Chung 2024; Meincke et al. 2025):
 *       - Novelty            = 1 − max cosine similarity to a reference set R
 *       - Distinctiveness    = 1 − mean cosine similarity to the other pool ideas
 *       - NoveltyScore       = w_novelty·novelty + w_distinct·distinctiveness  (was "Combined score")
 *       - Unique fraction    = connected groups / N (edge iff sim > tau), pool-level
 *   • llm_kpi_calculation_spec.md (Bouschery et al. 2024):
 *       - KPI 2 Productivity = count of non-redundant, multi-word ideas
 *
 * EXCLUDED for now (per request, "complicated to compute"):
 *   - KPI 1 Prototypicality (KS statistic) — needs a topic web corpus + Porter
 *     stemming + Jaccard semantic network + prototypical CDF.
 *   - KPI 3 Brainstorming creativity — defined as the share of ideas below the KS
 *     creativity cutoff, so it depends on KPI 1 and is deferred together with it.
 *
 * Everything here is PURE arithmetic over similarity values, so it is fully unit-
 * testable independently of how the vectors are produced (see deterministicKpis
 * test logic). The vectors themselves come from utils/tfidf.tfidfVectors() at
 * call time — classical TF-IDF computed in the browser, no embedding model.
 */

/** Cosine similarity of two numeric vectors; 0 if either has zero length. */
export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

/** Full N×N cosine similarity matrix for a list of vectors (diagonal = 1). */
export function simMatrix(vecs) {
  const n = vecs.length
  const m = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    m[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      const s = cosine(vecs[i], vecs[j])
      m[i][j] = s; m[j][i] = s
    }
  }
  return m
}

/**
 * Does this vector carry any term at all?
 *
 * A text with no word of two or more letters/digits ("", "?", "a", or a script
 * the tokeniser does not read, such as Greek) vectorises to ALL ZEROS, and a zero
 * vector has cosine 0 with everything. Every KPI below turns "similarity 0" into
 * "as different as possible", so such an idea used to score Novelty 1,
 * Distinctiveness 1 and Score 1 — the TOP of the ranking — for having nothing to
 * measure. It also sat in every other idea's Distinctiveness mean as a fake
 * "completely different" neighbour, and counted as a unique concept of its own
 * in the Unique fraction. An idea like that is not measured: its KPIs are left
 * blank and it is kept out of every pool.
 */
export function hasTerms(vec) {
  if (!vec) return false
  for (let k = 0; k < vec.length; k++) if (vec[k] !== 0) return true
  return false
}

/**
 * Novelty of an idea = 1 − the highest cosine similarity to any item in the
 * reference set R. Higher = further from everything that already exists.
 * Returns null if R is empty (novelty is undefined without a reference set),
 * and null for an idea with no terms (see hasTerms). A reference item with no
 * terms is ignored rather than counted as an existing product nothing resembles.
 */
export function novelty(ideaVec, refVecs) {
  if (!hasTerms(ideaVec)) return null
  const refs = (refVecs || []).filter(hasTerms)
  if (refs.length === 0) return null
  let max = -Infinity
  for (const r of refs) { const s = cosine(ideaVec, r); if (s > max) max = s }
  return 1 - max
}

/**
 * Pool distinctiveness of idea i = 1 − mean cosine similarity to the other
 * ideas in the pool. `sims` is the i-th row of a similarity matrix (sims[i] = 1
 * is skipped). `include` (optional, one boolean per pool member) restricts the
 * pool: excluded members are neither averaged over nor given a value of their
 * own. Returns null when no other member is left (the mean is undefined).
 */
export function distinctiveness(sims, i, include) {
  const n = sims.length
  if (include && !include[i]) return null
  let sum = 0, count = 0
  for (let j = 0; j < n; j++) {
    if (j === i || (include && !include[j])) continue
    sum += sims[j]; count++
  }
  return count === 0 ? null : 1 - sum / count
}

/**
 * Combined per-idea score = w_novelty·novelty + w_distinct·distinctiveness.
 * If distinctiveness is null (a pool of one) the score equals novelty (per spec).
 * If novelty is null (no reference set) it falls back to distinctiveness alone.
 */
export function combinedScore(nov, dist, wNov = 0.5, wDist = 0.5) {
  if (nov == null && dist == null) return null
  if (dist == null) return nov
  if (nov == null) return dist
  return wNov * nov + wDist * dist
}

/**
 * Unique fraction of a pool = (number of connected groups) / N, where two ideas
 * share an edge iff their cosine similarity is STRICTLY greater than tau. Groups
 * are connected components (DFS). Pool-level diversity measure. Returns null for
 * an empty pool.
 */
export function uniqueFraction(matrix, tau = 0.8) {
  const n = matrix.length
  if (n === 0) return null
  const seen = new Array(n).fill(false)
  let groups = 0
  for (let start = 0; start < n; start++) {
    if (seen[start]) continue
    groups++
    const stack = [start]
    while (stack.length) {
      const node = stack.pop()
      if (seen[node]) continue
      seen[node] = true
      for (let j = 0; j < n; j++) {
        if (!seen[j] && j !== node && matrix[node][j] > tau) stack.push(j)
      }
    }
  }
  return groups / n
}

/** Number of whitespace-separated words in a text. */
function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length
}

/**
 * KPI 2 — Brainstorming productivity: the count of non-redundant ideas in a pool
 * (Bouschery et al. 2024 §4). Cleaning rules applied here:
 *   - drop empty ideas and single-word ideas (cannot be scored),
 *   - within each group, collapse near-duplicate ideas (cosine > dedupTau) into
 *     one via connected components — so the same solution counts once.
 * `getSim(i, j)` returns the similarity between items i and j (use embeddings);
 * if omitted, near-duplicates are detected by exact normalised-text equality.
 *
 * @param items   [{ text, group }]
 * @param getSim  optional (i, j) => similarity
 * @param opts    { dedupTau = 0.9, minWords = 2 }
 * @returns { count, kept: number, dropped: number }
 */
export function productivityCount(items, getSim, opts = {}) {
  const dedupTau = opts.dedupTau ?? 0.9
  const minWords = opts.minWords ?? 2
  // Keep the original indices so getSim (defined over the full item list) stays valid.
  const usable = items
    .map((it, i) => ({ ...it, _i: i }))
    .filter(it => wordCount(it.text) >= minWords)
  const dropped = items.length - usable.length

  // Bucket usable items by group; near-duplicates only merge within a group.
  const byGroup = new Map()
  for (const it of usable) {
    const g = String(it.group ?? '')
    if (!byGroup.has(g)) byGroup.set(g, [])
    byGroup.get(g).push(it)
  }

  const norm = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const near = (a, b) =>
    typeof getSim === 'function' ? getSim(a._i, b._i) > dedupTau : norm(a.text) === norm(b.text)

  let count = 0
  for (const group of byGroup.values()) {
    // Connected components within the group: each cluster of near-duplicates = 1.
    const n = group.length
    const seen = new Array(n).fill(false)
    for (let s = 0; s < n; s++) {
      if (seen[s]) continue
      count++
      const stack = [s]
      while (stack.length) {
        const node = stack.pop()
        if (seen[node]) continue
        seen[node] = true
        for (let j = 0; j < n; j++) if (!seen[j] && j !== node && near(group[node], group[j])) stack.push(j)
      }
    }
  }
  return { count, kept: usable.length, dropped }
}

/**
 * Unique fraction over only the vectors that carry terms (see hasTerms) — an idea
 * with nothing to compare is not a unique concept. Null when none carry terms.
 */
export function measuredUniqueFraction(vecs, tau = 0.8) {
  return uniqueFraction(simMatrix(vecs.filter(hasTerms)), tau)
}

/**
 * Orchestrator: given the idea vectors and reference-set vectors (already embedded),
 * compute every per-idea deterministic KPI plus the pool unique fraction.
 *
 * Ideas with no terms (hasTerms false) get null KPIs and are left out of every
 * other idea's Distinctiveness and out of the Unique fraction.
 *
 * @param ideaVecs  number[][] — one embedding per idea (pool order)
 * @param refVecs   number[][] — one embedding per reference-set item (R)
 * @param opts      { tau = 0.8, wNovelty = 0.5, wDistinct = 0.5 }
 * @returns { perIdea: [{ novelty, distinctiveness, score }], uniqueFraction, tau,
 *            measured, unmeasured }
 */
export function computeDeterministicKpis(ideaVecs, refVecs, opts = {}) {
  const tau = opts.tau ?? 0.8
  const wNov = opts.wNovelty ?? 0.5
  const wDist = opts.wDistinct ?? 0.5
  const include = ideaVecs.map(hasTerms)
  const M = simMatrix(ideaVecs)
  const perIdea = ideaVecs.map((vec, i) => {
    if (!include[i]) return { novelty: null, distinctiveness: null, score: null }
    const nov = novelty(vec, refVecs)
    const dist = distinctiveness(M[i], i, include)
    return { novelty: nov, distinctiveness: dist, score: combinedScore(nov, dist, wNov, wDist) }
  })
  const measured = include.filter(Boolean).length
  return {
    perIdea,
    uniqueFraction: measuredUniqueFraction(ideaVecs, tau),
    tau,
    measured,
    unmeasured: ideaVecs.length - measured,
  }
}
