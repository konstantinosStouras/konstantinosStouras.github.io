/* ==========================================================================
   Simulation Platform — answers.js unit checks (offline, no deps, no browser).
       node simulation/tools/answers-guard.mjs

   `canon(field, value)` maps an answer that was saved in the student's display
   language back to the catalogue value it came from. It is allowed to be
   incomplete — an unrecognised answer is asked again, which is safe — but it
   must never be WRONG, because a wrong mapping silently records something the
   student never chose. These checks pin exactly that:

     · every catalogue value maps to itself (the normal case must not move);
     · the strings this cohort actually produced map to the right option;
     · an alias table never maps one spelling to two options, and every alias
       lands on a value that really is in its field's set;
     · "其他" resolves per FIELD (Gender → Other, Industry → Other) and never
       leaks across fields;
     · anything unknown returns '' rather than a guess, and healProfile then
       leaves it untouched.
   ========================================================================== */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const A = require(join(HERE, '..', 'answers.js'))

let fail = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return }
  fail++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ── identity: a canonical answer must survive untouched ───────────────── */
let identity = 0
for (const [field, set] of Object.entries(A.sets)) {
  for (const v of set) {
    if (A.canon(field, v) !== v) { check(`identity ${field}/${v}`, false, A.canon(field, v)); }
    else identity++
  }
}
check(`every catalogue value maps to itself (${identity} across ${Object.keys(A.sets).length} fields)`, true)
check('…and isCanonical agrees', A.sets.levelOfStudy.every(v => A.isCanonical('levelOfStudy', v)))

/* ── the strings this cohort actually produced ─────────────────────────── */
const observed = [
  ['levelOfStudy', '大学本科生', 'Undergraduate'],   // seen on the roster
  ['levelOfStudy', '本科阶段', 'Undergraduate'],     // same option, other wording
  ['levelOfStudy', '本科生', 'Undergraduate'],       // and a third
  ['levelOfStudy', '硕士研究生', 'Postgraduate (Masters)'],
  ['levelOfStudy', '博士研究生', 'Postgraduate (PhD)'],
  ['levelOfStudy', '工商管理硕士', 'MBA'],
  ['gender', '男', 'Male'],
  ['gender', '女', 'Female'],
  ['englishFluency', '高级', 'Advanced'],
  ['englishFluency', '母语', 'Native speaker'],
  ['occupation', '学生', 'Student'],
  ['industry', '物流与运输', 'Logistics & Transportation'],
  ['country', '中国', 'China'],
  ['country', '新加坡', 'Singapore'],
  ['nationality', '越南', 'Vietnam'],
]
observed.forEach(([f, v, want]) => check(`${f}: ${v} → ${want}`, A.canon(f, v) === want, A.canon(f, v)))

/* ── decoration, case and whitespace ───────────────────────────────────── */
check('a decorated age band keeps its option ("18-24岁")', A.canon('age', '18-24岁') === '18-24')
check('case and spacing are forgiven ("  undergraduate ")',
  A.canon('levelOfStudy', '  undergraduate ') === 'Undergraduate')
check('a fully translated string with no alias is NOT rescued by the skeleton rule',
  A.canon('industry', '完全没有对应') === '')

/* ── the alias tables are sane ─────────────────────────────────────────── */
let aliasFails = 0
for (const [field, table] of Object.entries(A.aliases)) {
  const set = A.sets[field]
  for (const [alias, target] of Object.entries(table)) {
    if (!set.includes(target)) { console.log(`  FAIL alias ${field}/${alias} → ${target} is not in the set`); aliasFails++ }
    if (A.canon(field, alias) !== target) { console.log(`  FAIL alias ${field}/${alias} does not resolve`); aliasFails++ }
  }
}
check('every alias resolves to a value that exists in its own field', aliasFails === 0)
check('"其他" is per-field: Gender → Other, Industry → Other, Level → Other',
  A.canon('gender', '其他') === 'Other' && A.canon('industry', '其他') === 'Other' &&
  A.canon('levelOfStudy', '其他') === 'Other')
check('…and a level alias does not leak into gender', A.canon('gender', '大学本科生') === '')

/* ── unknown answers are never guessed ─────────────────────────────────── */
check('an unknown answer returns empty', A.canon('levelOfStudy', 'Sonstiges (unmapped)') === '')
check('an unknown FIELD returns empty', A.canon('favouriteColour', 'blue') === '')
check('empty in, empty out', A.canon('gender', '') === '' && A.canon('gender', null) === '')

/* ── healProfile ───────────────────────────────────────────────────────── */
const before = {
  name: 'JiaQing Li', studentId: '25241164', workExperience: '0',
  age: '18-24岁', gender: '女', nationality: '中国', country: '中国',
  levelOfStudy: '大学本科生', occupation: '学生', industry: 'Sonstiges (unmapped)',
  englishFluency: '高级',
}
const { profile, fixed } = A.healProfile(before)
check('healProfile repairs every answer it recognises', fixed.length === 7, JSON.stringify(fixed))
check('…to the right values',
  profile.levelOfStudy === 'Undergraduate' && profile.gender === 'Female' &&
  profile.country === 'China' && profile.nationality === 'China' &&
  profile.occupation === 'Student' && profile.englishFluency === 'Advanced' &&
  profile.age === '18-24', JSON.stringify(profile))
check('…leaves the one it cannot map exactly as it was',
  profile.industry === 'Sonstiges (unmapped)' && !fixed.includes('industry'))
check('…never touches the free-text fields',
  profile.name === 'JiaQing Li' && profile.studentId === '25241164' && profile.workExperience === '0')
check('…and does not mutate the profile it was given',
  before.levelOfStudy === '大学本科生')
check('healing is idempotent — a clean profile changes nothing',
  A.healProfile(profile).fixed.length === 0)

console.log(fail ? `\nFAILURES: ${fail}` : '\nANSWERS GUARD OK — translated answers map back, unknown ones are never guessed.')
process.exit(fail ? 1 : 0)
