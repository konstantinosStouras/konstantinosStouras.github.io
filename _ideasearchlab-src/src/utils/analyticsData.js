/**
 * analyticsData.js
 *
 * Helpers for the admin "Data Analytics" page. Turns the raw Firestore data of
 * one or more ideation sessions into a flat, analysis-ready table (one row per
 * idea) with the experimental CONDITION derived from each session's AI config,
 * plus CSV (de)serialisation used to feed the in-browser Python / R runtimes.
 *
 * Experimental design (AsPredicted #298152 — "Effects of AI Timing on Idea
 * Generation and Selection"): four between-subjects conditions vary WHEN an AI
 * assistant is available in a hybrid (solo → group) brainstorming process. A
 * session's condition is therefore fully determined by its two AI flags:
 *
 *   aiConfig.individualAI  aiConfig.groupAI     condition
 *   ─────────────────────  ────────────────     ───────────────────
 *        false                  false           Human-Only Hybrid   (reference)
 *        true                   false           Individual + AI
 *        false                  true            Group + AI
 *        true                   true            Full AI
 *
 * Each idea is scored on three KPIs — novelty (1–5), usefulness (1–5) and
 * overall_quality (= mean of the two) — either by the AI rater (llmClient.js),
 * by hand, or imported from an uploaded spreadsheet.
 */

// Canonical condition encoding — the "Set A (placement)" short names. "None"
// (no AI) is first so it is the natural regression reference level in both the
// Python and R templates. Each maps to a paper name + where AI is present.
// Per-model AI score columns ("AI Novelty (GPT-6 Astra)" …): see aiScoreColumns.js.
import {
  UNRECORDED, aiNovKey, aiUseKey, isAiModelKey, parseAiHeader,
  aiKpiDefs, aiModelSlugs, hasAiModelFields, panelMean,
} from './aiScoreColumns.js'

export const CONDITIONS = ['None', 'Solo', 'Group', 'Both']

// The encoding key shown to the admin (top-of-page table + insights) and written
// into every exported "summarized file". encoding = placement (Set A).
export const CONDITION_INFO = [
  { encoding: 'None',  paper: 'Human-Only Hybrid', ai: 'neither stage' },
  { encoding: 'Solo',  paper: 'Individual + AI',   ai: 'solo stage only' },
  { encoding: 'Group', paper: 'Group + AI',        ai: 'group stage only' },
  { encoding: 'Both',  paper: 'Full AI',           ai: 'both stages' },
]

// Look up the paper name for an encoding (e.g. 'Group' -> 'Group + AI').
export function paperNameFor(encoding) {
  return (CONDITION_INFO.find(c => c.encoding === encoding) || {}).paper || encoding
}

// Columns of the analysis table, in CSV order. Keep in sync with the Python/R
// templates (they read these exact names). KPIs come from THREE sources, each
// kept in its own columns so they can be compared side by side (Section 3.1/3.2/3.3):
//   • AI-generated (3.2):        novelty / usefulness / overall_quality — DERIVED:
//     the mean over the per-model columns ai_nov__<model> / ai_use__<model>
//     (aiScoreColumns.js), which are what a rater actually writes
//   • External evaluators (3.3): ext_novelty / ext_usefulness / ext_quality
//   • Deterministic/empirical (3.1): det_* — the novelty side (det_novelty /
//     det_distinctiveness / det_score) and the usefulness side (det_need_fit /
//     det_specificity / det_workability / det_usefulness, see usefulnessKpis.js).
export const COLUMNS = [
  'idea_id',
  'session',
  'condition',
  'phase',
  'group_id',
  'author_id',
  'novelty',
  'usefulness',
  'overall_quality',
  'ext_novelty',
  'ext_usefulness',
  'ext_quality',
  'det_novelty',
  'det_distinctiveness',
  'det_score',
  'det_need_fit',
  'det_specificity',
  'det_workability',
  'det_usefulness',
  'final_pick',
  'text',
]

// The AI-generated KPI set (kept under these names for back-compat with scoring,
// the editable table, exports and the Rankings round-trip).
export const KPIS = ['novelty', 'usefulness', 'overall_quality']
// The external-evaluator KPI set (Section 3.3 upload).
export const EXT_KPIS = ['ext_novelty', 'ext_usefulness', 'ext_quality']

/**
 * Registry of every analysable KPI, in display order, with its source, a friendly
 * label and whether it lives on the 1–5 rating scale (so a "top rating" binary is
 * meaningful — used by Tables 5/6). The Section-4 summary, the Section-6 tables and
 * the Python/R regressions all iterate whichever of these have data, so adding a
 * deterministic KPI here (3.1) makes it flow through the whole pipeline.
 */
export const KPI_DEFS = [
  { key: 'novelty', label: 'AI Novelty', source: 'ai', scale5: true },
  { key: 'usefulness', label: 'AI Usefulness', source: 'ai', scale5: true },
  { key: 'overall_quality', label: 'AI Quality', source: 'ai', scale5: true },
  { key: 'ext_novelty', label: 'Eval. Novelty', source: 'ext', scale5: true },
  { key: 'ext_usefulness', label: 'Eval. Usefulness', source: 'ext', scale5: true },
  { key: 'ext_quality', label: 'Eval. Quality', source: 'ext', scale5: true },
  // 3.1 Deterministic / EMPIRICAL KPIs (range 0–1; not a 1–5 scale, so no "top
  // rating" Tables 5/6). Called "empirical" since 2026-09-24 (owner: "Don't call
  // them objective"); every importer still reads the old "(objective)" headers.
  // "Novelty (empirical)" is qualified so it never clashes with the AI columns.
  // The mean of the two is labelled NoveltyScore (owner, 2026-09-23; it was
  // "Combined score"). Its header contains "novelty",
  // so every importer asks isNoveltyScoreHeader BEFORE any "novelty" match — or
  // a re-uploaded NoveltyScore column would land in AI Novelty. Computed in
  // deterministicKpis.js.
  { key: 'det_novelty', label: 'Novelty (empirical)', source: 'det', scale5: false },
  { key: 'det_distinctiveness', label: 'Pool distinctiveness', source: 'det', scale5: false },
  { key: 'det_score', label: 'NoveltyScore', source: 'det', scale5: false },
  // 3.1 empirical USEFULNESS KPIs (usefulnessKpis.js), each anchored on something
  // the novelty KPIs never look at, so the two sides are not tied by construction.
  // Every label ends "(empirical)" so canonicalKpiField routes a re-upload back here.
  { key: 'det_need_fit', label: 'Need fit (empirical)', source: 'det', scale5: false },
  { key: 'det_specificity', label: 'Specificity (empirical)', source: 'det', scale5: false },
  { key: 'det_workability', label: 'Workability (empirical)', source: 'det', scale5: false },
  { key: 'det_usefulness', label: 'Usefulness score (empirical)', source: 'det', scale5: false },
]

/**
 * Did this idea enter the group phase? True for every group-stage idea, and for an
 * individual-stage idea only if the participant carried it forward (carried == 1).
 * This is the Section-5 "all ideas that entered the group phase" analysis scope —
 * it uses every idea the brainstorming process kept, excluding only the individual
 * ideas a participant did NOT select in the individual phase.
 */
export function enteredGroupPhase(r) {
  const phase = String(r.phase || '').toLowerCase()
  if (phase.includes('group')) return true
  return Number(r.carried) === 1
}

// ── Admin-uploaded extra KPIs (Section 3.1) ────────────────────────────────────
// The admin can upload externally-computed KPIs (e.g. Prototypicality / KS) and
// match them onto the loaded ideas. They are stored on each row under an "x_"-
// prefixed column (e.g. x_prototypicality), so the registry is fully derivable
// from the data — no separate state to persist, and clearing them is just dropping
// the x_ columns. Treated as continuous measures (no 1–5 "top rating" Tables 5/6).
export const UPLOADED_KPI_PREFIX = 'x_'

/** Display label for an uploaded-KPI key (drop the prefix, "_" → space). */
export function uploadedKpiLabel(key) {
  return String(key).slice(UPLOADED_KPI_PREFIX.length).replace(/_/g, ' ')
}

/** The uploaded-KPI column keys present (with at least one numeric value), sorted. */
export function uploadedKpiKeys(rows) {
  const keys = new Set()
  for (const r of rows || []) {
    for (const k of Object.keys(r)) {
      if (k.startsWith(UPLOADED_KPI_PREFIX) && r[k] !== '' && r[k] != null && Number.isFinite(Number(r[k]))) keys.add(k)
    }
  }
  return [...keys].sort()
}

/** KPI def objects for the uploaded extra KPIs present in the rows. */
export function uploadedKpiDefs(rows) {
  return uploadedKpiKeys(rows).map(key => ({ key, label: uploadedKpiLabel(key), source: 'upload', scale5: false }))
}

/** Every analysis column for the CSV/regressions: the fixed COLUMNS, each AI
 *  model's own two columns (ai_nov__… / ai_use__…) and the uploaded KPIs. */
export function analysisColumns(rows) {
  const perModel = aiModelSlugs(rows).flatMap(s => [aiNovKey(s), aiUseKey(s)])
  return [...COLUMNS, ...perModel, ...uploadedKpiKeys(rows)]
}

/**
 * The KPI keys a Step-5 script actually analyses: the keys named in its registry,
 * Python's `KPI_DEFS = [ … ]` or R's `KPI_KEYS <- c( … )`, ignoring comment lines.
 * Used to warn when a SAVED script predates a KPI (it would skip it silently).
 * Returns null when the registry cannot be found (a restructured script), so the
 * caller warns about nothing rather than guessing.
 */
export function scriptKpiKeys(code, lang) {
  const src = String(code || '')
  const block = lang === 'r'
    ? (src.match(/^KPI_KEYS\s*<-\s*c\(([\s\S]*?)\)/m) || [])[1]
    : (src.match(/^KPI_DEFS\s*=\s*\[([\s\S]*?)^\]/m) || [])[1]
  if (block == null) return null
  const active = block.split('\n').map(l => l.replace(/#.*$/, '')).join('\n')
  const keys = lang === 'r'
    ? [...active.matchAll(/"([a-z0-9_]+)"/g)].map(m => m[1])
    : [...active.matchAll(/\(\s*"([a-z0-9_]+)"/g)].map(m => m[1])
  return new Set(keys)
}

/** Drop every uploaded extra-KPI column (x_*) from the rows (the "clear" action). */
export function clearUploadedKpis(rows) {
  return (rows || []).map(r => {
    const out = {}
    for (const k of Object.keys(r)) if (!k.startsWith(UPLOADED_KPI_PREFIX)) out[k] = r[k]
    return out
  })
}

/** Every built-in KPI column (AI + external + deterministic), from the registry. */
export const ALL_KPI_COLUMNS = KPI_DEFS.map(d => d.key)

/**
 * Return rows with NO pre-computed KPIs: every built-in KPI value blanked and all
 * uploaded extra-KPI (x_*) and per-model AI (ai_nov__* / ai_use__*) columns dropped. Used for the persisted dataset default,
 * so a page refresh starts clean across all of Section 3 — the admin re-computes
 * (3.1) / re-scores (3.2) / re-uploads (3.3 + extra KPIs) within the session.
 */
export function stripAllKpis(rows) {
  return (rows || []).map(r => {
    const out = {}
    for (const k of Object.keys(r)) {
      if (k.startsWith(UPLOADED_KPI_PREFIX) || isAiModelKey(k)) continue
      out[k] = ALL_KPI_COLUMNS.includes(k) ? '' : r[k]
    }
    return out
  })
}

/**
 * Apply uploaded extra-KPI values onto the loaded rows, matched by Idea ID (then,
 * if no id match, by normalised title). `entries` = [{ idea_id, title, values }]
 * where `values` maps each key to a number; `keys` is the columns to write.
 *
 * Two kinds of column, two rules (owner 2026-08 — the same "an upload adds, it
 * never overrides" rule as `matchScoresIntoRows`):
 *  - A **canonical KPI** column (novelty / usefulness / overall_quality / ext_* /
 *    det_*) is one the app itself scores, so it is only ever FILLED WHERE BLANK.
 *    A file recognised as carrying "Novelty" lands in the AI Novelty column, and
 *    without this an upload wiped every idea a past AI rater had already scored —
 *    including blanking cells the file left empty, since the write was
 *    unconditional.
 *  - An **uploaded extra** (`x_…`) column belongs to the file itself — a column
 *    of the user's own values (prototypicality, ks, …) — so re-uploading it
 *    REPLACES it, which is the point of re-uploading a corrected file.
 *
 * Returns { rows, matched, unmatched, filled, kept }, where `filled`/`kept` count
 * ideas that gained / retained a canonical KPI (an extras-only upload leaves both 0).
 */
export function matchUploadedKpisIntoRows(rows, entries, keys) {
  const byId = new Map()
  const byTitle = new Map()
  rows.forEach((r, i) => {
    const id = String(r.idea_id ?? '')
    if (id && !byId.has(id)) byId.set(id, i)
    const t = normTitle(r.idea_title || rowTitle(r))
    if (t && !byTitle.has(t)) byTitle.set(t, i)
  })
  const next = rows.slice()
  let matched = 0, unmatched = 0, filled = 0, kept = 0
  for (const e of entries || []) {
    let idx = byId.get(String(e.idea_id ?? ''))
    if (idx == null) idx = byTitle.get(normTitle(e.title))
    if (idx == null) { unmatched++; continue }
    matched++
    const cur = next[idx]
    const patch = {}
    let gained = false, held = false
    for (const k of keys) {
      const v = e.values?.[k]
      const val = (v === '' || v == null || !Number.isFinite(Number(v))) ? '' : Number(v)
      if (k.startsWith(UPLOADED_KPI_PREFIX)) { patch[k] = val; continue }  // the file's own column — replace
      if (val === '') continue                       // nothing usable: never blank what is there
      if (!isBlankScore(cur[k])) { held = true; continue }  // already scored: keep it
      patch[k] = val
      gained = true
    }
    if (gained) filled++
    else if (held) kept++
    if (Object.keys(patch).length) next[idx] = { ...cur, ...patch }
  }
  return { rows: next, matched, unmatched, filled, kept }
}

/**
 * Is this column header the 3.1 NoveltyScore (the mean of objective Novelty and
 * Distinctiveness, formerly "Combined score")? "NoveltyScore", "Novelty Score",
 * "novelty_score", "Obj. NoveltyScore" all are. It contains the word "novelty",
 * so any code that picks a Novelty column by substring must rule this out first.
 */
export function isNoveltyScoreHeader(header) {
  return /novelty[\s_-]*score/.test(String(header || '').toLowerCase())
}

/**
 * Map an uploaded column header to a canonical row KPI field, so a re-uploaded
 * KPI/ideas file (e.g. the app's own "ideas_with_kpis") lands in the right columns
 * (Novelty / Usefulness / Quality / objective / evaluator) instead of as redundant
 * x_ extras — and so its scores feed Steps 4–5. Tolerant of label drift across
 * versions ("Obj. Novelty" vs "Novelty (objective)", "AI Novelty" vs "Novelty").
 * Returns null for anything that isn't a recognised KPI (e.g. "prototypicality",
 * "ks"), which then stays an uploaded extra (x_ column).
 */
export function canonicalKpiField(header) {
  const h = String(header || '').toLowerCase().trim()
  // A column already named by its row key (the analysis CSV: det_score,
  // det_need_fit, …) is that KPI. Without this, keys like det_distinctiveness
  // matched nothing below and came back in as a duplicate x_det_… extra. The AI
  // keys (novelty / usefulness / overall_quality) are NOT taken here: they are
  // derived now, and parseAiHeader below decides where a plain AI column goes.
  const exact = KPI_DEFS.find(d => d.key === h && d.source !== 'ai')
  if (exact) return exact.key
  const has = w => h.includes(w)
  // First: the NoveltyScore header also contains "novelty".
  if (isNoveltyScoreHeader(h)) return 'det_score'
  // "(empirical)" since 2026-09-24; "(objective)" / "Obj." before it — both read.
  const isObj = /\bobj\b|\bobjective\b|\bempirical\b|\(objective\)|\(empirical\)/.test(h)
  // A blind rater's / expert's column is an evaluator's (3.3), never an AI model's.
  const isEval = /\beval\b|\bevaluator\b|external|\brater\b|\bexpert\b/.test(h)
  if (isObj) {
    // Usefulness side first: "Usefulness score (objective)" also contains "score".
    if (has('need')) return 'det_need_fit'
    if (has('specific')) return 'det_specificity'
    if (has('workab')) return 'det_workability'
    if (has('useful')) return 'det_usefulness'
    if (has('distinct')) return 'det_distinctiveness'
    if (has('score') || has('combined')) return 'det_score'
    if (has('novelty')) return 'det_novelty'
    return null
  }
  if (has('pool distinctiveness')) return 'det_distinctiveness'
  if (h === 'combined score') return 'det_score'
  if (isEval) {
    if (has('novelty')) return 'ext_novelty'
    if (has('useful')) return 'ext_usefulness'
    if (has('quality')) return 'ext_quality'
    return null
  }
  // An AI score column. A model's own column ("AI Novelty (GPT-6 Astra)", or the
  // analysis CSV's ai_nov__gpt_6_astra) goes to that model; a column with no model
  // name ("Novelty", "AI Novelty") to "model not recorded"; a DERIVED column (the
  // mean of several models, AI Quality) to the derived key, which every importer
  // then skips — it is recomputed from the per-model columns, never imported.
  const ai = parseAiHeader(h)
  if (ai) {
    if (ai.derived) return ai.kind === 'novelty' ? 'novelty' : ai.kind === 'usefulness' ? 'usefulness' : 'overall_quality'
    return ai.kind === 'novelty' ? aiNovKey(ai.slug) : aiUseKey(ai.slug)
  }
  if (has('novelty')) return aiNovKey(UNRECORDED)
  if (has('useful')) return aiUseKey(UNRECORDED)
  if (has('quality')) return 'overall_quality'
  return null
}

/** Is this a DERIVED AI column (the canonical mean fields), never to be imported? */
export function isDerivedAiKey(k) {
  return k === 'novelty' || k === 'usefulness' || k === 'overall_quality'
}

/**
 * A KPI def has data in `rows` if at least one row carries a finite value for it.
 * Includes any admin-uploaded extra KPIs (x_* columns) after the built-in registry.
 */
export function presentKpis(rows) {
  return exportKpiColumns(rows)
}

/**
 * The KPI columns to show or export, in order (owner, 2026-09-24): the EMPIRICAL
 * proxies first (the 3.1 KPIs, then the extra KPIs uploaded beside them), then the
 * AI ratings model by model (each model's Novelty and Usefulness side by side,
 * then the panel means and AI Quality), then the external evaluators.
 *   allEmpirical      — list all seven 3.1 columns even before they are computed
 *                       (the Rankings tab keeps a fixed layout)
 *   evaluatorColumns  — list the three evaluator columns even when empty (the
 *                       Rankings tab goes to blind expert raters as it is)
 * Only columns with data otherwise.
 */
export function exportKpiColumns(rows, { allEmpirical = false, evaluatorColumns = false } = {}) {
  const has = d => (rows || []).some(r => Number.isFinite(Number(r[d.key])) && r[d.key] !== '' && r[d.key] != null)
  const det = KPI_DEFS.filter(d => d.source === 'det' && (allEmpirical || has(d)))
  const ext = KPI_DEFS.filter(d => d.source === 'ext' && (evaluatorColumns || has(d)))
  return [...det, ...uploadedKpiDefs(rows), ...aiKpiDefs(rows), ...ext]
}

/**
 * Default reference set R for the study's task (colour-change-at-37°C fabric), taken
 * verbatim from the idea-ranking spec (§11.2) — a representative list of products
 * that already exist in this market. Novelty = 1 − max similarity to these. The
 * admin can edit this list in Section 3.1 (it is the one human-assembled input).
 */
export const DEFAULT_REFERENCE_SET = [
  'Hypercolor-style colour-change t-shirt',
  'hidden-design reveal t-shirt that shows a pattern when warmed',
  'thermochromic hoodie',
  'colour-change athletic top',
  'thermochromic socks',
  'colour-changing swim shorts',
  'mood ring',
  'mood necklace',
  'thermochromic bracelet or beads',
  'thermochromic phone case',
  'thermochromic nail polish',
  'colour-change lipstick',
  'photochromic eyeglass lenses',
  'forehead fever thermometer strip',
  'thermochromic fever-indicator baby sticker',
  'colour-changing baby feeding spoon',
  'thermochromic baby bath thermometer or toy',
  'liquid-crystal room or aquarium strip',
  'colour-changing coffee mug',
  'thermochromic kettle band',
  'colour-change bath or floor mat',
  'thermochromic shower-head indicator',
]

/**
 * Default need set U for the study's task: the problems and jobs people have that
 * a fabric changing colour at 37°C could serve. It is the usefulness counterpart of
 * the reference set R. R lists what ALREADY EXISTS (Novelty = far from R); U lists
 * what people NEED (Need fit = close to U). The brief asks for both: "consider what
 * users currently have and what unmet needs remain". Each line names the need and
 * who has it in plain words (with common synonyms, since TF-IDF matches words, not
 * meanings). It deliberately covers comfort, fun and self-expression as well as
 * health and safety, so Need fit does not simply reward "medical" ideas. Lines are
 * PROBLEMS, not products: they avoid R's product words (thermometer, sticker, bath,
 * spoon, toy, mood ring…), or Need fit would partly copy "close to R" and pull
 * against Novelty for the wrong reason. Only the core need words (fever, baby)
 * are shared, because that need really is served by existing products. Write U
 * before looking at the ideas (Griffin & Hauser 1993: 20-30 customer interviews
 * surface about 90% of needs). Editable in Section 3.1, like R; a different theme
 * needs its own list.
 */
export const DEFAULT_NEED_SET = [
  'spot a fever early in a baby, infant, toddler or young child without waking or disturbing them',
  'let parents and carers check a child\'s temperature quickly and easily at home or at night',
  'keep an eye on a patient\'s body temperature in hospital, a care home or at home',
  'warn an athlete, runner or player that their body is overheating during sport, training or exercise',
  'warn outdoor workers, soldiers or firefighters of heat stress or heat stroke in hot weather',
  'notice when elderly or vulnerable people are too cold or too hot (hypothermia, overheating)',
  'detect infection or inflammation around a wound, injury, joint or surgical site',
  'show poor circulation or cold spots in hands and feet, for example for diabetes or Raynaud\'s',
  'track ovulation, the menstrual cycle, pregnancy or hormonal shifts in body temperature',
  'make health checks fun and less scary for children',
  'help people with dementia, autism or disabilities show that they feel unwell',
  'check muscle warm-up, injury and recovery in sport and physiotherapy',
  'spot fever or illness in pets, horses and farm animals',
  'screen for fever in schools, workplaces, travel and crowded public places',
  'help people sleep at a comfortable temperature and avoid night sweats',
  'show whether clothing, a mask or a brace fits well and touches the body where it should',
  'let people express how they feel and their personality through what they wear',
  'make clothing and play more fun, surprising and interactive for children and adults',
  'check health without batteries, electronics, apps or charging, at low cost',
]

/**
 * Default extra-technology list T for the Workability KPI (usefulnessKpis.js): the
 * technology a passive colour-changing fabric does NOT supply. An idea naming k of
 * these gets workability 1 / (1 + k). Terms are matched as whole words (plurals
 * too), so a line should be a word or a short phrase. Deliberately absent: words
 * the fabric itself covers ("display", "shows", "smart", "heat") and ambiguous ones
 * ("phone" — R has a phone case; "screen" — also "screen for fever"; "light",
 * "sound"). Editable in Section 3.1; a theme where apps are part of the brief
 * needs its own list.
 */
export const DEFAULT_TECH_SET = [
  'app', 'bluetooth', 'wifi', 'wi-fi', 'wireless', 'internet',
  'battery', 'rechargeable', 'charging', 'charger', 'power supply', 'solar panel',
  'sensor', 'chip', 'microchip', 'microcontroller', 'circuit', 'electronic', 'electronics',
  'led', 'lcd', 'oled', 'light up', 'lights up', 'camera', 'gps', 'ai', 'artificial intelligence',
  'algorithm', 'machine learning', 'data', 'iot', 'nfc', 'rfid', 'qr code', 'motor',
  'vibration', 'vibrates', 'vibrating', 'speaker', 'beep', 'buzzer', 'alarm sound',
  'heating element', 'heater', 'cooling fan', 'implant', 'graphene', 'nanotechnology',
  'notification', 'smartwatch', 'syncs', 'connected to',
]

/** Map a session's AI configuration to its condition encoding (None/Solo/Group/Both). */
export function conditionForSession(session) {
  // Gated on the phase actually being ACTIVE, exactly like `conditionOf` in
  // sessionExport.js. Without the gate, a group-only session that still carried
  // `aiConfig.individualAI: true` was tagged "Both" here and "Group" in the
  // workbook — the same ideas in two different cells of the 2x2, from one page.
  const ai = session?.aiConfig || {}
  const pc = session?.phaseConfig || {}
  const indivOn = pc.individualPhaseActive !== false
  const groupOn = pc.groupPhaseActive !== false
  return conditionFromFlags(!!ai.individualAI && indivOn, !!ai.groupAI && groupOn)
}

/** Overall quality = mean of novelty and usefulness when both are present.
 *  IMPORTANT: a blank ("") input is MISSING, not 0 — `Number("")` is 0 in JS, which
 *  would otherwise give unscored ideas a spurious quality of 0. `numOrNull` guards
 *  that, so a blank KPI stays blank all the way through (quality shows "—", and the
 *  regressions correctly drop the row instead of treating it as a real 0). */
function numOrNull(v) {
  if (v == null || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
export function overallQuality(novelty, usefulness) {
  // The mean of the two, or nothing. Returning a lone novelty (or usefulness)
  // score as "overall quality" mixed two different definitions into one column
  // that the summary tiles, the per-condition table and the regressions all read.
  const n = numOrNull(novelty), u = numOrNull(usefulness)
  if (n != null && u != null) return (n + u) / 2
  return null
}

/**
 * Build analysis rows for ONE session.
 * @param session       the session doc ({ id, code, aiConfig, ... })
 * @param ideas         ideas[] for the session (each { id, title, description, text, phase, groupId, authorId })
 * @param participants  participants[] (used to back-fill an idea's group from its author)
 * @param groups        groups[] (each { id, finalIdeas })
 */
export function buildRowsForSession(session, ideas = [], participants = [], groups = []) {
  const condition = conditionForSession(session)
  const sessionCode = session?.code || session?.id || ''
  const authorGroup = Object.fromEntries(
    (participants || []).map(p => [p.id, p.groupId || ''])
  )
  // uid -> display name / email, for the participants manager + search (not part
  // of the analysis CSV).
  const authorName = Object.fromEntries(
    (participants || []).map(p => [p.id, p.name || p.displayName || ''])
  )
  const authorEmail = Object.fromEntries(
    (participants || []).map(p => [p.id, p.email || ''])
  )
  // ideaId -> 1 if it is one of its group's locked-in final picks.
  const finalPickIds = new Set((groups || []).flatMap(g => g.finalIdeas || []))

  return (ideas || []).map(idea => {
    const groupId = idea.groupId || authorGroup[idea.authorId] || ''
    const text = ideaText(idea)
    return {
      idea_id: idea.id || '',
      session: sessionCode,
      condition,
      phase: idea.phase || '',
      group_id: groupId,
      author_id: idea.authorId || '',
      // Display-only (kept off the COLUMNS list so they never enter the analysis CSV).
      author_name: idea.authorName || authorName[idea.authorId] || '',
      author_email: authorEmail[idea.authorId] || '',
      idea_title: idea.title || '',
      idea_description: idea.description || '',
      // AI-generated KPIs (3.2) — filled later by AI scoring / manual edit / import,
      // each model into its OWN columns (ai_nov__<model> / ai_use__<model>); these
      // three are recomputed from them. An idea doc carrying a bare score (none do
      // today) has no model name, so it is kept as "model not recorded".
      novelty: '',
      usefulness: '',
      overall_quality: '',
      ...(numOrBlank(idea.novelty) !== '' ? { [aiNovKey(UNRECORDED)]: numOrBlank(idea.novelty) } : {}),
      ...(numOrBlank(idea.usefulness) !== '' ? { [aiUseKey(UNRECORDED)]: numOrBlank(idea.usefulness) } : {}),
      // External-evaluator KPIs (3.3) — filled by the evaluator-scores upload.
      ext_novelty: '',
      ext_usefulness: '',
      ext_quality: '',
      // Deterministic/objective KPIs (3.1) — filled by the "Compute" step.
      det_novelty: '',
      det_distinctiveness: '',
      det_score: '',
      det_need_fit: '',
      det_specificity: '',
      det_workability: '',
      det_usefulness: '',
      final_pick: finalPickIds.has(idea.id) ? 1 : 0,
      // Carried to the group phase = the participant selected this individual idea
      // to carry forward (idea.selected). Group-stage ideas weren't "carried"; the
      // enteredGroupPhase() helper adds them in via phase.
      carried: idea.selected ? 1 : 0,
      text,
    }
  })
}

/** Combined display/scoring text for an idea. */
export function ideaText(idea) {
  if (idea.title && idea.description) return `${idea.title}: ${idea.description}`
  return idea.title || idea.text || idea.description || ''
}

function numOrBlank(v) {
  // Treat empty / whitespace / null as blank (Number('') is 0, which we do NOT want).
  if (v == null || String(v).trim() === '') return ''
  const n = Number(v)
  return Number.isFinite(n) ? n : ''
}
function numOrBlankOrNull(v) {
  return v == null ? '' : numOrBlank(v)
}

/** Recompute the derived columns for every row:
 *  - AI novelty / usefulness = the mean over the per-model AI columns
 *    (ai_nov__* / ai_use__*), when the row carries any — one model: its scores;
 *    several: the panel mean. A row with no per-model fields keeps what it has.
 *  - each source's quality = mean(novelty, usefulness). When BOTH components are
 *    missing (overallQuality → null) an existing quality value is kept, so an
 *    imported file that carries only a standalone quality column isn't wiped by
 *    the recompute that runs after every load/score. */
export function recomputeOverall(rows) {
  return rows.map(r => {
    let novelty = r.novelty, usefulness = r.usefulness
    if (hasAiModelFields(r)) {
      const n = panelMean(r, 'novelty'), u = panelMean(r, 'usefulness')
      novelty = n == null ? '' : n
      usefulness = u == null ? '' : u
    }
    const oq = overallQuality(novelty, usefulness)
    const eq = overallQuality(r.ext_novelty, r.ext_usefulness)
    // A row with per-model fields has its quality DERIVED from them, always: with
    // either AI component missing it is blank (a stale mean must not survive a
    // cleared cell). Only a row with no per-model fields keeps a standalone value.
    const derivedQuality = hasAiModelFields(r)
    return {
      ...r,
      novelty,
      usefulness,
      overall_quality: oq != null ? numOrBlank(Math.round(oq * 1e4) / 1e4) : derivedQuality ? '' : numOrBlank(r.overall_quality),
      ext_quality: eq != null ? numOrBlank(eq) : numOrBlank(r.ext_quality),
    }
  })
}

// ── CSV (de)serialisation ───────────────────────────────────────────────────

function csvEscape(value) {
  let s = value == null ? '' : String(value)
  // Excel and LibreOffice evaluate a cell that opens with = + - @ even inside
  // quotes, so an idea described as "- A fabric that changes colour" opened as
  // #NAME? and its text was gone from the analysed dataset.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

/** Serialise rows to a CSV string using COLUMNS order. */
export function rowsToCsv(rows, columns = COLUMNS) {
  const header = columns.join(',')
  const body = (rows || []).map(r => columns.map(c => csvEscape(r[c])).join(',')).join('\n')
  return body ? `${header}\n${body}` : header
}

/** Minimal RFC-4180-ish CSV parser → array of row objects keyed by header. */
export function csvToRows(text) {
  const records = []
  let field = ''
  let record = []
  let inQuotes = false
  const src = String(text || '').replace(/\r\n?/g, '\n')
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      record.push(field); field = ''
    } else if (ch === '\n') {
      record.push(field); records.push(record); record = []; field = ''
    } else field += ch
  }
  // trailing field/record (no final newline)
  if (field !== '' || record.length) { record.push(field); records.push(record) }
  if (!records.length) return []
  const header = records[0].map(h => h.trim())
  return records.slice(1)
    .filter(r => r.some(c => c !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

/**
 * Normalise arbitrary imported rows (from an uploaded spreadsheet) to the
 * analysis schema. Handles BOTH a simple table (columns condition / novelty /
 * usefulness / …) AND the admin's condition-coded "analysis-ready" Excel export
 * (its **Ideas** sheet): the experimental condition is read from the
 * `AI Solo (0/1)` × `AI Group (0/1)` dummies (or the `AI Condition` /
 * `Condition Code` label), and each KPI is the mean of its blind-rater columns
 * (`Novelty (rater 1..n)` / `Usefulness (rater 1..n)`). Rows flagged
 * `Exclude (Yes/No) = Yes` (the pre-registered drop screen) are removed.
 */
export function normalizeImportedRows(rawRows) {
  const out = []
  // Decided ONCE per file (review finding, 2026-09-24): a bare "Novelty" /
  // "Usefulness" column is a score with no model name, EXCEPT in the page's own
  // analysis CSV, whose bare novelty / usefulness are the derived means beside the
  // ai_nov__ / ai_use__ keys. Deciding per row dropped a hand-combined file's plain
  // column wherever a named model also scored that row.
  const fileHeads = new Set()
  for (const raw of rawRows || []) for (const k of Object.keys(raw || {})) fileHeads.add(String(k).toLowerCase().trim())
  const bareIsDerived = [...fileHeads].some(isAiModelKey)
  ;(rawRows || []).forEach((raw, i) => {
    const lower = {}
    for (const [k, v] of Object.entries(raw)) lower[String(k).toLowerCase().trim()] = v
    const pick = (...keys) => {
      for (const k of keys) {
        const v = lower[k]
        if (v != null && String(v).trim() !== '') return v
      }
      return ''
    }

    // Pre-registered exclusion screen: drop rows the rater marked to exclude.
    if (/^(1|yes|y|true|x)$/i.test(String(pick('exclude (yes/no)', 'exclude', 'excluded')).trim())) return

    // Condition: prefer the analysis-ready 0/1 dummies, then the Yes/No stage
    // flags, then the label / short code, then a generic 'condition' column.
    const solo = toFlag(pick('ai solo (0/1)', 'ai solo (0_1)', 'ai_solo'), pick('ai solo stage'))
    const group = toFlag(pick('ai group (0/1)', 'ai group (0_1)', 'ai_group'), pick('ai group stage'))
    const condition = (solo !== null && group !== null)
      ? conditionFromFlags(solo, group)
      : canonicalCondition(pick('ai condition', 'condition code', 'condition', 'cond', 'group_condition', 'treatment'))

    // KPIs split by source:
    //  • AI-generated (3.2): a PLAIN novelty/usefulness/quality column (a simple CSV
    //    or an offline AI scoring sheet).
    //  • External evaluators (3.3): the blind-rater columns "Novelty (rater n)" etc.
    //    of the admin Excel export are human evaluators → averaged into ext_*.
    // AI scores, per model (aiScoreColumns.js): "AI Novelty (GPT-6 Astra)" lands in
    // that model's own column; "AI Novelty (model not recorded)" / ai_nov__unrecorded
    // — and a bare "Novelty" / "AI Novelty", a file saved before scores were
    // labelled by model — under "model not recorded". Derived columns (the mean
    // across models, AI Quality, and the bare columns of the analysis CSV) are never
    // read: they are recomputed. Values are kept as the file has them (a 0 or a 7
    // is the file's own business; only the 3.2 merges clamp to the rating scale).
    const aiScores = {}
    const explicitUnrecorded = k => /\(model not recorded\)|^ai_(nov|use)__unrecorded$/.test(k)
    // Explicitly named columns first, so a bare column never shadows one.
    const heads = Object.keys(lower).sort((x, y) => Number(!!parseAiHeader(y) && parseAiHeader(y).slug !== UNRECORDED) - Number(!!parseAiHeader(x) && parseAiHeader(x).slug !== UNRECORDED)
      || Number(explicitUnrecorded(y)) - Number(explicitUnrecorded(x)))
    for (const k of heads) {
      const a = parseAiHeader(k)
      if (!a || a.derived) continue
      if (/rater|expert|\beval|evaluator|external|objective|empirical/.test(k) || isNoveltyScoreHeader(k)) continue
      if (a.slug === UNRECORDED && !explicitUnrecorded(k) && bareIsDerived) continue
      const key = (a.kind === 'novelty' ? aiNovKey : aiUseKey)(a.slug)
      const val = numOrBlank(lower[k])
      if (val !== '' && aiScores[key] === undefined) aiScores[key] = val
    }
    const overall = Object.keys(aiScores).length ? '' : pick('overall_quality', 'overall quality', 'overall', 'quality', 'ai quality')
    // Evaluator ratings: the blind-rater columns ("Novelty (rater 1)" …) averaged;
    // failing those, an evaluator-labelled column ("Eval. Novelty", ext_novelty) —
    // what the Rankings tab and "Download all data" write, so a download reloads
    // with its evaluator ratings (review finding, 2026-09-24).
    const extCol = field => {
      for (const [k, v] of Object.entries(lower)) {
        if (/\brater\b|\(rater|\bexpert\b/.test(k)) continue
        if (canonicalKpiField(k) === field && numOrBlank(v) !== '') return numOrBlank(v)
      }
      return ''
    }
    const extNovelty = meanRaterCols(lower, 'novelty') !== '' ? meanRaterCols(lower, 'novelty') : extCol('ext_novelty')
    const extUsefulness = meanRaterCols(lower, 'usefulness') !== '' ? meanRaterCols(lower, 'usefulness') : extCol('ext_usefulness')
    const extOverall = overallQuality(extNovelty, extUsefulness)

    // Stage / phase → canonical 'individual' | 'group'.
    let phase = String(pick('stage', 'phase')).toLowerCase()
    if (phase.includes('group')) phase = 'group'
    else if (phase.includes('individual') || phase.includes('solo')) phase = 'individual'
    else phase = phase.trim()

    // Idea text: prefer the export's combined "Full Text"; otherwise join Title +
    // Description so the deterministic KPIs (and word counts) use the WHOLE idea,
    // not just the title. Title and Description are kept separately for re-export.
    const title = String(pick('idea title', 'title'))
    const description = String(pick('description'))
    const fullText = String(pick('full text', 'text', 'idea', 'idea_text', 'content'))
    const text = fullText || (title && description ? `${title}: ${description}` : (title || description))

    const row = {
      idea_id: String(pick('idea id', 'idea_id', 'id', 'ideaid') || `import_${i + 1}`),
      session: String(pick('session code', 'session', 'session_code', 'code') || 'imported'),
      condition,
      phase,
      group_id: String(pick('group uid', 'group_id', 'group id', 'group', 'groupid')),
      author_id: String(pick('author id', 'author_id', 'author', 'participant', 'participant_id')),
      author_name: String(pick('author name', 'author label', 'author_name', 'name')),
      author_email: String(pick('author email', 'email', 'author_email')),
      idea_title: title,
      idea_description: description,
      novelty: '',
      usefulness: '',
      overall_quality: numOrBlank(overall),
      ...aiScores,
      ext_novelty: numOrBlank(extNovelty),
      ext_usefulness: numOrBlank(extUsefulness),
      ext_quality: numOrBlankOrNull(extOverall),
      // 3.1 empirical KPIs: the "(empirical)" labels since 2026-09-24, and every
      // older "(objective)" / "Obj." spelling, so files saved before still load.
      det_novelty: numOrBlank(pick('det_novelty', 'novelty (empirical)', 'novelty (objective)', 'empirical novelty', 'objective novelty', 'obj. novelty', 'obj novelty')),
      det_distinctiveness: numOrBlank(pick('det_distinctiveness', 'pool distinctiveness', 'empirical distinctiveness', 'objective distinctiveness', 'obj. distinctiveness', 'obj distinctiveness')),
      det_score: numOrBlank(pick('det_score', 'noveltyscore', 'novelty score', 'novelty_score', 'combined score', 'objective score', 'obj. score', 'obj score')),
      det_need_fit: numOrBlank(pick('det_need_fit', 'need fit (empirical)', 'need fit (objective)')),
      det_specificity: numOrBlank(pick('det_specificity', 'specificity (empirical)', 'specificity (objective)')),
      det_workability: numOrBlank(pick('det_workability', 'workability (empirical)', 'workability (objective)')),
      det_usefulness: numOrBlank(pick('det_usefulness', 'usefulness score (empirical)', 'usefulness score (objective)')),
      final_pick: /^(1|yes|true)$/i.test(String(pick('final group pick', 'final_pick', 'final pick', 'final', 'selected')).trim()) ? 1 : 0,
      carried: /^(1|yes|true)$/i.test(String(pick('carried to group', 'carried', 'carried_to_group')).trim()) ? 1 : 0,
      text,
    }

    // Carry through any OTHER continuous KPI column the file has (e.g. a re-imported
    // ideas_with_kpis / aggregate Rankings with Prototypicality, KS, …) as an uploaded
    // extra (x_*), matched onto this idea by Idea ID downstream. Built-in KPIs (AI /
    // objective / evaluator) are already mapped above via canonicalKpiField, so they
    // are skipped here; integer-count diagnostics (n_nodes, n_edges), 0/1 dummies,
    // vote counts and blind-rater columns are skipped too.
    for (const [k, v] of Object.entries(lower)) {
      if (STD_IMPORT_COLS.has(k)) continue
      if (canonicalKpiField(k) || isAiModelKey(k)) continue
      if (/\brater\b|\(rater/.test(k)) continue
      if (v === '' || v == null || typeof v === 'boolean') continue
      const n = Number(v)
      if (!Number.isFinite(n) || Number.isInteger(n)) continue
      const key = UPLOADED_KPI_PREFIX + k.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      if (key !== UPLOADED_KPI_PREFIX) row[key] = n
    }
    out.push(row)
  })
  return out
}

// Standard (non-KPI) idea columns recognised on import — skipped when sweeping for
// extra continuous KPI columns to carry through as x_*.
const STD_IMPORT_COLS = new Set([
  'idea id', 'idea_id', 'id', 'ideaid', 'session code', 'session', 'session_code', 'code',
  'condition', 'ai condition', 'condition code', 'cond', 'group_condition', 'treatment',
  'condition (paper name)', 'ai present in',
  'ai solo (0/1)', 'ai solo (0_1)', 'ai_solo', 'ai solo stage',
  'ai group (0/1)', 'ai group (0_1)', 'ai_group', 'ai group stage',
  'stage', 'phase', 'group uid', 'group_id', 'group id', 'group', 'groupid',
  'author id', 'author_id', 'author', 'participant', 'participant_id',
  'author name', 'author label', 'author_name', 'name', 'author email', 'email', 'author_email',
  'idea title', 'title', 'description', 'full text', 'text', 'idea', 'idea_text', 'content',
  'final group pick', 'final_pick', 'final pick', 'final', 'selected',
  'carried to group', 'carried', 'carried_to_group', 'final pick rank',
  'exclude (yes/no)', 'exclude', 'excluded', 'exclusion reason',
  'votes', 'vote count', 'votes cast', 'created at', 'createdat',
  'n edges', 'n_edges', 'n nodes', 'n_nodes', 'scorable', 'score_mode', 'score mode',
])

/** Truthiness from a 0/1 dummy (preferred) or a Yes/No flag; null if unknown. */
function toFlag(zeroOne, yesNo) {
  if (zeroOne != null && String(zeroOne).trim() !== '') {
    const n = Number(zeroOne)
    if (n === 1) return true
    if (n === 0) return false
  }
  const s = String(yesNo || '').trim().toLowerCase()
  if (s === 'yes' || s === 'true' || s === 'y') return true
  if (s === 'no' || s === 'false' || s === 'n') return false
  return null
}

function conditionFromFlags(solo, group) {
  if (solo && group) return 'Both'   // AI in both stages   (Full AI)
  if (solo && !group) return 'Solo'  // AI in solo stage    (Individual + AI)
  if (!solo && group) return 'Group' // AI in group stage   (Group + AI)
  return 'None'                       // no AI               (Human-Only Hybrid)
}

/**
 * Mean of every filled per-rater column for a KPI — "<kpi> (rater N)" /
 * "<kpi> rater N" / "<kpi>_rater N" / "<kpi> (expert N)". These are the blind
 * expert/evaluator columns of the admin Excel export, so they feed the external
 * KPIs (3.3). Returns '' when none are filled — so an un-rated row stays un-rated.
 */
function meanRaterCols(lowerMap, kpiPrefix) {
  const vals = []
  for (const [k, v] of Object.entries(lowerMap)) {
    const isRater = k.startsWith(`${kpiPrefix} (rater`) || k.startsWith(`${kpiPrefix} rater`) ||
                    k.startsWith(`${kpiPrefix}_rater`) || k.startsWith(`${kpiPrefix} (expert`)
    if (isRater && v != null && String(v).trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) vals.push(n)
    }
  }
  if (!vals.length) return ''
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/**
 * Best-effort match of any free-text condition label to the placement encoding
 * (None/Solo/Group/Both). Accepts the new encoding directly, the paper names
 * (Human-Only Hybrid / Individual + AI / Group + AI / Full AI), the old short
 * codes (HumanOnly/IndAI/GroupAI/FullAI) and AI-Group/AI-Individual/Baseline
 * style labels — so older exports still import correctly.
 */
export function canonicalCondition(raw) {
  const s = String(raw || '').toLowerCase().trim()
  if (!s) return ''
  // Direct placement names (the current encoding).
  if (s === 'none') return 'None'
  if (s === 'solo') return 'Solo'
  if (s === 'group') return 'Group'
  if (s === 'both') return 'Both'
  // Otherwise infer from the words present.
  const hasFull = /(full|both)/.test(s)
  const hasNone = /(human[- ]?only|no[- ]?ai|control|baseline|none)/.test(s)
  const hasInd = /(individual|solo|ind)/.test(s)
  const hasGrp = /group/.test(s)
  if (hasFull) return 'Both'
  if (hasNone) return 'None'
  if (hasInd && hasGrp) return 'Both'
  if (hasInd) return 'Solo'
  if (hasGrp) return 'Group'
  return raw
}

// ── Loading idea scores from an external ranked-ideas file ─────────────────────

/** Normalised title key for fuzzy matching (lowercase, alphanumerics only). */
export function normTitle(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** A row's idea title — explicit `idea_title`, else the part of text before ": ".
 *  Exported so `scoreGaps.js` matches an uploaded dataset onto the loaded rows by
 *  exactly the title this file already uses — one definition, so a merge and a
 *  score upload can never disagree about what an idea is called. */
export function rowTitle(r) {
  if (r.idea_title) return r.idea_title
  const t = r.text || ''
  const i = t.indexOf(': ')
  return i > 0 ? t.slice(0, i) : t
}

/** Is this KPI cell empty (so an upload may fill it)? Scores are 1–5 or ''. */
function isBlankScore(v) {
  return v == null || String(v).trim() === ''
}

function clampScore(v) {
  if (v == null || String(v).trim() === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return Math.max(1, Math.min(5, Math.round(n * 10) / 10))
}

/**
 * Apply externally-rated idea scores onto the loaded dataset by matching the
 * idea TITLE (the imported file — e.g. an "All Ideas Ranked" sheet — usually has
 * no idea id). Each `entry` is { title, novelty, usefulness }. Matching is
 * exact-on-normalised-title first, then a length-guarded contains match; each
 * dataset row is used at most once.
 *
 * **An upload only ADDS scores — it never overwrites one that is already there**
 * (owner 2026-08). A file often carries ideas scored in an earlier sitting (by a
 * past AI rater or by hand), and re-importing it used to clobber every one of
 * them, silently replacing the kept scores with the file's — and blanking a
 * score outright wherever the file's cell was empty or unparseable, since the
 * write was unconditional. So each KPI is filled ONLY where the row is still
 * blank and the incoming value is usable; a row already carrying that KPI is
 * left exactly as it is. This is the same rule the LLM scoring run applies
 * (`scoreUnscored` fills only the missing field(s)) — change a kept score by
 * editing its cell in the Step-3 table, which is the one deliberate path.
 *
 * `fields` chooses WHICH KPI columns to fill, so the same matcher serves both the
 * 3.2 AI-scores upload ({novelty:'novelty', usefulness:'usefulness'}, the default)
 * and the 3.3 external-evaluator upload ({novelty:'ext_novelty', usefulness:'ext_usefulness'}).
 *
 * Returns { rows, matched, unmatched, filled, kept }: `matched` counts file rows
 * that found an idea (as before), `filled` those that actually gained a score,
 * and `kept` the matched ideas left untouched because they were already scored.
 * `filled`/`kept` are per-idea and MUTUALLY EXCLUSIVE — an idea that gained one
 * KPI while holding the other counts as filled — so the two never double-count
 * an idea in the message the page reports.
 */
export function matchScoresIntoRows(rows, entries, isEligible, fields = { novelty: aiNovKey(UNRECORDED), usefulness: aiUseKey(UNRECORDED) }, altTitle = null) {
  const eligible = typeof isEligible === 'function' ? isEligible : () => true
  const byTitle = new Map()
  const index = (key, i) => {
    if (!key) return
    if (!byTitle.has(key)) byTitle.set(key, [])
    if (!byTitle.get(key).includes(i)) byTitle.get(key).push(i)
  }
  rows.forEach((r, i) => {
    if (!eligible(r)) return // e.g. skip removed participants' ideas
    index(normTitle(rowTitle(r)), i)
    // `altTitle(r, i)`: a second title the file may carry for the same idea — its
    // English version (Data Analytics Step 1b), since the downloads the raters fill
    // in carry the English title, while the loaded idea keeps its original.
    if (altTitle) index(normTitle(altTitle(r, i) || ''), i)
  })

  const next = rows.slice()
  const used = new Set()
  let matched = 0
  let unmatched = 0
  let filled = 0
  let kept = 0

  for (const e of entries || []) {
    const key = normTitle(e.title)
    if (!key) { unmatched++; continue }
    let candidates = byTitle.get(key)
    if (!candidates) {
      // Conservative contains-fallback: both titles reasonably long, of similar
      // length (so a short title can't match inside a much longer one), AND a
      // single candidate idea — otherwise leave it unmatched rather than guess.
      const acc = new Set()
      if (key.length >= 10) {
        for (const [k, list] of byTitle) {
          if (k.length < 10) continue
          if (!(k.includes(key) || key.includes(k))) continue
          const ratio = Math.min(k.length, key.length) / Math.max(k.length, key.length)
          if (ratio < 0.6) continue
          list.forEach(i => acc.add(i))
        }
      }
      candidates = acc.size === 1 ? [...acc] : null
    }
    const idx = candidates && candidates.find(i => !used.has(i))
    if (idx == null) { unmatched++; continue }
    used.add(idx)
    matched++
    // Fill blanks only — never overwrite a score the dataset already carries,
    // and never blank one because this file had nothing usable for it.
    const cur = next[idx]
    const patch = {}
    const nov = clampScore(e.novelty)
    const use = clampScore(e.usefulness)
    if (nov !== '' && isBlankScore(cur[fields.novelty])) patch[fields.novelty] = nov
    if (use !== '' && isBlankScore(cur[fields.usefulness])) patch[fields.usefulness] = use
    if (Object.keys(patch).length) { next[idx] = { ...cur, ...patch }; filled++ }
    else kept++
  }
  return { rows: next, matched, unmatched, filled, kept }
}

/**
 * Build the "Table 1" summary statistics + correlation matrix (Section 4), in the
 * style of Table 1 of Boussioux et al. (2024). The variables are EVERY KPI that has
 * data — across all three sources (AI / external / deterministic) — plus the
 * condition dummies (Any-AI / Solo / Group / Both vs None) and the idea word count.
 *
 * Coverage differs by source (e.g. AI scored but not yet evaluator-rated), so each
 * variable's mean/median/SD/min/max use its OWN non-missing rows and the
 * correlations are PAIRWISE-complete (each cell uses rows where both variables are
 * present). Returns { n, variables:[{key,label,mean,median,sd,min,max,n}], corr:[[...]] };
 * a constant series yields null SD/correlations rather than NaN.
 */
export function buildSummaryTable(rows) {
  const data = rows || []
  const wordCount = r => String(r.text || '').trim().split(/\s+/).filter(Boolean).length
  // Variables = present KPIs (any source) + condition dummies + word count. Each
  // `get` returns a number, or null when that variable is missing for the row.
  const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v))
  const defs = [
    ...presentKpis(data).map(d => ({ key: d.key, label: d.label, get: r => num(r[d.key]) })),
    { key: 'ai', label: 'AI (any)', get: r => (r.condition !== 'None' ? 1 : 0) },
    { key: 'solo', label: 'Solo', get: r => (r.condition === 'Solo' ? 1 : 0) },
    { key: 'group', label: 'Group', get: r => (r.condition === 'Group' ? 1 : 0) },
    { key: 'both', label: 'Both', get: r => (r.condition === 'Both' ? 1 : 0) },
    { key: 'word_count', label: 'Word count', get: wordCount },
  ]
  // series[d] = the per-row value or null (kept row-aligned so correlations can pair).
  const series = defs.map(d => data.map(d.get))
  const present = s => s.filter(v => v != null)        // drop missing for univariate stats

  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
  const median = a => {
    if (!a.length) return null
    const s = [...a].sort((x, y) => x - y)
    const m = Math.floor(s.length / 2)
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
  }
  const sd = a => {
    if (a.length < 2) return null
    const mu = mean(a)
    const v = a.reduce((x, y) => x + (y - mu) ** 2, 0) / (a.length - 1)
    return Math.sqrt(v)
  }
  // Pairwise-complete Pearson correlation; null if either side is constant/too thin.
  const corrOf = (sa, sb) => {
    const xs = [], ys = []
    for (let i = 0; i < sa.length; i++) if (sa[i] != null && sb[i] != null) { xs.push(sa[i]); ys.push(sb[i]) }
    if (xs.length < 2) return null
    const mx = mean(xs), my = mean(ys)
    let sab = 0, saa = 0, sbb = 0
    for (let i = 0; i < xs.length; i++) { const da = xs[i] - mx, db = ys[i] - my; sab += da * db; saa += da * da; sbb += db * db }
    if (saa === 0 || sbb === 0) return null
    return sab / Math.sqrt(saa * sbb)
  }

  const variables = defs.map((d, i) => {
    const vals = present(series[i])
    return {
      key: d.key, label: d.label, n: vals.length,
      mean: mean(vals), median: median(vals), sd: sd(vals),
      min: vals.length ? Math.min(...vals) : null,
      max: vals.length ? Math.max(...vals) : null,
    }
  })
  const corr = series.map((a, i) => series.map((b, j) => (i === j ? 1 : corrOf(a, b))))
  // N = ideas with at least one KPI value (the correlations are pairwise within this).
  const kpiKeys = presentKpis(data).map(d => d.key)
  const n = data.filter(r => kpiKeys.some(k => num(r[k]) != null)).length
  return { n, variables, corr }
}

/** Quick per-condition / per-KPI summary used for the on-page preview table.
 *  IMPORTANT: blank ('') KPI cells are MISSING, not 0 — `Number('')` is 0 in JS,
 *  which would silently drag every mean/SD toward zero and inflate n. */
export function summarize(rows) {
  const out = {}
  for (const cond of CONDITIONS) {
    const sub = rows.filter(r => r.condition === cond)
    const stat = {}
    for (const kpi of KPIS) {
      const vals = sub.map(r => numOrNull(r[kpi])).filter(v => v != null)
      const n = vals.length
      const mean = n ? vals.reduce((a, b) => a + b, 0) / n : null
      const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null
      stat[kpi] = { n, mean, sd }
    }
    out[cond] = { count: sub.length, scored: sub.filter(r => r.novelty !== '' && r.usefulness !== '').length, kpis: stat }
  }
  return out
}
