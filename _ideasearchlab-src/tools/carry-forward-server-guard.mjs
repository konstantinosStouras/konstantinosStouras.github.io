/* ==========================================================================
   Ideation Challenge — the Cloud Function half of the carry-forward rule,
   RUN (offline, no network, Firebase stubbed).
       node _ideasearchlab-src/tools/carry-forward-server-guard.mjs

   functions/session.js requires firebase-functions/v1 and firebase-admin at
   load, and functions/ carries no node_modules, so until now the server's
   force-advance top-up (topUpCarriedIdeas, called from advancePhase) was
   pinned by text regexes alone. Here both packages are replaced through
   Node's module loader with a duck-typed Firestore that records every write,
   and advancePhase's handler is driven over a fixture:

     P1  wrote 5 ideas, ticked 1, never submitted     → 2 stable computer picks
     P2  submitted (individualComplete)               → untouched
     P3  wrote 2 ideas, ticked none, never submitted  → both become computer picks
     P4  ticked 1 (legacy, untagged), never submitted → the legacy pick keeps its
                                                        missing tag, 2 added
     P5  removed                                      → untouched
     P6  submitted under the OLD rule (completed, one
         untagged carried idea of 4)                  → left exactly as submitted
     P7  submitted under THIS rule but short (one
         tagged pick of 4: batch refused / cap raised) → topped up to 3
     and a stranger as the caller                     → permission-denied

   and again with P1 SELECTING another idea after the server's first read (a
   last-instant Select, their clock expiring as the instructor presses
   Advance): the per-participant TRANSACTION retries from the fresh documents
   and decides again, so the new pick is honoured and the cap is never
   exceeded. The status flip and the ordering (top-up before the status
   batch) are asserted from the write log.
   ========================================================================== */
import { createRequire } from 'node:module'
import Module from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const FN = join(HERE, '..', 'functions')
const { topUpSelection } = require(join(FN, 'carryForward.js'))

let fail = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return }
  fail++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

/* ── a duck-typed Firestore ────────────────────────────────────────────── */
function makeDb() {
  const store = new Map()            // path -> { data, updateTime }
  const log = []                     // every committed write, in order
  let clock = 0
  const tick = () => ++clock
  const docRef = path => ({
    path,
    id: path.split('/').pop(),
    collection: name => collRef(`${path}/${name}`),
    async get() { const r = store.get(path); return { exists: !!r, id: path.split('/').pop(), data: () => (r ? { ...r.data } : undefined), ref: docRef(path), updateTime: r && r.updateTime } },
    async update(patch) { applyWrite(path, patch, undefined, 'update') },
    async set(data, opts) { applyWrite(path, data, undefined, opts && opts.merge ? 'merge' : 'set') },
  })
  const applyWrite = (path, patch, precondition, kind) => {
    const cur = store.get(path)
    if (precondition && precondition.lastUpdateTime !== undefined) {
      if (!cur || cur.updateTime !== precondition.lastUpdateTime) {
        const e = new Error(`precondition failed on ${path}`); e.code = 'failed-precondition'; throw e
      }
    }
    const data = kind === 'set' ? { ...patch } : { ...(cur ? cur.data : {}), ...patch }
    store.set(path, { data, updateTime: tick() })
    log.push({ path, patch: { ...patch }, kind })
  }
  const collRef = path => {
    const filters = []
    const q = {
      doc: id => docRef(`${path}/${id}`),
      where(field, op, value) { filters.push({ field, op, value }); return q },
      async get() {
        const docs = []
        for (const [p, r] of store) {
          if (!p.startsWith(path + '/') || p.slice(path.length + 1).includes('/')) continue
          if (!filters.every(f => f.op === '==' ? r.data[f.field] === f.value : true)) continue
          docs.push({ id: p.split('/').pop(), data: () => ({ ...r.data }), get: f => r.data[f], ref: docRef(p), updateTime: r.updateTime, exists: true })
        }
        return { docs, empty: docs.length === 0, size: docs.length, forEach: fn => docs.forEach(fn) }
      },
    }
    return q
  }
  const db = {
    collection: name => collRef(name),
    // A transaction commits only if none of the documents it READ changed
    // meanwhile — read or written — and otherwise retries from fresh reads,
    // exactly as Firestore's does (up to 5 attempts). `onAfterRead` lets a
    // test change a document between a transaction's read and its commit.
    async runTransaction(fn) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const reads = new Map()   // path -> updateTime at read
        const writes = []
        const tx = {
          async get(ref) {
            const r = store.get(ref.path)
            reads.set(ref.path, r ? r.updateTime : null)
            return { exists: !!r, id: ref.path.split('/').pop(), ref, data: () => (r ? { ...r.data } : undefined), get: f => (r ? r.data[f] : undefined), updateTime: r && r.updateTime }
          },
          update: (ref, patch) => writes.push({ ref, patch, kind: 'update' }),
          set: (ref, data, opts) => writes.push({ ref, patch: data, kind: opts && opts.merge ? 'merge' : 'set' }),
        }
        const result = await fn(tx)
        if (db.onAfterRead) { const hook = db.onAfterRead; db.onAfterRead = null; hook() }
        const conflict = [...reads].some(([path, t]) => { const r = store.get(path); return (r ? r.updateTime : null) !== t })
        if (conflict) { txRetries++; continue }
        writes.forEach(w => applyWrite(w.ref.path, w.patch, undefined, w.kind))
        return result
      }
      const e = new Error('too much contention'); e.code = 'aborted'; throw e
    },
    batch() {
      const ops = []
      return {
        update: (ref, patch, precondition) => ops.push({ ref, patch, precondition, kind: 'update' }),
        set: (ref, data, opts) => ops.push({ ref, patch: data, kind: opts && opts.merge ? 'merge' : 'set' }),
        delete: ref => ops.push({ ref, kind: 'delete' }),
        async commit() {
          // Atomic: every precondition is checked before anything is applied.
          ops.forEach(o => {
            if (o.precondition && o.precondition.lastUpdateTime !== undefined) {
              const cur = store.get(o.ref.path)
              if (!cur || cur.updateTime !== o.precondition.lastUpdateTime) {
                const e = new Error(`precondition failed on ${o.ref.path}`); e.code = 'failed-precondition'; throw e
              }
            }
          })
          ops.forEach(o => { if (o.kind === 'delete') { store.delete(o.ref.path); log.push({ path: o.ref.path, kind: 'delete' }) } else applyWrite(o.ref.path, o.patch, o.precondition, o.kind) })
        },
      }
    },
  }
  let txRetries = 0
  const seed = (path, data) => store.set(path, { data: { ...data }, updateTime: tick() })
  const read = path => { const r = store.get(path); return r ? { ...r.data } : undefined }
  const touch = path => { const r = store.get(path); store.set(path, { data: r.data, updateTime: tick() }) }
  const write = (path, patch) => applyWrite(path, patch, undefined, 'update')
  return { db, store, log, seed, read, touch, write, retries: () => txRetries }
}

/* ── load functions/session.js with Firebase stubbed ───────────────────── */
let current = null    // the db the stub hands out
class HttpsError extends Error { constructor(code, message) { super(message); this.code = code } }
const fnStub = {
  https: { onCall: fn => fn },
  runWith: () => fnStub,
  firestore: { document: () => ({ onUpdate: fn => fn, onCreate: fn => fn, onWrite: fn => fn, onDelete: fn => fn }) },
  region: () => fnStub,
}
const functionsV1 = { region: () => fnStub, https: { HttpsError, onCall: fn => fn } }
// session.js captures `admin.firestore()` ONCE at load, so hand it a proxy
// that forwards to whichever fixture is current at call time.
const dbProxy = { collection: (...a) => current.db.collection(...a), batch: (...a) => current.db.batch(...a), runTransaction: (...a) => current.db.runTransaction(...a) }
const firestoreFn = () => dbProxy
firestoreFn.FieldValue = { serverTimestamp: () => '__ts__', delete: () => '__del__', increment: n => n, arrayUnion: (...v) => v, arrayRemove: (...v) => v }
const adminStub = { initializeApp() {}, firestore: firestoreFn, apps: [] }
const realLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'firebase-functions/v1' || request === 'firebase-functions') return functionsV1
  if (request === 'firebase-admin') return adminStub
  return realLoad.call(this, request, ...rest)
}
current = makeDb()   // session.js calls admin.firestore() at load
const session = require(join(FN, 'session.js'))
Module._load = realLoad
check('functions/session.js loads with Firebase stubbed and exposes advancePhase', typeof session.advancePhase === 'function')

/* ── fixture ───────────────────────────────────────────────────────────── */
function fixture() {
  const f = makeDb()
  f.seed('sessions/S', { instructorId: 'INSTR', status: 'individual', phaseConfig: { ideasCarriedToGroup: 3, phaseOrder: 'individual_first', individualPhaseActive: true, groupPhaseActive: true } })
  const P = (id, extra) => f.seed(`sessions/S/participants/${id}`, { uid: id, groupId: 'g1', status: 'individual', individualComplete: false, ...extra })
  P('P1'); P('P2', { status: 'waiting_for_group', individualComplete: true }); P('P3'); P('P4'); P('P5', { removed: true, status: 'removed' })
  P('P6', { status: 'waiting_for_group', individualComplete: true })
  P('P7', { status: 'waiting_for_group', individualComplete: true })
  const I = (id, authorId, extra) => f.seed(`sessions/S/ideas/${id}`, { authorId, phase: 'individual', title: id, selected: false, ...extra })
  // P1: 5 ideas, one ticked by hand
  I('a1', 'P1'); I('a2', 'P1', { selected: true, selectedBy: 'participant' }); I('a3', 'P1'); I('a4', 'P1'); I('a5', 'P1')
  // P2: submitted — 3 tagged, 1 not
  I('b1', 'P2', { selected: true, selectedBy: 'participant' }); I('b2', 'P2', { selected: true, selectedBy: 'computer' }); I('b3', 'P2', { selected: true, selectedBy: 'computer' }); I('b4', 'P2')
  // P3: 2 ideas, none ticked
  I('c1', 'P3'); I('c2', 'P3')
  // P4: a legacy untagged pick
  I('d1', 'P4', { selected: true }); I('d2', 'P4'); I('d3', 'P4'); I('d4', 'P4')
  // P5 (removed) has an idea too
  I('e1', 'P5')
  // P6 submitted under the OLD rule: completed, one untagged carried idea of four
  I('f1', 'P6', { selected: true }); I('f2', 'P6'); I('f3', 'P6'); I('f4', 'P6')
  // P7 submitted under THIS rule but SHORT (their ideas batch was refused, or the
  // cap was raised after): completed, one TAGGED pick of four
  I('h1', 'P7', { selected: true, selectedBy: 'participant' }); I('h2', 'P7'); I('h3', 'P7'); I('h4', 'P7')
  // a group-stage idea must be ignored by the top-up
  I('g1', 'P1', { phase: 'group', groupId: 'g1' })
  return f
}
const ideasOf = (f, uid) => [...f.store].filter(([p, r]) => p.startsWith('sessions/S/ideas/') && r.data.authorId === uid && r.data.phase === 'individual').map(([p, r]) => ({ id: p.split('/').pop(), ...r.data }))
const expectedPicks = (f, uid) => {
  const mine = ideasOf(f, uid)
  const d = topUpSelection({ ideas: mine, selectedIds: mine.filter(i => i.selected && i.selectedBy !== 'computer').map(i => i.id), priorComputer: mine.filter(i => i.selectedBy === 'computer').map(i => i.id), ideasCarried: 3 })
  return [...d.computerPicked].sort()
}

/* ── run 1: the ordinary force-advance ─────────────────────────────────── */
console.log('\n1. advancePhase individual → group tops up everyone entering the group phase')
{
  const f = fixture(); current = f
  const p1Expected = expectedPicks(f, 'P1')
  const p3Expected = expectedPicks(f, 'P3')
  const p4Expected = expectedPicks(f, 'P4')
  const res = await session.advancePhase({ sessionId: 'S' }, { auth: { uid: 'INSTR' } })
  check('the advance returns the next phase', res && res.nextPhase === 'group', JSON.stringify(res))
  check('the session is now in the group phase', f.read('sessions/S').status === 'group')
  const tagged = uid => ideasOf(f, uid).filter(i => i.selectedBy === 'computer').map(i => i.id).sort()
  check(`P1: exactly the 2 stable picks are tagged computer (${p1Expected})`, JSON.stringify(tagged('P1')) === JSON.stringify(p1Expected) && p1Expected.length === 2, JSON.stringify(tagged('P1')))
  check("P1's own pick keeps its participant tag", f.read('sessions/S/ideas/a2').selectedBy === 'participant' && f.read('sessions/S/ideas/a2').selected === true)
  check('P1: 3 carried in all, the other two untouched', ideasOf(f, 'P1').filter(i => i.selected).length === 3 && ideasOf(f, 'P1').filter(i => !i.selected).every(i => i.selectedBy === undefined))
  check("P1's group-stage idea is untouched", f.read('sessions/S/ideas/g1').selected === false && f.read('sessions/S/ideas/g1').selectedBy === undefined)
  check('P2 (already submitted): nothing written', !f.log.some(w => w.path.startsWith('sessions/S/ideas/b')))
  check(`P3: both ideas become computer picks (${p3Expected})`, JSON.stringify(tagged('P3')) === JSON.stringify(['c1', 'c2']))
  check(`P4: the legacy untagged pick stays untagged and 2 are added (${p4Expected})`, f.read('sessions/S/ideas/d1').selected === true && f.read('sessions/S/ideas/d1').selectedBy === undefined && JSON.stringify(tagged('P4')) === JSON.stringify(p4Expected) && p4Expected.length === 2, JSON.stringify(tagged('P4')))
  check('P5 (removed): nothing written, status untouched', !f.log.some(w => w.path === 'sessions/S/ideas/e1') && f.read('sessions/S/participants/P5').status === 'removed')
  check('P6 (submitted under the old rule): left exactly as submitted — 1 carried, untagged, nothing added', !f.log.some(w => w.path.startsWith('sessions/S/ideas/f')) && ideasOf(f, 'P6').filter(i => i.selected).length === 1 && f.read('sessions/S/ideas/f1').selectedBy === undefined)
  check('P7 (submitted under this rule, but short): topped up to 3 — the tagged pick kept, 2 computer picks added',
    ideasOf(f, 'P7').filter(i => i.selected).length === 3 && f.read('sessions/S/ideas/h1').selectedBy === 'participant' && ideasOf(f, 'P7').filter(i => i.selectedBy === 'computer').length === 2, JSON.stringify(ideasOf(f, 'P7').map(i => [i.id, i.selected, i.selectedBy])))
  const statuses = ['P1', 'P2', 'P3', 'P4', 'P6', 'P7'].map(id => f.read(`sessions/S/participants/${id}`).status)
  check('P1–P4, P6 and P7 are moved to the group phase', statuses.every(s => s === 'group'), statuses.join(','))
  const firstIdeaWrite = f.log.findIndex(w => w.path.startsWith('sessions/S/ideas/'))
  const firstStatusWrite = f.log.findIndex(w => w.path.startsWith('sessions/S/participants/') && w.patch && w.patch.status === 'group')
  check('the top-up lands BEFORE the participants\' status flip', firstIdeaWrite >= 0 && firstStatusWrite > firstIdeaWrite, `ideas@${firstIdeaWrite} status@${firstStatusWrite}`)
  check('every idea write carries only the two fields', f.log.filter(w => w.path.startsWith('sessions/S/ideas/')).every(w => JSON.stringify(Object.keys(w.patch).sort()) === JSON.stringify(['selected', 'selectedBy'])))
  // Idempotent: a second advance from group would not touch ideas; but re-running the
  // top-up over the now-tagged documents must be a no-op — simulate by resetting status.
  const before = f.log.length
  f.seed('sessions/S', { ...f.read('sessions/S'), status: 'individual' })
  ;['P1', 'P3', 'P4'].forEach(id => f.seed(`sessions/S/participants/${id}`, { ...f.read(`sessions/S/participants/${id}`), status: 'individual' }))
  await session.advancePhase({ sessionId: 'S' }, { auth: { uid: 'INSTR' } })
  check('a second force-advance writes nothing more to the ideas (idempotent)', !f.log.slice(before).some(w => w.path.startsWith('sessions/S/ideas/')))
}

/* ── run 2: a pick lands while the server is deciding ──────────────────── */
console.log('\n2. a pick made after the transaction\'s read: it retries from the fresh documents')
{
  const f = fixture(); current = f
  // Between P1's transaction reading its five ideas and committing, P1 taps
  // Select on a4 (toggleSelect writes it as the participant's).
  f.db.onAfterRead = () => f.write('sessions/S/ideas/a4', { selected: true, selectedBy: 'participant' })
  await session.advancePhase({ sessionId: 'S' }, { auth: { uid: 'INSTR' } })
  const mine = ideasOf(f, 'P1')
  const carried = mine.filter(i => i.selected)
  check('the transaction retried', f.retries() >= 1, String(f.retries()))
  check('P1 carries exactly 3 — never cap + 1', carried.length === 3, JSON.stringify(mine.map(i => [i.id, i.selected, i.selectedBy])))
  check("both of P1's own picks are honoured", carried.some(i => i.id === 'a2' && i.selectedBy === 'participant') && carried.some(i => i.id === 'a4' && i.selectedBy === 'participant'))
  check('and ONE computer pick fills the last place', carried.filter(i => i.selectedBy === 'computer').length === 1)
  const expected = topUpSelection({ ideas: mine.map(i => ({ id: i.id })), selectedIds: ['a2', 'a4'], ideasCarried: 3 })
  check('…the stable one every reader would derive', carried.filter(i => i.selectedBy === 'computer').every(i => expected.computerPicked.has(i.id)))
  check('P3 still got its picks', ideasOf(f, 'P3').filter(i => i.selectedBy === 'computer').length === 2)
  check('the advance itself went through', f.read('sessions/S').status === 'group' && f.read('sessions/S/participants/P1').status === 'group')
  // A transaction that cannot commit at all is skipped, non-fatally.
  const g = fixture(); current = g
  let bumps = 0
  const keep = () => { g.touch('sessions/S/ideas/a1'); if (++bumps < 9) g.db.onAfterRead = keep }
  g.db.onAfterRead = keep
  await session.advancePhase({ sessionId: 'S' }, { auth: { uid: 'INSTR' } })
  check('a participant whose documents keep changing is skipped, the others and the advance unaffected',
    !g.log.some(w => w.path.startsWith('sessions/S/ideas/a')) && ideasOf(g, 'P3').filter(i => i.selectedBy === 'computer').length === 2 && g.read('sessions/S').status === 'group')
}

/* ── run 3: guards ─────────────────────────────────────────────────────── */
console.log('\n3. guards')
{
  const f = fixture(); current = f
  let err = null
  try { await session.advancePhase({ sessionId: 'S' }, { auth: { uid: 'SOMEONE' } }) } catch (e) { err = e }
  check('another user cannot advance the session', err && err.code === 'permission-denied', err && err.message)
  check('…and nothing was written', f.log.length === 0)
  // group_first: the advance from waiting goes to the group phase with no individual ideas yet — no-op on ideas.
  const g = makeDb(); current = g
  g.seed('sessions/S', { instructorId: 'INSTR', status: 'waiting', phaseConfig: { ideasCarriedToGroup: 3, phaseOrder: 'group_first' } })
  g.seed('sessions/S/participants/P1', { uid: 'P1', status: 'waiting', individualComplete: false })
  await session.advancePhase({ sessionId: 'S' }, { auth: { uid: 'INSTR' } })
  check('group_first: entering the group phase with no individual ideas writes none', g.read('sessions/S').status === 'group' && !g.log.some(w => w.path.startsWith('sessions/S/ideas/')))
}

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll checks passed')
process.exit(fail ? 1 : 0)
