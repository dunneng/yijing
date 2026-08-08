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
  _branch: 'main',
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
        const raw = atob(data.content);
        this._corrections = JSON.parse(raw);
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
        <textarea class="edit-textarea" id="editTextarea">${this._escapeHtml(oldText)}</textarea>
        <div class="edit-footer">
          <span class="edit-status" id="editStatus"></span>
          <button class="edit-btn" onclick="EDITOR.close()">取消</button>
          <button class="edit-btn primary" onclick="EDITOR.submit('${source}','${key}')">提交</button>
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

  // ── 关闭弹窗 ──
  close() {
    const o = document.getElementById('editOverlay');
    if (o) o.remove();
    this._pendingSource = null;
    this._pendingKey = null;
  },

  // ── 提交纠错 ──
  async submit(source, key) {
    const statusEl = document.getElementById('editStatus');
    const newText = document.getElementById('editTextarea').value.trim();

    if (!newText) {
      statusEl.textContent = '内容不能为空';
      return;
    }

    statusEl.textContent = '提交中...';
    statusEl.style.color = 'var(--gold,#C9A96E)';

    // 更新内存
    if (!this._corrections[source]) this._corrections[source] = {};
    this._corrections[source][key] = newText;

    const token = GH_AUTH.getToken();
    if (!token) {
      statusEl.textContent = '请先登录';
      statusEl.style.color = 'var(--red,#B8392B)';
      return;
    }

    try {
      const jsonStr = JSON.stringify(this._corrections, null, 2);
      // base64 编码（支持中文）
      const content = btoa(unescape(encodeURIComponent(jsonStr)));

      const body = {
        message: `fix: 纠错 ${source}/${key}`,
        content: content,
        branch: this._branch
      };
      if (this._sha) body.sha = this._sha;

      const resp = await fetch(
        `https://api.github.com/repos/${this._repo}/contents/${this._path}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        }
      );

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
        statusEl.textContent = '权限不足，请重新登录（需仓库权限）';
        statusEl.style.color = 'var(--red,#B8392B)';
      } else if (resp.status === 409) {
        // SHA 冲突，重新获取
        statusEl.textContent = '文件已更新，正在重试...';
        await this._refreshSHA();
        // 重试
        setTimeout(() => this.submit(source, key), 500);
      } else {
        const errBody = await resp.text();
        statusEl.textContent = `提交失败: ${resp.status}`;
        statusEl.style.color = 'var(--red,#B8392B)';
        console.warn('Submit error:', resp.status, errBody);
      }
    } catch (e) {
      statusEl.textContent = '网络错误: ' + e.message;
      statusEl.style.color = 'var(--red,#B8392B)';
    }
  },

  // ── 刷新 SHA ──
  async _refreshSHA() {
    const token = GH_AUTH.getToken();
    if (!token) return;
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${this._repo}/contents/${this._path}?ref=${this._branch}`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }
      );
      if (resp.ok) {
        const data = await resp.json();
        this._sha = data.sha;
      }
    } catch (e) {}
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
