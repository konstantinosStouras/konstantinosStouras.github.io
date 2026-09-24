/**
 * analytics-page-guard.mjs — how the Data Analytics page handles the per-model AI
 * score columns, measured in a real browser (review of 2026-09-24).
 *
 *   node _ideasearchlab-src/tools/analytics-page-guard.mjs
 *
 * Builds the page on its own with Firebase stubbed (the translate-page harness,
 * ./translate-page/build.mjs) and drives it with Playwright. Nothing leaves the
 * machine: the one provider call the page makes (the rating run in section 7) is
 * answered by a stub. Every section pins a problem the review reproduced:
 *
 *   0. (Node) one Rankings record per idea: copies merged per column, the means
 *      rebuilt from the merged record, keyed on session + Idea ID.
 *   1. A model's blank cell cannot be typed into (a hand rating there would be
 *      exported as that model's); a score it gave can be corrected, and clearing
 *      it then typing a new value is one edit, even for the chosen model.
 *   2. A model whose last value is cleared keeps its columns, in place.
 *   3. "Load AI scores file" reads a decorated bare column ("Novelty Rating").
 *   4. A scores file with Idea ID + Session Code puts every model of a row on the
 *      same idea, even when two ideas share a title.
 *   5. The aggregate's Rankings tab keys on session + Idea ID (ideas are numbered
 *      per session) and carries its Session Code.
 *   6. "Upload additional KPIs" averages the raters' columns.
 *   7. Steps 4–5 say when the ideas were not all rated by the same models.
 *   8. A run whose every answer came back without a rating stops after one pass
 *      and says why (not "check the API key"); after two such batches in a row
 *      it stops sending.
 *   9. Every 3.1 result table reaches the Excel files (owner, 2026-09-24): the
 *      "Check against the ratings" r and n on an "Empirical KPIs vs ratings" tab,
 *      the pool / novelty × usefulness / specificity tables with their two medians
 *      on "Pool KPIs by condition", in all three Excel downloads, and a downloaded
 *      file re-imported still builds an aggregate (no duplicate tab).
 *  10. Table 1 of Step 4 (summary statistics + correlations) reaches the same three
 *      Excel downloads, number for number with the page, with the ideas behind each
 *      correlation (Node checks of the sheet builder, then the page).
 */
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { buildHarness } from './translate-page/build.mjs'
import { ideaValueLookup, ideaKey } from '../src/utils/rankingsMerge.js'
import { buildSummaryTable, summaryTableSheetRows } from '../src/utils/analyticsData.js'
import { detResultSheets, ratingCheck, POOL_KPI_SHEET, RATING_CHECK_SHEET } from '../src/utils/kpiResultSheets.js'
import { aiNovKey, aiUseKey, modelSlug } from '../src/utils/aiScoreColumns.js'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx-js-style')

let fails = 0
const failed = []
let section = ''
const check = (n, c, d) => {
  console.log((c ? '  ok   ' : '  FAIL ') + n + (c || d == null ? '' : ' — ' + d))
  if (!c) { fails++; failed.push(`[${section}] ${n}`) }
}
const head = s => { section = s; console.log(`\n=== ${s} ===`) }

// ── 0. The Rankings merge, in Node ───────────────────────────────────────────
head('0. one Rankings record per idea (rankingsMerge.js)')
{
  const cols = [{ key: 'ai_nov__a' }, { key: 'ai_nov__b' }, { key: 'novelty' }]
  const mean = r => {
    const v = ['ai_nov__a', 'ai_nov__b'].map(k => r[k]).filter(x => x !== '' && x != null)
    return { ...r, novelty: v.length ? v.reduce((s, x) => s + x, 0) / v.length : '' }
  }
  const rows = [
    { session: 'S1', idea_id: '1', ai_nov__a: 2, ai_nov__b: '', novelty: 2 },      // copy 1: model a only
    { session: 'S1', idea_id: '1', ai_nov__a: '', ai_nov__b: 4, novelty: 4 },      // copy 2: model b only
    { session: 'S2', idea_id: '1', ai_nov__a: 5, ai_nov__b: '', novelty: 5 },      // another session's idea 1
    { session: 'S2', idea_id: '9', ai_nov__a: 1, ai_nov__b: '', novelty: 1 },
  ]
  const get = ideaValueLookup(rows, cols, mean)
  const s1 = get('S1', '1')
  check('two copies of one idea merge per column (a from copy 1, b from copy 2)', s1.ai_nov__a === 2 && s1.ai_nov__b === 4, JSON.stringify(s1))
  check('…and the mean is rebuilt from the merged record (3, not the first copy\'s 2)', s1.novelty === 3, JSON.stringify(s1))
  check('the same Idea ID in another session is another idea', get('S2', '1').ai_nov__a === 5 && get('S2', '1').ai_nov__b === '', JSON.stringify(get('S2', '1')))
  check('an unknown session falls back to the Idea ID only when one idea carries it', get('X', '9')?.ai_nov__a === 1 && get('X', '1') === undefined)
  check('the inputs are not mutated', rows[0].ai_nov__b === '' && rows[0].novelty === 2)
  check('ideaKey separates session and id (S1+"12" is not S11+"2")', ideaKey('S1', '12') !== ideaKey('S11', '2'))
}

// ── 10a. The Table 1 sheet builder, in Node ──────────────────────────────────
head('10a. the Table 1 sheet (analyticsData.js summaryTableSheetRows)')
{
  const rows = [
    { condition: 'None', text: 'a b c', det_novelty: 0.1, det_score: 0.2 },
    { condition: 'Solo', text: 'a b c d', det_novelty: 0.4, det_score: 0.3 },
    { condition: 'Group', text: 'a b', det_novelty: 0.9, det_score: '' },
    { condition: 'Both', text: 'a b c d e f', det_novelty: 0.6, det_score: 0.8 },
    { condition: 'Both', text: '' },                                   // no KPI at all
  ]
  const sum = buildSummaryTable(rows)
  const sheet = summaryTableSheetRows(sum, { ideas: 5, onlyScored: false })
  const k = sum.variables.length
  const names = sum.variables.map((v, i) => `${i + 1}. ${v.label}`)
  check('buildSummaryTable counts the ideas behind each pair (novelty × NoveltyScore: 3, novelty alone: 4)',
    sum.pairN?.[0]?.[1] === 3 && sum.pairN?.[0]?.[0] === 4, JSON.stringify(sum.pairN?.slice(0, 2)))
  check('one row per variable, Variable first, then n / Mean / Median / SD / Min / Max, then the numbered variables',
    sheet && JSON.stringify(Object.keys(sheet[0])) === JSON.stringify(['Variable', 'n', 'Mean', 'Median', 'SD', 'Min', 'Max', ...names]),
    JSON.stringify(sheet && Object.keys(sheet[0])))
  check('lower triangle only: 1 on the diagonal, the upper triangle blank',
    sheet[0][names[0]] === 1 && sheet[0][names[1]] === '' && typeof sheet[1][names[0]] === 'number', JSON.stringify(sheet.slice(0, 2)))
  check('each value is the table\'s own, to 3 decimals (r of the two KPIs)',
    Math.abs(sheet[1][names[0]] - sum.corr[1][0]) < 5e-4, `${sheet[1][names[0]]} vs ${sum.corr[1][0]}`)
  const at = sheet.findIndex(r => /^Ideas with both values/.test(r.Variable || ''))
  check('the counts grid follows under its heading, same shape', at === k + 1 && sheet[at + 2][names[0]] === 3 && sheet[at + 2][names[2]] === '',
    JSON.stringify(sheet[at + 2]))
  check('the notes say which ideas the table covers', sheet.some(r => /Ideas analysed in Section 4: 5 \(every loaded idea\)\. N = 4 ideas/.test(r.Variable || '')),
    sheet.map(r => r.Variable).filter(Boolean).slice(-3).join(' | '))
  check('no Table 1 (and no sheet) when no idea carries a KPI', summaryTableSheetRows(buildSummaryTable([{ condition: 'None', text: 'x' }])) === null)
}

// ── 9a. The 3.1 result tabs, in Node ─────────────────────────────────────────
head('9a. the 3.1 result tabs (kpiResultSheets.js detResultSheets)')
{
  const validation = {
    cols: ['AI Novelty (GPT-6 Astra)', 'Eval. Novelty'],
    rows: [{ label: 'Novelty (empirical)', side: 'novelty', cells: [{ r: 0.41234, n: 12 }, { r: null, n: 2 }] }],
  }
  const overall = { r: 0.2, rLen: 0.1, q: { n: 4, both: 1, novelOnly: 1, usefulOnly: 1, neither: 1 }, facets: {} }
  const cond = { condition: 'Solo', n: 4, uf80: 0.5, productivity: 3, ...overall }
  const full = detResultSheets({ perCond: [cond], overall, ideas: 4, novCut: 0.3, useCut: 0.6, validation })
  check('both tabs from a result with ratings', full.map(x => x.name).join('|') === `${POOL_KPI_SHEET}|${RATING_CHECK_SHEET}`, full.map(x => x.name).join('|'))
  const pool = full[0].rows, chk = full[1].rows
  check('the pool tab: one row per condition + "All ideas", each with the two medians',
    pool.length === 2 && pool[1].Condition === 'All ideas' && pool.every(r => r['Novel = NoveltyScore above (median of all ideas)'] === 0.3 && r['Useful = Usefulness score above (median of all ideas)'] === 0.6),
    JSON.stringify(pool))
  check('the ratings tab: r to 3 decimals, blank where r is not defined, then the n grid under its heading',
    chk[0]['AI Novelty (GPT-6 Astra)'] === 0.412 && chk[0]['Eval. Novelty'] === '' && /^Ideas with both values/.test(chk[2]['Empirical KPI'])
      && chk[3]['AI Novelty (GPT-6 Astra)'] === 12 && chk[3]['Eval. Novelty'] === 2, JSON.stringify(chk))
  // No idea with a recognised condition (labels "A" / "B"): the page still draws the
  // "All ideas" rows and the check, so the files must carry them too (review, 2026-09-24).
  const noCond = detResultSheets({ perCond: [], overall, ideas: 4, novCut: 0.3, useCut: 0.6, validation })
  check('no per-condition row: both tabs are still written, the pool tab with its "All ideas" row',
    noCond.length === 2 && noCond[0].rows.length === 1 && noCond[0].rows[0].Condition === 'All ideas', JSON.stringify(noCond.map(x => [x.name, x.rows.length])))
  check('no ratings loaded: only the pool tab', detResultSheets({ perCond: [cond], overall, validation: null }).map(x => x.name).join('|') === POOL_KPI_SHEET)
  check('no Compute result: no tab', detResultSheets(null).length === 0)

  // The check itself, read from the ideas' stored KPIs and ratings as they are now.
  const astra = modelSlug('gpt-6-astra')
  const det = [[0.1, 0.2, 0.3], [0.4, 0.5, 0.2], [0.9, 0.8, 0.6], [0.6, 0.7, 0.9], [0.2, 0.1, 0.4]]
  const rows = det.map(([nov, sc, use], i) => ({
    det_novelty: nov, det_score: sc, det_need_fit: use, det_specificity: 0.4, det_workability: 1, det_usefulness: use,
    overall_quality: 3,
  }))
  check('no rating on the ideas: no check (the page draws no table)', ratingCheck(rows) === null)
  const rated = rows.map((r, i) => ({ ...r, [aiNovKey(astra)]: [1, 2, 5, 4, 1][i], [aiUseKey(astra)]: [2, 2, 3, 5, 3][i], ext_novelty: i < 2 ? 3 : '' }))
  const live = ratingCheck(rated)
  check('a model\'s two columns join once three ideas carry them; AI Quality and a 2-idea evaluator column do not',
    !!live && JSON.stringify(live.cols) === JSON.stringify(['AI Novelty (GPT-6 Astra)', 'AI Usefulness (GPT-6 Astra)']), JSON.stringify(live?.cols))
  const nov = live?.rows?.find(r => r.label === 'Novelty (empirical)')
  const xs = det.map(d => d[0]), ys = [1, 2, 5, 4, 1]
  const mx = xs.reduce((a, b) => a + b) / 5, my = ys.reduce((a, b) => a + b) / 5
  const want = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0) * ys.reduce((a, y) => a + (y - my) ** 2, 0))
  check('r is Pearson\'s over the ideas with both values, n counts them, and the six KPIs keep their sides',
    live?.rows?.length === 6 && Math.abs(nov.cells[0].r - want) < 1e-12 && nov.cells[0].n === 5 && nov.side === 'novelty'
      && live.rows.find(r => r.label === 'Usefulness score (empirical)').side === 'usefulness', JSON.stringify(nov))
  check('a constant KPI (Workability all 1) gives a blank r, not 0',
    live.rows.find(r => r.label === 'Workability (empirical)').cells.every(c => c.r === null))
  check('a rating added later is in the next reading (no recompute needed)',
    ratingCheck(rated.map((r, i) => ({ ...r, ext_novelty: [3, 3, 4, 5, 1][i] })))?.cols.includes('Eval. Novelty'))
}

// ── Build + serve the harness ────────────────────────────────────────────────
const OUT = await buildHarness(join(process.env.TMPDIR || tmpdir(), 'isl-analytics-page-harness'))
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  let f = join(OUT, decodeURIComponent(u.pathname))
  if (u.pathname.endsWith('/')) f = join(f, 'index.html')
  try { const b = await readFile(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(b) }
  catch { const b = await readFile(join(OUT, 'index.html')); res.writeHead(200, { 'content-type': 'text/html' }); res.end(b) }
})
await new Promise(r => srv.listen(0, '127.0.0.1', r))
const BASE = `http://127.0.0.1:${srv.address().port}/`

// ── The dataset: two sessions that both number their ideas from 1 ─────────────
const ASTRA = ['AI Novelty (GPT-6 Astra)', 'AI Usefulness (GPT-6 Astra)']
const SONNET = ['AI Novelty (Claude Sonnet 5)', 'AI Usefulness (Claude Sonnet 5)']
const IDEAS = [
  { id: '1', s: 'S1', cond: 'Solo', stage: 'group', final: 'Yes', t: 'Fever sock', astra: [2, 3] },
  { id: '2', s: 'S1', cond: 'Solo', stage: 'group', final: 'Yes', t: 'Mood scarf', astra: [4, 4], sonnet: [5, 5] },
  { id: '3', s: 'S1', cond: 'Solo', stage: 'group', final: 'No', t: 'Sports headband' },
  { id: '4', s: 'S1', cond: 'Solo', stage: 'group', final: 'Yes', t: 'Night light bib' },
  { id: '1', s: 'S2', cond: 'Group', stage: 'group', final: 'Yes', t: 'Heat cup', astra: [5, 5] },
  { id: '2', s: 'S2', cond: 'Group', stage: 'group', final: 'Yes', t: 'Sleep bag' },
  { id: '3', s: 'S2', cond: 'Group', stage: 'group', final: 'Yes', t: 'Sports headband' },
]
const desc = t => `${t}: a fabric product that changes colour at body temperature so people notice a fever early.`
function book(sheets) {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name)
  return Buffer.from(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }))
}
function ideasBook(ideas = IDEAS) {
  return book([['Ideas', ideas.map(i => ({
    'Idea ID': i.id, 'Session Code': i.s, 'Condition': i.cond, 'Stage': i.stage, 'Author ID': `${i.s}-a${i.id}`,
    'Final Group Pick': i.final, 'Title': i.t, 'Description': desc(i.t),
    [ASTRA[0]]: i.astra?.[0] ?? '', [ASTRA[1]]: i.astra?.[1] ?? '',
    [SONNET[0]]: i.sonnet?.[0] ?? '', [SONNET[1]]: i.sonnet?.[1] ?? '',
  }))]])
}
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// ── Browser ──────────────────────────────────────────────────────────────────
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' })
const pageErrors = [], consoleErrors = [], offsite = [], apiCalls = []
let dialogs = []
let anthropicReply = null     // section 8 sets what the stubbed Anthropic API answers

async function newContext() {
  const ctx = await br.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  await ctx.route('**/*', async route => {
    const req = route.request()
    const u = new URL(req.url())
    if (u.hostname === '127.0.0.1') return route.continue()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (u.hostname === 'api.anthropic.com' && anthropicReply) {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      apiCalls.push(Date.now())
      return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(anthropicReply) })
    }
    offsite.push(req.url())
    return route.abort()
  })
  return ctx
}
let p = null
async function openPage(ctx, name) {
  p = await ctx.newPage()
  p.on('pageerror', e => pageErrors.push(`[${name}] ${e.message}`))
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${name}] ${m.text()}`) })
  p.on('dialog', d => { dialogs.push(`[${name}] ${d.type()}: ${d.message()}`); d.accept() })
  await p.addInitScript(s => { globalThis.__HARNESS_AI_SETTINGS = s }, { provider: 'claude', apiKeys: { claude: 'test-key-123456' } })
  await p.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p.getByRole('heading', { name: 'Data Analytics' }).waitFor({ timeout: 10000 })
}
const btn = name => p.getByRole('button', { name }).first()
const bodyText = () => p.locator('body').innerText()
async function importFile(buffer, name) {
  await p.locator('input[type=file]').first().setInputFiles({ name, mimeType: XLSX_MIME, buffer })
  await btn(/^Load 1 imported file$/).waitFor({ timeout: 5000 })
  await btn(/^Load 1 imported file$/).click()
  await p.getByText(/Every loaded idea can be measured in English/).first().waitFor({ timeout: 5000 })
}
async function captureDownload(trigger) {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), trigger()])
  return XLSX.read(await readFile(await dl.path()), { type: 'buffer' })
}
// The Step-3 table: its header labels, and one idea's cell for a header.
const tableHeads = () => p.evaluate(() => {
  const t = [...document.querySelectorAll('table')].find(x => [...x.querySelectorAll('thead th')].some(th => /^AI (Novelty|Usefulness) \(/.test(th.innerText.trim())))
  return t ? [...t.querySelectorAll('thead th')].map(th => th.innerText.replace(/[▲▼]/g, '').trim()) : []
})
const cellOf = async (session, id, label) => {
  const heads = await tableHeads()
  const col = heads.indexOf(label)
  const row = p.locator('table tbody tr').filter({ has: p.locator('td:nth-child(1)', { hasText: new RegExp(`^${id}$`) }) })
    .filter({ has: p.locator('td:nth-child(2)', { hasText: new RegExp(`^${session}$`) }) })
  return { col, cell: row.first().locator(`td:nth-child(${col + 1})`) }
}
const sheetRows = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name] || {}, { defval: '' })
const find = (rows, s, id) => rows.find(r => String(r['Session Code']) === s && String(r['Idea ID']) === id)

try {
  const ctx = await newContext()
  await openPage(ctx, 'main')
  await importFile(ideasBook(), 'ideas.xlsx')
  check('the dataset loads without a dialog', dialogs.length === 0, dialogs.join(' | '))

  // Rate with Claude Sonnet 5, the model that has one idea's pair in the data
  // (the default is the provider's top model, Fable 5.1, so it is chosen here).
  await p.locator('select[title="Which provider\'s API key to use"]').selectOption('claude')
  await p.locator('select[title="Which of that provider\'s models rates the ideas"]').selectOption('claude-sonnet-5')
  check('the Final-Ideas box starts unticked (every idea is in scope by default)',
    !(await p.locator('label', { hasText: 'Only score the' }).locator('input[type="checkbox"]').isChecked()))

  // ── 1. Hand edits ──────────────────────────────────────────────────────────
  head('1. a blank model cell is not typed into; a score it gave can be corrected')
  const blank = await cellOf('S1', '1', SONNET[0])
  check('Claude Sonnet 5 has its column', blank.col >= 0, (await tableHeads()).join(' | '))
  check('its blank cell for an idea it did not rate has no input', await blank.cell.locator('input').count() === 0,
    await blank.cell.innerHTML())
  const astraBlank = await cellOf('S1', '3', ASTRA[0])
  check('same for GPT-6 Astra, which has rated other ideas', await astraBlank.cell.locator('input').count() === 0)
  // Mood scarf: blank Sonnet's usefulness first, then correct its novelty 5 -> 4
  // with select-all + Backspace + "4": that Backspace clears the model's last value.
  const use = await cellOf('S1', '2', SONNET[1])
  await use.cell.locator('input').fill('')
  await use.cell.locator('input').blur()
  const nov = await cellOf('S1', '2', SONNET[0])
  const input = nov.cell.locator('input')
  await input.click()
  await p.keyboard.press('Control+A')
  await p.keyboard.press('Backspace')
  check('clearing the chosen model\'s last value keeps the cell an input, with focus',
    await nov.cell.locator('input').count() === 1 && await p.evaluate(() => document.activeElement?.tagName) === 'INPUT')
  await p.keyboard.type('4')
  check('…so the new value lands (4)', await nov.cell.locator('input').inputValue() === '4', await nov.cell.innerHTML())
  await nov.cell.locator('input').blur()

  // ── 2. Columns stay in place ────────────────────────────────────────────────
  head('2. a model whose last value is cleared keeps its columns, in place')
  const before = await tableHeads()
  const n2 = await cellOf('S1', '2', SONNET[0])
  await n2.cell.locator('input').fill('')
  await n2.cell.locator('input').blur()
  const after = await tableHeads()
  check('Claude Sonnet 5 keeps both columns at the same place', before.indexOf(SONNET[0]) === after.indexOf(SONNET[0]) &&
    before.indexOf(SONNET[1]) === after.indexOf(SONNET[1]) && after.indexOf(SONNET[0]) >= 0, `${before.join('|')}  →  ${after.join('|')}`)
  check('…and the cleared cell is read-only once left', await (await cellOf('S1', '2', SONNET[0])).cell.locator('input').count() === 0)
  // Put the rating back through the file path below? No: section 1 measured what
  // it needed; the rest of the page runs with Sonnet cleared.

  // ── 3. A decorated bare column ──────────────────────────────────────────────
  head('3. "Load AI scores file" reads "Novelty Rating" / "Usefulness Rating"')
  dialogs = []
  const rated = book([['All Ideas Ranked', [
    { 'Idea Title': 'Night light bib', 'Novelty Rating': 3, 'Usefulness Rating': 4 },
    { 'Idea Title': 'Sleep bag', 'Novelty Rating': 2, 'Usefulness Rating': 5 },
  ]]])
  await p.locator('button:has-text("Load AI scores file") + input[type=file]').setInputFiles({ name: 'rated.xlsx', mimeType: XLSX_MIME, buffer: rated })
  await p.getByText(/^Loaded scores from/).first().waitFor({ timeout: 5000 })
  const msg3 = await p.getByText(/^Loaded scores from/).first().innerText()
  check('the file is read, not refused', dialogs.length === 0 && /filled the empty cells of 2 ideas/.test(msg3), `${dialogs.join(' | ')} ${msg3}`)
  const unrec = await cellOf('S1', '4', 'AI Novelty (model not recorded)')
  check('…into "model not recorded" (no model named)', unrec.col >= 0 && /^3(\.00)?$/.test((await unrec.cell.innerText()).trim() || await unrec.cell.locator('input').inputValue().catch(() => '')),
    (await tableHeads()).join(' | '))

  // ── 4. One file row, one idea ───────────────────────────────────────────────
  head('4. a scores file with Idea ID + Session Code puts every model of a row on one idea')
  const byId = book([['Rankings', [
    { 'Idea ID': '3', 'Session Code': 'S1', 'Title': 'Sports headband', [ASTRA[0]]: 1, [ASTRA[1]]: 1, 'AI Novelty (Mistral Small 4)': '', 'AI Usefulness (Mistral Small 4)': '' },
    { 'Idea ID': '3', 'Session Code': 'S2', 'Title': 'Sports headband', [ASTRA[0]]: 5, [ASTRA[1]]: 4, 'AI Novelty (Mistral Small 4)': 4, 'AI Usefulness (Mistral Small 4)': 3 },
  ]]])
  await p.locator('button:has-text("Load AI scores file") + input[type=file]').setInputFiles({ name: 'byid.xlsx', mimeType: XLSX_MIME, buffer: byId })
  await p.waitForTimeout(300)
  const all = await captureDownload(() => btn('Download all idea data (Excel)').click())
  const ideas = sheetRows(all, 'ideas')
  const hS1 = find(ideas, 'S1', '3'), hS2 = find(ideas, 'S2', '3')
  check('S1\'s "Sports headband" gets its own Astra 1 and no Mistral score',
    hS1?.[ASTRA[0]] === 1 && (hS1['AI Novelty (Mistral Small 4)'] ?? '') === '', JSON.stringify(hS1))
  check('S2\'s "Sports headband" gets Astra 5 AND Mistral 4, from the same file row',
    hS2?.[ASTRA[0]] === 5 && hS2['AI Novelty (Mistral Small 4)'] === 4, JSON.stringify(hS2))

  // ── 5. The Rankings tab ─────────────────────────────────────────────────────
  head('5. the Rankings tab keys on session + Idea ID')
  const agg = await captureDownload(() => btn(/^Download Excel$/).click())
  const rk = sheetRows(agg, 'Rankings')
  check('Rankings carries a Session Code column', rk.length > 0 && 'Session Code' in rk[0], Object.keys(rk[0] || {}).join(' | '))
  check('S1 idea 1 carries its own Astra 2, S2 idea 1 its own Astra 5 (ideas are numbered per session)',
    find(rk, 'S1', '1')?.[ASTRA[0]] === 2 && find(rk, 'S2', '1')?.[ASTRA[0]] === 5,
    JSON.stringify([find(rk, 'S1', '1'), find(rk, 'S2', '1')]))
  const meanCol = 'AI Novelty (mean across models)'
  const bad = rk.filter(r => {
    const v = Object.entries(r).filter(([k, x]) => /^AI Novelty \(/.test(k) && k !== meanCol && x !== '').map(([, x]) => Number(x))
    return v.length >= 2 && Math.abs(Number(r[meanCol]) - v.reduce((s, x) => s + x, 0) / v.length) > 1e-9
  })
  check('every row\'s mean is the mean of the model columns beside it', rk.some(r => r[meanCol] !== '') && bad.length === 0, JSON.stringify(bad.slice(0, 2)))

  // ── 6. Raters averaged ──────────────────────────────────────────────────────
  head('6. "Upload additional KPIs" averages the raters\' columns')
  const raters = book([['Ratings', [
    { 'Idea ID': '4', 'Novelty (rater 1)': 1, 'Novelty (rater 2)': 5, 'Usefulness (rater 1)': 2, 'Usefulness (rater 2)': 4 },
  ]]])
  await p.locator('xpath=//button[contains(., "Upload additional KPIs")]/following-sibling::input[@type="file"][1]')
    .setInputFiles({ name: 'raters.xlsx', mimeType: XLSX_MIME, buffer: raters })
  await p.getByText(/^Loaded \d+ KPI/).first().waitFor({ timeout: 5000 })
  const all2 = await captureDownload(() => btn('Download all idea data (Excel)').click())
  const bib = find(sheetRows(all2, 'ideas'), 'S1', '4')
  check('Eval. Novelty is the mean of the two raters (3), Eval. Usefulness too (3)',
    bib?.['Eval. Novelty'] === 3 && bib?.['Eval. Usefulness'] === 3, JSON.stringify(bib))

  // ── 7. The panel note ───────────────────────────────────────────────────────
  head('7. Steps 4–5 say when the ideas were not all rated by the same models')
  const note = /Not every idea here was rated by the same AI models/
  const t7 = await bodyText()
  check('the note shows (Astra only, Astra + Mistral, "model not recorded")', note.test(t7))
  check('…in both Step 4 and Step 5', (t7.match(/Not every idea here was rated by the same AI models/g) || []).length === 2)
  await p.close()
  await ctx.close()

  // A dataset every rated idea of which was rated by the same model: no note.
  const ctx2 = await newContext()
  await openPage(ctx2, 'uniform')
  await importFile(ideasBook(IDEAS.map(i => ({ ...i, sonnet: undefined }))), 'uniform.xlsx')
  check('no note when every rated idea has the same models', !note.test(await bodyText()))
  await p.close()
  await ctx2.close()

  // ── 8. Answers without a rating ─────────────────────────────────────────────
  head('8. a run whose every answer came back without a rating stops after one pass')
  const ctx3 = await newContext()
  await openPage(ctx3, 'exhausted')
  await importFile(ideasBook(), 'ideas.xlsx')
  await p.locator('select[title="Which provider\'s API key to use"]').selectOption('claude')
  await p.locator('select[title="Which of that provider\'s models rates the ideas"]').selectOption('claude-opus-5-5')
  // Scope to the 6 final ideas (the box is unticked by default) for the call arithmetic below.
  await p.locator('label', { hasText: 'Only score the' }).locator('input[type="checkbox"]').check()
  anthropicReply = { id: 'msg_stub', type: 'message', role: 'assistant', stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '…' }] }
  dialogs = []
  const t0 = Date.now()
  await btn(/^Fill the \d+ missing/).click()
  await p.getByText(/Claude Opus 5\.5 scored \d+ of the/).first().waitFor({ timeout: 60000 })
  const took = Date.now() - t0
  const t8 = await bodyText()
  const err8 = (await p.locator('p.error-msg').allInnerTexts()).join(' | ')
  check('one pass only (no "(2 passes)")', !/\(\d+ passes\)/.test(t8), (t8.match(/Claude Opus 5\.5 scored[^\n]*/) || [''])[0])
  // 6 ideas: one batch call and one single call per idea, each tried 3 times, is
  // 21. A recovery pass would double that, and wait 10 s before it.
  check('…at most 21 calls, no recovery pass', apiCalls.length <= 21, `${apiCalls.length} calls in ${took} ms`)
  check('the message says the model answered without a rating, and why',
    /answered without a rating \(.*token ceiling/.test(err8), err8)
  check('…and does not send the admin to the API key', !/Check the API key/.test(err8))
  await p.close()
  await ctx3.close()

  // 24 final ideas = 3 batches: the rater stops after two batches in a row came
  // back without a rating, instead of sending the third.
  const ctx4 = await newContext()
  await openPage(ctx4, 'exhausted-24')
  const many = Array.from({ length: 24 }, (_, k) => ({ id: String(k + 1), s: 'S9', cond: 'Both', stage: 'group', final: 'Yes', t: `Colour idea ${k + 1}` }))
  await importFile(ideasBook(many), 'many.xlsx')
  await p.locator('select[title="Which provider\'s API key to use"]').selectOption('claude')
  await p.locator('select[title="Which of that provider\'s models rates the ideas"]').selectOption('claude-opus-5-5')
  apiCalls.length = 0
  await btn(/^Fill the \d+ missing/).click()
  await p.getByText(/Claude Opus 5\.5 scored \d+ of the/).first().waitFor({ timeout: 90000 })
  const err8b = (await p.locator('p.error-msg').allInnerTexts()).join(' | ')
  // A batch is 27 calls (the batch call and 8 single calls, each tried 3 times):
  // two batches are 54, a third would make 81.
  check('24 ideas that all come back without a rating: two batches sent, not three (54 calls)', apiCalls.length === 54, `${apiCalls.length} calls`)
  check('…and the message says the run stopped and why', /It stopped after two batches in a row came back like that/.test(err8b), err8b)
  anthropicReply = null
  await p.close()
  await ctx4.close()

  // ── 9. The 3.1 result tables in the Excel files ─────────────────────────────
  head('9. every 3.1 result table reaches the Excel downloads')
  const ctx5 = await newContext()
  await openPage(ctx5, 'det-export')
  await importFile(ideasBook(), 'ideas.xlsx')
  dialogs = []
  await btn(/^Compute empirical KPIs for \d+ idea/).click()
  await p.getByText(/Check against the ratings\./).first().waitFor({ timeout: 20000 })
  // What the page shows: the check table (r to 2 decimals, n in each cell's title)
  // and the two medians printed in the note under the novelty × usefulness table.
  const shown = await p.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find(x => x.querySelector('thead th')?.innerText.trim() === 'Empirical KPI')
    if (!t) return null
    const cols = [...t.querySelectorAll('thead th')].slice(1).map(th => th.innerText.trim())
    const rows = [...t.querySelectorAll('tbody tr')].map(tr => {
      const tds = [...tr.querySelectorAll('td')]
      return {
        label: tds[0].innerText.replace(/\s*\((novelty|usefulness) side\)\s*$/, '').trim(),
        side: (tds[0].innerText.match(/\((novelty|usefulness) side\)/) || [])[1],
        cells: tds.slice(1).map(td => ({ r: td.innerText.trim(), n: Number((td.title.match(/n = (\d+)/) || [])[1]) })),
      }
    })
    const note = [...document.querySelectorAll('p')].map(x => x.innerText).find(x => /loaded ideas \(NoveltyScore/.test(x)) || ''
    const m = note.match(/NoveltyScore (-?[\d.]+), Usefulness score (-?[\d.]+)/)
    return { cols, rows, novCut: m && m[1], useCut: m && m[2] }
  })
  check('the page shows the check table, with at least one rating column', !!shown && shown.cols.length >= 1 && shown.rows.length === 6,
    JSON.stringify(shown))
  const f2 = v => (v === '' || v == null ? '—' : Number(v).toFixed(2))
  // Table 1 of Step 4, as the page shows it (2 decimals; blank upper triangle).
  const shownT1 = await p.evaluate(() => {
    const cap = [...document.querySelectorAll('div')].find(d => /^Table 1\. Summary statistics and correlations/.test(d.innerText.trim()) && d.nextElementSibling)
    const t = cap?.parentElement?.querySelector('table')
    if (!t) return null
    const rows = [...t.querySelectorAll('tbody tr')].map(tr => [...tr.querySelectorAll('td')].map(td => td.innerText.trim()))
    const note = cap.parentElement.innerText.match(/N = (\d+) ideas with at least one KPI value/)
    return { rows, n: note && Number(note[1]) }
  })
  check('the page shows Table 1 with its N', !!shownT1 && shownT1.rows.length > 5 && shownT1.n > 0, JSON.stringify(shownT1))
  // One downloaded workbook's Table 1 tab, measured against the page.
  const checkTable1 = (wb, what) => {
    const rows = sheetRows(wb, 'Table 1 summary + correlations')
    check(`${what}: has a "Table 1 summary + correlations" tab`, rows.length > 0, wb.SheetNames.join(' | '))
    if (!rows.length || !shownT1) return
    const k = shownT1.rows.length
    const names = shownT1.rows.map(r => r[0])
    const mism = []
    const near = (fv, pv) => (pv === '—' || pv === '' ? fv === '' : typeof fv === 'number' && Math.abs(fv - Number(pv)) <= 0.0051)
    shownT1.rows.forEach((pr, i) => {
      const fr = rows[i] || {}
      if (fr.Variable !== pr[0]) mism.push(`row ${i}: ${fr.Variable} vs ${pr[0]}`)
      ;['Mean', 'Median', 'SD', 'Min', 'Max'].forEach((c, ci) => { if (!near(fr[c], pr[1 + ci])) mism.push(`${pr[0]} ${c}: ${fr[c]} vs ${pr[1 + ci]}`) })
      names.forEach((nm, j) => { if (!near(fr[nm], pr[6 + j])) mism.push(`${pr[0]} × ${nm}: ${fr[nm]} vs ${pr[6 + j]}`) })
    })
    check(`${what}: every statistic and correlation is the page's`, mism.length === 0, mism.slice(0, 4).join(' | '))
    const at = rows.findIndex(r => /^Ideas with both values/.test(String(r.Variable)))
    const counts = at > 0 ? rows.slice(at + 1, at + 1 + k) : []
    check(`${what}: …then the ideas behind each correlation (the diagonal is each variable's own n)`,
      counts.length === k && counts.every((r, i) => r.Variable === names[i] && r[names[i]] === rows[i].n && Number.isInteger(r[names[0]])),
      JSON.stringify(counts.slice(0, 2)))
    check(`${what}: …and a note with the page's N`, rows.some(r => new RegExp(`N = ${shownT1.n} ideas with at least one KPI value`).test(String(r.Variable))))
  }
  // One downloaded workbook's two 3.1 tabs, measured against the page.
  const checkBook = (wb, what) => {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets['Empirical KPIs vs ratings'] || {}, { header: 1, defval: '' })
    check(`${what}: has an "Empirical KPIs vs ratings" tab`, aoa.length > 0, wb.SheetNames.join(' | '))
    if (!aoa.length || !shown) return
    const hdr = aoa[0]
    check(`${what}: its columns are the page's (Empirical KPI, Side, then every rating in order)`,
      JSON.stringify(hdr) === JSON.stringify(['Empirical KPI', 'Side', ...shown.cols]), JSON.stringify(hdr))
    const rTable = aoa.slice(1, 1 + shown.rows.length)
    const at = aoa.findIndex(r => /^Ideas with both values/.test(String(r[0])))
    const nTable = at > 0 ? aoa.slice(at + 1, at + 1 + shown.rows.length) : []
    const mism = []
    shown.rows.forEach((row, i) => {
      if (rTable[i]?.[0] !== row.label || rTable[i]?.[1] !== row.side) mism.push(`r row ${i}: ${JSON.stringify(rTable[i])}`)
      if (nTable[i]?.[0] !== row.label) mism.push(`n row ${i}: ${JSON.stringify(nTable[i])}`)
      row.cells.forEach((c, j) => {
        // The file keeps 3 decimals, the page prints 2 of the unrounded r: equal
        // within the page's own rounding (0.655 in the file can print as 0.65).
        const fr = rTable[i]?.[j + 2]
        const same = c.r === '—' ? fr === '' : (typeof fr === 'number' && Math.abs(fr - Number(c.r)) <= 0.0051)
        if (!same) mism.push(`${row.label} × ${shown.cols[j]}: file r ${rTable[i]?.[j + 2]}, page ${c.r}`)
        if (nTable[i]?.[j + 2] !== c.n) mism.push(`${row.label} × ${shown.cols[j]}: file n ${nTable[i]?.[j + 2]}, page ${c.n}`)
      })
    })
    check(`${what}: every r and every n is the page's`, at > 0 && mism.length === 0, `${at} ${mism.slice(0, 4).join(' | ')}`)
    check(`${what}: some r is a number (not a blank tab)`, rTable.some(r => r.slice(2).some(v => typeof v === 'number')))
    const pool = sheetRows(wb, 'Pool KPIs by condition')
    const novCol = 'Novel = NoveltyScore above (median of all ideas)', useCol = 'Useful = Usefulness score above (median of all ideas)'
    const allRow = pool.find(r => r.Condition === 'All ideas')
    check(`${what}: "Pool KPIs by condition" carries the two medians the page prints`,
      // Within the page's own rounding: the file keeps 3 decimals, the page prints 2
      // of the unrounded median (0.3846 prints 0.38; the file's 0.385 would re-round to 0.39).
      pool.length > 1 && pool.every(r => Math.abs(Number(r[novCol]) - Number(shown.novCut)) <= 0.0051 && Math.abs(Number(r[useCol]) - Number(shown.useCut)) <= 0.0051),
      JSON.stringify({ page: [shown.novCut, shown.useCut], file: pool.map(r => [r[novCol], r[useCol]]) }))
    check(`${what}: …and still the cross-check r and the specificity shares`,
      !!allRow && 'Novelty x usefulness r' in allRow && Object.keys(allRow).some(k => /^States: /.test(k)), JSON.stringify(allRow))
  }
  const kpiBook = await captureDownload(() => btn('Download ideas + KPIs (Excel)').click())
  checkBook(kpiBook, 'ideas + KPIs')
  const allBook = await captureDownload(() => btn('Download all idea data (Excel)').click())
  checkBook(allBook, 'all idea data')
  const aggBook = await captureDownload(() => btn(/^Download Excel$/).click())
  checkBook(aggBook, 'aggregate')
  head('10b. Table 1 of Step 4 reaches the same three downloads')
  checkTable1(kpiBook, 'ideas + KPIs')
  checkTable1(allBook, 'all idea data')
  checkTable1(aggBook, 'aggregate')
  check('no dialog while computing and downloading', dialogs.length === 0, dialogs.join(' | '))

  // A model rated AFTER Compute (the page's own order: 3.1, then 3.2) joins the
  // check at once, on the page and in the files, without pressing Compute again.
  const lateModel = ['AI Novelty (Mistral Small 4)', 'AI Usefulness (Mistral Small 4)']
  const late = book([['Rankings', IDEAS.map((i, k) => ({ 'Idea ID': i.id, 'Session Code': i.s, [lateModel[0]]: [1, 3, 5, 2, 4, 3, 5][k], [lateModel[1]]: [2, 4, 4, 1, 5, 3, 2][k] }))]])
  await p.locator('button:has-text("Load AI scores file") + input[type=file]').setInputFiles({ name: 'late.xlsx', mimeType: XLSX_MIME, buffer: late })
  await p.getByText(/^Loaded scores from/).first().waitFor({ timeout: 5000 })
  const colsNow = await p.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find(x => x.querySelector('thead th')?.innerText.trim() === 'Empirical KPI')
    return t ? [...t.querySelectorAll('thead th')].slice(1).map(th => th.innerText.trim()) : []
  })
  check('a model rated after Compute joins the check on the page at once', colsNow.includes(lateModel[0]) && colsNow.includes(lateModel[1]), colsNow.join(' | '))
  const lateBook = await captureDownload(() => btn('Download all idea data (Excel)').click())
  const lateHdr = (XLSX.utils.sheet_to_json(lateBook.Sheets['Empirical KPIs vs ratings'] || {}, { header: 1, defval: '' })[0]) || []
  check('…and in the downloaded "Empirical KPIs vs ratings" tab, column for column with the page',
    JSON.stringify(lateHdr.slice(2)) === JSON.stringify(colsNow), JSON.stringify(lateHdr))

  // Scores added to the SAME ideas keep the 3.1 results (the pool is unchanged)…
  const moreScores = book([['All Ideas Ranked', [{ 'Idea Title': 'Night light bib', 'Novelty Rating': 3, 'Usefulness Rating': 4 }]]])
  await p.locator('button:has-text("Load AI scores file") + input[type=file]').setInputFiles({ name: 'more.xlsx', mimeType: XLSX_MIME, buffer: moreScores })
  await p.getByText(/^Loaded scores from/).first().waitFor({ timeout: 5000 })
  check('scores loaded onto the same ideas keep the 3.1 results', await p.getByText(/Check against the ratings\./).count() > 0)
  // …but a different set of ideas clears them, on the page and in every download.
  dialogs = []
  await btn(/^Clear$/).click()
  await importFile(ideasBook(IDEAS.slice(0, 5)), 'fewer.xlsx')
  const t9 = await bodyText()
  check('new ideas loaded: the old 3.1 tables are gone and the page says why',
    !/Check against the ratings\./.test(t9) && /The loaded ideas changed since the last Compute/.test(t9), (t9.match(/The loaded ideas changed[^\n]*/) || ['(no note)'])[0])
  const stale = await captureDownload(() => btn('Download all idea data (Excel)').click())
  check('…and no download carries them any more', !stale.SheetNames.includes('Pool KPIs by condition') && !stale.SheetNames.includes('Empirical KPIs vs ratings'),
    stale.SheetNames.join(' | '))
  await p.close()
  await ctx5.close()

  // A downloaded aggregate, imported again: the aggregate is rebuilt with ONE copy
  // of each 3.1 tab (the imported ones are dropped, as Rankings is), not two —
  // book_append_sheet throws on a duplicate name and the file would not be built.
  const ctx6 = await newContext()
  await openPage(ctx6, 'det-reimport')
  await importFile(Buffer.from(XLSX.write(aggBook, { bookType: 'xlsx', type: 'buffer' })), 'aggregate.xlsx')
  dialogs = []
  const before9 = await captureDownload(() => btn(/^Download Excel$/).click())
  check('re-imported, before Compute: the imported 3.1 tabs are dropped, not carried stale',
    !before9.SheetNames.includes('Empirical KPIs vs ratings') && !before9.SheetNames.includes('Pool KPIs by condition'), before9.SheetNames.join(' | '))
  check('…and Table 1 is rebuilt from the loaded ideas, once (the imported copy dropped)',
    before9.SheetNames.filter(n => n === 'Table 1 summary + correlations').length === 1, before9.SheetNames.join(' | '))
  await btn(/^Compute empirical KPIs for \d+ idea/).click()
  await p.getByText(/Check against the ratings\./).first().waitFor({ timeout: 20000 })
  const after9 = await captureDownload(() => btn(/^Download Excel$/).click())
  const count = name => after9.SheetNames.filter(n => n === name).length
  check('re-imported + computed: the aggregate builds with one copy of each 3.1 tab',
    count('Empirical KPIs vs ratings') === 1 && count('Pool KPIs by condition') === 1 && count('Table 1 summary + correlations') === 1 && dialogs.length === 0,
    `${after9.SheetNames.join(' | ')} ${dialogs.join(' | ')}`)
  await p.close()
  await ctx6.close()
} catch (e) {
  check('the page sections ran to the end', false, e.stack || e.message)
}

head('page health')
check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '))
check('no request left the machine except the stubbed Anthropic API', offsite.length === 0, offsite.join(', '))

await br.close()
srv.close()
console.log(`\n${fails ? `FAILED — ${fails} check(s):\n  ` + failed.join('\n  ') : 'ANALYTICS PAGE GUARD OK — per-model AI columns behave in the page.'}`)
process.exit(fails ? 1 : 0)
