@echo off
title HST Tax Return Reviewer - Setup
echo ============================================
echo   HST Tax Return Reviewer - One-Click Setup
echo ============================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed.
    echo.
    echo Please install Node.js first:
    echo   1. Go to https://nodejs.org
    echo   2. Download the LTS version
    echo   3. Run the installer (accept all defaults)
    echo   4. CLOSE this window and re-run this script
    echo.
    pause
    exit /b 1
)

echo [1/3] Installing dependencies... (this may take a few minutes)
cd /d "%~dp0"
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo.
echo [2/3] Building the application...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

echo.
echo [3/3] Launching the application...
echo.
echo ============================================
echo   The app is starting now!
echo   (Keep this window open while using the app)
echo ============================================
npx electron dist/main.js
