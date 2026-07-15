@echo off
REM ==========================================================================
REM  ci-resume-backfills.bat  -  Re-enable the CI backfills that ci-pause-
REM  backfills.bat turned off. Run this after a local data-refs /
REM  data-workingpapers crawl, or any time you're unsure CI is back on.
REM  Safe to run repeatedly. Requires GitHub CLI (gh) + `gh auth login`.
REM ==========================================================================
setlocal
set "REPO_SLUG=konstantinosStouras/konstantinosStouras.github.io"

where gh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] GitHub CLI ^(gh^) is not installed or not on PATH.
  echo         Re-enable manually in the repo's Actions tab:
  echo           lit-references-backfill, lit-workingpapers-backfill,
  echo           lit-workingpapers-update-data
  if /i not "%~1"=="nopause" pause
  exit /b 1
)

echo Re-enabling CI backfills...
call :enable lit-references-backfill.yml
call :enable lit-workingpapers-backfill.yml
call :enable lit-workingpapers-update-data.yml
echo Done. CI backfills are back on their normal 3-hourly schedule.
if /i not "%~1"=="nopause" pause
exit /b 0

:enable
gh workflow enable "%~1" -R %REPO_SLUG% 2>nul
if errorlevel 1 (
  echo   [warn] could not enable %~1 - do it manually in the Actions tab
) else (
  echo   resumed %~1
)
exit /b 0
