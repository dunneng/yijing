"""
BGE-M3 向量搜索 API — FastAPI 服务
GET /search?q=查询&top_k=5  → 返回最相关段落+章节信息
"""
import os, re, json, numpy as np
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer

os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'

# ── 启动时加载模型和向量 ──
print("加载 BGE-M3 模型...")
model = SentenceTransformer('BAAI/bge-m3')

print("加载向量库...")
vec_path = os.path.join(os.path.dirname(__file__), 'knowledge_zs_vectors.json')
with open(vec_path, 'r', encoding='utf-8') as f:
    doc_vectors = np.array(json.load(f), dtype=np.float32)
print(f"向量: {doc_vectors.shape}")

# 加载文本
kb_path = os.path.join(os.path.dirname(__file__), 'knowledge_zs.js')
with open(kb_path, 'r', encoding='utf-8') as f:
    kb = f.read()

# 加载纠错
corrections = {}
corr_path = os.path.join(os.path.dirname(__file__), 'corrections.json')
if os.path.exists(corr_path):
    with open(corr_path, 'r', encoding='utf-8') as f:
        corrections = json.load(f)

# 提取 chunks
match = re.search(r'const ZS_CHUNKS\s*=\s*(\[.*?\]);', kb, re.DOTALL)
pattern = r"x:'((?:[^'\\]|\\.)*)'"
texts = [m.replace("\\'", "'") for m in re.findall(pattern, match.group(1))]

# 应用纠错
zs_corr = corrections.get('knowledge_zs_v3', {})
for k, v in zs_corr.items():
    idx = int(k)
    if 0 <= idx < len(texts):
        texts[idx] = v
if zs_corr:
    print(f"已应用 {len(zs_corr)} 条纠错")

# 提取 TOC
toc_match = re.search(r'const ZS_TOC\s*=\s*(\[.*?\]);', kb, re.DOTALL)
toc_raw = toc_match.group(1)
# 解析 TOC: {id:1,v:1,c:1,t:'阴阳之道',p:9}
toc = []
for m in re.finditer(r"\{id:(\d+),v:(\d+),c:(\d+),t:'([^']*)',p:(\d+)\}", toc_raw):
    toc.append({"id": int(m.group(1)), "v": int(m.group(2)), "c": int(m.group(3)),
                 "t": m.group(4), "p": int(m.group(5))})

# 从 chunk 提取 v,c,p
chunk_meta = []
for m in re.finditer(r"\{v:(\d+),c:(\d+),p:(\d+),x:'", match.group(1)):
    chunk_meta.append({"v": int(m.group(1)), "c": int(m.group(2)), "p": int(m.group(3))})

print(f"文本: {len(texts)}, TOC: {len(toc)}, Meta: {len(chunk_meta)}")

def get_chapter_title(v, p):
    """通过卷+页码找章节标题"""
    for t in reversed(toc):
        if t['v'] == v and p >= t['p']:
            return t['t']
    return ''

# ── API ──
app = FastAPI(title="易学私教搜索API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/search")
def search(q: str = Query(..., description="查询文本"),
           top_k: int = Query(5, ge=1, le=20)):
    # 生成查询向量
    q_vec = model.encode([q], normalize_embeddings=True)[0]
    # 点积（已归一化=余弦相似度）
    scores = np.dot(doc_vectors, q_vec)
    top_idx = np.argsort(scores)[::-1][:top_k * 3]  # 多取一些用于去重
    
    results = []
    seen_sources = set()
    for idx in top_idx:
        if scores[idx] < 0.3:  # 相似度阈值
            break
        if len(results) >= top_k:
            break
        
        meta = chunk_meta[idx] if idx < len(chunk_meta) else {}
        title = get_chapter_title(meta.get('v', 0), meta.get('p', 0))
        source_key = f"{meta.get('v', '?')}-{title}"
        
        # 同源去重（只保留得分最高的）
        if source_key in seen_sources:
            continue
        seen_sources.add(source_key)
        
        results.append({
            "text": texts[idx],
            "score": float(scores[idx]),
            "source": f"卷{meta.get('v', '?')} · {title}" if title else f"卷{meta.get('v', '?')}",
            "chapter": title,
            "volume": meta.get('v', 0),
            "idx": int(idx)
        })
    
    return {"query": q, "results": results, "total": len(results)}

@app.get("/health")
def health():
    return {"status": "ok", "vectors": doc_vectors.shape[0], "dim": doc_vectors.shape[1]}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
