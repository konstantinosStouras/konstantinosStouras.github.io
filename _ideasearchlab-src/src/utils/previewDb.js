// ─────────────────────────────────────────────────────────────────────────────
// Preview store: a tiny in-memory, reactive Firestore-subset used only in
// test mode (see preview.js). It implements exactly the operations the
// participant flow uses — doc/collection refs, equality/`!=`/`in`/array-contains
// `where`, `orderBy`, `onSnapshot` (doc + collection/query), get(Doc|Docs),
// add/set/update/deleteDoc, writeBatch, serverTimestamp — plus a local emulation
// of the Cloud Functions the flow calls (joinSession, sendAIMessage) and the one
// server trigger that isn't already client-driven (individual → next phase).
//
// Nothing here ever touches the network or persistence: the whole "database"
// lives in a Map for the lifetime of the tab and is gone when it closes. A solo
// run (group of one) is assumed — exactly like search-v2's single-participant
// preview; multi-user group dynamics can't be rehearsed by one tester anyway.
// ─────────────────────────────────────────────────────────────────────────────
import { getPhaseSequence, getNextPhase } from './phaseSequence'
import { PREVIEW_SESSION_ID, PREVIEW_UID, PREVIEW_CONFIG_KEY, isPreview } from './preview'

// Opaque sentinels standing in for the real firebase `db` / `functions` handles.
export const PREVIEW_DB = { __previewDb: true }
export const PREVIEW_FUNCTIONS = { __previewFns: true }

const store = new Map()   // full slash-path -> plain data object
const listeners = []      // { fire() }
let _idc = 0
function genId() { _idc += 1; return 'pv_' + _idc.toString(36) + '_' + Math.random().toString(36).slice(2, 8) }

// A Firestore-Timestamp-like value (has .seconds and .toMillis/.toDate, which is
// all the app reads). Date/Math.random are fine here — this is browser code.
function ts() {
  const d = new Date()
  const ms = d.getTime()
  return { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6, toMillis: () => ms, toDate: () => d }
}
export function serverTimestamp() { return ts() }

// ── refs ──────────────────────────────────────────────────────────────────
// collection()/doc() are called as collection(db, ...segments); the first arg
// (the db handle) is ignored and the remaining segments form the path. Segments
// may themselves contain slashes (e.g. AIChat passes `sessions/ID/aiMessages`).
export function doc(_db, ...segs) { return { __ref: 'doc', path: segs.join('/') } }
export function collection(_db, ...segs) { return { __ref: 'coll', path: segs.join('/') } }
export function query(coll, ...constraints) { return { __ref: 'query', path: coll.path, constraints } }
export function where(field, op, value) { return { __c: 'where', field, op, value } }
export function orderBy(field, dir = 'asc') { return { __c: 'orderBy', field, dir } }

// Direct children of a collection path (docs whose path is `${coll}/<one segment>`).
function collDocs(collPath) {
  const out = []
  const prefix = collPath + '/'
  for (const [k, v] of store) {
    if (k.startsWith(prefix) && k.slice(prefix.length).indexOf('/') === -1) {
      out.push({ id: k.slice(prefix.length), path: k, data: v })
    }
  }
  return out
}

function fieldVal(obj, field) {
  // Support dotted field paths in where/orderBy (not currently used, but safe).
  if (field.indexOf('.') === -1) return obj ? obj[field] : undefined
  return field.split('.').reduce((o, k) => (o == null ? o : o[k]), obj)
}
function scalar(v) { return v && typeof v === 'object' && v.seconds != null ? v.seconds : v }
function matchWhere(v, op, val) {
  switch (op) {
    case '==': return v === val
    case '!=': return v !== val
    case 'in': return Array.isArray(val) && val.includes(v)
    case 'not-in': return Array.isArray(val) && !val.includes(v)
    case 'array-contains': return Array.isArray(v) && v.includes(val)
    case '>': return scalar(v) > scalar(val)
    case '>=': return scalar(v) >= scalar(val)
    case '<': return scalar(v) < scalar(val)
    case '<=': return scalar(v) <= scalar(val)
    default: return true
  }
}
function applyQuery(q) {
  let docs = collDocs(q.path)
  const wheres = q.constraints.filter(c => c.__c === 'where')
  const orders = q.constraints.filter(c => c.__c === 'orderBy')
  docs = docs.filter(d => wheres.every(w => matchWhere(fieldVal(d.data, w.field), w.op, w.value)))
  orders.forEach(o => {
    docs.sort((a, b) => {
      const av = scalar(fieldVal(a.data, o.field)), bv = scalar(fieldVal(b.data, o.field))
      const c = av < bv ? -1 : av > bv ? 1 : 0
      return o.dir === 'desc' ? -c : c
    })
  })
  return docs
}

// ── snapshot shapes ─────────────────────────────────────────────────────────
function docSnap(path) {
  const data = store.get(path)
  return {
    id: path.split('/').pop(),
    ref: { __ref: 'doc', path },
    exists: () => data !== undefined,
    data: () => (data !== undefined ? { ...data } : undefined),
  }
}
function collSnap(rows) {
  const docs = rows.map(r => ({
    id: r.id, ref: { __ref: 'doc', path: r.path }, exists: true, data: () => ({ ...r.data }),
  }))
  return { docs, size: docs.length, empty: docs.length === 0, forEach: fn => docs.forEach(fn) }
}

function notify() { listeners.slice().forEach(l => { try { l.fire() } catch (e) { console.error(e) } }) }

export function onSnapshot(refOrQuery, cb, errCb) {
  const fire = () => {
    try {
      if (refOrQuery.__ref === 'doc') cb(docSnap(refOrQuery.path))
      else cb(collSnap(refOrQuery.__ref === 'query' ? applyQuery(refOrQuery) : collDocs(refOrQuery.path)))
    } catch (e) { if (errCb) errCb(e); else console.error(e) }
  }
  const l = { fire }
  listeners.push(l)
  fire()   // Firestore fires immediately with the current value
  return () => { const i = listeners.indexOf(l); if (i !== -1) listeners.splice(i, 1) }
}

// ── reads / writes ───────────────────────────────────────────────────────────
export async function getDoc(ref) { return docSnap(ref.path) }
export async function getDocs(qOrColl) {
  return collSnap(qOrColl.__ref === 'query' ? applyQuery(qOrColl) : collDocs(qOrColl.path))
}

function applyPatch(obj, patch) {
  for (const k of Object.keys(patch)) {
    if (k.indexOf('.') !== -1) {
      const parts = k.split('.')
      let o = obj
      for (let i = 0; i < parts.length - 1; i++) { if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {}; o = o[parts[i]] }
      o[parts[parts.length - 1]] = patch[k]
    } else obj[k] = patch[k]
  }
}

export async function setDoc(ref, data) { store.set(ref.path, { ...data }); afterWrite(ref.path, store.get(ref.path)); notify() }
export async function addDoc(coll, data) {
  const id = genId(), path = coll.path + '/' + id
  store.set(path, { ...data })
  notify()
  return { id, path, __ref: 'doc' }
}
export async function updateDoc(ref, patch) {
  const cur = store.get(ref.path) || {}
  applyPatch(cur, patch)
  store.set(ref.path, cur)
  afterWrite(ref.path, cur)
  notify()
}
export async function deleteDoc(ref) { store.delete(ref.path); notify() }

export function writeBatch() {
  const ops = []
  return {
    set: (ref, data) => ops.push(() => store.set(ref.path, { ...data })),
    update: (ref, patch) => ops.push(() => { const cur = store.get(ref.path) || {}; applyPatch(cur, patch); store.set(ref.path, cur) }),
    delete: (ref) => ops.push(() => store.delete(ref.path)),
    commit: async () => { ops.forEach(fn => fn()); notify() },
  }
}

// ── trigger emulation ─────────────────────────────────────────────────────────
// The only server trigger the solo flow depends on: when the participant marks
// the individual phase done (status 'waiting_for_group'), the real
// autoGroupParticipants trigger moves a fully-finished group to the next phase.
// For a group of one that condition is met immediately, so advance shortly after
// (a beat, so the "submitted" confirmation shows first, like a real round-trip).
// group → survey and survey → done are already client-driven (GroupPhase
// self-heal + Survey submit), so no emulation is needed for them.
function afterWrite(path, data) {
  const m = /^sessions\/([^/]+)\/participants\/([^/]+)$/.exec(path)
  if (!m || !data) return
  if (data.status === 'waiting_for_group') {
    const sid = m[1]
    const sess = store.get('sessions/' + sid) || {}
    const next = getNextPhase('individual', sess.phaseConfig) || 'survey'
    setTimeout(() => {
      const cur = store.get(path)
      if (!cur || cur.status !== 'waiting_for_group') return
      cur.status = next
      store.set(path, cur)
      notify()
    }, 450)
  }
}

// ── Cloud Function emulation ──────────────────────────────────────────────────
export function getFunctions() { return PREVIEW_FUNCTIONS }
export function httpsCallable(_functions, name) {
  return async (payload) => {
    if (name === 'joinSession') return emJoinSession()
    if (name === 'sendAIMessage') return emSendAIMessage(payload)
    // advancePhase / handleStragglers / removeParticipant etc. aren't reachable
    // from the solo participant flow — no-op them.
    return { data: { success: true, preview: true } }
  }
}

function emJoinSession() {
  const sid = PREVIEW_SESSION_ID
  const sess = store.get('sessions/' + sid) || {}
  const seq = getPhaseSequence(sess.phaseConfig || {})
  const firstPhase = seq[1] || 'survey'
  const pPath = `sessions/${sid}/participants/${PREVIEW_UID}`
  if (!store.get(pPath)) {
    store.set(pPath, {
      uid: PREVIEW_UID, anonymousLabel: 'p1', groupId: 'g0',
      status: firstPhase, individualComplete: false, votedFor: [],
      createdAt: ts(), timing: {},
    })
    store.set(`sessions/${sid}/groups/g0`, {
      members: [PREVIEW_UID], memberLabels: { [PREVIEW_UID]: 'p1' },
      status: 'active', full: true, createdAt: ts(),
    })
    notify()
  }
  return { data: { success: true, groupId: 'g0' } }
}

function emSendAIMessage(payload = {}) {
  const { sessionId = PREVIEW_SESSION_ID, scope, scopeId, userMessage = '' } = payload
  const snippet = userMessage.trim().slice(0, 80)
  const reply =
    'This is a test-mode reply, so no live AI model was called and nothing is saved. ' +
    'In a real session the assistant would help you develop your ideas here' +
    (snippet ? `, for example around: "${snippet}".` : '.')
  const path = `sessions/${sessionId}/aiMessages/${genId()}`
  store.set(path, {
    role: 'assistant', text: reply, scope, scopeId,
    authorId: 'ai', authorName: 'AI Assistant (test mode)',
    provider: 'preview', model: 'preview', inputTokens: null, outputTokens: null,
    timestamp: ts(),
  })
  notify()
  return { data: { success: true, preview: true } }
}

// ── one-time seed of the sandbox session from the admin's handoff ─────────────
// The admin's "Test round" button stashes the chosen session doc in localStorage;
// read it once so SessionContext's onSnapshot (routed through the façade) finds a
// session to render. groupSize is forced to 1 so the solo tester's group fills
// and the flow proceeds without waiting for other participants.
let _seeded = false
export function ensurePreviewSeed() {
  if (_seeded) return
  _seeded = true
  let cfg = null
  try { cfg = JSON.parse(localStorage.getItem(PREVIEW_CONFIG_KEY) || 'null') } catch (e) {}
  const phaseConfig = { ...(cfg && cfg.phaseConfig ? cfg.phaseConfig : {}), groupSize: 1 }
  store.set('sessions/' + PREVIEW_SESSION_ID, {
    id: PREVIEW_SESSION_ID,
    code: (cfg && cfg.code) || 'PREVIEW',
    name: (cfg && cfg.name) || 'Test round',
    status: 'waiting',
    joinCount: 0,
    phaseConfig,
    aiConfig: (cfg && cfg.aiConfig) || {},
    contentConfig: (cfg && cfg.contentConfig) || undefined,
    registrationConfig: (cfg && cfg.registrationConfig) || undefined,
    surveyConfig: (cfg && cfg.surveyConfig) || undefined,
    createdAt: ts(),
  })
}

if (isPreview()) ensurePreviewSeed()
