/**
 * aiPricing.js
 *
 * Provider prices in USD per 1 MILLION tokens (input/output), used by the
 * admin Excel export to compute the true AI cost of a session and by the two
 * model dropdowns (AI Settings, Data Analytics) to print each model's price.
 * Snapshot of official provider pricing, September 2026 — update here when
 * prices change. `null` = price not yet confirmed; cost columns stay blank for
 * that model. Every id in src/data/aiModels.js must have a row here
 * (`tools/ai-models-guard.mjs` checks).
 *
 * A time-limited price carries `until: 'YYYY-MM-DD'` (the last day it holds)
 * and `list: {in, out}` (the price after it). The dropdowns print the
 * expiry beside the price, and the guard FAILS once PRICES_AS_OF is later
 * than any row's `until` — so a lapsed promotion cannot keep understating the
 * Excel cost export or the dropdown silently; re-snapshot the row and bump
 * PRICES_AS_OF.
 */

export const PRICES_AS_OF = '2026-09-23'
// Exchange-rate snapshot (same date). Update as needed.
export const USD_TO_EUR = 0.866

export const MODEL_PRICES = {
  // Anthropic (Claude)
  'claude-fable-5-1': { in: 10, out: 50 },
  'claude-fable-5': { in: 10, out: 50 },
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-opus-4-5': { in: 5, out: 25 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-sonnet-4-5': { in: 3, out: 15 },
  'claude-haiku-4-5': { in: 1, out: 5 },
  // legacy IDs that may still be saved in old settings
  'claude-sonnet-4-20250514': { in: 3, out: 15 },
  'claude-opus-4-20250514': { in: 15, out: 75 },

  // OpenAI (ChatGPT)
  'gpt-6-astra': { in: 10, out: 50 },
  'gpt-6-sol': { in: 2, out: 10 },
  'gpt-6-luna': { in: 0.1, out: 0.5 },
  // GPT-5.6 Sol: promotional $4/$20 through at least 2026-11-21 (OpenAI,
  // 2026-08-21), list $5/$30. `gpt-5.6` is an alias of gpt-5.6-sol.
  'gpt-5.6-sol': { in: 4, out: 20, until: '2026-11-21', list: { in: 5, out: 30 } },
  'gpt-5.6': { in: 4, out: 20, until: '2026-11-21', list: { in: 5, out: 30 } },
  'gpt-5.6-terra': { in: 2, out: 12 },
  'gpt-5.6-luna': { in: 0.2, out: 1.2 },
  'gpt-5.5': { in: 5, out: 30 },
  'gpt-5.4': { in: 2.5, out: 15 },
  'gpt-5.4-mini': { in: 0.75, out: 4.5 },
  'gpt-5.4-nano': { in: 0.2, out: 1.25 },
  'gpt-5.2': null, // price not officially confirmed yet
  'gpt-5.1': { in: 1.25, out: 10 },
  'gpt-4.1': { in: 2, out: 8 },
  'gpt-4o': { in: 2.5, out: 10 },

  // Google (Gemini). 3.8/3.7/3.6 Flash carry Google's introductory price
  // ($0.75/$3.75) through 2026-12-31; standard $1.50/$7.50 after it.
  'gemini-3.8-flash': { in: 0.75, out: 3.75, until: '2026-12-31', list: { in: 1.5, out: 7.5 } },
  'gemini-3.7-flash': { in: 0.75, out: 3.75, until: '2026-12-31', list: { in: 1.5, out: 7.5 } },
  'gemini-3.6-flash': { in: 0.75, out: 3.75, until: '2026-12-31', list: { in: 1.5, out: 7.5 } },
  'gemini-3.5-flash': { in: 1.5, out: 9 },
  'gemini-3.5-flash-lite': { in: 0.3, out: 2.5 },
  'gemini-3.1-pro-preview': { in: 2, out: 12 },
  'gemini-3-flash': { in: 0.5, out: 3 },
  'gemini-2.5-pro': { in: 1.25, out: 10 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'gemini-2.5-flash-lite': { in: 0.1, out: 0.4 },
}

// Cost in USD for one AI reply; null when the model has no confirmed price.
export function replyCostUSD(model, inputTokens, outputTokens) {
  const p = MODEL_PRICES[model]
  if (!p) return null
  return ((inputTokens || 0) * p.in + (outputTokens || 0) * p.out) / 1e6
}
