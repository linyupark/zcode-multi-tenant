@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title ZCode Portal Prod

rem Production launcher: build frontend, then start the portal server.
rem ASCII-only on purpose: cmd parses .bat files in the ANSI codepage (GBK on
rem zh-CN Windows) and UTF-8 comments can corrupt line parsing (crash on run).
rem Pitfall: never put half-width parentheses inside echo text within if-blocks.

rem PORT: existing env wins, then .env, then 9900
if not defined PORT (
  set "PORT=9900"
  if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
      if /i "%%A"=="PORT" set "PORT=%%B"
    )
  )
)

echo [prod] working dir: %CD%
echo [prod] port: %PORT%

where node >nul 2>&1
if errorlevel 1 (
  echo [prod] node.exe not found in PATH
  pause
  exit /b 1
)

rem frontend source lives in portal/frontend; portal/static is gitignored so a
rem git pull never refreshes it - build before every start (about 2 seconds).
if not exist "portal\frontend\node_modules" (
  echo [prod] installing frontend deps, first run needs npm registry ...
  pushd portal\frontend
  call npm ci --no-fund --no-audit
  popd
)
if exist "portal\frontend\node_modules" (
  echo [prod] building frontend ...
  pushd portal\frontend
  call npm run build
  if errorlevel 1 echo [prod] WARN: frontend build failed - serving existing portal\static
  popd
) else (
  echo [prod] WARN: frontend deps not installed and npm ci failed - serving existing portal\static
)
if not exist "portal\static\index.html" (
  echo [prod] portal\static\index.html still missing - cannot start
  pause
  exit /b 1
)

rem restart semantics: stop the old listener only after the build succeeded
set "KILLED="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  set "KILLED=1"
  taskkill /PID %%P /F >nul 2>&1
)
if defined KILLED (
  echo [prod] killed existing listener on port %PORT%
  ping -n 2 127.0.0.1 >nul
)

rem taskkill is async: wait up to 10s for the port to actually be released
set /a TRIES=0
:waitport
set /a TRIES+=1
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul
if errorlevel 1 goto portfree
if %TRIES% GEQ 10 (
  echo [prod] WARN: port %PORT% still busy after 10s - a stale process may hold it
  goto portfree
)
ping -n 2 127.0.0.1 >nul
goto waitport
:portfree

if not defined ADMIN_PASSWORD echo [prod] ADMIN_PASSWORD not set in this shell - .env will be loaded if present

echo [prod] starting portal/server.mjs ...
if exist ".env" (
  node --env-file=.env portal/server.mjs
) else (
  node portal/server.mjs
)
set "EXITCODE=%ERRORLEVEL%"

echo.
echo [prod] server exited with code %EXITCODE%
pause
