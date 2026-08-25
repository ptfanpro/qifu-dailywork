@echo off
chcp 65001 >nul
set "APP_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APP_DIR%ui\PrayerAssistant.ps1"
if errorlevel 1 pause
