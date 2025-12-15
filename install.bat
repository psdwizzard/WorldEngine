@echo off
setlocal enabledelayedexpansion

REM ------------------------------------------------------------------
REM Install script for World Engine
REM - installs npm dependencies for the entire workspace
REM - seeds optional .env.local files from the shipped examples
REM - ensures the workspace-data folder exists for user data
REM ------------------------------------------------------------------

SET "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo.
echo  ╔════════════════════════════════════════╗
echo  ║         WORLD ENGINE INSTALLER         ║
echo  ╚════════════════════════════════════════╝
echo.

echo Checking Node.js and npm setup...
IF NOT DEFINED NODE_VERSION (
  node --version >nul 2>&1 || (
    echo [ERROR] Node.js is required. Download from https://nodejs.org/.
    goto :error
  )
)

echo.
echo Installing npm dependencies (this may take a minute)...
npm install
IF %ERRORLEVEL% NEQ 0 (
  echo.
  echo [ERROR] `npm install` failed.
  goto :error
)

:seedEnv
setlocal
set "COPIED=0"
call :ensure_env "%SCRIPT_DIR%apps\api\.env.example" "%SCRIPT_DIR%apps\api\.env.local"
call :ensure_env "%SCRIPT_DIR%apps\web\.env.example" "%SCRIPT_DIR%apps\web\.env.local"
endlocal

echo.
echo Ensuring workspace-data directory exists...
if not exist "%SCRIPT_DIR%workspace-data" mkdir "%SCRIPT_DIR%workspace-data"

echo.
echo Installation complete! Run `run.bat` (or `npm run dev`) to start the workspace.
goto :eof

REM --------------------------------
REM Helper: copy example env if missing
REM --------------------------------
:ensure_env
REM %~1 = source, %~2 = destination
if exist "%~2" (
  echo Skipping %~nx2 (already present).
) else if exist "%~1" (
  copy "%~1" "%~2" >nul
  if %ERRORLEVEL% EQU 0 (
    echo Created %~nx2 from %~nx1.
  ) else (
    echo [WARN] Could not copy %~nx1 to %~nx2.
  )
) else (
  echo [WARN] %~nx1 not found. Please create %~nx2 manually.
)
goto :eof

:error
echo.
echo [ERROR] Installation aborted.
exit /b 1
