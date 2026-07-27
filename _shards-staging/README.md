# _shards-staging — two NEW satellite data shards, ready to bootstrap

**Why this directory exists:** the owner asked for two dedicated data repos —
`lit-data-nature` (Nature, Nature Human Behaviour, Nature Communications) and
`lit-data-science` (Science/AAAS), each carrying ONLY papers on GenAI/LLMs,
innovation and the science of science. The Claude session that built them had
no permission to create GitHub repositories, so each repo's complete,
selftested content is staged here instead (underscore-prefixed, so Jekyll
never publishes it). The temporary `validate-shards.yml` workflow runs each
staged pipeline's REAL build on every push that touches this directory,
asserts the owner's six requested papers land in the datasets, and commits
the seeded `data/` back — so the trees below ship pre-populated.

## One-time bootstrap (per shard; ~2 minutes each)

1. Create the empty **public** repo on GitHub (no README/license):
   `konstantinosStouras/lit-data-nature`, then `…/lit-data-science`.
2. From a clone of this repo, on this branch:

   ```bash
   cd _shards-staging/lit-data-nature      # then repeat for lit-data-science
   git init -b main
   git add -A
   git commit -m "initial pipeline + seeded dataset"
   git remote add origin https://github.com/konstantinosStouras/lit-data-nature.git
   git push -u origin main
   ```

   (Or ask a Claude session to do it once the repos exist — `add repo
   konstantinosStouras/lit-data-nature` brings it into scope.)
3. Enable GitHub Pages on each repo: Settings → Pages → Deploy from a
   branch → `main` / root. The lit page starts merging the shard as soon as
   `https://www.stouras.com/<repo>/data/sources.json` serves (until then it
   404s and is skipped — nothing breaks while this is pending).
4. Optional secrets (per repo): `S2_API_KEY` (Semantic Scholar) and — for
   lit-data-nature — `SPRINGER_API_KEY` (Springer Meta API, abstracts for
   10.1038/… DOIs).
5. Delete `_shards-staging/` and `.github/workflows/validate-shards.yml`
   from THIS repo in the same change (their job is done); the lit page's
   `SHARDS` list already points at the new repos' Pages URLs.

Each shard's own README.md documents the topic filter (`_scraper/scope.json`)
and how to widen/narrow it.
