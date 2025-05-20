@echo off
setlocal EnableDelayedExpansion

REM STEP 1: Set up paths
set SITE_DIR=%~dp0
set BACKUP_DIR=%SITE_DIR%backups
set LOG_FILE=%SITE_DIR%website-update-log.txt

REM STEP 2: List available backups
echo 🗂 Available backup versions:
dir /b /ad "%BACKUP_DIR%"
echo.

REM STEP 3: Ask user which backup to restore from
set /p VERSION_FOLDER=🔁 Paste folder name (e.g. website_20250429_234100): 
set RESTORE_PATH=%BACKUP_DIR%\%VERSION_FOLDER%

REM STEP 4: Validate path
if not exist "%RESTORE_PATH%\index.html" (
    echo ❌ ERROR: %RESTORE_PATH%\index.html not found.
    pause
    exit /b
)

REM STEP 5: Confirm
echo ⚠️ This will overwrite your current index.html
echo.
set /p CONFIRM=Type YES to confirm restore: 
if /i not "%CONFIRM%"=="YES" (
    echo ❌ Restore cancelled.
    pause
    exit /b
)

REM STEP 6: Copy index.html only
copy /Y "%RESTORE_PATH%\index.html" "%SITE_DIR%\index.html"

REM STEP 7: Git commit and push
cd /d "%SITE_DIR%"
git add index.html
git commit -m "Restore index.html from %VERSION_FOLDER%"
git push

REM STEP 8: Log the restore
for /f %%A in ('powershell -command "Get-Date -Format \"yyyy-MM-dd HH:mm:ss\""') do set TIMESTAMP=%%A
echo %TIMESTAMP% - RESTORED index.html from %VERSION_FOLDER% >> "%LOG_FILE%"

REM STEP 9: Launch site
start "" "https://konstantinosStouras.github.io"

echo.
echo ✅ index.html restored from: %VERSION_FOLDER%
echo 🔁 Live website updated
echo 📝 Log updated: %LOG_FILE%
pause > nul
