(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const config = window.FIREBASE_CONFIG || {};
  const missingConfig = Object.values(config).some(v => typeof v !== 'string' || !v || v.startsWith('YOUR_'));

  const state = {
    uid: null,
    roomId: null,
    room: null,
    isOwner: false,
    memberName: '看片玩家',
    roomRef: null,
    stateRef: null,
    membersRef: null,
    chatRef: null,
    stateUnsub: null,
    membersUnsub: null,
    chatUnsub: null,
    player: null,
    playerReady: false,
    directVideo: $('directVideo'),
    applyingRemote: false,
    lastRemoteStateKey: '',
    lastWriteAt: 0,
    seekTimer: null,
    directTimer: null,
    youtubeReady: false
  };

  let db = null;
  let auth = null;

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function error(el, message) { el.textContent = message || ''; }
  function show(view) { $('homeView').classList.toggle('hidden', view !== 'home'); $('roomView').classList.toggle('hidden', view !== 'room'); }
  function fmt(sec) {
    if (!Number.isFinite(sec)) return '00:00';
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  function randomCode() { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''; for(let i=0;i<6;i++) s += chars[Math.floor(Math.random()*chars.length)]; return s; }
  function getParamRoom() { return new URLSearchParams(location.search).get('room')?.toUpperCase() || ''; }
  function roomLink(roomId) { return `${location.origin}${location.pathname}?room=${encodeURIComponent(roomId)}`; }
  function getInitialName() {
    let n = localStorage.getItem('wt_name');
    if (!n) { n = `玩家${Math.floor(Math.random()*900+100)}`; localStorage.setItem('wt_name', n); }
    return n;
  }

  function extractYoutubeId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0];
      if (u.hostname.includes('youtube.com')) {
        if (u.pathname === '/watch') return u.searchParams.get('v');
        if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2];
        if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2];
      }
    } catch (_) {}
    return null;
  }

  function currentPosition() {
    if (state.room?.sourceType === 'youtube') return state.playerReady && state.player ? state.player.getCurrentTime() : 0;
    return state.directVideo?.currentTime || 0;
  }
  function isPlaying() {
    if (state.room?.sourceType === 'youtube') return state.playerReady && state.player?.getPlayerState?.() === YT.PlayerState.PLAYING;
    return !!state.directVideo && !state.directVideo.paused;
  }
  function duration() {
    if (state.room?.sourceType === 'youtube') return state.playerReady && state.player ? state.player.getDuration() : 0;
    return state.directVideo?.duration || 0;
  }
  function updateTimeUI() { $('timeReadout').textContent = `${fmt(currentPosition())} / ${fmt(duration())}`; }

  async function writePlayback(action, explicitPosition = null) {
    if (!state.stateRef || state.applyingRemote) return;
    const now = Date.now();
    if (action === 'sync' && now - state.lastWriteAt < 300) return;
    state.lastWriteAt = now;
    const payload = {
      action,
      position: Math.max(0, Number(explicitPosition ?? currentPosition()) || 0),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid
    };
    await state.stateRef.set(payload).catch(() => toast('同步失敗，請檢查 Firebase 規則'));
  }

  async function applyRemotePlayback(data) {
    if (!data || data.updatedBy === state.uid) return;
    const key = `${data.updatedAt}|${data.updatedBy}|${data.action}|${data.position}`;
    if (key === state.lastRemoteStateKey) return;
    state.lastRemoteStateKey = key;
    state.applyingRemote = true;
    try {
      const pos = Number(data.position) || 0;
      const type = state.room?.sourceType;
      if (type === 'youtube' && state.playerReady && state.player) {
        const diff = Math.abs((state.player.getCurrentTime() || 0) - pos);
        if (diff > 0.7 || data.action === 'seek' || data.action === 'sync') state.player.seekTo(pos, true);
        if (data.action === 'play') state.player.playVideo();
        if (data.action === 'pause') state.player.pauseVideo();
        if (data.action === 'seek' || data.action === 'sync') {
          data.action === 'pause' ? state.player.pauseVideo() : state.player.playVideo();
        }
      } else if (type === 'direct' && state.directVideo) {
        if (Math.abs(state.directVideo.currentTime - pos) > 0.7 || data.action === 'seek' || data.action === 'sync') state.directVideo.currentTime = pos;
        if (data.action === 'play') await state.directVideo.play().catch(() => {});
        if (data.action === 'pause') state.directVideo.pause();
        if (data.action === 'seek' || data.action === 'sync') await state.directVideo.play().catch(() => {});
      }
    } finally {
      setTimeout(() => state.applyingRemote = false, 250);
    }
    $('syncStatus').textContent = `已同步 ${fmt(pos)}`;
    updateTimeUI();
  }

  function wireYoutubeEvents() {
    if (!state.player) return;
    state.player.addEventListener('onStateChange', (ev) => {
      if (state.applyingRemote) return;
      if (ev.data === YT.PlayerState.PLAYING) writePlayback('play');
      else if (ev.data === YT.PlayerState.PAUSED) writePlayback('pause');
      updateTimeUI();
    });
  }

  function buildPlayer() {
    const type = state.room?.sourceType;
    $('youtubePlayer').classList.toggle('hidden', type !== 'youtube');
    $('directVideo').classList.toggle('hidden', type !== 'direct');
    $('playerPlaceholder').classList.add('hidden');
    state.playerReady = false;

    if (type === 'youtube') {
      const id = extractYoutubeId(state.room.sourceUrl);
      if (!id) { $('playerPlaceholder').textContent = 'YouTube 網址無法辨識'; $('playerPlaceholder').classList.remove('hidden'); return; }
      if (!window.YT || !YT.Player) { $('playerPlaceholder').textContent = 'YouTube 播放器載入中…'; $('playerPlaceholder').classList.remove('hidden'); setTimeout(buildPlayer, 500); return; }
      if (state.player) { try { state.player.destroy(); } catch(_) {} }
      state.player = new YT.Player('youtubePlayer', {
        videoId: id,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => { state.playerReady = true; updateTimeUI(); syncLatestState(); wireYoutubeEvents(); },
          onError: () => toast('YouTube 播放器無法播放這支影片')
        }
      });
      $('volumeInput').value = '100';
    } else {
      state.directVideo.pause();
      state.directVideo.src = state.room.sourceUrl;
      state.directVideo.load();
      state.directVideo.addEventListener('loadedmetadata', () => { state.playerReady = true; updateTimeUI(); syncLatestState(); }, { once: true });
      state.directVideo.addEventListener('play', () => { if (!state.applyingRemote) writePlayback('play'); });
      state.directVideo.addEventListener('pause', () => { if (!state.applyingRemote) writePlayback('pause'); });
      state.directVideo.addEventListener('seeking', () => {
        if (state.applyingRemote) return;
        clearTimeout(state.seekTimer); state.seekTimer = setTimeout(() => writePlayback('seek', state.directVideo.currentTime), 100);
      });
      state.directVideo.addEventListener('timeupdate', updateTimeUI);
    }
  }

  async function syncLatestState() {
    if (!state.stateRef) return;
    const snap = await state.stateRef.once('value');
    const data = snap.val();
    if (data) await applyRemotePlayback({...data, updatedBy: data.updatedBy === state.uid ? '' : data.updatedBy});
    else writePlayback('sync', 0);
  }

  function listenRoom() {
    state.stateUnsub?.();
    state.membersUnsub?.();
    state.chatUnsub?.();

    state.stateRef = db.ref(`rooms/${state.roomId}/state`);
    state.membersRef = db.ref(`members/${state.roomId}`);
    state.chatRef = db.ref(`rooms/${state.roomId}/chat`);

    state.stateRef.on('value', s => applyRemotePlayback(s.val()));
    state.membersRef.on('value', s => renderMembers(s.val() || {}));
    state.chatRef.limitToLast(100).on('value', s => renderChat(s.val() || {}));
  }

  async function loadRoom(roomId) {
    roomId = (roomId || '').toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(roomId)) throw new Error('房間碼格式不正確');
    const snap = await db.ref(`rooms/${roomId}`).once('value');
    if (!snap.exists()) throw new Error('找不到這個房間');
    state.roomId = roomId;
    state.room = snap.val();
    state.isOwner = state.room.owner === state.uid;
    $('roomTitle').textContent = state.room.name || '一起看片';
    $('roomCodeLabel').textContent = roomId;
    document.querySelectorAll('.owner-only').forEach(el => el.classList.toggle('hidden', !state.isOwner));
    show('room');
    await db.ref(`members/${roomId}/${state.uid}`).set({ name: state.memberName, joinedAt: firebase.database.ServerValue.TIMESTAMP });
    listenRoom();
    buildPlayer();
  }

  async function createRoom() {
    const name = $('roomNameInput').value.trim() || '一起看片';
    const sourceType = $('sourceTypeInput').value;
    const sourceUrl = $('sourceUrlInput').value.trim();
    if (!sourceUrl) return error($('homeError'), '請貼上影片網址');
    if (sourceType === 'youtube' && !extractYoutubeId(sourceUrl)) return error($('homeError'), '這不是可辨識的 YouTube 網址');
    error($('homeError'), '');

    let roomId = randomCode();
    while ((await db.ref(`rooms/${roomId}`).once('value')).exists()) roomId = randomCode();
    const room = {
      owner: state.uid,
      name,
      sourceType,
      sourceUrl,
      state: { action:'pause', position:0, updatedAt:firebase.database.ServerValue.TIMESTAMP, updatedBy:state.uid }
    };
    await db.ref(`rooms/${roomId}`).set(room);
    history.replaceState({}, '', `?room=${roomId}`);
    await loadRoom(roomId);
  }

  function renderMembers(obj) {
    const entries = Object.entries(obj).sort((a,b) => (a[1].joinedAt||0)-(b[1].joinedAt||0));
    $('memberCount').textContent = entries.length;
    $('memberList').innerHTML = entries.map(([uid,m],i) => `<div class="member"><div class="avatar">${escapeHtml((m.name||'玩').slice(0,1))}</div><div class="member-name"><b>${escapeHtml(m.name||'看片玩家')}</b><span>${uid===state.room?.owner?'房主':'成員'}</span></div><span class="online"></span></div>`).join('') || '<div class="muted">還沒有其他人加入。</div>';
  }

  function renderChat(obj) {
    const list = Object.values(obj).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    $('chatMessages').innerHTML = list.map(m => `<div class="message"><b>${escapeHtml(m.name||'玩家')}</b><p>${escapeHtml(m.text||'')}</p></div>`).join('');
    const box = $('chatMessages'); box.scrollTop = box.scrollHeight;
  }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}

  async function changeSource(type, url) {
    if (!state.isOwner) return;
    if (type === 'youtube' && !extractYoutubeId(url)) throw new Error('YouTube 網址無法辨識');
    await db.ref(`rooms/${state.roomId}/sourceType`).set(type);
    await db.ref(`rooms/${state.roomId}/sourceUrl`).set(url);
    await db.ref(`rooms/${state.roomId}/state`).set({ action:'seek', position:0, updatedAt:firebase.database.ServerValue.TIMESTAMP, updatedBy:state.uid });
    state.room.sourceType = type; state.room.sourceUrl = url;
    buildPlayer(); toast('影片已切換');
  }

  function onPlayPause() {
    if (isPlaying()) {
      if (state.room.sourceType==='youtube') state.player.pauseVideo(); else state.directVideo.pause();
    } else {
      if (state.room.sourceType==='youtube') state.player.playVideo(); else state.directVideo.play().catch(()=>toast('瀏覽器阻止了自動播放，請點播放器再播放'));
    }
  }

  function setupEvents() {
    $('sourceTypeInput').addEventListener('change', () => $('sourceUrlLabel').textContent = $('sourceTypeInput').value==='youtube' ? 'YouTube 影片網址' : '直接影片網址');
    $('createRoomBtn').addEventListener('click', () => createRoom().catch(e=>error($('homeError'),e.message||'建立房間失敗')));
    $('joinRoomBtn').addEventListener('click', () => loadRoom($('joinCodeInput').value.trim()).catch(e=>toast(e.message||'加入失敗')));
    $('joinCodeInput').addEventListener('input', e => e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,''));
    $('leaveRoomBtn').addEventListener('click', () => { location.href = location.pathname; });
    $('copyRoomBtn').addEventListener('click', async () => { await navigator.clipboard.writeText(roomLink(state.roomId)); toast('房間連結已複製'); });
    $('playPauseBtn').addEventListener('click', onPlayPause);
    $('backBtn').addEventListener('click', () => { const p=Math.max(0,currentPosition()-10); if(state.room.sourceType==='youtube') state.player.seekTo(p,true); else state.directVideo.currentTime=p; writePlayback('seek',p); });
    $('forwardBtn').addEventListener('click', () => { const p=Math.min(duration()||Infinity,currentPosition()+10); if(state.room.sourceType==='youtube') state.player.seekTo(p,true); else state.directVideo.currentTime=p; writePlayback('seek',p); });
    $('syncNowBtn').addEventListener('click', () => syncLatestState().then(()=>toast('已重新同步')));
    $('volumeInput').addEventListener('input', e => { const v=Number(e.target.value); if(state.room?.sourceType==='youtube'&&state.playerReady) state.player.setVolume(v); else state.directVideo.volume=v/100; });
    $('fullscreenBtn').addEventListener('click', () => $('playerWrap').requestFullscreen?.());
    $('copyTimeBtn').addEventListener('click', async () => { await navigator.clipboard.writeText(fmt(currentPosition())); toast('目前時間已複製'); });
    $('changeSourceBtn').addEventListener('click', () => $('sourceModal').classList.remove('hidden'));
    $('cancelModalBtn').addEventListener('click', () => $('sourceModal').classList.add('hidden'));
    $('saveSourceBtn').addEventListener('click', async () => { try { error($('modalError'),''); await changeSource($('sourceTypeModal').value,$('sourceUrlModal').value.trim()); $('sourceModal').classList.add('hidden'); } catch(e){ error($('modalError'),e.message||'切換失敗'); } });
    $('chatForm').addEventListener('submit', async e => { e.preventDefault(); const text=$('chatInput').value.trim(); if(!text||!state.chatRef)return; $('chatInput').value=''; await state.chatRef.push({uid:state.uid,name:state.memberName,text,createdAt:firebase.database.ServerValue.TIMESTAMP}); });
    window.addEventListener('beforeunload', () => { if(state.roomId&&state.uid) db.ref(`members/${state.roomId}/${state.uid}`).remove().catch(()=>{}); });
    setInterval(updateTimeUI, 500);
    setInterval(() => {
      if (!state.roomId || state.applyingRemote || !state.stateRef || !isPlaying()) return;
      const data = { action:'sync', position:currentPosition(), updatedAt:firebase.database.ServerValue.TIMESTAMP, updatedBy:state.uid };
      // Soft heartbeat. Do not spam the database more than once per 4 seconds.
      if (Date.now()-state.lastWriteAt > 4000) state.stateRef.set(data).catch(()=>{});
    }, 1000);
  }

  window.onYouTubeIframeAPIReady = () => { state.youtubeReady=true; if(state.room?.sourceType==='youtube') buildPlayer(); };

  async function init() {
    state.memberName = getInitialName();
    setupEvents();
    if (missingConfig) {
      $('authStatus').textContent='尚未設定 Firebase';
      $('createRoomBtn').disabled=true; $('joinRoomBtn').disabled=true;
      error($('homeError'),'請先把 firebase-config.js 裡的 Firebase 設定換成你的專案資料。');
      return;
    }

    firebase.initializeApp(config);
    auth = firebase.auth();
    db = firebase.database();
    auth.onAuthStateChanged(async user => {
      if (!user) return;
      state.uid = user.uid;
      $('authStatus').textContent='已連線';
      const room = getParamRoom();
      if (room) {
        try { await loadRoom(room); } catch(e) { history.replaceState({},'',location.pathname); toast(e.message||'房間不存在'); }
      }
    });
    await auth.signInAnonymously().catch(e => { $('authStatus').textContent='登入失敗'; error($('homeError'),'Firebase Anonymous Authentication 尚未啟用。'); console.error(e); });
  }

  init();
})();
