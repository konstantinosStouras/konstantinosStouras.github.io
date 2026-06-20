/**
 * PortfolioFit for Managers — Cloud Functions (Firebase Functions v1, europe-west1).
 *
 * Two participant-facing callables:
 *   registerParticipant  atomically creates the participant doc, assigns a
 *                         sequential anonymous label (p1, p2, ...) via a counter
 *                         transaction, and stores the registration answers.
 *   submitSurvey          stores survey answers once (idempotent) and marks the
 *                         participant as done.
 *
 * All other reads/writes (events, rounds, config, puzzle library) happen
 * client-side, guarded by firestore.rules. Admin is the signed-in
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
 * registerParticipant({ participantId, answers })
 * Returns { ok, anonymousLabel, resumed }.
 */
exports.registerParticipant = functions.https.onCall(async (data, context) => {
  const auth = requireAuth(context);
  const uid = auth.uid;
  const email = (auth.token && auth.token.email) || '';

  const participantId = (data && data.participantId ? String(data.participantId) : '').trim();
  const answers = (data && data.answers && typeof data.answers === 'object') ? data.answers : {};
  if (!participantId) {
    throw new functions.https.HttpsError('invalid-argument', 'A Participant ID is required.');
  }

  const pRef = db.collection('participants').doc(uid);
  const existing = await pRef.get();

  if (existing.exists) {
    // Resume: refresh registration answers but never re-roll the label or status.
    await pRef.set({
      participantId,
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
    email,
    anonymousLabel,
    registration: answers,
    status: 'registered',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

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
