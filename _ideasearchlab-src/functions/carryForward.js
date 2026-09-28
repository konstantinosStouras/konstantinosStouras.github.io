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
// ONE PICKER, deliberately deterministic. `pickStable` orders the candidate
// ideas by a hash of their Firestore document ids. Those ids are random
// strings minted at creation, so the ranking is a uniformly random
// permutation — independent of the ideas' content, order and of anything the
// participant did — and the subset it yields is a uniformly random subset
// (measured in tools/carry-forward-guard.mjs over random ids). What a random
// draw at submit time would NOT give is agreement: the same decision is made
// by Finish & Submit, by the selection clock's auto-submit, by every group
// member's page for a member the instructor force-advanced before they
// submitted, and by the Cloud Function's force-advance — from the same
// documents, with no coordination — so no two writers can ever land two
// different "random" sets on one participant (the union would exceed the
// cap), and a group never watches a member's ideas change under it once a
// late write lands. A retry after a failed submit reaches the same set too.
//
// A computer pick already recorded on the documents (`priorComputer`) is
// HONOURED, never re-drawn: a participant's own pick always beats it, it is
// kept up to what is still needed, and only the remaining places are filled.
//
// This file exists TWICE — src/utils/carryForward.js (ES module, the app) and
// functions/carryForward.js (CommonJS, the Cloud Functions, which deploy only
// their own folder). The bodies are identical up to the export line, and
// tools/carry-forward-guard.mjs fails when they drift.
// ─────────────────────────────────────────────────────────────────────────────

// Who put an idea in the group phase. UNRECORDED = carried by a session run
// before 2026-09-28, when the app did not yet say who chose an idea: it may be
// the participant's own pick or the old clock's untagged auto-pick for
// someone who chose none, and nothing can tell the two apart — so it is never
// reported as either. Every write since then carries one of the other two.
const SELECTED_BY = Object.freeze({ PARTICIPANT: 'participant', COMPUTER: 'computer', UNRECORDED: 'unrecorded' })

// Version marker of this rule. IndividualPhase renders it into the page, so
// the SHIPPED bundle carries the value of the module it was built from and
// tools/carry-forward-guard.mjs can tell a stale rebuild from a current one
// (the tag strings alone are the same in every version). BUMP IT with every
// change to this file.
const CARRY_FORWARD_RULE = 'cf/2026-09-28b'

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

function toIdSet(v) {
  if (v instanceof Set) return v
  return new Set(Array.isArray(v) ? v : [])
}

/**
 * Decide the carried set for one participant.
 *   ideas         — their individual-stage ideas ({ id, … })
 *   selectedIds   — the ids THEY selected (Set or array); ids of ideas that no
 *                   longer exist are ignored
 *   priorComputer — ids the computer already picked for them, if any (a
 *                   retry, a force-advance seen after the fact); honoured up
 *                   to what is still needed, never re-drawn
 *   ideasCarried  — the session's cap (phaseConfig.ideasCarriedToGroup); 0
 *                   means nothing carries (no group phase follows)
 * Returns { selection, participantPicked, computerPicked }, three Sets of ids.
 * The participant's own picks are never removed, even above the cap.
 */
function topUpSelection({ ideas, selectedIds, priorComputer, ideasCarried }) {
  const list = Array.isArray(ideas) ? ideas.filter(i => i && i.id != null) : []
  const chosen = toIdSet(selectedIds)
  const prior = toIdSet(priorComputer)
  const participantPicked = new Set(list.filter(i => chosen.has(i.id)).map(i => i.id))
  const target = carryTarget(list.length, ideasCarried)
  const computerPicked = new Set()
  let missing = target - participantPicked.size
  if (missing > 0) {
    // Already-recorded computer picks first (trimmed if more than needed) …
    pickStable(list.filter(i => prior.has(i.id) && !participantPicked.has(i.id)), missing)
      .forEach(i => computerPicked.add(i.id))
    missing = target - participantPicked.size - computerPicked.size
    // … then the remaining places from the ideas nobody picked.
    if (missing > 0) {
      pickStable(list.filter(i => !participantPicked.has(i.id) && !computerPicked.has(i.id)), missing)
        .forEach(i => computerPicked.add(i.id))
    }
  }
  const selection = new Set([...participantPicked, ...computerPicked])
  return { selection, participantPicked, computerPicked }
}

/**
 * Who carried this idea into the group phase: 'participant', 'computer',
 * 'unrecorded' (carried before the tag existed) or '' (not carried).
 */
function carriedBy(idea) {
  if (!idea || !idea.selected) return ''
  if (idea.selectedBy === SELECTED_BY.COMPUTER) return SELECTED_BY.COMPUTER
  if (idea.selectedBy === SELECTED_BY.PARTICIPANT) return SELECTED_BY.PARTICIPANT
  return SELECTED_BY.UNRECORDED
}

/** True when the idea counts as the participant's own pick (a legacy untagged pick included). */
function isOwnPick(idea) {
  const by = carriedBy(idea)
  return by === SELECTED_BY.PARTICIPANT || by === SELECTED_BY.UNRECORDED
}

/** The fields to write on one idea once a decision is made. */
function selectionPatch(ideaId, decision) {
  if (decision.computerPicked.has(ideaId)) return { selected: true, selectedBy: SELECTED_BY.COMPUTER }
  if (decision.selection.has(ideaId)) return { selected: true, selectedBy: SELECTED_BY.PARTICIPANT }
  return { selected: false, selectedBy: null }
}

/**
 * True when the patch would change what the document already says. A legacy
 * untagged pick that stays a participant pick is left as it is: stamping it
 * 'participant' now would assert something the data never recorded.
 */
function patchChanges(idea, patch) {
  const was = carriedBy(idea)
  if (!!(idea && idea.selected) !== patch.selected) return true
  if (!patch.selected) return false
  if (was === patch.selectedBy) return false
  return !(was === SELECTED_BY.UNRECORDED && patch.selectedBy === SELECTED_BY.PARTICIPANT)
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

module.exports = {
  SELECTED_BY, COMPUTER_SELECTED_LABEL, CARRY_FORWARD_RULE, carryTarget, hashStr, pickStable,
  topUpSelection, carriedBy, isOwnPick, selectionPatch, patchChanges, carriedSummary,
}
