@echo off
chcp 65001 >nul
title 易学私教 — 启动服务

echo.
echo ═══════════════════════════════
echo   易学私教 — BGE-M3 搜索服务
echo ═══════════════════════════════
echo.

cd /d "G:\易经\app"

echo [1/3] 启动 BGE-M3 向量搜索 API (端口 8765)...
start "易学API" python launcher_search.py

echo [2/3] 启动 HTTP 服务器 (端口 8899)...
start "易学PWA" python -m http.server 8899 --bind 0.0.0.0

echo [3/3] 启动 AcFun 视频代理 (端口 8897)...
start "易学视频" python server.py 8897

echo.
echo ✅ 服务已启动！
echo.
echo 本机访问: http://localhost:8899
echo.

REM 获取本机IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    echo 手机访问: http://%%a:8899
)

echo.
echo ⚠️  关闭此窗口不会停止服务（需手动关闭三个命令行窗口）
echo ⚠️  BGE-M3 加载需要 ~30 秒
echo.
pause
