@echo off
title NodeDesk - SSH Server
cd /d "%~dp0"

echo ============================================
echo   NodeDesk - SSH Server
echo ============================================
echo.
echo   Press Ctrl+C to stop the server.
echo ============================================
echo.

:loop
node server.js
echo.
echo [%date% %time%] Server stopped. Restarting in 3 seconds...
echo Press Ctrl+C to exit.
timeout /t 3 /nobreak >nul
goto loop
