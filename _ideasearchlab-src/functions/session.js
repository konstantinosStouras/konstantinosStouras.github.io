const functionsV1 = require('firebase-functions/v1')
const functions = functionsV1.region('europe-west1')
const { HttpsError } = functionsV1.https
const admin = require('firebase-admin')

const db = admin.firestore()

/**
 * assignToGroup
 * Atomically places a newly-joined participant into exactly ONE group.
 *
 * Every join is serialized through the session's `joinCount` counter inside a
 * single transaction, so each participant receives a unique, sequential join
 * index and a deterministic group (g0, g1, …). This removes the race in the
 * old query-then-batch approach, where two people joining at the same moment
 * could both be placed into overlapping groups — i.e. one user ending up in
 * two groups of the same session. The member who fills a group flips every
 * member of that group into the first phase together.
 *
 * Firestore transactions cannot run queries, so this uses document reads only:
 * the session doc (counter + config) and the single target group doc.
 */
async function assignToGroup(sessionRef, uid, name, email) {
  return db.runTransaction(async (tx) => {
    // ── All reads first (Firestore transactions forbid reads after writes) ──
    const sessionSnap = await tx.get(sessionRef)
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.')
    const session = sessionSnap.data()

    const participantRef = sessionRef.collection('participants').doc(uid)
    const pSnap = await tx.get(participantRef)

    const groupSize = session.phaseConfig?.groupSize ?? 3
    const individualActive = session.phaseConfig?.individualPhaseActive ?? true
    const phaseOrder = session.phaseConfig?.phaseOrder ?? 'individual_first'
    const firstPhase = (individualActive && phaseOrder === 'individual_first') ? 'individual' : 'group'

    // A vacancy opens when the instructor removes someone from an in-progress
    // group (see removeParticipant), recorded on session.backfillQueue. The
    // oldest vacancy is read up front so a late joiner can backfill it.
    const queue = Array.isArray(session.backfillQueue) ? session.backfillQueue : []
    const slot = queue.length > 0 ? queue[0] : null
    const backfillGroupRef = slot ? sessionRef.collection('groups').doc(slot.groupId) : null
    const backfillGroupSnap = backfillGroupRef ? await tx.get(backfillGroupRef) : null

    const myIndex = session.joinCount || 0            // 0-based join order
    const groupNumber = Math.floor(myIndex / groupSize)
    const normalGroupRef = sessionRef.collection('groups').doc(`g${groupNumber}`)
    const normalGroupSnap = await tx.get(normalGroupRef)

    if (pSnap.exists) {
      // Rejoin: refresh identity only. Never re-assign a group or touch status.
      tx.update(participantRef, { name, email, uid })
      return session.status
    }

    // ── Backfill a vacated slot: the late joiner jumps straight into that
    // group's current phase, so the group is whole again. ──
    if (slot && backfillGroupSnap && backfillGroupSnap.exists) {
      const g = backfillGroupSnap.data()
      const members = [...(g.members || []), uid]
      const label = slot.label || `p${members.length}`
      const memberLabels = { ...(g.memberLabels || {}), [uid]: label }
      const joinStatus = slot.phase || firstPhase

      tx.set(participantRef, {
        name, email, uid,
        joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: joinStatus,
        individualComplete: false,
        groupId: backfillGroupRef.id,
        anonymousLabel: label,
        backfilled: true,
      })
      tx.set(backfillGroupRef, {
        members, memberLabels,
        status: 'active',
        full: members.length >= groupSize,
      }, { merge: true })
      tx.update(sessionRef, { backfillQueue: queue.slice(1) })
      return joinStatus
    }

    // ── Normal deterministic assignment (unchanged behaviour) ──
    const label = `p${(myIndex % groupSize) + 1}`
    const prevMembers = normalGroupSnap.exists ? (normalGroupSnap.data().members || []) : []
    const prevLabels = normalGroupSnap.exists ? (normalGroupSnap.data().memberLabels || {}) : {}
    const members = [...prevMembers, uid]
    const memberLabels = { ...prevLabels, [uid]: label }
    const isFull = members.length >= groupSize
    const startStatus = isFull ? firstPhase : 'waiting'

    // This participant's document.
    tx.set(participantRef, {
      name, email, uid,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: startStatus,
      individualComplete: false,
      groupId: normalGroupRef.id,
      anonymousLabel: label,
    })

    // The group document (merge so later joins never wipe createdAt/finalIdeas).
    const groupPayload = { members, memberLabels, status: 'active', full: isFull }
    if (!normalGroupSnap.exists) {
      groupPayload.createdAt = admin.firestore.FieldValue.serverTimestamp()
      groupPayload.finalIdeas = []
    }
    tx.set(normalGroupRef, groupPayload, { merge: true })

    // Advance the join counter; if this filled the group, start everyone in it.
    const sessionUpdates = { joinCount: myIndex + 1 }
    // A queued slot whose group has vanished is stale — drop it.
    if (slot && (!backfillGroupSnap || !backfillGroupSnap.exists)) {
      sessionUpdates.backfillQueue = queue.slice(1)
    }
    if (isFull) {
      prevMembers.forEach(mUid => {
        tx.update(sessionRef.collection('participants').doc(mUid), { status: firstPhase })
      })
      if (session.status === 'waiting') {
        sessionUpdates.status = firstPhase
        sessionUpdates.phaseStartedAt = admin.firestore.FieldValue.serverTimestamp()
      }
    }
    tx.update(sessionRef, sessionUpdates)

    return sessionUpdates.status || session.status
  })
}

/**
 * removeParticipant
 * Instructor-only. Removes a participant from the session even after play has
 * started: detaches them from their group (so the group has one fewer member),
 * marks them `removed`, and — if the group is mid-experiment — queues a
 * backfill vacancy so the next late joiner can take that exact slot and jump
 * into the group's current phase. After detaching, reconciles the group in
 * case the removed member was the only one still blocking it from advancing.
 */
exports.removeParticipant = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Must be logged in.')
  const { sessionId, participantId } = data
  if (!sessionId || !participantId) {
    throw new HttpsError('invalid-argument', 'sessionId and participantId required.')
  }

  const sessionRef = db.collection('sessions').doc(sessionId)

  const result = await db.runTransaction(async (tx) => {
    const sessionSnap = await tx.get(sessionRef)
    if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.')
    const session = sessionSnap.data()
    if (session.instructorId !== context.auth.uid) {
      throw new HttpsError('permission-denied', 'Only the instructor can remove participants.')
    }

    const pRef = sessionRef.collection('participants').doc(participantId)
    const pSnap = await tx.get(pRef)
    if (!pSnap.exists) throw new HttpsError('not-found', 'Participant not found.')
    const p = pSnap.data()
    if (p.removed) return { alreadyRemoved: true }

    const groupId = p.groupId || null
    const label = p.anonymousLabel || null
    let groupRef = null
    let groupData = null
    if (groupId) {
      groupRef = sessionRef.collection('groups').doc(groupId)
      const gSnap = await tx.get(groupRef)
      if (gSnap.exists) groupData = gSnap.data()
    }

    // Where a backfill joiner should resume = where the group is right now.
    // 'waiting_for_group' means the removed member had finished their own
    // individual work; a fresh joiner has not, so resume them in 'individual'.
    let backfillPhase = null
    if (['individual', 'waiting_for_group'].includes(p.status)) backfillPhase = 'individual'
    else if (['group', 'voting'].includes(p.status)) backfillPhase = 'group'

    // ── Writes ──
    tx.update(pRef, {
      removed: true,
      removedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'removed',
      groupId: null,
      removedFromGroupId: groupId,
    })

    if (groupRef && groupData) {
      const members = (groupData.members || []).filter(m => m !== participantId)
      const memberLabels = { ...(groupData.memberLabels || {}) }
      delete memberLabels[participantId]
      tx.update(groupRef, {
        members,
        memberLabels,
        full: members.length >= (session.phaseConfig?.groupSize ?? 3),
      })

      // Queue a backfill vacancy only while the group is still in play.
      if (backfillPhase && groupData.status === 'active') {
        const queue = Array.isArray(session.backfillQueue) ? session.backfillQueue : []
        queue.push({ groupId, label, phase: backfillPhase })
        tx.update(sessionRef, { backfillQueue: queue })
      }
    }

    return { groupId }
  })

  // Reconcile outside the transaction (it needs a members query, which
  // transactions can't run): if the removed member was the last one blocking
  // the group, advance the remaining members now.
  if (result.groupId && !result.alreadyRemoved) {
    await reconcileGroupAfterRemoval(sessionRef, result.groupId)
  }

  return { ok: true }
})

/**
 * reconcileGroupAfterRemoval
 * After a member is detached, the remaining members may already all be done —
 * in which case nothing else would trigger the group's advance. Mirror the
 * autoGroupParticipants / finishGroupVoting checks for the survivors.
 */
async function reconcileGroupAfterRemoval(sessionRef, groupId) {
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) return
  const session = sessionSnap.data()

  const groupRef = sessionRef.collection('groups').doc(groupId)
  const groupSnap = await groupRef.get()
  if (!groupSnap.exists || groupSnap.data().status !== 'active') return

  const membersSnap = await sessionRef.collection('participants')
    .where('groupId', '==', groupId)
    .get()
  const active = membersSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(m => !m.removed)
  if (active.length === 0) return

  const sequence = getPhaseSequence(session.phaseConfig)
  const phaseOrder = session.phaseConfig?.phaseOrder ?? 'individual_first'
  const individualActive = session.phaseConfig?.individualPhaseActive ?? true
  const groupActive = session.phaseConfig?.groupPhaseActive ?? true

  // Individual_first individual phase: all survivors finished -> move to group.
  if (session.status === 'individual' && individualActive && groupActive && phaseOrder === 'individual_first') {
    if (!active.every(m => m.individualComplete)) return
    const memberIds = active.map(m => m.id)
    const batch = db.batch()
    active.forEach(m => batch.update(sessionRef.collection('participants').doc(m.id), { status: 'group' }))
    const allSnap = await sessionRef.collection('participants').get()
    const allMoved = allSnap.docs.every(d => {
      if (d.data().removed || memberIds.includes(d.id)) return true
      return ['group', 'voting', 'survey', 'done'].includes(d.data().status)
    })
    if (allMoved) {
      batch.update(sessionRef, { status: 'group', phaseStartedAt: admin.firestore.FieldValue.serverTimestamp() })
    }
    await batch.commit()
    return
  }

  // Group phase: all survivors voted -> tally and move the group on.
  if (session.status === 'group') {
    if (!active.every(m => m.votesSubmitted)) return
    const groupIndex = sequence.indexOf('group')
    if (groupIndex === -1 || groupIndex >= sequence.length - 1) return
    const nextPhase = sequence[groupIndex + 1]
    const voteMap = {}
    active.forEach(m => (m.votedFor || []).forEach(id => { voteMap[id] = (voteMap[id] || 0) + 1 }))
    const topIdeas = Object.entries(voteMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id)

    const memberIds = active.map(m => m.id)
    const batch = db.batch()
    batch.update(groupRef, {
      status: 'done',
      finalIdeas: topIdeas,
      votingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
    active.forEach(m => batch.update(sessionRef.collection('participants').doc(m.id), { status: nextPhase }))

    const laterPhases = sequence.slice(groupIndex + 1)
    const allSnap = await sessionRef.collection('participants').get()
    const allMoved = allSnap.docs.every(d => {
      if (d.data().removed || memberIds.includes(d.id)) return true
      return laterPhases.includes(d.data().status)
    })
    if (allMoved) {
      batch.update(sessionRef, { status: nextPhase, phaseStartedAt: admin.firestore.FieldValue.serverTimestamp() })
    }
    await batch.commit()
  }
}

/**
 * joinSession
 * Validates a session code and registers the participant, then places them in
 * a group atomically (see assignToGroup). Called from the Registration page.
 */
exports.joinSession = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Must be logged in.')

  const { code } = data
  if (!code) throw new HttpsError('invalid-argument', 'Session code required.')

  const snap = await db.collection('sessions')
    .where('code', '==', code.trim().toUpperCase())
    .where('status', '!=', 'done')
    .limit(1)
    .get()

  if (snap.empty) throw new HttpsError('not-found', 'Session not found.')

  const sessionId = snap.docs[0].id
  const sessionRef = db.collection('sessions').doc(sessionId)
  const uid = context.auth.uid
  const name = context.auth.token.name || context.auth.token.email
  const email = context.auth.token.email

  const status = await assignToGroup(sessionRef, uid, name, email)

  return { sessionId, status }
})


/**
 * advancePhase
 * Moves the session to the next phase in its sequence.
 * Only the instructor (session owner) can call this.
 * Also updates participant statuses accordingly.
 */
exports.advancePhase = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Must be logged in.')

  const { sessionId } = data
  if (!sessionId) throw new HttpsError('invalid-argument', 'sessionId required.')

  const sessionRef = db.collection('sessions').doc(sessionId)
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) throw new HttpsError('not-found', 'Session not found.')

  const session = sessionSnap.data()

  if (session.instructorId !== context.auth.uid) {
    throw new HttpsError('permission-denied', 'Only the instructor can advance phases.')
  }

  const sequence = getPhaseSequence(session.phaseConfig)
  const currentIndex = sequence.indexOf(session.status)
  if (currentIndex === -1 || currentIndex >= sequence.length - 1) {
    throw new HttpsError('failed-precondition', 'Session is already at the final phase.')
  }

  const nextPhase = sequence[currentIndex + 1]

  // Tally group votes whenever leaving the group phase (the next phase is
  // survey for individual_first, individual for group_first)
  if (session.status === 'group') {
    await tallyGroupVotes(sessionRef)
  }

  // Update session status
  await sessionRef.update({
    status: nextPhase,
    phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  // Update participant statuses based on next phase
  const participantsSnap = await sessionRef.collection('participants').get()
  const batch = db.batch()

  participantsSnap.docs.forEach(pDoc => {
    const p = pDoc.data()
    let newStatus = p.status

    if (nextPhase === 'individual') {
      // From session start (waiting), or force-advancing everyone out of the
      // group phase when the group phase comes first
      if (['waiting', 'group'].includes(p.status)) newStatus = 'individual'
    }

    if (nextPhase === 'group') {
      if (session.phaseConfig?.phaseOrder === 'group_first') {
        // group_first: move waiting participants directly into group
        if (p.status === 'waiting') newStatus = 'group'
      } else {
        // individual_first: force-advance anyone who hasn't reached group yet
        if (['waiting', 'individual'].includes(p.status)) newStatus = 'group'
      }
    }

    if (nextPhase === 'survey') {
      // Move everyone who hasn't completed the survey yet
      if (!['survey', 'done'].includes(p.status)) newStatus = 'survey'
    }

    if (nextPhase === 'done') {
      newStatus = 'done'
    }

    if (newStatus !== p.status) {
      batch.update(pDoc.ref, { status: newStatus })
    }
  })

  await batch.commit()

  // No group pre-assignment needed: every participant is already placed in a
  // group atomically at join time (see assignToGroup). Force-advancing only
  // moves any still-waiting members of a partial group into the phase.

  return { nextPhase }
})


/**
 * tallyGroupVotes
 * Reads each participant's votedFor array, counts votes per idea,
 * and stores the top 3 ideas on each group document as finalIdeas.
 * Called when advancing from group phase to survey.
 */
async function tallyGroupVotes(sessionRef) {
  const groupsSnap = await sessionRef.collection('groups')
    .where('status', '==', 'active')
    .get()

  if (groupsSnap.empty) return

  const participantsSnap = await sessionRef.collection('participants').get()
  const participants = participantsSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  const batch = db.batch()

  for (const groupDoc of groupsSnap.docs) {
    const groupMembers = participants.filter(p => p.groupId === groupDoc.id)

    // Tally votes from all members' votedFor arrays
    const voteMap = {}
    groupMembers.forEach(m => {
      (m.votedFor || []).forEach(ideaId => {
        voteMap[ideaId] = (voteMap[ideaId] || 0) + 1
      })
    })

    const topIdeas = Object.entries(voteMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id]) => id)

    batch.update(groupDoc.ref, {
      status: 'done',
      finalIdeas: topIdeas,
      votingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  await batch.commit()
}


/**
 * Shared phase sequence logic (mirrors frontend utils/phaseSequence.js).
 * Must stay in sync with the frontend version.
 *
 * NOTE: 'voting' has been removed from the sequence. Voting now happens
 * inline during the group phase. The transition is group -> survey -> done.
 */
function getPhaseSequence(phaseConfig = {}) {
  const {
    individualPhaseActive = true,
    groupPhaseActive = true,
    phaseOrder = 'individual_first',
  } = phaseConfig

  const sequence = ['waiting']

  if (individualPhaseActive && groupPhaseActive) {
    if (phaseOrder === 'individual_first') {
      sequence.push('individual', 'group')
    } else {
      sequence.push('group', 'individual')
    }
  } else if (individualPhaseActive) {
    sequence.push('individual')
  } else if (groupPhaseActive) {
    sequence.push('group')
  }

  sequence.push('survey', 'done')
  return sequence
}


/**
 * finishGroupVoting
 * Called from onParticipantUpdated when a participant locks in their votes.
 * If every member of that participant's group has now submitted, tallies the
 * group's votes (top 3 -> finalIdeas), marks the group done, and moves its
 * members to the next phase in the sequence (survey for individual_first,
 * individual for group_first). Advances the session status once every
 * participant in the session has moved past the group phase.
 */
async function finishGroupVoting(sessionId, triggeringUid, after) {
  const groupId = after.groupId
  if (!groupId) return

  const sessionRef = db.collection('sessions').doc(sessionId)
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) return
  const session = sessionSnap.data()
  if (session.status !== 'group') return

  const sequence = getPhaseSequence(session.phaseConfig)
  const groupIndex = sequence.indexOf('group')
  if (groupIndex === -1 || groupIndex >= sequence.length - 1) return
  const nextPhase = sequence[groupIndex + 1]

  const groupRef = sessionRef.collection('groups').doc(groupId)
  const groupSnap = await groupRef.get()
  if (!groupSnap.exists || groupSnap.data().status !== 'active') return

  const membersSnap = await sessionRef.collection('participants')
    .where('groupId', '==', groupId)
    .get()
  const members = membersSnap.docs.map(d => ({ id: d.id, ...d.data() }))

  // The triggering participant's own write counts even if the query result
  // hasn't reflected it yet (read-after-write guard).
  const allSubmitted = members.every(m => m.id === triggeringUid || m.votesSubmitted)
  if (!allSubmitted) return

  // Tally this group's votes across all members' votedFor arrays
  const voteMap = {}
  members.forEach(m => {
    const votes = (m.id === triggeringUid ? after.votedFor : m.votedFor) || []
    votes.forEach(ideaId => { voteMap[ideaId] = (voteMap[ideaId] || 0) + 1 })
  })
  const topIdeas = Object.entries(voteMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id)

  const batch = db.batch()
  batch.update(groupRef, {
    status: 'done',
    finalIdeas: topIdeas,
    votingCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
  })

  const memberIds = members.map(m => m.id)
  members.forEach(m => {
    batch.update(sessionRef.collection('participants').doc(m.id), { status: nextPhase })
  })

  // Advance the session once every participant is past the group phase.
  // Members of THIS group count as moved (the batch hasn't committed yet).
  const laterPhases = sequence.slice(groupIndex + 1)
  const allParticipantsSnap = await sessionRef.collection('participants').get()
  const allMovedOn = allParticipantsSnap.docs.every(d => {
    if (memberIds.includes(d.id)) return true
    return laterPhases.includes(d.data().status)
  })

  if (allMovedOn) {
    batch.update(sessionRef, {
      status: nextPhase,
      phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }

  await batch.commit()
}


/**
 * Map a participant status to its index in the phase sequence, collapsing the
 * sub-statuses that aren't themselves sequence entries. Unknown statuses return
 * -1 so they never count as "reached this phase".
 */
function statusPhaseIndex(status, sequence) {
  const norm = status === 'waiting_for_group' ? 'individual'
    : status === 'voting' ? 'group'
    : status
  return sequence.indexOf(norm)
}

/**
 * maybeAdvanceSession
 * Monotonically advances session.status to the furthest phase that EVERY active
 * (non-removed) participant has reached. Idempotent and safe to call on any
 * participant change. This is the self-healing backstop that keeps the session
 * phase in sync even when a per-group auto-advance was delayed or dropped and
 * the members moved themselves on client-side — so the session still reaches
 * survey/done and never sticks on 'group'.
 */
async function maybeAdvanceSession(sessionRef) {
  const sessionSnap = await sessionRef.get()
  if (!sessionSnap.exists) return
  const session = sessionSnap.data()
  const sequence = getPhaseSequence(session.phaseConfig)
  const curIdx = sequence.indexOf(session.status)
  if (curIdx === -1 || curIdx >= sequence.length - 1) return

  const partsSnap = await sessionRef.collection('participants').get()
  const active = partsSnap.docs.map(d => d.data()).filter(p => !p.removed)
  if (active.length === 0) return

  let target = curIdx
  for (let i = sequence.length - 1; i > curIdx; i--) {
    if (active.every(p => statusPhaseIndex(p.status, sequence) >= i)) { target = i; break }
  }
  if (target > curIdx) {
    await sessionRef.update({
      status: sequence[target],
      phaseStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    })
  }
}

/**
 * onParticipantUpdated
 * Firestore trigger fired on every participant update. Two jobs:
 *  1. When a participant locks in their votes, try to finish their group's
 *     voting (tally finalIdeas, move members on).
 *  2. Whenever a participant's phase changes, re-evaluate the session's overall
 *     phase (maybeAdvanceSession) so the session self-heals to survey/done even
 *     if a per-group trigger was missed and participants advanced themselves.
 */
exports.onParticipantUpdated = functions.firestore
  .document('sessions/{sessionId}/participants/{participantId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data()
    const after = change.after.data()
    const { sessionId } = context.params
    const sessionRef = db.collection('sessions').doc(sessionId)

    // A participant just locked in their votes -> if the whole group has now
    // voted, move it on automatically (group -> survey, or -> individual when
    // the group phase comes first).
    if (!before.votesSubmitted && after.votesSubmitted) {
      await finishGroupVoting(sessionId, change.after.id, after)
    }

    // Any phase change -> keep the session-level status in sync (self-healing).
    if (before.status !== after.status) {
      await maybeAdvanceSession(sessionRef)
    }

    return null
  })