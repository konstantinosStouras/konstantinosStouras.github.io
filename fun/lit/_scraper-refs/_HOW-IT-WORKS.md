# The Lit — citation graph (`data-refs/`)

For every paper listed in **The Lit** (`stouras.com/fun/lit/`), this pipeline
extracts the references it **cites that also belong to the catalog** — the
intra-catalog out-edges of the citation graph. Each paper card gains a
**"Cited references in this catalog"** toggle that lists those papers, each
linking straight to the paper it cites, so you can walk the citation graph
within these journals.

It is deliberately a **separate dataset** so it never eats the main site's
size budget, and so it can move to a dedicated Pages repo when it grows — see
"Migration" below.

## Where the data live

```
fun/lit/data-refs/
  manifest.json        # {ver, shards:{<jkey>:{file,papers,edges}}, index, totals}
  refs-<jkey>.json     # { "<citing-doi>": ["<cited-doi>", …] } — one per citing journal
  refs-index.json      # { "<cited-doi>": [title, jkey, year] } — every edge target
  meta.json            # small run summary
  _refs-cache.json     # the incremental crawl cache (NOT served — see below)
```

- **`refs-<jkey>.json`** is keyed by the *citing* paper's DOI and holds only the
  cited DOIs that are in the catalog. Sharded by the citing journal so the page
  downloads just the one file for a paper's journal, on demand.
- **`refs-index.json`** lets the page render a cited paper's title/journal/year
  without loading that paper's journal file.
- **`_refs-cache.json`** is the build's memory: `{"<doi>": {r:[raw cited DOIs],
  t:"date", v:<ver>}}`. It caches the **raw** Crossref reference DOIs (not just
  the in-catalog ones), so every build re-intersects with the *current* catalog
  offline — as the catalog grows, new edges appear with **no re-fetching**. It
  is underscore-prefixed, so Jekyll does not publish it; it lives in git only as
  the crawl cursor.

## How it is built

`build-refs.mjs` (Node 20+, no dependencies):

1. **Catalog** — reads `../data/` and `../data-ft50/` (native + FT50) into a
   `DOI → {title, journal, year}` map and an ordered paper list. (ABS satellite
   shards live in sibling repos; add them via `REFS_CATALOG_DIRS` to resolve
   edges into them — the raw cache means no re-fetch is needed when you do.)
2. **Fetch** — for each not-yet-fetched paper, one Crossref request
   (`works?filter=doi:<doi>&select=DOI,reference`) reads the DOIs the publisher
   deposited in its reference list. A published paper's reference list never
   changes, so a fetched paper is **frozen** and never re-fetched. Crossref is
   paced (~1 request / 0.4 s), honours `Retry-After`, backs off on throttling,
   and each run is bounded (`REFS_MAX_PAPERS`, `REFS_BUDGET_MS`) and checkpoints
   as it goes — so it fills in over **weeks** without tripping rate limits.
3. **Apply** — intersects the whole cache with the catalog and writes the shards
   + index + manifest. This runs every build (cheap, no network).

**Paper priority** (per the site owner): Management Science, M&SOM, POM and PNAS
(all years) first, then the UTD24 and FT50 journals (newest years first), then
everyone else. See `tierOf()` / `orderPapers()`. The tier sets mirror
`index.html`'s `UTD24_KEYS` / `FT50_KEYS` — keep them in sync.

## Running it

```bash
# Offline smoke test (no network, uses ./mock/ fixtures):
node fun/lit/_scraper-refs/selftest.mjs

# A real slice (online; gently paced, resumable):
REFS_MAX_PAPERS=6000 REFS_BUDGET_MS=2700000 node fun/lit/_scraper-refs/build-refs.mjs
```

Online it runs from **`.github/workflows/lit-references-backfill.yml`** (every
3 h), which fetches a slice and commits `fun/lit/data-refs/` back (own
concurrency group; replays the directory on a rejected push). Only the
default branch carries the committed data.

Key env vars: `REFS_MAILTO` (Crossref/OpenAlex quota identity,
`kstouras+litrefs@gmail.com`), `REFS_MAX_PAPERS`, `REFS_BUDGET_MS`,
`REFS_PACE_MS`, `REFS_CATALOG_DIRS`, `REFS_DATA_DIR`, `REFS_MOCK`.

## On the page

`index.html` fetches `data-refs/manifest.json` at load (`loadRefsManifest`). A
paper card shows the **"Cited references in this catalog"** toggle only when its
journal has a shard (`refsShardFor`). Opening it lazy-loads `refs-index.json`
(once) and the paper's `refs-<jkey>.json` (once per journal), then lists the
cited papers newest-first, each linking to its DOI (`togRefs`). The dataset
**ships empty** (a manifest with no shards), so the toggle stays hidden until
the backfill has populated it.

## Migration to a dedicated Pages repo

When `data-refs/` nears the 1 GB Pages limit, move the folder into a dedicated
`lit-data-refs` GitHub-Pages repo (its own copy of this pipeline + workflow) and
flip **one constant** in `index.html`:

```js
const REFS_DATA_BASE = './data-refs/';           // →  '/lit-data-refs/data/'
```

Same one-constant pattern as the Working Papers archive (`WP_DATA_BASE`) and the
FT50 catalog. Nothing else on the page changes.

## Coverage caveats

- Only references the **publisher deposited to Crossref** are seen, and only
  those carrying a DOI — so coverage depends on the publisher and is not
  exhaustive. OpenAlex could be added later as a second leg (bump `RF_VER` to
  re-sweep the papers that came up empty).
- Edges into **ABS satellite-shard-only** papers appear once those dirs are
  added to `REFS_CATALOG_DIRS` (no re-fetch needed — the raw cache already holds
  the cited DOIs).
