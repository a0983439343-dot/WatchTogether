# WatchTogether YouTube Search Worker

這個 Worker 負責代理 YouTube Data API 搜尋。

## 1. 建立新的 YouTube Data API Key

不要再使用曾經放進前端 app.js 的舊 Key。

到 Google Cloud Console 建立新的 API Key，並把 API restriction 限制在 YouTube Data API v3。

這個 Key 只放進 Cloudflare Worker Secret，不要放進 GitHub Pages 前端。

## 2. 部署 Worker

在這個資料夾執行：

```bash
npx wrangler login
npx wrangler secret put YOUTUBE_API_KEY
npx wrangler deploy
```

YOUTUBE_API_KEY 請貼入新的 YouTube Data API Key。

部署完成後 Wrangler 會顯示 Worker URL。

## 3. 設定前端 Proxy URL

把部署後的 Worker URL 填入根目錄 firebase-config.js：

```js
window.WATCHTOGETHER_CONFIG = {
  youtubeSearchProxyUrl: "https://你的-worker-url.workers.dev",
  dailymotionPlayerId: ""
};
```

目前程式碼不會在瀏覽器端保存 YouTube API Key。

## 4. Worker 的安全限制

- 驗證 Firebase Auth ID Token。
- 僅允許 WatchTogether GitHub Pages 來源。
- 依 IP 與 Firebase UID 分別限制搜尋頻率。
- YouTube search.list 最多 25 筆。
- 前端最多使用 2 頁搜尋結果。
- 使用 30 秒邊緣快取降低重複請求。
- YouTube API Key 只存在 Worker Secret。
- 使用 videos.list 取得觀看數與影片長度。

注意：Cloudflare Worker 的 in-memory rate limit 是每個 Worker isolate 的暫時狀態，不能當成全球一致的配額系統；真正的 API 配額仍應在 Google Cloud Console 監控。