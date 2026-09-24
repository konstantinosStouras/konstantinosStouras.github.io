/**
 * aiScoreColumns.js
 *
 * One AI Novelty and one AI Usefulness column PER MODEL, instead of one pair
 * shared by whichever model happened to fill it (owner, 2026-09-24: "The app
 * should add column titles with respect to each AI model used, specifically it
 * should say AI Novelty (GPT-6 Astra), AI Usefulness (GPT-6 Astra), and append
 * close to it the respective columns for another AI provider's model").
 *
 * Before this, 3.2 wrote every model's ratings into the same two cells and only
 * ever filled blanks, so a dataset rated by GPT-6 Astra could not also be rated
 * by Gemini — the Gemini run found nothing empty — and a downloaded file never
 * said which model had produced its numbers.
 *
 * HOW A SCORE IS STORED. Each model gets two row fields, keyed on a slug of its
 * model id (`gpt-6-astra` → `gpt_6_astra`):
 *
 *     ai_nov__gpt_6_astra     AI Novelty (GPT-6 Astra)
 *     ai_use__gpt_6_astra     AI Usefulness (GPT-6 Astra)
 *
 * A score that arrives with NO model name — a file saved before this change, a
 * plain "Novelty" column — goes under the slug `unrecorded` ("model not
 * recorded"), and the 3.2 panel offers to label it with the model that made it.
 * Nothing is ever guessed onto a model.
 *
 * The old fields `novelty` / `usefulness` / `overall_quality` stay, DERIVED: the
 * mean over the models that rated the idea (recomputeOverall in analyticsData).
 * With one model they equal its scores; with several they are the panel mean,
 * which is what Steps 4–5 and the regression scripts analyse as "AI Novelty".
 *
 * Pure, no React, no Firebase: the guard `tools/ai-columns-guard.mjs` runs it
 * under plain Node.
 */
import { PROVIDERS } from '../data/aiModels.js'

export const AI_NOV_PREFIX = 'ai_nov__'
export const AI_USE_PREFIX = 'ai_use__'
/** Slug for a score whose model is not known (an older file, a plain "Novelty" column). */
export const UNRECORDED = 'unrecorded'
const UNRECORDED_NAME = 'model not recorded'

/** `gpt-5.6-sol` → `gpt_5_6_sol`. The same rule for a catalogue id and a free-text name. */
export function modelSlug(id) {
  return String(id ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export const aiNovKey = slug => AI_NOV_PREFIX + slug
export const aiUseKey = slug => AI_USE_PREFIX + slug

/** The two row fields a model's run writes into. */
export function aiFieldsFor(modelId) {
  const s = modelSlug(modelId) || UNRECORDED
  return { novelty: aiNovKey(s), usefulness: aiUseKey(s) }
}

/** Is this row field a per-model AI score? */
export function isAiModelKey(k) {
  return typeof k === 'string' && (k.startsWith(AI_NOV_PREFIX) || k.startsWith(AI_USE_PREFIX))
}
export const slugOfKey = k => String(k).slice(AI_NOV_PREFIX.length)   // both prefixes have the same length

function catalogue() {
  return PROVIDERS.flatMap(p => p.models.map(m => ({ ...m, provider: p.id })))
}

// The catalogue's names, looked up once: every header of every imported row is
// checked against them, and rebuilding the list per header made a 15k-row import
// take tens of seconds. `byName` maps each model's id, short name and label (as
// slugs) to its slug, the first model in catalogue order winning a shared name.
let catalogueIdx = null
function catalogueIndex() {
  if (catalogueIdx) return catalogueIdx
  const bySlug = new Map(), byName = new Map()
  for (const m of catalogue()) {
    const slug = modelSlug(m.id)
    if (!bySlug.has(slug)) bySlug.set(slug, m)
    for (const n of [m.id, shortModelName(m), m.label]) {
      const k = modelSlug(n)
      if (k && !byName.has(k)) byName.set(k, slug)
    }
  }
  catalogueIdx = { bySlug, byName }
  return catalogueIdx
}

/** A model's short display name: its `short` field, else its label up to " — "
 *  without a trailing date in brackets ("Claude Opus 5 (Jul 2026)" → "Claude
 *  Opus 5"), so a column title never nests brackets. */
export function shortModelName(m) {
  if (m?.short) return m.short
  return String(m?.label || m?.id || '').split(' — ')[0].replace(/\s*\([^()]*\)\s*$/, '').trim()
}

// Names learned at run time for models outside the catalogue (an imported
// "AI Novelty (Llama 4 Maverick)" column, a model retired from the dropdowns).
// Scores are not persisted across reloads (stripAllKpis), so a runtime map is
// enough: every row carrying the slug arrived in this page load.
const learned = new Map()
export function rememberModelName(slug, name) {
  const n = String(name ?? '').trim()
  if (!slug || !n || slug === UNRECORDED) return
  const had = learned.get(slug)
  // First spelling wins, except that a name with capitals replaces an all-lower-case
  // one: some callers only ever see a lower-cased header, and the column should
  // read "Qwen3 Max Thinking", as the file wrote it, not "qwen3 max thinking".
  if (!had || (had === had.toLowerCase() && n !== n.toLowerCase())) learned.set(slug, n)
}

/** Display name for a slug: the catalogue's short name, a learned name, or the slug itself. */
export function aiModelName(slug) {
  if (slug === UNRECORDED) return UNRECORDED_NAME
  const m = catalogueIndex().bySlug.get(slug)
  if (m) return shortModelName(m)
  return learned.get(slug) || slug.replace(/_/g, ' ')
}

/** "AI Novelty (GPT-6 Astra)" / "AI Usefulness (GPT-6 Astra)". */
export function aiColumnLabel(kind, slug) {
  return `${kind === 'usefulness' ? 'AI Usefulness' : 'AI Novelty'} (${aiModelName(slug)})`
}

/**
 * Slug for a model named in a column header: a catalogue model by its short
 * name, label or id (case- and punctuation-blind), else the name itself —
 * remembered so the column keeps its spelling on the page and in downloads.
 */
export function slugFromModelName(name) {
  const raw = String(name ?? '').trim()
  const norm = modelSlug(raw)
  if (!norm) return UNRECORDED   // "", "(-)", "(?)": no name at all, never the key "ai_nov__"
  const known = catalogueSlug(raw)
  if (known) return known
  rememberModelName(norm, raw)
  return norm
}

/** The slug of a CATALOGUE model named by its short name, label or id (or the
 *  "model not recorded" name), else null. Never learns a new name. */
function catalogueSlug(name) {
  const norm = modelSlug(name)
  if (!norm) return null
  if (norm === modelSlug(UNRECORDED_NAME) || norm === UNRECORDED) return UNRECORDED
  return catalogueIndex().byName.get(norm) || null
}

// What the text in brackets after "Novelty" says (review findings, 2026-09-24:
// "AI Novelty (1-5)" came in as a model called "1-5", with its own columns, and
// so did "(scale 1-5)", "(1 = low, 5 = high)", "(Likert 1-5)" and "(%)"). A
// bracket names a MODEL when the catalogue knows the name, or when it carries at
// least one word that is not a note word below. Otherwise it is a note:
//   derived  "(mean)", "(mean across models)", "(average of 3 models)"
//            — the page's own panel mean, recomputed and never imported
//   score    made only of numbers, punctuation and SCALE_WORDS: "(1-5)",
//            "(0-10 scale)", "(scale 1-5)", "(Likert 1-5)", "(rated 1-5)",
//            "(1 = low, 5 = high)", "(out of 5)", "(5-point)", "(avg)",
//            "(average)", "(avg of 3 runs)", "(n=3)", "(Final Ideas)" — how the
//            score was given, or which ideas it covers: still a score, with no
//            model name
//   stat     the same, with at least one STAT_WORDS word or a "%": "(sd)",
//            "(rank)", "(percentile)", "(%)", "(percent)", "(normalized)",
//            "(z-score)", or a lone "(n)", "(min)", "(max)" — a statistic ABOUT
//            scores, or a score on another scale: not a 1–5 score, so it stays
//            an uploaded extra instead of joining the panel mean
//   other    rater / expert / evaluator / judge / external / empirical /
//            objective / human — not an AI model's column at all
const SCALE_WORDS = new Set([
  'scale', 'likert', 'point', 'points', 'pt', 'pts', 'rated', 'rating', 'ratings', 'rate', 'score', 'scores', 'scored',
  'from', 'to', 'out', 'of', 'on', 'in', 'a', 'an', 'the', 'per', 'over', 'across', 'by', 'and', 'or', 'is', 'are', 'with', 'where',
  'low', 'high', 'lowest', 'highest', 'best', 'worst', 'least', 'most', 'very', 'not', 'at', 'all', 'none', 'little', 'somewhat',
  'extremely', 'highly', 'bad', 'poor', 'good', 'excellent', 'min', 'max', 'minimum', 'maximum', 'range',
  'higher', 'lower', 'better', 'worse', 'more', 'less', 'greater', 'smaller', 'than', 'means', 'indicates',
  'avg', 'average', 'averaged', 'mean', 'median', 'final', 'idea', 'ideas', 'selected',
  'run', 'runs', 'trial', 'trials', 'sample', 'samples', 'seed', 'seeds', 'repeat', 'repeats', 'repetition', 'repetitions',
  'time', 'times', 'x', 'n', 'novel', 'novelty', 'useful', 'usefulness',
])
const STAT_WORDS = new Set([
  'sd', 'std', 'stdev', 'stddev', 'dev', 'deviation', 'standard', 'var', 'variance', 'se', 'sem', 'error',
  'rank', 'ranks', 'ranking', 'ranked', 'percentile', 'percentiles', 'pctl', 'iqr', 'z', 'zscore', 'count',
  'percent', 'percentage', 'pct', 'normalized', 'normalised', 'standardized', 'standardised', 'log', 'share', 'proportion', '%',
])
// A lone word that is a statistic although, next to numbers, it names a scale's end.
const STAT_ALONE = /^(?:n|min|max|minimum|maximum|range|s\.d\.|s\.e\.)$/
const OTHER_NOTE = /\b(?:raters?|experts?|evaluators?|eval|judges?|external|empirical|objective|human)\b/
function noteKind(inner) {
  const s = String(inner ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!s) return 'score'
  if (catalogueSlug(inner)) return 'model'
  if (s === 'mean' || (/^(?:mean|avg|average)\b/.test(s) && /\bmodels?\b/.test(s))) return 'derived'
  if (OTHER_NOTE.test(s)) return 'other'
  if (STAT_ALONE.test(s)) return 'stat'
  const words = s.match(/%|[a-z]+/g) || []
  if (words.some(w => !SCALE_WORDS.has(w) && !STAT_WORDS.has(w))) return 'model'
  return words.some(w => STAT_WORDS.has(w)) ? 'stat' : 'score'
}

const kindOf = w => (w.startsWith('nov') ? 'novelty' : w === 'quality' ? 'quality' : 'usefulness')

// A score with no "AI … (model)" shape: "Novelty", "AI Novelty", "nov", and the
// decorated spellings other tools write — "Novelty Rating", "Avg Novelty",
// "Average Usefulness", "Novelty (1-5)", "Novelty (scale 1-5)". Deliberately NOT
// "… score" (that is the 3.1 NoveltyScore, and a bare "Usefulness score" reads as
// the empirical one), nor anything else that only mentions the word ("Embedding
// novelty", "Novelty SD", "Novelty rank"), which the importers keep as an
// uploaded extra instead.
const BARE_HEAD = /^(?:ai[\s_.-]*)?(?:(?:avg\.?|average|mean)[\s_.-]*)?(novelty|nov|usefulness|useful)(?:[\s_.-]+(?:rating|ratings|avg\.?|average))?$/
function bareAiScore(h) {
  const lower = h.toLowerCase()
  // From the FIRST "(" to the last ")", like parseAiHeader: a catalogue label
  // carries brackets of its own ("Claude Opus 5 (Jul 2026)").
  const pm = lower.match(/^(.*?)\s*\((.*)\)$/)
  const m = (pm ? pm[1] : lower).trim().match(BARE_HEAD)
  if (!m) return null
  const kind = kindOf(m[1])
  if (!pm) return { kind, slug: UNRECORDED, derived: false }
  const inner = h.slice(h.indexOf('(') + 1, h.lastIndexOf(')')).trim()
  const note = noteKind(inner)
  if (note === 'derived') return { kind, slug: null, derived: true }
  if (note === 'score') return { kind, slug: UNRECORDED, derived: false }
  // "Novelty (GPT-6 Astra)" without the "AI": a model only when the catalogue
  // knows it, since a bare bracket is as likely a measure ("Novelty (TF-IDF)").
  const known = note === 'model' ? catalogueSlug(inner) : null
  return known ? { kind, slug: known, derived: false } : null
}

// A file repeats its headers on every row, and the answer depends on the header
// alone (the catalogue does not change while the page is open), so each spelling
// is read once. A caller gets its own copy.
const headerMemo = new Map()

/**
 * Read an AI-score column header. Returns null when it is not one, else
 * { kind: 'novelty' | 'usefulness' | 'quality', slug, derived }:
 *   "AI Novelty (GPT-6 Astra)"          → novelty, gpt_6_astra
 *   "Novelty (GPT-6 Astra)"             → novelty, gpt_6_astra (a catalogue model only)
 *   "AI Novelty (mean across models)"   → novelty, derived (recomputed, never imported)
 *   "AI Quality (…)", "AI Quality",
 *   "Quality", "Overall quality"        → quality, derived
 *   "ai_nov__gpt_6_astra"               → novelty, gpt_6_astra (the analysis CSV)
 *   "Novelty", "AI Novelty", "novelty",
 *   "Novelty Rating", "Avg Novelty",
 *   "Novelty (1-5)", "AI Novelty (avg)",
 *   "AI Novelty (scale 1-5)",
 *   "Novelty (1 = low, 5 = high)"       → novelty, unrecorded (a score with no model name)
 *   "AI Novelty (sd)", "AI Novelty (%)",
 *   "Novelty rank", "Novelty (TF-IDF)",
 *   "Embedding novelty"                 → null (not a 1–5 score)
 * Pass the header as the file wrote it: a model outside the catalogue keeps
 * that spelling. Evaluator, rater, empirical/objective and NoveltyScore headers
 * are NOT AI scores and return null.
 */
export function parseAiHeader(header) {
  const key = String(header ?? '')
  if (!headerMemo.has(key)) headerMemo.set(key, readAiHeader(key))
  const a = headerMemo.get(key)
  return a && { ...a }
}
function readAiHeader(header) {
  const h = String(header ?? '').trim()
  const lower = h.toLowerCase()
  if (!lower) return null
  if (isAiModelKey(lower)) {
    return { kind: lower.startsWith(AI_NOV_PREFIX) ? 'novelty' : 'usefulness', slug: slugOfKey(lower) || UNRECORDED, derived: false }
  }
  if (/novelty[\s_-]*score/.test(lower)) return null   // the 3.1 NoveltyScore
  const m = lower.match(/^ai[\s_.-]*(novelty|usefulness|useful|quality)\s*\((.*)\)\s*$/)
  if (m) {
    const kind = kindOf(m[1])
    const inner = h.slice(h.indexOf('(') + 1, h.lastIndexOf(')')).trim()
    const note = noteKind(inner)
    if (note === 'stat' || note === 'other') return null
    if (kind === 'quality' || note === 'derived') return { kind, slug: null, derived: true }
    if (note === 'score') return { kind, slug: UNRECORDED, derived: false }
    return { kind, slug: slugFromModelName(inner), derived: false }
  }
  // Not a bare "Overall": in a 3.1 KPI upload that is a measure of its own and
  // stays an extra (the Step-1 import still reads it as an older file's quality).
  if (/^(ai[\s_]*)?(overall[\s_]*)?quality$/.test(lower) || lower === 'overall_quality') {
    return { kind: 'quality', slug: null, derived: true }
  }
  return bareAiScore(h)
}

/**
 * Is this header an AI score with NO model name — "Novelty", "AI Novelty",
 * "Novelty Rating", "Avg Novelty", "Novelty (1-5)", "AI Usefulness (avg)"?
 * Returns 'novelty' | 'usefulness', else null. Never for a named model, for
 * the explicit "AI Novelty (model not recorded)" (that one is always imported),
 * for a derived "(mean …)" column, or for anything parseAiHeader refuses
 * (empirical, evaluator, rank, SD, "Embedding novelty", NoveltyScore). These are
 * the columns that are the DERIVED mean in the page's own analysis CSV, where
 * the ai_nov__ / ai_use__ keys stand beside them.
 */
export function isBareAiScoreHeader(header) {
  const a = parseAiHeader(header)
  if (!a || a.derived || a.kind === 'quality' || a.slug !== UNRECORDED) return null
  if (isExplicitUnrecordedHeader(header)) return null
  return a.kind
}

/** "AI Novelty (model not recorded)" / ai_nov__unrecorded: a score the page itself
 *  saved as having no model name. Unlike a bare column, it is never a derived mean. */
export function isExplicitUnrecordedHeader(header) {
  const lower = String(header ?? '').toLowerCase().trim()
  return /\(\s*model not recorded\s*\)$/.test(lower) || lower === aiNovKey(UNRECORDED) || lower === aiUseKey(UNRECORDED)
    || lower === AI_NOV_PREFIX || lower === AI_USE_PREFIX   // a key with no model left in it
}

const hasValue = v => v !== '' && v != null && Number.isFinite(Number(v))

/**
 * The model slugs that carry at least one AI score in `rows`, in a stable order:
 * catalogue order (provider by provider, most capable first), then any other
 * model by name, then "model not recorded" last.
 */
export function aiModelSlugs(rows, { includeBlank = false } = {}) {
  const found = new Set()
  for (const r of rows || []) {
    for (const k of Object.keys(r || {})) if (isAiModelKey(k) && (includeBlank || hasValue(r[k]))) found.add(slugOfKey(k))
  }
  return sortModelSlugs([...found])
}

export function sortModelSlugs(slugs) {
  const order = catalogue().map(m => modelSlug(m.id))
  const rank = s => (s === UNRECORDED ? 1e6 : order.includes(s) ? order.indexOf(s) : 1e5)
  return [...new Set(slugs)].sort((a, b) => rank(a) - rank(b) || aiModelName(a).localeCompare(aiModelName(b)))
}

/** Does the row carry any per-model AI field at all (even a blank one)? */
export function hasAiModelFields(r) {
  return Object.keys(r || {}).some(isAiModelKey)
}

/**
 * The panel mean of one kind ('novelty' | 'usefulness') over every model that
 * scored this idea, or null when none did. Rounded to 4 dp so a mean of three
 * models does not carry float noise into the exports.
 */
export function panelMean(r, kind) {
  const prefix = kind === 'usefulness' ? AI_USE_PREFIX : AI_NOV_PREFIX
  const vals = []
  for (const [k, v] of Object.entries(r || {})) if (k.startsWith(prefix) && hasValue(v)) vals.push(Number(v))
  if (!vals.length) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1e4) / 1e4
}

/**
 * Give the "model not recorded" scores a model: move them onto `targetModelId`'s
 * columns. An idea's pair moves WHOLE or not at all (review finding, 2026-09-24):
 * only when BOTH of the target model's cells are still empty. If the target
 * already holds either one, the idea is left exactly as it was and counted in
 * `conflicts` — moving just the free half made the model's pair mix its own
 * Novelty with another file's Usefulness, and left the other half behind as a
 * second "model" in one mean only. The same "never overwrite a score" rule as
 * every upload here. `moved` + `conflicts` = the ideas that had unrecorded scores.
 * Returns { rows, moved, conflicts }.
 */
export function labelUnrecordedScores(rows, targetModelId) {
  const t = aiFieldsFor(targetModelId)
  const from = { novelty: aiNovKey(UNRECORDED), usefulness: aiUseKey(UNRECORDED) }
  const kinds = ['novelty', 'usefulness']
  let moved = 0, conflicts = 0
  const next = (rows || []).map(r => {
    const out = { ...r }
    const own = kinds.filter(kind => hasValue(r[from[kind]]))
    if (own.length) {
      if (kinds.some(kind => hasValue(r[t[kind]]))) conflicts++
      else {
        for (const kind of own) { out[t[kind]] = Number(r[from[kind]]); delete out[from[kind]] }
        moved++
      }
    }
    // Drop an unrecorded field left with nothing in it, so the column disappears.
    for (const kind of kinds) if (from[kind] in out && !hasValue(out[from[kind]])) delete out[from[kind]]
    return out
  })
  return { rows: next, moved, conflicts }
}

/**
 * Which models rated which ideas (review finding, 2026-09-24). The derived AI
 * Novelty / Usefulness is the mean over the models that rated THAT idea, so when
 * a second model rated only some ideas (a run stopped part way, or "Only score
 * the Final Ideas"), ideas are scored by different panels and a comparison
 * across conditions partly measures which panel each idea got. This says whether
 * that is the case.
 *
 * A row's model set = the models (UNRECORDED included) with a value in its AI
 * Novelty OR AI Usefulness column. Returns
 *   { models:  every model that rated any row (sortModelSlugs order),
 *     groups:  [{ slugs, n }] one per distinct non-empty model set, most rows first,
 *     rated:   rows with at least one model,
 *     unrated: rows with none,
 *     uneven:  more than one group — the ideas were not all rated by the same models }
 */
export function aiPanelCoverage(rows) {
  const counts = new Map()
  const all = new Set()
  let rated = 0, unrated = 0
  for (const r of rows || []) {
    const set = new Set()
    for (const k of Object.keys(r || {})) if (isAiModelKey(k) && hasValue(r[k])) set.add(slugOfKey(k))
    if (!set.size) { unrated++; continue }
    rated++
    const slugs = sortModelSlugs([...set])
    slugs.forEach(s => all.add(s))
    const key = slugs.join('|')
    const g = counts.get(key)
    if (g) g.n++
    else counts.set(key, { slugs, n: 1 })
  }
  const groups = [...counts.values()].sort((a, b) =>
    b.n - a.n || b.slugs.length - a.slugs.length || a.slugs.join('|').localeCompare(b.slugs.join('|')))
  return { models: sortModelSlugs([...all]), groups, rated, unrated, uneven: groups.length > 1 }
}

/**
 * The AI columns to show / export, in order (owner, 2026-09-24): each model's
 * AI Novelty and AI Usefulness side by side, one model after the other; then,
 * when two or more models rated ideas, the panel means; then AI Quality (the
 * mean of the AI novelty and usefulness). A catalogue name carries no brackets
 * of its own (Gemini's `short`), so a title reads cleanly; parseAiHeader takes
 * the text between the FIRST "(" and the LAST ")", so one that did still reads
 * back to the same model.
 * Returns [{ key, label, source:'ai', scale5:true, slug?, kind?, derived? }].
 */
export function aiKpiDefs(rows) {
  const slugs = aiModelSlugs(rows)
  const defs = []
  for (const s of slugs) {
    defs.push({ key: aiNovKey(s), label: aiColumnLabel('novelty', s), source: 'ai', scale5: true, slug: s, kind: 'novelty' })
    defs.push({ key: aiUseKey(s), label: aiColumnLabel('usefulness', s), source: 'ai', scale5: true, slug: s, kind: 'usefulness' })
  }
  const has = k => (rows || []).some(r => hasValue(r?.[k]))
  if (slugs.length >= 2) {
    // "across models", not "of N models": a model may have rated only some ideas
    // (say, just the Final Ideas), and each idea's mean is over the models that
    // rated THAT idea.
    const tail = '(mean across models)'
    if (has('novelty')) defs.push({ key: 'novelty', label: `AI Novelty ${tail}`, source: 'ai', scale5: true, derived: true })
    if (has('usefulness')) defs.push({ key: 'usefulness', label: `AI Usefulness ${tail}`, source: 'ai', scale5: true, derived: true })
  } else if (!slugs.length) {
    // Rows that never went through the per-model fields (defensive: a caller that
    // wrote the old canonical columns directly). Shown under the plain names.
    if (has('novelty')) defs.push({ key: 'novelty', label: 'AI Novelty', source: 'ai', scale5: true, derived: true })
    if (has('usefulness')) defs.push({ key: 'usefulness', label: 'AI Usefulness', source: 'ai', scale5: true, derived: true })
  }
  if (has('overall_quality')) {
    // Named after the model(s) only when EVERY quality value was derived from
    // them. A row with no per-model fields keeps a standalone quality of its own
    // (an older file's plain "Quality" column; recomputeOverall), and a column
    // named "AI Quality (GPT-6 Astra)" would credit that value to a model that
    // never produced it (review finding, 2026-09-24). The plain "AI Quality" is
    // true of both kinds of row, and it reads back in as the standalone value.
    const standalone = (rows || []).some(r => hasValue(r?.overall_quality) && !hasAiModelFields(r))
    const q = standalone || !slugs.length ? 'AI Quality'
      : slugs.length === 1 ? `AI Quality (${aiModelName(slugs[0])})` : 'AI Quality (mean across models)'
    defs.push({ key: 'overall_quality', label: q, source: 'ai', scale5: true, derived: true })
  }
  return defs
}
