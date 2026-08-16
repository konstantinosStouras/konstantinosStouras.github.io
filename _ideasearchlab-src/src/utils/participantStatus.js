import { doc, updateDoc, db } from './db'
import { identityRepairFor } from './participantIdentity'

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

/**
 * Write each participant's REAL identity onto their doc, where the throwaway
 * login left placeholders and the student's registration answers know better
 * (participantIdentity.js — a direct-link play records its name/e-mail/student
 * ID only under `demographics`). Fill-empty only, so a platform launch's
 * record is never overwritten; instructor-permitted by the deployed rules
 * (isSessionInstructor may update any participant of their session) and
 * idempotent — a healed doc computes no repair. Resolves with the number of
 * documents actually repaired; per-doc failures are swallowed like the status
 * heal above, so one blocked write can never hide the rest.
 *
 * Filling `platform.studentId` is what makes the Simulation Platform's
 * "Verify from Ideation Challenge" match these students (its adapter also
 * reads `demographics` directly, so verification does not WAIT on this heal —
 * this makes the export's Platform columns and the admin displays agree with
 * it).
 */
export async function healParticipantIdentities(sessionId, session, participants) {
  const fixes = (participants || [])
    .map(p => ({ p, updates: identityRepairFor(p, session) }))
    .filter(x => x.updates)
  if (!sessionId || fixes.length === 0) return 0
  const results = await Promise.allSettled(
    fixes.map(x =>
      updateDoc(doc(db, 'sessions', sessionId, 'participants', x.p.id || x.p.uid), x.updates)
    )
  )
  return results.filter(r => r.status === 'fulfilled').length
}
