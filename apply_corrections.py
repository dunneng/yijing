#!/usr/bin/env python3
"""
将 corrections.json 中的纠错合并回源数据文件。

用法：
  python apply_corrections.py [--dry-run] [--clear]

  --dry-run  只检查不写入
  --clear    合并后清空已合并的纠错

数据格式：
  corrections.json:
  {
    "knowledge_zs_v3": { "<chunk_idx>": "修正文本" },
    "fupeirong_data": {
      "1": "整卦修正文本",          // 旧格式（整卦替换）
      "1_卦辞": "卦辞修正",         // 新格式（分段替换）
      "1_初九": "初九爻修正"
    }
  }
"""

import json, re, sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()
CORRECTIONS = SCRIPT_DIR / "corrections.json"
ZS_JS = SCRIPT_DIR / "knowledge_zs_v3.js"
FP_JS = SCRIPT_DIR / "fupeirong_data.js"


def js_escape_single(text: str) -> str:
    result = text.replace("\\", "\\\\").replace("'", "\\'")
    result = result.replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
    return result


def find_chunk_boundaries(content: str, array_start: int) -> list:
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
        if in_single:
            if ch == "'": in_single = False
            continue
        if in_double:
            if ch == '"': in_double = False
            continue
        if ch == "'": in_single = True; continue
        if ch == '"': in_double = True; continue
        if ch == '{' and depth == 0: elem_start = i
        if ch == '{': depth += 1
        if ch == '}':
            depth -= 1
            if depth == 0 and elem_start is not None:
                chunks.append((elem_start, i + 1))
                elem_start = None
        if ch == ']' and depth == 0:
            break
    return chunks


def replace_chunk_x(content: str, chunk_start: int, chunk_end: int, new_text: str) -> str:
    chunk = content[chunk_start:chunk_end]
    pattern = re.compile(r"(x\s*:\s*)'((?:[^'\\]|\\.)*)'", re.DOTALL)
    match = pattern.search(chunk)
    if match:
        escaped = js_escape_single(new_text)
        return content[:chunk_start] + chunk[:match.start()] + match.group(1) + "'" + escaped + "'" + chunk[match.end():] + content[chunk_end:]
    print(f"  WARN: x field not found in chunk at {chunk_start}")
    return content


def apply_zs_corrections(corrections: dict) -> int:
    zs_corr = corrections.get("knowledge_zs_v3", {})
    if not zs_corr: return 0
    print(f"[ZS] {len(zs_corr)} corrections to apply")
    with open(ZS_JS, "r", encoding="utf-8") as f:
        content = f.read()
    match = re.search(r"const ZS_CHUNKS\s*=\s*\[", content)
    if not match:
        print("[ZS] ERROR: ZS_CHUNKS array not found"); return 0
    array_start = match.end() - 1
    chunks = find_chunk_boundaries(content, array_start)
    print(f"[ZS] Found {len(chunks)} chunks in file")
    count = 0
    modified = content
    for idx_str, new_text in sorted(zs_corr.items(), key=lambda x: -int(x[0])):
        idx = int(idx_str)
        if idx >= len(chunks):
            print(f"[ZS] WARN: chunk {idx} out of range"); continue
        cs, ce = chunks[idx]
        modified = replace_chunk_x(modified, cs, ce, new_text)
        count += 1
        preview = new_text[:50] + "..." if len(new_text) > 50 else new_text
        print(f"[ZS] Applied: chunk {idx} → {preview}")
    if count > 0:
        with open(ZS_JS, "w", encoding="utf-8") as f:
            f.write(modified)
        print(f"[ZS] File saved: {len(modified)} bytes")
    return count


def split_fp_text(text: str) -> list:
    """将 FP 文本按 卦辞/各爻 拆分，返回 [(label, start, end), ...]"""
    sections = []
    first_yao = re.search(r'\n(初[六九]|九[二三四五]|六[二三四五]|上[六九]|用[六九])', text)
    header_end = first_yao.start() if first_yao else len(text)
    sections.append(("卦辞", 0, header_end))
    if not first_yao:
        return sections
    remaining = text[header_end + 1:]  # skip the \n before first yao
    # 按爻位标记拆分（保留分隔 \n）
    pos = header_end + 1
    for part in re.split(r'\n(?=初[六九]|九[二三四五]|六[二三四五]|上[六九]|用[六九])', remaining):
        label_match = re.match(r'(初[六九]|九[二三四五]|六[二三四五]|上[六九]|用[六九])', part)
        label = label_match.group(1) if label_match else "?"
        start = pos
        end = pos + len(part)
        sections.append((label, start, end))
        pos = end + 1  # +1 for the \n between sections
    return sections


def apply_fp_corrections(corrections: dict) -> int:
    fp_corr = corrections.get("fupeirong_data", {})
    if not fp_corr: return 0
    print(f"[FP] {len(fp_corr)} corrections to apply")
    with open(FP_JS, "r", encoding="utf-8") as f:
        content = f.read()
    match = re.search(r"var FP_DATA\s*=\s*(\{)", content)
    if not match:
        print("[FP] ERROR: FP_DATA not found"); return 0
    json_start = match.start(1)
    json_text = content[json_start:].strip().rstrip(";")
    try:
        fp_data = json.loads(json_text)
    except json.JSONDecodeError as e:
        print(f"[FP] ERROR: JSON parse failed: {e}"); return 0

    count = 0
    for key, new_value in list(fp_corr.items()):
        sk = str(key)
        if "_" in sk and not sk.startswith("_"):
            # 新格式：分段纠错 key="1_卦辞"
            hex_id, section_label = sk.split("_", 1)
            if hex_id not in fp_data:
                print(f"[FP] WARN: hex {hex_id} not found"); continue
            old_text = fp_data[hex_id]
            sections = split_fp_text(old_text)
            replaced = False
            for sec_label, sec_start, sec_end in reversed(sections):
                if sec_label == section_label:
                    fp_data[hex_id] = old_text[:sec_start] + new_value + old_text[sec_end:]
                    replaced = True
                    count += 1
                    preview = new_value[:50] + "..." if len(new_value) > 50 else new_value
                    print(f"[FP] Applied: hex {hex_id}/{section_label} → {preview}")
                    break
            if not replaced:
                print(f"[FP] WARN: section '{section_label}' not found in hex {hex_id}")
        else:
            # 旧格式：整卦替换
            if sk in fp_data:
                fp_data[sk] = new_value
                count += 1
                preview = new_value[:50] + "..." if len(new_value) > 50 else new_value
                print(f"[FP] Applied: hex {sk} (full) → {preview}")
            else:
                print(f"[FP] WARN: hex {sk} not found")

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
        print("[SKIP] corrections.json not found")
        return
    with open(CORRECTIONS, "r", encoding="utf-8") as f:
        corrections = json.load(f)
    zs_count = len(corrections.get("knowledge_zs_v3", {}))
    fp_count = len(corrections.get("fupeirong_data", {}))
    total = zs_count + fp_count
    if total == 0:
        print("[SKIP] No corrections pending"); return
    print(f"Found {total} corrections ({zs_count} ZS + {fp_count} FP)")
    if dry_run:
        print("[DRY-RUN] Would apply:")
        for source, items in corrections.items():
            for key in items:
                v = items[key]
                preview = v[:60] + "..." if len(v) > 60 else v
                print(f"  {source}/{key}: {preview}")
        return
    zs_done = apply_zs_corrections(corrections)
    fp_done = apply_fp_corrections(corrections)
    total_done = zs_done + fp_done
    print(f"\n[DONE] Merged {zs_done} ZS + {fp_done} FP corrections")
    if do_clear and total_done > 0:
        if zs_done > 0: corrections["knowledge_zs_v3"] = {}
        if fp_done > 0: corrections["fupeirong_data"] = {}
        with open(CORRECTIONS, "w", encoding="utf-8") as f:
            json.dump(corrections, f, ensure_ascii=False, indent=2)
        print("[OK] Merged corrections removed from corrections.json")
    if not do_clear:
        print("[NOTE] corrections.json NOT cleared. Use --clear to clear.")


if __name__ == "__main__":
    main()
