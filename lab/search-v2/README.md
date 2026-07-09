# Search for Knowledge, with and without AI (`search-v2`)

A self-contained behavioral experiment, served as static files on GitHub Pages at
**https://stouras.com/lab/search-v2/**. No build step, no framework, no external
CDNs — vanilla HTML/CSS/JS with relative URLs only.

Subjects search a hidden landscape of 100 positions (each hiding a value 0–100¢)
for the best prize, paying 5¢ per reveal. Two arms differ in exactly one thing:

- **Arm A (human only)** — the subject searches alone.
- **Arm B (AI assisted)** — the subject additionally has a free assistant that
  interpolates between its own hidden data points inside a fixed coverage region
  (positions 30–70) and refuses outside it.

Design provenance (not shown in the app): the task/payoff/landscape replicate the
High-Variability treatment of Malladi, Martínez-Marquina & Morozov, *"Space
Exploration"*; the assistant implements the interpolation-only AI of Gans,
*"A Model of Artificial Jagged Intelligence."*

---

## File structure

```
lab/search-v2/
  index.html            screens shell (dynamic content injected by app.js)
  styles.css
  config.js             ONE place for every tunable constant (browser + Node)
  app.js                state machine: screens, rounds, logging, resume
  chart.js              inline-SVG chart (axes, selection, dots, diamonds, debug)
  assistant.js          interpolation + refusal + query log (loaded only in Arm B)
  logger.js             event queue, batching, sendBeacon, localStorage, CSV/JSON
  data/mappings.json    SHIPPED landscape pool (obfuscated), loaded by both arms
  tools/generate_pool.js  offline seeded pool generator → data/mappings.json
  tools/apps_script_endpoint.gs  paste-ready Google Apps Script logging endpoint
  tools/selftest.js     automatable acceptance tests (Node)
  tools/smoke.mjs        browser acceptance tests (Playwright)
  tools/pool_plain.json  un-obfuscated pool + strata metadata (gitignored; analysis)
  README.md
```

---

## Local testing

Serve the repo root over HTTP (the app `fetch()`es `data/mappings.json`, so
`file://` will not work):

```bash
# from the repository root
python3 -m http.server 8000
# then open:
#   http://localhost:8000/lab/search-v2/?arm=A
#   http://localhost:8000/lab/search-v2/?arm=B
```

**Debug overlay.** Append `&debug=1&key=stouras` to overlay the true landscape as
a faint line, mark the assistant's hidden dots, and show the stratum + mapping id.
Debug requires **both** `debug=1` and the key, so subjects can't trigger it by
accident. In debug you may also override the logging endpoint per-URL with
`&endpoint=<url>` (used by the smoke test).

```
http://localhost:8000/lab/search-v2/?arm=B&debug=1&key=stouras
```

### Run the tests

```bash
cd lab/search-v2
node tools/selftest.js          # Node acceptance tests (pool, strata, math, draw…)

# browser acceptance tests (arm isolation, resume, logging) — needs Playwright:
npm i playwright                 # or point CHROMIUM=/path/to/chrome at an existing build
CHROMIUM=/path/to/chrome node tools/smoke.mjs
```

---

## Regenerating the landscape pool

The pool is generated **offline** and committed; the app never generates
landscapes at runtime. It is seeded and deterministic — running it twice with the
same seed produces byte-identical `data/mappings.json`.

```bash
cd lab/search-v2
node tools/generate_pool.js                # default seed (20260709)
node tools/generate_pool.js --seed=12345   # choose a seed
node tools/generate_pool.js --stamp=2026-07-09T00:00:00Z   # set generatedAt
```

It writes:
- `data/mappings.json` — **shipped**. Value arrays are XOR-ed with a fixed byte
  (`OBFUSCATION_KEY`) and base64-encoded (`v` = the 100 values, `dots` = the 7
  `[pos,value]` pairs). This only deters casual DevTools peeking. Analysis
  metadata (`interiorMax`/`outsideMax`/`argmax` and plain arrays) is **not**
  shipped — it lives in the plain file so the served page leaks as little as
  possible.
- `tools/pool_plain.json` — **gitignored**. Plain values, plain `aiDots`, and
  strata metadata for analysis (including, for Arm A subjects, what the assistant
  *would* have said).

Two strata (60 landscapes each) + 1 practice landscape:
- **RICH** — global best is inside coverage (`interiorMax ≥ 85`, `outsideMax ≤ interiorMax`).
- **POOR** — global best is outside coverage (`interiorMax ≤ 55`, `outsideMax ≥ 85`).
- Both pass a comparability screen (mean of all 100 values in [25, 50]).

Each subject is served 5 RICH + 5 POOR, shuffled (seeded by session id).

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

## Prolific launch URLs

Give Prolific two study links (one per arm). Prolific substitutes the ID macros:

```
https://stouras.com/lab/search-v2/?arm=A&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
https://stouras.com/lab/search-v2/?arm=B&PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}
```

If `arm` is absent the app randomizes 50/50 and persists it. Re-entry after
completion is blocked (the completion code is shown again).

---

## Event schema

Every event is one flat JSON object. Columns (CSV / Sheet order):

| field | meaning |
|---|---|
| `session`,`pid`,`study`,`arm` | identifiers (from URL) |
| `event` | event type (below) |
| `t` | epoch ms |
| `rt_ms` | ms since this subject's previous event |
| `round` | 0 = practice, 1..10 = real |
| `mapping` | landscape id (e.g. `R012`, `P004`, `practice_1`) |
| `stratum` | `RICH` / `POOR` / `practice` |
| `position` | position acted on |
| `value` | revealed value (reveal); batch size (upload_*); bonus¢ (session_end) |
| `estimate` | assistant estimate (`ai_query`) |
| `refused` | `true` if the assistant refused (`ai_query`) |
| `reveals`,`cost`,`best`,`net` | running round counters |
| `qid`,`choice`,`correct` | quiz answer (`quiz_attempt`) |
| `rawNet`,`flooredNet` | round earnings, raw and floored-at-0 (`round_end`) |
| `info` | free-form payload (task order, paid rounds, best) |
| `ua`,`vw`,`vh` | user agent + viewport |
| `appVersion` | stamped from `config.js` |

**Event types:** `session_start`, `consent`, `quiz_attempt`, `round_start`,
`select` (throttled ≤1/s), `reveal`, `ai_query`, `warn_negative`, `stop_confirm`,
`round_end`, `paid_rounds_drawn`, `session_end`, `upload_ok`, `upload_fail`.

**Payoff.** Round net = highest revealed value − 5¢ × reveals (0 if no reveals).
At the end, `PAID_TASKS = 2` of the 10 real rounds are drawn uniformly at random
(seeded by session id, so a refresh reproduces the same draw); the bonus is the
sum of their nets, each floored at 0 for payment (the raw value is logged too).

---

## Config (`config.js`)

All tunables live in one object: `N_POSITIONS`, `L_STEP`, `REVEAL_COST`,
`N_TASKS`, `N_PRACTICE`, `PAID_TASKS`, `COVERAGE`, `K_DOTS`, `POOL_PER_STRATUM`,
`RICH_INTERIOR_MIN`, `POOR_INTERIOR_MAX`, `POOR_OUTSIDE_MIN`, `ENDPOINT_URL`,
`COMPLETION_CODE`, `APP_VERSION`, `OBFUSCATION_KEY`, `DEBUG_KEY`. `config.js` is
loaded by both the browser and the Node tools, so the two never disagree.

---

## Acceptance tests

Automated in `tools/selftest.js` (Node) and `tools/smoke.mjs` (browser):

| # | check | where |
|---|---|---|
| 1 | pool determinism (byte-identical regen) | selftest |
| 2 | stratum validity (every mapping passes its filters) | selftest |
| 3 | assistant math (dot = truth, midpoint = interp, 29/71 refuse) | selftest |
| 4 | arm isolation (no assistant UI/band/strings in Arm A) | smoke |
| 5 | same pool for both arms (single data file) | selftest |
| 6 | payoff math (net, floor-at-0 for pay only) | selftest |
| 7 | no plaintext leakage in shipped pool | selftest + smoke |
| 8 | resume mid-round (state restored, no double-logging) | smoke |
| 9 | logging completeness + endpoint-failure download fallback | smoke |
| 10 | payment draw seeded + reproducible | selftest |
