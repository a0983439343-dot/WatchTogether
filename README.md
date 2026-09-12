# WatchTogether 修正版

WatchTogether 是一個 Firebase + GitHub Pages 的多人同步觀看網站。

目前包含：
- YouTube 搜尋與播放
- Vimeo、Dailymotion、Bilibili、Twitch 與外部平台入口
- 房間、成員、踢人、聊天室、待播放清單
- Firebase Realtime Database 播放、暫停、跳轉同步
- 晚加入追趕與播放中 drift correction
- 每位成員只寫入自己的 `members/{roomId}/{uid}/playback`
- Firebase Storage 房間媒體檔案權限限制

Firebase Web App 設定位於 `firebase-config.js`。

Final workflow trigger verification.
