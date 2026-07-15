@echo off
REM ==========================================================================
REM  run-local-crawlers.bat  -  Resilient, run-and-leave-it local crawler.
REM
REM  Loops forever over the two merge-safe datasets, committing + pushing after
REM  every ~20-minute slice:
REM     * Pre-print OA links    (lit/data)       - the biggest win
REM     * FT50 citation counts  (lit/data-ft50)
REM
REM  WHY IT SURVIVES A DISCONNECT / POWER-OFF WITH MINIMAL LOSS:
REM   - Each slice is committed + pushed, so the live database is at most one
REM     slice behind.
REM   - The scrapers checkpoint their on-disk cache continuously and write every
REM     file ATOMICALLY (temp + rename), so a power-off can never truncate a
REM     file. On the next run, startup first flushes whatever the interrupted
REM     run left on disk, so even the un-pushed slice reaches the database.
REM   - If the network drops, the push fails but the commit stays LOCAL and is
REM     pushed on the next slice - crawling never stops for a connectivity blip.
REM   - Resuming = just run this again; each scraper picks up from its cache.
REM
REM  These two datasets merge without clobbering CI, so NO workflow is paused.
REM  For the citation graph / working papers, use crawl-refs.bat /
REM  crawl-workingpapers.bat (those pause CI). Run ONE loop per clone.
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

REM --- single-instance advisory lock (git protects integrity either way) ---
if exist "%LOCK%" (
  if "%AUTO%"=="1" (
    del "%LOCK%" >nul 2>nul
  ) else (
    echo [NOTE] A crawl loop may already be running in this clone, or a previous
    echo        run was closed without cleaning up. Lock file:
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
echo   Commits + pushes after every ~20-min slice; a disconnect or
echo   power-off loses at most the current slice, and even that is
echo   recovered from the on-disk cache next time you run this.
echo   To stop: close this window or press Ctrl+C.
echo ============================================================

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
if exist "%LOCK%" del "%LOCK%" >nul 2>nul
:hardend
echo.
echo Stopped. (This script never pauses CI.)
if "%AUTO%"=="0" pause
exit /b 0

REM ===== :sync  <dirs>  <message>  -> commit + best-effort push; sets CHANGED ==
:sync
cd /d "%REPO%"
git add %~1 2>nul
git diff --cached --quiet
if not errorlevel 1 exit /b 0
git commit -q -m "lit: %~2" 1>nul 2>nul
set "CHANGED=1"
git pull --rebase origin master 1>nul 2>nul && git push origin master 1>nul 2>nul
if errorlevel 1 (
  echo   [%TIME%] committed locally ^(offline? - will push next slice^)
) else (
  echo   [%TIME%] pushed to master
)
exit /b 0
