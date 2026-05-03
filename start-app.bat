@echo off
REM ===========================================================
REM   GTA International Fest - Volunteer App
REM   Local Desktop Server (Windows)
REM ===========================================================
REM   Double-click this file to launch the app on your computer.
REM   It starts a local web server on port 8080.
REM   Browser opens automatically. Phone testing works on same Wi-Fi.
REM ===========================================================

setlocal enabledelayedexpansion
title GTA Volunteer App - Local Server
color 0B

cd /d "%~dp0"

echo.
echo  ===========================================================
echo    GTA International Fest - Volunteer App
echo    Local Desktop Server
echo  ===========================================================
echo.

REM --- Detect this computer's LAN IP (so phones can connect) ---
set "LAN_IP="
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
    if not defined LAN_IP (
        for /f "tokens=* delims= " %%j in ("%%i") do set "LAN_IP=%%j"
    )
)
if not defined LAN_IP set "LAN_IP=YOUR-COMPUTER-IP"

echo    On THIS computer:    http://localhost:8080
echo    On phone / tablet:   http://!LAN_IP!:8080
echo.
echo    Phone testing:
echo      1. Connect your phone to the SAME Wi-Fi as this PC
echo      2. Open local-qr.html in your browser to see a QR
echo      3. Scan the QR with your phone camera
echo.
echo    Admin dashboard:     http://localhost:8080/admin.html
echo.
echo    Press Ctrl+C to stop the server when done.
echo  ===========================================================
echo.

REM --- Try Python 3 first (usually available on modern Windows) ---
where python >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo  [Python detected] Starting server...
    echo.
    start "" "http://localhost:8080"
    python -m http.server 8080
    goto :end
)

REM --- Try the py launcher (Python with custom launcher) ---
where py >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo  [Python launcher detected] Starting server...
    echo.
    start "" "http://localhost:8080"
    py -m http.server 8080
    goto :end
)

REM --- Try Node.js as fallback ---
where npx >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo  [Node.js detected] Starting server (first run downloads serve, ~15s)...
    echo.
    start "" "http://localhost:8080"
    npx --yes serve -l 8080 .
    goto :end
)

REM --- Nothing found ---
color 0C
echo.
echo  -----------------------------------------------------------
echo   ERROR: No web server runtime found on this computer.
echo  -----------------------------------------------------------
echo.
echo   This app needs either Python or Node.js installed
echo   to run a local web server. Pick one:
echo.
echo   OPTION A (recommended) - Install Python (5 min, free):
echo     1. Visit  https://www.python.org/downloads/
echo     2. Click "Download Python 3.x"
echo     3. Run installer. IMPORTANT: tick "Add python.exe to PATH"
echo     4. After install, double-click start-app.bat again
echo.
echo   OPTION B - Install Node.js (free):
echo     1. Visit  https://nodejs.org/
echo     2. Download the LTS version, run installer
echo     3. After install, double-click start-app.bat again
echo.
pause

:end
endlocal
