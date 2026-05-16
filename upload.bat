@echo off
cd /d "%~dp0"

if "%~1"=="" (
    echo Usage: upload.bat "local-path" "remote-path" [host] [port] [user] [pass]
    echo.
    echo Examples:
    echo   upload.bat "C:\myfile.txt" "C:\Users\remote\Desktop\myfile.txt"
    echo   upload.bat "C:\myfolder" "C:\Users\remote\Desktop\myfolder"
    echo   upload.bat "C:\myfile.txt" "C:\temp\myfile.txt" 192.168.1.100
    pause
    exit /b 1
)

if "%~2"=="" (
    echo ERROR: Remote path is required.
    echo Usage: upload.bat "local-path" "remote-path" [host] [port] [user] [pass]
    pause
    exit /b 1
)

node transfer.js upload %1 %2 %3 %4 %5 %6

if %errorlevel% neq 0 pause
