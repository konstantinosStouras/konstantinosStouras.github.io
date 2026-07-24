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
`portfoliofitgame` · `capitals` · `nomoi` · `rooks` · `sudoku` · `snake` ·
`ms-old` · `mnsc_scraper-to-use-locally` (plus redirect stubs at `fun/ms/`,
`fun/ms2/`, `fun/ft50/` and `fun/lit/` — the retired Management Science browser,
the retired FT50 browser and the graduated Lit all now redirect to `/lit/`).

**The Lit moved OUT of `/fun/`.** It was promoted from `fun/lit/` to the
top-level `/lit/` (served at `stouras.com/lit/`; see its own section below).
`fun/lit/` now holds only noindex redirect stubs (`fun/lit/index.html` and
`fun/lit/analytics/index.html`) pointing to `/lit/` and `/lit/analytics/`, so old
links keep working (like `fun/ms2/`/`fun/ft50/`). It is still featured on the Fun
landing page — its `fun/index.html` card links to `/lit/` — so it is the one card
whose target lives outside `/fun/`; keep that card's link pointing to `/lit/`.

## `/fun/ft50` — RETIRED (redirect stub only)
The standalone FT50 research paper browser was removed: `/lit/` is a
superset (its "Journal types" filter covers all 50 FT50 journals from lit's
own `lit/data-ft50/` dataset — see the lit section below). `fun/ft50/`
now holds only a noindex redirect stub to `/lit/` (like `fun/ms2/`), so
old links keep working; do not add a card for it on `fun/index.html`. The
app's data (~190 MB), scraper and its two workflows (`ft50-update-data.yml`,
`ft50-check-list.yml`) were deleted — the pipeline lives on, vendored at
`lit/_scraper-ft50/` with its own `lit-ft50-*` workflows.

## `/lit` — "The Lit", the multi-journal research paper browser
Served at `stouras.com/lit/` (a **top-level** directory, `lit/`, NOT under
`/fun/`; promoted from the old `fun/lit/`, which is now a redirect stub). The app
uses **relative** data paths (`./data/`, `./data-ft50/`, …), so it is
location-independent; only absolute links/meta (canonical, og:image, the `?db=1`
sqlite loader, `changelog.json` URLs) and the CI workflow paths are pinned to
`/lit/`.
`lit/` extends the `/fun/ms/` architecture to ten sources: Management
Science (with editors/areas, exactly like `/fun/ms/`), Operations Research,
Marketing Science, M&SOM, Information Systems Research, Strategy Science
(INFORMS; ISSNs 2333-2050/2333-2077, Articles in Advance, graded ABS 3 in
`ABS_RATING`), INFORMS Transactions on Education
(INFORMS; open-access, eISSN 1532-0545, Articles in Advance, unrated by ABS —
a native journal like PNAS/ACM EC), POM, PNAS (five topic
sections only), and the ACM EC conference (1999–present, incl. each year's
accepted-papers list from `ec<YY>.sigecom.org` with arXiv/SSRN/OA PDF links via
OpenAlex/DBLP/Semantic Scholar). **EC accepted-papers scraping is cadence-gated:**
each edition's `ec<YY>.sigecom.org` list is posted once (≈May–June) then frozen,
so the parsed lists are cached in `data/_ec-sigecom.json` and — from 2027 on —
only re-scraped live inside the **1 May–30 June** window, and only for the
current/upcoming edition (`sigecomShouldFetchLive`/`EC_SIGECOM_WINDOW_FROM_YEAR`
in `build-data.mjs`); every other daily run serves the cache instead of polling
sigecom year-round (an uncached year is fetched once to seed it, so the gate
never drops an already-captured list). **EC PDF enrichment is likewise frozen
per edition:** each 2020+ DBLP table-of-contents is cached in
`data/_ec-dblp-modern.json` and only the current/upcoming edition (or an
uncached year) is re-pulled — a past edition whose papers already carry PDFs
triggers no DBLP traffic (the per-paper OpenAlex/S2 lookups and the pre-print
search already skip resolved rows), so a fully-captured past edition is not
re-fetched. Data is static JSON in `lit/data/` (one
`papers-<src>.json` per source + `sources.json` manifest), built by
`lit/_scraper/build-data.mjs` and refreshed daily by
`.github/workflows/lit-update-data.yml` (same self-healing live-site check as
the ms workflow). **Fast new-paper pickup (incremental harvest):** the full
daily build re-pulls every journal's ENTIRE Crossref back-catalogue, so it can
only run once a day; on top of it, `build-data.mjs --incremental`
(`incrementalMain`) runs **every 15 minutes** via
`.github/workflows/lit-check-new.yml` and asks Crossref for only the records it
(re)indexed in the last few days (`filter=from-index-date`, `LIT_INCR_LOOKBACK_DAYS`
default 4) for the **eight Articles-in-Advance journals only** (ms/opre/mksc/msom/
isre/stsc/ited/pom — PNAS needs the Cloudflare-blocked local section index and ACM EC's list
is heavy + rarely changes, so both are carried through unchanged but still counted
and eligible for `recent.json`). It **upserts** into the committed
`papers-<key>.json` (appends genuinely-new DOIs; for a known DOI refreshes only
core bibliographic fields — the Articles-in-Advance→issue transition — while
PRESERVING enrichment: `Preprint`/`PreprintSrc`, an OpenAlex/S2-boosted `CitedBy`
+ `CitedBySrc`, and cached SE/AE via the offline `applyInformsEditors` overlay;
`CitedBy` only ever rises), then rewrites ONLY the small derived files
(`recent.json`/`meta.json`/`sources.json`/`_registry.json`) — `authors.json`/
`affiliations.json` are left to the daily build, which alone has the ORCID data
for faithful author merging. **New-paper enrichment on arrival:** the pass also
runs a strictly-bounded, non-fatal pre-print + citation lookup **on ONLY the
just-added rows** (`freshRows` — `resolvePreprints`/`refreshCitations` with tight
budgets: `LIT_INCR_PREPRINT_MS` 2 min / `LIT_INCR_CITATIONS_MS` 90 s; disable with
`LIT_INCR_ENRICH=0`), so a new Article in Advance shows its `Preprint` link and
`CitedBy` count from first appearance instead of waiting for the 2-hourly
pre-print backfill / daily citations sweep. It reuses the SAME OpenAlex/Crossref/
arXiv identities (module `MAILTO`) and the same frozen-link / 2-day-freshness
cache logic, so it adds no quota pressure beyond those few DOIs; the **steady-state
rolling sweeps stay the coverage engine for the whole corpus** (they are already at
their effective ceiling — bound by OpenAlex's ~100/day title-search and 100k/day
general quotas + the 2-day citation-freshness dedup, NOT by schedule, so running
them more often can't beat a per-day cap and would only starve the shared
concurrency group). It **writes nothing when nothing new arrived**, so it
commits (and redeploys Pages) only on a genuine change — that plus **sharing the
daily build's `lit-update-data-${{ github.ref }}` concurrency group** (so it never
races a papers-file push/Pages deploy against the daily build, a pre-print backfill
or the citations job — overlapping fires queue and coalesce) is what makes a
15-minute cadence non-degrading. No live-site self-heal here (the daily build has
one); a rejected push re-runs the idempotent incremental pass against the fresh
tip. Offline test: `node lit/_scraper/incremental-selftest.mjs` (mock, no network).
NOTE: this build env's egress blocks Crossref (403), so the incremental pass only
does real work on the GitHub Actions runners. **Journal types & the FT50 merge:** a "Journal types"
filter (left of Journals) offers UTD24 / FT50 / ABS 4/4* / ABS 3; a type chip
expands to its journal set and unions with the Journals selection. Each paper
card carries a small **badge left of its title** showing the single MOST
selective list its journal belongs to (UTD24 > FT50 > ABS 4/4* > ABS 3 —
JOURNAL_TYPES order in `index.html`), with ONE exception: a journal on both
the UTD24 and FT50 lists shows both tags (`journalBadges`; ABS tags never
stack onto a listed journal). Clicking a badge selects that type. Filtering is unaffected by
the badge: an ABS 4/4* search still returns UTD24 journals' papers.
**Text-search filters** are Authors, Title, **Abstracts** (full-text over each
paper's `Abstract`), and Affiliations — each a live input plus Enter-to-chip,
sharing `textMatch` (substring by default; a `"quoted"` term is an exact
word/phrase, word-boundary match) except Authors, which uses `authorMatch`
(prefix-of-a-name-part). All are `sel.<type>` Sets chained AND with every other
filter; a paper with no abstract on record can't match an abstract query.
**Filters chain (AND) and their counts stay connected:** the results bar's
"X (P%) of Y" denominator is the journal-scope corpus (`scopeCount`, counted
per applyFilters pass), NOT `allPapers.length` — with FT50 selected, chaining
the pre-print toggle or a search reads "2,787 (1.21%) of 230,089" even when an
earlier broad search left the whole catalog in memory; and `crossFilter()` (dropdown
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
lit's **own FT50 catalog** at runtime — `lit/data-ft50/` (seeded from the
retired fun/ft50 app's data, registry included, then maintained here):
it fetches `data-ft50/sources.json`, appends the 44 FT50-only journals to the
journal filter, and **lazy-loads** their `papers-<key>.json` only when they
enter scope — selected directly, via a type chip, or on a broad
year/title/author/affiliation search with no journal scope; the
`data-ft50/recent.json` (extras only) joins the recent view. The dataset is
built by `lit/_scraper-ft50/` (the retired fun/ft50 app's pipeline,
vendored; journal list in its own `journals.json`), refreshed daily by
`.github/workflows/lit-ft50-update-data.yml` (07:15 UTC) and checked against
the FT's list yearly by `lit-ft50-check-list.yml` (4 Jan). **Fast new-paper
pickup for the FT50 catalog** works like the native `lit-check-new` pass:
`_scraper-ft50/build-data.mjs --incremental` (`incrementalMain`) runs **every 20
minutes** via `.github/workflows/lit-ft50-check-new.yml`, asking Crossref for only
the records (re)indexed in the last few days (`filter=from-index-date`,
`FT50_INCR_LOOKBACK_DAYS` default 4) for a **small configured subset**
(`FT50_INCR_JOURNALS`, default **`ecta`** = Econometrica only). It upserts into
`papers-ecta.json` (appends new DOIs; for a known DOI refreshes only core
bibliographic fields, PRESERVING enrichment — `Preprint`/`CitedBy`+`CitedBySrc`),
then rewrites only the small derived files, doing a **lean recent.json merge** —
the polled journals' fresh rows unioned with the last build's recent rows for
every OTHER journal (correct because it and the daily build are the only
data-ft50 writers and share the `lit-ft50-update-data-${{ github.ref }}`
concurrency group, so nothing else changed) — instead of reloading all ~50 papers
files. It **writes nothing when nothing new arrived**. Why only Econometrica:
lit's own `lit-check-new` already fast-tracks the eight native INFORMS/SAGE AIA
journals, and Econometrica is the one requested journal that lives ONLY in the
FT50 catalog AND whose publisher assigns an accepted paper straight to a future
issue — so Crossref never lists it as a no-volume advance article and the daily
build was otherwise the only thing that ever picked it up (up to a day late).
Offline test: `node lit/_scraper-ft50/incremental-selftest.mjs` (mock, no
network; adds an `ecta` fixture, `mock/crossref-ecta.json`). NOTE: this build
env's egress blocks Crossref (403), so the incremental pass only does real work
on the GitHub Actions runners. AIA fixups for the catalog come from
`informs-aia-local.mjs --app lit-ft50`; **Econometrica FORTHCOMING papers**
(accepted, not yet in an issue — Crossref never shows these) are scraped from the
Econometric Society's own forthcoming-papers page by the LOCAL
`lit/_scraper/econometrica-forthcoming-local.mjs` (econometricsociety.org can
block cloud IPs, like pubsonline/pnas — so it runs locally, reads the standard
`citation_*` meta the Drupal site emits, and `--dry-run`/`--selftest` guard it),
which writes `jkey:"ecta"` rows into the shared `data-ft50/_informs-aia.json`
supplement that the daily build's `mergeSupplement` folds in (superseded by DOI
once Crossref catches up). FT50 membership is seeded statically
in `index.html` and extended from the data-ft50 manifest (so the yearly
FT-list check flows through); ABS grades (AJG 2024, via journalranking.org)
live in the `ABS_RATING` map there — PNAS/ACM EC are unrated, and HBR/MIT SMR
(AJG 2024 "top practitioner" journals) are kept at 3, their last numeric
grade. The full AJG 2024/2021/2018 grade table is **vendored** at
`lit/_scraper/_abs-ajg2024.json` (journalranking.org is Cloudflare-blocked
for cloud IPs, like the PNAS/editors local scrapers) — it is the offline
reference for auditing every ABS grade the page and the satellite shards use. The pre-computed Authors/Affiliations panels remain
native-eight-sources only (the pre-print backfill, by contrast, covers every
dataset — see below). **PNAS caveat:** the DOI→section index
`lit/data/_pnas-concepts.json` must be (re)built occasionally by running
`lit/_scraper/pnas-concepts-local.mjs` on a personal machine, because
pnas.org's search is Cloudflare-blocked for cloud IPs. **ISR/MkSc caveat:**
likewise, ISR Senior/Associate Editor and Marketing Science Senior Editor
names (`lit/data/_informs-editors.json`) come from
`lit/_scraper/informs-editors-local.mjs` run locally (pubsonline blocks
cloud IPs too) — until that cache is first committed, only the few papers
whose Crossref abstract/assertion carries the History line have SE/AE.
When even a local Node run is Cloudflare-blocked (its TLS handshake is
fingerprinted — a valid cf_clearance + matching UA can still fail),
`lit/_scraper/informs-editors-console.js` is the fallback: pasted into the
DevTools console ON pubsonline.informs.org, it harvests same-origin inside
the real browser (resumable via localStorage, seeds from master's committed
cache, downloads a byte-compatible `_informs-editors.json` to commit). Its
parser is VENDORED from informs-editors.mjs — keep in sync; the selftest
parity-checks the two on every fixture.
Extraction is shared in `lit/_scraper/informs-editors.mjs`:
`parseInformsEditors` (the History-line parser — "Name, Senior Editor"
lists, "Accepted by …", "served as …", elided-verb pairs, inverted
"Accepted by Senior Editor Name", colon forms) and `editorsFromPageHtml`
(the local scraper's whole-page scan: a window around EVERY "History:"
label and Senior/Associate-Editor mention, block-boundary `;` separators so
an adjacent fragment can't bleed into a name — the old single 500-char
window truncated long dated History lines). `build-data.mjs` also parses
any editor-labelled Crossref ASSERTION for ISR/MkSc (role-labelled bare
names accepted), mirroring MS's accepted-by assertion path. Offline test:
`node lit/_scraper/informs-editors-selftest.mjs`. ISR/MkSc paper cards
render clickable `SE:`/`AE:` chips (like the MS editor chip) for every row
carrying the data. Editors/Areas UI shows only when Management Science is
in scope; SE/AE filters show when ISR/MkSc are selected. **Articles-in-Advance
caveat:** a no-volume/no-issue record is tagged forthcoming only when recent
(`forthcomingStatus`); `data/_aia-fixups.json` supplies the real issue for older
frozen records and `data/_informs-aia.json` adds forthcoming papers Crossref
misses, both refreshed locally by `lit/_scraper/informs-aia-local.mjs`.
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
runs `lit/_scraper/preprints-ci.mjs`: the bounded by-DOI seeding, then a
bounded (~40 min) slice of title searches per run,
committing `lit/data/` back — it **shares the
`lit-update-data-*` concurrency group** with the daily build so the two never
race a commit, and its push-retry re-applies finds via
`--apply-only --merge-cache` instead of clobbering a fresher dataset. **The
daily builds (`lit-update-data.yml`, `lit-ft50-update-data.yml`) do the same on
a rejected push** — they overlay the tip's `_preprints.json` onto their fresh
harvest (`--apply-only --merge-cache`) so a concurrent backfill's pre-print
links are never downgraded back to `{none}`; a found `{u}` link is FROZEN
(a published paper's pre-print never changes) — never re-searched (the by-DOI
and title-search passes both skip `{u}`) and never clobbered at commit time.
`lit/_scraper/preprints-local.mjs` remains as a faster local alternative
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
`lit-ft50-preprints-backfill.yml` → `lit/_scraper-ft50/preprints-ci.mjs`
(commits `lit/data-ft50/`, shares the `lit-ft50-update-data-*`
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
`lit/_HOW-IT-WORKS.md`. **Citation counts:** every paper carries a
`CitedBy` field — the **highest of three tallies**: Crossref's
`is-referenced-by-count` (harvested for free in the build's own batched
Crossref requests — the `SELECT` addition + `mapWork` line in
`build-data.mjs`; the floor, set only when positive so it never bloats the
papers files or shows a "Cited by 0" badge), OpenAlex's `cited_by_count` and
Semantic Scholar's `citationCount` — the latter two index citing
preprints/proceedings/books, so they sit much closer to Google Scholar's
number. The OpenAlex+S2 sweep (`refreshCitations`/`applyCitations` in
`build-data.mjs`, replicated near-verbatim like the pre-print machinery) is
batched — OpenAlex 50 DOIs/call via `filter=doi:` + `select=doi,cited_by_count,authorships`
(general 100k/day quota, NOT the ~100/day title-search cut-off), Semantic
Scholar 500 DOIs/POST (`graph/v1/paper/batch`; its anonymous pool 429s
freely, so the leg is optional and drops out while OpenAlex carries on) —
into each data dir's incremental `_citations.json`
(`doi → {c, t:<day-checked>, s2:1?, au?}`; `c` omitted when 0). **Author
backfill:** the same OpenAlex call also reads `authorships` for records whose
**Crossref harvest deposited no authors** (7–9% of the catalog — older DOIs and
certain publishers, e.g. Econometrica/JPE/JoF) and caches a fallback author
string in `au`; `applyCitations` fills the empty `Authors` with it (rolling, so
it self-heals over the sweep's cadence) and **never overwrites** a
Crossref-provided list. This is what lets the "Citing references in this catalog"
panel show authors for those papers too. The refresh is
ROLLING (never-checked DOIs first, then stalest; entries fresh for
2 days; partial coverage never regresses a cached count) and runs
two-part like the pre-prints: strictly time-boxed inside each daily build
(`LIT_CITATIONS_MS`/`FT50_CITATIONS_MS`, default 5 min — new papers get a
count on day one) plus a dedicated daily ~45-min workflow per dataset —
natives `lit-citations-update.yml` → `_scraper/citations-ci.mjs`, FT50
catalog `lit-ft50-citations-update.yml` → `_scraper-ft50/citations-ci.mjs`,
and each shard repo its own `citations-update.yml` → `_scraper/citations-ci.mjs`
— each sharing its dataset's update-data concurrency group (push-retry via
`--apply-only --merge-cache`, newest-check-wins merge) and pinning its own
OpenAlex mailto quota identity (`+litcite`, `+litft50cite`, `+abs4cite`,
`+abs3omcite`, `+abs3restcite`). `applyCitations` lifts `CitedBy` to the max
and stamps **`CitedBySrc`** (`oa` | `s2`; absent = Crossref) — the card's
`citedByTagHTML` in `index.html` renders just **"Cited by N"** (kept
uncluttered; the source — OpenAlex/Semantic Scholar/Crossref, from
`CitedBySrc` — is named only in the hover **tooltip**, not the visible
label), linking (via `scholarSearchUrl`) to a Google
Scholar **title search** (`scholar.google.com/scholar?q=<title>`) — the exact
title lands the paper as the top hit so the user reaches its live GS "Cited
by" count and citing works. Deliberately NOT Google Scholar's own number:
there is no Scholar API, scraping it is blocked/ToS-barred at any scale, and
its exact `?cites=<cluster-id>` link isn't derivable from a DOI/title — so
the tooltip names its real source honestly and defers to Scholar via the link.
The page shows the tag for any paper that carries `CitedBy`, so older shard
data (no `CitedBySrc` yet) just renders as Crossref until its pipeline
catches up. Like `/fun/ms/`,
the page carries the optional sign-in feature (star/notes/lists/tags, private
per user, dedicated Firebase project); it stays inert until a web config is
pasted into `FB_CONFIG` in `lit/index.html` — setup steps in
`lit/_ACCOUNTS-SETUP.md`, security rules in `lit/_firestore.rules` (deployed
from `lit/` — `lit/firebase.json` + `lit/.firebaserc` are the Firebase-CLI
config for BOTH the rules and the `_functions` Cloud Function; the CLI requires
every referenced path inside the config's own directory, so the config lives at
their common parent `lit/`, NOT in `lit/_functions/`).
**ORCID (two features, one ORCID API client — `lit/_ORCID-SIGNIN-SETUP.md`):**
(1) *Connect your ORCID* — a signed-in user links their iD (first-run invite
modal or Edit profile) and the account menu gains two DIRECT links (no modal
in between): "My publications" → `./?author=<match name>` and "My author
analytics" → `analytics/?author=<match name>`
(`acctGoMyPublications`/`acctGoMyAnalytics`, both via `orcidMatchName`);
ORCID management lives INSIDE the Edit-profile card (connected-account
pattern): linked accounts show the iD chip + ✓ verified + Disconnect
(`#pfOrcidLinked`), a "Name we match your papers by" field saved with the
profile (empty = back to the credit-name default) and the consent toggle,
while unlinked ones keep the entry input + "Sign in with ORCID" button; the
old modal now serves only the first-run connect invite, and both connect
flows land on the profile card; besides typing the iD
(ISO 7064-validated, `normOrcid`), the connect stage offers **"Sign in with
ORCID"** — ORCID's OIDC *implicit* flow run wholly client-side
(`ORCID_OAUTH` config + `litOrcidSignIn`/`readOrcidOAuthResponse`/
`maybeApplyOrcidPending`; CSRF `state` nonce in sessionStorage; saves
`orcidVerified:true`, shown as "✓ verified"), ACTIVE with public client-id
`APP-VWG4YW59MEUCRQE2`. (2) *Register/sign in WITH ORCID* — an `orcid` entry
in `PROVIDER_DEFS` (Firebase generic OIDC provider **`oidc.orcid`**) puts
"Continue with ORCID" on the auth modal; on first sign-in
`maybeSeedOrcidFromProvider` auto-links the verified iD from the OIDC `sub`
(= providerData uid), exactly once per account (gated on
`!orcid && !orcidPromptSeen`, so a later unlink is respected). ACTIVE: the
Firebase project runs Identity Platform with the `oidc.orcid` OIDC provider
enabled (code flow; client secret lives ONLY in the console) and `'orcid'`
is in `AUTH_PROVIDERS` (flipped together with its changelog entry + About
copy, per the keep-in-sync discipline). **The match name defaults to ORCID's
credit-name** (Published Name — how journals actually credit the author;
given+family can drop a middle initial and match nothing):
`backfillOrcidAuthorName` fetches it from the public `pub.orcid.org` record
whenever a linked profile's match name isn't user-owned (auto names carry
`orcidNameAuto: true` and stay upgradeable — a legacy stored given+family
form is healed to the credit-name; a user-typed name is marked
`orcidNameAuto: false` and never overwritten; priority credit-name → the
catalog's own ORCID-resolved canonical spelling via `litCatalogCanonicalName`
→ given+family → sign-in claims; live-refreshes an open profile card). The
analytics page's `resolveAuthor` matches name-parts too (unique hit only), so
`analytics/?author=Konstantinos Stouras` finds the credited
"Konstantinos I. Stouras". **Duplicate-account merge:** an ORCID-only
registration by someone who already had an e-mail/Google account is repaired
from the duplicate's Edit profile → "Merge this account into my main account"
(`acctStartMerge` exports library/lists/alerts/profile, unpublishes its public
lists, deletes the duplicate sign-in, then `maybeApplyMergeStash` imports into
whichever account signs in next — papers union starred/tags/lists/notes,
profile fill-empty, ORCID fields only on no-iD-or-same-iD); prevention is
provider LINKING — a verified-ORCID account attaches `oidc.orcid` via
`acctLinkOrcidProvider` (Edit profile) so "Continue with ORCID" reaches it
directly; and DETECTION — each session (once the papers/lists snapshots land, since
the auto-merge export reads them) claims `orcid:<iD>` / `email:<sha256>`
keys in the `accountKeys` collection (`maybeClaimAccountKeys`; rule in
`_firestore.rules`, signed-in read, own-uid writes). A conflicting key
**auto-runs the merge** on the ORCID-only duplicate (`acctStartMerge(true)`
— no confirmation, per the owner; the kept account finishes the import on
its next sign-in), is silently **reclaimed** by an account that verifiably
holds the identity (verified ORCID / own auth e-mail —
`handleAccountKeyConflict`; this heals the stale ghost-claim nag after a
merge, and `maybeApplyMergeStash` also reclaims the merged-away account's
keys on import), and shows a pointer only on an account holding the
identity unverified. Inert until the rules are redeployed. Independently of the
stored name, **the `?author=` deep-link chip is widened to the catalog's full
`Name_Variants`** once authors.json is available (`litUpgradeAuthorDeepLink`;
the deep-link auto-fetches authors.json; when no exact variant matches it
falls back to a UNIQUE whole-name-part match, mirroring the analytics page's
`resolveAuthor` — so `?author=Konstantinos Stouras`, the ORCID given+family
form, still finds the credited "Konstantinos I. Stouras") — so ANY author's
page finds papers credited under any spelling. **Identity chips match
exactly:** the `sel.authorIdentity` filter compares each comma-separated
credited author name for (folded) EQUALITY with a variant (`identityMatch` in
`index.html`, diacritic/apostrophe-folded via `nameFold` like `authorMatch`)
— never substring/prefix, so "Xin Chen"'s page can't list "Yuxin Chen"'s
papers. Clicking the account chip on an `?author=`
page pops out the account menu like everywhere else, with a "Back to The Lit"
link to `stouras.com/lit/` as its first item (`acctUserChipClick`/
`acctOnAuthorPage`; the chip used to navigate home directly, which read as a
dead click while the author page's all-journal load kept the main thread
busy — and the mid-restore hint chip, which has no menu yet, QUEUES the
menu-open via `acctWhenSignedIn` instead of navigating, since the old
home-navigation fallback silently discarded the page's filters, e.g. a
running author search). Removing the author chip (or Clear) retires the
deep-link — `clearAuthorDeepLink` strips `?author=` from the URL and drops
the flag, so a reload can't resurrect the heavy all-journal author load.
The menu's "My publications" carries a **badge with the user's paper count**
(`litMyPubCount` resolves the match name in the Authors index — fetching it
once if uncached — and `maybeCacheMyPubCount` caches it as profile
`myPubCount`, which the sub-pages' shared card reads; cleared on unlink).
**Sign-in invariant:** a signed-in user is never shown the
sign-in modal again — `acctOpenAuth` no-ops when signed in, the header
paints from the `litAuthHint` localStorage cache while the session restores
(`authResolved`), and account actions clicked during the restore window
(star, notes panel) are queued by `acctWhenSignedIn` and run when auth
resolves instead of bouncing to the modal. A companion `litProfHint` cache
(uid-keyed; orcidLinked + match name + myPubCount, written on every profile
snapshot) keeps the account CARD identical while the profile snapshot is
still loading — the ORCID menu items/badge never vanish mid-load — and
guards the first-run ORCID invite: `maybeOrcidPrompt` never fires when the
hint says the account is linked (a first snapshot served from a stale
Firestore cache must not re-ask for an iD we have), and a false invite
already open is closed by onData the moment the real profile shows an iD.
Signed-in users can also save **default filters** (account menu →
"Default filters"): a preferred subset of journals and/or journal types,
**auto-applied on sign-in** so they land on their subset instead of the full
catalog (distinct from E-mail alerts, which saves filters to get *e-mailed*
about new matches — this pre-applies them to the *page* on entry). **Editorial
dimensions too:** exactly like the main filter bar, the modal reveals editorial
pickers when their journal is chosen — Management Science → Accepting Editor +
Area, ISR → Senior + Associate Editor, Marketing Science → Senior Editor
(`renderPrefEditorial`/`prefEdDims`/`prefEdSourceKeys`); each picker's value list
is derived from the SAME loaded, normalized papers the main page filters on
(`p._editors`/`_area`/`_se`/`_ae` after `normalizeEditors`+`fuzzyMerge`), so a
saved value always matches `sel.editor/area/se/ae`. Pickers are **collapsed +
load-on-demand** (a "Choose …" button; `prefEdEnsureData` calls `loadNativeSource`
only when opened, so merely *ticking* MS never force-downloads its ~20 MB file —
only opening its editor/area picker does; a picker with a saved value
auto-expands). Unticking a journal prunes its editorial drafts. It's stored on
the profile doc (`defaultJournals[]`, `defaultJTypes[]`, `defaultEditors[]`,
`defaultAreas[]`, `defaultSE[]`, `defaultAE[]`, `autoApplyFilters`;
written with `{merge:true}`, no rules change) and applied by
`maybeAutoApplyPrefs()` → `applyDefaultFilters(journals, jtypes, {editor,area,se,ae})`
in the accounts script — guarded by `prefsAutoApplied`
so it runs once per session (latched at first profile load, so a "not now"
decision — user mid-browse, or a Save whose write echoes a snapshot back — is
also final) and **never overrides filters the user set themselves** (applies
only when their live selection is still empty). It is undone on sign-out
(`autoAppliedActive` → `clearFilters()`), so a signed-out visitor sees the
**site default** again (see below) and the next user's own defaults aren't
blocked by leftovers. Auto-applying a catalog (FT50/shard) journal before its
lazy manifest arrives is fine: `registerExtraSources()` re-applies and refreshes
the chip label (and the open modal's list) once the journal registers.
**Site default filters (every new visitor):** with no personal defaults, the
page lands the visitor on a **built-in default filter set** — Journal =
**Management Science**, Area (MS) = **"entrepreneurship and innovation"**
(`LIT_SITE_DEFAULT_JOURNALS`/`LIT_SITE_DEFAULT_AREAS` + `applyLitSiteDefault()`
in the main script, `window.litSiteDefaultApplied`/`litSiteDefaultActive` guards).
It applies once per session and ONLY while the live selection is empty, so it
never overrides a user's own filters; typing any text search over the
untouched site default **drops its chips first**
(`litDropSiteDefaultForSearch`) so a first-touch author/title search isn't
AND-chained into a baffling 0, and the sign-in/out `clearFilters` runs only
while the live selection still equals the auto-applied snapshot
(`litFilterSig`/`litAutoSig`), so filters the user edited on top of a default
survive an auth change. Wiring: for an **anonymous** visitor the
accounts `onAuthStateChanged` else-branch applies it; for a **signed-in** user
with NO saved personal defaults, `maybeAutoApplyPrefs()` falls back to it (a user
WITH personal defaults gets theirs; a user who turned `autoApplyFilters` off gets
neither). **A DELIBERATE empty default overrides the site default:** a user who
opens Default filters, picks nothing and Saves (auto-apply on) is stamped
`defaultFiltersSet:true` (`savedDefaults().explicit`), and on sign-in
`maybeAutoApplyPrefs` LATCHES the site-default once-guard
(`window.litSiteDefaultApplied = true`) and returns — so they land on the FULL
catalog, not MS + area, and no later path (e.g. `litExitShared`) can re-seed it.
This distinguishes an explicit "search everything" choice from a never-configured
account (no `defaultFiltersSet` → still gets the site default); the guard is
re-armed on any auth change so a signed-OUT visitor still sees the site default.
`acctSaveDefaults` writes the flag `true`, `acctClearDefaults` writes it `false`.
When the **accounts system is off** (`window.LIT_ACCOUNTS_ENABLED ===
false`), `loadData()` applies it directly. It is cleared/re-armed on any auth
change alongside the personal defaults (`litSiteDefaultActive` joins
`autoAppliedActive` in the sign-out `clearFilters()` path). So a signed-in user
overrides it by saving their own **Default filters**; the area part of the
site default isn't editable via that modal (journals/types only) — to change the
site default itself, edit the two `LIT_SITE_DEFAULT_*` constants.
**Keep the About page in sync:** the **About** page (`lit/about/index.html`) is
the user-facing tour of what The Lit does. It was **promoted from an in-app modal
to a standalone page** (`stouras.com/lit/about/`) that shares an identical claret
header with the Data Analytics page (`.brand` logo → back to the database; a
`.pnav` with an active **About** / **Data Analytics** button — the active one
toggles back to the database, mirroring the main-page top nav; see `.pnav-btn` in
both files). **Whenever you add or materially change a user-facing `/lit` feature,
update the About page's copy in the same change** (e.g. a new journal type, a new
filter, a sign-in/library capability, an alerts option, a Data Analytics view) so
it never drifts from what actually ships — the same keep-in-sync discipline as the
`fun/index.html` landing-page cards. Its "What's new" list is rendered from
`../changelog.json` (the same single source the main page's alert preview and the
mailer use). The main page links to it (`about/`) from the top-nav **About**
button and the footer; the old modal (`#litAboutOverlay`) was removed.
**Top navigation (in the claret header):** three link buttons — **About** (a link
to the standalone page `lit/about/` describing what the browser covers, how to
search, and the full data/provenance notes, mirroring the footer text),
**Data Analytics** (a link to the sub-page `lit/analytics/` — a sub-page, so NOT a
`fun/index.html` card), and **Feedback** (a link to the standalone page
`lit/feedback/`). **E-mail alerts moved OUT of the top nav into the account menu**
(the account dropdown → "✉️ E-mail alerts", via `acctOpenAlerts`, with a badge of
the user's alert count) — it needs an account anyway. About, Data Analytics and
Feedback are all standalone pages that share the same claret header + `.pnav`
(About / Data Analytics / Feedback), each cross-linking the other two.
**Feedback (`lit/feedback/`)** is its own page (was an in-modal contact list):
a form where anyone (no sign-in) leaves a message and attaches screenshots
(compressed client-side to JPEG data URLs, ≤5, kept under Firestore's ~1 MB
doc limit) — written to a create-from-anyone Firestore **`feedback`** collection
using the same `FB_CONFIG` as the main page (prefills the e-mail if a main-page
sign-in is present). Each submission gets a page-generated **unique ticket
number** (`genTicket`, `LIT-YYMMDD-XXXX`; stored in the doc's `ticket` field,
shown on the thank-you panel, and leading every e-mail subject about it).
**Admin dashboard (maintainer only):** when `kstouras@gmail.com` is signed in
on the page, an **📥 inbox section renders on top** — all feedback received so
far, newest first grouped by day, each card with ticket + status badge +
submitter, the **screenshots on top** (click → enlarge in a lightbox) and the
**message below**, with Open/Closed/All tabs and per-ticket actions: **Mark
complete & reply** (prompts for how it was acted on, saves `resolution` +
`status:'closed'`, then opens a pre-composed reply e-mail to the submitter —
ticket, "now closed", the resolution; an anonymous ticket is just closed) and
**Delete**. Authorisation is the `isFeedbackAdmin()` rule in
`lit/_firestore.rules` (admin e-mail, verified → read/update/delete; create
stays bounded-from-anyone) — the client check only decides whether to SHOW the
section. Delivery is by **`lit/_scraper/feedback-mailer.mjs`**
(Admin SDK + SMTP, near-verbatim env handling as `alerts-mailer.mjs`; offline
`--selftest`/`--dry-run`/`--scan`; a no-op until `FIREBASE_SERVICE_ACCOUNT` +
`SMTP_*` are set), run every 10 min by
`.github/workflows/lit-feedback-mail.yml`: it reads pending (`forwarded==false`)
submissions and sends **two e-mails per submission** — the maintainer's copy to
`FEEDBACK_TO` (default `kstouras@gmail.com`) with the screenshots **attached**
(Reply-To = submitter) and, when the submitter left a valid e-mail, **the SAME
message back to them** as a confirmation (`renderSubmitterEmail`: receipt
banner + ticket; marked `ackSent` so it's never doubled; best-effort — its
failure never blocks or un-marks the maintainer copy). An **anonymous**
submission by definition can't receive one, so only the maintainer's copy goes
out. It stamps `forwarded:true` so nothing is sent twice.
Setup: `lit/_FEEDBACK-SETUP.md`. Delivery is
instant when the optional **Firestore `onCreate` Cloud Function** is deployed
(`lit/_functions/`, project `lit-paper-browser`; `forwardFeedbackOnCreate`
e-mails the same pair — maintainer + submitter confirmation — within seconds
and marks `forwarded`/`ackSent`, complementing the batch
mailer via the same flags — setup `lit/_functions/README.md`; its
`feedback-render.js` mirrors the mailer's renderers — keep in sync); the batch
mailer stays the always-on fallback. **Feedback is also mirrored into a PRIVATE GitHub
repo** by `lit/_scraper/feedback-github-log.mjs`
(`.github/workflows/lit-feedback-github-log.yml`): it reads new `feedback` docs
and writes one folder per submission (`feedback/<id>/feedback.md` + `feedback.json`
+ decoded `screenshot-*.jpg`) into a checked-out private log repo, then commits +
pushes — idempotent (the log repo is the record; no Firestore write). A separate
PRIVATE repo because this site's repo is public and feedback holds e-mails/
screenshots. Inert until a `FEEDBACK_LOG_REPO` variable + `FEEDBACK_LOG_TOKEN`
secret are set; setup `lit/_FEEDBACK-GITHUB-LOG-SETUP.md`. This is what lets the
feedback be read from GitHub (text + images) independent of e-mail. The main
page also keeps a couple of **library niceties**: in **My Library** the
paper-search filter bar is hidden (`body.lit-lib-mode`; the library has its own
search), and clicking the ACTIVE list/tag chip deactivates it (back to "All
saved") without removing it (`acctSetLibFilter` toggle). **Data Analytics
(`lit/analytics/`)** is an interactive summary-statistics dashboard over the
**whole corpus the main browser lists** — the ten native sources (`data/`),
the FT50 catalog (`data-ft50/`) AND the three satellite ABS data shards
(sibling repos, read from a local checkout: the workflow checks them out
under `_analytics-shards/`, a local run finds them as sibling clones of the
site repo, `LIT_SHARDS_DIR` overrides; a missing shard is skipped with a
warning, like the page's 404-skip). Journals dedupe first-registration-wins
in the page's own precedence (native → FT50 → shards); shard journals' ABS
grades flow from each shard manifest's `abs` field via the script's
`MANIFEST_ABS` mirror (~580k papers, 129 journals — the analytics journal
picker must always match the main browser's journal filter; working papers
(`data-workingpapers/`) stay out, as unpublished non-journals, exactly as
they're kept out of the main page's published "N papers" count). It never
downloads the ~600 MB of raw papers:
`lit/_scraper/build-analytics.mjs` pre-aggregates everything **offline** into
two small committed files it fetches on load — `analytics/data.json`
(per-journal × per-year rows: paper count `n`, summed authors `a`, solo `s`,
pre-print `p`, citation `c`, abstract `ab`, team-size buckets `t[6]`, **plus an
optional `x` sub-row of the same shape holding that year's NON-research subset**
— see the toggle below; plus each journal's UTD24/FT50/ABS membership — a
byte-for-byte mirror of index.html's `ABS_RATING`/`UTD24_KEYS`/`FT50_KEYS` — its
`native` flag & research-only paper count `rp`, and its top-cited papers) and
`analytics/authors.json` (for authors with ≥ 3 papers — was 5; lowered so the
account menu's "My author analytics" deep link reaches early-career authors —
canonicalised via the datasets' `Name_Variants`, loaded lazily only when the
Author tab opens: each
author carries `jy` — per-(journal, year) cells `[papers, co-author slots,
paper citations, co-author citation sum]`, from which the page derives the old
papers/year + papers/journal marginals on load AND computes the compare table's
collaboration statistics under any filter; the co-author citation sum uses each
co-author's DATABASE-WIDE total citations, precomputed in a first pass over all
sources). Journals for which we collect **editorial
metadata** also carry a `dims` block in `data.json` — per-value × per-year
aggregates (same row shape as `years`) for `editor`/`area` (Management Science's
accepting editor & area) and `se`/`ae` (ISR & Marketing Science senior/associate
editors), thresholded (`DIM_MIN_PAPERS`, areas kept in full) so the file stays
small; each value also carries its own `tc` (top-cited papers, `DIM_TOP_CITED`)
so the most-cited table can honour an editorial filter. The page (vanilla JS,
inline-SVG charts, no
external CDN beyond the shared Google Font) offers filters — **journal types**
(the same UTD24/FT50/ABS 4/4*/ABS 3 sets, union with the Journals picker),
**journals**, and a **year-range** slider — driving live tiles (papers, avg
co-authors, solo %, pre-print %, citations) and charts (publication volume by
journal over time, **citations by journal over time**, avg co-authors/year by
journal, co-authorship distribution, citation impact by journal, most-cited
table). **Default scope = the WHOLE database**:
with nothing selected `scopeKeys()` returns every journal, so the top-line
statistics describe the entire corpus until the user narrows scope. **Journal-type
group comparisons:** when specific **journals** are chosen, each chart overlays
the aggregate behaviour of every journal-type those journals belong to
(`comparisonGroups()` = union of the chosen journals' `types`: UTD24 / FT50 /
ABS 4/4* / ABS 3), with **per-plot toggle buttons** below each chart
(`renderGroupToggles`, `S.groupOff['<plot>|<type>']`). The **two "… over time"
line charts (publication volume `plot:'evo'` + citations `plot:'citeEvo'`)** are
rendered by ONE shared `renderTimeSeries(cfg)` — one line per top journal + the
group overlays as dashed lines, an **auto-trimmed x-axis to the non-zero year
range of the shown series** (so it starts when the shown journals began, not
1900), and a **click-to-hide/show legend** per line (`S.evoHidden` /
`S.citeEvoHidden`); the volume chart plots each row's `n`, the citations chart its
`c` (both journal rows and `groupYears` carry `c`). The avg-co-authors line chart
and the by-journal **citation-impact** bar chart likewise overlay their group
(avg team size / average citations per paper); the co-authorship distribution
overlays each group's team-size share as a dashed polyline. The **"Editorial area
trends"** line chart also trims its x-axis to the first year with data. Groups are
suppressed while an editorial dimension is active (not like-for-like). (The former
"Papers by journal" and "Journal share over time" charts, and the old "Compare vs.
other journals" toggle, were removed in favour of this system.)
**"Exclude non-research items" toggle (pre-ticked):** a filter-bar checkbox
(`S.excludeNonResearch`, default ON) filters journal "Editorial Board" front
matter, book reviews, corrigenda/errata, announcements and indices out of EVERY
figure — classified offline by `lit/_scraper/_nonarticle.mjs` (`isNonArticle`,
high-precision title patterns; offline test `nonarticle-selftest.mjs`) whose
per-year contribution is carried in each row's `x` delta and SUBTRACTED at read
time by `effRow()` (dims/topCited/authors are already research-only in the data,
so they're unaffected). This is **analytics-only** — the main browser at `/lit/`
deliberately still shows everything (no data-pipeline/`build-data` change).
**Totals reconcile with the main page's header:** `aggregate()` also tracks how
many items the toggle removed (`xn`), the scope line + Papers tile SAY so, and
the default-scope note names the header's full count (`DATA.totals.papers`) —
untick the box and the dashboard total equals the header as of the daily
analytics snapshot (the live header keeps moving intra-day with the
15/20-minute incremental harvests, so the two can differ by the day's
new papers until the next 08:10 UTC rebuild). The two
builds' `MIN_YEAR` sanity floor is **1850** (build-analytics.mjs +
build-disruption.mjs — keep in sync): the catalog genuinely starts in 1886
(QJE), so a 1900 floor would silently drop ~2,300 real papers. The three ABS
shard pipelines publish `authorCount` in their `data/meta.json` (pre-trim
distinct, like native/FT50 — `buildAuthors` returns `{rows, distinct}`), so the
main page's header "from N authors" stat sums ALL five catalogs. When a journal that
carries editorial metadata is **explicitly** in scope (a journal or type chosen,
never the default whole-corpus view — mirroring the main browser's `msInScope`),
the filter bar reveals the **same editorial dropdowns as the main page**:
**Accepting Editor (MS)** + **Area (MS)** when Management Science is in scope, and
**Senior Editor** / **Associate Editor** when ISR / Marketing Science are — each a
searchable multi-select of that dimension's values with paper counts
(`renderEditorialFilters`/`renderEdList`). Picking a value drives the SAME single
active editorial dimension `S.dim` the **Editorial breakdown** section's
click-to-filter bars do ("Papers by editorial area / accepting editor /
senior/associate editor"), so **all figures on the page follow it** — the tiles &
by-journal chart via `aggregate`'s `dims` path, and the time-series charts
(volume, co-authors, citation impact) + the most-cited table via the
`journalYears()` / `tc` helpers, letting you chart e.g. one MS area's papers over
time. Because the aggregates are **marginal per dimension** (no joint
editor×area), **one dimension is active at a time** — selecting a value in
another dimension replaces the prior selection; the cross-journal "Journal share
over time" chart and (for a non-area dim) the "Editorial area trends" chart hide
under an active editorial filter, and the disruption figures stay journal-wide
with the existing note. A removable scope pill shows the active value. There is also an **Author
spotlight** tab where you **add several authors (chips) and compare them**: one
author shows the full single-author view (per-author totals, in-scope counts,
publications-per-year, and where-they-publish, the latter greying journals
outside the current scope); **two or more** shows a comparison — an overlaid
publications-per-year line chart, a side-by-side "At a glance" metrics table,
and a where-they-publish matrix (`S.authors[]`,
`drawCompare`/`renderCompareDisruption`). The metrics table carries
**collaboration statistics in paired in-filters / all-papers rows** (avg
co-authors per paper; avg citations of co-authors — each co-author's
database-wide total citations averaged over co-author slots; avg citations per
paper — from the `jy` cells via `authorJYStats`) plus **two disruption rows**:
mean Dⱼ over the author's scored papers within the filters, and over ALL their
scored papers in the database (filled async). "In filters" = journal scope ∩
year range; editorial-dimension filters don't apply to author aggregates.
The page has **three tabs** whose descriptions name each one's unit of analysis:
**Corpus overview** (the *journal* — the whole dashboard above), **Author
spotlight** (the *author*), and **Paper comparison** (the *paper*). The
**Paper comparison** tab (`S.papers[]`, `addPaper`/`resolvePaper`/`renderPapers`/
`drawPapers`) lets you **add one or more individual papers (by title or a pasted
DOI) and compare them** in a side-by-side "At a glance" table — citations,
disruptiveness Dᵢ, team size, in-catalog citations, and reference age &
popularity, with **each column headed by the paper's citation** (title,
authors (year), journal — italic, DOI link; there's no volume/issue/pages
because the analytics page loads only `disruption.json`, not the full paper
records). Plus charts: **citations over the papers' publication years**
(`paperScatter`, one dot per paper at its year, connected in year order),
a **citations** comparison bar chart (`barsH`), a **disruptiveness Dᵢ**
diverging bar chart (`divergingBarsH`, disrupts right / develops left), and an
**impact-vs-disruption** scatter (Dᵢ on x, citations on y). Note: there is
deliberately **no "Dᵢ over the years" chart** — the citation-graph analysis
yields ONE Dᵢ per paper (a single snapshot), not a per-year series, so a
per-year Dᵢ trajectory can't be plotted honestly; Dᵢ is compared per-paper
(bars + the impact scatter) instead. Every metric comes from the same
per-paper `disruption.json` table (a paper is available once it has a computed
D), lazy-loaded via the Team-science section's `ensureDisruption`; the tab is
**independent of the top filter bar** (the papers you add are always shown).
A `?paper=`/`?papers=DOI,…` deep-link opens it straight on those papers. Keep
this tab's copy + the About page + a `changelog.json` entry in sync when it
changes.
**Team-science / disruption section** (a new block at the bottom of the Corpus
overview) reproduces the key measures of Wu, Wang & Evans, "Large teams develop
and small teams disrupt science and technology" (*Nature* 570, 2019) over The
Lit's **in-catalog citation graph** (`lit/data-refs/`): a per-paper
**disruption index D** (the CD index, Funk & Owen-Smith 2017 — `n_i−n_j` over
`n_i+n_j+n_k`; D>0 disrupts, D<0 develops), and, per the owner's clarification,
an **author's disruptiveness D_j = the mean of D over every paper they wrote or
co-wrote** (in scope). It draws the paper's signature plots — distribution of D
(Fig 1b), disruption & citations vs team size (the "scissor", Fig 2), reference
age & popularity vs team size (Fig 4), and relative-ratio extremes (Fig 2d) —
plus most-disruptive/-developing paper and author tables, and an author-level
disruption profile in the Author-spotlight tab. It is a **faithful but partial**
reconstruction (we only have the references harvested within the catalog, not
the paper's 40M-work network) that **sharpens as `data-refs/` grows**; every
figure honours the same journal / type / year filters, plus a dedicated
**Disruptiveness-index range slider** in the filter bar (a dual-thumb −1..1
control, `S.dMin`/`S.dMax`, with Full-range / Disruptive>0 / Developing<0 /
Highly-disruptive≥0.3 presets) that keeps only papers whose D is in the chosen
band — it drives every team-science figure (`disrInScope` = journal+year+D;
`disrScopeJY` = journal+year only, used for the distribution histogram, which
shows the whole distribution with the selected band highlighted, and for the
Author-spotlight percentile so a narrowed D range never distorts an author's
standing). It is pre-computed
**offline** by `lit/_scraper/build-disruption.mjs` into a small,
lazily-loaded `analytics/disruption.json` (one row per paper with a defined D —
`{j,y,t,d,c,nf,ra?,rp?,au[],ti,doi}` + an author-name index; `nf` = in-catalog
forward-citation count, used to gate the highlight tables against degenerate ±1
one-citation artefacts) — the whole per-paper table ships so the browser
computes every figure client-side under the live filters. The highlight tables
merge the thin large-team tail into an "8+" bin. Reference age uses reference
years; reference popularity uses references' `CitedBy` (a rough proxy while
citation coverage fills in). Keep the `ABS_RATING`/`UTD24_KEYS`/`FT50_KEYS`
mirror and the native-wins journal merge in sync with build-analytics.mjs.
Refreshed daily by `.github/workflows/lit-analytics.yml` (08:10 UTC, after the
native and FT50 data builds; checks out the three shard repos read-only under
`_analytics-shards/` so the summary covers their journals, then runs
build-analytics.mjs **and** build-disruption.mjs), which commits
`analytics/*.json` (incl. `disruption.json`) on master only.
The generation date mirrors the native `meta.json` `lastPull`, never
`Date.now()`, so re-runs on an unchanged dataset are a no-op. The page also
shows one **live community figure — the number of registered users** (a tile in
the Community band, separate from the corpus stats). Firebase Auth has no
client-side user count and each account's Firestore subtree is private, so the
count comes from a **public** `registeredUsers/{uid}` collection: one contentless
per-account doc holding just a coarse `t` timestamp (no e-mail/name), written
once per signed-in session by the main page's `auth.onAuthStateChanged` and read
here via a `count()` aggregation (one billed read per visit). Its rule in
`_firestore.rules` is public-read + owner-only, `t`-only writes, no delete; the
tile hides itself if that rule isn't deployed. The count reflects accounts that
have signed in since the tally launched (converges to the true total as users
return; the exact all-time total is in Firebase console → Authentication).
Beside it sits a live **"Exploring now"** figure — the number of visitors
currently browsing The Lit in real time — built on **Firebase Realtime Database
presence** with **anonymous auth**, run in a **separate `'presence'` Firebase
app** so it never touches the accounts sign-in state (and anonymous visitors are
NOT written to `registeredUsers`). Every page **writes** presence
(`presence/<uid>/<pushId> = true`, one child per tab with `onDisconnect().remove()`,
grouped by uid so the count is of DISTINCT visitors); the **main browser only
writes** (no fan-out) while **only the analytics page reads/counts**
(`ref('presence').numChildren()`). RTDB rules are in `lit/_database.rules.json`
(public read of `/presence`, owner-only `true`-valued writes); the whole thing is
**inert until** a Realtime Database is created and its URL is pasted into the
`PASTE_DATABASE_URL` placeholder in BOTH `lit/index.html` (bottom presence
`<script>`) and `lit/analytics/index.html` (`RTDB_URL`) — full steps in
`lit/_PRESENCE-SETUP.md`. The card stays hidden until presence is configured,
so it never shows a broken state. **E-mail alerts**
lets a signed-in user subscribe to an e-mail when new papers matching a set of
filters are added. The form's two top toggles choose *what* to be e-mailed
about: **New features & updates to the website** (first — `criteria.features`, a
subscription to site-feature updates, delivered automatically from a **feature
changelog** — see below) and **Any new paper added to the
database** (`criteria.allPapers` — every new paper, no filters, which hides the
paper-filter editor). Below those, unless "any new paper" is on, the modal
**pre-fills the alert criteria from the page's current search filters** (journal
types, journals, authors, title /
abstract / affiliation terms, years, MS editors/areas, ISR/MkSc SE/AE, and the
pre-print toggle — the same `sel` shape), editable in-modal, plus an alert name
(**used as the e-mail subject line** — the field is labelled as such),
recipient e-mail (default = account e-mail, sent *from* the user's own e-mail),
and frequency (immediate / daily / weekly / monthly). The modal shows a **live
example e-mail** at the bottom (`renderAlertPreview` — subject, header, sample
papers and/or a "what's new" feature digest built from the real latest changelog
entries, plus the footnote, updating as the user edits name/criteria/toggles); it
**mirrors the mailer's `renderEmail` / `renderFeatureDigest` / `renderAnnouncement`
templates — keep them in sync**. A **"Send me a test
e-mail"** button (beside *Create alert*) delivers a one-off sample of the alert
being composed to the recipient so the user can see how it looks in a real inbox
before saving (`litAlertSendTest`): the static page can't send mail, so — like
real alerts — it **queues** the request at `users/{uid}/testEmails/{id}`
(`{name, recipient, from, frequency, criteria, test:true}`; same private-subtree
rule) and the mailer's **`--test-emails`** pass delivers + deletes it. That pass
(`sendTestEmails` → `renderTestEmail`) reuses the very same `renderEmail` /
`renderFeatureDigest` templates (adding a `[Test]` subject prefix + preview
banner), listing the real recently-added papers that match — falling back to two
built-in `SAMPLE_PAPERS` (mirroring `renderAlertPreview`'s samples) so the format
always renders, and showing the "what's new" digest of the real latest changelog
entries (fallback `SAMPLE_FEATURES`) for a features-only draft. It
runs on its own frequent workflow `.github/workflows/lit-alerts-test.yml` (every
15 min, own concurrency group) so a test lands within minutes, separate from the
daily digest. A save now needs any
one intent (`alertHasIntent`: features, allPapers, or a filter). Alerts are stored
privately at `users/{uid}/alerts/{alertId}` (covered by the existing
`_firestore.rules` wildcard) and managed from the modal (enable/pause switch,
edit, delete). The page only writes subscriptions; **delivery is done by the
mailer** `lit/_scraper/alerts-mailer.mjs`, run daily by
`.github/workflows/lit-alerts-mail.yml`: it reads the recently-added papers
(`data/recent.json` + `data-ft50/recent.json`), reads all alerts via
`collectionGroup('alerts')` with the Admin SDK, matches each with **vendored
copies of the page's journal-list sets + `textMatch`/`authorMatch`** (keep in
sync), and e-mails due alerts over SMTP (`To` recipient, `Reply-To` the
subscriber, `From` = `ALERTS_FROM`/`SMTP_USER`), stamping a per-alert
`lastCheckedAt`/`lastSentAt` high-water mark so nothing is sent twice.
`criteria.allPapers` short-circuits `matchesCriteria` to match every new paper;
`hasPaperIntent` gates paper matching so a **features-only** subscription (no
`allPapers`, no filter) never sends paper e-mails. **Feature updates are their
own automated side of the same run:** the mailer also loads a hand-maintained
**feature changelog** — `lit/changelog.json` (`{version, updates:[{id, date,
title, summary, url}]}`, newest first; served, NOT build output; the single
source of truth also read by the page for its About-modal *What's new* list and
the alert preview) — via `loadChangelog()`, and for every `criteria.features`
alert sends a "what's new" digest (`renderFeatureDigest`) of the changelog
entries whose `date` falls in that alert's window. `evaluateFeatures` windows the
changelog by `date` **exactly like** `evaluateAlert` windows papers by
`Date Added` (daily = each entry the day it lands, weekly/monthly = batched over
the period), but with its **own** high-water marks (`lastFeatureCheckedAt`/
`lastFeatureSentAt`, falling back to the paper `lastCheckedAt` for existing
subscribers so turning it on never blasts the back-catalogue; a brand-new alert's
first window caps at ~31 days). The paper and feature sides advance
**independently**, each only when its own send succeeds, so a partial SMTP
failure retries just that side. **To announce a feature you just add a changelog
entry** dated ~today; entries dated in the past e-mail nobody (they precede every
subscriber's window), so seeding historical entries is safe. The **maintainer
`--announce` mode** (`node alerts-mailer.mjs --announce --subject=… --html-file=…
[--dry-run]`, `renderAnnouncement`) remains for an **ad-hoc free-form broadcast**
to `criteria.features` recipients (deduped) that is *not* a changelog entry and
does not touch the feature high-water mark. Every e-mail's footnote offers
**edit preferences / unsubscribe from future
e-mails / feedback** (the manage panel on the site, plus the maintainer
`CONTACT_EMAIL` = kostas.stouras@ucd.ie) and the message carries a
standards-based **`List-Unsubscribe`** header so clients show a native
unsubscribe; the shared chrome (`footerText`/`footerHtml`/`emailShell`) is used
by `renderEmail`, `renderFeatureDigest` and `renderAnnouncement`. It is a
no-op until the `FIREBASE_SERVICE_ACCOUNT` + `SMTP_*` secrets are set (so it
never fails pre-setup); `--selftest`/`--scan`/`--dry-run` modes and the full
deploy steps are in `lit/_EMAIL-ALERTS-SETUP.md`. No Firestore rule change
is needed. All of the alerts UI logic lives inside the accounts IIFE
(`window.litAlerts*`); Feedback is top-level (`window.litFeedback*`). The
**About page renders a data-driven "What's new" list** (`#litWhatsNew`, its own
inline script in `lit/about/index.html`) from the same `changelog.json` (fetched
as `../changelog.json`); the main page still loads `changelog.json` into
`LIT_CHANGELOG` for the alert preview. So the changelog is the ONE place to log a
feature — it feeds the About page's list, the alert preview and the automated
e-mails at once. So: **when you ship a user-facing `/lit` feature, add a
`changelog.json` entry (dated ~today) in the same change** — that is now part of
the keep-in-sync discipline alongside updating the About page copy and the
`fun/index.html` landing cards.

### Working Papers — the listed authors' UNPUBLISHED work
A **"Working Papers" journal type** (last in `JOURNAL_TYPES` for badge
precedence, but shown **first** in the Journal-types dropdown — `buildJTypeSelect`
reorders it to the top for display only, safe because its `WP_KEYS` are disjoint
from the published lists so no published paper's badge changes; badge
"Working Paper", green) surfaces the **unpublished working papers / pre-prints
(SSRN, NBER, arXiv, OSF) of every author already in the catalog** — genuinely
unpublished work, *excluding* anything whose title is already published in the
catalog (a paper that later gets published drops out on the next crawl, and the
published card's own "Pre-print (Open Access)" link takes over). It is its
**own dataset**, `lit/data-workingpapers/` (kept separate so it can move to
a dedicated `lit-data-workingpapers` Pages repo when it nears the 1 GB limit —
see below), built by the vendored pipeline `lit/_scraper-workingpapers/`
(OpenAlex only: resolves each author's OpenAlex ID from a known catalog DOI,
enumerates their `type:preprint` works, classifies the host with the pre-print
feature's own `pickPreprint`/`preprintFromDoi`, drops anything already-published
or journal-placed, `wpRecordFromWork`). **Title/abstract sanitization:**
`wpRecordFromWork` runs the record's title AND abstract through `cleanText`
(exported from `build-data.mjs`) — some publishers deposit HTML/XML markup that
OpenAlex passes through HTML-entity-encoded (sometimes double-encoded, e.g.
`&lt;p&gt;&lt;span&gt;…&lt;/span&gt;&lt;/p&gt;`, `&amp;nbsp;`, `&amp;amp;`), which
the page would otherwise render as literal "&lt;p&gt;…" gibberish since it
HTML-escapes titles. `cleanText` decodes the entities (repeatedly, so a
double-encoding fully resolves), strips the revealed tags (sub/sup with no space
so a chemistry formula stays `Cs3Cu2I5`; a lone `<` that isn't a tag, e.g.
`P < 0.05`, is preserved) and collapses whitespace; it is pure + idempotent, and
the **title is cleaned BEFORE `normTitle`** so a stray `<span>` can't leak "span"
into the normalized title and defeat the already-published exclusion. The ingest
(`ingest-submissions.mjs`) shares the same path via `wpRecordFromWork`. Offline
unit tests live in `selftest.mjs`. The page **merges it at runtime like the
FT50 catalog** — `loadWorkingPapersManifest()` registers each repository
(`wp-ssrn`/`wp-nber`/`wp-arxiv`/`wp-osf`, one `papers-wp-<host>.json` each,
flagged `"workingPaper": true`) as a lazy `EXTRA_SRC` and records its key in
`WP_KEYS`; `journalTypeKeys('wp') === WP_KEYS`. Records reuse the published-paper
shape (+ `"Status":"Working paper"`) so cards render with **no renderer
changes**: badge, repository tag, clickable **posted-year** chip, **co-authors**,
and the Pre-print link all come for free. **Text searches cover the archive
(per the owner):** a TEXT search (title/author/abstract/affiliation, typed or
chipped, incl. `?author=` identity chips) with no journal scope searches the
ENTIRE database, working papers included — `textSearchActive()` makes
`neededExtraKeys()` return the WP keys and `matchesJournal` admit WP rows (via
the per-pass `wpSearchable` cache, refreshed in `refreshJournalScope` — the hot
loop never re-reads the DOM). Bare BROWSING stays published-only: the year
filter alone or the pre-print toggle alone excludes `WP_KEYS` (every working
paper carries a Preprint link, so either would flood the view with unpublished
rows); working papers also stay out of the header's published "N papers" count.
The archive otherwise downloads when the user selects the Working Papers type
or one of its repositories. **"Recently added" includes new working papers (per
the owner):** the WP pipeline stamps `"Date Added"` on each key that first
enters the archive (crawler: stamped on new, PRESERVED across the re-crawl
overwrite; ingest: stamped on `added`) and both writers emit a
`data-workingpapers/recent.json` of ONLY dated rows, newest-added first (keep
the two emissions in sync); the page fetches it via `loadDatasetRecent` in
`loadWorkingPapersManifest()` and `matchesJournal` admits WP rows in
`recentMode` — back-catalog rows crawled before dating began carry no date and
never appear. `buildJTypeSelect()` **hides the Working Papers type until its
archive has sources**, so the shipped empty `data-workingpapers/` (valid empty
manifest) stays dormant until data lands. **The archive is built ONLINE, slowly:** two
workflows — `lit-workingpapers-backfill.yml` (every 3 h, the growth engine) and
`lit-workingpapers-update-data.yml` (daily refresh + live-site self-heal) — run
`build-data.mjs` on a **bounded, gently paced** (`WP_PACE_MS` ~1.5 s,
`WP_MAX_AUTHORS`, `WP_BUDGET_MS`), **resumable** slice (progress cursor in
`data-workingpapers/_authors.json`), so it fills in over **weeks** without
tripping OpenAlex's rate limits; they share the `lit-workingpapers-${{ github.ref }}`
concurrency group and commit `lit/data-workingpapers/` back (only on
`master`). **Author priority:** Management Science / M&SOM / POM authors (last
15 years) are crawled first (`WP_PRIORITY_KEYS`/`WP_PRIORITY_YEARS`), then the
rest, newest-active first. Distinct OpenAlex quota identity `kstouras+litwp`.
Offline test: `node lit/_scraper-workingpapers/selftest.mjs` (mock, no
network). Migration to a satellite repo is one constant: `WP_DATA_BASE`
`'./data-workingpapers/'` → `'/lit-data-workingpapers/data/'`. See
`lit/_scraper-workingpapers/_HOW-IT-WORKS.md`. NOTE: this build environment's
egress policy blocks the scholarly APIs (OpenAlex/Crossref/arXiv return 403), so
the archive can only be populated by the GitHub Actions runners — it is EMPTY
until the first workflow run on `master` post-merge.

**Suggest a working paper (user submissions → auto-ingest).** A **signed-in**
user can suggest an unpublished working paper from the **first section of the
Feedback page** (`lit/feedback/`, the "Suggest a working paper" `.fb-card`): they
paste an SSRN/arXiv/NBER/OSF link (or DOI) + optional title/authors/note, and the
page writes a bounded doc to a new Firestore **`paperSubmissions`** collection
(`{uid,email,name,url,title,authors,note,ticket,status:'pending',createdAt}`;
rule in `lit/_firestore.rules` — signed-in bounded create with `status` pinned to
`'pending'`, submitter reads own, `isFeedbackAdmin()` reads/updates/deletes). A
scheduled ingest `lit/_scraper-workingpapers/ingest-submissions.mjs`
(`.github/workflows/lit-paper-submissions.yml`, every ~10 min off-boundary,
**shares the `lit-workingpapers-${{ github.ref }}` concurrency group** so it never
races the crawler/backfill; master-only commit with the same push-retry replay)
processes each `pending` doc: it **parses the link into a DOI + host with the
pre-print feature's own allowlist** (`urlToDoi` → SSRN `10.2139`/arXiv
`10.48550`/NBER `10.3386`/OSF `10.31219`; a spoofed host, a bioRxiv/journal DOI or
junk is rejected), **resolves the REAL metadata itself** (OpenAlex by DOI →
Crossref fallback → an OpenAlex-shaped work), and builds the record with the SAME
`wpRecordFromWork()` the crawler uses — so the submitter's typed title/authors are
**only hints, never trusted into the dataset**. It then applies the owner's two
gates via the pure `decideSubmission()`: **not already in the catalog**
(`wpRecordFromWork`'s `publishedTitles` exclusion + a `recKey` dedup against the
archive → `duplicate`) and **≥1 author already in the catalog** (`catalogMatch`
against `loadCatalog`'s author index — `exact` full-name or, by default, `fuzzy`
last-name+initial via the crawler's own `nameParts`; env `SUB_AUTHOR_MATCH`). On
`added` it **upserts** into `lit/data-workingpapers/` (seeding `byKey` from the
committed files, so every crawler row is preserved — same invariant as the
crawler) and rewrites the derived files (`papers-wp-*.json`/`sources.json`/
`recent.json`/`meta.json`, preserving the crawler's `authorCount`; **never touches
`_authors.json`**), so the paper appears under the page's **Working Papers**
journal type with no page change. It **writes the dataset BEFORE stamping
Firestore** (a crash just re-processes idempotently — the paper is then a
`duplicate`, never lost), stamps each doc `added`/`duplicate`/`rejected`+reason
(a transient OpenAlex/Crossref outage leaves it `pending`; a not-yet-indexed
posting stays `pending` and is retried until it is older than `SUB_MAX_AGE_DAYS`
(default 7, time-based so a fresh SSRN posting's day-plus indexing lag doesn't
trip it) then rejects `not-indexed`), and — when SMTP
is set (reuses the feedback mailer's secrets; **`FIREBASE_SERVICE_ACCOUNT` is the
only one required**) — e-mails the submitter their outcome + the maintainer a
summary. To this `build-data.mjs` exports `WP_SOURCES`/`recKey`/`normName`/
`nameParts`/`stripAccents` (additive; the ingest imports them so the record shape
+ author normalization can't drift). The Feedback page also gains a **📄 Paper
suggestions** maintainer inbox (mirrors the feedback inbox; read-only + Delete)
showing what the ingest did. It is a **no-op until `FIREBASE_SERVICE_ACCOUNT` is
set** and the rule is deployed. Offline test:
`node lit/_scraper-workingpapers/ingest-selftest.mjs` (mock, no network); modes
`--scan`/`--dry-run`. Setup: `lit/_PAPER-SUBMISSIONS-SETUP.md`. NOTE: this build
env's egress blocks OpenAlex/Crossref (403), so real resolution only happens on
the Actions runners. (Per keep-in-sync: shipped with a `changelog.json` entry +
the About-page "Suggest a working paper" bullet.)

**Suggested/retired links → published paper's pre-print.** A submitted link (or a
crawled working paper) whose paper is ALREADY PUBLISHED in the catalog is attached
as that published paper's open-access **pre-print** instead of being added as a
standalone working paper — the canonical home for a found pre-print is the
published paper's `Preprint` field (the automated `resolvePreprints` finder is the
main filler; this is the human/retire-on-publish path for the ones it missed, e.g.
a working-paper title that drifted from the published title). Two producers, both
in the site repo (WP-side jobs sharing the `lit-workingpapers` group): (1) the
**submission ingest** — `decideSubmission` returns a **`linked`** outcome when
`matchPublished()` connects the submitted paper to a published one; (2) the **WP
crawler's retire-on-publish sweep** (`build-data.mjs` main, step 3b) — re-checks
every archived working paper against the published catalog each build and, on a
match, DROPS the row from the archive and records the link. Both write a small
served map **`lit/data-workingpapers/submitted-preprints.json`**
(`{bareDoi:{u,s}}`, seeded+merged so they never lose each other's entries). The
matcher `matchPublished(rec, byTitle)` (exported from the WP `build-data.mjs`,
offline-tested) mirrors the pre-print matcher's discipline — EXACT `normTitle` +
shared author surnames (2, or 1 when either side is single-author) + a plausible
year — off a title→published-paper index that `loadCatalog(dirs, {index:true})`
now also returns (`byTitle`). **The page applies it at DISPLAY time for EVERY
dataset (native/FT50/shard):** `index.html`'s `loadSubmittedPreprints()` fetches
the map once and `applySubmittedPreprint(p)` overlays `Preprint`/`PreprintSrc` onto
each paper row as it loads (native + lazy-extra load hooks), re-applying to
already-loaded rows on arrival (`overlaySubmittedPreprints`) — so a shard-published
paper is covered with NO shard-repo/build change. **Shard MATCHING** (detecting a
paper published ONLY in an ABS shard) runs in the **daily** `lit-workingpapers-update-data.yml`
sweep, which checks out the three shards read-only under `_analytics-shards/` (like
`lit-analytics.yml`) and points `WP_CATALOG_DIRS` at native+FT50+shards; the 3-hourly
backfill and the 10-min submission ingest stay native+FT50 (to avoid re-fetching the
large shard repos frequently), so a shard-only submission is reconciled by the daily
sweep + the display overlay rather than instantly. `matchPublished`/the `linked`
outcome are offline-tested in `ingest-selftest.mjs`. (The specific M&SOM example
"…Opportunity Zone Program…" `10.1287/msom.2024.0746` was also fixed directly in
`data/_preprints.json`+`papers-msom.json`.)

### Citation graph — the references a paper cites that are IN the catalog
For every listed paper, the pipeline extracts the references it **cites that
also belong to the catalog** (the intra-catalog out-edges), surfaced on each
paper card as a **"Citing references in this catalog"** toggle (steel-blue, next
to BibTeX; `togRefs` in `index.html`) that lazy-loads and lists those papers,
each linking to the paper it cites. The toggle also shows a **count** of how
many in-catalog references the paper cites — e.g. "Cited 12 references in this
catalog" (the number woven into the phrase, not parenthesised) — sourced from a tiny `refs-counts.json` companion
(`{citingDoi:N}`) loaded once in the background (`loadRefsCounts`/`refsCounts`/
`refsToggleLabel`/`annotateRefsCounts`) so the number appears WITHOUT
downloading the multi-MB per-journal shard; the shard still loads lazily only
when the panel is opened. It is its **own dataset**,
`lit/data-refs/` (kept separate to stay out of the main size budget and to
move to a dedicated `lit-data-refs` Pages repo when it nears the 1 GB limit —
migration is ONE constant, `REFS_DATA_BASE` `'./data-refs/'` →
`'/lit-data-refs/data/'`, same pattern as `WP_DATA_BASE`). **Data sources (three,
unioned for accuracy):** (1) **Crossref** backbone — one
`works?filter=doi:<doi>&select=DOI,reference` per paper reads the DOIs the
publisher deposited (the leg that stamps a paper "done"); (2) **OpenAlex** —
`works?filter=doi:<50>&select=id,doi,referenced_works` (batched 50/call), a
generally more-complete reference graph whose `referenced_works` OpenAlex-ids are
resolved back to catalog DOIs via `data-refs/_oaid.json` (`doi → OpenAlex id`,
built for free while crawling — each record returns its own id+doi); (3)
**Semantic Scholar** — `graph/v1/paper/batch?fields=references.externalIds`
(batched 500/POST), an OPTIONAL bonus leg that drops out on throttle (disable
with `REFS_S2=0`). Each source's RAW output is cached
(`data-refs/_refs-cache.json`: `doi → {r:[Crossref+S2 DOIs], o:[OpenAlex ref
ids], t, v, oa}`, underscore-prefixed so unserved) and every build
**re-intersects it offline** with the CURRENT catalog + `_oaid.json`, so catalog
growth (and a fuller id map) adds edges with NO re-fetch. A published paper's
reference list never changes, so a paper stamped at the current version is
**frozen** (never re-fetched); a **`RF_VER` bump re-sweeps EVERY paper** with the
wider net (v1 was Crossref-only; v2 added the OpenAlex + Semantic Scholar legs).
Built by the vendored pipeline `lit/_scraper-refs/` (`build-refs.mjs`;
exports `extractRefDois`/`extractOaRefs`/`extractS2Refs`/`shortOaid`/
`orderPapers`/`buildOutputs`/`loadCatalog`/`tierOf`/`normDoi`), refreshed by
`.github/workflows/lit-references-backfill.yml` (every 3 h, gently paced,
bounded+resumable, own `lit-references-${{ github.ref }}` concurrency group,
replays the dir on a rejected push; distinct OpenAlex/Crossref quota identity
`kstouras+litrefs`). **Served files:** `manifest.json` (which journals
have edges), `refs-<jkey>.json` (`{citingDoi:[citedDoi,…]}`, sharded by citing
journal, only papers with ≥1 in-catalog edge), `refs-index.json`
(`{citedDoi:[title,jkey,year,authors?]}`, so the page renders a cited paper's
title, journal, year AND authors without loading its journal file — the toggle
panel lists each cited reference's authors under its title), and `refs-counts.json`
(`{citingDoi:N}`, the tiny per-paper count companion that feeds the toggle
label). **Paper priority (per the owner):** MS /
M&SOM / POM / PNAS (all years) first, then UTD24 ∪ FT50 (newest years first),
then the rest (`tierOf`; the UTD24/FT50 key sets MIRROR index.html's — keep in
sync, like build-analytics.mjs). The page merges it at runtime like the FT50
catalog: `loadRefsManifest()` at load; a card shows the toggle only when its
journal has a shard (`refsShardFor`); `loadRefsIndex()`/`loadRefsShard(jkey)`
are lazy + idempotent. The dataset **ships EMPTY** (manifest with no shards), so
the toggle stays hidden until the backfill populates it. Offline test:
`node lit/_scraper-refs/selftest.mjs` (mock, no network). NOTE: this build
env's egress blocks the scholarly APIs (Crossref/OpenAlex/Semantic Scholar, 403),
so `data-refs/` can only be populated by the GitHub Actions runners — EMPTY until
the first workflow run on `master` post-merge. See
`lit/_scraper-refs/_HOW-IT-WORKS.md`.
**Forward citations — who cites each paper (`build-citedby.mjs`).** The COMPANION
to `build-refs.mjs`: where that crawls the references a paper CITES (backward
out-edges), `lit/_scraper-refs/build-citedby.mjs` crawls the works that CITE each
catalog paper (forward in-edges — "who cites me"), completing the graph in both
directions. **OpenAlex only** (`works?filter=cites:<id>`, cursor-paged), it
piggybacks on the `_oaid.json` map build-refs already builds (skips a paper until
its OpenAlex id is known) and refreshes on a **rolling** cadence (forward
citations grow, unlike a frozen reference list — never-fetched first, then
stalest, `CB_TTL_DAYS` re-check, `CB_VER` re-sweep), same priority tiers, bounded
+ resumable + checkpointed. It writes an **unserved** crawl cache
`data-refs/_citedby-cache.json` (per DOI `{c:[citer OpenAlex ids],n,t,v,cap?}`)
plus a tiny served `citedby-meta.json`; the raw citer sets exist only to COMPUTE
D and are never shipped to the page. Refreshed by
`.github/workflows/lit-citedby-backfill.yml` (every 6 h), which **shares the
`lit-references-${{ github.ref }}` concurrency group** (both write `data-refs/`,
so they must never race a commit); distinct OpenAlex quota identity
`kstouras+litcitedby`. Its purpose is to **sharpen the disruption index D**: the
CD index needs a focal paper's citers (groups i/j) and its references' citers
(groups j/k), which build-disruption today approximates by INVERTING the
in-catalog out-edges — seeing only citers that are themselves in the catalog,
which biases D downward. `build-disruption.mjs` imports `forwardDisruption()`
from build-citedby and, **behind `DISR_USE_FORWARD=1`** (default OFF) when the
forward cache is present, computes D over each paper's GLOBAL citer set instead —
tagging each `disruption.json` record `dm:"f"` (global-forward) or `dm:"c"`
(catalog-inverted fallback). Default-off so the shipped analytics is unchanged
(D values byte-identical) until the forward graph is broad enough to switch on.
Offline test: `node lit/_scraper-refs/citedby-selftest.mjs` (mock, no network;
reproduces the paper's D=0.25 worked example end-to-end). NOTE: this build env's
egress blocks OpenAlex (403), so `_citedby-cache.json` is EMPTY until the first
Actions run on `master` post-merge. See `lit/_scraper-refs/_HOW-IT-WORKS.md`.
**Range-served SQLite search (`?db=1`, opt-in):** the page can answer
native-journal-scoped filters from a single range-served SQLite DB
(`lit/data/db/lit.db.*` chunks + `lit-db.json` manifest, sql.js-httpvfs
vendored at `lit/sqlite/`) instead of downloading + filtering JSON, fetching
only the DB pages a query touches. STRICTLY ADDITIVE — the default JSON path is
unchanged, and any query the DB can't fully answer falls through to it. It
answers **OR / POM / ACM EC / PNAS** (native journals without the MS/ISR/MkSc
editor UIs) with text/year/pre-print filters and the default year-desc sort;
MS/ISR/MkSc, journal *types*, all-journal searches, non-default sorts and the
recent/library views use JSON. The DB is built by `lit/_scraper/emit-db.mjs`
(narrow `papers` + `papers_abs` side table + contentless FTS5 trigram; rows
inserted in the page's exact sort order so `id` = newest-first rank; membership
read from `index.html`) and chunked by `chunk-db.mjs` under the 100 MB per-file
Pages limit; the query builder is `lit/sqlite/lit-query.js`, the wiring is
the `?db=1` block in `index.html`. It needs NO COOP/COEP (sync-XHR reads in a
Worker). **The DB is deliberately NOT committed** — a built `lit.db` (~200 MB
chunked) is a range-served *copy* of the `data/papers-<key>.json` (~51 MB) it's
built from, pure redundancy that would bloat the repo and the deployed Pages
site. So `data/db/` is absent and `?db=1` **falls back to the JSON path** (the
manifest 404s, `initLitDb()` catches it) — the site is fully functional either
way. To activate db-mode, generate the DB (`emit-db.mjs` + `chunk-db.mjs`) and
serve it from a **dedicated data repo** (like the `lit-data-*` shards) so the
redundant binary never lives in the main site's history; point `initLitDb()`
there. (Git LFS won't work — Pages serves the LFS pointer, not the file.)
FT50-catalog/ABS-shard DBs (for types/all-journal) and MS/ISR/MkSc editor
columns are follow-ups. Tests: `node lit/_scraper/sqlite-parity.mjs`
(28/28 semantic parity) and `sqlite-bench.mjs` (payload/latency). See
`lit/_SQLITE-POC.md`.

## `/fun/ms` — RETIRED (redirect stub only)
The standalone Google-free Management Science browser was removed: `/lit/` is a
superset — it covers Management Science with the same editors/areas filtering
(`msInScope`) plus seven more sources, and reads its **own** data
(`lit/data/papers-ms.json`), so it never depended on this app. `fun/ms/` now
holds only a noindex redirect stub to `/lit/` (like `fun/ft50/`); its data
(`fun/ms/data/`), scraper (`fun/ms/_scraper/`) and its
`.github/workflows/ms-update-data.yml` workflow were deleted. Do not add a card
for it on `fun/index.html`. The old `fun/ms2/` stub (the graduated v2
experiment) now also redirects to `/lit/`.

**Articles in Advance (still used by /lit):** the `informs-aia-local.mjs` local
scraper (pubsonline blocks cloud IPs) still feeds `_aia-fixups.json` /
`_informs-aia.json` for `/lit` and its FT50 catalog — run it with `--app lit` /
`--app lit-ft50` (`forthcomingStatus` tags a no-volume/no-issue paper forthcoming
only when recent, so years-old frozen records aren't mislabeled). Its `--app ms`
target is retired along with this app.

The original Google-Sheets-backed Management Science browser remains
retired-but-served at `fun/ms-old/` (noindex; its data still comes from the
"ManSci Metadata" Google Sheet at runtime). `ms-old` is **deliberately unlisted**:
it has no card on `fun/index.html` and should not get one — it stays reachable
only by direct URL. It is an intended exception to the keep-in-sync rule above.

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
rule does not apply. It is linked from the homepage's "Fun Projects" section
(in the root `index.html`, below the PortfolioFit card).
