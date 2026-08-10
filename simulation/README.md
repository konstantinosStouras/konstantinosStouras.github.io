# Simulation Platform — `stouras.com/simulation`

One front door for the class simulations hosted on this site. Students
**register once**; the instructor **activates** the simulations for today's
class from an **admin panel**; only active simulations appear to students, as
cards; launching a card asks for the **Session ID** (or ships it
automatically) and hands the student's saved details to the simulation.
**No hosted simulation was modified** — each app keeps working standalone
exactly as before; the platform only *drives* them from the outside.

Vanilla HTML/CSS/JS, no build step, no external CDN (the Firebase SDK is
lazy-imported only when configured). Unlisted (`noindex`) until launch.
Offline test: `node simulation/tools/smoke.mjs` (Playwright; drives the whole
flow against a local static server, no network).

## Files

| File | Role |
|---|---|
| `index.html` | Student page: one-time registration → card grid of active sims → launch dialog |
| `admin/` | Admin panel: activation toggles, pinned Session IDs, embedded per-sim admin consoles, roster |
| `catalog.js` | **The one place that knows each simulation** — launch URL, session mechanism, admin panel, notes |
| `platform.js` | Shared engine: profile store, activation config, launch handoff, optional Firebase backend |
| `prefill.js` | Optional drop-in a simulation can include to auto-fill its own forms from the handoff |
| `config.json` | Committed activation list — what students see while in LOCAL mode |
| `firebase-config.js` | `PASTE_` placeholders → LOCAL mode (same convention as `sustainable-supply-chains/`) |
| `firestore.rules` | Rules for the platform's own Firebase project (when you create one) |

## Two modes

**LOCAL mode (current state — placeholders in `firebase-config.js`):**

- What students see comes from the committed **`config.json`**. To publish a
  change: open `admin/?key=…` (the usual lab maintainer key), toggle sims,
  *Save*, *Download config.json*, commit it at `simulation/config.json`.
  Your own browser applies the draft immediately (so you can preview the
  student page); everyone else sees it after the commit deploys.
- Student registrations stay in each student's browser (localStorage) — they
  still flow into every simulation at launch, but there is no central roster.

**FIREBASE mode (recommended for live class use):** create a free Firebase
project, enable **Anonymous** + **Email/Password** auth and **Firestore**,
deploy `firestore.rules` (keep its `isAdmin()` list in sync with
`SIMP_ADMIN_EMAILS`), create the admin user, paste the web config into
`firebase-config.js` — step-by-step walkthrough in `_FIREBASE-SETUP.md`.
Then:

- Activation toggles are **live**: Save publishes instantly to every student
  (one `simPlatform/config` doc, `onSnapshot` on the student page).
- Registrations are mirrored to `simPlatformStudents/{uid}` (anonymous auth),
  giving the admin panel a **roster with CSV export**. A student's **Log out**
  (header button) clears the browser and signs out the anonymous uid, so on a
  shared machine the next registration gets its own roster doc instead of
  overwriting the previous student's; the roster view collapses duplicate
  re-registrations by student ID (newest kept). The admin panel has its own
  **Sign out**.

## How a launch works

1. The student clicks a card; the dialog asks for the Session ID unless the
   admin pinned one (then it's pre-filled) or the sim doesn't need one.
2. `platform.js` writes the **handoff** — `localStorage['simp:handoff:v1']` =
   `{sim, session, profile, ts}`. Everything on `stouras.com` is same-origin,
   so any simulation can read it.
3. Any per-sim **seeds** are written (e.g. the Knapsack Game's
   `knapsack_session` key, so its submissions become attributable).
4. The sim opens in a new tab at its **launch URL** — query params per
   `catalog.js` (`?code=` auto-join for Sustainable Supply Chains and
   search-v2, `?session=` prefill for PortfolioFit, `?s=` for Answer Arena…).

### Per-simulation integration status

| Simulation | Session ID | Details prefill |
|---|---|---|
| Sustainable Supply Chains | `?code=` — **auto-joins** | in-app firm setup (no demographics) |
| Search w/ & w/o AI (v2) | `?code=` + Prolific-style params — **auto-joins**, student ID rides as `PROLIFIC_PID` | n/a (no demographics form) |
| PortfolioFit (research) | `?session=` pre-fills its welcome screen | add `prefill.js` to fill its registration by label (see below) |
| Answer Arena | `?s=` pre-fills (optional — default config without one) | n/a |
| Ideation Challenge | code copied to clipboard; student pastes on its join screen | copy chips in the dialog; `prefill.js` possible after a rebuild |
| Tetris Challenge | n/a | copy chips (minified React bundle — needs a rebuild for auto-fill) |
| Knapsack Game | optional — baked into the seeded `knapsack_session` | seeded localStorage key |
| Knapsack w/ Dependencies | n/a | impossible (it wipes its own sessionStorage at startup) |
| Newsvendor | n/a | impossible (different origin) — copy chips |
| Problem Solving, Space Exploration, Trust the AI?, Interpolation, Knapsack Calculator, PortfolioFit practice | n/a | n/a (no identity forms) |

### Adopting `prefill.js` in a simulation (optional, one line)

Add to the sim's page (nothing changes when the sim runs standalone —
without a fresh handoff the script is inert):

```html
<script>window.SIMP_EXPECT = 'portfoliofit';</script>  <!-- optional guard -->
<script src="/simulation/prefill.js" defer></script>
```

It fills inputs by explicit `data-simp="studentId|email|name|age|…"`
attributes first, then by **label text** (which is what reaches
PortfolioFit's and ideasearchlab's dynamically built, id-less fields), uses
the native value setter + `input` events so React state updates, only fills
empty fields, and never submits anything. For the Vite-built apps
(ideasearchlab, tetris) add the tag to the app's source `index.html` and
rebuild.

## The admin panel and each simulation's own admin

Creating sessions **with parameters** stays in each simulation's own admin
panel — those panels already encode each game's settings, validation and
backend, and duplicating that in the platform would rot. The platform admin
therefore:

- links and **embeds** each sim's admin console (same-origin iframes:
  Sustainable Supply Chains, search-v2, PortfolioFit `?admin`, Answer Arena
  `?admin`, Ideation Challenge, Problem Solving `?admin`);
- lets you pin the Session ID you just created onto the student card, so
  students launch straight into it.

**Shared credentials:** each Firebase-backed sim authenticates against its
*own* Firebase project, so no true single session exists across them — but if
you register the **same e-mail/password** as the admin user in every project,
it's one credential typed per panel (per browser session). The panel's
credential locker (sessionStorage by default, opt-in localStorage for new
tabs) enables real auto-sign-in for any sim that adopts this snippet in its
admin page, right after its Firebase auth is initialised:

```js
// Simulation Platform SSO (optional): auto-sign-in from the platform's locker.
try {
  var c = JSON.parse(sessionStorage.getItem('simp:admin-creds') ||
                     localStorage.getItem('simp:admin-creds') || 'null');
  if (c && c.email && !auth.currentUser) {
    signInWithEmailAndPassword(auth, c.email, c.pass).catch(function () {});
  }
} catch (e) {}
```

(Embedded consoles share the tab's sessionStorage; consoles opened in a new
tab need the locker's "also for new tabs" option.)

## Adding a simulation

Add one entry to `catalog.js` (path, session mechanism, admin URL, blurb) —
the student cards, the admin table, and the consoles picker all render from
it. Then activate it from the admin panel. Keep the catalog in sync with
what's actually served (CLAUDE.md discipline).
