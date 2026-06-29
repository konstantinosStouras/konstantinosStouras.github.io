@echo off
REM ===========================================================================
REM  run_kpis.bat - one-click runner for idea_kpis.py (Windows CMD)
REM
REM  Usage:
REM    * Put idea_analytics_aggregate.xlsx next to this file, then double-click
REM      this .bat (or run it from CMD).
REM    * Or drag an .xlsx file onto this .bat to score that file instead.
REM    * Or from CMD:   run_kpis.bat "C:\path\to\idea_analytics_aggregate.xlsx"
REM ===========================================================================
setlocal
cd /d "%~dp0"

REM Pick the input file: the one dragged/passed in, else the default name here.
set "INPUT=%~1"
if "%INPUT%"=="" set "INPUT=idea_analytics_aggregate.xlsx"

if not exist "%INPUT%" (
  echo.
  echo ERROR: could not find "%INPUT%".
  echo Put idea_analytics_aggregate.xlsx in this folder, or drag your .xlsx onto this file.
  echo.
  pause
  exit /b 1
)

echo Installing the minimum requirements (openpyxl, numpy)...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo Could not install requirements. Make sure Python is installed and on your PATH
  echo ^(https://www.python.org/downloads/ - tick "Add Python to PATH"^).
  echo.
  pause
  exit /b 1
)

echo.
echo Running the KPI computation on "%INPUT%"...
python idea_kpis.py --input "%INPUT%"

echo.
echo Done. Results are in the "output" folder next to this file.
pause
endlocal
