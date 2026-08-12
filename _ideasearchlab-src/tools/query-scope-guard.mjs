/**
 * query-scope-guard.mjs — offline check (no network, no deps).
 *
 *   node _ideasearchlab-src/tools/query-scope-guard.mjs
 *
 * Static sanity check: every participant-facing Firestore query in src/ must be
   satisfiable under the tightened rules. Not a substitute for the emulator, but
   it catches an unscoped query that the new rules would deny. */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('../src/', import.meta.url).pathname
const files = []
;(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.jsx?$/.test(p)) files.push(p)
  }
})(ROOT)

const ADMIN = /Admin\.jsx|AdminSession\.jsx|DataAnalytics\.jsx|AISettings\.jsx|sessionExport\.js/
let bad = 0
for (const f of files) {
  if (ADMIN.test(f)) continue                      // instructor branch covers these
  const src = readFileSync(f, 'utf8')
  // Collection reads that are NOT scoped by a where(...) on the same statement.
  const re = /(onSnapshot|getDocs)\(\s*(query\()?\s*collection\(db,\s*'sessions',\s*sessionId,\s*'([a-zA-Z]+)'([^)]*)\)([\s\S]{0,220}?)\)/g
  let m
  while ((m = re.exec(src))) {
    const coll = m[3]
    const tail = (m[4] || '') + (m[5] || '')
    const scoped = /where\(/.test(tail)
    if (['participants', 'ideas', 'aiMessages'].includes(coll) && !scoped) {
      console.log(`  UNSCOPED  ${f}: ${coll} read with no where()`)
      bad++
    }
  }
}
console.log(bad ? `\n${bad} unscoped participant-facing collection read(s)` : '\nRULES SANITY OK — every participant-facing collection read is scoped.')
process.exit(bad ? 1 : 0)
