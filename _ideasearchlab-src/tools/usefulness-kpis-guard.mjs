/**
 * usefulness-kpis-guard.mjs — offline test (no network, no deps).
 *
 *   node _ideasearchlab-src/tools/usefulness-kpis-guard.mjs
 *
 * Guards the Section 3.1 objective USEFULNESS KPIs (src/utils/usefulnessKpis.js)
 * and the one design rule they exist for (owner 2026-09): usefulness must mean
 * something different from novelty, so no usefulness KPI may be computed from the
 * novelty KPIs' anchor (the reference set R) or from their similarities. Checks:
 *   - each measure's arithmetic (Need fit, Specificity, Workability, the composite,
 *     Peer vote share, the novelty × usefulness cross-check helpers),
 *   - that the composite does not move when only novelty moves, and leaves the
 *     behavioural vote share out,
 *   - that the default need set U does not reuse R's product words,
 *   - that every new KPI key is registered in every place a KPI must be for it to
 *     reach Section 4, the Rankings tab, the downloads, a re-import and the
 *     Python/R regressions (a KPI missing from one of them is dropped silently).
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  needFit, specificity, specificityFacets, FACETS, percentileRanks, usefulnessComposite,
  peerVoteShares, rowVoters, parseVoters, compileTerms, techTermsIn, workability,
  computeUsefulnessKpis, pearson, partialPearson, withinGroupPearson, median, quadrantCounts, contentText, foldPlural, STOP_WORDS,
} from '../src/utils/usefulnessKpis.js'
import { tfidfVectors } from '../src/utils/tfidf.js'
import { computeDeterministicKpis } from '../src/utils/deterministicKpis.js'
import {
  KPI_DEFS, COLUMNS, canonicalKpiField, normalizeImportedRows, buildRowsForSession,
  DEFAULT_REFERENCE_SET, DEFAULT_NEED_SET, DEFAULT_TECH_SET, stripAllKpis, scriptKpiKeys,
} from '../src/utils/analyticsData.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = p => readFileSync(join(here, '..', p), 'utf8')

let failures = 0
function check(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); return }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}
const near = (a, b, eps = 1e-9) => a != null && b != null && Math.abs(a - b) < eps

// ── Specificity ─────────────────────────────────────────────────────────────
console.log('Specificity — who / what / where-when / why / how')
{
  const full = 'Fever Onesie: a baby onesie that turns red when the baby has a fever, so parents can check at night without waking them.'
  const f = specificityFacets(full)
  check('a fully specified idea states all five parts', FACETS.every(x => f[x.key]), JSON.stringify(f))
  check('…and scores 1', specificity(full) === 1, String(specificity(full)))
  check('"Mood shirt" names only what it is (0.2)', near(specificity('Mood shirt'), 0.2), String(specificity('Mood shirt')))
  check('the verb "wear" is not a product ("easy to wear shirt" = what only)',
    near(specificity('easy to wear shirt'), 0.2), JSON.stringify(specificityFacets('easy to wear shirt')))
  check('"sportswear" counts as a product', specificityFacets('new sportswear line').what === true)
  check('vague fillers ("people", "anyone") do not count as WHO',
    specificityFacets('a shirt that anyone and all people can use').who === false)
  check('an idea with no text is null, not 0', specificity('') === null && specificity('   ') === null)
  // HOW counts only detail BEYOND the brief (and the worked example), or it fires for every idea.
  const how = t => specificityFacets(t).how
  check('HOW: restating the brief does not count', !how('A shirt that changes colour at body temperature') && !how('A vest, 37°C'))
  check('HOW: the worked example ("reveals a hidden pattern … body heat") does not count',
    !how('Body-Heat Reveal Tee: a t-shirt that reveals a hidden pattern wherever your body heat warms the fabric'))
  check('HOW: the colour it turns, a threshold other than 37, placement, construction, reset all count',
    how('a panel that turns red') && how('turns bright blue') && how('above 38 C') && how('a 39°C threshold') &&
    how('printed on the cuff') && how('goes back to white when cool'),
    ['a panel that turns red', 'above 38 C', 'a 39°C threshold', 'goes back to white when cool'].map(how).join())
  check('a facet counts once however many words hit it',
    near(specificity('baby child kid infant toddler'), 0.2), String(specificity('baby child kid infant toddler')))
}

// ── Workability ─────────────────────────────────────────────────────────────
console.log('Workability — 1 / (1 + extra technologies named)')
{
  const c = compileTerms(['app', 'battery', 'light up', 'sensor', 'ai', 'led'])
  check('no extra technology → 1', workability('A tee that reveals a pattern with body heat', c) === 1)
  check('one (an app) → 0.5', workability('A shirt linked to an app', c) === 0.5)
  check('plurals match ("apps", "batteries")', techTermsIn('apps and batteries', c).join() === 'app,battery',
    techTermsIn('apps and batteries', c).join())
  check('distinct entries count once ("app … app")', workability('an app, then another app', c) === 0.5)
  check('whole words only ("leading", "mapped", "paint" are not led / app / ai)',
    techTermsIn('leading brand, mapped path, paint', c).length === 0, techTermsIn('leading brand, mapped path, paint', c).join())
  check('a phrase matches with a hyphen ("light-up")', techTermsIn('a light-up sock', c).join() === 'light up')
  check('three technologies → 0.25', workability('sensors feed an AI app', c) === 0.25)
  check('no text → null', workability('', c) === null)
  check('the default list compiles and flags a typical gadget idea',
    workability('A bluetooth patch with a battery that sends data to an app', compileTerms(DEFAULT_TECH_SET)) === 0.2,
    String(workability('A bluetooth patch with a battery that sends data to an app', compileTerms(DEFAULT_TECH_SET))))
  // The worked example participants saw ends "no electronics needed": copying it
  // must read as needing LESS technology, not as naming electronics.
  const T = compileTerms(DEFAULT_TECH_SET)
  check('the worked example ("… no electronics needed") needs no extra technology',
    workability('Body-Heat Reveal Tee: a t-shirt that reveals a hidden pattern wherever your body heat warms the fabric, shifting as you move — no electronics needed.', T) === 1)
  const neg = [
    ['without batteries or apps', []], ['battery-free patch', []], ['does not need a battery', []],
    ["doesn't require sensors or LEDs", []], ['works without any extra electronics', []],
    ['an app, no batteries', ['app']], ['No app. It has a sensor', ['sensor']], ['a sensor-free led strip', ['led']],
  ]
  for (const [t, want] of neg) {
    const got = techTermsIn(t, c.concat(compileTerms(['electronics'])))
    check(`negation: "${t}" → [${want.join(', ')}]`, got.join() === want.join(), got.join())
  }
}

// ── Percentile ranks + composite ────────────────────────────────────────────
console.log('Percentile ranks and the Usefulness score')
{
  const pr = percentileRanks([0.1, 0.5, 0.5, null, 0.9])
  check('mid-ranks in [0,1], ties share a rank, null stays null',
    pr[0] === 0 && pr[1] === 0.5 && pr[2] === 0.5 && pr[3] === null && pr[4] === 1, JSON.stringify(pr))
  check('a single value gets 0.5', percentileRanks([null, 3])[1] === 0.5)
  const comp = usefulnessComposite([[0, 1, null], [1, null, null]])
  check('composite = mean of the available ranks; none → null',
    comp[0] === 0.5 && comp[1] === 1 && comp[2] === null, JSON.stringify(comp))
}

// ── Peer vote share ─────────────────────────────────────────────────────────
console.log('Peer vote share — teammates only, author excluded')
{
  const items = [
    { group: 'g', author: 'a', voters: ['b', 'c'], eligible: true },   // 2 of b,c,d
    { group: 'g', author: 'b', voters: ['a', 'b'], eligible: true },   // own vote dropped: 1 of a,c,d
    { group: 'g', author: 'c', voters: [], eligible: true },           // on the ballot, nobody: 0
    { group: 'g', author: 'd', voters: ['d'], eligible: true },        // only its author: 0
    { group: 'g', author: 'a', voters: null, eligible: true },         // voters unknown: null
    { group: 'g', author: 'a', voters: ['b'], eligible: false },       // not on a ballot: null
    { group: '', author: 'a', voters: ['b'], eligible: true },         // no group: null
  ]
  const v = peerVoteShares(items)
  check('share of the OTHER voters in the group who backed it', near(v[0], 2 / 3), String(v[0]))
  check('the author\'s own vote is left out', near(v[1], 1 / 3), String(v[1]))
  check('on the ballot with no votes → 0', v[2] === 0 && v[3] === 0, `${v[2]} ${v[3]}`)
  check('unknown voters / not on a ballot / no group → null, never 0',
    v[4] === null && v[5] === null && v[6] === null, `${v[4]} ${v[5]} ${v[6]}`)
  check('rowVoters: ids → list; 0 votes and no ids → nobody; count > 0 but no ids → unknown',
    JSON.stringify(rowVoters({ voted_by: 'a, b', votes: 2 })) === '["a","b"]' &&
    JSON.stringify(rowVoters({ voted_by: '', votes: 0 })) === '[]' &&
    rowVoters({ voted_by: '', votes: 3 }) === null && rowVoters({ voted_by: '', votes: '' }) === null &&
    rowVoters({}) === null)
  check('parseVoters splits on , ; |', JSON.stringify(parseVoters('a; b | c,d')) === '["a","b","c","d"]')
}

// ── Need fit + the independence rule ────────────────────────────────────────
console.log('Need fit — anchored on U, never on R')
{
  const ideas = [
    'Fever onesie: a baby onesie that turns red when the baby has a fever so parents notice at night',
    'Aura dress: a dress that changes colour to express your cosmic aura',
  ]
  const needs = ['spot a fever early in a baby or young child at night', 'let people express how they feel']
  const v = tfidfVectors([...ideas, ...needs].map(contentText)).vectors
  const nf = [needFit(v[0], v.slice(2)), needFit(v[1], v.slice(2))]
  check('the fever idea fits a need better than the aura idea', nf[0] > nf[1], JSON.stringify(nf))
  check('an empty U → null', needFit(v[0], []) === null)
  check('contentText drops stop words and keeps content words',
    contentText('A shirt that shows when the baby is hot') === 'shirt baby hot', contentText('A shirt that shows when the baby is hot'))
  check('contentText folds plurals ("pets" = "pet", "babies" = "baby", "patches" = "patch"; "bus" stays)',
    contentText('pets babies patches bus') === 'pet baby patch bus', contentText('pets babies patches bus'))
  check('foldPlural leaves short words and -ss/-us/-is alone', ['dress', 'virus', 'iris', 'gas'].every(w => foldPlural(w) === w))

  // Two ideas with IDENTICAL text-usefulness inputs but different novelty (one is
  // a word-for-word existing product, one is not) must get the SAME usefulness.
  const useVecs = [[1, 0], [1, 0]]
  const out = computeUsefulnessKpis(useVecs, [[1, 0]], ['A baby vest for parents', 'A baby vest for parents'], null, [])
  check('same need fit + specificity + workability → same Usefulness score whatever the novelty',
    out.perIdea[0].usefulness === out.perIdea[1].usefulness, JSON.stringify(out.perIdea.map(p => p.usefulness)))
  // The composite ignores the vote share entirely.
  const a = computeUsefulnessKpis([[1, 0], [0, 1]], [[1, 0]], ['baby vest', 'dog collar'],
    [{ group: 'g', author: 'x', voters: ['y'], eligible: true }, { group: 'g', author: 'y', voters: [], eligible: true }], [])
  const b = computeUsefulnessKpis([[1, 0], [0, 1]], [[1, 0]], ['baby vest', 'dog collar'],
    [{ group: 'g', author: 'x', voters: [], eligible: true }, { group: 'g', author: 'y', voters: ['x'], eligible: true }], [])
  check('the Usefulness score does not move when only the votes move',
    a.perIdea.map(p => p.usefulness).join() === b.perIdea.map(p => p.usefulness).join() &&
    a.perIdea[0].voteShare !== b.perIdea[0].voteShare)

  // The novelty side is computed from ideas + R alone: the same numbers whatever U is.
  const refs = DEFAULT_REFERENCE_SET
  const nv = tfidfVectors([...ideas, ...refs]).vectors
  const nov1 = computeDeterministicKpis(nv.slice(0, 2), nv.slice(2)).perIdea.map(d => d.novelty)
  check('the novelty KPIs never see U (vectorised from ideas + R only)', nov1.every(x => x != null && x > 0 && x <= 1), JSON.stringify(nov1))
}

// ── Cross-check helpers ─────────────────────────────────────────────────────
console.log('Novelty × usefulness cross-check')
{
  check('pearson: perfect + / − and null for < 3 pairs or a constant',
    near(pearson([1, 2, 3], [2, 4, 6]), 1) && near(pearson([1, 2, 3], [3, 2, 1]), -1) &&
    pearson([1, 2], [1, 2]) === null && pearson([1, 1, 1], [1, 2, 3]) === null)
  check('pearson skips pairs with a missing side', near(pearson([1, 2, null, 3], [2, 4, 9, 6]), 1))
  // Partial r must equal the r of the residuals after regressing x and y on z.
  const resid = (ys, zs) => {
    const mz = zs.reduce((a, b) => a + b, 0) / zs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length
    let szz = 0, szy = 0
    zs.forEach((zv, i) => { szz += (zv - mz) ** 2; szy += (zv - mz) * (ys[i] - my) })
    const b = szy / szz
    return ys.map((yv, i) => yv - my - b * (zs[i] - mz))
  }
  const px = [3, 1, 4, 1, 5, 9, 2, 6], py = [2, 7, 1, 8, 2, 8, 1, 8], pz = [1, 4, 1, 4, 2, 1, 3, 5]
  check('partialPearson equals the r of the residuals on z',
    near(partialPearson(px, py, pz), pearson(resid(px, pz), resid(py, pz)), 1e-9),
    `${partialPearson(px, py, pz)} vs ${pearson(resid(px, pz), resid(py, pz))}`)
  // Within-group r: group B's level is shifted up, which a pooled r would mistake for a relation.
  const wx = [1, 2, 3, 10, 11, 12], wy = [3, 2, 1, 13, 12, 11], wg = ['a', 'a', 'a', 'b', 'b', 'b']
  check('withinGroupPearson removes group levels (pooled r > 0, within-group r = -1)',
    pearson(wx, wy) > 0.9 && near(withinGroupPearson(wx, wy, wg), -1), `${pearson(wx, wy)} / ${withinGroupPearson(wx, wy, wg)}`)
  check('withinGroupPearson skips single-idea groups and missing values',
    near(withinGroupPearson([1, 2, 3, 9, null], [1, 2, 3, 0, 5], ['a', 'a', 'a', 'c', 'a']), 1))
  check('partialPearson: constant z → plain r', near(partialPearson([1, 2, 3], [2, 4, 6], [5, 5, 5]), 1))
  check('median of odd / even / with nulls', median([3, 1, 2]) === 2 && median([4, 1, 2, 3]) === 2.5 && median([null, 5]) === 5)
  const q = quadrantCounts([0.9, 0.9, 0.1, 0.1, null], [0.9, 0.1, 0.9, 0.1, 0.5], 0.5, 0.5)
  check('quadrants: both / novel only / useful only / neither, missing skipped',
    q.n === 4 && q.both === 1 && q.novelOnly === 1 && q.usefulOnly === 1 && q.neither === 1, JSON.stringify(q))
  check('"high" means strictly above the median', quadrantCounts([0.5], [0.5], 0.5, 0.5).neither === 1)
}

// ── Default lists ───────────────────────────────────────────────────────────
console.log('Default lists')
{
  const words = list => new Set(contentText(list.join(' ')).split(' ').filter(Boolean))
  const R = words(DEFAULT_REFERENCE_SET), U = words(DEFAULT_NEED_SET)
  const shared = [...U].filter(w => R.has(w))
  check('U shares only the core need words with R (fever, baby)', shared.every(w => ['fever', 'baby'].includes(w)), shared.join(', '))
  check('U and T are non-empty', DEFAULT_NEED_SET.length >= 10 && DEFAULT_TECH_SET.length >= 10)
  check('T avoids words the fabric itself covers or that are ambiguous',
    !['display', 'smart', 'heat', 'phone', 'screen', 'light', 'sound'].some(w => DEFAULT_TECH_SET.includes(w)))
  check('STOP_WORDS covers the function words the novelty tokeniser keeps', ['that', 'when', 'the', 'or', 'for'].every(w => STOP_WORDS.has(w)))
}

// ── Registry: every place a KPI must be registered ──────────────────────────
console.log('Registry — every new KPI reaches every consumer')
{
  const NEW = ['det_need_fit', 'det_specificity', 'det_workability', 'det_usefulness', 'det_vote_share']
  const defs = Object.fromEntries(KPI_DEFS.map(d => [d.key, d]))
  const py = src('src/data/analyticsPython.py')
  const R_ = src('src/data/analyticsR.R')
  const page = src('src/pages/DataAnalytics.jsx')
  const exp = src('src/utils/sessionExport.js')
  const allKpiKeys = (page.match(/const ALL_KPI_KEYS = \[([\s\S]*?)\]/) || [])[1] || ''
  check('ALL_KPI_KEYS slice found in DataAnalytics.jsx (a vacuous slice would pass everything)', allKpiKeys.length > 100)
  const blankRow = buildRowsForSession({ code: 'S' }, [{ id: 'i1', title: 't' }], [], [])[0]
  for (const k of NEW) {
    const d = defs[k]
    check(`${k}: in KPI_DEFS with a "(objective)" label, not on the 1–5 scale`, d && /\(objective\)$/.test(d.label) && d.scale5 === false, d && d.label)
    if (!d) continue
    check(`${k}: in COLUMNS (the analysis CSV)`, COLUMNS.includes(k))
    check(`${k}: canonicalKpiField routes its label AND its key back to it`,
      canonicalKpiField(d.label) === k && canonicalKpiField(k) === k, `${canonicalKpiField(d.label)} / ${canonicalKpiField(k)}`)
    check(`${k}: the importer reads its label`,
      normalizeImportedRows([{ Condition: 'Solo', Title: 'x', [d.label]: 0.42 }])[0][k] === 0.42)
    check(`${k}: a Firestore-built row starts blank`, blankRow[k] === '')
    check(`${k}: stripAllKpis blanks it`, stripAllKpis([{ [k]: 0.5 }])[0][k] === '')
    check(`${k}: in ALL_KPI_KEYS (DataAnalytics.jsx)`, allKpiKeys.includes(`'${k}'`))
    // Peer vote share is kept OUT of the Step-5 condition regressions (the Final
    // Ideas are chosen by those votes, and its mean falls with ballot size); the
    // page uses it to validate the other KPIs instead. Every other one is analysed.
    const pyKeys = (py.match(/^KPI_DEFS = \[([\s\S]*?)^\]/m) || [])[1] || ''
    const pyActive = pyKeys.split('\n').filter(l => !l.trim().startsWith('#')).join('\n')
    const rKeys = (R_.match(/KPI_KEYS\s*<-\s*c\(([\s\S]*?)\)/) || [])[1] || ''
    if (k === 'det_vote_share') {
      check(`${k}: NOT in the Python KPI_DEFS (regressions skip it on purpose)`, pyKeys.length > 100 && !pyActive.includes(`"${k}"`))
      check(`${k}: NOT in the R KPI_KEYS (regressions skip it on purpose)`, rKeys.length > 50 && !rKeys.includes(`"${k}"`))
      check(`${k}: both scripts say how to add it back`, py.includes(`add: ("${k}"`) && R_.includes(`"${k}" to KPI_KEYS`))
    } else {
      check(`${k}: in the Python KPI_DEFS with the same label`, pyActive.includes(`("${k}", "${d.label}", False)`))
      check(`${k}: in the R KPI_KEYS / KPI_LABELS / KPI_SCALE5`,
        rKeys.includes(`"${k}"`) && R_.includes(`${k}="${d.label}"`) && R_.includes(`${k}=FALSE`))
    }
    check(`${k}: a column of the aggregate Rankings tab`, exp.includes(`'${d.label}':`))
  }
  check('the old novelty labels still route (no regression)',
    canonicalKpiField('Novelty (objective)') === 'det_novelty' && canonicalKpiField('Combined score') === 'det_score' &&
    canonicalKpiField('Pool distinctiveness') === 'det_distinctiveness' && canonicalKpiField('Usefulness') === 'usefulness' &&
    canonicalKpiField('Eval. Usefulness') === 'ext_usefulness')
  // Stale saved scripts: the page compares the template's registry with the script's.
  const pyNow = scriptKpiKeys(py, 'python'), rNow = scriptKpiKeys(R_, 'r')
  check('scriptKpiKeys reads the Python and R registries (new keys in, the vote share out)',
    pyNow && rNow && ['det_need_fit', 'det_workability', 'det_usefulness', 'novelty', 'det_score'].every(k => pyNow.has(k) && rNow.has(k)) &&
    !pyNow.has('det_vote_share') && !rNow.has('det_vote_share'),
    `${pyNow && [...pyNow].join(',')} | ${rNow && [...rNow].join(',')}`)
  const oldPy = py.replace(/^\s*\("det_(need_fit|specificity|workability|usefulness)".*\n/gm, '')
  check('an older script without the new keys is detected as missing them',
    ['det_need_fit', 'det_usefulness'].every(k => !scriptKpiKeys(oldPy, 'python').has(k)) && scriptKpiKeys(oldPy, 'python').has('det_score'))
  check('a restructured script (no registry) gives null, so nothing is flagged', scriptKpiKeys('print(1)', 'python') === null)
  check('Step 5 wires the warning under Run',
    /const staleKpis = useMemo/.test(page) && page.includes('scriptKpiKeys(code, lang)') && page.includes('{staleKpis.length > 0 && ('))
  check('a det_* key column is no longer re-imported as an x_ duplicate',
    !Object.keys(normalizeImportedRows([{ Condition: 'Solo', Title: 'x', det_distinctiveness: 0.37 }])[0]).some(k => k.startsWith('x_')))
}

// ── Votes on the rows ───────────────────────────────────────────────────────
console.log('Vote counts on the analysis rows')
{
  const parts = [
    { id: 'p1', groupId: 'g0', votedFor: ['i1', 'i2'] },
    { id: 'p2', groupId: 'g0', votedFor: ['i1'] },
    { id: 'p3', groupId: '', votedFor: ['i1'] },               // detached: not counted (the tally's rule)
    { id: 'p4', groupId: 'g0', removed: true, votedFor: ['i2'] },
  ]
  const rows = buildRowsForSession({ code: 'S' }, [{ id: 'i1', authorId: 'p1' }, { id: 'i2', authorId: 'p2' }, { id: 'i3', authorId: 'p1' }], parts, [])
  check('votes counted over the ballots the tally counts', rows[0].votes === 2 && rows[1].votes === 1 && rows[2].votes === 0,
    rows.map(r => r.votes).join())
  check('voted_by lists the counted voters', rows[0].voted_by === 'p1, p2' && rows[1].voted_by === 'p1' && rows[2].voted_by === '')
  const imp = normalizeImportedRows([{ Condition: 'Solo', Title: 'x', 'Vote Count': 2, 'Voted By (IDs)': 'a, b' }])[0]
  check('the importer reads Vote Count + Voted By (IDs)', imp.votes === 2 && imp.voted_by === 'a, b', `${imp.votes} ${imp.voted_by}`)
  check('"Voted By (IDs)" is not swept in as an x_ KPI', !Object.keys(imp).some(k => k.startsWith('x_')))
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll usefulness-KPI checks passed.')
process.exit(failures ? 1 : 0)
