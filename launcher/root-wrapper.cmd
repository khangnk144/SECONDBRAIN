@echo off
rem Second Brain: double-click to open the app. Run with "stop" to stop the background server.
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\launcher\start-second-brain.ps1" %*
if errorlevel 1 (
  echo.
  pause
)
