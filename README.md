# WatchTogether｜一起同步觀看

這是一個可以直接放 GitHub Pages 的靜態網站 MVP。

## 已完成

- 建立房間／加入房間
- 房間碼與邀請連結
- Firebase Anonymous Authentication
- Firebase Realtime Database 房間同步
- YouTube 影片同步
- 直接影片網址（MP4 / WebM 等）同步
- 播放／暫停／前進 10 秒／後退 10 秒／同步目前進度
- 成員列表
- 房間聊天室
- 房主更換影片
- 手機／電腦響應式介面

## 目前沒有硬接進 Netflix / Disney+ 等 DRM 平台

這些服務使用自己的播放器與 DRM。網站不會繞過 DRM 或接收帳號密碼。
若平台提供官方嵌入/API，之後可以各自加入正式的整合器。

## Firebase 設定

1. 建立 Firebase 專案。
2. 啟用 Authentication → Sign-in method → Anonymous。
3. 建立 Realtime Database。
4. 把 Firebase Web App 設定填進 `firebase-config.js`。
5. 在 Realtime Database → Rules 貼上 `database.rules.json`。
6. 把整個資料夾上傳 GitHub。
7. GitHub → Settings → Pages → Deploy from branch → 選 `main` / `root`。

## 注意

GitHub Pages 只負責放前端檔案；房間資料由 Firebase Realtime Database 保存。
直接影片網址必須是瀏覽器允許播放的影片來源，且來源伺服器需要允許相應的跨來源請求/播放。
