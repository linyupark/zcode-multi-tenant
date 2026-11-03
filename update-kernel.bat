@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem Kernel updater wrapper around scripts\update-kernel.mjs.
rem ASCII-only on purpose: cmd parses .bat files in the ANSI codepage (GBK on
rem zh-CN Windows) and UTF-8 comments can corrupt line parsing (crash on run).
rem Pitfall: never put half-width parentheses inside echo text within if-blocks.

title ZCode Kernel Updater
chcp 65001 >nul

where node >nul 2>&1
if errorlevel 1 goto nonode

rem ---- one-shot mode: word commands or verbatim mjs flags ----
set "A1=%~1"
if "%A1%"=="" goto menu
if "%A1:~0,1%"=="-" (
  node scripts\update-kernel.mjs %*
  goto end
)
if /i "%A1%"=="check" goto one-check
if /i "%A1%"=="update" goto one-update
if /i "%A1%"=="cdn" goto one-update
if /i "%A1%"=="desktop" goto one-desktop
if /i "%A1%"=="manual" goto one-manual
if /i "%A1%"=="rollback" goto one-rollback
echo [update-kernel] unknown command: %A1%
echo usage: update-kernel.bat check ^| update ^| desktop ^| rollback ^| ^<mjs flags^>
exit /b 1

:one-check
node scripts\update-kernel.mjs --check
goto end

:one-update
node scripts\update-kernel.mjs --source cdn
goto end

:one-desktop
if "%~2"=="" goto one-desktop-simple
node scripts\update-kernel.mjs --source desktop --desktop "%~2"
goto end
:one-desktop-simple
node scripts\update-kernel.mjs --source desktop
goto end

:one-manual
node scripts\update-kernel.mjs --source manual
goto end

:one-rollback
node scripts\update-kernel.mjs --rollback
echo [update-kernel] restart the portal to apply the rollback
goto end

rem ---- interactive menu (no arguments, e.g. double-click) ----
:menu
cls
echo ==============================================
echo  ZCode kernel updater
echo ==============================================
echo.
echo   1. check      show current / latest available version
echo   2. update     upgrade from official CDN
echo   3. desktop    copy from local ZCode desktop install
echo   4. rollback   restore previous kernel backup
echo   0. exit
echo.
choice /c 12340 /n /m "Select: "
if errorlevel 5 goto quit
if errorlevel 4 goto do-rollback
if errorlevel 3 goto do-desktop
if errorlevel 2 goto do-update
goto do-check

:do-check
node scripts\update-kernel.mjs --check
goto after

:do-update
node scripts\update-kernel.mjs --source cdn
goto after

:do-desktop
node scripts\update-kernel.mjs --source desktop
goto after

:do-rollback
node scripts\update-kernel.mjs --rollback
echo [update-kernel] restart the portal to apply the rollback
goto after

:after
echo.
pause
goto menu

:quit
exit /b 0

:nonode
echo [update-kernel] node.exe not found in PATH
pause
exit /b 1

:end
exit /b %errorlevel%
