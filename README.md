# WatchTogether

## 專案結構

- `index.html`：網站入口
- `404.html`：GitHub Pages 404
- `src/js/`：網站前端 JavaScript
- `src/css/`：網站樣式
- `src/vendor/`：第三方前端函式庫
- `admin/`：管理員後台
- `config/`：Firebase 設定與 Rules
- `workers/`：Cloudflare Worker
- `youtube-proxy/`：Render YouTube Proxy
- `.github/workflows/`：CI 驗證
- `firebase.json`：Firebase 部署設定
- `Dockerfile`：根目錄部署用 Docker 設定
- `sw.js`：Service Worker

## 主要功能

WatchTogether 提供房間、多人同步播放、聊天室、好友、QR 邀請、YouTube 搜尋與多平台播放器整合。

管理員後台位於 `admin/admin.html`，Firebase Rules 位於 `config/database.rules.json` 與 `config/storage.rules`。
