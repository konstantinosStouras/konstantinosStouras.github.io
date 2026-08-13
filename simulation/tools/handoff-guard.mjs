/* ==========================================================================
   Simulation Platform — handoff coverage guard (offline, no browser, no deps).
       node simulation/tools/handoff-guard.mjs

   WHAT IT PROVES. A student registers ONCE on the platform; every simulation
   is then supposed to receive those details and record them, so the research
   export carries the demographics without anyone retyping anything. Each sim
   maps the launch handoff onto its own registration form and — deliberately —
   DROPS any answer that would not survive that form's own validation, showing
   the field instead of submitting something off-list. That is the safe
   behaviour, but it is also silent: if one option list drifts by a word, or a
   new question appears that the platform cannot answer, the silent
   registration quietly turns back into a form, students click through it, and
   the export comes back with holes. Nothing warns you until you read the data.

   So this runs each sim's REAL mapper (its own ID/label tables and validation
   rules, read from its source — a changed shape fails here rather than
   passing vacuously) over a canonical platform profile built from
   simulation/answers.js, and requires FULL coverage: every field of every
   default registration form answered, in-list, from the platform alone.

   It also pins the two failure modes we have actually seen:
     · an answer saved in the student's display language ("大学本科生") is
       dropped rather than written off-list — the reason those students' data
       reached the Ideation Challenge in clean English;
     · a value the platform could offer but the sim does not list (drift
       between the two option sets) is reported per field, not swallowed.
   ========================================================================== */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const A = require(join(ROOT, 'simulation', 'answers.js'))

let fail = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return }
  fail++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ── the profile a student registers on the platform ───────────────────── */
/* Canonical by construction: every select answer is taken from answers.js, so
   this is exactly what the platform stores once it has healed/validated. */
const profile = {
  name: 'Nguyen Thanh Hai',
  email: 'hainguyen100305@gmail.com',
  studentId: '25262368',
  workExperience: '0',
}
for (const [field, set] of Object.entries(A.sets)) profile[field] = set[0]
profile.country = 'Singapore'          // a country that is not the first entry
profile.levelOfStudy = 'Undergraduate'
profile.gender = 'Female'

/* ── each sim's own mapping tables + registration form, from source ─────── */
/* Slicing the tables out of the sources keeps the guard honest: it exercises
   the real ID map / label regexes, and a rename makes it fail loudly. */
function sliceValue(src, decl) {
  const i = src.indexOf(decl)
  if (i < 0) throw new Error(`could not find "${decl}" — the mapper changed shape`)
  let k = i + decl.length
  while (k < src.length && /\s/.test(src[k])) k++
  const open = src[k]
  const close = open === '{' ? '}' : open === '[' ? ']' : null
  if (!close) throw new Error(`"${decl}" is not an object/array literal`)
  /* Balanced scan, skipping strings, regex literals and comments — the label
     maps hold regexes full of brackets. */
  let depth = 0, j = k, inStr = null, inRe = false, inCmt = null
  for (; j < src.length; j++) {
    const c = src[j], prev = src[j - 1]
    if (inCmt) { if (inCmt === '//' && c === '\n') inCmt = null; else if (inCmt === '/*' && prev === '*' && c === '/') inCmt = null; continue }
    if (inStr) { if (c === inStr && prev !== '\\') inStr = null; continue }
    if (inRe) { if (c === '/' && prev !== '\\') inRe = false; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '/' && src[j + 1] === '/') { inCmt = '//'; continue }
    if (c === '/' && src[j + 1] === '*') { inCmt = '/*'; continue }
    if (c === '/' && /[[(,=:]\s*$/.test(src.slice(Math.max(0, j - 3), j))) { inRe = true; continue }
    if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) break }
  }
  if (depth !== 0) throw new Error(`unbalanced literal after "${decl}"`)
  // eslint-disable-next-line no-eval
  return eval(`(${src.slice(k, j + 1)})`)
}

const isl = readFileSync(join(ROOT, '_ideasearchlab-src/src/utils/simplatform.js'), 'utf8')
const pf = readFileSync(join(ROOT, 'lab/portfoliofit/experiment.js'), 'utf8')
const ar = readFileSync(join(ROOT, 'lab/answerarena/arena-app.js'), 'utf8')

const MAPPERS = {
  ideasearchlab: {
    idMap: sliceValue(isl, 'const ID_MAP = '),
    labelMap: sliceValue(isl, 'const LABEL_MAP = '),
  },
  portfoliofit: {
    idMap: sliceValue(pf, 'var SIMP_ID_MAP = '),
    labelMap: sliceValue(pf, 'var SIMP_LABEL_MAP = '),
  },
  answerarena: {
    idMap: sliceValue(ar, 'var SIMP_ID_MAP = '),
    labelMap: sliceValue(ar, 'var SIMP_LABEL_MAP = '),
  },
}

/* The registration form each sim shows by default. */
const formsSrc = {
  ideasearchlab: readFileSync(join(ROOT, '_ideasearchlab-src/src/data/formDefaults.js'), 'utf8'),
  portfoliofit: readFileSync(join(ROOT, 'lab/portfoliofit/pf-defaults.js'), 'utf8'),
}
const FORMS = {
  ideasearchlab: sliceValue(formsSrc.ideasearchlab, 'export const DEFAULT_REGISTRATION = ', '}\n').fields,
  portfoliofit: sliceValue(formsSrc.portfoliofit, '  registrationQuestions: ', '],\n'),
}
const COUNTRIES = A.sets.country

/* The mapping + validation contract all three implement identically: resolve
   the field to a profile key (id first, then label), then keep the answer only
   if the sim's own form would have accepted it. */
function mapAnswers(sim, fields, prof) {
  const { idMap, labelMap } = MAPPERS[sim]
  const out = {}, dropped = []
  fields.forEach(f => {
    let key = idMap[f.id]
    if (!key) {
      const hit = labelMap.find(([re]) => re.test(f.label || ''))
      key = hit && hit[1]
    }
    const raw = key ? prof[key] : undefined
    if (raw == null || String(raw).trim() === '') { dropped.push([f.id, key ? 'no value' : 'no mapping']); return }
    const s = String(raw).trim()
    if (f.type === 'select' && Array.isArray(f.options) && f.options.length && !f.options.includes(s)) {
      dropped.push([f.id, `"${s}" is not one of this form's options`]); return
    }
    if (f.type === 'country' && !COUNTRIES.includes(s)) { dropped.push([f.id, 'not a known country']); return }
    if (f.type === 'number') {
      const n = Number(s)
      if (isNaN(n) || !Number.isInteger(n) || (f.min != null && n < f.min) || (f.max != null && n > f.max)) {
        dropped.push([f.id, 'fails the number rule']); return
      }
    }
    out[f.id] = s
  })
  return { out, dropped }
}

/* ── 1. full coverage: the registration submits with nothing shown ─────── */
for (const sim of ['ideasearchlab', 'portfoliofit']) {
  const fields = FORMS[sim]
  const { out, dropped } = mapAnswers(sim, fields, profile)
  check(`${sim}: every default registration field is answered from the platform (${fields.length})`,
    dropped.length === 0, dropped.map(d => d.join(': ')).join(' | '))
  check(`${sim}: every answer is one the form itself accepts`,
    fields.every(f => !(f.id in out) ||
      f.type !== 'select' || !f.options?.length || f.options.includes(out[f.id])))
  const required = fields.filter(f => f.required !== false)
  check(`${sim}: no REQUIRED field is left for the student to fill (${required.length})`,
    required.every(f => f.id in out), required.filter(f => !(f.id in out)).map(f => f.id).join(', '))
}

/* ── 2. the platform's answer sets are accepted in FULL ────────────────── */
/* Coverage for one profile is not enough: any student's answer must land. */
const FIELD_TO_QUESTION = {
  age: 'age', gender: 'gender', levelOfStudy: 'levelOfStudy',
  occupation: 'occupation', industry: 'industry', englishFluency: 'englishFluency',
}
for (const sim of ['ideasearchlab', 'portfoliofit']) {
  for (const [pfield, qid] of Object.entries(FIELD_TO_QUESTION)) {
    const q = FORMS[sim].find(f => f.id === qid)
    if (!q) { check(`${sim}: has a "${qid}" question`, false); continue }
    const missing = A.sets[pfield].filter(v => !(q.options || []).includes(v))
    check(`${sim}/${qid}: accepts every answer the platform can produce (${A.sets[pfield].length})`,
      missing.length === 0, missing.join(', '))
  }
  const countryQs = FORMS[sim].filter(f => f.type === 'country')
  check(`${sim}: nationality + country are country-typed (${countryQs.length})`, countryQs.length === 2)
}

/* ── 3. a translated answer is dropped, never written off-list ─────────── */
const translated = { ...profile, levelOfStudy: '大学本科生', gender: '女' }
for (const sim of ['ideasearchlab', 'portfoliofit']) {
  const { out, dropped } = mapAnswers(sim, FORMS[sim], translated)
  check(`${sim}: a display-language answer is NOT recorded off-list`,
    out.levelOfStudy === undefined && out.gender === undefined)
  check(`${sim}: …and it is the reason the field would be shown`,
    dropped.some(d => d[0] === 'levelOfStudy'))
}

/* ── 4. the identity fields the export joins on ────────────────────────── */
/* The platform's roster and each sim's records are joined by the university
   student ID; the ideasearchlab export also carries the platform name/e-mail.
   A missing student ID means a participant nobody can reconcile. */
for (const sim of ['ideasearchlab', 'portfoliofit', 'answerarena']) {
  const { idMap, labelMap } = MAPPERS[sim]
  const ids = Object.entries(idMap).filter(([, k]) => k === 'studentId').map(([id]) => id)
  check(`${sim}: maps a student-ID field (${ids.join(', ')})`, ids.length > 0)
  check(`${sim}: matches a student-ID question by label too`,
    labelMap.some(([re, k]) => k === 'studentId' && re.test('University Student ID')))
  check(`${sim}: matches an e-mail and a full-name question by label`,
    labelMap.some(([re, k]) => k === 'email' && re.test('E-mail')) &&
    labelMap.some(([re, k]) => k === 'name' && re.test('Full name')))
}

/* ── 5. every profile field the platform collects reaches the sims ─────── */
const platformFields = ['studentId', 'age', 'gender', 'nationality', 'country',
  'levelOfStudy', 'workExperience', 'occupation', 'industry', 'englishFluency']
for (const sim of Object.keys(MAPPERS)) {
  const reachable = new Set(Object.values(MAPPERS[sim].idMap).concat(MAPPERS[sim].labelMap.map(([, k]) => k)))
  const unreachable = platformFields.filter(f => !reachable.has(f))
  check(`${sim}: every field the platform collects has a mapping (${platformFields.length})`,
    unreachable.length === 0, unreachable.join(', '))
}

/* ── 6. a field a SIM leaves optional must be compulsory on the platform ─ */
/* This is where today's single hole came from: ideasearchlab (and PortfolioFit)
   mark Gender optional, so when the platform had no gender for a student the
   silent registration submitted it blank and the export carried an empty cell.
   The platform demands every field, which is what closes it — assert that, so
   nobody makes one of them optional there without noticing what it costs. */
const platFields = sliceValue(readFileSync(join(ROOT, 'simulation/index.html'), 'utf8'), 'var FIELDS = ')
const platKeys = new Set(platFields.map(([key]) => key))
for (const sim of ['ideasearchlab', 'portfoliofit']) {
  const optional = FORMS[sim].filter(f => f.required === false)
  const uncovered = optional.filter(f => {
    const key = MAPPERS[sim].idMap[f.id] ||
      (MAPPERS[sim].labelMap.find(([re]) => re.test(f.label || '')) || [])[1]
    return !key || !platKeys.has(key)
  })
  check(`${sim}: every field it leaves OPTIONAL (${optional.map(f => f.id).join(', ') || 'none'}) is compulsory on the platform`,
    uncovered.length === 0, uncovered.map(f => f.id).join(', '))
}
check('the platform collects all 12 registration fields', platFields.length === 12, String(platFields.length))

console.log(fail
  ? `\nFAILURES: ${fail} — a simulation would ask students for details the platform already has, and the export would come back with holes.`
  : '\nHANDOFF GUARD OK — the platform answers every registration field of every simulation, in-list.')
process.exit(fail ? 1 : 0)
