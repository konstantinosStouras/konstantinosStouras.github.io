# The Dataset Library

Static dataset browser at https://www.stouras.com/datasets/.

The page reads the current README from konstantinosStouras/datasets, whose GitHub Actions workflow merges updates from toddrjones/datasets hourly. `source.md` is a bundled fallback if GitHub cannot be reached. Original source notes and provider links are retained; the collection is CC0, while provider terms apply to each dataset.

Search and filters run in the browser. Topic, access, coverage year, inferred geographic focus, data type, units, study design, time period, API/software, data features and linked paper filters combine by intersection. Unknown information remains unspecified. Classifications use source wording and should be checked with the provider. The year filter uses explicit Years fields. Browser bookmarks are saved locally; query/filter settings are shareable in the URL. CSV exports contain the filtered results.

Run `node --test datasets/_tools/catalog.test.mjs` from the website repository. No installation or build is required. Publish only this directory to the existing GitHub Pages master branch. Do not change the domain or add `.nojekyll`.
