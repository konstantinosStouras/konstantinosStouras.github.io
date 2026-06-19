const functionsV1 = require('firebase-functions/v1')
const functions = functionsV1.region('europe-west1')
const { HttpsError } = functionsV1.https
const admin = require('firebase-admin')

const ADMIN_EMAIL = 'admin@admin.com'

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
