/**
 * participantIdentity.js — who a participant REALLY is.
 *
 * The student flow is account-free: RequireStudent mints a throwaway
 * email/password login (`student-…@simplatform.stouras.com`, displayName
 * "Student" unless a platform handoff carried the real name), and joinSession
 * copies that token identity onto the participant doc as `name`/`email`. So a
 * student who opened the app from a DIRECT link (no Simulation Platform
 * launch) shows up anonymously in the admin — even though they typed their
 * real name/e-mail/student ID into the session's own registration form, where
 * it sits under `demographics` keyed by the form's field ids.
 *
 * This module is the ONE place that resolves the real identity, from either
 * source: the `platform` block a platform launch writes, or the registration
 * answers of a direct-link play. It also computes the fill-empty repair
 * payload `healParticipantIdentities` (participantStatus.js) writes onto the
 * doc, so the export's Name/Email/Platform columns and the Simulation
 * Platform's "Verify from Ideation Challenge" (which joins on
 * platform.studentId — its adapter reads `demographics` too, keep the label
 * rules in sync with simulation/admin/verify.js) both see the same person.
 *
 * DELIBERATELY IMPORT-FREE (pure functions only) so the offline guard
 * (tools/identity-guard.mjs) can import it under plain Node — the writer that
 * needs Firestore lives in participantStatus.js beside the status heal.
 */

export const SYNTHETIC_EMAIL_RE = /@simplatform\.stouras\.com$/i

export function isSyntheticEmail(email) {
  return SYNTHETIC_EMAIL_RE.test(String(email || ''))
}

/** The throwaway login's displayName when no handoff carried a real name. */
export function isPlaceholderName(name) {
  const n = String(name || '').trim()
  return !n || n.toLowerCase() === 'student'
}

// The default registration form's student-ID field (formDefaults.js — kept as
// a literal so this module stays import-free; the id is part of the stored
// data's shape, not a tunable).
const DEFAULT_STUDENT_ID_FIELD = 'ucdStudentId'

// Which registration fields carry identity, by label — the same label
// discipline simplatform.js's LABEL_MAP uses to FILL such fields on a
// platform launch, so reading them back can't drift from writing them.
const RE_STUDENT_ID = /student\s*id|participant\s*id/i
const RE_EMAIL = /e-?mail/i
const RE_FIRST_NAME = /first\s*name|given\s*name/i
const RE_LAST_NAME = /last\s*name|family\s*name|surname/i
const RE_NAME = /full\s*name|^your\s+name|^name\b/i

/**
 * The identity-bearing field ids of a session's registration form,
 * `{ studentId: [ids], name: [], firstName: [], lastName: [], email: [] }`.
 * A session with no custom registrationConfig runs the DEFAULT form, whose
 * only identity field is `ucdStudentId`.
 */
export function identityFields(session) {
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

/** Identity as typed into the session's own registration form (may be ''s). */
export function registrationIdentity(participant, session) {
  const demo = (participant && participant.demographics) || {}
  const f = identityFields(session)
  const first = ids => {
    for (const id of ids) {
      const v = String(demo[id] ?? '').trim()
      if (v) return v
    }
    return ''
  }
  let name = first(f.name)
  if (!name) name = [first(f.firstName), first(f.lastName)].filter(Boolean).join(' ')
  return { name, email: first(f.email), studentId: first(f.studentId) }
}

/**
 * The participant's best-known real identity: the platform handoff's record
 * first (it is the roster's own), then the registration answers, then the
 * doc's own name/email — which count only when they are not the throwaway
 * account's placeholders.
 */
export function realIdentity(participant, session) {
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

/** Best display name — real identity, else whatever the doc holds. */
export function displayName(participant, session) {
  return realIdentity(participant, session).name || String((participant && participant.name) || '').trim()
}

/** Best display e-mail — real identity, else the (synthetic) login address. */
export function displayEmail(participant, session) {
  return realIdentity(participant, session).email || String((participant && participant.email) || '').trim()
}

const EMAILISH = /\S+@\S+\.\S+/

/**
 * The fill-empty repair for one participant doc, or null when there is
 * nothing to add. NEVER overwrites a real value: the doc's `name`/`email`
 * are only filled while they still hold the throwaway account's placeholders,
 * and the `platform` subfields (dotted paths, so an absent block is created
 * and a handoff-written one is only completed) only while empty — a platform
 * launch's record always wins over a registration answer. Pure and
 * idempotent: a healed doc resolves to null.
 */
export function identityRepairFor(participant, session) {
  const p = participant || {}
  const plat = p.platform || {}
  const reg = registrationIdentity(p, session)
  const regEmail = EMAILISH.test(reg.email) ? reg.email : ''
  // The doc's own name/email placeholders are filled from the BEST source
  // (platform block first, then the registration answers) — a platform
  // launch's doc also carries the synthetic login address, with the real one
  // sitting in its platform block.
  const real = realIdentity(p, session)
  const realEmailValue = EMAILISH.test(real.email) ? real.email : ''
  const updates = {}
  if (real.name && isPlaceholderName(p.name)) updates.name = real.name
  if (realEmailValue && (!p.email || isSyntheticEmail(p.email))) updates.email = realEmailValue
  if (reg.studentId && !String(plat.studentId || '').trim()) updates['platform.studentId'] = reg.studentId
  if (reg.name && !String(plat.name || '').trim()) updates['platform.name'] = reg.name
  if (regEmail && !String(plat.email || '').trim()) updates['platform.email'] = regEmail
  if (Object.keys(updates).length === 0) return null
  // Say where a filled platform block came from — but never relabel a
  // handoff-written one ('simulation-platform') that is merely being completed.
  if ((updates['platform.studentId'] || updates['platform.name'] || updates['platform.email']) && !plat.source) {
    updates['platform.source'] = 'in-app-registration'
  }
  return updates
}
