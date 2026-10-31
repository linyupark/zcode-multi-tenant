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

rem taskkill is async: wait up to 10s for the port to actually be released
set /a TRIES=0
:waitport
set /a TRIES+=1
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if errorlevel 1 goto portfree
if %TRIES% GEQ 10 (
  echo [dev] WARN: port %PORT% still busy after 10s - a stale process may hold it
  goto portfree
)
ping -n 2 127.0.0.1 >nul
goto waitport
:portfree

where node >nul 2>&1
if errorlevel 1 (
  echo [dev] node.exe not found in PATH
  pause
  exit /b 1
)

rem frontend source lives in portal/frontend; portal/static is gitignored so a
rem git pull never refreshes it - build before every start (about 2 seconds).
rem ASCII-only on purpose: cmd parses .bat in the ANSI codepage and UTF-8
rem comments can corrupt line parsing. Pitfall: no half-width parentheses
rem inside echo text within if-blocks - it breaks the block and the window
rem closes instantly.
if not exist "portal\frontend\node_modules" (
  echo [dev] installing frontend deps, first run needs npm registry ...
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
