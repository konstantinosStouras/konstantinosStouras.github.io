@echo off
setlocal EnableDelayedExpansion

REM STEP 1: Define paths
set SITE_DIR=%~dp0
set BACKUP_DIR=%SITE_DIR%backups
set LOG_FILE=%SITE_DIR%website-update-log.txt

REM STEP 2: Generate timestamped folder name
for /f %%A in ('powershell -command "Get-Date -Format \"yyyyMMdd_HHmmss\""') do set DATETIME=%%A
set VERSION_FOLDER=website_%DATETIME%
set VERSION_PATH=%BACKUP_DIR%\%VERSION_FOLDER%

REM STEP 3: Prompt user for an update note
set /p CUSTOM_NOTE=📝 Enter a short note for this website update (optional): 

REM STEP 4: Create the backup folder
mkdir "%VERSION_PATH%"

REM STEP 5: Copy only updated files (excluding internal folders & scripts)
echo 🔄 Backing up modified files to: %VERSION_PATH%
robocopy "%SITE_DIR%" "%VERSION_PATH%" /E /XO /XD ".git" "backups" /XF "*.bat" "website-update-log.txt" "version.txt"

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
