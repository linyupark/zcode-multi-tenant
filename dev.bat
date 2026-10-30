@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title ZCode Portal Dev

rem PORT: existing env wins, then .env, then 9900
if not defined PORT (
  set "PORT=9900"
  if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
      if /i "%%A"=="PORT" set "PORT=%%B"
    )
  )
)

echo [dev] working dir: %CD%
echo [dev] port: %PORT%

set "KILLED="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "KILLED=1"
  taskkill /PID %%P /F >nul 2>&1
)
if not defined KILLED (
  echo [dev] no listener on port %PORT%
) else (
  echo [dev] killed existing listener on port %PORT%
  ping -n 2 127.0.0.1 >nul
)

where node >nul 2>&1
if errorlevel 1 (
  echo [dev] node.exe not found in PATH
  pause
  exit /b 1
)

rem 前端构建产物缺失时自动构建（源码在 portal/frontend）
if not exist "portal\static\index.html" (
  echo [dev] portal\static\index.html missing, building frontend ...
  pushd portal\frontend
  if not exist "node_modules" (
    echo [dev] installing frontend deps ...
    call npm install --no-fund --no-audit
  )
  call npm run build
  popd
)

if not defined ADMIN_PASSWORD echo [dev] ADMIN_PASSWORD not set in this shell (a .env file will still be loaded if present)

echo [dev] starting portal/server.mjs ...
if exist ".env" (
  node --env-file=.env portal/server.mjs
) else (
  node portal/server.mjs
)
set "EXITCODE=%ERRORLEVEL%"

echo.
echo [dev] server exited with code %EXITCODE%
pause
