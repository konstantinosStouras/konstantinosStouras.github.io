# ORCID on The Lit — setup

Two related, separately-activated features share the one ORCID API client
(client-id `APP-VWG4YW59MEUCRQE2`, registered at
<https://orcid.org/developer-tools>):

1. **Part 1 — "Sign in with ORCID" on the connect stage** (✅ ACTIVE): a
   signed-in Lit user connects their ORCID by authenticating at orcid.org
   instead of copy-pasting their 16-digit iD.
2. **Part 2 — Register / sign in to The Lit WITH ORCID** (✅ ACTIVE — the
   project is on Identity Platform with the `oidc.orcid` OIDC provider
   enabled, and `AUTH_PROVIDERS` lists `'orcid'`): "Continue with ORCID" on
   the sign-in / register modal itself, next to "Continue with Google" — an
   ORCID account *is* the Lit account, and the verified iD is auto-linked to
   the new profile. The console steps below are kept as the record of the
   setup (and for re-doing it on another project).

---

## Part 1 — connect stage (ACTIVE)

Uses ORCID's **OpenID Connect implicit flow**, entirely from the static page —
**no backend, no client secret**. ORCID redirects the browser back to `/lit/`
with the authenticated iD (and, when granted, the name) in the URL fragment;
the page validates a CSRF `state` nonce, saves the iD with
`orcidVerified: true`, and opens "My publications". Manual iD entry (ISO 7064
checksum-validated) remains the permanent fallback.

Configuration (done):

- `ORCID_OAUTH.clientId = 'APP-VWG4YW59MEUCRQE2'` in `lit/index.html` (a
  **public** identifier by design — it appears in every authorize URL).
- The ORCID client lists `https://www.stouras.com/lit/` as a redirect URI
  (exact match, trailing slash included). ORCID requires HTTPS.
- `environment: 'production'`; `redirectUri: ''` (= this page's URL);
  `responseType: 'token'`.

To pause it, set `clientId` back to `'PASTE_ORCID_CLIENT_ID'` — the connect
stage reverts to manual entry only.

## Part 2 — register / sign in with ORCID (Firebase console steps)

The auth modal's provider buttons come from `AUTH_PROVIDERS` +
`PROVIDER_DEFS` in `lit/index.html`. ORCID is wired as the generic Firebase
OIDC provider **`oidc.orcid`** — supported once the Firebase project is
upgraded to **Identity Platform** (Google's superset of Firebase Auth; same
SDK, same users). Do these once:

1. **Upgrade the Firebase project to Identity Platform.** Firebase console →
   project `lit-paper-browser` → **Authentication** → look for the
   *"Upgrade to Firebase Authentication with Identity Platform"* banner (or
   Google Cloud console → *Identity Platform* → enable for the project).
   Existing users, providers and the free e-mail/Google tiers are unchanged.

   **Pricing note:** OIDC providers bill on Identity Platform's SAML/OIDC
   tier — free for roughly the first **50 monthly-active** ORCID-sign-in
   users, then about **$0.015/MAU** (only users who authenticate *via ORCID*
   count; e-mail/Google users don't). Check current pricing when upgrading.

2. **Add the OIDC provider.** Authentication → *Sign-in method* → *Add new
   provider* → **OpenID Connect**, and fill in:

   | Field | Value |
   |---|---|
   | **Grant type** | Code flow |
   | **Name / Provider ID** | `orcid` — the console shows the full id **`oidc.orcid`**; it MUST read exactly that (the page hardcodes it) |
   | **Client ID** | `APP-VWG4YW59MEUCRQE2` |
   | **Issuer (URL)** | `https://orcid.org` |
   | **Client secret** | the client secret shown for this app at <https://orcid.org/developer-tools> |

   The client secret lives ONLY in the Firebase console (server-side token
   exchange) — never in this repo.

3. **Add Firebase's callback URL to the ORCID client.** The console shows the
   provider's redirect/callback URL — for this project:
   `https://lit-paper-browser.firebaseapp.com/__/auth/handler`
   Add it as another **Redirect URI** of the app at
   <https://orcid.org/developer-tools> (keeping the existing
   `https://www.stouras.com/lit/` one — both are needed).

4. **Flip the switch in `lit/index.html`** (repo convention: a provider is
   listed only after it's enabled in the console):

   ```js
   var AUTH_PROVIDERS = ['google', 'orcid'];
   ```

   In the SAME change, per the keep-in-sync discipline: add a
   `lit/changelog.json` entry (id `orcid-register`, dated that day) and extend
   the About page's account bullets to say you can create your Lit account
   with ORCID.

5. **Verify:** open `/lit/` signed out → *Sign in* → **Continue with ORCID**
   → authenticate at orcid.org → you land back signed in; the account menu
   shows **📊 My publications** right away and the profile carries the
   **✓ verified** iD (auto-linked by `maybeSeedOrcidFromProvider`).

### Behaviour details

- **Auto-link on first sign-in:** the OIDC `sub` claim (= the user's
  providerData uid) *is* their ORCID iD. `maybeSeedOrcidFromProvider()` saves
  it to the profile (`orcid`, `orcidLinked: true`, `orcidVerified: true`,
  `orcidPromptSeen: true`) exactly **once per account** — it's gated on
  `!orcid && !orcidPromptSeen`, so a user who later chooses *"Turn off /
  remove ORCID association"* is never re-linked against their will.
- **Match name = ORCID's credit-name (Published Name):** the name journals
  credit an author by is the record's *Published Name*, not given+family
  (which can drop a middle initial and then match no papers at all). Whenever
  a linked profile has no explicit match name, `backfillOrcidAuthorName()`
  fetches `pub.orcid.org/v3.0/<iD>/personal-details` (public, CORS, no auth)
  and saves `credit-name` (falling back to given+family, then to the sign-in
  name claims) as the default `orcidAuthorName` — fill-when-empty only, so a
  name the user typed themselves always wins. Runs after both OAuth link
  paths, after a hand-typed link, and self-heals already-linked profiles when
  the "My publications" modal opens.
- **No e-mail from ORCID:** ORCID's OIDC does not share the account e-mail
  (unless the user made it public), so an ORCID-registered Firebase account
  may have none. The user can add one under *Edit profile* (used e.g. as the
  alerts default). Consequence: an ORCID registration can NOT be
  automatically matched to an existing e-mail/Google account — someone who
  already has a Lit account should link ORCID from the connect stage
  (Part 1) instead of registering afresh.
- `friendly()` already maps `auth/operation-not-allowed` (provider not yet
  enabled in the console) to a clear message, so a premature flip fails
  gracefully — but don't: keep the flip for after the console steps.

## Sandbox dry-run (optional)

Register a client at <https://sandbox.orcid.org/developer-tools>, set
`ORCID_OAUTH.environment = 'sandbox'` (Part 1) or use issuer
`https://sandbox.orcid.org` in the console (Part 2), and test with a
throwaway sandbox ORCID account.

## Security notes

- The connect-stage flow reads the `id_token` payload **without verifying its
  RS256 signature**: the iD only selects which author name the user's own
  private stats are shown under — no privilege or public data is gated on it.
  (Possible hardening: verify against ORCID's JWKS at
  `https://orcid.org/oauth/jwks`.) The register flow (Part 2) doesn't have
  this caveat — Firebase verifies the OIDC tokens server-side.
- No Firestore rules change for either part — all fields live on the existing
  private `users/{uid}/profile/main` doc.
