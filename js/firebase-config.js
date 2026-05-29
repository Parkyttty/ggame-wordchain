// Firebase 설정 (자동 생성됨)
const firebaseConfig = {
  apiKey:            "AIzaSyBtFAvCnbtV6j9_u0BxdKjSIZTn82UZxuc",
  authDomain:        "ggame-wordchain.firebaseapp.com",
  projectId:         "ggame-wordchain",
  storageBucket:     "ggame-wordchain.firebasestorage.app",
  messagingSenderId: "1086502086782",
  appId:             "1:1086502086782:web:61ac74f1983797d73fd02f"
};

firebase.initializeApp(firebaseConfig);

const db   = firebase.firestore();
const auth = firebase.auth();
