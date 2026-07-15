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

### `run-local-crawlers.bat` — resilient, run-and-leave-it
Loops **forever** over the two safe crawlers, committing + pushing after every
~20-minute slice:
1. **Pre-print links** (native `data/`) — the biggest visible win.
2. **FT50-catalog citations** (`data-ft50/`).

Both merge without clobbering CI, so **no workflow is paused**. Leave it
running; it keeps the live database continuously up to date and survives
disconnects/power-off with minimal loss (see **Resilience** below). To stop,
close the window or Ctrl+C. Run it again any time to resume.

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
Same resilient slice→commit→push loop as above, for the two datasets where a CI
backfill firing mid-crawl could **overwrite your fuller local data** (their CI
push does `git reset --hard` and replays its own older copy). So each wrapper:
1. **Pauses** the clobber-risk CI workflows (`ci-pause-backfills.bat`),
2. loops the crawler in ~20-min slices at a safe higher pace, committing +
   pushing each slice,
3. **Resumes** CI (`ci-resume-backfills.bat`) when you stop it cleanly.

> ⚠️ **If you stop the crawler early with Ctrl+C**, Windows asks
> *"Terminate batch job (Y/N)?"* — press **N** so the script continues and
> re-enables CI. If in doubt, just run **`ci-resume-backfills.bat`** afterwards;
> it's safe to run any time. Leaving CI paused isn't destructive — the site
> simply won't auto-refresh those two datasets until you resume.

### `install-autostart.bat` / `uninstall-autostart.bat` — optional
Register (or remove) a Windows Scheduled Task that starts
`run-local-crawlers.bat` at **logon**, so after a reboot / power-off the crawler
resumes on its own. It only autostarts the safe datasets (no CI pause). Runs in
the background; stop it via `uninstall-autostart.bat` + closing its process.

### `ci-pause-backfills.bat` / `ci-resume-backfills.bat` — the safety net
Disable / re-enable the three clobber-risk workflows
(`lit-references-backfill`, `lit-workingpapers-backfill`,
`lit-workingpapers-update-data`). The wrappers call these for you; run
`ci-resume-backfills.bat` manually if a crawl was ever hard-killed.

---

## Resilience — survives disconnects & power-off with minimal loss

The crawlers are built so an interrupted run loses almost nothing and resuming
is just re-running:

- **Continuous sync.** Each loop does a ~20-minute slice, then commits + pushes,
  so the live database is at most one slice behind.
- **Atomic writes.** Every data/cache file is written to a temp file and
  `rename`d into place (atomic on NTFS). A power-off mid-write can never leave a
  truncated JSON — a reader (and `git add`) always sees the old complete file or
  the new complete one. This is what makes auto-commit safe.
- **Startup flush.** On launch, each loop first commits + pushes anything a
  previous interrupted run left on disk, so even the un-pushed slice reaches the
  database — you don't lose the work between the last push and the crash.
- **Network-drop tolerant.** If a push fails (offline), the commit stays local
  and is pushed on the next slice; crawling never stops for a connectivity blip.
- **Resume = re-run.** Each scraper reads its own cache/cursor
  (`_preprints.json`, `_citations.json`, `_refs-cache.json`, `_authors.json`)
  and only crawls what isn't done. No progress is repeated.
- **Auto-resume on reboot** (optional): `install-autostart.bat`.

**Net:** a power-off loses at most the crawler's in-memory work since its last
checkpoint (seconds–minutes); everything already on disk re-syncs on the next
run. The permanent-loss window is tiny.

**One loop per clone.** All the loops commit to the same git working tree, so
run **one at a time** (a `.crawl-running.lock` file guards against accidental
double-runs — if a run is killed, the next start just offers to take over, or
delete `.crawl-running.lock`). To crawl several datasets truly in parallel, use
separate clones of the repo.

---

## Suggested order

1. **`run-local-crawlers.bat`** — leave it running (optionally
   `install-autostart.bat` so it survives reboots). Fixes "OA links exist but
   don't show" (the arXiv-blocked papers) and the FT50 citation gap.
2. **`crawl-blocked-sources.bat`** — editors/AIA/PNAS, data CI can't get.
3. **`crawl-refs.bat`** for a day — clears the citation graph.
4. **`crawl-workingpapers.bat`** over a few days — the slowest backfill.
5. **`crawl-econometrica.bat`** whenever — quick.

Run one loop at a time per clone (see **Resilience** above). A practical
rhythm: keep `run-local-crawlers.bat` on autostart for the everyday datasets,
and when you want to burn down the citation graph or working papers, stop it and
run `crawl-refs.bat` / `crawl-workingpapers.bat` for a day or two.

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
