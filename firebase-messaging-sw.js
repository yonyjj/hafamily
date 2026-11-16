// 앱이 닫혀 있을 때 메시지 알림을 받아서 보여주는 파일
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyBpNH_wEiAnVCAvLsPLM_oTXHRAQcWWJ-U",
  authDomain: "hafamily-55227.firebaseapp.com",
  projectId: "hafamily-55227",
  storageBucket: "hafamily-55227.firebasestorage.app",
  messagingSenderId: "1049765592530",
  appId: "1:1049765592530:web:192b8a654a4889c9e05c0b"
});
firebase.messaging();
