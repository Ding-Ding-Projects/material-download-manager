@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "REPOSITORY_ROOT=%~dp0"
set "SILENT_MODE=0"
if /I "%SILENT%"=="1" set "SILENT_MODE=1"
if /I "%MDM_BUILD_SILENT%"=="1" set "SILENT_MODE=1"

if "%~1"=="" goto :run
if /I "%~1"=="/s" (
  set "SILENT_MODE=1"
  if not "%~2"=="" goto :usage
  goto :run
)
if /I "%~1"=="--silent" (
  set "SILENT_MODE=1"
  if not "%~2"=="" goto :usage
  goto :run
)
if /I "%~1"=="/?" goto :usage_ok
if /I "%~1"=="--help" goto :usage_ok
goto :usage

:run
set "PS_EXE="
where pwsh.exe >nul 2>nul
if not errorlevel 1 set "PS_EXE=pwsh.exe"
if not defined PS_EXE set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" set "PS_EXE=powershell.exe"
if "%SILENT_MODE%"=="1" (
  "%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%REPOSITORY_ROOT%scripts\build-contract.ps1" -Mode Build -Silent
) else (
  "%PS_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%REPOSITORY_ROOT%scripts\build-contract.ps1" -Mode Build
)
set "EXIT_CODE=%ERRORLEVEL%"
endlocal & exit /b %EXIT_CODE%

:usage_ok
echo Usage: build.bat [/s^|--silent]
echo Builds the runnable Windows application. SILENT=1 or MDM_BUILD_SILENT=1 also enables silent mode.
endlocal & exit /b 0

:usage
echo Usage: build.bat [/s^|--silent]
echo Unknown argument or too many arguments. Silent mode never prompts or launches the app.
endlocal & exit /b 2
