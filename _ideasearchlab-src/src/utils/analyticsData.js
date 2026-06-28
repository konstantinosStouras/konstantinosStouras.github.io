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
 * Each idea is scored on three KPIs — novelty (1–7), usefulness (1–7) and
 * overall_quality (= mean of the two) — either by the AI rater (llmClient.js),
 * by hand, or imported from an uploaded spreadsheet.
 */

// Canonical condition order. "Human-Only Hybrid" is first so it is the natural
// regression reference level in both the Python and R templates.
export const CONDITIONS = [
  'Human-Only Hybrid',
  'Individual + AI',
  'Group + AI',
  'Full AI',
]

// Columns of the analysis table, in CSV order. Keep in sync with the Python/R
// templates (they read these exact names).
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
  'final_pick',
  'text',
]

export const KPIS = ['novelty', 'usefulness', 'overall_quality']

/** Map a session's AI configuration to its experimental condition label. */
export function conditionForSession(session) {
  const ai = session?.aiConfig || {}
  const ind = !!ai.individualAI
  const grp = !!ai.groupAI
  if (ind && grp) return 'Full AI'
  if (ind && !grp) return 'Individual + AI'
  if (!ind && grp) return 'Group + AI'
  return 'Human-Only Hybrid'
}

/** Overall quality = mean of novelty and usefulness when both are present. */
export function overallQuality(novelty, usefulness) {
  const n = Number(novelty)
  const u = Number(usefulness)
  if (Number.isFinite(n) && Number.isFinite(u)) return (n + u) / 2
  if (Number.isFinite(n)) return n
  if (Number.isFinite(u)) return u
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
      // Scores filled later (AI / manual / import). Preserve any already present.
      novelty: numOrBlank(idea.novelty),
      usefulness: numOrBlank(idea.usefulness),
      overall_quality:
        idea.overall_quality != null
          ? numOrBlank(idea.overall_quality)
          : numOrBlankOrNull(overallQuality(idea.novelty, idea.usefulness)),
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

/** Recompute overall_quality for every row from its novelty/usefulness. */
export function recomputeOverall(rows) {
  return rows.map(r => ({
    ...r,
    overall_quality: numOrBlankOrNull(overallQuality(r.novelty, r.usefulness)),
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

    // KPIs: mean across any filled blind-rater columns, else a single column.
    const novelty = meanRaterCols(lower, ['novelty', 'nov'], 'novelty')
    const usefulness = meanRaterCols(lower, ['usefulness', 'useful'], 'usefulness')
    let overall = pick('overall_quality', 'overall quality', 'overall', 'quality')
    if (overall === '' && (novelty !== '' || usefulness !== '')) {
      const oq = overallQuality(novelty, usefulness)
      overall = oq == null ? '' : oq
    }

    // Stage / phase → canonical 'individual' | 'group'.
    let phase = String(pick('stage', 'phase')).toLowerCase()
    if (phase.includes('group')) phase = 'group'
    else if (phase.includes('individual') || phase.includes('solo')) phase = 'individual'
    else phase = phase.trim()

    out.push({
      idea_id: String(pick('idea id', 'idea_id', 'id', 'ideaid') || `import_${i + 1}`),
      session: String(pick('session code', 'session', 'session_code', 'code') || 'imported'),
      condition,
      phase,
      group_id: String(pick('group uid', 'group_id', 'group id', 'group', 'groupid')),
      author_id: String(pick('author id', 'author_id', 'author', 'participant', 'participant_id')),
      novelty: numOrBlank(novelty),
      usefulness: numOrBlank(usefulness),
      overall_quality: numOrBlank(overall),
      final_pick: /^(1|yes|true)$/i.test(String(pick('final group pick', 'final_pick', 'final pick', 'final', 'selected')).trim()) ? 1 : 0,
      text: String(pick('full text', 'text', 'idea', 'idea_text', 'title', 'description', 'content')),
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
  if (solo && group) return 'Full AI'
  if (solo && !group) return 'Individual + AI'
  if (!solo && group) return 'Group + AI'
  return 'Human-Only Hybrid'
}

/**
 * Mean of every filled column for a KPI: a plain column (e.g. "novelty"/"nov")
 * or any per-rater column "<kpi> (rater N)" / "<kpi> rater N" / "<kpi> (expert N)".
 * Returns '' when none are filled — so an un-scored export row stays un-scored.
 */
function meanRaterCols(lowerMap, plainKeys, kpiPrefix) {
  const vals = []
  for (const [k, v] of Object.entries(lowerMap)) {
    const isPlain = plainKeys.includes(k)
    const isRater = k.startsWith(`${kpiPrefix} (rater`) || k.startsWith(`${kpiPrefix} rater`) ||
                    k.startsWith(`${kpiPrefix}_rater`) || k.startsWith(`${kpiPrefix} (expert`)
    if ((isPlain || isRater) && v != null && String(v).trim() !== '') {
      const n = Number(v)
      if (Number.isFinite(n)) vals.push(n)
    }
  }
  if (!vals.length) return ''
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

/** Best-effort match of a free-text condition label to a canonical one. */
export function canonicalCondition(raw) {
  const s = String(raw || '').toLowerCase()
  if (!s) return ''
  const hasInd = /(individual|solo|ind)/.test(s)
  const hasGrp = /group/.test(s)
  const hasFull = /(full|both)/.test(s)
  const hasNone = /(human[- ]?only|no[- ]?ai|control|none|baseline)/.test(s)
  if (hasFull) return 'Full AI'
  if (hasNone) return 'Human-Only Hybrid'
  if (hasInd && hasGrp) return 'Full AI'
  if (hasInd) return 'Individual + AI'
  if (hasGrp) return 'Group + AI'
  // exact canonical match (case-insensitive)
  const exact = CONDITIONS.find(c => c.toLowerCase() === s)
  return exact || raw
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
