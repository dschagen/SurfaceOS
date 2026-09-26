@echo off
cd /d "%~dp0"

where py >nul 2>&1
if %errorlevel%==0 (
  set "PYTHON_CMD=py -3"
) else (
  where python >nul 2>&1
  if not %errorlevel%==0 (
    echo Python 3 is required to run this local prototype.
    echo Install Python, then run this file again.
    pause
    exit /b 1
  )
  set "PYTHON_CMD=python"
)

rem Serve the repository root so the shell can load the widget renderer from ..\frontend.
start "SurfaceOS local server" cmd /k "%PYTHON_CMD% -m http.server 8000 --directory .."
timeout /t 2 /nobreak >nul
start "" "http://localhost:8000/surfaceos-shell/frontend/"
echo SurfaceOS opened in your browser. Close the server window when finished.
