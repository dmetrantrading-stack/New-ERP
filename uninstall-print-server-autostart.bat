@echo off
title D METRAN - Remove Print Server Autostart
cd /d "%~dp0"

set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\D Metran Print Server.lnk"

if exist "%LINK%" (
  del "%LINK%"
  echo [OK] Removed autostart shortcut.
) else (
  echo [INFO] Autostart shortcut was not found (already removed).
)

echo.
pause
