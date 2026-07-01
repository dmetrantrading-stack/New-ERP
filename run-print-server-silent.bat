@echo off
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  if not exist logs mkdir logs
  echo [%date% %time%] ERROR: Node.js not in PATH>> logs\print-server.log
  exit /b 1
)

if not exist logs mkdir logs
set "LOG=%~dp0logs\print-server.log"

cd thermal-print-server
if not exist node_modules (
  echo [%date% %time%] Installing print server dependencies...>> "%LOG%"
  call npm install >> "%LOG%" 2>&1
  if errorlevel 1 exit /b 1
)

:restart
echo [%date% %time%] Starting print server on http://localhost:9999>> "%LOG%"
node server.js >> "%LOG%" 2>&1
echo [%date% %time%] Print server exited; auto-restarting in 5 seconds...>> "%LOG%"
timeout /t 5 /nobreak >nul
goto restart
