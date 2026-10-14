@echo off
cd /d "C:\Users\alper\TrueDeck"
title TrueDeck
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0focus-truedeck.ps1"
if %ERRORLEVEL%==0 exit /b 0
call "%~dp0node_modules\.bin\electron-vite.cmd" dev
if errorlevel 1 (
  echo.
  echo TrueDeck did not start. See the messages above.
  pause
)
