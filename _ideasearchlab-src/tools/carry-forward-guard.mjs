/* ==========================================================================
   Ideation Challenge — carry-forward guard (offline, no deps, no network).
       node _ideasearchlab-src/tools/carry-forward-guard.mjs

   THE RULE (owner 2026-09-28, from analysing the data): a participant who
   generated 3 or more ideas in the individual stage but selected only k of
   them (k = 0, 1, 2) to carry into the group stage still carries 3 — the app
   selects the remaining 3 − k UNIFORMLY AT RANDOM from the rest and tags each
   one "computer selected to group stage" (`selectedBy: 'computer'`). Someone
   who generated 5 and picked 1 therefore arrives in the group with 3: the 1
   they chose and 2 the computer picked.

   What is pinned here:
     1. the pure module src/utils/carryForward.js — the top-up arithmetic over
        every (ideas, chosen, cap) combination that matters, that the
        participant's own picks are never removed, that a computer pick
        already recorded is honoured rather than re-drawn, that the pick is
        the same from every reader (order-independent, deterministic), and
        that over Firestore-shaped random ids it is a UNIFORM draw (measured);
     2. that functions/carryForward.js is a byte-identical copy (the Cloud
        Functions deploy only their own folder, so the rule is vendored);
     3. by source, that every consumer really goes through the module —
        Finish & Submit / the timer's auto-submit (ideas batch BEFORE the
        participant flag, tag written), the group page's stable top-up and its
        write-back for the participant's own ideas, the Cloud Function's
        force-advance, the admin badge, the export and analytics columns;
     4. that the SHIPPED bundle in lab/ideasearchlab carries the change (a
        stale rebuild fails here rather than on a class).
   ========================================================================== */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')
const SITE = join(HERE, '..', '..')
const read = p => readFileSync(p, 'utf8')

let fail = 0
const check = (name, cond, detail) => {
  if (cond) { console.log(`  ok   ${name}`); return }
  fail++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const esm = await import(join(SRC, 'src', 'utils', 'carryForward.js'))
const cjs = require(join(SRC, 'functions', 'carryForward.js'))
const { topUpSelection, pickStable, carryTarget, carriedBy, isOwnPick, selectionPatch, patchChanges, carriedSummary, SELECTED_BY, COMPUTER_SELECTED_LABEL } = esm

const ideas = n => Array.from({ length: n }, (_, i) => ({ id: `idea_${i + 1}` }))
const ids = set => [...set].sort()

/* ── 1. the arithmetic ─────────────────────────────────────────────────── */
console.log('\n1. carry target = min(cap, ideas written)')
check('5 ideas, cap 3 → 3', carryTarget(5, 3) === 3)
check('3 ideas, cap 3 → 3', carryTarget(3, 3) === 3)
check('2 ideas, cap 3 → 2', carryTarget(2, 3) === 2)
check('0 ideas → 0', carryTarget(0, 3) === 0)
check('cap 0 (no group phase) → 0', carryTarget(5, 0) === 0)
check('a junk cap counts as 0', carryTarget(5, 'x') === 0 && carryTarget(5, -1) === 0)

console.log('\n2. the top-up over every (written, chosen) case that matters')
for (const n of [0, 1, 2, 3, 4, 5, 6]) {
  for (const k of [0, 1, 2, 3]) {
    if (k > n) continue
    const list = ideas(n)
    const chosen = list.slice(0, k).map(i => i.id)
    const d = topUpSelection({ ideas: list, selectedIds: chosen, ideasCarried: 3 })
    const target = Math.min(3, n)
    check(`${n} written, ${k} chosen → ${target} carried (${Math.max(0, target - k)} by the computer)`,
      d.selection.size === target
      && d.participantPicked.size === k
      && d.computerPicked.size === Math.max(0, target - k)
      && chosen.every(id => d.selection.has(id) && d.participantPicked.has(id) && !d.computerPicked.has(id))
      && [...d.computerPicked].every(id => !chosen.includes(id) && list.some(i => i.id === id)),
      `sel=${ids(d.selection)} own=${ids(d.participantPicked)} auto=${ids(d.computerPicked)}`)
  }
}
{
  // The owner's own example: 5 generated, 1 selected → 2 more, at random.
  const list = ideas(5)
  const d = topUpSelection({ ideas: list, selectedIds: new Set(['idea_4']), ideasCarried: 3 })
  check('owner example: 5 generated, 1 selected → the 1 plus 2 computer picks',
    d.selection.size === 3 && d.participantPicked.has('idea_4') && d.computerPicked.size === 2 && !d.computerPicked.has('idea_4'))
  // Picks above the cap are the participant's and stay (an admin lowered the cap later).
  const over = topUpSelection({ ideas: ideas(5), selectedIds: ['idea_1', 'idea_2', 'idea_3', 'idea_4'], ideasCarried: 3 })
  check('4 chosen under a cap of 3: all 4 kept, none added', over.selection.size === 4 && over.computerPicked.size === 0)
  // A selected id whose idea was deleted is ignored, and the gap is filled.
  const stale = topUpSelection({ ideas: ideas(4), selectedIds: ['idea_1', 'gone'], ideasCarried: 3 })
  check('a stale selected id is dropped and its place filled', stale.selection.size === 3 && !stale.selection.has('gone') && stale.participantPicked.size === 1 && stale.computerPicked.size === 2)
  // Accepts a Set or an array, and ideas with no id are ignored.
  const arr = topUpSelection({ ideas: [...ideas(3), { title: 'no id' }, null], selectedIds: ['idea_2'], ideasCarried: 3 })
  check('array input, junk rows ignored', arr.selection.size === 3 && arr.computerPicked.size === 2)
  // No group phase (cap 0): nothing added, own picks (if any) kept.
  const none = topUpSelection({ ideas: ideas(4), selectedIds: ['idea_1'], ideasCarried: 0 })
  check('cap 0: nothing added', none.computerPicked.size === 0 && none.selection.size === 1)
}

console.log('\n2b. a computer pick already recorded is honoured, never re-drawn')
{
  const list = ideas(5)
  const fresh = topUpSelection({ ideas: list, selectedIds: ['idea_2'], ideasCarried: 3 })
  const other = [...list].map(i => i.id).find(id => id !== 'idea_2' && !fresh.computerPicked.has(id))
  // A prior computer pick the fresh draw would NOT have chosen stays.
  const kept = topUpSelection({ ideas: list, selectedIds: ['idea_2'], priorComputer: [other], ideasCarried: 3 })
  check('a recorded computer pick is kept and only the remaining place is filled',
    kept.computerPicked.has(other) && kept.computerPicked.size === 2 && kept.selection.size === 3, `${ids(kept.computerPicked)} (prior ${other})`)
  // The participant's own pick beats a prior computer pick on the same idea.
  const beat = topUpSelection({ ideas: list, selectedIds: [other], priorComputer: [other], ideasCarried: 3 })
  check("the participant's pick on the same idea wins", beat.participantPicked.has(other) && !beat.computerPicked.has(other))
  // More prior computer picks than needed are trimmed to what is needed.
  const trim = topUpSelection({ ideas: list, selectedIds: ['idea_1', 'idea_2'], priorComputer: ['idea_3', 'idea_4', 'idea_5'], ideasCarried: 3 })
  check('excess prior computer picks are released', trim.computerPicked.size === 1 && trim.selection.size === 3 && ['idea_3', 'idea_4', 'idea_5'].includes([...trim.computerPicked][0]))
  // A full participant selection leaves no room: prior computer picks go.
  const full = topUpSelection({ ideas: list, selectedIds: ['idea_1', 'idea_2', 'idea_3'], priorComputer: ['idea_4'], ideasCarried: 3 })
  check('a full own selection releases every computer pick', full.computerPicked.size === 0 && full.selection.size === 3)
  // A prior id that no longer exists is ignored.
  const gone = topUpSelection({ ideas: list, selectedIds: ['idea_1'], priorComputer: ['deleted'], ideasCarried: 3 })
  check('a stale prior id is ignored', !gone.selection.has('deleted') && gone.selection.size === 3)
  // Idempotent: feeding a decision back in returns the same decision — what
  // makes a retry, and a second writer, harmless.
  const again = topUpSelection({ ideas: list, selectedIds: [...fresh.participantPicked], priorComputer: [...fresh.computerPicked], ideasCarried: 3 })
  check('feeding a decision back in returns the same decision', ids(again.selection).join() === ids(fresh.selection).join() && ids(again.computerPicked).join() === ids(fresh.computerPicked).join())
}

console.log('\n3. the patches written to each idea')
{
  const d = topUpSelection({ ideas: ideas(4), selectedIds: ['idea_1'], ideasCarried: 3 })
  const auto = [...d.computerPicked][0]
  const out = [...ideas(4)].map(i => i.id).find(id => !d.selection.has(id))
  check("the participant's pick → selected, selectedBy 'participant'",
    JSON.stringify(selectionPatch('idea_1', d)) === JSON.stringify({ selected: true, selectedBy: 'participant' }))
  check("a computer pick → selected, selectedBy 'computer'",
    JSON.stringify(selectionPatch(auto, d)) === JSON.stringify({ selected: true, selectedBy: 'computer' }))
  check('an idea left behind → selected false, tag cleared',
    JSON.stringify(selectionPatch(out, d)) === JSON.stringify({ selected: false, selectedBy: null }))
  check('patchChanges: no-op when the document already says so',
    !patchChanges({ selected: true, selectedBy: 'computer' }, { selected: true, selectedBy: 'computer' })
    && !patchChanges({ selected: true, selectedBy: 'participant' }, { selected: true, selectedBy: 'participant' })
    && !patchChanges({ selected: false }, { selected: false, selectedBy: null })
    && !patchChanges(undefined, { selected: false, selectedBy: null }))
  check('patchChanges: a legacy untagged pick that stays a participant pick is left alone',
    !patchChanges({ selected: true }, { selected: true, selectedBy: 'participant' }))
  check('patchChanges: true when it changes',
    patchChanges({ selected: false }, { selected: true, selectedBy: 'computer' })
    && patchChanges({ selected: true }, { selected: true, selectedBy: 'computer' })
    && patchChanges({ selected: true, selectedBy: 'computer' }, { selected: true, selectedBy: 'participant' })
    && patchChanges({ selected: true, selectedBy: 'computer' }, { selected: false, selectedBy: null })
    && patchChanges({ selected: true }, { selected: false, selectedBy: null }))
  check("carriedBy: '' | 'participant' | 'computer' | 'unrecorded' (a pick from before the tag existed)",
    carriedBy({ selected: false }) === '' && carriedBy(null) === '' && carriedBy({ selected: true }) === 'unrecorded'
    && carriedBy({ selected: true, selectedBy: null }) === 'unrecorded' && carriedBy({ selected: true, selectedBy: 'junk' }) === 'unrecorded'
    && carriedBy({ selected: true, selectedBy: 'participant' }) === 'participant' && carriedBy({ selected: true, selectedBy: 'computer' }) === 'computer'
    && carriedBy({ selected: false, selectedBy: 'computer' }) === '')
  check("a legacy untagged pick counts as the participant's own (never removed, never re-labelled)",
    isOwnPick({ selected: true }) && isOwnPick({ selected: true, selectedBy: 'participant' }) && !isOwnPick({ selected: true, selectedBy: 'computer' }) && !isOwnPick({ selected: false }))
  check('the tag text is what the owner asked for', COMPUTER_SELECTED_LABEL === 'Computer selected to group stage' && SELECTED_BY.COMPUTER === 'computer')
}

console.log('\n4. the confirmation sentence')
check('nothing carried → no sentence', carriedSummary(0, 0) === '')
check('all chosen by the participant', carriedSummary(3, 0) === '3 ideas carry into the group phase.')
check('mixed', carriedSummary(3, 2) === '3 ideas carry into the group phase: 1 you chose and 2 the computer selected at random.')
check('all by the computer', /selected by the computer at random because you chose none\.$/.test(carriedSummary(3, 3)))
check('singular', carriedSummary(1, 0) === '1 idea carries into the group phase.')

/* ── 5. uniformity of the draw ─────────────────────────────────────────── */
console.log('\n5. over Firestore-shaped random ids the pick is a uniform draw (measured, seeded)')
{
  // Firestore mints a 20-character id from this alphabet at random for every
  // idea; the pick orders ideas by a hash of that id. So across participants
  // (each with their own random ids) the computer's subset is uniformly
  // random. Deterministic PRNG (mulberry32) so the measurement is repeatable.
  let seed = 0x9e3779b9
  const rng = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const autoId = () => Array.from({ length: 20 }, () => ALPHA[Math.floor(rng() * ALPHA.length)]).join('')
  const N = 40000
  const count = [0, 0, 0, 0, 0]          // by creation position (1..5)
  const pairs = {}
  for (let r = 0; r < N; r++) {
    const list = Array.from({ length: 5 }, (_, i) => ({ id: autoId(), pos: i }))
    const d = topUpSelection({ ideas: list, selectedIds: [list[0].id], ideasCarried: 3 })
    const picked = list.filter(i => d.computerPicked.has(i.id)).map(i => i.pos).sort()
    picked.forEach(pos => { count[pos]++ })
    pairs[picked.join('+')] = (pairs[picked.join('+')] || 0) + 1
  }
  // 2 of the 4 unchosen ideas each time: each position appears with p = 1/2,
  // each of the 6 pairs with p = 1/6 — the ideas' creation order buys nothing.
  const perPos = count.slice(1).map(c => c / N)
  check("the participant's pick is never drawn", count[0] === 0)
  check('each unchosen idea is drawn about half the time (±2%)', perPos.every(p => Math.abs(p - 0.5) < 0.02), perPos.map(p => p.toFixed(3)).join(' '))
  const pairKeys = Object.keys(pairs)
  check('all 6 pairs occur, each about 1/6 of the time (±1.5%)', pairKeys.length === 6 && pairKeys.every(k => Math.abs(pairs[k] / N - 1 / 6) < 0.015), pairKeys.map(k => `${k}:${(pairs[k] / N).toFixed(3)}`).join(' '))
  check('n larger than the pool returns the whole pool', pickStable(ideas(5), 9).length === 5)
}

console.log('\n6. the stable picker')
{
  const list = ideas(6)
  const a = pickStable(list, 3).map(i => i.id)
  const b = pickStable([...list].reverse(), 3).map(i => i.id)
  const c = pickStable(list.sort(() => 0.5 - Math.random()), 3).map(i => i.id)
  check('same ids in any order → the same 3', a.join() === b.join() && a.join() === c.join(), `${a} | ${b} | ${c}`)
  check('n ≤ 0 → nothing', pickStable(list, 0).length === 0 && pickStable(list, -1).length === 0)
  // The whole decision is stable too — the property the group page and the
  // Cloud Function rely on to agree without talking to each other.
  const d1 = topUpSelection({ ideas: list, selectedIds: ['idea_3'], ideasCarried: 3 })
  const d2 = topUpSelection({ ideas: [...list].reverse(), selectedIds: new Set(['idea_3']), ideasCarried: 3 })
  check('the decision is the same from any reader', ids(d1.selection).join() === ids(d2.selection).join() && ids(d1.computerPicked).join() === ids(d2.computerPicked).join())
  check('and the same on every call', ids(topUpSelection({ ideas: list, selectedIds: ['idea_3'], ideasCarried: 3 }).computerPicked).join() === ids(d1.computerPicked).join())
}

/* ── 7. the vendored copy ──────────────────────────────────────────────── */
console.log('\n7. functions/carryForward.js is the same module')
{
  const body = p => read(p).replace(/\n(export \{|module\.exports = \{)[\s\S]*$/, '')
  const a = body(join(SRC, 'src', 'utils', 'carryForward.js'))
  const b = body(join(SRC, 'functions', 'carryForward.js'))
  check('identical up to the export line', a === b)
  check('the same names are exported', JSON.stringify(Object.keys(esm).sort()) === JSON.stringify(Object.keys(cjs).sort()), Object.keys(cjs).join())
  const dd = cjs.topUpSelection({ ideas: ideas(5), selectedIds: ['idea_2'], ideasCarried: 3 })
  const de = esm.topUpSelection({ ideas: ideas(5), selectedIds: ['idea_2'], ideasCarried: 3 })
  check('both copies decide alike', ids(dd.selection).join() === ids(de.selection).join())
}

/* ── 8. every consumer goes through the module ─────────────────────────── */
console.log('\n8. the consumers (by source)')
{
  const ind = read(join(SRC, 'src', 'pages', 'IndividualPhase.jsx'))
  const grp = read(join(SRC, 'src', 'pages', 'GroupPhase.jsx'))
  const fn = read(join(SRC, 'functions', 'session.js'))
  const exp = read(join(SRC, 'src', 'utils', 'sessionExport.js'))
  const ana = read(join(SRC, 'src', 'utils', 'analyticsData.js'))
  const dan = read(join(SRC, 'src', 'pages', 'DataAnalytics.jsx'))
  const adm = read(join(SRC, 'src', 'pages', 'AdminSession.jsx'))

  check('IndividualPhase imports the module and keeps no picker of its own',
    /from '\.\.\/utils\/carryForward'/.test(ind) && !/pickRandomStable|function hashStr|pickUniform|pickStable/.test(ind))
  check('the cap applies only when a group phase FOLLOWS (group_first carries nothing)',
    /const carriesForward = groupPhaseActive && getNextPhase\('individual', pc\) === 'group'/.test(ind))
  const md = ind.slice(ind.indexOf('async function markDone('), ind.indexOf('function autoFinish('))
  check('markDone is a bounded slice', md.length > 500 && md.length < 7000, String(md.length))
  check('markDone tops the selection up under that cap', /topUpSelection\(\{[\s\S]*?ideasCarried: carriesForward \? ideasCarried : 0/.test(md))
  check("markDone separates the participant's picks from the computer's and honours recorded computer picks",
    /const mine = new Set\(\[\.\.\.marked\]\.filter\(id => !computerIds\.has\(id\)\)\)/.test(md)
    && /priorComputer: prior/.test(md) && /carriedBy\(i\) === SELECTED_BY\.COMPUTER\)\.map\(i => i\.id\)/.test(md))
  check('markDone writes the tag through selectionPatch', /batch\.update\(ref, selectionPatch\(idea\.id, decision\)\)/.test(md))
  const batchAt = md.indexOf('batch.commit()')
  const flagAt = md.indexOf('individualComplete: true')
  check('the ideas batch lands BEFORE the participant is marked complete', batchAt > 0 && flagAt > batchAt, `batch@${batchAt} flag@${flagAt}`)
  check('a failed submit keeps the decided set on screen for the retry', !/setSelectedIds\(decision\.participantPicked\)/.test(md) && /press Finish & Submit again/.test(md))
  const af = ind.slice(ind.indexOf('function autoFinish('), ind.indexOf('function autoFinish(') + 200)
  check('the timer\'s auto-submit is the same call', /markDone\(\)/.test(af))
  check('toggleSelect tags a manual pick as the participant\'s and drops a computer pick', /selected: on, selectedBy: on \? SELECTED_BY\.PARTICIPANT : null/.test(ind) && /setComputerIds\(prev => \{ if \(!prev\.has\(ideaId\)\) return prev/.test(ind))
  check('the confirmation screen badges the computer\'s picks', ind.includes('COMPUTER_SELECTED_LABEL') && ind.includes('confirmBadgeAuto') && ind.includes('carriedSummary(carried.length, computerCount)'))
  check('the confirmation badges nothing when no group phase follows', /const isCarried = i => carriesForward && \(/.test(ind))
  check('the selection stage says at least one is needed and the REMAINING PLACES are filled at random (visible text, no tooltip)',
    /choose at least one; if you choose fewer than \{Math\.min\(ideasCarried, ideas\.length\)\}, the computer fills the remaining places at random from your other ideas/.test(ind)
    && /Choose at least one; if you choose fewer than \$\{Math\.min\(ideasCarried, ideas\.length\)\}, the computer fills the remaining places at random from your other ideas\./.test(ind)
    && !/selects the rest of your ideas|picks the rest for you/.test(ind)
    && /'Choose at least one idea first'/.test(ind))
  check('the workspace names a computer pick "Selected for you"', /computerIds\.has\(idea\.id\) \? '✓ Selected for you' : '✓ Selected'/.test(ind))
  check('a reload seeds both the carried set and the computer\'s picks from the documents',
    /if \(by\) sel\.add\(idea\.id\)/.test(ind) && /if \(by === SELECTED_BY\.COMPUTER\) auto\.add\(idea\.id\)/.test(ind) && /setComputerIds\(prev => prev\.size === 0 && auto\.size > 0 \? auto : prev\)/.test(ind))
  check('Finish & Submit still needs at least one pick (the k = 0 case is the clock\'s)', /const canFinish = ideas\.length > 0 && \(!groupPhaseActive \|\| hasSelection\) && !done/.test(ind))

  check('GroupPhase imports the module and keeps no picker of its own',
    /import \{ topUpSelection, carriedBy, isOwnPick, SELECTED_BY \} from '\.\.\/utils\/carryForward'/.test(grp) && !/pickRandomStable|function hashStr|pickStable|pickUniform/.test(grp))
  const lis = grp.slice(grp.indexOf('const memberKey ='), grp.indexOf('// ── Listen to chat messages'))
  check('the ideas listener is a bounded slice', lis.length > 800 && lis.length < 7000, String(lis.length))
  check("the group derives each member's set from their own picks (legacy untagged included), honouring recorded computer picks",
    /selectedIds: mine\.filter\(isOwnPick\)/.test(lis) && /priorComputer: mine\.filter\(i => carriedBy\(i\) === SELECTED_BY\.COMPUTER\)/.test(lis))
  check('the group page says the function is what covers an absent participant', /covered\s+\/\/ by the function alone|by the function alone/.test(lis))
  check("…and writes only the UNRECORDED computer picks back, for the participant's OWN ideas only",
    /if \(uid === myUid\) \{/.test(lis) && /const unrecorded = \[\.\.\.decision\.computerPicked\]\.filter/.test(lis) && /selectedBy: SELECTED_BY\.COMPUTER/.test(lis) && /healedRef\.current\.has\(id\)/.test(lis))
  check('the listener re-runs when the signed-in uid changes', /\[sessionId, groupId, memberKey, ideasCarried, myUid\]/.test(lis))

  check('the Cloud Function requires the vendored module', /require\('\.\/carryForward'\)/.test(fn))
  const adv = fn.slice(fn.indexOf('exports.advancePhase'), fn.indexOf('async function topUpCarriedIdeas'))
  check('advancePhase collects everyone entering the group phase', /if \(nextPhase === 'group' && newStatus === 'group'\) enteringGroup\.push\(pDoc\.id\)/.test(adv))
  const topAt = adv.indexOf('await topUpCarriedIdeas(')
  const commitAt = adv.indexOf('await batch.commit()')
  check('…and tops them up BEFORE the status flip is committed', topAt > 0 && commitAt > topAt, `topUp@${topAt} commit@${commitAt}`)
  const tu = fn.slice(fn.indexOf('async function topUpCarriedIdeas'), fn.indexOf('async function tallyGroupVotes'))
  check('the server honours recorded computer picks and writes through selectionPatch', /selectedIds: mine\.filter\(isOwnPick\)/.test(tu) && /priorComputer: mine\.filter\(i => carriedBy\(i\) === SELECTED_BY\.COMPUTER\)/.test(tu) && /selectionPatch\(r\.idea\.id, decision\)/.test(tu) && /patchChanges\(r\.idea, r\.patch\)/.test(tu))
  check("the server's writes are conditional on the document being as read, one batch per participant",
    /\{ lastUpdateTime: r\.updateTime \}/.test(tu) && /for \(const uid of participantIds\)/.test(tu) && /const b = db\.batch\(\)/.test(tu))
  check("the server's copy is not itself deployed as a function", !/exports\._topUpCarriedIdeas/.test(fn))

  check('the Ideas sheet carries "Carried by"', /'Carried by': carriedBy\(idea\)/.test(exp) && /import \{ carriedBy \} from '\.\/carryForward'/.test(exp))
  check('the Conditions sheet counts the computer-selected ones', /'Carried-to-group ideas \(computer-selected\)'/.test(exp))
  check('analytics rows carry carried_by, in and out (unrecorded included)', /carried_by: carriedBy\(idea\)/.test(ana) && /carried_by: carriedByFromCell\(pick\('carried by', 'carried_by', 'selected by'\)\)/.test(ana) && /'carried by', 'carried_by', 'selected by'/.test(ana) && /s === 'computer' \|\| s === 'participant' \|\| s === 'unrecorded'/.test(ana))
  check('the export explains the unrecorded value', /unrecorded = carried in a session before 2026-09-28/.test(exp))
  check('the admin badge explains a legacy pick', /carriedBy\(idea\) === 'unrecorded'/.test(adm))
  check('the analytics download carries it too', /'Carried by': r\.carried_by \|\| ''/.test(dan))
  check('the admin session page badges the computer\'s picks', /computer selected to group/.test(adm) && /ideaSummaryBadgeAuto/.test(adm) && /import \{ carriedBy \} from '\.\.\/utils\/carryForward'/.test(adm))
}

/* ── 9. the shipped bundle ─────────────────────────────────────────────── */
console.log('\n9. the shipped bundle (lab/ideasearchlab)')
{
  const html = read(join(SITE, 'lab', 'ideasearchlab', 'index.html'))
  const m = html.match(/assets\/(index-[^"']+\.js)/)
  const bundle = m && join(SITE, 'lab', 'ideasearchlab', 'assets', m[1])
  check('index.html names a bundle', !!bundle, html.slice(0, 200))
  if (bundle) {
    const js = existsSync(bundle) ? read(bundle) : ''
    check(`the bundle ${m[1]} exists`, js.length > 0)
    check('it carries the computer tag', js.includes(COMPUTER_SELECTED_LABEL))
    check('it carries the selectedBy field and the confirmation sentence',
      js.includes('selectedBy') && js.includes('the computer selected at random'))
    check('it carries the export column', js.includes('Carried by'))
  }
}

console.log(fail ? `\n${fail} check(s) FAILED` : '\nAll checks passed')
process.exit(fail ? 1 : 0)
