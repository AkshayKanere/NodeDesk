@echo off
title NodeDesk - Web Server
cd /d "%~dp0"

echo ============================================
echo   NodeDesk - Remote Desktop Server
echo ============================================
echo.
echo   Starting web server...
echo   Settings are loaded from config.json
echo   Configure via browser Settings tab
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================
echo.

:loop
node web-server.js
echo.
echo [%date% %time%] Server stopped. Restarting in 3 seconds...
echo Press Ctrl+C to exit.
timeout /t 3 /nobreak >nul
goto loop
