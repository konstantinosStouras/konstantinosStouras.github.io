@echo off
REM ==========================================================================
REM  full-local-refresh.bat  -  One-shot "harvest everything from home" run:
REM  a full NATIVE rebuild + pre-prints + citations, then the same for the
REM  FT50 catalog, committing + pushing each dataset with a SELF-HEALING git
REM  sync. This is the heavy all-in-one alternative to run-local-crawlers.bat
REM  (which loops gentle ~20-min slices) - use this when you want a single
REM  deep pass and are happy for it to run for a few hours.
REM
REM  WHY THIS EXISTS / what it fixes vs. a hand-written sequence:
REM    A bare `git pull --rebase origin master` then `git push` breaks in two
REM    ways that stall a local crawl:
REM      1. A PREVIOUS run was interrupted mid-rebase (Ctrl+C, or CI pushed to
REM         master and a conflict stopped the rebase), leaving a stale
REM         .git/rebase-merge dir. The next `git pull --rebase` then refuses:
REM             "there is already a rebase-merge directory ... I am stopping"
REM         and because the pull never ran, the following push is rejected:
REM             "! [rejected]  master -> master (non-fast-forward)".
REM      2. Any pull/push error is ignored and the script barrels on.
REM    This script clears a stale rebase/merge up front and routes every push
REM    through :sync, which aborts a conflicting rebase and retries the push,
REM    so it can never strand a commit or wedge on a half-finished rebase.
REM
REM  BEST PRACTICE: run from a clone OUTSIDE Dropbox/OneDrive (a sync client
REM  fights git). See _LOCAL-CRAWLING.md. Requires Node 20+, GitHub CLI (gh,
REM  authenticated with the workflow scope), and being on master.
REM
REM  Usage:  full-local-refresh.bat            (interactive; pauses at the end)
REM          full-local-refresh.bat -auto      (unattended; no final pause)
REM ==========================================================================
setlocal enableextensions
title The Lit - full local refresh (native + FT50: papers, pre-prints, citations)

set "AUTO=0"
if /i "%~1"=="-auto" set "AUTO=1"

REM --- resolve the repo root from THIS script's location (location-independent,
REM     so it no longer matters where the clone lives) ---
pushd "%~dp0..\.."
set "REPO=%CD%"
popd
cd /d "%REPO%"

REM --- must be on master (the live site deploys from master) ---
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="master" (
  echo [WARN] On branch "%BRANCH%", not master; the live site deploys from master.
  if "%AUTO%"=="0" (
    choice /m "Continue anyway"
    if errorlevel 2 goto :end
  )
)

REM --- 0) SOLE WRITER - pause CI first (needs a one-time `gh auth login`), else
REM        CI pushes to master every few minutes and the push at the end is
REM        rejected as non-fast-forward. ---
call "%~dp0ci-pause-backfills.bat" nopause
if errorlevel 1 (
  echo [ABORT] Could not pause CI - fix gh auth first ^(gh auth login;
  echo         gh auth refresh -s workflow^), or pause the lit-* workflows by
  echo         hand in the Actions tab. Not starting, else local diverges from
  echo         CI and cannot push.
  goto :end
)

REM --- clear any half-finished rebase/merge a previous interrupted run left
REM     behind (this is the exact state that makes `git pull --rebase` stop
REM     with "there is already a rebase-merge directory"). Harmless no-ops when
REM     nothing is in progress. ---
git rebase --abort 1>nul 2>nul
git merge  --abort 1>nul 2>nul

REM --- flush anything a previous interrupted run left uncommitted/unpushed
REM     BEFORE the reset below, so those finds are not discarded ---
git fetch origin master
call :sync "lit/data lit/data-ft50" "resume: flush pending local crawl data"

REM --- start the full harvest from a clean copy of the live site. CAREFUL:
REM     reset --hard discards un-pushed local commits - the flush above pushes
REM     them first; anything still unpushed (e.g. CI was not actually paused)
REM     is simply re-found on this run, since the crawlers are additive. ---
git fetch origin master
git reset --hard origin/master

REM =========================== NATIVE (lit/data) ============================
REM  1) NATIVE full harvest (~15-30 min; writes only at the very end)
set "LIT_MAILTO=kstouras+litlocal@gmail.com"
node lit\_scraper\build-data.mjs

REM  2) NATIVE pre-prints - arXiv leg ON by default here, and it WORKS from a
REM     home IP (this is what clears the naxiv backlog CI can never resolve).
REM     Resume-safe, checkpoints every 200 searches, no time budget. Add
REM     --cap=N to bound a session.
set "LIT_MAILTO=kstouras+litpreprintslocal@gmail.com"
node lit\_scraper\preprints-local.mjs

REM  3) NATIVE citations - own quota identity + a 4h budget instead of 45 min
set "LIT_MAILTO=kstouras+litcitelocal@gmail.com"
set "LIT_CITATIONS_BACKFILL_MS=14400000"
node lit\_scraper\citations-ci.mjs

call :sync "lit/data" "local refresh - native papers, pre-prints, citations"

REM ======================= FT50 catalog (lit/data-ft50) =====================
REM  5) FT50 catalog - ALWAYS set FT50_MAILTO: the scripts otherwise identify
REM     as kstouras@gmail.com and burn CI's OpenAlex quota.
set "FT50_MAILTO=kstouras+litft50local@gmail.com"
node lit\_scraper-ft50\build-data.mjs

REM  5a) Pre-prints stage 1 - fast Crossref sweep (arXiv off, the default):
REM      finds SSRN/NBER/bioRxiv/OSF links at ~2 papers/s. 4h budget; re-run to
REM      continue (resume-safe). Fresh identity also revives the cheap OpenAlex
REM      by-DOI seeding (50 papers/call).
set "FT50_PREPRINT_BACKFILL_MS=14400000"
node lit\_scraper-ft50\preprints-ci.mjs

REM  5b) Pre-prints stage 2 - arXiv pass for the ~40k naxiv pile (papers
REM      Crossref already missed; only arXiv/OpenAlex can still find these).
REM      ~3.1s/paper, so run it overnight; repeat over several evenings.
set "FT50_PREPRINT_ARXIV=1"
set "FT50_PREPRINT_BACKFILL_MS=28800000"
node lit\_scraper-ft50\preprints-ci.mjs
set "FT50_PREPRINT_ARXIV="

REM  5c) FT50 citations - own identity + 4h budget (sweeps ~all 257k in ~95 min)
set "FT50_MAILTO=kstouras+ft50citelocal@gmail.com"
set "FT50_CITATIONS_BACKFILL_MS=14400000"
set "FT50_CITATIONS_MIN_AGE=2"
node lit\_scraper-ft50\citations-ci.mjs

call :sync "lit/data-ft50" "local refresh - FT50 papers, pre-prints, citations"

:end
REM --- 6) ALWAYS turn CI back on (safe to run any time) ---
echo.
echo Resuming CI data workflows...
call "%~dp0ci-resume-backfills.bat" nopause
echo.
echo Done. CI is back on its normal schedule.
if "%AUTO%"=="0" pause
exit /b 0

REM ===== :sync  <dirs>  <message> ===========================================
REM  Stage <dirs>, commit if anything changed, then push with a SELF-HEALING
REM  retry: on a diverged/rejected push it rebases onto the fresh tip, aborts
REM  the rebase if it conflicts (keeping the local commit), and retries. Never
REM  wedges on a half-finished rebase; never loses a commit (an unpushable
REM  commit stays local and goes out on the next run).
:sync
cd /d "%REPO%"
git add %~1
REM Commit if anything is staged; when nothing is staged `git commit` is a
REM harmless no-op and its non-zero exit is ignored. A prior commit that is
REM merely unpushed is still pushed by the loop below.
git commit -q -m "lit: %~2" 1>nul 2>nul
set "TRIES=0"
:pushloop
git pull --rebase origin master
if errorlevel 1 (
  echo   [%TIME%] rebase conflicted - aborting it, keeping your local commit
  git rebase --abort 1>nul 2>nul
)
git push origin master
if not errorlevel 1 (
  echo   [%TIME%] pushed %~1 to master
  exit /b 0
)
set /a TRIES+=1
if %TRIES% GEQ 5 (
  echo   [%TIME%] push still failing after %TRIES% tries - commit is saved
  echo            locally and will go out on the next run.
  exit /b 0
)
echo   [%TIME%] push rejected - re-syncing and retrying (%TRIES%/5)...
timeout /t 3 /nobreak >nul
goto :pushloop
