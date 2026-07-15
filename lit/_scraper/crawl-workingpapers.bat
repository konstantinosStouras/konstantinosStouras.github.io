@echo off
REM ==========================================================================
REM  crawl-workingpapers.bat  -  Resilient local crawl of the WORKING PAPERS
REM  archive (lit/data-workingpapers). CI does this ~3% done over 35-40 DAYS; a
REM  continuous local run finishes in ~3-8 days.
REM
REM  Loops slice -> commit + push -> repeat, so a disconnect / power-off loses at
REM  most one ~20-min slice (the atomic on-disk cursor recovers even that on the
REM  next run). Network drops are non-fatal. data-workingpapers is a CLOBBER-RISK
REM  dataset, so this PAUSES the CI backfills for the session and RESUMES on a
REM  clean stop.
REM
REM  Usage:  crawl-workingpapers.bat            (interactive)
REM          crawl-workingpapers.bat -auto      (unattended)
REM ==========================================================================
setlocal enableextensions
title The Lit - resilient local crawl: working papers (data-workingpapers)

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
> "%LOCK%" echo crawl-workingpapers since %DATE% %TIME%

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
echo   LOCAL CRAWL (resilient) - Working papers (data-workingpapers)
echo   CI backfills for data-refs / data-workingpapers are PAUSED
echo   now and RESUMED when you stop cleanly.
echo   Commits + pushes after every ~20-min slice. This is the
echo   slowest backfill - expect it to run for a few days.
echo   To stop: close the window or Ctrl+C, then run
echo   ci-resume-backfills.bat to be sure CI is back on.
echo ============================================================

call "%~dp0ci-pause-backfills.bat" nopause
if errorlevel 1 (
  echo [ABORT] Could not pause CI backfills - NOT starting (so CI can't clobber).
  echo         Fix gh ^(gh auth login^) or pause the workflows manually, then retry.
  goto :end
)

call :sync "lit/data-workingpapers" "resume: flush pending working-papers data"

:cycle
  set "CHANGED=0"
  echo.
  echo [%TIME%] --- working-papers slice (20 min) ---
  cd /d "%REPO%\lit\_scraper-workingpapers"
  set "WP_MAILTO=kstouras+litwplocal@gmail.com"
  set "WP_MAX_AUTHORS=100000"
  set "WP_BUDGET_MS=1200000"
  set "WP_PACE_MS=400"
  node build-data.mjs
  call :sync "lit/data-workingpapers" "local working-papers (data-workingpapers) slice"

  if "%CHANGED%"=="0" (
    echo [%TIME%] Nothing new this cycle - re-checking in 30 min...
    timeout /t 1800 /nobreak >nul
  )
  goto :cycle

:end
echo.
echo Resuming CI backfills...
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
