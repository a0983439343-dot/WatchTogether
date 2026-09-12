# WatchTogether 修正版

包含：
- app.js：保留原本多平台、YouTube 搜尋、待播放清單、聊天室、房主踢人，並移除播放秒數同步寫入。
- index.html：手機搜尋視窗結構、狀態文字與 favicon 佔位修正。
- styles.css：手機 YouTube 搜尋結果單欄排列、固定可滾動區域、文字防擠壓。
- firebase-config.js：改為一般 script 可用的 `window.FIREBASE_CONFIG`，不使用 `export`。
- database.rules.json：依 WatchTogether 實際資料結構重新建立 Rules。
- storage.rules：保留房間媒體檔案權限限制。
- firebase.json：對應上述 Rules。

注意：firebase-config.js 仍需要填入你目前 WatchTogether Firebase Web App 的實際 config；這份檔案原本沒有包含可可靠恢復的實際專案設定，不能自行猜測專案設定。

