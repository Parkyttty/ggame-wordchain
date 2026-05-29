// game.js — 끝말잇기 게임 로직 (엑셀 위장 버전)

/* ============================================================
   전역 상태
   ============================================================ */
let currentUser   = null;
let roomCode      = null;
let roomData      = null;
let myNickname    = '';
let unsubRoom     = null;
let turnStartTs   = null;   // 내 턴 시작 타임스탬프
let isHost        = false;
let usedWords     = new Set();  // 이 방에서 사용된 단어 전체

/* ============================================================
   유틸
   ============================================================ */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function copyLink() {
  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  navigator.clipboard.writeText(url).then(() => toast('링크가 복사되었습니다!', 'success'));
}
window.copyLink = copyLink;

/* ============================================================
   Auth
   ============================================================ */
async function initAuth() {
  return new Promise(resolve => {
    auth.onAuthStateChanged(async user => {
      currentUser = user || (await auth.signInAnonymously()).user;
      resolve(currentUser);
    });
  });
}

/* ============================================================
   방 참가
   ============================================================ */
async function joinRoom(code, nick) {
  const ref = db.collection('rooms').doc(code);
  const snap = await ref.get();
  if (!snap.exists) { toast('방을 찾을 수 없습니다.', 'error'); return false; }

  const data = snap.data();
  if (data.status !== 'waiting') {
    // 게임 중 재접속 허용 (기존 참가자인 경우)
    const already = (data.players || []).some(p => p.id === currentUser.uid);
    if (!already) { toast('이미 시작된 게임입니다.', 'error'); return false; }
    return true;
  }

  // 참가자 추가 (중복 방지)
  const already = (data.players || []).some(p => p.id === currentUser.uid);
  if (!already) {
    await ref.update({
      players: firebase.firestore.FieldValue.arrayUnion({ id: currentUser.uid, nickname: nick }),
      playerOrder: firebase.firestore.FieldValue.arrayUnion(currentUser.uid),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } else {
    // 닉네임이 바뀐 경우 업데이트
    const players = data.players.map(p =>
      p.id === currentUser.uid ? { ...p, nickname: nick } : p
    );
    await ref.update({ players });
  }

  // 사용자 문서 보장
  const userRef = db.collection('users').doc(currentUser.uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    await userRef.set({
      nickname: nick,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      stats: { wins:0, losses:0, totalGames:0, totalWords:0,
               diversityPoints:0, totalResponseTime:0,
               avgResponseTime:0, winStreak:0, bestWinStreak:0 }
    });
  } else if (userSnap.data().nickname !== nick) {
    await userRef.update({ nickname: nick });
  }

  return true;
}

/* ============================================================
   게임 시작 (방장 전용)
   ============================================================ */
async function startGame() {
  if (!isHost) return;
  const ref = db.collection('rooms').doc(roomCode);
  const snap = await ref.get();
  const data = snap.data();
  if ((data.players || []).length < 2) {
    toast('최소 2명이 필요합니다.', 'error'); return;
  }
  // 순서 랜덤 셔플
  const order = [...(data.playerOrder || [])].sort(() => Math.random() - .5);
  await ref.update({
    status: 'playing',
    playerOrder: order,
    currentPlayerIndex: 0,
    lastWord: null,
    words: [],
    turnStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
    voteKick: {},
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
}

/* ============================================================
   단어 제출
   ============================================================ */
async function submitWord() {
  const input = document.getElementById('word-input');
  const word  = input.value.trim();
  if (!word) return;

  // 승복
  if (word === '승복하겠습니다') { surrender(); return; }

  if (!roomData || roomData.status !== 'playing') return;

  const order = roomData.playerOrder || [];
  const idx   = roomData.currentPlayerIndex || 0;
  const myTurn = order[idx] === currentUser.uid;
  if (!myTurn) { toast('지금은 내 차례가 아닙니다.', 'warning'); return; }

  // 유효성 검사
  const mode = roomData.mode || 2;
  const result = validateWord(word, mode, roomData.lastWord, Array.from(usedWords));
  if (!result.valid) { toast(result.reason, 'error'); return; }

  // 응답 시간
  const rt = turnStartTs ? (Date.now() - turnStartTs) : 0;

  // NEW 단어 여부 (방 내 usedWords 기반)
  const isNew = !usedWords.has(word);

  // 다음 플레이어 인덱스
  const nextIdx = (idx + 1) % order.length;

  const wordEntry = {
    uid: currentUser.uid,
    nickname: myNickname,
    word,
    isNew,
    responseTime: rt,
    timestamp: Date.now()
  };

  const ref = db.collection('rooms').doc(roomCode);
  await ref.update({
    lastWord: word,
    currentPlayerIndex: nextIdx,
    words: firebase.firestore.FieldValue.arrayUnion(wordEntry),
    turnStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
    voteKick: {},   // 턴 바뀌면 투표 초기화
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // 전역 usedWords 업데이트
  if (isNew) {
    db.collection('users').doc(currentUser.uid)
      .collection('usedWords').doc(word)
      .set({ addedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .catch(() => {});
  }

  input.value = '';
  turnStartTs = null;
}

/* ============================================================
   승복
   ============================================================ */
async function surrender() {
  if (!roomData || roomData.status !== 'playing') return;
  const order = roomData.playerOrder || [];
  const idx   = roomData.currentPlayerIndex || 0;
  if (order[idx] !== currentUser.uid) {
    toast('지금은 내 차례가 아닙니다.', 'warning'); return;
  }
  await endGame(currentUser.uid, '승복');
}

/* ============================================================
   강제 패배 투표
   ============================================================ */
async function castVote() {
  if (!roomData || roomData.status !== 'playing') return;
  const order = roomData.playerOrder || [];
  const idx   = roomData.currentPlayerIndex || 0;
  const targetUid = order[idx];

  if (targetUid === currentUser.uid) {
    toast('자신에게는 투표할 수 없습니다.', 'warning'); return;
  }

  const currentVoters = ((roomData.voteKick || {})[targetUid]) || [];
  if (currentVoters.includes(currentUser.uid)) {
    toast('이미 투표했습니다.', 'warning'); return;
  }

  const ref = db.collection('rooms').doc(roomCode);
  await ref.update({
    [`voteKick.${targetUid}`]: firebase.firestore.FieldValue.arrayUnion(currentUser.uid)
  });
  toast('투표 완료!', 'success');
}

/* ============================================================
   게임 종료 (공통)
   ============================================================ */
async function endGame(loserUid, reason) {
  if (!roomData || roomData.status !== 'playing') return;

  const order   = roomData.playerOrder || [];
  const players = roomData.players || [];
  const winnerUid = order.find(uid => uid !== loserUid) || null;

  // 이미 종료됐으면 스킵
  const snap = await db.collection('rooms').doc(roomCode).get();
  if (snap.data().status !== 'playing') return;

  const words = roomData.words || [];

  await db.collection('rooms').doc(roomCode).update({
    status: 'finished',
    loser:  loserUid,
    winner: winnerUid,
    endReason: reason,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });

  // 통계 업데이트
  for (const p of players) {
    const myWords = words.filter(w => w.uid === p.id);
    const rtList  = myWords.map(w => w.responseTime || 0).filter(t => t > 0);
    const avgRt   = rtList.length
      ? Math.round(rtList.reduce((a, b) => a+b, 0) / rtList.length) : 0;
    const newCnt  = myWords.filter(w => w.isNew).length;
    const isWin   = p.id === winnerUid;
    const isLoss  = p.id === loserUid;

    const ref  = db.collection('users').doc(p.id);
    const uSnap = await ref.get();
    if (!uSnap.exists) continue;
    const st = uSnap.data().stats || {};

    const newWins   = (st.wins   || 0) + (isWin  ? 1 : 0);
    const newLosses = (st.losses || 0) + (isLoss  ? 1 : 0);
    const newTotal  = (st.totalGames || 0) + 1;
    const newTotalWords = (st.totalWords || 0) + myWords.length;
    const newDiv    = (st.diversityPoints || 0) + newCnt;
    const newTotalRt = (st.totalResponseTime || 0) + rtList.reduce((a, b) => a+b, 0);
    const newAvgRt   = newTotalWords > 0
      ? Math.round(newTotalRt / newTotalWords) : 0;
    const streak     = isWin ? (st.winStreak || 0) + 1 : 0;
    const bestStreak = Math.max(st.bestWinStreak || 0, streak);

    await ref.update({
      stats: {
        wins: newWins, losses: newLosses, totalGames: newTotal,
        totalWords: newTotalWords, diversityPoints: newDiv,
        totalResponseTime: newTotalRt, avgResponseTime: newAvgRt,
        winStreak: streak, bestWinStreak: bestStreak
      }
    });
  }
}

/* ============================================================
   Firestore 실시간 구독
   ============================================================ */
function subscribeRoom() {
  const ref = db.collection('rooms').doc(roomCode);
  unsubRoom = ref.onSnapshot(snap => {
    if (!snap.exists) { toast('방이 사라졌습니다.', 'error'); return; }
    const prev = roomData ? { ...roomData } : null;
    roomData = snap.data();

    // 사용된 단어 set 갱신
    (roomData.words || []).forEach(w => usedWords.add(w.word));

    updateConnectionStatus(true);
    renderRoom(prev);
  }, err => {
    console.error(err);
    updateConnectionStatus(false);
  });
}

/* ============================================================
   UI 렌더링
   ============================================================ */
function updateConnectionStatus(ok) {
  const dot  = document.getElementById('conn-dot');
  const text = document.getElementById('conn-text');
  dot.style.background = ok ? '#69F0AE' : '#FF5252';
  text.textContent = ok ? '연결됨' : '연결 끊김';
}

function renderRoom(prev) {
  if (!roomData) return;

  // 방 코드 표시
  document.getElementById('room-code-display').textContent = roomCode;
  document.getElementById('room-code-big').textContent     = roomCode;

  // 모드 배지
  const modeLabel = {2:'두글자', 3:'세글자', 4:'네글자'}[roomData.mode] || '─';
  document.getElementById('mode-badge').textContent = modeLabel;
  document.getElementById('mode-cell').textContent  = modeLabel;

  // 참가자
  const players = roomData.players || [];
  renderPlayers(players);

  // 공유 URL
  const shareUrl = `${location.origin}${location.pathname}?room=${roomCode}`;
  const shareCell = document.getElementById('share-url-cell');
  if (shareCell) shareCell.textContent = shareUrl;

  // 방장 권한
  isHost = roomData.createdBy === currentUser.uid;
  const startBtnSheet = document.getElementById('start-btn-sheet');
  const startBtn      = document.getElementById('start-btn');
  const waitingMsg    = document.getElementById('waiting-msg');
  if (isHost && roomData.status === 'waiting') {
    if (startBtnSheet) startBtnSheet.style.display = 'inline-block';
    if (startBtn)      startBtn.style.display      = 'flex';
    if (waitingMsg)    waitingMsg.style.display     = 'none';
  } else {
    if (startBtnSheet) startBtnSheet.style.display = 'none';
    if (startBtn)      startBtn.style.display      = 'none';
    if (waitingMsg)    waitingMsg.style.display     = 'inline';
  }

  if (roomData.status === 'waiting') {
    showWaiting();
  } else if (roomData.status === 'playing') {
    showGame();
    renderGameSheet();
    updateTurnUI();
    checkVote();
  } else if (roomData.status === 'finished') {
    showGame();
    renderGameSheet();
    // 결과창은 한 번만
    if (!prev || prev.status === 'playing') {
      showResult();
    }
  }
}

function renderPlayers(players) {
  const ribbon = document.getElementById('players-ribbon');
  const list   = document.getElementById('player-list-cell');
  const order  = roomData.playerOrder || [];
  const idx    = roomData.currentPlayerIndex || 0;
  const currentTurnUid = order[idx];

  if (ribbon) {
    ribbon.innerHTML = players.map(p => {
      const isMe   = p.id === currentUser.uid;
      const isTurn = p.id === currentTurnUid && roomData.status === 'playing';
      const color  = isMe ? 'var(--xl-green)' : 'var(--xl-blue)';
      const bg     = isTurn ? '#E8F5E9' : 'transparent';
      const border = isTurn ? '1px solid var(--xl-green)' : '1px solid var(--xl-border)';
      return `<span style="padding:1px 6px;background:${bg};border:${border};border-radius:2px;color:${color};font-weight:${isMe?700:400}">
        ${p.nickname}${isTurn ? ' ▶' : ''}
      </span>`;
    }).join('');
  }

  if (list) list.textContent = players.map(p => p.nickname).join(', ') || '—';
}

function showWaiting() {
  document.getElementById('waiting-screen').style.display = 'block';
  document.getElementById('game-area').style.display      = 'none';
  document.getElementById('input-hint').textContent = '대기 중 — 방장이 게임을 시작하면 시작됩니다';
  document.getElementById('word-input').disabled = true;
  document.getElementById('send-btn').disabled   = true;
  document.getElementById('game-status-bar').textContent = '대기 중';
}

function showGame() {
  document.getElementById('waiting-screen').style.display = 'none';
  document.getElementById('game-area').style.display      = 'block';
}

function updateTurnUI() {
  if (!roomData || roomData.status !== 'playing') return;

  const order    = roomData.playerOrder || [];
  const idx      = roomData.currentPlayerIndex || 0;
  const turnUid  = order[idx];
  const isMyTurn = turnUid === currentUser.uid;
  const players  = roomData.players || [];
  const turnPlayer = players.find(p => p.id === turnUid);
  const turnNick   = turnPlayer ? turnPlayer.nickname : '???';

  const input   = document.getElementById('word-input');
  const sendBtn = document.getElementById('send-btn');

  // 마지막 단어에서 체인 글자 추출
  const lastWord = roomData.lastWord;
  let chainChar = '';
  if (lastWord) {
    chainChar = lastKoreanChar(lastWord) || lastWord.slice(-1);
  }

  if (isMyTurn) {
    input.disabled   = false;
    sendBtn.disabled = false;
    input.placeholder = chainChar
      ? `"${chainChar}"(으)로 시작하는 단어를 입력하세요`
      : '첫 단어를 입력하세요';
    document.getElementById('chain-hint-cell').textContent = chainChar || 'A1';
    document.getElementById('input-hint').textContent = '🟢 내 차례입니다!';
    document.getElementById('game-status-bar').textContent = '내 차례';
    if (!turnStartTs) turnStartTs = Date.now();
    input.focus();
  } else {
    turnStartTs = null;
    input.disabled   = true;
    sendBtn.disabled = true;
    input.placeholder = `${turnNick}의 차례...`;
    document.getElementById('chain-hint-cell').textContent = chainChar || 'A1';
    document.getElementById('input-hint').textContent =
      `⏳ ${turnNick}의 차례 — ${chainChar ? `"${chainChar}"(으)로 시작하는 단어` : '첫 단어 기다리는 중'}`;
    document.getElementById('game-status-bar').textContent = `${turnNick} 차례`;
  }
}

function renderGameSheet() {
  const tbody = document.getElementById('game-sheet-body');
  if (!tbody) return;

  const words   = roomData.words || [];
  const order   = roomData.playerOrder || [];
  const idx     = roomData.currentPlayerIndex || 0;
  let rows = '';
  let rowNum = 1;

  // 헤더 행
  rows += `<tr>
    <td class="row-header">${rowNum++}</td>
    <td class="cell header-row">번호</td>
    <td class="cell header-row">플레이어</td>
    <td class="cell header-row">단어</td>
    <td class="cell header-row">NEW</td>
    <td class="cell header-row">응답시간</td>
    <td class="cell header-row">시각</td>
    <td class="cell header-row">비고</td>
  </tr>`;

  // 단어 행
  words.forEach((entry, i) => {
    const isMe = entry.uid === currentUser.uid;
    const wordCls = isMe ? 'word-mine' : 'word-other';
    const newBadge = entry.isNew
      ? `<span style="color:#C55A11;font-weight:700">✨NEW</span>` : '';
    const rt = (entry.responseTime || 0) > 0
      ? (entry.responseTime / 1000).toFixed(1) + 's' : '-';
    const ts = entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString('ko-KR',
          { hour:'2-digit', minute:'2-digit', second:'2-digit' })
      : '-';

    rows += `<tr>
      <td class="row-header">${rowNum++}</td>
      <td class="cell" style="text-align:center;color:var(--xl-muted)">${i + 1}</td>
      <td class="cell" style="color:${isMe ? 'var(--xl-green)' : 'var(--xl-text)'};font-weight:${isMe ? 700 : 400}">${entry.nickname}</td>
      <td class="cell ${wordCls}" style="font-size:14px">${entry.word}</td>
      <td class="cell word-new">${newBadge}</td>
      <td class="cell" style="text-align:right">${rt}</td>
      <td class="cell" style="color:var(--xl-muted);font-size:10px">${ts}</td>
      <td class="cell"></td>
    </tr>`;
  });

  // 현재 차례 빈 행
  if (roomData.status === 'playing') {
    const isMyTurn = order[idx] === currentUser.uid;
    rows += `<tr>
      <td class="row-header">${rowNum++}</td>
      <td class="cell ${isMyTurn ? 'my-turn' : ''}" colspan="7"
        style="color:var(--xl-muted);font-style:italic">
        ${isMyTurn ? '▶ 수식 입력줄에 단어를 입력하세요...' : ''}
      </td>
    </tr>`;
  }

  // 패딩 빈 행
  for (let i = 0; i < 12; i++) {
    rows += `<tr><td class="row-header">${rowNum++}</td>${Array(7).fill('<td class="cell"></td>').join('')}</tr>`;
  }

  tbody.innerHTML = rows;

  // 마지막 단어 행으로 스크롤
  if (words.length > 0) {
    const allRows = tbody.querySelectorAll('tr');
    const target  = allRows[words.length]; // 헤더 다음부터 words.length번째
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 상태 표시줄
  document.getElementById('stats-bar').textContent =
    `단어 수: ${words.length} | NEW: ${words.filter(w => w.isNew).length}개`;
}

/* ============================================================
   투표 시스템 UI
   ============================================================ */
function checkVote() {
  if (!roomData || roomData.status !== 'playing') return;

  const voteKick  = roomData.voteKick  || {};
  const order     = roomData.playerOrder || [];
  const idx       = roomData.currentPlayerIndex || 0;
  const targetUid = order[idx];
  const players   = roomData.players || [];
  const voters    = (voteKick[targetUid]) || [];
  const needed    = Math.max(3, players.length - 1);

  const voteSection = document.getElementById('vote-bar-section');
  const voteBtn     = document.getElementById('vote-btn');

  // 투표 버튼: 내가 현재 차례가 아닌 경우에만, 참가자 2명 이상
  if (targetUid !== currentUser.uid && players.length >= 2) {
    voteBtn.style.display = 'flex';
  } else {
    voteBtn.style.display = 'none';
  }

  if (voters.length > 0) {
    voteSection.style.display = 'block';
    const targetPlayer = players.find(p => p.id === targetUid);
    const targetNick   = targetPlayer ? targetPlayer.nickname : '???';
    document.getElementById('vote-status-text').textContent =
      `${targetNick}에 대한 강제 패배 투표 (${voters.length}/${needed}명 동의)`;
    const pct = Math.min(100, Math.round((voters.length / needed) * 100));
    document.getElementById('vote-bar-fill').style.width  = pct + '%';
    document.getElementById('vote-count-text').textContent = `${voters.length}/${needed}`;

    // 기준 충족 → 강제 패배 (호스트 또는 첫 번째 투표자가 트리거)
    if (voters.length >= needed) {
      const amTrigger = isHost || voters[0] === currentUser.uid;
      if (amTrigger) {
        endGame(targetUid, '강제 패배 투표').catch(console.error);
      }
    }
  } else {
    voteSection.style.display = 'none';
  }
}

/* ============================================================
   결과 다이얼로그
   ============================================================ */
function showResult() {
  if (!roomData) return;

  const players  = roomData.players || [];
  const loserUid = roomData.loser;
  const words    = roomData.words || [];
  const reason   = roomData.endReason || '게임 종료';

  const isLoser      = loserUid === currentUser.uid;
  const winnerPlayer = players.find(p => p.id === roomData.winner);
  const loserPlayer  = players.find(p => p.id === loserUid);
  const winnerNick   = winnerPlayer ? winnerPlayer.nickname : '???';
  const loserNick    = loserPlayer  ? loserPlayer.nickname  : '???';

  // 내 통계
  const myWords = words.filter(w => w.uid === currentUser.uid);
  const rtList  = myWords.map(w => w.responseTime || 0).filter(t => t > 0);
  const avgRt   = rtList.length
    ? (rtList.reduce((a, b) => a+b, 0) / rtList.length / 1000).toFixed(1) + 's' : '-';
  const newCnt  = myWords.filter(w => w.isNew).length;

  document.getElementById('result-dialog-title').textContent =
    isLoser ? 'Microsoft Excel — 오류 발생' : 'Microsoft Excel — 완료';
  document.getElementById('result-msg').textContent =
    isLoser
      ? `⚠️ ${loserNick}님이 패배했습니다. (${reason})`
      : `🎉 ${winnerNick}님이 승리했습니다! (${reason})`;

  document.getElementById('r-words').textContent  = myWords.length + '개';
  document.getElementById('r-rt').textContent     = avgRt;
  document.getElementById('r-new').textContent    = newCnt + '개';
  document.getElementById('r-result').textContent = isLoser ? '😢 패배' : '🏆 승리';

  document.getElementById('result-dialog').style.display = 'flex';
}

/* ============================================================
   DOMContentLoaded — 메인 진입점
   ============================================================ */
document.addEventListener('DOMContentLoaded', async () => {
  // URL 파라미터에서 방 코드 추출
  const params = new URLSearchParams(location.search);
  roomCode = params.get('room');
  if (!roomCode) {
    toast('방 코드가 없습니다. 홈으로 돌아갑니다.', 'error');
    setTimeout(() => { window.location.href = 'index.html'; }, 1500);
    return;
  }
  roomCode = roomCode.toUpperCase();

  // 닉네임 복원
  myNickname = localStorage.getItem('gg_nickname') || '';
  if (!myNickname || myNickname.length < 2) {
    myNickname = prompt('닉네임을 입력하세요 (2~10자)') || '익명';
    localStorage.setItem('gg_nickname', myNickname);
  }

  // Auth 초기화
  document.getElementById('conn-dot').style.background = '#FFB74D';
  document.getElementById('conn-text').textContent = '인증 중...';
  await initAuth();

  // 방 참가
  const joined = await joinRoom(roomCode, myNickname);
  if (!joined) {
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);
    return;
  }

  // 실시간 구독 시작
  subscribeRoom();

  /* ── 버튼 이벤트 바인딩 ── */

  // 게임 시작 (리본 + 시트)
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('start-btn-sheet').addEventListener('click', startGame);

  // 단어 입력
  const input   = document.getElementById('word-input');
  const sendBtn = document.getElementById('send-btn');
  sendBtn.addEventListener('click', submitWord);
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); submitWord(); }
  });

  // 승복 버튼
  document.getElementById('surrender-btn').addEventListener('click', () => {
    if (!roomData || roomData.status !== 'playing') {
      toast('게임이 진행 중이 아닙니다.', 'warning'); return;
    }
    const order = roomData.playerOrder || [];
    const idx   = roomData.currentPlayerIndex || 0;
    if (order[idx] !== currentUser.uid) {
      toast('지금은 내 차례가 아닙니다.', 'warning'); return;
    }
    if (confirm('정말 승복하시겠습니까?')) surrender();
  });

  // 강제 패배 투표 버튼
  document.getElementById('vote-btn').addEventListener('click', castVote);

  // 링크 복사 버튼
  document.getElementById('copy-link-btn').addEventListener('click', copyLink);
});
