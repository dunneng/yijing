/**
 * GitHub Gist 用户数据同步模块
 * 
 * 每个用户的数据存在其 GitHub 账号下名为 "yijing-user-data" 的私有 Gist 中。
 * 文件结构：
 *   yijing_progress.json  — 阅读进度
 *   yijing_chat.json      — 对话历史
 *   yijing_prefs.json     — 用户偏好
 * 
 * 用法：
 *   await GIST_SYNC.init()       // 初始化，找到或创建 gist
 *   await GIST_SYNC.save(key, value)  // 保存数据
 *   await GIST_SYNC.load(key)         // 读取数据
 *   await GIST_SYNC.saveAll()         // 全量保存
 *   await GIST_SYNC.loadAll()         // 全量读取
 */

const GIST_SYNC = {
  _gistId: null,
  _description: 'yijing-user-data',
  _ready: false,
  _dirty: {},
  _cache: {},
  _saveTimer: null,

  // ── 初始化：找到或创建用户数据 Gist ──
  async init() {
    const token = GH_AUTH.getToken();
    if (!token) return false;

    try {
      // 查找已有 gist
      const listResp = await fetch('https://api.github.com/gists?per_page=100', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });

      if (!listResp.ok) {
        console.warn('Gist list failed:', listResp.status);
        return false;
      }

      const gists = await listResp.json();
      const existing = gists.find(g => g.description === this._description);

      if (existing) {
        this._gistId = existing.id;
        // 加载缓存
        for (const [filename, file] of Object.entries(existing.files || {})) {
          try {
            this._cache[filename] = JSON.parse(file.content || 'null');
          } catch (e) {
            this._cache[filename] = file.content;
          }
        }
        this._ready = true;
        console.log('Gist sync ready:', this._gistId, Object.keys(this._cache));
        return true;
      }

      // 创建新 gist
      const createResp = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: this._description,
          public: false,
          files: {
            'yijing_progress.json': { content: '{}' },
            'yijing_chat.json': { content: '[]' },
            'yijing_prefs.json': { content: '{}' }
          }
        })
      });

      if (!createResp.ok) {
        console.warn('Gist create failed:', createResp.status);
        return false;
      }

      const gist = await createResp.json();
      this._gistId = gist.id;
      this._cache = {
        'yijing_progress.json': {},
        'yijing_chat.json': [],
        'yijing_prefs.json': {}
      };
      this._ready = true;
      console.log('Gist created:', this._gistId);
      return true;
    } catch (e) {
      console.warn('Gist init failed:', e.message);
      return false;
    }
  },

  // ── 读取 ──
  async load(key) {
    // 优先用内存缓存
    if (this._cache[key] !== undefined) return this._cache[key];

    // 回落 localStorage
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  // ── 保存（防抖批量写入）──
  async save(key, value) {
    // 立即更新内存缓存
    this._cache[key] = value;
    this._dirty[key] = true;

    // 总是同步到 localStorage 作为即时后备
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {}

    // 防抖远程写入（500ms 内多次 save 只写一次）
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._flush(), 500);
  },

  // ── 批量写入 Gist ──
  async _flush() {
    if (!this._gistId || !this._ready) return;

    const token = GH_AUTH.getToken();
    if (!token) return;

    const files = {};
    for (const key of Object.keys(this._dirty)) {
      const filename = key.endsWith('.json') ? key : key + '.json';
      files[filename] = { content: JSON.stringify(this._cache[key], null, 2) };
    }
    this._dirty = {};

    try {
      const resp = await fetch(`https://api.github.com/gists/${this._gistId}`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ files })
      });

      if (!resp.ok) {
        // Token 可能过期
        if (resp.status === 401) {
          GH_AUTH.logout();
        }
        console.warn('Gist save failed:', resp.status);
      }
    } catch (e) {
      console.warn('Gist save error:', e.message);
    }
  },

  // ── 全量保存 ──
  async saveAll() {
    for (const [key, value] of Object.entries(this._cache)) {
      this._dirty[key] = true;
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {}
    }
    if (this._saveTimer) clearTimeout(this._saveTimer);
    return this._flush();
  },

  // ── 全量读取（从远程刷新）──
  async loadAll() {
    const token = GH_AUTH.getToken();
    if (!token || !this._gistId) return null;

    try {
      const resp = await fetch(`https://api.github.com/gists/${this._gistId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json'
        }
      });

      if (!resp.ok) return null;

      const gist = await resp.json();
      for (const [filename, file] of Object.entries(gist.files || {})) {
        try {
          this._cache[filename] = JSON.parse(file.content || 'null');
        } catch (e) {
          this._cache[filename] = file.content;
        }
      }
      return this._cache;
    } catch (e) {
      console.warn('Gist load error:', e.message);
      return null;
    }
  },

  // ── 是否就绪 ──
  isReady() {
    return this._ready;
  }
};
