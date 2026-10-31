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

rem 前端源码在 portal/frontend，git pull 不会更新 portal/static（gitignored），
rem 所以每次启动前都构建一次（增量构建约 2 秒），保证页面和源码一致。
if not exist "portal\frontend\node_modules" (
  echo [dev] installing frontend deps (first run, needs npm registry) ...
  pushd portal\frontend
  call npm ci --no-fund --no-audit
  popd
)
if exist "portal\frontend\node_modules" (
  echo [dev] building frontend ...
  pushd portal\frontend
  call npm run build
  if errorlevel 1 echo [dev] WARN: frontend build failed - serving existing portal\static
  popd
) else (
  echo [dev] WARN: frontend deps not installed and npm ci failed - serving existing portal\static
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
