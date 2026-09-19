# WatchTogether

目前 GitHub Pages 使用的正式版本。

## 專案檔案

- `index.html`：頁面結構與 Firebase / YouTube / Vimeo SDK 載入。
- `app.js`：房間、搜尋、播放器、聊天室、待播放清單與同步核心。
- `styles.css`：桌面與手機版介面。
- `firebase-config.js`：目前 WatchTogether Firebase Web App 設定。
- `database.rules.json`：Realtime Database 權限與資料驗證。
- `storage.rules`：房間媒體檔案權限。
- `firebase.json`：Firebase Rules / Hosting 對應設定。

## 播放同步

目前使用 Firebase shared playback timeline，包含：

- `videoId`
- `position`
- `action`
- `playing`
- `playbackRate`
- `issuedAt`
- `updatedAt`
- `updatedBy`
- `eventId`
- 暫停時的 `effectiveAt`

播放器會使用 Firebase server time offset 做共同時間基準，並對小幅漂移做播放速度修正；較大的漂移才進行位置校正。

暫停操作會先建立共同的 `effectiveAt)，讓不同網路延遲的裝置在同一個時間點執行 pause。

## 影片切換

房主更換影片時會：

1. 更新 `rooms/{roomId}` 的平台與影片。
2. 由房主清除舊的 `playback/{roomId}` timeline。
3. 清理同步狀態失敗時仍會繼續完成影片切換，避免搜尋視窗卡住。

## Firebase Rules

Realtime Database Rules 會限制：

- 房主建立與修改房間影片。
- 成員自己的成員資料。
- 成員聊天與待播放清單。
- 成員播放事件只能以自己的 UID 寫入。
- `playback/{roomId}` 的刪除只允許房主。
- `effectiveAt` 若存在必須是正數。

## 目前檢查

已檢查目前 main 分支的：

- `index.html`
- `app.js`
- `styles.css`
- `firebase-config.js`
- `database.rules.json`
- `storage.rules`
- `firebase.json`
- `README.md`

`app.js` JavaScript 語法檢查通過；CSS 大括號結構與 Firebase JSON 也檢查通過。
