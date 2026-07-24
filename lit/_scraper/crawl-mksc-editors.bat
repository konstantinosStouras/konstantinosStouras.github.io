@echo off
REM ==========================================================================
REM  crawl-mksc-editors.bat  -  MARKETING SCIENCE Senior Editors ONLY.
REM  Crawls pubsonline.informs.org (blocked for cloud IPs, so this must run
REM  on your own machine) for the Senior Editor of every listed Marketing
REM  Science paper of the LAST 20 YEARS, newest first (~1,700 pages, under an
REM  hour at the polite pace; resume-safe, so re-run in as many sittings as
REM  you like). It then APPLIES the names to the served papers-mksc.json and
REM  pushes, so the site's SE chips (e.g. "SE: Olivier Toubia") update as
REM  soon as the push deploys - no wait for the daily build.
REM  Pauses CI while it runs so the push is clean.
REM
REM  If Cloudflare challenges the connection, set a cookie first:
REM    set "LIT_CF_COOKIE=cf_clearance=<value from browser DevTools>"
REM    set "LIT_UA=<that browser's exact navigator.userAgent>"
REM  Still blocked? Use informs-editors-console.js in the browser instead
REM  (same output; run  node informs-editors-local.mjs --apply-only  after).
REM  For the full ISR+MkSc pass, run crawl-blocked-sources.bat.
REM ==========================================================================
setlocal
title Local crawl: Marketing Science Senior Editors (last 20 years)

pushd "%~dp0..\.."
set "REPO=%CD%"
popd

echo ============================================================
echo   MARKETING SCIENCE SENIOR EDITORS - last 20 years, newest first
echo   (pubsonline.informs.org - your home IP only)
echo   Crawl -^> apply to served papers-mksc.json -^> commit + push.
echo   Pauses CI while it runs so the push is clean.
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
  echo [ABORT] Could not pause CI - not starting, else the push would diverge.
  echo         Fix gh: run  gh auth login  then  gh auth refresh -s workflow
  goto :end
)
git pull --rebase origin master

set "LIT_MAILTO=kstouras+litlocal@gmail.com"
cd /d "%REPO%\lit\_scraper"

echo.
echo [1/1] Marketing Science Senior Editors (last 20 years; resume-safe)...
node informs-editors-local.mjs --journal mksc --last-years 20

echo.
echo Committing and pushing...
cd /d "%REPO%"
git add lit/data
git diff --cached --quiet && ( echo No changes produced this run. & goto :end )
git commit -m "lit: Marketing Science Senior Editor refresh (pubsonline crawl)"
git pull --rebase origin master
git push origin master
echo Pushed - the site updates when Pages deploys.

:end
echo.
echo Resuming CI...
call "%~dp0ci-resume-backfills.bat" nopause
echo Done. (Full ISR+MkSc pass: crawl-blocked-sources.bat)
pause
