@echo off
title D METRAN - Install Print Server Autostart
color 0B
cd /d "%~dp0"

echo.
echo  ============================================
echo   D METRAN ERP - Print Server Autostart
echo   Adds startup entry for THIS Windows user
echo  ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not in PATH.
  echo Install from https://nodejs.org then run this again.
  pause
  exit /b 1
)

if not exist "print-server-autostart.vbs" (
  echo [ERROR] print-server-autostart.vbs not found in this folder.
  pause
  exit /b 1
)

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "LINK=%STARTUP%\D Metran Print Server.lnk"
set "VBS=%~dp0print-server-autostart.vbs"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $sc = $ws.CreateShortcut('%LINK%'); ^
   $sc.TargetPath = 'wscript.exe'; ^
   $sc.Arguments = '\"\"\"%VBS%\"\"\"'; ^
   $sc.WorkingDirectory = '%~dp0'; ^
   $sc.Description = 'D METRAN ERP thermal print server (localhost:9999)'; ^
   $sc.Save()"

if errorlevel 1 (
  echo [ERROR] Failed to create startup shortcut.
  pause
  exit /b 1
)

echo.
echo [OK] Autostart installed for user: %USERNAME%
echo      Shortcut: %LINK%
echo      Logs:     %~dp0logs\print-server.log
echo.
echo The print server will start hidden when you sign in to Windows.
echo It auto-restarts if it crashes (see logs\print-server.log).
echo To remove autostart, run uninstall-print-server-autostart.bat
echo.
echo Starting print server now (hidden)...
start "" wscript.exe "%VBS%"
timeout /t 2 /nobreak >nul
echo Done. Open Settings - Printer or POS to verify localhost:9999.
echo.
pause
