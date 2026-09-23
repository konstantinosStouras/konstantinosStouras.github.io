/**
 * ai-models-guard.mjs — offline test (no network, no deps, no key).
 *
 *   node _ideasearchlab-src/tools/ai-models-guard.mjs
 *
 * Guards the Data Analytics AI rater's provider layer and the shared model
 * catalogue (owner, 2026-09-23). Three things it pins:
 *
 *  1. **The rater can actually call a provider.** `llmClient.js` used to call a
 *     `callProvider` that was defined nowhere — the shipped bundle carried it
 *     as a bare global, so "Fill the N missing AI scores" threw
 *     `ReferenceError` on its first batch with a valid key. The function now
 *     lives in `src/utils/providerRequest.js`; this guard drives every
 *     request shape and every error path against a fake fetch, and reads the
 *     SHIPPED bundle to make sure the fix reached it.
 *  2. **The three catalogues agree.** Every model id in `src/data/aiModels.js`
 *     has a price in `src/data/aiPricing.js` (the export's cost columns and
 *     the dropdown labels read it) and a label in `functions/ai.js`
 *     MODEL_LABELS (the note participants see); the per-provider default the
 *     page prints mirrors the deployed function's PROVIDER_DEFAULTS.
 *  3. **The list is what the owner asked for**: five models per provider, the
 *     most expensive first, the scoring default the cheapest of the five, and
 *     the price printed in each option label.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PROVIDERS, SCORING_DEFAULT_MODEL, DEFAULT_SCORING_PROVIDER, providerById,
  allModelIds, modelOptionLabel, CATALOGUE_AS_OF,
} from '../src/data/aiModels.js'
import { MODEL_PRICES, PRICES_AS_OF, replyCostUSD } from '../src/data/aiPricing.js'
import {
  buildRequest, parseReplyText, callProvider, scrubKey,
  claudeSupportsEffort, openaiIsReasoning, geminiTakesThinkingLevel,
  SCORING_MAX_TOKENS, LEGACY_CHAT_MAX_TOKENS, SCORING_EFFORT,
} from '../src/utils/providerRequest.js'
import { isFatalApiError } from '../src/utils/scoreBatch.js'

const here = dirname(fileURLToPath(import.meta.url))
const src = rel => readFileSync(join(here, '..', rel), 'utf8')

let pass = 0, fail = 0
function check(cond, msg) {
  if (cond) { pass++ } else { fail++; console.error('  ✗', msg) }
}

// ── 1. The catalogue shape ──────────────────────────────────────────────────
console.log('catalogue')
check(PROVIDERS.length === 3, 'three providers')
check(new Set(PROVIDERS.map(p => p.id)).size === 3, 'provider ids unique')
const ids = allModelIds()
check(new Set(ids).size === ids.length, 'model ids unique across providers')
check(/^\d{4}-\d{2}-\d{2}$/.test(CATALOGUE_AS_OF), 'CATALOGUE_AS_OF is a date')
check(CATALOGUE_AS_OF === PRICES_AS_OF, `catalogue (${CATALOGUE_AS_OF}) and prices (${PRICES_AS_OF}) snapshot on the same day`)
for (const p of PROVIDERS) {
  check(p.models.length === 5, `${p.id}: five models (has ${p.models.length})`)
  check(p.models.every(m => m.id && m.label), `${p.id}: every model has id + label`)
  const prices = p.models.map(m => MODEL_PRICES[m.id])
  check(prices.every(Boolean), `${p.id}: every listed model has a price (missing: ${p.models.filter(m => !MODEL_PRICES[m.id]).map(m => m.id).join(', ') || 'none'})`)
  const outs = prices.map(x => x?.out ?? -1)
  check(outs[0] === Math.max(...outs), `${p.id}: the first model is the most expensive (${p.models[0].id})`)
  const def = SCORING_DEFAULT_MODEL[p.id]
  check(p.models.some(m => m.id === def), `${p.id}: scoring default ${def} is in its list`)
  const defPrice = MODEL_PRICES[def]?.out ?? Infinity
  check(defPrice === Math.min(...outs), `${p.id}: scoring default ${def} is the cheapest of the five`)
  check(!!MODEL_PRICES[p.defaultModel], `${p.id}: assistant default ${p.defaultModel} is priced`)
  // The scoring default is a current-generation id, never a retired one.
  check(!['claude-haiku-4-5', 'claude-sonnet-4-6', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gemini-3.5-flash', 'gemini-2.5-flash'].includes(def), `${p.id}: scoring default ${def} is current-generation, not the retired default`)
}
check(providerById('nope').id === PROVIDERS[0].id, 'providerById falls back to the first provider')
check(providerById(DEFAULT_SCORING_PROVIDER).id === DEFAULT_SCORING_PROVIDER, 'default scoring provider exists')

// Option labels print the price; a model with no price keeps its bare label.
const m0 = PROVIDERS[0].models[0]
const lab = modelOptionLabel(m0, MODEL_PRICES)
check(lab.startsWith(m0.label) && /\$\d/.test(lab) && /per 1M tokens/.test(lab), `option label carries the price: "${lab}"`)
check(modelOptionLabel({ id: 'nope', label: 'X' }, MODEL_PRICES) === 'X', 'unpriced model keeps its label')
check(modelOptionLabel({ id: 'x', label: 'X' }, { x: { in: 0.1, out: 0.5 } }) === 'X · $0.1 in / $0.5 out per 1M tokens', 'fractional prices print as given')
check(replyCostUSD('gpt-6-luna', 1_000_000, 1_000_000) === 0.6, 'replyCostUSD reads the new rows')

// The line-up the owner asked for on 2026-09-23 — best/most expensive first.
const want = {
  claude: ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5'],
  openai: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-6-sol', 'gpt-5.6-terra', 'gpt-6-luna'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
}
for (const [pid, list] of Object.entries(want)) {
  check(JSON.stringify(providerById(pid).models.map(m => m.id)) === JSON.stringify(list), `${pid}: the September-2026 line-up in order`)
}

// ── 2. The three catalogues agree ───────────────────────────────────────────
console.log('functions/ai.js mirror')
const fn = src('functions/ai.js')
const labelsBlock = fn.slice(fn.indexOf('const MODEL_LABELS = {'), fn.indexOf('}', fn.indexOf('const MODEL_LABELS = {')))
for (const id of ids) check(labelsBlock.includes(`'${id}'`), `MODEL_LABELS names ${id}`)
for (const p of PROVIDERS) {
  const re = new RegExp(`${p.id}:\\s*\\{\\s*model:\\s*'([^']+)'`)
  const m = fn.match(re)
  check(m && m[1] === p.defaultModel, `functions PROVIDER_DEFAULTS.${p.id} (${m && m[1]}) == catalogue defaultModel (${p.defaultModel})`)
}
// The function's own Claude/OpenAI parameter rules cover the new ids.
const tempRe = eval(fn.match(/supportsTemperature = !(\/[^\n]*\/)\.test/)[1])
for (const id of ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-opus-4-8']) {
  check(tempRe.test(id), `functions callClaude sends no temperature to ${id}`)
}
for (const id of ['claude-sonnet-4-6', 'claude-haiku-4-5']) check(!tempRe.test(id), `functions callClaude still allows temperature on ${id}`)
const reasonRe = eval(fn.match(/isReasoningFamily = (\/[^\n]*\/)\.test/)[1])
for (const id of ['gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol']) check(reasonRe.test(id), `functions callOpenAI treats ${id} as a reasoning model`)
check(!reasonRe.test('gpt-4o'), 'functions callOpenAI keeps gpt-4o on the legacy params')

// ── 3. The request shapes ───────────────────────────────────────────────────
console.log('request shapes')
const KEY = 'sk-test-SECRET-KEY-1234567890'
const args = { apiKey: KEY, system: 'SYS', user: 'USER' }

const c = buildRequest('claude', { ...args, model: 'claude-fable-5-1' })
check(c.url === 'https://api.anthropic.com/v1/messages', 'claude: messages endpoint')
check(c.headers['x-api-key'] === KEY, 'claude: key in x-api-key')
check(c.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'claude: browser-access header')
check(c.headers['anthropic-version'] === '2023-06-01', 'claude: anthropic-version header')
check(!('temperature' in c.body) && !('top_p' in c.body), 'claude: no sampling parameters (Fable/Opus 5/Sonnet 5 400 on them)')
check(c.body.max_tokens === SCORING_MAX_TOKENS, 'claude: 8000-token ceiling (thinking counts toward it)')
check(c.body.system === 'SYS' && c.body.messages[0].role === 'user' && c.body.messages[0].content === 'USER', 'claude: system + one user message')
check(c.body.output_config?.effort === SCORING_EFFORT, 'claude: low effort on a Fable model')
for (const id of ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6']) {
  check(claudeSupportsEffort(id), `claude: ${id} takes output_config.effort`)
}
check(!claudeSupportsEffort('claude-haiku-4-5') && !claudeSupportsEffort('claude-sonnet-4-5'), 'claude: Haiku 4.5 / Sonnet 4.5 get no effort field (they 400 on it)')
check(!('output_config' in buildRequest('claude', { ...args, model: 'claude-haiku-4-5' }).body), 'claude: no output_config on Haiku 4.5')

const o = buildRequest('openai', { ...args, model: 'gpt-6-astra' })
check(o.url === 'https://api.openai.com/v1/chat/completions', 'openai: chat completions endpoint')
check(o.headers.Authorization === `Bearer ${KEY}`, 'openai: bearer key')
check(o.body.max_completion_tokens === SCORING_MAX_TOKENS && !('max_tokens' in o.body), 'openai: reasoning model takes max_completion_tokens')
check(o.body.reasoning_effort === 'low', 'openai: reasoning_effort low (GPT-6 Astra rejects none/minimal)')
check(!('temperature' in o.body), 'openai: no temperature on a reasoning model')
check(o.body.messages[0].role === 'system' && o.body.messages[1].role === 'user', 'openai: system then user')
for (const id of ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.5', 'o3']) check(openaiIsReasoning(id), `openai: ${id} is on the reasoning line`)
const o4 = buildRequest('openai', { ...args, model: 'gpt-4o' })
check(o4.body.max_tokens === LEGACY_CHAT_MAX_TOKENS && !('max_completion_tokens' in o4.body) && !('reasoning_effort' in o4.body), 'openai: legacy gpt-4o keeps max_tokens, no reasoning_effort')

const g = buildRequest('gemini', { ...args, model: 'gemini-3.8-flash' })
check(g.url === 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent', 'gemini: generateContent endpoint')
check(!g.url.includes(KEY) && !g.url.includes('key='), 'gemini: key is NOT in the URL')
check(g.headers['x-goog-api-key'] === KEY, 'gemini: key in x-goog-api-key header')
check(g.body.generationConfig.thinkingConfig?.thinkingLevel === 'low', 'gemini: 3.x takes thinkingLevel low')
check(g.body.generationConfig.responseMimeType === 'application/json', 'gemini: JSON response mode')
check(g.body.generationConfig.maxOutputTokens === SCORING_MAX_TOKENS, 'gemini: 8000-token ceiling')
check(g.body.system_instruction.parts[0].text === 'SYS' && g.body.contents[0].parts[0].text === 'USER', 'gemini: system_instruction + user content')
for (const id of ['gemini-3.1-pro-preview', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash']) check(geminiTakesThinkingLevel(id), `gemini: ${id} takes thinkingLevel`)
const g25 = buildRequest('gemini', { ...args, model: 'gemini-2.5-flash' })
check(!('thinkingConfig' in g25.body.generationConfig), 'gemini: 2.5 gets no thinkingLevel (it rejects the field)')
let threw = false
try { buildRequest('nope', { ...args, model: 'x' }) } catch { threw = true }
check(threw, 'unknown provider throws')

// ── 4. Reply parsing ────────────────────────────────────────────────────────
console.log('reply parsing')
check(parseReplyText('claude', { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '[{"i":0' }, { type: 'text', text: ',"novelty":3,"usefulness":4}]' }] }) === '[{"i":0,"novelty":3,"usefulness":4}]', 'claude: thinking block first, text blocks joined')
check(parseReplyText('claude', { stop_reason: 'refusal', content: [] }) === '', 'claude: refusal → empty text (scoreBatch retries the idea)')
check(parseReplyText('openai', { choices: [{ message: { content: '[]' } }] }) === '[]', 'openai: message content')
check(parseReplyText('openai', { choices: [] }) === '', 'openai: no choices → empty')
check(parseReplyText('gemini', { candidates: [{ content: { parts: [{ text: 'thoughts', thought: true }, { text: '[{"i":0}]' }] } }] }) === '[{"i":0}]', 'gemini: thought parts skipped')
check(parseReplyText('gemini', { promptFeedback: { blockReason: 'SAFETY' } }) === '', 'gemini: blocked prompt → empty')
check(parseReplyText('other', {}) === '', 'unknown provider → empty')

// ── 5. callProvider against a fake fetch ────────────────────────────────────
console.log('callProvider')
const fakeFetch = (status, body, opts = {}) => async (url, init) => ({
  ok: status >= 200 && status < 300, status, statusText: opts.statusText || '',
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => body,
  _url: url, _init: init,
})
const resolved = { provider: 'claude', apiKey: KEY, model: 'claude-sonnet-5' }
const okText = await callProvider(resolved, 'SYS', 'USER', { fetch: fakeFetch(200, { content: [{ type: 'text', text: '[{"i":0,"novelty":5,"usefulness":2}]' }] }) })
check(okText === '[{"i":0,"novelty":5,"usefulness":2}]', 'success returns the reply text')

let seen = null
await callProvider(resolved, 'SYS', 'USER', { fetch: async (url, init) => { seen = { url, init }; return fakeFetch(200, { content: [] })(url, init) } })
check(seen.init.method === 'POST' && JSON.parse(seen.init.body).model === 'claude-sonnet-5' && seen.init.headers['x-api-key'] === KEY, 'POSTs the built request with the model and key')

async function errorOf(fetchFn, r = resolved) { try { await callProvider(r, 'SYS', 'USER', { fetch: fetchFn }); return null } catch (e) { return e } }
const e401 = await errorOf(fakeFetch(401, { error: { message: `invalid x-api-key ${KEY}` } }))
check(e401 && e401.status === 401, '401 carries status 401')
check(e401 && isFatalApiError(e401), '401 is fatal for scoreBatch (no retries on a bad key)')
check(e401 && !e401.message.includes(KEY) && e401.message.includes('[api key]'), 'the API key never appears in an error message')
check(e401 && /Claude \(Anthropic\) API error 401/.test(e401.message) && e401.message.includes('claude-sonnet-5'), 'error names the provider, status and model')
const e429 = await errorOf(fakeFetch(429, 'rate limited'))
check(e429 && e429.status === 429 && !isFatalApiError(e429), '429 is not fatal (retried with backoff)')
const e400 = await errorOf(fakeFetch(400, { error: 'unknown model' }), { provider: 'openai', apiKey: KEY, model: 'gpt-nope' })
check(e400 && e400.status === 400 && isFatalApiError(e400) && /ChatGPT \(OpenAI\)/.test(e400.message), '400 (bad model / param) is fatal and names OpenAI')
const eNet = await errorOf(async () => { throw new TypeError(`Failed to fetch ${KEY}`) })
check(eNet && eNet.status === undefined && !isFatalApiError(eNet), 'a network failure carries no status → retried')
check(eNet && !eNet.message.includes(KEY), 'a network error message is scrubbed too')
const eBig = await errorOf(fakeFetch(500, 'x'.repeat(2000)))
check(eBig && eBig.message.length < 700, 'a huge error body is truncated')
check(scrubKey('abc', '') === 'abc' && scrubKey('k=' + KEY, KEY) === 'k=[api key]', 'scrubKey')

// ── 6. The wiring: source and the shipped bundle ────────────────────────────
console.log('wiring')
const llm = src('src/utils/llmClient.js')
check(/import \{ callProvider \} from '\.\/providerRequest'/.test(llm), 'llmClient imports callProvider from providerRequest')
check(/callProvider\(resolved, RATER_SYSTEM_PROMPT, buildBatchPrompt\(/.test(llm), 'llmClient scores through callProvider')
check(!/^(async )?function callProvider/m.test(llm), 'llmClient keeps no copy of callProvider')
check(!/import .*firebase/.test(src('src/utils/providerRequest.js')), 'providerRequest imports no Firebase (offline-testable)')
const page = src('src/pages/DataAnalytics.jsx')
check(/modelOptionLabel\(m, MODEL_PRICES\)/.test(page), 'Data Analytics dropdown prints the price per model')
check(/five newest models, best and most expensive first/.test(page), 'Data Analytics explains the list order')
check(/A key unlocks all of a provider's models|An API key belongs to your/.test(page), 'Data Analytics explains why a model is chosen beside the key')
const settings = src('src/pages/AISettings.jsx')
check(/modelOptionLabel\(m, MODEL_PRICES\)/.test(settings), 'AI Settings dropdown prints the price per model')

// The shipped bundle: the chunk index.html loads must carry the provider calls
// and must NOT reference callProvider as a bare global (the original bug).
const shippedIndex = join(here, '..', '..', 'lab', 'ideasearchlab', 'index.html')
if (existsSync(shippedIndex)) {
  const html = readFileSync(shippedIndex, 'utf8')
  const main = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/)?.[1]
  const chunk = main && existsSync(join(here, '..', '..', 'lab', 'ideasearchlab', 'assets', main))
    ? readFileSync(join(here, '..', '..', 'lab', 'ideasearchlab', 'assets', main), 'utf8') : ''
  check(!!chunk, `shipped bundle's main chunk found (${main})`)
  check(chunk.includes('anthropic-dangerous-direct-browser-access'), 'shipped bundle carries the Claude browser call')
  check(chunk.includes('x-goog-api-key'), 'shipped bundle carries the Gemini header call')
  check(!/=>callProvider\(/.test(chunk) && !/[^.\w]callProvider\(/.test(chunk), 'shipped bundle has no bare callProvider global (the ReferenceError)')
  check(chunk.includes('gpt-6-astra') && chunk.includes('gemini-3.8-flash') && chunk.includes('claude-opus-5-5'), 'shipped bundle carries the September-2026 catalogue')
} else {
  console.log('  (no shipped bundle beside the source — bundle checks skipped)')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
