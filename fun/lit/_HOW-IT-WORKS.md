# fun/lit — how it works ("The Lit": the multi-journal research paper browser)

`stouras.com/fun/lit/` extends the Google-free architecture of
`stouras.com/fun/ms/` from one journal to **eight sources**:

| key    | source                                              | where the data comes from |
|--------|-----------------------------------------------------|---------------------------|
| `ms`   | Management Science (INFORMS)                        | Crossref, ISSN 0025-1909 — **with editors/areas**, exactly like `/fun/ms/` |
| `opre` | Operations Research (INFORMS)                       | Crossref, ISSN 0030-364X |
| `mksc` | Marketing Science (INFORMS)                         | Crossref, ISSN 0732-2399 |
| `msom` | Manufacturing & Service Operations Mgmt (INFORMS)   | Crossref, ISSN 1523-4614 |
| `isre` | Information Systems Research (INFORMS)              | Crossref, ISSN 1047-7047 |
| `pom`  | Production and Operations Management (Wiley→SAGE)   | Crossref, ISSN 1059-1478 |
| `pnas` | PNAS — five sections only (Computer Sciences, Sustainability Science, Environmental Sciences, Social Sciences, Economic Sciences) | Crossref (metadata) + pnas.org's own topic index (section labels; see below) |
| `ec`   | ACM EC conference, 1999–present                     | 1999–2019 (the "Electronic Commerce" era; renamed 2014, no conference in 2002): DBLP per-year tables of contents. 2020+: Crossref (published proceedings) + `ec<YY>.sigecom.org/program/accepted-papers/` (accepted lists). PDF links & abstracts for all years via OpenAlex/DBLP/Semantic Scholar |

> The underscore in this filename (and in `_scraper/`) tells GitHub Pages'
> Jekyll build **not** to publish them. The `data/` folder has no underscore,
> so it *is* served — that's the point.

## The one-paragraph version

There is no server and no database. A scheduled **GitHub Action**
(`.github/workflows/lit-update-data.yml`, daily at 05:30 UTC + on demand)
runs `_scraper/build-data.mjs`, which downloads every article from the public
APIs above, writes one static JSON file per source into `fun/lit/data/`
(`papers-ms.json`, `papers-opre.json`, …, listed in `sources.json`), plus
shared `authors.json` / `affiliations.json` / `recent.json` / `meta.json`,
and commits whatever changed. The page (`index.html`) `fetch()`es those files
lazily — a source downloads the first time a filter needs it, rendering
progressively — and does every filter, search and BibTeX export in the
browser.

## How the page behaves (by design)

- **Journals filter** (new vs. `/fun/ms/`): a multi-select of the six
  journals, the five PNAS sections (a PNAS paper can belong to several), and
  ACM EC — plus, appended alphabetically, every FT50 journal the page merges
  in from its own FT50 dataset in `data-ft50/` (see the "Journal types & the
  FT50 merge" note below). Nothing selected = search everything.
- **Journal types filter** (left of Journals): four fixed options — **UTD24**
  (the UT Dallas Top-100 rankings' 24 journals), **FT50** (all 50 journals of
  the Financial Times research rank), **ABS 4/4\*** and **ABS 3** (Chartered
  ABS Academic Journal Guide, AJG 2024, as mirrored at journalranking.org). A
  type chip expands to its whole journal set and **unions** with any
  individually selected journals (it broadens, never narrows). The UTD24 key
  set is static (the list is fixed); the FT50 key set is seeded statically
  and extended from the `data-ft50/sources.json` manifest at runtime —
  skipping entries flagged `notFT` (journals carried for another list, not
  the FT's: UTD24's INFORMS Journal on Computing `ijoc`, ABS 4's European
  Journal of Operational Research `ejor`) — so the yearly FT-list check
  (below) flows through; ABS grades live in the `ABS_RATING` map in
  `index.html` (PNAS and ACM EC are not in the AJG; HBR / MIT SMR — the
  AJG 2024 "top practitioner" journals — are kept at 3, their last numeric
  grade, so ABS 3 finds them, alongside IJOC).
- **Journal-type badge on every card.** A small badge left of each paper's
  title shows the single MOST selective list its journal belongs to
  (UTD24 > FT50 > ABS 4/4* > ABS 3, the JOURNAL_TYPES order): a UTD24
  journal's paper is badged `UTD24` only — never additionally FT50 or
  ABS 4/4*. Display only: an ABS 4/4* *search* still returns every UTD24
  journal's papers (each shown with its UTD24 badge). Clicking a badge
  selects that journal type; PNAS and ACM EC papers carry no badge.
- **Everything is lazy — first paint is a few hundred KB.** No papers file
  downloads until a filter needs it: the landing screen renders from the
  manifests + the small `recent.json`, so the page is fast on any connection
  (it used to eager-fetch ~60 MB of native JSON on every visit). Each native
  `data/papers-<src>.json` and each catalog `data-ft50/papers-<key>.json`
  is fetched only when its journal enters the view's scope — selected
  directly (a PNAS section loads the parent `pnas` file), via a type chip, or
  on a broad search with no journal scope, which streams everything;
  `authors.json` is fetched on the first Authors-tab open. The results bar
  counts the files still on their way; loaded journals stay in memory for
  the session. **Satellite data shards:** the catalog can outgrow this
  repo's 1 GB Pages limit — the page also merges the manifests of the shard
  repos listed in `SHARDS` (`lit-data-abs4`, `lit-data-abs3-omecon`,
  `lit-data-abs3-rest`; each a sibling repo with its own Pages site,
  pipeline and curated journal list, served same-origin under
  `stouras.com/<repo>/data/`). A shard's `sources.json` carries each
  journal's ABS grade (`abs` field), which flows into the ABS 4/4* / ABS 3
  buckets and badges via `MANIFEST_ABS` — adding a journal to a shard needs
  no edit to this page. Absent or not-yet-built shards 404 and are skipped. The MS/ISR-specific
  editor filters and the pre-print toggle can't match FT50-extra papers, so
  those alone never trigger the download; the recent view merges the
  `data-ft50/recent.json` (extras only — natives are already covered).
  `data-ft50/` is **this app's own copy** of the FT50 dataset: it was seeded
  by copying the retired fun/ft50 app's data (registry included, so "recently
  added" history carried over) and is maintained by `_scraper-ft50/` — that
  app's pipeline, vendored here — via its own daily workflow
  (`.github/workflows/lit-ft50-update-data.yml`, 07:15 UTC) and its own
  yearly FT-list check (`lit-ft50-check-list.yml`, 4 Jan). The old
  `/fun/ft50/` URL is now a redirect stub to this page.
- **Editors & Areas are Management Science only.** When MS is explicitly
  selected in the journal filter (alone or with other journals) the page
  behaves exactly like `/fun/ms/` — Accepting Editor / Area filters,
  Editors/Areas summary tabs, editor & area tags on cards. On the default
  all-journals landing (and for e.g. an MSOM-only search) those controls stay
  hidden. Other journals contribute plain records; the "Articles in Advance"
  status appears only for the six journals that publish such a stage (never
  for PNAS or ACM EC).
- **Senior/Associate Editors for ISR & Marketing Science.** Selecting
  *Information Systems Research* reveals Senior Editor and Associate Editor
  filters (Marketing Science: Senior Editor only), and ISR/MkSc cards carry
  clickable `SE:` / `AE:` tags — click one to see every other paper that
  editor handled. Names come from each article's "History:" line
  ("Dr. Ram D. Gopal, Senior Editor; Dr. Hong Xu, Associate Editor" /
  "Puneet Manchanda served as the senior editor"): parsed from the Crossref
  abstract when deposited there, otherwise from the committed cache
  `data/_informs-editors.json` built by `_scraper/informs-editors-local.mjs`
  (see the "local scripts" note below — pubsonline.informs.org blocks cloud
  IPs the same way pnas.org does).
- **ACM EC papers** carry a green **PDF ↗** tag when an arXiv / SSRN /
  open-access copy was found. Papers on a `sigecom.org` accepted-papers list
  that are not yet in the ACM Digital Library appear as *"Accepted (EC 'YY)"*
  and upgrade automatically (DOI, pages, PDF) once ACM registers them.
- BibTeX is journal-aware: `@article` with the right journal/publisher,
  `@inproceedings` for published EC papers, `@unpublished` for accepted ones.

## The pieces

```
fun/lit/
├─ index.html                ← the page (adapted from /fun/ms/)
├─ data/                     ← the "database": static JSON, served to visitors
│  ├─ sources.json           ← manifest: keys, files, counts per source
│  ├─ papers-<src>.json      ← one file per source (8 files)
│  ├─ authors.json           ← per-author aggregates (authors with ≥2 papers)
│  ├─ affiliations.json      ← per-affiliation aggregates
│  ├─ recent.json            ← papers first seen in the last few weeks
│  ├─ meta.json              ← { lastPull, paperCount, perSource }
│  ├─ _registry.json         ← bookkeeping: which paper was first seen when
│  ├─ _pnas-concepts.json    ← DOI → PNAS section keys (see PNAS note below)
│  ├─ _informs-editors.json  ← DOI → ISR/MkSc Senior/Associate Editor names
│  └─ _ec-extras.json        ← cached PDF/abstract lookups for EC papers
├─ _scraper/
│  ├─ build-data.mjs         ← the program that builds everything in data/
│  ├─ ec-pages.mjs           ← parsers for the 7 sigecom accepted-papers formats
│  ├─ pnas-crawl.mjs         ← the PNAS section crawler (shared module)
│  ├─ informs-editors.mjs    ← the History-line Senior/Associate Editor parser
│  ├─ pnas-concepts-local.mjs    ← ★ run LOCALLY to (re)build the PNAS index
│  ├─ informs-editors-local.mjs  ← ★ run LOCALLY to (re)build ISR/MkSc editors
│  └─ mock/                  ← tiny real-payload fixtures for offline testing
├─ data-ft50/                ← lit's OWN FT50 dataset (papers-<key>.json × 50,
│                              sources.json, authors/affiliations/recent/meta,
│                              _registry.json) — seeded from the retired
│                              fun/ft50 app's data, then maintained here
├─ _scraper-ft50/            ← the FT50 pipeline (vendored from the retired
│                              fun/ft50 app):
│  ├─ build-data.mjs         ← builds everything in data-ft50/
│  ├─ check-ft50-list.mjs    ← yearly FT50 list check (updates journals.json)
│  ├─ journals.json          ← the FT50 journal list this app follows
│  ├─ informs-editors.mjs    ← History-line editor parser (copy)
│  └─ mock/                  ← offline fixtures (FT50_MOCK=1 smoke test)
└─ _HOW-IT-WORKS.md          ← this file

.github/workflows/lit-update-data.yml       ← runs the native scraper daily
.github/workflows/lit-ft50-update-data.yml  ← runs the FT50 pipeline daily
.github/workflows/lit-ft50-check-list.yml   ← yearly FT50 list check
```

## The PNAS wrinkle (one manual step, occasionally)

PNAS's section labels ("Computer Sciences", "Economic Sciences", …) exist
only on pnas.org, whose search pages sit behind a **Cloudflare challenge
that blocks cloud IPs** — GitHub Actions runners included (verified). So the
DOI→section index lives in the committed file `data/_pnas-concepts.json`,
built by running **on your own machine**:

```bash
cd fun/lit/_scraper
node pnas-concepts-local.mjs          # first run: full crawl (~15–30 min)
# …then commit & push fun/lit/data/_pnas-concepts.json
```

If the plain script is blocked by Cloudflare even with the `LIT_CF_COOKIE`
fallback (strict mode also fingerprints the HTTP client), use the variant
that drives your real Chrome/Edge — it cannot be told apart from you
browsing:

```bash
npm install --no-save playwright-core   # once
node pnas-concepts-browser-local.mjs    # a browser window opens and crawls
```

And if even that is challenged (Cloudflare also detects automated browsers),
the guaranteed path is `_scraper/pnas-concepts-console.js`: paste its whole
contents into DevTools → Console on any www.pnas.org tab — it crawls inside
your normal browsing session and downloads a ready `_pnas-concepts.json` to
drop into `fun/lit/data/` and push.

Later runs are incremental (about a minute); re-run it every month or so to
pick up newly published PNAS papers. Everything else — including joining that
index with fresh Crossref metadata — happens automatically in the daily
Action. (Each daily build also *tries* the crawl itself and will take over
automatically if Cloudflare ever stops challenging the runner. If your own
connection is challenged too, the script explains the `LIT_CF_COOKIE`
cookie fallback.)

**Approximation fallback (automatic):** for PNAS papers the official index
does not cover — including the whole journal before the local crawl ever
runs — the build classifies papers into the five sections from their
**OpenAlex primary topic** (the paper's actual main subject): its
field/subfield → section via `classifyOneTopic` / `classifyOpenAlexWork`,
cached in `data/_pnas-approx.json`. It is deliberately **primary-topic only**.
An earlier version also counted strong secondary topics to widen recall, but
OpenAlex's field taxonomy doesn't line up with PNAS's editorial sections, so a
tangential co-topic mislabelled clearly off-section papers (an antibody-
delivery study or lunar-sample geochemistry as *Environmental Sciences*,
molecular biology as *Computer Sciences*). For a curated browser precision
beats recall, and the accurate way to recover genuine cross-field papers is
the official pnas.org index below, not stretching OpenAlex topics. The field
map is additive and conservative (only fields that map cleanly onto the five
sections). The cache carries a `version` (`PNAS_APPROX_VERSION`); **bump it
whenever the field-map rules change** and the next run re-classifies the
*whole* corpus (a one-off full backfill) instead of only recent publications,
so a rule change applies retroactively to old papers. This is a *content-based
approximation*, not PNAS's editorial assignment, so the paper sets differ at
the margins; an official label from the local crawl always wins per-DOI. The
build log prints how many papers used each source.

## The ISR/Marketing Science editors wrinkle (same idea)

Senior/Associate Editor names live in each article's "History:" line on
pubsonline.informs.org, which Crossref mostly does not carry and which — like
pnas.org — blocks cloud IPs. So the DOI→editors index lives in the committed
file `data/_informs-editors.json`, built by running **on your own machine**:

```bash
cd fun/lit/_scraper
node informs-editors-local.mjs            # resume-safe; ~4,000 pages ≈ 2h total
node informs-editors-local.mjs --max 500  # …or bound one sitting (~15 min)
# …then commit & push fun/lit/data/_informs-editors.json
```

Run it after the first data build (it reads the papers-isre/mksc DOI lists).
It processes newest papers first and resumes across sittings, so partial runs
are useful immediately. Editors found in Crossref abstracts are picked up by
the daily Action with no local run needed.

## Articles in Advance (forthcoming papers)

A record with **no volume and no issue** is a forthcoming ("Articles in
Advance" / OnlineFirst) paper — but only if it is **recent**. `forthcomingStatus()`
in `build-data.mjs` requires the year to be within the last few years of the
pull; an older no-volume/no-issue record is a published paper whose Crossref
entry was simply frozen at the advance stage, so it is shown as published, not
mislabeled forthcoming. (Before this guard, ~hundreds of years-old papers across
the INFORMS journals wrongly wore the "Articles in Advance" badge.)

Two committed files patch the gaps Crossref leaves:

- **`data/_aia-fixups.json`** — `{ "<doi>": { volume, issue, page?, year? } }`.
  The real issue for older records Crossref never updated (e.g. 47 Management
  Science papers stuck at the advance stage). The build fills these in **only
  when Crossref itself still returns no volume/issue**, so they read as published.
- **`data/_informs-aia.json`** — `{ "<doi>": { jkey, Title, Authors?, … } }`.
  Forthcoming papers INFORMS lists on its advance pages
  (`pubsonline.informs.org/toc/<code>/0/0`) that **Crossref has not indexed
  yet**. `mergeSupplement()` adds any DOI Crossref didn't return, into its named
  source; each shows up in the paper list *and* the "Recently added papers" view,
  and is silently superseded once Crossref catches up.

Both files are refreshed by running **on your own machine** (pubsonline blocks
cloud IPs, like the editors index above):

```bash
cd fun/lit/_scraper
node informs-aia-local.mjs                 # fun/lit — all INFORMS journals
node informs-aia-local.mjs --app ms        # fun/ms
node informs-aia-local.mjs --app lit-ft50  # fun/lit/data-ft50 (the FT50 catalog)
# …then commit & push the two files it writes into that app's data/ dir
```

It reads each `toc/<code>/0/0` page for forthcoming DOIs, fetches each article's
`citation_*` metadata (title/authors, or volume/issue if it turns out to be
published), and is resume-safe via `data/_aia-cache.json`. Nothing here runs in
CI; the daily Action just folds the committed files in.

## ACM EC: how accepted papers get their PDFs

1. Published proceedings (2020→) come from Crossref with exact container
   titles ("Proceedings of the 21st…27th ACM Conference on Economics and
   Computation") — DOIs, authors, pages.
2. Each year's `ec<YY>.sigecom.org/program/accepted-papers/` page is parsed
   (every year uses a different format; `ec-pages.mjs` handles all seven and
   falls back to trying every known format for future years). Entries not in
   Crossref yet — typically the current year — are added as
   *Accepted (EC 'YY)* with authors/affiliations from the page.
3. PDF links and missing abstracts are found via **OpenAlex** (batched DOI
   lookups; also supplies abstracts ACM doesn't give Crossref), **DBLP**
   (per-year tables of contents; arXiv links), and **Semantic Scholar**
   (title match; capped per run and cached in `_ec-extras.json`, so coverage
   grows across daily runs without hitting rate limits). Preference order for
   the link: arXiv → SSRN → any other open-access copy.

## Updating the data

- **Automatic:** daily at 05:30 UTC.
- **On demand:** GitHub → Actions → *lit — update multi-journal data* → Run
  workflow.
- **PNAS sections:** the one local script above, occasionally.
- **Change what's collected:** edit `_scraper/build-data.mjs` (journal list
  is the `JOURNALS` array at the top; PNAS sections in `pnas-crawl.mjs`),
  commit — the push itself triggers a rebuild.
- **The merged FT50 journals update on their own, lit-owned pipeline** — the
  *lit — update FT50 (merged catalog) data* workflow (07:15 UTC daily) runs
  `_scraper-ft50/build-data.mjs` and commits into `fun/lit/data-ft50/`. The
  header's "Last publication data pull" shows the **latest** of the two
  datasets' pulls. When the yearly FT-list check
  (*lit — yearly FT50 list check*, 4 Jan, `_scraper-ft50/check-ft50-list.mjs`)
  adds or removes a journal, it updates `_scraper-ft50/journals.json`,
  dispatches the data build, and the journal filter and FT50 chip follow the
  manifest automatically; only a **new** journal's ABS grade must be added to
  `ABS_RATING` in `index.html` (the list-change issue includes a reminder).
- **FT50 Articles-in-Advance fixups:** run
  `node informs-aia-local.mjs --app lit-ft50` locally (same pattern as
  `--app ms|lit|ft50`) to refresh `data-ft50/_aia-fixups.json` and
  `data-ft50/_informs-aia.json` for the INFORMS journals in this dataset.

## Testing locally (no network needed)

```bash
cd fun/lit/_scraper
LIT_MOCK=1 node build-data.mjs     # builds data/*.json from mock/ fixtures
cd ../_scraper-ft50
FT50_MOCK=1 node build-data.mjs    # smoke-tests the FT50 pipeline into _mock-out/
# then serve the repo with any static server and open fun/lit/
```

## Honest limitations

- **PNAS sections need the occasional local crawl** (see above); newly
  published PNAS papers appear in the dataset only after the index is
  refreshed.
- **Editors/areas exist for Management Science 2011+ only** — same limitation
  (and same editor-overrides import) as `/fun/ms/`.
- **EC PDF coverage is best-effort**: papers with no arXiv/SSRN/OA copy get no
  PDF tag (their DOI still links to the ACM DL, which is open access for EC).
- **Author/affiliation identity merging is automatic** (ORCID + name-based),
  so a person may occasionally appear under two spellings; `authors.json`
  keeps authors with ≥2 papers to stay a sane size.
- **The pre-computed Authors / Affiliations panels cover the eight native
  sources only** — they come from this app's `authors.json` /
  `affiliations.json`, which the FT50 merge does not touch. Searching or
  filtering papers by author/affiliation works for the merged FT50 journals
  (it reads each paper's own fields); only the aggregate panels are
  native-only. FT50-extra papers also carry no `Preprint` links yet (that
  backfill runs in this app's pipeline, not ft50's).
