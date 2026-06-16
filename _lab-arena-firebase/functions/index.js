/* =====================================================================
   Answer Arena - Cloud Functions (v2 callable, europe-west1)
   ---------------------------------------------------------------------
   The only thing that genuinely needs the server is handing out a
   sequential, anonymous label (p1, p2, p3, ...) atomically, so two
   participants registering at the same time never collide. Everything
   else (config, task sets, sessions, responses, survey) is done directly
   from the client under the Firestore security rules.

   If you do not deploy this function, the app still works - participants
   simply get a null anonymousLabel (the client handles that gracefully).
   ===================================================================== */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();
const REGION = 'europe-west1';

// Returns the next anonymous label as { label: 'p<n>' }, allocated atomically.
exports.nextLabel = onCall({ region: REGION }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const counterRef = db.doc('counters/participants');
  const n = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists ? (snap.data().count || 0) : 0;
    const next = current + 1;
    tx.set(counterRef, { count: next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return next;
  });
  return { label: 'p' + n };
});
