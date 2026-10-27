@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Showkey · CS2 准星工坊

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [错误] 未检测到 Node.js
  echo   请先安装：https://nodejs.org  ^(装 LTS 版即可^)
  echo.
  pause
  exit /b 1
)

echo.
echo   ============================================
echo    Showkey · CS2 准星工坊
echo   ============================================
echo    本机访问： http://127.0.0.1:3800
echo    局域网访问：http://本机IP:3800 ^(需管理员执行一次 netsh advfirewall 放行 TCP 3800^)
echo.
echo    关闭本窗口即停止服务。
echo.

start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:3800"
node server.js
pause
