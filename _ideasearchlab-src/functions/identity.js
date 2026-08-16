/**
 * identity.js — server-side (CommonJS) port of the participant-identity
 * resolver in src/utils/participantIdentity.js. KEEP THE TWO IN SYNC — the
 * rules are parity-checked by tools/identity-guard.mjs, which requires this
 * copy beside the browser module and compares their answers on shared
 * fixtures.
 *
 * Why a port exists at all: listRegisteredUsers (users.js) joins every Auth
 * account to its registration records with the ADMIN SDK, which sees every
 * participant document — including those ORPHANED by a deleted session
 * (deleting a session doc does not delete its subcollections, and the client
 * rules can no longer authorise reading them once the session doc is gone),
 * exactly where the admin panel's client-side join is blind.
 */
'use strict'

const SYNTHETIC_EMAIL_RE = /@simplatform\.stouras\.com$/i

function isSyntheticEmail(email) {
  return SYNTHETIC_EMAIL_RE.test(String(email || ''))
}

/** The throwaway login's displayName when no handoff carried a real name. */
function isPlaceholderName(name) {
  const n = String(name || '').trim()
  return !n || n.toLowerCase() === 'student'
}

// The default registration form's student-ID field (src/data/formDefaults.js).
const DEFAULT_STUDENT_ID_FIELD = 'ucdStudentId'

// Which registration fields carry identity, by label — same discipline as the
// browser module and simplatform.js's LABEL_MAP.
const RE_STUDENT_ID = /student\s*id|participant\s*id/i
const RE_EMAIL = /e-?mail/i
const RE_FIRST_NAME = /first\s*name|given\s*name/i
const RE_LAST_NAME = /last\s*name|family\s*name|surname/i
// A bare "Name" label counts only when it IS the whole question — `^name\b`
// would also swallow an instructor prompt like "Name of your company".
const RE_NAME = /full\s*name|^your\s+name|^name\s*$/i

function identityFields(session) {
  const rc = session && session.registrationConfig
  const fields = rc && Array.isArray(rc.fields) && rc.fields.length
    ? rc.fields
    : [{ id: DEFAULT_STUDENT_ID_FIELD, label: 'UCD Student ID' }]
  const out = { studentId: [], name: [], firstName: [], lastName: [], email: [] }
  fields.forEach(f => {
    if (!f || !f.id) return
    const label = String(f.label || '')
    if (f.id === DEFAULT_STUDENT_ID_FIELD || RE_STUDENT_ID.test(label)) { out.studentId.push(f.id); return }
    if (RE_EMAIL.test(label) || /email/i.test(f.id)) { out.email.push(f.id); return }
    if (RE_FIRST_NAME.test(label)) { out.firstName.push(f.id); return }
    if (RE_LAST_NAME.test(label)) { out.lastName.push(f.id); return }
    if (RE_NAME.test(label)) { out.name.push(f.id); return }
  })
  return out
}

function registrationIdentity(participant, session) {
  const demo = (participant && participant.demographics) || {}
  const f = identityFields(session)
  const first = ids => {
    for (const id of ids) {
      const v = String(demo[id] != null ? demo[id] : '').trim()
      if (v) return v
    }
    return ''
  }
  let name = first(f.name)
  if (!name) name = [first(f.firstName), first(f.lastName)].filter(Boolean).join(' ')
  return { name, email: first(f.email), studentId: first(f.studentId) }
}

function realIdentity(participant, session) {
  const p = participant || {}
  const plat = p.platform || {}
  const reg = registrationIdentity(p, session)
  const ownName = isPlaceholderName(p.name) ? '' : String(p.name || '').trim()
  const ownEmail = isSyntheticEmail(p.email) ? '' : String(p.email || '').trim()
  return {
    name: String(plat.name || '').trim() || reg.name || ownName,
    email: String(plat.email || '').trim() || reg.email || ownEmail,
    studentId: String(plat.studentId || '').trim() || reg.studentId,
  }
}

module.exports = {
  isSyntheticEmail,
  isPlaceholderName,
  identityFields,
  registrationIdentity,
  realIdentity,
}
