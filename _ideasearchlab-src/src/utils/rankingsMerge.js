/**
 * rankingsMerge.js
 *
 * One record per idea for the aggregate's Rankings tab, built from the page's
 * rows. Pure (no Firebase), so tools/analytics-page-guard.mjs can test it in Node;
 * sessionExport.js imports Firebase and cannot be loaded there.
 */

/** Key of one idea across loaded sessions: its session and its Idea ID. */
export const ideaKey = (session, id) => `${session ?? ''}\u0000${id ?? ''}`

/**
 * One merged record per idea, for the Rankings tab (review, 2026-09-24). The same
 * idea can be loaded twice (a session from Firestore AND its own export), so the
 * copies are merged column by column, first non-blank value wins: an unscored copy
 * never blanks a scored one. `finish` (the page's recomputeOverall) then rebuilds
 * the derived columns from the merged record, so a mean always is the mean of the
 * model columns printed beside it. Keyed on session + Idea ID, because two
 * sessions number their ideas independently and a bare id would fuse two ideas
 * from different conditions. Returns (sessionCode, ideaId) => record | undefined;
 * a sheet row whose session code finds nothing falls back to its Idea ID only when
 * exactly one loaded idea carries that id.
 */
export function ideaValueLookup(rows, columns, finish = r => r) {
  const blankV = v => v === '' || v == null
  const merged = new Map()
  for (const r of rows || []) {
    const k = ideaKey(r.session, r.idea_id)
    const prev = merged.get(k)
    if (!prev) { merged.set(k, { ...r }); continue }
    for (const c of columns || []) if (blankV(prev[c.key]) && !blankV(r[c.key])) prev[c.key] = r[c.key]
  }
  const done = new Map([...merged].map(([k, r]) => [k, finish(r)]))
  const byId = new Map()   // Idea ID -> record, or null when two ideas share the id
  for (const r of done.values()) {
    const id = String(r.idea_id ?? '')
    byId.set(id, byId.has(id) ? null : r)
  }
  return (session, id) => done.get(ideaKey(session, id)) ?? (byId.get(String(id ?? '')) || undefined)
}
