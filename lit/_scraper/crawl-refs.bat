@echo off
REM ==========================================================================
REM  crawl-refs.bat  -  Local crawl of the in-catalog CITATION GRAPH
REM  (lit/data-refs). CI does this ~18% done over WEEKS; a continuous local
REM  run at a safe higher pace clears it in ~6-24 h.
REM
REM  data-refs is a CLOBBER-RISK dataset (its CI push does `git reset --hard`),
REM  so this script PAUSES the CI backfills, crawls, then RESUMES them.
REM  Uses a separate OpenAlex identity (+litrefslocal) - never spends CI quota.
REM ==========================================================================
setlocal
title Local crawl: citation graph (data-refs)

pushd "%~dp0..\.."
set "REPO=%CD%"
popd

echo ============================================================
echo   LOCAL CRAWL - Citation graph (lit/data-refs)
echo ------------------------------------------------------------
echo   CI backfills that touch data-refs / data-workingpapers will
echo   be PAUSED now and RESUMED when this finishes.
echo.
echo   *** If you stop early with Ctrl+C and Windows asks
echo   *** "Terminate batch job (Y/N)?", press N so CI resumes.
echo   *** If unsure, run ci-resume-backfills.bat afterwards.
echo ============================================================
echo.

REM --- must be on master ---
cd /d "%REPO%"
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="master" (
  echo [WARN] You are on branch "%BRANCH%", not master.
  choice /m "Continue anyway"
  if errorlevel 2 goto :end
)

REM --- pause CI; abort the crawl if we can't (so CI can't clobber us) ---
call "%~dp0ci-pause-backfills.bat" nopause
if errorlevel 1 (
  echo [ABORT] Could not pause CI backfills - NOT starting the crawl.
  echo         Fix gh ^(gh auth login^) or pause the workflows manually, then retry.
  goto :end
)

echo.
echo Pulling latest, then crawling references (Ctrl+C to stop)...
git pull --rebase origin master

cd /d "%REPO%\lit\_scraper-refs"
set "REFS_MAILTO=kstouras+litrefslocal@gmail.com"
set "REFS_MAX_PAPERS=1000000"
set "REFS_BUDGET_MS=86400000"
set "REFS_PACE_MS=120"
REM  set "REFS_S2=0"   REM uncomment to skip the flaky Semantic Scholar leg
node build-refs.mjs

echo.
echo Crawl finished/stopped. Resuming CI backfills...
call "%~dp0ci-resume-backfills.bat" nopause

REM --- commit + push data-refs ---
cd /d "%REPO%"
git add lit/data-refs
git diff --cached --quiet && ( echo No new reference data to commit. & goto :end )
choice /m "Commit and push the new data-refs to master now"
if errorlevel 2 goto :end
git commit -m "lit: local citation-graph (data-refs) refresh"
git pull --rebase origin master
git push origin master
echo Pushed.

:end
echo.
echo Done. (If CI might still be paused, run ci-resume-backfills.bat.)
pause
