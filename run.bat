@echo off
setlocal

echo.
echo  ╔═══════════════════════════════════════════════════════════════════╗
echo  ║                      WORLD ENGINE v0.1.3                          ║
echo  ║           AI-Powered Comic Panel Generation System                ║
echo  ╚═══════════════════════════════════════════════════════════════════╝
echo.
echo  FEATURES:
echo  ─────────────────────────────────────────────────────────────────────
echo  • Web UI for managing Characters, Locations, Items, and Panels
echo  • AI image generation via Google Gemini API
echo  • Multi-reference asset selection for consistent character rendering
echo  • Automatic speech bubble layout and text placement
echo  • PNG and PSD output with layer organization
echo.
echo  PHOTOSHOP PLUGIN:
echo  ─────────────────────────────────────────────────────────────────────
echo  • Install the plugin from: PhotoshopPlugin\WorldEnine_Photoshop-013.ccx
echo  • Use Adobe UXP Developer Tool to load the plugin
echo  • Generate images directly into Photoshop layers
echo  • Use marquee/lasso selection to create layer masks automatically
echo  • Select reference assets from your project within Photoshop
echo.
echo  ═══════════════════════════════════════════════════════════════════════
echo.

if not exist package.json (
  echo  [ERROR] World Engine workspace not initialized.
  echo          Please run 'npm init' or pull the latest setup before launching.
  goto :eof
)

echo  [1/2] Checking dependencies...
if exist node_modules (
  echo        Dependencies already installed.
) else (
  echo        Installing packages (this may take a few minutes)...
  call npm install || goto :error
)

echo.
echo  [2/2] Starting World Engine...
echo.
echo  ─────────────────────────────────────────────────────────────────────
echo  Web UI:    http://localhost:5173
echo  API:       http://localhost:4000
echo  ─────────────────────────────────────────────────────────────────────
echo.
echo  Press Ctrl+C to stop the servers.
echo.

call npm run dev

goto :eof

:error
echo.
echo  [ERROR] Failed to install dependencies. Check npm logs and retry.
exit /b 1
