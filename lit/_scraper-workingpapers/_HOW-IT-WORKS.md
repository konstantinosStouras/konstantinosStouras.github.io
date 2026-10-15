# How the Working Papers archive works

`lit/_scraper-workingpapers/` builds the **Working Papers** dataset for
[stouras.com/lit/](https://www.stouras.com/lit/): the **unpublished
working papers / pre-prints** of every author already listed in "The Lit". It
is a sibling of `lit/_scraper/` (the published-catalog pipeline) and
`lit/_scraper-ft50/` (the FT50 catalog), and it writes into
`lit/data-workingpapers/`, which the page merges at runtime exactly like a
satellite shard — under a **"Working Papers" journal type**.

## What it archives (deliberately conservative)

A working paper is kept only when **all** of these hold — the point is
*genuinely unpublished* work, not "a pre-print of something already published"
(that is what the published cards' own *Pre-print (Open Access)* link is for):

1. it is an OpenAlex work of `type:preprint` by one of the listed authors;
2. it lives on a repository we recognise and can link to — **SSRN, NBER,
   arXiv or OSF** (same host validators as the pre-print feature —
   `pickPreprint` / `preprintFromDoi`, imported from `../_scraper/build-data.mjs`);
3. its title does **not** already appear in the published catalog; and
4. OpenAlex does not also place it in a journal (no published version).

A working paper that later gets published simply **drops out** on the next
crawl (its title starts matching the published catalog), and the published
record takes over.

## How it runs — slow on purpose, resumable, polite

OpenAlex is the only API called. The crawl is built to fill in over **weeks**,
not minutes:

- **Author IDs** are resolved with high precision from a paper we *know* the
  author wrote: fetch that DOI's OpenAlex authorships and pick the one whose
  surname + initial match. This uses the trusted catalog to disambiguate common
  names, and is cached in `data-workingpapers/_authors.json`.
- Each author's `type:preprint` works are then enumerated (cursor-paginated),
  filtered by the four rules above, and turned into page-ready records
  (`wpRecordFromWork`).
- Every request is **paced** (`WP_PACE_MS`, default 1.5 s), honours
  `Retry-After`, and **backs off exponentially** on 429/403; each run does a
  **bounded slice** of authors (`WP_MAX_AUTHORS`) within a wall-clock budget
  (`WP_BUDGET_MS`) and **checkpoints after every author**, so a run always
  resumes where the last one stopped.

### Author priority

Authors who published in **Management Science, M&SOM or POM in the last 15
years** are crawled **first** (`WP_PRIORITY_KEYS` / `WP_PRIORITY_YEARS`), then
the rest of the catalog (most-recently-active first), then everyone is
periodically **re-crawled** (`WP_REFRESH_DAYS`, default 45) to pick up new
working papers.

## Files it writes into `lit/data-workingpapers/`

| file | purpose |
|---|---|
| `papers-wp-<host>.json` | one per repository (`wp-ssrn`, `wp-nber`, `wp-arxiv`, `wp-osf`) — the working-paper records |
| `sources.json` | manifest (per-repo name/file/count, each flagged `"workingPaper": true`) |
| `recent.json` | newest-posted working papers (kept for parity; the page's "Recently added" view stays published-only) |
| `meta.json` | `{ lastPull, paperCount, authorCount, authorsInCatalog, perSource, workingPapers:true }` |
| `_authors.json` | **internal** crawl cursor: `normName -> { oaid, ts, done, found }` (underscore-prefixed, so Jekyll doesn't publish it) |

A record has the same shape as a published paper (`Title`, `Authors`,
`Affiliations`, `Year`, `Abstract`, `DOI`, `Journal`, `JKey`, `Preprint`,
`PreprintSrc`, optional `CitedBy`) plus `"Status": "Working paper"` — so the
page renders it with no card changes: the "Working Paper" badge, the repository
tag, a clickable posted-year chip, the co-authors, and the *Pre-print (Open
Access)* link all come for free.

## The page side (`lit/index.html`)

- `WP_SOURCES_URL` / `WP_DATA_BASE` point at `./data-workingpapers/`.
- `loadWorkingPapersManifest()` registers the repos as lazy `EXTRA_SRC`
  entries and records their keys in `WP_KEYS`; the `wp` entry in
  `JOURNAL_TYPES` (with `journalTypeKeys('wp') === WP_KEYS`) turns them into a
  "Working Papers" chip and per-card badge.
- Working papers are **opt-in**: `neededExtraKeys()` excludes `WP_KEYS` from the
  "broad filter loads everything" path, so a normal search stays published-only
  — the archive downloads only when the user selects the Working Papers type or
  one of its repositories. They are also kept out of the header's published
  "N papers" count.

## Offline test (no network)

```
node lit/_scraper-workingpapers/selftest.mjs
```

Runs the pipeline in mock mode (`WP_MOCK=1`, `./mock/` fixtures) end-to-end and
unit-tests the pure helpers (`wpRecordFromWork`, `orderAuthors`,
`invertAbstract`, `loadCatalog`).

## Growing past the 1 GB Pages limit → move to a satellite repo

The archive is a superset of a satellite shard's layout, so lifting it out into
a dedicated `lit-data-workingpapers` GitHub-Pages repo (like `lit-data-abs4`)
is mechanical:

1. move `lit/data-workingpapers/` to that repo's `data/` and enable Pages;
2. in `lit/index.html`, change **one** constant —
   `WP_DATA_BASE` from `'./data-workingpapers/'` to
   `'/lit-data-workingpapers/data/'` (and `WP_SOURCES_URL` to match);
3. point this pipeline's output at the satellite checkout (`WP_DATA_DIR`) and
   move these two workflows there (they already commit only
   `lit/data-workingpapers`).

Everything else — the runtime merge, the journal type, the opt-in lazy load —
is unchanged, because the page already fetches an extra source from whatever
`base` its manifest entry carries.

## Reconcile published versions across the full Lit catalog

Run `node --max-old-space-size=8192 lit/_scraper-workingpapers/reconcile.mjs` for a read-only audit of all working-paper parts against the native, FT50, ABS4, ABS3 and Nature/Science catalogs. Live satellite downloads must succeed before any cleanup is attempted. The internal `data-workingpapers/_reconciliation-audit.json` records every proposed transfer and uncertain candidate.

Run the same command with `--apply-report` to apply the saved audit: save DOI-keyed access links first, remove the matched working-paper entries, then rebuild the manifest, totals and recent feeds. Existing supplement links are preserved. Uncertain candidates remain in the archive.

Exact title matches require shared authors and plausible years. Title variants require the complete surname set on both versions (at least two authors), a long title, at least 90% word overlap, and a unique candidate with a clear lead. Substantially renamed titles require further review; word overlap alone does not establish identity. The regular crawl uses the same matcher on its local catalogs and now passes newly crawled title matches through reconciliation before removing them.

Matching regression checks: `node lit/_scraper-workingpapers/reconcile-selftest.mjs`.

## Evidence review of uncertain versions (2026-10-15)

The follow-up review checked all 7,527 retained candidates against repository and publisher Crossref deposits, arXiv's journal DOI metadata, NBER's Published Versions sections, current repository titles, existing catalog preprint URLs, and shared abstract passages. Every outcome and its evidence are retained in `data-workingpapers/_uncertain-review-audit.json`; no abstract text is duplicated in that audit.

The review confirmed 2,387 versions. Three were already retired by scheduled crawls; 2,384 further archive entries were consolidated into 2,360 published records. Supporting documents (254) and unconfirmed candidates (4,886) remain separate. `_reconciliation-audit.json` records the applied transfers and supports the existing integrity verifier.

`verified-versions.json` persists reviewed repository URLs and primary repository DOIs, together with their published target and evidence source. The daily crawler uses these mappings even for papers in remotely hosted satellite catalogs. Exact repository URLs take precedence over potentially incorrect imported DOI fields; supporting-document titles never inherit a main-paper mapping. Add mappings only after evidence review, and never infer a new target from a similar title alone.

Run `node lit/_scraper-workingpapers/review-selftest.mjs` to check every reviewed mapping, satellite-catalog independence, supporting-document exclusion, unknown identifiers, and conflicting imported DOI fields. Run `node lit/_scraper-workingpapers/verify-reconciliation.mjs` from any directory for archive and link integrity checks.

## Deeper paper review (2026-10-15)

All 4,886 previously unconfirmed candidates were checked again. The review assessed 9,680 working/published document records and recovered 2,156 readable, identity-validated paper copies; 344 candidate pairs had accessible text on both sides. It also queried all 3,973 SSRN identifiers in this cohort, finding 3,215 indexed primary repository records. Search-index evidence is explicitly distinguished from downloaded manuscripts in `data-workingpapers/_fullpaper-review-audit.json`.

The deeper review confirmed and retired 733 working-paper entries associated with 729 published papers. Another 4 entries were no longer listed when the refreshed archive was reconciled. The remaining 4,149 active candidates retain separate entries: inaccessible texts, insufficient evidence and conflicting targets are never treated as confirmations. Existing open-access links are preserved when another confirmed version is retired.

Confirmations use a current title and authors at the same repository identifier, an explicit publication DOI or earlier-title statement in the paper itself, substantial shared paper text, or a documented manual comparison of distinctive methods and findings. Reference lists are excluded from text comparisons. Body-based matches require at least 1,000 substantive words in both documents, 500 shared seven-word passages, 50% containment and 40% Dice overlap. Conference books, supporting documents, related-paper citations and generic acknowledgements cannot supply version evidence. Downloaded paper text is not included in the repository.

Run `node lit/_scraper-workingpapers/deep-evidence-selftest.mjs` for evidence safeguards and `node lit/_scraper-workingpapers/deep-review-selftest.mjs` to verify all 733 new durable mappings independently of the satellite catalogs. The existing reconciliation integrity verifier checks the transferred links, retired entries, totals and recent feeds.

## Alternative full-text sources (2026-10-15)

The next pass checked all 4,149 retained candidates, including 36 alternative publication targets and 1,555 direct-PDF follow-up searches, for 5,740 source searches in total. Additional repository locations, CORE results before its rate limit, and public author, institutional, repository and publisher copies supplemented the earlier retrieval. Access and rate limits were respected. The pass assessed 8,225 document records; 626 additional document records passed the refined manuscript-identity checks, and 444 candidate pairs had qualifying text on both sides.

The final review confirmed 72 working-paper versions for 70 published papers. All 4,077 other cohort records remain separate. `data-workingpapers/_alternative-review-audit.json` records the outcomes, source URLs, retrieval failures, content comparisons and corrections. Complete titles followed by author names, explicit earlier-title notices or printed primary repository identifiers establish manuscript identity. A title prefix or an imported DOI alone cannot do so. Two retrievals of the same file need separate version evidence. References and supporting documents cannot supply body-match evidence; explicit version notices were checked individually.

The supporting-document check now also recognizes explicit additional-results documents and electronic companions. Review of the historical audits found two companions wrongly retired in earlier passes. Their original archive records were restored, their incorrect version mappings removed, and the main-paper access links replaced with full manuscripts at INSEAD and MIT. The historical audit remains intact; the new audit records the superseding corrections. The arXiv additional-results document in the current cohort remains separate as well.

Run `node lit/_scraper-workingpapers/alternative-identity-selftest.mjs` for title-prefix, related-work, imported-DOI and supporting-document safeguards. Run `node lit/_scraper-workingpapers/alternative-review-selftest.mjs` to verify every new mapping, the restored companions and their corrected access links. Continue to run the earlier review tests and `verify-reconciliation.mjs` for archive consistency.
