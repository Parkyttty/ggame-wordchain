// main.js — 홈 (엑셀 위장)
let currentUser = null;
let selectedMode = 2;

function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`; el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function closeDialog(id) { document.getElementById(id).style.display = 'none'; }

function selectMode(btn, mode) {
  btn.closest('.xl-dialog-body,#main').querySelectorAll('.mode-xl-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedMode = mode;
}

function generateCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({length:6}, () => ch[Math.floor(Math.random()*ch.length)]).join('');
}

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
      stats: { wins:0, losses:0, totalGames:0, totalWords:0,
               diversityPoints:0, totalResponseTime:0,
               avgResponseTime:0, winStreak:0, bestWinStreak:0 }
    });
  } else if (snap.data().nickname !== nickname) {
    await ref.update({ nickname });
  }
}

async function createRoom() {
  const nickInput = document.getElementById('dialog-nickname');
  const nick = (nickInput?.value || document.getElementById('nickname-input')?.value || '').trim();
  if (!nick || nick.length < 2) { toast('닉네임을 2자 이상 입력해주세요.', 'error'); return; }
  localStorage.setItem('gg_nickname', nick);
  await ensureUserDoc(currentUser.uid, nick);

  try {
    const code = generateCode();
    await db.collection('rooms').doc(code).set({
      mode: selectedMode,
      players: [{id: currentUser.uid, nickname: nick}],
      playerOrder: [currentUser.uid],
      currentPlayerIndex: 0, lastWord: null,
      status: 'waiting', winner: null, loser: null,
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      turnStartedAt: null,
      voteKick: {}  // userId → [voterIds]
    });
    closeDialog('create-dialog');
    toast(`방 코드: ${code}`, 'success');
    window.location.href = `game.html?room=${code}`;
  } catch(e) {
    console.error(e);
    toast('방 생성 실패', 'error');
  }
}

function joinRoom() {
  const nick = document.getElementById('nickname-input')?.value.trim() || '';
  if (!nick || nick.length < 2) { toast('닉네임을 먼저 입력하세요.', 'error'); return; }
  const code = document.getElementById('room-code-input')?.value.trim().toUpperCase() || '';
  if (code.length !== 6) { toast('방 코드 6자리를 입력하세요.', 'error'); return; }
  localStorage.setItem('gg_nickname', nick);
  window.location.href = `game.html?room=${code}`;
}

async function loadRankings() {
  const body = document.getElementById('sheet-body');
  let rows = '';
  let r = 1;

  // 헤더 행
  rows += `<tr>
    <td class="row-header">${r++}</td>
    <td class="cell header-row">순위</td>
    <td class="cell header-row">닉네임</td>
    <td class="cell header-row">승률</td>
    <td class="cell header-row">평균응답</td>
    <td class="cell header-row">다양성</td>
    <td class="cell header-row">연승</td>
    <td class="cell header-row">총 판수</td>
  </tr>`;

  try {
    const snap = await db.collection('users').orderBy('stats.wins','desc').limit(10).get();

    if (snap.empty) {
      rows += `<tr><td class="row-header">${r++}</td>
        <td class="cell" colspan="7" style="color:var(--xl-muted);text-align:center">아직 게임 기록이 없습니다.</td></tr>`;
    } else {
      snap.docs.forEach((doc, i) => {
        const s = doc.data().stats || {};
        const rate = s.totalGames > 0 ? Math.round((s.wins/s.totalGames)*100) : 0;
        const avg  = s.avgResponseTime > 0 ? (s.avgResponseTime/1000).toFixed(1)+'s' : '-';
        const medal = ['🥇','🥈','🥉'][i] || (i+1);
        const rc = i===0 ? 'rank-gold' : i===1 ? 'rank-silver' : i===2 ? 'rank-bronze' : '';
        rows += `<tr>
          <td class="row-header">${r++}</td>
          <td class="cell ${rc}">${medal}</td>
          <td class="cell">${doc.data().nickname||'익명'}</td>
          <td class="cell">${rate}%</td>
          <td class="cell">${avg}</td>
          <td class="cell">${s.diversityPoints||0}</td>
          <td class="cell">${s.winStreak||0}</td>
          <td class="cell">${s.totalGames||0}</td>
        </tr>`;
      });
    }
  } catch(e) {
    rows += `<tr><td class="row-header">${r++}</td>
      <td class="cell" colspan="7" style="color:var(--xl-red)">랭킹 로드 실패</td></tr>`;
  }

  // 빈 행들
  for (let i = 0; i < 15; i++) {
    rows += `<tr><td class="row-header">${r++}</td>
      ${Array(7).fill('<td class="cell"></td>').join('')}</tr>`;
  }

  body.innerHTML = rows;
  document.getElementById('status-info').textContent = '합계: 0 | 평균: 0 | 개수: 0';
}

document.addEventListener('DOMContentLoaded', async () => {
  // 닉네임 복원
  const saved = localStorage.getItem('gg_nickname') || '';
  if (saved) {
    document.getElementById('nickname-input').value = saved;
    const dialogNick = document.getElementById('dialog-nickname');
    if (dialogNick) dialogNick.value = saved;
  }

  // 리본 모드 버튼
  document.querySelectorAll('.ribbon .mode-xl-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ribbon .mode-xl-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMode = parseInt(btn.dataset.mode);
    });
  });

  // 버튼 이벤트
  document.getElementById('create-btn').addEventListener('click', () => {
    const nick = document.getElementById('nickname-input').value.trim();
    if (nick) document.getElementById('dialog-nickname').value = nick;
    document.getElementById('create-dialog').style.display = 'flex';
  });
  document.getElementById('join-btn').addEventListener('click', joinRoom);
  document.getElementById('room-code-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') joinRoom();
  });

  // 셀 클릭 효과
  document.getElementById('main-sheet').addEventListener('click', e => {
    const cell = e.target.closest('td.cell');
    if (!cell) return;
    document.querySelectorAll('td.cell.selected').forEach(c => c.classList.remove('selected'));
    cell.classList.add('selected');
    const row = cell.closest('tr');
    const colIdx = [...row.children].indexOf(cell);
    const rowIdx = [...row.closest('tbody').children].indexOf(row);
    const colLetter = String.fromCharCode(64 + colIdx);
    document.querySelector('.cell-ref').textContent = `${colLetter}${rowIdx + 1}`;
  });

  await initAuth();
  loadRankings();
});
