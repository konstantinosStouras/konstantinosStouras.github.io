/* ==========================================================================
   Ideation Challenge — phase-guard unit checks (offline, no deps, no network).
       node _ideasearchlab-src/tools/phase-guard.mjs

   A group advances TOGETHER: finishGroupVoting / autoGroupParticipants /
   reconcileGroupAfterRemoval write the next phase onto every member. That is
   wrong for a member who is already further along — and it happened for real.

   Session SGP1 (2026-08-13), group g13: zhangqiong submitted votes 05:57:50,
   was moved on, and finished the survey at 06:01:34 (status 'done'). The last
   member of g13 submitted their votes at 06:04:29; the trigger then rewrote
   the whole group to 'survey', leaving zhangqiong carrying a complete
   surveyAnswers + surveyCompletedAt beside `status: 'survey'`. The admin read
   them as still working and the Simulation Platform offered to revoke their ✓.
   Same in g5 for Zhang Pan, 25 s apart.

   These checks pin the two rules in functions/phaseGuard.js: a finished
   participant is terminal, and nobody moves backwards through their session's
   own phase sequence (which differs between individual_first and group_first).
   ========================================================================== */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const { statusPhaseIndex, isFinishedParticipant, shouldSetStatus } =
  require(join(HERE, '..', 'functions', 'phaseGuard.js'))

const IND_FIRST = ['waiting', 'individual', 'group', 'survey', 'done']
const GRP_FIRST = ['waiting', 'group', 'individual', 'survey', 'done']

let fail = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return }
  fail++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ── the reported bug ──────────────────────────────────────────────────── */
const zhangqiong = {
  id: 'tR0as7wWqWUEbzRWxX7x99zRmhs2',
  status: 'done',
  votesSubmitted: true,
  surveyAnswers: { q1: 5 },
  surveyCompletedAt: { seconds: 1786000894 },
}
check('SGP1/g13: the finished member is NOT rewritten when the last member votes',
  shouldSetStatus(zhangqiong, 'survey', IND_FIRST) === false)
check('…and the members still in the group phase ARE moved on',
  shouldSetStatus({ id: 'x', status: 'group', votesSubmitted: true }, 'survey', IND_FIRST) === true)
check('a survey submitted while status still says "survey" is terminal too',
  shouldSetStatus({ status: 'survey', surveyCompletedAt: { seconds: 1 } }, 'individual', GRP_FIRST) === false)
check('a participant on the survey with NO answers yet is still movable',
  shouldSetStatus({ status: 'survey' }, 'done', IND_FIRST) === true)

/* ── forward-only ──────────────────────────────────────────────────────── */
check('never backwards: survey → group is refused',
  shouldSetStatus({ status: 'survey' }, 'group', IND_FIRST) === false)
check('forwards: individual → group is allowed',
  shouldSetStatus({ status: 'individual' }, 'group', IND_FIRST) === true)
check('waiting_for_group counts as the individual phase, so → group is allowed',
  shouldSetStatus({ status: 'waiting_for_group' }, 'group', IND_FIRST) === true)
check('a no-op write (same status) is skipped',
  shouldSetStatus({ status: 'group' }, 'group', IND_FIRST) === false)
check('group_first: group → individual is FORWARD in that sequence',
  shouldSetStatus({ status: 'group' }, 'individual', GRP_FIRST) === true)
check('individual_first: group → individual is backwards and refused',
  shouldSetStatus({ status: 'group' }, 'individual', IND_FIRST) === false)
check('a removed participant is never touched',
  shouldSetStatus({ status: 'removed', removed: true }, 'survey', IND_FIRST) === false)
check('an unknown status is still movable (nothing to compare against)',
  shouldSetStatus({ status: 'lobby-v2' }, 'group', IND_FIRST) === true)
check('no participant / no phase is a no-op',
  shouldSetStatus(null, 'survey', IND_FIRST) === false && shouldSetStatus({ status: 'group' }, '', IND_FIRST) === false)

/* ── the primitives ────────────────────────────────────────────────────── */
check('isFinishedParticipant: done',
  isFinishedParticipant({ status: 'done' }) === true)
check('isFinishedParticipant: survey answers without done',
  isFinishedParticipant({ status: 'survey', surveyAnswers: {} }) === true)
check('isFinishedParticipant: mid-survey is not finished',
  isFinishedParticipant({ status: 'survey' }) === false)
check('statusPhaseIndex: voting collapses onto group',
  statusPhaseIndex('voting', IND_FIRST) === IND_FIRST.indexOf('group'))
check('statusPhaseIndex: unknown → -1',
  statusPhaseIndex('nonsense', IND_FIRST) === -1)

console.log(fail ? `\nFAILURES: ${fail}` : '\nPHASE GUARD OK — a finished participant is never dragged back.')
process.exit(fail ? 1 : 0)
