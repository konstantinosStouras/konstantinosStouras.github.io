@echo off
REM ==========================================================================
REM  ci-pause-backfills.bat  -  Pause the CI backfills that can overwrite local
REM  data while you crawl data-refs / data-workingpapers from home.
REM
REM  Those two workflows push with `git reset --hard origin` + replay-own-copy,
REM  so a run firing mid-crawl can REGRESS your fuller local dataset. Pausing
REM  them makes a local crawl safe. Re-enable with ci-resume-backfills.bat.
REM
REM  Run directly (double-click), or it is called by crawl-refs.bat /
REM  crawl-workingpapers.bat with the argument `nopause`.
REM  Requires GitHub CLI (gh) + `gh auth login` (workflow scope).
REM ==========================================================================
setlocal
set "REPO_SLUG=konstantinosStouras/konstantinosStouras.github.io"

where gh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] GitHub CLI ^(gh^) is not installed or not on PATH.
  echo         Install it from https://cli.github.com/ then run: gh auth login
  echo         Or disable the workflows manually in the repo's Actions tab:
  echo           lit-references-backfill, lit-workingpapers-backfill,
  echo           lit-workingpapers-update-data
  if /i not "%~1"=="nopause" pause
  exit /b 1
)

echo Pausing CI backfills that can overwrite local data-refs / data-workingpapers...
set "FAIL=0"
call :disable lit-references-backfill.yml
call :disable lit-workingpapers-backfill.yml
call :disable lit-workingpapers-update-data.yml

if "%FAIL%"=="1" (
  echo.
  echo [ERROR] One or more workflows could not be disabled ^(gh not authed?^).
  if /i not "%~1"=="nopause" pause
  exit /b 1
)
echo Done. These stay off until you run ci-resume-backfills.bat.
if /i not "%~1"=="nopause" pause
exit /b 0

:disable
gh workflow disable "%~1" -R %REPO_SLUG% 2>nul
if errorlevel 1 (
  echo   [warn] could not disable %~1
  set "FAIL=1"
) else (
  echo   paused %~1
)
exit /b 0
