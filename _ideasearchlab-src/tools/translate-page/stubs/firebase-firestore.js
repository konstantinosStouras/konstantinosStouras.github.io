// firebase/firestore stand-in for the translate-page harness.
//  - every read returns an EMPTY result (no sessions, no ideas),
//  - except settings/ai, which returns window.__HARNESS_AI_SETTINGS (set by the
//    test's init script) — the AI Settings document the page reads its keys from.
// Every call is logged to globalThis.__stubCalls so the test can prove the page
// never WROTE anything (this module exports no write function at all: a write
// the page tried would fail the build as a missing export).
const log = (...a) => { (globalThis.__stubCalls ||= []).push(a) }
const pathOf = (...segs) => segs.filter(s => typeof s === 'string').join('/')

export function collection(_db, ...segs) { const path = pathOf(...segs); log('collection', path); return { kind: 'collection', path } }
export function doc(_db, ...segs) { const path = pathOf(...segs); log('doc', path); return { kind: 'doc', path, id: segs[segs.length - 1] } }
export function query(ref, ...constraints) { return { ...ref, constraints } }
export function where(field, op, value) { return { where: [field, op, value] } }
export function orderBy(field, dir) { return { orderBy: [field, dir] } }
export async function getDocs(ref) { log('getDocs', ref.path); return { docs: [], size: 0, empty: true, forEach() {} } }
export async function getDoc(ref) {
  log('getDoc', ref.path)
  if (ref.path === 'settings/ai') {
    const data = globalThis.__HARNESS_AI_SETTINGS
    return { id: 'ai', exists: () => !!data, data: () => data }
  }
  return { id: ref.id, exists: () => false, data: () => undefined }
}
