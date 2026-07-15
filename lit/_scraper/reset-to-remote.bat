@echo off
REM ==========================================================================
REM  reset-to-remote.bat  -  Recover a scrambled/diverged clone by DISCARDING
REM  all local commits and uncommitted changes and matching origin/master
REM  exactly (= the live site). Use this when `git status` shows the branch has
REM  "diverged" or lists modified data files you didn't intend (e.g. Dropbox
REM  rewrote tracked files out of band). Any un-pushed local crawl finds are
REM  simply re-found on the next crawl, so nothing is really lost.
REM ==========================================================================
setlocal enableextensions
title The Lit - reset clone to origin/master

pushd "%~dp0..\.."
set "REPO=%CD%"
popd
cd /d "%REPO%"

echo This DISCARDS all local commits and uncommitted changes in:
echo     %REPO%
echo and resets the working tree to origin/master (the live site).
echo Un-pushed local crawl finds are re-found on the next crawl.
echo.
choice /m "Discard local changes and reset to origin/master"
if errorlevel 2 ( echo Cancelled - nothing changed. & goto :end )

REM stop any half-finished rebase/merge first
git rebase --abort 1>nul 2>nul
git merge --abort 1>nul 2>nul
git fetch origin master
git reset --hard origin/master
echo.
git log --oneline -3
echo.
echo Done - working tree now matches origin/master.
echo (Leftover *.tmp-* files are ignored by git and harmless.)
:end
pause
