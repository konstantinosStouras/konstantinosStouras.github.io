# fun/ms — how it works (the Google-free Management Science browser)

`stouras.com/fun/ms/` is the **same** paper browser as the original
(now retired to `stouras.com/fun/ms-old/`), but with **no Google Sheet anywhere**. This file explains
where the data lives, how a visitor gets it, and how it stays up to date.

> The underscore in this filename (and in `_scraper/`) tells GitHub Pages' Jekyll
> build **not** to publish them. The `data/` folder has no underscore, so it *is*
> served — that's the point.

---

## The one-paragraph version

There is no server and no database. A scheduled **GitHub Action** downloads every
Management Science article straight from the public **Crossref API**, turns it into
a handful of plain **JSON files**, and commits those files into this repository. The
web page (`index.html`) simply `fetch()`es those JSON files, which GitHub Pages
serves from its global CDN — the same place your HTML comes from. So when someone
opens the page, their browser talks only to stouras.com. Google is never involved.

---

## The pieces

```
fun/ms/
├─ index.html              ← the page (the old /fun/ms/ UI wired to local JSON)
├─ data/                   ← the "database": static JSON, served to visitors
│  ├─ papers.json          ← every paper (the main dataset)
│  ├─ authors.json         ← per-author counts / areas / name variants
│  ├─ affiliations.json    ← per-affiliation counts
│  ├─ recent.json          ← papers first seen in the last few weeks
│  ├─ meta.json            ← { lastPull, paperCount }
│  └─ _registry.json       ← bookkeeping: which DOI was first seen when
├─ _scraper/
│  ├─ build-data.mjs       ← the program that builds everything in data/
│  └─ mock-crossref.json   ← a tiny fake feed for local testing
└─ _HOW-IT-WORKS.md        ← this file

.github/workflows/ms-update-data.yml   ← runs the scraper on a schedule
```

## How the data flows

1. **Source of truth: Crossref.** Every article's metadata (title, authors,
   affiliations, volume/issue/page, year, abstract, and — for 2011+ papers — the
   "This paper was accepted by …" editor sentence) is fetched from
   `https://api.crossref.org/journals/0025-1909/works`. That is the same public
   source the original Sheets pipeline (now at `/fun/ms-old/`) ultimately draws from.

2. **Build step: `build-data.mjs`.** It pages through all ~13,000 records, maps each
   into the exact field shape the page expects, derives the author/affiliation
   summaries, tracks which DOIs are new (so "Recently added" works), and writes the
   six JSON files into `data/`. It needs nothing installed — plain Node 20.

3. **Automation: the GitHub Action.** `.github/workflows/ms-update-data.yml` runs
   `build-data.mjs` **every day at 05:00 UTC** (and whenever you click *Run workflow*, and
   once whenever the scraper code changes). If the data changed, it commits the new
   JSON back to the repo. GitHub Actions runners have open internet, so they can
   reach Crossref even though the files are then served as boring static assets.

   After committing, the workflow **verifies the live site actually serves the new
   dataset**. GitHub Pages deploys occasionally fail with a transient error (it
   happened on 2026-07-03 and 2026-07-06), which used to mean the site silently kept
   serving stale data until the next unrelated commit. Now the workflow polls
   `stouras.com/fun/ms/data/meta.json`, requests a fresh Pages build via the API if
   the deploy didn't land, and fails the run loudly if the site is still stale — so
   a broken deploy shows up as a red ✗ in the Actions tab instead of going unnoticed.

4. **The page: `index.html`.** On load it does
   `fetch('./data/papers.json')` (and the other files) and renders. All filtering,
   sorting and BibTeX happens in your browser, exactly as before.

## Updating the data yourself

- **Automatic:** nothing to do — it refreshes weekly.
- **On demand:** GitHub → **Actions** tab → *ms — update Management Science data*
  → **Run workflow**.
- **Change what's collected:** edit `_scraper/build-data.mjs`, commit; the next run
  picks it up. To point the page at a different data location, change only the
  `*_URL` constants near the top of the `<script>` in `index.html`.

## Testing the build locally (optional)

Node 20+; no install needed. The mock feed avoids hitting the network:

```bash
cd fun/ms/_scraper
MS2_MOCK=./mock-crossref.json node build-data.mjs   # writes sample data/*.json
```

Then open `fun/ms/index.html` through any static server and browse.

## Articles in Advance (forthcoming papers)

A paper with **no volume and no issue** is a forthcoming ("Articles in Advance")
article — but only if it is **recent**. `forthcomingStatus()` in `build-data.mjs`
requires the year to be within the last few years of the pull; an older
no-volume/no-issue record is a published paper whose Crossref entry was frozen at
the advance stage, so it is shown as published rather than mislabeled forthcoming.
(This fixed ~49 papers from 2016–2024 that wrongly wore the "Articles in Advance"
badge only because Crossref was missing their volume/issue.)

Two committed files patch what Crossref leaves out:

- **`data/_aia-fixups.json`** — `{ "<doi>": { volume, issue, page?, year? } }`, the
  real issue for those frozen advance records. The build fills them in **only when
  Crossref itself still returns none**, so they read as published with correct
  pages.
- **`data/_informs-aia.json`** — `{ "<doi>": { Title, Authors?, … } }`, forthcoming
  papers INFORMS lists on `pubsonline.informs.org/toc/mnsc/0/0` that **Crossref has
  not indexed yet**. The build merges any DOI Crossref didn't return; each then
  appears in the paper list *and* the "Recently added papers" view, and is
  superseded automatically once Crossref catches up.

Refresh both by running **on your own machine** (pubsonline blocks cloud IPs, so
this can't run in CI — same reason as the lit/PNAS local scripts):

```bash
cd lit/_scraper
node informs-aia-local.mjs --app ms      # writes fun/ms/data/_informs-aia.json + _aia-fixups.json
# …then commit & push those two files; the daily Action folds them in.
```

## Honest limitations (vs. the old Sheets version at /fun/ms-old/)

- **Editors and research areas exist only for ~2011+ papers**, because they are
  parsed from the "This paper was accepted by …" sentence in the abstract. This is
  the same limitation the old version has. Special-issue sentences ("accepted by X for
  the Special Issue on Y") split like the sheet does: X is the editor, the
  special-issue title is the area. On top of that, `_scraper/editor-overrides.json`
  carries a one-time import of the editors the sheet collected from sources that
  don't exist on Crossref (INFORMS page scrapes and a hand-curated tab); the build
  uses it whenever Crossref itself yields no editor, so this page's per-editor counts
  match the sheet-backed version (and exceed it slightly where the abstract names an editor the
  sheet missed). If the sheet gains more hand-collected editors before it retires,
  regenerate the file with `_scraper/make-editor-overrides.mjs`.
- **Author and affiliation cleanup is lighter.** The Sheets pipeline has years of
  hand-tuned name-merging and ORCID resolution. this pipeline does a reasonable automatic
  version (ORCID when Crossref provides it, otherwise name-based), so a few authors
  may appear under more than one spelling.
- **"Recently added" is seeded on the first run.** The very first build stamps the
  newest ~40 papers as "just added" so the view isn't empty; after that, genuinely
  new papers are tracked by date as they appear.

None of these touch the core question you asked: the dataset is served as static
files from your own site, with no Google Sheet and no per-visitor database cost.
