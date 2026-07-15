@echo off
REM ==========================================================================
REM  crawl-blocked-sources.bat  -  Refresh the data GitHub Actions can NEVER
REM  fetch, because these publishers block datacenter IPs (Cloudflare/Atypon):
REM    - ISR / Marketing Science editors   (pubsonline.informs.org)
REM    - Articles-in-Advance, native + FT50 (pubsonline.informs.org)
REM    - PNAS section concepts             (pnas.org)
REM  Only your home machine can do this. Best run from a clone OUTSIDE Dropbox
REM  (see _LOCAL-CRAWLING.md). Pauses CI while it runs so the push is clean.
REM
REM  If a source reports a Cloudflare challenge, set a cookie first:
REM    set "LIT_CF_COOKIE=cf_clearance=<value from browser DevTools>"
REM  For Econometrica forthcoming, run crawl-econometrica.bat.
REM ==========================================================================
setlocal
title Local crawl: cloud-blocked sources (editors / AIA / PNAS)

pushd "%~dp0..\.."
set "REPO=%CD%"
popd

echo ============================================================
echo   CLOUD-BLOCKED SOURCES - data CI can never fetch
echo     1) ISR/MkSc editors        (pubsonline.informs.org)
echo     2) Articles-in-Advance     (native /lit)
echo     3) Articles-in-Advance     (FT50 catalog)
echo     4) PNAS section concepts   (pnas.org)
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
echo [1/4] INFORMS ISR/MkSc editors (first full pass can take ~2 h; resume-safe)...
node informs-editors-local.mjs

echo.
echo [2/4] Articles-in-Advance - native /lit...
node informs-aia-local.mjs --app lit

echo.
echo [3/4] Articles-in-Advance - FT50 catalog...
node informs-aia-local.mjs --app lit-ft50

echo.
echo [4/4] PNAS section concepts...
node pnas-concepts-local.mjs

echo.
echo Committing and pushing...
cd /d "%REPO%"
git add lit/data lit/data-ft50
git diff --cached --quiet && ( echo No changes produced this run. & goto :end )
git commit -m "lit: local refresh of cloud-blocked sources (editors/AIA/PNAS)"
git pull --rebase origin master
git push origin master
echo Pushed.

:end
echo.
echo Resuming CI...
call "%~dp0ci-resume-backfills.bat" nopause
echo Done. (For Econometrica forthcoming, run crawl-econometrica.bat.)
pause
