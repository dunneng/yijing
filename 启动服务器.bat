@echo off
chcp 65001 >nul
cd /d "G:\易经\app"
echo.
echo ═══════════════════════════════════════
echo   易学私教 — 曾仕强·易经的智慧
echo ═══════════════════════════════════════
echo.
echo   本机访问: http://localhost:8899
echo.
echo   按 Ctrl+C 停止服务器
echo ═══════════════════════════════════════
echo.

start "易学PWA" python -m http.server 8899 --bind 0.0.0.0
start "易学视频" python server.py 8897

echo ✅ 服务已启动
pause
