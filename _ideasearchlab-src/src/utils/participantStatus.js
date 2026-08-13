import { doc, updateDoc, db } from './db'

/**
 * Who has actually FINISHED the study — and repairing the ones whose status
 * field says otherwise.
 *
 * The survey is the last step, so a participant carrying `surveyAnswers` /
 * `surveyCompletedAt` is finished, whatever `status` holds. The two can
 * disagree because a group-wide advance used to rewrite every member's status
 * when the LAST member submitted their votes — minutes after a faster member
 * had already finished the survey, demoting them from 'done' back to 'survey'
 * (session SGP1, 2026-08-13: zhangqiong and Zhang Pan). The backend guard is
 * `functions/phaseGuard.js`; this is the reader's side of the same truth, plus
 * a repair for the records already written that way.
 */
export function hasCompletedSurvey(p) {
  return !!(p && (p.surveyCompletedAt || p.surveyAnswers))
}

/** Finished the study: reached 'done', or completed the survey. */
export function participantIsDone(p) {
  return !!(p && (p.status === 'done' || hasCompletedSurvey(p)))
}

/** Participants whose status contradicts their completed survey. */
export function needsStatusRepair(participants) {
  return (participants || []).filter(
    p => hasCompletedSurvey(p) && p.status !== 'done' && p.status !== 'removed' && !p.removed
  )
}

/**
 * Set `status: 'done'` on every participant of `sessionId` who completed the
 * survey but is not marked done. Instructor-only in practice (participants can
 * write their own doc, the instructor can write any of their session's), and
 * idempotent — a repaired doc no longer matches. Resolves with the number of
 * documents actually repaired; failures are swallowed per-doc so one blocked
 * write can never hide the rest.
 */
export async function healFinishedParticipants(sessionId, participants) {
  const stale = needsStatusRepair(participants)
  if (!sessionId || stale.length === 0) return 0
  const results = await Promise.allSettled(
    stale.map(p =>
      updateDoc(doc(db, 'sessions', sessionId, 'participants', p.id || p.uid), { status: 'done' })
    )
  )
  return results.filter(r => r.status === 'fulfilled').length
}
