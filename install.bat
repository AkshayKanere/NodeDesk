@echo off
title NodeDesk - Setup
cd /d "%~dp0"

echo ============================================
echo   NodeDesk - Setup
echo ============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Download it from https://nodejs.org
    pause
    exit /b 1
)

echo [1/3] Node.js found:
node --version
echo.

echo [2/3] Installing dependencies...
npm install
echo.

if not exist keys\host_key (
    echo [3/3] Generating host keys...
    node generate-key.js
) else (
    echo [3/3] Host keys already exist, skipping.
)

echo.
echo ============================================
echo   Setup complete!
echo.
echo   To start web server:  start-web.bat
echo   To start SSH server:  start-server.bat
echo   Open http://localhost:8080 in your browser
echo ============================================
pause
