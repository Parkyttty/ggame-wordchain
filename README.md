# 끝말잇기 🎮

친구들과 즐기는 비동기 멀티플레이어 끝말잇기 게임

## 기능

- **3가지 모드**: 두글자 / 세글자 / 네글자
- **비동기 플레이**: 각자 시간 날 때 접속해서 단어 입력
- **실시간 업데이트**: Firebase Firestore 기반 실시간 동기화
- **승복 시스템**: 입력창에 `승복하겠습니다` → 패배 처리
- **두음법칙 지원**: ㄹ↔ㄴ, ㄴ↔ㅇ 자동 인정
- **랭킹 시스템**:
  - 승률
  - 평균 응답시간 (빠를수록 좋음)
  - 단어 다양성 (전체 이력에서 처음 쓰는 단어 = NEW✨)
  - 연승 기록

---

## Firebase 설정 방법

### 1. Firebase 프로젝트 생성

1. [Firebase Console](https://console.firebase.google.com/) 접속
2. **프로젝트 추가** 클릭 → 프로젝트 이름 입력 (예: `ggame-wordchain`)
3. Google Analytics 설정 (선택 사항)

### 2. 웹 앱 등록

1. 프로젝트 홈 → **`</>`** (웹) 아이콘 클릭
2. 앱 닉네임 입력 → **앱 등록**
3. `firebaseConfig` 객체 복사

### 3. `js/firebase-config.js` 수정

```js
const firebaseConfig = {
  apiKey:            "실제값으로 교체",
  authDomain:        "실제값으로 교체",
  projectId:         "실제값으로 교체",
  storageBucket:     "실제값으로 교체",
  messagingSenderId: "실제값으로 교체",
  appId:             "실제값으로 교체"
};
```

### 4. Firestore 설정

1. Firebase Console → **Firestore Database** → **데이터베이스 만들기**
2. **테스트 모드**로 시작 (30일 후 보안 규칙 적용 필요)
3. 리전 선택 (asia-northeast3 = 서울 권장)

### 5. 익명 인증 활성화

1. Firebase Console → **Authentication** → **Sign-in method**
2. **익명** 활성화

### 6. Firestore 보안 규칙 (배포 전 적용)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /rooms/{roomId} {
      allow read: if true;
      allow create: if request.auth != null;
      allow update: if request.auth != null;
      match /moves/{moveId} {
        allow read: if true;
        allow create: if request.auth != null;
      }
    }
    match /globalWords/{word} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

---

## GitHub Pages 배포

```bash
# 이미 GitHub에 올라가 있다면:
# Settings → Pages → Branch: main → / (root) → Save
```

배포 후 URL: `https://{username}.github.io/ggame-wordchain/`

---

## 게임 방법

1. **방 만들기**: 모드 선택 → 닉네임 입력 → 게임 만들기
2. **링크 공유**: 생성된 6자리 코드 또는 URL을 친구에게 공유
3. **게임 시작**: 2명 이상 입장 → 방장이 "게임 시작!" 클릭
4. **단어 입력**: 내 차례가 되면 입력창 활성화 → 단어 입력 후 Enter
5. **승복**: 못 이어나갈 것 같으면 `승복하겠습니다` 입력 또는 버튼 클릭
