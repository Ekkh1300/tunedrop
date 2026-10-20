@echo off
rem ────────────────────────────────────────────────────────────────────
rem  TuneDrop launcher
rem  Double-click (or a shortcut on the Desktop / Start menu) → installs
rem  dependencies on first run, builds the UI once, starts the server in
rem  a hidden console window and opens the page in the default browser.
rem ────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "server\node_modules" (
  echo First run: installing dependencies, hang on...
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed - make sure you have Node.js 22.5+ and internet.
    pause
    exit /b 1
  )
)

if not exist "client\dist\index.html" (
  echo First run: building the interface...
  call npm.cmd run build
)

cd /d "%~dp0server"
set "NODE_ENV=production"
start "TuneDrop server" /min cmd /c "node src\index.js"

rem give the server a breath, then open the page
timeout /t 2 /nobreak >nul
start "" http://localhost:8787

echo.
echo TuneDrop is running:  http://localhost:8787
echo  - The server keeps running in the small console window; closing it stops the app.
echo  - If the page did not open, the browser blocked it - open the address above manually.
echo  - First run: Windows may ask permission for Node.js - allow it on private networks.
echo.
timeout /t 8 >nul
