@echo off
REM ==========================================================================
REM  crawl-refs.bat  -  Resilient local crawl of the in-catalog CITATION GRAPH
REM  (lit/data-refs). CI does this ~18% done over WEEKS; a continuous local run
REM  clears it in ~6-24 h.
REM
REM  Loops slice -> commit + push -> repeat, so a disconnect / power-off loses at
REM  most one ~20-min slice (and the atomic on-disk cache recovers even that on
REM  the next run). Network drops are non-fatal (commit stays local, pushes next
REM  slice). data-refs is a CLOBBER-RISK dataset, so this PAUSES the CI backfills
REM  for the whole session and RESUMES them when you stop cleanly.
REM
REM  Usage:  crawl-refs.bat            (interactive)
REM          crawl-refs.bat -auto      (unattended)
REM ==========================================================================
setlocal enableextensions
title The Lit - resilient local crawl: citation graph (data-refs)

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
> "%LOCK%" echo crawl-refs since %DATE% %TIME%

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
echo   LOCAL CRAWL (resilient) - Citation graph (lit/data-refs)
echo   CI backfills for data-refs / data-workingpapers are PAUSED
echo   now and RESUMED when you stop cleanly.
echo   Commits + pushes after every ~20-min slice. To stop, close
echo   the window or Ctrl+C, then run ci-resume-backfills.bat to be
echo   sure CI is back on.
echo ============================================================

call "%~dp0ci-pause-backfills.bat" nopause
if errorlevel 1 (
  echo [ABORT] Could not pause CI backfills - NOT starting (so CI can't clobber).
  echo         Fix gh ^(gh auth login^) or pause the workflows manually, then retry.
  goto :end
)

REM --- flush anything a previous interrupted run left uncommitted ---
call :sync "lit/data-refs" "resume: flush pending citation-graph data"

:cycle
  set "CHANGED=0"
  echo.
  echo [%TIME%] --- citation-graph slice (20 min) ---
  cd /d "%REPO%\lit\_scraper-refs"
  set "REFS_MAILTO=kstouras+litrefslocal@gmail.com"
  set "REFS_MAX_PAPERS=100000"
  set "REFS_BUDGET_MS=1200000"
  set "REFS_PACE_MS=120"
  REM  set "REFS_S2=0"   REM uncomment to skip the flaky Semantic Scholar leg
  node build-refs.mjs
  call :sync "lit/data-refs" "local citation-graph (data-refs) slice"

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
