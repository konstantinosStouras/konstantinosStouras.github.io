// The Data Analytics page's result tables as Excel sheets, kept out of the page
// (and free of Firebase) so the offline guards can import them. Every Excel
// download on the page writes these tabs: Download ideas + KPIs, Download all
// idea data and the aggregate (owner, 2026-09-24: "I see lots of correlation
// calculations here … these data are also exported in the Excel output").
import { FACETS } from './usefulnessKpis.js'

// The two Section 3.1 result tabs.
export const POOL_KPI_SHEET = 'Pool KPIs by condition'
export const RATING_CHECK_SHEET = 'Empirical KPIs vs ratings'
// Section 4's Table 1 (summary statistics + correlations), in the same downloads;
// its rows come from summaryTableSheetRows in analyticsData.js.
export const TABLE1_SHEET = 'Table 1 summary + correlations'

const round3 = x => (x == null || !Number.isFinite(x)) ? '' : Number(x.toFixed(3))

/** The per-condition rows of a 3.1 Compute result plus one "All ideas" row
 *  carrying the pooled cross-check. */
export const withOverall = res => [
  ...(res?.perCond || []),
  ...(res?.overall ? [{ condition: 'All ideas', n: res.ideas, ...res.overall }] : []),
]

/**
 * Rows for the "Pool KPIs by condition" tab: the per-pool deterministic KPIs
 * (Unique fraction at three thresholds + Productivity) the spec reports separately
 * from the per-idea columns, then the novelty × usefulness cross-check and the
 * specificity facet shares: the three tables of the 3.1 results, one row per
 * condition plus one "All ideas" row. The medians that split "novel" from "not
 * novel" and "useful" from "not useful" are the same for every row (the WHOLE
 * pool's, so every condition is judged against one line); they sit beside the
 * shares they define.
 */
export const poolKpiRows = res => withOverall(res).map(c => {
  const q = c.q || { n: 0 }
  const share = k => (q.n ? round3(k / q.n) : '')
  const row = {
    Condition: c.condition,
    Ideas: c.n,
    'Unique fraction (τ=.80)': round3(c.uf80),
    'Unique fraction (τ=.75)': round3(c.uf75),
    'Unique fraction (τ=.85)': round3(c.uf85),
    'Productivity (KPI 2)': c.productivity,
    'Novelty x usefulness r': round3(c.r),
    'Novelty x usefulness r (same length)': round3(c.rLen),
    'Share novel and useful': share(q.both),
    'Share novel only': share(q.novelOnly),
    'Share useful only': share(q.usefulOnly),
    'Share neither': share(q.neither),
    'Novel = NoveltyScore above (median of all ideas)': round3(res?.novCut),
    'Useful = Usefulness score above (median of all ideas)': round3(res?.useCut),
  }
  for (const f of FACETS) row[`States: ${f.label}`] = round3(c.facets?.[f.key])
  row['Needs no extra technology'] = round3(c.facets?.notech)
  return row
})

/**
 * Rows for the "Empirical KPIs vs ratings" tab: the 3.1 "Check against the
 * ratings" table. Pearson's r of each empirical KPI with each rating loaded when
 * Compute was pressed (every AI model's own columns, the mean across models when
 * several, the evaluators), then, under a heading row, the number of ideas behind
 * each r (the page shows it on hover). Blank where r is not defined: fewer than
 * three ideas carry both values, or one side is constant. Null when no rating was
 * loaded, as the page then shows no table either.
 */
export const ratingCheckRows = validation => {
  if (!validation?.rows?.length || !validation.cols?.length) return null
  const table = pick => validation.rows.map(row => {
    const out = { 'Empirical KPI': row.label, Side: row.side }
    validation.cols.forEach((col, i) => { out[col] = pick(row.cells[i] || {}) })
    return out
  })
  return [
    ...table(c => round3(c.r)),
    {},
    { 'Empirical KPI': 'Ideas with both values (n behind each r above)' },
    ...table(c => (c.n == null ? '' : c.n)),
  ]
}

/**
 * Both 3.1 result tabs, as `{ name, rows }`, for whichever download is being
 * built: each one exactly when the page draws its table. So the pool tab is
 * written whenever there is a result (its "All ideas" row is always there, even
 * when no idea carries a recognised condition and there is no per-condition row),
 * and the ratings tab whenever the page shows the check against the ratings.
 */
export const detResultSheets = res => {
  if (!res) return []
  const pool = poolKpiRows(res)
  const check = ratingCheckRows(res.validation)
  return [
    ...(pool.length ? [{ name: POOL_KPI_SHEET, rows: pool }] : []),
    ...(check ? [{ name: RATING_CHECK_SHEET, rows: check }] : []),
  ]
}
