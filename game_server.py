"""
大观园·卦中境 — API 代理服务器 (FastAPI版)
代理 DeepSeek API 请求，绕过 CORS 限制
启动: python game_server.py
端口: 8766
"""
import os, re, json, traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import httpx

# ── 从 Hermes .env 读取 DeepSeek API Key ──
def load_api_key():
    env_paths = [
        os.path.join(os.environ.get('HERMES_HOME', ''), '.env'),
        os.path.expanduser('~/.hermes/.env'),
        r'E:\hermes-data\.env',
    ]
    for p in env_paths:
        try:
            with open(p, 'r', encoding='utf-8') as f:
                for line in f:
                    m = re.match(r'^DEEPSEEK_API_KEY\s*=\s*(.+)$', line.strip())
                    if m:
                        key = m.group(1).strip()
                        # Strip Windows carriage return if present
                        if key.endswith('\r'):
                            key = key[:-1]
                        return key
        except FileNotFoundError:
            continue
    return os.environ.get('DEEPSEEK_API_KEY', '')

API_KEY = load_api_key()
API_BASE = os.environ.get('DAGUAN_API_BASE', 'https://api.deepseek.com')

app = FastAPI(title="大观园·卦中境 API 代理")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/health")
def health():
    return {"status": "ok", "api_key_loaded": bool(API_KEY), "api_base": API_BASE}

@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    try:
        body = await request.body()
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{API_BASE}/v1/chat/completions",
                content=body,
                headers=headers,
            )

        # Try to parse response as JSON
        try:
            data = resp.json()
        except Exception:
            print(f"[proxy] DeepSeek returned non-JSON (status {resp.status_code}): {resp.text[:500]}")
            return JSONResponse(
                content={"error": f"Upstream returned non-JSON (status {resp.status_code})", "detail": resp.text[:500]},
                status_code=502,
            )

        if resp.status_code >= 400:
            print(f"[proxy] DeepSeek error (status {resp.status_code}): {json.dumps(data, ensure_ascii=False)[:500]}")

        return JSONResponse(content=data, status_code=resp.status_code)

    except httpx.TimeoutException:
        return JSONResponse(content={"error": "Upstream timeout"}, status_code=504)
    except Exception as e:
        print(f"[proxy] Internal error: {traceback.format_exc()}")
        return JSONResponse(content={"error": str(e)}, status_code=500)

if __name__ == '__main__':
    import uvicorn
    if not API_KEY:
        print("⚠ 警告: 未找到 DEEPSEEK_API_KEY！")
        print("  请在 E:\\hermes-data\\.env 中设置，或设置环境变量 DEEPSEEK_API_KEY")
    else:
        print(f"✅ 已加载 DeepSeek API Key (长度: {len(API_KEY)})")
        print(f"   Base URL: {API_BASE}")

    port = int(os.environ.get('DAGUAN_PORT', 8766))
    print(f"🚀 大观园·卦中境 API 代理已启动: http://localhost:{port}")
    print(f"   游戏页面: G:\\易经\\app\\daguanyuan.html")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
