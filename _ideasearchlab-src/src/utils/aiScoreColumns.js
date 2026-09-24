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
  if (slug && n && slug !== UNRECORDED && !learned.has(slug)) learned.set(slug, n)
}

/** Display name for a slug: the catalogue's short name, a learned name, or the slug itself. */
export function aiModelName(slug) {
  if (slug === UNRECORDED) return UNRECORDED_NAME
  const m = catalogue().find(x => modelSlug(x.id) === slug)
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
  if (!raw) return UNRECORDED
  const norm = modelSlug(raw)
  if (norm === modelSlug(UNRECORDED_NAME) || norm === UNRECORDED) return UNRECORDED
  const hit = catalogue().find(m =>
    modelSlug(m.id) === norm || modelSlug(shortModelName(m)) === norm || modelSlug(m.label) === norm)
  if (hit) return modelSlug(hit.id)
  rememberModelName(norm, raw)
  return norm
}

/**
 * Read an AI-score column header. Returns null when it is not one, else
 * { kind: 'novelty' | 'usefulness' | 'quality', slug, derived }:
 *   "AI Novelty (GPT-6 Astra)"          → novelty, gpt_6_astra
 *   "AI Novelty (mean across models)"   → novelty, derived (recomputed, never imported)
 *   "AI Quality (…)", "AI Quality"      → quality, derived
 *   "ai_nov__gpt_6_astra"               → novelty, gpt_6_astra (the analysis CSV)
 *   "Novelty", "AI Novelty", "novelty"  → novelty, unrecorded (a score with no model name)
 * Evaluator, rater, empirical/objective and NoveltyScore headers are NOT AI
 * scores and return null — callers check those first.
 */
export function parseAiHeader(header) {
  const h = String(header ?? '').trim()
  const lower = h.toLowerCase()
  if (!lower) return null
  if (isAiModelKey(lower)) {
    return { kind: lower.startsWith(AI_NOV_PREFIX) ? 'novelty' : 'usefulness', slug: slugOfKey(lower), derived: false }
  }
  const m = lower.match(/^ai[\s_.-]*(novelty|usefulness|useful|quality)\s*\((.*)\)\s*$/)
  if (m) {
    const kind = m[1] === 'novelty' ? 'novelty' : m[1] === 'quality' ? 'quality' : 'usefulness'
    const inner = h.slice(h.indexOf('(') + 1, h.lastIndexOf(')')).trim()
    if (kind === 'quality' || /^mean\b/i.test(inner)) {
      return { kind, slug: null, derived: true }
    }
    return { kind, slug: slugFromModelName(inner), derived: false }
  }
  if (/^(ai[\s_]*)?(overall[\s_]*)?quality$/.test(lower) || lower === 'overall_quality') {
    return { kind: 'quality', slug: null, derived: true }
  }
  if (/^(ai[\s_]*)?(novelty|nov)$/.test(lower)) return { kind: 'novelty', slug: UNRECORDED, derived: false }
  if (/^(ai[\s_]*)?(usefulness|useful)$/.test(lower)) return { kind: 'usefulness', slug: UNRECORDED, derived: false }
  return null
}

const hasValue = v => v !== '' && v != null && Number.isFinite(Number(v))

/**
 * The model slugs that carry at least one AI score in `rows`, in a stable order:
 * catalogue order (provider by provider, most capable first), then any other
 * model by name, then "model not recorded" last.
 */
export function aiModelSlugs(rows) {
  const found = new Set()
  for (const r of rows || []) {
    for (const k of Object.keys(r || {})) if (isAiModelKey(k) && hasValue(r[k])) found.add(slugOfKey(k))
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
 * columns wherever that model's cell is still empty. A cell the target already
 * holds is left alone and the unrecorded value stays where it was (reported as
 * `conflicts`) — the same "never overwrite a score" rule as every upload here.
 * Returns { rows, moved, conflicts }.
 */
export function labelUnrecordedScores(rows, targetModelId) {
  const t = aiFieldsFor(targetModelId)
  const from = { novelty: aiNovKey(UNRECORDED), usefulness: aiUseKey(UNRECORDED) }
  let moved = 0, conflicts = 0
  const next = (rows || []).map(r => {
    const out = { ...r }
    let touched = false, clash = false
    for (const kind of ['novelty', 'usefulness']) {
      const v = r[from[kind]]
      if (!hasValue(v)) continue
      if (hasValue(r[t[kind]])) { clash = true; continue }
      out[t[kind]] = Number(v)
      delete out[from[kind]]
      touched = true
    }
    if (touched) moved++
    if (clash) conflicts++
    // Drop an unrecorded field left with nothing in it, so the column disappears.
    for (const kind of ['novelty', 'usefulness']) if (from[kind] in out && !hasValue(out[from[kind]])) delete out[from[kind]]
    return out
  })
  return { rows: next, moved, conflicts }
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
    const q = slugs.length === 1 ? `AI Quality (${aiModelName(slugs[0])})`
      : slugs.length >= 2 ? 'AI Quality (mean across models)' : 'AI Quality'
    defs.push({ key: 'overall_quality', label: q, source: 'ai', scale5: true, derived: true })
  }
  return defs
}
