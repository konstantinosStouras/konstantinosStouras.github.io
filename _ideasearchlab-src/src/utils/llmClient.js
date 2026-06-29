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

/** Tolerant JSON-array extractor (models sometimes wrap output in prose/fences). */
export function extractJsonArray(text) {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
}

// ── Provider calls (browser) ──────────────────────────────────────────────────

async function callClaude({ apiKey, model }, system, userText) {
  // Opus 4.7+/Opus 5+/Fable/Mythos reject sampling params; older models accept them.
  const supportsTemperature = !/^claude-(opus-(?:4-(?:[7-9]|\d{2})|[5-9])|fable|mythos)/.test(model || '')
  const body = { model, max_tokens: 1500, system, messages: [{ role: 'user', content: userText }] }
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
  if (!res.ok) throw new Error(`Claude API error: ${await res.text()}`)
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
  if (isReasoning) body.max_completion_tokens = 2000
  else { body.max_tokens = 1500; body.temperature = 0 }
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`OpenAI API error: ${await res.text()}`)
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
      generationConfig: { temperature: 0, maxOutputTokens: 2000, responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw new Error(`Gemini API error: ${await res.text()}`)
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
 * @param ideas   array of idea text strings (caller maps rows → text first)
 * @param opts    { provider?, model?, brief?, batchSize?, onProgress? }
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
  const batchSize = opts.batchSize || 8
  const results = new Array(ideas.length).fill(null)
  let done = 0
  for (let start = 0; start < ideas.length; start += batchSize) {
    const batch = ideas.slice(start, start + batchSize)
    const userText = buildBatchPrompt(batch, opts.brief)
    let parsed = null
    try {
      const raw = await callProvider(resolved, RATER_SYSTEM_PROMPT, userText)
      parsed = extractJsonArray(raw)
    } catch (err) {
      if (opts.onProgress) opts.onProgress({ done, total: ideas.length, error: err.message })
      throw err
    }
    if (Array.isArray(parsed)) {
      parsed.forEach((item, pos) => {
        // Prefer the explicit index the model echoes; fall back to array position
        // if it omits `i` or returns a 1-based / out-of-range index.
        let idx = Number(item.i)
        if (!Number.isInteger(idx) || idx < 0 || idx >= batch.length) idx = pos
        if (idx >= 0 && idx < batch.length) {
          results[start + idx] = {
            novelty: clamp1to5(item.novelty),
            usefulness: clamp1to5(item.usefulness),
          }
        }
      })
    }
    done += batch.length
    if (opts.onProgress) opts.onProgress({ done, total: ideas.length })
  }
  return results
}

function clamp1to5(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(1, Math.min(5, Math.round(n * 10) / 10))
}

export { PROVIDER_DEFAULTS }
