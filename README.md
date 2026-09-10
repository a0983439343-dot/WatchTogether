# WatchTogether

可直接部署的 WatchTogether 專案。

- app.js：YouTube 搜尋、多平台播放器、待播放清單、聊天室、房主踢人、房間影片同步。播放進度不寫入 Firebase，也不會從 Firebase 自動定位、播放或暫停。
- index.html：房間、播放器、聊天室與搜尋介面。
- styles.css：桌面與手機版版面、搜尋結果滾動與播放器樣式。
- firebase-config.js：WatchTogether Firebase Web App 設定。
- database.rules.json：Realtime Database Rules；房間只同步目前影片，不保存播放秒數狀態。
- storage.rules：媒體儲存權限。
- firebase.json：Firebase Hosting、Database、Storage 設定。

播放行為：每位成員可以自己播放、暫停、前進與後退；只有「目前播放哪一部影片」會同步到房間。
