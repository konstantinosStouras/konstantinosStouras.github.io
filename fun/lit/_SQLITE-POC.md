# `/fun/lit` range-served SQLite search — proof of concept

**Status: validated proof of concept, not yet wired into the live page.**

This is a working prototype of answering every `/fun/lit` filter as an **indexed
SQL query against a single `lit.db` fetched over HTTP Range requests**, instead
of downloading whole `papers-<key>.json` files and filtering them in JavaScript.
It stays 100% static (no server, no build step for the served site, no external
CDN) — the database and the WASM SQLite are just files on GitHub Pages, and the
browser fetches only the handful of DB pages a query actually touches.

## Why

Today a cross-journal ("all journals") search downloads the entire corpus for the
sources in scope — ~60 MB for the eight native journals, and hundreds of MB once
the FT50 catalog and ABS shards are involved — then parses and filters it in
memory. Range-served SQLite turns that into: *fetch the query's index/posting
pages only.* The win is modest for the native corpus and **decisive for the
large catalogs** (you never download a 200–637 MB dataset to answer one query).

## How it works

- **`_scraper/emit-db.mjs`** builds `lit.db` from the same `papers-<key>.json`
  files the scraper already writes. Schema:
  - a **narrow `papers`** table (no abstract) so facet/sort/row-probe pages stay
    small; the heavy abstract/significance text lives in a side table
    **`papers_abs`**, fetched only for a card or a quoted-abstract check;
  - **`papers_tri`**, a contentless **FTS5 trigram** index over
    title/authors/affiliations/abstract — a column-filtered trigram `MATCH`
    (`{title} : "…"`) is the app's exact case-insensitive **substring** match
    (adjacent trigrams == substring; no `remove_diacritics`, matching the page);
  - denormalized boolean facet columns (`is_utd24/is_ft50/is_abs4/is_abs3/
    has_preprint`) and a `paper_jkey` junction (journal + PNAS section keys);
  - rows inserted **year-descending**, so FTS5's natural rowid order is already
    newest-first (no `ORDER BY` needed for the default sort → no temp-sort scan);
  - membership sets (UTD24 / FT50 / ABS) are read **straight out of
    `index.html`** so the DB can never drift from the page.
  - A content-hash sidecar (`lit.db.sha`) lets a no-op rebuild skip re-emitting
    the binary; `lit.db.length` carries the exact byte size for the loader.
- **`sqlite/lit-query.js`** translates the page's filter state (`sel`) into SQL.
  Substring terms become a trigram `MATCH` (exact, no residual); **quoted**
  (word-boundary) and **author** (prefix-of-a-name-part) terms use the same
  `MATCH` as a superset prefilter plus a JS **residual verify** using
  `textMatch`/`authorMatch` copied verbatim from `index.html`. A pure-substring
  count runs on `papers_tri` alone (no join).
- **`sqlite/`** vendors `phiresky/sql.js-httpvfs` v0.8.12 (`index.js`,
  `sqlite.worker.js`, `sql-wasm.wasm`, Apache-2.0). Its read path is a
  **synchronous XHR Range request inside a Web Worker** — it needs no
  `SharedArrayBuffer`, hence **no COOP/COEP headers**, which GitHub Pages cannot
  set. (Confirmed: the prototype runs with `crossOriginIsolated === false`.)
- **`db-preview/index.html`** is the prototype page (noindex): a small search UI
  driven entirely by the range-served `lit.db`, self-reporting latency and (when
  served by the local benchmark server) wire bytes per query.

## Validated results (native 8-source corpus, 33,735 papers)

Measured in headless Chromium against a Range-capable server (`sqlite-bench.mjs`):

- **Parity:** `_scraper/sqlite-parity.mjs` — the app's real matchers (oracle,
  over the raw JSON) vs. the SQL path, across 28 representative queries. Exact
  match on scopeCount (Y), filtered **row** count (X), result row-identity
  multiset, and crossFilter journal/year histograms. **28/28 pass.**
- **Feasibility:** GitHub Pages serves Range (`206`, exact bytes); the reader is
  SQLite **3.35.0**; `SharedArrayBuffer` absent, `crossOriginIsolated` false.
- **Payload (cold, fresh page cache, per query):** one-time worker init ≈ 536 KB;
  facet / year / pre-print ≈ 0.6–0.9 MB; rare substring ≈ 1.3 MB; author prefix
  ≈ 1.7 MB; common substring (market/pricing/affiliation) ≈ 3–5 MB. Worst cases
  — a broad text term intersected with a restrictive facet, and long quoted
  phrases — ≈ 14–16 MB (trigram posting-list reads for common trigrams). Every
  case is **≤ the ~15 MB gzipped JSON the page downloads on every visit today**,
  and repeat queries in a session are served from the worker's page cache
  (~free). DB file on origin: ~209 MB, never downloaded whole.

## Reproduce

```
node fun/lit/_scraper/emit-db.mjs fun/lit/data fun/lit/index.html /tmp/lit.db   # build
node fun/lit/_scraper/sqlite-parity.mjs                                         # 28/28 parity
LIT_DB=/tmp/lit.db BROWSER=<chromium> node fun/lit/_scraper/sqlite-bench.mjs    # payload/latency
```

## Open deployment decisions (not done yet)

1. **100 MB per-file limit.** GitHub blocks files > 100 MB, and the native DB is
   ~209 MB (the FT50 DB ~637 MB). Real deployment needs sql.js-httpvfs
   **`serverMode: "chunked"`** (split the `.db` into < 100 MB parts) — validated
   as available but **not yet implemented/tested here**.
2. **Binary in git.** A ~209 MB DB (chunked) committed and rebuilt daily grows
   the repo. The hash-gate limits churn, but the initial add is large; consider
   whether CI generates+commits the chunks or they live in the data-shard repos.
3. **Wiring into the live page (`index.html`).** The staged plan is: build the
   `.db` alongside the JSON (invisible) → ship this prototype → switch the loader
   behind `?db=1` with a **per-dataset fall back to the existing JSON loader** if
   a `.db` is missing → flip the default. None of that is done; the live page is
   untouched.
4. **Replicating to ft50 + the three shard repos** (one `.db` each, same builder)
   comes only after native parity is proven in the wild.

See the full design write-up referenced in the PR for the query-model spec, the
loader analysis, and the schema rationale.
