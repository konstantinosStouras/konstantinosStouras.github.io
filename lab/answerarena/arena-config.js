/* =====================================================================
   Answer Arena — Firebase web configuration (single source of truth)
   ---------------------------------------------------------------------
   This is the PUBLIC Firebase web config. It is safe to commit (Firebase
   web configs are not secrets; access is controlled by Security Rules and
   Auth, not by hiding these values).

   HOW TO WIRE THIS UP (after creating the Firebase project — see
   _lab-arena-firebase/README.md for the full step-by-step):
     1. Firebase console -> Project settings -> "Your apps" -> Web app.
     2. Copy the `firebaseConfig` object it shows you.
     3. Paste the values below, replacing every REPLACE_ME.
     4. Commit. The app switches from local test-mode to Firebase
        automatically once apiKey no longer starts with "REPLACE".

   Until this is filled in, the app and admin run in LOCAL TEST MODE
   (accounts, config, task sets, sessions and responses are kept in this
   browser's localStorage only) so the whole flow is clickable offline.
   ===================================================================== */
window.ARENA_FIREBASE = {
  apiKey: 'AIzaSyAbi8PVaGcGpMq_dt7KqYBWgz7iAGda_Mg',
  authDomain: 'stouras-answerarena.firebaseapp.com',
  projectId: 'stouras-answerarena',
  storageBucket: 'stouras-answerarena.firebasestorage.app',
  messagingSenderId: '575267196372',
  appId: '1:575267196372:web:fa6268734c61e045b65a41',
  measurementId: 'G-MGBVNVRD75'
};

// Firebase JS SDK version loaded from gstatic (kept in one place).
window.ARENA_FB_SDK = '10.12.2';

// The admin account. Only this signed-in e-mail can write config, task sets
// and sessions (enforced by Firestore rules in _lab-arena-firebase/).
window.ARENA_ADMIN_EMAIL = 'admin@admin.com';

// Cloud Functions region (matches _lab-arena-firebase/functions).
window.ARENA_FB_REGION = 'europe-west1';

// True once a real config has been pasted in above (i.e. we are not on the
// REPLACE_ME placeholder). Both arena-store.js backends read this flag.
window.ARENA_FB_READY = !!(window.ARENA_FIREBASE &&
  window.ARENA_FIREBASE.apiKey &&
  window.ARENA_FIREBASE.apiKey.indexOf('REPLACE') !== 0);
