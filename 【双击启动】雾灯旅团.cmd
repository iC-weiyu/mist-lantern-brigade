@echo off
title Mistlight Brigade - Launcher
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch-game.ps1" %*
if errorlevel 1 (
  echo.
  echo Launch failed. Keep this window open and check the message above.
  pause
)
