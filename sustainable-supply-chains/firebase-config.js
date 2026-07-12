/* ==========================================================================
   Sustainable Supply Chains — firebase-config.js
   Firebase project config for running REAL class sessions (many devices).
   Filling this in is what turns Firebase ON; with the PASTE_… placeholders
   the app runs in DEMO MODE: everything works, but data lives only in this
   browser's localStorage (open the student page and the admin panel in the
   same browser to try the whole game). See README.md → "Firebase setup".

   NOTE: a Firebase apiKey is a public client identifier, not a secret —
   access is controlled by firestore.rules.
   ========================================================================== */
window.SSC_FIREBASE_CONFIG = {
  apiKey:            'PASTE_API_KEY',
  authDomain:        'PASTE_PROJECT.firebaseapp.com',
  projectId:         'PASTE_PROJECT_ID',
  storageBucket:     'PASTE_PROJECT.appspot.com',
  messagingSenderId: 'PASTE_SENDER_ID',
  appId:             'PASTE_APP_ID'
};

// Email addresses allowed into the admin panel. Each MUST be a Firebase Auth
// Email/Password user (Authentication → Users → Add user) AND appear in the
// isAdmin() allow-list in firestore.rules.
window.SSC_ADMIN_EMAILS = ['admin@admin.com'];

// Firestore root collection for game sessions (rarely needs changing).
window.SSC_PATHS = { sessions: 'sscSessions' };

// Version of the Firebase JS SDK to load from the CDN (only when configured).
window.SSC_FIREBASE_SDK_VERSION = '10.12.2';
