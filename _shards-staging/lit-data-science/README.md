# lit-data-science

A **satellite data shard** for [stouras.com/lit/](https://www.stouras.com/lit/)
("The Lit" research paper browser): **Science (AAAS), filtered to papers on
GenAI/LLMs, innovation and the science of science**. Science publishes across
all of science; only this curated topical slice belongs in The Lit, so —
unlike the ABS shards, which mirror each journal's full Crossref
back-catalogue — this shard harvests **two-step**:

1. **Scope seeding (OpenAlex).** `_scraper/scope.json` defines the filter —
   an OpenAlex **topic-ID allowlist** (the CI-friendly analogue of PNAS's
   topic sections: science.org is bot-blocked for cloud IPs and offers no
   public per-article taxonomy, while OpenAlex tags every work with ~3
   topics), quoted **title+abstract search terms** ("large language model",
   "ChatGPT", "science of science", …) and **must-include DOIs**
   (owner-requested papers, immune to topic re-tagging). Each daily build
   re-queries OpenAlex and unions the DOIs into `data/_scope.json` (with an
   audit tag saying *why* each DOI is in). A failed or suspiciously-shrunken
   seed falls back to the committed scope.
2. **Harvest (Crossref).** The scoped DOIs are fetched in batched
   `filter=doi:a,doi:b,…` calls and flow through the same vendored pipeline
   as every other shard (duplicate collapse, pre-print links, citation
   counts, abstracts overlay, registry/recent), so the published `/data/`
   layout is identical and the lit page needs nothing special.

Science carries no ABS grade (it is outside the AJG), so the manifest has no
`abs` field — it appears in the page's Journals filter (flagged " — limited
coverage") without joining the UTD24/FT50/ABS type buckets, exactly like PNAS.

**To widen/narrow the filter:** edit `_scraper/scope.json` (keep its
topics/searches in sync with `lit-data-nature`'s — same curation, two shards)
and push; the next build harvests the difference. **To add a paper the filter
missed:** add its DOI under `mustInclude`.

Offline tests (no network): `node _scraper/scope-selftest.mjs` and
`node _scraper/abstracts-selftest.mjs`.

Requires GitHub Pages enabled on this repo (Settings → Pages → Deploy from a
branch → `main` / root) — the lit page lazy-loads
`https://www.stouras.com/lit-data-science/data/` same-origin and skips the
shard with a 404 until Pages is live.
