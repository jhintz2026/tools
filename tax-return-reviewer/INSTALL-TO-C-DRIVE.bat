@echo off
title HST Tax Return Reviewer - Install to C:\HSTReviewTool
echo ============================================
echo   Installing to C:\HSTReviewTool
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

:: Create folder on C drive
echo [1/5] Creating C:\HSTReviewTool ...
if exist "C:\HSTReviewTool" (
    echo Folder already exists. Removing old version...
    rmdir /s /q "C:\HSTReviewTool"
)
mkdir "C:\HSTReviewTool"

:: Copy project files
echo [2/5] Copying files...
xcopy "%~dp0src" "C:\HSTReviewTool\src\" /E /I /Q >nul
xcopy "%~dp0package.json" "C:\HSTReviewTool\" /Q >nul
xcopy "%~dp0package-lock.json" "C:\HSTReviewTool\" /Q >nul
xcopy "%~dp0tsconfig.json" "C:\HSTReviewTool\" /Q >nul
xcopy "%~dp0webpack.config.js" "C:\HSTReviewTool\" /Q >nul

:: Install dependencies
echo [3/5] Installing dependencies... (this may take a few minutes)
cd /d "C:\HSTReviewTool"
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

:: Build
echo [4/5] Building the application...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Build failed.
    pause
    exit /b 1
)

:: Create a shortcut batch file on the desktop
echo [5/5] Creating desktop shortcut...
(
    echo @echo off
    echo title HST Tax Return Reviewer
    echo cd /d "C:\HSTReviewTool"
    echo npx electron dist/main.js
) > "%USERPROFILE%\Desktop\HST Review Tool.bat"

echo.
echo ============================================
echo   DONE! The app is installed at:
echo   C:\HSTReviewTool
echo.
echo   A shortcut has been placed on your Desktop:
echo   "HST Review Tool.bat"
echo.
echo   Launching the app now...
echo ============================================
echo.

npx electron dist/main.js
