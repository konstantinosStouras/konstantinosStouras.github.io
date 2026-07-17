# "Sign in with ORCID" — setup

Lets a signed-in user connect their ORCID by **authenticating at orcid.org**
(the ORCID sign-in page) instead of copy-pasting their 16-digit iD into the
"Connect your ORCID iD" box. When they come back, their **authenticated** iD is
saved automatically and their "My publications" view opens.

It uses ORCID's **OpenID Connect implicit flow**, so it runs entirely from this
**static** page — **no backend, no client secret**. ORCID redirects the browser
back to `/lit/` with the authenticated iD (and, when the user grants it, their
name) in the URL fragment; the page reads it there.

It is **inert until configured**: with no ORCID client-id set, the connect stage
shows the manual iD entry exactly as before, and the profile modal shows no
sign-in button. Setting it up only **adds** the "Sign in with ORCID" button —
manual entry always remains as a fallback.

---

## One-time setup

1. **Register a PUBLIC ORCID API client.** Sign in at
   <https://orcid.org/developer-tools> (any personal ORCID account can create
   one free) and add an application. You'll get a **client-id** that looks like
   `APP-XXXXXXXXXXXXXXXX`. (There's also a client-secret — you do **not** need
   it here; the implicit flow doesn't use one.)

   - Under **Redirect URIs**, add this page's exact URL:
     `https://www.stouras.com/lit/`
     (ORCID requires HTTPS and an exact match — include the trailing slash. Add
     any other host you serve `/lit/` from too.)
   - To try it first without touching real ORCID accounts, register a client on
     the **ORCID Sandbox** (<https://sandbox.orcid.org/developer-tools>) and set
     `environment: 'sandbox'` below. Sandbox iDs are test-only.

2. **Paste the client-id** into `ORCID_OAUTH` near the top of the accounts
   script in `lit/index.html` (right after `FB_CONFIG` / `AUTH_PROVIDERS`):

   ```js
   var ORCID_OAUTH = {
     clientId: 'APP-XXXXXXXXXXXXXXXX',  // ← your public client-id
     environment: 'production',         // 'production' | 'sandbox'
     redirectUri: '',                   // '' = this page's URL (origin + path)
     responseType: 'token'              // ORCID's implicit flow
   };
   ```

   - `redirectUri` `''` uses `location.origin + location.pathname`, i.e.
     `https://www.stouras.com/lit/`. Set it explicitly only if you serve the app
     from a different path than the URL you registered.
   - Leave `responseType` as `'token'` (ORCID's implicit flow, which returns the
     iD plus an `id_token`). If a future ORCID change needs `token id_token`,
     you can switch it here without touching the code.

3. **Commit & deploy.** That's it — the button appears on the "Connect your
   ORCID iD" stage and in the profile modal.

## How it flows

- The user clicks **Sign in with ORCID** → the page stores a CSRF `state` nonce
  and their consent choice in `sessionStorage` and redirects to
  `https://orcid.org/oauth/authorize?...&response_type=token&scope=openid`.
- The user signs in / authorizes at orcid.org, which redirects back to `/lit/`
  with `#...&orcid=…&name=…&id_token=…&state=…` in the fragment.
- On load, `readOrcidOAuthResponse()` validates the `state`, reads the
  authenticated iD (from the `orcid` param, or the `id_token` JWT's `sub`) and
  name, and cleans the fragment from the address bar. Once the Firebase profile
  snapshot is ready, `maybeApplyOrcidPending()` saves
  `orcid` / `orcidLinked` / `orcidVerified: true` (and seeds `orcidAuthorName`
  from ORCID's name only if the user hasn't set their own), then opens the
  "My publications" view. A connected-via-sign-in iD shows a small
  **✓ verified** marker.

## Notes / security

- The iD only selects **which author name the user's own private stats are
  shown under** — no privilege or public data is gated by it, so this is not a
  security-sensitive credential. The page therefore reads the `id_token`
  payload without verifying its RS256 signature. (A future hardening could
  verify it against ORCID's JWKS at `https://orcid.org/oauth/jwks`.)
- No Firebase / Firestore rule change is needed — the fields live on the
  existing private `users/{uid}/profile/main` doc.
- Nothing about the account is made public; the connection is entirely for the
  user's own "My publications" view.
- The manual iD entry (with the ISO 7064 checksum validation) is untouched and
  remains the fallback whenever a user prefers to type it or ORCID is
  unreachable.
