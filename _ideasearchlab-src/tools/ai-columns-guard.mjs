/**
 * ai-columns-guard.mjs — offline test (no network, no deps).
 *
 *   node _ideasearchlab-src/tools/ai-columns-guard.mjs
 *
 * Guards the per-model AI score columns of the Data Analytics page (owner,
 * 2026-09-24: "AI Novelty (GPT-6 Astra), AI Usefulness (GPT-6 Astra), and append
 * close to it the respective columns for another AI provider's model … first,
 * the empirical proxies … second, the AI estimated novelty and usefulness by
 * mentioning each model used"):
 *
 *  1. every model's scores live in its OWN two fields and are titled with its
 *     name; a score with no model name is "model not recorded", never guessed;
 *  2. the old novelty / usefulness / overall_quality fields are DERIVED (the
 *     mean across the models that rated the idea) and never imported;
 *  3. the column ORDER — empirical first, then the uploaded extras, then each
 *     model's pair, the means and AI Quality, then the evaluators;
 *  4. a downloaded file reads back to the same per-model fields (the round
 *     trip the "Upload full dataset" button depends on);
 *  5. the "Usefulness score check" sheet's arithmetic reproduces the score;
 *  6. the page is wired to all of it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  UNRECORDED, modelSlug, aiFieldsFor, aiNovKey, aiUseKey, parseAiHeader, aiModelName,
  aiColumnLabel, aiModelSlugs, labelUnrecordedScores, aiKpiDefs, shortModelName,
} from '../src/utils/aiScoreColumns.js'
import {
  normalizeImportedRows, recomputeOverall, presentKpis, exportKpiColumns, stripAllKpis,
  canonicalKpiField, analysisColumns, buildRowsForSession, KPI_DEFS,
  DEFAULT_NEED_SET, DEFAULT_TECH_SET,
} from '../src/utils/analyticsData.js'
import { scoreGaps, mergeAiScoresIntoRows, pickScoredSheet } from '../src/utils/scoreGaps.js'
import { usefulnessKpisFromText, percentileRanks } from '../src/utils/usefulnessKpis.js'
import { PROVIDERS } from '../src/data/aiModels.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = rel => readFileSync(join(here, '..', rel), 'utf8')

let failures = 0
function check(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); return }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

const ASTRA = aiFieldsFor('gpt-6-astra')
const GEM = aiFieldsFor('gemini-3.1-pro-preview')
const REC = aiFieldsFor(UNRECORDED)

// ── 1. Names and keys ───────────────────────────────────────────────────────
console.log('names and keys')
check('a model id becomes one safe slug', modelSlug('gpt-5.6-sol') === 'gpt_5_6_sol' && modelSlug('meta/muse-spark-1.3') === 'meta_muse_spark_1_3')
check('its two fields', ASTRA.novelty === 'ai_nov__gpt_6_astra' && ASTRA.usefulness === 'ai_use__gpt_6_astra')
check('its column titles', aiColumnLabel('novelty', 'gpt_6_astra') === 'AI Novelty (GPT-6 Astra)' && aiColumnLabel('usefulness', 'gpt_6_astra') === 'AI Usefulness (GPT-6 Astra)')
check('Gemini 3.1 Pro has a bracket-free title', aiColumnLabel('novelty', modelSlug('gemini-3.1-pro-preview')) === 'AI Novelty (Gemini 3.1 Pro Preview)')
check('a date in a label never reaches a title', shortModelName({ label: 'Claude Opus 5 (Jul 2026)' }) === 'Claude Opus 5')
check('every catalogue model has a title that reads back to it',
  PROVIDERS.every(p => p.models.every(m => {
    const a = parseAiHeader(aiColumnLabel('novelty', modelSlug(m.id)))
    return a && a.slug === modelSlug(m.id) && !a.derived
  })))
check('the unrecorded name', aiModelName(UNRECORDED) === 'model not recorded' && aiColumnLabel('usefulness', UNRECORDED) === 'AI Usefulness (model not recorded)')
const heads = {
  'AI Novelty (GPT-6 Astra)': ['novelty', 'gpt_6_astra', false],
  'ai usefulness (gpt-6-astra)': ['usefulness', 'gpt_6_astra', false],
  'AI Novelty (Claude Sonnet 5 — best speed/cost balance (Jun 2026))': null,   // handled below
  'AI Novelty (mean across models)': ['novelty', null, true],
  'AI Quality (GPT-6 Astra)': ['quality', null, true],
  'ai_use__gemini_3_8_flash': ['usefulness', 'gemini_3_8_flash', false],
  'Novelty': ['novelty', UNRECORDED, false],
  'AI Usefulness': ['usefulness', UNRECORDED, false],
  'AI Novelty (model not recorded)': ['novelty', UNRECORDED, false],
}
for (const [h, want] of Object.entries(heads)) {
  if (!want) continue
  const a = parseAiHeader(h)
  check(`parseAiHeader("${h}")`, a && a.kind === want[0] && a.slug === want[1] && a.derived === want[2], JSON.stringify(a))
}
check('not AI columns: empirical, evaluator, rater, NoveltyScore',
  ['Novelty (empirical)', 'Eval. Novelty', 'Novelty (rater 1)', 'NoveltyScore', 'Need fit (empirical)'].every(h => {
    const k = canonicalKpiField(h)
    return !k || !k.startsWith('ai_')
  }))
check('a model outside the catalogue keeps its name', (() => {
  const a = parseAiHeader('AI Novelty (Llama 3.3 70B)')
  return a && a.slug === 'llama_3_3_70b' && aiModelName(a.slug) === 'Llama 3.3 70B'
})())

// ── 2. Derived fields + import ──────────────────────────────────────────────
console.log('derived means and import')
{
  const one = recomputeOverall([{ [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4, novelty: '', usefulness: '' }])[0]
  check('one model: the AI fields equal its scores', one.novelty === 3 && one.usefulness === 4 && one.overall_quality === 3.5, JSON.stringify(one))
  const two = recomputeOverall([{ [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4, [GEM.novelty]: 5, [GEM.usefulness]: 1 }])[0]
  check('two models: the mean across them', two.novelty === 4 && two.usefulness === 2.5 && two.overall_quality === 3.25, JSON.stringify(two))
  const partial = recomputeOverall([{ [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4, [GEM.novelty]: '', [GEM.usefulness]: '' }])[0]
  check('a model that has not rated this idea does not count', partial.novelty === 3 && partial.usefulness === 4)
  const cleared = recomputeOverall([{ [ASTRA.novelty]: '', [ASTRA.usefulness]: '', novelty: 3, usefulness: 4, overall_quality: 3.5 }])[0]
  check('clearing a model\'s cells clears the derived fields and the quality', cleared.novelty === '' && cleared.usefulness === '' && cleared.overall_quality === '')
  const legacyOnlyQuality = recomputeOverall([{ novelty: '', usefulness: '', overall_quality: 4 }])[0]
  check('a row with no AI fields keeps a standalone quality (unchanged rule)', legacyOnlyQuality.overall_quality === 4)

  const [imp] = recomputeOverall(normalizeImportedRows([{
    'Idea ID': 'i1', Condition: 'None', Title: 't',
    'AI Novelty (GPT-6 Astra)': 3, 'AI Usefulness (GPT-6 Astra)': 4,
    'AI Novelty (Gemini 3.1 Pro Preview)': 5, 'AI Usefulness (Gemini 3.1 Pro Preview)': 2,
    'AI Novelty (mean across models)': 99, 'AI Usefulness (mean across models)': 99, 'AI Quality (mean across models)': 99,
    'Novelty (empirical)': 0.5,
  }]))
  check('each model lands in its own fields', imp[ASTRA.novelty] === 3 && imp[ASTRA.usefulness] === 4 && imp[GEM.novelty] === 5 && imp[GEM.usefulness] === 2)
  check('the derived columns are recomputed, never imported (the 99s are gone)', imp.novelty === 4 && imp.usefulness === 3 && imp.overall_quality === 3.5, JSON.stringify({ n: imp.novelty, u: imp.usefulness, q: imp.overall_quality }))
  check('no derived or model column comes back as an x_ extra', !Object.keys(imp).some(k => k.startsWith('x_')))
  const [old] = normalizeImportedRows([{ 'Idea ID': 'i2', Condition: 'Solo', Title: 't', Novelty: 2, Usefulness: 3, 'Novelty (objective)': 0.4 }])
  check('an older file with plain Novelty / Usefulness: "model not recorded"', old[REC.novelty] === 2 && old[REC.usefulness] === 3 && old.det_novelty === 0.4)
  // A plain column is a score with no model name — unless the file is the page's
  // analysis CSV, where it is the derived mean beside the ai_nov__ keys (decided
  // per FILE; see section 7).
  const [mixed] = normalizeImportedRows([{ 'Idea ID': 'i3', Condition: 'Solo', Title: 't', 'AI Novelty (GPT-6 Astra)': 3, Novelty: 5 }])
  check('a plain column beside a named one is "model not recorded"', mixed[ASTRA.novelty] === 3 && mixed[REC.novelty] === 5)
  const [analysis] = normalizeImportedRows([{ idea_id: 'i4', condition: 'Solo', text: 't', ai_nov__gpt_6_astra: 3, novelty: 3 }])
  check('the analysis CSV\'s bare novelty is the derived mean, never imported', analysis[ASTRA.novelty] === 3 && analysis[REC.novelty] === undefined)
  const blank = buildRowsForSession({ code: 'S' }, [{ id: 'i', title: 't' }], [], [])[0]
  check('a Firestore-built row carries no AI field at all', !Object.keys(blank).some(k => k.startsWith('ai_')) && blank.novelty === '')
  check('stripAllKpis drops every model\'s fields', !Object.keys(stripAllKpis([{ [ASTRA.novelty]: 3, [GEM.usefulness]: 2, novelty: 3 }])[0]).some(k => k.startsWith('ai_')))
}

// ── 3. The column order ─────────────────────────────────────────────────────
console.log('column order: empirical, then AI by model, then evaluators')
{
  const rows = recomputeOverall([
    { det_novelty: 0.4, det_score: 0.5, det_usefulness: 0.6, x_prototypicality: 0.3,
      [GEM.novelty]: 4, [GEM.usefulness]: 3, [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4, [REC.novelty]: 2,
      ext_novelty: 3, ext_usefulness: 3 },
  ])
  const labels = presentKpis(rows).map(d => d.label)
  const want = [
    'Novelty (empirical)', 'NoveltyScore', 'Usefulness score (empirical)', 'prototypicality',
    'AI Novelty (GPT-6 Astra)', 'AI Usefulness (GPT-6 Astra)',
    'AI Novelty (Gemini 3.1 Pro Preview)', 'AI Usefulness (Gemini 3.1 Pro Preview)',
    'AI Novelty (model not recorded)', 'AI Usefulness (model not recorded)',
    'AI Novelty (mean across models)', 'AI Usefulness (mean across models)', 'AI Quality (mean across models)',
    'Eval. Novelty', 'Eval. Usefulness', 'Eval. Quality',
  ]
  // "model not recorded" has only a Novelty value here; its Usefulness column is
  // still listed as the model's pair (the pair stays together).
  check('the exact order', JSON.stringify(labels) === JSON.stringify(want), labels.join(' | '))
  const single = presentKpis(recomputeOverall([{ [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4 }])).map(d => d.label)
  check('one model: no mean columns, AI Quality named after it',
    JSON.stringify(single) === JSON.stringify(['AI Novelty (GPT-6 Astra)', 'AI Usefulness (GPT-6 Astra)', 'AI Quality (GPT-6 Astra)']), single.join(' | '))
  const rank = exportKpiColumns([], { allEmpirical: true, evaluatorColumns: true }).map(d => d.label)
  check('the Rankings tab with nothing computed: the seven empirical columns, then the three evaluator columns',
    JSON.stringify(rank) === JSON.stringify([...KPI_DEFS.filter(d => d.source === 'det').map(d => d.label), 'Eval. Novelty', 'Eval. Usefulness', 'Eval. Quality']), rank.join(' | '))
  check('every empirical label says "empirical" or is a named score, none says "objective"',
    KPI_DEFS.filter(d => d.source === 'det').every(d => !/objective/i.test(d.label)))
  check('the analysis CSV carries each model\'s two fields', ['ai_nov__gpt_6_astra', 'ai_use__gemini_3_1_pro_preview'].every(k => analysisColumns(rows).includes(k)))
}

// ── 4. Round trip: downloaded titles read back to the same fields ─────────────
console.log('round trip')
{
  const rows = recomputeOverall([
    { idea_id: 'a', condition: 'None', text: 'A fever vest', [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4, [GEM.novelty]: 5, [GEM.usefulness]: 2, det_need_fit: 0.3 },
  ])
  const cols = exportKpiColumns(rows)
  const exported = rows.map(r => Object.fromEntries([['Idea ID', r.idea_id], ['Condition', r.condition], ['Title', 'A fever vest'],
    ...cols.map(c => [c.label, r[c.key]])]))
  const [back] = recomputeOverall(normalizeImportedRows(exported))
  check('every model\'s scores come back into their own fields',
    back[ASTRA.novelty] === 3 && back[ASTRA.usefulness] === 4 && back[GEM.novelty] === 5 && back[GEM.usefulness] === 2)
  check('the empirical value comes back', back.det_need_fit === 0.3)
  check('the derived means are the same after the trip', back.novelty === rows[0].novelty && back.usefulness === rows[0].usefulness)
  const picked = pickScoredSheet([{ name: 'ideas', rows: exported }])
  check('"Upload full dataset" counts the per-model columns as AI scores, not the means', picked && picked.scored === 4, JSON.stringify(picked && picked.scored))
  const merged = mergeAiScoresIntoRows([{ rid: 'r', idea_id: 'a', text: 'A fever vest', [ASTRA.novelty]: 3 }], normalizeImportedRows(exported))
  check('merging the file onto a partly rated dataset fills each model, keeps what is there',
    merged.rows[0][ASTRA.novelty] === 3 && merged.rows[0][ASTRA.usefulness] === 4 && merged.rows[0][GEM.novelty] === 5)
}

// ── 5. Per-model coverage and labelling ──────────────────────────────────────
console.log('coverage and labelling')
{
  const rows = [
    { idea_id: '1', text: 'a', [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4 },
    { idea_id: '2', text: 'b', [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4 },
    { idea_id: '3', text: 'c', [REC.novelty]: 2, [REC.usefulness]: 2 },
  ]
  check('coverage is per model: Astra rated 2 of 3', scoreGaps(rows, { fields: ASTRA }).scored === 2 && scoreGaps(rows, { fields: ASTRA }).fillable === 1)
  check('a second model has rated none, so all three are open to it', scoreGaps(rows, { fields: GEM }).fillable === 3)
  check('aiModelSlugs lists the models with data, unrecorded last', JSON.stringify(aiModelSlugs(rows)) === JSON.stringify(['gpt_6_astra', UNRECORDED]))
  const lab = labelUnrecordedScores(rows, 'gpt-6-astra')
  check('labelling moves the unrecorded scores onto the chosen model', lab.moved === 1 && lab.rows[2][ASTRA.novelty] === 2 && !(REC.novelty in lab.rows[2]))
  const clash = labelUnrecordedScores([{ [ASTRA.novelty]: 4, [REC.novelty]: 2, [REC.usefulness]: 3 }], 'gpt-6-astra')
  check('an existing score is never overwritten by labelling', clash.rows[0][ASTRA.novelty] === 4 && clash.rows[0][REC.novelty] === 2 && clash.rows[0][ASTRA.usefulness] === 3 && clash.conflicts === 1)
  check('aiKpiDefs marks each model\'s own columns editable (slug) and the means derived',
    aiKpiDefs(recomputeOverall([{ [ASTRA.novelty]: 3, [ASTRA.usefulness]: 3, [GEM.novelty]: 4, [GEM.usefulness]: 4 }]))
      .every(d => (d.slug ? !d.derived : d.derived)))
}

// ── 6. The "Usefulness score check" arithmetic ───────────────────────────────
console.log('usefulness check sheet')
{
  const ideas = [
    'Fever baby sleepsuit: a baby onesie that turns red when the baby has a fever above 37.5°C, so parents know at night without waking the baby.',
    'Smart fever shirt with a sensor and an app that sends an alert to your phone.',
    'Colour changing yoga mat for home workouts.',
    'Sports shirt for runners that shows where you are overheating during a workout, so you know when to slow down and drink water.',
    'Pet bandage that turns blue when the wound gets infected and warm, so owners can see it at home.',
    'A hat.',
    'Baby sleep bag that removes the battery or Bluetooth wearable device, turning the blanket into a passive fever map for parents.',
  ]
  const res = usefulnessKpisFromText(ideas, DEFAULT_NEED_SET, DEFAULT_TECH_SET)
  const r4 = x => (x == null ? null : Math.round(x * 1e4) / 1e4)
  // What the page stores (rounded to 4 dp), then the sheet's recomputation.
  const stored = res.perIdea.map(d => ({ nf: r4(d.needFit), sp: r4(d.specificity), wk: r4(d.workability), us: r4(d.usefulness) })).filter(d => d.us != null)
  const pn = percentileRanks(stored.map(d => d.nf)), ps = percentileRanks(stored.map(d => d.sp)), pw = percentileRanks(stored.map(d => d.wk))
  const worst = Math.max(...stored.map((d, i) => {
    const ranks = [pn[i], ps[i], pw[i]].filter(v => v != null)
    return Math.abs(ranks.reduce((a, b) => a + b, 0) / ranks.length - d.us)
  }))
  check('the mean of the three ranks reproduces the stored Usefulness score', worst < 0.001, `worst gap ${worst}`)
  check('the idea that removes the battery / Bluetooth needs no extra technology', res.perIdea[6].workability === 1, String(res.perIdea[6].workability))
  check('"A hat." is left blank', res.perIdea[5].usefulness == null)
}

// ── 7. The 2026-09-24 review's findings, each pinned ────────────────────────
console.log('review findings')
{
  const rt = raw => recomputeOverall(normalizeImportedRows(raw))[0]
  // 1. "model not recorded" survives every re-import the page offers.
  const u = rt([{ 'Idea ID': 'a', Condition: 'None', Title: 't', 'AI Novelty (model not recorded)': 2, 'AI Usefulness (model not recorded)': 3, 'AI Quality (model not recorded)': 2.5 }])
  check('1: "AI Novelty (model not recorded)" imports (it used to vanish)', u[REC.novelty] === 2 && u[REC.usefulness] === 3 && u.overall_quality === 2.5)
  const three = rt([{ 'Idea ID': 'a', Condition: 'None', Title: 't', 'AI Novelty (GPT-6 Astra)': 3, 'AI Usefulness (GPT-6 Astra)': 4,
    'AI Novelty (Gemini 3.1 Pro Preview)': 5, 'AI Usefulness (Gemini 3.1 Pro Preview)': 2, 'AI Novelty (model not recorded)': 1, 'AI Usefulness (model not recorded)': 1 }])
  check('1: beside named models too, so the mean keeps all three', three[REC.novelty] === 1 && three.novelty === 3, JSON.stringify({ rec: three[REC.novelty], mean: three.novelty }))
  const csv = rt([{ idea_id: 'a', condition: 'None', text: 't', novelty: 9, usefulness: 9, ai_nov__gpt_6_astra: 3, ai_use__gpt_6_astra: 4, ai_nov__unrecorded: 1, ai_use__unrecorded: 2 }])
  check('1: the analysis CSV: its ai_nov__unrecorded is kept, its bare (derived) novelty is not', csv[REC.novelty] === 1 && csv.novelty === 2 && csv.usefulness === 3)
  const hand = normalizeImportedRows([{ 'Idea ID': 'a', Condition: 'None', Title: 't', 'AI Novelty (GPT-6 Astra)': 3, Novelty: 5 }])[0]
  check('1: a hand-combined file keeps its plain column beside a named one (decided per file)', hand[ASTRA.novelty] === 3 && hand[REC.novelty] === 5)
  const top = mergeAiScoresIntoRows([{ rid: 'r', idea_id: 'a', text: 't' }], normalizeImportedRows([{ 'Idea ID': 'a', Condition: 'None', Title: 't', 'AI Novelty (model not recorded)': 2, 'AI Usefulness (model not recorded)': 2 }]))
  check('1: so "Upload full dataset" fills them instead of reporting "filled 0"', top.filled === 1 && top.rows[0][REC.novelty] === 2)
  // 5. Evaluator columns reload.
  const ev = rt([{ 'Idea ID': 'a', Condition: 'None', Title: 't', 'Eval. Novelty': 4, 'Eval. Usefulness': 2 }])
  check('5: "Eval. Novelty / Usefulness" reload into the evaluator fields', ev.ext_novelty === 4 && ev.ext_usefulness === 2 && ev.ext_quality === 3)
  const rat = rt([{ 'Idea ID': 'a', Condition: 'None', Title: 't', 'Novelty (rater 1)': 4, 'Novelty (rater 2)': 2, 'Eval. Novelty': 5 }])
  check('5: blind-rater columns still win when present (their mean)', rat.ext_novelty === 3)
  // 7. Imported values are kept as the file has them.
  check('7: an imported 0 stays 0 (it is not turned into a 1)', normalizeImportedRows([{ 'Idea ID': 'a', Condition: 'None', Title: 't', Novelty: 0 }])[0][REC.novelty] === 0)
  // 9. A per-model row's quality is always derived: clearing one component clears it.
  const q = recomputeOverall([{ [ASTRA.novelty]: 3, [ASTRA.usefulness]: '', overall_quality: 3.5 }])[0]
  check('9: clearing one AI component clears the stale quality', q.overall_quality === '', String(q.overall_quality))
  // 10. A model whose last value was cleared keeps its columns in the table.
  check('10: aiModelSlugs can count a model with only blank cells (the table keeps its columns)',
    JSON.stringify(aiModelSlugs([{ [GEM.novelty]: '' }], { includeBlank: true })) === JSON.stringify(['gemini_3_1_pro_preview']) && aiModelSlugs([{ [GEM.novelty]: '' }]).length === 0)
  const page = src('src/pages/DataAnalytics.jsx')
  check('3: a run asks first when ideas carry unlabelled scores', /unrecInScope && !confirm\(/.test(page) && /use "Label them"/.test(page))
  check('4: the chosen model\'s placeholder pair is not editable', /placeholder: true/.test(page) && /d\.source === 'ai' && d\.slug && !d\.placeholder/.test(page))
  check('6: the Rankings tab merges duplicate idea ids per column', /first non-blank\s*\n\s*\/\/ value wins/.test(page) || /blankV\(prev\[c\.key\]\) && !blankV\(r\[c\.key\]\)/.test(page))
  check('8: the CSV never prefixes a number', /typeof v !== 'number' && \/\^\[=\+\\-@/.test(page))
  check('11: the 3.2 upload counts ideas, not model pairs', /filledIdeas = res\.rows\.filter/.test(page))
  check('12: the Rankings hint lists exactly what the tab writes', /const labels = exportKpiColumns\(rows, \{ allEmpirical: true, evaluatorColumns: true \}\)/.test(page))
  const pr = src('src/utils/providerRequest.js')
  check('13: the "exhausted" message names no fixed token count', /spent its whole token ceiling on/.test(pr) && !/\$\{SCORING_MAX_TOKENS\}-token ceiling/.test(pr))
}

// ── 8. The page is wired to it ───────────────────────────────────────────────
console.log('page wiring')
{
  const page = src('src/pages/DataAnalytics.jsx')
  check('a run writes the chosen model\'s own fields', /const applyPassScores = \(list, byRid, fields\)/.test(page) && /applyPassScores\(working, byRid, fields\)/.test(page) && /applyPassScores\(prev, byRid, fields\)/.test(page))
  check('the run pins its fields from the model dropdown', /const fields = scoreFields/.test(page) && /ideaScoreState\(r, fields\)/.test(page))
  check('coverage is counted for the chosen model', /scoreGaps\(effectiveRows, \{ onlyFinal: scoreOnlyFinal, isFinal, fields: scoreFields \}\)/.test(page))
  check('the table\'s KPI columns follow exportKpiColumns, a model\'s own cells editable',
    /const tableKpiCols = useMemo/.test(page) && /exportKpiColumns\(effectiveRows\)/.test(page) && /d\.source === 'ai' && d\.slug/.test(page))
  check('the old fixed AI columns are gone from the table', !/novelty: \{ label: 'AI Novelty'/.test(page) && /const TABLE_COLS = \['idea_id', 'session', 'condition', 'phase', 'final', 'idea'\]/.test(page))
  check('"Download all data" exists and uses the shared idea sheet', /function downloadAllData\(\)/.test(page) && /addSheet\(wb, 'ideas', ideaExportRows\(data\)\)/.test(page) && /onClick=\{downloadAllData\}/.test(page))
  check('the 3.1 download uses the same sheet', /function downloadIdeasWithKpis\(\) \{[\s\S]{0,300}ideaExportRows\(data\)/.test(page))
  check('the check sheet is added when the Usefulness score exists', /addUsefulnessCheckSheet\(wb, data, techSet\)/.test(page) && /function addUsefulnessCheckSheet\(/.test(page))
  check('the Rankings tab takes the page\'s ordered columns', /rankingsSheetFromIdeas\(ideasSheet\.rows, valuesById, cols\)/.test(page) && /exportKpiColumns\(rows, \{ allEmpirical: true, evaluatorColumns: true \}\)/.test(page))
  check('the top-up merges every model in the file', /mergeAiScoresIntoRows\(rows, incoming\)/.test(page))
  check('unlabelled scores can be given a model', /labelUnrecordedScores\(rows, labelTarget\)/.test(page) && /Label them/.test(page))
  check('a derived AI column is never imported by the 3.1 upload', /if \(isDerivedAiKey\(canon\)\) continue/.test(page))
  const OLD_COPY = ['Deterministic and objective KPIs', 'Objective, repeatable', 'Obj. computed', 'Compute objective KPIs',
    '>Objective KPI<', 'objective KPIs (3.1)', 'objective compute', 'Novelty&nbsp;(objective)', 'Evaluator · Objective']
  const left = OLD_COPY.filter(t => page.includes(t))
  check('no "objective" wording left in the page\'s visible copy', left.length === 0, left.join(' | '))
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll AI-column checks passed.')
process.exit(failures ? 1 : 0)
