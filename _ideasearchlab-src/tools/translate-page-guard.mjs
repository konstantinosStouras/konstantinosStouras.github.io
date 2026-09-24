/**
 * translate-page-guard.mjs — Data Analytics Step 1b, "Translate everything to
 * English", in a REAL browser (Playwright, no network, no Firebase).
 *
 *   node _ideasearchlab-src/tools/translate-page-guard.mjs
 *   PW=/path/to/playwright CHROMIUM=/path/to/chromium node …   (overrides)
 *
 * tools/translate-guard.mjs drives translation.js offline; nothing there renders
 * the admin page, which sits behind RequireInstructor + Firebase. So this guard
 * builds that page ON ITS OWN (tools/translate-page/: an entry that renders only
 * <DataAnalytics/>, every Firebase import resolved to a stub that returns empty
 * data and an AI-Settings doc holding a fake Claude key), serves it locally, stubs
 * api.anthropic.com at the network layer, and plays the owner's request:
 *
 *   "add a first step in the data analysis process that would be translating all
 *    text supplied to our app in English using Fable 5.1 and Anthropic's API …
 *    Everything that is not in English should be translated in English and then
 *    show me updated file with all data collected in English."
 *
 *   1. Import a workbook through Step 1: six ideas (two Chinese, one French, three
 *      English) and a Group Chat sheet with one Chinese message.
 *   2. Step 1b says 3 ideas are not in English and Step 3 is locked; 3.1 Compute
 *      refuses and nothing is sent anywhere.
 *   3. "Find text not in English" lists the 7 texts (the chat message included,
 *      the sender's Chinese name NOT), all to translate.
 *   4. One is typed by hand; "Translate 6 texts with Claude Fable 5.1" sends ONE
 *      request, to the Messages API, model claude-fable-5-1, the translator's
 *      system prompt, carrying exactly the six texts still untranslated.
 *   5. Step 3 unlocks; 3.1 computes a NoveltyScore for all six ideas (the Chinese
 *      ones cannot be measured in Chinese at all, so a number is proof the English
 *      was measured).
 *   6. "Download all data in English (Excel)": every text cell in English, names
 *      kept, each original on the Translations sheet; "Download ideas + KPIs" the
 *      same for the ideas file.
 *   7. Editing a translation clears the measures computed from the old text;
 *      removing one locks Step 3 again; translating it again unlocks it and the
 *      old "translate first" message goes away.
 *   8. A reload keeps the translations (no new request); importing the English
 *      download into an empty browser brings them back.
 *   9. No Claude key: Translate refuses with a clear message and sends nothing.
 *  9b. In a browser that knows no translation, a scored English file still works:
 *      the full-dataset top-up keeps the scores it fills, and a scores file with
 *      English titles matches the Chinese originals.
 *
 * Plus: no page error or console error, nothing leaves the machine except the
 * stubbed Anthropic call, Firebase only read, and at 1280px no sideways scroll
 * with every Save / Remove button reachable.
 */
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { buildHarness } from './translate-page/build.mjs'
import { TRANSLATOR_SYSTEM_PROMPT, TRANSLATIONS_SHEET } from '../src/utils/translation.js'

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

// ── Build + serve the harness ────────────────────────────────────────────────
const OUT = await buildHarness(join(process.env.TMPDIR || tmpdir(), 'isl-translate-page-harness'))
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

// ── The dataset ──────────────────────────────────────────────────────────────
const IDEAS = [
  { id: 'Kx7PqL2mZr9TbVw4NcYa', session: 'SGP1', cond: 'None', stage: 'individual', final: 'No', author: 'u1',
    title: 'Mood mug', desc: 'A mug sleeve that turns red when the drink is at body temperature so you know it is safe to sip.' },
  { id: 'Qm3RtY8uIo1PaSdF6gHj', session: 'SGP1', cond: 'Solo', stage: 'group', final: 'Yes', author: 'u2',
    title: 'Fever patch for kids', desc: 'A soft fabric patch for children that changes colour when they have a fever, helping parents check quickly at night.' },
  { id: 'Zc5VbN7mLk2JhG9fDsAq', session: 'SGP2', cond: 'Group', stage: 'group', final: 'Yes', author: 'u3', lang: 'Chinese',
    title: '变色运动衫', desc: '一种运动衫，当身体温度达到三十七度时颜色会改变，提醒运动员及时休息和补水。' },
  { id: 'Wp4OeI6uYt8RrQ1aSzXc', session: 'SGP2', cond: 'Both', stage: 'group', final: 'Yes', author: 'u4', lang: 'Chinese',
    title: '智能婴儿睡袋', desc: '婴儿睡袋在宝宝体温过高时会变色，让父母在夜里也能及时发现发烧。' },
  { id: 'Lb2VnM9cXz3KjH5gFdSa', session: 'ATHENS', cond: 'Group', stage: 'individual', final: 'Yes', author: 'u5', lang: 'French',
    title: 'Écharpe thermique', desc: 'Une écharpe qui change de couleur quand la température du corps est trop élevée, pour les personnes âgées et les enfants dans le froid.' },
  { id: 'Ty1UiO3pAs5DfG7hJkLz', session: 'ATHENS', cond: 'Both', stage: 'individual', final: 'No', author: 'u6',
    title: 'Yoga mat heat map', desc: 'A yoga mat that shows where your body presses hardest by changing colour with warmth, to improve posture.' },
]
const [, , ZH_A, ZH_B, FR] = IDEAS
const CHAT = '我觉得智能婴儿睡袋最好，父母会很喜欢'
const SENDER = '李华'
const HAND = 'Colour-changing sportswear'          // typed for ZH_A's title
// What the stubbed Fable answers, per original text.
const MODEL = {
  [ZH_A.desc]: ['Chinese', 'A sports top that changes colour when body temperature reaches 37 degrees, reminding athletes to rest and drink water in time.'],
  [ZH_B.title]: ['Chinese', 'Smart baby sleeping bag'],
  [ZH_B.desc]: ['Chinese', 'A baby sleeping bag that changes colour when the baby\'s temperature is too high, so parents can notice a fever in time even at night.'],
  [FR.title]: ['French', 'Thermal scarf'],
  [FR.desc]: ['French', 'A scarf that changes colour when body temperature is too high, for older people and children in the cold.'],
  [CHAT]: ['Chinese', 'I think the smart baby sleeping bag is best, parents will love it'],
}
const ORIGINALS = [ZH_A.title, ZH_A.desc, ZH_B.title, ZH_B.desc, FR.title, FR.desc, CHAT]

function ideasWorkbook() {
  const rows = IDEAS.map(i => ({
    'Idea ID': i.id, 'Session Code': i.session, 'Condition': i.cond, 'Stage': i.stage,
    'Author ID': i.author, 'Final Group Pick': i.final, 'Title': i.title, 'Description': i.desc,
  }))
  const chat = [
    { 'Session Code': 'SGP2', 'Sender Name': SENDER, Message: CHAT },
    { 'Session Code': 'SGP2', 'Sender Name': 'Ann', Message: 'Agreed, the sleeping bag is the one to pick' },
  ]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Ideas')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(chat), 'Group Chat')
  return Buffer.from(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }))
}
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const CJK = /[\p{Script=Han}]/u

// ── Browser ──────────────────────────────────────────────────────────────────
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' })
const pageErrors = [], consoleErrors = [], dialogs = [], offsite = [], apiCalls = []
const fsCalls = []

async function newContext() {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  await ctx.route('**/*', async route => {
    const req = route.request()
    const u = new URL(req.url())
    if (u.hostname === '127.0.0.1') return route.continue()
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (u.hostname === 'api.anthropic.com') {
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      let body = null
      try { body = JSON.parse(req.postData() || 'null') } catch { /* recorded as null */ }
      const user = String(body?.messages?.[0]?.content || '')
      const items = user.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l))
      apiCalls.push({ url: req.url(), body, texts: items.map(it => it.text) })
      const out = items.map(it => {
        const [lang, text] = MODEL[it.text] || ['Unknown', `English for ${it.i}`]
        return { i: it.i, lang, text }
      })
      return route.fulfill({
        status: 200, headers: { ...cors, 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'msg_stub', type: 'message', role: 'assistant', stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(out) }] }),
      })
    }
    offsite.push(req.url())
    return route.abort()
  })
  return ctx
}

let p = null
async function openPage(ctx, name, aiSettings) {
  p = await ctx.newPage()
  p.on('pageerror', e => pageErrors.push(`[${name}] ${e.message}`))
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${name}] ${m.text()}`) })
  p.on('dialog', d => { dialogs.push(`[${name}] ${d.type()}: ${d.message()}`); d.accept() })
  await p.addInitScript(s => { globalThis.__HARNESS_AI_SETTINGS = s }, aiSettings)
  await p.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p.getByRole('heading', { name: 'Data Analytics' }).waitFor({ timeout: 10000 })
  return p
}
async function closePage() {
  fsCalls.push(...await p.evaluate(() => (globalThis.__stubCalls || []).map(c => c.join(' '))))
  await p.close()
}
const WITH_KEY = { provider: 'claude', apiKeys: { claude: 'test-key-123456' } }
const NO_KEY = { provider: 'claude', apiKeys: {} }

// ── Page helpers ─────────────────────────────────────────────────────────────
const btn = name => p.getByRole('button', { name }).first()
const bodyText = () => p.locator('body').innerText()
const errorsShown = () => p.locator('p.error-msg').allInnerTexts()
const review = () => p.locator('details').filter({ has: p.locator('summary', { hasText: 'Review the translations' }) })
const exact = t => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
const reviewRow = text => review().locator('tbody tr').filter({ has: p.locator('div[class*="_trText_"]', { hasText: exact(text) }) })

async function importFile(buffer, name) {
  await p.locator('input[type=file]').first().setInputFiles({ name, mimeType: XLSX_MIME, buffer })
  await btn(/^Load 1 imported file$/).waitFor({ timeout: 5000 })
  await btn(/^Load 1 imported file$/).click()
  await p.getByText(/not in English yet, so Step 3 is locked|Every loaded idea can be measured in English/).first().waitFor({ timeout: 5000 })
}
async function scan() {
  await btn('Find text not in English').click()
  await p.getByText(/^Found \d+ texts? not in English|^Everything in the loaded data is in English/).waitFor({ timeout: 5000 })
}
// NoveltyScore of each idea in the Step-3 table, found by its Idea ID.
const noveltyScores = () => p.evaluate(ids => {
  const t = [...document.querySelectorAll('table')].find(x => [...x.querySelectorAll('thead th')].some(th => th.innerText.replace(/[▲▼]/g, '').trim() === 'NoveltyScore'))
  if (!t) return null
  const heads = [...t.querySelectorAll('thead th')].map(th => th.innerText.replace(/[▲▼]/g, '').trim())
  const col = heads.indexOf('NoveltyScore')
  const out = {}
  for (const tr of t.querySelectorAll('tbody tr')) {
    const id = ids.find(i => tr.innerText.includes(i))
    if (!id) continue
    const td = tr.children[col]
    out[id] = td ? (td.querySelector('input') ? td.querySelector('input').value : td.innerText.trim()) : null
  }
  return out
}, IDEAS.map(i => i.id))
const isNum = v => v != null && v !== '' && v !== '—' && Number.isFinite(Number(v))
async function captureDownload(trigger) {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), trigger()])
  const buffer = await readFile(await dl.path())
  return { name: dl.suggestedFilename(), wb: XLSX.read(buffer, { type: 'buffer' }), buffer }
}
// The review table at the current width: page scroll, and whether each action
// button takes a click after scrolling up or down to it (never sideways).
const layout = () => p.evaluate(async () => {
  const frame = () => new Promise(r => requestAnimationFrame(() => r()))
  const t = document.querySelector('table[class*="_trTable_"]')
  const wrap = t.parentElement
  const buttons = []
  for (const b of t.querySelectorAll('div[class*="_trActions_"] button')) {
    // Vertical only: the review box scrolls up and down (its header stays put),
    // and a button must never need the box scrolled SIDEWAYS to be reached.
    b.scrollIntoView({ block: 'center', inline: 'nearest' })
    await frame()
    const r = b.getBoundingClientRect(), w = wrap.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    buttons.push({ inside: r.left >= w.left - 1 && r.right <= w.right + 1 && wrap.scrollLeft === 0, hittable: !!hit && (hit === b || b.contains(hit)) })
  }
  const cellDisplays = [...t.querySelectorAll('tbody td')].map(td => getComputedStyle(td).display)
  return {
    pageScroll: document.documentElement.scrollWidth, viewport: window.innerWidth,
    wrapScroll: wrap.scrollWidth, wrapClient: wrap.clientWidth, buttons,
    allTableCells: cellDisplays.every(d => d === 'table-cell'),
  }
})

let english = null, ideasFile = null
try {
  const ctx = await newContext()
  await openPage(ctx, 'main', WITH_KEY)

  // ── 1–2. Import; the ideas not in English lock Step 3 ──────────────────────
  head('1-2. import, and Step 3 is locked')
  await importFile(ideasWorkbook(), 'ideas_zh_fr.xlsx')
  check('no import alert', dialogs.length === 0, dialogs.join(' | '))
  const t0 = await bodyText()
  check('Step 1b says "3 ideas (Chinese 2, French 1) are not in English yet, so Step 3 is locked"',
    /3 ideas \(Chinese 2, French 1\)\s*are not in English yet, so Step 3 is locked\./.test(t0),
    (t0.match(/[^\n]*not in English yet[^\n]*/) || ['(no such line)'])[0])
  const order = await p.evaluate(() => [...document.querySelectorAll('h2')].map(h => h.innerText.replace(/\s+/g, ' ').trim()))
  const i1b = order.findIndex(h => /Translate everything to English/.test(h))
  check('the Step 1b section sits between Step 1 and Step 2',
    i1b > 0 && /^1[^b]/.test(order[i1b - 1]) && /^2\D/.test(order[i1b + 1]), JSON.stringify(order.slice(0, 4)))
  await btn(/^Compute objective KPIs for 6 ideas$/).click()
  await p.waitForTimeout(300)
  const errs = await errorsShown()
  check('3.1 Compute refuses, pointing at Step 1b',
    errs.some(e => /^3 ideas \(Chinese 2, French 1\) are not in English yet\. Translate them in Step 1b first/.test(e)), errs.join(' | '))
  check('no NoveltyScore was computed', (await noveltyScores()) === null || Object.values(await noveltyScores()).every(v => !isNum(v)))
  check('nothing was sent to the AI provider', apiCalls.length === 0)

  // ── 3. Scan ────────────────────────────────────────────────────────────────
  head('3. "Find text not in English"')
  await scan()
  check('the scan reports 7 texts, 7 to translate', await p.getByText('Found 7 texts not in English; 7 still need a translation.').count() === 1,
    (await bodyText()).match(/Found[^\n]*/)?.[0])
  check('the review list is open', await review().evaluate(d => d.open))
  for (const t of ORIGINALS) check(`listed: ${JSON.stringify(t.slice(0, 24))}`, await reviewRow(t).count() === 1)
  check('the chat message is listed under Group Chat', (await reviewRow(CHAT).innerText()).includes('Group Chat'))
  check('the sender\'s name is not listed (a name is never translated)', !(await review().innerText()).includes(SENDER))
  check('no English text is listed', !(await review().innerText()).includes('Mood mug'))
  check('the button names the model and the count', await btn('Translate 7 texts with Claude Fable 5.1').count() === 1)
  check('a cost estimate is shown', /about \$\d+(\.\d\d)? at Fable 5\.1 prices \(an estimate\)/.test(await bodyText()))
  check('still nothing sent', apiCalls.length === 0)

  const lay = await layout()
  check('no horizontal page scroll at 1280px', lay.pageScroll <= lay.viewport, `${lay.pageScroll} > ${lay.viewport}`)
  check('every Save / It is English button takes a click without scrolling the table sideways',
    lay.buttons.length === 14 && lay.buttons.every(b => b.inside && b.hittable), JSON.stringify(lay.buttons.filter(b => !b.inside || !b.hittable)))
  check('every cell of the table is a real table cell (no display:flex on a td)', lay.allTableCells)

  // ── 4. One by hand, the rest with Fable ────────────────────────────────────
  head('4. one typed by hand, six translated by Claude Fable 5.1')
  const rowA = reviewRow(ZH_A.title)
  await rowA.locator('textarea').fill(HAND)
  await rowA.getByRole('button', { name: 'Save' }).click()
  check('the typed one is recorded "by hand"', (await reviewRow(ZH_A.title).innerText()).includes('by hand'))
  await btn('Translate 6 texts with Claude Fable 5.1').click()
  await p.getByText(/^Translated \d+ of \d+ texts? with Claude Fable 5\.1/).waitFor({ timeout: 10000 })
  check('the run reports "Translated 6 of 6 texts with Claude Fable 5.1"', await p.getByText(/^Translated 6 of 6 texts with Claude Fable 5\.1\./).count() === 1)
  check('exactly one request', apiCalls.length === 1, `${apiCalls.length}`)
  const c0 = apiCalls[0]
  check('…to Anthropic\'s Messages API', c0?.url === 'https://api.anthropic.com/v1/messages', c0?.url)
  check('…with model claude-fable-5-1 and the 16000-token ceiling', c0?.body?.model === 'claude-fable-5-1' && c0?.body?.max_tokens === 16000, `${c0?.body?.model} ${c0?.body?.max_tokens}`)
  check('…and the translator\'s system prompt', JSON.stringify(c0?.body?.system).includes(TRANSLATOR_SYSTEM_PROMPT.slice(0, 60)))
  check('…carrying exactly the six texts still untranslated (not the typed one)',
    c0 && c0.texts.length === 6 && !c0.texts.includes(ZH_A.title) && ORIGINALS.filter(t => t !== ZH_A.title).every(t => c0.texts.includes(t)),
    JSON.stringify(c0?.texts))
  check('each English version is shown in its box', await reviewRow(ZH_B.title).locator('textarea').inputValue() === MODEL[ZH_B.title][1])
  check('…with the language the model reported', (await reviewRow(FR.desc).innerText()).includes('French'))
  { const sm = (await review().locator('summary').textContent()).trim(); check('the review list reads 7 of 7 done', sm === 'Review the translations (7 of 7 done)', JSON.stringify(sm)) }

  // ── 5. Step 3 unlocks ──────────────────────────────────────────────────────
  head('5. Step 3 measures the English')
  check('Step 1b says every idea can be measured in English (7 translations on record)',
    /✓ Every loaded idea can be measured in English \(7 translations on record\)\./.test(await bodyText()))
  check('the 3.1 lock message is gone', !(await errorsShown()).some(e => e.includes('Step 1b')))
  await btn(/^Compute objective KPIs for 6 ideas$/).click()
  await p.waitForFunction(() => [...document.querySelectorAll('thead th')].some(th => th.innerText.includes('NoveltyScore')), null, { timeout: 10000 })
  await p.waitForTimeout(200)
  const s1 = await noveltyScores()
  check('all six ideas get a NoveltyScore, the Chinese and French ones included', s1 && IDEAS.every(i => isNum(s1[i.id])), JSON.stringify(s1))

  // ── 6. Download all data in English ────────────────────────────────────────
  head('6. "Download all data in English (Excel)"')
  english = await captureDownload(() => btn('Download all data in English (Excel)').click())
  check('the file is named idea_analytics_aggregate_english.xlsx', english.name === 'idea_analytics_aggregate_english.xlsx', english.name)
  const sheetRows = n => XLSX.utils.sheet_to_json(english.wb.Sheets[n] || {}, { defval: '' })
  check('it carries a Translations sheet', english.wb.SheetNames.includes(TRANSLATIONS_SHEET), english.wb.SheetNames.join(','))
  const leftovers = []
  for (const sn of english.wb.SheetNames.filter(n => n !== TRANSLATIONS_SHEET)) {
    for (const [ri, r] of sheetRows(sn).entries()) {
      for (const [col, v] of Object.entries(r)) {
        if (typeof v === 'string' && CJK.test(v) && !/name/i.test(col)) leftovers.push(`${sn}!${col}${ri + 2}: ${v.slice(0, 20)}`)
      }
    }
  }
  check('no Chinese text is left in any sheet (outside name columns)', leftovers.length === 0, leftovers.slice(0, 5).join(' | '))
  const allCells = english.wb.SheetNames.filter(n => n !== TRANSLATIONS_SHEET).flatMap(n => sheetRows(n).flatMap(r => Object.values(r)))
  check('no French idea text is left either', !allCells.some(v => typeof v === 'string' && v.includes(FR.desc)))
  check('the English is there: the hand-typed title and the chat message',
    allCells.includes(HAND) && allCells.includes(MODEL[CHAT][1]))
  const chatSheet = english.wb.SheetNames.find(n => /chat/i.test(n))
  check('the sender\'s name is kept as written', chatSheet && sheetRows(chatSheet).some(r => Object.values(r).includes(SENDER)), chatSheet)
  const log = sheetRows(TRANSLATIONS_SHEET)
  check('the Translations sheet keeps every original beside its English',
    ORIGINALS.every(t => log.some(l => l.Original === t && l.English)), `${log.length} rows`)
  check('…naming the sheet, the language and who translated it',
    log.some(l => l.Original === CHAT && /chat/i.test(l.Sheet) && l['Translated from'] === 'Chinese' && l['Translated by'] === 'Claude Fable 5.1')
    && log.some(l => l.Original === ZH_A.title && l['Translated by'] === 'by hand'))

  ideasFile = await captureDownload(() => btn('Download ideas + KPIs (Excel)').click())
  const ideasSheet = XLSX.utils.sheet_to_json(ideasFile.wb.Sheets.ideas || {}, { defval: '' })
  const zb = ideasSheet.find(r => r['Idea ID'] === ZH_B.id)
  check('"Download ideas + KPIs" carries the ideas in English with their NoveltyScore',
    zb && zb.Title === MODEL[ZH_B.title][1] && zb.Description === MODEL[ZH_B.desc][1] && Number.isFinite(Number(zb.NoveltyScore)),
    JSON.stringify(zb))
  const ideasLog = XLSX.utils.sheet_to_json(ideasFile.wb.Sheets[TRANSLATIONS_SHEET] || {}, { defval: '' })
  check('…and its originals on a Translations sheet (ideas only, no chat)',
    [ZH_A.title, ZH_B.desc, FR.title].every(t => ideasLog.some(l => l.Original === t)) && !ideasLog.some(l => l.Original === CHAT))

  // ── 7. Corrections ─────────────────────────────────────────────────────────
  head('7. edit, remove, translate again')
  await reviewRow(ZH_A.title).locator('textarea').fill('Colour-changing sports top')
  await reviewRow(ZH_A.title).getByRole('button', { name: 'Save edit' }).click()
  await p.getByText(/^An English version changed, so the measures computed from the old text were cleared/).waitFor({ timeout: 5000 })
  const s2 = await noveltyScores()
  check('editing a translation clears the objective KPIs (press Compute again)', !s2 || IDEAS.every(i => !isNum(s2[i.id])), JSON.stringify(s2))
  await reviewRow(FR.desc).getByRole('button', { name: 'Remove' }).click()
  check('removing one locks Step 3 again: "1 idea (French 1) is not in English yet"',
    /1 idea \(French 1\)\s*is not in English yet, so Step 3 is locked\./.test(await bodyText()))
  check('the removed text is back to be translated', await btn('Translate 1 text with Claude Fable 5.1').count() === 1)
  await btn(/^Compute objective KPIs for 6 ideas$/).click()
  await p.waitForTimeout(300)
  check('3.1 refuses again', (await errorsShown()).some(e => /^1 idea \(French 1\) is not in English yet\. Translate it in Step 1b first/.test(e)))
  await btn('Translate 1 text with Claude Fable 5.1').click()
  await p.getByText(/^Translated 1 of 1 text with Claude Fable 5\.1/).waitFor({ timeout: 10000 })
  check('the second request carries only that text', apiCalls.length === 2 && JSON.stringify(apiCalls[1].texts) === JSON.stringify([FR.desc]),
    JSON.stringify(apiCalls[1]?.texts))
  check('Step 3 unlocks and the old "translate first" message is gone',
    /✓ Every loaded idea can be measured in English/.test(await bodyText()) && !(await errorsShown()).some(e => e.includes('Step 1b')))
  await closePage()

  // ── 8a. A reload keeps the translations ────────────────────────────────────
  head('8. the translations are kept')
  await openPage(ctx, 'reload', WITH_KEY)
  await importFile(ideasWorkbook(), 'ideas_zh_fr.xlsx')
  check('after a reload the same import needs no translation (7 on record, no new request)',
    /✓ Every loaded idea can be measured in English \(7 translations on record\)\./.test(await bodyText()) && apiCalls.length === 2)
  await closePage()
  await ctx.close()
} catch (e) {
  check('sections 1-8a ran to the end', false, e.stack || e.message)
}

// ── 8b. Importing the English file into an empty browser ──────────────────────
try {
  head('8b. importing the English download into an empty browser')
  if (!english) throw new Error('no English workbook from section 6')
  const ctx = await newContext()
  await openPage(ctx, 'round-trip', WITH_KEY)
  await importFile(english.buffer, english.name)
  check('the import brings the translations back from its Translations sheet',
    /✓ Every loaded idea can be measured in English \(\d+ translations? on record\)\./.test(await bodyText()),
    (await bodyText()).match(/[^\n]*measured in English[^\n]*|[^\n]*not in English yet[^\n]*/)?.[0])
  await scan()
  check('nothing is left to translate', !(await btn(/^Translate \d+ texts? with Claude Fable 5\.1$/).count()))
  const again = await captureDownload(() => btn('Download all data in English (Excel)').click())
  check('downloading again keeps the originals (the Translations sheet is carried forward)',
    again.wb.SheetNames.includes(TRANSLATIONS_SHEET)
    && ORIGINALS.every(t => XLSX.utils.sheet_to_json(again.wb.Sheets[TRANSLATIONS_SHEET], { defval: '' }).some(l => l.Original === t)),
    again.wb.SheetNames.join(','))
  check('…and never a second Translations sheet', again.wb.SheetNames.filter(n => n === TRANSLATIONS_SHEET).length === 1)
  await btn(/^Compute objective KPIs for \d+ ideas$/).click()
  await p.waitForFunction(() => [...document.querySelectorAll('thead th')].some(th => th.innerText.includes('NoveltyScore')), null, { timeout: 10000 })
  const ideasAgain = await captureDownload(() => btn('Download ideas + KPIs (Excel)').click())
  const carried = XLSX.utils.sheet_to_json(ideasAgain.wb.Sheets[TRANSLATIONS_SHEET] || {}, { defval: '' })
  check('the ideas + KPIs file from the re-imported English data still keeps the ideas\' originals',
    [ZH_A.title, ZH_B.desc, FR.desc].every(t => carried.some(l => l.Original === t)) && !carried.some(l => l.Original === CHAT),
    `${carried.length} rows`)
  await closePage()
  await ctx.close()
} catch (e) {
  check('section 8b ran to the end', false, e.stack || e.message)
}

// ── 9b. A scored file into a browser with no translations (review of 2026-09-24) ──
// Both uploads carry the ENGLISH titles and a Translations sheet; the loaded ideas
// are the Chinese originals and this browser has never seen a translation.
function withSheets(sheets) {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name)
  return Buffer.from(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }))
}
try {
  head('9b. uploading a scored English file where no translation is known yet')
  if (!ideasFile || !english) throw new Error('no downloads from section 6')
  const log = XLSX.utils.sheet_to_json(ideasFile.wb.Sheets[TRANSLATIONS_SHEET], { defval: '' })
  const ideasRows = XLSX.utils.sheet_to_json(ideasFile.wb.Sheets.ideas, { defval: '' })

  // (1) "Upload full dataset (top up AI scores)": its scores and its translations
  // arrive in the same render, and the scores must survive it.
  let ctx = await newContext()
  await openPage(ctx, 'top-up', WITH_KEY)
  await importFile(ideasWorkbook(), 'ideas_zh_fr.xlsx')
  const topUp = withSheets([['ideas', ideasRows.map(r => ({ ...r, 'AI Novelty': 4, 'AI Usefulness': 3 }))], [TRANSLATIONS_SHEET, log]])
  await p.locator('button:has-text("Upload full dataset") + input[type=file]').setInputFiles({ name: 'scored.xlsx', mimeType: XLSX_MIME, buffer: topUp })
  await p.getByText(/^Merged “scored\.xlsx”/).waitFor({ timeout: 5000 })
  await p.waitForTimeout(500)
  const merged = await p.getByText(/^Merged “scored\.xlsx”/).innerText()
  check('the top-up fills all six ideas', /filled 6 that had no AI score yet/.test(merged), merged.slice(0, 160))
  check('the file\'s translations come back, so Step 3 unlocks', /✓ Every loaded idea can be measured in English/.test(await bodyText()))
  check('…and the scores it filled are still there (not cleared as "changed text")',
    await btn(/^All (final )?ideas have AI scores$/).count() === 1,
    await p.locator('button', { hasText: /AI scores?/ }).first().innerText())
  await closePage()
  await ctx.close()

  // (2) "Load AI scores file" with raters' Rankings carrying the English titles.
  ctx = await newContext()
  await openPage(ctx, 'scores-file', WITH_KEY)
  await importFile(ideasWorkbook(), 'ideas_zh_fr.xlsx')
  const english6 = {
    [ZH_A.id]: HAND, [ZH_B.id]: MODEL[ZH_B.title][1], [FR.id]: MODEL[FR.title][1],
  }
  const ranking = IDEAS.map(i => ({ 'Idea ID': i.id, Title: english6[i.id] || i.title, Novelty: 5, Usefulness: 4 }))
  const aggLog = XLSX.utils.sheet_to_json(english.wb.Sheets[TRANSLATIONS_SHEET], { defval: '' })
  const scores = withSheets([['Rankings', ranking], [TRANSLATIONS_SHEET, aggLog]])
  await p.locator('button:has-text("Load AI scores file") + input[type=file]').setInputFiles({ name: 'rankings.xlsx', mimeType: XLSX_MIME, buffer: scores })
  await p.getByText(/^Loaded scores from/).waitFor({ timeout: 5000 })
  const loaded = await p.getByText(/^Loaded scores from/).innerText()
  check('every English title in the file finds its idea (6 scored, 0 unmatched)',
    /scored 6 ideas that had no score yet/.test(loaded) && /; 0 file rows had no match/.test(loaded), loaded)
  await closePage()
  await ctx.close()
} catch (e) {
  check('section 9b ran to the end', false, e.stack || e.message)
}

// ── 9. No Claude key ─────────────────────────────────────────────────────────
try {
  head('9. no Claude key saved')
  const ctx = await newContext()
  await openPage(ctx, 'no-key', NO_KEY)
  await importFile(ideasWorkbook(), 'ideas_zh_fr.xlsx')
  await scan()
  check('the panel says no Claude key is saved', /no Claude key saved: add one in AI Settings, or type the English below/.test(await bodyText()))
  const before = apiCalls.length
  await btn('Translate 7 texts with Claude Fable 5.1').click()
  await p.waitForTimeout(400)
  check('Translate refuses with a clear message', (await errorsShown()).some(e => e.startsWith('No Anthropic (Claude) API key is saved.')), (await errorsShown()).join(' | '))
  check('and sends nothing', apiCalls.length === before)
  check('Step 3 stays locked', /3 ideas \(Chinese 2, French 1\)\s*are not in English yet/.test(await bodyText()))
  await closePage()
  await ctx.close()
} catch (e) {
  check('section 9 ran to the end', false, e.stack || e.message)
}

// ── Page health ──────────────────────────────────────────────────────────────
head('page health')
check('no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '))
check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '))
check('no request left the machine except the stubbed Anthropic API', offsite.length === 0, offsite.join(', '))
check('no alert()/confirm()', dialogs.length === 0, dialogs.join(' | '))
check('Firebase: only reads of settings/ai (+ the session list), nothing written',
  fsCalls.every(c => /^(doc settings\/ai|getDoc settings\/ai|collection sessions|getDocs sessions)$/.test(c)), fsCalls.join(', '))

await br.close()
srv.close()
console.log(`\n${fails ? `FAILED — ${fails} check(s):\n  ` + failed.join('\n  ') : 'All checks passed.'}`)
process.exit(fails ? 1 : 0)
