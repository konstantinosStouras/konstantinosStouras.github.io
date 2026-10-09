export function accountStorageKey(uid) { return uid ? `wardrobe.account.${uid}` : 'wardrobe.v1'; }
export function passwordProblem(password, confirmation) {
  if (password.length < 10 || password.length > 128) return 'Use a password between 10 and 128 characters.';
  if (password !== confirmation) return 'The passwords do not match.';
  return '';
}
export function authMessage(error) {
  return ({
    'auth/invalid-credential':'The email or password is incorrect. Please try again.',
    'auth/user-not-found':'The email or password is incorrect. Please try again.',
    'auth/wrong-password':'The email or password is incorrect. Please try again.',
    'auth/email-already-in-use':'Unable to create this account. Try signing in or resetting your password.',
    'auth/invalid-email':'Enter a valid email address.',
    'auth/weak-password':'Use a stronger password of at least 10 characters.',
    'auth/password-does-not-meet-requirements':'Use a password between 10 and 128 characters.',
    'auth/too-many-requests':'Too many attempts. Please wait a little before trying again.',
    'auth/network-request-failed':'Could not connect. Check your internet connection and try again.',
    'auth/popup-closed-by-user':'Sign-in was cancelled. You can try again whenever you are ready.',
    'auth/cancelled-popup-request':'Another sign-in window is already open.',
    'auth/popup-blocked':'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.',
    'auth/account-exists-with-different-credential':'This email uses another sign-in method. Sign in using that method first.',
    'auth/unauthorized-domain':'Sign-in is not available on this address. Open the published website.',
    'auth/operation-not-allowed':'This sign-in method is not available yet.',
    'auth/requires-recent-login':'For your security, sign out and sign in again before deleting your account.',
  })[error?.code] || 'Something went wrong. Please try again.';
}
