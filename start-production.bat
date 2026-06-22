@echo off
title D METRAN ERP - Production Server
color 0A
cd /d "%~dp0"

echo.
echo  ============================================
echo   D METRAN ERP - Hybrid Cloud (Windows)
echo   Web UI + API on port 5000
echo  ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  pause
  exit /b 1
)

if not exist backend\.env (
  echo [WARN] backend\.env not found. Copy backend\.env.example and configure it first.
  pause
  exit /b 1
)

echo Building frontend...
cd frontend
call npm run build
if errorlevel 1 (
  echo [ERROR] Frontend build failed.
  pause
  exit /b 1
)
cd ..

echo Building backend...
cd backend
call npm run build
if errorlevel 1 (
  echo [ERROR] Backend build failed.
  pause
  exit /b 1
)

echo Running migrations...
call npm run migrate:prod
if errorlevel 1 (
  echo [ERROR] Migration failed.
  pause
  exit /b 1
)

echo.
echo Starting ERP server (SERVE_FRONTEND=true in .env recommended)...
echo Users open: http://YOUR-SERVER-IP:5000  or your HTTPS domain via nginx/IIS.
echo Cashier PCs: run start-print-server.bat separately for thermal receipts.
echo.

set NODE_ENV=production
call npm start

pause
