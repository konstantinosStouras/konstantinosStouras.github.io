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
JOURNAL_TYPES order in `index.html`), with ONE exception: a journal on both
the UTD24 and FT50 lists shows both tags (`journalBadges`; ABS tags never
stack onto a listed journal). Clicking a badge selects that type. Filtering is unaffected by
the badge: an ABS 4/4* search still returns UTD24 journals' papers.
**Filters chain (AND) and their counts stay connected:** the results bar's
"X of Y" denominator is the journal-scope corpus (`scopeCount`, counted per
applyFilters pass), NOT `allPapers.length` — with FT50 selected, chaining the
pre-print toggle or a search reads "2,787 of 230,089" even when an earlier
broad search left the whole catalog in memory; and `crossFilter()` (dropdown
counts + summary tabs) applies the pre-print toggle like every other filter. The
catalog also carries **notFT extras** — journals on another list but not the
FT50: UTD24's INFORMS Journal on Computing (`ijoc`) and ABS 4's European
Journal of Operational Research (`ejor`) — flagged `"notFT": true` in
`journals.json` so the page keeps them out of FT50 membership and the yearly
FT-list check never retires them. **ABS field scope (deliberate):** the
FT50 and UTD24 lists are covered in full (all fields), but ABS 4/4*/3
coverage beyond them extends ONLY to Operations / Supply Chain / Economics /
Computer Science / Project Management / Innovation-related journals — other
fields' ABS journals are neither harvested nor listed (AJPS/APSR, 4*
political science, were retired under this rule). The catalog grows past this repo's 1 GB Pages limit via
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
grade. The full AJG 2024/2021/2018 grade table is **vendored** at
`fun/lit/_scraper/_abs-ajg2024.json` (journalranking.org is Cloudflare-blocked
for cloud IPs, like the PNAS/editors local scrapers) — it is the offline
reference for auditing every ABS grade the page and the satellite shards use. The pre-computed Authors/Affiliations panels remain
native-eight-sources only (the pre-print backfill, by contrast, covers every
dataset — see below). **PNAS caveat:** the DOI→section index
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
**Pre-print links:** every paper with a free author pre-print on **arXiv,
SSRN, bioRxiv/medRxiv, NBER or OSF** carries a `Preprint` (+ `PreprintSrc`)
field, resolved in `build-data.mjs`
(`resolvePreprints`) and cached in `data/_preprints.json` (doi → `{u,s}` |
`{none:1}` | `{none:1,ts:N}`; incremental). Two passes: (1) OpenAlex **by DOI**
(`seedPreprintsByDoi`, batched 50/call, bounded by `LIT_PREPRINT_DOI_BATCHES`
and OPTIONAL — it stops itself on quota/throttle) reads any pre-print location
already attached to the published record;
(2) a **title+author search** (`searchPreprintsByTitle`, newest-first) across
**three engines sharing one conservative matcher**: OpenAlex title.search
(`matchPreprintWork`) is the widest net but only a **quota-permitting bonus
leg** — OpenAlex cuts an identity off after **~100 title searches/day**, and
on its quota signal the run just drops that leg; the backbone is **Crossref**
(`searchCrossrefPreprints`/`matchCrossrefPreprint`,
`filter=prefix:10.2139,prefix:10.1101,prefix:10.3386,prefix:10.31219` — same-name
filters OR together; SSRN, bioRxiv/medRxiv,
NBER and OSF all mint their DOIs through Crossref, so it has every one of
their records even where OpenAlex has none) plus **arXiv's own API**
(`searchArxivPreprint`/`matchArxivFeed`/`parseArxivAtom`,
`export.arxiv.org/api/query` with `ti:"…" AND au:"…"` — the host Crossref
can't see; free, paced at ~1 req/3 s via `axSleepMs`, and skipped when the
OpenAlex leg ran, since OpenAlex indexes arXiv). A find from any engine wins;
a **miss is stamped `{none:1,ts:TS_VER}` only when the required legs
(Crossref always, arXiv when OpenAlex didn't run) concluded cleanly** — a
transient failure leaves the paper un-stamped so a later run retries.
**arXiv resilience:** arXiv's API frequently rate-limits GitHub-Actions IPs, so
after OpenAlex's daily quota is spent the run would otherwise **stop the whole
title search the moment arXiv drops out** — even though Crossref (the SSRN/NBER
engine, the point of the finance-heavy FT50 catalog) is still healthy. So when
arXiv is down the search **keeps going on Crossref** and stamps a Crossref-only
miss `{none:1,ts:TS_VER,naxiv:1}`; `naxiv` misses stay re-eligible so a later
arXiv-healthy run re-checks them for an arXiv-only pre-print (they graduate to a
plain `{none:1,ts:TS_VER}` once arXiv confirms). Without this, a first-deploy
backfill crawls at ~240 papers/run instead of thousands. Also:
papers with **no cache entry at all are directly eligible** (the by-DOI pass
is an optimisation, not a prerequisite — this is what lets a fresh
250k-paper catalog backfill immediately). Titles match exactly or by
**prefix** (≥14 collapsed chars — working papers often gain/lose a subtitle
on publication; guarded against same-team sequels, see below), always with
the author check. The
search covers **every paper from 1991 on (arXiv's first year), PNAS
included**; `ts` records WHICH search version last missed (`TS_VER` in the
block — **bump it whenever the matcher or host coverage expands** and every
old miss is retried with the wider net, never-searched papers first;
currently v4). arXiv
links are canonicalised to the **unversioned `/abs/<id>`** form
(`canonArxiv`/`canonPreprint`, applied on every apply) so they always resolve
to the LATEST version. The **backfill runs online in its own scheduled
workflow**, `.github/workflows/lit-preprints-backfill.yml` (every 2 h), which
runs `fun/lit/_scraper/preprints-ci.mjs`: the bounded by-DOI seeding, then a
bounded (~40 min) slice of title searches per run,
committing `fun/lit/data/` back — it **shares the
`lit-update-data-*` concurrency group** with the daily build so the two never
race a commit, and its push-retry re-applies finds via
`--apply-only --merge-cache` instead of clobbering a fresher dataset.
`fun/lit/_scraper/preprints-local.mjs` remains as a faster local alternative
(unthrottled from a home connection; identifies as a separate `LIT_MAILTO`
quota identity so CI can never spend the local budget). In the daily build the
same pass also runs as a **strictly time-boxed, gentle best-effort**
(`LIT_PREPRINT_SEARCH_MS`, default 6 min; `LIT_PREPRINT_SEARCH_CAP`, default
2500; single-attempt fetch that drops the OpenAlex leg on quota/throttle and
stops only when Crossref or arXiv are unavailable too) so it can **never
hang the build**. **The same machinery is replicated in every other dataset's
pipeline** (near-verbatim block in each `build-data.mjs`; env names
`FT50_PREPRINT_SEARCH_*`, and the matcher uses a local `matchNorm` — the
reference's fully-collapsing title norm — NOT those files' registry
`normTitle`): the FT50 catalog backfills via
`lit-ft50-preprints-backfill.yml` → `fun/lit/_scraper-ft50/preprints-ci.mjs`
(commits `fun/lit/data-ft50/`, shares the `lit-ft50-update-data-*`
concurrency group), and each shard repo has its own `preprints-backfill.yml`
→ `_scraper/preprints-ci.mjs` (shares that repo's `update-data-*` group).
Every workflow pins a distinct OpenAlex quota identity via mailto
plus-addressing — natives `kstouras@gmail.com`, FT50 catalog `+litft50`,
shards `+abs4`/`+abs3om`/`+abs3rest` (their daily builds use the same
identity) — so the five parallel backfills never starve each other. Because
extras now carry `Preprint` fields, the page's pre-print toggle counts as a
broad trigger in `neededExtraKeys()` (like it always did for natives). Both `pickPreprint` and the matcher are host-validated (real
`arxiv.org`/`ssrn.com`/`biorxiv.org`/`medrxiv.org`/`nber.org`/`osf.io`
hostname) so a spoofed domain can't slip into the href; the matcher demands
an exact normalized-title match + **two shared author surnames** (one only
for single-author records) + a plausible year to avoid wrong links.
Titles may also match by prefix (≥14 collapsed chars) to catch working
papers that gained/lost a subtitle — but a prefix match must be
near-contemporaneous (≤6y older, vs 12 for exact) and never a comment/
reply/corrigendum sibling (`titlesMatch`), or a same-team title-stem SEQUEL
would link the wrong paper's pre-print. The card shows an open-access **"Pre-print (Open Access)"**
link between BibTeX and the sign-in "Notes, tags & lists" toggle; EC's meta-row
PDF tag is suppressed when it duplicates it. **Pre-print links open the PDF
directly, latest version:** at render time `preprintPdfUrl()` in `index.html`
rewrites landing-page hrefs to the PDF itself — SSRN abstract pages
(`papers.cfm?abstract_id=N` / `ssrn.com/abstract=N`) to SSRN's
`Delivery.cfm?abstractid=N&mirid=1` download endpoint (`ssrnPdfUrl`); arXiv
`/abs|pdf/<id>[vN]` to unversioned `/pdf/<id>` = the latest version
(`arxivPdfUrl`); versioned bioRxiv/medRxiv content URLs to `.full.pdf`
(`biorxivPdfUrl`); NBER `/papers/wN` to its direct-PDF path (`nberPdfUrl`);
OSF ids to `/download` (`osfPdfUrl`). Href-only — the datasets keep the
stable landing URLs, so an endpoint change needs only those helpers updated;
applied to both the Pre-print link and EC's PDF tag (link tooltip names the
host via the `PREPRINT_HOST` map).
**DOI-less EC accepted papers** (each year's fresh sigecom.org list, e.g.
EC '26) can't be reached by any by-DOI pass, so `enrichEc` runs a
title-search pass for them (newest first, `LIT_EC_TITLE_CAP` default 350/run,
same three engines + gentle fetch + conservative matcher as the preprint
search; versioned `oat` cache marker — `OAT_VER` — in `_ec-extras.json`), and
a pre-print find is surfaced as
both their `PDF` and their `Preprint` (the DOI-keyed `_preprints.json` can't
serve them). **PNAS "Significance":** for PNAS,
the Crossref abstract's JATS `<sec><title>Significance</title>` block is split
out into a `Significance` field (`extractSignificance`, no pnas.org fetch) and
shown as a **"Significance"** card toggle before "Abstract". See
`fun/lit/_HOW-IT-WORKS.md`. **Citation counts:** every paper carries a
`CitedBy` field — Crossref's `is-referenced-by-count`, harvested for free in
the same batched Crossref requests the build already makes (added to the
`SELECT` array in `build-data.mjs`; set in `mapWork` only when the count is a
positive integer, so it never bloats the papers files or shows a "Cited by 0"
badge). The card renders it as a **"Cited by N · Crossref"** tag next to the
PDF tag, linking (via `scholarSearchUrl` in `index.html`) to a Google Scholar
**title search** (`scholar.google.com/scholar?q=<title>`) — the exact title
lands the paper as the top hit so the user reaches its live GS "Cited by"
count and citing works. Deliberately NOT Google Scholar's own number: there is
no Scholar API, and its exact `?cites=<cluster-id>` link isn't derivable from a
DOI/title, so the count is labelled honestly as Crossref's (a different, lower
metric — GS also counts preprints/theses/working papers). The FT50 catalog's
`_scraper-ft50/build-data.mjs` and each satellite shard repo
(`lit-data-abs4`, `lit-data-abs3-omecon`, `lit-data-abs3-rest`) carry the
identical two-line change in their own vendored `build-data.mjs` (the `SELECT`
addition plus the `mapWork` `CitedBy` line), so counts surface for every
dataset; the page's renderer shows the tag for any paper that carries
`CitedBy`. Like `/fun/ms/`,
the page carries the optional sign-in feature (star/notes/lists/tags, private
per user, dedicated Firebase project); it stays inert until a web config is
pasted into `FB_CONFIG` in `fun/lit/index.html` — setup steps in
`fun/lit/_ACCOUNTS-SETUP.md`, security rules in `fun/lit/_firestore.rules`.

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

**Admin "Test round" (no data logged).** Every session card in `/admin` has a
**🧪 Test round** button that opens the whole participant flow (Welcome →
Registration → Individual → Group → Survey → Done) in a throwaway sandbox tab
using that session's exact config — writing **nothing**: no Firestore, no Cloud
Functions, no LLM cost, no participant records. It is gated by
`?preview=1&key=stouras` (`src/utils/preview.js`); the flag is resolved ONCE from
the initial URL and cached (SPA navigations drop the query). A small façade
`src/utils/db.js` re-exports either the real `firebase/firestore`+`functions`
primitives or, in preview, an in-memory reactive store `src/utils/previewDb.js`
that emulates the ~10 participant-flow files' reads/writes plus the Cloud
Functions they call (`joinSession`, `sendAIMessage` → canned reply) and the one
server trigger that isn't already client-driven (individual → next phase). It is
a **solo** run (group of one, `groupSize` forced to 1 — like search-v2's
single-participant preview); `AuthContext` supplies a synthetic user, the session
config is handed over via `localStorage`, and `<PreviewRibbon/>` shows a constant
"nothing is saved" banner. All participant pages import Firestore/Functions from
`../utils/db` instead of directly, so the swap is transparent in normal use.

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

## `/sustainable-supply-chains` — global sourcing class simulation

`sustainable-supply-chains/` is a class simulation (student teams = competing
e-bike firms sourcing components worldwide) with an instructor panel at
`/sustainable-supply-chains/admin/` in the ideasearchlab admin look. Vanilla
HTML/JS, no build step. Designed to teach: bullwhip (lead times + hidden demand
patterns + pro-rata supplier rationing + service-loyalty brand; measured per
firm over the steady middle of the game), logistics (sea/air cost–CO2–lead
tradeoffs), competition (per-market logit on price/green/brand), tariffs (base
rates + scheduled shocks), sourcing, and CO2/ESG sourcing (embodied CO2,
supplier ESG + audits + scandals, carbon tax, offsets — net vs gross).
Two play modes: **live** (instructor-paced shared market) and **async
practice** (`settings.asyncMode`): each firm plays its own private self-paced
game vs `asyncBots` optimal opponents — Nash-equilibrium logit pricing +
base-stock ordering under rational expectations (`nashDecisions` in engine.js).
The async instance lives in the `async/{firmId}` subcollection and is resolved
in the student's browser; the admin control room becomes a progress monitor.
'nash' is also a bot profile for live sessions; the debrief excludes nash bots
from the order-amplification chart (their variability is anticipation).
Every action is appended to an admin-only `events` subcollection (timing:
seconds-to-submit, saves, round opens/resolves, session duration); the admin
panel's **Analytics** tab loads several sessions via `store.fetchAll` and
computes per-firm efficiency KPIs + summary stats + Excel/CSV export.
Automatic coaching (`settings.coachOn`): engine-level `coachDecision`
(decision-time nudges) + `coachResult` (post-round feedback benchmarked
against Nash pricing and order-up-to coverage). Messaging
(`settings.chatOn`): firm↔instructor and firm↔firm messages in a `messages`
subcollection — all traffic is visible in the admin control room (stated in
the student UI).

Key structure (see its README.md for the full model):
- `engine.js` — pure deterministic engine (seeded per session code + round;
  also runs in Node). ALL game math lives here; the admin browser resolves
  rounds with it. `config.js` holds the default catalog/settings copied into
  each session (admin-editable per session, incl. the catalog JSON).
- `store.js` — one storage API, two backends: Firebase (lazy CDN SDK v10;
  anonymous students + email/password admin; sessions under `sscSessions`,
  code→id lookups under `sscSessionCodes`) or a zero-setup localStorage DEMO
  mode with cross-tab sync (active while `firebase-config.js` holds `PASTE_…`
  placeholders — the current state). `firestore.rules` enforces firm ownership
  via each firm doc's `memberUids`; keep its `isAdmin()` email list in sync
  with `SSC_ADMIN_EMAILS` in `firebase-config.js`.
- Tests that must stay green: `node sustainable-supply-chains/tools/selftest.js`
  (engine, 75+ checks incl. full bot/Nash games and the coach) and
  `node sustainable-supply-chains/tools/smoke.mjs` (Playwright, plays a whole
  demo game across admin + student tabs; container paths overridable via
  `PW`/`CHROMIUM`). `tools/smoke-firebase.mjs` additionally verifies the REAL
  Firebase path + firestore.rules against the Firebase emulator (needs Java,
  firebase-tools and the npm `firebase` bundles via `FIREBASE_BIN`/
  `FIREBASE_SDK_DIR`) — run it whenever store.js or the rules change.

**Test round (no data logged).** The admin's create form has a **🧪 Test round
(nothing saved)** button, and every session card a **🧪 Test** button, that open
a private sandbox tab at `?preview=1` (`&fresh=1` seeds it from that session's
settings). In preview, `store.js` returns an **isolated** copy of the demo
backend keyed to a separate, resettable `ssc-preview-*` localStorage namespace —
never Firebase, never the real session list/exports/analytics — so the whole
game (admin control room + student tabs, cross-tab synced, bots and all) runs
end to end and writes no real data. A constant `.preview-ribbon` banner and a
`banner-warn` note make the sandbox obvious. `resetPreview()` wipes it on each
fresh launch. Verified by `tools/smoke.mjs` (unchanged normal game) plus an
isolation check that the sandbox wins over a configured Firebase and never
touches `ssc-db-v1`.

The app is at the repo root (NOT under `/fun/`), so the fun-landing-page card
rule does not apply; it is deliberately not linked from the homepage yet.
