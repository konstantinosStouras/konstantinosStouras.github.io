@echo off
setlocal EnableDelayedExpansion

REM STEP 1: Define paths
set SITE_DIR=%~dp0
set BACKUP_DIR=%SITE_DIR%backups
set LOG_FILE=%SITE_DIR%website-update-log.txt
set TEMP_DIR=%SITE_DIR%__temp_snapshot

REM STEP 2: Generate timestamp
for /f %%A in ('powershell -command "Get-Date -Format \"yyyyMMdd_HHmmss\""') do set DATETIME=%%A
set VERSION_NAME=website_%DATETIME%
set VERSION_PATH=%BACKUP_DIR%\%VERSION_NAME%

REM STEP 3: Prompt user for update note
set /p CUSTOM_NOTE=📝 Enter a short note for this website update (optional): 

REM STEP 4: Create temp snapshot (excluding .git, backups, .bat, and logs)
rmdir /s /q "%TEMP_DIR%" >nul 2>&1
robocopy "%SITE_DIR%" "%TEMP_DIR%" /MIR /XD ".git" "backups" /XF "*.bat" "website-update-log.txt" "version.txt"

REM STEP 5: Copy temp snapshot to versioned backup
mkdir "%VERSION_PATH%"
robocopy "%TEMP_DIR%" "%VERSION_PATH%" /MIR

REM STEP 6: Clean up temp snapshot
rmdir /s /q "%TEMP_DIR%"

REM STEP 7: Commit and push to GitHub
cd /d "%SITE_DIR%"
git add .
git commit -m "Website update (%DATETIME%) - %CUSTOM_NOTE%"
git push

REM STEP 8: Log update
echo %DATETIME% - %CUSTOM_NOTE% >> "%LOG_FILE%"

REM STEP 9: Open your site
start "" "https://konstantinosStouras.github.io"

echo.
echo ✅ Website updated and backed up.
echo 📂 Backup saved to: %VERSION_PATH%
echo 📝 Log updated: %LOG_FILE%
pause > nul
