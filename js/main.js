// ============================================================
// main.js — 홈 페이지
// ============================================================

let currentUser  = null;
let userNickname = '';
let selectedMode = 2;

// ── 유틸 ──────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function generateCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => ch[Math.floor(Math.random() * ch.length)]).join('');
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
      nickname,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      stats: { wins:0, losses:0, totalGames:0, totalWords:0,
               diversityPoints:0, totalResponseTime:0,
               avgResponseTime:0, winStreak:0, bestWinStreak:0 }
    });
  } else if (snap.data().nickname !== nickname) {
    await ref.update({ nickname });
  }
}

// ── 방 생성 ───────────────────────────────────────────────
async function createRoom() {
  const nick = document.getElementById('nickname-input').value.trim();
  if (!nick || nick.length < 2) { toast('닉네임을 2자 이상 입력해주세요.', 'error'); return; }

  userNickname = nick;
  localStorage.setItem('gg_nickname', nick);
  await ensureUserDoc(currentUser.uid, nick);

  const btn = document.getElementById('create-btn');
  btn.disabled = true; btn.textContent = '방 만드는 중...';

  try {
    const code = generateCode();
    await db.collection('rooms').doc(code).set({
      mode: selectedMode,
      players: [{ id: currentUser.uid, nickname: nick }],
      playerOrder: [currentUser.uid],
      currentPlayerIndex: 0,
      lastWord: null,
      status: 'waiting',
      winner: null, loser: null,
      createdBy: currentUser.uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      turnStartedAt: null
    });
    toast('방 생성 완료!', 'success');
    window.location.href = `game.html?room=${code}`;
  } catch (e) {
    console.error(e);
    toast('방 생성 실패. 다시 시도해주세요.', 'error');
    btn.disabled = false; btn.textContent = '게임 만들기';
  }
}

// ── 방 참여 ───────────────────────────────────────────────
async function joinRoom() {
  const nick = document.getElementById('nickname-input').value.trim();
  if (!nick || nick.length < 2) { toast('닉네임을 2자 이상 입력해주세요.', 'error'); return; }

  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (code.length !== 6) { toast('방 코드 6자리를 입력해주세요.', 'error'); return; }

  localStorage.setItem('gg_nickname', nick);
  window.location.href = `game.html?room=${code}`;
}

// ── 랭킹 로드 ─────────────────────────────────────────────
async function loadRankings() {
  const list = document.getElementById('rankings-list');
  try {
    const snap = await db.collection('users').orderBy('stats.wins', 'desc').limit(10).get();

    if (snap.empty) {
      list.innerHTML = '<p style="color:var(--muted);text-align:center;padding:20px;font-size:14px">아직 기록이 없어요 👻</p>';
      return;
    }

    const rows = snap.docs.map((doc, i) => {
      const s = doc.data().stats || {};
      const rate = s.totalGames > 0 ? Math.round((s.wins/s.totalGames)*100) : 0;
      const avgSec = s.avgResponseTime > 0 ? (s.avgResponseTime/1000).toFixed(1)+'초' : '-';
      const medal = ['🥇','🥈','🥉'][i] || '';
      const rankClass = ['gold','silver','bronze'][i] || '';
      return `<tr>
        <td><span class="rank-num ${rankClass}">${medal||i+1}</span></td>
        <td><strong>${doc.data().nickname||'익명'}</strong></td>
        <td><span class="badge badge-purple">${rate}%</span></td>
        <td>${avgSec}</td>
        <td><span class="badge badge-green">+${s.diversityPoints||0}</span></td>
        <td style="color:var(--muted);font-size:13px">${s.totalGames||0}판</td>
      </tr>`;
    }).join('');

    list.innerHTML = `
      <table class="rank-table">
        <thead><tr>
          <th>#</th><th>닉네임</th><th>승률</th><th>평균응답</th><th>다양성</th><th>판수</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (e) {
    list.innerHTML = '<p style="color:var(--red);text-align:center;padding:20px;font-size:14px">랭킹 로드 실패</p>';
  }
}

// ── 초기화 ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const savedNick = localStorage.getItem('gg_nickname') || '';
  if (savedNick) document.getElementById('nickname-input').value = savedNick;

  // 모드 버튼
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMode = parseInt(btn.dataset.mode);
    });
  });

  document.getElementById('create-btn').addEventListener('click', createRoom);
  document.getElementById('join-btn').addEventListener('click', joinRoom);
  document.getElementById('room-code-input').addEventListener('keydown', e => { if(e.key==='Enter') joinRoom(); });

  await initAuth();
  loadRankings();
});
