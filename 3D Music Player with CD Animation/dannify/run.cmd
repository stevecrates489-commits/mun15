@echo off
rem The Dannify extension, started by the player.
rem
rem The first launch makes the Python environment it needs and keeps it in
rem this folder, so the next launch is instant. Every launch then compares
rem the requirements that environment was installed from with the ones this
rem copy of the extension ships, and installs again when they differ — a
rem newer Dannify brings its own requirements, and an unchanged .venv would
rem happily go on serving the old ones (see the stamp below).
rem
rem It starts player_bridge.py rather than Backend/main.py: that is Dannify
rem with a few extra routes, so the player can hand it the signed-in YouTube
rem Music session and be told which names this copy still exposes. Everything
rem else is Dannify's own app, untouched.
rem
rem bin\ holds this folder's own ffmpeg, put on the path below: without one
rem every download fails at the step that turns the audio into a file.

setlocal
cd /d "%~dp0"

set "PATH=%~dp0bin;%PATH%"

if not defined DANNIFY_DATA_DIR set "DANNIFY_DATA_DIR=%APPDATA%\MUN15H\dannify-data"
if not exist "%DANNIFY_DATA_DIR%" mkdir "%DANNIFY_DATA_DIR%"

set "PYEXE=%~dp0.venv\Scripts\python.exe"
set "REQS=%~dp0Backend\requirements.txt"
set "STAMP=%~dp0.venv\requirements.txt.stamp"

if not exist "%PYEXE%" (
  rem 3.14 when it is there and working, otherwise the 3.x the machine has.
  py -3.14 -c "import sys" >nul 2>&1
  if errorlevel 1 (
    py -3 -m venv .venv
  ) else (
    py -3.14 -m venv .venv
  )
  if not exist "%PYEXE%" (
    echo The Dannify extension needs Python 3.11 or newer.
    exit /b 1
  )
)

rem No stamp yet (first launch, or a venv that predates this rule) means the
rem requirements have never been checked against the environment.
if not exist "%STAMP%" goto install
fc /b "%REQS%" "%STAMP%" >nul 2>&1
if errorlevel 1 goto install
goto serve

:install
echo Installing what this copy of the extension needs...
"%PYEXE%" -m pip install --disable-pip-version-check -q -r "%REQS%"
if errorlevel 1 (
  echo The extension's requirements could not be installed.
  exit /b 1
)
copy /y "%REQS%" "%STAMP%" >nul

:serve
"%PYEXE%" player_bridge.py --host 127.0.0.1 --port 8765 --log-level warning
