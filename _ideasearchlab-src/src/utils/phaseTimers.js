/**
 * Per-STAGE phase timers.
 *
 * Each working phase is played in two stages, and the instructor allocates a
 * separate countdown to each from the admin panel:
 *
 *   individual : idea GENERATION (write ideas)  ->  idea SELECTION (pick the
 *                ones that carry into the group phase)
 *                phaseConfig.individualGenerationDuration / individualSelectionDuration
 *   group      : group IDEATION (add ideas)     ->  group VOTING (pick the
 *                group's ideas)
 *                phaseConfig.groupIdeationDuration / groupVotingDuration
 *
 * Sessions created before the split carry only the single-phase
 * `individualPhaseDuration` / `groupPhaseDuration`. Those keep running
 * UNSPLIT: one countdown spanning both stages which expires straight into the
 * phase's default decision (auto-submit), exactly as before — so a session
 * already in flight never changes behaviour mid-study. `split` tells the pages
 * which regime they are in: they use `first`/`second` for the two stage clocks
 * and `total` wherever the whole phase's budget is displayed.
 *
 * A stage duration of null/blank means "no countdown" (manual) for that stage,
 * exactly like a blank phase timer did before.
 */

export const INDIVIDUAL_TIMER_KEYS = ['individualGenerationDuration', 'individualSelectionDuration']
export const GROUP_TIMER_KEYS = ['groupIdeationDuration', 'groupVotingDuration']

/** A positive whole number of seconds, or null for "no countdown". */
function secs(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

function resolve(pc, [firstKey, secondKey], legacyKey) {
  const cfg = pc || {}
  // Key PRESENCE (not truthiness) marks a session as configured with the
  // split — an admin may deliberately leave one stage on manual (null).
  const split = firstKey in cfg || secondKey in cfg
  if (!split) {
    const legacy = secs(cfg[legacyKey])
    return { split: false, first: legacy, second: null, total: legacy }
  }
  const first = secs(cfg[firstKey])
  const second = secs(cfg[secondKey])
  return { split: true, first, second, total: (first || 0) + (second || 0) || null }
}

/** Individual phase: `{ split, first: generation, second: selection, total }`. */
export function individualTimers(phaseConfig) {
  return resolve(phaseConfig, INDIVIDUAL_TIMER_KEYS, 'individualPhaseDuration')
}

/** Group phase: `{ split, first: ideation, second: voting, total }`. */
export function groupTimers(phaseConfig) {
  return resolve(phaseConfig, GROUP_TIMER_KEYS, 'groupPhaseDuration')
}

/** Whole minutes of a duration in seconds, or null when there is no countdown. */
export function minutesOf(seconds) {
  const s = secs(seconds)
  return s == null ? null : Math.max(1, Math.round(s / 60))
}

/** "12 min" / "45 sec" / "10 min 30 sec" / "Manual" — for admin summaries. */
export function formatDuration(seconds) {
  const s = secs(seconds)
  if (s == null) return 'Manual'
  const m = Math.floor(s / 60)
  const r = s % 60
  if (!m) return `${r} sec`
  return r ? `${m} min ${r} sec` : `${m} min`
}

/**
 * Fill the per-stage keys of a legacy session's phaseConfig so the admin edit
 * form shows real values instead of blanks (saving a blank would silently drop
 * that session's countdown). The phase's old single duration becomes the first
 * stage's, and the second stage falls back to the supplied defaults.
 */
export function migratePhaseTimers(phaseConfig, defaults = {}) {
  const pc = { ...(phaseConfig || {}) }
  const pairs = [
    [INDIVIDUAL_TIMER_KEYS, 'individualPhaseDuration'],
    [GROUP_TIMER_KEYS, 'groupPhaseDuration'],
  ]
  pairs.forEach(([[firstKey, secondKey], legacyKey]) => {
    if (firstKey in pc || secondKey in pc) return // already split
    const legacy = secs(pc[legacyKey])
    pc[firstKey] = legacy ?? defaults[firstKey] ?? null
    pc[secondKey] = defaults[secondKey] ?? null
  })
  return pc
}
