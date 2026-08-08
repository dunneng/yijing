# 易学私教 — 曾仕强《易经的智慧》PWA

传统智慧 × 现代技术。基于曾仕强教授《易经的智慧》全集144集的交互式学习应用。

## 功能

- 💬 **AI 对话私教** — 问任何易经问题，AI 用曾仕强教授的原文为你讲解
- 🎲 **在线占卜** — 传统铜钱起卦法，即时解读64卦
- 📖 **全书阅读** — 曾仕强全集 OCR 文本 + 插图
- 🎬 **视频课程** — AcFun 在线/本地视频，144集全部支持
- 🔍 **语义搜索** — BGE-M3 向量搜索，精准定位原文段落
- 📱 **PWA 离线可用** — 安装到手机桌面，离线也能用
- 🔑 **GitHub 登录** — 登录后数据自动同步到你的私有 Gist，多设备无缝切换

## 技术栈

纯静态 HTML/CSS/JS PWA，零后端依赖：

- **搜索**: BGE-M3 向量搜索（需本地 search_api.py）
- **视频**: AcFun m3u8 流 + HLS.js
- **鉴权**: GitHub Device Flow OAuth
- **同步**: GitHub Gist API
- **部署**: GitHub Pages

## 本地运行

```bash
# 启动静态服务器
python server.py 8899

# 启动搜索 API（需要 BGE-M3 模型）
python search_api.py

# 打开浏览器
# http://localhost:8899
```

## 在线版

[dunneng.github.io/yijing](https://dunneng.github.io/yijing)
