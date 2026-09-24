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
 * and `list: {in, out}` (the price after it). `priceAt` resolves the price
 * that applies on a given day — the promotional one through `until`, the list
 * one after — so the dropdowns and the cost export never keep charging a
 * lapsed promotion (a reply is costed at the price of ITS day); the guard also
 * fails on the day a promotion lapses, so the row gets re-snapshotted.
 */

export const PRICES_AS_OF = '2026-09-24'
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

  // The four rater-only providers (added 2026-09-24; figures from the providers'
  // pages and price trackers as indexed that week — re-check before a big run).
  // Mistral AI (La Plateforme, EU)
  'mistral-medium-latest': { in: 1.5, out: 7.5 },
  'mistral-large-2512': { in: 0.5, out: 1.5 },
  'mistral-small-2603': { in: 0.15, out: 0.6 },
  'ministral-14b-2512': { in: 0.2, out: 0.2 },
  'ministral-8b-2512': { in: 0.15, out: 0.15 },
  // DeepSeek: the PEAK price (weekdays 01:00–04:00 and 06:00–10:00 UTC); off-peak
  // is half. Costed at peak so an estimate never comes out low.
  'deepseek-v4-pro': { in: 1.32, out: 3.96 },
  'deepseek-flash': { in: 0.3, out: 1.2 },
  // Alibaba Qwen (Model Studio, international / Singapore). Qwen3.7-Max at its
  // list price; a 50% promotion was reported but could not be confirmed.
  'qwen3.8-max': { in: 2, out: 6 },
  'qwen3.7-max': { in: 2.5, out: 7.5 },
  'qwen3.7-plus': { in: 0.4, out: 1.6 },
  'qwen3.8-flash': { in: 0.15, out: 0.45 },
  // Meta, through OpenRouter (Meta's own Llama API closed on 2026-07-06; its new
  // API serves only the closed Muse models). OpenRouter's prices.
  'meta/muse-spark-1.3': { in: 1.25, out: 4.25 },
  'meta/muse-glimmer-30b': { in: 0.3, out: 1.1 },
  'meta-llama/llama-4-maverick': { in: 0.19, out: 0.65 },
}

/** 'YYYY-MM-DD' for a Date, epoch ms, ISO string or Firestore-like {seconds}; today when absent. */
export function dayOf(at) {
  let d = at
  if (d && typeof d === 'object' && typeof d.toDate === 'function') d = d.toDate()
  else if (d && typeof d === 'object' && typeof d.seconds === 'number') d = new Date(d.seconds * 1000)
  else if (typeof d === 'number' || typeof d === 'string') d = new Date(d)
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) d = new Date()
  return d.toISOString().slice(0, 10)
}

/**
 * The price row that applies on day `at` (default today): the promotional
 * `{in, out}` through its `until`, the `list` price after it. Returns the row
 * with `promo: true` while the promotion holds, so a label can say so.
 */
export function priceAt(p, at) {
  if (!p) return null
  if (!p.until) return { in: p.in, out: p.out, promo: false }
  if (dayOf(at) <= p.until) return { in: p.in, out: p.out, promo: true, until: p.until }
  return p.list ? { in: p.list.in, out: p.list.out, promo: false } : { in: p.in, out: p.out, promo: false }
}

// Cost in USD for one AI reply on day `at` (its timestamp; default today);
// null when the model has no confirmed price.
export function replyCostUSD(model, inputTokens, outputTokens, at) {
  const p = priceAt(MODEL_PRICES[model], at)
  if (!p) return null
  return ((inputTokens || 0) * p.in + (outputTokens || 0) * p.out) / 1e6
}
