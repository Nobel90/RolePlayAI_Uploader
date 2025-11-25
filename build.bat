@echo off
echo Starting Build Process...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "./build-signed.ps1"

echo.
echo ===================================================
echo Build process finished (check above for errors).
pause


