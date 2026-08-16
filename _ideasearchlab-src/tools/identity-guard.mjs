/**
 * identity-guard.mjs — offline test (no network, no deps).
 *
 *   node _ideasearchlab-src/tools/identity-guard.mjs
 *
 * Guards src/utils/participantIdentity.js — the ONE resolver of who a
 * participant really is. The student flow mints a throwaway login ("Student" +
 * student-…@simplatform.stouras.com), so a student who joined from a DIRECT
 * link (no Simulation Platform handoff) is anonymous on the participant doc
 * while their real name/e-mail/student ID sit under `demographics`. The
 * resolver reads them back via the session's own registrationConfig, and
 * `identityRepairFor` computes the fill-empty heal the admin pages write.
 *
 * The rules that must never regress:
 *   · a platform handoff's record always beats a registration answer;
 *   · a real value is NEVER overwritten — only placeholders are filled;
 *   · the repair is idempotent (a healed doc computes null);
 *   · a handoff-written platform block keeps its 'simulation-platform' source.
 */
import {
  isSyntheticEmail, isPlaceholderName, identityFields,
  registrationIdentity, realIdentity, displayName, displayEmail,
  identityRepairFor,
} from '../src/utils/participantIdentity.js'

let failures = 0
function check(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); return }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

/* Apply an updateDoc payload (incl. dotted paths) onto a plain object, the way
   Firestore would — so idempotence can be asserted end to end. */
function applyUpdates(docData, updates) {
  const out = JSON.parse(JSON.stringify(docData))
  Object.entries(updates).forEach(([path, v]) => {
    const parts = path.split('.')
    let node = out
    parts.slice(0, -1).forEach(k => { if (typeof node[k] !== 'object' || node[k] == null) node[k] = {}; node = node[k] })
    node[parts[parts.length - 1]] = v
  })
  return out
}

// ── Placeholder detection ──────────────────────────────────────────────────
console.log('placeholder / synthetic detection')
check('throwaway address is synthetic', isSyntheticEmail('student-abc123@simplatform.stouras.com'))
check('real address is not', !isSyntheticEmail('qi.yuhao@ucdconnect.ie'))
check('"Student" is a placeholder name', isPlaceholderName('Student') && isPlaceholderName(' student '))
check('a real name is not', !isPlaceholderName('Qi YuHao'))
check('empty name is a placeholder', isPlaceholderName('') && isPlaceholderName(null))

// ── Field classification ───────────────────────────────────────────────────
console.log('identityFields — which registration fields carry identity')
{
  // No custom registrationConfig → the DEFAULT form runs, whose one identity
  // field is ucdStudentId.
  const f = identityFields(null)
  check('default form: studentId = ucdStudentId', f.studentId.length === 1 && f.studentId[0] === 'ucdStudentId')
  check('default form: no name/email fields', f.name.length === 0 && f.email.length === 0)
}
{
  const session = { registrationConfig: { fields: [
    { id: 'ucdStudentId', label: 'UCD Student ID' },
    { id: 'f_ab12', label: 'Full Name' },
    { id: 'f_cd34', label: 'Email address' },
    { id: 'f_ef56', label: 'First name' },
    { id: 'f_gh78', label: 'Last name' },
    { id: 'f_ij90', label: 'University Student ID' },
    { id: 'nationality', label: 'Nationality' },       // must NOT read as a name
    { id: 'levelOfStudy', label: 'Level of Study' },
  ] } }
  const f = identityFields(session)
  check('both student-ID fields found (default id + label match)',
    f.studentId.includes('ucdStudentId') && f.studentId.includes('f_ij90'))
  check('full-name field found', f.name.length === 1 && f.name[0] === 'f_ab12')
  check('email field found', f.email.length === 1 && f.email[0] === 'f_cd34')
  check('first/last name fields found', f.firstName[0] === 'f_ef56' && f.lastName[0] === 'f_gh78')
  check('Nationality / Level of Study are not identity fields',
    !Object.values(f).flat().includes('nationality') && !Object.values(f).flat().includes('levelOfStudy'))
}
{
  // A bare "Name" label is the student's name; a label merely STARTING with
  // "Name" is an instructor question whose answer must never become — or be
  // healed into — the student's identity ("Name of your company", the
  // brick-uses prompt). Review finding 2026-08-16.
  const f = identityFields({ registrationConfig: { fields: [
    { id: 'f_a1', label: 'Name' },
    { id: 'f_b2', label: 'Name of your company' },
    { id: 'f_c3', label: 'Name three creative uses for a brick' },
  ] } })
  check('bare "Name" label is a name field', f.name.length === 1 && f.name[0] === 'f_a1')
  check('"Name of your company"-style prompts are NOT identity fields',
    !Object.values(f).flat().includes('f_b2') && !Object.values(f).flat().includes('f_c3'))
}

// ── Resolution ─────────────────────────────────────────────────────────────
console.log('registrationIdentity / realIdentity — reading the answers back')
const SESSION = { registrationConfig: { fields: [
  { id: 'ucdStudentId', label: 'UCD Student ID' },
  { id: 'f_nm', label: 'Full Name' },
  { id: 'f_em', label: 'Email' },
  { id: 'f_fn', label: 'First name' },
  { id: 'f_ln', label: 'Last name' },
] } }
{
  const p = {
    name: 'Student', email: 'student-x9@simplatform.stouras.com',
    demographics: { ucdStudentId: '25258366', f_nm: 'Qi YuHao', f_em: 'qi@ucdconnect.ie' },
  }
  const r = realIdentity(p, SESSION)
  check('standalone play: identity comes from the registration answers',
    r.name === 'Qi YuHao' && r.email === 'qi@ucdconnect.ie' && r.studentId === '25258366')
  check('displayName prefers the real name over "Student"', displayName(p, SESSION) === 'Qi YuHao')
  check('displayEmail prefers the real address over the throwaway', displayEmail(p, SESSION) === 'qi@ucdconnect.ie')
}
{
  const p = { demographics: { f_fn: 'Pua', f_ln: 'Suan Ting' } }
  check('first + last combine when there is no full-name field answer',
    registrationIdentity(p, SESSION).name === 'Pua Suan Ting')
}
{
  const p = {
    name: 'Zhou Yan', email: 'student-a1@simplatform.stouras.com',
    platform: { name: 'Zhou Yan', email: 'zhou@ucd.ie', studentId: '25232453', source: 'simulation-platform' },
    demographics: { ucdStudentId: 'TYPED-DIFFERENTLY' },
  }
  const r = realIdentity(p, SESSION)
  check('platform block beats the registration answers', r.studentId === '25232453' && r.email === 'zhou@ucd.ie')
}
{
  const p = { name: 'Jane Doe', email: 'jane@ucd.ie', demographics: {} }
  const r = realIdentity(p, SESSION)
  check('a real token name/e-mail counts when nothing else is known',
    r.name === 'Jane Doe' && r.email === 'jane@ucd.ie')
}
{
  const p = { name: 'Student', email: 'student-b2@simplatform.stouras.com', demographics: {} }
  check('with nothing real anywhere, displayEmail falls back to the login address',
    displayEmail(p, SESSION) === 'student-b2@simplatform.stouras.com' && displayName(p, SESSION) === 'Student')
}

// ── The heal payload ───────────────────────────────────────────────────────
console.log('identityRepairFor — fill-empty, never overwrite, idempotent')
{
  const p = {
    name: 'Student', email: 'student-x9@simplatform.stouras.com',
    demographics: { ucdStudentId: '25258366', f_nm: 'Qi YuHao', f_em: 'qi@ucdconnect.ie' },
  }
  const u = identityRepairFor(p, SESSION)
  check('standalone doc: name/email filled from the answers',
    u && u.name === 'Qi YuHao' && u.email === 'qi@ucdconnect.ie')
  check('standalone doc: platform block filled (the verify join key)',
    u && u['platform.studentId'] === '25258366' && u['platform.name'] === 'Qi YuHao' &&
    u['platform.email'] === 'qi@ucdconnect.ie' && u['platform.source'] === 'in-app-registration')
  const healed = applyUpdates(p, u)
  check('idempotent: a healed doc computes no repair', identityRepairFor(healed, SESSION) === null)
}
{
  const p = {
    name: 'Zhou Yan', email: 'student-a1@simplatform.stouras.com',
    platform: { name: 'Zhou Yan', email: 'zhou@ucd.ie', studentId: '25232453', source: 'simulation-platform' },
    demographics: { ucdStudentId: '25232453' },
  }
  const u = identityRepairFor(p, SESSION)
  check('platform-launched doc: only the synthetic doc e-mail is filled, platform untouched',
    u && u.email === 'zhou@ucd.ie' && !u['platform.studentId'] && !u['platform.name'] &&
    !u['platform.email'] && !u['platform.source'])
}
{
  const p = {
    name: 'Jane Doe', email: 'jane@ucd.ie',
    demographics: { ucdStudentId: '11112222', f_nm: 'SOMEONE ELSE', f_em: 'other@x.com' },
  }
  const u = identityRepairFor(p, SESSION)
  check('a real doc name/e-mail is NEVER overwritten', u && !u.name && !u.email)
  check('…but the missing platform.studentId is still filled', u['platform.studentId'] === '11112222')
}
{
  const p = {
    name: 'Student', email: 'student-c3@simplatform.stouras.com',
    platform: { name: 'Wen Anqi', email: '', studentId: '25250153', source: 'simulation-platform' },
    demographics: { f_em: 'wen@ucdconnect.ie' },
  }
  const u = identityRepairFor(p, SESSION)
  check('a handoff block being COMPLETED keeps its simulation-platform source',
    u && u['platform.email'] === 'wen@ucdconnect.ie' && u['platform.source'] === undefined)
}
{
  const p = {
    name: 'Student', email: 'student-d4@simplatform.stouras.com',
    demographics: { f_em: 'not-an-email' },
  }
  const u = identityRepairFor(p, SESSION)
  check('a junk "email" answer is never written onto the doc', u === null)
}
{
  const p = { name: 'Student', email: 'student-e5@simplatform.stouras.com', demographics: {} }
  check('nothing to add → null (no pointless write)', identityRepairFor(p, SESSION) === null)
}

console.log('')
if (failures) { console.log(`GUARD FAILED — ${failures} check(s)`); process.exit(1) }
console.log('GUARD OK — participantIdentity resolution and heal rules hold')
