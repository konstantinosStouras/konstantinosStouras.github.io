@echo off
REM ==========================================================================
REM  run-local-crawlers.bat  -  One-click, safe, unattended.
REM  Runs the two merge-safe crawlers and commits/pushes to master:
REM    1) Open-access PRE-PRINT links   (lit/data)      - the biggest win
REM    2) FT50-catalog CITATION counts  (lit/data-ft50)
REM  Both use a SEPARATE OpenAlex identity (+...local), so they never spend
REM  CI's daily quota, and their results merge without clobbering CI - so NO
REM  workflow needs to be paused here.
REM
REM  For the citation graph / working papers, use crawl-refs.bat /
REM  crawl-workingpapers.bat (those DO pause CI). See _LOCAL-CRAWLING.md.
REM ==========================================================================
setlocal
title Local crawlers (safe): pre-prints + FT50 citations

REM --- locate the repo root from this script's folder (lit\_scraper\) ---
pushd "%~dp0..\.."
set "REPO=%CD%"
popd

echo ============================================================
echo   THE LIT - safe local crawlers (unattended)
echo     1) Open-access pre-print links  ^(lit/data^)
echo     2) FT50-catalog citation counts ^(lit/data-ft50^)
echo   No CI workflow is paused: these merge without clobbering.
echo ============================================================
echo.

cd /d "%REPO%"

REM --- must be on master: the live site deploys from master ---
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="master" (
  echo [WARN] You are on branch "%BRANCH%", not master.
  echo        The live site deploys from master; data pushed elsewhere won't show.
  choice /m "Continue anyway"
  if errorlevel 2 goto :end
)

echo Pulling latest so the crawlers read current papers...
git pull --rebase origin master

REM ================= 1. pre-print links (native) =================
echo.
echo [1/2] Pre-print links (arXiv / SSRN / NBER / OSF / bioRxiv)...
cd /d "%REPO%\lit\_scraper"
set "LIT_MAILTO=kstouras+litpreprintslocal@gmail.com"
node preprints-local.mjs

REM ================= 2. FT50-catalog citations =================
echo.
echo [2/2] FT50-catalog citation counts...
cd /d "%REPO%\lit\_scraper-ft50"
set "FT50_MAILTO=kstouras+ft50citelocal@gmail.com"
set "FT50_CITATIONS_BACKFILL_MS=14400000"
set "FT50_CITATIONS_MIN_AGE=2"
node citations-ci.mjs

REM ================= commit + push =================
echo.
echo Committing and pushing new data to master...
cd /d "%REPO%"
git add lit/data lit/data-ft50
git diff --cached --quiet && ( echo No new data produced this run - nothing to push. & goto :end )
git commit -m "lit: local crawler refresh (pre-prints + FT50 citations)"
git pull --rebase origin master
git push origin master
echo Pushed. GitHub Pages will redeploy in a couple of minutes.

:end
echo.
echo All done.
pause
