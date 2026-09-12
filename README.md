# WatchTogether

WatchTogether 是一個多人同步觀看網站，包含房間、YouTube 搜尋、待播放清單、聊天室、房間成員與多平台播放器介面。

目前播放同步採用 Firebase Realtime Database 的成員個人 playback 狀態，房間成員會讀取同房間成員的最新播放狀態並進行播放、暫停、跳轉與進度校正。

主要檔案：
- `index.html`：網站介面與播放器容器。
- `app.js`：Firebase、房間、成員、聊天室、佇列、播放器與播放同步邏輯。
- `styles.css`：網站與行動版版面。
- `firebase-config.js`：Firebase Web App 設定。
- `database.rules.json`：Realtime Database 權限。
- `storage.rules`：房間媒體檔案權限。
- `firebase.json`：Firebase Hosting 與 Rules 設定。
- `.github/workflows/enable-playback-sync.yml`：播放同步修復與驗證流程。
