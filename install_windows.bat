@echo off
setlocal

cd /d "%~dp0"

echo ========================================================
echo Antigravity Patch Installer
echo ========================================================
echo.
echo This script will temporarily download Node.js to apply
echo the patch without modifying your system installations.
echo.

set "NODE_URL=https://nodejs.org/dist/latest/win-x64/node.exe"
set "TMP_DIR=%~dp0.tmp_node"
set "NODE_EXE=%TMP_DIR%\node.exe"

if not exist "%TMP_DIR%" mkdir "%TMP_DIR%"

echo [1/3] Downloading portable Node.js...
:: Using built-in Windows 10/11 curl
curl.exe -# -L -o "%NODE_EXE%" "%NODE_URL%"

if not exist "%NODE_EXE%" (
    echo.
    echo ERROR: Failed to download Node.js. Please check your internet connection.
    echo Cleaning up...
    rmdir /s /q "%TMP_DIR%"
    pause
    exit /b 1
)

echo.
echo [2/3] Applying the patch...
echo.
"%NODE_EXE%" applyAutoRetryContinueAllowPatch.js
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo [3/3] Cleaning up temporary files...
rmdir /s /q "%TMP_DIR%"

echo.
echo ========================================================
if %EXIT_CODE% EQU 0 (
    echo Patch process finished successfully!
) else (
    echo Patch process finished with errors ^(Code %EXIT_CODE%^).
)
echo ========================================================
pause
