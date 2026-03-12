@echo off
chcp 65001 >nul 2>&1
setlocal

cd /d "%~dp0"
cd ..

:: get port from config
for /f "delims=" %%a in ('node -e "console.log(require('./config').server.port)"') do set PORT=%%a

echo ========================================
echo   LPF File Server - Stop
echo ========================================
echo.

netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo [INFO] LPF service is not running
    pause
    exit /b 0
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo Stopping PID %%a ...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo [OK] LPF service stopped
echo.
pause
