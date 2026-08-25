import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDZntXy7hLNzBlADp94MyoRmiFWSSdvDLE",
  authDomain: "watchtogether-3f4f9.firebaseapp.com",
  databaseURL: "https://watchtogether-3f4f9-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "watchtogether-3f4f9",
  storageBucket: "watchtogether-3f4f9.firebasestorage.app",
  messagingSenderId: "726694766811",
  appId: "1:726694766811:web:238f98e46330d0f65884fe"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getDatabase(app);

export async function loginAnonymously() {
  const result = await signInAnonymously(auth);
  return result.user;
}
