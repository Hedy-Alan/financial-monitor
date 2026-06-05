@echo off
chcp 65001 >nul
title 📈 财经面板

echo.
echo   ╔══════════════════════════════════════════════╗
echo   ║     📈 Financial Monitor                     ║
echo   ╚══════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

echo [*] Starting server...
start /B node server.js

echo [*] Waiting...
timeout /t 2 /nobreak >nul

echo [*] Opening dashboard in Edge App Mode...
start msedge --app=http://localhost:9877 --window-size=880,560

echo.
echo   ✅ Running!
echo   📊 http://localhost:9877
echo.
pause >nul
