/**
 * scoreGaps.js
 *
 * "How many ideas still have NO AI Novelty / AI Usefulness, and can they be
 * filled?" — the one question the Data Analytics 3.2 step could not answer.
 *
 * WHY THIS EXISTS (owner report 2026-08-25: *"in the past I noticed that some
 * rows had no scores for those two columns … if I notice any rows with empty
 * those two columns, I would like to be able to upload my entire data set, and
 * in this step, we check how many ideas do not have AI novelty and AI
 * usefulness, and I simply press the button to fill them up"*).
 *
 * `scoreBatch.js` had already made a LONG RUN stop losing work — it salvages a
 * truncated reply, retries a mishandled idea on its own, and returns partial
 * results instead of throwing them away. Three gaps were left, and together they
 * are exactly the loop the owner is describing:
 *
 *  1. **The page never said how big the hole was.** The only number on screen
 *     was the Score button's own scope count, which follows the "Only score the
 *     Final Ideas" tick — so with the box ticked a dataset with 24 unscored
 *     ideas could read "Score 0 final ideas with AI" and look finished. Nothing
 *     ever counted the ideas that CANNOT be scored (no text at all), so a
 *     permanent hole and a retryable one were indistinguishable.
 *  2. **The run stopped early and said so only in passing.** `runScoring` trips
 *     a circuit breaker after `maxConsecutiveFailures` failed batches and
 *     `break`s — the right call against a dead provider — but `scoreIdeas`
 *     DISCARDED that `aborted` flag, so a run that gave up at batch 7 of 55
 *     reported the same way as one that merely mishandled four replies.
 *  3. **Topping a dataset up from a file meant re-importing it.** The Step-1/2
 *     import APPENDS, so an admin re-uploading their own dataset to fill the
 *     gaps got every idea twice.
 *
 * Everything here is pure — no React, no Firebase, no `fetch` — so
 * `tools/score-gaps-guard.mjs` reproduces each case offline.
 */
import { normTitle, rowTitle } from './analyticsData.js'

/** The two AI columns this step fills. Quality is derived from them, never filled. */
export const AI_SCORE_FIELDS = ['novelty', 'usefulness']

/** Is this KPI cell empty (so a run or an upload may fill it)? Scores are 1–5 or ''. */
export function isBlankScore(v) {
  return v == null || String(v).trim() === ''
}

/**
 * The text the rater is actually given for one idea.
 *
 * ONE definition, used by both `hasIdeaText` (which decides whether the panel
 * calls an idea unratable) and the page (which decides what to send). They must
 * not drift: an idea the panel counts as fillable but the run sends as an empty
 * string is scored by nobody and stays empty for ever, while the panel goes on
 * offering to fill it. `text` is what every ingest populates; the title and
 * description are the fallback for a row that carries them separately.
 */
export function scorableText(r) {
  const t = String(r?.text ?? '').trim()
  if (t) return t
  const title = String(r?.idea_title ?? r?.title ?? '').trim()
  const desc = String(r?.idea_description ?? r?.description ?? '').trim()
  if (title && desc) return `${title}: ${desc}`
  return title || desc || ''
}

/** An idea with no text at all can never be rated — no run will ever fill it. */
export function hasIdeaText(r) {
  return !!scorableText(r)
}

/** Default "is this a group-selected Final Idea?" test, mirroring DataAnalytics.jsx. */
export const isFinalRow = r => Number(r?.final_pick) === 1

/**
 * Where does one idea stand?
 *   'scored'    — both AI columns present
 *   'partial'   — exactly one present (still an empty cell on the page), with
 *                 text, so a run can fill the other one
 *   'missing'   — neither present, but it has text, so a run can fill both
 *   'unratable' — an empty cell and NO text to rate; no run will ever fill it
 *
 * The text test is applied to `partial` as well as to `missing` on purpose. An
 * idea carrying one score and no text (an imported sheet of ratings with no
 * titles) cannot have its other column filled either — counting it as fillable
 * puts a number on the panel that pressing the button can never bring down, and
 * makes the run report it as "the model's reply could not be read" when in truth
 * nothing was ever sent.
 */
export function ideaScoreState(r) {
  const nov = !isBlankScore(r?.novelty)
  const use = !isBlankScore(r?.usefulness)
  if (nov && use) return 'scored'
  if (!hasIdeaText(r)) return 'unratable'
  return (nov || use) ? 'partial' : 'missing'
}

/**
 * The coverage report the 3.2 panel prints, over whichever rows are in scope.
 *
 * `gaps` is what the admin actually asked to see: **ideas with an empty AI
 * Novelty or AI Usefulness cell**, whether they are missing one or both. It is
 * split into `fillable` (there is text to rate — pressing the button will try
 * them) and `unratable` (there is not — nothing can ever fill these, so they
 * must never be counted as "still to do", or the panel can never reach zero).
 *
 * @param rows      the dataset rows in scope
 * @param opts      { onlyFinal, isFinal } — mirror the page's scope toggle
 */
export function scoreGaps(rows, opts = {}) {
  const isFinal = opts.isFinal || isFinalRow
  const scope = (rows || []).filter(r => (opts.onlyFinal ? isFinal(r) : true))
  const out = {
    total: scope.length,
    scored: 0,
    partial: 0,
    missing: 0,
    unratable: 0,
    missingNovelty: 0,
    missingUsefulness: 0,
    ids: [],          // idea ids of the fillable gaps, in order — for the run
  }
  for (const r of scope) {
    const state = ideaScoreState(r)
    out[state === 'scored' ? 'scored' : state]++
    if (isBlankScore(r.novelty)) out.missingNovelty++
    if (isBlankScore(r.usefulness)) out.missingUsefulness++
    if (state === 'partial' || state === 'missing') out.ids.push(r.idea_id ?? r.rid)
  }
  // Every gap except an `unratable` one is worth a call.
  out.gaps = out.partial + out.missing + out.unratable
  out.fillable = out.partial + out.missing
  out.complete = out.gaps === 0
  return out
}

/** One line of English for the coverage panel — kept here so the page and the
 *  guard agree on what the numbers mean. */
export function gapSummary(g, onlyFinal = false) {
  const n = k => k.toLocaleString()
  const noun = onlyFinal ? 'final idea' : 'idea'
  if (!g.total) return 'No ideas loaded yet.'
  if (g.complete) return `All ${n(g.total)} ${noun}${g.total === 1 ? '' : 's'} have an AI Novelty and an AI Usefulness score.`
  const parts = [
    `${n(g.fillable)} of ${n(g.total)} ${noun}${g.total === 1 ? '' : 's'} still need an AI score`,
    `${n(g.missingNovelty)} missing AI Novelty`,
    `${n(g.missingUsefulness)} missing AI Usefulness`,
  ]
  if (g.unratable) parts.push(`${n(g.unratable)} cannot be scored (no idea text)`)
  return parts.join(' · ') + '.'
}

/** How many times a pass that filled NOTHING may still be retried, when the
 *  reason it filled nothing is that the provider stopped answering. */
export const MAX_RECOVERY_PASSES = 2

/**
 * Should the fill run make ANOTHER pass over whatever is still empty?
 *
 * A pass can come back short for three reasons that need three answers:
 *
 *  1. **It filled some and left some.** It is working — go again. This is the
 *     ordinary case: a few replies the model mishandled.
 *  2. **It filled nothing and the run was NOT aborted.** Every idea was sent and
 *     came back unreadable; sending them again will not read any better. Stop.
 *  3. **It filled nothing and the run WAS aborted.** `runScoring` trips its
 *     circuit breaker after three consecutive failed batches, so the ideas after
 *     that point were never sent at all — and on a long run that is the usual
 *     shape of a rate limit, which passes. Nothing in the outcome distinguishes
 *     "429, come back in a minute" from "the provider is down", so this is the
 *     one case that gets a small, bounded number of RECOVERY passes
 *     (`MAX_RECOVERY_PASSES`) with a pause between them. A genuinely dead
 *     provider costs those few attempts and is then reported as the outage it
 *     is; a rate-limited one finishes the job.
 *
 * That third case is not hypothetical, and it is why the caller must count
 * recoveries rather than reading `filled` alone: three consecutive 429s inside
 * the FIRST three batches of a 93-batch run abort it with nothing filled and 741
 * ideas never sent — which is exactly the "some rows had no scores" the run is
 * meant to end.
 *
 * `maxPasses` is the outer backstop, so this can never loop for ever.
 */
export function shouldRunAnotherPass({
  pass, maxPasses = 4, filled = 0, remaining = 0, aborted = false,
  recoveries = 0, maxRecoveries = MAX_RECOVERY_PASSES,
}) {
  if (remaining <= 0) return false          // nothing left to fill — done
  if (pass >= maxPasses) return false       // backstop
  if (filled > 0) return true               // it is making progress; keep going
  if (aborted && recoveries < maxRecoveries) return true  // never sent — worth one more go
  return false                              // a pass that reached every idea will not do better
}

/**
 * Which sheet of an uploaded workbook actually carries the per-idea AI scores?
 *
 * WHY THIS IS NOT "the one called Ideas" (owner's own files, 2026-08-25). The
 * admin's AGGREGATE export is a 13-tab workbook, and it keeps the two halves
 * apart: the **Ideas** tab holds the raw session rows — session, author, title,
 * votes, and the blind-rater columns, which are EMPTY — while the AI scores live
 * on the **Rankings** tab. Preferring the sheet literally named "Ideas", the way
 * the Step-1 importer does, therefore reads the one sheet of that workbook with
 * no scores on it at all: measured on a real 741-idea export, `Ideas` had 0 of
 * 741 AI values and `Rankings` had 741 of 741. A top-up would have reported
 * "filled 0" and looked broken.
 *
 * So the sheet is chosen by what it CONTAINS: it must identify its rows (an Idea
 * ID or a Title) and it wins on how many AI score values it actually carries.
 * Blind-rater columns ("Novelty (rater 1)") and the objective KPIs ("Novelty
 * (objective)", "Pool distinctiveness") are deliberately not counted — they are
 * different measures, and a sheet carrying only those is not a scores sheet.
 * With nothing scored anywhere the identifiable sheet named "Ideas" still wins,
 * which is the plain `ideas_with_kpis` case and the Step-1 behaviour.
 *
 * @param sheets  [{ name, rows }] — every sheet of the workbook, already parsed
 * @returns the chosen { name, rows, scored }, or null when none can be used
 */
export function pickScoredSheet(sheets) {
  let best = null
  for (const sh of sheets || []) {
    const rows = sh?.rows
    if (!Array.isArray(rows) || !rows.length) continue
    const cols = Object.keys(rows[0] || {})
    const lower = cols.map(c => String(c).toLowerCase().trim())
    const identifies = lower.some(c => ID_COLUMNS.includes(c))
    if (!identifies) continue
    const scoreCols = cols.filter(c => isAiScoreColumn(c))
    let scored = 0
    for (const c of scoreCols) {
      for (const r of rows) if (!isBlankScore(r[c])) scored++
    }
    const isIdeas = /^ideas?$/i.test(String(sh.name || ''))
    const cand = { name: sh.name, rows, scored, isIdeas }
    if (!best
      || cand.scored > best.scored
      || (cand.scored === best.scored && cand.isIdeas && !best.isIdeas)) best = cand
  }
  return best
}

const ID_COLUMNS = ['idea id', 'idea_id', 'id', 'ideaid', 'idea title', 'title']

/** An AI Novelty / AI Usefulness column — not a blind rater's, not an objective KPI. */
function isAiScoreColumn(col) {
  const c = String(col).toLowerCase()
  if (!/novelty|usefulness/.test(c)) return false
  if (/rater|\(rater/.test(c)) return false            // human evaluators (3.3)
  if (/objective|obj\.|distinctiveness/.test(c)) return false  // the 3.1 KPIs
  return true
}

/**
 * Merge the AI scores of an uploaded FULL dataset onto the loaded rows, matched
 * by **Idea ID first, then normalised title** — the "upload my entire data set
 * and top it up" path.
 *
 * Idea ID is preferred deliberately: it is exact, it survives an edited title,
 * and it is the join key every other merge on this page uses. Title is the
 * fallback for a file that carries no id (an offline rating sheet).
 *
 * Two rules it shares with every other upload path here:
 *  - **it only ADDS a score, it never overrides one that is already there**
 *    (owner 2026-08) — and it never blanks a cell because the file had nothing
 *    usable for it;
 *  - **it never APPENDS.** A file row with no matching idea is REPORTED, never
 *    added: the admin's own `ideas_with_kpis` export carries no Session Code and
 *    no author columns, so appending its rows would file real participants'
 *    ideas under a nameless "imported" session and quietly corrupt the
 *    participant panel, the per-session summaries and the regressions. Raising
 *    it leaves the decision — re-import in Step 1 to load the file AS the
 *    dataset — with the person who knows which file they uploaded.
 *
 * @param rows      the loaded dataset
 * @param incoming  rows normalised to the analysis schema (`normalizeImportedRows`)
 * @param fields    which two columns to fill (the 3.3 evaluator upload passes ext_*)
 * @returns { rows, matched, unmatched, filled, kept, gainedNovelty, gainedUsefulness }
 */
export function mergeAiScoresIntoRows(rows, incoming, fields = { novelty: 'novelty', usefulness: 'usefulness' }) {
  const byId = new Map()
  const byTitle = new Map()
  ;(rows || []).forEach((r, i) => {
    const id = joinableId(r.idea_id)
    if (id && !byId.has(id)) byId.set(id, i)
    const t = normTitle(rowTitle(r))
    if (t && !byTitle.has(t)) byTitle.set(t, i)
  })

  const next = (rows || []).slice()
  const used = new Set()
  let matched = 0, unmatched = 0, filled = 0, kept = 0
  let gainedNovelty = 0, gainedUsefulness = 0

  for (const e of incoming || []) {
    const id = joinableId(e?.idea_id)
    let idx = id ? byId.get(id) : undefined
    if (idx == null) idx = byTitle.get(normTitle(rowTitle(e || {})))
    // One file row per idea: a duplicate row in the file must not be counted as a
    // second match, and must not get a second chance to fill what the first left.
    if (idx == null || used.has(idx)) { unmatched++; continue }
    used.add(idx)
    matched++
    const cur = next[idx]
    const patch = {}
    const nov = clampScore(e?.novelty)
    const use = clampScore(e?.usefulness)
    if (nov !== '' && isBlankScore(cur[fields.novelty])) { patch[fields.novelty] = nov; gainedNovelty++ }
    if (use !== '' && isBlankScore(cur[fields.usefulness])) { patch[fields.usefulness] = use; gainedUsefulness++ }
    if (Object.keys(patch).length) { next[idx] = { ...cur, ...patch }; filled++ }
    else kept++
  }
  return { rows: next, matched, unmatched, filled, kept, gainedNovelty, gainedUsefulness }
}

/**
 * An Idea ID only if it identifies the idea. `normalizeImportedRows` invents
 * `import_<n>` for a file with no Idea ID column, and those are POSITIONS, not
 * identities: two unrelated files both start at `import_1`, so joining on one
 * would confidently write the third row of one file onto the third row of
 * another. Such an id is dropped here and the title match decides instead.
 */
function joinableId(v) {
  const id = String(v ?? '').trim()
  return /^import_\d+$/i.test(id) ? '' : id
}

/** Coerce a file's rating to the 1–5 scale, or '' when it is not a usable number. */
function clampScore(v) {
  if (v == null || String(v).trim() === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  return Math.max(1, Math.min(5, Math.round(n * 10) / 10))
}
