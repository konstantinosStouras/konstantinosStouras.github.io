/**
 * providerRequest.js
 *
 * The browser-side request shapes for the three AI providers the Data
 * Analytics rater can score with — Claude (Anthropic), ChatGPT (OpenAI) and
 * Gemini (Google) — and the parsers that turn each reply into plain text.
 *
 * It is split out of `llmClient.js` for the same reason `scoreBatch.js` was:
 * that module imports Firebase and cannot be loaded by an offline guard, and
 * this one holds no Firebase and no bare `fetch` (the caller injects it), so
 * `tools/ai-models-guard.mjs` can drive every request shape and every error
 * path against a fake fetch, with no network and no key.
 *
 * WHY IT EXISTS (found 2026-09-23): `llmClient.js` called a `callProvider`
 * function that was defined NOWHERE — not in the source, not in the shipped
 * bundle (`call:S=>callProvider(…)` as a bare global in the minified chunk). So
 * the "Fill the N missing AI scores" button, with a valid key saved, threw
 * `ReferenceError: callProvider is not defined` on its first batch, for every
 * provider. This file is that function, rebuilt to the shapes documented in
 * CLAUDE.md and mirrored from functions/ai.js, updated for the September-2026
 * model line-up.
 *
 * Request rules, per provider (each pinned by the guard):
 *  - Claude: `POST /v1/messages` with the key in `x-api-key` and the
 *    `anthropic-dangerous-direct-browser-access` header a browser call needs.
 *    NO `temperature`: Opus 4.7+, Opus 5/5.5, Sonnet 5 and the Fable family
 *    return 400 on sampling parameters. Thinking is on by default on every
 *    listed model and counts toward `max_tokens`, so the ceiling is 8000 and
 *    the effort is `low` on models that take it — a 1–5 rating of eight short
 *    ideas is exactly the "simple task" the low setting is for; raising
 *    `SCORING_EFFORT` is the one knob if deeper deliberation is wanted.
 *  - OpenAI: `POST /v1/chat/completions`. The reasoning line (gpt-5*, gpt-6*,
 *    o*) takes `max_completion_tokens` (not `max_tokens`), `reasoning_effort`
 *    and NO temperature; `low` is accepted by every current model (GPT-6 Astra
 *    rejects `none`/`minimal`, which is why the rater never sends those).
 *    Legacy chat models (gpt-4.1, gpt-4o) keep `max_tokens`.
 *  - Gemini: `POST …/models/{model}:generateContent` with the key in the
 *    `x-goog-api-key` HEADER — never in the URL, where it would sit in browser
 *    history, referrers and error text. Gemini 3.x models take
 *    `thinkingConfig.thinkingLevel: "low"` (2.5 models use the older
 *    `thinkingBudget` and reject `thinkingLevel`, so it is gated on the id);
 *    `responseMimeType: application/json` makes the array come back as JSON
 *    rather than prose around it.
 *
 *  - Mistral, DeepSeek, Qwen and Meta-via-OpenRouter (rater-only, added
 *    2026-09-24): one OpenAI-compatible `chat/completions` shape each
 *    (`buildOpenAICompatRequest`), sending ONLY `Authorization` and
 *    `Content-Type` — DeepSeek's and Qwen's CORS preflights allow nothing else —
 *    and no `response_format` (the rater asks for a JSON ARRAY; the providers'
 *    JSON mode forces an OBJECT). Thinking is switched OFF where the provider
 *    allows it, for a cheap and repeatable 1–5 rating: Mistral Medium 3.5 /
 *    Small 4 `reasoning_effort: "none"`, DeepSeek V4 `thinking: {type:
 *    "disabled"}` (it thinks by default), Qwen `enable_thinking: false`
 *    (required on a non-streaming call); Meta's Muse models cannot stop
 *    thinking, so they get OpenRouter's `reasoning: {effort: "low", exclude:
 *    true}` and the 8000-token ceiling. Mistral may return `content` as an
 *    ARRAY of chunks (a thinking chunk, then text) — its text chunks are joined.
 *
 * Errors carry the HTTP `status` (scoreBatch's `isFatalApiError` reads it: a
 * 401/403/400/404 aborts the run at once, a 429/5xx is retried), and the
 * message can never contain the API key — a provider that echoes the key in
 * its error body has it scrubbed before the message is built.
 *
 * A 200 that carries NO rating is an error too, not an empty string: a
 * safety refusal (Claude `stop_reason: "refusal"`, an OpenAI `message.refusal`,
 * a Gemini `blockReason` / SAFETY finish) or a reply whose whole token
 * ceiling went on hidden thinking (`max_tokens` / `length` / `MAX_TOKENS` with
 * no text). Returned as '' they were indistinguishable from an unreadable
 * reply — scoreBatch re-sent every idea of the batch one by one (1 + 16 calls
 * for a deterministic refusal) and the run ended "N unscored" with nothing in
 * `lastError`. Thrown with `replyProblem` set (no HTTP status; a refusal is
 * `retryable: false`), scoreBatch records the cause, does NOT count the batch
 * as a transport failure, and still runs the per-idea round, so one refused
 * idea costs only itself its score, not its seven batch-mates. A reply that
 * was cut off but DID return text is handed back as is — `extractScoreObjects`
 * salvages the complete objects out of a truncated array.
 */

export const SCORING_MAX_TOKENS = 8000
export const LEGACY_CHAT_MAX_TOKENS = 4000
export const SCORING_EFFORT = 'low'

export const PROVIDER_NAMES = {
  claude: 'Claude (Anthropic)',
  openai: 'ChatGPT (OpenAI)',
  gemini: 'Gemini (Google)',
  mistral: 'Mistral AI',
  openrouter: 'OpenRouter (Meta models)',
  deepseek: 'DeepSeek',
  qwen: 'Qwen (Alibaba Cloud)',
}

/** The OpenAI-compatible rater-only providers and their chat-completions endpoint. */
export const OPENAI_COMPAT_URLS = {
  mistral: 'https://api.mistral.ai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
}
export const isOpenAICompat = provider => Object.prototype.hasOwnProperty.call(OPENAI_COMPAT_URLS, provider)

/** Mistral's hybrid models, which take `reasoning_effort` ("none" switches thinking off). */
export function mistralTakesReasoningEffort(model) {
  return /^(mistral-medium-(2604|3-5|latest)|mistral-small-(2603|latest))/.test(model || '')
}
/** Meta's Muse models think on every call (reasoning cannot be turned off). */
export function isMuseModel(model) {
  return /^meta\/muse-/.test(model || '')
}

/** Models that accept `output_config.effort` (Opus 4.5+, Sonnet 4.6+, Fable/Mythos). */
export function claudeSupportsEffort(model) {
  return /^claude-(fable|mythos|opus-(4-[5-9]|4-\d{2}|5)|sonnet-(4-6|5))/.test(model || '')
}

/** OpenAI's reasoning line: `max_completion_tokens` + `reasoning_effort`, no temperature. */
export function openaiIsReasoning(model) {
  return /^(gpt-5|gpt-6|o\d)/.test(model || '')
}

/** Gemini 3.x takes `thinkingLevel`; 2.5 and older take `thinkingBudget` instead. */
export function geminiTakesThinkingLevel(model) {
  return /^gemini-3/.test(model || '')
}

export function buildClaudeRequest({ model, apiKey, system, user }) {
  const body = {
    model,
    max_tokens: SCORING_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: user }],
  }
  if (claudeSupportsEffort(model)) body.output_config = { effort: SCORING_EFFORT }
  return {
    url: 'https://api.anthropic.com/v1/messages',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body,
  }
}

export function buildOpenAIRequest({ model, apiKey, system, user }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  }
  if (openaiIsReasoning(model)) {
    body.max_completion_tokens = SCORING_MAX_TOKENS
    body.reasoning_effort = SCORING_EFFORT
  } else {
    body.max_tokens = LEGACY_CHAT_MAX_TOKENS
  }
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  }
}

export function buildGeminiRequest({ model, apiKey, system, user }) {
  const generationConfig = {
    maxOutputTokens: SCORING_MAX_TOKENS,
    responseMimeType: 'application/json',
  }
  if (geminiTakesThinkingLevel(model)) generationConfig.thinkingConfig = { thinkingLevel: SCORING_EFFORT }
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig,
    },
  }
}

export function buildOpenAICompatRequest(provider, { model, apiKey, system, user }) {
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: LEGACY_CHAT_MAX_TOKENS,
  }
  if (provider === 'mistral' && mistralTakesReasoningEffort(model)) body.reasoning_effort = 'none'
  if (provider === 'deepseek') body.thinking = { type: 'disabled' }
  if (provider === 'qwen') body.enable_thinking = false
  if (provider === 'openrouter' && isMuseModel(model)) {
    body.reasoning = { effort: SCORING_EFFORT, exclude: true }
    body.max_tokens = SCORING_MAX_TOKENS          // thinking counts toward the ceiling
  }
  return {
    url: OPENAI_COMPAT_URLS[provider],
    // Only these two: DeepSeek's and Qwen's CORS preflights refuse any other header.
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body,
  }
}

/** `{ url, headers, body }` for one scoring call, by provider id. */
export function buildRequest(provider, args) {
  switch (provider) {
    case 'claude': return buildClaudeRequest(args)
    case 'openai': return buildOpenAIRequest(args)
    case 'gemini': return buildGeminiRequest(args)
    default:
      if (isOpenAICompat(provider)) return buildOpenAICompatRequest(provider, args)
      throw new Error(`Unknown AI provider: ${provider}`)
  }
}

/** An OpenAI-style `message.content`: a string, or (Mistral, with thinking) an
 *  array of chunks whose TEXT chunks are the reply. */
function chatContentText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(c => c && (c.type === 'text' || c.type == null) && typeof c.text === 'string')
      .map(c => c.text)
      .join('')
  }
  return ''
}

/** The reply's text, by provider — '' when the model returned none. */
export function parseReplyText(provider, data) {
  switch (provider) {
    case 'claude':
      // Newer models may lead with a thinking block — join the text blocks.
      return (data?.content || [])
        .filter(b => b && b.type === 'text' && typeof b.text === 'string')
        .map(b => b.text)
        .join('')
    case 'openai':
      return data?.choices?.[0]?.message?.content || ''
    case 'mistral':
    case 'openrouter':
    case 'deepseek':
    case 'qwen':
      return chatContentText(data?.choices?.[0]?.message?.content)
    case 'gemini':
      // Thought parts are only present when asked for; skip them if they are.
      return (data?.candidates?.[0]?.content?.parts || [])
        .filter(p => p && typeof p.text === 'string' && !p.thought)
        .map(p => p.text)
        .join('')
    default:
      return ''
  }
}

/** Remove the key from any text that is about to become an error message. */
export function scrubKey(text, apiKey) {
  const s = String(text ?? '')
  if (!apiKey || apiKey.length < 6) return s
  return s.split(apiKey).join('[api key]')
}

/**
 * One scoring call: POST the batch to the provider and return the reply text.
 *
 * @param resolved { provider, apiKey, model } from llmClient's resolveProvider
 * @param system   the rater system prompt
 * @param user     the batch prompt
 * @param opts     { fetch? } — injected for the offline guard
 * @returns the model's reply as a string ('' when it returned no text)
 * @throws Error with `.status` = HTTP status on a non-2xx reply; without a
 *         status on a network failure (so scoreBatch retries it)
 */
export async function callProvider(resolved, system, user, opts = {}) {
  const fetchFn = opts.fetch || globalThis.fetch
  const { provider, apiKey, model } = resolved
  const name = PROVIDER_NAMES[provider] || provider
  const req = buildRequest(provider, { model, apiKey, system, user })

  let res
  try {
    res = await fetchFn(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body) })
  } catch (e) {
    // No status: a dropped connection is transient and worth another go.
    const err = new Error(`${name}: could not reach the API — ${scrubKey(e?.message || e, apiKey)}`)
    err.cause = e
    throw err
  }

  if (!res.ok) {
    let detail = ''
    try { detail = await res.text() } catch { /* no body */ }
    const err = new Error(
      `${name} API error ${res.status} for model "${model}": ${scrubKey(detail, apiKey).slice(0, 500) || res.statusText || 'request refused'}`
    )
    err.status = res.status
    throw err
  }

  const data = await res.json()
  const text = parseReplyText(provider, data)
  const problem = replyProblem(provider, data, text)
  if (problem) {
    const err = new Error(`${name} (${model}) ${scrubKey(problem.why, apiKey)}`)
    err.replyProblem = problem.kind          // 'refusal' | 'exhausted'
    err.retryable = problem.kind === 'exhausted'
    throw err
  }
  return text
}

/**
 * Why a 2xx reply still carries no usable rating — null when it is fine, else
 * `{ kind, why }`: `refusal` (the provider declined this CONTENT — repeating
 * the request repeats the answer, so `retryable` is false and scoreBatch goes
 * straight to the per-idea round, where only the refused idea stays empty) or
 * `exhausted` (the ceiling went on hidden thinking — worth another go, since
 * thinking length varies run to run). Pure, so the guard drives every shape.
 */
export function replyProblem(provider, data, text) {
  const empty = !String(text || '').trim()
  const refusal = why => ({ kind: 'refusal', why })
  // No number: the ceiling is 8000 on the thinking models and 4000 elsewhere.
  const exhausted = what => ({ kind: 'exhausted', why: `spent its whole token ceiling on ${what} and returned no text` })
  switch (provider) {
    case 'claude': {
      if (data?.stop_reason === 'refusal') {
        const cat = data?.stop_details?.category
        return refusal(`declined to rate this batch (refusal${cat ? `: ${cat}` : ''})`)
      }
      if (empty && data?.stop_reason === 'max_tokens') return exhausted('thinking')
      return null
    }
    case 'openai':
    case 'mistral':
    case 'openrouter':
    case 'deepseek':
    case 'qwen': {
      const choice = data?.choices?.[0]
      if (choice?.message?.refusal) return refusal(`declined to rate this batch (refusal: ${String(choice.message.refusal).slice(0, 200)})`)
      if (empty && choice?.finish_reason === 'length') return exhausted('reasoning')
      if (empty && choice?.finish_reason === 'content_filter') return refusal('declined to rate this batch (content filter)')
      return null
    }
    case 'gemini': {
      const block = data?.promptFeedback?.blockReason
      if (block) return refusal(`declined to rate this batch (prompt blocked: ${block})`)
      const fin = data?.candidates?.[0]?.finishReason
      if (empty && fin === 'MAX_TOKENS') return exhausted('thinking')
      if (empty && fin && fin !== 'STOP') return refusal(`declined to rate this batch (finish reason ${fin})`)
      return null
    }
    default:
      return null
  }
}
