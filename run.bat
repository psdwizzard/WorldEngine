@echo off
setlocal

if not exist package.json (
  echo World Generator workspace not initialized. Please run 'npm init' or pull the latest setup before launching.
  goto :eof
)

echo Ensuring dependencies are installed...
if exist node_modules (
  echo Dependencies already present.
) else (
  echo Installing packages...
  call npm install || goto :error
)

echo Starting development stack...
call npm run dev

goto :eof

:error
echo Failed to install dependencies. Check npm logs and retry.
exit /b 1