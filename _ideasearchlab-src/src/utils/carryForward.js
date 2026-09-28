// ─────────────────────────────────────────────────────────────────────────────
// carryForward — which of a participant's individual-stage ideas go into the
// group phase, and who chose each one.
//
// THE RULE (owner, 2026-09-28): a participant who wrote at least
// `ideasCarried` ideas always sends exactly `ideasCarried` of them to their
// group. Whatever they selected themselves goes first; when they selected
// fewer (k = 0, 1 or 2 of 3), the computer picks the remaining
// `ideasCarried − k` UNIFORMLY AT RANDOM from the ideas they did not select,
// and each such idea is tagged `selectedBy: 'computer'` ("Computer selected to
// group stage") so the data says which picks were the participant's and which
// were not. A participant with fewer ideas than the cap sends all of them —
// the same rule with the target capped at what exists (2 ideas, 1 chosen: the
// other one is picked for them).
//
// TWO PICKERS, and why. `pickUniform` is a genuine random draw (partial
// Fisher–Yates) and serves the paths where the top-up is PERSISTED BEFORE
// anyone can read it: Finish & Submit and the selection timer's auto-submit
// write the ideas batch first and only then mark the participant complete.
// `pickStable` orders ideas by a hash of their (random) Firestore ids, so every
// reader derives the SAME top-up from the same documents without a write. It
// serves the paths where the group may already be reading: the group page's
// view of a member the instructor force-advanced before they submitted (and
// that member's own client persisting exactly the set the others derived),
// and the Cloud Function's force-advance. A random draw there would let the
// group's list change under its members once the write landed.
//
// This file exists TWICE — src/utils/carryForward.js (ES module, the app) and
// functions/carryForward.js (CommonJS, the Cloud Functions, which deploy only
// their own folder). The bodies are identical up to the export line, and
// tools/carry-forward-guard.mjs fails when they drift.
// ─────────────────────────────────────────────────────────────────────────────

const SELECTED_BY = Object.freeze({ PARTICIPANT: 'participant', COMPUTER: 'computer' })

/** The tag shown on an idea the computer moved to the group stage. */
const COMPUTER_SELECTED_LABEL = 'Computer selected to group stage'

/** How many of `ideaCount` ideas carry forward under a cap of `ideasCarried`. */
function carryTarget(ideaCount, ideasCarried) {
  const cap = Number(ideasCarried) > 0 ? Math.floor(Number(ideasCarried)) : 0
  const n = Number(ideaCount) > 0 ? Math.floor(Number(ideaCount)) : 0
  return Math.min(cap, n)
}

function hashStr(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}

/** Deterministic pick: the same `n` ideas for the same ids, whatever the input order. */
function pickStable(arr, n) {
  if (!(n > 0)) return []
  return [...arr]
    .sort((a, b) =>
      (hashStr(String(a.id)) - hashStr(String(b.id)))
      || String(a.id).localeCompare(String(b.id)))
    .slice(0, n)
}

/** Uniform random pick of `n` distinct ideas (partial Fisher–Yates); `rng` yields [0, 1). */
function pickUniform(arr, n, rng) {
  const rand = typeof rng === 'function' ? rng : Math.random
  const pool = [...arr]
  const k = Math.max(0, Math.min(n > 0 ? Math.floor(n) : 0, pool.length))
  for (let i = 0; i < k; i++) {
    const span = pool.length - i
    const j = i + Math.min(span - 1, Math.max(0, Math.floor(rand() * span)))
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t
  }
  return pool.slice(0, k)
}

/**
 * Decide the carried set for one participant.
 *   ideas        — their individual-stage ideas ({ id, … })
 *   selectedIds  — the ids they selected (Set or array); ids of ideas that no
 *                  longer exist are ignored
 *   ideasCarried — the session's cap (phaseConfig.ideasCarriedToGroup); 0 means
 *                  nothing carries (a session with no group phase)
 *   pick         — pickUniform (default) or pickStable, see the header
 * Returns { selection, participantPicked, computerPicked }, three Sets of ids.
 * The participant's own picks are never removed, even above the cap.
 */
function topUpSelection({ ideas, selectedIds, ideasCarried, pick }) {
  const list = Array.isArray(ideas) ? ideas.filter(i => i && i.id != null) : []
  const chosen = selectedIds instanceof Set ? selectedIds : new Set(selectedIds || [])
  const participantPicked = new Set(list.filter(i => chosen.has(i.id)).map(i => i.id))
  const target = carryTarget(list.length, ideasCarried)
  const missing = target - participantPicked.size
  const computerPicked = new Set()
  if (missing > 0) {
    const pool = list.filter(i => !participantPicked.has(i.id))
    const picker = typeof pick === 'function' ? pick : pickUniform
    picker(pool, missing).forEach(i => computerPicked.add(i.id))
  }
  const selection = new Set([...participantPicked, ...computerPicked])
  return { selection, participantPicked, computerPicked }
}

/** Who carried this idea into the group phase: 'participant', 'computer' or '' (not carried). */
function carriedBy(idea) {
  if (!idea || !idea.selected) return ''
  return idea.selectedBy === SELECTED_BY.COMPUTER ? SELECTED_BY.COMPUTER : SELECTED_BY.PARTICIPANT
}

/** The fields to write on one idea once a decision is made. */
function selectionPatch(ideaId, decision) {
  if (decision.computerPicked.has(ideaId)) return { selected: true, selectedBy: SELECTED_BY.COMPUTER }
  if (decision.selection.has(ideaId)) return { selected: true, selectedBy: SELECTED_BY.PARTICIPANT }
  return { selected: false, selectedBy: null }
}

/**
 * The confirmation screen's sentence about the carried set — one place, so
 * the participant's summary and the tests cannot disagree about the wording.
 */
function carriedSummary(total, byComputer) {
  if (!(total > 0)) return ''
  const n = total === 1 ? '1 idea carries' : `${total} ideas carry`
  if (!(byComputer > 0)) return `${n} into the group phase.`
  if (byComputer >= total) {
    return `${n} into the group phase, selected by the computer at random because you chose none.`
  }
  const mine = total - byComputer
  return `${n} into the group phase: ${mine} you chose and ${byComputer} the computer selected at random.`
}

export {
  SELECTED_BY, COMPUTER_SELECTED_LABEL, carryTarget, hashStr, pickStable, pickUniform,
  topUpSelection, carriedBy, selectionPatch, carriedSummary,
}
