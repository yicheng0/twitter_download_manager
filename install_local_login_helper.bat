@echo off
setlocal
set PYTHONUTF8=1
set "APP_DIR=%LOCALAPPDATA%\TwitterDownloadLocalLoginHelper"
set "SOURCE_DIR=%~dp0"
set "HELPER_SOURCE=%SOURCE_DIR%backend\tools\local_login_helper.py"
set "LAUNCHER_SOURCE=%SOURCE_DIR%launch_local_login_helper.bat"
set "VPS_HOSTS=%TW_LOCAL_LOGIN_ALLOWED_HOSTS%"
set "VENV_DIR=%APP_DIR%\.local-login-helper-venv"
set "PYTHON_EXE=%VENV_DIR%\Scripts\python.exe"
set "CHROMIUM_MARKER=%VENV_DIR%\.chromium-installed"

if "%VPS_HOSTS%"=="" set "VPS_HOSTS=twitter.198-12-70-103.nip.io"

echo Installing local authorization helper...
echo Target: %APP_DIR%

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  set "PYTHON_CMD=py -3"
) else (
  set "PYTHON_CMD=python"
)

if not exist "%HELPER_SOURCE%" (
  echo local_login_helper.py not found next to this installer.
  echo Please keep install_local_login_helper.bat and local_login_helper.py in the same folder.
  pause
  exit /b 1
)

if not exist "%APP_DIR%" mkdir "%APP_DIR%"
copy /Y "%HELPER_SOURCE%" "%APP_DIR%\local_login_helper.py" >nul
if exist "%LAUNCHER_SOURCE%" copy /Y "%LAUNCHER_SOURCE%" "%APP_DIR%\launch_local_login_helper.bat" >nul

if not exist "%PYTHON_EXE%" (
  echo Creating helper Python environment...
  %PYTHON_CMD% -m venv "%VENV_DIR%"
  if %ERRORLEVEL% NEQ 0 (
    echo Failed to create Python environment. Please install Python 3 first.
    pause
    exit /b 1
  )
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

(
  echo @echo off
  echo setlocal
  echo set PYTHONUTF8=1
  echo set "TW_LOCAL_LOGIN_ALLOWED_HOSTS=%VPS_HOSTS%"
  echo cd /d "%APP_DIR%"
  echo "%PYTHON_EXE%" "%APP_DIR%\local_login_helper.py"
) > "%APP_DIR%\run_local_login_helper.bat"

echo Registering Windows startup task...
schtasks /Create /TN "TwitterDownloadLocalLoginHelper" /TR "\"%APP_DIR%\run_local_login_helper.bat\"" /SC ONLOGON /RL LIMITED /F >nul 2>nul

echo Registering browser launch protocol...
reg add "HKCU\Software\Classes\tw-login-helper" /ve /d "URL:Twitter Download Login Helper" /f >nul
reg add "HKCU\Software\Classes\tw-login-helper" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\tw-login-helper\shell\open\command" /ve /d "\"%APP_DIR%\launch_local_login_helper.bat\" \"%%1\"" /f >nul

echo Starting helper in background...
start "" /min "%APP_DIR%\run_local_login_helper.bat"

echo.
echo Done. Keep this helper installed; next time you can open the VPS account page and click local authorization login.
echo Allowed VPS hosts: %VPS_HOSTS%
pause
