@echo off
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1
set "VENV_DIR=.local-login-helper-venv"
set "PYTHON_EXE=%VENV_DIR%\Scripts\python.exe"
set "CHROMIUM_MARKER=%VENV_DIR%\.chromium-installed"

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set PYTHON_CMD=py -3
) else (
  set PYTHON_CMD=python
)

if not exist "%PYTHON_EXE%" (
  echo Creating local login helper environment...
  %PYTHON_CMD% -m venv "%VENV_DIR%"
)

"%PYTHON_EXE%" -m pip show playwright >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo Installing Playwright runtime...
  "%PYTHON_EXE%" -m pip install playwright==1.49.1
  if %ERRORLEVEL% NEQ 0 (
    echo Failed to install Playwright.
    pause
    exit /b 1
  )
  if exist "%CHROMIUM_MARKER%" del /Q "%CHROMIUM_MARKER%" >nul 2>nul
)

if not exist "%CHROMIUM_MARKER%" (
  echo Installing Playwright Chromium...
  "%PYTHON_EXE%" -m playwright install chromium >nul 2>nul
  if %ERRORLEVEL% NEQ 0 (
    echo Failed to install Playwright Chromium.
    pause
    exit /b 1
  )
  echo installed>"%CHROMIUM_MARKER%"
)

echo Starting local Chrome login helper...
"%PYTHON_EXE%" -m backend.tools.local_login_helper
pause
