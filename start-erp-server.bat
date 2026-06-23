@echo off
title D METRAN ERP Server
cd /d "%~dp0"

if not exist backend\.env (
  echo [ERROR] backend\.env not found.
  exit /b 1
)

if not exist backend\dist\index.js (
  echo [ERROR] Backend not built. Run start-production.bat once first.
  exit /b 1
)

if not exist frontend\dist\index.html (
  echo [ERROR] Frontend not built. Run start-production.bat once first.
  exit /b 1
)

if not exist logs mkdir logs

echo [%date% %time%] Starting D METRAN ERP server...>> logs\erp-server.log

cd backend
set NODE_ENV=production
node dist\index.js >> "..\logs\erp-server.log" 2>&1

echo [%date% %time%] Server exited.>> ..\logs\erp-server.log
exit /b 1
