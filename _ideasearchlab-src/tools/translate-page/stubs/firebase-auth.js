// firebase/auth stand-in. signOut is recorded so the harness can see it was
// never called by the Step 1b translation guard.
const log = (...a) => { (globalThis.__stubCalls ||= []).push(a) }
export function getAuth() { return { currentUser: { uid: 'harness-admin' } } }
export async function signOut() { log('auth.signOut') }
export function onAuthStateChanged(_a, cb) { cb && cb({ uid: 'harness-admin' }); return () => {} }
export async function createUserWithEmailAndPassword() { throw new Error('stub: no auth in the harness') }
export async function updateProfile() {}
