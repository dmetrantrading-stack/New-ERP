@echo off
title D METRAN - Thermal Print Server
color 0B
cd /d "%~dp0"

echo.
echo  ============================================
echo   D METRAN ERP - Thermal Print Server
echo   Hybrid: run on EACH cashier PC (not cloud)
echo   Keep this window open while using POS.
echo  ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install from https://nodejs.org then run this file again.
  echo.
  pause
  exit /b 1
)

cd thermal-print-server
if not exist node_modules (
  echo Installing print server dependencies (first run only)...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
  echo.
)

echo Starting print server on http://localhost:9999 ...
echo Press Ctrl+C to stop.
echo.

npm start
if errorlevel 1 (
  echo.
  echo [ERROR] Print server exited with an error.
  pause
  exit /b 1
)

pause
