# lit-data-nature

A **satellite data shard** for [stouras.com/lit/](https://www.stouras.com/lit/)
("The Lit" research paper browser): the **Nature-portfolio journals — Nature,
Nature Human Behaviour and Nature Communications — filtered to papers on
GenAI/LLMs, innovation and the science of science**. These journals publish
tens of thousands of papers a year across all of science; only this curated
topical slice belongs in The Lit, so — unlike the ABS shards, which mirror
each journal's full Crossref back-catalogue — this shard harvests **two-step**:

1. **Scope seeding (OpenAlex).** `_scraper/scope.json` defines the filter —
   an OpenAlex **topic-ID allowlist** (the CI-friendly analogue of PNAS's
   topic sections; a paper matches when any of its ~3 assigned topics is
   listed), quoted **title+abstract search terms** ("large language model",
   "ChatGPT", "science of science", …), per-journal **must-include DOIs**
   (owner-requested papers, immune to topic re-tagging) and
   **exclude-prefixes** (Nature's `10.1038/d41586-*` news/comment DOIs).
   Each daily build re-queries OpenAlex per journal and unions the DOIs into
   `data/_scope.json` (with an audit tag saying *why* each DOI is in). A
   failed or suspiciously-shrunken seed falls back to the committed scope.
2. **Harvest (Crossref).** The scoped DOIs are fetched in batched
   `filter=doi:a,doi:b,…` calls and flow through the same vendored pipeline
   as every other shard (duplicate collapse, pre-print links, citation
   counts, abstracts overlay, registry/recent), so the published `/data/`
   layout is identical and the lit page needs nothing special.

The journals carry no ABS grade (Nature titles are outside the AJG), so the
manifest has no `abs` field — they appear in the page's Journals filter
(flagged " — limited coverage") without joining the UTD24/FT50/ABS type
buckets, exactly like PNAS.

**To widen/narrow the filter:** edit `_scraper/scope.json` (add/remove topic
ids or search phrases — ids are verified against their display names on every
build, warn-only) and push; the next build harvests the difference. **To add
a paper the filter missed:** add its DOI under `mustInclude` for its journal
key. **To add a journal:** append an entry to `_scraper/journals.json` (key,
name, ISSNs, publisher, `aia`/`limitedCoverage`) and push.

Abstracts: the Nature-portfolio journals deposit **no abstracts to Crossref**,
so `.github/workflows/abstracts-backfill.yml` (OpenAlex `abstract_inverted_index`
+ optional Semantic Scholar / Springer Meta API legs) is what fills the
Abstracts search for this shard. Pre-print links and OpenAlex/Semantic-Scholar
citation counts come from their own scheduled backfills, same as every shard.

Offline tests (no network): `node _scraper/scope-selftest.mjs` and
`node _scraper/abstracts-selftest.mjs`.

Requires GitHub Pages enabled on this repo (Settings → Pages → Deploy from a
branch → `main` / root) — the lit page lazy-loads
`https://www.stouras.com/lit-data-nature/data/` same-origin and skips the
shard with a 404 until Pages is live.
