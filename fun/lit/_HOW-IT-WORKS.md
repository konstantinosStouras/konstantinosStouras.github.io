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
— all sources in parallel, rendering progressively — and does every filter,
search and BibTeX export in the browser.

## How the page behaves (by design)

- **Journals filter** (new vs. `/fun/ms/`): a multi-select of the six
  journals, the five PNAS sections (a PNAS paper can belong to several), and
  ACM EC. Nothing selected = search everything.
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
└─ _HOW-IT-WORKS.md          ← this file

.github/workflows/lit-update-data.yml   ← runs the scraper on a schedule
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
**OpenAlex primary topic** (field/subfield → section mapping in
`classifyOpenAlexTopic`, cached in `data/_pnas-approx.json`; first run does a
full backfill, later runs only re-check recent publications). This is a
*content-based approximation*, not PNAS's editorial assignment, so the paper
sets differ at the margins; an official label from the local crawl always
wins per-DOI. The build log prints how many papers used each source.

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

## Testing locally (no network needed)

```bash
cd fun/lit/_scraper
LIT_MOCK=1 node build-data.mjs     # builds data/*.json from mock/ fixtures
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
