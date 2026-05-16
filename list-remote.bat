@echo off
cd /d "%~dp0"

if "%~1"=="" (
    echo Usage: list-remote.bat "remote-path" [host] [port] [user] [pass]
    echo.
    echo Examples:
    echo   list-remote.bat "C:\Users\remote\Desktop"
    echo   list-remote.bat "C:\" 192.168.1.100
    pause
    exit /b 1
)

node transfer.js list %1 %2 %3 %4 %5

if %errorlevel% neq 0 pause
