@echo off
REM ==========================================================================
REM  crawl-workingpapers.bat  -  Local crawl of the WORKING PAPERS archive
REM  (lit/data-workingpapers). CI does this ~3% done over 35-40 DAYS; a
REM  continuous local run at a safe higher pace finishes in ~3-8 days.
REM
REM  data-workingpapers is a CLOBBER-RISK dataset (its CI push does
REM  `git reset --hard`), so this script PAUSES the CI backfills, crawls, then
REM  RESUMES them. Uses a separate OpenAlex identity (+litwplocal).
REM ==========================================================================
setlocal
title Local crawl: working papers (data-workingpapers)

pushd "%~dp0..\.."
set "REPO=%CD%"
popd

echo ============================================================
echo   LOCAL CRAWL - Working papers (lit/data-workingpapers)
echo ------------------------------------------------------------
echo   CI backfills that touch data-refs / data-workingpapers will
echo   be PAUSED now and RESUMED when this finishes.
echo.
echo   *** If you stop early with Ctrl+C and Windows asks
echo   *** "Terminate batch job (Y/N)?", press N so CI resumes.
echo   *** If unsure, run ci-resume-backfills.bat afterwards.
echo   NOTE: this is the slowest backfill - expect several days.
echo ============================================================
echo.

cd /d "%REPO%"
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="master" (
  echo [WARN] You are on branch "%BRANCH%", not master.
  choice /m "Continue anyway"
  if errorlevel 2 goto :end
)

call "%~dp0ci-pause-backfills.bat" nopause
if errorlevel 1 (
  echo [ABORT] Could not pause CI backfills - NOT starting the crawl.
  echo         Fix gh ^(gh auth login^) or pause the workflows manually, then retry.
  goto :end
)

echo.
echo Pulling latest, then crawling working papers (Ctrl+C to stop)...
git pull --rebase origin master

cd /d "%REPO%\lit\_scraper-workingpapers"
set "WP_MAILTO=kstouras+litwplocal@gmail.com"
set "WP_MAX_AUTHORS=1000000"
set "WP_BUDGET_MS=86400000"
set "WP_PACE_MS=400"
node build-data.mjs

echo.
echo Crawl finished/stopped. Resuming CI backfills...
call "%~dp0ci-resume-backfills.bat" nopause

cd /d "%REPO%"
git add lit/data-workingpapers
git diff --cached --quiet && ( echo No new working-paper data to commit. & goto :end )
choice /m "Commit and push the new data-workingpapers to master now"
if errorlevel 2 goto :end
git commit -m "lit: local working-papers (data-workingpapers) refresh"
git pull --rebase origin master
git push origin master
echo Pushed.

:end
echo.
echo Done. (If CI might still be paused, run ci-resume-backfills.bat.)
pause
