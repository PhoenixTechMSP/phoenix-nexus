@echo off
title Phoenix-Nexus
cd /d "%~dp0"
set NODE_ENV=production
echo App disponible sur http://localhost:8080
start "" http://localhost:8080
node server\index.js
pause
