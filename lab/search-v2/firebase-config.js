/* ==========================================================================
   search-v2  ·  firebase-config.js
   Firebase project config for central data collection + the admin panel
   (/lab/search-v2/admin/). This file being filled in is what turns Firebase ON;
   with the PASTE_… placeholders it stays OFF (fully client-side, admin shows
   local data only). See README.md → "Admin panel & Firebase setup".

   Project: search-with-ai-456d7
   NOTE: this apiKey is a public client identifier, not a secret — access is
   controlled by firestore.rules (admin reads gated to ADMIN_EMAILS). Google
   Analytics is intentionally NOT loaded on the participant page.
   ========================================================================== */
window.FIREBASE_CONFIG = {
  apiKey:            'AIzaSyB5uF8XwqI8fyTuIBwQ_OPkg-VqU98H0uc',
  authDomain:        'search-with-ai-456d7.firebaseapp.com',
  projectId:         'search-with-ai-456d7',
  storageBucket:     'search-with-ai-456d7.firebasestorage.app',
  messagingSenderId: '9761548035',
  appId:             '1:9761548035:web:13d1cda30bbe35aeec2b36',
  measurementId:     'G-28GL8PRTNV'
};

// Email addresses allowed into the admin panel. Each MUST be a Firebase Auth
// Email/Password user (Authentication → Users → Add user) AND appear in the
// isAdmin() allow-list in firestore.rules. Change this to whichever address you
// will sign in with.
window.ADMIN_EMAILS = ['admin@admin.com'];

// Firestore collection/doc names (rarely need changing).
window.FIREBASE_PATHS = {
  events: 'events',       // one document per logged event
  configDoc: 'config/study' // admin-controlled study conditions & codes
};

// Version of the Firebase JS SDK to load from the CDN.
window.FIREBASE_SDK_VERSION = '10.12.2';
