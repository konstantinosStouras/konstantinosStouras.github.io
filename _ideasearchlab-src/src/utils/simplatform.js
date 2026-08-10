// Simulation Platform integration (stouras.com/simulation).
//
// Students launched from the platform (and walk-ins alike) never see an
// account screen: RequireStudent (ProtectedRoute.jsx) calls
// provisionStudentAccount() to mint a SILENT, THROWAWAY login, and
// Registration auto-submits from the platform handoff (owner decision
// 2026-08: "each user plays once by entering a code").
//
// Why a throwaway email/password account and NOT Firebase anonymous auth:
// the deployed joinSession Cloud Function writes { name, email } from the
// auth token, and the Admin SDK rejects `undefined` values — an anonymous
// user (no email claim) would crash it server-side. Email/Password is the
// provider the app has always used, so a synthetic address + random password
// (never shown to anyone) keeps the deployed backend untouched. The
// student's REAL name rides as displayName and the real e-mail is recorded
// in the registration data.
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'

const HANDOFF_KEY = 'simp:handoff:v1'
const MAX_AGE_MS = 6 * 60 * 60 * 1000   // a handoff older than 6 h is stale

// The launch handoff written by stouras.com/simulation (same origin), or null.
export function platformHandoff() {
  try {
    const h = JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null')
    if (!h || h.sim !== 'ideasearchlab' || !h.profile) return null
    if (Date.now() - (h.ts || 0) > MAX_AGE_MS) return null
    return h
  } catch {
    return null
  }
}

function randomId(len) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('')
}

export async function provisionStudentAccount(auth) {
  const h = platformHandoff()
  const name = (h && h.profile.name) || 'Student'
  // Synthetic, never-mailed address; unique per play. Visible only in the
  // Firebase console's user list.
  const email = `student-${randomId(16)}@simplatform.stouras.com`
  const password = randomId(24)
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  await updateProfile(cred.user, { displayName: name })
  // Refresh the ID token so callables (joinSession) see the name claim.
  await cred.user.getIdToken(true)
  return cred.user
}

// Map the session's registration fields onto the platform profile: by the
// app's default field ids first, then by label text for admin-added fields.
const ID_MAP = {
  ucdStudentId: 'studentId',
  age: 'age',
  gender: 'gender',
  nationality: 'nationality',
  country: 'country',
  levelOfStudy: 'levelOfStudy',
  workExperience: 'workExperience',
  occupation: 'occupation',
  englishFluency: 'englishFluency',
}
const LABEL_MAP = [
  [/student\s*id|participant\s*id/i, 'studentId'],
  [/e-?mail/i, 'email'],
  [/full\s*name|^your\s+name/i, 'name'],
  [/^age\b/i, 'age'],
  [/^gender/i, 'gender'],
  [/nationality/i, 'nationality'],
  [/country/i, 'country'],
  [/level\s+of\s+study/i, 'levelOfStudy'],
  [/work\s+experience/i, 'workExperience'],
  [/occupation/i, 'occupation'],
  [/english/i, 'englishFluency'],
]

export function registrationAnswers(fields, profile) {
  const out = {}
  fields.forEach(f => {
    let key = ID_MAP[f.id]
    if (!key) {
      const hit = LABEL_MAP.find(([re]) => re.test(f.label || ''))
      key = hit && hit[1]
    }
    const v = key ? profile[key] : undefined
    if (v != null && String(v).trim() !== '') out[f.id] = String(v).trim()
  })
  return out
}
