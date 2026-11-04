@echo off
title Mohammadpur Stock Point
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is required to run the shop app.
  echo  Install the LTS build from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)
echo.
echo  Starting Mohammadpur Stock Point...
echo  Keep this window open while the shop is using the app.
echo.
node server/index.js --open
echo.
echo  The server has stopped.
pause
