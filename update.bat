@echo off
echo Stashing local changes to ensure clean update...
git stash
echo.
echo Updating from GitHub...
git pull
if %errorlevel% neq 0 (
    echo Update failed!
    pause
    exit /b %errorlevel%
)
echo.
echo Update complete!
echo Your local changes were stashed. If you want to re-apply them on top of the update, run: git stash pop
pause
