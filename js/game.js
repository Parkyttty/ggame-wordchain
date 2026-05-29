// ============================================================
// game.js — 게임 룸
// ============================================================

let currentUser   = null;
let userNickname  = '';
let roomCode      = '';
let roomData      = null;
let unsubRoom     = null;
let unsubMoves    = null;
let myTurnStarted = null;
let moves         = [];
let usedWords     = [];

// ── 유틸 ──────────────────────────────────────────────────
function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`; el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
const $ = id => document.getElementById(id);

function avatarColor(uid) {
  const hues = [260,200,30,160,330,0,45,120,300];
  let h = 0;
  for (const c of uid) h = (h*31 + c.charCodeAt(0)) & 0xffffffff;
  return `hsl(${hues[Math.abs(h)%hues.length]},65%,55%)`;
}

function initials(name) { return name ? name[0].toUpperCase() : '?'; }

function fmtTime(ms) {
  if (!ms || ms<=0) return '-';
  if (ms<60000) return `${(ms/1000).toFixed(1)}초`;
  return `${Math.floor(ms/60000)}분 ${((ms%60000)/1000).toFixed(0)}초`;
}

// ── Firebase 인증 ─────────────────────────────────────────
async function initAuth() {
  return new Promise(resolve => {
    auth.onAuthStateChanged(async user => {
      currentUser = user || (await auth.signInAnonymously()).user;
      resolve(currentUser);
    });
  });
}

async function ensureUserDoc(uid, nickname) {
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      nickname, createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      stats: { wins:0,losses:0,totalGames:0,totalWords:0,
               diversityPoints:0,totalResponseTime:0,
               avgResponseTime:0,winStreak:0,bestWinStreak:0 }
    });
  }
}

// ── 방 참여 ───────────────────────────────────────────────
async function joinRoomIfNeeded(code, uid, nickname) {
  const ref  = db.collection('rooms').doc(code);
  const snap = await ref.get();

  if (!snap.exists) { showError('존재하지 않는 방입니다.'); return false; }

  const data = snap.data();
  if (data.status === 'finished') { return true; }

  const isPlayer = (data.players||[]).some(p => p.id === uid);
  if (!isPlayer) {
    if (data.status === 'playing') { toast('이미 시작된 게임입니다. 관전 모드로 봅니다.','warning'); return true; }
    if ((data.players||[]).length >= 6) { showError('방이 가득 찼습니다. (최대 6명)'); return false; }

    await ref.update({
      players:     firebase.firestore.FieldValue.arrayUnion({ id: uid, nickname }),
      playerOrder: firebase.firestore.FieldValue.arrayUnion(uid),
      updatedAt:   firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  return true;
}

// ── 실시간 구독 ───────────────────────────────────────────
function subscribeRoom(code) {
  unsubRoom = db.collection('rooms').doc(code).onSnapshot(snap => {
    if (!snap.exists) { showError('방 정보를 찾을 수 없습니다.'); return; }
    roomData = snap.data();
    renderRoom();
  });

  unsubMoves = db.collection('rooms').doc(code)
    .collection('moves').orderBy('timestamp','asc')
    .onSnapshot(snap => {
      moves     = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      usedWords = moves.map(m => m.word);
      renderMoves();
    });
}

// ── 렌더: 방 ─────────────────────────────────────────────
function renderRoom() {
  if (!roomData) return;

  const turnId = roomData.playerOrder?.[roomData.currentPlayerIndex] || null;

  // 플레이어 칩
  $('players-list').innerHTML = (roomData.players||[]).map(p => {
    const active = p.id === turnId && roomData.status === 'playing';
    const me = p.id === currentUser.uid;
    return `<div class="player-chip ${active?'active':''} ${me?'you':''}">
      <div class="player-dot"></div>
      <span>${p.nickname}${me?' (나)':''}</span>
      ${active?'<span class="badge badge-green" style="font-size:11px">차례</span>':''}
    </div>`;
  }).join('');

  if (roomData.status === 'waiting') {
    renderWaiting();
  } else {
    $('waiting-screen').style.display = 'none';
    $('game-area').style.display      = 'block';
    renderInputArea(turnId);
    if (roomData.status === 'finished') showResultOverlay();
  }

  $('mode-badge').textContent = {2:'두글자',3:'세글자',4:'네글자'}[roomData.mode]||'';
}

// ── 렌더: 대기 화면 ───────────────────────────────────────
function renderWaiting() {
  $('waiting-screen').style.display = 'flex';
  $('game-area').style.display      = 'none';

  const url = `${location.origin}${location.pathname}?room=${roomCode}`;
  $('room-code-display').textContent = roomCode;
  $('share-url').textContent = url;

  const isCreator = roomData.createdBy === currentUser.uid;
  const canStart  = (roomData.players||[]).length >= 2;
  $('start-btn').style.display = isCreator ? 'inline-flex' : 'none';
  $('start-btn').disabled      = !canStart;
  $('start-btn').textContent   = canStart ? '🚀 게임 시작!' : `친구를 기다리는 중… (${(roomData.players||[]).length}/2명 이상)`;
}

// ── 렌더: 입력 영역 ───────────────────────────────────────
function renderInputArea(turnId) {
  const isMyTurn   = turnId === currentUser.uid;
  const isPlaying  = roomData.status === 'playing';
  const isObserver = !(roomData.players||[]).some(p => p.id === currentUser.uid);

  const lastChar = roomData.lastWord ? lastKoreanChar(roomData.lastWord) : null;
  $('chain-hint').textContent = lastChar || '';

  const input   = $('word-input');
  const hint    = $('input-hint');
  const sendBtn = $('send-btn');

  if (!isPlaying || isObserver) {
    input.disabled = true; sendBtn.disabled = true;
    hint.textContent = isObserver ? '👀 관전 중' : '게임이 종료됐습니다';
    hint.className = 'input-hint';
    return;
  }

  if (isMyTurn) {
    if (!myTurnStarted) myTurnStarted = Date.now();
    input.disabled = false; sendBtn.disabled = false;
    input.focus();
    hint.textContent = lastChar
      ? `✅ 내 차례! '${lastChar}'(으)로 시작하는 ${roomData.mode}글자 단어`
      : `✅ 첫 번째 차례! ${roomData.mode}글자 단어를 입력해요`;
    hint.className = 'input-hint your-turn';
  } else {
    myTurnStarted = null;
    input.disabled = true; sendBtn.disabled = true;
    const p = (roomData.players||[]).find(p => p.id === turnId);
    hint.textContent = `⏳ ${p?.nickname||'상대방'} 차례를 기다리는 중…`;
    hint.className = 'input-hint waiting';
  }
}

// ── 렌더: 단어 히스토리 ───────────────────────────────────
function renderMoves() {
  const container = $('word-history');
  if (moves.length === 0) {
    container.innerHTML = '<p class="sys-msg">아직 입력된 단어가 없어요.<br>첫 단어를 입력해보세요! 🎯</p>';
    return;
  }

  container.innerHTML = moves.map(m => {
    const me    = m.userId === currentUser.uid;
    const color = avatarColor(m.userId);
    const rt    = m.responseTime ? `⚡ ${fmtTime(m.responseTime)}` : '';
    const ts    = m.timestamp?.toDate?.()
      ? m.timestamp.toDate().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'}) : '';

    return `<div class="word-item ${me?'mine':''}">
      <div class="word-avatar" style="background:${color}">${initials(m.nickname)}</div>
      <div class="word-bubble">
        <div class="word-bubble-inner">
          ${m.word} ${m.isNewWord?'<span class="word-new-badge">NEW✨</span>':''}
        </div>
        <div class="word-meta">
          <span>${m.nickname}</span>
          ${rt?`<span>${rt}</span>`:''}
          ${ts?`<span>${ts}</span>`:''}
        </div>
      </div>
    </div>`;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

// ── 단어 제출 ─────────────────────────────────────────────
async function submitWord() {
  const input = $('word-input');
  const word  = input.value.trim();

  if (word === '승복하겠습니다') { await surrenderGame(); return; }

  const result = validateWord(word, roomData.mode, roomData.lastWord, usedWords);
  if (!result.valid) {
    $('input-hint').textContent = `❌ ${result.error}`;
    $('input-hint').className   = 'input-hint error';
    input.classList.add('error');
    setTimeout(() => {
      input.classList.remove('error');
      renderInputArea(roomData.playerOrder[roomData.currentPlayerIndex]);
    }, 2200);
    return;
  }

  $('send-btn').disabled = true;
  input.disabled = true;

  const responseTime = myTurnStarted ? Date.now() - myTurnStarted : 0;
  myTurnStarted = null;

  try {
    // 전체 이력 단어 여부 확인
    const wordSnap = await db.collection('globalWords').doc(word).get();
    const isNewWord = !wordSnap.exists;

    const nextIndex = (roomData.currentPlayerIndex + 1) % roomData.playerOrder.length;
    const batch = db.batch();

    // 단어 기록
    const moveRef = db.collection('rooms').doc(roomCode).collection('moves').doc();
    batch.set(moveRef, {
      userId: currentUser.uid, nickname: userNickname,
      word, isNewWord, responseTime,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 방 업데이트
    batch.update(db.collection('rooms').doc(roomCode), {
      lastWord: word, currentPlayerIndex: nextIndex,
      updatedAt:     firebase.firestore.FieldValue.serverTimestamp(),
      turnStartedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    // 전역 단어 카운트
    if (isNewWord) {
      batch.set(db.collection('globalWords').doc(word), {
        count: 1, firstUsed: firebase.firestore.FieldValue.serverTimestamp()
      });
    } else {
      batch.update(db.collection('globalWords').doc(word), {
        count: firebase.firestore.FieldValue.increment(1)
      });
    }

    // 사용자 통계
    const userRef = db.collection('users').doc(currentUser.uid);
    const uSnap = await userRef.get();
    const uStats = uSnap.data()?.stats || {};
    const newTotal = (uStats.totalWords||0) + 1;
    const newTotalRt = (uStats.totalResponseTime||0) + responseTime;
    const upd = {
      'stats.totalWords':        newTotal,
      'stats.totalResponseTime': newTotalRt,
      'stats.avgResponseTime':   Math.round(newTotalRt / newTotal)
    };
    if (isNewWord) upd['stats.diversityPoints'] = firebase.firestore.FieldValue.increment(1);
    batch.update(userRef, upd);

    await batch.commit();

    input.value = '';
    toast(`"${word}" ✅${isNewWord?' 🌟 새 단어!':''}`, 'success');
  } catch (e) {
    console.error(e);
    toast('제출 실패. 다시 시도해주세요.', 'error');
    $('send-btn').disabled = false;
    input.disabled = false;
  }
}

// ── 게임 시작 ─────────────────────────────────────────────
async function startGame() {
  if ((roomData.players||[]).length < 2) { toast('최소 2명 필요해요.', 'warning'); return; }
  if (roomData.createdBy !== currentUser.uid) return;

  const btn = $('start-btn');
  btn.disabled = true; btn.textContent = '시작 중…';

  try {
    // 플레이어 순서 셔플
    const order = [...roomData.playerOrder];
    for (let i = order.length-1; i>0; i--) {
      const j = Math.floor(Math.random()*(i+1));
      [order[i],order[j]] = [order[j],order[i]];
    }

    const batch = db.batch();
    batch.update(db.collection('rooms').doc(roomCode), {
      status: 'playing', playerOrder: order,
      currentPlayerIndex: 0, lastWord: null,
      turnStartedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
    });
    for (const p of (roomData.players||[])) {
      batch.update(db.collection('users').doc(p.id), {
        'stats.totalGames': firebase.firestore.FieldValue.increment(1)
      });
    }
    await batch.commit();
    toast('게임 시작! 🎮', 'success');
  } catch (e) {
    console.error(e);
    toast('시작 실패.', 'error');
    btn.disabled = false; btn.textContent = '🚀 게임 시작!';
  }
}

// ── 승복 ──────────────────────────────────────────────────
async function surrenderGame() {
  if (!confirm('정말 승복하겠습니까? (패배 처리됩니다)')) return;

  try {
    const winner = (roomData.players||[]).find(p => p.id !== currentUser.uid);
    const batch  = db.batch();

    batch.update(db.collection('rooms').doc(roomCode), {
      status: 'finished', loser: currentUser.uid, winner: winner?.id||null,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });

    batch.update(db.collection('users').doc(currentUser.uid), {
      'stats.losses': firebase.firestore.FieldValue.increment(1),
      'stats.winStreak': 0
    });

    if (winner) {
      const wSnap = await db.collection('users').doc(winner.id).get();
      const ws  = (wSnap.data()?.stats?.winStreak||0) + 1;
      const bws = Math.max(ws, wSnap.data()?.stats?.bestWinStreak||0);
      batch.update(db.collection('users').doc(winner.id), {
        'stats.wins':          firebase.firestore.FieldValue.increment(1),
        'stats.winStreak':     ws,
        'stats.bestWinStreak': bws
      });
    }
    await batch.commit();
    toast('승복했습니다! 다음엔 꼭 이겨요 💪', 'warning');
  } catch(e) {
    console.error(e);
    toast('처리 중 오류.', 'error');
  }
}

// ── 결과 오버레이 ─────────────────────────────────────────
function showResultOverlay() {
  if ($('result-overlay').style.display === 'flex') return;

  const isWinner = roomData.winner === currentUser.uid;
  const isLoser  = roomData.loser  === currentUser.uid;
  const wp = (roomData.players||[]).find(p => p.id === roomData.winner);

  $('result-emoji').textContent = isWinner ? '🏆' : isLoser ? '😭' : '🎮';
  $('result-title').textContent = isWinner ? '승리!' : isLoser ? '패배...' : '게임 종료';
  $('result-sub').textContent   = isWinner ? '축하해요! 최고예요! 🎉'
    : isLoser ? '승복했습니다. 다음엔 이길 수 있어요!'
    : wp ? `${wp.nickname} 님이 승리!` : '게임이 종료됐습니다.';

  const myMoves  = moves.filter(m => m.userId === currentUser.uid);
  const wordCnt  = myMoves.length;
  const avgRt    = wordCnt > 0
    ? Math.round(myMoves.reduce((s,m) => s+(m.responseTime||0), 0) / wordCnt) : 0;
  const newWords = myMoves.filter(m => m.isNewWord).length;

  $('stat-words').textContent  = wordCnt;
  $('stat-avg-rt').textContent = avgRt > 0 ? `${(avgRt/1000).toFixed(1)}초` : '-';
  $('stat-new').textContent    = `+${newWords}`;
  $('stat-result').textContent = isWinner ? '🏆 WIN' : isLoser ? '💀 LOSE' : '-';

  $('result-overlay').style.display = 'flex';
}

// ── 에러 화면 ─────────────────────────────────────────────
function showError(msg) {
  document.body.innerHTML = `
    <div class="page-wrap" style="display:flex;align-items:center;justify-content:center;min-height:80vh;text-align:center">
      <div>
        <div style="font-size:64px">😵</div>
        <h2 style="margin:16px 0 8px">${msg}</h2>
        <a href="index.html" class="btn btn-primary" style="margin-top:16px;display:inline-flex">홈으로</a>
      </div>
    </div>`;
}

// ── 메인 ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(location.search);
  roomCode = params.get('room')?.toUpperCase() || '';
  if (!roomCode) { showError('방 코드가 없습니다.'); return; }

  $('room-code-header').textContent = roomCode;

  userNickname = localStorage.getItem('gg_nickname') || '';
  if (!userNickname) {
    userNickname = prompt('닉네임을 입력해주세요 (2~10자)') || '익명';
    localStorage.setItem('gg_nickname', userNickname);
  }

  await initAuth();
  await ensureUserDoc(currentUser.uid, userNickname);

  const ok = await joinRoomIfNeeded(roomCode, currentUser.uid, userNickname);
  if (!ok) return;

  // 링크 복사
  const shareUrl = `${location.origin}${location.pathname}?room=${roomCode}`;
  $('share-url').textContent = shareUrl;
  $('copy-link-btn').addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrl);
    toast('링크 복사됐어요! 📋', 'success');
  });
  $('share-box')?.addEventListener('click', () => {
    navigator.clipboard.writeText(shareUrl);
    toast('링크 복사됐어요!', 'success');
  });

  $('start-btn').addEventListener('click', startGame);
  $('send-btn').addEventListener('click', submitWord);
  $('surrender-btn').addEventListener('click', surrenderGame);
  $('home-btn').addEventListener('click', () => { window.location.href = 'index.html'; });
  $('play-again-btn').addEventListener('click', () => { window.location.href = 'index.html'; });

  $('word-input').addEventListener('keydown', e => { if(e.key==='Enter') submitWord(); });

  subscribeRoom(roomCode);
});

window.addEventListener('beforeunload', () => {
  unsubRoom?.();
  unsubMoves?.();
});
