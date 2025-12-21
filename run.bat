@echo off
setlocal

REM --------------------------------------------------------------
REM World Engine launcher
REM - ensures we run from the repo root
REM - installs deps if node_modules is missing
REM - starts both web and API dev servers
REM --------------------------------------------------------------

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%" || goto :error_cd

echo.
echo ================================================================
echo WORLD ENGINE v0.1.3
echo AI-Powered Comic Panel Generation System
echo ================================================================
echo.
echo FEATURES:
echo - Web UI for managing Characters, Locations, Items, and Panels
echo - AI image generation via Google Gemini API
echo - Multi-reference asset selection for consistent character rendering
echo - Automatic speech bubble layout and text placement
echo - PNG and PSD output with layer organization
echo.
echo PHOTOSHOP PLUGIN:
echo - Install the plugin from: PhotoshopPlugin\WorldEnine_Photoshop-013.ccx
echo - Use Adobe UXP Developer Tool to load the plugin
echo - Generate images directly into Photoshop layers
echo - Use marquee/lasso selection to create layer masks automatically
echo - Select reference assets from your project within Photoshop
echo.

if not exist "package.json" (
  echo [ERROR] package.json not found. Please run from the project root.
  goto :error
)

echo [1/2] Checking dependencies...
if exist "node_modules\" (
  echo        Dependencies already installed.
  goto :start_servers
)
echo        Installing packages (this may take a few minutes)...
call npm install
if errorlevel 1 goto :error_install

:start_servers

echo.
echo [2/2] Starting World Engine (Ctrl+C to stop)...
echo -------------------------------------------------------------
echo   Web UI: http://localhost:6248
echo   API:    http://localhost:4000
echo -------------------------------------------------------------
echo.

call npm run dev
exit /b %ERRORLEVEL%

:error_cd
echo [ERROR] Unable to change directory to "%SCRIPT_DIR%".
exit /b 1

:error_install
echo.
echo [ERROR] Failed to install dependencies. Check npm logs and retry.
exit /b 1

:error
exit /b 1
