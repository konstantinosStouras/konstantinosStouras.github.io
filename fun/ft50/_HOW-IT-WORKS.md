# fun/ft50 — how it works (the FT50 research paper browser)

`stouras.com/fun/ft50/` extends the Google-free architecture of
`stouras.com/fun/ms/` and `stouras.com/fun/lit/` to **all 50 journals of the
Financial Times FT50 research rank** (<https://www.ft.com/ft50-journals>).

> The underscore in this filename (and in `_scraper/`) tells GitHub Pages'
> Jekyll build **not** to publish them. The `data/` folder has no underscore,
> so it *is* served — that's the point.

## The one-paragraph version

There is no server and no database behind the paper data. A scheduled **GitHub
Action** (`.github/workflows/ft50-update-data.yml`, daily at 06:00 UTC + on
demand) runs `_scraper/build-data.mjs`, which downloads every article of every
FT50 journal from the **Crossref API** (one pull per journal, by ISSN), writes
one static JSON file per journal into `fun/ft50/data/` (`papers-ms.json`,
`papers-aer.json`, …, listed in `sources.json`), plus shared `authors.json` /
`affiliations.json` / `recent.json` / `meta.json`, and commits whatever
changed. The page (`index.html`) reads those files with `fetch()` and does
every filter, search and BibTeX export in the browser. Because 50 journals are
a couple hundred MB of JSON, the page **lazy-loads** them: selecting journals
downloads only their files; searching with no journal selected streams in all
of them progressively. A **second, yearly Action** keeps the journal list
itself in sync with ft.com (see below). Optional per-user accounts (stars,
notes, lists, tags) use their own dedicated Firebase/Firestore project — see
`_ACCOUNTS-SETUP.md`.

## How the page behaves (by design)

- **Journals filter**: a multi-select of the 50 FT50 journals (searchable
  dropdown). Nothing selected = search everything (data downloads on demand).
- **Filters adapt per journal** (capability flags in `sources.json`, never
  hardcoded keys):
  - **Editors & Areas are Management Science only.** When MS is explicitly
    selected (alone or with other journals) the page behaves exactly like
    `/fun/ms/` — Accepting Editor / Area filters, Editors/Areas summary tabs,
    editor & area tags on cards. On the default all-journals landing (and for
    selections without MS) those controls stay hidden.
  - **Senior/Associate Editors for ISR & Marketing Science**: selecting
    *Information Systems Research* reveals Senior + Associate Editor filters
    (Marketing Science: Senior Editor only), with clickable `SE:` / `AE:` tags
    on cards — same mechanics as `/fun/lit/`.
  - Other journals contribute plain records. Journals with an advance-
    publication stage (`aia` flag) show "Articles in Advance" for records
    without volume/issue.
- **"Recently added papers"** shows papers first seen by the pipeline in the
  last 4 weeks, newest first — and **it respects the journal filter**: with
  journals selected it shows only their recent papers (this is a deliberate
  difference from `/fun/lit/`, whose recent view clears the filters). The
  other filters (year, title, author, …) narrow the recent view too.
- **Practitioner magazines**: Harvard Business Review and MIT Sloan Management
  Review register only some articles with Crossref; they are included with
  whatever exists and marked "limited coverage" in the journal picker.
- Per-journal tag colors are generated at runtime from the manifest order
  (golden-angle palette) — 50 journals is too many for hand-written CSS.
- BibTeX is journal-aware via the manifest (`@article` with the right journal
  name and publisher).

## The pieces

```
fun/ft50/
├─ index.html                ← the page (adapted from /fun/lit/)
├─ data/                     ← the "database": static JSON, served to visitors
│  ├─ sources.json           ← manifest: keys, files, counts, capability flags
│  ├─ papers-<key>.json      ← one file per journal (50 files)
│  ├─ authors.json           ← per-author aggregates (authors with ≥2 papers)
│  ├─ affiliations.json      ← per-affiliation aggregates
│  ├─ recent.json            ← papers first seen in the last few weeks
│  ├─ meta.json              ← { lastPull, paperCount, journalCount, perSource }
│  └─ _registry.json         ← bookkeeping: which paper was first seen when
├─ _scraper/
│  ├─ journals.json          ← ★ THE FT50 LIST: key, name, ISSNs, publisher,
│  │                            capability flags per journal (data-driven)
│  ├─ build-data.mjs         ← the program that builds everything in data/
│  ├─ check-ft50-list.mjs    ← the yearly ft.com list checker (see below)
│  ├─ informs-editors.mjs    ← the History-line Senior/Associate Editor parser
│  └─ mock/                  ← tiny real-payload fixtures for offline testing
├─ _firestore.rules          ← security rules for the optional accounts
├─ _ACCOUNTS-SETUP.md        ← one-time Firebase/Firestore setup steps
└─ _HOW-IT-WORKS.md          ← this file

.github/workflows/ft50-update-data.yml   ← daily data build
.github/workflows/ft50-check-list.yml    ← yearly FT50 list check
```

## The yearly FT50 list check

The FT revises the list occasionally (FT45 → FT50 in 2016). Once a year
(3 January, and on demand from the Actions tab), `ft50-check-list.yml` runs
`_scraper/check-ft50-list.mjs`, which:

1. Fetches the live list from **ft.com/ft50-journals** (falling back to
   **Wikipedia's FT50 article** if ft.com blocks the runner), and diffs it
   against `journals.json` (matching on normalized names + `ftAliases`).
2. **Added journals** get their ISSNs and publisher resolved via Crossref's
   `/journals?query=` endpoint (exact normalized-title match required) and are
   appended to `journals.json`. If resolution isn't confident, the journal is
   NOT added silently — it's flagged for manual addition instead.
3. **Removed journals** are marked `"retired": true`; the next data build
   deletes their `papers-<key>.json` and drops them from the manifest.
4. The workflow commits the updated `journals.json` and then **dispatches the
   data build** explicitly (a push made with `GITHUB_TOKEN` does not itself
   trigger other workflows), and **opens a GitHub issue** describing exactly
   what changed — also when the check couldn't run, or when the Wikipedia
   fallback (advisory only) suggests a change for manual review — so nothing
   happens silently.

## Resilience choices in the data build

- **One journal's failure never sinks the run**: a failed Crossref pull — or a
  pull that suddenly shrinks below half the committed size (truncated cursor
  walk) — reuses the previously committed `papers-<key>.json` for that journal
  and continues (`FT50_ALLOW_SHRINK=1` overrides the shrink guard).
- **Per-journal onboarding guard** for "recently added": a journal that
  contributes hundreds of unseen papers at once (first run, a newly added FT50
  journal, an ISSN fix) is being onboarded, not publishing news — only its
  newest few get stamped with today's date, so the recent view never floods.
  Guarding per journal (vs per run, as lit does) means onboarding one journal
  can't suppress the genuinely new papers of the other 49 that day.
- Secondary/predecessor ISSNs are best-effort (e.g. Operations Research's
  JORSA era, Review of Finance's European Finance Review era); only the first
  ISSN of each journal must succeed.

## Updating the data

- **Automatic:** daily at 06:00 UTC (data), yearly on 3 January (journal list).
- **On demand:** GitHub → Actions → *ft50 — update FT50 journal data* → Run
  workflow (same for the list check).
- **Change what's collected:** edit `_scraper/journals.json` (add/remove
  journals, flags) — the push itself triggers a rebuild.
- **Partial rebuild while testing:** `FT50_ONLY=ms,qje node build-data.mjs`
  (all other journals reuse their committed files).

## Testing locally (no network needed)

```bash
cd fun/ft50/_scraper
FT50_MOCK=1 node build-data.mjs    # builds _mock-out/*.json from mock/ fixtures
# then serve the repo with any static server and open fun/ft50/
# (temporarily point the page at the mock output, or copy it into data/)
```

The list checker has an offline mode too:

```bash
FT50_LIST_FILE=<saved-list.txt> node check-ft50-list.mjs --dry
```

## Honest limitations

- **HBR and MIT SMR coverage is partial** — they register only a fraction of
  their articles with Crossref (they're practitioner magazines). The picker
  labels them accordingly.
- **Editors/areas exist for Management Science 2011+ only** — same limitation
  (and same editor-overrides import) as `/fun/ms/` and `/fun/lit/`.
- **ISR/MkSc Senior/Associate Editor names** come from Crossref abstracts,
  plus fun/lit's committed pubsonline cache (`fun/lit/data/_informs-editors.json`)
  when it exists — pubsonline.informs.org blocks cloud IPs, exactly as
  documented in `fun/lit/_HOW-IT-WORKS.md`.
- **Searching everything is a big download**: the first no-journal-selected
  search fetches all 50 data files (~a few hundred MB raw, much less over the
  wire gzipped) progressively. Selecting journals first keeps it light.
- **Abstracts** are only as good as what publishers deposit with Crossref —
  INFORMS deposits full abstracts; several others (AEA, Elsevier, Chicago)
  often don't, so many records outside INFORMS have no abstract text.
- **Author/affiliation identity merging is automatic** (ORCID + name-based),
  so a person may occasionally appear under two spellings; `authors.json`
  keeps authors with ≥2 papers (plus the top slice) to stay a sane size.
