/* ==========================================================================
   Sustainable Supply Chains — firebase-config.js
   Firebase project config for running REAL class sessions (many devices).
   CONFIGURED for the live class project 'sustainable-supplychains'.
   (Restoring PASTE_… placeholders would switch the app back to the
   localStorage DEMO MODE.) See README.md → "Firebase setup".

   NOTE: a Firebase apiKey is a public client identifier, not a secret —
   access is controlled by firestore.rules.
   ========================================================================== */
window.SSC_FIREBASE_CONFIG = {
  apiKey:            'AIzaSyD_Gbv6PkUuixxb4i28jPv_0ACjkmWplZs',
  authDomain:        'sustainable-supplychains.firebaseapp.com',
  projectId:         'sustainable-supplychains',
  storageBucket:     'sustainable-supplychains.firebasestorage.app',
  messagingSenderId: '465004185871',
  appId:             '1:465004185871:web:560fa651958511513d567a'
};

// Email addresses allowed into the admin panel. Each MUST be a Firebase Auth
// Email/Password user (Authentication → Users → Add user) AND appear in the
// isAdmin() allow-list in firestore.rules (keep the two lists identical).
window.SSC_ADMIN_EMAILS = ['admin@admin.com'];

// Firestore root collections (rarely need changing): game sessions, and the
// code → sessionId lookup docs students use to join without listing sessions.
window.SSC_PATHS = { sessions: 'sscSessions', codes: 'sscSessionCodes' };

// Version of the Firebase JS SDK to load from the CDN (only when configured).
window.SSC_FIREBASE_SDK_VERSION = '10.12.2';
