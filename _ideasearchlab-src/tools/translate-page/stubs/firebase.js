// Stand-in for src/firebase.js in the translate-page harness: no Firebase app is
// ever initialised, so nothing can reach the ideasearchlab project.
export const auth = { currentUser: { uid: 'harness-admin', email: 'admin@example.test' } }
export const db = { __stub: 'firestore' }
export const functions = { __stub: 'functions' }
