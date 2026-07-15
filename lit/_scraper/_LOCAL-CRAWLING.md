# Local crawling — speed up The Lit's enrichment from your own machine

The Lit fills itself in from GitHub Actions alone, but slowly, for two reasons
that a home/university machine fixes:

1. **GitHub's runner IPs are blocked or throttled** by some hosts.
   - **arXiv** hard-throttles datacenter IPs. When it does, the pre-print search
     drops the arXiv leg and stamps the paper `naxiv` ("Crossref checked, arXiv
     never reached"). Those papers' arXiv pre-prints are essentially
     **unreachable from CI** — a home IP is the only way to get them.
   - **pubsonline.informs.org, pnas.org, econometricsociety.org,
     journalranking.org** block cloud IPs outright (Cloudflare/Atypon). The
     editors / Articles-in-Advance / PNAS-sections / Econometrica-forthcoming /
     ABS-grade scrapers therefore **cannot run in CI at all** — they are
     local-only by design.
2. **The reference-graph and working-papers backfills are paced far below what
   the APIs allow** (to be polite from shared CI) and run in short slices every
   3 h. Run continuously at a safe higher pace locally, they finish in
   hours/days instead of weeks.

What "faster" really means, per dataset (measured on the current data):

| Dataset | CI on its own | Local | The real win |
|---|---|---|---|
| Pre-print OA links (`data/`) | ~7,600 papers arXiv-blocked, never resolved | ~8–10 h clears the backlog | **coverage** — arXiv responds from a home IP (same 3.1 s/req pace, but it actually *finds* the links) |
| Citations — native 8 sources | already ~87 %, re-swept daily | little to add | skip; native isn't the gap |
| Citations — FT50 catalog (`data-ft50/`) | ~80 %, 2–3-day rolling cycle | one ~95-min pass sweeps all ~257k | removes the time-box + once-a-day cadence |
| Citation graph (`data-refs/`) | ~18 % done, weeks to go | **6–24 h** | pace is throttled below Crossref's limit — genuinely faster |
| Working papers (`data-workingpapers/`) | ~3 % done, 35–40 days | **3–8 days** | same — safe to raise the pace ~4× |
| Editors / AIA / PNAS / Econometrica | **impossible on CI** | the only way | pure new data cloud IPs can't fetch |

So: **yes to "a lot more data."** For pre-prints it's *completeness*, not a
faster clock; for references and working papers it's a real speed-up.

---

## Before you run anything

- **Location.** The app lives at the repo's **top-level `lit\`**, not
  `fun\lit\` (that's now just redirect stubs). All scripts here are under
  `lit\_scraper\`. On your machine that's
  `C:\Users\LENOVO\Dropbox\Others\GitHub\konstantinosStouras.github.io\lit\_scraper\`.
  If your local copy still shows the app under `fun\lit\`, you're behind
  `master` — `git pull` first.
- **Be on `master`.** The live site deploys from `master`; data pushed to any
  other branch won't show. The scripts warn you if you're not on `master`.
- **Node 20+** on your PATH (`node -v`). No `npm install` needed.
- **GitHub CLI** (`gh`) for the CI pause/resume scripts only. Install from
  <https://cli.github.com/>, then once: `gh auth login` (grant the **workflow**
  scope). Without `gh` you can still pause/resume manually in the repo's
  **Actions** tab.

## Separate OpenAlex quota identity (`+…local`)

OpenAlex meters its polite pool per `mailto`. Every CI job uses its own
plus-addressed identity (`kstouras+litrefs@gmail.com`, `+litcite`, …). The local
scripts here pin **their own `+…local` addresses** (`+litrefslocal`,
`+ft50citelocal`, `+litwplocal`, `+litpreprintslocal`, `+litlocal`) so a local
run **never spends CI's daily budget** and vice-versa. `preprints-local.mjs`
already does this on its own (defaults to `kostas.stouras@ucd.ie`); the wrappers
set a `+…local` gmail explicitly so every crawler is consistent.

---

## The scripts (all in `lit\_scraper\`, double-click or run from CMD)

### `run-local-crawlers.bat` — one-click, safe, unattended
Runs the two safe crawlers and commits/pushes for you:
1. **Pre-print links** (native `data/`) — the biggest visible win.
2. **FT50-catalog citations** (`data-ft50/`).

Both merge without clobbering CI, so **no workflow is paused**. Walk away; it
pushes to `master` when done.

### `crawl-blocked-sources.bat` — data CI can never fetch
Runs the cloud-blocked local scrapers in sequence and pushes:
ISR/MkSc **editors**, **Articles-in-Advance** (native + FT50), **PNAS
sections**. No CI pause needed (they write separate supplement files the daily
build folds in). If your home IP hits a Cloudflare challenge, set a cookie
first (see below).

### `crawl-econometrica.bat` — Econometrica forthcoming
Runs a `--dry-run` first (writes nothing) so you can confirm the parser found
papers, then prompts before writing to `data-ft50/` and pushing.

### `crawl-refs.bat` — citation graph (`data-refs/`) **[pauses CI]**
### `crawl-workingpapers.bat` — working papers (`data-workingpapers/`) **[pauses CI]**
These two datasets are the only ones where a CI backfill firing mid-crawl can
**overwrite your fuller local data** (their CI push does `git reset --hard` and
replays its own older copy). So each wrapper:
1. **Pauses** the clobber-risk CI workflows (`ci-pause-backfills.bat`),
2. runs the crawler continuously at a safe higher pace,
3. **Resumes** CI (`ci-resume-backfills.bat`) when it finishes,
4. offers to commit + push.

> ⚠️ **If you stop the crawler early with Ctrl+C**, Windows asks
> *"Terminate batch job (Y/N)?"* — press **N** so the script continues and
> re-enables CI. If in doubt, just run **`ci-resume-backfills.bat`** afterwards;
> it's safe to run any time. Leaving CI paused isn't destructive — the site
> simply won't auto-refresh those two datasets until you resume.

### `ci-pause-backfills.bat` / `ci-resume-backfills.bat` — the safety net
Disable / re-enable the three clobber-risk workflows
(`lit-references-backfill`, `lit-workingpapers-backfill`,
`lit-workingpapers-update-data`). The wrappers call these for you; run
`ci-resume-backfills.bat` manually if a crawl was ever hard-killed.

---

## Suggested order

1. **`run-local-crawlers.bat`** overnight, twice — fixes "OA links exist but
   don't show" (the arXiv-blocked papers) and the FT50 citation gap.
2. **`crawl-blocked-sources.bat`** — editors/AIA/PNAS, data CI can't get.
3. **`crawl-refs.bat`** for a day — clears the citation graph.
4. **`crawl-workingpapers.bat`** over a few days — the slowest backfill.
5. **`crawl-econometrica.bat`** whenever — quick.

That collapses the "months on its own" into roughly a weekend of mostly
hands-off runs.

---

## Equivalent manual commands (reference / non-Windows)

Run from the repo root after `git pull`. Use the `+…local` mailto so you never
spend CI's quota.

```bat
REM Pre-prints (native) — auto-uses a separate identity
cd lit\_scraper
set "LIT_MAILTO=kstouras+litpreprintslocal@gmail.com"
node preprints-local.mjs                 REM optional: --cap=4000  --source=ms,opre

REM FT50 citations
cd lit\_scraper-ft50
set "FT50_MAILTO=kstouras+ft50citelocal@gmail.com"
set "FT50_CITATIONS_BACKFILL_MS=14400000"
set "FT50_CITATIONS_MIN_AGE=2"            REM set 0 to force a full re-sweep
node citations-ci.mjs

REM Citation graph — pause CI first (ci-pause-backfills.bat)
cd lit\_scraper-refs
set "REFS_MAILTO=kstouras+litrefslocal@gmail.com"
set "REFS_MAX_PAPERS=1000000"
set "REFS_BUDGET_MS=86400000"
set "REFS_PACE_MS=120"                    REM 400 in CI; 120 is safe from home
node build-refs.mjs                       REM add: set "REFS_S2=0" to skip Semantic Scholar

REM Working papers — pause CI first
cd lit\_scraper-workingpapers
set "WP_MAILTO=kstouras+litwplocal@gmail.com"
set "WP_MAX_AUTHORS=1000000"
set "WP_BUDGET_MS=86400000"
set "WP_PACE_MS=400"                       REM 1500 in CI; 400 is safe from home
node build-data.mjs

REM Cloud-blocked (home IP required)
cd lit\_scraper
set "LIT_MAILTO=kstouras+litlocal@gmail.com"
node informs-editors-local.mjs            REM --max 500 to bound; resume-safe
node informs-aia-local.mjs --app lit
node informs-aia-local.mjs --app lit-ft50
node pnas-concepts-local.mjs              REM --full to force a re-crawl
node econometrica-forthcoming-local.mjs --dry-run   REM then without --dry-run
```

Then: `git add lit/data lit/data-ft50 lit/data-refs lit/data-workingpapers`,
`git commit`, `git pull --rebase origin master`, `git push origin master`.

### Cloudflare cookie (only if a blocked source is challenged from home)
If `informs-*`/`pnas-*` report a Cloudflare block, open the site in your
browser, copy the `cf_clearance` cookie from DevTools, and set:
```bat
set "LIT_CF_COOKIE=cf_clearance=<value>"
```
before running. The cookie expires, so long crawls may need re-cookieing.

## Manual pause/resume (no `gh`)
Repo → **Actions** → open each of **lit-references-backfill**,
**lit-workingpapers-backfill**, **lit-workingpapers-update-data** → **⋯ →
Disable workflow** before a `data-refs`/`data-workingpapers` crawl, and
**Enable workflow** after.

> These scripts only ever *add* data — a found pre-print link is frozen, a
> citation count only rises — so the merge-safe crawlers can't corrupt CI's work
> and vice-versa. The pause exists solely for the two `git reset --hard`
> backfills.
