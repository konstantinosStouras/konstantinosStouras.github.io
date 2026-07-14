# The Lit — citation graph (`data-refs/`)

For every paper listed in **The Lit** (`stouras.com/lit/`), this pipeline
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
lit/data-refs/
  manifest.json        # {ver, shards:{<jkey>:{file,papers,edges}}, index, counts, totals, sources}
  refs-<jkey>.json     # { "<citing-doi>": ["<cited-doi>", …] } — one per citing journal
  refs-index.json      # { "<cited-doi>": [title, jkey, year, authors?] } — every edge target
  refs-counts.json     # { "<citing-doi>": N } — in-catalog refs per paper (toggle count)
  meta.json            # small run summary
  _refs-cache.json     # the incremental crawl cache (NOT served — see below)
  _oaid.json           # doi → OpenAlex id map (NOT served — see below)
```

- **`refs-<jkey>.json`** is keyed by the *citing* paper's DOI and holds only the
  cited DOIs that are in the catalog. Sharded by the citing journal so the page
  downloads just the one file for a paper's journal, on demand.
- **`refs-index.json`** lets the page render a cited paper's title/journal/year
  — and its **authors** (the optional 4th tuple element) — without loading that
  paper's journal file; the toggle panel shows each cited reference's authors
  under its title.
- **`refs-counts.json`** is a tiny `{"<citing-doi>": N}` companion (one int per
  citing paper with ≥1 edge) so a card can show the count on its "Cited
  references in this catalog (N)" toggle without downloading the per-journal
  shard. The page loads it once in the background; the shard still loads lazily
  only when a panel is opened.
- **`_refs-cache.json`** is the build's memory: `{"<doi>": {r:[raw cited DOIs],
  o:[raw OpenAlex ref ids], t:"date", v:<ver>, oa:<ver>}}`. It caches each
  source's **raw** output (not just the in-catalog subset), so every build
  re-intersects with the *current* catalog offline — as the catalog grows, new
  edges appear with **no re-fetching**. `v` marks the version the paper was
  stamped at (its Crossref backbone concluded); `oa` marks the version its
  OpenAlex leg was attempted at.
- **`_oaid.json`** is `{"<doi>": "<OpenAlex id>"}`, built for free while crawling
  (each OpenAlex record returns its own id + doi). It is what lets the build
  resolve an OpenAlex `referenced_works` id back to a catalog DOI.
- The underscore files are not published by Jekyll; they live in git only as the
  crawl state.

## How it is built

`build-refs.mjs` (Node 20+, no dependencies). A published paper's reference list
never changes, so a paper stamped at the current version is **frozen** and never
re-fetched; only a version bump (`RF_VER`, currently **2**) re-sweeps everyone
with a wider net.

1. **Catalog** — reads `../data/` and `../data-ft50/` (native + FT50) into a
   `DOI → {title, journal, year}` map and an ordered paper list. (ABS satellite
   shards live in sibling repos; add them via `REFS_CATALOG_DIRS` to resolve
   edges into them — the raw cache means no re-fetch is needed when you do.)
2. **Fetch — three sources, unioned for accuracy:**
   - **Crossref** (backbone) — one `works?filter=doi:<doi>&select=DOI,reference`
     per paper; the DOIs the publisher deposited. This is the leg that stamps a
     paper "done".
   - **OpenAlex** (accuracy) — `works?filter=doi:<50>&select=id,doi,
     referenced_works` (batched 50/call). OpenAlex's reference graph is generally
     more complete than deposited references. `referenced_works` are OpenAlex
     ids; only the ones that are OUR papers are resolved, via `_oaid.json`.
   - **Semantic Scholar** (bonus) — `graph/v1/paper/batch?fields=references.
     externalIds` (batched 500/POST); optional, drops out on throttle. Disable
     with `REFS_S2=0`.

   Everything is paced (~1 req/0.4 s for Crossref; the batched legs lightly),
   honours `Retry-After`, backs off on throttling, and each run is bounded
   (`REFS_MAX_PAPERS`, `REFS_BUDGET_MS`) and checkpoints as it goes — so it fills
   in over **weeks** without tripping rate limits.
3. **Apply** — intersects the whole cache with the catalog (Crossref/S2 DOIs
   directly; OpenAlex ids via `_oaid.json`) and writes the shards + index +
   manifest. This runs every build (cheap, no network).

**Paper priority** (per the site owner): Management Science, M&SOM, POM and PNAS
(all years) first, then the UTD24 and FT50 journals (newest years first), then
everyone else. See `tierOf()` / `orderPapers()`. The tier sets mirror
`index.html`'s `UTD24_KEYS` / `FT50_KEYS` — keep them in sync.

## Running it

```bash
# Offline smoke test (no network, uses ./mock/ fixtures):
node lit/_scraper-refs/selftest.mjs

# A real slice (online; gently paced, resumable):
REFS_MAX_PAPERS=6000 REFS_BUDGET_MS=2700000 node lit/_scraper-refs/build-refs.mjs
```

Online it runs from **`.github/workflows/lit-references-backfill.yml`** (every
3 h), which fetches a slice and commits `lit/data-refs/` back (own
concurrency group; replays the directory on a rejected push). Only the
default branch carries the committed data.

Key env vars: `REFS_MAILTO` (Crossref/OpenAlex quota identity,
`kstouras+litrefs@gmail.com`), `REFS_MAX_PAPERS`, `REFS_BUDGET_MS`,
`REFS_PACE_MS`, `REFS_OA_PACE_MS`, `REFS_S2` (`0` to disable Semantic Scholar),
`REFS_CATALOG_DIRS`, `REFS_DATA_DIR`, `REFS_MOCK`.

## On the page

`index.html` fetches `data-refs/manifest.json` at load (`loadRefsManifest`). A
paper card shows the **"Cited references in this catalog"** toggle only when its
journal has a shard (`refsShardFor`); when the manifest has shards, the page also
fetches `refs-counts.json` once in the background (`loadRefsCounts`) so each
toggle can show its count — "Cited N references in this catalog" — filled in on
arrival (`annotateRefsCounts`/`refsToggleLabel`) without downloading any shard.
Opening it lazy-loads `refs-index.json`
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

- Coverage is the **union of Crossref, OpenAlex and Semantic Scholar**, and only
  references carrying a DOI (or, for OpenAlex, resolving to a catalog paper) can
  be matched — so it is broad but not exhaustive. Adding another source, or
  widening the matcher, is a matter of a new leg + bumping `RF_VER` to re-sweep
  every paper with the wider net.
- Edges into **ABS satellite-shard-only** papers appear once those dirs are
  added to `REFS_CATALOG_DIRS` (no re-fetch needed — the raw cache already holds
  the cited DOIs and OpenAlex ids).
