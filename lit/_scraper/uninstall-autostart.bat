@echo off
REM ==========================================================================
REM  uninstall-autostart.bat  -  Remove the logon autostart task created by
REM  install-autostart.bat. Does NOT stop a crawler that is already running.
REM ==========================================================================
setlocal enableextensions
title The Lit - remove crawler autostart

set "TASK=LitLocalCrawlers"
schtasks /Delete /TN "%TASK%" /F
if errorlevel 1 (
  echo No autostart task named "%TASK%" was found - nothing to remove.
) else (
  echo Removed the autostart task "%TASK%".
)
echo.
echo NOTE: this does not stop a crawler that is currently running. To stop one,
echo close its window ^(or end node.exe / cmd.exe in Task Manager^), then run
echo ci-resume-backfills.bat to be sure CI backfills are re-enabled.
pause
