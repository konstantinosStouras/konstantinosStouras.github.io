# Search for Knowledge, with and without AI (`search-v2`)

A self-contained behavioral experiment, served as static files on GitHub Pages at
**https://stouras.com/lab/search-v2/**. No build step, no framework, no external
CDNs — vanilla HTML/CSS/JS with relative URLs only.

Subjects search a hidden landscape of 100 positions (each hiding a value 0–100¢)
for the best prize, paying 5¢ per reveal. The study runs in one or more
**phases**, which differ in exactly one thing:

- **Without AI (human only, arm `A`)** — the subject searches alone.
- **With AI (AI assisted, arm `B`)** — the subject additionally has an AI
  assistant: a conceptual model of an LLM. It is "trained on" hidden data points
  inside one or two **interpolation region(s)** (admin-set, default `[[30,70]]`)
  and **always answers, for any position, with the same confident wording** — it
  never says "I don't know". Within a region it **interpolates** between its
  nearest points (accurate, since the true curve is locally smooth); outside and
  between regions it **extrapolates** linearly along the nearest edge (confident
  but increasingly wrong), exactly like the teaching demo at `/lab/interpolation`.
  Consulting it **costs cents per question** (less than a reveal), and the admin
  can offer two models — a cheaper **baseline** trained on less data and a pricier
  **frontier** trained on more — for the participant to choose between. The AI is
  reliable only near its training data, and the participant is **not told where
  that is** — they must calibrate by verifying with their own reveals.

**Ground truth is deterministic.** Each round's hidden prize curve is a bounded
random walk generated at runtime (`landscape.js`) from a fixed `(arm, round)`
seed: it is **identical for every participant of every session**, **different**
between the Without-AI and With-AI phases, and an **independent** draw for each
round within a phase (10 rounds ⇒ 10 different curves). There is no landscape pool
to ship; change `TRUTH_SEED` in `config.js` to reshuffle every curve at once.

The admin chooses **which phases to include and the order** participants move
through them (in the `/admin/` panel → **Phases**). Include one phase for a
single-condition study, or both for a **within-subjects** design where every
participant plays each condition as its own block of rounds — in a fixed order,
or **counterbalanced** (random order per participant) to control for order
effects. Each event is stamped with the active `arm` and a 1-based `phase`
ordinal, so both designs analyse cleanly. (Internally the two phases are still
arms `A`/`B`; the older per-arm `armMode` on a saved session is still honoured as
a one-phase fallback.)

After the last round the participant sees an **end-of-study debrief** — one
representative (paid) round per phase drawn with its true prize curve, the
positions they revealed and, for the With-AI phase, the AI's region / training
points / interpolation line (all hidden during play) — plus per-phase summary
stats. **Next** leads to a short anonymous **exit survey** (Likert + free text,
logged as `survey` events), then the finish/completion-code page.

**Testing view.** On a debug/Test link only (`?debug=1&key=…`), the round screen
shows a "Testing view" checkbox bar to toggle the ground-truth line and, in the
With-AI phase, the AI region / training points / interpolation + extrapolation.
These overlays are styled like `/lab/interpolation` (blue Brownian truth, red
training points, green interpolation within the region(s), amber dashed
extrapolation with shaded zones) and are **never shown to a real participant** —
during play they only see the prizes they reveal and the estimates they ask for.
Debug links also accept `?phases=AB` to force a phase sequence for local testing.

Design provenance (not shown in the app): the task/payoff/landscape replicate the
High-Variability treatment of Malladi, Martínez-Marquina & Morozov, *"Space
Exploration"*; the assistant implements the interpolation/extrapolation AI of
Gans, *"A Model of Artificial Jagged Intelligence,"* rendered like the
`/lab/interpolation` teaching demo.

---

## File structure

```
lab/search-v2/
  index.html            screens shell (dynamic content injected by app.js)
  styles.css
  config.js             ONE place for every tunable constant (browser + Node)
  landscape.js          deterministic Brownian truth + AI interp/extrap (browser + Node)
  app.js                state machine: screens, rounds, logging, resume
  chart.js              inline-SVG chart (axes, selection, dots, diamonds, debug)
  assistant.js          thin wrapper over landscape.js (loaded only in Arm B)
  logger.js             event queue, batching, sendBeacon, localStorage, CSV/JSON
  firebase-config.js    OPTIONAL: paste your Firebase project config here
  firebase.js           OPTIONAL Firestore/Auth integration (inert until configured)
  firestore.rules       security rules to deploy in the Firebase console
  admin/index.html      admin panel (phases, rounds, AI model, regions, data) — /admin/
  admin/admin.js        admin panel logic
  og-image.png          1200×630 social/link-preview card (Open Graph / Twitter)
  icon-180.png          apple-touch-icon
  tools/apps_script_endpoint.gs  paste-ready Google Apps Script logging endpoint
  tools/selftest.js     Node acceptance tests (deterministic truth, estimate, wiring)
  tools/smoke.mjs        browser acceptance tests (Playwright)
  README.md
```

There is **no `data/` directory and no pool generator** anymore: the hidden prize
curves are generated in the browser at runtime by `landscape.js`, so the served
page never fetches a landscape file.

---

## Local testing

Serve the repo root over HTTP (the optional Firebase SDK is loaded as an ES
module, so `file://` will not work):

```bash
# from the repository root
python3 -m http.server 8000
# then open:
#   http://localhost:8000/lab/search-v2/?arm=A
#   http://localhost:8000/lab/search-v2/?arm=B
```

**Debug overlay.** Append `&debug=1&key=stouras` to show the "Testing view" bar,
which toggles the true Brownian curve, the AI interpolation region(s), its
training points, and its interpolation/extrapolation — plus the round's `arm-round`
id (and, in Arm B, the selected model). Debug requires **both** `debug=1` and the
key, so subjects can't trigger it by accident. In debug you may also override the
logging endpoint per-URL with `&endpoint=<url>` and force a phase order with
`&phases=AB` (used by the smoke test).

```
http://localhost:8000/lab/search-v2/?arm=B&debug=1&key=stouras
```

### Run the tests

```bash
cd lab/search-v2
node tools/selftest.js          # Node acceptance tests (truth, estimate, geometry, wiring)

# browser acceptance tests (arm isolation, resume, logging) — needs Playwright:
npm i playwright                 # or point CHROMIUM=/path/to/chrome at an existing build
CHROMIUM=/path/to/chrome node tools/smoke.mjs
```

---

## Deterministic ground truth (`landscape.js`)

There is **no offline pool** — every curve is generated in the browser, on
demand, and is fully reproducible:

- `makeWalk(seed)` builds one round's truth: a bounded random walk in cents
  `[0,100]` with `|Δ| ≤ L_STEP` between neighbours. The seed is
  `hashSeed(TRUTH_SEED + ':' + arm + ':r' + round)`, so the curve is the **same
  for everyone**, **differs** between arm `A` and arm `B`, and is an
  **independent** draw for each round. (The single practice round uses an
  arm-independent seed.) It also **prefers a single, tie-free peak**: it draws up
  to 64 candidates from a deterministic seed sequence and keeps the first whose
  global maximum is unique — preferred, **never enforced** (on the astronomically
  rare miss it keeps the first candidate).
- `makeDots(values, patches, density, seed)` places the assistant's training
  points inside each interpolation region — evenly spaced with a little
  deterministic jitter, at a spacing set by the density label (`few` / `standard`
  / `lots`), so "more data" gives finer interpolation.
- `estimate(groups, x)` and `geometry(groups)` implement the interval-aware
  interpolation (within a region) and linear extrapolation (outside/between
  regions) that both `assistant.js` and the chart overlays consume, matching
  `/lab/interpolation`.

`landscape.js` loads in the browser (`window.Landscape`) and in Node
(`require`), so the app and `tools/selftest.js` never disagree. To reshuffle
every curve at once, change `TRUTH_SEED` in `config.js`.

---

## Deploying the logging endpoint (optional)

The app works fine with `ENDPOINT_URL = ""` (events stay in localStorage and are
downloadable on the finish page). To collect centrally into a Google Sheet:

1. Create a Google Sheet.
2. **Extensions → Apps Script**, paste `tools/apps_script_endpoint.gs`, Save.
3. **Deploy → New deployment → Web app.** *Execute as:* Me. *Who has access:*
   **Anyone**.
4. Copy the `/exec` URL into `config.js` → `ENDPOINT_URL`.

Events are POSTed as `text/plain` (no CORS preflight) in batches of 10 or every
15 s, with retry + exponential backoff, plus a `sendBeacon` tail flush on page
hide. Each event becomes one row in the sheet, in the column order below.

Also set `COMPLETION_CODE` in `config.js` to your Prolific completion code before
launch.

---

## Admin panel & Firebase setup (optional but recommended)

The **admin panel** at **`/lab/search-v2/admin/`** lets you, from any browser
(with a **dark / light** toggle):

- **create named sessions** — each *session* is one run of the study with its own
  **name**, **code**, settings, and page text. Participants join a session via its
  code (`?code=WAVE1` in the launch link); all data is grouped by session. The
  right column lists **Active** and **Completed** sessions (open / mark
  completed / reopen / delete).
- **control the conditions** — per session: the **phases** (which conditions to
  include — Without AI and/or With AI — and the order, incl. counterbalanced),
  the **number of rounds** each participant plays *per phase* (default **1**, real
  rounds, paid rounds drawn across all phases at the end, and whether a practice
  round is shown — default **off**), the **AI model parameters** (below), and the
  Prolific **completion code** (shared, or a phase-specific code for single-phase
  sessions). Every field has a hover tooltip.
- **tune the AI** — a dedicated **AI model parameters** section: the
  **interpolation region(s)** (one or two disjoint intervals on the 1–100 line
  where the assistant is trained), the **baseline model** (cost per question, kept
  below the 5¢ reveal cost, and how much training data it has), and an optional
  **frontier model** the participant can choose per question (costs more, trained
  on more data). More AI parameters can be added here over time.
- **edit every participant page** — consent, instructions (all phases + the
  With-AI addendum), the between-phase transition screens, the finish page, and
  the study-closed page. Blank = built-in default;
  `**bold**` and blank lines are supported. **Save**, **Make this the default**
  (seed new sessions), and **Restore built-in default** controls, plus a **Settings
  summary**.
- **test immediately** — each session has a **▶ Test this session** link that opens
  the app with the intro (consent/instructions/quiz) **skipped, just for you**
  (gated on the debug key; real participants always see consent). Preview never
  writes to Firestore.
- **see the data & analytics** — a per-session data table (CSV/JSON export) and an
  **Analytics** tab comparing **Without AI vs With AI** (net, reveals, best found
  per round) over completed participants. In a within-subjects session each
  participant contributes to both, aggregated per `(participant, phase)`.
- **download an analysis-ready Excel workbook** — the **⬇ Download Excel (.xlsx)**
  button on the Data tab (honours the session filter) and the **⬇ Excel** action on
  every session card (handy once a session is completed) export one workbook with
  six sheets: **ReadMe** (column dictionary + units), **Sessions** (every parameter
  the admin chose for the wave), **Participants** (one row per person: timing,
  totals, quiz, bonus, completion), **Rounds** (one row per participant × phase ×
  round: duration, reveals, AI questions/fees, best, raw/floored net, whether the
  round was drawn for payment), **Actions** (every logged action in time order,
  with `decision_ms` — the milliseconds the participant took since their previous
  action, i.e. the per-decision response time — plus running within-round totals),
  and **Survey** (Likert + free-text answers). Money is in cents, times are UTC
  with milliseconds. The workbook is generated fully client-side by
  `admin/xlsx.js`, a dependency-free OOXML writer (no CDN), and derives everything
  from the same events the Data tab shows.
- **manage participants** — the **Participants** panel lists everyone who has taken
  part (anonymous — no accounts, so each is one play session id). Each card
  **expands** to show first-seen / last-active, Prolific id, wave code, phases
  played, event count, bonus, and a per-round net breakdown, with per-user actions:
  - **Message** — push a live message to that participant; it pops up on their
    screen while they play (Firestore `messages/{session}`; dismissal is tracked
    client-side, so participants never write).
  - **View data** — jump to that participant's wave in the Data tab.
  - **Remove user** — permanently delete that participant's collected event rows.
  - Panel-level **Remove all** (participants) and **Remove all sessions** (waves),
    each double-confirmed.

  The admin `delete` on `events` is already allowed by `firestore.rules`; the new
  **`messages`** collection needs the updated `firestore.rules` **published once** in
  the Firebase console before admin→participant messaging will work (delete, bulk
  delete, and the auto-nudge below need no rules change).
- **auto-nudge inactive players** — if a participant makes no move for
  `NUDGE_IDLE_MS` (default 60 s) during a round, the app itself shows a gentle
  "keep going / do your best" encouragement (purely client-side — no server, and it
  works even without the `messages` rule). The admin's manual messages reuse the
  same toast; both are logged as `nudge_shown` events.

These are backed by **Firebase (Firestore + Auth)**. Until you configure it, the
admin panel opens in a **local preview** (this browser’s test sessions only) and
the experiment runs exactly as before. Every logged event is stamped with
`sessionCode` and `sessionName`.

### One-time Firebase setup (with a dedicated account)

1. **Dedicated account.** Create a Google account just for this study (e.g. a
   new Gmail), so the research data lives separately from personal projects. Sign
   into the [Firebase console](https://console.firebase.google.com) with it.
2. **Create a project** — *Add project*, name it e.g. `search-v2` (Analytics
   optional).
3. **Firestore** — *Build → Firestore Database → Create database*, **Production
   mode**, pick a region near your subjects.
4. **Authentication** — *Build → Authentication → Get started*; enable
   **Anonymous** (participants) and **Email/Password** (you). Under *Users → Add
   user*, create your admin login (e.g. `admin@admin.com` + a strong password).
5. **Web app config** — *Project settings → General → Your apps → Web (`</>`)*,
   register an app, and copy the `firebaseConfig` object.
6. **Paste config** — put that object into `lab/search-v2/firebase-config.js` (over
   the `PASTE_…` placeholders) and set `ADMIN_EMAILS` to your admin email. Commit &
   push.
7. **Deploy rules** — copy `lab/search-v2/firestore.rules` into Firestore →
   **Rules**, replace `admin@admin.com` with your admin email, and **Publish**.
8. **Use it** — open `/lab/search-v2/admin/`, sign in with your admin account, set
   the conditions, and watch data arrive on the **Data** tab as participants play.

### How it fits together

- Participants **sign in anonymously** and each logged event is written to the
  Firestore **`events`** collection, keyed by `session__<sequence>` so a resume or
  retry **overwrites** rather than duplicates. (localStorage mirror + the optional
  Apps-Script endpoint keep working in parallel.)
- The app reads the admin-controlled **`config/study`** document on load and
  applies it (arm mode, open/closed, completion code). The security rules let
  anyone signed in *read* `config/study` but only your admin email *write* it, and
  only the admin can *read* the `events` collection — so one participant can never
  read another’s data.
- Free-tier Firestore (Spark plan) is ample for a study of this size.

---

## Prolific launch URLs

Each admin session has **one** participant link — the phases (and their order)
come from the session settings, so no `?arm` is needed. Prolific substitutes the
ID macros:

```
https://stouras.com/lab/search-v2/?code=WAVE1&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
```

Re-entry after completion is blocked (the completion code is shown again).
`?arm=A`/`?arm=B` is still honoured as a **legacy fallback** for sessions saved
before the phases model (or a bare link with no session settings), where it
forces a single-phase run and otherwise randomises 50/50.

### Session code required (the entry gate)

**Nobody can play without a session code.** The code is the study link's
`SESSION_ID` — Prolific fills it in automatically, so real participants go
straight to consent and never see the gate. If someone opens the bare URL with no
`SESSION_ID`, the app **does not invent a session** (it used to auto-generate a
random one); instead it shows an **"Enter your session code"** screen and refuses
to start until a code is typed. The entered code is persisted, so a refresh
resumes the same session. In debug mode (`?debug=1&key=stouras`) a fixed `debug`
code is used so local testing needs no gate, and the admin **preview** link
(`?preview=1&debug=1&key=…`) bypasses the gate the same way (a throwaway
session). Note the admin **session/wave** code (`?code=WAVE1`) is unrelated to
this gate — real launch links carry both `code` and `SESSION_ID`.

A small **"Log out"** control appears in the header once you are in a session. It
erases every trace of the study on that device (state, event log, sync markers,
saved code) and returns to the code gate — useful for clearing a stuck or shared
browser. On the live site the authoritative data is already in Firestore, so
logging out never loses collected research data.

---

## Event schema

Every event is one flat JSON object. Columns (CSV / Sheet order):

| field | meaning |
|---|---|
| `session`,`pid`,`study`,`arm` | identifiers (`arm` = the active phase's condition, `A`/`B`) |
| `phase` | 1-based phase ordinal (1 for a single-phase session; 1 then 2 within-subjects) |
| `sessionCode`,`sessionName` | the admin session (wave) this participant belongs to |
| `event` | event type (below) |
| `t` | epoch ms |
| `rt_ms` | ms since this subject's previous event |
| `round` | 0 = practice, 1..N = real, **per phase** (rounds restart at 1 in each phase — use `phase`+`round` together) |
| `mapping` | round id: `A-r1`, `B-r2`, … (arm + round), or `practice` |
| `stratum` | `practice` for the practice round, else blank (strata were retired with the pool) |
| `position` | position acted on |
| `value` | revealed value (reveal); batch size (upload_*); bonus¢ (session_end) |
| `estimate` | assistant estimate (`ai_query`) |
| `refused` | always `false` — the assistant never refuses (kept for schema stability) |
| `reveals`,`cost`,`best`,`net` | running round counters (`cost`/`net` include AI-consultation fees) |
| `qid`,`choice`,`correct` | quiz answer (`quiz_attempt`) |
| `rawNet`,`flooredNet` | round earnings, raw and floored-at-0 (`round_end`) |
| `info` | free-form payload (phases, interpolation regions, AI config, per-round summary; `ai_query` carries `model=…;mode=interp\|extrap;fee=…`) |
| `ua`,`vw`,`vh` | user agent + viewport |
| `appVersion` | stamped from `config.js` |

**Event types:** `session_start`, `phase_start` (each phase after the first),
`consent`, `quiz_attempt`, `round_start`, `select` (throttled ≤1/s), `reveal`,
`ai_query`, `warn_negative`, `stop_confirm`, `round_end`, `paid_rounds_drawn`,
`session_end`, `upload_ok`, `upload_fail`.

**Payoff.** Round net = highest revealed value − 5¢ × reveals − AI-consultation
fees (0 if the participant did nothing; it can go negative if they only paid the
AI and revealed no prize). At the end, `PAID_TASKS` rounds are drawn uniformly at
random from **all** real rounds across **all** phases (seeded by session id, so a
refresh reproduces the same draw); the bonus is the sum of their nets, each
floored at 0 for payment (the raw value is logged too).

---

## Config (`config.js`)

All tunables live in one object: `N_POSITIONS`, `L_STEP`, `REVEAL_COST`,
`N_TASKS` (default **1**), `N_PRACTICE` (default **0**), `PAID_TASKS`,
`TRUTH_SEED` (reshuffles every curve), `COVERAGE_PATCHES` (default interpolation
region), `AI` (baseline/frontier per-question cost + training-data density),
`ENDPOINT_URL`, `COMPLETION_CODE`, `APP_VERSION`, `DEBUG_KEY`. These are the
built-in defaults; the admin panel overrides most of them per session. `config.js`
is loaded by both the browser and the Node tools, so the two never disagree.

---

## Acceptance tests

Automated in `tools/selftest.js` (Node) and `tools/smoke.mjs` (browser):

| # | check | where |
|---|---|---|
| 1 | deterministic truth (identical for all · differs by arm · fresh per round) | selftest + smoke |
| 2 | walk shape (in range · adjacency ≤ `L_STEP` · length `N`) | selftest |
| 3 | assistant math (exact at dots · interpolate inside · extrapolate outside/between) | selftest + smoke |
| 4 | training-data density (few < standard < lots points) | selftest |
| 5 | chart geometry (interp polylines + extrap zones; one vs two regions) | selftest + smoke |
| 6 | app wiring (no pool fetch · runtime truth · AI cost folded into the net) | selftest |
| 7 | AI economics + defaults (baseline < reveal ≤ frontier; 1 round, no practice) | selftest |
| 8 | arm-B playthrough (AI question + reveal → cost 7¢, net = best − 7¢) | smoke |
| 9 | interpolation overlays render (blue truth · green interp · amber extrap + zones · red dots) | smoke |
| 10 | Arm-A isolation (no assistant DOM/text) | smoke |
