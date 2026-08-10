/**
 * 内容纠错编辑器
 * 长按文本 → 弹出编辑框 → 修改 → 提交 corrections.json 到 GitHub 仓库
 * 
 * 数据流：
 *   PWA 加载 → 读原数据 + corrections.json → 应用纠错后显示
 *   用户纠错 → 更新 corrections.json → 提交到 GitHub
 * 
 * corrections.json 结构：
 * {
 *   "knowledge_zs_v3": { "<chunk_idx>": "修正后文本" },
 *   "fupeirong_data": { "<hexId>": "修正后全文" }
 * }
 */
const EDITOR = {
  _repo: 'dunneng/yijing',
  _branch: 'master',
  _path: 'corrections.json',
  _corrections: null,
  _sha: null,
  _ready: false,
  _initialized: false,

  // ── 初始化：加载现有 corrections.json ──
  async init() {
    if (this._initialized) return this._ready;
    this._initialized = true;

    const token = GH_AUTH.getToken();
    if (!token) { console.log('Editor: not logged in'); return false; }

    try {
      const resp = await fetch(
        `https://api.github.com/repos/${this._repo}/contents/${this._path}?ref=${this._branch}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
      );

      if (resp.ok) {
        const data = await resp.json();
        this._sha = data.sha;
        // Proper UTF-8 decode: atob → binary bytes → TextDecoder → JSON
        const binary = atob(data.content);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const text = new TextDecoder().decode(bytes);
        this._corrections = JSON.parse(text);
        console.log('Editor: loaded corrections, SHA=' + this._sha.slice(0,7));
      } else if (resp.status === 404) {
        // 文件不存在
        this._corrections = { knowledge_zs_v3: {}, fupeirong_data: {} };
        console.log('Editor: no corrections file yet, starting fresh');
      } else {
        console.warn('Editor init failed:', resp.status);
        return false;
      }
      this._ready = true;
      return true;
    } catch (e) {
      console.warn('Editor init error:', e.message);
      return false;
    }
  },

  // ── 获取某个 chunk 的纠错文本（如有）──
  getChunkCorrection(chunkIdx) {
    if (!this._corrections) return null;
    return this._corrections.knowledge_zs_v3?.[String(chunkIdx)] || null;
  },

  // ── 获取某个卦的 FP 纠错（重建全文）──
  getFPCorrection(hexId) {
    if (!this._corrections) return null;
    var fpCorr = this._corrections.fupeirong_data || {};
    var hexStr = String(hexId);
    // 新格式：检查是否有以 "hexId_" 开头的分段纠错
    var prefix = hexStr + '_';
    var sectionKeys = Object.keys(fpCorr).filter(function(k) { return k.indexOf(prefix) === 0; });
    if (sectionKeys.length === 0) {
      // 旧格式：完整文本替换
      return fpCorr[hexStr] || null;
    }
    // 新格式：按段落重建全文
    if (typeof FP_DATA === 'undefined' || !FP_DATA[hexStr]) return null;
    var baseText = FP_DATA[hexStr];
    var sections = splitFPSections(baseText);
    var correctedSections = sections.map(function(sec) {
      var key = hexStr + '_' + sec.label;
      return fpCorr[key] || sec.text;
    });
    return correctedSections.join('\n');
  },

  // ── 显示编辑弹窗 ──
  show(source, key, oldText, label) {
    // 移除旧弹窗
    const old = document.getElementById('editOverlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'editOverlay';
    overlay.innerHTML = `
      <div class="edit-mask" onclick="EDITOR.close()"></div>
      <div class="edit-panel">
        <div class="edit-header">
          <span class="edit-title">纠错编辑</span>
          <span class="edit-label">${label || source + '/' + key}</span>
          <span class="edit-close" onclick="EDITOR.close()">✕</span>
        </div>
        <textarea class="edit-textarea" id="editTextarea" oninput="EDITOR._updatePreview()">${this._escapeHtml(oldText)}</textarea>
        <div class="edit-preview" id="editPreview" style="display:none"></div>
        <div class="edit-toolbar">
          <button class="etb-btn" onclick="EDITOR.wrapMarkup('**','**')" title="加粗">B</button>
          <button class="etb-btn etb-i" onclick="EDITOR.wrapMarkup('*','*')" title="斜体">I</button>
          <span class="etb-sep"></span>
          <button class="etb-btn etb-red" onclick="EDITOR.wrapMarkup('[red]','[/red]')" title="红色">红</button>
          <button class="etb-btn etb-gold" onclick="EDITOR.wrapMarkup('[gold]','[/gold]')" title="金色">金</button>
          <button class="etb-btn etb-green" onclick="EDITOR.wrapMarkup('[green]','[/green]')" title="绿色">绿</button>
          <button class="etb-btn etb-hl" onclick="EDITOR.wrapMarkup('[highlight]','[/highlight]')" title="高亮">亮</button>
          <span class="etb-sep"></span>
          <button class="etb-btn" onclick="EDITOR._togglePreview()" title="预览分段" style="font-size:10px;width:auto;padding:0 6px">👁</button>
          <button class="etb-btn" onclick="EDITOR._mergeNext()" title="合并下一段" style="font-size:10px;width:auto;padding:0 5px">⇅</button>
        </div>
        <div class="edit-footer">
          <span class="edit-status" id="editStatus"></span>
          <button class="edit-btn" onclick="EDITOR.close()">取消</button>
          <button class="edit-btn primary" onclick="EDITOR.submit()">提交</button>
        </div>
      </div>`;

    // 添加 CSS（如果还没有）
    if (!document.getElementById('editStyles')) {
      const style = document.createElement('style');
      style.id = 'editStyles';
      style.textContent = `
#editOverlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;display:flex;align-items:center;justify-content:center}
.edit-mask{position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6)}
.edit-panel{position:relative;width:92%;max-width:400px;max-height:80vh;background:var(--card,#FFF9F0);border-radius:12px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.3)}
.edit-header{display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid var(--divider,#E5D9C5);gap:8px}
.edit-title{font-size:15px;font-weight:700;color:var(--text,#2A241E);letter-spacing:1px}
.edit-label{font-size:11px;color:var(--sub,#6B5E4F);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.edit-close{font-size:18px;color:var(--sub,#6B5E4F);cursor:pointer;padding:0 4px}
.edit-textarea{flex:1;min-height:140px;padding:14px;border:none;outline:none;resize:none;background:var(--bg,#F5EFE3);color:var(--text,#2A241E);font-family:"Noto Serif SC",serif;font-size:14px;line-height:1.8;letter-spacing:.5px}
.edit-footer{display:flex;align-items:center;padding:10px 14px;border-top:1px solid var(--divider,#E5D9C5);gap:8px}
.edit-status{flex:1;font-size:11px;color:var(--sub,#6B5E4F)}
.edit-btn{border:1px solid var(--divider,#E5D9C5);padding:8px 16px;border-radius:8px;background:var(--card,#FFF9F0);color:var(--text,#2A241E);font-size:13px;cursor:pointer}
.edit-btn.primary{background:var(--nav,#3A3228);color:#fff;border-color:var(--nav,#3A3228)}
.edit-btn:active{opacity:.7}
.edit-hint{display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 16px;border-radius:20px;font-size:12px;z-index:9998;pointer-events:none;transition:opacity .3s}
.edit-toolbar{display:flex;align-items:center;gap:4px;padding:6px 10px;background:var(--bg,#F5EFE3);border-top:1px solid var(--divider,#E5D9C5);overflow-x:auto}
.etb-btn{flex-shrink:0;width:28px;height:24px;border:1px solid var(--divider,#E5D9C5);border-radius:4px;background:var(--card,#FFF9F0);color:var(--text,#2A241E);font-size:12px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1}
.etb-btn:active{opacity:.6;background:var(--nav,#3A3228);color:#fff}
.etb-i{font-style:italic;font-family:serif}
.etb-red{color:#B8392B;border-color:#B8392B}
.etb-blue{color:#2B5CB8;border-color:#2B5CB8}
.etb-green{color:#4A7C59;border-color:#4A7C59}
.etb-gold{color:#C9A96E;border-color:#C9A96E}
.etb-hl{background:#F5EDDC;border-color:#C9A96E}
.edit-preview{max-height:120px;overflow-y:auto;padding:8px 14px;background:var(--card,#FFF9F0);font-family:"Noto Serif SC",serif;font-size:13px;line-height:1.8;color:var(--text,#2A241E);border-bottom:1px solid var(--divider,#E5D9C5)}
.edit-preview p{margin:0 0 6px 0;text-indent:1em}
.edit-preview p:last-child{margin-bottom:0}
.etb-sep{width:1px;height:18px;background:var(--divider,#E5D9C5);margin:0 2px}
.edit-hint.show{display:block}
`;
      document.head.appendChild(style);
    }

    document.body.appendChild(overlay);
    const ta = document.getElementById('editTextarea');
    setTimeout(() => ta.focus(), 100);

    // 存储提交参数
    this._pendingSource = source;
    this._pendingKey = key;
  },

  // ── 工具栏：选中文字包上标记 ──
  wrapMarkup(openTag, closeTag) {
    var ta = document.getElementById('editTextarea');
    if (!ta) return;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var text = ta.value;
    var sel = text.substring(start, end);
    if (!sel) return; // 没选中就不做
    var newText = text.substring(0, start) + openTag + sel + closeTag + text.substring(end);
    ta.value = newText;
    // 恢复选中
    ta.focus();
    ta.setSelectionRange(start + openTag.length, end + openTag.length);
  },

  // ── 实时预览分段效果 ──
  _updatePreview() {
    var preview = document.getElementById('editPreview');
    var ta = document.getElementById('editTextarea');
    if (!preview || !ta || preview.style.display === 'none') return;
    var text = ta.value;
    var lines = text.split('\n').filter(function(l) { return l.trim(); });
    var html = '';
    for (var i = 0; i < lines.length; i++) {
      html += '<p>' + lines[i].replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</p>';
    }
    preview.innerHTML = html || '<p style="color:var(--sub)">（预览：在编辑框中用回车分段）</p>';
  },

  _togglePreview() {
    var preview = document.getElementById('editPreview');
    if (!preview) return;
    if (preview.style.display === 'none') {
      preview.style.display = 'block';
      this._updatePreview();
    } else {
      preview.style.display = 'none';
    }
  },

  // ── 合并下一段：把相邻 chunk 文本追加到编辑框 ──
  _mergeNext() {
    var ta = document.getElementById('editTextarea');
    if (!ta || this._pendingSource !== 'knowledge_zs_v3') return;
    var key = parseInt(this._pendingKey);
    if (isNaN(key) || key >= ZS_CHUNKS.length - 1) return;
    var nextChunk = ZS_CHUNKS[key + 1];
    if (!nextChunk || nextChunk.c !== ZS_CHUNKS[key].c) return; // 同一章才合并
    var nextText = EDITOR.getChunkCorrection(key + 1) || nextChunk.x;
    ta.value = ta.value + '\n' + nextText;
    ta.focus();
    this._pendingMergeNext = key + 1; // 记录，提交时清空下一段
    this._updatePreview();
  },

  // ── 关闭弹窗 ──
  close() {
    const o = document.getElementById('editOverlay');
    if (o) o.remove();
    this._pendingSource = null;
    this._pendingKey = null;
    delete this._pendingMergeNext;
  },

  // ── 提交纠错 ──
  async submit(source, key) {
    // Fall back to stored values if called without args (from onclick)
    if (!source || !key) {
      source = this._pendingSource;
      key = this._pendingKey;
    }
    if (!source || !key) return;

    const statusEl = document.getElementById('editStatus');
    const newText = document.getElementById('editTextarea').value.trim();

    if (!newText) {
      statusEl.textContent = '内容不能为空';
      return;
    }

    statusEl.textContent = '提交中...';
    statusEl.style.color = 'var(--gold,#C9A96E)';

    // Ensure corrections is initialized
    if (!this._corrections) this._corrections = { knowledge_zs_v3: {}, fupeirong_data: {} };

    // 更新内存
    if (!this._corrections[source]) this._corrections[source] = {};
    this._corrections[source][key] = newText;
    // 如果合并了下一段，将其清空
    if (this._pendingMergeNext !== undefined) {
      this._corrections[source][String(this._pendingMergeNext)] = '';
      delete this._pendingMergeNext;
    }

    const token = GH_AUTH.getToken();
    if (!token) {
      statusEl.textContent = '请先登录';
      statusEl.style.color = 'var(--red,#B8392B)';
      return;
    }

    try {
      // If we don't have the SHA (init failed or not called yet), fetch it now
      if (!this._sha) {
        statusEl.textContent = '正在获取文件信息...';
        try {
          await this._refreshSHA();
        } catch (e) {
          statusEl.textContent = '获取失败: ' + e.message;
          statusEl.style.color = 'var(--red,#B8392B)';
          return;
        }
      }

      const jsonStr = JSON.stringify(this._corrections, null, 2);
      // base64 编码（UTF-8 安全，TextEncoder）
      const encoder = new TextEncoder();
      const bytes = encoder.encode(jsonStr);
      let binary = '';
      bytes.forEach(function(b) { binary += String.fromCharCode(b); });
      const content = btoa(binary);

      const body = {
        message: `fix: 纠错 ${source}/${key}`,
        content: content,
        branch: this._branch
      };
      if (this._sha) body.sha = this._sha;

      const controller = new AbortController();
      const timeout = setTimeout(function() { controller.abort(); }, 15000);

      const resp = await fetch(
        `https://api.github.com/repos/${this._repo}/contents/${this._path}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal: controller.signal
        }
      );
      clearTimeout(timeout);

      if (resp.ok) {
        const data = await resp.json();
        this._sha = data.content.sha;
        statusEl.textContent = '✓ 已提交';
        statusEl.style.color = 'var(--green,#2E5C4E)';

        // 1.5s 后关闭弹窗并刷新显示
        setTimeout(() => {
          this.close();
          // 重新渲染当前页
          if (source === 'knowledge_zs_v3' && typeof App !== 'undefined') {
            App.refreshBookView();
          } else if (source === 'fupeirong_data' && typeof App !== 'undefined') {
            App.refreshFPView();
          }
        }, 1500);
      } else if (resp.status === 401 || resp.status === 403) {
        // Token 失效，清除并触发重新登录
        GH_AUTH.logout();
        statusEl.textContent = '登录已过期，正在重新登录...';
        statusEl.style.color = 'var(--gold,#C9A96E)';
        if (typeof App !== 'undefined') {
          App._updateLoginUI(null);
          setTimeout(() => App.showLogin(), 500);
        }
      } else if (resp.status === 409) {
        // SHA 冲突，重新获取
        statusEl.textContent = '文件已更新，正在重试...';
        await this._refreshSHA();
        // 重试
        setTimeout(() => this.submit(source, key), 500);
      } else {
        const errBody = await resp.text();
        let errMsg = resp.status.toString();
        try {
          const errJson = JSON.parse(errBody);
          if (errJson.message) errMsg = errJson.message;
        } catch(e) {}
        statusEl.textContent = '提交失败: ' + errMsg;
        statusEl.style.color = 'var(--red,#B8392B)';
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        statusEl.textContent = '提交超时，请检查网络';
      } else {
        statusEl.textContent = '网络错误: ' + e.message;
      }
      statusEl.style.color = 'var(--red,#B8392B)';
    }
  },

  // ── 刷新 SHA ──
  async _refreshSHA() {
    const token = GH_AUTH.getToken();
    if (!token) throw new Error('未登录');
    const resp = await fetch(
      `https://api.github.com/repos/${this._repo}/contents/${this._path}?ref=${this._branch}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
    );
    if (resp.ok) {
      const data = await resp.json();
      this._sha = data.sha;
      return;
    }
    if (resp.status === 404) {
      // File doesn't exist yet — first correction, SHA stays null (will create new file)
      this._sha = null;
      return;
    }
    // Other errors: throw so caller can show the message
    const errBody = await resp.text();
    let errMsg = `GitHub API ${resp.status}`;
    try {
      const errJson = JSON.parse(errBody);
      if (errJson.message) errMsg = errJson.message;
    } catch(e) {}
    throw new Error(errMsg);
  },

  // ── HTML 转义 ──
  _escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  // ── 是否就绪 ──
  isReady() {
    return this._ready;
  }
};
