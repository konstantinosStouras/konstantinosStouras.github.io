# Repository conventions

This repo is the source of **stouras.com** (Konstantinos Stouras' homepage),
served as a static site via GitHub Pages from the `master` branch. There is no
build step — HTML/CSS/JS are committed and served as-is.

## Fun Projects landing page — keep it in sync

`/fun/` (`fun/index.html`) is the landing page that lists every app under
`stouras.com/fun/`. Each app is one `<li class="app">` card.

**Whenever a new app is added under `fun/<name>/`, you MUST also add a matching
card to `fun/index.html`** (and remove/rename the card if an app is removed or
renamed). Do this in the same change that introduces the app, so the landing
page never drifts out of sync with what actually ships.

For a new card:
- Put the newest app first in the `<ul class="apps">` list.
- Link the title to `/fun/<name>/`.
- Add a one–two sentence `<p>` description matching the app.
- Optional `<span class="tag">New</span>` (green) for a new app, or
  `<span class="tag gr">…</span>` (blue) to flag a Greek-language app.
- If it broadens the site's scope, also refresh the page's `<meta name="description">`
  and `<meta name="keywords">` to mention it.

The homepage's "Fun Projects" section (in the root site) may also link apps —
keep that in mind if a change there is warranted.

## Current /fun/ apps
`portfoliofitgame` · `capitals` · `nomoi` · `rooks` · `sudoku` · `snake` · `ms` ·
`ms2` · `mnsc_scraper-to-use-locally`

## `/fun/ms2` — the Google-free (v2) Management Science browser
`fun/ms2/` is an experimental rebuild of `fun/ms/` that uses **no Google Sheets**.
Its data lives as static JSON in `fun/ms2/data/` (`papers.json`, `authors.json`,
`affiliations.json`, `recent.json`, `meta.json`), built directly from the Crossref
API by `fun/ms2/_scraper/build-data.mjs` and refreshed by the GitHub Action
`.github/workflows/ms2-update-data.yml` (weekly + manual), which commits the
refreshed files back to the repo. The page (`fun/ms2/index.html`) reads those
files with `fetch()` — GitHub Pages serves them from its CDN, same origin. To
change the dataset, edit only the `*_URL` constants near the top of its `<script>`.
The `_scraper/` folder and `_HOW-IT-WORKS.md` are underscore-prefixed so Jekyll
does not publish them; `data/` (no underscore) IS published and must stay served.
See `fun/ms2/_HOW-IT-WORKS.md`.

## `/lab/ideasearchlab` — self-contained, built from this repo

The Ideation Challenge app at `stouras.com/lab/ideasearchlab/` is a React/Vite +
Firebase app whose **complete source is vendored in `_ideasearchlab-src/`** (the
leading `_` keeps Jekyll from publishing it). The served bundle lives in
`lab/ideasearchlab/`. There is **no dependency on any external repo** — to update
the app, edit `_ideasearchlab-src/`, then run `ideasearchlab-deploy-update.bat`
(or `cd _ideasearchlab-src && npm install && npm run build` and copy `dist/*` into
`lab/ideasearchlab/`), commit, and push. Cloud Functions deploy separately with
`firebase deploy --only functions` from `_ideasearchlab-src/`. See
`_ideasearchlab-src/README-SELF-CONTAINED.md`. The old standalone
`github.com/konstantinosStouras/ideasearchlab` repo is retired and safe to delete.

The retired static prototype `lab/brainstorming/` (an older Google-Sheets-backed
version of the same Ideation Challenge, superseded by `lab/ideasearchlab/`) was
removed.
