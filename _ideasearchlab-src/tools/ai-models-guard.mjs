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
 *  5. **A failure is never read as an unreadable reply** (2026-09-24): a 2xx
 *     carrying `error` (OpenRouter), or an empty reply with finish reason
 *     `error` / `insufficient_system_resource` (DeepSeek), throws with a
 *     status, so it backs off and trips the circuit breaker; a 422 is fatal
 *     like a 400; and a key saved with a trailing space is trimmed where it
 *     is read and saved, and scrubbed from errors in both spellings.
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
  buildRequest, parseReplyText, callProvider, scrubKey, replyProblem, replyFailure, retryAfterMs,
  cleanApiKey, trimApiKeys,
  claudeSupportsEffort, openaiIsReasoning, geminiTakesThinkingLevel,
  SCORING_MAX_TOKENS, LEGACY_CHAT_MAX_TOKENS, SCORING_EFFORT,
  OPENAI_COMPAT_URLS, mistralTakesReasoningEffort, isMuseModel,
} from '../src/utils/providerRequest.js'
import { isFatalApiError, runScoring } from '../src/utils/scoreBatch.js'
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
  mistral: ['mistral-medium-latest', 'mistral-large-2512', 'mistral-small-2603', 'ministral-14b-2512', 'ministral-8b-2512'],
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
  // The scoring default is the provider's TOP model, the first of its list
  // (owner 2026-09-24); it used to be the cheapest.
  check(def === p.models[0].id, `${p.id}: scoring default ${def} is the flagship, first of its list`)
  if (p.raterOnly) {
    // Most capable first (the OWNER_LINEUP table pins the order); Qwen3.7-Max's
    // list price is above the Qwen3.8-Max flagship's, so the price rule is not
    // applied here.
    check(typeof p.note === 'string' && p.note.length > 40, `${p.id}: carries a note on the key and where the ideas go`)
  } else {
    check(outs[0] === Math.max(...outs), `${p.id}: the first model is the most expensive (${p.models[0].id})`)
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
// and Qwen's CORS preflights refuse any other), no JSON mode on a call without
// the rating schema, thinking off where it can be.
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
// The rating schema: a HARD 1..5 constraint on every provider that takes one
// (owner 2026-09-24: "constrain scores from AIs to be integers in 1, 2, 3, 4, 5 only").
const R = { ...args, ratings: true }
const enum5 = s => JSON.stringify(s?.properties?.ratings?.items?.properties?.novelty?.enum) === '[1,2,3,4,5]'
  && JSON.stringify(s?.properties?.ratings?.items?.properties?.usefulness?.enum) === '[1,2,3,4,5]'
  && s.additionalProperties === false && s.properties.ratings.items.additionalProperties === false
  && JSON.stringify(s.properties.ratings.items.required) === '["i","novelty","usefulness"]'
const cr = buildRequest('claude', { ...R, model: 'claude-fable-5-1' })
check(cr.body.output_config?.format?.type === 'json_schema' && cr.body.output_config.effort === SCORING_EFFORT && !('tools' in cr.body) && !('tool_choice' in cr.body),
  'claude: rating schema via output_config.format beside the effort, never forced tool use (Fable 5.1 400s on it)')
check(enum5(cr.body.output_config.format.schema), 'claude: novelty and usefulness are an enum of 1..5, additionalProperties false (no minimum/maximum: unsupported there)')
check(!/minimum|maximum/.test(JSON.stringify(cr.body.output_config.format.schema)), 'claude: the schema carries no numeric range keywords')
const orq = buildRequest('openai', { ...R, model: 'gpt-6-astra' })
check(orq.body.response_format?.type === 'json_schema' && orq.body.response_format.json_schema.strict === true && enum5(orq.body.response_format.json_schema.schema), 'openai: strict json_schema with the 1..5 enum')
const grq = buildRequest('gemini', { ...R, model: 'gemini-3.8-flash' })
const gi = grq.body.generationConfig.responseSchema?.properties?.ratings?.items?.properties
check(gi?.novelty?.type === 'INTEGER' && gi.novelty.minimum === 1 && gi.novelty.maximum === 5 && gi.usefulness.type === 'INTEGER' && gi.usefulness.minimum === 1 && gi.usefulness.maximum === 5
  && grq.body.generationConfig.responseMimeType === 'application/json', 'gemini: responseSchema INTEGER 1..5 (its enum is string-only) under JSON mode')
const mrq = buildRequest('mistral', { ...R, model: 'mistral-medium-latest' })
check(mrq.body.response_format?.type === 'json_schema' && mrq.body.response_format.json_schema.strict === true && enum5(mrq.body.response_format.json_schema.schema), 'mistral: strict json_schema with the 1..5 enum')
for (const pid of ['openrouter', 'deepseek', 'qwen']) check(!('response_format' in buildRequest(pid, { ...R, model: providerById(pid).models[0].id }).body), `${pid}: no schema mode to rely on — the prompt rule and the wholeRating gate`)
check(!('response_format' in buildRequest('openai', { ...args, model: 'gpt-6-astra' }).body) && !('format' in (buildRequest('claude', { ...args, model: 'claude-fable-5-1' }).body.output_config || {}))
  && !('responseSchema' in buildRequest('gemini', { ...args, model: 'gemini-3.8-flash' }).body.generationConfig) && !('response_format' in buildRequest('mistral', { ...args, model: 'mistral-medium-latest' }).body),
  'a call built without ratings:true (Step 1b translations) carries no rating schema')
check(buildRequest('mistral', { ...args, model: 'mistral-medium-latest' }).body.reasoning_effort === 'none' && buildRequest('mistral', { ...args, model: 'mistral-small-2603' }).body.reasoning_effort === 'none', 'mistral: thinking off on Medium 3.5 and Small 4')
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
check(isFatalApiError({ status: 422 }) && isFatalApiError({ status: 400 }), '422 (DeepSeek "Invalid Parameters", Mistral validation) stops the run at once, like 400')
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
const e422 = await errorOf(fakeFetch(422, { error: { message: 'Invalid Parameters: thinking', type: 'invalid_request_error' } }), { provider: 'deepseek', apiKey: KEY, model: 'deepseek-v4-pro' })
check(e422 && e422.status === 422 && isFatalApiError(e422), '422 through callProvider carries its status and is fatal')

// ── 5b. A 2xx that is really a failed request (2026-09-24) ─────────────────
// OpenRouter reports an upstream failure after generation started as HTTP 200
// + {error}; DeepSeek says it is out of capacity with an empty reply and
// finish_reason "insufficient_system_resource". Returned as '' they were read
// as unreadable replies: no backoff, no breaker, every idea re-sent singly (186
// ideas took 396 calls) and no cause on the page. Each must throw like a
// non-2xx: a status, no replyProblem, and never the key in the message.
console.log('a 2xx that is a failed request')
{
  const compat = (pid, model) => ({ provider: pid, apiKey: KEY, model })
  const orr = compat('openrouter', 'meta/muse-spark-1.3')
  const isTransportFailure = e => !!e && !e.replyProblem && e.retryable !== false && !isFatalApiError(e)

  const eTop = await errorOf(fakeFetch(200, { error: { code: 429, message: 'meta/muse-spark-1.3 is temporarily rate-limited upstream' } }), orr)
  check(eTop && eTop.status === 429 && isTransportFailure(eTop), 'openrouter: 200 + {error:{code:429}} throws status 429, no replyProblem, not fatal (backed off)')
  check(eTop && /OpenRouter \(Meta models\) API error 429 for model "meta\/muse-spark-1\.3"/.test(eTop.message) && /rate-limited upstream/.test(eTop.message), 'openrouter: the message names the provider, status, model and the upstream reason')
  const eChoice = await errorOf(fakeFetch(200, { choices: [{ finish_reason: 'error', message: { content: '' }, error: { code: 502, message: 'Upstream provider returned an error' } }] }), orr)
  check(eChoice && eChoice.status === 502 && isTransportFailure(eChoice), 'openrouter: an error on the CHOICE (finish_reason error) throws with its code')
  const eStr = await errorOf(fakeFetch(200, { error: { code: 'server_error', message: 'boom' } }), orr)
  check(eStr && eStr.status === 502 && isTransportFailure(eStr), 'a non-numeric error code becomes 502 (the request failed, the reply does not say how)')
  const eOdd = await errorOf(fakeFetch(200, { error: { code: 200, message: 'odd' } }), orr)
  check(eOdd && eOdd.status === 502, 'a numeric code that is not an HTTP error code becomes 502 too')
  const eKeyed = await errorOf(fakeFetch(200, { error: { code: 401, message: `No auth credentials found for ${KEY}` } }), orr)
  check(eKeyed && eKeyed.status === 401 && isFatalApiError(eKeyed), 'a 200 carrying error 401 is fatal, exactly as an HTTP 401 is')
  check(eKeyed && !eKeyed.message.includes(KEY) && eKeyed.message.includes('[api key]'), 'a 2xx error body echoing the key is scrubbed')
  const eOai = await errorOf(fakeFetch(200, { error: { message: 'The server had an error', type: 'server_error', code: null } }), { provider: 'openai', apiKey: KEY, model: 'gpt-6-luna' })
  check(eOai && eOai.status === 502 && /ChatGPT \(OpenAI\) API error 502/.test(eOai.message), 'openai: a 200 carrying {error} throws too (502)')
  const eClaude = await errorOf(fakeFetch(200, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }))
  check(eClaude && eClaude.status === 502 && isTransportFailure(eClaude), 'claude: a 200 carrying {type:"error", error} throws too (502)')

  for (const [pid, model, fin] of [
    ['deepseek', 'deepseek-flash', 'insufficient_system_resource'],
    ['deepseek', 'deepseek-v4-pro', 'error'],
    ['mistral', 'mistral-small-2603', 'error'],
    ['openrouter', 'meta-llama/llama-4-maverick', 'error'],
    ['qwen', 'qwen3.8-flash', 'error'],
    ['openai', 'gpt-6-luna', 'error'],
  ]) {
    const e = await errorOf(fakeFetch(200, { choices: [{ message: { content: '' }, finish_reason: fin }] }), compat(pid, model))
    check(e && e.status === 503 && isTransportFailure(e) && e.message.includes(fin) && e.message.includes(model), `${pid}: an empty reply with finish_reason "${fin}" throws 503, no replyProblem, retried (${e && e.message})`)
  }
  const cut = await callProvider(compat('deepseek', 'deepseek-flash'), 'S', 'U', { fetch: fakeFetch(200, { choices: [{ message: { content: '[{"i":0,"novelty":3,"usefulness":4},{"i":1' }, finish_reason: 'insufficient_system_resource' }] }) })
  check(cut.startsWith('[{"i":0'), 'a reply that broke off AFTER some text is handed back for the parser to salvage')
  const fine = await callProvider(compat('openai', 'gpt-6-luna'), 'S', 'U', { fetch: fakeFetch(200, { error: null, choices: [{ message: { content: '[]' }, finish_reason: 'stop' }] }) })
  check(fine === '[]', 'a normal reply carrying `error: null` is a normal reply')
  check(replyFailure('gemini', { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '[]' }] } }] }, '[]') === null
    && replyFailure('deepseek', { choices: [{ message: { content: '' }, finish_reason: 'length' }] }, '') === null, 'replyFailure leaves normal and "length" replies alone (those are replyProblem\'s)')

  // Mistral's model_length: a token limit reached with nothing to show, the
  // same failure as "length", so the same kind (exhausted, worth another go).
  const eLen = await errorOf(fakeFetch(200, { choices: [{ message: { content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'hm' }] }] }, finish_reason: 'model_length' }] }), compat('mistral', 'mistral-medium-latest'))
  check(eLen && eLen.replyProblem === 'exhausted' && eLen.retryable === true && eLen.status === undefined && /model_length/.test(eLen.message), 'mistral: an empty reply with finish_reason "model_length" is an exhausted reply (retryable, not a transport failure)')

  // End to end through the real batching loop: the failure now backs off and
  // trips the circuit breaker instead of fanning out to one call per idea.
  let calls = 0, slept = 0
  const r = await runScoring({
    texts: Array.from({ length: 186 }, (_, i) => `idea ${i}`), isFatal: isFatalApiError, sleep: async ms => { slept += ms },
    call: async () => { calls++; return callProvider(orr, 'S', 'U', { fetch: fakeFetch(200, { error: { code: 429, message: 'rate-limited upstream' } }) }) },
  })
  // A 429 gets six patient tries per batch (2, 4, 8, 16, 30 s), so three batches
  // in a row cost 18 calls and a three-minute wait before the breaker trips.
  check(r.aborted === true && r.failedBatches === 3 && calls === 18 && slept === 3 * (2000 + 4000 + 8000 + 16000 + 30000), `runScoring: a 200 + {error:429} backs off and trips the breaker (calls=${calls}, aborted=${r.aborted}, failedBatches=${r.failedBatches}, slept=${slept} ms)`)
  check(r.lastError?.status === 429 && /rate-limited upstream/.test(r.lastError.message), 'runScoring: the cause reaches lastError')
  let dsCalls = 0
  const ds = await runScoring({
    texts: Array.from({ length: 40 }, (_, i) => `idea ${i}`), isFatal: isFatalApiError, sleep: async () => {},
    call: async () => { dsCalls++; return callProvider(compat('deepseek', 'deepseek-flash'), 'S', 'U', { fetch: fakeFetch(200, { choices: [{ message: { content: '' }, finish_reason: 'insufficient_system_resource' }] }) }) },
  })
  check(ds.aborted === true && dsCalls === 9, `runScoring: DeepSeek out of capacity trips the breaker (calls=${dsCalls})`)
  let fatalCalls = 0
  const fatal = await runScoring({
    texts: Array.from({ length: 40 }, (_, i) => `idea ${i}`), isFatal: isFatalApiError, sleep: async () => {},
    call: async () => { fatalCalls++; return callProvider(compat('deepseek', 'deepseek-v4-pro'), 'S', 'U', { fetch: fakeFetch(422, { error: { message: 'Invalid Parameters' } }) }) },
  }).then(() => null, e => e)
  check(fatal && fatal.status === 422 && fatalCalls === 1, `runScoring: a 422 stops the run on its first call (calls=${fatalCalls})`)

  // Retry-After: seconds or an HTTP date, capped at ten minutes, null otherwise.
  const hdr = v => ({ get: n => (n === 'retry-after' ? v : null) })
  const t0 = Date.parse('2026-09-24T10:00:00Z')
  check(retryAfterMs(hdr('7')) === 7000 && retryAfterMs(hdr(' 2.5 ')) === 2500 && retryAfterMs(hdr('0')) === 0
    && retryAfterMs(hdr('Thu, 24 Sep 2026 10:00:20 GMT'), t0) === 20000 && retryAfterMs(hdr('Thu, 24 Sep 2026 09:59:00 GMT'), t0) === 0
    && retryAfterMs(hdr('99999')) === 600000 && retryAfterMs(hdr('soon')) === null && retryAfterMs(hdr(null)) === null && retryAfterMs(undefined) === null,
    'retryAfterMs reads seconds and dates, caps at ten minutes, ignores junk')
  const e429 = await errorOf(async () => ({ ok: false, status: 429, statusText: 'Too Many Requests', headers: hdr('12'), text: async () => 'slow down' }))
  check(e429 && e429.status === 429 && e429.retryAfterMs === 12000, 'a 429 carries the provider\'s Retry-After as retryAfterMs')
  const e503 = await errorOf(async () => ({ ok: false, status: 503, statusText: '', headers: hdr(null), text: async () => 'overloaded' }))
  check(e503 && e503.status === 503 && e503.retryAfterMs === undefined, 'a refusal without Retry-After carries none')

  // A 2xx whose body is not JSON: a status-less (retried) error, the parser's
  // own message scrubbed (it can quote the start of the body).
  const eJson = await errorOf(async () => ({ ok: true, status: 200, statusText: '', text: async () => KEY, json: async () => { throw new SyntaxError(`Unexpected token 's', "${KEY}" is not valid JSON`) } }))
  check(eJson && eJson.status === undefined && !isFatalApiError(eJson) && /could not be read as JSON/.test(eJson.message) && !eJson.message.includes(KEY), 'an unreadable 2xx body is a retried error whose message never carries the key')
  // Only a few characters of the body reach the parser's message: too few for
  // scrubKey, so none of it is shown.
  const eFrag = await errorOf(async () => ({ ok: true, status: 200, statusText: '', text: async () => `oops ${KEY}`, json: async () => { throw new SyntaxError(`Unexpected token 'o', "oops ${KEY.slice(0, 5)}"... is not valid JSON`) } }))
  check(eFrag && !eFrag.message.includes(KEY.slice(0, 5)) && eFrag.cause === undefined, 'no fragment of the key is kept in the message or as a cause')
  // An error code written as a string still names the status.
  check(replyFailure('openrouter', { error: { code: '429', message: 'slow down' } }, '')?.status === 429
    && replyFailure('openrouter', { error: { code: 'rate_limited', message: 'slow down' } }, '')?.status === 502
    && replyFailure('openrouter', { choices: [{ error: { code: '503', message: 'upstream down' } }] }, '')?.status === 503,
    'a 3-digit string error.code is that status; any other code is 502')
}

// ── 5c. The key as the provider saw it (2026-09-24) ────────────────────────
// A key pasted with a trailing space was saved with it. fetch strips it from
// the header, so the provider authenticates, and echoes, the bare key, which
// scrubbing the padded string never found.
console.log('a key saved with surrounding spaces')
{
  const PADDED = `${KEY} `
  check(cleanApiKey(PADDED) === KEY && cleanApiKey(`\n ${KEY}\t`) === KEY, 'cleanApiKey trims a saved key')
  check(cleanApiKey('   ') === null && cleanApiKey('') === null && cleanApiKey(undefined) === null && cleanApiKey(42) === null, 'cleanApiKey: only spaces, empty or not a string reads as no key')
  check(JSON.stringify(trimApiKeys({ claude: ` ${KEY} `, openai: '', gemini: undefined })) === JSON.stringify({ claude: KEY, openai: '', gemini: undefined }), 'trimApiKeys trims every key and keeps blanks as they were')
  check(scrubKey(`k=${KEY}`, PADDED) === 'k=[api key]' && scrubKey(`k=${PADDED}!`, PADDED) === 'k=[api key]!', 'scrubKey removes the key as saved AND as trimmed')
  check(scrubKey(`k=${KEY}`, ` ${KEY}\n`) === 'k=[api key]', 'scrubKey: leading space and a trailing line break too')
  check(scrubKey('a b', '    ') === 'a b' && scrubKey('x', null) === 'x', 'scrubKey: a blank or missing key scrubs nothing')
  for (const pid of ['mistral', 'openrouter', 'deepseek', 'qwen', 'openai', 'claude', 'gemini']) {
    const e = await errorOf(fakeFetch(401, { error: { message: 'bad key', key: KEY } }), { provider: pid, apiKey: PADDED, model: providerById(pid).models[0].id })
    check(e && !e.message.includes(KEY.slice(3)) && e.message.includes('[api key]'), `${pid}: an error body echoing the TRIMMED key of a padded saved key is scrubbed (${e && e.message.slice(0, 90)})`)
  }
  const eNetPad = await errorOf(async () => { throw new TypeError(`Invalid header value "Bearer ${KEY}"`) }, { provider: 'mistral', apiKey: PADDED, model: 'mistral-small-2603' })
  check(eNetPad && !eNetPad.message.includes(KEY), 'a network error quoting the trimmed key is scrubbed too')
}

// ── 6. The wiring: source and the shipped bundle ────────────────────────────
console.log('wiring')
const llm = src('src/utils/llmClient.js')
check(/import \{ callProvider(, [\w, ]+)? \} from '\.\/providerRequest'/.test(llm), 'llmClient imports callProvider from providerRequest')
check(/callProvider\(resolved, RATER_SYSTEM_PROMPT, buildBatchPrompt\(/.test(llm), 'llmClient scores through callProvider')
check(!/^(async )?function callProvider/m.test(llm), 'llmClient keeps no copy of callProvider')
check(/const apiKey = cleanApiKey\(settings\?\.apiKeys\?\.\[provider\]\)/.test(llm), 'llmClient resolveProvider trims the saved key (cleanApiKey)')
// The Data Analytics page tells a run where the provider ANSWERED every time
// (a refusal, a ceiling spent on thinking) from a transport failure by the
// report it gets BEFORE scoreIdeas throws, plus the thrown error itself: that
// is runScoring's lastError, unchanged, so it carries replyProblem/retryable.
{
  const iReport = llm.indexOf('if (opts.onReport) opts.onReport({ unscored, blank, failedBatches, aborted, stoppedOnReply, lastError })')
  const iThrow = llm.indexOf('if (lastError && unscored === scores.length) throw lastError')
  check(iReport > 0 && iThrow > iReport, 'scoreIdeas reports the run (failedBatches included) BEFORE it throws, and throws lastError itself')
}
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
check((settings.match(/apiKeys: trimApiKeys\(apiKeys\)/g) || []).length === 3 && !/\{ apiKeys \}/.test(settings) && !/^\s*apiKeys,\s*$/m.test(settings), 'AI Settings saves the keys trimmed on every path (Save, Make default, Save Settings)')
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
    ['the reply carried an error', 'a 2xx error body thrown like an HTTP error'],
    ['insufficient_system_resource', 'an empty reply the provider broke off, thrown as 503'],
  ]
  for (const [marker, what] of BUNDLE_MARKERS) check(chunk.includes(marker), `shipped bundle carries ${what} ("${marker}")`)
} else {
  console.log('  (no shipped bundle beside the source — bundle checks skipped)')
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
