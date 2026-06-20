@echo off
setlocal EnableDelayedExpansion
REM ================================================================
REM   IDEASEARCHLAB - BUILD FROM VENDORED SOURCE AND DEPLOY
REM
REM   Self-contained: the React/Vite + Cloud Functions source lives in
REM   _ideasearchlab-src in THIS repo. No external repo and no CI are
REM   needed to rebuild the app. Requires Node.js and git installed.
REM
REM   Usage: edit files in _ideasearchlab-src, then double-click this
REM   script (or run it from CMD). It builds, copies the bundle into
REM   lab\ideasearchlab, commits, and pushes -> live in 1-2 minutes.
REM
REM   (Cloud Functions still deploy separately with Firebase:
REM    cd _ideasearchlab-src ^&^& firebase deploy --only functions)
REM ================================================================

set "REPO_DIR=%~dp0"
set "SRC_DIR=%REPO_DIR%_ideasearchlab-src"
set "OUT_DIR=%REPO_DIR%lab\ideasearchlab"

echo.
echo [1/5] Building from source...
cd /d "%SRC_DIR%" || (echo ERROR: %SRC_DIR% not found & pause & exit /b 1)
if not exist "node_modules" (
  echo Installing dependencies, first run only...
  call npm install || (echo ERROR: npm install failed & pause & exit /b 1)
)
call npm run build || (echo ERROR: build failed & pause & exit /b 1)

echo.
echo [2/5] Copying build into lab\ideasearchlab ...
if exist "%OUT_DIR%\assets" rmdir /s /q "%OUT_DIR%\assets"
xcopy /e /i /y "%SRC_DIR%\dist\*" "%OUT_DIR%\" >nul || (echo ERROR: copy failed & pause & exit /b 1)

echo.
echo [3/5] Staging changes...
cd /d "%REPO_DIR%"
git add lab/ideasearchlab _ideasearchlab-src

echo.
echo [4/5] Committing...
git commit -m "Deploy ideasearchlab build - %date% %time%" || echo (nothing to commit)

echo.
echo [5/5] Pushing...
git push origin master
if !errorlevel! neq 0 ( git push origin main )
if !errorlevel! neq 0 ( echo ERROR: push failed - check connection/auth & pause & exit /b 1 )

echo.
echo ========================================
echo   DONE - live in 1-2 min at
echo   https://www.stouras.com/lab/ideasearchlab/
echo   Hard-refresh with Ctrl+Shift+R to bypass cache.
echo ========================================
timeout /t 5
exit /b 0
