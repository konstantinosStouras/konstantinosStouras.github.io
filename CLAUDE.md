# Repository conventions

This repo is the source of **stouras.com** (Konstantinos Stouras' homepage),
served as a static site via GitHub Pages from the `master` branch. There is no
build step — HTML/CSS/JS are committed and served as-is.

## Fun Projects landing page — keep it in sync

`/fun/` (`fun/index.html`) is the landing page that lists every app under
`stouras.com/fun/`. Each app is one `<li class="app">` card.

**Whenever a new app is added under `fun/<name>/`, you MUST also add a matching
card to `fun/index.html`** (and remove/rename the card if an app is removed or
renamed). Do this in the same change that introduces the app, so the landing
page never drifts out of sync with what actually ships.

For a new card:
- Put the newest app first in the `<ul class="apps">` list.
- Link the title to `/fun/<name>/`.
- Add a one–two sentence `<p>` description matching the app.
- Optional `<span class="tag">New</span>` (green) for a new app, or
  `<span class="tag gr">…</span>` (blue) to flag a Greek-language app.
- If it broadens the site's scope, also refresh the page's `<meta name="description">`
  and `<meta name="keywords">` to mention it.

The homepage's "Fun Projects" section (in the root site) may also link apps —
keep that in mind if a change there is warranted.

## Current /fun/ apps
`ft50` · `lit` · `portfoliofitgame` · `capitals` · `nomoi` · `rooks` · `sudoku` · `snake` ·
`ms` · `ms-old` · `mnsc_scraper-to-use-locally` (plus a redirect stub at `fun/ms2/`)

## `/fun/ft50` — the FT50 research paper browser
`fun/ft50/` extends the `/fun/lit/` architecture to **all 50 journals of the
Financial Times FT50 research rank**. The journal list is data-driven:
`fun/ft50/_scraper/journals.json` (key, name, ISSNs, publisher, capability
flags per journal). Data is static JSON in `fun/ft50/data/` (one
`papers-<key>.json` per journal + `sources.json` manifest), built by
`fun/ft50/_scraper/build-data.mjs` from Crossref and refreshed daily by
`.github/workflows/ft50-update-data.yml` (same hardened commit + self-healing
live-site check as the lit workflow). A second, yearly workflow
(`.github/workflows/ft50-check-list.yml`, 3 Jan) runs
`_scraper/check-ft50-list.mjs`, which re-checks the list against
ft.com/ft50-journals (Wikipedia fallback), auto-adds new journals (ISSNs
resolved via Crossref), marks removed ones `retired` (their data files are
deleted on the next build), and opens a GitHub issue describing any change.
Because 50 journals are a couple hundred MB of JSON, **the page lazy-loads
per-journal files** (selection-driven; searching with nothing selected streams
all of them) — unlike lit, which eager-loads everything. Filter UI is
capability-driven from `sources.json`: Editors/Areas only when Management
Science is selected (exactly like `/fun/ms/`), SE/AE filters for ISR/MkSc; HBR
and MIT SMR are flagged `limitedCoverage` (thin Crossref deposits). The
**"Recently added papers" view respects the journal selection** (a deliberate
difference from lit, whose recent view clears filters). Optional per-user
accounts (stars/notes/lists/tags) mirror `/fun/ms/` but use a **separate
dedicated Firebase project** — inert until `FB_CONFIG` in `fun/ft50/index.html`
is filled per `fun/ft50/_ACCOUNTS-SETUP.md` (rules in `fun/ft50/_firestore.rules`).
See `fun/ft50/_HOW-IT-WORKS.md`. Articles-in-Advance handling matches `/fun/ms`
and `/fun/lit` (`forthcomingStatus` guard + `data/_aia-fixups.json` +
`data/_informs-aia.json`, refreshed locally via `informs-aia-local.mjs --app ft50`).

## `/fun/lit` — "The Lit", the multi-journal research paper browser
`fun/lit/` extends the `/fun/ms/` architecture to eight sources: Management
Science (with editors/areas, exactly like `/fun/ms/`), Operations Research,
Marketing Science, M&SOM, Information Systems Research, POM, PNAS (five topic
sections only), and the ACM EC conference (1999–present, incl. each year's
accepted-papers list from `ec<YY>.sigecom.org` with arXiv/SSRN/OA PDF links via
OpenAlex/DBLP/Semantic Scholar). Data is static JSON in `fun/lit/data/` (one
`papers-<src>.json` per source + `sources.json` manifest), built by
`fun/lit/_scraper/build-data.mjs` and refreshed daily by
`.github/workflows/lit-update-data.yml` (same self-healing live-site check as
the ms workflow). **PNAS caveat:** the DOI→section index
`fun/lit/data/_pnas-concepts.json` must be (re)built occasionally by running
`fun/lit/_scraper/pnas-concepts-local.mjs` on a personal machine, because
pnas.org's search is Cloudflare-blocked for cloud IPs. **ISR/MkSc caveat:**
likewise, ISR Senior/Associate Editor and Marketing Science Senior Editor
names (`fun/lit/data/_informs-editors.json`) come from
`fun/lit/_scraper/informs-editors-local.mjs` run locally (pubsonline blocks
cloud IPs too). Editors/Areas UI shows only when Management Science is in
scope; SE/AE filters show when ISR/MkSc are selected. **Articles-in-Advance
caveat:** a no-volume/no-issue record is tagged forthcoming only when recent
(`forthcomingStatus`); `data/_aia-fixups.json` supplies the real issue for older
frozen records and `data/_informs-aia.json` adds forthcoming papers Crossref
misses, both refreshed locally by `fun/lit/_scraper/informs-aia-local.mjs`.
**Pre-print links:** every paper with a free author pre-print on **arXiv or
SSRN** carries a `Preprint` (+ `PreprintSrc`) field, resolved from OpenAlex by
DOI in `build-data.mjs` (`resolvePreprints`/`pickPreprint`, host-validated so a
spoofed domain can't slip into the href) and cached in `data/_preprints.json`
(incremental — the daily build only queries DOIs it hasn't resolved). The card
shows it as an open-access **"Pre-print (Open Access)"** link between BibTeX and
the sign-in "Notes, tags & lists" toggle; EC's existing meta-row PDF tag is
suppressed when it duplicates the pre-print link. See
`fun/lit/_HOW-IT-WORKS.md`. Like `/fun/ms/`, the page carries the optional
sign-in feature (star/notes/lists/tags, private per user, dedicated Firebase
project); it stays inert until a web config is pasted into `FB_CONFIG` in
`fun/lit/index.html` — setup steps in `fun/lit/_ACCOUNTS-SETUP.md`, security
rules in `fun/lit/_firestore.rules`.

## `/fun/ms` — the Google-free Management Science browser
`fun/ms/` is the Management Science paper browser. It uses **no Google Sheets**:
its data lives as static JSON in `fun/ms/data/` (`papers.json`, `authors.json`,
`affiliations.json`, `recent.json`, `meta.json`), built directly from the Crossref
API by `fun/ms/_scraper/build-data.mjs` and refreshed by the GitHub Action
`.github/workflows/ms-update-data.yml` (daily + manual), which commits the
refreshed files back to the repo and then verifies the live site serves them
(self-healing a transiently failed Pages deploy by requesting a rebuild). The page (`fun/ms/index.html`) reads those
files with `fetch()` — GitHub Pages serves them from its CDN, same origin. To
change the dataset, edit only the `*_URL` constants near the top of its `<script>`.
The `_scraper/` folder and `_HOW-IT-WORKS.md` are underscore-prefixed so Jekyll
does not publish them; `data/` (no underscore) IS published and must stay served.
See `fun/ms/_HOW-IT-WORKS.md`. **Articles in Advance:** a no-volume/no-issue paper
is tagged forthcoming only when recent (`forthcomingStatus` in `build-data.mjs`),
so years-old frozen records aren't mislabeled; their real issue comes from
`data/_aia-fixups.json`, and forthcoming papers Crossref hasn't indexed yet come
from `data/_informs-aia.json` — both refreshed **locally** (pubsonline blocks cloud
IPs) by `fun/lit/_scraper/informs-aia-local.mjs --app ms`, same pattern as the local
editors/PNAS scripts. This applies identically to `/fun/lit` and `/fun/ft50` (shared
`_aia-fixups.json`; run the scraper with `--app lit` / `--app ft50`).

This app was developed at `fun/ms2/` (that path now holds a redirect stub to
`/fun/ms/`) and replaced the original Google-Sheets-backed version, which is
retired-but-served at `fun/ms-old/` (noindex; its data still comes from the
"ManSci Metadata" Google Sheet at runtime). `ms-old` is **deliberately unlisted**:
it has no card on `fun/index.html` and should not get one — it stays reachable
only by direct URL. It is the intended exception to the keep-in-sync rule above.

## `/lab/ideasearchlab` — self-contained, built from this repo

The Ideation Challenge app at `stouras.com/lab/ideasearchlab/` is a React/Vite +
Firebase app whose **complete source is vendored in `_ideasearchlab-src/`** (the
leading `_` keeps Jekyll from publishing it). The served bundle lives in
`lab/ideasearchlab/`. There is **no dependency on any external repo** — to update
the app, edit `_ideasearchlab-src/`, then run `ideasearchlab-deploy-update.bat`
(or `cd _ideasearchlab-src && npm install && npm run build` and copy `dist/*` into
`lab/ideasearchlab/`), commit, and push. Cloud Functions deploy separately with
`firebase deploy --only functions` from `_ideasearchlab-src/`. See
`_ideasearchlab-src/README-SELF-CONTAINED.md`. The old standalone
`github.com/konstantinosStouras/ideasearchlab` repo is retired and safe to delete.

The retired static prototype `lab/brainstorming/` (an older Google-Sheets-backed
version of the same Ideation Challenge, superseded by `lab/ideasearchlab/`) was
removed.

## `/lab/search` — self-contained "Space Exploration" search-experiment replica

`lab/search/index.html` is a **single, self-contained** static page (no build
step, no backend, no external CDN) that recreates the online experiment app for
the sequential-search study in the paper **"Space Exploration" (EC 2026)** by
Suraj Malladi, Alejandro Martínez-Marquina & Ilya Morozov. (The reproduced
consent form keeps the original IRB study title, "Searching the Unknown".)
It reproduces the full flow client-side: consent + Prolific-ID
entry (with the treatment codes `Unrestricted`, `High_Variability`,
`Low_Variability`, `Sweet_Spot`, `Known_Maximum` — matched leniently, ignoring
case/spaces/hyphens/underscores; any other ID randomizes), comprehension-gated
instructions (7 screens), 25 search rounds split into Part I (13) and Part II
(12, with a few free pre-revealed prizes), the per-round payoff = best prize −
total reveal fees ($0.05 each), a two-round payment lottery, and an exit survey.
The prize maps are generated in the browser per Section IV of the paper
(`genPrizesRaw`): Unrestricted = i.i.d. U[0,1]; High/Low Variability = a bounded
random walk with step ±10¢/±5¢ from a random peak; Sweet Spot = the same walk
with a mass-at-zero downward shock (quasiconcave "mountain"); Known Maximum = the
High-Variability walk with the peak pinned to $1. **No data is collected or
transmitted.** The plot is drawn as inline SVG. To change behavior, edit the
constants near the top of the `<script>` (`FEE`, `PART1_ROUNDS`, `TOTAL_ROUNDS`,
`PART2_PREREVEAL`) or the treatment logic in `genPrizesRaw`.

**Currently in QUICK-TEST MODE:** the consent/Prolific-ID page and the
comprehension-checked instruction pages are commented out (both the HTML
sections and their JS wiring, all marked `RESTORE WITH CONSENT/INSTRUCTIONS`
in `lab/search/index.html`); the page instead opens on a minimal start screen
with a treatment picker, like `/lab/jagged`. The game screen also carries a
test-only **"Show hidden prizes"** checkbox (default on) that draws the true
prize map as a red line on the plot — participants must never see it. To
restore the full study flow, follow the numbered steps in the comment on the
consent section and remove the checkbox and its `renderPlot` block.

## `/lab/search-v2` — "Search for Knowledge, with and without AI"

`lab/search-v2/` is a **multi-file** static behavioral experiment (vanilla
HTML/CSS/JS, relative URLs only, no build step): subjects search a hidden line of
100 prizes, paying 5¢ per reveal, in a **Without AI** and/or **With AI** phase
(within-subjects, admin-chosen order; arms `A`/`B`). It has a full **admin panel**
at `/lab/search-v2/admin/` (create sessions, set phases/rounds/AI, view data),
backed by an **optional Firebase** project (`search-with-ai-456d7`) that is
**already configured** in `firebase-config.js`; it degrades gracefully offline.
See `lab/search-v2/README.md`.

Key design points (keep in sync when editing):
- **Ground truth is deterministic and generated at runtime** by `landscape.js`
  (`makeWalk(seed)`), seeded from `(arm, round)` via `config.js` `TRUTH_SEED`: the
  same curve for **every participant of every session**, **different** between the
  two phases, and an **independent** draw per round. There is **no landscape pool**
  (the old `data/mappings.json` + `tools/generate_pool.js` + RICH/POOR strata were
  retired).
- The **With-AI assistant** is trained inside one or two admin-set
  **interpolation regions** (`COVERAGE_PATCHES`); within them it interpolates,
  outside/between them it extrapolates linearly — same math/look as
  `/lab/interpolation`. The testing overlays (debug only) render blue truth, red
  training points, green interpolation, amber dashed extrapolation + shaded zones.
- **AI-model parameters** (admin, `config.js` `AI`): a **baseline** model (cost/
  question below the 5¢ reveal cost + a training-data density) and an optional
  **frontier** model the participant chooses per question (costs more, more data).
  Consulting the AI is charged per question and folded into the round net.
- Defaults: **1 round per phase, practice off**. `assistant.js` is a thin wrapper
  over `landscape.js` and is loaded only in Arm B (strict arm isolation).
- Tests: `node tools/selftest.js` (Node) and `CHROMIUM=… node tools/smoke.mjs`
  (Playwright).

## `/lab/jagged` — self-contained "Trust the AI?" jagged-intelligence game

**Currently unlisted / not yet public:** the app is served but deliberately not
announced — it is not linked from the homepage (or anywhere else on the site)
and its page carries `<meta name="robots" content="noindex,nofollow">`. Do not
add links to it or flip it back to `index,follow` until it is ready to launch.

`lab/jagged/index.html` is a **single, self-contained** static page (no build
step, no backend, no external CDN) — a clean teaching game inspired by Joshua
Gans, *"A Model of Artificial Jagged Intelligence"* (2026, arXiv:2601.07573). One
hidden rough "truth" curve over 100 questions; an AI knows a scatter of points
exactly and **interpolates** (linear between neighbours, flat extrapolation past
the ends), looking equally confident everywhere. Each of 15 questions the player
chooses **Trust** (free; keeps points to the extent the AI was close) or
**Verify** (−20; reveals the truth and scores +80). Questions land uniformly so
players over-encounter wide gaps (the paper's inspection paradox). Three start-screen
toggles are the experimental levers: coverage **Sparse/Dense** (AI scaling = the
knowledge-point intensity λ); a 2-way reliability view **Blind / Band** (a blind user
who sees only the AI's answer with no map · a calibrated user shown the AI's points,
its interpolated line, and the Brownian-bridge posterior-std band, a ~95% region,
zero at knowledge points and largest mid-gap); and **Shared
learning** (Off/On), which on Verify adds the checked point to the AI's knowledge and
re-interpolates (`computeInterp`), an endogenous data-flywheel extension beyond Gans's
exogenous scaling. The start-screen illustration is a fresh random landscape at the
selected coverage (it reshuffles when Sparse/Dense is toggled) with labelled in-plot
arrows (in a header band above the plot so they never overlap the curve); the game
itself uses a fresh Brownian walk (`buildLandscape`). An "Experimental conditions"
section previews the playing environment for the chosen toggles (`drawPreview` over a
stable base landscape) and updates live. Displayed values are rounded to the shown 2
decimals so "off by" always equals (AI answer − truth). The
end screen reveals the true curve over the AI's line and compares
the player to always-trust / always-verify / perfect-play. **No data is collected
or transmitted.** The plot is inline SVG. To change behavior, edit the constants
near the top of the `<script>` (`N_Q`, `CORRECT`, `VERIFY_FEE`, `PEN`, `STEP_SD`,
`K_SPARSE`, `K_DENSE`) or `buildLandscape`.
