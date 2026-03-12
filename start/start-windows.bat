@echo off
chcp 65001 >nul 2>&1
setlocal

cd /d "%~dp0"
cd ..

set PROJECT_ROOT=%CD%

echo ========================================
echo   LPF File Server
echo ========================================
echo.

:: check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not installed
    echo Please install Node.js 18+
    pause
    exit /b 1
)

echo [OK] Node.js installed
echo.

:: get port from config
for /f "delims=" %%a in ('node -e "console.log(require('./config').server.port)"') do set PORT=%%a

:: check LPF is running
netstat -ano | findstr ":%PORT%" | findstr "LISTENING" >nul
if not errorlevel 1 (
    echo [ERROR] LPF service is already running on port %PORT%
    echo Please stop the existing service first
    pause
    exit /b 1
)

:: check modules
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    call npm install
)

echo [OK] Dependencies ready
echo.
echo ========================================
echo Starting server...
echo ========================================
echo.
echo User: admin / admin123
echo.

:: run server
node server.js

pause
