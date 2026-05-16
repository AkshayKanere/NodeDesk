@echo off
title NodeDesk - SSH Client
cd /d "%~dp0"

set DEFAULT_HOST=localhost
set DEFAULT_PORT=2222
set DEFAULT_USER=admin
set DEFAULT_PASS=

if "%~1"=="" (
    set HOST=%DEFAULT_HOST%
) else (
    set HOST=%~1
)

if "%~2"=="" (
    set PORT=%DEFAULT_PORT%
) else (
    set PORT=%~2
)

if "%~3"=="" (
    set USER=%DEFAULT_USER%
) else (
    set USER=%~3
)

if "%~4"=="" (
    set PASS=%DEFAULT_PASS%
) else (
    set PASS=%~4
)

echo ============================================
echo   NodeDesk - SSH Client
echo ============================================
echo.
echo   Connecting to %HOST%:%PORT% as %USER%
echo.
echo   Type "exit" to disconnect.
echo ============================================
echo.

node client.js %HOST% %PORT% %USER% %PASS%

if %errorlevel% neq 0 (
    echo.
    echo ERROR: Connection failed.
    pause
)
