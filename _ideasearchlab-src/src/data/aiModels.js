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
 * its FIVE newest models, best and most expensive first. The list was rebuilt
 * from the providers' line-ups on that date (release dates in the comments),
 * so an older model that is still served — Claude Opus 4.8 / Haiku 4.5,
 * GPT-5.5 / GPT-5.4, Gemini 2.5 — no longer appears in the dropdowns; a
 * model id already saved under AI Settings keeps working until its provider
 * retires it (the pages show it as "Use default (…)" / the saved id).
 *
 * WHY A MODEL IS CHOSEN AT ALL (owner question, 2026-09-23: "isn't the API
 * attached to a specific model?"): no — an API key belongs to a provider
 * ACCOUNT and unlocks every model that provider serves; the model is named on
 * every request (`model: "…"`), so a key alone does not say which one runs.
 * That is why each page pairs the provider (which key) with a model (which
 * brain, at which price).
 */
export const CATALOGUE_AS_OF = '2026-09-23'

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
    keyPlaceholder: 'AIza...',
    keyLink: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-3.5-flash',
    // Gemini 3.5 Pro was announced at I/O (May 2026) but has no API model id
    // yet; 3.1 Pro (preview) is the only Pro tier the API serves.
    models: [
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview) — deepest reasoning' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash — newest, most capable Flash (Sep 2026)' },
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash (Aug 2026)' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash (Jul 2026)' },
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash (May 2026)' },
    ],
  },
]

// Defaults for the Data Analytics idea-scoring rater. Scoring runs over every
// idea (hundreds of calls), so the default is the cheapest of each provider's
// five — each is still a current-generation model.
export const DEFAULT_SCORING_PROVIDER = 'claude'
export const SCORING_DEFAULT_MODEL = {
  claude: 'claude-sonnet-5',
  openai: 'gpt-6-luna',
  gemini: 'gemini-3.8-flash',
}

export function providerById(id) {
  return PROVIDERS.find(p => p.id === id) || PROVIDERS[0]
}

/** Every model id the catalogue offers, across providers. */
export function allModelIds() {
  return PROVIDERS.flatMap(p => p.models.map(m => m.id))
}

/**
 * Dropdown text for a model: its label plus the price per 1M tokens, so the
 * "best and most expensive first" ordering is visible rather than implied.
 * `prices` is the MODEL_PRICES map from aiPricing.js (passed in, so this data
 * module stays import-free and the guard can test it with a fake table).
 */
export function modelOptionLabel(model, prices) {
  const p = prices?.[model.id]
  if (!p) return model.label
  return `${model.label} · $${fmtPrice(p.in)} in / $${fmtPrice(p.out)} out per 1M tokens`
}

function fmtPrice(n) {
  return Number.isInteger(n) ? String(n) : String(n).replace(/^0\./, '0.')
}
