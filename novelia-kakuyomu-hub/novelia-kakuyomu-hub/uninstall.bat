@echo off
setlocal
title Novelia Kakuyomu Ranking Hub - Uninstaller

echo ========================================================
echo   Novelia Kakuyomu Ranking Hub - Uninstall Clean-up
echo ========================================================
echo.

echo Removing Windows protocol registration (novelia-rank://)...
reg delete "HKCU\Software\Classes\novelia-rank" /f >nul 2>&1

echo.
echo [SUCCESS] Protocol registration removed cleanly.
echo No background services or registry traces remain on your system.
echo To completely delete this tool, simply remove this folder and userscript.
echo.
pause
