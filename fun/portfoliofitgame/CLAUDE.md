# CLAUDE.md — PortfolioFit for Managers

Context file for an LLM. Paste/point an assistant at this to understand how the
**PortfolioFit** research-experiment app is designed, so a similar app can be
built. It explains the *philosophy* and the *structure*, not just the code.

- **Live (public, anonymous flow — now the default):** https://www.stouras.com/fun/portfoliofitgame/
- **Live (join a session):** https://www.stouras.com/fun/portfoliofitgame/?session=CODE
- **Live (original plain game):** https://www.stouras.com/fun/portfoliofitgame/?classic
- **Live (admin):** https://www.stouras.com/fun/portfoliofitgame/?admin
- **Repo:** github.com/konstantinosStouras/konstantinosStouras.github.io → `fun/portfoliofitgame/`
- **Backend (not web-served):** repo root `_portfoliofit-firebase/`

> **This folder is a preserved copy of the original `lab/portfoliofit/` app.** It is
> a verbatim snapshot (only the canonical / Open-Graph / share URLs were repointed
> to this path) that keeps the **current** version live at
> `stouras.com/fun/portfoliofitgame/`. It still talks to the **same**
> `stouras-portfoliofit` Firebase project as the original did. The original
> `lab/portfoliofit/` is being repointed to a separate Firestore project for
> ongoing edits — see `_portfoliofit-firebase/SWITCH-LAB-TO-NEW-PROJECT.md`.

---

## 1. What it is

PortfolioFit is a management-training game framed as the **knapsack / bin-packing
problem**: each brick is a *project* with a dollar value; you pack projects into a
frame to maximise **net value** = (value of placed bricks) − ($1 penalty per empty
cell), before a timer ends. The deceptive part: the highest value-per-cell bricks
are traps, so a greedy player is reliably sub-optimal (this is measured as a
"Sahni number" κ — the fewest hand-placed hints a ratio-greedy needs to finish).

On top of this single-player game sits a **research-experiment platform**: a
multi-phase flow (welcome → training → main → stats → thank-you),
backed by Firebase, with detailed per-action logging and an admin CMS. Players
are **fully anonymous** (Firebase Anonymous Auth, no sign-up) and may join a
specific admin-created configuration via a **session-code deep link**
(`?session=CODE`). The participant flow no longer includes a post-game survey,
the welcome screen no longer shows a session-code input (deep links still work),
and the in-game "My Notes" pad was removed; the survey config, admin Survey tab,
and `submitSurvey` backend remain in place but are not presented to players.

## 2. Design philosophy (the important part)

1. **Extend a working artifact in place; do not rewrite.** The game already
   existed as one hand-written, no-build `index.html` (the repo serves static
   files via GitHub Pages with no build step). Rather than port it to React, the
   experiment + admin were **layered on top** as separate plain-JS files. This
   keeps the proven game intact and matches the repo's "served as-is" convention.

2. **A thin bridge between the game and everything else.** The game exposes a
   small, stable global API, `window.PFGame` (start/load a puzzle, pause/resume
   the timer, read metrics/placements, run a scripted demo, an `_onRoundEnd`
   callback). The experiment and admin drive the game **only** through this
   bridge; they never reach into game internals. The game emits user actions
   through a single hook, `window.PF.onGameEvent(type, payload)`.

3. **Feature-flag the new flow, then flip the default.** The anonymous research
   flow is now the **default** at the bare URL (`window.PF_EXPERIMENT`, true
   unless `?admin` or `?classic`). `?classic` shows the original plain game and
   `?admin` opens the CMS. If Firebase is unreachable or Anonymous Auth is
   disabled, the layer degrades to OFFLINE mode (the default game still plays,
   just unsaved), so production never hard-fails.

4. **One source of truth for content.** `pf-defaults.js` defines all built-in
   text, settings, registration/survey questions, and the default puzzle set on
   `window.PF_DEFAULTS`. Both the participant app and the admin's "Restore
   built-in default" read it, so defaults never drift.

5. **Client-first backend, minimal server.** Firestore + Auth do almost
   everything, guarded by security rules (admin = the signed-in `admin@admin.com`
   email). Cloud Functions are used **only** where atomicity/secrecy matters
   (sequential anonymous labels, idempotent survey submit). Excel export and
   puzzle generation are client-side.

6. **Research integrity.** Every meaningful action is logged as one event doc;
   per-round summaries are stored separately; participants are shown an
   **anonymous label** (`p1, p2…`) and are **never shown the optimum** (the κ
   badge, "best possible", personal-best pill, and reveal-y nudges are hidden in
   experiment mode).

7. **Admin CMS mirrors a familiar tool.** The panel deliberately matches the
   look/behaviour of the sibling `ideasearchlab` admin (dark theme, collapsible
   editors, the trio of buttons) but is implemented in vanilla JS.

## 3. File / module structure

Served app (`fun/portfoliofitgame/`):

| File | Role |
| --- | --- |
| `index.html` | The whole **game**: markup + CSS + the game engine (an IIFE). Also hosts the shared "snake" Account login widget and a localStorage `AppStats` block (legacy). Exposes `window.PFGame`, emits events via `window.PF.onGameEvent`, and reads the `window.PF_EXPERIMENT` / `window.PF_ADMIN` flags set by a tiny inline script. Loads the three layer scripts (deferred). |
| `pf-defaults.js` | Sets `window.PF_DEFAULTS` = `{ texts, settings, registrationQuestions, surveyQuestions, defaultPuzzles }`. Loaded **before** the other two. |
| `experiment.js` | The **participant experiment** layer. Activates only on `?exp=1`. Phase state machine, Firebase (named app), anonymous auth, event logging, per-round summaries, onboarding tour, movable/resizable boxes. |
| `admin.js` | The **admin CMS**. Activates only on `?admin`. Login gate, content/settings/puzzle editors, participants table (+ per-row delete, **Delete all participants**, Excel export), sessions, theme. |
| `404.html` | Redirects to `/`. |
| `og-image.jpg`, `portfoliofit-difficulty.pdf`, `portfoliofit-difficulty.makepdf.py` | Social card + the κ methodology note (PDF + its generator). |

Backend (`_portfoliofit-firebase/`, underscore-prefixed so Jekyll does **not**
publish it; versioned in the repo, deployed manually):

| File | Role |
| --- | --- |
| `firestore.rules` | Security rules (admin = `admin@admin.com`). |
| `firestore.indexes.json` | Composite indexes. |
| `functions/index.js` | `registerParticipant` + `submitSurvey` (Firebase Functions **v1**, `europe-west1`). |
| `firebase.json`, `.firebaserc`, `README.md` | Deploy config + steps. |

## 4. The game engine (`index.html` IIFE) — what to reproduce

- **Pieces:** a fixed library of 8 polyominoes (one tromino, three tetrominoes,
  four pentominoes), each with a dollar value tuned so the eight value-per-cell
  ratios are distinct and deceptive.
- **Puzzle generation:** pick a random subset whose areas sum to the target
  outline (14 cells "easy", 18 "hard") and place them by randomized
  backtracking → a guaranteed-solvable outline (`region`). Then **evaluate**:
  enumerate all exact-cover tilings (bitmask DLX-style), compute the max-value
  cover (`bestValue`), how many covers attain it (must be unique), and the
  Sahni κ via a ratio-greedy completion test. Accept "easy" when κ∈{1,2},
  "hard" when κ≥3, with ≥3 distinct covers and a unique optimum.
- **KPIs (live):** Net Value, Total Value, Resource Cost (empty-cell penalty),
  Value/Resource (ROI), Coverage %, Portfolio Fitness (net ÷ best). Hover
  tooltips explain each.
- **Tools:** a calculator. **Nudges:** encouraging/idle/time
  messages below the board (idle threshold ~15s).
- **Round lifecycle:** `newGame(diff,limit)` → `startRound()` builds `state`,
  renders, starts the timer; the round ends on the deadline (not on completion),
  calling `endRound()` → `showEnd()` (end modal suppressed in experiment mode) →
  the `PFGame._onRoundEnd(metrics)` callback.
- **`window.PFGame` bridge (the contract):**
  `newGame(diff,limit)`, `loadPuzzle(spec,limit)`, `generatePuzzle(diff)` (returns
  a serializable spec), `previewPuzzle(spec)` (load without a timer),
  `pauseTimer()/resumeTimer()`, `endRound()`, `getMetrics()`, `getPlacements()`,
  `showSolutions()/showProof()`, `demoSelectSolution/demoCycleOri/demoPlaceSolution/
  demoRemoveSolution/demoClear` (for the scripted tour), and a writable
  `_onRoundEnd` callback. A puzzle **spec** = `{diff, rows, cols, region:["r,c",…],
  solution:[{name,color,cells:[[r,c]…]}], kappa, tilings:{count}, bestValue}`.

## 5. The experiment layer (`experiment.js`)

- **Activation:** returns immediately unless `window.PF_EXPERIMENT` (now the
  default; off only for `?admin`/`?classic`). Adds class `pf-exp` to `<body>`
  and hides research artifacts via CSS (the κ "difficulty" badge, the PDF-note
  footer, the legacy account widget, and the "Best $" pill).
- **Phase machine:** `welcome → training → main → stats → thankyou`
  (no registration or survey phase). Each screen is an overlay card; `S` holds the
  live state (including `S.sessionId` and `S.offline`).
- **Onboarding tour (before training):** an iPhone-style spotlight tour over the
  live board (intro → board → bricks → a **scripted gameplay demo** that places/
  rotates/removes solution bricks while KPIs update → net value → KPIs (with each
  KPI explained) → calculator → nudges → "boxes are draggable/resizable"
  → the green submit button). The clock is paused during the tour. Repositions on
  scroll/resize for mobile.
- **Auth:** a **named** Firebase app `'portfoliofit'` (so it coexists with the
  page's default `stouras-snake` app instead of colliding). Players sign in with
  **Anonymous Auth** on the welcome screen — **no** e-mail/password/registration.
  The welcome screen no longer shows a session-code input, but a player can still
  join a specific session via a **deep link** (`?session=CODE`); a valid code
  loads `sessions/{code}`, otherwise the default config is used. Each player gets
  a `participants/{uid}` doc (created client-side) tagged with `sessionId` and a
  short `anonymousLabel`. Returning players resume via their persisted anonymous
  identity.
- **Top bar:** a fixed bar shows the play status plus an **Admin** button (opens
  `?admin`, itself gated behind the admin login) and a **Restart** button (fresh
  anonymous session).
- **Main phase puzzle source:** if the admin has **frozen** a set
  (`config.settings.activePuzzleIds` → `puzzleSets`), every player plays **exactly
  those** puzzles — the same reviewed, vetted set for everyone, with only the order
  shuffled per participant; nothing is generated invisibly per player and the
  `puzzlesPerUser` counts are not consulted. If **no** set is frozen, each player
  plays the built-in `defaultPuzzles` limited to the `puzzlesPerUser` counts
  (default 2 easy + 2 hard) — again identical for everyone, only the order
  randomized; if a count exceeds the built-in pool the admin is prompted to
  generate & freeze a fuller reviewed set (so extras are never created silently per
  player). To serve more than the built-in defaults, the admin builds a frozen set
  on the Puzzles tab (generate → review/regenerate → freeze), with "Generate set to
  match Settings" sizing it to the counts. The Puzzles tab's "Current active set"
  mirrors what each player will see. Order is shuffled per participant and persisted
  (`puzzleOrder` + `mainIndex`) so a mid-session reload resumes the same queue.
- **Event logging:** one buffered, retry-on-failure writer appends a doc per
  action to `participants/{uid}/events` (place/move/rotate/flip/remove/calc/
  round-start/round-end/stats). Nested arrays (cells/placements) are
  JSON-stringified (Firestore rejects nested arrays). Per-round summaries go to
  `participants/{uid}/rounds`.
- **Stats → thank-you:** aggregate the rounds (totals, coverage, time), show them
  on the stats card, then a "Finish" button advances straight to the thank-you
  screen (the post-game survey phase was removed; the participant `status` goes to
  `done` at the stats screen).
- **Movable/resizable boxes (during play only, `pf-playing`):** drag a box by its
  body (cursor "move") to reposition (CSS `transform`, with **no-overlap**
  collision), and resize from any **border/corner** (cursor changes; wide hit
  zones). Layout persists in `localStorage`; a "Reset layout" button restores it.
- **Privacy:** nudges never reveal the maximum/optimal in experiment mode.

## 6. The admin panel (`admin.js`)

- **Activation:** `?admin`; requires the `admin@admin.com` account. Caches the
  admin auth so a refresh shows the panel immediately (no login flash). Dark/
  light theme.
- **Tabs:**
  - **Content** — collapsible per-page text editors (welcome/training/game/stats/
    thank-you), each pre-filled with the current effective text. (The Registration
    and Survey page editors and their dedicated **Registration**/**Survey** tabs
    were removed along with those participant phases.)
  - **Puzzles** — build the exact set every participant plays: **Generate set to
    match Settings** creates puzzles sized to the easy/hard counts (reusing vetted
    built-ins first, generating the shortfall), or generate one at a time via
    `PFGame.generatePuzzle`; review each (κ analysis via
    `PFGame.previewPuzzle`+`showSolutions`/`showProof`), **regenerate** any you
    dislike, then **freeze** (writes `puzzleSets` + sets
    `config.settings.activePuzzleIds`) so every participant replays that frozen set.
    "Current active set" shows the frozen puzzles (or, if none frozen, the built-in
    set sized to the counts).
  - **Settings** — easy/hard puzzle counts, per-puzzle time limits, randomize-order.
  - **Sessions** — create a **session** (a snapshot of the *current*
    configuration: texts, questions, settings, active puzzle set) under a
    **Session name** + optional **Session ID** (typed or auto-generated 3–40
    char code), written to `sessions/{code}` with `status:'open'`. Lists sessions
    (Session ID / Name / Status / **Participants** count / Created) with **copy
    ID**, **close**/**reopen** (`status` toggles; closing blocks *new* joins —
    enforced in `experiment.js` `beginSession`), and **delete**. Players join by
    code; data is tagged with `sessionId`.
  - **Participants** — table of all players (Player / Session / Status / Started),
    per-row **delete** (doc + subcollections), a **Delete all participants** button
    (double-confirmed bulk wipe of every participant + subcollections), and
    **Export to Excel** (SheetJS via CDN; sheets: Participants / Events / Rounds /
    Survey, each carrying `player` + `session` + `uid`).
- Every editable tab carries the same three controls: **Save** and **Make this
  the default** (both persist this page to `config/app`; one live config, so they
  do the same write with different wording) and **Restore built-in default**
  (revert to `PF_DEFAULTS`). Each uses `withFeedback` so the button itself
  confirms — it presses, shows "Saving…", then flashes green "✓ Saved".

## 7. Firebase backend

- **Project:** `stouras-portfoliofit`, region `europe-west1`, **separate** from
  the shared `stouras-snake` account. **Blaze** plan (Cloud Functions). Admin
  account `admin@admin.com`; players use **Anonymous Auth** (enable it in the
  console — see the backend README). The web config is public (ships in the
  client JS).
- **Firestore data model:**
  ```
  config/app                      texts, settings (timeLimits, puzzlesPerUser,
                                  randomizeOrder, activePuzzleIds),
                                  registrationQuestions, surveyQuestions
  sessions/{code}                 admin config snapshot players join by code
                                  (label, texts, settings, questions)
  puzzleSets/{id}                 frozen approved puzzles (diff, kappa, bestValue,
                                  cells, specJson)            ← admin-managed library
  counters/participants           { count }  legacy label source (unused anon flow)
  participants/{uid}              uid = anonymous-auth uid; anonymous:true,
                                  anonymousLabel, sessionId, status,
                                  puzzleOrder[], mainIndex
    events/{autoId}               one doc per action (type + dataJson + context)
    rounds/{autoId}               per-round summary (net/coverage/fitness/time…)
    survey/answers                { answers, completedAt }
  ```
- **Cloud Functions (v1, europe-west1):** `registerParticipant` (atomically
  creates the participant doc and assigns the next `p{n}` label via a
  `counters/participants` transaction; idempotent on rejoin) and `submitSurvey`
  (idempotent, stamps `status:'done'`).
- **Security rules:** admin = `request.auth.token.email == 'admin@admin.com'`.
  `config` + `sessions` + `puzzleSets`: signed-in read (anonymous players count
  as signed-in), admin write. `counters`: functions only. `participants` +
  subcollections: owner or admin read; the (anonymous) owner creates their own
  participant doc + events/rounds/survey; admin can delete.

## 8. Deployment

- **Front end:** pure static files on GitHub Pages from `master`. **No build
  step** — commit and it's live at `stouras.com/fun/portfoliofitgame/`.
- **Backend:** from `_portfoliofit-firebase/`:
  ```
  firebase use stouras-portfoliofit
  cd functions && npm install && cd ..
  firebase deploy --only firestore:rules,firestore:indexes,functions
  ```
  (Functions need Blaze; the default compute service account needs the Cloud
  Build / Storage Object Viewer / Artifact Registry roles for the first deploy.)

## 9. Gotchas worth carrying into a new build

- Use a **named** Firebase app if another default app already lives on the page.
- **Firestore rejects nested arrays** — JSON-stringify anything like cell lists.
- Let `onAuthStateChanged` (not an eager call) drive routing to avoid a login
  flash; optionally cache "was admin" to render instantly on refresh.
- Keep built-in content in **one** module that both the app and the admin's
  "restore default" consume.
- Drive the game from the **experiment/admin only via the `PFGame` bridge**;
  emit user actions through **one** hook — this is what makes logging, the tour,
  and the admin puzzle tools possible without entangling the game.
- For a research build, decide up front what to **hide from participants**
  (optimum, personal bests, difficulty internals) and gate it behind the
  experiment flag so the public game keeps its full feedback.
