# CLAUDE.md — PortfolioFit for Managers

Context file for an LLM. Paste/point an assistant at this to understand how the
**PortfolioFit** research-experiment app is designed, so a similar app can be
built. It explains the *philosophy* and the *structure*, not just the code.

- **Live (session-gated research flow — the default):** https://www.stouras.com/lab/portfoliofit/
- **Live (join a session directly):** https://www.stouras.com/lab/portfoliofit/?session=CODE
- **Live (original plain game):** https://www.stouras.com/lab/portfoliofit/?classic
- **Live (admin):** https://www.stouras.com/lab/portfoliofit/?admin
- **Repo:** github.com/konstantinosStouras/konstantinosStouras.github.io → `lab/portfoliofit/`
- **Backend (not web-served):** repo root `_portfoliofit-lab-firebase/`

> **This is the DEV / research copy, on its own Firebase project.** It has
> **intentionally diverged** from the public production copy at `fun/portfoliofitgame/`:
> this lab copy is now a **session-gated research build** — there is **NO anonymous
> play**. To take part a visitor MUST enter a session code matching an **active
> (open)** admin-created session, and after the training phase they complete a
> **Registration** form (compulsory **UCD Student ID** + demographics) before the
> main game. The production copy at `fun/portfoliofitgame/` keeps the original
> **fully anonymous** flow (optional session code) and **must not be repointed** —
> it talks to `stouras-portfoliofit` (see
> `_portfoliofit-firebase/SWITCH-LAB-TO-NEW-PROJECT.md`); this copy uses its own
> `stouras-portfoliofit-86127` project so research data never touches production.

---

## 1. What it is

PortfolioFit is a management-training game framed as the **knapsack / bin-packing
problem**: each brick is a *project* with a dollar value; you pack projects into a
frame to maximise **net value** = (value of placed bricks) − ($1 penalty per empty
cell), before a timer ends. The deceptive part: the highest value-per-cell bricks
are traps, so a greedy player is reliably sub-optimal (this is measured as a
"Sahni number" κ — the fewest hand-placed hints a ratio-greedy needs to finish).

On top of this single-player game sits a **research-experiment platform**: a
multi-phase flow (welcome → training → **registration** → main → stats → survey →
thank-you), backed by Firebase, with detailed per-action logging and an admin CMS.
Play is **session-gated**: there is **no anonymous play** — a visitor must enter a
**session code** matching an **active (open)** admin-created session to take part.
Firebase Anonymous Auth is still used as the technical identity (so Firestore
reads/writes work), but the participant is identified for research by the
**Registration** form shown after training (compulsory **UCD Student ID** +
demographics; written to the participant doc as `registration`/`studentId`).

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

3. **Feature-flag the new flow, then flip the default.** The session-gated
   research flow is the **default** at the bare URL (`window.PF_EXPERIMENT`, true
   unless `?admin` or `?classic`). `?classic` shows the original plain game and
   `?admin` opens the CMS. If Firebase is unreachable or Anonymous Auth is
   disabled, the layer enters OFFLINE mode; because a session cannot be validated
   offline, play is **blocked** and the welcome screen asks the visitor to
   reconnect (the `?classic` URL remains as an unsaved escape hatch).

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

Served app (`lab/portfoliofit/`):

| File | Role |
| --- | --- |
| `index.html` | The whole **game**: markup + CSS + the game engine (an IIFE). Also hosts the shared "snake" Account login widget and a localStorage `AppStats` block (legacy). Exposes `window.PFGame`, emits events via `window.PF.onGameEvent`, and reads the `window.PF_EXPERIMENT` / `window.PF_ADMIN` flags set by a tiny inline script. Loads the three layer scripts (deferred). |
| `pf-defaults.js` | Sets `window.PF_DEFAULTS` = `{ texts, settings, registrationQuestions, surveyQuestions, defaultPuzzles }`. Loaded **before** the other two. |
| `experiment.js` | The **participant experiment** layer. Activates only on `?exp=1`. Phase state machine, Firebase (named app), auth/registration, event logging, per-round summaries, survey, onboarding tour, movable/resizable boxes. |
| `admin.js` | The **admin CMS**. Activates only on `?admin`. Login gate, content/question/settings/puzzle editors, participants table + Excel export, theme. |
| `404.html` | Redirects to `/`. |
| `og-image.jpg`, `portfoliofit-difficulty.pdf`, `portfoliofit-difficulty.makepdf.py` | Social card + the κ methodology note (PDF + its generator). |

Backend (`_portfoliofit-lab-firebase/`, underscore-prefixed so Jekyll does **not**
publish it; versioned in the repo, deployed manually to the lab project):

| File | Role |
| --- | --- |
| `firestore.rules` | Security rules (admin = `admin@admin.com`). |
| `firestore.indexes.json` | Composite indexes. |
| `functions/index.js` | `registerParticipant` + `submitSurvey` (Firebase Functions **v1**, `europe-west1`). |
| `firebase.json`, `.firebaserc`, `README.md` | Deploy config + steps. |

## 4. The game engine (`index.html` IIFE) — what to reproduce

- **Pieces:** a fixed library of 8 polyominoes (one tromino, three tetrominoes,
  four pentominoes). The library carries each brick's **shape and colour**; the
  **dollar value is assigned per puzzle**, not fixed (see generation).
- **The board never changes:** every puzzle — Easy or Hard — is the **same fixed
  4×4 square** (16 cells), tiled by a 4-brick subset (tromino + two tetrominoes +
  one pentomino, areas 3+4+4+5). All eight bricks are always shown.
- **Puzzle generation — difficulty comes from VALUES, not the board.** Because the
  board's geometry never changes, its legal placements and all ~88 exact-cover
  tilings are enumerated **once** and cached, along with **every feasible brick-set**
  (all ~97 subsets of the 8 bricks that fit on the board at once — 7 full covers +
  90 partials). To make a puzzle, draw random whole-dollar brick **values** (ratios
  kept distinct) and evaluate them against the cached sets:
  - **Unique, board-filling optimum (`globalBest`).** Net Value = (value of placed
    bricks) − ($1 × empty cells), so it depends only on *which* bricks are placed.
    Crucially a high-value **partial** placement can beat a full cover, so the
    generator scores **all** feasible sets — not just full covers — and accepts a
    value vector only when the maximum Net Value is attained by **exactly one** set,
    *that set is a full cover*, **and** that set tiles the board a **single way up to
    the square's symmetry** (`orbitByMask[set] === 1`). So every puzzle has one best
    portfolio that fills the whole board, no partial ties/beats it, and it isn't a
    family of equal-value arrangements — there is exactly **one** best solution (the
    8 board rotations/reflections of it count as the same). The `Solutions` panel and
    `κ proof` both value covers with the **per-puzzle** values (not the library
    defaults), fold symmetric copies together, and surface that single optimum, so
    they agree with each other and with `bestValue`.
  - **Difficulty (Sahni κ)** via a ratio-greedy completion test. Accept **Easy**
    when κ = 1 (one hint), **Hard** when κ ≥ 2 (the ceiling the deceptive eight-piece
    set reaches on this square). Easy returns the first qualifying board; Hard scans
    for the hardest and stops at the ceiling.
- **KPIs (live):** Net Value, Total Value, Resource Cost (empty-cell penalty),
  Value/Resource (ROI), Coverage %, Portfolio Fitness (net ÷ best). Hover
  tooltips explain each.
- **Tools:** a calculator and a notes pad. **Nudges:** encouraging/idle/time
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
  values:{brickName:dollars,…}, solution:[{name,color,cells:[[r,c]…]}], kappa,
  tilings:{count}, bestValue}`. `values` is the per-puzzle brick pricing that *is*
  the difficulty; it round-trips through freeze/load (stored in `specJson`). Specs
  saved before this change have no `values` and fall back to the library defaults.

## 5. The experiment layer (`experiment.js`)

- **Activation:** returns immediately unless `window.PF_EXPERIMENT` (now the
  default; off only for `?admin`/`?classic`). Adds class `pf-exp` to `<body>`
  and hides research artifacts via CSS (the κ "difficulty" badge, the PDF-note
  footer, the legacy account widget, and the "Best $" pill).
- **Phase machine:** `welcome → training → registration → main → stats → survey →
  thankyou`. Each screen is an overlay card; `S` holds the live state (including
  `S.sessionId` and `S.offline`). The **registration** phase (after training,
  before the main game) renders `cfg.registrationQuestions` — UCD Student ID
  (compulsory, first) + demographics (Age, Gender, Nationality, Country of
  residence, Level of Study, Work Experience, Occupation, English Fluency) — via
  `buildField` (now also handling `country` dropdowns and `min`/`max` `number`
  inputs) plus any `cfg.registrationConsents` checkboxes (empty by default = no
  consent section). On submit it writes `registration` (map) + `studentId` +
  (when consents are shown) `consentGiven`/`consentTimestamp` to the participant
  doc, then starts the main game.
- **Onboarding tour (before training):** an iPhone-style spotlight tour over the
  live board (intro → board → bricks → a **scripted gameplay demo** that places/
  rotates/removes solution bricks while KPIs update → net value → KPIs (with each
  KPI explained) → calculator → notes → nudges → "boxes are draggable/resizable"
  → the green submit button). The clock is paused during the tour. Repositions on
  scroll/resize for mobile.
- **Auth:** a **named** Firebase app `'portfoliofit'` (so it coexists with the
  page's default `stouras-snake` app instead of colliding). Players sign in with
  **Anonymous Auth** (the technical identity only) — **no** e-mail/password.
  A **session code is REQUIRED**: the welcome screen will not start without one,
  and `beginSession` validates the typed code (or one from `?session=CODE`)
  against an **active** `sessions/{code}` (rejecting missing / `closed`
  sessions). There is **no default / anonymous play path**. Each player gets a
  `participants/{uid}` doc (created client-side) tagged with `sessionId` and a
  short `anonymousLabel`, status `joined` until Registration completes then
  `playing`. Returning players resume via their persisted identity **only if
  their doc carries a `sessionId`** (legacy/anonymous docs are sent back to the
  welcome screen to re-enter a code). Offline (Firebase unreachable / Anonymous
  Auth disabled) **blocks play**, since a session cannot be validated.
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
  action to `participants/{uid}/events` (place/move/rotate/flip/remove/calc/note/
  round-start/round-end/stats/survey). Nested arrays (cells/placements) are
  JSON-stringified (Firestore rejects nested arrays). Per-round summaries go to
  `participants/{uid}/rounds`.
- **Stats → survey → thank-you:** aggregate the rounds (totals, coverage, time),
  render the survey from config, submit via the `submitSurvey` function (with a
  direct-write fallback), then the thank-you screen.
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
  - **Content** — collapsible per-page text editors (welcome/training/registration/
    game/stats/survey/thank-you), each pre-filled with the current effective text.
  - **Registration** / **Survey** — add/edit/reorder/delete questions. The
    Registration form is the post-training demographics form (default first field
    is the compulsory **UCD Student ID**); field types include `country` (full
    country dropdown) and `number` (with `min`/`max`).
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
  - **Participants** — table of all players (Player / **UCD Student ID** / Session
    / Status / Started), per-row **delete** (doc + subcollections), and **Export
    to Excel** (SheetJS via CDN; sheets: Participants / Events / Rounds / Survey,
    each carrying `player` + `session` + `uid`; the Participants sheet also carries
    `studentId`, `consentGiven`, and the demographics flattened as `reg_*`).
- Every editable tab carries the same three controls: **Save** and **Make this
  the default** (both persist this page to `config/app`; one live config, so they
  do the same write with different wording) and **Restore built-in default**
  (revert to `PF_DEFAULTS`). Each uses `withFeedback` so the button itself
  confirms — it presses, shows "Saving…", then flashes green "✓ Saved".

## 7. Firebase backend

- **Project:** `stouras-portfoliofit-86127` (the lab / dev project, **separate**
  from production's `stouras-portfoliofit` and from the shared `stouras-snake`
  account), region `europe-west1`. **Blaze** plan (Cloud Functions). Admin
  account `admin@admin.com`; players use **Anonymous Auth** (enable it in the
  console — see the backend README). The web config is public (ships in the
  client JS).
- **Firestore data model:**
  ```
  config/app                      texts, settings (timeLimits, puzzlesPerUser,
                                  randomizeOrder, activePuzzleIds),
                                  registrationQuestions, registrationConsents,
                                  surveyQuestions
  sessions/{code}                 admin config snapshot players join by code
                                  (label, status, texts, settings, questions,
                                  registrationConsents)
  puzzleSets/{id}                 frozen approved puzzles (diff, kappa, bestValue,
                                  cells, specJson)            ← admin-managed library
  counters/participants           { count }  legacy label source (unused anon flow)
  participants/{uid}              uid = anonymous-auth uid; anonymous:true,
                                  anonymousLabel, sessionId,
                                  status ('joined'→'playing'→'survey'→'done'),
                                  registration{studentId,age,gender,nationality,
                                  country,levelOfStudy,workExperience,occupation,
                                  englishFluency}, studentId, consentGiven?,
                                  consentTimestamp?, puzzleOrder[], mainIndex
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
  step** — commit and it's live at `stouras.com/lab/portfoliofit/`.
- **Backend:** from `_portfoliofit-lab-firebase/` (deploy to the **lab** project,
  not production):
  ```
  firebase deploy --only firestore:rules,firestore:indexes,functions --project stouras-portfoliofit-86127
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
