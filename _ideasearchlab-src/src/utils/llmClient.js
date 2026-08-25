/**
 * llmClient.js
 *
 * Browser-side LLM access for the admin Data Analytics page. The admin (and
 * only the admin) can read `settings/ai` — which holds the provider API keys —
 * per the Firestore rules, so the analytics page can score ideas directly from
 * the browser without a Cloud Functions round-trip or redeploy. This mirrors
 * the provider request shapes in functions/ai.js, adapted for direct browser
 * calls (Claude needs the `anthropic-dangerous-direct-browser-access` header).
 *
 * Used to "extend the data" by giving every idea an expert-style rating on the
 * two base KPIs — novelty (1–5) and usefulness (1–5); overall quality is the
 * mean of the two and computed client-side.
 */
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../firebase'
import { runScoring, extractScoreObjects, clamp1to5 } from './scoreBatch'

const PROVIDER_DEFAULTS = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-5.5',
  gemini: 'gemini-3.5-flash',
}

/** Read the admin AI settings (provider, keys, model). Admin-only by rules. */
export async function fetchAISettings() {
  const snap = await getDoc(doc(db, 'settings', 'ai'))
  return snap.exists() ? snap.data() : {}
}

/** Resolve the effective provider / key / model from saved settings. */
export function resolveProvider(settings, providerOverride, modelOverride) {
  const provider = providerOverride || settings?.provider || 'claude'
  const apiKey = settings?.apiKeys?.[provider] || null
  const model = modelOverride || settings?.model || PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.claude
  return { provider, apiKey, model }
}

const RATER_SYSTEM_PROMPT = `You are one of several independent expert evaluators rating ideas produced in a
product-design brainstorming study. You rate each idea on two dimensions using a
1 to 5 Likert scale, where each point means:
  1 = Poor
  2 = Below average
  3 = Average
  4 = Above average
  5 = Excellent

- novelty: how original, innovative and rare the idea is — how far it departs
  from existing knowledge and conventional, obvious solutions.
- usefulness: how practical, effective and valuable the idea is — its feasibility
  and relevance for the problem at hand.

Rate each idea on its own merits. You are blind to which experimental condition
produced it. Use the full range of the scale and be discriminating. Return ONLY
valid JSON — an array with one object per idea, in the same order given, each
{"i": <index>, "novelty": <1-5>, "usefulness": <1-5>}. No prose, no markdown.`

/** Build the user message listing a batch of ideas to rate. */
function buildBatchPrompt(ideas, brief) {
  const lines = ideas.map((t, i) => `${i}. ${oneLine(t)}`).join('\n')
  return (
    (brief ? `Design brief / context: ${brief}\n\n` : '') +
    `Rate the following ${ideas.length} idea(s). Return a JSON array of ` +
    `{"i","novelty","usefulness"} with one entry per idea, indices 0..${ideas.length - 1}.\n\n` +
    lines
  )
}

function oneLine(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 600)
}

/** Tolerant JSON-array extractor (models sometimes wrap output in prose/fences).
 *  Kept as the module's public parser; the recovery rules live in scoreBatch.js
 *  (`extractScoreObjects` also salvages a reply truncated mid-array). */
export function extractJsonArray(text) {
  const objs = extractScoreObjects(text)
  return objs.length ? objs : null
}

/** An error the run should give up on rather than retry: a rejected or missing
 *  API key, or a request the provider refuses outright, fails identically every
 *  time. Everything else (429 rate limits, 5xx, dropped connections) is worth
 *  another go — those are exactly what made a long 435-idea run lose batches. */
function isFatalApiError(err) {
  const s = err?.status
  if (s === 401 || s === 403 || s === 404) return true
  if (s === 400) return true
  return false
}

/** Wrap a non-OK response in an Error that carries its HTTP status. */
async function httpError(label, res) {
  const err = new Error(`${label} API error (${res.status}): ${await res.text()}`)
  err.status = res.status
  return err
}

// ── Provider calls (browser) ──────────────────────────────────────────────────

async function callClaude({ apiKey, model }, system, userText) {
  // Opus 4.7+/Opus 5+/Fable/Mythos reject sampling params; older models accept them.
  const supportsTemperature = !/^claude-(opus-(?:4-(?:[7-9]|\d{2})|[5-9])|fable|mythos)/.test(model || '')
  // 4000, not 1500: a reply cut off by the token limit has no closing "]" and
  // used to lose the WHOLE batch (see scoreBatch.js). The headroom is free —
  // the rater's actual output is a few hundred tokens.
  const body = { model, max_tokens: 4000, system, messages: [{ role: 'user', content: userText }] }
  if (supportsTemperature) body.temperature = 0
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await httpError('Claude', res)
  const data = await res.json()
  return data.content?.find(b => b.type === 'text')?.text || ''
}

async function callOpenAI({ apiKey, model }, system, userText) {
  const isReasoning = /^(gpt-5|o\d)/.test(model || '')
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userText },
    ],
  }
  // A reasoning model spends this budget on hidden reasoning FIRST, so a tight
  // cap can return an empty message and silently lose the batch — hence the
  // generous ceiling here and 4000 for the rest.
  if (isReasoning) body.max_completion_tokens = 8000
  else { body.max_tokens = 4000; body.temperature = 0 }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw await httpError('OpenAI', res)
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

async function callGemini({ apiKey, model }, system, userText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8000, responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw await httpError('Gemini', res)
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || ''
}

function callProvider(resolved, system, userText) {
  switch (resolved.provider) {
    case 'openai': return callOpenAI(resolved, system, userText)
    case 'gemini': return callGemini(resolved, system, userText)
    case 'claude':
    default: return callClaude(resolved, system, userText)
  }
}

/**
 * Score a list of ideas with the configured LLM, in batches.
 *
 * Returns PARTIAL results rather than losing them: a batch the provider or the
 * model fails on leaves those entries null and the run carries on (see
 * scoreBatch.js for the four ways a 435-idea run used to end with empty rows).
 * The caller applies what came back and can simply press Score again to retry
 * the remainder, since the button's scope is "ideas with no score yet".
 *
 * It throws only when the run cannot produce anything: no API key, a fatal
 * provider error (bad key / refused request), or every single batch failing.
 *
 * `opts.onReport` receives what `runScoring` LEARNED about the run —
 * `{ unscored, blank, failedBatches, aborted, lastError }`. That mattered
 * enough to add (owner 2026-08-25): `runScoring` trips a circuit breaker after
 * `maxConsecutiveFailures` failed batches and stops, which is the right call
 * against a dead provider — but this function used to DISCARD the `aborted`
 * flag, so a run that gave up at batch 7 of 55 with 380 ideas never attempted
 * reported exactly like one that merely mishandled four replies. The caller
 * needs the difference to say something true and to decide whether another
 * pass is worth making.
 *
 * @param ideas   array of idea text strings (caller maps rows → text first)
 * @param opts    { provider?, model?, brief?, batchSize?, onProgress?, onReport?, settings? }
 * @returns array (same length/order as ideas) of { novelty, usefulness } | null
 */
export async function scoreIdeas(ideas, opts = {}) {
  const settings = opts.settings || (await fetchAISettings())
  const resolved = resolveProvider(settings, opts.provider, opts.model)
  if (!resolved.apiKey) {
    throw new Error(
      `No API key saved for "${resolved.provider}". Add it under Admin → AI Settings first.`
    )
  }
  const { scores, unscored, blank, failedBatches, aborted, lastError } = await runScoring({
    texts: ideas,
    batchSize: opts.batchSize || 8,
    onProgress: opts.onProgress,
    isFatal: isFatalApiError,
    call: batch => callProvider(resolved, RATER_SYSTEM_PROMPT, buildBatchPrompt(batch, opts.brief)),
  })
  if (opts.onReport) opts.onReport({ unscored, blank, failedBatches, aborted, lastError })
  // Nothing at all came back and we know why: surface it instead of returning a
  // silent array of nulls (the run looked like it "worked" and scored nothing).
  if (lastError && unscored === scores.length) throw lastError
  return scores
}

// Note: the Section 3.1 deterministic KPIs no longer use text embeddings — they
// are computed in the browser with classical TF-IDF (see utils/tfidf.js), so
// there is no embedding API, model download, or billing involved.

export { PROVIDER_DEFAULTS }
