const functionsV1 = require('firebase-functions/v1')
const functions = functionsV1.region('europe-west1')
const { HttpsError } = functionsV1.https
const admin = require('firebase-admin')

const db = admin.firestore()

/**
 * autoGroupParticipants
 *
 * Firestore-triggered. Fires when a participant document is updated.
 * Handles the individual_first rolling transition: when all members of a group
 * complete the individual phase, move that group to the group phase.
 * Also auto-advances the session status when all groups are in group phase.
 */
exports.autoGroupParticipants = functions.firestore
  .document('sessions/{sessionId}/participants/{participantId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data()
    const after = change.after.data()

    // Only act when individualComplete flips from false to true
    if (before.individualComplete === after.individualComplete) return
    if (!after.individualComplete) return

    const groupId = after.groupId
    if (!groupId) return // not in a group yet (still waiting in lobby)

    const { sessionId } = context.params
    const sessionRef = db.collection('sessions').doc(sessionId)

    // Query group members OUTSIDE transaction (transactions don't support queries)
    const sessionSnap = await sessionRef.get()
    if (!sessionSnap.exists) return

    const session = sessionSnap.data()

    const individualActive = session.phaseConfig?.individualPhaseActive ?? true
    const groupActive = session.phaseConfig?.groupPhaseActive ?? true
    const phaseOrder = session.phaseConfig?.phaseOrder ?? 'individual_first'

    // When the individual phase is the LAST working phase (group_first, or
    // individual-only sessions), the next phase is the survey — which is
    // individual, so a finished participant moves on alone instead of
    // waiting for the rest of their group.
    if (individualActive && (!groupActive || phaseOrder === 'group_first')) {
      const batch = db.batch()
      batch.update(change.after.ref, { status: 'survey' })

      const allSnap = await sessionRef.collection('participants').get()
      const allMoved = allSnap.docs.every(d =>
        d.id === change.after.id || ['survey', 'done'].includes(d.data().status)
      )
      if (allMoved && session.status === 'individual') {
        batch.update(sessionRef, {
          status: 'survey',
          phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        })
      }
      await batch.commit()
      return
    }

    // Only run during individual_first flow
    if (!individualActive || !groupActive || phaseOrder !== 'individual_first') return

    // Get all members of this participant's group
    const groupMembersSnap = await sessionRef.collection('participants')
      .where('groupId', '==', groupId)
      .get()

    const members = groupMembersSnap.docs.map(d => ({ id: d.id, ...d.data() }))

    // Check if ALL members of this group have completed individual phase
    const allGroupDone = members.every(m => {
      if (m.id === change.after.id) return true // this one just flipped
      return m.individualComplete
    })

    if (!allGroupDone) {
      // Not all group members done yet - mark as waiting_for_group
      await change.after.ref.update({ status: 'waiting_for_group' })
      return
    }

    // All group members done - move them all to group phase using a batch
    const batch = db.batch()
    const groupMemberIds = members.map(m => m.id)

    members.forEach(m => {
      batch.update(sessionRef.collection('participants').doc(m.id), {
        status: 'group',
      })
    })

    // Check if ALL participants in the session are now resolved.
    // Account for all members of THIS group (they are about to be moved
    // to 'group' in this batch but Firestore hasn't committed yet).
    const allParticipantsSnap = await sessionRef.collection('participants').get()
    const allSessionDone = allParticipantsSnap.docs.every(d => {
      if (groupMemberIds.includes(d.id)) return true // being moved to group in this batch
      const p = d.data()
      return ['group', 'voting', 'survey', 'done'].includes(p.status)
    })

    if (allSessionDone && session.status === 'individual') {
      batch.update(sessionRef, {
        status: 'group',
        phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
    }

    await batch.commit()
  })


/**
 * handleStragglers
 *
 * HTTPS callable - the instructor triggers this to start any partly-filled
 * last group whose members are still waiting in the lobby (e.g. 70 students
 * with group size 3 leaves one undersized group). Each participant was already
 * placed in a deterministic group at join time (see assignToGroup), so this
 * simply starts those still-waiting members in the first phase as their
 * existing (undersized) group.
 */
exports.handleStragglers = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Must be logged in.')

  const { sessionId } = data
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.')

  const sessionRef = db.collection('sessions').doc(sessionId)
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.')

  const session = sessionSnap.data()
  if (session.instructorId !== context.auth.uid) {
    throw new HttpsError('permission-denied', 'Only the instructor can do this.')
  }

  const phaseOrder = session.phaseConfig?.phaseOrder ?? 'individual_first'
  const individualActive = session.phaseConfig?.individualPhaseActive ?? true
  const firstPhase = (individualActive && phaseOrder === 'individual_first') ? 'individual' : 'group'

  const waitingSnap = await sessionRef.collection('participants')
    .where('status', '==', 'waiting')
    .get()

  const waiting = waitingSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  if (waiting.length === 0) return { handled: 0 }

  const batch = db.batch()
  const groupsTouched = new Set()

  waiting.forEach(p => {
    batch.update(sessionRef.collection('participants').doc(p.id), { status: firstPhase })
    if (p.groupId) groupsTouched.add(p.groupId)
  })

  // Mark each affected group full so it begins as an undersized group.
  groupsTouched.forEach(gid => {
    batch.set(
      sessionRef.collection('groups').doc(gid),
      { full: true },
      { merge: true }
    )
  })

  if (session.status === 'waiting') {
    batch.update(sessionRef, {
      status: firstPhase,
      phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  await batch.commit()
  return { handled: waiting.length }
})