@echo off
setlocal EnableDelayedExpansion

REM ================================================================
REM   BRAINSTORMING APP - DEPLOY UPDATES TO GITHUB PAGES
REM   Your existing setup: konstantinosStouras.github.io
REM ================================================================

echo.
echo ========================================
echo   DEPLOYING BRAINSTORMING APP UPDATES
echo ========================================
echo.

REM === STEP 1: Navigate to GitHub Pages repo ===
set REPO_DIR=C:\Users\LENOVO\Dropbox\Others\GitHub\konstantinosStouras.github.io

echo [1/6] ðŸ"‚ Navigating to GitHub Pages repository...
cd /d "%REPO_DIR%"
if !errorlevel! neq 0 (
    echo âŒ ERROR: Could not find repository directory
    pause
    exit /b 1
)
echo âœ… In repository: %CD%

REM === STEP 2: Check git status ===
echo.
echo [2/6] ðŸ" Checking for changes...
git status --short
if !errorlevel! neq 0 (
    echo âŒ ERROR: git status failed
    pause
    exit /b 1
)

REM === STEP 3: Add all changes ===
echo.
echo [3/6] ðŸ"¤ Adding all changes...
git add lab/brainstorming/*
if !errorlevel! neq 0 (
    echo âŒ ERROR: git add failed
    pause
    exit /b 1
)
echo âœ… Changes added

REM === STEP 4: Commit ===
echo.
echo [4/6] ðŸ'¾ Committing changes...

REM Create commit message with timestamp
for /f "tokens=1-3 delims=/ " %%a in ('date /t') do (
    set COMMIT_DATE=%%a-%%b-%%c
)
for /f "tokens=1-2 delims=: " %%a in ('time /t') do (
    set COMMIT_TIME=%%a:%%b
)

git commit -m "Update brainstorming app with logging - %COMMIT_DATE% %COMMIT_TIME%"
if !errorlevel! neq 0 (
    echo âš  No changes to commit (everything up to date)
    echo.
    choice /C YN /M "Continue anyway"
    if errorlevel 2 (
        echo Deployment cancelled
        pause
        exit /b 0
    )
) else (
    echo âœ… Changes committed
)

REM === STEP 5: Push to GitHub ===
echo.
echo [5/6] ðŸŒ Pushing to GitHub Pages...
git push origin main
if !errorlevel! neq 0 (
    REM Try 'master' branch if 'main' fails
    echo Trying 'master' branch...
    git push origin master
    if !errorlevel! neq 0 (
        echo âŒ ERROR: git push failed
        echo.
        echo Check your internet connection and GitHub authentication
        pause
        exit /b 1
    )
)
echo âœ… Successfully pushed to GitHub

REM === STEP 6: Success ===
echo.
echo ========================================
echo   âœ… DEPLOYMENT COMPLETE
echo ========================================
echo.
echo ðŸš€ Changes pushed to GitHub Pages
echo âš¡ Your site will update in 1-2 minutes
echo.
echo ðŸŒ Your app is live at:
echo    https://konstantinosStouras.github.io/lab/brainstorming
echo.
echo ðŸ" Google Sheets logging is now active!
echo    Data will be saved to your Google Sheet
echo.

timeout /t 5
exit /b 0