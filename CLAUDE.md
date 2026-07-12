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
`lit` · `portfoliofitgame` · `capitals` · `nomoi` · `rooks` · `sudoku` · `snake` ·
`ms` · `ms-old` · `mnsc_scraper-to-use-locally` (plus redirect stubs at `fun/ms2/`
and `fun/ft50/` — the retired FT50 browser now redirects to `/fun/lit/`)

## `/fun/ft50` — RETIRED (redirect stub only)
The standalone FT50 research paper browser was removed: `/fun/lit/` is a
superset (its "Journal types" filter covers all 50 FT50 journals from lit's
own `fun/lit/data-ft50/` dataset — see the lit section below). `fun/ft50/`
now holds only a noindex redirect stub to `/fun/lit/` (like `fun/ms2/`), so
old links keep working; do not add a card for it on `fun/index.html`. The
app's data (~190 MB), scraper and its two workflows (`ft50-update-data.yml`,
`ft50-check-list.yml`) were deleted — the pipeline lives on, vendored at
`fun/lit/_scraper-ft50/` with its own `lit-ft50-*` workflows.

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
the ms workflow). **Journal types & the FT50 merge:** a "Journal types"
filter (left of Journals) offers UTD24 / FT50 / ABS 4/4* / ABS 3; a type chip
expands to its journal set and unions with the Journals selection. Each paper
card carries a small **badge left of its title** showing the single MOST
selective list its journal belongs to (UTD24 > FT50 > ABS 4/4* > ABS 3 —
JOURNAL_TYPES order in `index.html`; a UTD24 journal is never additionally
badged FT50/ABS); clicking it selects that type. Filtering is unaffected by
the badge: an ABS 4/4* search still returns UTD24 journals' papers. The
catalog also carries **notFT extras** — journals on another list but not the
FT50: UTD24's INFORMS Journal on Computing (`ijoc`), ABS 4's European
Journal of Operational Research (`ejor`), and the two AJG 2024 4* additions
American Journal of Political Science (`ajps`) / American Political Science
Review (`apsr`) — flagged `"notFT": true` in `journals.json` so the page
keeps them out of FT50 membership and the yearly FT-list check never retires
them. (Full ABS 3 coverage — ~330 journals, ~1 GB — would exceed GitHub
Pages' 1 GB site limit; ABS 3 therefore means the 3-graded journals among
the covered lists. The catalog grows past this repo's 1 GB Pages limit via
**satellite data shards** — sibling repos `lit-data-abs4`,
`lit-data-abs3-omecon`, `lit-data-abs3-rest`, each with its own Pages site,
vendored pipeline and curated `_scraper/journals.json` (grades in an `abs`
field that flows into the page's ABS buckets/badges via `MANIFEST_ABS`);
the page merges their `data/sources.json` manifests at runtime (`SHARDS`
list in `index.html`) and lazy-loads their papers files same-origin from
`stouras.com/<repo>/data/`. Missing shards 404 and are skipped.) **Everything loads lazily:** no papers file (native or catalog)
downloads until a filter needs it — first paint is a few hundred KB
(manifests + recent.json; authors.json fetched on first Authors-tab open),
where the page previously eager-fetched ~60 MB per visit. The page merges in
lit's **own FT50 catalog** at runtime — `fun/lit/data-ft50/` (seeded from the
retired fun/ft50 app's data, registry included, then maintained here):
it fetches `data-ft50/sources.json`, appends the 44 FT50-only journals to the
journal filter, and **lazy-loads** their `papers-<key>.json` only when they
enter scope — selected directly, via a type chip, or on a broad
year/title/author/affiliation search with no journal scope; the
`data-ft50/recent.json` (extras only) joins the recent view. The dataset is
built by `fun/lit/_scraper-ft50/` (the retired fun/ft50 app's pipeline,
vendored; journal list in its own `journals.json`), refreshed daily by
`.github/workflows/lit-ft50-update-data.yml` (07:15 UTC) and checked against
the FT's list yearly by `lit-ft50-check-list.yml` (4 Jan). AIA fixups for it
come from
`informs-aia-local.mjs --app lit-ft50`. FT50 membership is seeded statically
in `index.html` and extended from the data-ft50 manifest (so the yearly
FT-list check flows through); ABS grades (AJG 2024, via journalranking.org)
live in the `ABS_RATING` map there — PNAS/ACM EC are unrated, and HBR/MIT SMR
(AJG 2024 "top practitioner" journals) are kept at 3, their last numeric
grade. The pre-computed Authors/Affiliations panels and the pre-print
backfill remain native-eight-sources only. **PNAS caveat:** the DOI→section index
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
SSRN** carries a `Preprint` (+ `PreprintSrc`) field, resolved in `build-data.mjs`
(`resolvePreprints`) and cached in `data/_preprints.json` (doi → `{u,s}` |
`{none:1}` | `{none:1,ts:1}`; incremental). Two passes: (1) OpenAlex **by DOI**
(batched) reads any arXiv/SSRN location already attached to the published record;
(2) a **title+author search** (`searchPreprintsByTitle`/`matchPreprintWork`,
newest-first) finds preprints that live as a **separate** OpenAlex/SSRN record
(own `10.2139/ssrn.*` DOI) — this is what surfaces most SSRN links. It is ONE
OpenAlex request per paper (rate-limited per identity, daily quota resets at
midnight UTC), so the **backfill runs online in its own scheduled workflow**,
`.github/workflows/lit-preprints-backfill.yml` (4×/day), which runs
`fun/lit/_scraper/preprints-ci.mjs`: a bounded (~25 min), quota-aware slice of
searches per run (waits out throttling; exits cleanly when the day's quota is
spent) that commits `fun/lit/data/` back — it **shares the
`lit-update-data-*` concurrency group** with the daily build so the two never
race a commit, and its push-retry re-applies finds via
`--apply-only --merge-cache` instead of clobbering a fresher dataset.
`fun/lit/_scraper/preprints-local.mjs` remains as a faster local alternative
(unthrottled from a home connection; identifies as a separate `LIT_MAILTO`
quota identity so CI can never spend the local budget). In the daily build the
same pass also runs as a **strictly time-boxed, gentle best-effort**
(`LIT_PREPRINT_SEARCH_MS`, default 6 min; `LIT_PREPRINT_SEARCH_CAP`, default
2500; single-attempt fetch that backs off and stops on 429s) so it can **never
hang the build**. Both `pickPreprint` and the matcher are host-validated (real
`arxiv.org`/`ssrn.com` hostname) so a spoofed domain can't slip into the href;
the matcher also demands an exact normalized-title match + a shared author
surname + a plausible year to avoid wrong links. The card shows an open-access **"Pre-print (Open Access)"**
link between BibTeX and the sign-in "Notes, tags & lists" toggle; EC's meta-row
PDF tag is suppressed when it duplicates it. **PNAS "Significance":** for PNAS,
the Crossref abstract's JATS `<sec><title>Significance</title>` block is split
out into a `Significance` field (`extractSignificance`, no pnas.org fetch) and
shown as a **"Significance"** card toggle before "Abstract". See
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
editors/PNAS scripts. This applies identically to `/fun/lit` and its FT50
catalog (shared `_aia-fixups.json`; run the scraper with `--app lit` /
`--app lit-ft50`).

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
at `/lab/search-v2/admin/` (create sessions, set phases/rounds/AI, view data, and
export an analysis-ready multi-sheet **.xlsx** — sessions' admin-chosen parameters,
participants, rounds, every action with per-decision response times, survey —
generated client-side by the dependency-free writer `admin/xlsx.js`), backed by an
**optional Firebase** project (`search-with-ai-456d7`) that is **already
configured** in `firebase-config.js`; it degrades gracefully offline. Firestore
cannot store nested arrays, so session settings persist `coveragePatches` as
`[{a,b},…]` maps (admin encodes/decodes; `app.js` `normalizePatches` accepts both
shapes). See `lab/search-v2/README.md`.

Key design points (keep in sync when editing):
- **Ground truth is deterministic and generated at runtime** by `landscape.js`
  (`makeWalk(seed)`), seeded from `(arm, round)` via `config.js` `TRUTH_SEED`: the
  same curve for **every participant of every session**, **different** between the
  two phases, and an **independent** draw per round. `makeWalk` deterministically
  resamples (up to 64 candidates) to **prefer a single tie-free peak** (preferred,
  not enforced). There is **no landscape pool**
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
