@echo off
setlocal
set "APP_DIR=%LOCALAPPDATA%\TwitterDownloadLocalLoginHelper"
if exist "%APP_DIR%\run_local_login_helper.bat" (
  start "" /min "%APP_DIR%\run_local_login_helper.bat"
) else (
  start "" /min "%~dp0install_local_login_helper.bat"
)
