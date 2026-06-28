/**
 * aiModels.js
 *
 * Single source of truth for the AI provider + model catalogue, shared by the
 * AI Settings page (the global per-session assistant config) and the Data
 * Analytics page (the idea-scoring rater). Keep model ids in sync with
 * functions/ai.js MODEL_LABELS and src/data/aiPricing.js.
 */
export const PROVIDERS = [
  {
    id: 'claude',
    name: 'Claude (Anthropic)',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-ant-...',
    keyLink: 'https://console.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable Opus (recommended)' },
      { id: 'claude-fable-5', label: 'Claude Fable 5 — frontier model (premium pricing)' },
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 — best speed/cost balance' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 — fastest, most cost-effective' },
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5 (older)' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (older)' },
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
      { id: 'gpt-5.5', label: 'GPT-5.5 — flagship (recommended)' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini — fast, cost-efficient' },
      { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano — fastest, cheapest' },
      { id: 'gpt-5.2', label: 'GPT-5.2 — previous flagship' },
      { id: 'gpt-5.1', label: 'GPT-5.1' },
      { id: 'gpt-4.1', label: 'GPT-4.1 (older)' },
      { id: 'gpt-4o', label: 'GPT-4o (legacy)' },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini (Google)',
    keyLabel: 'API Key',
    keyPlaceholder: 'AIza...',
    keyLink: 'https://aistudio.google.com/app/apikey',
    defaultModel: 'gemini-3.5-flash',
    models: [
      { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash — latest GA (recommended)' },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview) — deepest reasoning' },
      { id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
    ],
  },
]

// Defaults for the Data Analytics idea-scoring rater. Scoring runs over every
// idea, so the default leans fast/cheap — Haiku for Claude.
export const DEFAULT_SCORING_PROVIDER = 'claude'
export const SCORING_DEFAULT_MODEL = {
  claude: 'claude-haiku-4-5',
  openai: 'gpt-5.4-mini',
  gemini: 'gemini-3.5-flash',
}

export function providerById(id) {
  return PROVIDERS.find(p => p.id === id) || PROVIDERS[0]
}
