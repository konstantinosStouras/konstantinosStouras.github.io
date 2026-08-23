# Repository conventions

This repo is the source of **stouras.com** (Konstantinos Stouras' homepage),
served as a static site via GitHub Pages from the `master` branch. There is no
build step — HTML/CSS/JS are committed and served as-is.

## Branch protection & repo visibility — the DELIBERATE posture

**The default branch is protected against force pushes and deletion ONLY. Do
NOT enable "Require a pull request before merging" or "Require status checks to
pass".** This repo's data is written by its own workflows: 17 workflow steps
(the daily builds, the 15/20-minute incremental harvests, the pre-print /
citations / references / cited-by / working-papers / editors backfills, the
feedback log) push straight to the default branch with
`git push origin HEAD:${{ github.ref_name }}` using `GITHUB_TOKEN`. Rulesets
apply to `GITHUB_TOKEN` pushes too, so a PR requirement would reject every one
of them and `/lit` would silently stop updating. Force-push/deletion rules are
safe because **nothing here ever force-pushes, deletes a branch or pushes
tags** — every push is a plain fast-forward with rebase-and-retry on rejection
(the `--apply-only --merge-cache` replay paths). The same applies to the
sibling repos (`lit-data-abs4`, `lit-data-abs3-omecon`, `lit-data-abs3-rest`,
`lit-data-nature`, `lit-data-science`, `mnsc-scraper`), whose workflows push
the same way; note the default branch is `master` here and `main` in all of
those. Keep **Repository admin** on the
ruleset's bypass list — a one-off history rewrite (`dedupe-data.mjs`,
`clean-titles.mjs`) must stay possible for the sole maintainer.

**This repo and the five `lit-data-*` shards stay PUBLIC.** Private is not an
upgrade here: (1) Pages from a private repo requires a paid plan, so on GitHub
Free the site simply unpublishes — `stouras.com`, `/lit/` and the shard data the
page lazy-loads same-origin from `stouras.com/lit-data-*/data/` all go dark;
(2) even on a paid plan a Pages site published from a private repo is still
world-readable (per-site access control is Enterprise Cloud only), so nothing
about the served data becomes private; (3) public repos get unlimited free
Actions minutes, private ones bill past a small quota — this repo alone fires
~700 scheduled runs/day across 21 workflows, several of them deliberately long
bounded slices (`LIT_PREPRINT_SEARCH_MS`, `LIT_EDITORS_BUDGET_MS`, …), on the
order of 100k minutes/month. `mnsc-scraper` and the feedback log repo
(`FEEDBACK_LOG_REPO`) are the ones that are correctly PRIVATE — the latter holds
submitters' e-mails and screenshots. The real protection for a public repo of
this shape is **secret scanning + push protection** (free on public repos),
guarding `FIREBASE_SERVICE_ACCOUNT`, `SMTP_*`, `S2_API_KEY`,
`ELSEVIER_API_KEY` and `FEEDBACK_LOG_TOKEN`.

## Deploying Firebase rules — ALWAYS name the project

This repository holds **six** unrelated Firebase projects, and the sibling
`OperationsAcademia.github.io` holds a seventh:

| Folder | Project |
|---|---|
| `lit/` | `lit-paper-browser` |
| `_lab-arena-firebase/` | `stouras-answerarena` |
| `_ideasearchlab-src/` | `ideasearchlab` |
| `_portfoliofit-firebase/` | `stouras-portfoliofit` |
| `_portfoliofit-lab-firebase/` | `stouras-portfoliofit-86127` |
| `lab/search-v2/` | `search-with-ai-456d7` |

The Firebase CLI resolves the target from, in order: `--project`, the
`FIREBASE_PROJECT` env var, **the "active project" it remembers PER DIRECTORY
in its own global config**, and only then the default alias in `.firebaserc`.
The remembered one wins over `.firebaserc`, is invisible in the repository, and
survives between sessions — so `firebase deploy --only firestore:rules` run in
one folder can publish that folder's rules into ANOTHER project's database and
print "Deploy complete!".

**It has happened twice, both times to Answer Arena** — once from
`lab/search-v2`, once from `OperationsAcademia.github.io`, whose rules end in a
deny-all catch-all and name none of Answer Arena's collections, so every read
and write in that app was refused until its own rules were re-published.

So **every folder carries `check-project.mjs`, wired as a `predeploy` hook on
every deployable section of its `firebase.json`** (`firestore`, `functions`,
`hosting` — `emulators` is local-only and needs none). The CLI exports
`GCLOUD_PROJECT` to a predeploy hook, so the target is knowable before anything
is uploaded; a mismatch exits non-zero, which aborts the deploy. Run it
standalone to see where a folder would deploy: `node check-project.mjs`.

**Still pass `--project` yourself.** The guard is the net, not the practice:

    cd lit
    firebase deploy --only firestore:rules --project lit-paper-browser

**A new Firebase project means a new guard.** `node tools/deploy-guard-selftest.mjs`
fails when a folder holding a `firebase.json` has no `check-project.mjs`, when a
deployable section is left un-hooked (a guard on the rules alone still lets a
Functions deploy land in the wrong project), when the guard hardcodes a project
id instead of reading `.firebaserc`, or when two folders claim one project.

## Link previews — the card people see before they click

The owner pasted `/lit/` and `operationsacademia.org` into one WhatsApp
conversation. The Lit drew a proper card; the other site drew its own hostname
twice. Chasing that down found a defect class BOTH sites had, and this is the
repository that had been getting away with it.

**A served file that declares another page's `og:url` steals that page's
preview.** Facebook's crawler family — which serves WhatsApp, Messenger,
Facebook, LinkedIn and Viber — keys a preview on `og:url`, **not** on the
address that was pasted. Twenty-five files were being PUBLISHED by GitHub Pages
and between them claimed three live addresses, including the home page's:
five under `backups/`, sixteen under `lab/problem-solving/back-ups/`, three
under `fun/ms-old/back-ups/` and a stray `fun/ms-old/index - Copy.html`, which
went into that folder with them. **Pages runs Jekyll, and Jekyll serves any directory whose name
does not begin with an underscore** — which is why `_ideasearchlab-src/` is
invisible and `backups/` was not. They are `_backups/site/` and `_back-ups/`
now; the two `.bat` scripts that write into the first were repointed with it.
That is the whole fix, and `tools/share-check.mjs` fails if it ever comes back.
**Do not add a `.nojekyll` file to this repository.** It is the one change that
would undo this silently: it turns Jekyll off, and with it the underscore rule
that is the only thing keeping `_backups/`, `_ideasearchlab-src/`,
`_lab-arena-firebase/` and every other `_`-prefixed folder off the web.

**And the Lit's card was out of date, which no check could have caught because
nobody looks at a picture twice.** It said "EIGHT SOURCES" over a catalogue
that had long since passed eight, and gave the address as
`stouras.com/fun/lit` — where The Lit has not lived since it was promoted to
`/lit/`. Every share for months carried both. So the cards are now GENERATED,
by `tools/make-share-images.mjs`, and nothing on one may be a COUNT: the
journal LISTS it filters by (UTD24 · FT50 · ABS) do not move, and eight did.

### The two pictures, and why there are two

    <page>/og-image.jpg      1200x630 (2400x1260 for /lit) — the WIDE card
    <page>/share-square.jpg  800x800                       — the SQUARE one

Every wide-card platform renders `og:image` at about 1.91:1. The Chinese
clients draw a small near-square tile and **centre-crop** whatever they are
given: hand them the Lit card and the crop keeps the word "Research" and
nothing else. The square is offered through `<link rel="image_src">` and
`<meta itemprop="image">`, which those clients prefer and the wide-card
platforms ignore, so each gets the one it can use. Run
`node tools/make-share-images.mjs` to redraw the squares, `--wide` to redraw
the cards as well, `--check` to see what would change — then **look at what
came out** before committing it. Nothing here runs in CI.

### The block, and why each tag is in it

Written from the `MANAGED` table in `tools/share-check.mjs`, which is the one
place the copy lives, and placed directly under the `<title>`: Slackbot reads
the first 32 KB of a document and WhatsApp's parser gives up sooner, so a fat
head above the tags is a documented way to lose a card. (That is also why the
home page's `<meta charset>` was moved to the top of its `<head>` — it sat
behind four `<script>` blocks, past the 1024-byte window a strict parser
commits to an encoding in, and the description carries em-dashes.)

* `og:*` is RDFa — **`property=`, never `name=`**; `twitter:*` is `name=`.
  Backwards, each is invisible to the crawler that wanted it and nothing warns.
* `twitter:card` has **no Open Graph equivalent**, so `og:*` alone can never
  produce X's large card.
* `og:image:width`/`height` must match the file's REAL pixels — Meta lays the
  card out from the declared numbers before it has downloaded the image, which
  decides whether the FIRST person to share a link gets the big card. The check
  reads the JPEG's own SOFn header rather than trusting the tag.
* **Exactly one `og:image`**: several are legal Open Graph and WhatsApp handles
  them badly.
* Under 300 KB, absolute `https`, no redirect — WhatsApp silently drops a
  heavier thumbnail and the card degrades to plain text.
* `<meta name="description">` as well as `og:description`, because WeChat and
  Google read that one and not the Open Graph one.
* `og:site_name` is **"The Lit"** across `/lit/`, not "stouras.com": LinkedIn
  and Discord print it as a line above the title.
* `og:locale` agrees with the language the PAGE declares: the home page says
  `lang="en-us"` and carries `hreflang="en-us"` alternates, so it is `en_US`;
  everything else says `lang="en"` and is written in British spelling, so it is
  `en_GB`. Both are on Facebook's own published locale list. `en_IE`, the
  obvious guess for an Irish site, is NOT — and an unsupported value is ignored
  rather than rejected, so it fails silently, which is this whole section's
  theme.

`MANAGED` covers the pages people actually paste — `/`, `/lit/`, `/lit/about/`,
`/lit/analytics/`, `/lit/feedback/`, `/fun/` and
`/sustainable-supply-chains/` (which had no card at all and now has its own).
**Every other served page that carries `og:*` is CHECKED but not rewritten** —
the `/fun/` games and `/lab/` tools each have a card of their own — and the
three that carry `og:*` with no picture are named in `NO_CARD_IMAGE` with a
reason each, rather than tolerated silently. Redirect stubs carry no `og:*` at
all, which is exactly why `/lit/`'s card never broke while the OA home page's
did. The one allowed shared identity is in `SHARED_IDENTITY`: the root
`404.html` and the Ideation Challenge's own two files, which deliberately carry
the same card because Pages serves the root 404 for that app's deep links.

**robots.txt names the preview crawlers explicitly.** They were already allowed
by the wildcard, but `Crawl-delay: 7` applies to it and Slack honours crawl
delay — seven seconds is long enough to lose an unfurl — and the Facebook
Sharing Debugger has a recurring bug where it answers 403 blaming `robots.txt`
on a site whose only rule is a permissive wildcard.

`.github/workflows/site-checks.yml` runs it, with `tools/deploy-guard-selftest.mjs`,
on every push that touches a page, a card or `tools/`. **It is the first
workflow in this repository that reads the served HTML at all** — every other
one writes data — and it is deliberately read-only, in its own concurrency
group, so it can neither interfere with nor be delayed by the harvests.

**The About page was deliberately NOT rewritten.** The keep-in-sync rule that
covers `/lit/about/` is about what The Lit DOES — a new journal type, a new
filter, a sign-in capability — and how a link previews is not one of those; the
`changelog.json` entry is the right place, and the About page renders that list
itself. Its `<meta name="description">` did change, because every managed page's
did.

### What the check cannot see

That a crawler can REACH the page. A Pages edge answering `facebookexternalhit`
with a 403, a Meta-side domain flag and a cached FAILED scrape all look exactly
like bad tags. One paste into <https://developers.facebook.com/tools/debug/>
settles all three — read **Response Code** and **Time Scraped**, then press
*Scrape Again* two or three times. Do it before concluding a fix did not work:
a handset that has already cached the old card will keep showing it for days.

### WeChat, honestly

Mobile WeChat **does not unfurl a pasted link at all**, whatever the `<head>`
says — Tencent withdrew that in April 2017 for pages without a signed JS-SDK
integration, which needs a verified Official Account and an ICP-filed domain,
neither available to a GitHub Pages site. What DOES read these tags: the
**desktop** WeChat client, **WeCom**, and "share to WeChat" from a mobile
browser. Those are what the square thumbnail is for, and why every `<title>`
has to stand on its own — WeChat's fallback leans on `<title>` and drops
`og:description` even where it crawls. There is no WeChat debugger and no cache
purge; the only reliable re-read is a changed URL (`?v=2`). Separately, for
readers inside mainland China, GitHub Pages is unreliable and the Google Fonts
every page here loads are blocked — a card is not the binding constraint there.

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
`CitedBy` only ever rises, and the fresh record's Abstract is taken UPGRADE-only
via `betterAbstract` — a publisher may deposit the abstract days after first
registration, and this closes that gap within a poll instead of a day, while the
pubsonline/API overlay caches can never be regressed to a Crossref teaser — the
same rule in BOTH incrementals, unit-tested in both selftests), then rewrites
ONLY the small derived files
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
does real work on the GitHub Actions runners. **Duplicate registrations are
collapsed — no paper is ever listed twice:** Crossref keeps superseded
registrations alive (INFORMS's zero-padded DOI switch `.612`→`.0612`, POM's
Wiley→SAGE re-deposit, JSTOR `10.2307` legacy DOIs beside the publisher's own,
JORS's Palgrave→T&F move, online-first stubs never withdrawn), so a DOI-keyed
harvest would list the same paper under two DOIs. `collapseSameWork` in
`build-data.mjs` (replicated near-verbatim in the FT50 + shard pipelines, like
the pre-print machinery) collapses rows that are provably the SAME work —
identical fully-collapsed title (≥15 chars) + a shared author surname + either
the same volume/issue/first-page or a no-volume/no-issue stub within a small
year window (stub-vs-published ≤3y, stub-vs-stub ≤1y) — keeping the fullest
registration (`dupRank`: published > stub, abstract, page range, non-JSTOR/
non-typo DOI) and folding the dropped row's enrichment (`CitedBy`/`Preprint`)
into the kept one. Deliberately conservative: recurring same-title items
(annual editor reports, per-issue notices, multi-part articles) differ in
volume/issue/page or authors and are always kept. The **incremental passes
guard the same way when adding a new paper**: an unknown DOI whose
title+authors match an existing row is never appended — the fuller
registration's DOI is ADOPTED onto the existing row (enrichment preserved, the
registry date migrated so it never re-surfaces as "recently added") or the
lesser one skipped. The working-papers pipeline has its own collapse
(`collapseWpDuplicates`/`wpSameWork` in its `build-data.mjs`: re-posted SSRN
versions and the same paper on two hosts keep the newest posting, earliest
"Date Added"; `wpSameWork` also gates the submission ingest's duplicate check),
and the ms-old Google-Sheet scraper (`mnsc-scraper` repo, `_same_work`) applies
the same guard. The committed back-catalogues were deduped once via the
maintenance CLI `lit/_scraper/dedupe-data.mjs` (`--dir <dataset>` [`--wp`]
[`--dry-run`]; ~20k duplicate rows removed across native/FT50/shards/WP, small
derived files refreshed; authors/affiliations left to the next daily build).
Covered by `incremental-selftest.mjs` (rule unit checks + a DOI-adoption
scenario) and the WP selftests. **Journal types & the FT50 merge:** a "Journal types"
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
counts + summary tabs) applies the pre-print toggle like every other filter.
**EXCEPT under the "Citing papers of" focal filter, where the denominator is
MANIFEST-derived and the percentage is dropped** — "228 of 569,696 papers":
that filter answers from the citation graph (which already knows every citing
paper in the WHOLE catalog) and therefore downloads only the journals its
citers live in, so `scopeCount` would report that deliberately narrow download
("228 of 73,474") as if it were the corpus. `catalogPaperTotal()` (factored out
of `updateHeaderStats`, so the bar and the header can't disagree) and
`citedByCorpusTotal()` (the in-scope journals' manifest counts when a
journal/type IS selected; 0 → caller falls back to `scopeCount`, e.g. a PNAS
section whose count folds into the parent) supply it. The narrowing is
LOSSLESS — verified over all 1,166,176 edges: every citer resolves to a journal
in `refs-index.json` — and a citer that ever lacks one flips the filter's
`wide` flag, which drops the narrowing so every file loads and no row can be
silently missed.
**"N papers added in the last 4 weeks" comes from a TALLY, never from the rows
(`recent-counts.json`).** `recent.json` is fetched with the page, so every
pipeline caps it (`RECENT_CAP`, 1000–1500 rows of a 90-day window). Counting
those rows — what the view used to do — silently under-reports whenever more
than the cap lands inside the displayed 4 weeks, which is not an edge case: a
journal's back-catalogue arriving, a re-registration sweep, or the
working-papers backfill do it routinely (measured 2026-07: 1,000 native rows
carried where 2,833 papers had really been added; the WP archive stamps
~12–16k/day). So every dataset now also publishes **`recent-counts.json`** —
`{generated, windowDays, total, days:{"<jkey>":{"YYYY-MM-DD":n}}}`, ~1 KB,
UNCAPPED — beside its `recent.json`, and `renderRecent()` prints that number.
Keys are the row's WHOLE scope-key set `'|'`-joined (`recentScopeKey`:
journal key first, then its PNAS section keys — `"pnas|pnas-econ|pnas-soc"`),
because that is what `matchesJournal` tests a row against; emitting one entry
per section instead would double-count a paper filed under several. The page
sums the days ≥ cutoff for the keys in scope, per dataset
(`recentExactCount`/`recentCountsKeyVisible` — which also mirrors
`loadDatasetRecent`'s "is this journal registered from THIS dataset" drop, so
the six INFORMS journals the FT50 catalog shares with the native data are not
counted twice), and uses it only when it is **≥ what the rows show**; anything
else falls back to counting rows, i.e. the pre-existing behaviour, so a
missing or stale file (the Nature/Science shards until their vendored
pipelines ship one) can never make the number smaller than what is on screen.
Published and working papers are counted SEPARATELY in the label ("3,914
papers and 85,510 working papers added in the last 4 weeks"), since the WP
backfill would otherwise swamp the figure that matches the header's published
catalog; when the capped list can't show them all it says "· showing the
newest N", and the empty state explains a scope whose additions all fell
outside the slice. **Every writer of a dataset must rewrite this file with
`recent.json`** — the daily builds and both incremental passes (the FT50 one
via `mergeRecentCounts`: polled journals recomputed, the rest carried over and
pruned to the slid window, the same reasoning as its lean `recent.json`
merge), the WP crawler AND `ingest-submissions.mjs`, and `dedupe-data.mjs`
(which re-tallies from the SURVIVING rows, so a removal lowers it too). Tests:
unit + integration checks in `incremental-selftest.mjs` (native + FT50), the WP
`selftest.mjs` and `ingest-selftest.mjs`.
**All four published counters are audited offline by
`node lit/_scraper/counters-selftest.mjs`** — the header's "N papers from M
authors", the recently-added tally, and the analytics scope line + tiles — each
recomputed from the papers files themselves (manifest counts vs rows,
`meta.paperCount`/`perSource`, every tally day against the registry/`Date
Added`, `analytics/data.json` totals vs its own per-journal rows and the
non-research `x` delta). It reads shards exactly as `build-analytics.mjs` finds
them and runs as a report-only (`continue-on-error`) step in
`lit-analytics.yml`, the one job that checks out all five shards. The
dashboard trailing the header by a day of harvests is expected and reported as
a note, not a failure. The
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
`stouras.com/<repo>/data/`. Missing shards 404 and are skipped.
**Topic-filtered shards — Nature & Science (`lit-data-nature`,
`lit-data-science`):** two further satellite shards carry the
Nature-portfolio journals (Nature, Nature Human Behaviour, Nature
Communications; keys `nature`/`nhb`/`ncomms`) and Science (`science`) as
**curated topical SLICES, never full catalogues** — only papers on
GenAI/LLMs, innovation and the science of science (per the owner). These
journals publish across all of science (Nature's Crossref catalogue alone is
~446k articles), so instead of the shards' harvest-everything pattern their
`build-data.mjs` is TWO-STEP: (1) an **OpenAlex scope seeding** — each repo's
curated `_scraper/scope.json` lists topic IDs (T10102 scientometrics,
T10003 innovation & knowledge management, T10181 NLP, T10028 topic modeling,
T10883 ethics/social impacts of AI, T12128 AI in service interactions,
T12026 XAI, T13910 computational text analysis, T10068 technology adoption),
quoted `title_and_abstract.search` phrases ("large language model",
"ChatGPT", "generative AI", "science of science", …), per-journal
`mustInclude` DOIs (the owner's six requested papers — force-included so an
OpenAlex re-tag can never drop them) and `excludeDoiPrefixes` (Nature's
`10.1038/d41586-*` NEWS DOIs) — unioned per journal into the committed,
audited `data/_scope.json` (fallback to the committed scope on a failed or
half-shrunken seed); then (2) a **Crossref by-DOI batched harvest** of
exactly those DOIs, flowing through the unchanged vendored shard machinery
(collapseSameWork, pre-prints, citations, abstracts overlay, registry), so
the served layout is byte-compatible and the page needs nothing special.
This is the PNAS-sections idea rebuilt on OpenAlex topics because it runs in
CI: pnas.org needs a local scrape, science.org is bot-blocked for cloud IPs
with no public per-article taxonomy, and nature.com's subject tags (readable
from runners) don't map onto these cross-cutting themes. Both repos'
manifests carry **no `abs` field** (Nature/Science are outside the AJG), so
their journals join the Journals filter (" — limited coverage") without
entering any type bucket, like PNAS; abstracts rely on each repo's
`abstracts-backfill.yml` (the Nature portfolio deposits NO abstracts to
Crossref). OpenAlex identities: `+litnature`/`+litnaturecite`/
`+litnatureabs`, `+litscience`/`+litsciencecite`/`+litscienceabs`. Offline
test in each repo: `node _scraper/scope-selftest.mjs`. To widen/narrow the
filter, edit `scope.json` (keep the two repos' topics/searches lists in
sync); to rescue a paper the filter missed, add its DOI to `mustInclude`.) **Everything loads lazily:** no papers file (native or catalog)
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
(`FT50_INCR_JOURNALS`, default **`ecta,ejor`** = Econometrica + EJOR). It upserts
into those `papers-<key>.json` (appends new DOIs; for a known DOI refreshes only
core bibliographic fields, PRESERVING enrichment — `Preprint`/`CitedBy`+`CitedBySrc` —
and takes a materially-fuller Abstract via `betterAbstract`, the EJOR case:
Elsevier deposits many abstracts only days after registration, so an
Articles-in-Press row added abstract-less gains its abstract within a poll
instead of at the next daily rebuild),
then rewrites only the small derived files, doing a **lean recent.json merge** —
the polled journals' fresh rows unioned with the last build's recent rows for
every OTHER journal (correct because it and the daily build are the only
data-ft50 writers and share the `lit-ft50-update-data-${{ github.ref }}`
concurrency group, so nothing else changed) — instead of reloading all ~50 papers
files. It **writes nothing when nothing new arrived**. Why THESE journals: lit's
own `lit-check-new` already fast-tracks the eight native INFORMS/SAGE AIA
journals, so this pass exists for the ones that live ONLY in the FT50 catalog.
**Econometrica** because its publisher assigns an accepted paper straight to a
future issue — so Crossref never lists it as a no-volume advance article and the
daily build was otherwise the only thing that ever picked it up (up to a day
late). **EJOR** because it is the catalog's highest-volume journal (~700
papers/year across 24 issues + a ~40/month Articles-in-Press stream, so 1–2
genuinely-new records most days), which the once-a-day build delivered in one
nightly batch; its back-catalogue was audited complete at the same time (see
`coverage-audit.mjs` below), so freshness was the only thing lacking. Adding a
key costs one Crossref call per ISSN per run and nothing else — the pass still
writes only on a genuine change, so a quiet 20-minute fire commits nothing.
Offline test: `node lit/_scraper-ft50/incremental-selftest.mjs` (mock, no
network; fixtures `mock/crossref-ecta.json` and `mock/crossref-ejor.json`, the
latter covering the no-volume Articles-in-Press case that motivated polling EJOR
plus a "two polled journals still no-op on unchanged data" check). NOTE: this
build env's egress blocks Crossref (403), so the incremental pass only does real
work on the GitHub Actions runners.
**Completeness auditing — `lit/_scraper/coverage-audit.mjs`.** "Are we actually
missing papers from journal X?" cannot be answered by counting our own rows (the
harvest and the count share a source, so a gap is invisible), so this **offline,
no-network** maintenance CLI — beside `dedupe-data.mjs`/`clean-titles.mjs`, same
`--journal <key>` [`--dir <dataset>`] [`--from <year>`] [`--verbose`] [`--json`]
shape, auto-locating the papers file across native/FT50/shard dirs — applies two
probes INDEPENDENT of the harvest. **(A) Page tiling:** an issue paginates
contiguously, so its articles' page ranges must tile it; a hole is a suspected
missing paper. Measured WITHIN an issue (a jump at an issue boundary is that
issue's front matter — the `IFC`/roman-leaf rows — not a missing article) and
1-page holes ignored (blank verso). Since that probe cannot see a WHOLE missing
issue (the volume would just end early) it is paired with a volume-run +
issue-set check: every volume number present, each volume carrying its journal's
modal issue set. Volume/issue labels are normalised numerically — `"00"`
placeholder volumes are skipped (Econometrica deposits them on some corrigenda)
and a split issue (`"4-part-1"`/`"4-part-2"`, OR vol 58) folds into its issue
number, or both would read as false gaps. **(B) Cited-DOI probe:** every DOI of
the journal that appears in `data-refs/_refs-cache.json`'s RAW reference lists is
a paper some catalog paper cites — proof it exists, from a corpus with nothing to
do with our journal harvest — so any such DOI absent from `papers-<key>.json` is
a PROVEN hole. It derives the journal's DOI stem set itself by cutting each DOI
at its first variable numeric field (so `10.1016/j.ejor.2015.05.082` →
`10.1016/j.ejor`, the legacy Elsevier PII `10.1016/S0377-2217(99)…` →
`10.1016/0377-2217(`, `10.3982/ECTA24001` → `10.3982/ecta`), keeps the stems
explaining ≥95% of rows and SKIPS the probe when they cannot (Econometrica's
JSTOR-era `10.2307/` DOIs give no journal-specific stem, and matching the bare
registrant would pull in every other JSTOR journal). It is deliberately
high-precision, via THREE guards. (1) Trailing sentence punctuation is stripped
from a cited DOI first. (2) A DOI whose SHAPE (digit runs → `#`, letter runs →
`@`) is not one the journal itself uses is a **malformed citation** (OCR slips
like `mnsc.l070.0830`), never a missing paper. (3) A DOI naming a
(volume, issue, first page) we already carry is a **variant registration**, not a
hole — INFORMS' pre-2010 form is `<journal>.<vol>.<issue>.<firstPage>.<id>` with
an opaque trailing id, so a cited `mnsc.46.9.1249.12220` is the SAME paper as our
`mnsc.46.9.1249.12238` (`coordIndex`/`heldAtSameCoords`). That guard is keyed on
the article's COORDINATES, deliberately NOT on "matches one of ours except the
last field", which would be wrong for date-sequence DOIs — `j.ejor.2006.02.001`
and `j.ejor.2006.02.003` differ only in the last field yet are different papers.
Exit code 1 on a proven hole so it can gate CI; probe B under-samples the newest
years by construction (an unpublished-last-month paper has no citers yet), which
the output states. Current readings: **EJOR 2007–2026 is complete** — 160 volumes
with no gap, every volume its 3 issues, tiling coverage 99.89% (~14 suspected,
all pre-2016), and **0 of 2,446** cited EJOR DOIs missing. It also flagged
**Operations Research vol 67 (2019) as missing issue 2 plus most of issue 4**
(page tiling: iss 2's 295–598 and most of iss 4's 905–1208 untiled) — but READ
THE TWO PROBES TOGETHER: probe B simultaneously showed **0 cited OR DOIs
absent**, and the resolution (owner-supplied pubsonline TOCs, 2026-08-03) is
that the papers were IN the catalog all along as **frozen no-volume/no-issue
records** — Crossref never received their final issue assignment (the same
freeze afflicted **vol 68 (2020) issue 2**; all repaired once the owner
supplied the three pubsonline TOCs). A
tiling hole with a CLEAN cited-DOI probe therefore means MISLABELED, not
missing — repaired via `_aia-fixups.json` (51 OR entries from the TOCs:
17 for 67(2), 16 for 67(4) with exact pages, 18 for 68(2) with exact pages +
year; fill-empty semantics in mapWork for volume/issue/page, so a later
Crossref correction wins). THREE papers were genuinely absent —
`10.1287/opre.2018.1783` "On the Minimum Chordal Completion Polytope" 67(2)
532–547, `10.1287/opre.2018.1827` "TN—Optimizing Foreclosed Housing
Acquisitions" 67(4) 950–964, and `10.1287/opre.2019.1870` "Fast or Slow"
68(2) 552–571 — and those proved ABSENT FROM CROSSREF ENTIRELY (validated
live 2026-08-03: the batched `filter=doi:` route returned nothing AND the
singular `GET /works/<doi>` 404s for all three), so they are carried by the
native **`lit/data/_informs-aia.json` supplement** (titles/authors from the
publisher TOCs; `mergeSupplement` is FIXUP-AWARE — a supplement row whose DOI
has an `_aia-fixups.json` volume/issue entry lands PUBLISHED with its real
pages/year, not as Articles in Advance; abstracts left to the pubsonline
needy harvest; superseded by DOI if Crossref ever registers them). Gaps
Crossref CAN serve are repaired by the
**by-DOI rescue** (`rescueMissingWorks` in the native `build-data.mjs`): the
committed manifest `lit/data/_rescue-dois.json` names, per journal key,
explicit `dois` and/or OpenAlex volume `scans` (`[{volume}]`, resolved each
daily build via `works?filter=locations.source.issn,biblio.volume` so the DOI
list self-heals); whatever the journal-route listing missed is batch-fetched
from Crossref by DOI (each still-missing explicit DOI then retried on the
singular `GET /works/<doi>` endpoint, which can serve registered-but-unindexed
records the filter route misses) and APPENDED TO THE RAW ITEMS, so the type filter,
mapWork sanitize (incl. `junkAbstract`), `collapseSameWork` and registry
stamping treat rescued rows exactly like harvested ones (they join "recently
added" dated by the build). Guards: a scan-found DOI is kept only when the
FETCHED record's own volume matches the scan (an OpenAlex misattribution can
never smuggle another journal's paper in), and an explicit DOI Crossref cannot
resolve is REPORTED (`::notice::`) and skipped, never fabricated — which is
also how a suspected-missing DOI is safely probed: `10.1287/mnsc.2014.1882`
(1 citer) was carried as exactly such a probe and RESOLVED — Crossref cannot
serve it as an MS journal-article, so it was a bad reference in some paper's
bibliography, and the probe was removed; an OpenAlex volume scan for OR 67
likewise proved barren (69 works — OpenAlex mirrors Crossref's metadata hole)
and was removed; the three genuinely-absent OR papers were likewise probed to
"Crossref lacks them entirely" and moved to the supplement (above), so the
manifest is currently EMPTY (comment-only). The rescue re-runs every daily build because the build REPLACES each
journal from the fresh harvest (a one-off data patch would be wiped next
morning); rescued rows persist intra-day because the incremental pass upserts
into the committed files. Wholly non-fatal — any failure just means no extra
rows that build. Offline test: `node lit/_scraper/rescue-selftest.mjs` (mock,
no network; covers the volume guard, the 404 probe, registry/recent stamping
and rebuild stability). AIA fixups for the catalog come from
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
pnas.org's search is Cloudflare-blocked for cloud IPs. **PNAS completeness is
tracked honestly (the 2008–2025 gap fix):** a truncated pnas.org crawl (1–4
pages/section, 864 DOIs) once got stamped `full:true` and `applyPnasSections`
treated it as authoritative — dropping every pre-cutoff paper it had missed,
while the OpenAlex approximation (`_pnas-approx.json`, itself truncated to
2015+ yet stamped full) was confined to the current year. Now `crawlConcepts`
claims `ok` only when EVERY section's listing reached a genuine NON-EMPTY
not-full last page (result-count headers are never a stop signal, an empty
page is never trusted as the end — pnas.org can serve an HTTP-200 zero-result
template mid-listing; junk chrome DOIs filtered like the console script); a
complete full crawl stamps `fullAsOf` (the authority horizon —
partial/incremental merges advance only `updated`) and REPLACES the map;
`refreshPnasApprox` records `total`/`scanned` and stays un-full (re-attempting
next build) when the OpenAlex cursor walk didn't cover ~95% of the declared
corpus, prunes non-`10.1073/pnas.` junk ("In This Issue" stubs) and salvages
partial progress on error; and `applyPnasSections` applies the safety valve
the console script documents — the official index may EXCLUDE papers only
when it CARRIES a `fullAsOf` stamp (the sticky `full` flag alone is exactly
what lied; partial sittings can never re-earn authority by size) AND is
≥ half the approximation's size, else official labels win per-paper while the
approximation covers all years. The
legacy caches lack the new completeness fields, so the first post-merge daily
build re-runs the full OpenAlex backfill and the next local pnas-concepts run
does a full (not incremental) crawl automatically. Offline test:
`node lit/_scraper/pnas-selftest.mjs`. **ISR/MkSc caveat:**
likewise, ISR Senior/Associate Editor and Marketing Science Senior Editor
names (`lit/data/_informs-editors.json`) come from
`lit/_scraper/informs-editors-local.mjs` run locally (pubsonline blocks
cloud IPs too) — until that cache is first committed, only the few papers
whose Crossref abstract/assertion carries the History line have SE/AE.
**Marketing Science is crawled FIRST** (`mksc` before `isre`, newest papers
first — per the owner: MkSc SE coverage, e.g. Olivier Toubia's accepted
papers, is the priority); a sitting can be bounded with `--journal mksc`,
`--last-years 20` / `--since 2006` (year floor) and `LIT_EDITORS_DELAY_MS`
(pace, floor 700 ms) — `crawl-mksc-editors.bat` is the one-click
MkSc-last-20-years run. **Every crawl ends by APPLYING the cache onto the
served `papers-mksc.json`/`papers-isre.json`** (`applyToPapers`,
fill-empty-only — the same semantics as build-data's `applyInformsEditors`),
so collected names go live on the very next commit + push instead of waiting
for the daily build (`--no-apply` skips; `--apply-only` applies without
crawling, e.g. after a console harvest — commit `lit/data/`, not just the
cache file). **CI also ATTEMPTS the crawl on its own**
(`.github/workflows/lit-editors-backfill.yml`, every 3 h, bounded ~45-min
resume-safe slices via `LIT_EDITORS_BUDGET_MS`, master-only commits, shares
the `lit-update-data-${{ github.ref }}` concurrency group, push-retry replay
via `--apply-only --merge-cache` — a merge never downgrades an editor record
to a none-record): when the runner is blocked, the first challenged page (or
`LIT_EDITORS_MAX_FAILS` consecutive failures) ends the run cleanly in ~a
minute with nothing committed, so the standing attempt costs almost nothing;
if pubsonline ever answers a runner, the backlog burns down online with no
babysitting. It is listed in `ci-pause-backfills.bat`/`ci-resume-backfills.bat`
like every other lit-data writer, so local crawls stay the sole writer while
they run.
**Full abstracts for INFORMS papers:** Crossref's deposited abstract for many
INFORMS papers is a one-sentence TEASER (MkSc especially — ~800 of its ~2,300
rows short/missing); the real abstract is on the pubsonline page.
`lit/_scraper/informs-abstracts-local.mjs` (browser fallback
`informs-abstracts-console.js` — vendored extractor, keep in sync,
parity-checked by `informs-abstracts-selftest.mjs`) crawls ONLY needy papers
(served Abstract < 300 chars; `--all` lifts), MkSc first then the other
INFORMS journals, newest first, into `lit/data/_informs-abstracts.json`
(doi → `{a}` | `{none:1}`), and every crawl/`--apply-only` ends by applying
the cache onto the served papers files — **UPGRADE-only** (`betterAbstract`:
materially-longer-only, so a page fragment can never replace fuller existing
text). `build-data.mjs` re-applies the committed cache in BOTH the daily
build and the incremental pass (`applyInformsAbstracts`), so a rebuild can
never regress a fixed abstract back to the teaser. Same CI knobs as the
editors crawler (`LIT_ABSTRACTS_DELAY_MS`/`_BUDGET_MS`/`_MAX_FAILS`,
cookie via `LIT_CF_COOKIE`+`LIT_UA`); the standing pubsonline CI attempt
(`lit-editors-backfill.yml`) runs this crawler as a second step (25-min
slice) after the editors one, replaying BOTH caches on its push-retry.
**The apply step also covers the FT50 catalog's copies of the five INFORMS
journals** (`FT50_APPLY` in informs-abstracts-local.mjs — same DOIs), and
the FT50 daily build overlays the same cache itself (`applyAbstractCaches`
in `_scraper-ft50/build-data.mjs`). **FT50-wide abstracts (the ~45
non-INFORMS journals)** come from a separate ONLINE backfill —
`lit/_scraper-ft50/abstracts-ci.mjs`, run 4×/day by
`.github/workflows/lit-ft50-abstracts-backfill.yml` (shares the
`lit-ft50-update-data-*` concurrency group; in the ci-pause lists): many
FT50 journals deposit no abstract to Crossref, so it resolves missing/stub
rows by DOI via OpenAlex `abstract_inverted_index` (reconstructed;
batched 50/call) with an optional Semantic Scholar leg (500 DOIs/POST,
drops out on throttle; an `S2_API_KEY` secret moves it off the anonymous
pool) **plus an Elsevier Abstract Retrieval leg** for `10.1016/…` DOIs —
the bulk of the still-missing FT50 abstracts (EJOR/JFE/AOS/OBHDP/JAE/
Research Policy…) are Elsevier journals whose text OpenAlex/S2 may not
serve; INERT until an `ELSEVIER_API_KEY` secret is set (free institutional
key from dev.elsevier.com; `elsevierAbstract` parses `dc:description`,
keyed runs re-try earlier keyless `{none}` stamps for Elsevier DOIs, and
the leg drops out for the run on 401/403/429 so a spent quota never stalls
the batched legs), caches into `data-ft50/_api-abstracts.json`
(doi → `{a}` | `{none:1,t:day}`, misses retried after
`FT50_ABS_MISS_TTL_DAYS` 45), and applies UPGRADE-only via the same
`betterAbstract`; `applyAbstractCaches` folds it into every FT50 daily
build. Distinct OpenAlex identity `kstouras+litft50abs`. Offline test:
`node lit/_scraper-ft50/abstracts-selftest.mjs`.
**A keyed leg that never ran must not write its DOIs off** (`shouldStampMiss`,
pure + unit-tested). The per-DOI Elsevier/Springer legs drop for the WHOLE run
on 401/403/429, and the time budget can cut one mid-batch — but the
end-of-batch "stamp the rest as misses" then recorded a 45-day miss for a
check that never happened. Observed live: `ELSEVIER_API_KEY` is set, Elsevier
refused it, the leg dropped on its first call, and **16,908 EJOR DOIs were
written off as "no abstract" in a 9-minute run** that could not physically have
queried them (one GET per DOI at `ELS_PACE_MS` 350 ms ≈ 98 min). So each batch
now tracks which DOIs a keyed leg actually reached (`keyedTried`) and leaves
the rest uncached for the next run. A configured-but-refused key also emits a
`::warning::` naming the HTTP code and its meaning (401 bad/expired key, 403 no
off-campus abstract entitlement → get an institutional token and set
`ELSEVIER_INST_TOKEN`, 429 quota) — the run otherwise exits 0 and looks healthy
while achieving nothing. **This is why EJOR abstract coverage sits at ~10%**:
Elsevier DOIs resolve at 7.6% against 87.7% (OUP), 85.6% (AAA), 70.3% (AoM) —
a credential problem, not a code or coverage one. The needy queue is already
sorted newest-year-first, so 2026 is served before older years. **The same backfill is
VENDORED into each ABS shard repo** (`_scraper/abstracts-ci.mjs` +
`abstracts-selftest.mjs` + `abstracts-backfill.yml`, identities `+abs4abs`/
`+abs3omabs`/`+abs3restabs`; `betterAbstract`/`ABS_MAX` inlined) — the shards
are mostly Elsevier journals with ~173k missing abstracts, so the Elsevier leg
matters most there (each shard repo needs its own `ELSEVIER_API_KEY`/
`S2_API_KEY` secrets — per-repo on a personal account); each shard's daily
build re-applies the cache via its own `applyAbstractCaches`, so a rebuild
never regresses a backfilled abstract. An `S2_API_KEY` secret, where set, is
also sent by every Semantic Scholar leg (citations sweeps in all five
pipelines, the references backfill, EC enrichment).
**Text sanitization is shared in `lit/_scraper/_entities.mjs`** (VENDORED into
each shard repo's `_scraper/_entities.mjs` — keep in sync, like the pre-print
machinery): `cleanText` decodes HTML/JATS entities (repeatedly, so a
double-encoded "&amp;lt;sup&amp;gt;" fully resolves) THEN strips the revealed
markup (sub/sup with no space so "P<sup>2</sup>-FORM" stays "P2-FORM" and
chemistry stays "Cs3Cu2I5"; a tag must start with a letter so "P &lt; 0.05" and
a bare `<http://…>` URL survive) and decodes once more. Every pipeline's
`stripJats` is now an alias of it — the OLD local stripJats decoded only
`&lt;/&gt;/&amp;` and stripped tags BEFORE decoding, so double-encoded markup
survived as literal "&lt;sup&gt;" text and every other entity ("&apos;",
"&nbsp;", "&EACUTE;") rendered raw on the page. Entity names match
CASE-SENSITIVELY (&Eacute;=É vs &eacute;=é) with an ALL-CAPS fallback
("&EACUTE;" → É, for all-caps titles); an UNKNOWN name (publisher typo
"&haelip;", "AT&T;") is left intact, never guessed — add new names to
`HTML_ENTITIES` only when the character is certain. `authorName` decodes too
(then strips commas, so a decoded comma can never add a phantom author — the
page splits Authors on commas).
**Stray trailing separators are trimmed at ingest** (feedback LIT-260725-YWTL).
Some publishers deposit a title with a dangling `,`/`;`/`:` — OUP's JEEA/EJ
("The Lock-In Effect and the Corporate Payout Puzzle,"), AMR ("The Ethics of
Organizational Politics ,"), or a lost subtitle ("America's Best:") — and the
same artifact reaches affiliation names ("University of Tokyo ,"), where a
dangling `;` also shows as a doubled "; ;" once the set is joined. `titleText`
(= `cleanText` + the trim), `affilName`/`affilParts`/`affilList` (entity-`;`
masked through the split; iterated to a fixed point) live in `_entities.mjs`
beside `trimTrailingSeparators`, which cuts one separator at a time but **NEVER
the `;` that terminates an entity `cleanText` left intact** (an unknown name like
"…&haelip;") — cutting it would corrupt the entity. The working-papers pipeline's
`cleanText` was the reference implementation, promoted to the shared module;
its `cleanTitle` = `titleText`. All pure + idempotent, so every build re-applies
safely. The committed back-catalogues were cleaned via the maintenance CLI
`lit/_scraper/clean-titles.mjs` (`--dir <dataset>` [`--dry-run`]; Title +
Abstract + Significance + Authors + Affiliations; first pass: 307 titles + ~14k
affiliations; entity pass: 73 titles, ~700 abstracts, ~3.1k affiliations, 88
author strings across native/FT50/shards/WP, `recent.json` refreshed too;
authors/affiliations panels left to the next daily build, as with
`dedupe-data.mjs`). Registry keys are unaffected (`normTitle` strips
non-alphanumerics, and every entity-bearing title had a DOI — verified), so no
paper resurfaces as "recently added". Covered by
`lit/_scraper/entities-selftest.mjs` (the module's own suite) plus unit checks
in `incremental-selftest.mjs` (native + FT50) and the WP `selftest.mjs`.
**SHOUTED author names are re-cased at ingest** (user report 2026-08):
Wiley's JoF, JAR/CAR and some POM/AMJ records deposit fully-capitalized
author names ("MICHAEL EWENS, NADYA MALENKO" — ~6,300 rows). `nameCase` in
`_entities.mjs`, applied inside BOTH pipelines' `authorName`, title-cases a
name ONLY when the WHOLE name is shouting (no lowercase anywhere — the
trigger, not the transform, is the safety): per-segment across hyphens and
apostrophes ("JEAN-PIERRE" → "Jean-Pierre", "O'BRIEN" → "O'Brien"),
diacritics preserved, `MC` humped ("MCDONALD" → "McDonald") but `MAC`
deliberately NOT (Machado), roman-numeral suffixes kept, JR/SR → Jr/Sr,
single-letter initials untouched; a mixed-case "John MacDonald" or particled
"van der Berg" is never altered. Committed rows heal on each daily rebuild
(authors.json/affiliations panels follow); shard repos get it when
`_entities.mjs` is next vendored (same follow-up as junkAbstract/
stripHighlights). Unit-tested in `entities-selftest.mjs` (14 cases).
**Article-page furniture is never served as an abstract** (feedback
LIT-260727-XRQ8). Two junk shapes reached served abstracts:
the pubsonline full-abstract harvest could capture the page's navigation +
"Cited by" block AFTER the real abstract on layouts carrying none of the
extractor's stop-class signatures ("… Previous Back to Top Next Figures
References Related Information Cited by <citing-article list>" — the reported
Search Duration MkSc card, ~350 MkSc/MS papers), and Semantic Scholar sometimes
serves a scrape of the WHOLE article page — share bar, "Get access" author
links, citation metadata, Wiley's "No abstract is available for this article."
— for items that have no abstract at all (OUP/U.Chicago/AoM/Silverchair/
MIT-Press/Wiley journals: QJE, RESTUD, EJ, JPE, JCR, TAR, RFS …).
`stripPageFurniture` in `_entities.mjs` (vendored into the shard repos with the
rest of the module) cuts everything from the first navigation signature on and
rejects a remainder that is page chrome rather than abstract prose —
high-precision like `isNonArticle`: the cut anchors on the full "Figures
References Related Information" label sequence (never bare "Back to Top", which
can occur inside a real sentence), and rejection needs either one unambiguous
scraped-page marker ("Search for other works by this author", "PDFPDF",
"Download citation file" …) or two weaker ones together, so a lone "…request
permission…" in real prose never rejects. Applied at EVERY abstract ingest:
mapWork + the supplement merge in all five build-data pipelines, the WP
`wpRecordFromWork`, EC's S2 enrichment, all four `abstracts-ci.mjs` API legs,
and the pubsonline extractor's `cleanAbstractText` (console copy vendored in
sync, parity-checked). The crawlers/backfills also HEAL their caches at load,
so a stale contaminated cache (e.g. the console harvester's localStorage from
an earlier sitting) can never re-apply junk: chrome-only `_informs-abstracts`
entries are DELETED (re-crawl with the fixed extractor), chrome-only
`_api-abstracts` entries re-stamped as TTL misses (re-resolved under the
guard). The committed data was repaired in the same change: ~500
tail-contaminated abstracts cut back to their real text and ~11.4k
chrome-scrape "abstracts" emptied across native/FT50/shards — rows that never
had a real abstract on the scraped page, which the rolling backfills re-resolve
from the APIs' actual abstract fields. Covered by `entities-selftest.mjs`,
`informs-abstracts-selftest.mjs` (incl. the parity pass) and the FT50/shard
`abstracts-selftest.mjs`.
**A publisher summary or citation line is never served as the abstract**
(user report 2026-08: every recent Operations Research card showed an
editorial plain-language summary — a headline + "In '<Title>', <the authors>
develop…", third person, naming the paper's own authors — instead of the real
abstract; INFORMS deposits these blurbs to Crossref for many OR/IJOC/ISR/MS
papers, AEA deposits "<Title> by <Authors>. Published in volume …" stubs, and
JSTOR/OUP-era records carry "<Authors>, <Title>, <Journal>, Vol. …, pp. …"
citation lines). `junkAbstract` in `_entities.mjs`
(`isLaySummaryAbstract`/`isCitationStubAbstract`) detects both shapes
HIGH-PRECISION against the row's own title/authors/journal: a summary names
its OWN authors in the body or quotes its OWN title mid-prose — things a real
abstract never does outside the Funding/COI/"accepted by" tail INFORMS
appends, which is cut before author names are counted. Deliberate
non-matches: errata/replies/comments/book-review notices (legitimately
self-citing), IJOC "Code and Data Repository for …" companions, and "the
authors" WITHOUT names (Journal of Marketing style); **HBR + MIT SMR are
exempt** (`JUNK_ABS_EXEMPT_KEYS`) — practitioner decks ARE those journals'
own summary text. Applied at EVERY abstract ingest: mapWork + the supplement
merge in both this repo's pipelines, `applyInformsAbstracts` /
`applyAbstractCaches`, the pubsonline crawler's apply, and all four
`abstracts-ci.mjs` API legs (OpenAlex/S2 MIRROR the publisher deposit, so
without the leg guard the backfill would reinstate exactly what the build
dropped) — a junk API result is left unresolved → TTL miss. The FT50 apply
step also HEALS its cache (a junk `_api-abstracts.json` entry re-stamped a
miss — 2,820 found live). The committed data was cleaned via the maintenance
CLI `lit/_scraper/clean-junk-abstracts.mjs` (`--dir <dataset>` [`--dry-run`];
~3,060 junk abstracts blanked: 129 native — 102 of them Operations Research —
+ 2,932 FT50, `recent.json` refreshed, both caches healed); the blanked rows
are "needy" again, so the pubsonline harvest (<300-char rule) and the FT50
API backfill re-fill the REAL abstracts on their normal cadence — a paper
shows no abstract, never a description of itself, until then. VENDORED into
all five shard repos' `_entities.mjs` copies (guards in each vendored
build-data/abstracts-ci, `clean-junk-abstracts.mjs` vendored + run: abs4
1,366 rows blanked — mostly EJ/REStat/JHR/IER OUP citation lines — + 1,358
cache entries healed; abs3-omecon 2, abs3-rest 12; nature/science clean,
guard preventive). Covered by `entities-selftest.mjs`.
**ScienceDirect "Highlights" bullets are never served as the abstract** (user
report 2026-08, the EJOR case). Elsevier deposits many papers' author
HIGHLIGHTS — the 3-5 short ScienceDirect bullet points — as (or fused onto)
the Crossref abstract, and OpenAlex/S2 mirror the same deposit into the API
backfill's cache (~170 EJOR + ~120 Research Policy + ~10 OBHDP rows read
"• A new measure… • We provide…" as their abstract; 334 poisoned
`_api-abstracts` entries). `stripHighlights` in `_entities.mjs`: prose
≥250 chars BEFORE the first bullet = the real abstract with highlights
appended → KEEP the prose, cut the bullets (217 rows recover their abstract);
text STARTING with the bullet block (bare, "Highlights"-labelled or led by
the paper's own title) has no safe seam even when the abstract is fused into
the last bullet → dropped, the row is needy again (~80 rows; no abstract
beats a wrong one). Guards: <2 bullets never trips it (a lone mid-prose `•`
survives); any long inner inter-bullet segment (>250) = prose legitimately
using bullets, untouched. Applied at BOTH mapWorks (native + FT50), all
`abstracts-ci.mjs` API legs (`elsevierAbstract`/`springerAbstract`/OpenAlex/
S2), the cache heal-at-load, and `applyAbstractCaches` (guarding the window
before the next heal). The ~300 committed rows heal automatically on the next
FT50 daily build (the build re-maps every abstract from fresh Crossref
through the strip — no manual sweep needed). Same shard-repo vendoring
follow-up as `junkAbstract` above. Covered by `entities-selftest.mjs`.
**ALL-CAPITALS titles are restored to sentence case at ingest** (feedback
LIT-260728-TVQ5). Older registrations shout — PNAS's pre-1970s back-catalogue,
POM's Wiley years, JoF, TAR, AMJ, IER, Economic Inquiry: "MARKET EQUILIBRIUM",
"A PENTAPLOID LARVA OF THE NEWT, TRITURUS VIRIDESCENS". Beyond reading badly it
wrecked the **BibTeX export**, whose `bibTitle` brace-protects every capital
after the first, so the user copied
`M{A}{R}{K}{E}{T} {E}{Q}{U}{I}{L}{I}{B}{R}{I}{U}{M}` into their `.bib`.
**SCOPE, per the owner: ONLY all-capitals titles.** A Title Case title
("Modeling First: Rethinking Undergraduate Operations Management with AI") is
how it was published and is left EXACTLY alone — which is why `isAllCapsTitle`
demands ZERO lowercase letters (plus ≥8 capitals, ≥2 words, and ≥1 word the
lexicon does not know as an acronym, so "DNA" / "IEEE ACM" are never
"corrected" while "DNA AND RNA" is). `sentenceCaseTitle` + `isAllCapsTitle`
live in `_entities.mjs` beside the other guards and are folded into `titleText`
(= `cleanText` + `trimTrailingSeparators` + the recase), so every pipeline that
already used `titleText` is covered with no per-pipeline change; pure +
idempotent, so every build re-applies safely. Restoring case is NOT
`toLowerCase()`: acronyms (DNA, CAPM, ANOVA) and proper nouns (Bayesian,
Cournot, Drosophila) must keep their capitals and an all-caps string carries no
evidence of which is which — so the evidence is MINED from the ~715k
properly-cased titles + ~306k abstracts the catalog already holds, into
`lit/_scraper/_titlecase-lexicon.mjs` (1,165 words + 418 phrases, generated by
`build-titlecase-lexicon.mjs`; **VENDORED into each shard repo's
`_scraper/`, exactly like `_entities.mjs` — keep both in sync**, and the import
is deliberately STATIC so a shard that vendored one without the other fails
loudly instead of silently lowercasing every acronym). The mining is narrow
because the naive version is wrong: roughly HALF the catalog's titles are Title
Case (AMJ/JoF/TAR), which would "prove" every ordinary noun is capitalised, so
PROPER-NOUN evidence is taken only from titles classified sentence-case and
from abstract prose, and only at non-sentence-initial positions; ACRONYM
evidence is safe in any house style (Title Case never yields "DNA" from "dna").
PHRASES exist because the parts of a multi-word name are lowercase-dominant
alone ("states", "york", "war"), so word-by-word gives "United states"; a
phrase is kept only when no token follows a sentence boundary and none is a
stop word (killing "United States The"). Anything unknown is LOWERCASED — the
sentence-case default and the safe direction, since capitalising by guess would
invent names. Word-level rules: possessives resolve through their base
("CFPB'S"→"CFPB's", "NEUMANN'S"→"Neumann's"); a trailing footnote digit is not
a code ("CONTROLLERS1"→"controllers1", 4-letter floor so T2/M12/CO2 survive);
ordinals lowercase ("21ST"→"21st"); a lone "A" is the article unless it is an
initial or hyphen-joined ("E. COLI", "S-CURVE"); a Roman numeral keeps its
capitals only right after a numbering word ("VOLUME CXXI" — the regex also
matches "MIX", hence the context gate). A capital returns after `:`/`?`/`!` and
after a sentence-ending `.` — but NOT after a single-letter initial, so
"E. COLI" stays "E. coli" while ", IX. SEDIMENTATION" gets its capital; runs of
quotes/brackets on either side of the punctuation are stepped over
("EDUCATION?’ AN" → "education?’ An"). Because `titleText` now recases, the
POM/JM/JMR **`EXPRESS:` prefix strip runs after it and was made
case-insensitive** in `build-data.mjs` (native + FT50) — a case-sensitive strip
would silently start leaving "Express:" in once an all-caps deposit arrived —
and the native EC/DBLP path was switched from a bare `trimTrailingSeparators`
to the full `titleText`. Registry keys are unaffected by design (`normTitle`
lowercases), so no paper resurfaces as "recently added" and no dedup/match
changes. The committed data was repaired in the same change via
`clean-titles.mjs` (~17,400 titles across native/FT50/shards/WP), whose new
**`--derived`** flag also fixes the derived files that carry their own COPY of
a title — `data-refs/refs-index.json` (the citing/cited panels),
`analytics/disruption.json` and `analytics/data.json` (top-cited/paper
comparison) — which otherwise self-heal only on their own 3-hourly/daily
rebuild cadence. Covered by `entities-selftest.mjs`.
**Known pubsonline name typos are canonicalized at ingest** ("Olivier
Tobuia"/"Olivier Touba" → Olivier Toubia, "K. Sudir" → K. Sudhir, the
inverted "Manchanda Puneet" → Puneet Manchanda — the journal's own
History-line errors, which would split one editor across several filter
entries): `EDITOR_NAME_FIXUPS`/`canonEditorNames` in `informs-editors.mjs`,
routed through **`healEditorNames` = sanitize + canonicalize** —
`sanitizeEditorNames` drops comma-blob "names" (an acknowledgment
editorial's captured board list, e.g. "Fred Feinberg, Ganesh Iyer, K") and
sub-4-char fragments; `plausibleName` also rejects commas at parse time.
Applied by informs-editors-local.mjs (cache load, new records, applyToPapers
— heals already-applied rows too) and build-data.mjs (mapWork +
applyInformsEditors) — deliberately NOT inside the parser's vendored console
copy beyond the plausibleName guard (kept byte-identical; raw output is
healed on apply/build). Add new typos to that map as found; "Heng Xu" vs
"Hong Xu" are DISTINCT real editors — never fuzzy-merge near-names without
confirming identity. **Editor names are never taken from NON-RESEARCH
items** (editorials/errata/front matter, `isNonArticle` from
`_nonarticle.mjs`): the crawlers skip them and both appliers CLEAR any
previously mis-applied SE/AE on them (an acknowledgment editorial's own text
mentions the board and would be mis-read as a History line).
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
**AIA rows lead their journal's list:** the page's year sorts rank any row with
a non-published `Status` ('Other' and 'Working paper' excepted — `statusRank` in
`index.html`, also in `dbYearCmp` and emit-db.mjs's insertion order) ahead of
the same year's issue papers, mirroring the data files' pubRank order, which
the old (Year, Volume) comparator inverted by sorting the empty Volume last;
within that block every pipeline (native, FT50, the three shards) tie-breaks
equal-rank rows by registry first-seen date, newest first (`addedCmp` beside
each `regKey`), so the latest advance articles surface on page one — keep the
comparators in sync across all of them.
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
"Konstantinos I. Stouras". **Duplicate-account merge:** offered on **EVERY**
account from Edit profile → "Merge this account into another of mine…", not
only an ORCID-only registration (per the owner, 2026-08-16: two e-mail
addresses, or two Google accounts, are two Lit accounts just as surely — and
that case previously had no repair at all). The ORCID-only shape is still the
one the AUTO path acts on, and it keeps its own wording
(`pfMergeLede` in `acctOpenProfile`); `acctStartMerge(true)` still refuses
anything else. `acctStartMerge` exports library/lists/alerts/profile,
unpublishes its public lists, **deletes the duplicate's alert subscriptions**
(deleting a Firebase sign-in does NOT delete its Firestore data, and
`alerts-mailer.mjs` reads `collectionGroup('alerts')` — so an alert left behind
under a uid nobody can sign in to keeps e-mailing for ever, and after the import
the subscriber has it twice; `deleteOwnAlerts`, with `restoreOwnAlerts` on the
failure branch beside the existing `syncPublicLists()` restore, since the alerts
must go while we can still write as that user), deletes the duplicate sign-in
(re-proving it via `reauthCurrentAccount`, which uses whichever provider the
account HAS — it assumed ORCID, which a Google or password duplicate cannot do),
then `maybeApplyMergeStash` imports into whichever account signs in next — papers union starred/tags/lists/notes,
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
repo** — LIVE at `konstantinosStouras/lit-feedback-log` — by
`lit/_scraper/feedback-github-log.mjs`
(`.github/workflows/lit-feedback-github-log.yml`): it reads the `feedback` docs
and writes one folder per submission (`feedback/<id>/feedback.md` + `feedback.json`
+ decoded `screenshot-*.jpg`) into a checked-out private log repo, then commits +
pushes — idempotent (the log repo is the record; no Firestore write) and
**syncing**: an already-mirrored folder's `feedback.md`/`feedback.json` is
REFRESHED whenever the doc changed (`syncSubmission` — a ticket closed, a
resolution recorded, a reopen; the decoded screenshots are immutable and never
rewritten), and it maintains a **ticket index** — `feedback/INDEX.md` +
`index.json` (`indexEntry`/`buildIndex`, newest first, deterministic so an
unchanged collection commits nothing): ticket linked to its folder + date/
submitter/status/message/resolution excerpts — because the maintainer refers to
feedback by ticket while the folders are named after Firestore doc ids. A separate
PRIVATE repo because this site's repo is public and feedback holds e-mails/
screenshots. Configured via the `FEEDBACK_LOG_REPO` variable + `FEEDBACK_LOG_TOKEN`
secret; setup `lit/_FEEDBACK-GITHUB-LOG-SETUP.md`. This is what lets the
feedback be read from GitHub (text + images) independent of e-mail.
**Resolutions close the loop from the repo (`lit/_feedback-resolutions/`):** one
file per resolved ticket, `<TICKET>.md` — front matter `ticket:` (or `doc:` for a
legacy pre-ticket submission) + optional `url:` (host-validated: https on
stouras.com only), body = what was done, e-mailed to the submitter VERBATIM.
This directory lives in the PUBLIC site repo, so a resolution file must never
contain the submitter's name/e-mail (the mailer looks those up in Firestore by
ticket). The feedback mailer's second phase (`applyResolutions`, every 10-min
run; `parseResolutionFile`/`resolutionHashOf`/`renderResolutionEmail`, offline-
tested in `--selftest`, listed by `--scan`) finds the doc by ticket, CLOSES it
(`status:'closed'`+`resolution`+`resolutionUrl`+`resolutionHash`,
`resolvedBy:'repo'`) **before e-mailing** (write-before-stamp, like the
submissions ingest — a send failure retries only the e-mail), then sends the
submitter the "your feedback is resolved" e-mail (fix description + "see it
live" link + their original message) and stamps `resolutionSent`; an anonymous
submission is just closed. Idempotent via `resolutionHash`: files STAY in place
as the public record of fixes, an unchanged file is skipped forever, and EDITING
one re-applies + re-notifies. The log-repo mirror then shows the closure (a
**Resolution** section in the ticket's `feedback.md`; index row `closed ✉`).
**So the standard assistant flow for "act on feedback LIT-X" is:** read the
ticket from the private log repo (`feedback/INDEX.md` → its folder; ask to
`add repo konstantinosStouras/lit-feedback-log` if not in the session), ship the
fix, and add `lit/_feedback-resolutions/<TICKET>.md` in the SAME change — the
submitter's closure e-mail then goes out automatically on merge. (The dashboard's
manual mark-complete + mailto path still works and is untouched.) The main
page also keeps a couple of **library niceties**: in **My Library** the
paper-search filter bar is hidden (`body.lit-lib-mode`; the library has its own
search), and clicking the ACTIVE list/tag chip deactivates it (back to "All
saved") without removing it (`acctSetLibFilter` toggle). **Data Analytics
(`lit/analytics/`)** is an interactive summary-statistics dashboard over the
**whole corpus the main browser lists** — the ten native sources (`data/`),
the FT50 catalog (`data-ft50/`) AND the five satellite data shards (ABS + the Nature/Science topic slices)
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
**Citation flows — two journal-to-journal Sankey charts** (just above "Editorial
area trends"): chart 1 shows where each in-scope journal's citations GO (the
journals its papers cite), chart 2 where they COME FROM (the journals citing its
papers) — left boxes are the journals in scope sized by total in-catalog
citations made/received (default **ms/msom/pom** when nothing is selected —
`FLOW_DEFAULT_KEYS`, per the owner — never the whole 55-journal graph; an
explicit selection caps at the top `FLOW_MAX_LEFT` 8 by volume), ribbons to each
journal's top `FLOW_TOP_PARTNERS` 10 partners with the rest folded into an
"Other" node, native `<title>` tooltips with counts + shares, self-citations
kept. Data is `analytics/citeflow.json`, pre-aggregated offline by
`lit/_scraper/build-citeflow.mjs` from `lit/data-refs/` (refs shards ×
`refs-index.json`; refreshed in `lit-analytics.yml` beside the other two
builds, lazy-loaded like disruption.json via `ensureCiteflow`, page hides the
cards until it exists). The SAME edge set is aggregated TWICE — `out` windowed
by the CITING paper's year, `in` by the CITED paper's year — so both charts
read as "papers of that journal published in the selected years"; junk-year
guard mirrors the builds' `MIN_YEAR` 1850 (keep in sync). Journal-level only:
the non-research toggle and editorial filters can't apply to edges (the
subtitles say so). Offline test: `node lit/_scraper/citeflow-selftest.mjs`.
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
disruption profile in the Author-spotlight tab. The two paper tables cite each
row in full — title, **authors** (`disrPaperAuthors` maps the row's `au` ids
through `DISR.authors`; truncated to 110 chars with the full list in a `title=`
tooltip, like the most-cited table's byline) then journal · year · in-catalog
citers — and their team column is headed **"Team size"** and rendered as
"**N** authors" (`disrTeamCell`), never a bare number, with the same
"credited authors on the paper" wording in each card's sub-heading and the
`th` tooltip; keep that wording aligned with the figures' "Team size (authors)"
x-axis label. It is a **faithful but partial**
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
`{j,y,t,d,c,nf,x?,ra?,rp?,au[],ti,doi}` + a case-insensitive author-name
index; `nf` = in-catalog forward-citation count (in BOTH scoring modes), used
to gate the highlight tables against degenerate ±1 one-citation artefacts;
`x` = non-research item per `_nonarticle.mjs`, so the page's exclude-toggle
covers the team-science figures too) — the whole per-paper table ships so the browser
computes every figure client-side under the live filters. The highlight tables
merge the thin large-team tail into an "8+" bin. Reference age uses reference
years; reference popularity uses references' `CitedBy` (a rough proxy while
citation coverage fills in). Keep the `ABS_RATING`/`UTD24_KEYS`/`FT50_KEYS`
mirror and the native-wins journal merge in sync with build-analytics.mjs.
Refreshed daily by `.github/workflows/lit-analytics.yml` (08:10 UTC, after the
native and FT50 data builds; checks out the five shard repos read-only under
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
`_firestore.rules` is public-read + owner-only, `t`-only writes, OWNER-ONLY
delete; the tile hides itself if that rule isn't deployed. **The count is of
UNIQUE accounts, and two things keep it that way** (owner request 2026-08-21 —
"if two registered user accounts have been merged, we should count them as
one"): (1) the duplicate-account MERGE retires its own marker —
`deleteOwnRegistryMark` in `acctStartMerge`, run while we can still write as
the merged-away user (the same reasoning as `deleteOwnAlerts`) and re-written
by `markRegistryEntry` on the failure branch, since deleting a Firebase
sign-in does not delete its Firestore data and the orphaned marker would count
one person as two for ever (this is why the rule allows owner delete — nobody
can delete anyone ELSE's marker, so the tally can't be deflated); and (2) a
daily **audit** removes the markers already orphaned by earlier merges or by
console-deleted accounts — `lit/_scraper/registered-users-audit.mjs`
(`.github/workflows/lit-registered-users-audit.yml`, 07:10 UTC, before the
analytics build; Admin SDK, since only it can ask Auth whether a uid still
exists), which deletes a marker ONLY on a definite `auth/user-not-found` — any
other error leaves it in place, so a failed look-up can never shrink the
tally. Modes `--dry-run`/`--scan`; offline test
`node lit/_scraper/registered-users-audit.mjs --selftest`; a no-op until
`FIREBASE_SERVICE_ACCOUNT` is set (the same secret the mailers use). The count
otherwise reflects accounts that have signed in since the tally launched
(converges to the true total as users return; the exact all-time total is in
Firebase console → Authentication).
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
(`data/recent.json` + `data-ft50/recent.json` + `data-workingpapers/recent.json`
— the WP file was NOT read before 2026-08, which is why an "any new paper"
subscriber never received a single working paper), reads all alerts via
`collectionGroup('alerts')` with the Admin SDK, matches each with **vendored
copies of the page's journal-list sets + `textMatch`/`authorMatch`** (keep in
sync), and e-mails due alerts over SMTP (`To` recipient, `Reply-To` the
subscriber, `From` = `ALERTS_FROM`/`SMTP_USER`), stamping a per-alert
`lastCheckedAt`/`lastSentAt` high-water mark so nothing is sent twice.
**Working papers match with the page's own reachability rules** (`isWorkingPaper`
by wp-* repository key + the `!scope && !hasTextFilter` gate in
`matchesCriteria`; `jtypeKeys('wp')` = the WP manifest's keys): "any new paper"
includes them, an explicit Working Papers scope (jtype `wp` / a `wp-*` key) or a
text search reaches them, but a bare year or pre-print filter alone never does —
mirroring `matchesJournal`/`textSearchActive`. `renderEmail` counts the two
populations separately ("3 new papers and 2 working papers"), lists published
papers first (so a WP burst can't crowd them out of the 100-row cap), and the
selftest covers all of it.
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
**About page renders a data-driven "What's new" list** (`#litWhatsNew` in
`lit/about/index.html`) from the same `changelog.json` (fetched as
`../changelog.json`); the main page loads it into `LIT_CHANGELOG` for the alert
preview. So the changelog is the ONE place to log a feature — it feeds the About
page's list, the alert preview and the automated e-mails at once. So: **when you
ship a user-facing `/lit` feature, add a `changelog.json` entry (dated ~today) in
the same change** — that is now part of the keep-in-sync discipline alongside
updating the About page copy and the `fun/index.html` landing cards.

**Nothing on "What's new" publishes itself (owner, 2026-08-18).**
`changelog.json` says WHAT was announced; Firestore `newsOverrides/{changelog
id}` says what the maintainer has DONE about it, and **an entry with no document
is withheld**:

    status: 'approved'   published — every visitor sees it
    status: 'pending'    not reviewed yet — only the maintainer sees it
    status: 'removed'    taken down — it leaves the list entirely
    title / summary      an optional rewording, applied wherever it is shown

Three rules, and they only work together. (1) **A removed entry LEAVES the
list**, for the maintainer too — the list is meant to get cleaner, not to fill
up with struck-through entries. (2) **And removing is not a one-way door**:
filtering it out for everybody would leave nothing on the page to press, so the
removed ones sit in a **collapsed panel below the list** that only the
maintainer sees, one click from Restore. (3) **A new entry waits for review** —
`changelog.json` is committed by whoever ships a change, and the entry reached
visitors AND the feature digests the moment it landed; it is now flagged for the
maintainer with Publish (and **Publish all N**, since one change routinely ships
two or three entries and a gate that clears one at a time does not get cleared).
Every entry can also be edited in place — title and summary, in an inline form,
because a browser `prompt()` shows a paragraph as one unscrollable line.

**The gate arriving is not a reason to retract.** The 69 entries already on the
site have no document and would all have gone pending on the first load, so an
entry dated before `REVIEW_FROM` is approved by default — a DATE rather than a
list of ids, so nothing has to be backfilled. Back-dating stays safe for the
reason it already was: the mailer windows by date, so a back-dated entry
precedes every subscriber's window.

**One file, three consumers: `lit/lit-news.js`** — dual-mode (browser
`window.LitNews`, Node `require`), so the About page's list, the main page's
alert preview and `lit/_scraper/alerts-mailer.mjs` cannot disagree about what is
public. This is the shape `assets/oa-news.js` uses on operationsacademia.org for
the same problem; **keep the two in step in SHAPE, not in code** — different
sites, different Firebase projects, different markup. The decisions cost one
Firestore read, so the main page fetches them only when the **alerts panel
opens** (`litNewsEnsure`), which is the only thing there that reads the log.

**The mailer holds the STREAM at the oldest unreviewed entry**
(`sendableChangelog`, pure + unit-tested in its `--selftest`): each alert's
window advances on a high-water mark, so sending an entry dated after one still
waiting would push the mark past it and the older entry, once published, would
reach nobody. The digest stops before it — publish or remove it and everything
behind it goes out on the next run, in the order it was written. Delayed, never
lost — **and that last part needs BOTH halves**: the Lit's feature window is a
TIMESTAMP (`lastFeatureCheckedAt`) advanced on every due run, empty send
included, so holding the entry back was not enough on its own — the mark would
have slid past its date while it waited and publishing it a day later would have
reached nobody. `markCap` parks the mark just before the oldest held entry, and
with nothing held it IS `now`, exactly as before. A decision read that FAILS is
caught, not left to reject: it withholds everything since the gate (the safe
direction) rather than killing the PAPER digests too. The `--test-emails` pass
is held to the same rule — a test e-mail is a real e-mail.

`DOC_KEYS` in `lit-news.js` and the `hasOnly()` list in `lit/_firestore.rules`
are pinned against each other BOTH WAYS by
**`node lit/_scraper/news-selftest.mjs`** (offline), which also pins the length
caps, the maintainer address the module draws controls for against the one
`isFeedbackAdmin()` authorises, and that every consumer really goes through the
module. What each PERSON actually gets — a visitor's list, the maintainer's,
that a removed entry is off the list and still in the panel — is measured in a
real browser by **`node lit/_scraper/news-page-guard.mjs`** (Playwright, no
network, Firebase deliberately unreachable so it also proves the page still
renders its log before the rules are deployed). **Inert until the rules are redeployed**: `cd lit && firebase deploy
--only firestore:rules --project lit-paper-browser`.

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
`data-workingpapers/recent.json` of ONLY dated rows, newest-added first, plus
the uncapped `recent-counts.json` tally the view's number is read from
(`buildWpRecentCounts`, shared by both writers — the capped rows can never
carry a backfill day of ~12–16k stamps; keep the two emissions in sync); the
page fetches them via `loadDatasetRecent`/`loadRecentCounts` in
`loadWorkingPapersManifest()` and `matchesJournal` admits WP rows in
`recentMode` — back-catalog rows crawled before dating began carry no date and
never appear. **The recent view is ordered DAY BY DAY (newest day first), and
WITHIN a day published papers lead, working papers follow** (per the owner,
2026-08-10 — `renderRecent`'s comparator: `day` desc, then `(a.w - b.w)`, then
time desc, where `w` comes from `isWorkingPaperRow` — `_jkeys` if computeJkeys
has run, else the raw `JKey`). The view reads as a feed: today's journal
articles, then today's WP arrivals, then yesterday's — NOT the two global
blocks it briefly used (every published paper of the whole window before any
working paper, which pushed a day-old working paper below four weeks of
published rows), and NOT a pure date sort either, which let the WP backfill
bury the published catalogue (it adds ~1,000 rows in one day: on 2026-07-28
all 1,000 preceded the 144 published papers added the day before — ABS shards
first appeared on page 41, the NATIVE journals on 43). The within-day
published-first rule is the same instinct `matchesJournal` applies to bare
browsing ("flood the view with unpublished rows"). `buildJTypeSelect()` **hides the Working Papers type until its
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
**Papers files are CHUNKED under GitHub's hard 100 MiB push limit** (the Aug
2026 outage: `papers-wp-arxiv.json` crossed it on 2026-08-01 and EVERY
progress-carrying push was rejected from then on — the archive froze for nine
days while `meta.json`'s `lastPull` kept advancing, because only no-progress
runs could still push; the crawl slice itself was fine). Both writers (the
crawler and `ingest-submissions.mjs`) write each repository through the shared
`lit/_scraper/_chunked-json.mjs` helpers (`loadWpRows`/`writeWpRows` in
build-data.mjs, cap `WP_FILE_CAP_BYTES` default 48 MiB): part 1 keeps the
plain name, later parts insert `-N` (`papers-wp-arxiv.json`,
`papers-wp-arxiv-2.json`, …), a shrinking rewrite deletes stale parts, and the
manifest entry lists the parts in `files` (with `file` still the first part).
The page's `loadExtraSource` fetches every listed part and concatenates —
single-file sources (FT50/shards) are just the one-part case.
`counters-selftest`/`dedupe-data` are chunk-aware (`s.files` union; dedupe's
WP branch folds part files into their base key and rewrites through the same
chunked writer); `clean-titles`/`build-titlecase-lexicon` glob `papers-*.json`
per-file, which is already correct for row-local edits. Tests:
`node lit/_scraper/chunked-json-selftest.mjs` + chunk checks in the WP
selftest.
Offline test: `node lit/_scraper-workingpapers/selftest.mjs` (mock, no
network). Migration to a satellite repo is one constant: `WP_DATA_BASE`
`'./data-workingpapers/'` → `'/lit-data-workingpapers/data/'`. See
`lit/_scraper-workingpapers/_HOW-IT-WORKS.md`. NOTE: this build environment's
egress policy blocks the scholarly APIs (OpenAlex/Crossref/arXiv return 403), so
the archive can only be populated by the GitHub Actions runners — it is EMPTY
until the first workflow run on `master` post-merge.

**Suggest a missing published paper or a working paper (user submissions →
auto-ingest).** A **signed-in** user can suggest a paper from the **first
section of the Feedback page** (`lit/feedback/`, the "Suggest a missing
published Paper or a Working Paper" `.fb-card`, a Working-paper/Published-paper
kind toggle): for a WORKING paper they paste an SSRN/arXiv/NBER/OSF link (or
DOI) + optional title/authors/note; for a PUBLISHED paper missing from the
catalog they paste its DOI (or any link containing it) and/or its **full
citation** (a `citation` textarea — the citation alone suffices). The page
writes a bounded doc to the Firestore **`paperSubmissions`** collection
(`{uid,email,name,url,title,authors,note,kind?,citation?,ticket,
status:'pending',createdAt}`; `kind` sent only as `'published'`, absent = the
legacy working-paper shape; rule in `lit/_firestore.rules` — signed-in bounded
create with `status` pinned to `'pending'`, `kind` in `['wp','published']`,
`citation` ≤ 4000, submitter reads own, `isFeedbackAdmin()`
reads/updates/deletes; until the updated rules are deployed the page falls back
ONCE on permission-denied to the legacy shape, folding the citation into the
note as `"Citation: …"`, which the ingest also reads — no submission is lost).
A scheduled ingest `lit/_scraper-workingpapers/ingest-submissions.mjs`
(`.github/workflows/lit-paper-submissions.yml`, every ~10 min off-boundary,
**shares the `lit-workingpapers-${{ github.ref }}` concurrency group** so it never
races the crawler/backfill; master-only commit with the same push-retry replay)
processes each `pending` doc, **ROUTING by what the link/DOI actually IS**
(`routeSubmission` — the form's kind choice is a hint only, never trusted): a
recognised SSRN/arXiv/NBER/OSF link or DOI — found anywhere in the
link/citation/title/note (`urlToDoi`/`extractAnyDoi` → SSRN `10.2139`/arXiv
`10.48550`/NBER `10.3386`/OSF `10.31219`; a spoofed host or junk is rejected,
bioRxiv/medRxiv rejected `unsupported`) — takes the WORKING-PAPER path; any
OTHER DOI takes the PUBLISHED-PAPER path; a published suggestion with no DOI at
all is resolved by a conservative **Crossref bibliographic search** over the
citation (`matchBibItem` — the hit's title AND one author surname must visibly
appear in the citation text, so a wrong top hit is never adopted).
**Working-paper path:** it **resolves the REAL metadata itself** (OpenAlex by
DOI → Crossref fallback → an OpenAlex-shaped work), and builds the record with
the SAME `wpRecordFromWork()` the crawler uses — so the submitter's typed
title/authors are **only hints, never trusted into the dataset**. It then
applies the owner's two gates via the pure `decideSubmission()`: **not already
in the catalog** (`wpRecordFromWork`'s `publishedTitles` exclusion + a `recKey`
dedup against the archive → `duplicate`) and **≥1 author already in the
catalog** (`catalogMatch` against `loadCatalog`'s author index — `exact`
full-name or, by default, `fuzzy` last-name+initial via the crawler's own
`nameParts`; env `SUB_AUTHOR_MATCH`). On `added` it **upserts** into
`lit/data-workingpapers/` (seeding `byKey` from the committed files, so every
crawler row is preserved — same invariant as the crawler) and rewrites the
derived files (`papers-wp-*.json`/`sources.json`/`recent.json`/`meta.json`,
preserving the crawler's `authorCount`; **never touches `_authors.json`**), so
the paper appears under the page's **Working Papers** journal type with no page
change. **Published-paper path:** resolved Crossref-FIRST (it carries the
journal/volume/issue; OpenAlex fallback; `publishedFromCrossref`/
`publishedFromOpenAlex`) and decided by the pure `decidePublishedSubmission()`
against `loadCatalog(…,{index:true})`'s new `dois` set + `byTitle` index:
already listed (by DOI, or by the `matchPublished` probe that catches the same
paper under another registration) → `duplicate`; genuinely missing →
**`review`** — a published paper is NEVER auto-added (the daily harvests own
the published catalog); the maintainer gets the resolved title/journal/year +
the submitter's citation to add by hand. It **writes the dataset BEFORE
stamping Firestore** (a crash just re-processes idempotently — the paper is
then a `duplicate`, never lost), stamps each doc
`added`/`duplicate`/`linked`/`review`/`rejected`+reason (+ `mode:'published'`,
`resolvedJournal` for the admin inbox; a transient OpenAlex/Crossref outage
leaves it `pending`; a not-yet-indexed posting stays `pending` and is retried
until it is older than `SUB_MAX_AGE_DAYS` (default 7, time-based so a fresh
SSRN posting's day-plus indexing lag doesn't trip it) then rejects
`not-indexed`), and — when SMTP is set (reuses the feedback mailer's secrets;
**`FIREBASE_SERVICE_ACCOUNT` is the only one required**) — e-mails the
submitter their outcome + the maintainer a summary. To this `build-data.mjs`
exports `WP_SOURCES`/`recKey`/`normName`/`nameParts`/`stripAccents` (additive;
the ingest imports them so the record shape + author normalization can't
drift). The Feedback page also gains a **📄 Paper suggestions** maintainer
inbox (mirrors the feedback inbox; read-only + Delete; `review` items show
under the Pending tab with their own badge as the maintainer's to-do) showing
what the ingest did. It is a **no-op until `FIREBASE_SERVICE_ACCOUNT` is set**
and the rule is deployed. Offline test:
`node lit/_scraper-workingpapers/ingest-selftest.mjs` (mock, no network); modes
`--scan`/`--dry-run`. Setup: `lit/_PAPER-SUBMISSIONS-SETUP.md`. NOTE: this build
env's egress blocks OpenAlex/Crossref (403), so real resolution only happens on
the Actions runners. (Per keep-in-sync: shipped with a `changelog.json` entry +
the About-page "Suggest a missing published paper or a working paper" bullet.)

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
paper card as TWO toggles next to BibTeX: a **"Citing … references in this
catalog"** toggle (steel-blue; `togRefs` in `index.html`) that lazy-loads and
lists those papers, each linking to the paper it cites, and its **inverse — a
"Cited by … references in this catalog"** toggle (green, `.paper-cited-toggle`;
`togCited`) listing the catalog papers that CITE this one (the SAME edge set
keyed by the cited paper — derived in `buildOutputs`, no extra crawling, so the
two directions can never disagree; both panels render via the shared
`refListHTML`). Each toggle weaves a **count** into its phrase — "Citing 12
references in this catalog" / "Cited by 7 references in this catalog" (never
parenthesised) — sourced from tiny companions (`refs-counts.json`
`{citingDoi:N}`, `cited-counts.json` `{citedDoi:N}`) loaded once in the
background (`loadRefsCounts`/`loadCitedCounts`/`refsToggleLabel`/
`citedToggleLabel`/`annotateRefsCounts`/`annotateCitedCounts`) so the numbers
appear WITHOUT downloading the multi-MB per-journal shards; a shard still loads
lazily only when its panel is opened. It is its **own dataset**,
`lit/data-refs/` (kept separate to stay out of the main size budget and to
move to a dedicated `lit-data-refs` Pages repo when it nears the 1 GB limit —
migration is ONE constant, `REFS_DATA_BASE` `'./data-refs/'` →
`'/lit-data-refs/data/'`, same pattern as `WP_DATA_BASE`). **Data sources (three,
unioned for accuracy):** (1) **Crossref** backbone — BATCHED
`works?filter=doi:<a>,doi:<b>,…&select=DOI,reference` calls (`REFS_CR_BATCH`,
default 25 DOIs/call — same-name filters OR together, like the citations
sweep; a DOI absent from its batch's response is concluded empty, the old
per-paper-404 semantics) read the DOIs the publisher deposited — the leg that
stamps a paper "done". Batching is what made the backfill fast (~25× the old
per-paper call), so the FT50 25-year backlog clears in days; (2) **OpenAlex** —
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
growth (and a fuller id map) adds edges with NO re-fetch. **Both crawl caches
are CHUNKED under GitHub's hard 100 MiB push limit** (`_refs-cache.json` +
`_refs-cache-2.json` + …, likewise `_citedby-cache.json` — the Aug 2026
outage: the refs cache hit 114 MB on the runners and every backfill push was
rejected, exactly like the working-papers archive; see
`lit/_scraper/_chunked-json.mjs`, whose helpers build-refs/build-citedby write
through and build-disruption/coverage-audit read through, each part ≤ ~48 MiB,
stale parts deleted on a shrinking rewrite). A published paper's
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
have edges, per direction: `shards` + `citedShards`), `refs-<jkey>.json`
(`{citingDoi:[citedDoi,…]}`, sharded by citing journal, only papers with ≥1
in-catalog edge), `cited-<jkey>.json` (`{citedDoi:[citingDoi,…]}` — the SAME
edges inverted, sharded by the CITED paper's journal; a journal can have a
cited shard without a citing one, e.g. ACM EC papers get cited but deposit no
references), `refs-index.json` (`{doi:[title,jkey,year,authors?]}` for EVERY
edge endpoint — cited AND citing — so either panel renders a paper's title,
journal, year AND authors without loading its journal file), and the count
companions `refs-counts.json`/`cited-counts.json` that feed the toggle
labels. **Paper priority (per the owner):** MS /
M&SOM / POM / PNAS (all years) first, then UTD24 ∪ FT50 (newest years first),
then the rest (`tierOf`; the UTD24/FT50 key sets MIRROR index.html's — keep in
sync, like build-analytics.mjs). The page merges it at runtime like the FT50
catalog: `loadRefsManifest()` at load; a card shows each toggle only when its
journal has that direction's shard (`refsShardFor`/`citedShardFor`);
`loadRefsIndex()`/`loadRefsShard(jkey)`/`loadCitedShard(jkey)`
are lazy + idempotent. **The "Citing papers of" FOCAL FILTER (citation
search):** a filter-bar group (primary row, beside Journals) resolves a focal
PAPER (DOI/doi.org URL, or a title matched exactly-normalized / uniquely by
substring against `refs-index.json` — ambiguity asks for the DOI, never
guesses) or a focal AUTHOR (`authorMatch` over the index's authors strings,
gated to papers `cited-counts.json` says have citers) into the set of catalog
papers that CITE it/them (`litCbResolvePaper`/`litCbResolveAuthor` →
`citedByFilter` `{kind,label,doi?,dois:Set,jkeys:Set,focal}`), entirely from
the graph files — no papers file downloads during resolution. The set then
ANDs into `applyFilters` AND `crossFilter` like the pre-print toggle (per-row
bare-DOI cache `p._bdoi`), so journals/types/years/text searches all chain on
top; `neededNativeKeys`/`neededExtraKeys` treat it as a broad trigger but
INTERSECT with `citedByFilter.jkeys`, so a focal cited from 3 journals streams
3 papers files, never the whole catalog. One focal at a time (chip
`chip-citedby`, green); wired into the welcome-state check, `litSelectionIsEmpty`,
`litFilterSig`, `resetFilterState`, `registerExtraSources`' re-render trigger,
and `dbAnswerable` (bails to the JSON path). Deep-linkable + shareable —
`?citedby=<doi>` / `?citedbyauthor=<name>` (`litSyncCitedByUrl` keeps the URL
in step, `applyCitedByDeepLink` applies it on load and stands the site default
down via `LIT_CITEDBY_DEEPLINK`); each card's cited-by panel carries a
"Show as filtered list" shortcut (`litCitedByFromCard`). The dataset **ships
EMPTY** (manifest with no shards), so
the toggles stay hidden until the backfill populates it. Offline test:
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
+ resumable + checkpointed. **It no longer waits on build-refs for the ids that
matter most:** the canon references (Lazear–Rosen 1981, Moldovanu–Sela 2001, …)
sit deep in build-refs's newest-first queue yet appear in hundreds of focal
papers' reference lists — and an unharvested reference contributes NOTHING to
forwardDisruption's n_j/n_k pools, deflating every one of those focals' D. So
each run first **seeds `_oaid.json` itself** for the most-in-catalog-cited
papers still missing an id (`orderOaidSeeds`/`seedOaids`, ranked by
`cited-counts.json` — a paper's in-catalog citer count = the number of focal D
computations its citer list unlocks; batched `works?filter=doi:` id lookups,
`CB_SEED_MAX` 1500/run, eligibility ≥ `CB_HOT_MIN` 5 citers; a DOI OpenAlex
lacks is recorded as an EMPTY-STRING `_oaid.json` entry — falsy, so every
truthy consumer treats it like absent and build-refs overwrites it if the work
appears — and never re-queried), then the citer crawl puts those same
high-value papers FIRST (`orderCitedby`'s hot bump, most-cited first, ahead of
the tier queue), so a just-seeded canon paper gets its citer list in the same
run. Hot papers also crawl under a MUCH higher per-paper citer cap
(`CB_HOT_MAX_CITERS` 50k vs `CB_MAX_CITERS` 3k, never below the base cap) —
the papers that hit the base cap ARE the canon classics, and a capped list
feeds n_j/n_k truncated; a paper already stamped capped under a smaller cap
than applies to it now is re-queued immediately (the recap rule — a truncated
list is not a fresh fetch), not after the TTL. It writes an **unserved** crawl cache
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

**Both phases are timed PER STAGE (idea generation vs selection/voting).** Each
working phase is played in two stages and the admin panel's "Phase Timers"
section allocates a separate countdown to each: the individual phase runs
**idea generation** ("Proceed to Selection") then **idea selection**
(double-click the ones that carry forward, then Finish & Submit), and the group
phase runs **ideation** ("Proceed to Voting") then **voting**
(`phaseConfig.individualGenerationDuration`/`individualSelectionDuration` and
`groupIdeationDuration`/`groupVotingDuration`, resolved in
`_ideasearchlab-src/src/utils/phaseTimers.js`). A stage's timer running out
moves the participant to the NEXT stage; only the second stage's expiry submits
(auto-picking a selection / locking whatever votes exist). Each stage's clock is
per-participant and anchored where they entered it (`individualStartedAt` /
`individualSelectionStartedAt`, `groupStartedAt` / `groupVotingStartedAt`), and
those stamps split the export's Timing sheet into writing-vs-selecting and
ideation-vs-voting. Sessions created before the split carry only the old
`individualPhaseDuration`/`groupPhaseDuration` and keep running UNSPLIT — one
clock across both stages, expiring straight into the auto-submit exactly as
before (`migratePhaseTimers` fills the per-stage fields from them wherever a
stored `phaseConfig` is read, so a legacy session never loses its countdown).

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
**A test round arrives with the registration form already filled in with RANDOM
data and the consents ticked** (owner request 2026-08 — rehearsing shouldn't mean
retyping demographics): `randomRegistrationAnswers` in
`_ideasearchlab-src/src/utils/testData.js` answers each field by what it asks for
(a random option for a select/country, a value inside `min`/`max` for a number,
digits for a Student-ID, a test address for an e-mail, a name for a name field),
applied by Registration.jsx ONLY when `isPreview()` and never over a value the
tester already typed. A real Simulation-Platform handoff is **ignored** in preview
(`platformHandoff()` returns null; `SIMP_EXPECT` is switched off for
`?preview=1`), so a launch still sitting in this browser can't silently
auto-submit the sandbox's form. **`/lab/answerarena` has the same two things** —
a 🧪 Test round button on every session card (and on its Create-a-session card)
plus a randomly pre-filled intake — implemented for its vanilla-JS store as
`ARENA_PREVIEW` + a namespaced `LocalBackend` (`lab/answerarena/CLAUDE.md` §6b;
offline test `node lab/answerarena/tools/preview-guard.mjs`); the two random
fillers are deliberate twins — keep them in sync.

**Excel export per session, from the session list.** Both admins let the
instructor download ONE session's research workbook straight from its card —
ideasearchlab's `/admin` Active + Completed cards gained a green **⬇ Export data**
button (calling the same `exportSessionWorkbook` builder the control room uses, so
the file is identical), matching what Answer Arena's session cards already had.

**Both admins' session cards carry a Copy link button** (owner 2026-08).
ideasearchlab gained the one Answer Arena already had: on every ACTIVE card,
beside Open, it copies that session's participant join link and flips to a green
"✓ Copied". Completed cards have none — a closed session is filtered out of the
join lookup, so its link would dead-end. The URL shape and the parser that reads
it back live together in `_ideasearchlab-src/src/utils/joinLink.js`; it points at
the app ROOT with the code on the query string
(`stouras.com/lab/ideasearchlab/?code=BALI`), never at the `/join` client route,
so it can't depend on the SPA 404 fallback — and it PRE-FILLS the join field
rather than auto-joining (the Simulation-Platform handoff stays the only silent
path, its code deliberately never shown). Offline test:
`node _ideasearchlab-src/tools/join-link-guard.mjs`.

**Every ideasearchlab session card states its CONDITION ENCODING** (owner
2026-08). The card's right-hand meta block used to say only "0 participants" +
"Individual + Group"; it now carries a third line — the None / Solo / Group /
Both chip plus "AI in <neither stage | solo stage only | group stage only |
both stages>", on ACTIVE and COMPLETED cards alike (one shared `SessionCard`
renders both lists, so they cannot drift). It is computed by **`conditionOf()`
imported from `src/utils/sessionExport.js`** — the SAME function that stamps
every Excel/CSV export and feeds the Data Analytics regressions, so a card and
its data can never encode a session differently (that also means the card
inherits the export's phase gating: an AI flag on a phase the session does not
run does not count). Chip colours mirror `.cond0…3` in
`DataAnalytics.module.css` (None grey · Solo accent · Group blue · Both green)
— keep the two palettes in sync. In the same change the **phase line became
order-aware**: "Individual → Group" / "Group → Individual", built from
`getPhaseSequence(phaseConfig)` itself, because "Individual + Group" read
identically for a `group_first` session and left the admin guessing which order
they had chosen.

**Both working phases end on a 15-second summary of what the participant just
produced** (owner 2026-08). The individual phase already held its "Your ideas are
submitted" card for `CONFIRM_HOLD_MS`; the group phase now does the same once
EVERY member has voted, showing the group's **final selected ideas** (most-voted
first, with vote counts) before the phase change goes through. Same mechanism —
park the navigation, stamp the completion, count down — because the backend
advances everyone the instant the last member submits, which in a solo group is
that same instant. Neither summary shows a phase timer any more: they come after
their stage's work is done, and the only countdown that still governs anything is
the hold printed on the card (the individual one used to leave the selection
stage's clock ticking there, and its expiry re-fired `autoFinish`). Offline test:
`node _ideasearchlab-src/tools/phase-hold-guard.mjs` (Playwright over the Test-round
sandbox — nothing is saved). That guard also pins the **header controls** (theme
toggle + account menu) to the same right edge on all 11 screens of the flow: they
are present throughout, so they must not shift between steps, and two things
moved them — the phase headers pushed them right only via the timer's
`margin-left: auto` (so the timer-less confirmation screens stranded them beside
the wordmark), and the workspace top bars padded 28px against the page headers'
40px. Any new screen must land them 40px from the right.

**A phase page never draws its instructions screen before it knows where the
participant is** (owner report 2026-08: refreshing on the "Your ideas are
submitted" summary flashed the "Individual Ideation Phase" instructions, Start
button and all). `started` and `done` are both restored FROM the participant
document, so until its first `onSnapshot` lands they are both false — exactly the
state that renders the instructions. Both phase pages now gate on a
`participantLoaded` flag (set inside the snapshot handler BEFORE the
`snap.exists()` bail, so a participant with no doc still stops loading), returning
a "Restoring your session…" state ahead of the `!started` branch. That ORDERING is
the whole fix, pinned by `node _ideasearchlab-src/tools/phase-restore-guard.mjs`
— a source check, not a browser one: reproducing it at runtime needs a
participant who submitted in a PREVIOUS page load, and the Test-round sandbox's
store lives in memory for the tab's lifetime, so a reload wipes the very document
whose absence is the bug.

**Group voting shows where the group's votes are, and says so when they
disagree** (owner 2026-08). Each idea with votes carries a filled **"N votes of
M"** chip and an accent left edge on the card; the current top three are deepened
and stamped `#1`/`#2`/`#3` (the set that becomes the group's picks), and a live
line above the list reports how many ideas carry votes and how many the group
agrees on. When two or more members have cast a COMPLETE ballot and still no idea
has more than one vote, an advisory is raised **unprompted** (it used to wait for
Submit Votes, i.e. until minds were made up) — modal plus a persistent amber
banner — explaining *consensus* in plain words ("simply agreeing together…") for
the many participants who are not native English speakers. Details, including the
90-second cooldown that keeps it advice rather than nagging, are in
`_ideasearchlab-src/CLAUDE.md`.

**Session cards look and behave the same in both admins** (owner request
2026-08). *Alignment:* ideasearchlab's cards used a mix of global
`btn-primary`/`btn-ghost` (bigger padding) and borderless text buttons, so its
Active/Completed rows sat at ragged heights and "⬇ Export data" wrapped onto two
lines; every card button now uses ONE pill family — `.sBtn` + a variant
(`.sBtnPrimary` Open · `.exportBtn` solid green · `.sBtnSec` 🧪 Test round ·
`.closeBtn` · `.deleteBtn` red-outlined, no longer `margin-left:auto`) in
`Admin.module.css`, mirroring Answer Arena's `.aa-btn … sm` set (same height,
radius, weight, colour roles, `white-space: nowrap`). Keep the two in sync — a
new card button must be added as `.sBtn` + a variant, never a bare
`btn-primary`/`btn-ghost`. **The Arena pill is the reference and `.sBtn` now
carries its geometry VERBATIM — `font-size:12px`, `padding:7px 11px`,
`border-radius:10px`, `font-weight:600`, `line-height:1.4`, nowrap** (measured
identical: every pill in both admins renders 32.8px tall on one baseline). Those
numbers are a contract between `Admin.module.css` and `.aa-btn`/`.aa-btn.sm` in
`lab/answerarena/admin.js` — change them in both or neither. Each panel keeps its
OWN theme (arena dark, ideasearchlab light) and its own action set, so the colour
roles map rather than match: `.sBtnSec` paints `var(--white)` where arena's
`.sec` paints `var(--panel)`, and ideasearchlab keeps a neutral **Close Session**
(non-destructive — moves the session to Completed) beside the red **Delete**,
where arena has only one closing action and paints it `danger`. **Every variant
carries a 1px border, transparent on the filled ones**, in BOTH admins: with
arena's old `.aa-btn{border:none}` a filled pill (Open / Export data) sat 2px
shorter than an outlined neighbour (Copy link / Test round / Close), so even
arena's own row was subtly ragged. *No editing a session that exists:* the **Edit**
button (ideasearchlab) and **Edit name** (Answer Arena) were REMOVED — a session
may already have participants playing in it, so its configuration is fixed at
creation. ideasearchlab's whole edit path went with it (`editingSession` state,
`startEdit`/`saveEdit`/`cancelEdit`, the form's Edit-Session title/badge and its
"Save Changes / Cancel" actions; the per-section **Save** buttons now only
confirm the value is captured for the session about to be created), and Answer
Arena's inline `editMode` rename form; name a session on its Create card.
*Two distinct endings, in the same order and colours in both admins:* a grey
**Close Session** that only stops new joins (the card moves to Closed/Completed
sessions, data kept) and, directly after it, a red **Delete** that removes the
session for good. Answer Arena's active card was the odd one out — a single red
"Close" and no Delete — and now matches (`lab/answerarena/CLAUDE.md` §6): its
Delete also **erases the session's data** (`Store.deleteSessionData` runs before
`deleteSession`, so a failed purge leaves the session listed and retryable),
deleting each player's responses/events/survey/draft for that session and the
participant records that exist only because of it, while anyone who also played
another session keeps that session's data.

### 🧪 Test round — EVERY class simulation that can have one has one

Owner request 2026-08: the instructor must be able to rehearse any simulation
end to end without leaving a trace. Each app's admin therefore has a **🧪 Test
round** button that opens the participant flow in a private sandbox writing
**nothing** — and, where the app asks for demographics, the form arrives
**pre-filled with random test data and the consents ticked**. The shape differs
because the apps differ, but the contract is identical: *no participant record,
no responses/events/rounds, no completion marker, and a constant "Test mode —
nothing is saved" ribbon.* Also uniform: a REAL Simulation-Platform handoff is
IGNORED in a sandbox, and each app's `SIMP_EXPECT` is switched off for
`?preview=1`, so a test round can never stamp the platform card "✓ Completed"
and gate a student's real play.

| Simulation | How the sandbox is isolated | Gate |
| --- | --- | --- |
| **ideasearchlab** | `src/utils/db.js` façade swaps Firestore/Functions for the in-memory `previewDb`; solo run, synthetic user | `?preview=1&key=stouras` |
| **Answer Arena** | `ArenaStore` forced to the LOCAL backend in its own `arena:preview:` localStorage namespace (Firebase SDK never fetched) | `?preview=1&key=stouras` |
| **PortfolioFit** | `init()` returns `startPreview()` before Firebase is imported; `S.offline` already no-ops every write; session snapshot + frozen puzzle specs seeded via localStorage | `?preview=1&key=stouras` |
| **Problem Solving** | its ONE write (the Apps-Script POST) is replaced by a no-op; the real game is played | `?preview=1&key=stouras` |
| **Search-v2** | its pre-existing admin preview (`PREVIEW` in app.js) skips the intro and never calls `startFirebaseSync`; now reachable from every session card + a visible ribbon | `?preview=1&debug=1&key=stouras` |
| **Sustainable Supply Chains** | `store.js` returns an isolated, resettable `ssc-preview-*` demo backend | `?preview=1` |

Random-data fillers are deliberate triplets — `randomRegistrationAnswers`
(`_ideasearchlab-src/src/utils/testData.js`), `previewAnswers`
(`lab/answerarena/arena-app.js`) and `previewRegAnswers`
(`lab/portfoliofit/experiment.js`) — each answering a field by what it asks for
(random option for a select/country, a value inside `min`/`max`, digits for a
Student-ID, a test address for e-mail, a name for a name field). Keep them in
sync. Deliberately NOT pre-filled: the end-of-study **surveys** (a tester may
want to exercise their validation).

**Two sims deliberately have no test round.** `newsvendor` is hosted
CROSS-ORIGIN (newsvendor-kostas.web.app) — this repo cannot instrument it, and
it has no admin here; `jagged` collects nothing at all, so free play already IS
a sandbox. Search-v2 and Problem Solving have no registration form, so there is
nothing to pre-fill there.

Offline tests (Playwright, no network — each asserts the isolation, the ribbon
and, where applicable, the pre-filled form): `node
lab/answerarena/tools/preview-guard.mjs`, `node
lab/portfoliofit/tools/preview-guard.mjs`, `node
lab/problem-solving/tools/preview-guard.mjs`, `node
lab/search-v2/tools/preview-guard.mjs`.

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

## `/lab/search-v2` — "Search With and Without Generative AI"

`lab/search-v2/` is a **multi-file** static behavioural experiment (vanilla
HTML/CSS/JS, relative URLs only, no build step) implementing the design brief
`search_with_ai_design.md` in full; the source cites its section numbers
throughout. Environment adapted from Malladi, Martínez-Marquina & Morozov,
*"Space Exploration"* (EC 2026), High Variability condition. Backed by the
Firebase project `search-with-ai-456d7`, already configured in
`firebase-config.js`; it degrades gracefully when Firestore is unreachable and
runs fully offline with local logging. See `lab/search-v2/README.md` and
`SEEDS.md`.

**The task.** 100 positions hiding integer prizes 0–100, neighbours differing by
at most 10. THREE actions (§7): **Ask the AI** (2 points, returns its estimate,
does NOT reveal the truth — button ABSENT, not disabled, in AI-off rounds),
**Reveal** (5 points, the true prize, joins the AI's anchors), and **Stop**
(0, ends the round; under the default `best_found` stop rule it NEVER opens a
new position — the button names the best prize it takes, and stopping with
nothing found asks for confirmation). **Score = the best TRUE prize the
participant holds (pre-opened + own reveals) minus all query and reveal costs;
under the legacy explicit-`nominate` rule only, the true prize at the selected
position instead.** The AI's
number is never a prize — that one rule is what makes trust fallible, and it is
the strict comprehension gate. No score floor: a round may end negative and that
is logged. Caps 40 queries / 20 reveals (§7/§17b/§20b say 20; the §20c table says
30 — the three-to-one reading wins).

**The AI (§3, §12).** K private anchors — 4 sparse / 10 dense, one per equal
stratum — plus every pre-opened and every revealed position. It answers the truth
at an anchor, the straight-line interpolation between the two nearest anchors
inside, and the nearest anchor's value flat beyond the outermost. Rounded, and
returned after a FIXED latency identical to a reveal's, so neither formatting nor
response time can leak whether the answer was exact. Never draws a curve, never
marks its anchors; the two switches that would (`ai.drawCurve`, `ai.markAnchors`)
stay visible in the panel behind a red confirmation and must never be turned on.
Sparse sits ABOVE the verification threshold `s* = c_R·√(2π)` and dense BELOW it,
so the prediction is a SIGN CHANGE, not a gradient — the panel's badge goes red if
a parameter edit breaks that.
**The defaults MOVED on simulation evidence (owner 2026-08): reveal cost 5 → 4
and sparse K 4 → 3**, so s* = 10.03, sparse mid-gap SD 16.67, dense 9.13. Reason,
measured over 1000 simulated participants in `tools/simulate.mjs` (tables in
`tools/SIMULATION-FINDINGS.md`): at the brief's values the AI-OFF arm is barely a
search arm (unaided myopic search opens 1.88 positions and buys +5.84 over
spending nothing) AND the sparse/dense contrast is a GRADIENT — trusting the AI
gains +4.30 sparse against +7.85 dense, the same sign. Moving BOTH flips it
(−1.56 against +5.83); neither alone does. **c_R must stay inside (3.64, 6.65)**
— below 3.64 s* drops under the dense SD, verification pays everywhere and the
density manipulation has nothing left to manipulate; that window is only this
wide BECAUSE sparse K is 3 (at K = 4 it was (3.64, 5.76)). `selftest.js` asserts
the window, so a future edit that breaks the straddle fails there rather than in
the data. Change the two together or not at all. Every already-created session
keeps its own stored `params`, so this affects new sessions only.
**Tests must never hardcode a study parameter or a board position.** The specs
are regenerated from the seeds whenever K changes, so which positions start
pre-opened moves — smoke.mjs and data-audit.mjs now CHOOSE a revealable position
(a pre-opened one has its reveal button correctly disabled) and read costs from
`window.CONFIG.DEFAULTS`, after waiting out the latency gate that disables every
button.

**Registration first; the exit survey no longer asks background** (owner
2026-08). The background items (year/level, age band, gender) moved out of the
survey's Part F into their OWN registration phase between consent and the
instructions — asked once, before the task, all optional
(`Content.REGISTRATION`, `showRegistration` in app.js, screen
`s-registration`). On a Simulation Platform launch every item the platform's
registration already answered is NOT re-asked: it travels as
`platform_<field>`. The ids are unchanged from the Part F era and the exporter
reads either source into the same `reg_<id>` column, so sessions already
collected keep their background. Pinned by `tools/platform-guard.mjs`.
**FIELD OF STUDY was removed** (owner 2026-08, "irrelevant") — the question and
its six options, everywhere. Every other consumer is DERIVED from the
`REGISTRATION` array (`registrationColumns()` → the `reg_<id>` workbook columns,
`outline()` → the Wording tab's editable fields, `resolve()` → the per-session
copy), so the deletion is one array entry; `fieldOfStudy` left
`PLATFORM_BACKGROUND` with it, because the platform's own registration has no
such answer set either (`simulation/answers.js`) — which is exactly why it was
the ONE item a launch still had to ask. Three consequences, each pinned:
(1) a platform launch now has **nothing left to ask**, so the phase passes
through with **no screen at all** — no longer a contingency but the only
behaviour a launch can have (a standalone participant is still asked the three);
(2) **consent routes PAST a phase with nothing to ask** rather than entering it
and bouncing out, because `goto` stamps the phase either way and the workbook
would ship `phase_ms_registration = 0` for a screen a whole cohort never saw —
against its own rule that an empty cell, never a 0, means not applicable
(`showRegistration`'s pass-through, now reachable only on a resume, deletes the
phantom stamp too but keeps a genuine earlier dwell);
(3) a **retired question keeps exporting the answers it already collected** —
the column list is the CURRENT block, so `admin/export.js` sweeps any answer
held under a retired background id (from `reg` or, for the Part F era,
`survey`) back into its `reg_<id>` column. Without it, re-exporting a session
collected under the old shape would quietly differ from the export taken last
term — at the study level exactly what the panel's own "clone, do not edit" rule
forbids at the session level. `f_` is the background block's id namespace and
selftest pins that nothing else uses it.

**The two paid buttons are the primary outcome, so the interface may not tilt
them** (owner 2026-08, a written spec). "Ask the AI" and "Reveal" are ONE
button style at strict visual parity — same size, padding, radius, weight,
border, shadow and every state, two hues matched on saturation and lightness
(`hsl(272,55%,40%)` / `hsl(211,55%,40%)`), neither styled as primary — placed
SIDE BY SIDE in an equal-width row (the old 220px action column could not hold
two equal buttons; `.round-grid` is 2 columns), with "Stop
and nominate" apart below a divider and never in the swap. Which sits on the
LEFT is assigned ONCE PER PARTICIPANT and fixed for the session
(`ui.buttonOrder`, default `'participant'`), block-randomised JOINTLY with the
crossover sequence — `Specs.assignmentCells()` cycles A/ask, B/reveal,
A/reveal, B/ask so both marginals stay exact at any roster size, the server's
`claimCode` counter and the admin's roster generator both fill the four cells,
and a client-mode run falls back to `Specs.buttonOrder` (a hash of the code).
It is stamped as a LOGGER BASE FIELD (`button_order`), so it reaches the
participant record and every decision row for the model to control with.
Deliberately NOT redrawn per round or per decision: ~300 actions with the
buttons moving buys mis-clicks (one spends the higher cost and destroys the
ground truth at that position) and inflates decision latency, itself a measure.
The cost numeral inside each button is red — and nothing else on screen is —
the cheaper action in a LIGHTER TINT OF THE SAME HUE, on a white chip because
no red meets 4.5:1 against a saturated fill; against white the lighter tint is
the lower-contrast one, so the step runs 38% (reveal) / 50% (ask), both above
4.5:1. Both are LOCKED RUN PARAMETERS (`ui.costColorReveal`/`costColorQuery`,
pushed into CSS custom properties at load) because styling that touches a
primary outcome is a treatment, not a theme; the reveal colour is identical in
AI-off rounds, where the Ask button is REMOVED FROM THE DOM rather than hidden
(so it is not tabbable or inspectable either — everything touching `#btn-ask`
is null-guarded). `tools/smoke.mjs` measures the parity from computed styles
and `tools/layout-guard.mjs` pins the side-by-side row at five widths.

**Where the round screen puts things** (owner 2026-08, from screenshots).
HEADER = the title **"Practice round (not scored) · Part 1 (out of 2)"** — the
qualifier sits with the thing it qualifies and the part says how many there are
(the count comes from the plan, never written down) — with the whole-study counter **"Round n / 28 · N rounds to go"**. **There is
no Instructions button** (owner 2026-08): the rules that matter while playing
are on the reminder strip in every round, so a reopenable summary had nothing
to add. `#ov-summary` and its builder are kept intact and unreachable, so
restoring the button is one line, and `instruction_reopens` stays in the schema
— constant at 0 for any session run without it, which its dictionary entry
says. The progress BAR and its per-half line under the title are gone: the
title already names the part and the counter says how much is left, and the two
together said it three times. LEFT COLUMN = **the round in four numbers and
nothing else**: net value if you stop right now (green, the one that matters),
best prize found, total cost of revealing, total cost of asking the AI (hidden
in an AI-off round, so that screen carries no mention of the AI at all), each
cost carrying its own count as a qualifier. The itemised ledger
that used to stand there, and the same four numbers as a band UNDER the plot,
are both gone: the ledger repeated in words what the plot, the number box, the
nominate button and the progress bar already said, and a band under the plot
was something to scroll to. CENTRE COLUMN = the reminder strip, the plot, the
legend, the position picker, the in-round nudge (moved down from the top of the
screen, so it speaks where the participant is looking), then **the two paid
buttons directly under the plot they aim at** (moved up out of a full-width row below the whole grid —
look at the line, choose a position, act, with no lane change in between; the
pair keeps its strict visual parity, which the ~640px column still gives it).
**The reminder strip on top of the plot** is the comprehension gate's own
reminder list as THREE OR FOUR SHORT SENTENCES (owner 2026-08 — as a chain of
fragments divided by `·` it read as a run-on, and copied as one word), rebuilt
from the RUN's parameters every round so a session that moves a cost or the step
bound can never leave a stale number on screen — deliberately dropping the two points that change no decision
inside a round (that every AI answer looks the same whether known or guessed,
and that prizes are drawn afresh each round; both stay in the gate). Like the
price note and the quiz reminder, copy derived from the numbers is built in
app.js and is therefore NOT an editable Wording field, which is what keeps it
from contradicting them. **HOW MANY positions the AI knows is NEVER disclosed**
(owner 2026-08: "it seems we reveal AI's private information here") — K is the
study's own manipulation, and a participant told the number can reason straight
to the expected gap size, which is the inference the design asks them to make
from experience. It was leaking in three places at once (the round subtitle,
the summary the Instructions button reopens, and the AI instruction screen's
"{K} of the {J}"); all three now say what the AI DOES — it interpolates from
the prizes it knows, and every position you reveal is added to them — never how
much it holds. **The boxes line up** (owner 2026-08, from a hand-drawn layout): the reminder
strip spans the WHOLE round, flush with the two columns beneath it; the key
(legend) sits directly above the plot it explains rather than under it; the
action block is flush with the chart column and centred, with the stop button
sharing the paid pair's exact left and right edges; and in an AI-off round the
lone Reveal button is a centred pill of the same width one of the pair would
have (`.act-pair.solo`, a class app.js sets — `:has()` is newer than anything
else in this build), because a single button stretched across the row read as a
banner. The selected position is labelled at BOTH ends of its line on every
plot, and the x-axis tick it would overprint is dropped rather than doubled.
`layout-guard.mjs` pins all of it: the KPIs beside the plot, the
strip on top of it and short enough not to push it down, the buttons within
220px of the plot's bottom in the same column, every alignment above measured
edge-to-edge, and no "knows N" anywhere on the round screen or in its reopened
summary.
**THE KEY NAMES THE MARKS THAT ARE ON THE PLOT, AND ONLY THOSE** (owner
2026-08, from a screenshot of an OPEN round at its first paint: an empty chart
under a key naming two kinds of mark, sending a participant hunting for
pre-opened prizes the round does not have). Each entry appears the moment its
first mark is drawn and not before — pre-opened only in a seeded round,
revealed from the first reveal, the AI's from the first answer paid for — and
with nothing on the plot the key is empty and OUT OF THE FLOW, so it leaves no
gap above the chart. It therefore cannot be built once with the round:
`renderLegend` is called from `renderRound`, like everything else that reads
the round's marks. The debrief caption follows the same rule (its truth/AI
line/anchors are always drawn; the participant's own asks and reveals may be
empty). Tested as an invariant against the SVG itself rather than against what
a round should hold — an entry exists exactly when ≥1 such mark is drawn —
sampled twice per round by `smoke.mjs` (which also asserts the run really met
an empty plot, a seeded round, a reveal and an AI answer) and measured
geometrically by `layout-guard.mjs`, which now REVEALS a position before
checking the key sits flush above the plot, since a key for nothing is not
drawn and cannot be measured.

**STOPPING TAKES THE BEST PRIZE ALREADY FOUND** (owner 2026-08, a deliberate
change to the brief's §7, made with its consequence stated and accepted).
Stopping is the END OF SEARCHING, not an action with an outcome: it never opens
a new position. The score is the best TRUE prize the participant holds — the
positions open at the start plus the ones they revealed — minus everything
spent, so the green "Net value if you stop right now" tile IS literally the
score. A participant who has found nothing takes 0 (and still pays what they
spent); that is the one case the stop button confirms, since it is almost
always a mis-click. **The consequence, which is not recoverable afterwards:**
an unverified position can no longer be taken, so `nomination_type` stops being
a behavioural outcome and the trust-without-verification measure does not
exist. The AI becomes purely navigational — where to spend a reveal — and
`tools/simulate.mjs`, whose 1000-participant runs motivated `revealCost` 4 and
`sparseK` 3 (SIMULATION-FINDINGS.md), models the OLD rule, so its numbers do
not carry over to a `best_found` session. The verification threshold
s* = c_R·√(2π) still describes when checking beats trusting a reading, and the
admin's Consequences panel still reports it, but nothing in the task now
rewards acting on an unchecked estimate.
**It is a LOCKED RUN PARAMETER, `costs.stopRule`** (`'best_found'` — the
default for every new session — or `'nominate'`, the brief's original rule),
chosen in the admin's Costs group and frozen at first participant like every
other task parameter. `specs.js withDefaults` resolves a session stored BEFORE
the parameter existed to `'best_found'` like any other missing parameter
(owner decision 2026-08-17 — the old `'nominate'` fallback is exactly the live
bug: the tile promised the best-found net while Stop settled on the selected
position, opening an unrevealed prize for free and re-pricing the round; only
a session whose stored params EXPLICITLY say `'nominate'` runs the legacy
rule). The dataset stays interpretable because every round row carries
**`stop_rule`** (dictionary entry included, and `logger.js`'s field whitelist
extended, the same trap that once silently dropped `raw_score`) AND because
`admin/export.js` **re-settles at export** any round that settled under the
old nominate fallback inside a best_found session — via the engine's own
`Specs.settle` over the pre-opened positions plus the participant's own
reveals, so a prize they never revealed can no longer touch the round's
objective in either direction; such rows export `score_corrected: TRUE` with
the as-played settlement preserved in `as_played_*` columns, and participants'
`total_score` is re-summed (`rounds_score_corrected`,
`total_score_as_played`). Re-downloading a past session's workbook from its
card yields the corrected data; the tile is rule-aware too, so under an
explicit nominate session it promises a number only when the selected
position's truth is known. `nomination_type` gains
`best_revealed` / `best_pre_opened` / `nothing_found` beside the legacy
`verified` / `queried_only` / `untouched`. **One settlement function,
`Specs.settle`**, is used by the local backend AND vendored into the Cloud
Function (`tools/sync-engine.mjs --check` keeps the copy honest) — the score is
the one thing a client must never be able to differ with the server about, and
under `best_found` the server IGNORES the position the client sends. Every
piece of participant-facing copy that describes scoring asks the rule rather
than assuming it: the stop button (which names the prize it takes, not the
slider's position), its note, the strip on top of the plot, the reopenable
summary, the gate's reminder, the between-rounds line, and — through the
`{scoreRule}` / `{scoreRuleNote}` / `{stopVerb}` tokens, so the text stays ONE
editable Wording field — instruction screen i4 and the AI screen. The admin's
Wording tab substitutes the same three tokens, so its preview shows what that
session's participants will actually read. The strict gate (`qai_score`) was
rewritten to a form that is true under BOTH rules: an AI estimate is not a
prize you have found. `smoke.mjs` and `data-audit.mjs` read `costs.stopRule`
and assert against whichever rule is in force — the audit deriving the expected
settlement from the frozen specs and its own reveals, never from the app.

**The comprehension gates ask participants to USE the rules, and hold them on
the explanation** (owner 2026-08). Two changes that go together. (1) **The gate
grades on the first press and continues on the second** (`reviewing` in
`renderQuiz`): a correct answer has always been given a green "✓ Correct." plus
its `why`, but when EVERYTHING was right the screen advanced in the same click,
so the explanation was drawn onto a screen already leaving — nobody ever read
one. The first press now grades, freezes the answers (radios disabled, so
nothing can be changed after grading) and turns the button into **Continue**;
attempts and first-answer correctness are still recorded on the press that
graded them, so the measure is untouched. `selftest` fails if any item lacks a
`why`. (2) **Every question was rewritten to be applied rather than recall.**
The reminder above the gate — and now the strip on top of every plot — states
both costs and the step bound outright, so "what does it cost to reveal?" was
answered by copying; `selftest` fails any item whose correct option is nothing
but a cost token. The twelve items now test: that the step bound decays with
distance, that it works leftwards as well as rightwards, that the prize ceiling
binds before it does, applied scoring arithmetic, that a round can end below
zero, that prizes are redrawn; and for the AI, the ask-vs-reveal trade-off, that
an earlier exact answer certifies nothing (the strict gate), where its answers
are likeliest to be wrong, that a known and a guessed answer are indistinguishable,
that a flat run marks the edge of its knowledge, and that a reveal moves its
line. **The twelve ids are unchanged** — they are the export's own column names,
so a rename would break every session already collected; several no longer
describe what they ask (`q_adj_lo1` is a "highest" question) and that is
deliberate. The three arithmetic items state their numbers outright, so
`selftest` pins the step bound and prize range they were written for and fails
if either default moves. Every prompt and option stays editable per session in
the Wording tab; only the answer KEY is structure.

**A cost is RED, except the AI's, which is purple** (owner 2026-08): red is what
a cost is on this screen — on the KPI and on the tag inside the button alike —
and the one exception ties the AI's running cost to the purple of "Ask the AI",
so the number and the button that produces it read as the same thing. "Stop and
nominate" is centred under the pair rather than aligned to the left one, so it
reads as belonging to neither. **Neither paid button carries helper text**: what
each does, and what it costs, is on the reminder strip at the top of every round,
and a line under each one only pushed the actions further from the plot they aim
at (smoke pins that there is none under EITHER, which is a stronger parity claim
than the old "about the same length"). The STOP button keeps its note — it is
the only one that ends the round, and its wording follows the session's stop
rule.

**Engagement, under the same rule** (owner 2026-08): a progress bar + "round n
of 12 in this half" under the round title, milestone pop-ups at the halfway
point / three rounds left / the last round, one in-round encouragement tip, a
friendly between-rounds line, and a FOCUS PROMPT when a scored round is about
to be closed after `ui.rushMinActions` (default 2) actions or fewer — always
dismissible in one click, since a prompt that could not be dismissed would
coerce the choice being measured. Every message is motivational and never
informational: none names a position, none reacts to the score, none differs
between the arms, and each is logged as a `nudge`. Copy lives in `content.js`
(`ENCOURAGE`), the whole feature behind `ui.encouragement`. A session stored
before the `ui` group existed keeps the interface it actually ran with
(`withDefaults` sets `buttonOrder:'fixed'`, `encouragement:false`), so a
running session never changes under its participants.

**The enrolment rule lives in ONE place** (`Specs.nextCell`, shared by the Cloud
Function's `claimCode`, svfirebase's client-mode `assignCell` and the tests):
the under-filled arm takes the entrant, and the button order alternates on that
arm's own PARITY, which keeps all four cells of sequence × order balanced
WITHOUT a new counter field. That last part is load-bearing — the deployed
`firestore.rules` pin `runCounts/{runId}` to `hasOnly(['nA','nB'])`, so an extra
key makes the whole client-mode transaction permission-denied and the catch
hands out a wall-clock coin flip while the counter never advances, silently
destroying §11's exact crossover split for a whole class. Also: `publicDoc`
MUST carry the `ui` group — in server mode the redacted copy is all the
participant sees, and without it `withDefaults` takes the pre-`ui` branch and
turns the whole interface treatment off; and the Run sheet exports `ui` with
the other parameter groups, because it is a treatment, not a theme.

**28 rounds**, 4 warm-up + 24 scored, 12 per block, counterbalanced crossover
(sequence A = AI off then on, B = the reverse). Per block: 4 open + 8 seeded
(2 FRONTIER, 4 BALANCED, 2 GAP), densities balanced within each shape. Mappings,
seed positions and AI anchors are FROZEN and identical for every participant;
only the order within a block is shuffled, from `hash(participant_code)`, and the
realised order is logged.

**Deterministic artifacts, none committed (§18).** `pool.js` generates the
mapping pool from `env.generatorSeed`; `specs.js` builds the 28 specs and owns
the §17b **validation gate**. `tools/generate_mappings.py` is a bit-exact port of
the same mulberry32 PRNG — the two print the same parity vector and build
byte-identical pools, asserted by `tools/selftest.js`. **The pool size is 600,
not the brief's 200**, and that is measured, not a preference: only ~2% of
(mapping, seed-set) pairings pass the §9 acceptance filter, so 200 cannot give
the 16 seeded specs a distinct prize curve each — and a repeated curve would make
the instruction "the prizes are drawn afresh in every round" false.
`Specs.validate()` FAILS a run whose specs repeat a mapping, so this cannot
regress silently. Full reasoning in `SEEDS.md`.

**Log raw state, derive nothing in the client (§16).** `logger.js` writes two
classes: RECORDS (every query/reveal/stop, round and session boundaries,
comprehension, survey) one flat append-only document each, and TELEMETRY (slider
trace throttled to 250 ms + one on release, 30 s heartbeats, focus/blur,
instruction opens, resizes) batched into array documents. A decision row carries
BOTH anchor sets — `ai_anchors_before` (private anchors included) and
`participant_known_before` — encoded `"pos:val|pos:val"` because Firestore rejects
nested arrays. **Every derived field of §16.8 is computed offline in
`admin/export.js` and nowhere else.**

**Admin panel** at `/lab/search-v2/admin/`, seven tabs over the brief's six
screens: Sessions · Parameters (+ Consequences beside it) · Participants · Live
monitor ·
Data & preview · Design notes · Wording. The tab switcher derives its pane list
from the buttons themselves — a hard-coded list silently fails to show any screen
added after it was written, which is exactly how the Wording pane first shipped
invisible. Parameters carries an eighth group, **Interface and engagement**
(button order, the two cost colours, encouragement); the Participants screen reports the
ask-left / reveal-left balance beside the sequence split; and the Wording tab
covers the registration questions and every encouragement message, like every
other word a participant reads. **The UI calls the unit a SESSION** (28 rounds: 4 warm-up + 24
scored, two blocks) — the brief calls it a *run* and the DATA keeps that name
(`run_id` on every row, the workbook's Run sheet), so the two words are one
object and no analysis script moves; rename UI copy only. The governing rule is
**CLONE, DO NOT EDIT** — a session's task parameters lock the moment its first
participant claims a code (greyed with a padlock and the date; only the
Operations group and the next-entrant override stay editable), enforced by
`firestore.rules`, not by the UI. Consequences recompute live with two badges.
The four buttons under the form are unchanged in number and colour from the
previous panel: **Save session** (green), then Cancel edit / Make this the
default / Restore built-in default (ghost). Export is one workbook (ReadMe, **Dictionary**, Run,
Specs, Decisions, Rounds, Participants, Slider, Attention, Raw) plus the three
CSVs, bundling the session's frozen configuration and a checksum; `interrupted`
and `disengaged` are COLUMNS, not filters.
**The third tab is PARTICIPANTS, and its status is read from the participant, not
from the roster document** (owner 2026-08: "many participants have fully completed
the game but the data shows them still as started"). The roster document learns
one thing — that a code was CLAIMED, stamped `'started'` at entry — and nothing
ever wrote to it again, so every finished participant read as in-progress for the
rest of the session's life (47 of 47 on the live session, 0 completed). Two
halves to the fix: `derivedStatus` in admin.js joins each roster row to that
participant's own session record (`completed`, written on the Done screen) and
prefers it, which HEALS every session already recorded; and `showDone` now calls
`SVFirebase.markRosterCompleted`, a best-effort merge write allowed by the
existing rule (`request.resource.data.claimedByUid == request.auth.uid` — it
re-states the claiming uid, so no rules republish), which closes the loop going
forward. The panel must keep deriving even so: the write is deliberately
non-fatal and a refusal must never surface on a participant's Done screen. A new
**Round** column reads `18/24 (75%)` — SCORED rounds finished out of the scored
rounds this session assigns (`scoredDone`/`scoredTotal`, derived from the
participant record's `rounds_done`, which counts warm-ups too, against THIS
session's own `warmupPerBlock`/`scoredPerBlock` rather than the default 4 + 24;
warm-ups head each of the two blocks, per `Specs.orderPlan`). A code with no
session record shows `—`, never `0/24`: it has finished nothing, but it has not
finished zero rounds either. A session record whose roster document is missing is
appended as its own row rather than vanishing. **The screen's two side cards were
REMOVED** (owner: "I will never use it") — code generation and the next-entrant
override — so the table spans the full width; the override is still edited in
Parameters (Assignment → Next entrant, the one control that stays unlocked) and
its log still ships with the export, but a CONSEQUENCE is that `ops.rosterMode =
'roster'` ("roster only") now has no way to be given codes, so leave it on Open,
where a class-platform student ID enrols itself. Only the UI word changed: the
`roster` collection, the `runId__CODE` document ids and the tab's own
`data-tab="roster"` are untouched, exactly as SESSION/`run_id` is handled above.
**The button column NAMES the button** (owner 2026-08: "what does the column
Buttons mean really?"): heading **Left button**, cells "Ask the AI" / "Reveal"
— which of the two paid buttons sat on the LEFT for that participant, assigned
once at enrolment and fixed for the session, the covariate `button_order` — with
a tooltip and a line of lead text saying so. The CSV keeps the raw
`button_order` beside the readable `left_button`. **Every heading sorts, and
reverses on a second press.** One `rosterCols(params)` spec owns each column's
heading, its cell AND its sort key, so a sorted table can never order itself by
something other than what it displays; `sortRoster` sinks null sort values to the
bottom in BOTH directions (an unclaimed code has nothing to compare, which is not
a zero) and decorates with the load index so ties are stable and a re-click is a
clean reversal. Status sorts unused → started → completed — by how far they got,
since alphabetical order here is an accident. Painting was split from reading
(`paintRoster` vs `renderRoster`), so a sort click re-renders what is loaded
instead of firing two more collection reads; the CSV exports in the displayed
order. Covered by `tools/admin-smoke.mjs` (199).
**The Dictionary sheet describes EVERY column** of Decisions/Rounds/Participants
in a sentence + a type, generated from `admin/dictionary.js`; `selftest.js`
FAILS when a column is exported without an entry, so the two can never drift —
add the entry in the same change as the column. The data sheets stay tidy (one
row per observation, no merged cells or spacer rows), header frozen +
filterable, numbers as numbers, **booleans as real Excel booleans** (reads
TRUE/FALSE, parses as boolean — same as the CSVs), timestamps as epoch ms AND
ISO, empty cell = not applicable (never 0). Join keys: `participant_code +
round_index` (Decisions→Rounds), `participant_code` (→Participants), `spec_id`
(→Specs).
**A sixth tab, `Design notes`** (owner 2026-08 — the questions this design
attracts, answered in the panel itself): does the AI hold private data (YES —
K positions per round whose TRUE prize it knows exactly, plus every pre-opened
and revealed one; it interpolates between the two nearest and repeats the
nearest value beyond the outermost, so it CANNOT extrapolate; rounded + fixed
latency so nothing leaks whether it knew); what a pre-opened ("seeded") round is
and why (identification — the geometry at the first decision is
experimenter-assigned); gaps vs tails (σ√g/2 vs σ√t → **g = 4t**) and the
three layouts' own g/4t + benchmark frontier share; why all three are needed
(the AI's blind spot IS the frontier, so a GAP-only design could never detect an
AI pulling people off it); that the landscape is redrawn every round (28 specs,
28 different mappings, same set for everyone, shuffled within block, sequence
counterbalanced → mapping difficulty balanced by construction); and that
"Brownian" here runs **across positions, not across time** (drawn once offline,
static while played). **Every number is measured from the OPEN SESSION's own
frozen pool at render time** (`poolStatsFor`), never copied from the design
document — keep it that way. It also disambiguates the word **"seed"**, which
carries three unrelated meanings (pre-opened positions · the walk's start value ·
the RNG seed); the Environment labels now say "walk start value" and the filter
says "highest pre-opened value" for exactly that reason (labels only — field ids
and `seed*` param names are unchanged).
**The ceiling plateau + the tie rule it forced:** the walk reflects at the prize
ceiling, so measured over the default 600-pool **56.0%** of mappings touch it,
only **49.7%** have a single-position maximum and **24.3%** have 3+. Taking "the"
argmax as the FIRST index (what `Pool.argmaxOf` returns) imports a leftward
tie-break artifact — mean position 41.1 and 17.7% in the first decile, against
47.8 and 11.4% counting every maximising position, i.e. essentially uniform. So
`dist_best_to_argmax` in the export is the distance to the **NEAREST** maximising
position and **`argmax_count`** ships beside it; `argmax_position` stays the first
index for continuity. The plateaus are inherited from the source study's
generator, so this build does not silently diverge from it — removing them needs
an acceptance rule (max attained at ≤2 positions, ~a quarter of draws) and that
is a NEW session, never a change to a running one.
**Session cards, like the other class admins** (owner 2026-08): the Sessions
screen groups **Active** and **Completed** with a count each, and every card
carries code · status · name · created · participant count · sequence balance ·
where the score is computed, then **Open · Copy link · ⬇ Export data · 🧪 Test
round · Clone · Open entry / Close session · Delete** (Copy link is dropped on a
completed session — its link would refuse the entrant). Same `.sBtn` pill family
as ideasearchlab/Answer Arena, 1px border on every variant so the row sits on one
baseline. **Export data is the whole job in one press** (select → read the log →
build → save); **Delete removes the session AND its event log**, confirm-guarded
with the participant count.
**A session is NAMED BEFORE IT EXISTS** (owner report 2026-08: "creating a new
session is complicated, I need to create, then open it etc. Why? Instead, before
creating a session I would like to give it a name"). The Sessions screen opens on
a **Create a session** card — Session name (`e.g. Spring MBA 2026`), an optional
**Session ID** live-normalised to one word of `[A-Z0-9]{3,40}`, and one green
**Create session** — the SAME shape ideasearchlab's "Session details" and Answer
Arena's "Create a session" already use; keep the three in step. It was previously
creatable only from the parameter form: press New session, scroll past seven
collapsed groups to Operations (where the name field lived), create, then go back
and open it. Now `createFromCard`/`askCreate` build it from `savedDefaultParams()`,
run the SAME `askSummary` gate (creating still freezes the pool and all 28 specs),
and then **`loadRuns(id)` SELECTS it** — so creating a session is also opening it:
Parameters/Roster/Data are already on it, and a `.made-box` reports the code, the
participant link and the three things to do next (Copy link · Check its parameters
· Open entry, the last running the validation gate + confirmation exactly as the
card's button does). The parameter form is still one click away —
**Set the parameters first…** (the old `btn-new-run`, moved into the card) —
and CARRIES the typed name/code into Operations, so switching paths costs nothing.
A typed ID is refused when it is under 3 chars or already taken (locally, plus
`FB.codeExists` for a session another admin made since this list was read); a
blank one is auto-generated by `freshCode`, which re-draws until the code is
unused — `autoCode` draws at random, and a repeat would re-point
`runCodes/<code>` at the newer session and send the older one's participants into
it. Two fixes rode along: the form's own create now selects what it created (it
left `editingId` null, so pressing Save again created a SECOND session on the
same code), and `newRunDoc` forces `ops.entryOpen = false` — every session is
created a draft, `app.js` treats a session as open when `entryOpen !== false` OR
`status === 'open'`, so a draft created with the Operations toggle left on was
enterable before the validation gate had ever run. `.made-box` is deliberately
NOT named `.code-box`: `../styles.css` already has one (the participant app's
completion code) and the admin page loads it. Covered by `admin-smoke.mjs`
(178 checks).
**The parameter form COMPOSES a session; it does not silently rewrite one**
(owner report 2026-08: "changing the parameters and hitting Save affects all the
previously opened sessions"). Two variables that had been kept as one:
`current` is the session the READ screens are on (roster, monitor, data, notes)
and the panel picks one at load so they have something to show; `editingId` is
what the parameter form and the Wording tab WRITE to, and `null` there means "a
new session". Binding the form to the panel's own pick turned the obvious act —
set the parameters for my next session, press Save — into an unconfirmed
overwrite of whichever session had been picked, with no summary and no new
session created (reproduced: reveal cost 4 → 9 landed on the existing session
and nothing was added). So `selectRun(run, {form:false})` is what the fallback
pick now uses, and the form is bound to a session ONLY by opening it from its
card. Save therefore has two clearly-separated jobs, said on the button, in a
banner above the form (`#edit-note`) and again in the confirmation: **Create
session** — which asks for the **name and the Session ID in the create dialog
itself** (`createFieldsHTML`/`readCreateFields`, same rules as the Sessions
card, refusing a short or taken ID without closing the dialog) and then shows
the created box with Copy link / Open entry — or **Save changes to `<CODE>`**,
which names the session in a confirm before rewriting it. The Wording tab
follows the same target and says so (`#wd-target`), since it is saved by the
same button.
**The 4-round demo session** (`demoParams`/`demoContent`/`createDemoRun`, the
"🧪 Create the 4-round demo session" button on the Sessions screen; code `TEST`,
name "For testing purposes"): a session for showing a class how the game works
before they play the real one — **2 rounds without the AI, then 2 with it**, and
in each half **one round that starts empty followed by one with three prizes
already open**. Every departure from the defaults is deliberate and load-bearing:
0 warm-ups + 2 scored a block (= 4 rounds), 1 open + 1 seeded with
`shuffleWithinBlock:false` so the empty round always comes first,
`nextEntrantOverride:'A'` so EVERY entrant gets the no-AI half first (the control
is labelled "next entrant" but is never consumed, so it holds for the session —
the crossover would otherwise send half the room the other way), the open round
on the DENSE AI and the seeded one on SPARSE so a class sees both faces of it,
the 24-question exit survey off and the debrief on, and — the one that matters
for the data — **its own `generatorSeed`**, because specs are drawn from a pool
shuffled by that seed and a demo sharing it would show the class the real
session's round 1. Pressing the button twice refuses rather than making a second
`TEST`. Two things had to change for a warm-up-free session to read correctly:
`showBlockIntro` no longer announces "the next 0 rounds are practice" (a
warm-up-free block introduces its scored rounds directly, in both the opening
and the halfway branch), and the one instruction screen that counts practice
rounds is reworded for this session through the per-session Wording system
rather than by touching the study's own text.
**A rehearsal reads the session it was launched from.** "🧪 Test round" is
pressed on a particular card to see what THAT session gives a participant, but
`boot()` skipped the run read whenever `PREVIEW` was set, so the sandbox always
rehearsed the built-in defaults — a session that differs from them (the 4-round
demo, say) could not be checked before it was shown to anyone. The read is now
unconditional on the code; nothing is written either way (startPreview runs on a
local backend with `run_id` null and every writer checks `PREVIEW` first), and
`startPreview` passes the run's own `specSeed`, so a server-mode session — whose
specs never reach the browser — rebuilds the same rounds locally instead of a
different set drawn from the default seed.
**A session is summarised before it can bite** (`summaryBoxes`/`askSummary`):
CREATING freezes the pool and all 28 specs under its seeds, and OPENING ENTRY
starts the lock, so both put the whole configuration in front of the admin first
— rounds, task, costs/caps, the two AI densities and whether they still bracket
`s*`, assignment, after-the-task, and the participant link — with Cancel as a
real cancel (the smoke test asserts a cancelled summary creates nothing).
**Every round, drawn** (`renderRoundGallery`, bottom of Data & preview): one plot
per round in the frozen order, each overlay behind its own tick box — **ground
truth (the hidden random walk)**, the AI's interpolation line, its private
anchors, pre-opened prizes (with values), mark-the-best-position, scored-rounds-
only — plus, under each plot, what is pre-opened, where the best prize is and how
many positions the AI knows. Built from `artifacts(run)` + `Ai.anchorSet`/
`Ai.aiAnswer` through the participant's own `SVChart`, so it cannot drift from
what the round actually is. **ALL OF IT IS ADMIN-ONLY AND MUST STAY SO** — the
truth and the AI curve exist in the participant build only as debug overlays
behind the preview key, the anchors never reach a live browser in server mode,
and `tools/smoke.mjs` asserts on a LIVE round that `#plot` holds no `.gt-line`,
no `.ai-line`, no `.anchor-dot` and that `#testview` is not displayed.

**A participant who comes back continues where they left off — on ANY device**
(owner 2026-08). Resume was localStorage-only, so a returning participant whose
browser had been cleared, or who came back on their phone, started the study
again from consent. Their progress is now mirrored to their participant record
as **`state_json`** on every save (alongside, never inside, `sessionRecord()` —
that object is also the body of the `session_end` event, and a copy of the whole
state in the log would be huge and redundant), and the boot reads it back after
the claim. It continues from whichever copy got **FURTHER** —
`progressOf`/`furtherAlong`: completed, then rounds finished, then phase, and
only then the clock — so a sync that never landed can never replay finished
rounds, in either direction. Carrying the state is safe because S holds only
what the participant has already SEEN (their answers, their own queries and
reveals, the values they paid for); the mapping and the AI's private anchors are
not in it and must never be put there. Reading it on a new device needs the
`firestore.rules` change that ships with it — a new browser is a new anonymous
uid, so `data.uid` cannot be the test on that first read; the test is the roster
document with the SAME id (`runId__CODE`), which `claimCode` rebinds on a resume,
hence the read happens AFTER the claim. **Republish the rules**; until then the
fetch is refused and the participant falls back to their own browser's copy,
which is the old behaviour. Deliberately NOT resumed mid-way: an OPEN round,
which still restarts from its beginning and is flagged `interrupted` — a round is
one uninterrupted decision sequence and its timings are the measure. Guards: a
6 s `CONFIG.RESUME_FETCH_MS` timeout so a slow network cannot strand anyone on a
spinner, `getParticipant` checked by name (a cached older `svfirebase.js` must
fall back, not die), a 400 KB blob cap, and nothing written in PREVIEW.
**Resumptions and BREAKS BETWEEN SITTINGS are tracked** (same request): `save()`
stamps `lastSeenAt`, and leaving stamps it too (`stampSeen` on
`pagehide`/`visibilitychange`) so a break is measured from when they actually
left rather than from the last 30 s heartbeat. `stampSeen` writes **only the
timestamp onto whatever is stored**, never this tab's whole state — a second tab
may have gone further, and rewriting S wholesale on the way out would push its
progress back (that is also what made every localStorage-editing test resume into
the wrong phase). Every return logs a `resume` RECORD row carrying the raw gap
and where the progress came from (`local`/`cloud`); a gap ≥ `CONFIG.BREAK_MIN_MS`
(5 min) is a break rather than a reload, and `admin/export.js` derives
`breaks_count`/`break_total_ms`/`longest_sitting_break_ms`/`sittings` from those
raw gaps (with Dictionary entries — `selftest.js` fails without them). The live
monitor shows Resumptions beside a **Breaks** column. `logout()` sets `wiped`,
which silences both writers — it promises to erase every trace on the device, and
a stamp written a millisecond into the navigation would put the state key back.
**The "Abandoned" tile is now "Away 30+ min"** (owner: "how do you know 15 users
have abandoned?"): nothing observes abandonment — it is
`started − completed − (record written in the last 30 min)`, and with
cross-device resume anyone in it can come back and carry on, so the tile says
what it actually knows. Every monitor tile and health check now carries the rule
behind it (`why`, shown in the row when the ⚠ fires), the event-log placeholder
names the button that computes it, and **the median active time counts COMPLETED
sessions only** — someone who stopped after five minutes is not a fast
participant, and the row exists to answer "is the study the length we designed".
**The round gallery's caption reports what the AI ACTUALLY knows** (owner
2026-08: "it says the AI knows 10 points; it knows 13"): the anchor set is the
UNION of its private anchors, the pre-opened positions and every prize revealed
so far — that is `Ai.anchorSet`, in the preview and in BOTH backends, which is
why the dashed line already bent through the pre-opened squares — but the caption
printed the private K alone. It now reads "the AI knows **13** positions exactly
at the start (10 private + 3 pre-opened), and one more with every prize the
participant reveals", counting a shared position once, and the pre-opened list
above it is labelled as what the PARTICIPANT knows. Behaviour unchanged; only the
label was wrong.

**Firestore layout (§17.3):** `runs` · `runPublic` · `runCodes` · `runCounts` ·
`roster` · `participants` (+ a server-only `rounds` subcollection) · `events` ·
`audit` · `messages`. **`events` must keep its name** —
`simulation/admin/verify.js` reads it and matches `event == 'session_end'` on
`pid`. `firestore.rules` must be REPUBLISHED for the new collections; until then
the panel says so instead of failing silently.

**Score-bearing actions run on the SERVER (§17.2).** `claimCode`, `startRound`,
`act` (query or reveal), `nominate` and `debriefRound` are callable Cloud
Functions in `lab/search-v2/_functions/functions/` — the project is on the Blaze
plan. The client sends a position; the server holds the mapping, computes the
answer or the truth, charges the cost, appends the authoritative event and returns
ONE number. Enforced and emulator-tested: an IDENTICAL response whether or not the
position was a private anchor (same keys, same shape, every handler padded to a
fixed duration — measured at a median 267 ms either way), IDEMPOTENCY on a
client-generated `actionId` (a retry returns the recorded answer; a different id
on an already-open position is refused), and `nominate` computing the score, never
the client. In server mode the run document is ADMIN-ONLY (it holds
`generatorSeed`) and the participant boots from the redacted `runPublic/{runId}`;
the server's per-round state is unreadable to anyone but the admin.

**Which mode a run uses is a LOCKED run parameter** — *Score-bearing actions* in
the admin's Operations group (`ops.compute`, `'server'` | `'client'`), set before
the first participant. `backend.js` is the one place that knows the difference,
and a server-mode failure is NEVER downgraded to computing locally: the
participant sees "we could not reach the study server" and reloads. Falling back
would void the property the run was configured for and put two kinds of row in one
dataset. Client mode remains for the admin's test round (always local, so the
testing overlays work) and for a project with no Functions deployed.

**The engine is VENDORED into the Functions** (`_functions/functions/engine/`)
because Firebase deploys only that directory. It is GENERATED by
`tools/sync-engine.mjs`, never edited, and `--check` (run by `selftest.js` and by
the emulator test, and as a `predeploy` step) fails the build the moment it drifts
— a drifted copy would have the server computing against a different pool from the
one the exporter joins against.

**Simulation Platform contract (both directions, pinned by
`tools/platform-guard.mjs`).** The handoff's `studentId` becomes
`participant_code` AND `pid` — one join key, no second identifier invented. A
background item the platform already answered (level of study, age band, gender)
is NOT asked again; its answer travels as `platform_<field>`, flagged. The
student's name and e-mail NEVER reach this study's log (§11). Finishing writes
`session_end` with `pid` and calls `window.simpMarkCompleted()`. A rehearsal
(`?preview=1&debug=1&key=…`) does neither, never adopts the student ID, and its
rows carry no `run_id`.

**A seventh tab, `Wording`** (owner 2026-08 — "include the exact words that will
be shown to each participant right in the admin panel… I wanted to check these
questions that participants see, and can't find them"): every participant-facing
string content.js holds, **in the order a participant meets it** — consent, the
five instruction screens, the three AI screens, both quick checks with their
answer options, all twenty-four survey items with their options and follow-ups,
the part headings, debrief and thanks. Deliberately NOT in scope (and said so on
the screen): the game screen's own buttons and labels and the reminder box above
each quick check, which app.js builds from the numbers themselves — interface
rather than study text. Each is shown **with this session's own numbers substituted**,
because a screen that displayed `{revealCost}` instead of `4` would defeat its
own purpose. Editing a field writes a **per-session override**; the study's
defaults in `content.js` are untouched and every other session keeps them.
**`content.js` owns the whole mechanism** — `outline()` (the editable fields,
which doubles as the whitelist), `normalizeOverrides()` and `resolve()` — so the
panel only draws it and `app.js` only reads it. Storage is a **flat
`key → string` map** (keys like `quiz.q_cost.opt.2`), held on the run document as
a JSON STRING — **`run.contentJson`, beside `specsJson`** — and that is not
cosmetic: both writers use `setDoc(merge:true)`, which DEEP-MERGES a map, so
stored as a map a reverted key would be merged straight back and "revert" would
change nothing for the participant while looking right in the panel. A string
field is replaced whole. It is carried by **`publicDoc` too**, or a server-mode
participant — for whom the run document is admin-only — could never see an
override. `newRunDoc` takes the wording as an ARGUMENT rather than reading the
panel's current state, so **a clone carries the wording of the session it was
cloned from** instead of whatever session happened to be open in the form. **WORDING IS EDITABLE,
STRUCTURE IS NOT**: ids, answer keys, option COUNTS, question types, `strict`,
`platformKey` and the numeracy answers always come from `content.js`. That is the
safety argument, not a UI convenience — `admin/dictionary.js` describes one entry
per column and `surveyColumns()`/`quizColumns()` derive the workbook from those
ids, so a session that could add a question or move an answer key would
invalidate its own data; rewording cannot. For the same reason wording stays
editable **after a session locks** (it is not part of the design), unlike the task
parameters. `normalizeOverrides` drops an unknown key, a non-string, a blank, an
over-long value (`MAX_LEN` 4000) and — deliberately — **a value equal to the
default**, so an untouched field is never frozen against a later correction to
`content.js`. Overrides are plain text: the participant screen escapes them and
re-introduces only `**bold**`, exactly as it does the defaults. Fixed in the same
change, because the tab surfaced it: **`{stepBound}` was never substituted** —
three quick-check explanations reached participants reading "differ by at most
{stepBound}" — and `selftest.js` now derives the handled token list from `app.js`
itself and fails on any token `content.js` uses that the app does not substitute,
so the two cannot drift again.

**`lab/search-v2/DESIGN.md` is the design document — keep it in sync.** It is the
single place that explains how the participant app AND the admin panel are built
and **why every default parameter is the number it is** (the c_R = 4 / sparse
K = 3 straddle window, the 600-mapping pool, the three layouts' `g = 4t`
ordering, the caps, the gates, the button-parity and engagement `ui` group, the
lock semantics and what stays editable after a lock), with every derived figure
recomputed from `config.js` and a one-command recipe to re-verify them. **Whenever
a parameter default, a screen, a security rule, an export column, an admin tab or
the platform contract changes, update the matching section of `DESIGN.md` in the
same change** — the same discipline as the `fun/index.html` cards and `/lit`'s
About page. `README.md` stays the operator's guide, `SEEDS.md` the frozen seeds,
`tools/SIMULATION-FINDINGS.md` the measurements. Its "Known drift" section is the
live to-do list of stale participant-facing copy (currently: the survey item and
the debrief prose still saying the AI knows 4 positions, and `dictionary.js`'s
"SPARSE (K=4)", when sparse K is 3) — the data is unaffected, the prose is not.

**Tests that must stay green** (browser ones need Playwright; only Chromium is
installed in the container, so Firefox/WebKit report as skipped rather than
pretending):
`node lab/search-v2/tools/selftest.js` (342) ·
`tools/smoke.mjs` (217 — a whole 28-round session, plus the resume path: breaks between sittings and which copy of a participant's progress is continued from) ·
`tools/admin-smoke.mjs` (199) · `tools/platform-guard.mjs` (30) ·
**`tools/wording-guard.mjs` (17 — a session's overrides actually REACH its
participants, and the drift guard that `app.js` reads content only through the
resolved copy: one `Content.SURVEY` slipping back would silently ignore that
session's wording for that one screen)** ·
`tools/layout-guard.mjs` (219 — reachability at five window sizes) ·
`tools/data-audit.mjs` (56) ·
**`tools/migration-guard.mjs`** (a participant MID-SESSION when a build ships
must not lose data — the registration phase is entered from the consent button,
so a resume from the previous build is caught up before the task or asked at the
end of the survey, never skipped) ·
`tools/preview-guard.mjs` · **`tools/emulator-test.mjs` (37, against the REAL
Functions + Rules in the Firebase emulator — needs Java and firebase-tools, skips
cleanly without them)** · `python3 tools/generate_rounds.py --validate`.
Standing in for cross-engine coverage: the browser code contains no syntax or API
newer than 2020, and `inset` carries its long-hand fallback.

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

## `/simulation` — the class Simulation Platform (hub over the lab apps)

`simulation/` (top level, NOT under `/fun/` — no landing-card rule) is the
front door for the class simulations: students **register once**
(`localStorage 'simp:profile:v1'`), the instructor **activates** simulations
from `simulation/admin/`, and only active ones render as cards on the student
page; launching a card collects/ships the **Session ID** and hands the saved
details to the sim. **No hosted simulation was modified** — the platform
drives them from the outside via `catalog.js`, the ONE place that knows each
app's launch URL, session mechanism (`?code=` auto-join for
sustainable-supply-chains/search-v2, `?session=` prefill for portfoliofit,
`?s=` for answerarena, handoff-prefilled join code for ideasearchlab —
whose student flow is now ACCOUNT-FREE: `RequireStudent` mints a silent
throwaway e-mail/password login (NOT anonymous auth — the deployed
joinSession writes token name+email and the Admin SDK rejects undefined)
and Registration auto-submits from the handoff — consent statements
included, carried as granted from the platform launch and stamped
`consentVia: 'simulation-platform'` on the participant doc, per the owner),
storage seeds (a hook,
currently unused) and admin-panel URL. The catalog is DELIBERATELY CURATED
(per the owner): eight class sims in a fixed display order (ideasearchlab,
portfoliofit — titled plain "PortfolioFit" —, answerarena, problem-solving,
ssc, newsvendor, then search-v2/jagged); the practice/tool apps
(portfoliofit-testing, interpolation, knapsack-*, tetris, search) are
intentionally NOT listed. The admin table floats saved-active sims to the top (stable
sort on the SAVED state, so rows don't jump while ticking). Vanilla JS, no
build step. **Backend switch follows `sustainable-supply-chains/store.js`:**
`firebase-config.js` still holds `PASTE_` placeholders → LOCAL mode, where
the committed **`config.json` is what students see** (admin edits are a
browser-local draft published by committing the panel's downloaded
config.json; the maintainer key gates the panel) and profiles stay
client-side; a configured Firebase project (rules in `firestore.rules`,
admin e-mails in `SIMP_ADMIN_EMAILS` — keep in sync with `isAdmin()`; setup
walkthrough in `simulation/_FIREBASE-SETUP.md`; live updates hardened for
stream-hostile networks — `experimentalAutoDetectLongPolling`, ONE memoized
anonymous sign-in per page load (concurrent sign-ins minted two uids: roster
doc under one, approval watch on the other — the "unlock only after refresh"
bug), a 5 s own-doc poll while unapproved + a 10 s roster `count()` poll with
refetch-on-change, and an optimistic Approve-row repaint) makes
activation live (`simPlatform/config` doc) and adds a roster
(`simPlatformStudents/{uid}`, anonymous auth, every registration field
compulsory — and ENFORCED (owner 2026-08): an incomplete registration
raises a pop-up naming the missing details (on approval arriving, else on
the next visit), banners the card list and **cannot launch a simulation**
(`profileComplete`/`missingFields`/`openRegPrompt` in index.html); the
selects' blank first entry became a **disabled placeholder** so nothing
empty is selectable, and **every `<option>` now carries an explicit
`value`** — without one an option's value IS its text, so a student
browsing with page translation on saved `大学本科生` as their level, which
the roster showed and the edit form (English values) then matched to
nothing and rendered EMPTY — and it did NOT need a re-registration: opening
Edit-details and pressing Save re-read every select, so ONE visit with
translation on rewrote a good English profile (proven by the SGP1 export,
which carries those same students in clean English at 05:34 on 2026-08-13).
Already-saved translated answers are REPAIRED by **`simulation/answers.js`**
— the single source of truth for all eight answer sets (the form builds every
dropdown from it and carries no hardcoded `<option>`; smoke fails the build on
drift) plus `canon(field,value)`: exact → case/space-folded → ASCII-skeleton
("18-24岁" → `18-24`) → a per-FIELD alias table (so "其他" resolves inside
Gender and inside Industry without colliding), and **'' rather than a guess**
for anything unrecognised, which is left as stored and asked again. It runs on
the student page at load (`healStoredAnswers`, the save mirrors it to the
roster + recovery docs) AND in the admin roster at idle (`healRosterAnswers`
→ `updateStudent`, admin-only per the rules, reporting "Repaired N
registrations"; an unmappable Level is flagged `⚠`). Offline tests
`node simulation/tools/answers-guard.mjs` +
`node simulation/tools/registration-guard.mjs` +
**`node simulation/tools/handoff-guard.mjs`** (the research-data guard: runs
each sim's OWN handoff mapper — id/label tables + validation rules sliced from
its source — over a canonical platform profile and demands FULL coverage of
every default registration field, in-list; also asserts a field a sim leaves
OPTIONAL, i.e. Gender, is compulsory on the platform, since the sims drop an
answer they cannot accept and show the field SILENTLY, which is how a blank
reaches the export);
LIVE in the admin panel — auto-loads and updates via
onSnapshot, no manual load) with CSV export, a per-row **Delete**
(confirm-guarded; removes the row's doc(s) incl. collapsed duplicate
re-registrations — for test registrations etc.; rules already allow
admin delete) and a per-row **Approve** toggle — plus the bulk
**✓ Approve all** / **Revoke all approvals** buttons beside Export CSV
(owner 2026-08: a whole class in one click — `wireBulkApproval` in
admin.js; each shows how many rows it would change, disables itself when
there is nothing to do, confirms first, writes ONLY the rows that change
— every uid behind a collapsed row, like the per-row toggle — and acts on
the rows CURRENTLY SHOWN, so the column filters double as a selector) and
a red **Delete all students** (the row Delete over the same shown-rows
scope, for clearing a class between terms; irreversible AND locking —
a browser whose high-water mark says it already synced does NOT re-create
its roster doc, and no roster doc means no cards — so it asks TWICE:
confirm + the word DELETE typed back) —
the play gate (per the
owner, against class links shared with out-of-class students): an
unapproved student sees NO simulation cards (approval overrides the
active toggles; `startApprovalWatch`/`apprBlocked` in index.html, live
own-doc onSnapshot unlock, waiting-note banner; LOCAL mode ungated)
**EXCEPT the ones they have already COMPLETED, which are always shown**:
logging out and back in mints a new anonymous account (approval never
rides through recovery), so a returning approved student would otherwise
lose sight of finished work until re-approved. It grants nothing — a
completed card cannot be launched (it opens the already-completed notice),
so approval still gates every actual play — and the waiting note shows
only while something is genuinely still locked (`pending > 0` in
`render()`), so a student who finished everything active is not told to
wait, and the "no simulations active" empty state cannot appear beside it. A
student can never self-approve (the rules pin `approved` to admin-only
writes — REPUBLISH firestore.rules when adopting), and Approve writes all
uids behind a roster row like Delete. The roster also tracks **who answered
which ACTIVE simulation** — one dynamic column per active sim (✓/—, tally
in the header, click the Approved/sim headers to cycle filters all→✓→—,
CSV carries `completed:<sim>` columns): the student page mirrors its
play-once markers onto the roster doc (`syncCompleted` in platform.js, at
load + on the completion storage event; `completed` is student-writable in
the rules — it grants nothing), and the roster's `completed` map flows BACK
DOWN via the own-doc watch (merge in `watchApproval`, forced re-render), so
a centrally stamped ✓ reaches the student's card live wherever they log in.
The admin's **"⟲ Verify from …" buttons — ONE PER ACTIVE SIMULATION THAT
KEEPS AN IDENTIFIABLE PARTICIPANT RECORD** (`renderVerifyButtons`/
`verifyFromSim` in admin/admin.js, rebuilt on every roster render so the row
follows the activation toggles exactly like the roster's columns) are the
ground-truth reconciliation for markers the client side missed. A simulation
opts in with a **`verify` block in `catalog.js`** (`adapter` name, its PUBLIC
Firebase web config — inline, or `configGlobal` for Answer Arena which
publishes `arena-config.js`, loaded on the admin page —, and an `idNote` for
the button tooltip) plus **one reader in `simulation/admin/verify.js`**
(`window.SIMP_VERIFY[adapter](ctx) → {records, doneById, doneByEmail}` — each
mark carries `{ts, session, id, email, dur}`, the record's own identities +
play duration); everything else —
the shared-locker sign-in into that project's own Firebase app
(`simFirestore`, named app `verify-<key>`), the roster join, the duplicate
detection, the guards, the
stamping and revoking — is GENERIC, so a fifth simulation is those two edits
and nothing more. Currently wired: **answerarena** (`participants.participantId`
+ sessions for id→code), **ideasearchlab** (`sessions/*/participants/*` of the
sessions this admin created — `platform.studentId` **or, for a student who
played from a DIRECT link rather than a platform launch (no handoff ever wrote
a platform block — sessions SGP2/SGP3/ATHENS, owner 2026-08), the student ID
they typed into that session's own registration form**, read from
`demographics` via the session's `registrationConfig` (the default form's
`ucdStudentId` field, or any admin-added field whose label names a
Student/Participant ID — the same label rule `simplatform.js` uses to FILL
such a field on a launch, so the two directions can't drift; a session with no
`registrationConfig` runs the default form, hence the `ucdStudentId`
fallback; the platform ID always wins when both exist; behaviour pinned by
`node simulation/tools/verify-adapter-guard.mjs`, a mocked-Firestore run of
the adapter itself). **The same pass also writes the ROSTER's real name and
e-mail back onto every matched Ideation Challenge record still carrying the
throwaway login's placeholders** ("Student" + `student-…@simplatform…`) —
owner 2026-08-16: a direct-link student registered on the platform, so their
identity is on the roster, but no launch handoff ever carried it into the
app. The adapter stays read-only and merely REPORTS the needy records
(`identityDocs`, every matched student, finished or not — a name is a name);
`verifyFromSim` in admin.js does the writing, fill-empty only (a real value
is never overwritten; a filled platform block is stamped
`source: 'simulation-platform-roster'`, a handoff's `simulation-platform`
never relabelled), because that pass is the one place holding both handles —
the roster and, via ctx, the app's own project signed in as its instructor.
The outcome line reports "filled the real name/e-mail of N …". The Ideation
Challenge's own admin pages also HEAL such
standalone participants' docs — `healParticipantIdentities` writes the real
name/e-mail/`platform.studentId` from the registration answers, fill-empty
only (see `_ideasearchlab-src/CLAUDE.md`) — but verification deliberately
does NOT wait on that heal, reading `demographics` directly. done =
`status:'done'` OR
**a stored survey** (`surveyCompletedAt`/`surveyAnswers` — the survey is the
last step, and `status` could be rewritten behind a finished participant; see
the phase-guard note in `_ideasearchlab-src/CLAUDE.md`) OR,
in a CLOSED session — which ends everyone on the same Done screen WITHOUT
setting their status, so counting only the survey would propose revoking that
whole class — **demonstrable participation: an idea they authored (the reason
a closed session's `ideas` collection is read, and only then) or a vote cast**.
Deliberately NOT `votesSubmitted`/`individualComplete` on their own, which is
what it used to accept: both phase timers auto-submit with NOTHING in them
(`autoFinish` submits zero ideas, `autoSubmitVotes` locks an empty ballot), so
a student who opened the page and idled was ticked here while the Ideation
Challenge's own admin showed no contribution from them — the platform's ✓ and
what that app shows must mean the same thing (owner 2026-08)),
**portfoliofit** (`participants.studentId`, `status:'done'`) and **search-v2**
(no participant docs at all: `events` filtered to `event=='session_end'`,
identity `pid` = the student ID the platform sends as `PROLIFIC_PID`, plus a
`limit(1)` probe so "the read came back empty" is distinguishable from
"nobody has finished yet"). Deliberately NOT verifiable (no button, nothing to
reconcile against): **problem-solving** (Google Sheet, no identity), **ssc**
(firm decisions, no student ID), **newsvendor** (cross-origin project),
**jagged** (collects nothing). Each run reads a FRESH roster (never the
snapshot cache) and joins the simulation's records to EVERY registered
student **by university student ID AND/OR e-mail**
(`SIMP_MATCH.joinRecords` in `simulation/admin/match.js` — owner 2026-08-16,
the Qiu Taoyi case: the ID is typed into two different forms, so the ID-only
join lost the match for good on one typo while the simulation's own admin
showed the play; now the record's e-mail rescues it — the synthetic
`@simplatform` throwaway addresses never count as an identity, in match.js
AND verify.js's private copy of the rule, parity-pinned by the guard), and
`stampCompleted`s
(admin write) every match. **The same pass runs UNATTENDED once per admin
panel open** (`maybeAutoVerify`, after the roster and activation config have
both arrived, at idle, sims sequentially): the SAFE half only — stamps +
identity fills — with the locker's saved credentials and NEVER a prompt
(`sharedCreds(title, {auto:true})` declines instead; with no locker the note
says how to enable it); proposed removals are only counted in the note, it
never RE-STAMPS a ✓ the instructor removed unless the play on record
post-dates the removal's `rts` (a genuine retake — pressing the button IS
the explicit re-sync instruction), and one verification runs at a time
(`verifyBusy`; the buttons render disabled while the chain runs), so the
buttons remain for the extreme cases. **Duplicate registrations are
raised in a pop-up (`showDuplicatesDialog`), never removed automatically**:
one person behind two roster rows — the same e-mail under two student IDs
(the roster only collapses same-ID duplicates) or one simulation record
whose ID matches one row and whose e-mail another (`join.links`) — is
clustered (`findDuplicateClusters`) and listed with a per-entry removal
SUGGESTION (pre-ticked, admin can untick): a profile that only registered
while its duplicate carries the play data, or a **super-fast play**
(< `FAST_PLAY_MS` 5 min, from each adapter's `dur`) made before
re-registering to play properly — when the record's own ID pins the play to
a profile (`attributed`) that fast-play profile is proposed for removal and
the fresh registration kept; matched by e-mail alone the play cannot be
pinned to either profile, so the NEWEST registration (the one in use) is
kept instead. Several proper plays are ambiguous
and get NO suggestion; two clustered rows whose names share NO token
(siblings on a family mailbox) drop every pre-tick and carry a caution
(`nameTokens`); a suggestion never covers a whole cluster; the
dialog refuses to delete every registration of one student in one click,
QUEUES behind an open dialog (`dupeQueue`) instead of replacing it,
and deletion is the row-Delete's own admin delete. A ✓ on a clustered row
is also never proposed for revocation (`inDupCluster` — the person may be
listed under the duplicate; the pop-up owns it), and a mass removal is
refused when the read carries no student IDs at all (`idJoinDegraded`)
beside the existing unmatched-IDs guard. TWO-WAY as before, it
**revokes** a ✓ whose student is
no longer a completed participant THERE (deleted so they may retake
it; arena's `deleteParticipant` hard-deletes the doc + its subcollections,
so they simply vanish — and the arena's participant list is GROUPED BY
STUDENT, so Delete removes EVERY account a student registered under, not
just the card clicked: a duplicate registration is a second anonymous uid
= a second participant doc, and deleting one used to leave the other's
answers in the Excel export; both arena exports also re-read participants
at export time). A revocation is a TOMBSTONE inside the
already-allowed `completed` map (`{revoked:1,rts}` — no rules republish),
written to the roster doc AND the e-mail recovery replica (else logging in
elsewhere resurrects it); the student's browser stamps `seenAt` from its
OWN clock on first sight and compares markers against that, so instructor/
student clock skew can neither defeat a revocation nor destroy a retake
(a retake's newer marker survives). Every writer replaces its entry via a
dotted path and records `src` (`verify`/`manual`/`client`, plus the legacy
`arena` from when Answer Arena was the only verifiable one) — a deep merge
would fuse a marker into a tombstone and the row would read revoked
forever. Guards: never auto-revoke a `manual` mark; refuse when the
simulation returns no participant records (`records === 0`, the adapters'
contract — indistinguishable from a wrong project/permissions, and treating
it as "nobody completed anything" would revoke the whole class) or no
completed participants; refuse a mass removal while student-ID joins are
failing; always confirm, listing names; `allSettled` so one failed write
can't hide the rest; an inactive simulation has no button at all (its column
would be invisible) and `verifyFromSim` re-checks that anyway.
The student page pushes local markers only AFTER its first roster snapshot
(pushing at load raced a fresh revocation).
Each run's outcome (stamped count — incl. how many matched by e-mail where
the ID differed — + IDs unmatched by either key) prints in the shared
`#verify-note` beside the buttons. Offline drift
guard: `node simulation/tools/verify-guard.mjs` (catalog ↔ adapter pairing
both ways, a real web config per verifiable sim, the copied configs still
matching the apps' own files, and the four no-identity sims still declaring
no `verify` block); `node simulation/tools/match-guard.mjs` pins the
ID-and/or-e-mail join, the duplicate clustering + suggestion rules, the
e-mail-rule parity between match.js and verify.js, and that auto-verify
never prompts and never revokes. For those stragglers
the roster's ✓/— cells are CLICKABLE (confirm-guarded manual override —
stamp or `unstampCompleted` via deleteField; flows to the student live).
The admin panel also AUTO-BACKFILLS the e-mail recovery docs once per
open (`backfillRecovery`, `#backfill-note`): students who registered
before the recovery feature existed have no recovery doc and could not
log back in by e-mail until the backfill (student browsers also
self-mirror via the separate `simp:recovery-synced:v1` high-water mark
in syncProfile). **Pinned Session IDs are never
shown to students**: a pinned code launches the card DIRECTLY ("Session
ready" badge, no dialog — openModal's pinned branch), and the same-origin
sims hide their own code fields when the code came from the handoff
(portfoliofit + arena welcome `hiddenCode`, revealed again on a failing
code so nobody dead-ends; ideasearchlab's JoinSession silently
auto-joins), leaving the dialog only for unpinned codes and the
cross-origin newsvendor's copy chips. Students **log out** from the header (clears the
browser AND signs out the anonymous uid, so on a shared machine the next
registration gets its own roster doc instead of overwriting) — with **no
confirmation dialog** (per the owner): it only forgets the details in THIS
browser, the class registration is kept and they can log back in with their
student ID + e-mail, so the prompt was pure friction on the shared machine the
feature exists for; the roster view
collapses duplicate re-registrations by student ID, newest kept, and the
admin panel has its own Sign out. **The account corner (top right of the header)** holds EITHER the
signed-out **Log in** / **Register** pills (`#hero-auth`/`setHeroAuth`,
shown on every entry screen) OR — once signed in — the student's **name
chip** ALONE (`#who-chip`; the pills never sit beside it), whose click
opens the account menu (`#who-menu`: "Signed in as …", **Edit details**,
**Log out**; closes on outside-click/Escape). **Returning students** (same
corner;
`showSims` calls `hideAll()` so the login card cannot linger behind the
cards): same browser =
auto-signed-in (localStorage + persisted anon auth); a NEW device/cleared
browser presses **Log in** and gives the university student ID + e-mail —
BOTH must match (`recoverByEmail(email, studentId)`) — restoring the
registration from
`simPlatformRecovery/{sha256(email)}` (mirrored on every profile sync +
completion sync; get-by-exact-key only, list denied, `approved` NOT in the
field set so approval never rides through recovery — the instructor
re-approves with one live click; completion markers restore too so a
device switch earns no replay; `recoverByEmail`/`saveRecovery`/`emailKeyOf`
in platform.js, the "Already registered before?" box in index.html;
SIMP_PATHS defaults are MERGED under overrides so an older
firebase-config.js can never leave a new path undefined).
**A student can back SEVERAL roster docs, and the ✓ is read MERGED across
them (`simulation/completions.js`)** — every registration mints a fresh
anonymous uid, so a log-out + re-register, or a second device, gives the
same student another `simPlatformStudents/{uid}` doc. Admin writes fan out
to every uid behind the collapsed row, but the STUDENT's own push
(`syncCompleted`) only reaches the doc they are signed into — and `logout()`
clears the local markers — so the NEWEST doc, the one the row is built from,
can be missing a ✓ that a duplicate carries. That is the
"done in PortfolioFit's own admin, — on the platform" report (2026-08-14):
the cell read one doc while `verifyFromSim` asked a DIFFERENT question
("does ANY doc have it?"), so it counted the student as `already` matched,
wrote nothing, and reported success while the cell stayed —. `completions.js`
(`studentKey`/`rowKey`/`docNewer`/`groupByStudent`/`mergeCompleted`/`isDone`,
loaded by the admin page before admin.js) is now the ONE reading both halves
use: group newest-first, merge per simulation key, the NEWEST statement
winning — so a tombstone on the current doc still hides an older mark (the
instructor removed the ✓ on purpose) and a retake after it counts again.
Two companion fixes: `stampCompleted` now also writes the e-mail RECOVERY
replica (as `revokeCompletion` always did — else a verified ✓ vanished the
moment the student logged in elsewhere, since the new device's doc becomes
the newest with nothing to restore onto it), and it takes `{uid,email}` rows
like revoke; and the failing-join guard now refuses only the REMOVALS
instead of aborting the pass, which used to discard the safe additive
stamps — the very thing the button was pressed for. Offline test:
`node simulation/tools/completion-guard.mjs`. A card with nothing to ask (no session
input, no copy chips) launches its sim DIRECTLY in a new tab — and NEVER pass
'noopener' as window.open features: its by-spec null return reads as a
blocked pop-up and made the fallback also navigate the platform tab (the
double-open bug). At launch the
platform writes the same-origin **handoff** `localStorage 'simp:handoff:v1'`
`{sim, session, profile, ts}`; `simulation/prefill.js` is the optional
one-line drop-in a sim can include to auto-fill its own registration form
from it. Portfoliofit's and answerarena's registration/intake pages go
further — SILENT registration (simpHandoff/simpRegAnswers in
experiment.js / arena-app.js): fields the platform covers are answered and
NOT rendered, the page auto-submits when nothing is left, and only
uncovered fields are shown. Consent checkboxes are BYPASSED on a platform
launch in all three (per the owner): portfoliofit, answerarena and
ideasearchlab CARRY them as ticked, stamping
`consentVia: 'simulation-platform'` on the participant doc so the data
shows how consent was given; ideasearchlab silent-registers natively (see
its account-free flow above), and standalone visitors still tick the boxes
themselves.
The generic prefill.js drop-in also stays on those pages and ssc (each
with a `SIMP_EXPECT` guard, disabled on admin views) for any form that
still renders (explicit `data-simp` attrs first, then label-text matching with the
native-setter+input-event React trick; inert without a fresh handoff — so
adding it never changes standalone behaviour). **Play-once gate:** on a
platform launch prefill.js also defines `window.simpMarkCompleted()`, which
each sim's own thank-you/done screen calls (ideasearchlab's `Done()` —
preview-guarded, portfoliofit's `showThankYou`, arena's `showThankYou` +
`showAlreadyDone`, problem-solving's `handleSubmitRule`, search-v2's
`finish`) to record `simp:completed:v1` `{simKey:{ts,session}}`; the
student page badges that card "✓ Completed" (live via the storage event)
and clicking it shows an already-completed notice instead of launching —
a NEW pinned Session ID unlocks the card (fresh run ≠ replay), and Log out
clears the markers. Deliberately NOT gated: ssc (rejoining your firm
mid-game is the normal flow), newsvendor (cross-origin) and jagged
(free-play). The smoke test drives the real cross-tab path and a
marker-drift preflight fails it if an instrumented sim (or the shipped
ideasearchlab bundle) loses its simpMarkCompleted call. The admin panel also embeds
each sim's own admin console (same-origin iframes, picker ordered
active-first on the SAVED config — `buildConsoleOptions`, refreshed on
save/config change; pinned Session IDs are UPPERCASED at save since every
sim mints uppercase codes, and pf's welcome normalizes typed/handoff codes
the same way) for creating sessions
with parameters there, plus an optional shared-credential locker
(`'simp:admin-creds'`, sessionStorage by default) whose `simpTrySso()` SSO
snippet is WIRED into the sustainable-supply-chains, search-v2, portfoliofit
and answerarena admin pages (one silent sign-in attempt when no user is
signed in; inert without saved credentials, so standalone behaviour is
unchanged — ideasearchlab would need a Vite rebuild to join) — each sim
authenticates against its OWN Firebase project, so a shared login means
registering the same e-mail/password in every project. **Keep `catalog.js`
in sync with the served class sims** (add/retire entries deliberately — it is
a curated subset of `/lab/`, not a mirror). Currently UNLISTED: `noindex` on both
pages, no homepage link — flip deliberately at launch. **The admin page is the
one page that uses the WINDOW width** (`.wrap.wide`, 1680px cap, vs the student
page's 1060px reading column): the roster is the widest thing on the site — name,
student ID, e-mail, level, registered, approved, ONE COLUMN PER ACTIVE
SIMULATION, then the per-row **Delete** — and at 1060px that last cell sat
outside `.roster-wrap` inside its horizontal scroll, so an instructor who did not
know to scroll sideways could not reach it (owner report 2026-08). Long unbroken
cell values wrap too (`table.simtab td { overflow-wrap: anywhere }` — an e-mail
address has no spaces, so it otherwise sets the table's minimum width), with the
actions column exempted so its button stays on one line. Offline tests that must
stay green: `node simulation/tools/smoke.mjs` (Playwright over a local static
server, LOCAL mode forced — registration → admin activation → cards → launch
handoff/seeds → prefill), `node simulation/tools/completion-guard.mjs`
(the merged completion reading — the roster cell and the reconciliation must
answer the same question), `node simulation/tools/match-guard.mjs`
(the ID-and/or-e-mail join, duplicate clustering + removal suggestions, and
the auto-verify wiring) and `node simulation/tools/roster-width-guard.mjs`
(the Delete button unclipped at six window widths × simulation counts). That
second guard measures containment inside `.roster-wrap` plus `elementFromPoint`,
NOT viewport coordinates: a button clipped inside a scrolling ancestor still
reports a rect on screen, so a viewport-only check passes while the bug is
present. Details in `simulation/README.md`.
