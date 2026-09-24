/**
 * analytics-scores-guard.mjs — offline test (no network, no deps).
 *
 *   node _ideasearchlab-src/tools/analytics-scores-guard.mjs
 *
 * Guards the one rule the Data Analytics page must never lose (owner 2026-08):
 * **an uploaded scores/KPI file ADDS scores to ideas that have none — it never
 * overrides a score that is already there.** A file typically carries ideas
 * scored in an earlier sitting (by a past AI rater or by hand), and before this
 * rule both upload paths wrote unconditionally: they replaced kept scores with
 * the file's, and blanked a score outright wherever the file's cell was empty.
 *
 * Covers both upload paths into the canonical KPI columns —
 * `matchScoresIntoRows` / `matchScoreTable` (3.2 "Load AI scores file" / 3.3
 * evaluator ratings) and `matchUploadedKpisIntoRows` (3.1 "Upload additional
 * KPIs") — plus the deliberate exception: an `x_…` column is the file's own, so
 * it is replaced. And the CSV round trip the uploads read through: a value
 * leaves and comes back as it was.
 */
import {
  matchScoresIntoRows, matchScoreTable, matchUploadedKpisIntoRows, UPLOADED_KPI_PREFIX,
  rowsToCsv, csvToRows,
} from '../src/utils/analyticsData.js'
import { aiFieldsFor, UNRECORDED } from '../src/utils/aiScoreColumns.js'
const { novelty: N, usefulness: U } = aiFieldsFor('gpt-6-astra')

let failures = 0
function check(name, cond, detail) {
  if (cond) { console.log(`  ok   ${name}`); return }
  failures++
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 3.2 / 3.3: the AI-scores + evaluator upload ────────────────────────────
console.log('matchScoresIntoRows — an upload only fills unscored ideas')
{
  const rows = [
    { rid: 'a', idea_title: 'Thermo signal commuter Jacket', [N]: 4, [U]: 3 }, // fully scored
    { rid: 'b', idea_title: 'Zone map Athletic Top', [N]: '', [U]: '' },        // unscored
    { rid: 'c', idea_title: 'Half scored idea', [N]: 5, [U]: '' },              // half scored
  ]
  const entries = [
    { title: 'Thermo signal commuter Jacket', novelty: 1, usefulness: 1 },
    { title: 'Zone map Athletic Top', novelty: 2, usefulness: 5 },
    { title: 'Half scored idea', novelty: 1, usefulness: 4 },
    { title: 'An idea nobody loaded', novelty: 3, usefulness: 3 },
  ]
  // Since 2026-09-24 the AI upload fills ONE MODEL's own columns (aiScoreColumns.js).
  const res = matchScoresIntoRows(rows, entries, null, { novelty: N, usefulness: U })
  const [a, b, c] = res.rows

  check('an already-scored idea keeps BOTH its scores',
    a[N] === 4 && a[U] === 3, `got ${a[N]}/${a[U]}`)
  check('an unscored idea receives the file\'s scores',
    b[N] === 2 && b[U] === 5, `got ${b[N]}/${b[U]}`)
  check('a half-scored idea keeps its score and gains only the missing one',
    c[N] === 5 && c[U] === 4, `got ${c[N]}/${c[U]}`)
  check('counts: filled=2, kept=1, unmatched=1',
    res.filled === 2 && res.kept === 1 && res.unmatched === 1,
    `filled=${res.filled} kept=${res.kept} unmatched=${res.unmatched}`)
  check('matched still counts every file row that found an idea (3)',
    res.matched === 3, `matched=${res.matched}`)
  check('the input rows are not mutated',
    rows[0][N] === 4 && rows[1][N] === '', 'source array was written through')
}

{
  // With no target named, a file's plain Novelty / Usefulness has no model name:
  // it goes under "model not recorded", never into the derived mean columns.
  const res = matchScoresIntoRows([{ rid: 'a', idea_title: 'Plain file' }], [{ title: 'Plain file', novelty: 3, usefulness: 4 }])
  const R = aiFieldsFor(UNRECORDED)
  check('the default target is "model not recorded"', res.rows[0][R.novelty] === 3 && res.rows[0][R.usefulness] === 4 && !('novelty' in res.rows[0]),
    JSON.stringify(res.rows[0]))
}

console.log('matchScoresIntoRows — a blank/unusable file cell never blanks a score')
{
  const rows = [{ rid: 'a', idea_title: 'Kept idea', novelty: 4, usefulness: 2 }]
  const res = matchScoresIntoRows(rows, [{ title: 'Kept idea', novelty: '', usefulness: 'n/a' }])
  check('scores survive an empty + a non-numeric cell',
    res.rows[0].novelty === 4 && res.rows[0].usefulness === 2,
    `got ${res.rows[0].novelty}/${res.rows[0].usefulness}`)
  check('the untouched idea counts as kept, not filled',
    res.filled === 0 && res.kept === 1, `filled=${res.filled} kept=${res.kept}`)
}

console.log('matchScoresIntoRows — the evaluator upload (3.3) obeys the same rule')
{
  const rows = [{ rid: 'a', idea_title: 'Rated idea', novelty: 4, ext_novelty: 5, ext_usefulness: '' }]
  const fields = { novelty: 'ext_novelty', usefulness: 'ext_usefulness' }
  const res = matchScoresIntoRows(rows, [{ title: 'Rated idea', novelty: 1, usefulness: 2 }], null, fields)
  check('an existing evaluator rating is kept, the missing one filled',
    res.rows[0].ext_novelty === 5 && res.rows[0].ext_usefulness === 2,
    `got ${res.rows[0].ext_novelty}/${res.rows[0].ext_usefulness}`)
  check('the AI column is untouched by an evaluator upload',
    res.rows[0].novelty === 4, `got ${res.rows[0].novelty}`)
}

console.log('matchScoreTable — the per-row score-file match obeys the same rule')
{
  const rows = [
    { rid: 'a', idea_id: 'i1', idea_title: 'Scored', [N]: 4, [U]: 3 },
    { rid: 'b', idea_id: 'i2', idea_title: 'Half', [N]: 5, [U]: '' },
  ]
  const res = matchScoreTable(rows, [
    { id: 'i1', session: '', title: 'Scored', values: { [N]: 1, [U]: 1 } },
    { id: 'i2', session: '', title: 'Half', values: { [N]: '', [U]: 2 } },
  ])
  check('a scored idea keeps both scores; a half-scored one gains only the missing one; a blank never blanks',
    res.rows[0][N] === 4 && res.rows[0][U] === 3 && res.rows[1][N] === 5 && res.rows[1][U] === 2,
    JSON.stringify(res.rows))
  check('counts: filled=1, kept=1', res.filled === 1 && res.kept === 1, `filled=${res.filled} kept=${res.kept}`)
}

// ── 3.1: "Upload additional KPIs" ──────────────────────────────────────────
console.log('matchUploadedKpisIntoRows — recognised KPI columns fill only blanks')
{
  const rows = [
    { rid: 'a', idea_id: 'i1', idea_title: 'Scored', novelty: 4, usefulness: '', x_ks: 0.2 },
    { rid: 'b', idea_id: 'i2', idea_title: 'Unscored', novelty: '', usefulness: '', x_ks: 0.9 },
  ]
  const entries = [
    { idea_id: 'i1', title: 'Scored', values: { novelty: 1, usefulness: 3, x_ks: 0.55 } },
    { idea_id: 'i2', title: 'Unscored', values: { novelty: 2, usefulness: 2, x_ks: 0.11 } },
  ]
  const res = matchUploadedKpisIntoRows(rows, entries, ['novelty', 'usefulness', `${UPLOADED_KPI_PREFIX}ks`])
  const [a, b] = res.rows

  check('an existing AI Novelty is NOT overwritten by an uploaded KPI file',
    a.novelty === 4, `got ${a.novelty}`)
  check('the blank AI Usefulness beside it IS filled',
    a.usefulness === 3, `got ${a.usefulness}`)
  check('an unscored idea gets both',
    b.novelty === 2 && b.usefulness === 2, `got ${b.novelty}/${b.usefulness}`)
  check('an x_ extra column is REPLACED (it is the file\'s own column)',
    a.x_ks === 0.55 && b.x_ks === 0.11, `got ${a.x_ks}/${b.x_ks}`)
  // filled / kept are per-IDEA and mutually exclusive: an idea that gained any
  // score counts as filled even if it also held one, so the two can never
  // double-count an idea in the message the page prints.
  check('counts: filled=2, kept=0 ("Scored" gained usefulness, so it is filled)',
    res.filled === 2 && res.kept === 0, `filled=${res.filled} kept=${res.kept}`)
}

console.log('matchUploadedKpisIntoRows — a fully-scored idea is left entirely alone')
{
  const rows = [{ rid: 'a', idea_id: 'i1', idea_title: 'Done', novelty: 4, usefulness: 5, overall_quality: 4.5 }]
  const res = matchUploadedKpisIntoRows(
    rows,
    [{ idea_id: 'i1', title: 'Done', values: { novelty: 1, usefulness: 1, overall_quality: 1 } }],
    ['novelty', 'usefulness', 'overall_quality'],
  )
  const a = res.rows[0]
  check('all three canonical KPIs keep their values',
    a.novelty === 4 && a.usefulness === 5 && a.overall_quality === 4.5,
    `got ${a.novelty}/${a.usefulness}/${a.overall_quality}`)
  check('it is reported as kept, not filled',
    res.filled === 0 && res.kept === 1, `filled=${res.filled} kept=${res.kept}`)
}

// ── The CSV round trip ─────────────────────────────────────────────────────
console.log('CSV — values leave and come back as they were')
{
  // The Step-5 regression CSV is read by Python and R: a negative KPI must reach
  // them as a number, not as the text "'-0.25" (which both read as missing).
  const csv = rowsToCsv([{ idea_id: 'a', x_ks: -0.25, text: '- A bullet idea', det_novelty: 0.4 }], ['idea_id', 'x_ks', 'text', 'det_novelty'])
  const line = csv.split('\n')[1]
  check('rowsToCsv never puts a "\'" in front of a number (or of the text)', line === 'a,-0.25,- A bullet idea,0.4', line)
  const back = csvToRows(csv)[0]
  check('...and reads back whole', back.x_ks === '-0.25' && Number(back.x_ks) === -0.25 && back.text === '- A bullet idea', JSON.stringify(back))

  // The page's "Download all data" CSV guards TEXT that opens with = + - @ (Excel
  // would run it as a formula) with one "'". Importing that file must drop it
  // again, or "- Personalizable phone case" comes back as "'- Personalizable …".
  const pageEsc = v => {   // the writer in DataAnalytics.jsx downloadAllDataCsv
    let t = v == null ? '' : String(v)
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(t)) t = "'" + t
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t
  }
  const texts = ['- Personalizable phone case', '=SUM(A1)', '+ plus idea', '@home', '\tTabbed', "'Quoted' title", "It's fine", 'Plain, with comma']
  const file = ['Idea ID,Title,Novelty', ...texts.map((t, i) => [pageEsc(`i${i}`), pageEsc(t), pageEsc(-1.5)].join(','))].join('\n')
  const read = csvToRows('\ufeff' + file)
  check('csvToRows removes exactly the one "\'" the page\'s CSV writer added', JSON.stringify(read.map(r => r.Title)) === JSON.stringify(texts), JSON.stringify(read.map(r => r.Title)))
  check('...and a number stays a number', read.every(r => r.Novelty === '-1.5') && read[0]['Idea ID'] === 'i0', JSON.stringify(read[0]))
  check('a text that itself starts with "\'" and a letter is left alone', csvToRows("t\n'Quoted'")[0].t === "'Quoted'")
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.')
process.exit(failures ? 1 : 0)
