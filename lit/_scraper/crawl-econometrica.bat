@echo off
REM ==========================================================================
REM  crawl-econometrica.bat  -  Refresh Econometrica FORTHCOMING papers
REM  (accepted, not yet in an issue - Crossref never lists these) from
REM  econometricsociety.org, which blocks datacenter IPs. Home machine only.
REM  Writes jkey:"ecta" rows into lit/data-ft50/_informs-aia.json.
REM
REM  Runs a --dry-run FIRST (writes nothing) so you can confirm the listing
REM  parser found papers before touching the dataset - as the scraper's own
REM  header advises.
REM ==========================================================================
setlocal
title Local crawl: Econometrica forthcoming

pushd "%~dp0..\.."
set "REPO=%CD%"
popd

cd /d "%REPO%"
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="master" (
  echo [WARN] You are on branch "%BRANCH%", not master.
  choice /m "Continue anyway"
  if errorlevel 2 goto :end
)
git pull --rebase origin master

set "LIT_MAILTO=kstouras+litlocal@gmail.com"
cd /d "%REPO%\lit\_scraper"

echo ============================================================
echo   Econometrica FORTHCOMING papers (econometricsociety.org)
echo   Step 1: --dry-run (writes nothing) - check the list below.
echo ============================================================
node econometrica-forthcoming-local.mjs --dry-run

echo.
echo ------------------------------------------------------------
echo   If the dry-run listed forthcoming papers, continue to write
echo   them into lit/data-ft50. If it found ZERO, STOP and see
echo   _LOCAL-CRAWLING.md - the listing parser may need updating.
echo ------------------------------------------------------------
choice /m "Write the forthcoming papers and push"
if errorlevel 2 ( echo Skipped - nothing written. & goto :end )

call "%~dp0ci-pause-backfills.bat" nopause
if errorlevel 1 ( echo [ABORT] Could not pause CI - the push would diverge. & goto :end )

node econometrica-forthcoming-local.mjs

cd /d "%REPO%"
git add lit/data-ft50
git diff --cached --quiet && ( echo No changes produced. & goto :end )
git commit -m "lit: local refresh of Econometrica forthcoming papers"
git pull --rebase origin master
git push origin master
echo Pushed.

:end
echo.
echo Resuming CI...
call "%~dp0ci-resume-backfills.bat" nopause
echo Done.
pause
