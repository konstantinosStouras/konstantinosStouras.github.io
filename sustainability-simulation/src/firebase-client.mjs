import { firebaseConfig } from '../firebase-config.mjs?v=5366cc14c565';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js';
import { getAuth, setPersistence, browserSessionPersistence, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, sendEmailVerification, sendPasswordResetEmail, signOut } from 'https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
await setPersistence(auth, browserSessionPersistence);
await auth.authStateReady();
export const firebase = {
  get user() { return auth.currentUser; },
  async google() { const p = new GoogleAuthProvider(); p.setCustomParameters({ prompt: 'select_account' }); return (await signInWithPopup(auth, p)).user; },
  async login(email, password) { return (await signInWithEmailAndPassword(auth, email, password)).user; },
  async register(name, email, password) { const result = await createUserWithEmailAndPassword(auth, email, password); await updateProfile(result.user, { displayName: name }); await sendEmailVerification(result.user); return result.user; },
  async reset(email) { await sendPasswordResetEmail(auth, email); },
  async verify() { await sendEmailVerification(auth.currentUser); },
  async refresh() { await auth.currentUser?.reload(); return auth.currentUser?.getIdToken(true); },
  async token() { return auth.currentUser?.getIdToken(); },
  async logout() { await signOut(auth); }
};
