@echo off
rem PhysVis 网页版一键启动：自动选择 Node.js（npx serve）或 Python 起本地静态服务器并打开浏览器
chcp 65001 >nul
cd /d "%~dp0"
title PhysVis 本地运行
echo [PhysVis] 正在启动本地服务器，浏览器将自动打开……
echo 关闭本窗口即可停止服务。

where npx >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:4173/
  npx --yes serve . -l 4173
  goto :end
)

where python >nul 2>nul
if %errorlevel%==0 (
  start "" http://localhost:4173/
  python -m http.server 4173
  goto :end
)

echo 未检测到 Node.js 或 Python。
echo 请先安装 Node.js（https://nodejs.org），或改用任意静态服务器打开本目录。
pause
:end
