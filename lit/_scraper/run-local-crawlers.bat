@echo off
REM ==========================================================================
REM  run-local-crawlers.bat  -  Resilient, run-and-leave-it local crawler for
REM  the two safe datasets: pre-print OA links (lit/data) + FT50 citation counts
REM  (lit/data-ft50). Loops ~20-min slices, committing + pushing each one.
REM
REM  IMPORTANT - it PAUSES CI's data pipeline while it runs, so your machine is
REM  the SOLE writer and pushes fast-forward cleanly (otherwise CI commits every
REM  few minutes, your commit diverges, and nothing pushes). CI is resumed when
REM  you stop. This is a bounded "burn down the backlog" session; while it runs,
REM  CI's new-paper pickup and daily rebuilds are paused.
REM
REM  BEST PRACTICE: run this from a clone OUTSIDE Dropbox/OneDrive. A sync client
REM  fights git (locks files -> EPERM, rewrites tracked files out of band). See
REM  _LOCAL-CRAWLING.md.
REM
REM  Usage:  run-local-crawlers.bat            (interactive)
REM          run-local-crawlers.bat -auto      (unattended; used by autostart)
REM ==========================================================================
setlocal enableextensions
title The Lit - resilient local crawlers (pre-prints + FT50 citations)

set "AUTO=0"
if /i "%~1"=="-auto" set "AUTO=1"

pushd "%~dp0..\.."
set "REPO=%CD%"
popd
set "LOCK=%REPO%\.crawl-running.lock"

if exist "%LOCK%" (
  if "%AUTO%"=="1" ( del "%LOCK%" >nul 2>nul ) else (
    echo [NOTE] A crawl loop may already be running in this clone. Lock file:
    echo            %LOCK%
    choice /m "Start anyway (choose N if another crawler is running)"
    if errorlevel 2 goto :hardend
    del "%LOCK%" >nul 2>nul
  )
)
> "%LOCK%" echo run-local-crawlers since %DATE% %TIME%

cd /d "%REPO%"
set "BRANCH="
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if /i not "%BRANCH%"=="master" (
  if "%AUTO%"=="0" (
    echo [WARN] On branch "%BRANCH%", not master; the live site deploys from master.
    choice /m "Continue anyway"
    if errorlevel 2 goto :end
  )
)

echo ============================================================
echo   THE LIT - resilient local crawlers  (leave this running)
echo     * Pre-print links   (lit/data)
echo     * FT50 citations    (lit/data-ft50)
echo   Pausing CI's data pipeline so this machine is the sole
echo   writer; commits + pushes after every ~20-min slice.
echo   To stop: close this window or press Ctrl+C, then run
echo   ci-resume-backfills.bat to turn CI back on.
echo ============================================================

REM --- make this the sole writer, else local diverges from CI and can't push ---
call "%~dp0ci-pause-backfills.bat" nopause
if errorlevel 1 (
  echo [ABORT] Could not pause CI - not starting, else local diverges from CI
  echo         and cannot push. Fix gh: run  gh auth login  then
  echo         gh auth refresh -s workflow  - or pause the 11 lit-* workflows
  echo         manually in the Actions tab, then retry.
  goto :end
)

REM --- flush anything a previous interrupted run left uncommitted ---
call :sync "lit/data lit/data-ft50" "resume: flush pending local crawl data"

:cycle
  set "CHANGED=0"

  echo.
  echo [%TIME%] --- pre-print slice (cap 250) ---
  cd /d "%REPO%\lit\_scraper"
  set "LIT_MAILTO=kstouras+litpreprintslocal@gmail.com"
  node preprints-local.mjs --cap=250
  call :sync "lit/data" "local pre-print links (slice)"

  echo.
  echo [%TIME%] --- FT50 citation slice (20 min) ---
  cd /d "%REPO%\lit\_scraper-ft50"
  set "FT50_MAILTO=kstouras+ft50citelocal@gmail.com"
  set "FT50_CITATIONS_BACKFILL_MS=1200000"
  set "FT50_CITATIONS_MIN_AGE=2"
  node citations-ci.mjs
  call :sync "lit/data-ft50" "local FT50 citation counts (slice)"

  if "%CHANGED%"=="0" (
    echo.
    echo [%TIME%] Caught up - nothing new this cycle. Re-checking in 30 min...
    timeout /t 1800 /nobreak >nul
  )
  goto :cycle

:end
echo.
echo Resuming CI data workflows...
call "%~dp0ci-resume-backfills.bat" nopause
if exist "%LOCK%" del "%LOCK%" >nul 2>nul
:hardend
echo.
echo Stopped. (If CI might still be paused, run ci-resume-backfills.bat.)
if "%AUTO%"=="0" pause
exit /b 0

REM ===== :sync  <dirs>  <message>  -> commit + push; sets CHANGED on a commit ==
:sync
cd /d "%REPO%"
git add %~1
git diff --cached --quiet && exit /b 0
git commit -q -m "lit: %~2"
if errorlevel 1 ( echo   [%TIME%] nothing committed & exit /b 0 )
set "CHANGED=1"
git pull --rebase origin master
if errorlevel 1 git rebase --abort 1>nul 2>nul
git push origin master
if errorlevel 1 (
  echo   [%TIME%] push failed - committed locally, will retry next slice
) else (
  echo   [%TIME%] pushed to master
)
exit /b 0
