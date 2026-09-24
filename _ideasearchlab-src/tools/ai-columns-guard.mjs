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
 *  6. each review finding stays fixed (sections 7 and 7b): which headers are
 *     AI scores, evaluator ratings or extras, the unrecorded pair moving whole;
 *  7. matchScoreTable matches a score file ONE idea per row (Idea ID, then
 *     title) and aiPanelCoverage says whether every idea had the same models;
 *  8. the page is wired to all of it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  UNRECORDED, modelSlug, aiFieldsFor, aiNovKey, aiUseKey, parseAiHeader, aiModelName,
  aiColumnLabel, aiModelSlugs, labelUnrecordedScores, aiKpiDefs, shortModelName,
  isBareAiScoreHeader, rememberModelName, aiPanelCoverage, slugFromModelName,
} from '../src/utils/aiScoreColumns.js'
import {
  normalizeImportedRows, recomputeOverall, presentKpis, exportKpiColumns, stripAllKpis,
  canonicalKpiField, analysisColumns, buildRowsForSession, KPI_DEFS,
  DEFAULT_NEED_SET, DEFAULT_TECH_SET, matchScoreTable, parseEvalHeader, evaluatorMean,
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

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

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
  // A catalogue model's full dropdown label, brackets inside brackets: the slug
  // comes from the catalogue, not a new model named after the whole label.
  'AI Novelty (Claude Sonnet 5 — best speed/cost balance (Jun 2026))': ['novelty', 'claude_sonnet_5', false],
  'AI Novelty (mean across models)': ['novelty', null, true],
  'AI Quality (GPT-6 Astra)': ['quality', null, true],
  'ai_use__gemini_3_8_flash': ['usefulness', 'gemini_3_8_flash', false],
  'Novelty': ['novelty', UNRECORDED, false],
  'AI Usefulness': ['usefulness', UNRECORDED, false],
  'AI Novelty (model not recorded)': ['novelty', UNRECORDED, false],
}
for (const [h, want] of Object.entries(heads)) {
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
  // The pair moves whole or not at all: here the model already holds a Novelty, so
  // neither half moves (moving only the Usefulness would pair Astra's own Novelty
  // with another file's Usefulness).
  const clash = labelUnrecordedScores([{ [ASTRA.novelty]: 4, [REC.novelty]: 2, [REC.usefulness]: 3 }], 'gpt-6-astra')
  check('an existing score is never overwritten by labelling, and the pair is not split',
    clash.rows[0][ASTRA.novelty] === 4 && clash.rows[0][REC.novelty] === 2 && clash.rows[0][REC.usefulness] === 3
      && clash.rows[0][ASTRA.usefulness] === undefined && clash.conflicts === 1 && clash.moved === 0, JSON.stringify(clash))
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
  check('10: …and the table uses it (plus the catalogue order), so a cleared model stays in place',
    /sortModelSlugs\(\[\.\.\.aiModelSlugs\(effectiveRows, \{ includeBlank: true \}\)/.test(src('src/pages/DataAnalytics.jsx')))
  const page = src('src/pages/DataAnalytics.jsx')
  // Pin the BEHAVIOUR, not an identifier: Cancel must stop the run (`)) return`).
  check('3: a run asks first when ideas carry unlabelled scores, and Cancel stops it',
    /unrecInScope && !confirm\(/.test(page) && /use "Label them"/.test(page) && /anyway, as a separate column\.`\)\) return\n/.test(page))
  check('4: the chosen model\'s pair is read-only until it has a field; a blank model cell is never typed into',
    /sl === scoreSlug && fresh \? \{ \.\.\.d, placeholder: true \}/.test(page)
    && /d\.source === 'ai' && d\.slug && !d\.placeholder && \(hasScore \|\| editingCell === cellId\)/.test(page))
  // The merge itself is tested in Node (analytics-page-guard section 0); here, that
  // the page uses it with the recompute.
  check('6: the Rankings tab merges each idea\'s copies and rebuilds the means',
    /ideaValueLookup\(rows, cols, r => recomputeOverall\(\[r\]\)\[0\]\)/.test(page) && /rankingsSheetFromIdeas\(ideasSheet\.rows, lookup, cols\)/.test(page))
  check('8: the CSV never prefixes a number', /typeof v !== 'number' && \/\^\[=\+\\-@/.test(page))
  check('11: the 3.2 upload matches each file row once (all its models to one idea) and counts ideas',
    /const res = matchScoreTable\(rows, fileRows, \{/.test(page) && !/for \(const \[ciNov, ciUse, target\] of pairs\)/.test(page))
  check('12: the Rankings hint lists exactly what the tab writes', /const labels = exportKpiColumns\(rows, \{ allEmpirical: true, evaluatorColumns: true \}\)/.test(page))
  const pr = src('src/utils/providerRequest.js')
  check('13: the "exhausted" message names no fixed token count', /spent its whole token ceiling on/.test(pr) && !/\$\{SCORING_MAX_TOKENS\}-token ceiling/.test(pr))
}

// ── 7b. The second review's findings (2026-09-24), each pinned ─────────────────
console.log('second review: headers, import rules, labelling')
{
  const rt = raw => recomputeOverall(normalizeImportedRows(raw))
  const base = { 'Idea ID': 'a', Condition: 'None', Title: 't' }

  // P9. A bracket that is a scale or a statistic is not a model name.
  const note = h => { const a = parseAiHeader(h); return a && [a.kind, a.slug, a.derived] }
  check('P9: "AI Novelty (1-5)" is a score with no model name, not a model called "1-5"', same(note('AI Novelty (1-5)'), ['novelty', UNRECORDED, false]), JSON.stringify(note('AI Novelty (1-5)')))
  check('P9: so are (avg), (average), (score), (Final Ideas)',
    ['AI Novelty (avg)', 'AI Novelty (average)', 'AI Usefulness (score)', 'AI Usefulness (Final Ideas)', 'AI Novelty (1–5)']
      .every(h => { const a = parseAiHeader(h); return a && a.slug === UNRECORDED && !a.derived }))
  check('P9: "(mean)" is the derived mean, "(sd)" / "(rank)" are not scores at all',
    parseAiHeader('AI Novelty (mean)')?.derived === true && parseAiHeader('AI Novelty (sd)') === null && parseAiHeader('AI Usefulness (rank)') === null)
  {
    const [r] = rt([{ ...base, 'AI Novelty (1-5)': 4, 'AI Usefulness (1-5)': 3 }])
    check('P9: imported under "model not recorded", and no model "1-5" appears',
      r[REC.novelty] === 4 && r[REC.usefulness] === 3 && same(aiModelSlugs([r]), [UNRECORDED]) && !Object.keys(r).some(k => /1_5/.test(k)), JSON.stringify(aiModelSlugs([r])))
  }

  // P10. A model outside the catalogue keeps the capitals the file gave it.
  {
    const [r] = normalizeImportedRows([{ ...base, 'AI Novelty (Qwen3 Max Thinking)': 3, 'AI Usefulness (Qwen3 Max Thinking)': 4 }])
    check('P10: normalizeImportedRows keeps "Qwen3 Max Thinking" (not lower-cased)',
      r.ai_nov__qwen3_max_thinking === 3 && aiModelName('qwen3_max_thinking') === 'Qwen3 Max Thinking', aiModelName('qwen3_max_thinking'))
    check('P10: so does the 3.1 upload path (canonicalKpiField)',
      canonicalKpiField('AI Usefulness (Zeta Nine Pro)') === 'ai_use__zeta_nine_pro' && aiModelName('zeta_nine_pro') === 'Zeta Nine Pro', aiModelName('zeta_nine_pro'))
    rememberModelName('omega_seven', 'omega seven')
    rememberModelName('omega_seven', 'Omega Seven')
    rememberModelName('omega_seven', 'OMEGA-seven')
    check('P10: a name with capitals replaces an all-lower-case one, and then stays', aiModelName('omega_seven') === 'Omega Seven', aiModelName('omega_seven'))
  }

  // P11. The analysis CSV's bare column is the derived mean only on a row that has a per-model value.
  {
    const [r1, r2] = normalizeImportedRows([
      { idea_id: 'x1', condition: 'None', text: 't', ai_nov__unrecorded: 3, novelty: 3 },
      { idea_id: 'x2', condition: 'None', text: 't', ai_nov__unrecorded: '', novelty: 4 },
    ])
    check('P11: a row with no per-model value keeps its bare score (it is not a mean of nothing)', r2[REC.novelty] === 4, JSON.stringify(r2[REC.novelty]))
    check('P11: a row with one still skips its bare (derived) column', r1[REC.novelty] === 3)
  }

  // P14. A standalone quality is not credited to a model, and it survives the page's own download.
  {
    const rows = recomputeOverall([
      { idea_id: 'L', condition: 'None', text: 'Legacy idea', novelty: '', usefulness: '', overall_quality: 4.5 },
      { idea_id: 'A', condition: 'None', text: 'Astra idea', [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4 },
    ])
    const q = exportKpiColumns(rows).find(d => d.key === 'overall_quality')
    check('P14: a mix of standalone and model qualities is labelled plain "AI Quality"', q && q.label === 'AI Quality', q && q.label)
    const cols = exportKpiColumns(rows)
    const back = rt(rows.map(r => Object.fromEntries([['Idea ID', r.idea_id], ['Condition', r.condition], ['Title', r.text], ...cols.map(c => [c.label, r[c.key]])])))
    check('P14: the legacy quality comes back through the download, the model row stays derived',
      back[0].overall_quality === 4.5 && back[1].overall_quality === 3.5 && back[1][ASTRA.novelty] === 3, JSON.stringify(back.map(r => r.overall_quality)))
    const [old] = rt([{ ...base, 'AI Novelty (GPT-6 Astra)': '', 'AI Quality (GPT-6 Astra)': 4.5 }])
    check('P14: a file saved with the old "AI Quality (GPT-6 Astra)" label reloads that standalone value', old.overall_quality === 4.5, String(old.overall_quality))
    const only = presentKpis(recomputeOverall([{ [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4 }])).find(d => d.key === 'overall_quality')
    check('P14: a quality that IS the model\'s own still names it', only.label === 'AI Quality (GPT-6 Astra)', only.label)
  }

  // P15 + P42. Evaluator columns: exact headers, several averaged; "Eval. Quality" is derived.
  {
    check('P15: parseEvalHeader knows the page\'s labels and one rater\'s columns',
      same(parseEvalHeader('Eval. Novelty'), { kind: 'novelty', rater: false }) && same(parseEvalHeader('ext_usefulness'), { kind: 'usefulness', rater: false })
      && same(parseEvalHeader('Novelty (rater 2)'), { kind: 'novelty', rater: true }) && same(parseEvalHeader('novelty_rater1'), { kind: 'novelty', rater: true })
      && same(parseEvalHeader('Usefulness (evaluator 1)'), { kind: 'usefulness', rater: true }) && same(parseEvalHeader('Eval. Quality'), { kind: 'quality', rater: false }))
    check('P15: and nothing that merely mentions an evaluator',
      ['Eval. Novelty SD', 'Eval. Novelty rank', 'Novelty (rater 1) SD', 'Evaluator agreement', 'Novelty'].every(h => parseEvalHeader(h) === null))
    const [a] = rt([{ ...base, 'Novelty (evaluator 1)': 1, 'Novelty (evaluator 2)': 5 }])
    check('P15a: two evaluators are averaged, not "the first"', a.ext_novelty === 3, String(a.ext_novelty))
    const [b] = rt([{ ...base, 'Eval. Novelty SD': 0.71, 'Eval. Novelty': 3, 'Eval. Usefulness': 4 }])
    check('P15b: an SD column is not the rating (it stays an extra)', b.ext_novelty === 3 && b.ext_quality === 3.5 && b.x_eval_novelty_sd === 0.71, JSON.stringify({ n: b.ext_novelty, q: b.ext_quality, sd: b.x_eval_novelty_sd }))
    const [c] = rt([{ ...base, 'Eval. Novelty rank': 312 }])
    check('P15c: a rank column is not the rating', c.ext_novelty === '', String(c.ext_novelty))
    const [d] = rt([{ ...base, 'Eval. Novelty': 2, ext_novelty: 4 }])
    check('P15: two evaluator-labelled columns are averaged', d.ext_novelty === 3, String(d.ext_novelty))
    check('P15: evaluatorMean prefers the raters, then the labels', evaluatorMean({ 'Novelty (rater 1)': 2, 'Novelty (rater 2)': 4, 'Eval. Novelty': 5 }, 'novelty') === 3
      && evaluatorMean({ 'Eval. Novelty': 5 }, 'novelty') === 5 && evaluatorMean({ 'Eval. Novelty': '' }, 'novelty') === '')
    const [e] = rt([{ ...base, 'Eval. Novelty': 2, 'Eval. Usefulness': 4, 'Eval. Quality': 5 }])
    check('P42: with both parts, Eval. Quality is their mean (it is derived)', e.ext_quality === 3, String(e.ext_quality))
    const [f] = rt([{ ...base, 'Eval. Quality': 4 }])
    check('P42: a file with ONLY "Eval. Quality" keeps it as the evaluator quality (not dropped, not an extra)',
      f.ext_quality === 4 && !Object.keys(f).some(k => k.startsWith('x_')) && f.overall_quality === '', JSON.stringify({ q: f.ext_quality, o: f.overall_quality }))
    check('P42: the 3.1 upload files "Eval. Quality" as the evaluator quality, never an AI one',
      canonicalKpiField('Eval. Quality') === 'ext_quality' && canonicalKpiField('Quality (rater 1)') === 'ext_quality')
  }

  // P33. Only a real AI score header routes to an AI field; the rest are extras.
  {
    const notKpi = ['Embedding novelty', 'Quality index', 'Novelty SD', 'Novelty rank', 'Eval. Novelty SD', 'Eval. Novelty rank', 'AI Novelty (sd)', 'Usefulness score', 'Novelty index']
    const got = notKpi.map(h => canonicalKpiField(h))
    check('P33: a header that only mentions novelty / usefulness / quality is no KPI of the app', got.every(k => k === null), JSON.stringify(got))
    const want = { 'Novelty': REC.novelty, 'AI Novelty': REC.novelty, 'Novelty Rating': REC.novelty, 'Avg Novelty': REC.novelty, 'Novelty (1-5)': REC.novelty,
      'Usefulness Rating': REC.usefulness, 'Average usefulness': REC.usefulness, 'AI Novelty (GPT-6 Astra)': ASTRA.novelty, 'Novelty (GPT-6 Astra)': ASTRA.novelty,
      ai_use__gpt_6_astra: ASTRA.usefulness, 'Overall quality': 'overall_quality', 'AI Quality': 'overall_quality' }
    const bad = Object.entries(want).filter(([h, k]) => canonicalKpiField(h) !== k)
    check('P33: the AI score headers still route to their fields', !bad.length, JSON.stringify(bad.map(([h]) => [h, canonicalKpiField(h)])))
    const [r] = rt([{ ...base, 'AI Novelty (GPT-6 Astra)': 5, 'AI Usefulness (GPT-6 Astra)': 5, 'Embedding novelty': 0.3005, 'Quality index': 0.42, 'Novelty SD': 0.71 }])
    check('P33: the Step-1 import keeps them as extras and leaves the AI mean alone',
      r.x_embedding_novelty === 0.3005 && r.x_quality_index === 0.42 && r.x_novelty_sd === 0.71 && r[REC.novelty] === undefined && r.novelty === 5 && r.overall_quality === 5,
      JSON.stringify({ x: [r.x_embedding_novelty, r.x_quality_index, r.x_novelty_sd], rec: r[REC.novelty], n: r.novelty }))
    // A bracket after a bare "Novelty" is a model only when the catalogue knows it:
    // "Novelty (TF-IDF)" is a measure, and as an AI model it would join the panel mean.
    const [tf] = rt([{ ...base, 'AI Novelty (GPT-6 Astra)': 4, 'Novelty (TF-IDF)': 0.42 }])
    check('P33: "Novelty (TF-IDF)" is an extra, not an AI model ("Novelty (GPT-6 Astra)" still is one)',
      canonicalKpiField('Novelty (TF-IDF)') === null && parseAiHeader('Novelty (TF-IDF)') === null && tf.x_novelty_tf_idf === 0.42
        && same(aiModelSlugs([tf]), ['gpt_6_astra']) && tf.novelty === 4 && canonicalKpiField('Novelty (GPT-6 Astra)') === ASTRA.novelty,
      JSON.stringify({ k: canonicalKpiField('Novelty (TF-IDF)'), x: tf.x_novelty_tf_idf, m: aiModelSlugs([tf]), n: tf.novelty }))
  }

  // A bare "Overall" (second review). The 3.1 KPI upload keeps it as an extra, as it
  // did before; the Step-1 import reads it as an older file's AI quality, and not
  // ALSO as an extra.
  {
    check('"Overall" is no built-in KPI of the 3.1 upload (it loads as the extra x_overall)', canonicalKpiField('Overall') === null, String(canonicalKpiField('Overall')))
    const [o] = rt([{ ...base, Overall: 4.5 }])
    check('Step 1: "Overall" is the standalone AI quality, with no duplicate x_overall', o.overall_quality === 4.5 && !('x_overall' in o), JSON.stringify({ q: o.overall_quality, x: o.x_overall }))
    const [p] = rt([{ ...base, 'AI Novelty (GPT-6 Astra)': 3, 'AI Usefulness (GPT-6 Astra)': 4, Overall: 4.5 }])
    check('Step 1: beside model scores, "Overall" is recomputed, still not an extra', p.overall_quality === 3.5 && !('x_overall' in p), JSON.stringify({ q: p.overall_quality, x: p.x_overall }))
  }

  // P9, second round: a note made only of scale words, numbers and punctuation is a
  // score with no model name; one with a statistic word or a "%" is not a 1–5 score.
  {
    const scoreNotes = ['AI Novelty (scale 1-5)', 'AI Novelty (1 = low, 5 = high)', 'AI Novelty (Likert 1-5)', 'AI Novelty (rated 1-5)',
      'AI Novelty (n=3)', 'AI Novelty (avg of 3 runs)', 'AI Novelty (mean of 3 runs)', 'AI Usefulness (1 = min, 5 = max)', 'AI Novelty (-)',
      'AI Novelty (1-5, higher = more novel)',
      'Novelty (scale 1-5)', 'Novelty (1 = low, 5 = high)', 'Usefulness (Likert 1-5)']
    const badScore = scoreNotes.filter(h => { const a = parseAiHeader(h); return !(a && a.slug === UNRECORDED && !a.derived) })
    check('P9: scale notes are a score with no model name, with or without the "AI"', !badScore.length, JSON.stringify(badScore.map(h => [h, parseAiHeader(h)])))
    const statNotes = ['AI Novelty (%)', 'AI Novelty (percent)', 'AI Novelty (normalized)', 'AI Novelty (0-100%)', 'AI Novelty (n)', 'AI Novelty (z-score)', 'AI Usefulness (max)']
    const badStat = statNotes.filter(h => parseAiHeader(h) !== null)
    check('P9: a statistic, a percentage or another scale is not an AI score', !badStat.length, JSON.stringify(badStat.map(h => [h, parseAiHeader(h)])))
    check('P9: "(mean)" and "(mean across models)" stay derived', parseAiHeader('AI Novelty (mean)')?.derived === true && parseAiHeader('AI Novelty (average across 2 models)')?.derived === true)
    const [r] = rt([{ ...base, 'AI Novelty (scale 1-5)': 4, 'AI Usefulness (1 = low, 5 = high)': 2, 'AI Novelty (%)': 0.4 }])
    check('P9: imported under "model not recorded"; no model is named after a note, no empty model key',
      r[REC.novelty] === 4 && r[REC.usefulness] === 2 && same(aiModelSlugs([r]), [UNRECORDED]) && !('ai_nov__' in r) && r.x_ai_novelty === 0.4,
      JSON.stringify(Object.fromEntries(Object.entries(r).filter(([k]) => /^(ai_|x_)/.test(k)))))
    check('P9: a bracket with no letters or digits names no model',
      parseAiHeader('AI Novelty (?)')?.slug === UNRECORDED && parseAiHeader('ai_nov__')?.slug === UNRECORDED
        && slugFromModelName('—') === UNRECORDED && slugFromModelName('(%)') === UNRECORDED && slugFromModelName('') === UNRECORDED)
    const [b] = normalizeImportedRows([{ ...base, 'Novelty (scale 1-5)': 4, 'Usefulness (1 = low, 5 = high)': 3 }])
    check('P9: the bare forms read too (the 3.2 fallback and Step 1)',
      isBareAiScoreHeader('Novelty (scale 1-5)') === 'novelty' && isBareAiScoreHeader('Usefulness (1 = low, 5 = high)') === 'usefulness' && b[REC.novelty] === 4 && b[REC.usefulness] === 3)
    // The note words never swallow a model the catalogue knows, by any of its names.
    const miss = []
    for (const p of PROVIDERS) for (const m of p.models) {
      for (const name of [shortModelName(m), m.label, m.id]) {
        for (const h of [`AI Novelty (${name})`, `Novelty (${name})`, `AI Usefulness (${name})`]) {
          const a = parseAiHeader(h)
          if (!a || a.slug !== modelSlug(m.id)) miss.push(h)
        }
      }
    }
    check('every catalogue model, by short name, label or id, with or without "AI", reads back to itself', !miss.length, JSON.stringify(miss.slice(0, 5)))
    // parseAiHeader reads each spelling once; a caller changing its answer must not
    // change the next caller's.
    const first = parseAiHeader('AI Novelty (GPT-6 Astra)')
    first.slug = 'tampered'
    check('parseAiHeader hands every caller its own copy', parseAiHeader('AI Novelty (GPT-6 Astra)').slug === 'gpt_6_astra')
  }

  // P15, second round: a rater column may carry the rater's name or a note (the
  // old meanRaterCols prefix rule); only a statistic, an ID or a comment is refused.
  {
    const [r] = rt([{ ...base, 'Novelty (rater 1 - Jane)': 2, 'Novelty (rater 2 - Ali)': 4, 'Usefulness (rater Jane)': 3, 'Usefulness (rater Ali)': 5 }])
    check('P15: named rater columns are averaged', r.ext_novelty === 3 && r.ext_usefulness === 4 && r.ext_quality === 3.5, JSON.stringify({ n: r.ext_novelty, u: r.ext_usefulness, q: r.ext_quality }))
    const yes = ['Novelty (rater avg)', 'Novelty rater 1 (blind)', 'Novelty (raters avg)', 'Novelty (judge 1)', 'Novelty (rater Max)', 'Novelty (expert)']
    const wrongYes = yes.filter(h => parseEvalHeader(h)?.rater !== true)
    check('P15: the old prefix forms are one rater\'s column', !wrongYes.length, JSON.stringify(wrongYes))
    const no = ['Novelty (rater 1) SD', 'Novelty (rater agreement)', 'Novelty rater ID', 'Novelty (rater 1 comments)', 'Usefulness (raters sd)']
    const wrongNo = no.filter(h => parseEvalHeader(h) !== null)
    check('P15: a statistic, an ID or a comment about the raters is not a rating', !wrongNo.length, JSON.stringify(wrongNo))
    check('P15: in brackets the plural is the group\'s column, as before',
      parseEvalHeader('Novelty (experts)')?.rater === false && parseEvalHeader('Novelty (evaluators)')?.rater === false && parseEvalHeader('Novelty (raters)')?.rater === false)
  }

  // isBareAiScoreHeader: the scores with no model name, decorated or not (for the 3.2 upload).
  {
    const yes = { Novelty: 'novelty', 'AI Novelty': 'novelty', nov: 'novelty', 'Novelty Rating': 'novelty', 'Novelty Ratings': 'novelty', 'Avg Novelty': 'novelty',
      'Avg. Novelty': 'novelty', 'Average Novelty': 'novelty', 'Mean Novelty': 'novelty', 'Novelty (1-5)': 'novelty',
      'AI Novelty (avg)': 'novelty', 'Novelty avg': 'novelty', Usefulness: 'usefulness', 'Usefulness Rating': 'usefulness', 'Useful': 'usefulness',
      'Usefulness (1–5)': 'usefulness', 'AI Usefulness Rating (1-5)': 'usefulness' }
    const no = ['AI Novelty (GPT-6 Astra)', 'Novelty (GPT-6 Astra)', 'AI Novelty (model not recorded)', 'ai_nov__unrecorded', 'ai_nov__gpt_6_astra', 'ai_nov__',
      'AI Novelty (mean across models)', 'Novelty (mean)', 'Novelty (empirical)', 'Novelty (objective)', 'Eval. Novelty', 'Novelty (rater 1)',
      'Novelty (expert 2)', 'NoveltyScore', 'Novelty Score', 'Novelty rank', 'Novelty SD', 'Novelty (sd)', 'Embedding novelty', 'AI Quality', 'Quality',
      'Novelty (TF-IDF)', 'Usefulness score (empirical)', 'Need fit (empirical)']
    const wrongYes = Object.entries(yes).filter(([h, k]) => isBareAiScoreHeader(h) !== k)
    const wrongNo = no.filter(h => isBareAiScoreHeader(h) !== null)
    check('isBareAiScoreHeader reads the bare and decorated forms', !wrongYes.length, JSON.stringify(wrongYes.map(([h]) => [h, isBareAiScoreHeader(h)])))
    check('isBareAiScoreHeader refuses named, explicit, derived, empirical, evaluator, rank, SD and embedding columns', !wrongNo.length, JSON.stringify(wrongNo))
    const [r] = normalizeImportedRows([{ ...base, 'Novelty Rating': 4, 'Usefulness (1-5)': 2 }])
    check('a decorated bare column imports as "model not recorded"', r[REC.novelty] === 4 && r[REC.usefulness] === 2)
  }

  // Third review: what a note in brackets says about a score column.
  {
    // A score on ANOTHER scale is not a 1-5 AI score: it stays an extra column.
    const other = ['AI Novelty (0-1)', 'AI Novelty (0-100)', 'AI Novelty (1-10)', 'AI Novelty (0-10 scale)', 'AI Novelty (1 = low, 7 = high)',
      'Novelty (0-1)', 'Novelty (0-10 scale)', 'AI Novelty (GPT-6 Astra, 0-1)']
    const readOther = other.filter(h => parseAiHeader(h) !== null || isBareAiScoreHeader(h) !== null)
    check('a note of another scale is not a 1-5 AI score', !readOther.length, JSON.stringify(readOther))
    check('...not even through the 3.1 upload (it loads as an extra)', canonicalKpiField('Novelty (0-1)') === null && canonicalKpiField('AI Novelty (0-100)') === null,
      JSON.stringify([canonicalKpiField('Novelty (0-1)'), canonicalKpiField('AI Novelty (0-100)')]))
    const [r] = recomputeOverall(normalizeImportedRows([{ ...base, 'AI Novelty (0-1)': 0.42, [ASTRA.novelty]: 4, [ASTRA.usefulness]: 3 }]))
    check('...so it does not move the AI Novelty mean', r.novelty === 4 && same(aiModelSlugs([r]), ['gpt_6_astra']), JSON.stringify({ n: r.novelty, m: aiModelSlugs([r]) }))
    // The 1-5 notes still mean "a score, model not recorded".
    const five = ['AI Novelty (1-5)', 'AI Novelty (5-point)', 'AI Novelty (out of 5)', 'AI Novelty (1 = low, 5 = high)',
      'AI Novelty (not recorded)', 'AI Novelty (unknown model)', 'AI Novelty (NA)', 'AI Novelty (n/a)']
    const wrongFive = five.filter(h => parseAiHeader(h)?.slug !== UNRECORDED)
    check('1-5 and "no model" notes read as model not recorded', !wrongFive.length, JSON.stringify(wrongFive.map(h => [h, parseAiHeader(h)])))
    // One run of several is a source of its own, kept apart as it always was.
    const r1 = parseAiHeader('AI Novelty (run 1)'), r2 = parseAiHeader('AI Novelty (run 2)')
    check('(run 1) and (run 2) are two sources, not one', r1 && r2 && r1.slug !== UNRECORDED && r1.slug !== r2.slug, JSON.stringify([r1, r2]))
    const [runs] = recomputeOverall(normalizeImportedRows([{ ...base, 'AI Novelty (run 1)': 2, 'AI Novelty (run 2)': 4, 'AI Usefulness (run 1)': 3, 'AI Usefulness (run 2)': 5 }]))
    check('...and both runs\' scores are kept (the mean of 2 and 4 is 3)', runs.novelty === 3 && aiModelSlugs([runs]).length === 2, JSON.stringify({ n: runs.novelty, m: aiModelSlugs([runs]) }))
    // A model name with a note.
    check('"(GPT-6 Astra, 1-5)" is GPT-6 Astra', parseAiHeader('AI Novelty (GPT-6 Astra, 1-5)')?.slug === 'gpt_6_astra'
      && isBareAiScoreHeader('Novelty (GPT-6 Astra, 1-5)') === null && canonicalKpiField('Novelty (GPT-6 Astra, 1-5)') === ASTRA.novelty,
      JSON.stringify([parseAiHeader('AI Novelty (GPT-6 Astra, 1-5)'), canonicalKpiField('Novelty (GPT-6 Astra, 1-5)')]))
    // People are not an AI model.
    check('"(human)" and "(raters)" are not AI scores', parseAiHeader('AI Novelty (human)') === null && parseAiHeader('AI Novelty (raters)') === null)
  }
  {
    // Evaluator headers with a note on how the rating was given.
    const yes = { 'Evaluator Novelty Rating': ['novelty', false], 'Eval. Novelty (1-5)': ['novelty', false], 'Eval. Novelty (mean)': ['novelty', false],
      'Eval. Usefulness (avg)': ['usefulness', false], 'Eval. Novelty avg': ['novelty', false], 'Novelty (external evaluator 1)': ['novelty', true],
      'Novelty rater 1 (blind)': ['novelty', true], 'Usefulness (blind rater 2)': ['usefulness', true] }
    const wrongYes = Object.entries(yes).filter(([h, [k, r]]) => { const e = parseEvalHeader(h); return !e || e.kind !== k || e.rater !== r })
    check('decorated evaluator headers are read, not dropped', !wrongYes.length, JSON.stringify(wrongYes.map(([h]) => [h, parseEvalHeader(h)])))
    const no = ['Eval. Novelty SD', 'Eval. Novelty (sd)', 'Eval. Novelty (0-1)', 'Eval. Novelty rank', 'Eval. Novelty (GPT-6 Astra)']
    const wrongNo = no.filter(h => parseEvalHeader(h) !== null)
    check('...but a statistic, another scale or a model name is not an evaluator rating', !wrongNo.length, JSON.stringify(wrongNo.map(h => [h, parseEvalHeader(h)])))
    check('evaluatorMean reads the decorated headers', evaluatorMean({ 'Eval. Novelty (1-5)': 2, 'Evaluator Novelty Rating': 4 }, 'novelty') === 3
      && evaluatorMean({ 'Eval. Novelty (0-1)': 0.4 }, 'novelty') === '')
  }

  // P40. The unrecorded pair moves whole.
  {
    const rows = recomputeOverall([{ idea_id: 'I1', [REC.novelty]: 3, [REC.usefulness]: 4, [ASTRA.novelty]: 5, [ASTRA.usefulness]: '' }])
    const res = labelUnrecordedScores(rows, 'gpt-6-astra')
    const r = recomputeOverall(res.rows)[0]
    check('P40: an idea whose model cell is half full is left whole (a conflict)',
      res.moved === 0 && res.conflicts === 1 && r[ASTRA.novelty] === 5 && r[ASTRA.usefulness] === '' && r[REC.novelty] === 3 && r[REC.usefulness] === 4,
      JSON.stringify({ moved: res.moved, conflicts: res.conflicts, row: r }))
    const both = labelUnrecordedScores([{ [REC.novelty]: 3, [REC.usefulness]: 4 }, { [REC.novelty]: 2 }, { [ASTRA.usefulness]: 1, [REC.novelty]: 2 }], 'gpt-6-astra')
    check('P40: both cells empty: the pair moves; a lone half moves too; counts add up to the ideas',
      both.moved === 2 && both.conflicts === 1 && both.rows[0][ASTRA.novelty] === 3 && both.rows[0][ASTRA.usefulness] === 4 && both.rows[1][ASTRA.novelty] === 2
        && both.rows[2][REC.novelty] === 2 && both.rows[2][ASTRA.novelty] === undefined, JSON.stringify(both))
  }
}

// ── 7c. matchScoreTable: one idea per file row, every field to that idea ──────────
console.log('matchScoreTable (the 3.2 / 3.3 score-file match)')
{
  const CL = aiFieldsFor('claude-sonnet-5')
  const idea = (id, title, extra = {}) => ({ idea_id: id, session: 'S1', idea_title: title, text: title, ...extra })
  {
    // P36: two ideas share a title; the file (with Idea IDs) has Claude only on the Final one.
    const rows = [idea('I1', 'Sports headband'), idea('I2', 'Sports headband'), idea('I3', 'Fever sock')]
    const res = matchScoreTable(rows, [
      { id: 'I1', session: '', title: 'Sports headband', values: { [ASTRA.novelty]: 2, [ASTRA.usefulness]: 2, [CL.novelty]: '', [CL.usefulness]: '' } },
      { id: 'I2', session: '', title: 'Sports headband', values: { [ASTRA.novelty]: 5, [ASTRA.usefulness]: 5, [CL.novelty]: 4, [CL.usefulness]: 4 } },
      { id: 'I3', session: '', title: 'Fever sock', values: { [ASTRA.novelty]: 3, [ASTRA.usefulness]: 3, [CL.novelty]: 1, [CL.usefulness]: 2 } },
    ])
    const [a, b] = res.rows
    check('by Idea ID: both models of a file row land on the SAME idea (P36)',
      a[ASTRA.novelty] === 2 && a[CL.novelty] === undefined && b[ASTRA.novelty] === 5 && b[CL.novelty] === 4, JSON.stringify([a, b]))
    check('by Idea ID: counts', res.matched === 3 && res.filled === 3 && res.kept === 0 && res.unmatched === 0 && res.matchedIdx.size === 3)
  }
  {
    // The id wins over a changed title; an id this dataset does not have falls through to the title.
    const rows = [idea('I1', 'Old title'), idea('I2', 'Fever sock')]
    const res = matchScoreTable(rows, [
      { id: 'I1', session: '', title: 'New title', values: { [ASTRA.novelty]: 4 } },
      { id: 'ZZZ', session: '', title: 'Fever sock', values: { [ASTRA.novelty]: 2 } },
    ])
    check('the id beats a changed title; an unknown id falls through to the title', res.rows[0][ASTRA.novelty] === 4 && res.rows[1][ASTRA.novelty] === 2 && res.unmatched === 0)
  }
  {
    // P35(b): two sessions number their ideas 1, 2 — the session decides.
    const rows = [
      { idea_id: '1', session: 'S1', idea_title: 'Fever sock' }, { idea_id: '2', session: 'S1', idea_title: 'Cool cap' },
      { idea_id: '1', session: 'S2', idea_title: 'Mood scarf' }, { idea_id: '2', session: 'S2', idea_title: 'Warm glove' },
    ]
    const res = matchScoreTable(rows, [{ id: '1', session: 'S2', title: 'Mood scarf', values: { [CL.novelty]: 5 } }])
    check('session narrows the id: S2\'s idea 1, not S1\'s', res.rows[2][CL.novelty] === 5 && res.rows[0][CL.novelty] === undefined)
    const noSess = matchScoreTable(rows, [{ id: '1', session: '', title: 'Mood scarf', values: { [CL.novelty]: 5 } }])
    check('no session in the file: the title picks between the two idea 1s', noSess.rows[2][CL.novelty] === 5 && noSess.rows[0][CL.novelty] === undefined)
    const amb = matchScoreTable(rows, [{ id: '1', session: '', title: 'Something else', values: { [CL.novelty]: 5 } }])
    check('...and when the title does not decide, nothing is guessed', amb.unmatched === 1 && amb.filled === 0 && !amb.rows.some(r => r[CL.novelty] !== undefined))
    // Same id AND same title in two sessions: only the session can tell them apart.
    const twins = [{ idea_id: '1', session: 'S1', idea_title: 'Fever sock' }, { idea_id: '1', session: 'S2', idea_title: 'Fever sock' }]
    const tw = matchScoreTable(twins, [{ id: '1', session: 'S2', title: 'Fever sock', values: { [CL.novelty]: 5 } }])
    check('...and where the titles agree too, the session alone decides', tw.rows[1][CL.novelty] === 5 && tw.rows[0][CL.novelty] === undefined && tw.filled === 1)
    // The file's session code in another case is still that session.
    const lower = matchScoreTable(twins, [{ id: '1', session: 's2', title: 'Fever sock', values: { [CL.novelty]: 5 } }])
    check('...whatever case the file writes the session code in', lower.rows[1][CL.novelty] === 5 && lower.rows[0][CL.novelty] === undefined && lower.filled === 1)
  }
  {
    // The same idea loaded twice (a session and its export): both copies are filled.
    const rows = [idea('I1', 'Fever sock'), idea('I2', 'Cool cap'), idea('I1', 'Fever sock')]
    const res = matchScoreTable(rows, [{ id: 'I1', session: 'S1', title: 'Fever sock', values: { [ASTRA.novelty]: 4 } }])
    check('duplicate copies of one idea are all filled', res.rows[0][ASTRA.novelty] === 4 && res.rows[2][ASTRA.novelty] === 4 && res.filled === 2 && res.matched === 1)
  }
  {
    // Title only: two file rows with one title go to two different ideas, and never to one an id already placed.
    const rows = [idea('I1', 'Sports headband'), idea('I2', 'Sports headband'), idea('I3', 'Sports headband')]
    const res = matchScoreTable(rows, [
      { id: '', session: '', title: 'Sports headband', values: { [ASTRA.novelty]: 1 } },
      { id: 'I1', session: '', title: 'Sports headband', values: { [ASTRA.novelty]: 3 } },
      { id: '', session: '', title: 'Sports headband', values: { [ASTRA.novelty]: 2 } },
    ])
    check('same-title rows spread over different ideas, the id-placed one excluded',
      same(res.rows.map(r => r[ASTRA.novelty]), [3, 1, 2]), JSON.stringify(res.rows.map(r => r[ASTRA.novelty])))
  }
  {
    // Fill blanks only; a blank or unusable file value never blanks; values are kept as given.
    const rows = [idea('I1', 'Kept', { [ASTRA.novelty]: 4, [ASTRA.usefulness]: '' })]
    const res = matchScoreTable(rows, [{ id: 'I1', session: '', title: 'Kept', values: { [ASTRA.novelty]: 1, [ASTRA.usefulness]: 7, [GEM.novelty]: '', [GEM.usefulness]: 'n/a' } }])
    const r = res.rows[0]
    check('fill-blank: a held score is kept, an empty one filled (7 kept as given), a blank never written',
      r[ASTRA.novelty] === 4 && r[ASTRA.usefulness] === 7 && !(GEM.novelty in r) && !(GEM.usefulness in r) && res.filled === 1 && res.kept === 0, JSON.stringify(r))
    const again = matchScoreTable(res.rows, [{ id: 'I1', session: '', title: 'Kept', values: { [ASTRA.novelty]: 2, [ASTRA.usefulness]: 2 } }])
    check('fill-blank: a fully scored idea is kept, the same row object returned', again.filled === 0 && again.kept === 1 && again.rows[0] === res.rows[0])
    check('the input rows are not changed', rows[0][ASTRA.usefulness] === '')
    // Two file rows for one idea (a file split by model): the first fills, the
    // second finds its value already there. The idea gained, so it is filled, not kept.
    const split = matchScoreTable([idea('I9', 'Split')], [
      { id: 'I9', session: '', title: 'Split', values: { [ASTRA.novelty]: 3 } },
      { id: 'I9', session: '', title: 'Split', values: { [ASTRA.novelty]: 5, [GEM.novelty]: 2 } },
      { id: 'I9', session: '', title: 'Split', values: { [ASTRA.novelty]: 1 } },
    ])
    check('an idea counts once: filled if it gained anything, never also kept',
      split.filled === 1 && split.kept === 0 && split.matched === 3 && split.rows[0][ASTRA.novelty] === 3 && split.rows[0][GEM.novelty] === 2,
      JSON.stringify({ f: split.filled, k: split.kept, m: split.matched, r: split.rows[0] }))
  }
  {
    // P19's file: two models covering different ideas.
    const rows = []
    for (let i = 0; i < 20; i++) rows.push(idea(`A${i}`, `Astra rated idea number ${i}`, { [ASTRA.novelty]: 3, [ASTRA.usefulness]: 3 }))
    for (let i = 0; i < 10; i++) rows.push(idea(`C${i}`, `Claude only idea number ${i}`))
    const file = [
      ...rows.slice(0, 20).map(r => ({ id: '', session: '', title: r.idea_title, values: { [ASTRA.novelty]: 4, [ASTRA.usefulness]: 4, [CL.novelty]: '', [CL.usefulness]: '' } })),
      ...rows.slice(20).map(r => ({ id: '', session: '', title: r.idea_title, values: { [ASTRA.novelty]: '', [ASTRA.usefulness]: '', [CL.novelty]: 2, [CL.usefulness]: 2 } })),
      ...[1, 2, 3].map(i => ({ id: '', session: '', title: `Unknown astra ${i}`, values: { [ASTRA.novelty]: 4 } })),
      ...[1, 2, 3, 4].map(i => ({ id: '', session: '', title: `Unknown claude ${i}`, values: { [CL.novelty]: 4 } })),
      { id: '', session: '', title: 'Unrated template row', values: { [ASTRA.novelty]: '' } },
    ]
    const res = matchScoreTable(rows, file)
    check('P19: counts per idea and per file row: filled 10, kept 20, unmatched 7',
      res.filled === 10 && res.kept === 20 && res.unmatched === 7 && res.matched === 30, JSON.stringify({ f: res.filled, k: res.kept, u: res.unmatched, m: res.matched }))
  }
  {
    // isEligible, the English title (Step 1b) and a positional import_<n> id.
    const rows = [idea('I1', 'Fièvre chaussette'), idea('I2', 'Removed idea'), idea('import_3', 'Cool cap')]
    const res = matchScoreTable(rows, [
      { id: '', session: '', title: 'Fever sock', values: { [ASTRA.novelty]: 4 } },
      { id: 'I2', session: '', title: 'Removed idea', values: { [ASTRA.novelty]: 4 } },
      { id: 'import_3', session: '', title: 'Another file\'s third row', values: { [ASTRA.novelty]: 4 } },
    ], { isEligible: r => r.idea_id !== 'I2', altTitle: (r, i) => (i === 0 ? 'Fever sock' : '') })
    check('the English title matches, a removed idea is never filled, an import_<n> id needs its title',
      res.rows[0][ASTRA.novelty] === 4 && res.rows[1][ASTRA.novelty] === undefined && res.rows[2][ASTRA.novelty] === undefined && res.unmatched === 2 && res.excluded === 1,
      JSON.stringify(res.rows.map(r => r[ASTRA.novelty])))
  }
  {
    // Second review: an Idea ID that belongs to a REMOVED participant's idea is still
    // this dataset's id. It must not fall through to the title and fill another
    // session's idea that happens to share it (the owner's "Baby wear" case).
    const rows = [
      { idea_id: 'X', session: 'S1', idea_title: 'Sports headband', author_id: 'removed' },
      { idea_id: 'Y', session: 'S2', idea_title: 'Sports headband', author_id: 'ok' },
    ]
    const notRemoved = r => r.author_id !== 'removed'
    const withSess = matchScoreTable(rows, [{ id: 'X', session: 'S1', title: 'Sports headband', values: { ext_novelty: 5 } }], { isEligible: notRemoved })
    check('a removed idea\'s id: unmatched (excluded), never moved to the same-titled idea',
      withSess.rows[1].ext_novelty === undefined && withSess.rows[0].ext_novelty === undefined && withSess.matched === 0 && withSess.unmatched === 1 && withSess.excluded === 1 && withSess.rows[1] === rows[1],
      JSON.stringify({ rows: withSess.rows.map(r => r.ext_novelty), m: withSess.matched, u: withSess.unmatched, x: withSess.excluded }))
    const noSess = matchScoreTable(rows, [{ id: 'X', session: '', title: 'Sports headband', values: { ext_novelty: 5 } }], { isEligible: notRemoved })
    check('...with no session in the file either', noSess.rows[1].ext_novelty === undefined && noSess.excluded === 1 && noSess.unmatched === 1)
    // An id this dataset does not have at all still falls through to the title.
    const other = matchScoreTable(rows, [{ id: 'ZZZ', session: '', title: 'Sports headband', values: { ext_novelty: 5 } }], { isEligible: notRemoved })
    check('...while an id no loaded idea has still goes to the title (the eligible idea)', other.rows[1].ext_novelty === 5 && other.excluded === 0 && other.matched === 1)
  }
  {
    // A file row that names a session this dataset has is matched by title inside
    // that session only; a session the dataset does not have narrows nothing.
    const rows = [
      { idea_id: 'A', session: 'S1', idea_title: 'Baby wear' },
      { idea_id: 'B', session: 'S2', idea_title: 'Baby wear' },
      { idea_id: 'C', session: 'S2', idea_title: 'A long title for the fuzzy match here' },
    ]
    const res = matchScoreTable(rows, [{ id: 'gone', session: 'S2', title: 'Baby wear', values: { ext_novelty: 4 } }])
    check('title inside the file row\'s session: S2\'s "Baby wear", not S1\'s', res.rows[1].ext_novelty === 4 && res.rows[0].ext_novelty === undefined, JSON.stringify(res.rows.map(r => r.ext_novelty)))
    const none = matchScoreTable(rows, [{ id: '', session: 'S3X', title: 'Baby wear', values: { ext_novelty: 4 } }, { id: '', session: 's2', title: 'A long title for the fuzzy match', values: { ext_novelty: 3 } }])
    check('an unknown session narrows nothing; a known one (any case) keeps the fuzzy title match inside it',
      none.rows[0].ext_novelty === 4 && none.rows[2].ext_novelty === 3 && none.matched === 2, JSON.stringify(none.rows.map(r => r.ext_novelty)))
    const gone = matchScoreTable(rows, [{ id: '', session: 'S1', title: 'A long title for the fuzzy match here', values: { ext_novelty: 3 } }])
    check('a title found only in ANOTHER session than the file row\'s is unmatched', gone.unmatched === 1 && !gone.rows.some(r => r.ext_novelty !== undefined))
  }
  {
    // An ambiguous id is left unmatched even when its title would match another idea:
    // the id says it is one of the two, so it is not that third idea.
    const rows = [
      { idea_id: '1', session: 'S1', idea_title: 'Alpha' }, { idea_id: '1', session: 'S2', idea_title: 'Alpha' },
      { idea_id: '7', session: 'S3', idea_title: 'Alpha' }, { idea_id: '8', session: 'S3', idea_title: 'Gamma' },
    ]
    const res = matchScoreTable(rows, [
      { id: '1', session: '', title: 'Alpha', values: { ext_novelty: 5 } },
      { id: '1', session: '', title: 'Gamma', values: { ext_novelty: 4 } },
    ])
    check('an ambiguous id never goes on to the title', res.unmatched === 2 && res.matched === 0 && !res.rows.some(r => r.ext_novelty !== undefined),
      JSON.stringify(res.rows.map(r => r.ext_novelty)))
  }
  {
    // A file row with no value still matches (it keeps the ideas in step) but is not counted.
    const rows = [idea('I1', 'One'), idea('I2', 'Two')]
    const res = matchScoreTable(rows, [
      { id: 'I1', session: '', title: 'One', values: { [ASTRA.novelty]: '' } },
      { id: 'I2', session: '', title: 'Two', values: { [ASTRA.novelty]: 3 } },
      { id: '', session: '', title: 'Nothing like it', values: { [ASTRA.novelty]: '' } },
    ])
    check('a missing (null) loaded row is skipped, not a crash',
      (() => { try { return matchScoreTable([idea('I1', 'One'), null], [{ id: 'I1', values: { [ASTRA.novelty]: 2 } }]).filled === 1 } catch { return false } })())
    check('a row with no value is in neither matched nor unmatched, but it is placed',
      res.matched === 1 && res.unmatched === 0 && res.filled === 1 && res.matchedIdx.has(0) && res.matchedIdx.has(1), JSON.stringify({ m: res.matched, u: res.unmatched, f: res.filled }))
  }
}

// ── 7d. aiPanelCoverage: were the ideas rated by the same models? ────────────────
console.log('aiPanelCoverage')
{
  const CL = aiFieldsFor('claude-sonnet-5')
  const even = aiPanelCoverage([{ [ASTRA.novelty]: 3, [ASTRA.usefulness]: 3 }, { [ASTRA.usefulness]: 4 }, { novelty: 3 }])
  check('one model on every rated idea: even', !even.uneven && even.rated === 2 && even.unrated === 1 && same(even.groups, [{ slugs: ['gpt_6_astra'], n: 2 }]) && same(even.models, ['gpt_6_astra']), JSON.stringify(even))
  const rows = []
  for (let i = 0; i < 10; i++) rows.push({ [ASTRA.novelty]: 3, [ASTRA.usefulness]: 3, ...(i < 4 ? { [CL.novelty]: 4, [CL.usefulness]: '' } : { [CL.novelty]: '', [CL.usefulness]: '' }) })
  rows.push({ [REC.novelty]: 2 }, { [ASTRA.novelty]: '' })
  const cov = aiPanelCoverage(rows)
  check('a second model on 4 of 10 ideas: uneven, most common panel first, models in catalogue order, "not recorded" last',
    cov.uneven && cov.rated === 11 && cov.unrated === 1
      && same(cov.groups, [{ slugs: ['gpt_6_astra'], n: 6 }, { slugs: ['claude_sonnet_5', 'gpt_6_astra'], n: 4 }, { slugs: [UNRECORDED], n: 1 }])
      && same(cov.models, ['claude_sonnet_5', 'gpt_6_astra', UNRECORDED]), JSON.stringify(cov))
  check('no rows: nothing rated, not uneven', (() => { const z = aiPanelCoverage([]); return !z.uneven && z.rated === 0 && z.groups.length === 0 })())
  const both = aiPanelCoverage([{ [ASTRA.novelty]: 3, [CL.usefulness]: 4 }, { [ASTRA.usefulness]: 2, [CL.novelty]: 1 }])
  check('two models that both rated every idea: one panel, not uneven',
    !both.uneven && both.groups.length === 1 && both.groups[0].n === 2 && same(both.models, ['claude_sonnet_5', 'gpt_6_astra']), JSON.stringify(both))
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
  // Scoped to downloadAllData's own body: the 3.1 download calls the same helper, so
  // a page-wide match would pass with this one reverted (review, 2026-09-24).
  check('"Download all idea data" exists and uses the shared idea sheet',
    /function downloadAllData\(\) \{\n\s*const data = effectiveRows\n\s*if \(!data\.length\) return\n\s*const wb = XLSX\.utils\.book_new\(\)\n\s*addIdeaSheet\(wb, data\)/.test(page)
    && /onClick=\{downloadAllData\}/.test(page) && /Download all idea data \(Excel\)/.test(page))
  check('the shared idea sheet goes through Step 1b (English + Translations sheet)',
    /translateSheets\(\[\{ name: 'ideas', kind: 'json', rows: ideaExportRows\(data\) \}\], tm\)/.test(page) && /if \(trSheet\) addSheet\(wb, TRANSLATIONS_SHEET, trSheet\.rows\)/.test(page))
  check('the CSV writes the same English idea sheet', /function downloadAllDataCsv\(\) \{[\s\S]{0,500}translatedIdeaSheet\(data\)\.rows/.test(page))
  check('the 3.1 download uses the same sheet', /function downloadIdeasWithKpis\(\) \{[\s\S]{0,300}addIdeaSheet\(wb, data\)/.test(page))
  check('a changed English version clears every model\'s AI columns, not just the mean',
    /for \(const k of aiKeys\(r\)\) x\[k\] = ''/.test(page) && /Object\.keys\(r\)\.filter\(isAiModelKey\)/.test(page))
  check('the check sheet reads the text 3.1 measured (the English version)', /const text = measureText\(r\)\n\s*const facets = specificityFacets\(text\)/.test(page))
  check('the scores upload also matches English titles (Step 1b)', /altTitle: \(_r, i\) => withEn\[i\]\?\.title_en/.test(page))
  check('the check sheet is added when the Usefulness score exists', /addUsefulnessCheckSheet\(wb, data, techSet\)/.test(page) && /function addUsefulnessCheckSheet\(/.test(page))
  check('the Rankings tab takes the page\'s ordered columns', /rankingsSheetFromIdeas\(ideasSheet\.rows, lookup, cols\)/.test(page) && /exportKpiColumns\(rows, \{ allEmpirical: true, evaluatorColumns: true \}\)/.test(page))
  check('the top-up merges every model in the file', /mergeAiScoresIntoRows\(rows, incoming\)/.test(page))
  check('unlabelled scores can be given a model (the ideas on show only)', /labelUnrecordedScores\(rows\.filter\(\(_, i\) => shown\[i\]\), labelTarget\)/.test(page) && /Label them/.test(page))
  check('a derived AI column is never imported by the 3.1 upload', /if \(isDerivedAiKey\(canon\)\) continue/.test(page))
  const OLD_COPY = ['Deterministic and objective KPIs', 'Objective, repeatable', 'Obj. computed', 'Compute objective KPIs',
    '>Objective KPI<', 'objective KPIs (3.1)', 'objective compute', 'Novelty&nbsp;(objective)', 'Evaluator · Objective']
  const left = OLD_COPY.filter(t => page.includes(t))
  check('no "objective" wording left in the page\'s visible copy', left.length === 0, left.join(' | '))
}

// ── 9. No AI score is rounded; the API's ratings are whole numbers ─────────────
// Owner, 2026-09-24: "you should not round any AI score. rather the kpis the any
// AI computes from the api should be integers in 1-5". The rater asks for whole
// numbers and accepts nothing else (score-batch-guard runs that end to end); no
// upload, import or derived column rounds anything.
console.log('no AI score is rounded; the rater asks for whole numbers')
{
  const page = src('src/pages/DataAnalytics.jsx')
  const topped = mergeAiScoresIntoRows([{ idea_id: 'i1', session: 'S', idea_title: 'Fever sock', text: 'Fever sock' }],
    [{ idea_id: 'i1', session: 'S', idea_title: 'Fever sock', [ASTRA.novelty]: 3.25, [ASTRA.usefulness]: 4.67 }])
  check('the top-up upload keeps 3.25 and 4.67 as they are (it used to round them to 3.3 and 4.7)',
    topped.rows[0][ASTRA.novelty] === 3.25 && topped.rows[0][ASTRA.usefulness] === 4.67, JSON.stringify(topped.rows[0]))
  const two = recomputeOverall([{ [ASTRA.novelty]: 3, [ASTRA.usefulness]: 4, [GEM.novelty]: 4, [GEM.usefulness]: 4 }])[0]
  check('the mean across models and AI Quality are exact, not rounded', two.novelty === 3.5 && two.usefulness === 4 && two.overall_quality === 3.75, JSON.stringify(two))
  check('no upload rounds an AI score', ![src('src/utils/scoreGaps.js'), src('src/utils/analyticsData.js'), src('src/utils/scoreBatch.js'), page]
    .some(t => /Math\.round\([nv] \* 10\) \/ 10/.test(t)) && /if \(v !== ''\) values\[x\.field\] = Math\.max\(1, Math\.min\(5, v\)\)/.test(page))
  const llm = src('src/utils/llmClient.js')
  check('the rater asks every model for whole numbers from 1 to 5', /Every rating is a WHOLE NUMBER: 1, 2, 3, 4 or 5/.test(llm)
    && /"novelty": <integer 1-5>, "usefulness": <integer 1-5>/.test(llm) && /each rating a whole number from 1 to 5/.test(llm))
  check('...and keeps only whole-number replies (wholeRating), which the page says', /novelty: wholeRating\(item\.novelty\), usefulness: wholeRating\(item\.usefulness\)/.test(src('src/utils/scoreBatch.js'))
    && /The rater only accepts whole numbers/.test(page))
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll AI-column checks passed.')
process.exit(failures ? 1 : 0)
