@echo off
REM ==========================================================================
REM  ci-resume-backfills.bat  -  Re-enable the CI data workflows that
REM  ci-pause-backfills.bat turned off. Run this after a local crawl session,
REM  or any time you're unsure CI is back on. Safe to run repeatedly.
REM  Requires GitHub CLI (gh) + `gh auth login`.
REM ==========================================================================
setlocal enableextensions
set "REPO_SLUG=konstantinosStouras/konstantinosStouras.github.io"
set "WFS=lit-update-data.yml lit-check-new.yml lit-editors-backfill.yml lit-preprints-backfill.yml lit-citations-update.yml lit-ft50-update-data.yml lit-ft50-check-new.yml lit-ft50-preprints-backfill.yml lit-ft50-citations-update.yml lit-references-backfill.yml lit-workingpapers-backfill.yml lit-workingpapers-update-data.yml"

where gh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] GitHub CLI ^(gh^) is not installed or not on PATH.
  echo         Re-enable these by hand in the repo's Actions tab:
  echo         %WFS%
  if /i not "%~1"=="nopause" pause
  exit /b 1
)
gh auth status >nul 2>nul
if errorlevel 1 (
  echo [ERROR] GitHub CLI is not authenticated. Run:  gh auth login
  if /i not "%~1"=="nopause" pause
  exit /b 1
)

echo Re-enabling CI data workflows...
for %%w in (%WFS%) do call :enable %%w
echo Done. CI is back on its normal schedule.
if /i not "%~1"=="nopause" pause
exit /b 0

:enable
gh workflow enable "%~1" -R %REPO_SLUG% >nul 2>nul
if errorlevel 1 ( echo   %~1 - already on ) else ( echo   resumed %~1 )
exit /b 0
