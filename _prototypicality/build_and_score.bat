@echo off
REM One-click build + score for the GloVe path on Windows.
REM
REM Usage:
REM   build_and_score.bat GLOVE_FILE TOPIC_DOCS IDEAS_FILE [MIN_DOC_COUNT]
REM
REM Example:
REM   build_and_score.bat glove.6B.300d.txt samples\topic_docs_thermochromic.txt ideas.xlsx 2
REM
REM Notes:
REM   - Use the SAME GloVe file for build and score (the prototype is built from it).
REM   - MIN_DOC_COUNT is optional; lower it (e.g. 2) to grow the vocabulary.
setlocal
set GLOVE=%1
set DOCS=%2
set IDEAS=%3
set MDC=%4

if "%GLOVE%"=="" goto :usage
if "%DOCS%"=="" goto :usage
if "%IDEAS%"=="" goto :usage

pip install -r requirements.txt

if "%MDC%"=="" (
  python score_glove.py build --glove "%GLOVE%" --docs "%DOCS%" --model glove_model.json
) else (
  python score_glove.py build --glove "%GLOVE%" --docs "%DOCS%" --model glove_model.json --min-doc-count %MDC%
)

REM Score with open-mode rescue on, so out-of-topic ideas still get a KPI.
python score_glove.py score --model glove_model.json --ideas "%IDEAS%" --glove "%GLOVE%" --out ideas_with_prototypicality.xlsx

echo.
echo Done. See ideas_with_prototypicality.xlsx
goto :eof

:usage
echo Usage: build_and_score.bat GLOVE_FILE TOPIC_DOCS IDEAS_FILE [MIN_DOC_COUNT]
echo Example: build_and_score.bat glove.6B.300d.txt samples\topic_docs_thermochromic.txt ideas.xlsx 2
