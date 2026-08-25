@echo off
chcp 65001 >nul
set "APP_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%ui\Install-Shortcut.ps1"
pause
