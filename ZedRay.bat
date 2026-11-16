@echo off
title ZedRay VPN Client
cd /d "%~dp0"

echo ====================================================
echo             ZEDRAY VPN CLIENT FOR WINDOWS          
echo ====================================================
echo.

:: Ensure Node path is available
set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.20.0-win-x64;%PATH%"

echo [1/2] Ishga tushirilmoqda...
node launch.js

pause
