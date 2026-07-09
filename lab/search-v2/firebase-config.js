/* ==========================================================================
   search-v2  ·  firebase-config.js
   PASTE YOUR FIREBASE PROJECT CONFIG HERE to enable central data collection
   and the admin panel (/lab/search-v2/admin/). Until you do, the experiment
   runs exactly as before — fully client-side, no network, no Firebase loaded —
   and the admin panel falls back to showing the current browser's local data.

   How to fill this in: see README.md → "Admin panel & Firebase setup".
   In short: Firebase console → create project → add a Web app → copy its
   firebaseConfig object over FIREBASE_CONFIG below; enable Anonymous auth and
   Email/Password auth; create your admin user; and add your admin email(s) to
   ADMIN_EMAILS. Then deploy firestore.rules.
   ========================================================================== */
window.FIREBASE_CONFIG = {
  apiKey:            'PASTE_API_KEY',
  authDomain:        'PASTE_PROJECT.firebaseapp.com',
  projectId:         'PASTE_PROJECT',
  storageBucket:     'PASTE_PROJECT.appspot.com',
  messagingSenderId: 'PASTE_SENDER_ID',
  appId:             'PASTE_APP_ID'
};

// Email addresses allowed into the admin panel (must match Firebase Auth users
// AND the isAdmin() allow-list in firestore.rules).
window.ADMIN_EMAILS = ['admin@stouras.com'];

// Firestore collection/doc names (rarely need changing).
window.FIREBASE_PATHS = {
  events: 'events',       // one document per logged event
  configDoc: 'config/study' // admin-controlled study conditions & codes
};

// Version of the Firebase JS SDK to load from the CDN (only loaded when the
// config above is real; the base experiment never loads it otherwise).
window.FIREBASE_SDK_VERSION = '10.12.2';
