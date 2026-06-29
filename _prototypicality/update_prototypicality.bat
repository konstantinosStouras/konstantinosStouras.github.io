@echo off
REM ============================================================================
REM  update_prototypicality.bat
REM  Double-click to score your ideas and (re)create ideas_with_prototypicality.xlsx.
REM
REM  Keep this .bat in the same folder as: score_glove.py, proto_core.py,
REM  glove_loader.py, glove_model.json and glove.6B.300d.txt.
REM
REM  - Double-click           -> scores  ideas.xlsx
REM  - Drag another .xlsx onto -> scores that file instead
REM  Output is always  ideas_with_prototypicality.xlsx  in this folder.
REM
REM  (You only need to rebuild the model with score_glove.py build if you change
REM   the topic documents or the GloVe file. New ideas just need this score step.)
REM ============================================================================
setlocal
cd /d "%~dp0"

REM Use a file dragged onto this .bat; otherwise default to ideas.xlsx.
set "IDEAS=%~1"
if "%IDEAS%"=="" set "IDEAS=ideas.xlsx"

if not exist "%IDEAS%" (
  echo Could not find "%IDEAS%" in this folder.
  echo Put your ideas file here as ideas.xlsx, or drag the file onto this .bat.
  echo.
  pause
  exit /b 1
)

echo Scoring "%IDEAS%"  ->  ideas_with_prototypicality.xlsx
echo.
python score_glove.py score --model glove_model.json --ideas "%IDEAS%" --glove glove.6B.300d.txt --out ideas_with_prototypicality.xlsx
set "RC=%errorlevel%"

echo.
if not "%RC%"=="0" (
  echo *** Something went wrong - see the messages above. ***
) else (
  echo Done. Created ideas_with_prototypicality.xlsx in this folder.
  echo Next: upload it in the app under Data Analytics ^> Section 3.1.
)
echo.
pause
