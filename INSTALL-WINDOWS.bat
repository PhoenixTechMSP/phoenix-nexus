@echo off
title Phoenix-Nexus - Installation
cd /d "%~dp0"
echo Lancement de l installation...
powershell -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows.ps1"
if errorlevel 1 pause
