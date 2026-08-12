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

// The answer is also STICKY FOR THE TAB (sessionStorage — exactly the sandbox's
// lifetime). Caching it in a module variable survives SPA navigations but not a
// RELOAD: after F5 the query string is long gone, `isPreview()` flipped to
// false, and the app quietly left the sandbox — dropping the "nothing is saved"
// ribbon and starting to talk to the REAL Firebase project (minting a genuine
// throwaway Auth account and looking up a session literally called "PREVIEW",
// which dead-ends on the login screen). A test round must stay a test round
// until the tab is closed.
const PREVIEW_STICKY_KEY = 'ideasearchlab-preview-mode'

let _cached
export function isPreview() {
  if (_cached === undefined) {
    let fromUrl = false
    try {
      const p = new URLSearchParams(window.location.search)
      fromUrl = p.get('preview') === '1' && p.get('key') === PREVIEW_KEY
    } catch (e) {
      fromUrl = false
    }
    let sticky = false
    try {
      if (fromUrl) sessionStorage.setItem(PREVIEW_STICKY_KEY, '1')
      else sticky = sessionStorage.getItem(PREVIEW_STICKY_KEY) === '1'
    } catch (e) {
      /* sessionStorage unavailable — fall back to the URL alone */
    }
    _cached = fromUrl || sticky
  }
  return _cached
}

// Build the launch URL the admin opens in a new tab. Absolute so it survives the
// GitHub-Pages 404 → SPA redirect (which preserves the query string).
export function previewLaunchUrl() {
  const base = import.meta.env.BASE_URL || '/'
  return `${window.location.origin}${base}session/${PREVIEW_SESSION_ID}/welcome?preview=1&key=${PREVIEW_KEY}`
}
