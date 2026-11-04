@echo off
title Mohammadpur Stock Point - Shop LAN server
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
rem Public host - phones on the shop Wi-Fi connect to http://<LAN-IP>:4173
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4"') do (
  for /f "tokens=* delims= " %%b in ("%%a") do set LAN_IP=%%b
)
echo.
echo  Starting the shop server, reachable from every device on this Wi-Fi...
echo.
echo    This PC (web + auto-connect):   http://localhost:4173
echo    Phones / tablets (web app):     http://
if defined LAN_IP <nul set /p dummy="      %LAN_IP%"
echo:4173
echo    Android app: open it, Settings, paste the same
echo    http://<PC-IP>:4173 and press Save - both sides then share one
echo    live catalogue, order history and stock level.
echo.
echo  NOTE: the first start Windows may ask to allow Node.js through the
echo  firewall - click "Allow access" (Private + Public) once.
echo.
node server/index.js --open --host 0.0.0.0
echo.
echo  The server has stopped.
pause
