@echo off
setlocal EnableDelayedExpansion

REM STEP 1: Define paths
set SITE_DIR=%~dp0
REM `_backups`, not `backups`: GitHub Pages runs Jekyll, Jekyll publishes
REM any directory whose name does not start with an underscore, and five old
REM copies of index.html were therefore being SERVED — each one still
REM declaring og:url = the home page, which is how a link preview loses its
REM card to a page nobody links to. The leading underscore un-serves them.
set BACKUP_DIR=%SITE_DIR%_backups\site
set LOG_FILE=%SITE_DIR%website-update-log.txt

REM STEP 2: Generate timestamped folder name
for /f %%A in ('powershell -command "Get-Date -Format \"yyyyMMdd_HHmmss\""') do set DATETIME=%%A
set VERSION_FOLDER=website_%DATETIME%
set VERSION_PATH=%BACKUP_DIR%\%VERSION_FOLDER%

REM STEP 3: Prompt user for an update note
set /p CUSTOM_NOTE=📝 Enter a short note for this website update (optional): 

REM STEP 4: Create the backup folder
mkdir "%VERSION_PATH%"

REM STEP 5: Backup key files only
echo 🔄 Backing up index.html...

if exist "%SITE_DIR%index.html" (
    copy /Y "%SITE_DIR%index.html" "%VERSION_PATH%\index.html"
)

REM STEP 6: Git commit and push
cd /d "%SITE_DIR%"
git add .
git commit -m "Website update (%DATETIME%) - %CUSTOM_NOTE%"
git push

REM STEP 7: Log the update
echo %DATETIME% - %CUSTOM_NOTE% >> "%LOG_FILE%"

REM STEP 8: Open live site
start "" "https://konstantinosStouras.github.io"

echo.
echo ✅ Website updated and only modified files backed up.
echo 🔖 Backup saved to: %VERSION_PATH%
echo 📝 Log updated: %LOG_FILE%
pause > nul
