/**
 * GitHub Device Flow 鉴权模块
 * 零后端、纯客户端 OAuth，用户只需在浏览器确认一次即可
 * 
 * 流程：
 *   1. POST /login/device/code → 获取 user_code + device_code
 *   2. 用户打开 github.com/login/device 输入 user_code
 *   3. 轮询 POST /login/oauth/access_token → 获取 token
 *   4. token 存 localStorage，后续请求带 Authorization: Bearer <token>
 */

const GITHUB_CLIENT_ID = 'Ov23li__FILL_AFTER_OAUTH_APP__'; // ← 注册 OAuth App 后替换

const GH_AUTH = {
  _tokenKey: 'gh_token',
  _userKey: 'gh_user',
  _pollTimer: null,

  // ── 获取当前 token ──
  getToken() {
    return localStorage.getItem(this._tokenKey);
  },

  // ── 获取当前用户信息 ──
  getUser() {
    try {
      return JSON.parse(localStorage.getItem(this._userKey) || 'null');
    } catch (e) {
      return null;
    }
  },

  // ── 是否已登录 ──
  isLoggedIn() {
    return !!this.getToken();
  },

  // ── 发起登录 ──
  // onCode: callback({user_code, verification_uri}) → 显示验证码给用户
  // onDone: callback(user) → 登录完成
  // onError: callback(err) → 登录失败
  async login(onCode, onDone, onError) {
    try {
      // Step 1: 请求设备码
      const resp = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          scope: 'gist read:user'
        })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error_description || err.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      // data: { device_code, user_code, verification_uri, interval, expires_in }

      // 通知 UI 显示验证码
      if (onCode) onCode(data);

      // Step 2: 轮询等待用户确认
      const token = await this._poll(data.device_code, data.interval || 5);
      
      // Step 3: 获取用户信息
      const user = await this._fetchUser(token);
      
      // 持久化
      localStorage.setItem(this._tokenKey, token);
      localStorage.setItem(this._userKey, JSON.stringify(user));
      
      if (onDone) onDone(user);
      return user;
    } catch (e) {
      if (onError) onError(e);
      throw e;
    }
  },

  // ── 轮询 token ──
  async _poll(deviceCode, interval) {
    const maxAttempts = 60; // 最多等 5 分钟
    for (let i = 0; i < maxAttempts; i++) {
      await this._sleep(interval * 1000);

      try {
        const resp = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
          })
        });

        const data = await resp.json();

        if (data.access_token) {
          return data.access_token;
        }

        if (data.error === 'authorization_pending') {
          continue; // 用户还没确认，继续等
        }

        if (data.error === 'slow_down') {
          interval += 5; // GitHub 要求放慢
          continue;
        }

        if (data.error === 'expired_token') {
          throw new Error('验证码已过期，请重新登录');
        }

        throw new Error(data.error_description || data.error || '登录失败');
      } catch (e) {
        if (e.message.includes('验证码已过期') || e.message.includes('登录失败')) {
          throw e;
        }
        // 网络错误，继续重试
        console.warn('Poll error, retrying:', e.message);
      }
    }
    throw new Error('登录超时，请重试');
  },

  // ── 获取用户信息 ──
  async _fetchUser(token) {
    const resp = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json'
      }
    });
    if (!resp.ok) throw new Error('获取用户信息失败');
    const data = await resp.json();
    return {
      login: data.login,
      name: data.name || data.login,
      avatar: data.avatar_url
    };
  },

  // ── 登出 ──
  logout() {
    localStorage.removeItem(this._tokenKey);
    localStorage.removeItem(this._userKey);
    if (this._pollTimer) clearTimeout(this._pollTimer);
  },

  // ── 刷新用户信息 ──
  async refreshUser() {
    const token = this.getToken();
    if (!token) return null;
    try {
      const user = await this._fetchUser(token);
      localStorage.setItem(this._userKey, JSON.stringify(user));
      return user;
    } catch (e) {
      return this.getUser();
    }
  },

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};
