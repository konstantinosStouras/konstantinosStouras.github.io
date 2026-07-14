# `/lit` range-served SQLite search

**Status: capability implemented (opt-in `?db=1`); the database is deliberately
NOT committed to this repo.**

`/lit` *can* answer native-journal-scoped filters as **indexed SQL queries
against a single `lit.db` fetched over HTTP Range requests**, instead of
downloading whole `papers-<key>.json` files and filtering them in JavaScript.
It stays 100% static — the DB and WASM SQLite are just files on GitHub Pages,
and the browser fetches only the handful of DB pages a query touches.

**Why the DB isn't committed:** the built DB (~200 MB across chunks) is a
range-served *copy* of data already in `data/papers-<key>.json` (~51 MB) — pure
redundancy that inflates the repo and the deployed Pages site. So `data/db/` is
not stored here. `?db=1` therefore **falls back to the normal JSON path** (a
missing `data/db/lit-db.json` 404s and `initLitDb()` catches it), so the site is
100% functional either way. To *activate* db-mode, generate the DB and serve it
(see Reproduce), ideally from a **dedicated data repo** rather than this one so
the redundant binary never lives in the main site's history.

Add `?db=1` to the URL to turn it on **once a DB is served**. It is **strictly
additive**: the normal JSON path is byte-for-byte unchanged, and any query the
DB can't fully answer falls through to it transparently (see "What db-mode
covers" below).

## How it works

- **`_scraper/emit-db.mjs`** builds `lit.db` from the same `papers-<key>.json`
  files the scraper already writes:
  - a **narrow `papers`** table (no abstract) so facet/sort/row-probe pages stay
    small; abstract/significance text lives in a side table **`papers_abs`**;
  - **`papers_tri`**, a contentless **FTS5 trigram** index over
    title/authors/affiliations/abstract — a column-filtered trigram `MATCH`
    (`{title} : "…"`) is the app's exact case-insensitive **substring** match;
  - denormalized boolean facet columns + a `paper_jkey` junction (journal +
    PNAS section keys);
  - rows inserted in the page's **exact default sort order** (year-desc, then
    Volume-desc, stable = file order), so a row's `id` is its newest-first rank
    and streaming any scope by `id` yields precisely the page's top-N — which is
    what makes the db-mode result set match the JSON path row-for-row;
  - membership sets (UTD24/FT50/ABS) read **straight out of `index.html`**.
  - A content-hash sidecar (`lit.db.sha`) lets a no-op rebuild skip re-emitting.
- **`_scraper/chunk-db.mjs`** splits `lit.db` into `data/db/lit.db.NNN` parts
  under the 100 MB GitHub per-file limit + a `data/db/lit-db.json` manifest.
  sql.js-httpvfs `serverMode:"chunked"` reads sub-ranges *within* chunks (Pages
  honors Range, and clamps an overhanging read-ahead request to the file size —
  RFC 7233 — verified on the live site), so chunking only clears the file-size
  limit; the fetch pattern is unchanged.
- **`sqlite/lit-query.js`** translates the page's filter state into SQL.
  Substring → trigram `MATCH` (no residual); **quoted** (word-boundary) and
  **author** (prefix-of-a-name-part) → the same `MATCH` prefilter + a JS
  residual verify using `textMatch`/`authorMatch` copied verbatim from
  `index.html`.
- **`sqlite/`** vendors `phiresky/sql.js-httpvfs` v0.8.12 (Apache-2.0): a
  **synchronous XHR Range read inside a Web Worker**, so no `SharedArrayBuffer`
  / COOP-COEP (which GitHub Pages can't set). Confirmed running with
  `crossOriginIsolated === false`.
- **`index.html`** (`?db=1`): the db-mode block (search "range-served SQLite
  mode") opens the chunked DB in the background; `applyFilters()` routes an
  answerable query to `applyFiltersDb()` (async build → query → render, reusing
  the existing card renderer via capitalized column aliases + `computeJkeys`/
  `normalizeEditors`), with keyset pagination for "Show more" and journal/year
  dropdown counts via `GROUP BY`.
- **`db-preview/index.html`** — a noindex prototype/benchmark page.

## What db-mode covers (and what falls back to JSON)

`?db=1` answers a query from the DB **iff** the journal scope is native and
without the special-editor UIs — i.e. **Operations Research, POM, ACM EC, PNAS
(and PNAS sections)** — with text / year / pre-print filters and the default
year-desc sort. Everything else falls through to the unchanged JSON path:

- **Management Science / ISR / Marketing Science** (their editor/area/SE/AE
  filters aren't in the DB schema — the page's fuzzy name-merge isn't reproduced
  there yet);
- **journal *types*** (UTD24/FT50/ABS) and **all-journal** searches — these need
  the FT50-catalog and ABS-shard datasets, which aren't in this DB (see below);
- non-default sorts, the Recently-added and sign-in/library views.

Because the fallback is transparent, a `?db=1` visitor sees a faster experience
on the covered journals and the normal experience everywhere else — nothing
degrades.

## Validated

- **JSON-vs-`?db=1` equivalence** (`_scraper/` has no automated Playwright test
  committed for this, but the dev harness drives the real page in both modes):
  identical scopeCount (Y), filtered count (X), and result DOI sets across
  facets, FTS, quoted phrases, author-prefix, multi-journal and combined
  filters; the fallback gate correctly marks MS/ISR/types/all-journal
  non-answerable.
- **Semantic parity** (`_scraper/sqlite-parity.mjs`): the SQL query layer vs the
  page's real matchers over 28 queries — **28/28**, row-level.
- **Chunked mode**: 5×42 MB chunks reassemble byte-identical; the page loads and
  queries them correctly in headless Chromium; Pages clamps overhanging Range.
- **Payload** (`_scraper/sqlite-bench.mjs`, native corpus, cold): init ≈ 536 KB;
  facet / year / pre-print ≈ 0.6–0.9 MB; substring ≈ 3–5 MB; worst cases
  (broad-text ∩ narrow facet, long quoted phrase) ≈ 14–16 MB — all ≤ the ~15 MB
  gzipped JSON the page downloads every visit today; warm queries ~free. DB on
  origin ≈ 209 MB, never downloaded whole.

## Reproduce

```
node lit/_scraper/emit-db.mjs lit/data lit/index.html /tmp/lit.db
node lit/_scraper/chunk-db.mjs /tmp/lit.db lit/data/db
node lit/_scraper/sqlite-parity.mjs                 # 28/28
LIT_DB=/tmp/lit.db node lit/_scraper/sqlite-bench.mjs
```

## Remaining / follow-ups

1. **Serving the DB (to activate `?db=1`).** The DB isn't committed here (it
   duplicates the JSON — see above). To turn db-mode on, generate it and serve
   it from a location the page can range-fetch same-origin — a **dedicated data
   repo** with its own Pages site (like the existing `lit-data-*` shards) is the
   right home, so the ~200 MB redundant binary and its daily refresh never touch
   the main site repo. Point `initLitDb()` at that repo's `data/db/` and have
   that repo's CI rebuild it. (Git LFS is a non-starter — Pages serves the LFS
   pointer, not the file.)
2. **FT50 catalog + ABS shards** → their own `lit.db` (each repo, same builder)
   so *types* and *all-journal* searches also go through the DB. The FT50 DB is
   ~637 MB, so it needs its own repo (this repo's 1 GB Pages budget is nearly
   full) — hence it's a separate step.
3. **MS/ISR/MkSc editor/area/SE/AE** in the DB (with the page's fuzzy name
   merge) so those journals are db-answerable too.
