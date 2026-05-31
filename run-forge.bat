@echo off
setlocal
title WorldEngine - Forge Edition

cd /d "%~dp0" || exit /b 1

echo.
echo ================================================================
echo   WorldEngine - Forge Edition
echo   Cloudflare Access + per-user comic workspaces
echo ================================================================
echo.

if not exist ".env.forge" (
  echo [ERROR] .env.forge is missing. Copy .env.forge.example and fill secrets.
  exit /b 1
)

for /f "usebackq tokens=1,* delims==" %%A in (".env.forge") do (
  if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
)

if not exist "node_modules\" (
  echo [1/4] Installing dependencies...
  call npm install
  if errorlevel 1 exit /b %ERRORLEVEL%
)

echo [2/4] Building shared package...
call npm --workspace @worldengine/shared run build
if errorlevel 1 exit /b %ERRORLEVEL%

echo [3/4] Building web frontend...
set "VITE_WORLDENGINE_HOSTED=1"
set "VITE_WORLDENGINE_MANAGED_KEY=1"
set "VITE_BASE_PATH=/"
set "VITE_API_BASE_URL="
call npm --workspace @worldengine/web exec vite build
if errorlevel 1 exit /b %ERRORLEVEL%

echo [4/4] Starting API and web gateway on %HOST%:%PORT%...
echo        Public URL: https://worldengine.bluemediaserver.xyz/
echo.
call npm --workspace @worldengine/api run serve
