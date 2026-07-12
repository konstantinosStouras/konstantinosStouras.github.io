// ─────────────────────────────────────────────────────────────────────────────
// Test-mode ("preview") flag.
//
// When the app is opened with ?preview=1&key=<PREVIEW_KEY> it runs the WHOLE
// participant experience against a throwaway, in-browser store — no Firestore
// reads or writes, no Cloud Function calls, no LLM cost, nothing saved anywhere.
// The instructor uses it to rehearse a session end to end without logging any
// data (mirrors lab/search-v2's PREVIEW flag).
//
// The key gate means a stray student who appends ?preview=1 can't accidentally
// land in the sandbox; the instructor's "Test round" button builds the full link.
//
// The value is resolved ONCE and cached: React-Router navigations within the SPA
// drop the query string, so every consumer must read the same locked-in answer
// from the initial URL rather than re-reading location.search later.
// ─────────────────────────────────────────────────────────────────────────────

export const PREVIEW_KEY = 'stouras'

// A fixed session id + participant identity for the sandbox. The instructor
// launches /session/PREVIEW/welcome; the mock store lives entirely under this id.
export const PREVIEW_SESSION_ID = 'PREVIEW'
export const PREVIEW_UID = 'preview-user'
export const PREVIEW_CONFIG_KEY = 'ideasearchlab-preview-config'

let _cached
export function isPreview() {
  if (_cached === undefined) {
    try {
      const p = new URLSearchParams(window.location.search)
      _cached = p.get('preview') === '1' && p.get('key') === PREVIEW_KEY
    } catch (e) {
      _cached = false
    }
  }
  return _cached
}

// Build the launch URL the admin opens in a new tab. Absolute so it survives the
// GitHub-Pages 404 → SPA redirect (which preserves the query string).
export function previewLaunchUrl() {
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base}session/${PREVIEW_SESSION_ID}/welcome?preview=1&key=${PREVIEW_KEY}`
}
