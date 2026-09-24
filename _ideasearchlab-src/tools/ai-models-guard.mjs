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
 *  4. **The four rater-only providers** (owner, 2026-09-24: Mistral, Meta's
 *     Llama, DeepSeek, Qwen): each listed with its top models, priced, marked
 *     `raterOnly` (the assistant's Cloud Function does not speak them, so they
 *     need no MODEL_LABELS entry and get no assistant card), carrying the note
 *     that says where the ideas go, and called with an OpenAI-compatible
 *     request that sends only `Authorization` + `Content-Type`.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  PROVIDERS, ASSISTANT_PROVIDERS, SCORING_DEFAULT_MODEL, DEFAULT_SCORING_PROVIDER, providerById,
  allModelIds, modelOptionLabel, CATALOGUE_AS_OF,
} from '../src/data/aiModels.js'
import { MODEL_PRICES, PRICES_AS_OF, replyCostUSD, priceAt, dayOf } from '../src/data/aiPricing.js'
import {
  buildRequest, parseReplyText, callProvider, scrubKey, replyProblem,
  claudeSupportsEffort, openaiIsReasoning, geminiTakesThinkingLevel,
  SCORING_MAX_TOKENS, LEGACY_CHAT_MAX_TOKENS, SCORING_EFFORT,
  OPENAI_COMPAT_URLS, mistralTakesReasoningEffort, isMuseModel,
} from '../src/utils/providerRequest.js'
import { isFatalApiError } from '../src/utils/scoreBatch.js'
import { shortModelName } from '../src/utils/aiScoreColumns.js'

// THE ONE PLACE the owner's requested line-up is written down (2026-09-23:
// each provider's five newest, most capable first). When the list is next
// refreshed, update this table with the catalogue — every other check below
// derives from the catalogue and the price table themselves.
const OWNER_LINEUP = {
  claude: ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5'],
  openai: ['gpt-6-astra', 'gpt-5.6-sol', 'gpt-6-sol', 'gpt-5.6-terra', 'gpt-6-luna'],
  gemini: ['gemini-3.1-pro-preview', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
  // 2026-09-24, "Add Mistral, Meta's Llama, DeepSeek and Qwen's top models
  // available": each provider's top models its own API (or, for Meta, OpenRouter)
  // serves, most capable first. DeepSeek's API offers two; Meta runs no Llama API.
  mistral: ['mistral-medium-2604', 'mistral-large-2512', 'mistral-small-2603', 'ministral-14b-2512', 'ministral-8b-2512'],
  openrouter: ['meta/muse-spark-1.3', 'meta/muse-glimmer-30b', 'meta-llama/llama-4-maverick'],
  deepseek: ['deepseek-v4-pro', 'deepseek-flash'],
  qwen: ['qwen3.8-max', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.8-flash'],
}
// Former scoring defaults (and the retired per-provider fallbacks) that must
// never quietly become the scoring default again.
const FORMER_SCORING_DEFAULTS = ['claude-haiku-4-5', 'claude-sonnet-4-6', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gemini-2.5-flash']

const here = dirname(fileURLToPath(import.meta.url))
const src = rel => readFileSync(join(here, '..', rel), 'utf8')

let pass = 0, fail = 0
function check(cond, msg) {
  if (cond) { pass++ } else { fail++; console.error('  ✗', msg) }
}

// ── 1. The catalogue shape ──────────────────────────────────────────────────
console.log('catalogue')
check(PROVIDERS.length === 7, 'seven providers (three for the assistant and the rater, four for the rater only)')
check(new Set(PROVIDERS.map(p => p.id)).size === PROVIDERS.length, 'provider ids unique')
check(JSON.stringify(ASSISTANT_PROVIDERS.map(p => p.id)) === JSON.stringify(['claude', 'openai', 'gemini']), 'the assistant providers are exactly the three functions/ai.js speaks')
check(PROVIDERS.filter(p => p.raterOnly).every(p => Object.keys(OPENAI_COMPAT_URLS).includes(p.id)), 'every rater-only provider has an OpenAI-compatible endpoint')
const ids = allModelIds()
check(new Set(ids).size === ids.length, 'model ids unique across providers')
check(/^\d{4}-\d{2}-\d{2}$/.test(CATALOGUE_AS_OF), 'CATALOGUE_AS_OF is a date')
check(/^\d{4}-\d{2}-\d{2}$/.test(PRICES_AS_OF) && PRICES_AS_OF >= CATALOGUE_AS_OF, `prices (${PRICES_AS_OF}) were snapshotted no earlier than the catalogue (${CATALOGUE_AS_OF}) — a price-only update may re-date aiPricing.js alone`)
for (const p of PROVIDERS) {
  if (p.raterOnly) check(p.models.length >= 1 && p.models.length <= 5, `${p.id}: one to five models (has ${p.models.length})`)
  else check(p.models.length === 5, `${p.id}: five models (has ${p.models.length})`)
  check(p.models.every(m => m.id && m.label), `${p.id}: every model has id + label`)
  // A column title reads "AI Novelty (<short name>)": no brackets inside it.
  check(p.models.every(m => shortModelName(m) && !/[()]/.test(shortModelName(m))), `${p.id}: every short name is bracket-free (give the model a \`short\`): ${p.models.map(shortModelName).join(' | ')}`)
  const prices = p.models.map(m => MODEL_PRICES[m.id])
  check(prices.every(Boolean), `${p.id}: every listed model has a price (missing: ${p.models.filter(m => !MODEL_PRICES[m.id]).map(m => m.id).join(', ') || 'none'})`)
  const outs = prices.map(x => x?.out ?? -1)
  const def = SCORING_DEFAULT_MODEL[p.id]
  check(p.models.some(m => m.id === def), `${p.id}: scoring default ${def} is in its list`)
  const defPrice = MODEL_PRICES[def]?.out ?? Infinity
  if (p.raterOnly) {
    // Most capable first (the OWNER_LINEUP table pins the order); Qwen3.7-Max's
    // list price is above the Qwen3.8-Max flagship's, so the price rule is not
    // applied here. The default is a cheap model, never the flagship.
    check(p.models.length === 1 || def !== p.models[0].id || p.models.length < 3, `${p.id}: scoring default ${def} is not the flagship`)
    check(typeof p.note === 'string' && p.note.length > 40, `${p.id}: carries a note on the key and where the ideas go`)
  } else {
    check(outs[0] === Math.max(...outs), `${p.id}: the first model is the most expensive (${p.models[0].id})`)
    check(defPrice === Math.min(...outs), `${p.id}: scoring default ${def} is the cheapest of the five`)
  }
  check(!!MODEL_PRICES[p.defaultModel], `${p.id}: assistant default ${p.defaultModel} is priced`)
  // The scoring default is a current-generation id, never a retired one.
  check(!FORMER_SCORING_DEFAULTS.includes(def), `${p.id}: scoring default ${def} is not a former scoring default`)
}
check(providerById('nope').id === PROVIDERS[0].id, 'providerById falls back to the first provider')
check(providerById(DEFAULT_SCORING_PROVIDER).id === DEFAULT_SCORING_PROVIDER, 'default scoring provider exists')

// Option labels print the price; a model with no price keeps its bare label.
const m0 = PROVIDERS[0].models[0]
const lab = modelOptionLabel(m0, MODEL_PRICES)
check(lab.startsWith(m0.label) && /\$\d/.test(lab) && /per 1M tokens/.test(lab), `option label carries the price: "${lab}"`)
check(modelOptionLabel({ id: 'nope', label: 'X' }, MODEL_PRICES) === 'X', 'unpriced model keeps its label')
check(modelOptionLabel({ id: 'x', label: 'X' }, { x: { in: 4, out: 20, until: '2099-01-01' } }).endsWith('(promotional price until 2099-01-01)'), 'a time-limited price prints its expiry')
// A promotional price must never outlive its own expiry in the table. The
// runtime already falls back to the list price the day after `until`
// (priceAt / modelOptionLabel), so nothing is mis-charged — but the row is
// stale from that day, and this check (against TODAY's date, not the
// hand-maintained PRICES_AS_OF) is what gets it re-snapshotted.
const TODAY = dayOf()
for (const [id, row] of Object.entries(MODEL_PRICES)) {
  if (!row?.until) continue
  check(/^\d{4}-\d{2}-\d{2}$/.test(row.until) && row.list && row.list.in > 0 && row.list.out > 0, `${id}: promotional row carries a dated \`until\` and a \`list\` price`)
  check(TODAY <= row.until, `${id}: promotional price lapsed on ${row.until} (today ${TODAY}) — the runtime is charging the list price; re-snapshot the row and PRICES_AS_OF`)
}
// The price of the day: promotional through `until`, list after it.
{
  const row = { in: 4, out: 20, until: '2026-11-21', list: { in: 5, out: 30 } }
  check(priceAt(row, '2026-11-21').in === 4 && priceAt(row, '2026-11-21').promo === true, 'priceAt: the promotional price holds on its last day')
  check(priceAt(row, '2026-11-22').in === 5 && priceAt(row, '2026-11-22').out === 30 && priceAt(row, '2026-11-22').promo === false, 'priceAt: the list price applies the day after')
  check(priceAt({ in: 2, out: 10 }, '2030-01-01').in === 2, 'priceAt: a plain row never expires')
  check(priceAt(null) === null, 'priceAt: no row → null')
  check(dayOf({ seconds: 1764720000 }) === '2025-12-03' && dayOf('2026-11-22T10:00:00Z') === '2026-11-22' && /^\d{4}-\d{2}-\d{2}$/.test(dayOf(undefined)), 'dayOf reads Firestore-like, ISO and absent stamps')
  check(Math.abs(replyCostUSD('gpt-5.6-sol', 1e6, 1e6, '2026-11-22') - 35) < 1e-9 && Math.abs(replyCostUSD('gpt-5.6-sol', 1e6, 1e6, '2026-11-01') - 24) < 1e-9, 'replyCostUSD costs a reply at the price of ITS day')
  const m = { id: 'x', label: 'X' }
  const tbl = { x: row }
  check(modelOptionLabel(m, tbl, '2026-11-01').endsWith('(promotional price until 2026-11-21)') && /\$4 in \/ \$20 out/.test(modelOptionLabel(m, tbl, '2026-11-01')), 'label: promotional price + expiry while it holds')
  check(!/promotional/.test(modelOptionLabel(m, tbl, '2026-11-22')) && /\$5 in \/ \$30 out/.test(modelOptionLabel(m, tbl, '2026-11-22')), 'label: the list price, no expiry note, once lapsed')
}
check(modelOptionLabel({ id: 'x', label: 'X' }, { x: { in: 0.1, out: 0.5 } }) === 'X · $0.1 in / $0.5 out per 1M tokens', 'fractional prices print as given')
{
  const probe = PROVIDERS[1].models[4].id
  const pp = MODEL_PRICES[probe]
  check(pp && Math.abs(replyCostUSD(probe, 1_000_000, 1_000_000) - (pp.in + pp.out)) < 1e-9, `replyCostUSD reads the new rows (${probe})`)
}

for (const [pid, list] of Object.entries(OWNER_LINEUP)) {
  check(JSON.stringify(providerById(pid).models.map(m => m.id)) === JSON.stringify(list), `${pid}: the owner's line-up in order (update OWNER_LINEUP at the top of this file with the catalogue)`)
}

// ── 2. The three catalogues agree ───────────────────────────────────────────
console.log('functions/ai.js mirror')
const fn = src('functions/ai.js')
const labelsStart = fn.indexOf('const MODEL_LABELS = {')
const labelsBlock = labelsStart === -1 ? '' : fn.slice(labelsStart, fn.indexOf('\n}', labelsStart))
check(labelsBlock.length > 0, 'found the MODEL_LABELS block in functions/ai.js')
// Only the assistant's models: the function never runs a rater-only provider.
for (const id of ASSISTANT_PROVIDERS.flatMap(p => p.models.map(m => m.id))) check(labelsBlock.includes(`'${id}'`), `MODEL_LABELS names ${id}`)
// A regex literal scraped from the function's source; null when the line moved
// or was reshaped — reported as a failed check, never a crash that hides the
// hundred checks after it.
function scrapedRegex(source, pattern, what) {
  const m = source.match(pattern)
  check(!!m, `found the ${what} regex in functions/ai.js`)
  if (!m) return { test: () => false }
  try { return new Function(`return ${m[1]}`)() } catch { check(false, `${what} regex parses`); return { test: () => false } }
}
for (const p of ASSISTANT_PROVIDERS) {
  const re = new RegExp(`${p.id}:\\s*\\{\\s*model:\\s*'([^']+)'`)
  const m = fn.match(re)
  check(m && m[1] === p.defaultModel, `functions PROVIDER_DEFAULTS.${p.id} (${m && m[1]}) == catalogue defaultModel (${p.defaultModel})`)
}
// The function's own Claude/OpenAI parameter rules cover the new ids.
const tempRe = scrapedRegex(fn, /supportsTemperature = !(\/[^\n]*\/)\.test/, 'supportsTemperature')
for (const id of ['claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-fable-5-1', 'claude-opus-4-8']) {
  check(tempRe.test(id), `functions callClaude sends no temperature to ${id}`)
}
for (const id of ['claude-sonnet-4-6', 'claude-haiku-4-5']) check(!tempRe.test(id), `functions callClaude still allows temperature on ${id}`)
const reasonRe = scrapedRegex(fn, /isReasoningFamily = (\/[^\n]*\/)\.test/, 'isReasoningFamily')
for (const id of ['gpt-6-astra', 'gpt-6-luna', 'gpt-5.6-sol']) check(reasonRe.test(id), `functions callOpenAI treats ${id} as a reasoning model`)
check(!reasonRe.test('gpt-4o'), 'functions callOpenAI keeps gpt-4o on the legacy params')
// The deployed Gemini caller must carry the key as a header, like the browser
// rater: `?key=` puts it in logs and is refused for the "AQ."-format keys.
check(!/\?key=\$\{/.test(fn) && !/generateContent\?key/.test(fn), 'functions callGemini never puts the key in the URL')
check(/'x-goog-api-key':\s*config\.apiKey/.test(fn), 'functions callGemini sends the key in x-goog-api-key')
// Thinking-by-default Claude models get headroom above the reply ceiling and
// a low effort, or a 1000-token chat reply can come back as thinking alone.
const thinksRe = scrapedRegex(fn, /CLAUDE_THINKS_BY_DEFAULT = (\/[^\n]*\/)/, 'CLAUDE_THINKS_BY_DEFAULT')
for (const id of ['claude-fable-5-1', 'claude-fable-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5']) check(thinksRe.test(id), `functions callClaude gives ${id} thinking headroom + low effort`)
for (const id of ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5']) check(!thinksRe.test(id), `functions callClaude keeps the plain ceiling on ${id} (no thinking when omitted)`)
check(/body\.max_tokens = config\.maxTokens \+ CLAUDE_THINKING_HEADROOM/.test(fn) && /body\.output_config = \{ effort: 'low' \}/.test(fn), 'functions callClaude adds the headroom and low effort inside that branch')
// Same trap on Gemini 3.x (thinks at MEDIUM by default, thoughts count toward
// maxOutputTokens): low thinking level + headroom; 2.5 rejects thinkingLevel.
const gThinksRe = scrapedRegex(fn, /GEMINI_THINKS_BY_DEFAULT = (\/[^\n]*\/)/, 'GEMINI_THINKS_BY_DEFAULT')
for (const id of ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-pro-preview']) check(gThinksRe.test(id), `functions callGemini gives ${id} thinking headroom + low thinking level`)
check(!gThinksRe.test('gemini-2.5-flash'), 'functions callGemini keeps the plain ceiling on gemini-2.5-flash')
check(/generationConfig\.maxOutputTokens = config\.maxTokens \+ GEMINI_THINKING_HEADROOM/.test(fn) && /generationConfig\.thinkingConfig = \{ thinkingLevel: 'low' \}/.test(fn), 'functions callGemini adds the headroom and low thinking level inside that branch')

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
// The four rater-only providers: OpenAI-compatible, two headers only (DeepSeek's
// and Qwen's CORS preflights refuse any other), no JSON mode (it forces an
// object; the rater asks for an array), thinking off where it can be.
const COMPAT = {
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
}
for (const [pid, url] of Object.entries(COMPAT)) {
  for (const m of providerById(pid).models) {
    const r = buildRequest(pid, { ...args, model: m.id })
    check(r.url === url, `${pid}: ${m.id} goes to ${url}`)
    check(JSON.stringify(Object.keys(r.headers).sort()) === JSON.stringify(['Authorization', 'Content-Type']) && r.headers.Authorization === `Bearer ${KEY}`, `${pid}: ${m.id} sends only Authorization + Content-Type`)
    check(!('response_format' in r.body) && !r.url.includes(KEY), `${pid}: ${m.id} no JSON mode, key not in the URL`)
    check(r.body.model === m.id && r.body.messages[0].content === 'SYS' && r.body.messages[1].content === 'USER' && r.body.max_tokens > 0, `${pid}: ${m.id} model, system + user, a token ceiling`)
  }
}
check(buildRequest('mistral', { ...args, model: 'mistral-medium-2604' }).body.reasoning_effort === 'none' && buildRequest('mistral', { ...args, model: 'mistral-small-2603' }).body.reasoning_effort === 'none', 'mistral: thinking off on Medium 3.5 and Small 4')
check(!('reasoning_effort' in buildRequest('mistral', { ...args, model: 'mistral-large-2512' }).body) && !mistralTakesReasoningEffort('ministral-8b-2512'), 'mistral: no reasoning_effort on the models without a reasoning mode')
check(buildRequest('deepseek', { ...args, model: 'deepseek-v4-pro' }).body.thinking?.type === 'disabled', 'deepseek: thinking disabled (V4 thinks by default)')
check(buildRequest('qwen', { ...args, model: 'qwen3.8-max' }).body.enable_thinking === false, 'qwen: enable_thinking false (required on a non-streaming call)')
{
  const muse = buildRequest('openrouter', { ...args, model: 'meta/muse-spark-1.3' }).body
  const llama = buildRequest('openrouter', { ...args, model: 'meta-llama/llama-4-maverick' }).body
  check(isMuseModel('meta/muse-glimmer-30b') && muse.reasoning?.effort === SCORING_EFFORT && muse.reasoning?.exclude === true && muse.max_tokens === SCORING_MAX_TOKENS, 'openrouter: Muse (cannot stop thinking) gets low effort, hidden reasoning, the 8000 ceiling')
  check(!('reasoning' in llama) && llama.max_tokens === LEGACY_CHAT_MAX_TOKENS, 'openrouter: Llama 4 Maverick gets no reasoning field')
}
check(parseReplyText('mistral', { choices: [{ message: { content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'hm' }] }, { type: 'text', text: '[{"i":0}]' }] } }] }) === '[{"i":0}]', 'mistral: content as an array of chunks — the text chunks are the reply')
for (const pid of Object.keys(COMPAT)) check(parseReplyText(pid, { choices: [{ message: { content: '[]' } }] }) === '[]', `${pid}: string content parses`)
check(replyProblem('deepseek', { choices: [{ message: { content: '' }, finish_reason: 'length' }] }, '')?.kind === 'exhausted' && replyProblem('qwen', { choices: [{ message: { refusal: 'no' } }] }, '')?.kind === 'refusal', 'rater-only providers: the OpenAI reply-problem rules apply')
check(isFatalApiError({ status: 402 }), '402 (DeepSeek / OpenRouter out of credit) stops the run at once')
let threw = false
try { buildRequest('nope', { ...args, model: 'x' }) } catch { threw = true }
check(threw, 'unknown provider throws')

// ── 4. Reply parsing ────────────────────────────────────────────────────────
console.log('reply parsing')
check(parseReplyText('claude', { content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: '[{"i":0' }, { type: 'text', text: ',"novelty":3,"usefulness":4}]' }] }) === '[{"i":0,"novelty":3,"usefulness":4}]', 'claude: thinking block first, text blocks joined')
check(parseReplyText('claude', { stop_reason: 'refusal', content: [] }) === '', 'claude: refusal parses to empty text (callProvider then reports it — below)')
check(parseReplyText('openai', { choices: [{ message: { content: '[]' } }] }) === '[]', 'openai: message content')
check(parseReplyText('openai', { choices: [] }) === '', 'openai: no choices → empty')
check(parseReplyText('gemini', { candidates: [{ content: { parts: [{ text: 'thoughts', thought: true }, { text: '[{"i":0}]' }] } }] }) === '[{"i":0}]', 'gemini: thought parts skipped')
check(parseReplyText('gemini', { promptFeedback: { blockReason: 'SAFETY' } }) === '', 'gemini: blocked prompt → empty')
check(parseReplyText('other', {}) === '', 'unknown provider → empty')
// A 2xx with no rating is reported as a cause, never returned as '' (which
// scoreBatch would re-send per idea and end with nothing in lastError).
const rp = (prov, data, text) => replyProblem(prov, data, text)
check(rp('claude', { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }, '')?.kind === 'refusal' && /refusal: cyber/.test(rp('claude', { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }, '').why), 'claude: refusal is a reply problem of kind refusal naming its category')
check(rp('claude', { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '…' }] }, '')?.kind === 'exhausted', 'claude: ceiling spent on thinking with no text is an exhausted reply')
check(rp('claude', { stop_reason: 'max_tokens', content: [{ type: 'text', text: '[{"i":0,"novelty":3,"usefulness":4},{"i":1' }] }, '[{"i":0,"novelty":3,"usefulness":4},{"i":1') === null, 'claude: a truncated reply WITH text is handed back (the parser salvages it)')
check(rp('claude', { stop_reason: 'end_turn', content: [{ type: 'text', text: '[]' }] }, '[]') === null, 'claude: a normal reply is no problem')
check(rp('openai', { choices: [{ message: { refusal: 'no' }, finish_reason: 'stop' }] }, '')?.kind === 'refusal', 'openai: message.refusal is a refusal')
check(rp('openai', { choices: [{ message: { content: '' }, finish_reason: 'length' }] }, '')?.kind === 'exhausted', 'openai: length with no text is an exhausted reply')
check(rp('openai', { choices: [{ message: { content: '[]' }, finish_reason: 'length' }] }, '[]') === null, 'openai: length WITH text is handed back')
check(rp('openai', { choices: [{ message: { content: '' }, finish_reason: 'content_filter' }] }, '')?.kind === 'refusal', 'openai: content_filter is a refusal')
check(rp('gemini', { promptFeedback: { blockReason: 'SAFETY' } }, '')?.kind === 'refusal', 'gemini: a blocked prompt is a refusal')
check(rp('gemini', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }, '')?.kind === 'exhausted', 'gemini: MAX_TOKENS with no text is an exhausted reply')
check(rp('gemini', { candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }, '')?.kind === 'refusal', 'gemini: a SAFETY finish with no text is a refusal')
check(rp('gemini', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '[]' }] } }] }, '[]') === null, 'gemini: a normal reply is no problem')
check(rp('other', {}, '') === null, 'unknown provider → no problem reported')

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
const eRef = await errorOf(fakeFetch(200, { stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] }))
check(eRef && eRef.replyProblem === 'refusal' && eRef.retryable === false && eRef.status === undefined && !isFatalApiError(eRef) && /refusal: cyber/.test(eRef.message) && eRef.message.includes('claude-sonnet-5'), 'a refusal THROWS as a non-retryable reply problem (no status, never fatal), naming the model and category')
const eThink = await errorOf(fakeFetch(200, { stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: '…' }] }))
check(eThink && eThink.replyProblem === 'exhausted' && eThink.retryable === true && /thinking and returned no text/.test(eThink.message), 'a ceiling spent on thinking with no text THROWS as a retryable reply problem')
// scoreBatch honours both: a refusal skips the transport retries and the
// per-idea round still runs (tools/score-batch-guard.mjs drives the loop; here
// only the contract the two modules share is pinned).
{
  const sb = src('src/utils/scoreBatch.js')
  check(/err\?\.retryable === false/.test(sb) && /err\?\.replyProblem/.test(sb), 'scoreBatch reads retryable and replyProblem off the thrown error')
}
const okCut = await callProvider(resolved, 'SYS', 'USER', { fetch: fakeFetch(200, { stop_reason: 'max_tokens', content: [{ type: 'text', text: '[{"i":0,"novelty":3,"usefulness":4},{"i":1' }] }) })
check(okCut.startsWith('[{"i":0'), 'a truncated reply WITH text is returned for the parser to salvage')
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
check(/newest models \(five each for Claude, OpenAI and Gemini\), most capable/.test(page), 'Data Analytics explains the list order')
check(/activeProvider\.note/.test(page), 'Data Analytics shows the chosen provider\'s note (where the ideas go)')
check(/A key unlocks all of a provider's models|An API key belongs to your/.test(page), 'Data Analytics explains why a model is chosen beside the key')
const settings = src('src/pages/AISettings.jsx')
check(/modelOptionLabel\(m, MODEL_PRICES\)/.test(settings), 'AI Settings dropdown prints the price per model')
check(/ASSISTANT_PROVIDERS\.map\(p => \(/.test(settings), 'AI Settings offers only the assistant providers as the assistant\'s provider')
check(/PROVIDERS\.map\(p => \(\s*<div key=\{p\.id\} className=\{styles\.field\}>/.test(settings) && /rater only/.test(settings), 'AI Settings has a key field for every provider, rater-only ones marked')
check(/Object\.fromEntries\(PROVIDERS\.map\(p => \[p\.id, ''\]\)\)/.test(settings), 'AI Settings starts and clears keys for every provider')
// A saved id the pruned list no longer offers must render as ITSELF, not as
// "Use default" (a controlled <select> with no matching option shows the first
// row while Save re-persists the invisible id).
check(/model && !activeProvider\?\.models\.some\(m => m\.id === model\) && \(/.test(settings) && /Saved: \$\{model\} \(no longer listed\)/.test(settings), 'AI Settings renders a saved-but-unlisted model as its own option')
check(!/best and most expensive first/.test(settings) && !/best and most expensive first/.test(page), 'the hint text no longer claims a price ordering the printed prices contradict')

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
  const missingIds = ids.filter(id => !chunk.includes(id))
  check(missingIds.length === 0, `shipped bundle carries every catalogue id (rebuild + copy dist/ into lab/ideasearchlab; missing: ${missingIds.join(', ') || 'none'})`)
  // One marker per behaviour this guard exists for, so a bundle built before
  // any of them fails here rather than passing on the older markers alone.
  // ADD A MARKER WITH EVERY USER-VISIBLE STRING A LATER CHANGE INTRODUCES.
  const BUNDLE_MARKERS = [
    ['no longer listed', 'the saved-but-unlisted model option'],
    ['declined to rate this batch', 'the refusal reply problem'],
    ['token ceiling on', 'the thinking-exhausted reply problem'],
    ['promotional price until', 'the promotional-price label'],
    ['Last cause reported', 'the reported cause on the analytics page'],
    ['(mean across models)', 'the per-model AI columns (aiScoreColumns)'],
    ['model not recorded', 'the unlabelled-score column'],
    ['Download all idea data (Excel)', 'the download-all button'],
    ['Usefulness score check', 'the usefulness check sheet'],
    ['Novelty (empirical)', 'the empirical labels'],
    ['api.deepseek.com', 'the rater-only providers'],
  ]
  for (const [marker, what] of BUNDLE_MARKERS) check(chunk.includes(marker), `shipped bundle carries ${what} ("${marker}")`)
} else {
  console.log('  (no shipped bundle beside the source — bundle checks skipped)')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
