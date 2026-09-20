@echo off
chcp 65001 >nul
title 雾灯旅团 - 启动器
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch-game.ps1" %*
if errorlevel 1 (
  echo.
  echo 启动未完成，请按上面的提示处理后重新双击本文件。
  echo.
  pause
)
