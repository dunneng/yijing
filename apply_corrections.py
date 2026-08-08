#!/usr/bin/env python3
"""
将 corrections.json 中的纠错合并回源数据文件。

用法：
  python apply_corrections.py [--dry-run] [--clear]

  --dry-run  只检查不写入
  --clear    合并后清空已合并的纠错

数据格式说明：
  knowledge_zs_v3.js 使用 JS 对象字面量（非标准 JSON），例如：
    {v:1,c:1,p:9,x:'文本内容',img:'xxx'}
  因此不能直接用 json.loads，使用正则匹配替换。
  
  fupeirong_data.js 使用标准 JSON：var FP_DATA={...};
"""

import json, re, sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
CORRECTIONS = SCRIPT_DIR / "corrections.json"
ZS_JS = SCRIPT_DIR / "knowledge_zs_v3.js"
FP_JS = SCRIPT_DIR / "fupeirong_data.js"


def js_escape_single(text: str) -> str:
    """将文本转义为 JS 单引号字符串中的表示。"""
    # 先处理反斜杠和引号
    result = text.replace("\\", "\\\\").replace("'", "\\'")
    # 处理换行等
    result = result.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    return result


def find_chunk_boundaries(content: str, array_start: int) -> list:
    """解析 JS 数组中的对象边界，返回 [(start, end), ...] 列表。"""
    chunks = []
    depth = 0
    in_single = False
    in_double = False
    escape = False
    elem_start = None
    
    for i in range(array_start, len(content)):
        ch = content[i]
        
        if escape:
            escape = False
            continue
        
        if ch == '\\':
            escape = True
            continue
        
        # 处理字符串
        if in_single:
            if ch == "'":
                in_single = False
            continue
        if in_double:
            if ch == '"':
                in_double = False
            continue
        
        if ch == "'":
            in_single = True
            continue
        if ch == '"':
            in_double = True
            continue
        
        # 不在字符串内
        if ch == '{' and depth == 0:
            elem_start = i
        if ch == '{':
            depth += 1
        if ch == '}':
            depth -= 1
            if depth == 0 and elem_start is not None:
                chunks.append((elem_start, i + 1))
                elem_start = None
        if ch == ']' and depth == 0:
            break
    
    return chunks


def replace_chunk_x(content: str, chunk_start: int, chunk_end: int, new_text: str) -> str:
    """替换一个 JS 对象中 x 字段的值。"""
    chunk = content[chunk_start:chunk_end]
    
    # 匹配 x:'...' 或 x:"..." 
    # 模式: x 后面跟冒号，然后是单引号或双引号字符串
    pattern = re.compile(r"(x\s*:\s*)'((?:[^'\\]|\\.)*)'", re.DOTALL)
    match = pattern.search(chunk)
    
    if match:
        escaped = js_escape_single(new_text)
        new_chunk = chunk[:match.start()] + match.group(1) + "'" + escaped + "'" + chunk[match.end():]
        return content[:chunk_start] + new_chunk + content[chunk_end:]
    
    # 尝试双引号
    pattern_dq = re.compile(r'(x\s*:\s*)"((?:[^"\\]|\\.)*)"', re.DOTALL)
    match_dq = pattern_dq.search(chunk)
    if match_dq:
        escaped = new_text.replace('\\', '\\\\').replace('"', '\\"')
        escaped = escaped.replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
        new_chunk = chunk[:match_dq.start()] + match_dq.group(1) + '"' + escaped + '"' + chunk[match_dq.end():]
        return content[:chunk_start] + new_chunk + content[chunk_end:]
    
    print(f"  WARN: x field not found in chunk at {chunk_start}")
    return content


def apply_zs_corrections(corrections: dict) -> int:
    """将 ZS_CHUNKS 纠错写入 knowledge_zs_v3.js。"""
    zs_corr = corrections.get("knowledge_zs_v3", {})
    if not zs_corr:
        return 0

    print(f"[ZS] {len(zs_corr)} corrections to apply")
    
    with open(ZS_JS, "r", encoding="utf-8") as f:
        content = f.read()
    
    match = re.search(r"const ZS_CHUNKS\s*=\s*\[", content)
    if not match:
        print("[ZS] ERROR: ZS_CHUNKS array not found")
        return 0
    
    array_start = match.end() - 1  # position of [
    chunks = find_chunk_boundaries(content, array_start)
    print(f"[ZS] Found {len(chunks)} chunks in file")
    
    count = 0
    modified = content
    
    # 从后往前替换以保持位置不变
    items = sorted(zs_corr.items(), key=lambda x: -int(x[0]))
    for idx_str, new_text in items:
        idx = int(idx_str)
        if idx >= len(chunks):
            print(f"[ZS] WARN: chunk {idx} out of range (max {len(chunks) - 1})")
            continue
        
        cs, ce = chunks[idx]
        modified = replace_chunk_x(modified, cs, ce, new_text)
        count += 1
        
        # 预览
        preview = new_text[:50] + "..." if len(new_text) > 50 else new_text
        print(f"[ZS] Applied: chunk {idx} → {preview}")
    
    if count > 0:
        with open(ZS_JS, "w", encoding="utf-8") as f:
            f.write(modified)
        print(f"[ZS] File saved: {len(modified)} bytes")
    
    return count


def apply_fp_corrections(corrections: dict) -> int:
    """将 FP_DATA 纠错写入 fupeirong_data.js。"""
    fp_corr = corrections.get("fupeirong_data", {})
    if not fp_corr:
        return 0

    print(f"[FP] {len(fp_corr)} corrections to apply")
    
    with open(FP_JS, "r", encoding="utf-8") as f:
        content = f.read()
    
    match = re.search(r"var FP_DATA\s*=\s*(\{)", content)
    if not match:
        print("[FP] ERROR: FP_DATA not found")
        return 0
    
    json_start = match.start(1)
    json_text = content[json_start:].strip()
    if json_text.endswith(";"):
        json_text = json_text[:-1]
    
    try:
        fp_data = json.loads(json_text)
    except json.JSONDecodeError as e:
        print(f"[FP] ERROR: JSON parse failed at pos {e.pos}: {e}")
        print(f"[FP] Context: ...{json_text[max(0,e.pos-20):e.pos+20]}...")
        return 0
    
    count = 0
    for key, new_value in fp_corr.items():
        sk = str(key)
        if sk in fp_data:
            fp_data[sk] = new_value
            count += 1
            preview = new_value[:50] + "..." if len(new_value) > 50 else new_value
            print(f"[FP] Applied: hex {key} → {preview}")
        else:
            print(f"[FP] WARN: hex {key} not found in FP_DATA")
    
    if count > 0:
        new_json = json.dumps(fp_data, ensure_ascii=False, indent=2)
        new_content = content[:json_start] + new_json + ";\n"
        with open(FP_JS, "w", encoding="utf-8") as f:
            f.write(new_content)
        print(f"[FP] File saved: {len(new_content)} bytes")
    
    return count


def main():
    dry_run = "--dry-run" in sys.argv
    do_clear = "--clear" in sys.argv
    
    if not CORRECTIONS.exists():
        print(f"[SKIP] corrections.json not found — nothing to merge")
        return
    
    with open(CORRECTIONS, "r", encoding="utf-8") as f:
        corrections = json.load(f)
    
    zs_count = len(corrections.get("knowledge_zs_v3", {}))
    fp_count = len(corrections.get("fupeirong_data", {}))
    total = zs_count + fp_count
    
    if total == 0:
        print("[SKIP] No corrections pending")
        return
    
    print(f"Found {total} corrections ({zs_count} ZS + {fp_count} FP)")
    
    if dry_run:
        print("[DRY-RUN] Would apply:")
        for source, items in corrections.items():
            for key in items:
                preview = items[key][:60] + "..." if len(items[key]) > 60 else items[key]
                print(f"  {source}/{key}: {preview}")
        return
    
    zs_done = apply_zs_corrections(corrections)
    fp_done = apply_fp_corrections(corrections)
    
    total_done = zs_done + fp_done
    print(f"\n[DONE] Merged {zs_done} ZS + {fp_done} FP corrections into source files")
    
    if do_clear and total_done > 0:
        # 只清除已成功合并的
        if zs_done > 0:
            corrections["knowledge_zs_v3"] = {}
        if fp_done > 0:
            corrections["fupeirong_data"] = {}
        with open(CORRECTIONS, "w", encoding="utf-8") as f:
            json.dump(corrections, f, ensure_ascii=False, indent=2)
        print("[OK] Merged corrections removed from corrections.json")
    
    if not do_clear:
        print("[NOTE] corrections.json NOT cleared. Use --clear to clear merged items.")


if __name__ == "__main__":
    main()
