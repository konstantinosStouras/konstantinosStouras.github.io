/**
 * joinLink.js — the participant JOIN LINK, in one place.
 *
 * The admin's session cards have a **Copy link** button (mirroring the Answer
 * Arena admin): it copies a URL that opens the join page with the session code
 * already filled in, so an instructor can paste it into a class chat instead of
 * dictating the code.
 *
 * Both ends of that link live here so they cannot drift — `joinLinkFor()` builds
 * it (Admin.jsx) and `joinCodeFromSearch()` reads it back (JoinSession.jsx).
 *
 * Two deliberate choices:
 *  - The link points at the app ROOT with the code on the query string
 *    (`/lab/ideasearchlab/?code=BALI`), NOT at `/join`. The root is a real file
 *    on GitHub Pages, so the link never depends on the SPA 404 fallback; App.jsx
 *    carries the query through on the "/" → "/join" redirect.
 *  - It only PRE-FILLS the field — it never auto-joins. The student sees which
 *    session they are entering, and a stale link fails on the normal form rather
 *    than dead-ending. (The Simulation-Platform handoff is the one silent path,
 *    and its code stays hidden because the instructor never handed it out.)
 */

/** Normalise a code the way the join form and the admin's create form do. */
export function normalizeJoinCode(raw) {
  // NFKC first: a code pasted out of a slide, a PDF or a phone keyboard can
  // arrive in full-width forms (SGP１) that the [^A-Z0-9] strip would silently
  // delete, turning a correct code into a "Session not found".
  let s = String(raw ?? '')
  try { s = s.normalize('NFKC') } catch (e) { /* pre-ES6 engine: use as-is */ }
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40)
}

/**
 * Read the session code out of a join link's query string. Accepts `?code=`
 * and `?s=` (Answer Arena's spelling, so a link in either shape works).
 * Returns '' when there is none.
 */
export function joinCodeFromSearch(search) {
  try {
    const q = new URLSearchParams(search || '')
    return normalizeJoinCode(q.get('code') || q.get('s') || '')
  } catch {
    return ''
  }
}

/**
 * Build the shareable join link. `origin` is e.g. 'https://www.stouras.com' and
 * `base` the app's base path (Vite's BASE_URL, '/lab/ideasearchlab/').
 */
export function joinLinkFor(origin, base, code) {
  const b = String(base || '/')
  return `${origin}${b.endsWith('/') ? b : b + '/'}?code=${encodeURIComponent(normalizeJoinCode(code))}`
}
