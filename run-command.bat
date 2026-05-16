@echo off
cd /d "%~dp0"

set DEFAULT_HOST=100.64.1.39
set DEFAULT_PORT=2222
set DEFAULT_USER=admin
set DEFAULT_PASS=lrt@1234

if "%~1"=="" (
    echo Usage: run-command.bat "command" [host] [port] [user] [pass]
    echo.
    echo Example: run-command.bat "ipconfig /all"
    echo          run-command.bat "dir C:\" 192.168.1.100 2222 admin pass123
    pause
    exit /b 1
)

set CMD=%~1

if "%~2"=="" ( set HOST=%DEFAULT_HOST% ) else ( set HOST=%~2 )
if "%~3"=="" ( set PORT=%DEFAULT_PORT% ) else ( set PORT=%~3 )
if "%~4"=="" ( set USER=%DEFAULT_USER% ) else ( set USER=%~4 )
if "%~5"=="" ( set PASS=%DEFAULT_PASS% ) else ( set PASS=%~5 )

node client.js %HOST% %PORT% %USER% %PASS% --exec %CMD%
