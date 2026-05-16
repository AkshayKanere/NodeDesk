@echo off
cd /d "%~dp0"

if "%~1"=="" (
    echo Usage: download.bat "remote-path" "local-path" [host] [port] [user] [pass]
    echo.
    echo Examples:
    echo   download.bat "C:\Users\remote\Desktop\file.txt" "C:\Downloads\file.txt"
    echo   download.bat "C:\Users\remote\Documents" "C:\Downloads\Documents"
    echo   download.bat "C:\data\file.txt" ".\file.txt" 192.168.1.100
    pause
    exit /b 1
)

if "%~2"=="" (
    echo ERROR: Local path is required.
    echo Usage: download.bat "remote-path" "local-path" [host] [port] [user] [pass]
    pause
    exit /b 1
)

node transfer.js download %1 %2 %3 %4 %5 %6

if %errorlevel% neq 0 pause
