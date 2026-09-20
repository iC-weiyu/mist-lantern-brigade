@echo off
chcp 65001 >nul
title 雾灯旅团 - 推送更新到 GitHub（维护者）
cd /d "%~dp0.."

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0push-update.ps1"
echo.
pause
