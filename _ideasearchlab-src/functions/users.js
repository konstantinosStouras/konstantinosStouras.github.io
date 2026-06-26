const functionsV1 = require('firebase-functions/v1')
const functions = functionsV1.region('europe-west1')
const { HttpsError } = functionsV1.https
const admin = require('firebase-admin')
const { detachParticipant } = require('./session')

const ADMIN_EMAIL = 'admin@admin.com'
const db = admin.firestore()

/**
 * listRegisteredUsers
 *
 * Admin-only callable. Returns every account registered in Firebase Auth
 * (email/password) so the instructor can see who has signed up — including
 * users who have not joined any session yet. This is the only authoritative
 * source of "who registered": the client SDK cannot list Auth users, so we go
 * through the Admin SDK here.
 *
 * Which sessions each user has joined is cross-referenced on the client from
 * the participant documents the admin already reads (instructor-readable), so
 * no participation data is duplicated here.
 */
exports.listRegisteredUsers = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Must be logged in.')
  if (context.auth.token.email !== ADMIN_EMAIL) {
    throw new HttpsError('permission-denied', 'Only the instructor can list users.')
  }

  const users = []
  let pageToken
  do {
    const res = await admin.auth().listUsers(1000, pageToken)
    res.users.forEach(u => {
      users.push({
        uid: u.uid,
        email: u.email || '',
        displayName: u.displayName || '',
        createdAt: u.metadata?.creationTime || null,    // ISO string
        lastSignInAt: u.metadata?.lastSignInTime || null, // ISO string
      })
    })
    pageToken = res.pageToken
  } while (pageToken)

  return { users }
})

/**
 * deleteAllRegisteredUsers
 *
 * Admin-only callable. Permanently deletes every registered Firebase Auth
 * account except the admin (and the caller). Only the Admin SDK can delete Auth
 * users, so this must run server-side. Per-session participant documents are
 * left untouched; delete the sessions to clear those.
 */
exports.deleteAllRegisteredUsers = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Must be logged in.')
  if (context.auth.token.email !== ADMIN_EMAIL) {
    throw new HttpsError('permission-denied', 'Only the instructor can delete users.')
  }

  const uids = []
  let pageToken
  do {
    const res = await admin.auth().listUsers(1000, pageToken)
    res.users.forEach(u => {
      if (u.email !== ADMIN_EMAIL && u.uid !== context.auth.uid) uids.push(u.uid)
    })
    pageToken = res.pageToken
  } while (pageToken)

  let deleted = 0
  // deleteUsers accepts up to 1000 uids per call.
  for (let i = 0; i < uids.length; i += 1000) {
    const res = await admin.auth().deleteUsers(uids.slice(i, i + 1000))
    deleted += res.successCount
  }

  return { deleted, attempted: uids.length }
})

/**
 * deleteRegisteredUser
 *
 * Admin-only callable. Permanently removes ONE registered Firebase Auth account.
 * Before deleting the account it detaches that user from every session where
 * they are an active participant, so each affected group simply continues with
 * one fewer member (n-1) under the same session parameters — exactly the
 * per-session "Remove" behaviour, applied across all of the user's sessions at
 * once. Participants who already finished (survey/done) keep their records (and
 * therefore their exported data) untouched; only the Auth account is removed.
 *
 * Only the Admin SDK can delete an Auth user and reach across sessions, so this
 * must run server-side.
 */
exports.deleteRegisteredUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new HttpsError('unauthenticated', 'Must be logged in.')
  if (context.auth.token.email !== ADMIN_EMAIL) {
    throw new HttpsError('permission-denied', 'Only the instructor can delete users.')
  }
  const uid = data && data.uid
  if (!uid) throw new HttpsError('invalid-argument', 'uid required.')
  if (uid === context.auth.uid) {
    throw new HttpsError('failed-precondition', 'You cannot remove your own account.')
  }

  // Guard the admin account (it may not be the caller, e.g. a co-admin).
  try {
    const rec = await admin.auth().getUser(uid)
    if (rec.email === ADMIN_EMAIL) {
      throw new HttpsError('failed-precondition', 'The admin account cannot be removed.')
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e
    // auth/user-not-found → account already gone; still clean up participation.
  }

  // Detach from every session this user participates in. Participant doc ids
  // equal the uid, so detachParticipant(sessionRef, uid) targets the right doc;
  // sessions are few, so iterating avoids needing a collection-group index.
  const sessionsSnap = await db.collection('sessions').get()
  let detachedFrom = 0
  for (const sDoc of sessionsSnap.docs) {
    const res = await detachParticipant(sDoc.ref, uid, { activeOnly: true })
    if (res && !res.notFound && !res.alreadyRemoved && !res.skipped) detachedFrom++
  }

  // Delete the Auth account last (idempotent — a missing account is fine).
  let authDeleted = false
  try {
    await admin.auth().deleteUser(uid)
    authDeleted = true
  } catch (e) {
    if (e.code !== 'auth/user-not-found') {
      throw new HttpsError('internal', 'Could not delete the account: ' + (e.message || 'unknown error'))
    }
  }

  return { ok: true, authDeleted, detachedFrom }
})
