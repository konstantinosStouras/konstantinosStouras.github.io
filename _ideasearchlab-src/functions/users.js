const functionsV1 = require('firebase-functions/v1')
const functions = functionsV1.region('europe-west1')
const { HttpsError } = functionsV1.https
const admin = require('firebase-admin')
const { detachParticipant } = require('./session')
const { realIdentity, isPlaceholderName } = require('./identity')

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
 *
 * It ALSO joins each account to the student's REAL identity (owner
 * 2026-08-16: the student flow mints a throwaway login — "Student" + a
 * synthetic address — while the real name/e-mail/student ID live on the
 * participant docs, in the platform block or the registration answers). The
 * join runs HERE because the Admin SDK sees EVERY participant document,
 * including those ORPHANED by a deleted session (deleting a session doc does
 * not delete its subcollections, and the client rules can no longer authorise
 * reading them once the session doc is gone) — exactly where the panel's
 * client-side join is blind. The resolver is functions/identity.js, a CJS
 * port of src/utils/participantIdentity.js (parity-checked by
 * tools/identity-guard.mjs). While listing, it REPAIRS a placeholder Auth
 * displayName ("Student"/empty) to the real name — or "Student ID NNNNNNNN"
 * when the registration collected only the ID — fill-empty and idempotent,
 * so the Firebase console and every future listing read properly too. Auth
 * E-MAILS are deliberately never touched: they are the account's login key
 * and must stay unique; the real e-mail travels in `identity` instead.
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

  // uid -> { name, email, studentId }, merged across every participant doc the
  // account ever wrote (a student may appear in several sessions): per field,
  // a platform-handoff value always wins; otherwise first non-empty. Wholly
  // best-effort — a failure here must never take the account list down.
  const identityByUid = {}
  try {
    const [sessionsSnap, partsSnap] = await Promise.all([
      db.collection('sessions').get(),
      db.collectionGroup('participants').get(),
    ])
    const sessionById = {}
    sessionsSnap.forEach(d => { sessionById[d.id] = d.data() })
    partsSnap.forEach(d => {
      const p = d.data() || {}
      const uid = p.uid || d.id
      const sessRef = d.ref.parent.parent
      const session = (sessRef && sessionById[sessRef.id]) || null   // null = deleted → default form
      const r = realIdentity(p, session)
      if (!r.name && !r.email && !r.studentId) return
      const plat = p.platform || {}
      const cur = identityByUid[uid] ||
        (identityByUid[uid] = { name: '', email: '', studentId: '', _pn: false, _pe: false, _ps: false })
      const set = (field, value, fromPlatform, flag) => {
        if (!value) return
        if (fromPlatform && !cur[flag]) { cur[field] = value; cur[flag] = true }
        else if (!cur[field]) cur[field] = value
      }
      set('name', r.name, !!String(plat.name || '').trim(), '_pn')
      set('email', r.email, !!String(plat.email || '').trim(), '_pe')
      set('studentId', r.studentId, !!String(plat.studentId || '').trim(), '_ps')
    })
  } catch (e) {
    console.warn('identity join skipped:', e.message)
  }

  let healedNames = 0
  for (const u of users) {
    const idn = identityByUid[u.uid]
    if (idn) u.identity = { name: idn.name, email: idn.email, studentId: idn.studentId }
    if (!idn || u.email === ADMIN_EMAIL || !isPlaceholderName(u.displayName)) continue
    const label = idn.name || (idn.studentId ? `Student ID ${idn.studentId}` : '')
    if (!label) continue
    try {
      await admin.auth().updateUser(u.uid, { displayName: label })
      u.displayName = label
      healedNames++
    } catch (e) {
      // best-effort — the list itself is the deliverable
    }
  }

  return { users, healedNames }
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
