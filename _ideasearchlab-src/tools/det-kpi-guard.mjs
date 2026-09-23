// det-kpi-guard.mjs — offline checks for the Data Analytics Section 3.1 objective
// KPIs (Novelty / Distinctiveness / Score / Unique fraction), no network.
//
//   node _ideasearchlab-src/tools/det-kpi-guard.mjs
//
// Pins the "idea with no words" rule: an idea whose text has no word the TF-IDF
// tokeniser reads ("", "   ", "?", "a", Greek text) vectorises to all zeros, and a
// zero vector has cosine 0 with everything — which the formulas read as "as
// different as possible". Such an idea used to score Novelty 1, Distinctiveness 1
// and Score 1, i.e. the TOP of the ranking, sat in every other idea's
// Distinctiveness mean as a fake "completely different" neighbour, and counted as
// a unique concept in the Unique fraction. It must now be left blank, kept out of
// every pool, and kept out of the TF-IDF corpus, so the real ideas get EXACTLY the
// numbers they would get without it.
//
// Runs the same code the page runs (src/utils/objectiveKpis.js), pins that the page
// goes through it, and — when python3 + numpy are available — checks the offline
// twin _idea-kpi-script/idea_kpis.py gives the same numbers.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { tfidfVectors, tokenize } from '../src/utils/tfidf.js'
import {
  hasTerms, novelty, distinctiveness, measuredUniqueFraction, computeDeterministicKpis,
} from '../src/utils/deterministicKpis.js'
import { objectiveKpisFromText, isReadable } from '../src/utils/objectiveKpis.js'
import {
  DEFAULT_REFERENCE_SET, KPI_DEFS, canonicalKpiField, isNoveltyScoreHeader, normalizeImportedRows,
} from '../src/utils/analyticsData.js'
import { pickScoredSheet } from '../src/utils/scoreGaps.js'

const HERE = dirname(fileURLToPath(import.meta.url))
let pass = 0, fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  [PASS] ${name}`) }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ''}`) }
}
const same = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= 1e-12)

const REAL = [
  'Thermochromic socks: socks that change colour at body temperature',
  'Fever pillowcase: a pillowcase that changes colour when a sleeping child has a fever',
  'Heat-map running sleeve: a compression sleeve that shows which muscles warm up during a run',
  'Mood hoodie: a thermochromic hoodie whose colour shifts with body heat',
  'Colour-change baby onesie that warns parents when the baby overheats',
]
const WORDLESS = ['', '   ', '?', 'a', '— !', 'Καλημέρα κόσμε', '你好']

console.log('\n--- building blocks ---')
check('hasTerms: zero vector is false', hasTerms([0, 0, 0]) === false)
check('hasTerms: empty / missing vector is false', hasTerms([]) === false && hasTerms(null) === false)
check('hasTerms: a real vector is true', hasTerms([0, 0.2, 0]) === true)
check('isReadable: blank, punctuation, one letter, Greek, Chinese are not readable',
  WORDLESS.every(t => !isReadable(t)))
check('isReadable: a two-letter word is readable', isReadable('ok'))
check('novelty of a zero-vector idea is null (was 1)', novelty([0, 0], [[1, 0]]) === null)
check('novelty ignores a wordless reference item', novelty([1, 0], [[0, 0], [1, 0]]) === 0)
check('novelty is null when every reference item is wordless', novelty([1, 0], [[0, 0]]) === null)
check('novelty is null for an empty R', novelty([1, 0], []) === null)
{
  const row = [1, 0.6, 0]   // idea 0 vs [itself, a real idea, a wordless idea]
  check('distinctiveness without a mask keeps the old N−1 mean', same(distinctiveness(row, 0), 1 - 0.6 / 2))
  check('distinctiveness leaves the masked-out idea out of the mean', same(distinctiveness(row, 0, [true, true, false]), 0.4))
  check('distinctiveness of a masked-out idea is null', distinctiveness(row, 2, [true, true, false]) === null)
  check('distinctiveness with no other member is null', distinctiveness([1, 0.3], 0, [true, false]) === null)
}
{
  const a = [1, 0], b = [0.6, 0.8], z = [0, 0]
  check('unique fraction ignores zero vectors (2 real ideas, 3 wordless)',
    same(measuredUniqueFraction([a, z, b, z, z], 0.8), 1))
  check('unique fraction of only-wordless ideas is null', measuredUniqueFraction([z, z], 0.8) === null)
}
{
  const r = computeDeterministicKpis([[1, 0], [0, 0], [0.6, 0.8]], [[1, 0]])
  check('computeDeterministicKpis: wordless idea gets null on all three KPIs',
    r.perIdea[1].novelty === null && r.perIdea[1].distinctiveness === null && r.perIdea[1].score === null)
  check('computeDeterministicKpis reports measured / unmeasured counts', r.measured === 2 && r.unmeasured === 1)
  check('computeDeterministicKpis: a real idea is averaged over real ideas only',
    same(r.perIdea[0].distinctiveness, 1 - 0.6))
}

console.log('\n--- the page pipeline (objectiveKpisFromText) ---')
const base = objectiveKpisFromText(REAL, DEFAULT_REFERENCE_SET)
check('pipeline runs on real ideas', !base.error && base.perIdea.length === REAL.length && base.unmeasured === 0)
// Interleave the wordless ideas among the real ones, as they arrive in real data.
const mixed = [], where = []
REAL.forEach((t, i) => { mixed.push(t); where.push(i); if (i < WORDLESS.length) { mixed.push(WORDLESS[i]); where.push(-1) } })
WORDLESS.slice(REAL.length).forEach(t => { mixed.push(t); where.push(-1) })
const got = objectiveKpisFromText(mixed, [...DEFAULT_REFERENCE_SET, '', '?'])
check('pipeline runs with wordless ideas present', !got.error)
check(`every wordless idea is left blank (${WORDLESS.length} of them)`,
  where.every((w, k) => w !== -1 || (got.perIdea[k].novelty === null && got.perIdea[k].distinctiveness === null && got.perIdea[k].score === null)))
check('wordless ideas are counted as unmeasured', got.unmeasured === WORDLESS.length && got.measured === REAL.length)
let unchanged = true
where.forEach((w, k) => {
  if (w === -1) return
  for (const kpi of ['novelty', 'distinctiveness', 'score']) {
    if (!same(got.perIdea[k][kpi], base.perIdea[w][kpi])) {
      unchanged = false
      console.log(`      idea ${w + 1} ${kpi}: ${got.perIdea[k][kpi]} vs ${base.perIdea[w][kpi]} without wordless ideas`)
    }
  }
})
check('real ideas get EXACTLY the numbers they get without wordless ideas (pool AND IDF)', unchanged)
check('wordless reference lines are dropped from R', got.refs.length === DEFAULT_REFERENCE_SET.length)
{
  const scored = got.perIdea.map((p, k) => ({ p, k })).filter(x => x.p.score != null)
  const top = scored.sort((x, y) => y.p.score - x.p.score)[0]
  check('the top-ranked idea is a real idea, not a blank one', where[top.k] !== -1)
}
{
  // The bug itself, reproduced on the pre-fix arithmetic: vectorise everything
  // together and score it with no mask — the blank idea tops the ranking with 1s.
  const texts = [...REAL, '']
  const { vectors } = tfidfVectors([...texts, ...DEFAULT_REFERENCE_SET])
  const iv = vectors.slice(0, texts.length), rv = vectors.slice(texts.length)
  const n = iv.length
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
  const oldNov = 1 - Math.max(...rv.map(r => dot(iv[n - 1], r)))
  const oldDist = 1 - iv.slice(0, n - 1).reduce((s, v) => s + dot(iv[n - 1], v), 0) / (n - 1)
  check('(the bug) the old unmasked formulas gave a blank idea Novelty 1 and Distinctiveness 1',
    oldNov === 1 && oldDist === 1, `got ${oldNov}, ${oldDist}`)
  const now = objectiveKpisFromText(texts, DEFAULT_REFERENCE_SET)
  check('(the fix) the same blank idea is now blank', now.perIdea[n - 1].score === null)
}
check('error when fewer than two ideas have words',
  /At least two ideas/.test(objectiveKpisFromText(['Thermochromic socks', '', '?'], DEFAULT_REFERENCE_SET).error || ''))
check('error when the reference set has no words',
  /reference set R is empty/.test(objectiveKpisFromText(REAL, ['', '?', 'a']).error || ''))
check('tokenize is unchanged (2+ lowercase letters/digits)',
  JSON.stringify(tokenize('Colour-change T-shirt, 37°C!')) === JSON.stringify(['colour', 'change', 'shirt', '37']))

console.log('\n--- the page goes through the pipeline ---')
{
  const src = readFileSync(join(HERE, '../src/pages/DataAnalytics.jsx'), 'utf8')
  const start = src.indexOf('async function computeDeterministic(')
  const end = src.indexOf('// ── Section 3.1: upload additional', start)
  const body = start >= 0 && end > start ? src.slice(start, end) : ''
  check('found computeDeterministic in DataAnalytics.jsx', body.length > 500, `slice length ${body.length}`)
  check('computeDeterministic scores through objectiveKpisFromText', /objectiveKpisFromText\(/.test(body))
  check('computeDeterministic does not vectorise on its own (no tfidfVectors / computeDeterministicKpis call)',
    !/tfidfVectors\(|computeDeterministicKpis\(/.test(body))
  check('the per-condition Unique fraction skips wordless ideas (measuredUniqueFraction)',
    /measuredUniqueFraction\(/.test(body) && !/[^d]uniqueFraction\(/.test(body))
}

console.log('\n--- the combined KPI is labelled NoveltyScore (owner, 2026-09-23) ---')
// Its header contains "novelty", so every importer must recognise it BEFORE any
// "novelty" substring match — otherwise a re-uploaded NoveltyScore column would be
// filed as the AI Novelty score.
{
  const det = KPI_DEFS.find(d => d.key === 'det_score')
  check('KPI_DEFS labels det_score "NoveltyScore"', det && det.label === 'NoveltyScore')
  const heads = { 'NoveltyScore': 'det_score', 'Novelty Score': 'det_score', 'novelty_score': 'det_score',
    'Obj. NoveltyScore': 'det_score', 'Combined score': 'det_score', 'Obj. Score': 'det_score',
    'Novelty': 'novelty', 'AI Novelty': 'novelty', 'Novelty (objective)': 'det_novelty',
    'Obj. Novelty': 'det_novelty', 'Pool distinctiveness': 'det_distinctiveness', 'Eval. Novelty': 'ext_novelty' }
  const wrong = Object.entries(heads).filter(([h, want]) => canonicalKpiField(h) !== want)
  check('canonicalKpiField: NoveltyScore (new and old spellings) → det_score, Novelty headers unchanged',
    wrong.length === 0, wrong.map(([h, w]) => `${h} → ${canonicalKpiField(h)} (want ${w})`).join('; '))
  check('isNoveltyScoreHeader is true only for the NoveltyScore header',
    isNoveltyScoreHeader('NoveltyScore') && !isNoveltyScoreHeader('Novelty') && !isNoveltyScoreHeader('AI Novelty')
    && !isNoveltyScoreHeader('Novelty (objective)'))
  // The page's own "Download ideas + KPIs" headers (KPI_DEFS labels), read back in.
  const exported = [{ 'Idea ID': 'i1', 'Condition': 'None', 'Title': 'Fever pillowcase', 'Description': 'x',
    'AI Novelty': 3, 'AI Usefulness': 4, 'AI Quality': 3.5,
    'Novelty (objective)': 0.61, 'Pool distinctiveness': 0.93, 'NoveltyScore': 0.77 }]
  const [row] = normalizeImportedRows(exported)
  check('re-import: NoveltyScore → det_score, not AI Novelty',
    row.det_score === 0.77 && row.novelty === 3 && row.det_novelty === 0.61 && row.det_distinctiveness === 0.93,
    JSON.stringify({ novelty: row.novelty, det_score: row.det_score, det_novelty: row.det_novelty }))
  check('re-import: NoveltyScore is not also carried as an uploaded extra (x_) column',
    !Object.keys(row).some(k => /^x_.*novelty/.test(k)))
  const [only] = normalizeImportedRows([{ 'Idea ID': 'i2', 'Title': 't', 'NoveltyScore': 0.5 }])
  check('re-import: a file with ONLY NoveltyScore leaves AI Novelty empty', only.novelty === '' && only.det_score === 0.5)
  const [legacy] = normalizeImportedRows([{ 'Idea ID': 'i3', 'Title': 't', 'Combined score': 0.4 }])
  check('re-import: an older file\'s "Combined score" still lands in det_score', legacy.det_score === 0.4)
  const picked = pickScoredSheet([
    { name: 'Rankings', rows: [{ 'Idea ID': 'i1', 'Novelty': '', 'Usefulness': '', 'NoveltyScore': 0.5 }] },
  ])
  check('"Upload full dataset" does not count NoveltyScore values as AI scores', picked && picked.scored === 0,
    JSON.stringify(picked && { scored: picked.scored }))
  const exp = readFileSync(join(HERE, '../src/utils/sessionExport.js'), 'utf8')
  check('the Rankings export column is "NoveltyScore" (and no "Combined score" column is left)',
    /'NoveltyScore': sc \? blank\(sc\.detScore\)/.test(exp) && !/'Combined score':/.test(exp))
  const page = readFileSync(join(HERE, '../src/pages/DataAnalytics.jsx'), 'utf8')
  check('the 3.2 AI-scores upload skips the NoveltyScore column when it looks for "Novelty"',
    /const ciNov = find\(c => c\.includes\('novelty'\) && !isNoveltyScoreHeader\(c\)/.test(page))
  check('the page no longer shows the bare "Score" / "Combined score" label for this KPI',
    !/their mean <em>Score<\/em>|Distinctiveness \/ Score for|Obj\.&nbsp;Score/.test(page))
}

console.log('\n--- parity with the offline Python twin (_idea-kpi-script/idea_kpis.py) ---')
{
  const py = spawnSync('python3', ['-c', 'import numpy'], { encoding: 'utf8' })
  if (py.status !== 0) {
    console.log('  [SKIP] python3 with numpy not available')
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'detkpi-'))
    try {
      writeFileSync(join(dir, 'in.json'), JSON.stringify({ texts: mixed, refs: [...DEFAULT_REFERENCE_SET, '', '?'] }))
      const script = [
        'import json, sys',
        `sys.path.insert(0, ${JSON.stringify(join(HERE, '../../_idea-kpi-script'))})`,
        'import idea_kpis as k',
        `d = json.load(open(${JSON.stringify(join(dir, 'in.json'))}))`,
        'ideas = [{"text": t, "group_uid": ""} for t in d["texts"]]',
        'r = k.compute_kpis(ideas, d["refs"], k.TfidfBackend())',
        'print(json.dumps([[it["novelty"], it["distinctiveness"], it["score"]] for it in r["ideas"]]))',
      ].join('\n')
      const out = spawnSync('python3', ['-c', script], { encoding: 'utf8' })
      if (out.status !== 0) {
        check('Python twin runs', false, out.stderr.slice(-400))
      } else {
        const pyRows = JSON.parse(out.stdout.trim().split('\n').pop())
        let maxDiff = 0, nullsAgree = true
        pyRows.forEach((row, k) => {
          const js = [got.perIdea[k].novelty, got.perIdea[k].distinctiveness, got.perIdea[k].score]
          row.forEach((v, j) => {
            if ((v == null) !== (js[j] == null)) nullsAgree = false
            else if (v != null) maxDiff = Math.max(maxDiff, Math.abs(v - js[j]))
          })
        })
        check('Python twin leaves the same ideas blank', nullsAgree)
        check(`Python twin gives the same numbers (max diff ${maxDiff.toExponential(1)})`, maxDiff < 1e-9)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}

console.log(`\n${fail === 0 ? 'ALL PASSED' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
