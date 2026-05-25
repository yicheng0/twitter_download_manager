@echo off
setlocal
cd /d "%~dp0"
set PYTHONUTF8=1

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set PYTHON_CMD=py -3
) else (
  set PYTHON_CMD=python
)

if not exist ".local-login-helper-venv\Scripts\python.exe" (
  echo Creating local login helper environment...
  %PYTHON_CMD% -m venv .local-login-helper-venv
)

".local-login-helper-venv\Scripts\python.exe" -m pip show playwright >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
  echo Installing Playwright runtime...
  ".local-login-helper-venv\Scripts\python.exe" -m pip install playwright==1.49.1
)

".local-login-helper-venv\Scripts\python.exe" -m playwright install chromium >nul 2>nul

echo Starting local Chrome login helper...
".local-login-helper-venv\Scripts\python.exe" local_login_helper.py
pause
