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
//   • AI-generated (3.2):        novelty / usefulness / overall_quality
//   • External evaluators (3.3): ext_novelty / ext_usefulness / ext_quality
//   • Deterministic/objective (3.1): det_* — appended once those KPIs are defined.
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
  // 3.1 Deterministic / objective KPIs (embedding-based, range 0–1; not a 1–5 scale,
  // so they have no "top rating" Tables 5/6). Computed in deterministicKpis.js.
  { key: 'det_novelty', label: 'Obj. Novelty', source: 'det', scale5: false },
  { key: 'det_distinctiveness', label: 'Obj. Distinctiveness', source: 'det', scale5: false },
  { key: 'det_score', label: 'Obj. Score', source: 'det', scale5: false },
]

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

/** Every analysis column for the CSV/regressions: the fixed COLUMNS + uploaded KPIs. */
export function analysisColumns(rows) {
  return [...COLUMNS, ...uploadedKpiKeys(rows)]
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
 * uploaded extra-KPI (x_*) columns dropped. Used for the persisted dataset default,
 * so a page refresh starts clean across all of Section 3 — the admin re-computes
 * (3.1) / re-scores (3.2) / re-uploads (3.3 + extra KPIs) within the session.
 */
export function stripAllKpis(rows) {
  return (rows || []).map(r => {
    const out = {}
    for (const k of Object.keys(r)) {
      if (k.startsWith(UPLOADED_KPI_PREFIX)) continue
      out[k] = ALL_KPI_COLUMNS.includes(k) ? '' : r[k]
    }
    return out
  })
}

/**
 * Apply uploaded extra-KPI values onto the loaded rows, matched by Idea ID (then,
 * if no id match, by normalised title). `entries` = [{ idea_id, title, values }]
 * where `values` maps each x_ key to a number; `keys` is the x_ columns to write.
 * Returns { rows, matched, unmatched }.
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
  let matched = 0, unmatched = 0
  for (const e of entries || []) {
    let idx = byId.get(String(e.idea_id ?? ''))
    if (idx == null) idx = byTitle.get(normTitle(e.title))
    if (idx == null) { unmatched++; continue }
    const patch = {}
    for (const k of keys) {
      const v = e.values?.[k]
      patch[k] = (v === '' || v == null || !Number.isFinite(Number(v))) ? '' : Number(v)
    }
    next[idx] = { ...next[idx], ...patch }
    matched++
  }
  return { rows: next, matched, unmatched }
}

/**
 * A KPI def has data in `rows` if at least one row carries a finite value for it.
 * Includes any admin-uploaded extra KPIs (x_* columns) after the built-in registry.
 */
export function presentKpis(rows) {
  const known = KPI_DEFS.filter(d => (rows || []).some(r => Number.isFinite(Number(r[d.key])) && r[d.key] !== ''))
  return [...known, ...uploadedKpiDefs(rows)]
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

/** Map a session's AI configuration to its condition encoding (None/Solo/Group/Both). */
export function conditionForSession(session) {
  const ai = session?.aiConfig || {}
  return conditionFromFlags(!!ai.individualAI, !!ai.groupAI)
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
  const n = numOrNull(novelty)
  const u = numOrNull(usefulness)
  if (n != null && u != null) return (n + u) / 2
  if (n != null) return n
  if (u != null) return u
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
      // AI-generated KPIs (3.2) — filled later by AI scoring / manual edit / import.
      novelty: numOrBlank(idea.novelty),
      usefulness: numOrBlank(idea.usefulness),
      overall_quality:
        idea.overall_quality != null
          ? numOrBlank(idea.overall_quality)
          : numOrBlankOrNull(overallQuality(idea.novelty, idea.usefulness)),
      // External-evaluator KPIs (3.3) — filled by the evaluator-scores upload.
      ext_novelty: '',
      ext_usefulness: '',
      ext_quality: '',
      // Deterministic/objective KPIs (3.1) — filled by the "Compute" step.
      det_novelty: '',
      det_distinctiveness: '',
      det_score: '',
      final_pick: finalPickIds.has(idea.id) ? 1 : 0,
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

/** Recompute each source's quality = mean(novelty, usefulness) for every row. */
export function recomputeOverall(rows) {
  return rows.map(r => ({
    ...r,
    overall_quality: numOrBlankOrNull(overallQuality(r.novelty, r.usefulness)),
    ext_quality: numOrBlankOrNull(overallQuality(r.ext_novelty, r.ext_usefulness)),
  }))
}

// ── CSV (de)serialisation ───────────────────────────────────────────────────

function csvEscape(value) {
  const s = value == null ? '' : String(value)
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
    const novelty = numOrBlank(pick('novelty', 'nov'))
    const usefulness = numOrBlank(pick('usefulness', 'useful'))
    let overall = pick('overall_quality', 'overall quality', 'overall', 'quality')
    if (overall === '' && (novelty !== '' || usefulness !== '')) {
      const oq = overallQuality(novelty, usefulness)
      overall = oq == null ? '' : oq
    }
    const extNovelty = meanRaterCols(lower, 'novelty')        // blind-rater averages
    const extUsefulness = meanRaterCols(lower, 'usefulness')
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

    out.push({
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
      novelty: numOrBlank(novelty),
      usefulness: numOrBlank(usefulness),
      overall_quality: numOrBlank(overall),
      ext_novelty: numOrBlank(extNovelty),
      ext_usefulness: numOrBlank(extUsefulness),
      ext_quality: numOrBlankOrNull(extOverall),
      det_novelty: numOrBlank(pick('det_novelty', 'objective novelty', 'obj. novelty')),
      det_distinctiveness: numOrBlank(pick('det_distinctiveness', 'objective distinctiveness', 'obj. distinctiveness')),
      det_score: numOrBlank(pick('det_score', 'objective score', 'obj. score')),
      final_pick: /^(1|yes|true)$/i.test(String(pick('final group pick', 'final_pick', 'final pick', 'final', 'selected')).trim()) ? 1 : 0,
      text,
    })
  })
  return out
}

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

/** A row's idea title — explicit `idea_title`, else the part of text before ": ". */
function rowTitle(r) {
  if (r.idea_title) return r.idea_title
  const t = r.text || ''
  const i = t.indexOf(': ')
  return i > 0 ? t.slice(0, i) : t
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
 * dataset row is used at most once. Returns the updated rows plus counts.
 *
 * `fields` chooses WHICH KPI columns to fill, so the same matcher serves both the
 * 3.2 AI-scores upload ({novelty:'novelty', usefulness:'usefulness'}, the default)
 * and the 3.3 external-evaluator upload ({novelty:'ext_novelty', usefulness:'ext_usefulness'}).
 */
export function matchScoresIntoRows(rows, entries, isEligible, fields = { novelty: 'novelty', usefulness: 'usefulness' }) {
  const eligible = typeof isEligible === 'function' ? isEligible : () => true
  const byTitle = new Map()
  rows.forEach((r, i) => {
    if (!eligible(r)) return // e.g. skip removed participants' ideas
    const key = normTitle(rowTitle(r))
    if (!key) return
    if (!byTitle.has(key)) byTitle.set(key, [])
    byTitle.get(key).push(i)
  })

  const next = rows.slice()
  const used = new Set()
  let matched = 0
  let unmatched = 0

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
    next[idx] = { ...next[idx], [fields.novelty]: clampScore(e.novelty), [fields.usefulness]: clampScore(e.usefulness) }
    matched++
  }
  return { rows: next, matched, unmatched }
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

/** Quick per-condition / per-KPI summary used for the on-page preview table. */
export function summarize(rows) {
  const out = {}
  for (const cond of CONDITIONS) {
    const sub = rows.filter(r => r.condition === cond)
    const stat = {}
    for (const kpi of KPIS) {
      const vals = sub.map(r => Number(r[kpi])).filter(Number.isFinite)
      const n = vals.length
      const mean = n ? vals.reduce((a, b) => a + b, 0) / n : null
      const sd = n > 1 ? Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null
      stat[kpi] = { n, mean, sd }
    }
    out[cond] = { count: sub.length, scored: sub.filter(r => r.novelty !== '' && r.usefulness !== '').length, kpis: stat }
  }
  return out
}
