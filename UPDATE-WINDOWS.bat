@echo off
title Phoenix-Nexus - Mise a jour
cd /d "%~dp0"
echo Mise a jour de l installation existante (base de donnees conservee)...
powershell -NoProfile -NoExit -ExecutionPolicy Bypass -File "%~dp0scripts\update-windows.ps1"
if errorlevel 1 pause
