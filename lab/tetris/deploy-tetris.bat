@echo off
setlocal

:: Define paths
set VITE_APP=C:\Users\User\Dropbox\Others\GitHub\konstantinosStouras.github.io\lab\tetris
set GITHUB_REPO=C:\Users\User\Dropbox\Others\GitHub\konstantinosStouras.github.io

:: Go to GitHub repo
cd /d %GITHUB_REPO%
echo.
echo === Ensuring we are on master branch ===
git checkout master

echo.
echo === Pulling latest from remote ===
git pull --rebase

:: Go to Vite app and build
cd /d %VITE_APP%
echo.
echo === Running npm install and Vite build ===
call npm install
call npm run build

:: Return to repo and add all changes
cd /d %GITHUB_REPO%
echo.
echo === Adding, committing, and pushing changes ===
git add .
git commit -m "Automated deploy from deploy-tetris.bat"
git push

echo.
echo === ✅ Done. Check: http://konstantinosstouras.github.io/lab/tetris
pause
