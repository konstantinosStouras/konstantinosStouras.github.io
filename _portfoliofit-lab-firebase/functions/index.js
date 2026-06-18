/**
 * PortfolioFit for Managers — Cloud Functions (LAB build, Firebase Functions v1, europe-west1).
 *
 * Lab build = ANONYMOUS participant sign-in gated by an admin-issued Session ID.
 *
 * Two participant-facing callables:
 *   registerParticipant  validates the Session ID, atomically creates the
 *                         participant doc, assigns a sequential anonymous label
 *                         (p1, p2, ...) via a counter transaction, stores the
 *                         registration answers, and bumps the session's count.
 *   submitSurvey          stores survey answers once (idempotent) and marks the
 *                         participant as done.
 *
 * All other reads/writes (events, rounds, config, puzzle library, sessions)
 * happen client-side, guarded by firestore.rules. Admin is the signed-in
 * admin@admin.com account.
 */

const functions = require('firebase-functions').region('europe-west1');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

function requireAuth(context) {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be signed in.');
  }
  return context.auth;
}

/**
 * registerParticipant({ sessionId, participantId, answers })
 * Returns { ok, anonymousLabel, resumed }.
 */
exports.registerParticipant = functions.https.onCall(async (data, context) => {
  const auth = requireAuth(context);
  const uid = auth.uid;
  const email = (auth.token && auth.token.email) || '';   // empty for anonymous users

  const participantId = (data && data.participantId ? String(data.participantId) : '').trim();
  const sessionId = (data && data.sessionId ? String(data.sessionId) : '').trim();
  const answers = (data && data.answers && typeof data.answers === 'object') ? data.answers : {};
  if (!participantId) {
    throw new functions.https.HttpsError('invalid-argument', 'A Participant ID is required.');
  }
  if (!sessionId) {
    throw new functions.https.HttpsError('invalid-argument', 'A Session ID is required.');
  }

  // The session must exist and be open.
  const sRef = db.collection('sessions').doc(sessionId);
  const sSnap = await sRef.get();
  if (!sSnap.exists || sSnap.data().active === false) {
    throw new functions.https.HttpsError('failed-precondition', 'That Session ID is not valid or has been closed.');
  }

  const pRef = db.collection('participants').doc(uid);
  const existing = await pRef.get();

  if (existing.exists) {
    // Resume: refresh registration answers but never re-roll the label or status.
    await pRef.set({
      participantId,
      sessionId,
      email,
      registration: answers,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, anonymousLabel: existing.data().anonymousLabel || null, resumed: true };
  }

  // First registration — assign the next sequential anonymous label atomically.
  const n = await db.runTransaction(async (tx) => {
    const cRef = db.doc('counters/participants');
    const cSnap = await tx.get(cRef);
    const next = (cSnap.exists ? (cSnap.data().count || 0) : 0) + 1;
    tx.set(cRef, { count: next }, { merge: true });
    return next;
  });
  const anonymousLabel = 'p' + n;

  await pRef.set({
    uid,
    participantId,
    sessionId,
    email,
    anonymousLabel,
    registration: answers,
    status: 'registered',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Best-effort: bump the session's participant count for the admin view.
  try { await sRef.set({ participantCount: FieldValue.increment(1) }, { merge: true }); } catch (e) { /* non-fatal */ }

  return { ok: true, anonymousLabel, resumed: false };
});

/**
 * submitSurvey({ answers })
 * Idempotent: if a survey was already submitted, returns without overwriting.
 * Returns { ok, alreadySubmitted }.
 */
exports.submitSurvey = functions.https.onCall(async (data, context) => {
  const auth = requireAuth(context);
  const uid = auth.uid;
  const answers = (data && data.answers && typeof data.answers === 'object') ? data.answers : {};

  const pRef = db.collection('participants').doc(uid);
  const sRef = pRef.collection('survey').doc('answers');

  const snap = await sRef.get();
  if (snap.exists && snap.data().completedAt) {
    return { ok: true, alreadySubmitted: true };
  }

  await sRef.set({ answers, completedAt: FieldValue.serverTimestamp() }, { merge: true });
  await pRef.set({ status: 'done', updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  return { ok: true, alreadySubmitted: false };
});
