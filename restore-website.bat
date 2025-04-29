@echo off
setlocal EnableDelayedExpansion

REM STEP 1: Define paths
set SITE_DIR=%~dp0
set BACKUP_DIR=%SITE_DIR%backups
set LOG_FILE=%SITE_DIR%website-update-log.txt

REM STEP 2: List available backups
echo 🗂 Available backups:
dir /b /ad "%BACKUP_DIR%"
echo.

REM STEP 3: Ask which to restore
set /p VERSION_FOLDER=🔁 Paste folder name to restore (e.g. website_20250430_095500): 
set RESTORE_PATH=%BACKUP_DIR%\%VERSION_FOLDER%

REM STEP 4: Check folder exists
if not exist "%RESTORE_PATH%" (
    echo ❌ Backup not found: %RESTORE_PATH%
    pause
    exit /b
)

REM STEP 5: Confirm
echo ⚠️ This will overwrite your current website files (except .git)
set /p CONFIRM=Type YES to confirm: 
if /i not "%CONFIRM%"=="YES" (
    echo ❌ Restore cancelled.
    pause
    exit /b
)

REM STEP 6: Restore
robocopy "%RESTORE_PATH%" "%SITE_DIR%" /MIR /XD ".git"

REM STEP 7: Commit & push
cd /d "%SITE_DIR%"
git add .
git commit -m "Restore website from %VERSION_FOLDER%"
git push

REM STEP 8: Log
for /f %%A in ('powershell -command "Get-Date -Format \"yyyy-MM-dd HH:mm:ss\""') do set TIMESTAMP=%%A
echo %TIMESTAMP% - RESTORED from %VERSION_FOLDER% >> "%LOG_FILE%"

REM STEP 9: Open site
start "" "https://konstantinosStouras.github.io"

echo.
echo ✅ Website restored from %VERSION_FOLDER%.
echo 🔁 Log updated: %LOG_FILE%
pause > nul
