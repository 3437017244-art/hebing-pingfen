@echo off
chcp 65001 >nul
cd /d "%~dp0"

title 购物与商店评分 - 电脑版

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未找到 npm，请先安装 Node.js。
  echo 下载：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron" (
  echo 正在安装电脑版依赖，请稍候...
  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
  call npm install
  if errorlevel 1 (
    echo [错误] 依赖安装失败。
    pause
    exit /b 1
  )
)

echo 正在启动最新电脑版（源码直启，改完代码重启即生效）...
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
call npm start
if errorlevel 1 (
  echo.
  echo [错误] 启动失败。
  pause
  exit /b 1
)
