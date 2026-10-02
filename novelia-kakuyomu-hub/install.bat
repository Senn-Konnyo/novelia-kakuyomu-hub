@echo off
setlocal
title Novelia Kakuyomu Ranking Hub - Installer

echo ========================================================
echo   Novelia Kakuyomu Ranking Hub - Installation Setup
echo ========================================================
echo.

REM Verify Node.js environment
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found in your PATH.
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

set "LAUNCH_VBS=%~dp0scripts\launch.vbs"

REM Register Windows URL Protocol novelia-rank
echo [1/2] Registering Windows protocol (novelia-rank)...
reg add "HKCU\Software\Classes\novelia-rank" /ve /d "URL:Novelia Ranking Protocol" /f >nul
reg add "HKCU\Software\Classes\novelia-rank" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\novelia-rank\shell\open\command" /ve /d "wscript.exe \"%LAUNCH_VBS%\" \"%%1\"" /f >nul

if %errorlevel% equ 0 (
    echo [SUCCESS] Protocol registered successfully.
) else (
    echo [ERROR] Failed to register protocol. Please try running as Administrator.
    pause
    exit /b 1
)

echo.
echo [2/2] Userscript Setup:
echo   1. Open Tampermonkey in Google Chrome.
echo   2. Create a new script, copy and paste the contents of:
echo      scripts\novelia-ranking-helper.user.js
echo   3. Save the script (Ctrl+S).
echo.
echo ========================================================
echo   Setup complete! Click 'Kakuyomu Ranking' on n.novelia.cc
echo ========================================================
echo.
pause
