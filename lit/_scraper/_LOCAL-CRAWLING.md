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
     ABS-grade scrapers therefore **cannot rely on CI** — they are
     local-first by design. (The ISR/MkSc editors crawl does keep a cheap
     standing CI attempt, `lit-editors-backfill.yml`, that exits cleanly in
     ~a minute whenever the runner is blocked — the usual outcome.)
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
| Editors / AIA / PNAS / Econometrica | **blocked on CI** (the editors job keeps trying 3-hourly, usually in vain) | the only reliable way | pure new data cloud IPs can't fetch |

So: **yes to "a lot more data."** For pre-prints it's *completeness*, not a
faster clock; for references and working papers it's a real speed-up.

---

## Before you run anything

> ### ⚠️ Do NOT run the crawler inside a Dropbox / OneDrive folder
> A sync client actively fights git: it **locks files** while the crawler
> renames them (`EPERM: operation not permitted`), and it **rewrites tracked
> files out of band** across your machines, which shows up as phantom "modified"
> files and a "diverged" branch that can't push. **Run the crawler from a clone
> OUTSIDE any synced folder**, e.g.:
> ```bat
> git clone https://github.com/konstantinosStouras/konstantinosStouras.github.io C:\dev\lit-crawler
> cd C:\dev\lit-crawler\lit\_scraper
> run-local-crawlers.bat
> ```
> Keep editing the site in your Dropbox clone if you like — just `git pull` it
> whenever you want the crawler's pushes. If a clone ever gets scrambled, run
> **`reset-to-remote.bat`** to snap it back to the live site.
> (The scrapers now retry the rename to ride out transient locks, but a
> dedicated non-synced clone avoids the whole class of problems.)

- **Location.** The app lives at the repo's **top-level `lit\`**, not
  `fun\lit\` (that's now just redirect stubs). All scripts here are under
  `lit\_scraper\`. If your local copy still shows the app under `fun\lit\`,
  you're behind `master` — `git pull` first.
- **Be on `master`.** The live site deploys from `master`; data pushed to any
  other branch won't show. The scripts warn you if you're not on `master`.
- **Node 20+** on your PATH (`node -v`). No `npm install` needed.
- **GitHub CLI** (`gh`) is **required** — every crawl script pauses CI while it
  runs (so your machine is the sole writer and pushes cleanly). Install from
  <https://cli.github.com/>, then once: `gh auth login` (grant the **workflow**
  scope). Without `gh` a crawl won't start; you can instead pause the 11
  `lit-*` data workflows by hand in the repo's **Actions** tab.

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
Loops over the two safe crawlers, committing + pushing after every ~20-minute
slice:
1. **Pre-print links** (native `data/`) — the biggest visible win.
2. **FT50-catalog citations** (`data-ft50/`).

It **pauses CI's data pipeline** while it runs so your machine is the *sole
writer* — otherwise CI commits to `master` every few minutes, your commit
diverges, `git pull --rebase` conflicts on the minified JSON, and **nothing
pushes**. CI is resumed when you stop. This is a bounded "burn down the backlog"
session, not 24/7: while it runs, CI's new-paper pickup and daily rebuilds are
paused. It keeps the live database continuously up to date and survives
disconnects/power-off with minimal loss (see **Resilience** below). To stop,
close the window or Ctrl+C. Run it again any time to resume.

### `full-local-refresh.bat` — one deep "harvest everything" pass
The heavy all-in-one alternative to `run-local-crawlers.bat`'s gentle loop: a
**full native rebuild + pre-prints + citations**, then the **same for the FT50
catalog**, committing + pushing each dataset. Use it when you want a single deep
pass (it runs for a few hours) rather than the continuous slice loop. It pauses
CI (sole writer) and resumes it at the end, and — like every script here —
routes every push through the same **self-healing git sync** (below), so it can
never wedge on a half-finished rebase or a non-fast-forward push. It starts each
run from a clean `origin/master` (after first flushing any pending finds), so a
scrambled clone can't block it. This is the maintained replacement for a
hand-written "run all the manual commands" batch file — prefer it over pasting
the reference commands below, because those, run bare, hit exactly the git
failure in **Troubleshooting**.

### `crawl-refs.bat` — citation graph (`data-refs/`)
### `crawl-workingpapers.bat` — working papers (`data-workingpapers/`)
Same resilient slice→commit→push loop as `run-local-crawlers.bat`, for the two
slow backfills. Like every crawl script they **pause CI** for the session (sole
writer) and **resume** it when you stop cleanly.

### `crawl-blocked-sources.bat` — data CI can not reliably fetch
Runs the cloud-blocked local scrapers in sequence and pushes:
ISR/MkSc **editors**, **Articles-in-Advance** (native + FT50), **PNAS
sections** — data whose hosts block datacenter IPs. Pauses CI while it runs. If
your home IP hits a Cloudflare challenge, set a cookie first (see below).

### `crawl-econometrica.bat` — Econometrica forthcoming
Runs a `--dry-run` first (writes nothing) so you can confirm the parser found
papers, then prompts before writing to `data-ft50/` and pushing. Pauses CI.

> ⚠️ **If you stop a crawler early with Ctrl+C**, Windows asks
> *"Terminate batch job (Y/N)?"* — press **N** so the script continues and
> re-enables CI. If in doubt, just run **`ci-resume-backfills.bat`** afterwards;
> it's safe to run any time. Leaving CI paused isn't destructive — the site
> simply won't auto-refresh until you resume.

### `install-autostart.bat` / `uninstall-autostart.bat` — optional
Register (or remove) a Windows Scheduled Task that starts
`run-local-crawlers.bat` at **logon**, so after a reboot / power-off the crawler
resumes on its own. Note it pauses CI while running, so it suits a focused
backlog-clearing period — **uninstall it once the backlog is cleared** so CI's
normal cadence takes over.

### `ci-pause-backfills.bat` / `ci-resume-backfills.bat`
Disable / re-enable the **11 `lit-*` data workflows** (native, FT50, refs and
working-papers) so a local crawl is the sole writer of the datasets. The crawl
scripts call these for you; run `ci-resume-backfills.bat` manually if a crawl
was ever hard-killed and left CI paused.

### `reset-to-remote.bat` — recover a scrambled clone
Discards all local commits and uncommitted changes and snaps the working tree
back to `origin/master` (the live site). Use it if `git status` shows the branch
has *diverged* or lists data files you didn't intend to change (classic Dropbox
interference). Un-pushed local finds are simply re-found on the next crawl.

---

## Resilience — survives disconnects & power-off with minimal loss

The crawlers are built so an interrupted run loses almost nothing and resuming
is just re-running:

- **Sole writer.** Each crawl pauses CI's data pipeline so your machine is the
  only thing committing those files, and pushes fast-forward cleanly instead of
  diverging from CI and failing.
- **Continuous sync.** Each loop does a ~20-minute slice, then commits + pushes,
  so the live database is at most one slice behind.
- **Atomic writes (retried).** Every data/cache file is written to a temp file
  and `rename`d into place (atomic on NTFS), so a power-off mid-write can never
  leave a truncated JSON for `git add` to commit. If a sync client briefly locks
  the file (`EPERM`), the rename is retried before falling back to an in-place
  write — so Dropbox/OneDrive/antivirus can't crash the crawl (though a
  non-synced clone is still strongly preferred — see the top of this file).
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
node informs-editors-local.mjs            REM MkSc first (newest first); --max 500 / --journal mksc /
                                          REM --last-years 20 to bound; resume-safe. Ends by APPLYING
                                          REM the cache to the served papers files (--no-apply skips;
                                          REM --apply-only = apply without crawling, e.g. after a
                                          REM console harvest). One-click MkSc: crawl-mksc-editors.bat
                                          REM CI also attempts this crawl on its own every 3 h
                                          REM (lit-editors-backfill.yml; exits cleanly when the runner
                                          REM is blocked) - it is in the pause list like the others.
node informs-abstracts-local.mjs          REM FULL abstracts for INFORMS papers whose Crossref deposit
                                          REM is a one-line teaser (MkSc first, only needy rows ~800
                                          REM pages; upgrade-only apply). Cloudflare-blocked? paste
                                          REM informs-abstracts-console.js in the browser, then
                                          REM node informs-abstracts-local.mjs --apply-only
node informs-aia-local.mjs --app lit
node informs-aia-local.mjs --app lit-ft50
node pnas-concepts-local.mjs              REM --full to force a re-crawl
node econometrica-forthcoming-local.mjs --dry-run   REM then without --dry-run
```

Then commit + push. Do it in the **self-healing order** the wrapper scripts use,
so a leftover half-finished rebase can't wedge the push (see **Troubleshooting**):

```bat
git rebase --abort 2>nul & git merge --abort 2>nul   REM clear any stale rebase/merge
git add lit/data lit/data-ft50 lit/data-refs lit/data-workingpapers
git commit -m "lit: local refresh"
git pull --rebase origin master || git rebase --abort   REM abort on conflict, keep your commit
git push origin master
```

If the push is still rejected as non-fast-forward, re-run the `git pull --rebase`
+ `git push` pair (CI committed while you were crawling — pause it first), or, to
just start clean, run `reset-to-remote.bat`.

### Cloudflare cookie (only if a blocked source is challenged from home)
If `informs-*`/`pnas-*` report a Cloudflare block, open the site in your
browser, copy the `cf_clearance` cookie from DevTools, and set:
```bat
set "LIT_CF_COOKIE=cf_clearance=<value>"
```
before running. The cookie expires, so long crawls may need re-cookieing.

## Troubleshooting

### Push rejected: `! [rejected] master -> master (non-fast-forward)`
Your local `master` is behind the remote, so git won't push over it. It almost
always comes with (or is caused by) the rebase error below. The cause is a
**second writer**: CI (or another clone) pushed to `master` while your crawl
was running — which is exactly why every crawl script **pauses CI first** so
your machine is the sole writer. To recover, integrate the remote commits, then
push again:

```bat
git rebase --abort 2>nul & git merge --abort 2>nul   REM clear any half-finished rebase
git pull --rebase origin master
git push origin master
```

If the `git pull --rebase` reports a conflict (the minified JSON data files
diverged), the simplest fix is to discard your un-pushed local finds and snap
back to the live site with **`reset-to-remote.bat`** — the crawlers re-find them
on the next run (a found pre-print link is frozen, a citation count only rises,
so nothing is truly lost). Then make sure CI is paused (`ci-pause-backfills.bat`)
before you crawl again.

### `git pull --rebase` stops: "there is already a rebase-merge directory"
```
It seems that there is already a rebase-merge directory ...
If that is not the case, please
        rm -fr ".git/rebase-merge"
and run me again. I am stopping in case you still have something valuable there.
```
A **previous** rebase was interrupted (Ctrl+C, a power-off, or a conflict during
`git pull --rebase`) and left `.git/rebase-merge/` on disk. git refuses to start
a new rebase until it's cleared — and because the pull never runs, your next
`git push` is rejected as non-fast-forward (above). This is the failure a
hand-written `pull --rebase` + `push` sequence hits; the wrapper scripts avoid
it by clearing a stale rebase up front and aborting a conflicting one. To clear
it by hand:

```bat
git rebase --abort            REM the clean way to remove .git/rebase-merge
git pull --rebase origin master
git push origin master
```

**If `git rebase --abort` says `No rebase in progress?` but the error keeps
happening**, the leftover directory is stale/corrupt — `--abort` won't remove it
and neither will `git reset --hard`, so delete it by hand. git's own message
suggests `rm -fr ".git/rebase-merge"`, which is **Unix** syntax; in a **Windows
CMD** window use:

```bat
rmdir /s /q .git\rebase-merge
git pull --rebase origin master
git push origin master
```

(In Git Bash the `rm -rf .git/rebase-merge` git prints works as-is. Your local
crawl commit is safe — an interrupted rebase never moves the `master` ref — so
the `pull --rebase` replays it onto the fresh tip.) The maintained
**`full-local-refresh.bat`** and **`reset-to-remote.bat`** now do all of this for
you (they `--abort`, then force-remove any surviving rebase dir), so re-running
either from a stuck clone self-heals.

## Manual pause/resume (no `gh`)
Repo → **Actions** → open each of **lit-references-backfill**,
**lit-workingpapers-backfill**, **lit-workingpapers-update-data** → **⋯ →
Disable workflow** before a `data-refs`/`data-workingpapers` crawl, and
**Enable workflow** after.

> These scripts only ever *add* data — a found pre-print link is frozen, a
> citation count only rises — so the merge-safe crawlers can't corrupt CI's work
> and vice-versa. The pause exists solely for the two `git reset --hard`
> backfills.
