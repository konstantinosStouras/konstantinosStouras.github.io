@echo off
REM ==========================================================================
REM  ci-pause-backfills.bat  -  Pause CI's data pipeline so a LOCAL crawl is the
REM  SOLE writer of the lit datasets. This is what makes local pushes work:
REM  otherwise CI commits to master every few minutes, your local commit
REM  diverges, `git pull --rebase` conflicts on the minified JSON, and nothing
REM  pushes. With CI paused, your commits fast-forward cleanly.
REM
REM  Re-enable with ci-resume-backfills.bat when you stop crawling. Pausing is
REM  meant for a bounded "burn down the backlog" session, NOT 24/7 (CI's
REM  new-paper pickup and daily rebuilds are off while paused).
REM
REM  Run directly, or it is called by the crawl-*.bat wrappers with `nopause`.
REM  Requires GitHub CLI (gh) + `gh auth login` (workflow scope).
REM ==========================================================================
setlocal enableextensions
set "REPO_SLUG=konstantinosStouras/konstantinosStouras.github.io"

REM All workflows that commit to lit/data, lit/data-ft50, lit/data-refs or
REM lit/data-workingpapers:
set "WFS=lit-update-data.yml lit-check-new.yml lit-preprints-backfill.yml lit-citations-update.yml lit-ft50-update-data.yml lit-ft50-check-new.yml lit-ft50-preprints-backfill.yml lit-ft50-citations-update.yml lit-references-backfill.yml lit-workingpapers-backfill.yml lit-workingpapers-update-data.yml"

where gh >nul 2>nul
if errorlevel 1 (
  echo [ERROR] GitHub CLI ^(gh^) is not installed or not on PATH.
  echo         Install it from https://cli.github.com/ then run: gh auth login
  echo         Or disable these workflows by hand in the repo's Actions tab:
  echo         %WFS%
  if /i not "%~1"=="nopause" pause
  exit /b 1
)

echo Pausing CI data workflows so your local crawl is the sole writer...
set "FAIL=0"
for %%w in (%WFS%) do call :disable %%w
if "%FAIL%"=="1" (
  echo.
  echo [ERROR] One or more workflows could not be disabled ^(gh not authed?^).
  echo         Run: gh auth login   ^(and grant the "workflow" scope^)
  if /i not "%~1"=="nopause" pause
  exit /b 1
)
echo Done. These stay off until you run ci-resume-backfills.bat.
if /i not "%~1"=="nopause" pause
exit /b 0

:disable
gh workflow disable "%~1" -R %REPO_SLUG% 2>nul
if errorlevel 1 ( echo   [warn] could not pause %~1 & set "FAIL=1" ) else ( echo   paused %~1 )
exit /b 0
