@echo off
REM ==========================================================================
REM  install-autostart.bat  (OPTIONAL)  -  Make the resilient crawler start
REM  automatically at logon, so after a reboot / power-off it resumes on its
REM  own. Registers a Windows Scheduled Task that runs
REM  run-local-crawlers.bat -auto (pre-prints + FT50 citations; no CI pause).
REM  Remove it any time with uninstall-autostart.bat.
REM ==========================================================================
setlocal enableextensions
title The Lit - install crawler autostart

set "TASK=LitLocalCrawlers"
set "SCRIPT=%~dp0run-local-crawlers.bat"

echo This registers a Windows Scheduled Task "%TASK%" that starts the resilient
echo local crawler automatically when you log in, so it resumes by itself after
echo a reboot or power-off. It runs in the background (no window).
echo     Script: %SCRIPT%
echo.
echo It only runs the safe datasets (pre-prints + FT50 citations); it never
echo pauses CI. To also burn down the citation graph / working papers, run
echo crawl-refs.bat / crawl-workingpapers.bat by hand.
echo.
choice /m "Install autostart-at-logon"
if errorlevel 2 ( echo Cancelled. & goto :end )

schtasks /Create /TN "%TASK%" /SC ONLOGON /F /TR "\"%SCRIPT%\" -auto"
if errorlevel 1 (
  echo.
  echo [ERROR] Could not create the task. Run this as your normal user account,
  echo         or add it by hand in Task Scheduler ^(Trigger: At log on;
  echo         Action: "%SCRIPT%" -auto^).
) else (
  echo.
  echo Installed. The crawler will start at your next logon.
  echo   * Start it now without waiting:  run-local-crawlers.bat
  echo   * Stop the running one:          close its window / end node.exe
  echo   * Remove autostart:              uninstall-autostart.bat
)
:end
pause
