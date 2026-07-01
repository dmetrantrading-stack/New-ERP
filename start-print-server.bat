@echo off
title D METRAN - Thermal Print Server
color 0B
cd /d "%~dp0"

echo.
echo  ============================================
echo   D METRAN ERP - Thermal Print Server
echo   Hybrid: run on EACH cashier PC (not cloud)
echo   Auto-restarts if it crashes. Ctrl+C to stop.
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

:restart
echo Starting print server on http://localhost:9999 ...
echo Press Ctrl+C to stop (will not auto-restart after Ctrl+C).
echo.

node server.js
if errorlevel 1 (
  echo.
  echo [WARN] Print server exited with an error.
) else (
  echo.
  echo [INFO] Print server stopped.
)
echo Restarting in 5 seconds...
timeout /t 5 /nobreak
goto restart
