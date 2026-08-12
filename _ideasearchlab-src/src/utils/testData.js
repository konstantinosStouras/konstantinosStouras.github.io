/**
 * Random plausible answers for a TEST ROUND (the admin's 🧪 sandbox).
 *
 * A test round exists to rehearse the participant flow, not to retype
 * demographics every time — so in preview the registration form arrives
 * already filled in with random values and the consents ticked; the tester
 * just presses Submit (and can still edit anything first).
 *
 * Nothing here ever runs outside the preview sandbox (see utils/preview.js),
 * so no real participant record can be seeded with fake data.
 *
 * The Answer Arena sandbox does the same for its intake form
 * (`previewAnswers` in lab/answerarena/arena-app.js) — keep the two in sync.
 */

const FIRST = ['Alex', 'Sam', 'Robin', 'Jamie', 'Casey', 'Riley', 'Jordan', 'Morgan', 'Avery', 'Quinn']
const LAST = ['Taylor', 'Walsh', 'Byrne', 'Okoye', 'Novak', 'Costa', 'Meyer', 'Haddad', 'Lindqvist', 'Moreau']
const WORDS = ['Pilot', 'Trial', 'Sandbox', 'Rehearsal', 'Dry run', 'Check']

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function intBetween(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)) }

/** A random test person, so two test rounds don't look identical. */
export function randomTestPerson() {
  const first = pick(FIRST)
  const last = pick(LAST)
  return {
    name: `${first} ${last}`,
    email: `${first}.${last}`.toLowerCase() + '+test@example.com',
    studentId: String(intBetween(10000000, 99999999)),
  }
}

/**
 * Random answers for a registration/intake config.
 *   fields    - [{ id, label, type, options?, required?, min?, max? }]
 *   countries - the shared country list (used for `country` fields)
 * Returns a { fieldId: value } map of strings, ready to drop into form state.
 */
export function randomRegistrationAnswers(fields, countries = []) {
  const person = randomTestPerson()
  const out = {}
  ;(fields || []).forEach(f => {
    const label = String(f.label || '')
    const id = String(f.id || '')
    if (f.type === 'select' || f.type === 'radio') {
      const opts = (f.options || []).filter(Boolean)
      if (opts.length) out[f.id] = pick(opts)
      return
    }
    if (f.type === 'country') {
      const opts = (f.options && f.options.length ? f.options : countries).filter(Boolean)
      if (opts.length) out[f.id] = pick(opts)
      return
    }
    if (f.type === 'number') {
      const lo = f.min != null ? Number(f.min) : 0
      const hi = f.max != null ? Number(f.max) : Math.max(lo + 10, 10)
      out[f.id] = String(intBetween(lo, Math.max(lo, hi)))
      return
    }
    // Free text: answer by what the field is asking for, so the values look
    // like real answers rather than filler.
    if (/student\s*id|participant\s*id/i.test(label) || /studentid|participantid/i.test(id)) {
      out[f.id] = person.studentId
    } else if (/e-?mail/i.test(label) || /email/i.test(id)) {
      out[f.id] = person.email
    } else if (/name/i.test(label) || /name/i.test(id)) {
      out[f.id] = person.name
    } else if (/age/i.test(label)) {
      out[f.id] = String(intBetween(18, 45))
    } else {
      out[f.id] = `${pick(WORDS)} answer`
    }
  })
  return out
}
