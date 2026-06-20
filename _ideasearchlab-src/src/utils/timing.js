// Client-side timing collector for the pre-join pages (Welcome, Registration),
// which run BEFORE the participant document exists (it is created on Registration
// submit via joinSession). Marks are stashed in sessionStorage keyed by session,
// then flushed onto the participant doc as `timing.*` when the doc is created.
//
// All values are client epoch milliseconds (Date.now()). Durations are computed
// within this same clock domain (e.g. welcomeAgreedAt − welcomeOpenedAt), so a
// client/server clock offset never affects them.

const keyFor = sessionId => `ideationTiming:${sessionId}`

export function readTiming(sessionId) {
  try {
    return JSON.parse(sessionStorage.getItem(keyFor(sessionId)) || '{}')
  } catch {
    return {}
  }
}

// Record a timing mark. By default only the FIRST call for a field sticks, so
// "opened" reflects the first visit rather than a re-render or a return visit.
// Pass once=false to overwrite (e.g. the moment a button is pressed).
export function markTiming(sessionId, field, once = true) {
  if (!sessionId) return
  try {
    const t = readTiming(sessionId)
    if (once && t[field] != null) return
    t[field] = Date.now()
    sessionStorage.setItem(keyFor(sessionId), JSON.stringify(t))
  } catch {
    /* sessionStorage unavailable — timing is best-effort */
  }
}

export function clearTiming(sessionId) {
  try {
    sessionStorage.removeItem(keyFor(sessionId))
  } catch {
    /* ignore */
  }
}
