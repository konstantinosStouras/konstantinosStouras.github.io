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
 *      and says why (not "check the API key").
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

  // Rate with Claude Sonnet 5, the model that has one idea's pair in the data.
  await p.locator('select[title="Which provider\'s API key to use"]').selectOption('claude')
  await p.locator('select[title="Which of that provider\'s models rates the ideas"]').selectOption('claude-sonnet-5')

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
  anthropicReply = { id: 'msg_stub', type: 'message', role: 'assistant', stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '…' }] }
  dialogs = []
  const t0 = Date.now()
  await btn(/^Fill the \d+ missing/).click()
  await p.getByText(/Claude Opus 5\.5 scored \d+ of the/).first().waitFor({ timeout: 60000 })
  const took = Date.now() - t0
  const t8 = await bodyText()
  check('one pass only (no "(2 passes)")', !/\(\d+ passes\)/.test(t8), (t8.match(/Claude Opus 5\.5 scored[^\n]*/) || [''])[0])
  check('…and no 10-second recovery wait', took < 9000, `${took} ms`)
  check('the message says the model answered without a rating, and why',
    /answered without a rating \([^)]*token ceiling/.test(t8), (t8.match(/[^\n]*empty cell[^\n]*/) || ['(none)'])[0])
  check('…and does not send the admin to the API key', !/Check the API key/.test(t8))
  anthropicReply = null
  await p.close()
  await ctx3.close()
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
