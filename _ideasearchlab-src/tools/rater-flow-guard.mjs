/**
 * rater-flow-guard.mjs — the whole AI-rating flow, driven in a real browser.
 *
 * Owner, 2026-09-24: "check that adding API keys of different providers and
 * then calculating novelty and usefulness AI-based KPIs works correctly … upload
 * them again from the top, then calculate the empirical measures, then add all
 * the AI-based measures (make sure the API is called at the right pace so that
 * it's not blocked and its output works correctly), then be able to download a
 * file with all the final data."
 *
 * So, on the Data Analytics page (Firebase stubbed, every provider's API
 * intercepted — no live key, no network):
 *   1. a fresh upload of the owner's 741 ideas with NO KPI column at all;
 *   2. "Compute empirical KPIs" over them;
 *   3. one API key per provider saved in AI Settings, and every provider in turn
 *      asked to fill its own columns for the 186 final ideas — each call must
 *      carry THAT provider's key in the right header and name the model chosen;
 *      the stubs answer in each provider's own reply shape, one of them once with
 *      a fractional rating (asked again), and three refuse a call with a 429
 *      (one naming Retry-After) or a 500 — the run must wait, retry and finish;
 *   4. the calls are paced: one at a time, never closer than the provider's pace,
 *      and after a 429 no sooner than the wait the provider asked for;
 *   5. "Download all idea data" (Excel + CSV) carries every empirical column and
 *      every provider's pair, whole numbers from 1 to 5, the means exact;
 *   6. a provider with no saved key is refused at once, with no call made.
 * Steps 4 and 5 of the page (the Python / R analysis) are out of scope here.
 *
 *   node _ideasearchlab-src/tools/rater-flow-guard.mjs
 *
 * Needs the 741-idea file: RATER_FLOW_IDEAS=<path to an Ideas workbook> (the
 * owner's export), else a built-in 320-idea set (80 final) of the same shape is used.
 */
const PW = process.env.PW || '/opt/node22/lib/node_modules/playwright/index.mjs'
const { chromium } = await import(PW)
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { buildHarness } from './translate-page/build.mjs'
import { PROVIDERS, SCORING_DEFAULT_MODEL } from '../src/data/aiModels.js'
import { aiModelName, modelSlug, aiColumnLabel } from '../src/utils/aiScoreColumns.js'
import { PROVIDER_PACE_MS } from '../src/utils/scoreBatch.js'

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

// ── The ideas: the owner's 741, KPI columns stripped, else a small stand-in ────
const KEEP = ['Idea ID', 'Session Code', 'Condition', 'Stage', 'Group UID', 'Author ID', 'Author Name', 'Author Email', 'Final Group Pick', 'Carried to group', 'Title', 'Description', 'Full Text']
function loadIdeas() {
  const src = process.env.RATER_FLOW_IDEAS
  if (src && existsSync(src)) {
    const wb = XLSX.read(readFileSync(src))
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames.find(n => /ideas/i.test(n)) || wb.SheetNames[0]], { defval: '' })
    return rows.map(r => Object.fromEntries(KEEP.map(k => [k, r[k] ?? ''])))
  }
  const words = ['sock', 'scarf', 'headband', 'bib', 'cup', 'bag', 'glove', 'hat', 'patch', 'sleeve', 'collar', 'blanket']
  const conds = ['None', 'Solo', 'Group', 'Both']
  return Array.from({ length: 320 }, (_, i) => {
    const w = words[i % words.length], c = conds[i % 4], s = `S${1 + (i % 3)}`
    return {
      'Idea ID': String(1 + i), 'Session Code': s, Condition: c, Stage: 'group', 'Group UID': `g${i % 5}`, 'Author ID': `a${i}`,
      'Author Name': `Author ${i}`, 'Author Email': `a${i}@example.org`, 'Final Group Pick': i % 4 === 0 ? 'Yes' : 'No', 'Carried to group': 'Yes',
      Title: `Fever ${w} ${i}`, Description: `A ${w} that changes colour at 37°C so a parent notices a fever early, without a battery or an app; a sensor thread in the ${w} shows red.`,
      'Full Text': `Fever ${w} ${i}: A ${w} that changes colour at 37°C so a parent notices a fever early, without a battery or an app; a sensor thread in the ${w} shows red.`,
    }
  })
}
const IDEAS = loadIdeas()
const FINALS = IDEAS.filter(r => String(r['Final Group Pick']).trim().toLowerCase() === 'yes').length
console.log(`ideas: ${IDEAS.length} (${FINALS} final)${process.env.RATER_FLOW_IDEAS ? ' from ' + process.env.RATER_FLOW_IDEAS : ' (built-in set)'}`)
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const rawBook = () => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(IDEAS), 'Ideas')
  return Buffer.from(XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }))
}

// ── Build + serve the harness ────────────────────────────────────────────────
const OUT = await buildHarness(join(process.env.TMPDIR || tmpdir(), 'isl-rater-flow-harness'))
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

// ── The seven providers, stubbed ─────────────────────────────────────────────
const KEYS = { claude: 'k-claude-111111', openai: 'k-openai-222222', gemini: 'k-gemini-333333', mistral: 'k-mistral-444444', openrouter: 'k-or-555555', deepseek: 'k-ds-666666', qwen: 'k-qwen-777777' }
const HOSTS = {
  'api.anthropic.com': 'claude', 'api.openai.com': 'openai', 'generativelanguage.googleapis.com': 'gemini',
  'api.mistral.ai': 'mistral', 'openrouter.ai': 'openrouter', 'api.deepseek.com': 'deepseek', 'dashscope-intl.aliyuncs.com': 'qwen',
}
const ORDER = ['claude', 'openai', 'gemini', 'mistral', 'openrouter', 'deepseek', 'qwen']
const calls = []            // { provider, n, i, t0, t1, status, headers, model, url }
const perProvider = pid => calls.filter(c => c.provider === pid)
// Every string in the body, deepest first, so the prompt with the numbered ideas is found whatever the shape.
const strings = v => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [])
const ideaLines = body => {
  const prompt = strings(body).find(s => /Rate the following/.test(s)) || ''
  return (prompt.match(/^\d+\. /gm) || []).length
}
const ratings = n => Array.from({ length: n }, (_, i) => ({ i, novelty: 1 + ((i * 7) % 5), usefulness: 5 - ((i * 3) % 5) }))
const replyFor = (pid, text) => {
  if (pid === 'claude') return { id: 'msg', type: 'message', role: 'assistant', content: [{ type: 'text', text }], stop_reason: 'end_turn' }
  if (pid === 'gemini') return { candidates: [{ content: { parts: [{ text }], role: 'model' }, finishReason: 'STOP' }] }
  return { id: 'c', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }
}
// What each provider's stub does on its k-th call (1-based): a refusal, or a doctored rating.
const SCRIPT = {
  claude: { 2: { status: 429, retryAfter: '1' }, 5: { status: 429 }, 8: { status: 500 } },
  gemini: { 2: { status: 429, retryAfter: '1', google: true } },
  mistral: { 2: { fraction: true } },
  openai: { 3: { status: 503, retryAfter: 'Thu, 01 Jan 2000 00:00:00 GMT' } },   // a date in the past: wait 0, plain backoff
}
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-expose-headers': 'retry-after' }
const offsite = [], pageErrors = [], consoleErrors = []
let dialogs = []
async function newContext() {
  const ctx = await br.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  await ctx.route('**/*', async route => {
    const req = route.request()
    const u = new URL(req.url())
    if (u.hostname === '127.0.0.1') return route.continue()
    const pid = HOSTS[u.hostname]
    if (!pid) { offsite.push(req.url()); return route.abort() }
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    const t0 = Date.now()
    let body = {}
    try { body = JSON.parse(req.postData() || '{}') } catch { /* not JSON */ }
    const n = ideaLines(body)
    const i = perProvider(pid).length + 1
    const schema = body.output_config?.format?.schema || body.response_format?.json_schema?.schema || body.generationConfig?.responseSchema || null
    const rec = { provider: pid, n, i, t0, t1: 0, status: 200, headers: req.headers(), model: body.model || '', url: req.url(), schema, tools: 'tools' in body || 'tool_choice' in body }
    calls.push(rec)
    await new Promise(r => setTimeout(r, 25))             // a call takes a moment
    const act = SCRIPT[pid]?.[i]
    rec.t1 = Date.now()
    if (act?.status) {
      rec.status = act.status
      const headers = { ...cors, 'content-type': 'application/json' }
      if (act.retryAfter) headers['retry-after'] = act.retryAfter
      const errBody = act.google
        ? { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED' } }
        : { error: { type: 'rate_limit_error', message: act.status === 429 ? 'rate limited' : 'try again' } }
      return route.fulfill({ status: act.status, headers, body: JSON.stringify(errBody) })
    }
    const arr = ratings(n)
    if (act?.fraction && arr.length > 2) arr[2].novelty = 3.5     // not a rating: the page must ask again
    // The shape the schema-bound providers really return: {"ratings": [...]}.
    return route.fulfill({ status: 200, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(replyFor(pid, JSON.stringify({ ratings: arr }))) })
  })
  return ctx
}
const br = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' })
let p = null
async function openPage(ctx, name, settings) {
  p = await ctx.newPage()
  p.on('pageerror', e => pageErrors.push(`[${name}] ${e.message}`))
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push(`[${name}] ${m.text()}`) })
  p.on('dialog', d => { dialogs.push(`[${name}] ${d.type()}: ${d.message()}`); d.accept() })
  await p.addInitScript(s => { globalThis.__HARNESS_AI_SETTINGS = s }, settings)
  await p.goto(BASE, { waitUntil: 'domcontentloaded' })
  await p.getByRole('heading', { name: 'Data Analytics' }).waitFor({ timeout: 10000 })
}
const btn = name => p.getByRole('button', { name }).first()
async function importFile(buffer, name) {
  await p.locator('input[type=file]').first().setInputFiles({ name, mimeType: XLSX_MIME, buffer })
  await btn(/^Load 1 imported file$/).waitFor({ timeout: 5000 })
  await btn(/^Load 1 imported file$/).click()
  await p.getByText(/Every loaded idea can be measured in English/).first().waitFor({ timeout: 20000 })
}
async function captureDownload(trigger) {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), trigger()])
  const path = await dl.path()
  return { path, buf: await readFile(path) }
}
const tableHeaders = async () => (await p.$$eval('table', ts => ts.map(t => [...t.querySelectorAll('thead th')].map(th => th.textContent.replace(/[▲▼]/g, '').trim()))))
  .find(h => h.includes('Idea ID') && h.includes('Idea')) || []
const modelName = pid => aiModelName(modelSlug(SCORING_DEFAULT_MODEL[pid]))
const KEY_HEADER = { claude: ['x-api-key', k => k], gemini: ['x-goog-api-key', k => k] }
const keyHeaderOf = (pid, headers) => (KEY_HEADER[pid] ? headers[KEY_HEADER[pid][0]] : (headers.authorization || '').replace(/^Bearer /, ''))

// ── 1. A fresh upload, then the empirical measures ───────────────────────────
head('1. a fresh upload from the top, then the empirical KPIs')
const ctx = await newContext()
await openPage(ctx, 'flow', { provider: 'claude', apiKeys: { ...KEYS } })
await importFile(rawBook(), 'ideas-raw.xlsx')
let heads = await tableHeaders()
check(`${IDEAS.length} ideas loaded (the compute button counts them)`, (await btn(new RegExp(`^Compute empirical KPIs for ${IDEAS.length} ideas$`)).count()) === 1)
const EMP = ['Novelty (empirical)', 'Pool distinctiveness', 'NoveltyScore', 'Need fit (empirical)', 'Specificity (empirical)', 'Workability (empirical)', 'Usefulness score (empirical)']
// The table always shows the chosen model's (empty) pair; nothing else came in with the file.
check('no empirical column yet, and no AI column but the chosen model\'s empty pair', !heads.some(h => /\(empirical\)|NoveltyScore/.test(h)) && heads.filter(h => /^AI /.test(h)).length === 2, heads.join(' | '))
await btn(new RegExp(`^Compute empirical KPIs for ${IDEAS.length} ideas$`)).click()
await p.waitForFunction(() => [...document.querySelectorAll('table thead th')].some(th => /Usefulness score \(empirical\)/.test(th.textContent)), null, { timeout: 180000 })
await p.waitForFunction(() => !/computing TF-IDF/.test(document.body.innerText), null, { timeout: 180000 })
heads = await tableHeaders()
check('the seven empirical columns are in the table', EMP.every(c => heads.includes(c)), heads.join(' | '))

// ── 2. Every provider fills its own columns ──────────────────────────────────
head('2. each provider, with its own key, fills its own columns for the final ideas')
const providerSel = p.locator('select[title="Which provider\'s API key to use"]')
const modelSel = p.locator('select[title="Which of that provider\'s models rates the ideas"]')
for (const pid of ORDER) {
  const name = modelName(pid)
  await providerSel.selectOption(pid)
  check(`${pid}: the model pre-selected is ${SCORING_DEFAULT_MODEL[pid]}`, (await modelSel.inputValue()) === SCORING_DEFAULT_MODEL[pid], await modelSel.inputValue())
  check(`${pid}: no "no key saved" warning (the key is in AI Settings)`, (await p.locator('span', { hasText: /^no .* key saved — add it under AI Settings$/ }).count()) === 0)
  const fill = btn(new RegExp(`^Fill the ${FINALS} missing ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} scores?$`))
  check(`${pid}: the button offers the ${FINALS} final ideas ${name} has not rated`, (await fill.count()) === 1, (await p.getByRole('button', { name: /^Fill the|has rated all/ }).first().textContent().catch(() => '?')))
  const before = calls.length
  const t0 = Date.now()
  await fill.click()
  await p.getByText(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} scored ${FINALS} of the ${FINALS} ideas`)).first().waitFor({ timeout: 240000 })
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  const mine = calls.slice(before)
  check(`${pid}: every one of the ${mine.length} calls went to ${pid} (${secs} s)`, mine.length > 0 && mine.every(c => c.provider === pid), JSON.stringify(mine.map(c => c.provider)))
  check(`${pid}: every call carried THIS provider's key in its header`, mine.every(c => keyHeaderOf(pid, c.headers) === KEYS[pid]), JSON.stringify(mine[0] && Object.keys(mine[0].headers)))
  check(`${pid}: every call named the chosen model`, mine.every(c => (pid === 'gemini' ? decodeURIComponent(c.url).includes(SCORING_DEFAULT_MODEL[pid]) : c.model === SCORING_DEFAULT_MODEL[pid])), mine[0] && (mine[0].model || mine[0].url))
  if (['claude', 'openai', 'gemini', 'mistral'].includes(pid)) {
    const r = s => s?.properties?.ratings?.items?.properties || {}
    check(`${pid}: every call carried the 1..5 answer schema`, mine.every(c => c.schema && (pid === 'gemini'
      ? r(c.schema).novelty?.minimum === 1 && r(c.schema).novelty?.maximum === 5 && r(c.schema).usefulness?.maximum === 5
      : JSON.stringify(r(c.schema).novelty?.enum) === '[1,2,3,4,5]' && JSON.stringify(r(c.schema).usefulness?.enum) === '[1,2,3,4,5]')) && !mine.some(c => c.tools),
      JSON.stringify(mine[0]?.schema))
  } else check(`${pid}: no schema mode to rely on, so none is sent`, mine.every(c => !c.schema))
  check(`${pid}: batches of at most 8 ideas, ${FINALS} ideas sent in the first pass`, mine.every(c => c.n >= 1 && c.n <= 8) && mine.filter(c => c.n > 1 && c.status === 200).reduce((s, c) => s + c.n, 0) >= FINALS, JSON.stringify(mine.map(c => c.n)))
  check(`${pid}: no error shown after the run`, (await p.locator('p.error-msg').count()) === 0, await p.locator('p.error-msg').first().textContent().catch(() => ''))
  // Pace: one call at a time, never closer than the provider's pace. Measured at the
  // stub, so the first gap is shorter by the CORS preflight the first call pays
  // (~100 ms) and timers add a little: a 150 ms allowance, against a pace of 300+.
  const pace = PROVIDER_PACE_MS[pid]
  const overlaps = mine.filter((c, k) => k > 0 && c.t0 < mine[k - 1].t1)
  const tooClose = mine.filter((c, k) => k > 0 && c.t0 - mine[k - 1].t0 < pace - 150)
  check(`${pid}: calls never overlap, and start at least ${pace} ms apart`, !overlaps.length && !tooClose.length,
    JSON.stringify({ overlaps: overlaps.length, tooClose: tooClose.map((c, k) => c.t0 - mine[mine.indexOf(c) - 1].t0).slice(0, 3) }))
  // The scripted refusals: the run waited and went on.
  for (const [k, act] of Object.entries(SCRIPT[pid] || {})) {
    const c = mine[Number(k) - 1], next = mine[Number(k)]
    if (!act.status) continue
    check(`${pid}: call ${k} was refused with ${act.status} and the run went on`, c && c.status === act.status && next, c && c.status)
    if (act.retryAfter && /^\d/.test(act.retryAfter)) {
      const gap = next ? next.t0 - c.t1 : 0
      check(`${pid}: after the 429 with Retry-After ${act.retryAfter} s the next call waited at least that long (${gap} ms)`, gap >= Number(act.retryAfter) * 1000 - 30)
    } else if (act.status === 429) {
      const gap = next ? next.t0 - c.t1 : 0
      check(`${pid}: after a bare 429 the next call waited the 2 s backoff (${gap} ms)`, gap >= 2000 - 30)
    }
  }
  if (SCRIPT[pid]?.[2]?.fraction) {
    const single = mine.filter(c => c.n === 1)
    check(`${pid}: the idea answered 3.5 was asked again on its own (${single.length} single call)`, single.length === 1)
  }
}
heads = await tableHeaders()
const pairs = ORDER.map(pid => [aiColumnLabel('novelty', modelSlug(SCORING_DEFAULT_MODEL[pid])), aiColumnLabel('usefulness', modelSlug(SCORING_DEFAULT_MODEL[pid]))])
check('the table carries every provider\'s pair, then the means and AI Quality',
  pairs.every(([n, u]) => heads.indexOf(u) === heads.indexOf(n) + 1 && heads.indexOf(n) > 0) && heads.includes('AI Novelty (mean across models)') && heads.includes('AI Quality (mean across models)'), heads.join(' | '))
const other = await p.getByText(/Other models in the data/).first().textContent().catch(() => '')
check('the coverage panel lists the six other models', ORDER.slice(0, 6).every(pid => other.includes(modelName(pid))), other.slice(0, 200))

// ── 3. The final download ────────────────────────────────────────────────────
head('3. download all idea data: every column, whole numbers, exact means')
const { buf } = await captureDownload(() => btn('Download all idea data (Excel)').click())
const wb = XLSX.read(buf, { type: 'buffer' })
check('sheets: ideas, the Usefulness score check, the summaries', ['ideas', 'Usefulness score check', 'Summary by condition', 'Summary by session'].every(n => wb.SheetNames.includes(n)), wb.SheetNames.join(' | '))
const ideas = XLSX.utils.sheet_to_json(wb.Sheets.ideas, { defval: '' })
const cols = Object.keys(ideas[0] || {})
check(`${IDEAS.length} ideas in the file`, ideas.length === IDEAS.length, String(ideas.length))
const pos = n => cols.indexOf(n)
check('identity, then the empirical columns, then AI by model, then the means',
  pos('Full Text') >= 0 && pos('Full Text') < pos('Novelty (empirical)') && pos('Usefulness score (empirical)') < pos(pairs[0][0])
  && pairs.every(([n, u]) => pos(u) === pos(n) + 1) && pairs.every(([n], k) => k === 0 || pos(n) === pos(pairs[k - 1][1]) + 1)
  && pos('AI Novelty (mean across models)') > pos(pairs[6][1]) && pos('AI Quality (mean across models)') > pos('AI Usefulness (mean across models)'), cols.join(' | '))
const isFinal = r => String(r['Final Group Pick']).trim().toLowerCase() === 'yes'
const whole = v => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5
const finals = ideas.filter(isFinal), rest = ideas.filter(r => !isFinal(r))
check(`every final idea (${finals.length}) has a whole-number 1–5 score from all seven models`,
  finals.length === FINALS && finals.every(r => pairs.every(([n, u]) => whole(r[n]) && whole(r[u]))), JSON.stringify(finals.find(r => !pairs.every(([n, u]) => whole(r[n]) && whole(r[u]))) || null)?.slice(0, 300))
check('no other idea has an AI score', rest.every(r => pairs.every(([n, u]) => r[n] === '' && r[u] === '')))
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length
check('the mean across models is the exact mean of the seven, and AI Quality the exact mean of the two means',
  finals.every(r => Math.abs(r['AI Novelty (mean across models)'] - mean(pairs.map(([n]) => Number(r[n])))) < 6e-5
    && Math.abs(r['AI Usefulness (mean across models)'] - mean(pairs.map(([, u]) => Number(r[u])))) < 6e-5
    && Math.abs(r['AI Quality (mean across models)'] - (Number(r['AI Novelty (mean across models)']) + Number(r['AI Usefulness (mean across models)'])) / 2) < 6e-5),
  JSON.stringify(finals.slice(0, 1).map(r => [r['AI Novelty (mean across models)'], pairs.map(([n]) => r[n])])))
const measured = ideas.filter(r => r['Novelty (empirical)'] !== '')
check(`the empirical columns are filled (${measured.length} of ${ideas.length} measurable ideas), every value in [0, 1]`,
  measured.length >= ideas.length * 0.9 && measured.every(r => EMP.every(c => r[c] === '' || (Number(r[c]) >= 0 && Number(r[c]) <= 1))))
const chk = XLSX.utils.sheet_to_json(wb.Sheets['Usefulness score check'], { header: 1, defval: '' })
check('the Usefulness score check sheet has one row per measured idea', chk.filter(r => r[0] && r[0] !== 'Idea ID' && String(r[0]).length < 40).length >= measured.length * 0.9)
const { buf: csvBuf } = await captureDownload(() => btn(/^CSV$/).click())
const csvHead = csvBuf.toString('utf8').replace(/^﻿/, '').split('\n')[0]
check('the CSV has the same columns as the Excel', csvHead.split(',').length === cols.length && pairs.every(([n]) => csvHead.includes(n)), csvHead.slice(0, 200))

// ── 4. The downloaded file re-uploaded as a top-up: nothing doubled ──────────
head('4. the downloaded file, uploaded as a top-up, changes nothing and doubles nothing')
await p.locator('input[type=file][accept=".xlsx,.xls,.csv"]').nth(1).setInputFiles({ name: 'all.xlsx', mimeType: XLSX_MIME, buffer: buf })
const topMsg = await p.locator('p').filter({ hasText: /matched|filled|already/ }).last().textContent({ timeout: 10000 }).catch(() => '')
check('the top-up matched every idea and filled none (they are all scored)', /matched/i.test(topMsg) && !/filled [1-9]/.test(topMsg), topMsg.slice(0, 200))
check(`still ${IDEAS.length} ideas (nothing appended)`, new RegExp(`for ${IDEAS.length} ideas`).test(await p.getByRole('button', { name: /empirical KPIs for/ }).first().textContent().catch(() => '')),
  await p.getByRole('button', { name: /empirical KPIs for/ }).first().textContent().catch(() => '?'))

// ── 5. A provider with no key ────────────────────────────────────────────────
head('5. a provider with no saved key is refused before any call')
await p.close()
const ctx2 = await newContext()
const noQwen = { ...KEYS }; delete noQwen.qwen
await openPage(ctx2, 'nokey', { provider: 'claude', apiKeys: noQwen })
await importFile(rawBook(), 'ideas-raw.xlsx')
await p.locator('select[title="Which provider\'s API key to use"]').selectOption('qwen')
check('the panel says the Qwen key is not saved', (await p.getByText(/no Qwen \(Alibaba Cloud\) key saved/).count()) === 1)
const before5 = calls.length
await btn(/^Fill the \d+ missing/).click()
const err5 = await p.locator('p.error-msg').first().textContent({ timeout: 10000 }).catch(() => '')
check('pressing Fill reports the missing key at once', /No API key saved for "qwen"/.test(err5), err5)
check('…and made no call', calls.length === before5)

// ── Wrap up ──────────────────────────────────────────────────────────────────
head('hygiene')
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '))
// The browser logs every 429 / 500 the stubs answered on purpose; anything else is an error.
const realErrors = consoleErrors.filter(e => !/status of (?:429|500|503)/.test(e))
check('no console errors (beyond the refusals the stubs scripted)', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))
check('no request left the machine except the seven stubbed providers', offsite.length === 0, offsite.slice(0, 3).join(' | '))
check('no unexpected dialog', dialogs.length === 0, dialogs.join(' | '))
await br.close()
srv.close()
console.log(fails ? `\nFAILED — ${fails} check(s):\n  ${failed.join('\n  ')}` : '\nRATER FLOW GUARD OK — a fresh upload, the empirical KPIs, seven paced AI raters and the final download all work.')
process.exit(fails ? 1 : 0)
