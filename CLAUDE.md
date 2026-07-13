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
`--apply-only --merge-cache` instead of clobbering a fresher dataset. **The
daily builds (`lit-update-data.yml`, `lit-ft50-update-data.yml`) do the same on
a rejected push** — they overlay the tip's `_preprints.json` onto their fresh
harvest (`--apply-only --merge-cache`) so a concurrent backfill's pre-print
links are never downgraded back to `{none}`; a found `{u}` link is FROZEN
(a published paper's pre-print never changes) — never re-searched (the by-DOI
and title-search passes both skip `{u}`) and never clobbered at commit time.
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
`CitedBy` field — the **highest of three tallies**: Crossref's
`is-referenced-by-count` (harvested for free in the build's own batched
Crossref requests — the `SELECT` addition + `mapWork` line in
`build-data.mjs`; the floor, set only when positive so it never bloats the
papers files or shows a "Cited by 0" badge), OpenAlex's `cited_by_count` and
Semantic Scholar's `citationCount` — the latter two index citing
preprints/proceedings/books, so they sit much closer to Google Scholar's
number. The OpenAlex+S2 sweep (`refreshCitations`/`applyCitations` in
`build-data.mjs`, replicated near-verbatim like the pre-print machinery) is
batched — OpenAlex 50 DOIs/call via `filter=doi:` + `select=doi,cited_by_count`
(general 100k/day quota, NOT the ~100/day title-search cut-off), Semantic
Scholar 500 DOIs/POST (`graph/v1/paper/batch`; its anonymous pool 429s
freely, so the leg is optional and drops out while OpenAlex carries on) —
into each data dir's incremental `_citations.json`
(`doi → {c, t:<day-checked>, s2:1?}`; `c` omitted when 0). The refresh is
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
`citedByTagHTML` in `index.html` renders **"Cited by N · OpenAlex/Semantic
Scholar/Crossref"** accordingly, linking (via `scholarSearchUrl`) to a Google
Scholar **title search** (`scholar.google.com/scholar?q=<title>`) — the exact
title lands the paper as the top hit so the user reaches its live GS "Cited
by" count and citing works. Deliberately NOT Google Scholar's own number:
there is no Scholar API, scraping it is blocked/ToS-barred at any scale, and
its exact `?cites=<cluster-id>` link isn't derivable from a DOI/title — so
the tag names its real source honestly and defers to Scholar via the link.
The page shows the tag for any paper that carries `CitedBy`, so older shard
data (no `CitedBySrc` yet) just renders as Crossref until its pipeline
catches up. Like `/fun/ms/`,
the page carries the optional sign-in feature (star/notes/lists/tags, private
per user, dedicated Firebase project); it stays inert until a web config is
pasted into `FB_CONFIG` in `fun/lit/index.html` — setup steps in
`fun/lit/_ACCOUNTS-SETUP.md`, security rules in `fun/lit/_firestore.rules`.
Signed-in users can also save **default filters** (account menu →
"Default filters"): a preferred subset of journals and/or journal types,
**auto-applied on sign-in** so they land on their subset instead of the full
catalog (distinct from E-mail alerts, which saves filters to get *e-mailed*
about new matches — this pre-applies them to the *page* on entry). It's stored
on the profile doc (`defaultJournals[]`, `defaultJTypes[]`, `autoApplyFilters`;
written with `{merge:true}`, no rules change) and applied by
`maybeAutoApplyPrefs()` in the accounts script — guarded by `prefsAutoApplied`
so it runs once per session (latched at first profile load, so a "not now"
decision — user mid-browse, or a Save whose write echoes a snapshot back — is
also final) and **never overrides filters the user set themselves** (applies
only when their live selection is still empty). It is undone on sign-out
(`autoAppliedActive` → `clearFilters()`), so a signed-out visitor sees the full
catalog again and the next user's own defaults aren't blocked by leftovers.
Auto-applying a catalog (FT50/shard) journal before its lazy manifest arrives is
fine: `registerExtraSources()` re-applies and refreshes the chip label (and the
open modal's list) once the journal registers.
**Keep the About modal in sync:** the **About** modal (`#litAboutOverlay` in
`index.html`) is the user-facing tour of what The Lit does. **Whenever you add or
materially change a user-facing `/fun/lit` feature, update the About modal's copy
in the same change** (e.g. a new journal type, a new filter, a sign-in/library
capability, an alerts option, a Data Analytics view) so it never drifts from what
actually ships — the same keep-in-sync discipline as the `fun/index.html`
landing-page cards.
**Top navigation (in the claret header):** four buttons — **About** (a modal
describing what the browser covers, how to search, and the full data/provenance
notes, mirroring the footer text), **E-mail alerts**, **Data Analytics** (a
link to the sub-page `fun/lit/analytics/` — a sub-page, so NOT a
`fun/index.html` card), and
**Feedback** (a modal with the maintainer's contact links: e-mail
kostas.stouras@ucd.ie, X `@stourask`, Google Scholar, ORCID, website). About and
Feedback are static; the Data Analytics page is standalone. **Data Analytics
(`fun/lit/analytics/`)** is an interactive summary-statistics dashboard over the
whole corpus available in this repo — the eight native sources (`data/`) plus
the FT50 catalog (`data-ft50/`), deduped with native winning on overlap
(~260k papers, 53 journals). It never downloads the ~270 MB of raw papers:
`fun/lit/_scraper/build-analytics.mjs` pre-aggregates everything **offline** into
two small committed files it fetches on load — `analytics/data.json`
(per-journal × per-year rows: paper count `n`, summed authors `a`, solo `s`,
pre-print `p`, citation `c`, abstract `ab`, team-size buckets `t[6]`; plus each
journal's UTD24/FT50/ABS membership — a byte-for-byte mirror of index.html's
`ABS_RATING`/`UTD24_KEYS`/`FT50_KEYS` — and its top-cited papers) and
`analytics/authors.json` (per-author papers/year + papers/journal for authors
with ≥ 5 papers, canonicalised via the datasets' `Name_Variants`, loaded lazily
only when the Author tab opens). Journals for which we collect **editorial
metadata** also carry a `dims` block in `data.json` — per-value × per-year
aggregates (same row shape as `years`) for `editor`/`area` (Management Science's
accepting editor & area) and `se`/`ae` (ISR & Marketing Science senior/associate
editors), thresholded (`DIM_MIN_PAPERS`, areas kept in full) so the file stays
small. The page (vanilla JS, inline-SVG charts, no
external CDN beyond the shared Google Font) offers filters — **journal types**
(the same UTD24/FT50/ABS 4/4*/ABS 3 sets, union with the Journals picker),
**journals**, and a **year-range** slider — driving live tiles (papers, avg
co-authors, solo %, pre-print %, citations) and charts (publication volume by
journal over time, avg co-authors/year, co-authorship distribution, papers by
journal, pre-print availability/year, most-cited table). When a journal that
carries editorial metadata is in scope, an **Editorial breakdown** section shows
click-to-filter bar charts ("Papers by editorial area / accepting editor /
senior/associate editor"); clicking a bar filters the *whole* dashboard by that
value (one dimension at a time, via `aggregate`'s `dims` path — `S.dim`), and a
removable scope pill shows the active value. There is also an **Author
spotlight** tab (per-author totals, in-scope counts, publications-per-year, and
where-they-publish, the latter greying journals outside the current scope).
Refreshed daily by `.github/workflows/lit-analytics.yml` (08:10 UTC, after the
native and FT50 data builds), which commits `analytics/*.json` on master only.
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
(`ref('presence').numChildren()`). RTDB rules are in `fun/lit/_database.rules.json`
(public read of `/presence`, owner-only `true`-valued writes); the whole thing is
**inert until** a Realtime Database is created and its URL is pasted into the
`PASTE_DATABASE_URL` placeholder in BOTH `fun/lit/index.html` (bottom presence
`<script>`) and `fun/lit/analytics/index.html` (`RTDB_URL`) — full steps in
`fun/lit/_PRESENCE-SETUP.md`. The card stays hidden until presence is configured,
so it never shows a broken state. **E-mail alerts**
lets a signed-in user subscribe to an e-mail when new papers matching a set of
filters are added. The form's two top toggles choose *what* to be e-mailed
about: **New features & updates to the website** (first — `criteria.features`, a
subscription to product announcements) and **Any new paper added to the
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
papers and/or a "what's new" feature note, plus the footnote, updating as the
user edits name/criteria/toggles); it **mirrors the mailer's `renderEmail` /
`renderAnnouncement` templates — keep the three in sync**. A save now needs any
one intent (`alertHasIntent`: features, allPapers, or a filter). Alerts are stored
privately at `users/{uid}/alerts/{alertId}` (covered by the existing
`_firestore.rules` wildcard) and managed from the modal (enable/pause switch,
edit, delete). The page only writes subscriptions; **delivery is done by the
mailer** `fun/lit/_scraper/alerts-mailer.mjs`, run daily by
`.github/workflows/lit-alerts-mail.yml`: it reads the recently-added papers
(`data/recent.json` + `data-ft50/recent.json`), reads all alerts via
`collectionGroup('alerts')` with the Admin SDK, matches each with **vendored
copies of the page's journal-list sets + `textMatch`/`authorMatch`** (keep in
sync), and e-mails due alerts over SMTP (`To` recipient, `Reply-To` the
subscriber, `From` = `ALERTS_FROM`/`SMTP_USER`), stamping a per-alert
`lastCheckedAt`/`lastSentAt` high-water mark so nothing is sent twice.
`criteria.allPapers` short-circuits `matchesCriteria` to match every new paper;
`hasPaperIntent` gates paper matching so a **features-only** subscription (no
`allPapers`, no filter) never sends paper e-mails — those are delivered instead
by the **maintainer `--announce` mode** (`node alerts-mailer.mjs --announce
--subject=… --html-file=… [--dry-run]`, `renderAnnouncement`), which e-mails
everyone with `criteria.features` a "what's new" message (deduped by recipient).
Every e-mail's footnote offers **edit preferences / unsubscribe from future
e-mails / feedback** (the manage panel on the site, plus the maintainer
`CONTACT_EMAIL` = kostas.stouras@ucd.ie) and the message carries a
standards-based **`List-Unsubscribe`** header so clients show a native
unsubscribe; the shared chrome (`footerText`/`footerHtml`/`emailShell`) is used
by both `renderEmail` and `renderAnnouncement`. It is a
no-op until the `FIREBASE_SERVICE_ACCOUNT` + `SMTP_*` secrets are set (so it
never fails pre-setup); `--selftest`/`--scan`/`--dry-run` modes and the full
deploy steps are in `fun/lit/_EMAIL-ALERTS-SETUP.md`. No Firestore rule change
is needed. All of the alerts UI logic lives inside the accounts IIFE
(`window.litAlerts*`); About/Feedback are top-level (`window.litAbout*` /
`window.litFeedback*`).

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
**own dataset**, `fun/lit/data-workingpapers/` (kept separate so it can move to
a dedicated `lit-data-workingpapers` Pages repo when it nears the 1 GB limit —
see below), built by the vendored pipeline `fun/lit/_scraper-workingpapers/`
(OpenAlex only: resolves each author's OpenAlex ID from a known catalog DOI,
enumerates their `type:preprint` works, classifies the host with the pre-print
feature's own `pickPreprint`/`preprintFromDoi`, drops anything already-published
or journal-placed, `wpRecordFromWork`). The page **merges it at runtime like the
FT50 catalog** — `loadWorkingPapersManifest()` registers each repository
(`wp-ssrn`/`wp-nber`/`wp-arxiv`/`wp-osf`, one `papers-wp-<host>.json` each,
flagged `"workingPaper": true`) as a lazy `EXTRA_SRC` and records its key in
`WP_KEYS`; `journalTypeKeys('wp') === WP_KEYS`. Records reuse the published-paper
shape (+ `"Status":"Working paper"`) so cards render with **no renderer
changes**: badge, repository tag, clickable **posted-year** chip, **co-authors**,
and the Pre-print link all come for free. **Opt-in:** `neededExtraKeys()`
excludes `WP_KEYS` from the "broad filter loads everything" path, so a normal
search stays published-only — the archive downloads only when the user selects
the Working Papers type or one of its repositories; working papers are also kept
out of the header's published "N papers" count, and out of the "Recently added"
view. `buildJTypeSelect()` **hides the Working Papers type until its archive has
sources**, so the shipped empty `data-workingpapers/` (valid empty manifest)
stays dormant until data lands. **The archive is built ONLINE, slowly:** two
workflows — `lit-workingpapers-backfill.yml` (every 3 h, the growth engine) and
`lit-workingpapers-update-data.yml` (daily refresh + live-site self-heal) — run
`build-data.mjs` on a **bounded, gently paced** (`WP_PACE_MS` ~1.5 s,
`WP_MAX_AUTHORS`, `WP_BUDGET_MS`), **resumable** slice (progress cursor in
`data-workingpapers/_authors.json`), so it fills in over **weeks** without
tripping OpenAlex's rate limits; they share the `lit-workingpapers-${{ github.ref }}`
concurrency group and commit `fun/lit/data-workingpapers/` back (only on
`master`). **Author priority:** Management Science / M&SOM / POM authors (last
15 years) are crawled first (`WP_PRIORITY_KEYS`/`WP_PRIORITY_YEARS`), then the
rest, newest-active first. Distinct OpenAlex quota identity `kstouras+litwp`.
Offline test: `node fun/lit/_scraper-workingpapers/selftest.mjs` (mock, no
network). Migration to a satellite repo is one constant: `WP_DATA_BASE`
`'./data-workingpapers/'` → `'/lit-data-workingpapers/data/'`. See
`fun/lit/_scraper-workingpapers/_HOW-IT-WORKS.md`. NOTE: this build environment's
egress policy blocks the scholarly APIs (OpenAlex/Crossref/arXiv return 403), so
the archive can only be populated by the GitHub Actions runners — it is EMPTY
until the first workflow run on `master` post-merge.
**Range-served SQLite search (`?db=1`, opt-in):** the page can answer
native-journal-scoped filters from a single range-served SQLite DB
(`fun/lit/data/db/lit.db.*` chunks + `lit-db.json` manifest, sql.js-httpvfs
vendored at `fun/lit/sqlite/`) instead of downloading + filtering JSON, fetching
only the DB pages a query touches. STRICTLY ADDITIVE — the default JSON path is
unchanged, and any query the DB can't fully answer falls through to it. It
answers **OR / POM / ACM EC / PNAS** (native journals without the MS/ISR/MkSc
editor UIs) with text/year/pre-print filters and the default year-desc sort;
MS/ISR/MkSc, journal *types*, all-journal searches, non-default sorts and the
recent/library views use JSON. The DB is built by `fun/lit/_scraper/emit-db.mjs`
(narrow `papers` + `papers_abs` side table + contentless FTS5 trigram; rows
inserted in the page's exact sort order so `id` = newest-first rank; membership
read from `index.html`) and chunked by `chunk-db.mjs` under the 100 MB per-file
Pages limit; the query builder is `fun/lit/sqlite/lit-query.js`, the wiring is
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
columns are follow-ups. Tests: `node fun/lit/_scraper/sqlite-parity.mjs`
(28/28 semantic parity) and `sqlite-bench.mjs` (payload/latency). See
`fun/lit/_SQLITE-POC.md`.

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
