window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDZntXy7hLNzBlADp94MyoRmiFWSSdvDLE",
  authDomain: "watchtogether-3f4f9.firebaseapp.com",
  databaseURL: "https://watchtogether-3f4f9-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "watchtogether-3f4f9",
  storageBucket: "watchtogether-3f4f9.firebasestorage.app",
  messagingSenderId: "726694766811",
  appId: "1:726694766811:web:238f98e46330d0f65884fe",
  measurementId: "G-VZXG2CRVE0"
};


/*
 * 公開前端設定。
 * youtubeSearchProxyUrl 是 Cloudflare Worker 的公開網址，
 * 不要把 YouTube API Key 放進這裡。
 *
 * dailymotionPlayerId 為可選的自訂 Dailymotion Player ID。
 * 留空時會使用 Dailymotion 官方 default Player iframe。
 */
window.WATCHTOGETHER_CONFIG = {
  youtubeSearchProxyUrl: "",
  dailymotionPlayerId: ""
};
