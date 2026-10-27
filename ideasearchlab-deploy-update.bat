@echo off
setlocal EnableDelayedExpansion
REM ================================================================
REM   IDEASEARCHLAB - BUILD FROM ITS SEPARATE SOURCE REPOSITORY
REM
REM   Source: sibling ideasearchlab-source repository.
REM   Built website: sibling lab-ideasearchlab repository.
REM   Requires Node.js, Git, and the GitHub CLI.
REM
REM   Usage: commit source edits in ideasearchlab-source, then run this
REM   script. It builds, copies the bundle into lab-ideasearchlab,
REM   commits that website repository, and starts the publishing workflow.
REM
REM   (Cloud Functions still deploy separately with Firebase:
REM    cd ..\ideasearchlab-source
REM    firebase deploy --only functions --project ideasearchlab)
REM ================================================================

set "REPO_DIR=%~dp0"
set "SRC_DIR=%REPO_DIR%..\ideasearchlab-source"
set "OUT_DIR=%REPO_DIR%..\lab-ideasearchlab"
if not exist "%OUT_DIR%\.git" (echo ERROR: clone lab-ideasearchlab first & exit /b 1)

echo.
echo [1/5] Building from source...
cd /d "%SRC_DIR%" || (echo ERROR: %SRC_DIR% not found & pause & exit /b 1)
if not exist "node_modules" (
  echo Installing dependencies, first run only...
  call npm install || (echo ERROR: npm install failed & pause & exit /b 1)
)
call npm run build || (echo ERROR: build failed & pause & exit /b 1)

echo.
echo [2/5] Copying build into its separate website repository ...
REM Deliberately NOT deleting the old assets. Vite content-hashes every filename,
REM so old and new bundles coexist harmlessly — and GitHub Pages serves index.html
REM with a 10-minute cache, so a student who loaded the app before a mid-class
REM redeploy would otherwise request a bundle that no longer exists and get a
REM blank page that a normal reload does not fix. Prune assets\ by hand between
REM classes if it grows.
xcopy /e /i /y "%SRC_DIR%\dist\*" "%OUT_DIR%\" >nul || (echo ERROR: copy failed & pause & exit /b 1)

echo.
echo [3/5] Staging changes...
cd /d "%OUT_DIR%" || exit /b 1
git add index.html 404.html assets || exit /b 1

echo.
echo [4/5] Committing...
git commit -m "Deploy ideasearchlab build - %date% %time%" || echo (nothing to commit)

echo.
echo [5/5] Pushing...
git push origin main
if !errorlevel! neq 0 ( echo ERROR: push failed - check connection/auth & pause & exit /b 1 )
gh workflow run sync-projects.yml --repo konstantinosStouras/konstantinosStouras.github.io
if !errorlevel! neq 0 ( echo ERROR: could not start publication & pause & exit /b 1 )

echo.
echo ========================================
echo   Build saved. Publication workflow started for
echo   https://www.stouras.com/lab/ideasearchlab/
echo   Hard-refresh with Ctrl+Shift+R to bypass cache.
echo ========================================
timeout /t 5
exit /b 0
