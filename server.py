"""
易学私教 HTTP 服务器
- 静态文件服务 (替代 python -m http.server)
- /api/video?p=N  获取 AcFun 视频 m3u8 流地址

用法: python server.py [端口] [目录]
默认: python server.py 8899 .
"""
import http.server
import json
import os
import subprocess
import sys
import urllib.parse


class YijingServer(http.server.SimpleHTTPRequestHandler):

    # ── 路由 ──────────────────────────────────────────
    def do_OPTIONS(self):
        """处理 CORS 预检请求"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip('/') or '/'
        params = urllib.parse.parse_qs(parsed.query)

        if path == '/api/video':
            self._video_api(params)
        elif path == '/api/ping':
            self._json({'ok': True})
        else:
            super().do_GET()

    # ── 视频 API ──────────────────────────────────────
    def _video_api(self, params):
        p_num = params.get('p', [None])[0]
        if not p_num:
            return self._json({'error': '缺少参数 p'}, 400)
        try:
            p_num = int(p_num)
        except ValueError:
            return self._json({'error': 'p 必须是数字'}, 400)

        url = self._fetch_acfun(p_num)
        if not url:
            return self._json({'error': f'无法获取第{p_num}集视频地址'}, 502)

        self._json({'p': p_num, 'url': url, 'type': 'm3u8'})

    def _fetch_acfun(self, p_num):
        """通过 yt-dlp 获取 AcFun m3u8 地址"""
        acfun_url = f'https://www.acfun.cn/v/ac36887663_{p_num}'
        try:
            result = subprocess.run(
                [sys.executable, '-m', 'yt_dlp', '--no-playlist',
                 '-f', 'best', '-g', acfun_url],
                capture_output=True, text=True, timeout=25,
                env={**os.environ, 'PYTHONIOENCODING': 'utf-8'}
            )
            if result.returncode == 0 and result.stdout.strip():
                lines = result.stdout.strip().split('\n')
                return lines[-1].strip()
        except Exception:
            pass
        return None

    # ── HTTP 工具 ─────────────────────────────────────
    def _json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    directory = sys.argv[2] if len(sys.argv) > 2 else '.'

    os.chdir(directory)
    server = http.server.HTTPServer(('0.0.0.0', port), YijingServer)
    print(f'易学私教服务已启动')
    print(f'  地址: http://localhost:{port}')
    print(f'  API:  http://localhost:{port}/api/video?p=22')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('服务已停止')
        server.server_close()
