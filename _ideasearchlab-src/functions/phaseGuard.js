/**
 * phaseGuard — a participant is never dragged BACKWARDS through the flow.
 *
 * Several places move a whole GROUP on together: `finishGroupVoting` (the last
 * member submits their votes), `autoGroupParticipants` (the last member
 * finishes the individual phase) and `reconcileGroupAfterRemoval`. Each used to
 * write `{ status: nextPhase }` to every member unconditionally — which is
 * wrong whenever a member is already FURTHER ALONG than that phase.
 *
 * That is not hypothetical. Members reach the survey on their own (the
 * GroupPhase self-heal, or the instructor's Force advance) and the survey is
 * short, so a fast participant can be `done` well before the slowest member of
 * their group submits their votes. When that last vote finally lands, the
 * trigger fires and rewrites the WHOLE group to 'survey' — demoting the
 * finished participant from 'done' back to 'survey'.
 *
 * Observed in session SGP1 (2026-08-13): zhangqiong finished their survey at
 * 06:01:34, the last member of group g13 submitted votes at 06:04:29, and the
 * participant doc was left carrying `status: 'survey'` beside a complete
 * `surveyAnswers` + `surveyCompletedAt`. The admin then read them as still
 * working, and the Simulation Platform's "Verify from Ideation Challenge"
 * offered to REVOKE their ✓. Same story for Zhang Pan in g5 (25 s apart).
 *
 * Two rules, applied at every group-wide write:
 *   1. A participant who has COMPLETED THE SURVEY is terminal. The survey is
 *      the last step of the study, so their record is finished whatever the
 *      status field happens to say — never rewrite it.
 *   2. Otherwise only move them FORWARD in this session's own phase sequence
 *      (which differs between individual_first and group_first, hence the
 *      sequence argument rather than a global rank table).
 *
 * Pure functions, no Firebase imports, so `tools/phase-guard.mjs` can test them
 * offline.
 */

/**
 * Index of a participant status within the session's phase sequence,
 * collapsing the sub-statuses that are not themselves sequence entries.
 * Unknown statuses return -1, so they never count as "reached this phase".
 */
function statusPhaseIndex(status, sequence) {
  const norm = status === 'waiting_for_group' ? 'individual'
    : status === 'voting' ? 'group'
    : status
  return (sequence || []).indexOf(norm)
}

/**
 * Has this participant finished the study? The survey is the last step, so a
 * stored survey IS completion — `status` alone is not the truth (it is the
 * field this guard exists to protect).
 */
function isFinishedParticipant(p) {
  if (!p) return false
  return p.status === 'done' || !!p.surveyCompletedAt || !!p.surveyAnswers
}

/**
 * Should a group-wide advance write `nextPhase` onto this participant?
 * False when the write would be a no-op, would touch a finished participant,
 * or would move them backwards.
 */
function shouldSetStatus(p, nextPhase, sequence) {
  if (!p || !nextPhase) return false
  if (p.removed || p.status === 'removed') return false
  if (p.status === nextPhase) return false
  if (isFinishedParticipant(p)) return false
  const target = statusPhaseIndex(nextPhase, sequence)
  const current = statusPhaseIndex(p.status, sequence)
  if (target >= 0 && current >= 0 && current >= target) return false
  return true
}

module.exports = { statusPhaseIndex, isFinishedParticipant, shouldSetStatus }
