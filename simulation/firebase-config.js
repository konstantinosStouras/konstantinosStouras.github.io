/* Simulation Platform — optional Firebase backing.
   Same convention as sustainable-supply-chains/firebase-config.js: while the
   PASTE_ placeholders are in place the platform runs in LOCAL mode —
   activation edits live only in the admin's browser (publish by committing the
   downloaded config.json), student profiles stay in each student's browser,
   and there is no central roster.
   To go live: create a (free, Spark-plan) Firebase project, enable Anonymous
   Authentication + Email/Password Authentication + Firestore, deploy
   simulation/firestore.rules, create the admin user, and paste the web-app
   config below. Full steps in simulation/README.md. */
window.SIMP_FIREBASE_CONFIG = {
  apiKey: 'PASTE_API_KEY',
  authDomain: 'PASTE_PROJECT_ID.firebaseapp.com',
  projectId: 'PASTE_PROJECT_ID',
  appId: 'PASTE_APP_ID'
};

/* Admin sign-in e-mails (client-side gate; the real gate is firestore.rules —
   keep its isAdmin() list in sync with this one). */
window.SIMP_ADMIN_EMAILS = ['admin@admin.com'];

/* Firestore paths. */
window.SIMP_PATHS = {
  config: 'simPlatform/config',        // one doc: { sims: { key: {active, sessionId, note} }, updated }
  students: 'simPlatformStudents'      // one doc per student, keyed by anonymous-auth uid
};
