/**
 * aiModels.js
 *
 * Single source of truth for the AI provider + model catalogue, shared by the
 * AI Settings page (the global per-session assistant config) and the Data
 * Analytics page (the idea-scoring rater). Keep model ids in sync with
 * functions/ai.js MODEL_LABELS and src/data/aiPricing.js — the offline guard
 * `tools/ai-models-guard.mjs` fails when they drift.
 *
 * WHAT IS LISTED, AND IN WHAT ORDER (owner, 2026-09-23): each provider offers
 * FIVE models of its newest generation, most capable first (the first of each
 * provider is also its most expensive; prices are printed beside every
 * option). "Newest" is by generation, not strictly by date: Gemini keeps its
 * only Pro tier, 3.1 Pro (preview), over the later 3.5 Flash-Lite, and OpenAI
 * keeps GPT-5.6 Sol and Terra over the same-day 5.6 Luna. The list was rebuilt
 * from the providers' line-ups on that date (release dates in the comments),
 * so an older model that is still served — Claude Opus 4.8 / Haiku 4.5,
 * GPT-5.5 / GPT-5.4, Gemini 2.5 — no longer appears in the dropdowns. A
 * model id already saved under AI Settings keeps working until its provider
 * retires it, and the AI Settings dropdown shows it as its own "Saved: …
 * (no longer listed)" option — a controlled <select> whose value matches no
 * option would otherwise silently display the first row, "Use default", while
 * the assistant kept running on the saved id and Save re-persisted it.
 * "Best first" is by CAPABILITY, with each model's price printed beside it —
 * the two are not the same ordering (Opus 5.5 is cheaper than the Opus 5 it
 * outperforms; GPT-6 Sol is cheaper than GPT-5.6 Terra), and the first entry
 * of each provider is both its most capable and its most expensive.
 *
 * WHY A MODEL IS CHOSEN AT ALL (owner question, 2026-09-23: "isn't the API
 * attached to a specific model?"): no — an API key belongs to a provider
 * ACCOUNT and unlocks every model that provider serves; the model is named on
 * every request (`model: "…"`), so a key alone does not say which one runs.
 * That is why each page pairs the provider (which key) with a model (which
 * brain, at which price).
 */
export const CATALOGUE_AS_OF = '2026-09-24'

export const PROVIDERS = [
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-ant-...',
    keyLink: 'https://console.anthropic.com',
    // The AI-assistant default lives in functions/ai.js (PROVIDER_DEFAULTS) and
    // is deployed separately, so this mirrors what the deployed function uses.
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 — most capable (Sep 2026)' },
      { id: 'claude-fable-5', label: 'Claude Fable 5 — previous Fable (Jun 2026)' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — Fable-5.1-level at Opus price (Sep 2026)' },
      { id: 'claude-opus-5', label: 'Claude Opus 5 (Jul 2026)' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — best speed/cost balance (Jun 2026)' },
    ],
  },
  {
    id: 'openai',
    name: 'ChatGPT (OpenAI)',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-...',
    keyLink: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-5.5',
    models: [
      { id: 'gpt-6-astra', label: 'GPT-6 Astra — flagship (Sep 2026)' },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol — previous flagship (Jul 2026)' },
      { id: 'gpt-6-sol', label: 'GPT-6 Sol — workhorse (Sep 2026)' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra — mid tier (Jul 2026)' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna — fastest, cheapest (Sep 2026)' },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini (Google)',
    keyLabel: 'API Key',
    keyPlaceholder: 'AQ.… (older keys: AIza…)',
    keyLink: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-3.5-flash',
    // Gemini 3.5 Pro was announced at I/O (May 2026) but has no API model id
    // yet; 3.1 Pro (preview) is the only Pro tier the API serves.
    models: [
      // `short` = the name in a column title ("AI Novelty (Gemini 3.1 Pro Preview)");
      // without it the label's own brackets would nest inside the title's.
      { id: 'gemini-3.1-pro-preview', short: 'Gemini 3.1 Pro Preview', label: 'Gemini 3.1 Pro (preview) — deepest reasoning' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash — newest, most capable Flash (Sep 2026)' },
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (Aug 2026)' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (Jul 2026)' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (May 2026)' },
    ],
  },
  // ── Rater-only providers (owner, 2026-09-24: "Add Mistral, Meta's Llama,
  // DeepSeek and Qwen's top models available") ──────────────────────────────
  // `raterOnly`: offered by the Data Analytics AI rater, whose calls go straight
  // from the admin's browser; NOT by the participants' AI assistant, whose Cloud
  // Function (functions/ai.js callLLM) speaks only Claude / OpenAI / Gemini. All
  // four are OpenAI-compatible (providerRequest.js buildOpenAICompatRequest).
  // `note` is shown under the rater when the provider is chosen: what the key is
  // and where the ideas go, which matters for research data.
  {
    id: 'mistral',
    name: 'Mistral AI',
    raterOnly: true,
    keyLabel: 'API Key',
    keyPlaceholder: 'Mistral API key',
    keyLink: 'https://console.mistral.ai/api-keys',
    note: 'Mistral runs in the EU by default. Paid (Scale) traffic is not used for training; on the free Experiment plan, turn training off under Admin Console → Privacy.',
    defaultModel: 'mistral-small-2603',
    models: [
      // The alias, not the dated id `mistral-medium-2604` (owner 2026-09-24): a
      // pay-as-you-go org's Limits page lists an allowance for `mistral-medium-latest`
      // and none for the dated id, and Mistral answers the latter 429 "rate limited"
      // on every call, so 741 ideas scored nothing.
      { id: 'mistral-medium-latest', short: 'Mistral Medium 3.5', label: 'Mistral Medium 3.5 — most capable (Apr 2026)' },
      { id: 'mistral-large-2512', short: 'Mistral Large 3', label: 'Mistral Large 3 — largest, no reasoning mode (Dec 2025)' },
      { id: 'mistral-small-2603', short: 'Mistral Small 4', label: 'Mistral Small 4 (Mar 2026)' },
      { id: 'ministral-14b-2512', short: 'Ministral 3 14B', label: 'Ministral 3 14B (Dec 2025)' },
      { id: 'ministral-8b-2512', short: 'Ministral 3 8B', label: 'Ministral 3 8B — smallest (Dec 2025)' },
    ],
  },
  {
    // Meta's own Llama API closed on 2026-07-06, and the Meta Model API that
    // replaced it serves only the closed Muse Spark models (US-only, reasoning
    // cannot be switched off). OpenRouter serves Meta's models — Muse and Llama —
    // with one key, from US/EU hosts, and answers browser calls.
    id: 'openrouter',
    name: 'Meta Llama / Muse (via OpenRouter)',
    raterOnly: true,
    keyLabel: 'OpenRouter API Key',
    keyPlaceholder: 'sk-or-…',
    keyLink: 'https://openrouter.ai/keys',
    note: 'Meta no longer runs a Llama API of its own (closed 6 July 2026), so Meta\'s models are reached through OpenRouter with an OpenRouter key and prepaid credits.',
    defaultModel: 'meta-llama/llama-4-maverick',
    models: [
      { id: 'meta/muse-spark-1.3', short: 'Muse Spark 1.3', label: 'Meta Muse Spark 1.3 — Meta\'s newest flagship, closed (Sep 2026)' },
      { id: 'meta/muse-glimmer-30b', short: 'Muse Glimmer 30B', label: 'Meta Muse Glimmer 30B — open weights (Aug 2026)' },
      { id: 'meta-llama/llama-4-maverick', short: 'Llama 4 Maverick', label: 'Meta Llama 4 Maverick — newest Llama (Apr 2025)' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    raterOnly: true,
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-…',
    keyLink: 'https://platform.deepseek.com/api_keys',
    note: 'DeepSeek stores requests on servers in China and has no EU or US region; check that this fits your ethics approval before sending participants\' ideas. Prepaid: top up the balance first. Its API offers these two models only.',
    defaultModel: 'deepseek-flash',
    models: [
      { id: 'deepseek-v4-pro', short: 'DeepSeek V4 Pro', label: 'DeepSeek V4 Pro — flagship (Aug 2026)' },
      { id: 'deepseek-flash', short: 'DeepSeek V4.1 Flash', label: 'DeepSeek V4.1 Flash — fast, cheap (Sep 2026)' },
    ],
  },
  {
    id: 'qwen',
    name: 'Qwen (Alibaba Cloud)',
    raterOnly: true,
    keyLabel: 'API Key (International / Singapore)',
    keyPlaceholder: 'sk-… (Model Studio, International region)',
    keyLink: 'https://modelstudio.console.alibabacloud.com/',
    note: 'Uses Alibaba Cloud Model Studio\'s International (Singapore) endpoint, which runs outside mainland China. The key must be made in that region; a key from another region is refused.',
    defaultModel: 'qwen3.8-flash',
    // Most capable first; Qwen3.7-Max's list price is above Qwen3.8-Max's, the
    // one list here whose first model is not also its most expensive.
    models: [
      { id: 'qwen3.8-max', short: 'Qwen3.8-Max', label: 'Qwen3.8-Max — flagship (Aug 2026)' },
      { id: 'qwen3.7-max', short: 'Qwen3.7-Max', label: 'Qwen3.7-Max (May 2026)' },
      { id: 'qwen3.7-plus', short: 'Qwen3.7-Plus', label: 'Qwen3.7-Plus (Jun 2026)' },
      { id: 'qwen3.8-flash', short: 'Qwen3.8-Flash', label: 'Qwen3.8-Flash — fast, cheap (Aug 2026)' },
    ],
  },
]

/** Providers the participants' AI assistant can use (functions/ai.js speaks these). */
export const ASSISTANT_PROVIDERS = PROVIDERS.filter(p => !p.raterOnly)

// Defaults for the Data Analytics idea-scoring rater: each provider's TOP model,
// the first of its list (owner, 2026-09-24: "for every provider/lab should be
// choosing the top/frontier model as default choice"). It used to be the
// cheapest of the five, since bulk scoring is hundreds of calls; the price is
// printed on every option, so the choice is visible where it is made.
export const DEFAULT_SCORING_PROVIDER = 'claude'
export const SCORING_DEFAULT_MODEL = Object.fromEntries(PROVIDERS.map(p => [p.id, p.models[0].id]))

export function providerById(id) {
  return PROVIDERS.find(p => p.id === id) || PROVIDERS[0]
}

/** Every model id the catalogue offers, across providers. */
export function allModelIds() {
  return PROVIDERS.flatMap(p => p.models.map(m => m.id))
}

/**
 * Dropdown text for a model: its label plus the price per 1M tokens, so the
 * "most capable first" ordering carries its cost rather than implying it.
 * `prices` is the MODEL_PRICES map from aiPricing.js (passed in, so this data
 * module stays import-free and the guard can test it with a fake table); a
 * promotional row prints its expiry while it holds and its list price after
 * (`at` = the day to price for, default today).
 */
export function modelOptionLabel(model, prices, at) {
  const p = prices?.[model.id]
  if (!p) return model.label
  const today = dayString(at)
  const live = p.until && today > p.until && p.list ? p.list : p
  const promo = p.until && today <= p.until ? ` (promotional price until ${p.until})` : ''
  return `${model.label} · $${fmtPrice(live.in)} in / $${fmtPrice(live.out)} out per 1M tokens${promo}`
}

function dayString(at) {
  const d = at instanceof Date ? at : at ? new Date(at) : new Date()
  return (Number.isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10)
}

function fmtPrice(n) {
  return Number.isInteger(n) ? String(n) : String(n).replace(/^0\./, '0.')
}
