// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDZntXy7hLNzBlADp94MyoRmiFWSSdvDLE",
  authDomain: "watchtogether-3f4f9.firebaseapp.com",
  databaseURL: "https://watchtogether-3f4f9-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "watchtogether-3f4f9",
  storageBucket: "watchtogether-3f4f9.firebasestorage.app",
  messagingSenderId: "726694766811",
  appId: "1:726694766811:web:238f98e46330d0f65884fe",
  measurementId: "G-VZXG2CRVE0"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
