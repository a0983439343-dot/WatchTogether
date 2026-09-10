// WatchTogether Firebase 設定
// 請把下面內容替換成 Firebase Console → 專案設定 → Web App 的實際設定。
// 這個檔案由 index.html 以一般 <script> 載入，因此不要使用 export。

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

window.FIREBASE_CONFIG = firebaseConfig;
