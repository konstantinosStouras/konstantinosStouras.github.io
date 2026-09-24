// The correlation between every pair of AI models' ratings, one table per rating
// kind (owner, 2026-09-24: "what is the correlation of AI Novelty (DeepSeek V4
// Pro) with AI Novelty (Gemini 3.1 Pro Preview)? I want to be able to see all
// correlations there. Do it for novelty and usefulness separately"). Pearson's r
// over the ideas BOTH models rated; the same idea count is given in a second
// table, since a pair rated on 20 shared ideas is not a pair rated on 700.
import { aiModelSlugs, aiNovKey, aiUseKey, aiModelName } from './aiScoreColumns.js'

const num = v => (v === '' || v == null ? NaN : Number(v))

/** Pearson's r of two equal-length number arrays; null under 2 points or when a
 *  side is constant (no correlation is defined there). */
export function pearson(xs, ys) {
  const n = Math.min(xs.length, ys.length)
  if (n < 2) return null
  let mx = 0, my = 0
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i] }
  mx /= n; my /= n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  if (sxx === 0 || syy === 0) return null
  return sxy / Math.sqrt(sxx * syy)
}

/**
 * `{ names, matrix, counts }` for one kind ('novelty' | 'usefulness'): `matrix`
 * has one row per model (its name under `Model`, then r with every model, 1 on
 * the diagonal, blank where fewer than 3 ideas were rated by both or a column is
 * constant, rounded to 3 decimals); `counts` has the same shape with the number
 * of ideas behind each pair. Models are the ones with a rating in `rows`, in the
 * catalogue's order.
 */
export function aiCorrelationRows(rows, kind) {
  const keyOf = kind === 'usefulness' ? aiUseKey : aiNovKey
  const slugs = aiModelSlugs(rows)
  const names = slugs.map(aiModelName)
  const cols = slugs.map(s => (rows || []).map(r => num(r?.[keyOf(s)])))
  const matrix = [], counts = []
  slugs.forEach((_, i) => {
    const row = { Model: names[i] }, cnt = { Model: names[i] }
    slugs.forEach((__, j) => {
      const xs = [], ys = []
      cols[i].forEach((x, k) => { const y = cols[j][k]; if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y) } })
      const r = i === j ? (xs.length ? 1 : null) : (xs.length >= 3 ? pearson(xs, ys) : null)
      row[names[j]] = r == null ? '' : Math.round(r * 1000) / 1000
      cnt[names[j]] = xs.length
    })
    matrix.push(row); counts.push(cnt)
  })
  return { names, matrix, counts }
}

/** The rows of one "AI <kind> correlations" sheet: the r table, a gap, then the
 *  idea counts under a heading row. */
export function aiCorrelationSheetRows(rows, kind) {
  const { names, matrix, counts } = aiCorrelationRows(rows, kind)
  if (names.length < 2) return null
  return [...matrix, {}, { Model: 'Ideas rated by both models' }, ...counts]
}
