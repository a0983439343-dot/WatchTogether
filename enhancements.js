(() => {
"use strict";
if (!window.firebase) return;

var wt = window.WT_ENHANCEMENTS = window.WT_ENHANCEMENTS || {};
var $ = function(id) { return document.getElementById(id); };
var db = wt.db = firebase.database();
var auth = wt.auth = firebase.auth();

var KEYS = wt.KEYS = {
  recentRooms: "wt_recent_rooms_v2",
  history: "wt_watch_history_v1",
  favorites: "wt_favorites_v1",
  theme: "wt_theme_v1",
  notifications: "wt_notifications_v1"
};

var ROOM_RE = /^[A-Z0-9]{6}$/;
var FRIEND_CODE_RE = /^[A-Z0-9]{6}$/;
var THEMES = wt.THEMES = [
  {id:"aurora",name:"Aurora",desc:"流光玻璃、柔和層次、寬鬆留白"},
  {id:"cyber",name:"Cyber Grid",desc:"網格背景、切角卡片、霓虹結構"},
  {id:"paper",name:"Paper",desc:"紙張質感、襯線字、硬邊陰影"},
  {id:"terminal",name:"Terminal",desc:"終端字體、掃描線、零圓角"},
  {id:"sakura",name:"Sakura",desc:"柔和櫻花構圖、不對稱圓角"},
  {id:"ocean",name:"Ocean",desc:"深海層次、流體光暈、海浪式分區"},
  {id:"sunset",name:"Sunset",desc:"暖夕陽、斜角卡片、編輯風構圖"},
  {id:"mono",name:"Mono",desc:"黑白硬邊、極簡排版、紙卡陰影"},
  {id:"glass",name:"Glass Room",desc:"透明玻璃、浮層面板、柔焦深度"},
  {id:"retro",name:"Retro Tape",desc:"復古錄影帶、顆粒紋理、老電視比例感"},
  {id:"forest",name:"Forest",desc:"森林紙張、木質層次、自然不規則分區"},
  {id:"blueprint",name:"Blueprint",desc:"工程藍圖、標註線、技術文件風格"}
];

var STICKERS = wt.STICKERS = [
  "😀","😂","🤣","😊","😍","🥹","😎","🤩","😱","😭",
  "🥺","😡","🤔","😴","🤯","🥳","❤️","💖","🔥","✨",
  "👍","👎","👏","🙏","🎉","🍿","🎬","🫶","💯","⭐"
];

var state = wt.state = {
  user:null,
  profile:null,
  friends:{},
  requests:{},
  selectedFriendUid:"",
  selectedFriendProfile:null,
  dmMessagesRef:null,
  dmReadsRef:null,
  dmReads:{},
  dmSelectionToken:0,
  lastDmMarkedAt:0,
  requestRef:null,
  roomChatRef:null,
  roomVideoRef:null,
  roomMembersRef:null,
  pwaPrompt:null,
  roomId:"",
  authStateSequence:0,
  friendListenerToken:0,
  roomSetupToken:0,
  initialized:false
};

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function(c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c];
  });
}

function toast(message) {
  if (typeof window.toast === "function") {
    try { window.toast(message); return; } catch (_) {}
  }
  var wrap = document.getElementById("wtToastStack");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = "wtToastStack";
    wrap.className = "wt-toast-stack";
    document.body.appendChild(wrap);
  }
  var item = document.createElement("div");
  item.className = "wt-toast-item";
  item.textContent = String(message || "");
  wrap.appendChild(item);
  setTimeout(function(){ item.remove(); }, 3000);
}

function openModal(id) {
  var modal = $(id);
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("wt-modal-open");
}

function closeModal(id) {
  var modal = $(id);
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden","true");
  if (!document.querySelector(".wt-modal:not(.hidden)")) {
    document.body.classList.remove("wt-modal-open");
  }
}

function closeAllModals() {
  document.querySelectorAll(".wt-modal:not(.hidden)").forEach(function(modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden","true");
  });
  document.body.classList.remove("wt-modal-open");
}

function readJson(key, fallback) {
  try {
    var value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function roomIdFromUrl() {
  var value = new URLSearchParams(location.search).get("room") || "";
  value = value.trim().toUpperCase();
  return ROOM_RE.test(value) ? value : "";
}

function roomLink(id) {
  return location.origin + location.pathname + "?room=" + encodeURIComponent(id);
}

function randomCode(length, alphabet) {
  alphabet = alphabet || "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  var values = new Uint32Array(length);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(values);
  } else {
    for (var i=0;i<length;i++) values[i] = Math.floor(Math.random() * 4294967295);
  }
  var result = "";
  for (var j=0;j<length;j++) result += alphabet[values[j] % alphabet.length];
  return result;
}

function formatDate(value) {
  var date = new Date(Number(value) || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
  return date.toLocaleString("zh-TW", {
    year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"
  });
}

function currentName() {
  var local = String(localStorage.getItem("wt_name") || "").trim();
  if (local) return local.slice(0,30);
  if (state.profile && state.profile.displayName) return String(state.profile.displayName).slice(0,30);
  if (state.user && state.user.displayName) return String(state.user.displayName).slice(0,30);
  return "玩家";
}

function currentAvatar() {
  return String(state.profile && state.profile.avatarEmoji || "🙂").slice(0,4) || "🙂";
}

function serverTs() {
  return firebase.database.ServerValue.TIMESTAMP;
}

function applyTheme(theme) {
  if (!THEMES.some(function(item){ return item.id === theme; })) theme = "aurora";
  document.body.dataset.wtTheme = theme;
  localStorage.setItem(KEYS.theme, theme);
  document.documentElement.style.colorScheme = theme === "paper" ? "light" : "dark";
  document.querySelectorAll(".wt-theme-card").forEach(function(card) {
    card.classList.toggle("active", card.dataset.theme === theme);
  });
}

function currentTheme() {
  return state.profile && state.profile.theme || localStorage.getItem(KEYS.theme) || "aurora";
}

function recentRooms() {
  var list = readJson(KEYS.recentRooms, []);
  if (!Array.isArray(list)) return [];
  return list.filter(function(item){
    return ROOM_RE.test(String(item && item.id || "").toUpperCase());
  }).map(function(item){
    return {
      id:String(item.id).toUpperCase(),
      name:String(item.name || "一起看").slice(0,40),
      joinedAt:Number(item.joinedAt || 0)
    };
  }).sort(function(a,b){ return b.joinedAt-a.joinedAt; }).slice(0,12);
}

function rememberRoom(id, name) {
  id = String(id || "").trim().toUpperCase();
  if (!ROOM_RE.test(id)) return;
  var list = recentRooms().filter(function(item){ return item.id !== id; });
  list.unshift({id:id,name:String(name || "一起看").trim().slice(0,40) || "一起看",joinedAt:Date.now()});
  writeJson(KEYS.recentRooms, list.slice(0,12));
  renderRecentRooms();
}

function deleteRecentRoom(id) {
  writeJson(KEYS.recentRooms, recentRooms().filter(function(item){ return item.id !== String(id || "").toUpperCase(); }));
  renderRecentRooms();
}

function historyList() {
  var list = readJson(KEYS.history, []);
  return Array.isArray(list) ? list.slice(0,30) : [];
}

function videoKey(video) {
  return String(video && video.platform || "youtube") + ":" + String(video && video.id || "");
}

function favoritesMap() {
  var value = readJson(KEYS.favorites, {});
  return value && typeof value === "object" ? value : {};
}

function isFavorite(video) {
  return Boolean(favoritesMap()[videoKey(video)]);
}

function rememberVideo(video) {
  if (!video || !video.id) return;
  var item = {
    key:videoKey(video),
    id:String(video.id),
    platform:String(video.platform || "youtube"),
    title:String(video.title || "未命名影片").slice(0,200),
    thumbnail:String(video.thumbnail || "").slice(0,2000),
    channel:String(video.channel || "").slice(0,100),
    url:String(video.url || "").slice(0,2000),
    updatedAt:Date.now()
  };
  var list = historyList().filter(function(entry){ return entry.key !== item.key; });
  list.unshift(item);
  writeJson(KEYS.history, list.slice(0,30));
  renderHomeActivity();

  if (
    typeof wt.renderFavorites ===
    "function"
  ) {
    wt.renderFavorites();
  }
}

function toggleFavorite(video) {
  if (!video || !video.id) return;
  var map = favoritesMap();
  var key = videoKey(video);
  if (map[key]) {
    delete map[key];
    toast("已取消收藏");
  } else {
    map[key] = Object.assign({}, video, {key:key,updatedAt:Date.now()});
    toast("已加入收藏");
  }
  writeJson(KEYS.favorites,map);
  renderHomeActivity();
  renderFavorites();
}

function ensureTopbar() {
  var right = document.querySelector(".topbar-right");
  if (!right) return;
  if (!document.getElementById("wtFriendsBtn")) {
    var b1 = document.createElement("button");
    b1.id = "wtFriendsBtn";
    b1.className = "wt-nav-btn";
    b1.type = "button";
    b1.textContent = "👥 好友";
    b1.addEventListener("click",function(){ wt.openFriends(); });
    right.insertBefore(b1, document.getElementById("googleLoginBtn") || null);
  }
  if (!document.getElementById("wtSettingsBtn")) {
    var b2 = document.createElement("button");
    b2.id = "wtSettingsBtn";
    b2.className = "wt-nav-btn";
    b2.type = "button";
    b2.textContent = "⚙️ 設定";
    b2.addEventListener("click",function(){ wt.openSettings(); });
    right.insertBefore(b2, document.getElementById("googleLoginBtn") || null);
  }
  if (!document.getElementById("wtStatusBtn")) {
    var b3 = document.createElement("button");
    b3.id = "wtStatusBtn";
    b3.className = "wt-nav-btn";
    b3.type = "button";
    b3.textContent = "📡 狀態";
    b3.addEventListener("click",function(){ wt.openStatus(); });
    right.insertBefore(b3, document.getElementById("googleLoginBtn") || null);
  }
}

function ensureHome() {
  var home = $("homeView");
  if (!home) return;
  if (!$("wtHomeEnhancements")) {
    var section = document.createElement("section");
    section.id = "wtHomeEnhancements";
    section.className = "wt-home-panel";
    section.innerHTML =
      '<div class="wt-home-panel-header">' +
        '<div><div class="wt-panel-title">最近活動</div><div class="wt-home-subtitle">離開房間後會保留最近加入紀錄，可重新加入或刪除紀錄。</div></div>' +
        '<div class="wt-card-actions"><button class="wt-mini-btn" id="wtHomeFriends" type="button">👥 好友</button><button class="wt-mini-btn" id="wtHomeSettings" type="button">⚙️ 設定</button></div>' +
      '</div>' +
      '<div class="wt-recent-grid" id="wtRecentRooms"></div>' +
      '<div class="wt-section-title" style="margin-top:22px;"><span class="wt-panel-title" style="font-size:15px;">最近觀看</span><span class="wt-small">只保留在目前裝置。</span></div>' +
      '<div class="wt-recent-grid" id="wtHomeHistory"></div>';
    var platformPanel = home.querySelector(".platform-panel");
    home.insertBefore(section, platformPanel || home.lastElementChild);
    $("wtHomeFriends").addEventListener("click",function(){ wt.openFriends(); });
    $("wtHomeSettings").addEventListener("click",function(){ wt.openSettings(); });
  }
  renderHomeActivity();
}

function renderRecentRooms() {
  var box = $("wtRecentRooms");
  if (!box) return;
  var list = recentRooms();
  if (!list.length) {
    box.innerHTML = '<div class="wt-card-section" style="grid-column:1/-1;"><div class="wt-small">目前沒有最近房間。加入或建立房間後會顯示在這裡。</div></div>';
    return;
  }
  box.innerHTML = list.map(function(item) {
    return '<article class="wt-room-card">' +
      '<div class="wt-room-card-main">' +
        '<div class="wt-room-card-title">' + esc(item.name) + '</div>' +
        '<div class="wt-room-code">' + esc(item.id) + '</div>' +
        '<div class="wt-room-card-meta">最近加入：' + esc(formatDate(item.joinedAt)) + '</div>' +
      '</div>' +
      '<div class="wt-card-actions"><button class="wt-mini-btn primary" data-wt-rejoin="' + esc(item.id) + '" type="button">重新加入</button><button class="wt-mini-btn danger" data-wt-delete-room="' + esc(item.id) + '" type="button">刪除紀錄</button></div>' +
    '</article>';
  }).join("");
  box.querySelectorAll("[data-wt-rejoin]").forEach(function(btn){
    btn.addEventListener("click",function(){ location.href = roomLink(btn.dataset.wtRejoin); });
  });
  box.querySelectorAll("[data-wt-delete-room]").forEach(function(btn){
    btn.addEventListener("click",function(){ deleteRecentRoom(btn.dataset.wtDeleteRoom); toast("已刪除房間紀錄"); });
  });
}

function renderHomeHistory() {
  var box = $("wtHomeHistory");
  if (!box) return;
  var list = historyList().slice(0,6);
  if (!list.length) {
    box.innerHTML = '<div class="wt-card-section" style="grid-column:1/-1;"><div class="wt-small">開始播放影片後，最近觀看會顯示在這裡。</div></div>';
    return;
  }
  box.innerHTML = list.map(function(video){
    return '<article class="wt-room-card">' +
      '<div class="wt-room-card-main"><div class="wt-room-card-title">' + esc(video.title) + '</div><div class="wt-room-code" style="letter-spacing:normal;">' + esc(video.platform) + '</div><div class="wt-room-card-meta">' + esc(video.channel || "") + '</div></div>' +
      '<div class="wt-card-actions"><button class="wt-mini-btn" data-wt-history-fav="' + esc(video.key) + '" type="button">' + (isFavorite(video) ? "★ 已收藏" : "☆ 收藏") + '</button><button class="wt-mini-btn primary" data-wt-history-room="' + esc(video.key) + '" type="button">建立房間</button></div>' +
    '</article>';
  }).join("");
  box.querySelectorAll("[data-wt-history-fav]").forEach(function(btn){
    var video = list.find(function(item){ return item.key === btn.dataset.wtHistoryFav; });
    btn.addEventListener("click",function(){ toggleFavorite(video); });
  });
  box.querySelectorAll("[data-wt-history-room]").forEach(function(btn){
    var video = list.find(function(item){ return item.key === btn.dataset.wtHistoryRoom; });
    btn.addEventListener("click",function(){ void createRoomWithVideo(video); });
  });
}

function renderHomeActivity() {
  renderRecentRooms();
  renderHomeHistory();
}

async function createRoomWithVideo(video) {
  if (!video || !video.id) {
    toast("沒有可建立的影片");
    return;
  }

  if (
    !window.WT_CORE ||
    typeof window.WT_CORE.createRoomWithVideo !== "function"
  ) {
    toast("核心房間功能尚未準備完成，請稍後再試");
    return;
  }

  try {
    await window.WT_CORE.createRoomWithVideo(video);
  } catch (error) {
    toast(error && error.message || "建立房間失敗");
  }
}
function setupRoomCodeInput() {
  var input = $("joinCodeInput");
  if (!input || input.dataset.wtSixCode) return;
  input.maxLength = 6;
  input.placeholder = "例如：K7M4Q9";
  input.addEventListener("input",function(){
    input.value = String(input.value || "").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
  });
  input.dataset.wtSixCode = "1";
}



wt.applyTheme = applyTheme;
wt.currentTheme = currentTheme;
wt.rememberRoom = rememberRoom;
wt.renderHome = ensureHome;
wt.openModal = openModal;
wt.closeModal = closeModal;
wt.toast = toast;
wt.createRoomWithVideo = createRoomWithVideo;
wt.currentName = currentName;
wt.currentAvatar = currentAvatar;
wt.roomLink = roomLink;
wt.ensureTopbar = ensureTopbar;
wt.esc = esc;
wt.randomCode = randomCode;
wt.roomIdFromUrl = roomIdFromUrl;
wt.serverTs = serverTs;
wt.readJson = readJson;
wt.writeJson = writeJson;
wt.openModal = openModal;
wt.closeModal = closeModal;
wt.ROOM_RE = ROOM_RE;
wt.FRIEND_CODE_RE = FRIEND_CODE_RE;

function isCurrentAuthUser(user) {
  var current =
    wt.auth &&
    wt.auth.currentUser;

  return Boolean(
    current &&
    user &&
    String(current.uid) ===
      String(user.uid) &&
    Boolean(current.isAnonymous) ===
      Boolean(user.isAnonymous)
  );
}

wt.isCurrentAuthUser =
  isCurrentAuthUser;

wt.rememberVideo = rememberVideo;

applyTheme(currentTheme());

})();

(() => {
"use strict";
var wt = window.WT_ENHANCEMENTS;
if (!wt) return;

var $ = wt.$ || function(id){ return document.getElementById(id); };
wt.$ = $;
var toast = wt.toast;
var readJson = typeof wt.readJson === "function" ? wt.readJson : function(key, fallback) {
  try {
    var value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (_) {
    return fallback;
  }
};
var writeJson = typeof wt.writeJson === "function" ? wt.writeJson : function(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
};
var roomIdFromUrl = wt.roomIdFromUrl;
var randomCode = wt.randomCode;
var esc = wt.esc;
var openModal = wt.openModal;
var closeModal = wt.closeModal;
var serverTs = wt.serverTs;
var FRIEND_CODE_RE = wt.FRIEND_CODE_RE;
var isCurrentAuthUser = wt.isCurrentAuthUser;

async function ensurePublicCode(profile) {
  var user = wt.auth.currentUser;
  if (!user || user.isAnonymous) throw new Error("Google 登入後才能建立好友代碼");

  async function reserve(code) {
    if (!FRIEND_CODE_RE.test(code)) return false;
    try {
      var ref = wt.db.ref("profileCodes/" + code);
      var result = await ref.transaction(function(value){
        if (value === null || String(value) === String(user.uid)) {
          return user.uid;
        }
        return;
      });
      return Boolean(result.committed && String(result.snapshot.val()) === String(user.uid));
    } catch (_) {
      return false;
    }
  }

  var existing = String(profile && profile.publicCode || "").trim().toUpperCase();
  if (FRIEND_CODE_RE.test(existing) && await reserve(existing)) {
    return existing;
  }

  for (var attempt=0;attempt<64;attempt++) {
    var code = randomCode(6);
    if (await reserve(code)) {
      return code;
    }
  }

  throw new Error("好友代碼建立失敗");
}

async function loadProfile(user) {
  if (!user || user.isAnonymous) {
    wt.state.profile = null;
    wt.applyTheme(localStorage.getItem(wt.KEYS.theme) || "aurora");
    renderProfile();
    return null;
  }

  var ref = wt.db.ref("profiles/" + user.uid);
  var snapshot = await ref.once("value");
  var old = snapshot.val() || {};
  var oldCode = String(old.publicCode || "").trim().toUpperCase();
  var code = await ensurePublicCode(old);

  if (!isCurrentAuthUser(user)) {
    if (code && code !== oldCode && FRIEND_CODE_RE.test(code)) {
      try {
        var reservedRef = wt.db.ref("profileCodes/" + code);
        var reservedSnapshot = await reservedRef.once("value");
        if (String(reservedSnapshot.val() || "") === String(user.uid)) {
          await reservedRef.remove();
        }
      } catch (_) {}
    }
    return null;
  }

  var localName = String(localStorage.getItem("wt_name") || "").trim();
  var displayName = String(old.displayName || localName || user.displayName || "玩家").trim().slice(0,30) || "玩家";
  var theme = wt.THEMES.some(function(x){ return x.id === old.theme; }) ? old.theme : (localStorage.getItem(wt.KEYS.theme) || "aurora");
  var profile = {
    displayName:displayName,
    publicCode:code,
    avatarEmoji:String(old.avatarEmoji || "🙂").slice(0,4) || "🙂",
    theme:theme,
    notifications:old.notifications !== false,
    createdAt:old.createdAt || wt.serverTs(),
    updatedAt:wt.serverTs()
  };
  await ref.update(profile);

  if (!isCurrentAuthUser(user)) {
    return null;
  }

  if (oldCode && oldCode !== code) {
    try {
      var oldCodeRef = wt.db.ref("profileCodes/" + oldCode);
      var oldCodeSnapshot = await oldCodeRef.once("value");
      if (String(oldCodeSnapshot.val() || "") === String(user.uid)) {
        await oldCodeRef.remove();
      }
    } catch (_) {}
  }
  wt.state.profile = Object.assign({},old,profile);
  localStorage.setItem("wt_name",displayName);
  localStorage.setItem(wt.KEYS.notifications,profile.notifications ? "1" : "0");
  wt.applyTheme(theme);
  renderProfile();
  return wt.state.profile;
}

function isCurrentAuthUser(user) {
  var current = wt.auth.currentUser;
  return Boolean(
    current &&
    user &&
    String(current.uid) === String(user.uid) &&
    Boolean(current.isAnonymous) === Boolean(user.isAnonymous)
  );
}

function renderProfile() {
  var profile = wt.state.profile;
  var name = $("wtProfileName");
  var code = $("wtProfileCodeText");
  var avatar = $("wtProfileAvatar");
  var input = $("wtNicknameInput");
  var avatarInput = $("wtAvatarInput");
  var note = $("wtNotificationToggle");
  var hint = $("wtProfileHint");

  if (name) name.textContent = profile && profile.displayName || wt.currentName();
  if (code) code.textContent = profile && profile.publicCode ? "好友代碼：" + profile.publicCode : "訪客模式";
  if (avatar) avatar.textContent = profile && profile.avatarEmoji || wt.currentAvatar();
  if (input) input.value = profile && profile.displayName || wt.currentName();
  if (avatarInput) avatarInput.value = profile && profile.avatarEmoji || wt.currentAvatar();
  if (note) note.checked = localStorage.getItem(wt.KEYS.notifications) !== "0";
  if (hint) {
    hint.textContent = wt.state.user && !wt.state.user.isAnonymous
      ? "好友代碼可提供給朋友，不需要公開 Email。"
      : "Google 登入後才能使用好友與私聊功能。";
  }
}

function renderThemes() {
  var grid = $("wtThemeGrid");
  if (!grid) return;
  var active = wt.currentTheme();
  grid.innerHTML = wt.THEMES.map(function(theme){
    var icon = theme.id === "cyber" ? "▦" : theme.id === "paper" ? "▤" : theme.id === "terminal" ? ">" :
      theme.id === "sakura" ? "✿" : theme.id === "ocean" ? "≋" : theme.id === "sunset" ? "◒" : theme.id === "mono" ? "■" : "✦";
    return '<button class="wt-theme-card' + (active === theme.id ? ' active' : '') + '" data-wt-theme="' + esc(theme.id) + '" type="button">' +
      '<span style="font-size:20px;">' + icon + '</span>' +
      '<strong>' + esc(theme.name) + '</strong>' +
      '<span>' + esc(theme.desc) + '</span></button>';
  }).join("");

  grid.querySelectorAll("[data-wt-theme]").forEach(function(button){
    button.addEventListener("click",async function(){
      var theme = button.dataset.wtTheme;
      wt.applyTheme(theme);
      if (wt.state.user && !wt.state.user.isAnonymous) {
        await wt.db.ref("profiles/" + wt.state.user.uid).update({theme:theme,updatedAt:wt.serverTs()}).catch(function(){});
        if (wt.state.profile) wt.state.profile.theme = theme;
      }
      renderThemes();
      toast("主題已切換");
    });
  });
}

function renderFavorites() {
  var box = $("wtFavoritesList");
  if (!box) return;
  var map = readJson(wt.KEYS.favorites,{});
  var list = Object.values(map || {}).sort(function(a,b){ return Number(b.updatedAt||0)-Number(a.updatedAt||0); }).slice(0,20);
  if (!list.length) {
    box.innerHTML = '<div class="wt-small">目前沒有收藏影片。</div>';
    return;
  }
  box.innerHTML = list.map(function(video){
    return '<div class="wt-room-card"><div class="wt-room-card-main"><div class="wt-room-card-title">' + esc(video.title) + '</div><div class="wt-room-card-meta">' + esc(video.platform) + ' · ' + esc(video.channel || "") + '</div></div>' +
      '<div class="wt-card-actions"><button class="wt-mini-btn primary" data-wt-favorite-room="' + esc(video.key) + '" type="button">建立房間</button><button class="wt-mini-btn danger" data-wt-favorite-remove="' + esc(video.key) + '" type="button">取消收藏</button></div></div>';
  }).join("");

  box.querySelectorAll("[data-wt-favorite-room]").forEach(function(button){
    button.addEventListener("click",function(){
      var video = list.find(function(item){ return item.key === button.dataset.wtFavoriteRoom; });
      if (video) void wt.createRoomWithVideo(video);
    });
  });
  box.querySelectorAll("[data-wt-favorite-remove]").forEach(function(button){
    button.addEventListener("click",function(){
      var map2 = readJson(wt.KEYS.favorites,{});
      delete map2[button.dataset.wtFavoriteRemove];
      writeJson(wt.KEYS.favorites,map2);
      renderFavorites();
      wt.renderHome();
      toast("已取消收藏");
    });
  });
}

function buildSettingsModal() {
  if ($("wtSettingsModal")) return;

  var modal = document.createElement("div");
  modal.id = "wtSettingsModal";
  modal.className = "wt-modal hidden";
  modal.setAttribute("aria-hidden","true");
  modal.innerHTML =
    '<div class="wt-modal-card">' +
      '<div class="wt-modal-header"><div><div class="wt-panel-title">帳號與設定</div><div class="wt-small">個人資料、主題、通知、收藏與網站工具</div></div><button class="wt-close-btn" id="wtSettingsClose" type="button">×</button></div>' +
      '<div class="wt-settings-grid">' +
        '<section class="wt-card-section">' +
          '<div class="wt-section-title"><span class="wt-panel-title" style="font-size:15px;">個人資料</span></div>' +
          '<div class="wt-profile-head" style="margin-top:13px;"><div class="wt-avatar-lg" id="wtProfileAvatar">🙂</div><div class="wt-profile-text"><div class="wt-profile-name" id="wtProfileName">玩家</div><div class="wt-profile-code" id="wtProfileCodeText">訪客模式</div></div></div>' +
          '<div class="wt-form-row"><label for="wtNicknameInput">暱稱</label><input id="wtNicknameInput" maxlength="30" autocomplete="off"></div>' +
          '<div class="wt-form-row"><label for="wtAvatarInput">頭像 Emoji</label><input id="wtAvatarInput" maxlength="4" autocomplete="off" placeholder="🙂"></div>' +
          '<div class="wt-settings-actions"><button class="wt-action-btn primary" id="wtSaveProfileBtn" type="button">儲存個人資料</button><button class="wt-action-btn" id="wtCopyFriendCodeBtn" type="button">複製好友代碼</button></div>' +
          '<div class="wt-small" id="wtProfileHint" style="margin-top:10px;"></div>' +
        '</section>' +
        '<section class="wt-card-section">' +
          '<div class="wt-section-title"><span class="wt-panel-title" style="font-size:15px;">通知與網站</span></div>' +
          '<div class="wt-form-row"><label><input id="wtNotificationToggle" type="checkbox" style="margin-right:7px;"> 顯示好友與私聊通知</label></div>' +
          '<div class="wt-settings-actions"><button class="wt-action-btn" id="wtRequestNotificationBtn" type="button">允許瀏覽器通知</button><button class="wt-action-btn" id="wtInstallPwaBtn" type="button">安裝 WatchTogether</button></div>' +
          '<div class="wt-settings-actions"><button class="wt-action-btn" id="wtOpenStatusBtn" type="button">📡 狀態中心</button><button class="wt-action-btn" id="wtOpenReportBtn" type="button">🐛 回報問題</button></div>' +
        '</section>' +
      '</div>' +
      '<section class="wt-card-section" style="margin-top:18px;"><div class="wt-section-title"><div><div class="wt-panel-title" style="font-size:15px;">主題</div><div class="wt-small">不是只換顏色：不同主題會改變字體、卡片形狀、背景、排版氣質與陰影。</div></div></div><div class="wt-theme-grid" id="wtThemeGrid"></div></section>' +
      '<section class="wt-card-section" style="margin-top:18px;"><div class="wt-section-title"><span class="wt-panel-title" style="font-size:15px;">收藏影片</span><span class="wt-small">本機收藏</span></div><div id="wtFavoritesList" style="display:grid;gap:9px;margin-top:12px;"></div></section>' +
      '<section class="wt-card-section" style="margin-top:18px;"><div class="wt-settings-actions"><button class="wt-action-btn" id="wtOpenPrivacyBtn" type="button">隱私說明</button><button class="wt-action-btn" id="wtOpenTermsBtn" type="button">使用規範</button></div></section>' +
    '</div>';
  document.body.appendChild(modal);

  $("wtSettingsClose").addEventListener("click",function(){ wt.closeModal("wtSettingsModal"); });
  $("wtSaveProfileBtn").addEventListener("click",saveProfile);
  $("wtCopyFriendCodeBtn").addEventListener("click",copyFriendCode);
  $("wtNotificationToggle").addEventListener("change",async function(event){
    var enabled = Boolean(event.target.checked);
    localStorage.setItem(wt.KEYS.notifications,enabled ? "1" : "0");
    if (wt.state.user && !wt.state.user.isAnonymous) {
      await wt.db.ref("profiles/" + wt.state.user.uid).update({notifications:enabled,updatedAt:wt.serverTs()}).catch(function(){});
      if (wt.state.profile) wt.state.profile.notifications = enabled;
    }
  });
  $("wtRequestNotificationBtn").addEventListener("click",requestNotifications);
  $("wtInstallPwaBtn").addEventListener("click",installPwa);
  $("wtOpenStatusBtn").addEventListener("click",function(){ wt.closeModal("wtSettingsModal"); wt.openStatus(); });
  $("wtOpenReportBtn").addEventListener("click",function(){ wt.closeModal("wtSettingsModal"); wt.openReport(); });
  $("wtOpenPrivacyBtn").addEventListener("click",function(){ wt.openInfo("privacy"); });
  $("wtOpenTermsBtn").addEventListener("click",function(){ wt.openInfo("terms"); });

  renderThemes();
  renderProfile();
  renderFavorites();
}

async function saveProfile() {
  var user = wt.auth.currentUser;
  if (!user || user.isAnonymous) {
    toast("Google 登入後才能儲存公開個人資料");
    return;
  }
  var name = String($("wtNicknameInput").value || "").trim().slice(0,30);
  var avatar = String($("wtAvatarInput").value || "🙂").trim().slice(0,4) || "🙂";
  if (!name) {
    toast("暱稱不能是空白");
    return;
  }
  try { await user.updateProfile({displayName:name}); } catch (_) {}
  localStorage.setItem("wt_name",name);
  var profile = {
    displayName:name,
    avatarEmoji:avatar,
    theme:wt.currentTheme(),
    notifications:localStorage.getItem(wt.KEYS.notifications) !== "0",
    updatedAt:wt.serverTs()
  };
  await wt.db.ref("profiles/" + user.uid).update(profile);
  wt.state.profile = Object.assign({},wt.state.profile || {},profile);
  await updateCurrentRoomMember(name,avatar);
  renderProfile();
  wt.renderHome();
  toast("個人資料已更新");
}

async function updateCurrentRoomMember(name,avatar) {
  var room = roomIdFromUrl();
  var user = wt.auth.currentUser;
  if (!room || !user) return;
  var ref = wt.db.ref("members/" + room + "/" + user.uid);
  var snapshot = await ref.once("value").catch(function(){ return null; });
  if (!snapshot || !snapshot.exists()) return;
  await ref.update({name:name,avatarEmoji:avatar,lastSeen:wt.serverTs(),online:true}).catch(function(){});
}

async function copyFriendCode() {
  var code = wt.state.profile && wt.state.profile.publicCode;
  if (!code) {
    toast("Google 登入後才有好友代碼");
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
    toast("好友代碼已複製");
  } catch (_) {
    toast(code);
  }
}

async function requestNotifications() {
  if (!("Notification" in window)) {
    toast("瀏覽器不支援通知");
    return;
  }
  try {
    var permission = await Notification.requestPermission();
    if (permission === "granted") {
      localStorage.setItem(wt.KEYS.notifications,"1");
      toast("瀏覽器通知已允許");
    } else {
      localStorage.setItem(wt.KEYS.notifications,"0");
      toast("通知權限未開啟");
    }
  } catch (error) {
    toast(error && error.message || "通知設定失敗");
  }
}

async function installPwa() {
  if (wt.state.pwaPrompt) {
    wt.state.pwaPrompt.prompt();
    try { await wt.state.pwaPrompt.userChoice; } catch (_) {}
    wt.state.pwaPrompt = null;
    return;
  }
  toast("iPhone 可用 Safari 的「加入主畫面」；支援安裝的瀏覽器會在選單提供安裝。");
}

function buildInfoModal() {
  if ($("wtInfoModal")) return;
  var modal = document.createElement("div");
  modal.id = "wtInfoModal";
  modal.className = "wt-modal hidden";
  modal.setAttribute("aria-hidden","true");
  modal.innerHTML =
    '<div class="wt-modal-card narrow"><div class="wt-modal-header"><div class="wt-panel-title" id="wtInfoTitle">說明</div><button class="wt-close-btn" id="wtInfoClose" type="button">×</button></div><div id="wtInfoBody" class="wt-legal"></div></div>';
  document.body.appendChild(modal);
  $("wtInfoClose").addEventListener("click",function(){ wt.closeModal("wtInfoModal"); });
}

function openInfo(kind) {
  buildInfoModal();
  if (kind === "privacy") {
    $("wtInfoTitle").textContent = "隱私說明";
    $("wtInfoBody").innerHTML =
      "<p>Google 登入由 Firebase Authentication 管理。公開社交資料只有暱稱、頭像與好友代碼；不把 Email 顯示在好友搜尋裡。</p>" +
      "<p>最近房間、觀看紀錄、收藏、主題與通知偏好保留在目前裝置的瀏覽器中。</p>" +
      "<p>房間聊天、好友關係、好友邀請與私聊訊息由 Firebase Realtime Database 儲存，Rules 會限制存取範圍。</p>";
  } else {
    $("wtInfoTitle").textContent = "使用規範";
    $("wtInfoBody").innerHTML =
      "<p>請遵守影片來源平台的服務條款，只分享你有權觀看或分享的內容。</p>" +
      "<p>請勿使用網站進行騷擾、冒充他人、垃圾訊息或大量自動化請求。</p>" +
      "<p>不同影片平台的嵌入與同步能力可能不同，網站會依官方播放器能力處理。</p>";
  }
  wt.openModal("wtInfoModal");
}

function buildReportModal() {
  if ($("wtReportModal")) return;
  var modal = document.createElement("div");
  modal.id = "wtReportModal";
  modal.className = "wt-modal hidden";
  modal.setAttribute("aria-hidden","true");
  modal.innerHTML =
    '<div class="wt-modal-card narrow"><div class="wt-modal-header"><div><div class="wt-panel-title">回報問題</div><div class="wt-small">自動附上裝置、房間與發生時間。</div></div><button class="wt-close-btn" id="wtReportClose" type="button">×</button></div>' +
    '<div class="wt-form-row"><label for="wtReportCategory">問題類型</label><select id="wtReportCategory"><option value="playback">播放 / 同步</option><option value="search">YouTube 搜尋</option><option value="room">房間</option><option value="chat">好友 / 聊天</option><option value="account">登入 / 帳號</option><option value="ui">畫面 / 手機</option><option value="other">其他</option></select></div>' +
    '<div class="wt-form-row"><label for="wtReportDetails">問題描述</label><textarea id="wtReportDetails" maxlength="2000" placeholder="請描述問題。"></textarea></div>' +
    '<div class="wt-settings-actions"><button class="wt-action-btn" id="wtReportCancel" type="button">取消</button><button class="wt-action-btn primary" id="wtReportSend" type="button">送出回報</button></div><div class="wt-small" id="wtReportHint"></div></div>';
  document.body.appendChild(modal);
  $("wtReportClose").addEventListener("click",function(){ wt.closeModal("wtReportModal"); });
  $("wtReportCancel").addEventListener("click",function(){ wt.closeModal("wtReportModal"); });
  $("wtReportSend").addEventListener("click",sendReport);
}

async function sendReport() {
  var user = wt.auth.currentUser;
  var details = String($("wtReportDetails").value || "").trim().slice(0,2000);
  if (!details) {
    $("wtReportHint").textContent = "請先描述問題。";
    return;
  }
  try {
    await wt.db.ref("reports").push({
      uid:user && user.uid || "",
      category:String($("wtReportCategory").value || "other"),
      details:details,
      roomId:roomIdFromUrl(),
      page:location.href.slice(0,1000),
      userAgent:navigator.userAgent.slice(0,500),
      createdAt:wt.serverTs()
    });
    $("wtReportDetails").value = "";
    $("wtReportHint").textContent = "已送出問題回報。";
    toast("問題回報已送出");
    setTimeout(function(){ wt.closeModal("wtReportModal"); },500);
  } catch (error) {
    $("wtReportHint").textContent = error && error.message || "回報失敗";
  }
}

function openSettings() {
  buildSettingsModal();
  renderProfile();
  renderThemes();
  renderFavorites();
  wt.openModal("wtSettingsModal");
}

function openReport() {
  buildReportModal();
  wt.openModal("wtReportModal");
}

function setupSettingsExtras() {
  buildSettingsModal();
  buildInfoModal();
  buildReportModal();
}

wt.readJson = readJson;
wt.writeJson = writeJson;
wt.roomIdFromUrl = roomIdFromUrl;
wt.openSettings = openSettings;
wt.openReport = openReport;
wt.openInfo = openInfo;
wt.loadProfile = loadProfile;
wt.renderFavorites = renderFavorites;

})();

(() => {
"use strict";
var wt = window.WT_ENHANCEMENTS;
if (!wt) return;
var $ = wt.$;
var roomLink = wt.roomLink;
var ROOM_RE = wt.ROOM_RE;
var FRIEND_CODE_RE = wt.FRIEND_CODE_RE;

function notify(title,body) {
  if (localStorage.getItem(wt.KEYS.notifications) === "0") return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (document.visibilityState === "visible") return;
  try {
    new Notification(title,{body:body,icon:"./icon.svg",tag:"watchtogether"});
  } catch (_) {}
}

async function isLoggedUser() {
  var user = wt.auth.currentUser;
  if (!user || user.isAnonymous) {
    wt.toast("Google 登入後才能使用好友與私聊");
    return false;
  }
  return true;
}

async function isFriend(uid) {
  var user = wt.auth.currentUser;
  if (!user || user.isAnonymous || !uid) return false;
  var snapshot = await wt.db.ref("friendships/" + user.uid + "/" + uid).once("value").catch(function(){ return null; });
  return Boolean(snapshot && snapshot.exists());
}

async function addFriendByCode(code) {
  if (!(await isLoggedUser())) return;
  var user = wt.auth.currentUser;
  code = String(code || "").trim().toUpperCase();
  if (!FRIEND_CODE_RE.test(code)) throw new Error("好友代碼必須是 6 碼英數字");

  var codeSnapshot = await wt.db.ref("profileCodes/" + code).once("value");
  var targetUid = String(codeSnapshot.val() || "");
  if (!targetUid) throw new Error("找不到這個好友代碼");
  if (targetUid === user.uid) throw new Error("不能加自己為好友");

  if (await isFriend(targetUid)) throw new Error("你們已經是好友");

  var incomingRef = wt.db.ref("friendRequests/" + user.uid + "/" + targetUid);
  var incoming = await incomingRef.once("value");
  if (incoming.exists()) {
    await acceptFriend(targetUid);
    return;
  }

  var requestRef = wt.db.ref("friendRequests/" + targetUid + "/" + user.uid);
  var existing = await requestRef.once("value");
  if (existing.exists()) throw new Error("好友邀請已經送出");

  var profile = wt.state.profile || {};
  await requestRef.set({
    uid:user.uid,
    name:String(profile.displayName || wt.currentName()).slice(0,30),
    avatarEmoji:String(profile.avatarEmoji || wt.currentAvatar()).slice(0,4),
    fromName:String(profile.displayName || wt.currentName()).slice(0,30),
    fromCode:String(profile.publicCode || "").slice(0,6),
    createdAt:wt.serverTs()
  });
  wt.toast("好友邀請已送出");
}

async function acceptFriend(uid) {
  if (!(await isLoggedUser())) return;
  var user = wt.auth.currentUser;
  var requestRef = wt.db.ref("friendRequests/" + user.uid + "/" + uid);
  var request = (await requestRef.once("value")).val();
  if (!request) throw new Error("這個好友邀請已不存在");

  var updates = {};
  var since = wt.serverTs();
  updates["friendships/" + user.uid + "/" + uid] = {since:since};
  updates["friendships/" + uid + "/" + user.uid] = {since:since};
  updates["friendRequests/" + user.uid + "/" + uid] = null;
  updates["friendRequests/" + uid + "/" + user.uid] = null;
  await wt.db.ref().update(updates);
  wt.toast("已新增好友");
}

async function declineFriend(uid) {
  if (!(await isLoggedUser())) return;
  var user = wt.auth.currentUser;
  await wt.db.ref("friendRequests/" + user.uid + "/" + uid).remove();
  wt.toast("已拒絕好友邀請");
}

async function removeFriend(uid) {
  if (!(await isLoggedUser())) return;
  var user = wt.auth.currentUser;
  if (!window.confirm("確定要刪除這位好友嗎？")) return;
  var updates = {};
  updates["friendships/" + user.uid + "/" + uid] = null;
  updates["friendships/" + uid + "/" + user.uid] = null;
  updates["friendRequests/" + user.uid + "/" + uid] = null;
  updates["friendRequests/" + uid + "/" + user.uid] = null;
  await wt.db.ref().update(updates);
  if (wt.state.selectedFriendUid === uid) {
    wt.state.selectedFriendUid = "";
    wt.state.selectedFriendProfile = null;
    stopDmListener();
    renderPrivateMessages({});
    updatePrivateHeader();
  }
  wt.toast("好友已刪除");
}

async function loadFriends() {
  var user = wt.auth.currentUser;
  if (!user || user.isAnonymous) {
    wt.state.friends = {};
    renderFriends();
    return;
  }
  var snapshot = await wt.db.ref("friendships/" + user.uid).once("value").catch(function(){ return null; });
  var ids = Object.keys(snapshot && snapshot.val() || {});
  var pairs = await Promise.all(ids.map(async function(uid){
    var profile = (await wt.db.ref("profiles/" + uid).once("value").catch(function(){ return null; })).val() || {};
    return [uid,profile];
  }));
  wt.state.friends = Object.fromEntries(pairs);
  renderFriends();
}

function stopRequestListener() {
  try { wt.state.requestRef && wt.state.requestRef.off(); } catch (_) {}
  wt.state.requestRef = null;
}

function listenRequests() {
  stopRequestListener();
  var user = wt.auth.currentUser;
  if (!user || user.isAnonymous) {
    wt.state.requests = {};
    renderRequests();
    updateFriendBadge();
    return;
  }
  var ref = wt.db.ref("friendRequests/" + user.uid);
  wt.state.requestRef = ref;
  ref.on("value",function(snapshot){
    var next = snapshot.val() || {};
    var previousIds = Object.keys(wt.state.requests || {});
    wt.state.requests = next;
    renderRequests();
    Object.entries(next).forEach(function(pair){
      if (!previousIds.includes(pair[0])) {
        var request = pair[1] || {};
        void notify(
          "WatchTogether 新好友邀請",
          String(request.fromName || request.name || "有人") + " 想加你為好友"
        );
      }
    });
    updateFriendBadge();
  });
}

function updateFriendBadge() {
  var count = Object.keys(wt.state.requests || {}).length;
  var buttons = [$("wtFriendsBtn"),$("wtHomeFriends")];
  buttons.forEach(function(button){
    if (!button) return;
    button.textContent = count > 0 ? "👥 好友 · " + count : "👥 好友";
  });
}

function buildFriendsModal() {
  if ($("wtFriendsModal")) return;
  var modal = document.createElement("div");
  modal.id = "wtFriendsModal";
  modal.className = "wt-modal hidden";
  modal.setAttribute("aria-hidden","true");
  modal.innerHTML =
    '<div class="wt-modal-card">' +
      '<div class="wt-modal-header"><div><div class="wt-panel-title">好友與私聊</div><div class="wt-small">用 6 碼好友代碼加好友，私聊只允許對話雙方讀取。</div></div><button class="wt-close-btn" id="wtFriendsClose" type="button">×</button></div>' +
      '<div class="wt-card-section" style="margin-top:16px;"><div class="wt-inline"><input id="wtFriendCodeInput" class="wt-friend-search" maxlength="6" minlength="6" placeholder="輸入 6 碼好友代碼" autocomplete="off" spellcheck="false" style="max-width:360px;"><button class="wt-action-btn primary" id="wtAddFriendBtn" type="button">＋ 加好友</button><span id="wtMyFriendCode" class="wt-small"></span></div></div>' +
      '<div class="wt-friends-layout">' +
        '<aside class="wt-friends-sidebar">' +
          '<div class="wt-section-title"><span class="wt-panel-title" style="font-size:15px;">好友</span><span id="wtFriendCount" class="wt-small">0</span></div>' +
          '<div id="wtFriendsList" style="display:grid;gap:7px;margin-top:10px;"></div>' +
          '<div class="wt-section-title" style="margin-top:18px;"><span class="wt-panel-title" style="font-size:15px;">好友邀請</span></div>' +
          '<div id="wtFriendRequests" class="wt-request-list"></div>' +
        '</aside>' +
        '<section class="wt-friends-main">' +
          '<div class="wt-private-head"><div><div class="wt-panel-title" id="wtPrivateTitle" style="font-size:15px;">選擇好友開始私聊</div><div class="wt-small" id="wtPrivateSubtitle">可以傳文字或貼圖。</div></div><button class="wt-mini-btn danger" id="wtRemoveFriendBtn" type="button" disabled>刪除好友</button></div>' +
          '<div id="wtPrivateMessages" class="wt-private-messages"></div>' +
          '<form id="wtPrivateForm" class="wt-private-form"><div class="wt-room-sticker-wrap"><button id="wtPrivateStickerBtn" class="wt-mini-btn" type="button">😊</button><div id="wtPrivateStickerPicker" class="wt-sticker-picker hidden"></div></div><input id="wtPrivateInput" class="wt-private-input" maxlength="300" placeholder="傳送私訊…" autocomplete="off"><button class="wt-action-btn primary" type="submit">送出</button></form>' +
        '</section>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  $("wtFriendsClose").addEventListener("click",function(){ wt.closeModal("wtFriendsModal"); });
  $("wtAddFriendBtn").addEventListener("click",async function(){
    try {
      await addFriendByCode($("wtFriendCodeInput").value);
      $("wtFriendCodeInput").value = "";
    } catch (error) { wt.toast(error && error.message || "加好友失敗"); }
  });
  $("wtFriendCodeInput").addEventListener("input",function(event){
    event.target.value = String(event.target.value || "").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
  });
  $("wtFriendCodeInput").addEventListener("keydown",function(event){
    if (event.key === "Enter") {
      event.preventDefault();
      $("wtAddFriendBtn").click();
    }
  });
  $("wtRemoveFriendBtn").addEventListener("click",async function(){
    if (!wt.state.selectedFriendUid) return;
    try { await removeFriend(wt.state.selectedFriendUid); } catch (error) { wt.toast(error && error.message || "刪除好友失敗"); }
  });
  $("wtPrivateStickerBtn").addEventListener("click",function(event){
    event.preventDefault();
    $("wtPrivateStickerPicker").classList.toggle("hidden");
  });
  $("wtPrivateForm").addEventListener("submit",async function(event){
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      await sendPrivateText($("wtPrivateInput").value);
      $("wtPrivateInput").value = "";
    } catch (error) { wt.toast(error && error.message || "私訊送出失敗"); }
  });
  buildStickerPicker("wtPrivateStickerPicker",function(sticker){ void sendPrivateSticker(sticker); });
}

function buildStickerPicker(id,onSelect) {
  var box = $(id);
  if (!box || box.dataset.wtBuilt) return;
  box.innerHTML = wt.STICKERS.map(function(sticker){
    return '<button class="wt-sticker-btn" data-wt-sticker="' + esc(sticker) + '" type="button">' + esc(sticker) + '</button>';
  }).join("");
  box.querySelectorAll("[data-wt-sticker]").forEach(function(button){
    button.addEventListener("click",function(){ onSelect(button.dataset.wtSticker); });
  });
  box.dataset.wtBuilt = "1";
}

function renderRequests() {
  var box = $("wtFriendRequests");
  if (!box) return;
  var entries = Object.entries(wt.state.requests || {});
  if (!entries.length) {
    box.innerHTML = '<div class="wt-small">目前沒有新的好友邀請。</div>';
    return;
  }
  box.innerHTML = entries.map(function(pair){
    var uid = pair[0];
    var request = pair[1] || {};
    return '<div class="wt-request-card"><div class="wt-profile-head"><div class="wt-avatar-sm">' + esc(request.avatarEmoji || String(request.fromName || "🙂").slice(0,1)) + '</div><div class="wt-profile-text"><div class="wt-profile-name" style="font-size:13px;">' + esc(request.fromName || request.name || "玩家") + '</div><div class="wt-small">' + esc(request.fromCode || "") + '</div></div></div><div class="wt-card-actions" style="margin-top:8px;justify-content:flex-start;"><button class="wt-mini-btn primary" data-wt-accept="' + esc(uid) + '" type="button">接受</button><button class="wt-mini-btn" data-wt-decline="' + esc(uid) + '" type="button">拒絕</button></div></div>';
  }).join("");
  box.querySelectorAll("[data-wt-accept]").forEach(function(btn){
    btn.addEventListener("click",async function(){
      try { await acceptFriend(btn.dataset.wtAccept); } catch (error) { wt.toast(error && error.message || "接受邀請失敗"); }
    });
  });
  box.querySelectorAll("[data-wt-decline]").forEach(function(btn){
    btn.addEventListener("click",async function(){
      try { await declineFriend(btn.dataset.wtDecline); } catch (error) { wt.toast(error && error.message || "拒絕邀請失敗"); }
    });
  });
}

function renderFriends() {
  var box = $("wtFriendsList");
  if (!box) return;
  var entries = Object.entries(wt.state.friends || {});
  if ($("wtFriendCount")) $("wtFriendCount").textContent = String(entries.length);
  if ($("wtMyFriendCode")) $("wtMyFriendCode").textContent = wt.state.profile && wt.state.profile.publicCode ? "我的好友代碼：" + wt.state.profile.publicCode : "Google 登入後會建立好友代碼";
  if (!entries.length) {
    box.innerHTML = '<div class="wt-small">還沒有好友。把 6 碼好友代碼給朋友即可互加。</div>';
    return;
  }
  box.innerHTML = entries.map(function(pair){
    var uid = pair[0], profile = pair[1] || {};
    return '<button class="wt-friend-card' + (wt.state.selectedFriendUid === uid ? ' active' : '') + '" data-wt-friend="' + esc(uid) + '" type="button"><div class="wt-avatar-sm">' + esc(profile.avatarEmoji || String(profile.displayName || "🙂").slice(0,1)) + '</div><div class="wt-friend-info"><strong>' + esc(profile.displayName || "玩家") + '</strong><span>' + esc(profile.publicCode || "好友") + '</span></div></button>';
  }).join("");
  box.querySelectorAll("[data-wt-friend]").forEach(function(button){
    button.addEventListener("click",function(){ void selectFriend(button.dataset.wtFriend); });
  });
  updateFriendBadge();
}

function privateId(a,b) {
  return [String(a),String(b)].sort().join("_");
}

function stopDmListener() {
  try { wt.state.dmMessagesRef && wt.state.dmMessagesRef.off(); } catch (_) {}
  try { wt.state.dmReadsRef && wt.state.dmReadsRef.off(); } catch (_) {}
  wt.state.dmMessagesRef = null;
  wt.state.dmReadsRef = null;
  wt.state.dmReads = {};
  wt.state.lastDmMarkedAt = 0;
}

async function ensureConversation(friendUid) {
  var user = wt.auth.currentUser;
  if (!user || user.isAnonymous) throw new Error("Google 登入後才能私聊");
  if (!(await isFriend(friendUid))) throw new Error("只有好友可以私聊");

  var id = privateId(user.uid,friendUid);
  var ref = wt.db.ref("conversations/" + id);

  var snapshot = await ref.once("value").catch(function(){
    return null;
  });

  if (!snapshot || !snapshot.exists()) {
    var pair = [user.uid,friendUid].sort();
    var created = {
      userA:pair[0],
      userB:pair[1],
      createdAt:wt.serverTs()
    };

    try {
      await ref.set(created);
    } catch (error) {
      var retry = await ref.once("value").catch(function(){
        return null;
      });

      if (!retry || !retry.exists()) {
        throw error;
      }
    }
  }

  return id;
}

function startDmListener() {
  stopDmListener();
  var user = wt.auth.currentUser;
  var friendUid = wt.state.selectedFriendUid;
  if (!user || user.isAnonymous || !friendUid) return;
  var id = privateId(user.uid,friendUid);
  var ref = wt.db.ref("conversations/" + id + "/messages").limitToLast(100);
  var readsRef = wt.db.ref("conversations/" + id + "/reads");
  wt.state.dmMessagesRef = ref;
  wt.state.dmReadsRef = readsRef;

  readsRef.on("value",function(snapshot){
    wt.state.dmReads = snapshot.val() || {};
    renderPrivateMessages(wt.state.dmMessages || {});
  });

  ref.on("value",function(snapshot){
    var messages = snapshot.val() || {};
    wt.state.dmMessages = messages;
    renderPrivateMessages(messages);
    markDmRead(messages);

    var latest = Object.entries(messages).map(function(pair){
      return Object.assign({id:pair[0]},pair[1] || {});
    }).sort(function(a,b){
      return Number(a.createdAt||0)-Number(b.createdAt||0);
    }).pop();

    var latestKey = latest && latest.id || "";
    if (
      latest &&
      latestKey !== wt.state.lastDmMessageId &&
      String(latest.uid || "") !== String(user.uid || "") &&
      Number(latest.createdAt || 0) > Date.now() - 120000
    ) {
      notify(
        "WatchTogether 私訊",
        String(latest.name || "好友") + "： " +
        (latest.type === "sticker" ? String(latest.sticker || "貼圖") : String(latest.text || ""))
      );
    }
    if (latestKey) wt.state.lastDmMessageId = latestKey;
  });
}

function updatePrivateHeader() {
  var title = $("wtPrivateTitle");
  var subtitle = $("wtPrivateSubtitle");
  var remove = $("wtRemoveFriendBtn");
  if (!title || !subtitle) return;
  if (!wt.state.selectedFriendUid || !wt.state.selectedFriendProfile) {
    title.textContent = "選擇好友開始私聊";
    subtitle.textContent = "可以傳文字或貼圖。";
    if (remove) remove.disabled = true;
    return;
  }
  title.textContent = wt.state.selectedFriendProfile.displayName || "好友";
  subtitle.textContent = "好友代碼：" + String(wt.state.selectedFriendProfile.publicCode || "");
  if (remove) remove.disabled = false;
}

async function selectFriend(uid) {
  if (!wt.state.friends[uid]) return;

  var token =
    Number(wt.state.dmSelectionToken || 0) + 1;

  wt.state.dmSelectionToken =
    token;

  wt.state.selectedFriendUid =
    uid;

  wt.state.selectedFriendProfile =
    wt.state.friends[uid];

  stopDmListener();

  renderFriends();
  updatePrivateHeader();
  renderPrivateMessages({});

  try {
    await ensureConversation(uid);

    if (
      token !== Number(wt.state.dmSelectionToken || 0) ||
      String(wt.state.selectedFriendUid || "") !== String(uid) ||
      !wt.auth.currentUser ||
      wt.auth.currentUser.isAnonymous
    ) {
      return;
    }

    startDmListener();
  } catch (error) {
    if (
      token === Number(wt.state.dmSelectionToken || 0)
    ) {
      wt.toast(error && error.message || "私聊初始化失敗");
    }
  }
}

function markDmRead(messages) {
  var user = wt.auth.currentUser;
  var friendUid = wt.state.selectedFriendUid;
  if (!user || user.isAnonymous || !friendUid) return;
  var list = Object.values(messages || {});
  var latestIncoming = list.filter(function(item){
    return String(item.uid || "") !== String(user.uid);
  }).sort(function(a,b){
    return Number(a.createdAt || 0)-Number(b.createdAt || 0);
  }).pop();
  var timestamp = Number(latestIncoming && latestIncoming.createdAt || 0);
  if (!timestamp || timestamp <= Number(wt.state.dmReads[user.uid] || 0)) return;
  if (timestamp <= wt.state.lastDmMarkedAt) return;
  wt.state.lastDmMarkedAt = timestamp;
  var id = privateId(user.uid,friendUid);
  wt.db.ref("conversations/" + id + "/reads/" + user.uid).set(wt.serverTs()).catch(function(){});
}

function renderPrivateMessages(messages) {
  wt.state.dmMessages = messages || {};
  var box = $("wtPrivateMessages");
  if (!box) return;
  var user = wt.auth.currentUser;
  var list = Object.entries(messages || {}).map(function(pair){
    return Object.assign({id:pair[0]},pair[1] || {});
  }).sort(function(a,b){ return Number(a.createdAt||0)-Number(b.createdAt||0); });
  if (!list.length) {
    box.innerHTML = '<div class="wt-small">還沒有訊息，先打個招呼吧 👋</div>';
    return;
  }
  box.innerHTML = list.map(function(message){
    var self = String(message.uid||"") === String(user && user.uid || "");
    var body = message.type === "sticker" ? '<div class="wt-sticker">' + esc(message.sticker || "😊") + '</div>' : '<div class="wt-message-text">' + esc(message.text || "") + '</div>';
    var friendReadAt = Number(wt.state.dmReads[String(wt.state.selectedFriendUid || "")] || 0);
    var mineRead = self && friendReadAt >= Number(message.createdAt || 0) ? '<span class="wt-message-time">已讀</span>' : "";
    return '<div class="wt-message' + (self ? ' self' : '') + '"><div class="wt-message-top"><span class="wt-message-name">' + esc(message.name || "玩家") + '</span><span class="wt-message-time">' + esc(formatDate(message.createdAt)) + '</span>' + mineRead + '</div>' + body + (self ? '<button class="wt-message-delete" data-wt-dm-delete="' + esc(message.id) + '" type="button">刪除訊息</button>' : '') + '</div>';
  }).join("");
  box.querySelectorAll("[data-wt-dm-delete]").forEach(function(button){
    button.addEventListener("click",async function(){
      if (!user || !wt.state.selectedFriendUid) return;
      var id = privateId(user.uid,wt.state.selectedFriendUid);
      try { await wt.db.ref("conversations/" + id + "/messages/" + button.dataset.wtDmDelete).remove(); } catch (error) { wt.toast(error && error.message || "刪除訊息失敗"); }
    });
  });
  box.scrollTop = box.scrollHeight;
}

function formatDate(value) {
  var date = new Date(Number(value)||0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
  return date.toLocaleString("zh-TW",{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
}

async function sendPrivateText(text) {
  var user = wt.auth.currentUser;
  if (!user || user.isAnonymous || !wt.state.selectedFriendUid) throw new Error("請先登入並選擇好友");
  text = String(text || "").trim().slice(0,300);
  if (!text) return;
  var id = await ensureConversation(wt.state.selectedFriendUid);
  await wt.db.ref("conversations/" + id + "/messages").push({
    uid:user.uid,name:wt.currentName(),type:"text",text:text,createdAt:wt.serverTs()
  });
}

async function sendPrivateSticker(sticker) {
  var user = wt.auth.currentUser;
  if (!user || user.isAnonymous || !wt.state.selectedFriendUid) throw new Error("請先登入並選擇好友");
  var id = await ensureConversation(wt.state.selectedFriendUid);
  await wt.db.ref("conversations/" + id + "/messages").push({
    uid:user.uid,name:wt.currentName(),type:"sticker",sticker:String(sticker || "😊").slice(0,4),createdAt:wt.serverTs()
  });
  $("wtPrivateStickerPicker").classList.add("hidden");
}

function openFriends() {
  buildFriendsModal();
  if (!wt.auth.currentUser || wt.auth.currentUser.isAnonymous) wt.toast("Google 登入後才能使用好友功能");
  wt.openModal("wtFriendsModal");
  void loadFriends();
  listenRequests();
  renderFriends();
  renderRequests();
  updatePrivateHeader();
}

wt.isFriend = isFriend;
wt.addFriendByCode = addFriendByCode;
wt.openFriends = openFriends;
wt.renderFriends = renderFriends;
wt.listenRequests = listenRequests;
wt.stopRequestListener = stopRequestListener;
wt.stopDmListener = stopDmListener;

})();

(() => {
"use strict";
var wt = window.WT_ENHANCEMENTS;
if (!wt) return;
var $ = wt.$;

function roomId() {
  return wt.roomIdFromUrl();
}

function buildStickerPicker(id,onSelect) {
  var box = $(id);
  if (!box || box.dataset.wtBuilt) return;
  box.innerHTML = wt.STICKERS.map(function(sticker){
    return '<button class="wt-sticker-btn" data-wt-sticker="' + wt.esc(sticker) + '" type="button">' + wt.esc(sticker) + '</button>';
  }).join("");
  box.querySelectorAll("[data-wt-sticker]").forEach(function(button){
    button.addEventListener("click",function(){ onSelect(button.dataset.wtSticker); });
  });
  box.dataset.wtBuilt = "1";
}

function roomMessageList(messages) {
  return Object.entries(messages || {}).map(function(pair){
    return Object.assign({id:pair[0]},pair[1] || {});
  }).sort(function(a,b){ return Number(a.createdAt||0)-Number(b.createdAt||0); });
}

function renderRoomChat(messages) {
  var box = $("chatMessages");
  if (!box) return;
  var user = wt.auth.currentUser;
  var list = roomMessageList(messages);
  if (!list.length) {
    box.innerHTML = '<div class="wt-small" style="padding:12px;">開始聊天吧 👋</div>';
    return;
  }
  box.innerHTML = list.map(function(message){
    var self = String(message.uid||"") === String(user && user.uid || "");
    var body = message.type === "sticker"
      ? '<div class="wt-sticker">' + wt.esc(message.sticker || "😊") + '</div>'
      : '<div class="wt-message-text">' + wt.esc(message.text || "") + '</div>';
    var quick = '<div class="wt-inline" style="margin-top:6px;">' +
      '<button class="wt-message-delete" data-wt-room-delete="' + wt.esc(message.id) + '" type="button">' + (self ? "刪除訊息" : "") + '</button>' +
      '</div>';
    return '<div class="wt-message' + (self ? ' self' : '') + '"><div class="wt-message-top"><span class="wt-message-name">' + wt.esc(message.name || "玩家") + '</span><span class="wt-message-time">' + wt.esc(formatDate(message.createdAt)) + '</span></div>' + body + (self ? quick : '') + '</div>';
  }).join("");
  box.querySelectorAll("[data-wt-room-delete]").forEach(function(button){
    button.addEventListener("click",async function(){
      var currentRoom = roomId();
      if (!currentRoom) return;
      try {
        await wt.db.ref("chat/" + currentRoom + "/" + button.dataset.wtRoomDelete).remove();
      } catch (error) {
        wt.toast(error && error.message || "刪除訊息失敗");
      }
    });
  });
  box.scrollTop = box.scrollHeight;
}

function formatDate(value) {
  var date = new Date(Number(value)||0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
  return date.toLocaleString("zh-TW",{hour:"2-digit",minute:"2-digit"});
}

async function sendRoomText(text) {
  var user = wt.auth.currentUser;
  var id = roomId();
  text = String(text || "").trim().slice(0,300);
  if (!user || !id || !text) return;
  await wt.db.ref("chat/" + id).push({
    uid:user.uid,
    name:wt.currentName(),
    type:"text",
    text:text,
    createdAt:wt.serverTs()
  });
}

async function sendRoomSticker(sticker) {
  var user = wt.auth.currentUser;
  var id = roomId();
  if (!user || !id) return;
  await wt.db.ref("chat/" + id).push({
    uid:user.uid,
    name:wt.currentName(),
    type:"sticker",
    sticker:String(sticker || "😊").slice(0,4),
    createdAt:wt.serverTs()
  });
  $("wtRoomStickerPicker").classList.add("hidden");
}

function ensureRoomChat(room) {
  var form = $("chatForm");
  if (!form) return;

  if (!form.dataset.wtFormalChat) {
    var submit = form.querySelector('button[type="submit"]');
    var wrap = document.createElement("div");
    wrap.className = "wt-room-sticker-wrap";
    wrap.innerHTML = '<button id="wtRoomStickerBtn" class="wt-mini-btn" type="button" aria-label="貼圖"><span aria-hidden="true">😊</span></button><div id="wtRoomStickerPicker" class="wt-sticker-picker hidden"></div>';
    form.insertBefore(wrap,submit || null);
    $("wtRoomStickerBtn").addEventListener("click",function(event){
      event.preventDefault();
      event.stopPropagation();
      $("wtRoomStickerPicker").classList.toggle("hidden");
    });
    buildStickerPicker("wtRoomStickerPicker",function(sticker){ void sendRoomSticker(sticker); });
    form.dataset.wtFormalChat = "1";
  }
}

function ensureRoomToolbar() {
  var meta = document.querySelector(".room-meta");
  if (!meta) return;

  var items = [
    ["wtShareRoomBtn","↗ 分享",shareRoom],
    ["wtQrRoomBtn","▦ QR",openQr],
    ["wtRoomSettingsBtn","⚙ 房間設定",openRoomSettings]
  ];

  items.forEach(function(item) {
    if ($(item[0])) return;
    var button = document.createElement("button");
    button.id = item[0];
    button.className = "tiny-btn";
    button.type = "button";
    button.textContent = item[1];
    button.addEventListener("click",item[2]);
    meta.appendChild(button);
  });

  var actions = document.querySelector("#roomView .room-actions");
  if (actions && !$("wtPipBtn")) {
    var pip = document.createElement("button");
    pip.id = "wtPipBtn";
    pip.className = "secondary-btn";
    pip.type = "button";
    pip.textContent = "▣ 畫中畫";
    pip.addEventListener("click",async function() {
      var video = document.getElementById("directVideo");
      if (!(video instanceof HTMLVideoElement)) {
        toast("目前影片來源不支援畫中畫");
        return;
      }
      try {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          return;
        }
        if (!document.pictureInPictureEnabled || typeof video.requestPictureInPicture !== "function") {
          throw new Error("這個瀏覽器不支援畫中畫");
        }
        await video.requestPictureInPicture();
      } catch (error) {
        toast(error && error.message || "無法開啟畫中畫");
      }
    });
    actions.appendChild(pip);
  }
}

async function shareRoom() {
  var id = roomId();
  if (!id) return;
  var url = roomLink(id);
  try {
    if (navigator.share) {
      await navigator.share({title:$("roomTitle") && $("roomTitle").textContent || "WatchTogether",text:"加入我的 WatchTogether 房間",url:url});
      return;
    }
    await navigator.clipboard.writeText(url);
    wt.toast("房間連結已複製");
  } catch (_) {}
}

var qrPromise = null;

function loadQr() {
  if (window.QRCode && window.QRCode.toCanvas) return Promise.resolve();
  if (qrPromise) return qrPromise;
  qrPromise = new Promise(function(resolve,reject){
    var old = document.querySelector('script[data-wt-qr="1"]');
    if (old) {
      var timer = setInterval(function(){
        if (window.QRCode && window.QRCode.toCanvas) {
          clearInterval(timer);
          resolve();
        }
      },80);
      setTimeout(function(){
        clearInterval(timer);
        if (window.QRCode && window.QRCode.toCanvas) resolve();
        else reject(new Error("QR Code 載入逾時"));
      },10000);
      return;
    }
    var script = document.createElement("script");
    script.dataset.wtQr = "1";
    script.src = "https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js";
    script.async = true;
    script.onload = function(){ window.QRCode && window.QRCode.toCanvas ? resolve() : reject(new Error("QR Code 不可用")); };
    script.onerror = function(){ reject(new Error("QR Code 載入失敗")); };
    document.head.appendChild(script);
  });
  return qrPromise;
}

function buildRoomModals() {
  if (!$("wtQrModal")) {
    var qr = document.createElement("div");
    qr.id = "wtQrModal";
    qr.className = "wt-modal hidden";
    qr.setAttribute("aria-hidden","true");
    qr.innerHTML = '<div class="wt-modal-card narrow"><div class="wt-modal-header"><div><div class="wt-panel-title">加入房間</div><div class="wt-small">掃描 QR Code 或輸入 6 碼房間碼。</div></div><button class="wt-close-btn" id="wtQrClose" type="button">×</button></div><div class="wt-qr"><canvas id="wtQrCanvas" width="280" height="280"></canvas></div><div class="wt-profile-code" id="wtQrCode" style="text-align:center;"></div><div class="wt-settings-actions"><button class="wt-action-btn primary" id="wtQrCopy" type="button">複製房間連結</button></div></div>';
    document.body.appendChild(qr);
    $("wtQrClose").addEventListener("click",function(){ wt.closeModal("wtQrModal"); });
    $("wtQrCopy").addEventListener("click",shareRoom);
  }

  if (!$("wtRoomSettingsModal")) {
    var settings = document.createElement("div");
    settings.id = "wtRoomSettingsModal";
    settings.className = "wt-modal hidden";
    settings.setAttribute("aria-hidden","true");
    settings.innerHTML = '<div class="wt-modal-card narrow"><div class="wt-modal-header"><div><div class="wt-panel-title">房間設定</div><div class="wt-small">調整房間名稱、加入限制與播放權限。</div></div><button class="wt-close-btn" id="wtRoomSettingsClose" type="button">×</button></div>' +
      '<div class="wt-form-row"><label for="wtRoomSettingName">房間名稱</label><input id="wtRoomSettingName" maxlength="40" autocomplete="off"></div>' +
      '<div class="wt-form-row"><label for="wtRoomSettingMax">人數上限</label><select id="wtRoomSettingMax"><option value="2">2 人</option><option value="3">3 人</option><option value="4">4 人</option><option value="5">5 人</option><option value="6">6 人</option><option value="8">8 人</option><option value="10">10 人</option></select></div>' +
      '<div class="wt-form-row"><label><input id="wtRoomSettingLocked" type="checkbox" style="margin-right:7px;"> 鎖定房間，禁止新成員加入</label></div>' +
      '<div class="wt-form-row"><label>播放控制</label><select disabled><option>房主控制</option></select></div>' +
      '<div class="wt-small" id="wtRoomSettingHint"></div><div class="wt-settings-actions"><button class="wt-action-btn" id="wtRoomSettingsCancel" type="button">取消</button><button class="wt-action-btn primary" id="wtRoomSettingsSave" type="button">儲存</button></div></div>';
    document.body.appendChild(settings);
    $("wtRoomSettingsClose").addEventListener("click",function(){ wt.closeModal("wtRoomSettingsModal"); });
    $("wtRoomSettingsCancel").addEventListener("click",function(){ wt.closeModal("wtRoomSettingsModal"); });
    $("wtRoomSettingsSave").addEventListener("click",saveRoomSettings);
  }
}

async function openQr() {
  var id = roomId();
  if (!id) return;
  buildRoomModals();
  wt.openModal("wtQrModal");
  try {
    await loadQr();
    await window.QRCode.toCanvas($("wtQrCanvas"),roomLink(id),{width:280,margin:2});
    $("wtQrCode").textContent = id;
  } catch (error) {
    $("wtQrCode").textContent = id + "（QR 載入失敗）";
  }
}

async function openRoomSettings() {
  buildRoomModals();
  var id = roomId();
  var user = wt.auth.currentUser;
  if (!id || !user) return;
  var metaSnapshot = await wt.db.ref("roomMeta/" + id).once("value").catch(function(){ return null; });
  var roomSnapshot = await wt.db.ref("rooms/" + id + "/owner").once("value").catch(function(){ return null; });
  var meta = metaSnapshot && metaSnapshot.val();
  var actualOwner = String(roomSnapshot && roomSnapshot.val() || "");
  if (!meta || actualOwner !== String(user.uid)) {
    wt.toast("只有房主可以修改房間設定");
    return;
  }
  var settings = meta.settings || {};
  $("wtRoomSettingName").value = String(meta.name || "一起看");
  $("wtRoomSettingMax").value = String(settings.maxMembers || 2);
  $("wtRoomSettingLocked").checked = settings.locked === true;
  $("wtRoomSettingHint").textContent = "房間碼：" + id + " · 控制權限：房主";
  wt.openModal("wtRoomSettingsModal");
}

async function saveRoomSettings() {
  var id = roomId();
  var user = wt.auth.currentUser;
  if (!id || !user) return;
  var metaSnapshot = await wt.db.ref("roomMeta/" + id).once("value").catch(function(){ return null; });
  var roomSnapshot = await wt.db.ref("rooms/" + id + "/owner").once("value").catch(function(){ return null; });
  var meta = metaSnapshot && metaSnapshot.val();
  var actualOwner = String(roomSnapshot && roomSnapshot.val() || "");
  if (!meta || actualOwner !== String(user.uid)) {
    wt.toast("只有房主可以修改房間設定");
    return;
  }
  var name = String($("wtRoomSettingName").value || "").trim().slice(0,40);
  var maxMembers = Math.max(2,Math.min(10,Number($("wtRoomSettingMax").value || 2)));
  var locked = $("wtRoomSettingLocked").checked === true;
  if (!name) {
    wt.toast("房間名稱不能是空白");
    return;
  }
  var updates = {};
  updates["rooms/" + id + "/name"] = name;
  updates["roomMeta/" + id + "/owner"] = user.uid;
  updates["roomMeta/" + id + "/name"] = name;
  updates["roomMeta/" + id + "/settings"] = {locked:locked,maxMembers:maxMembers,controlMode:"host"};
  try {
    await wt.db.ref().update(updates);
    if ($("roomTitle")) $("roomTitle").textContent = name;
    wt.rememberRoom(id,name);
    wt.closeModal("wtRoomSettingsModal");
    wt.toast("房間設定已更新");
  } catch (error) {
    wt.toast(error && error.message || "房間設定儲存失敗");
  }
}

function enhanceRoomMembers() {
  var list = $("memberList");
  var user = wt.auth.currentUser;
  if (!list || !user || user.isAnonymous) return;
  list.querySelectorAll(".member[data-member-uid]").forEach(function(member){
    var uid = String(member.dataset.memberUid || "");
    if (!uid || uid === user.uid || member.querySelector("[data-wt-member-friend]")) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "tiny-btn";
    button.dataset.wtMemberFriend = uid;
    button.textContent = "加好友";
    button.style.marginLeft = "6px";
    button.addEventListener("click",async function(){
      var code = String(
        member.dataset.memberPublicCode || ""
      ).trim().toUpperCase();

      if (!FRIEND_CODE_RE.test(code)) {
        wt.toast("對方目前沒有可用的好友代碼");
        return;
      }

      try {
        await wt.addFriendByCode(code);
      } catch (error) {
        wt.toast(error && error.message || "加好友失敗");
      }
    });
    member.appendChild(button);
  });
}

async function setupRoom(id) {
  if (!id) return;
  if (wt.state.roomSetupId === id) return;

  var setupToken = Number(wt.state.roomSetupToken || 0) + 1;
  wt.state.roomSetupToken = setupToken;
  wt.state.roomSetupId = id;

  buildRoomModals();
  ensureRoomToolbar();
  ensureRoomChat(id);

  var metaSnapshot = await wt.db.ref("roomMeta/" + id).once("value").catch(function(){ return null; });

  if (
    setupToken !== Number(wt.state.roomSetupToken || 0) ||
    wt.state.roomSetupId !== id ||
    roomId() !== id
  ) {
    return;
  }

  if (!metaSnapshot || !metaSnapshot.exists()) {
    if (wt.state.roomSetupId === id) wt.state.roomSetupId = "";
    return;
  }

  var meta = metaSnapshot.val() || {};
  wt.state.roomMeta = meta;
  wt.rememberRoom(id,meta.name || "一起看");

  try { wt.state.roomVideoRef && wt.state.roomVideoRef.off(); } catch (_) {}
  wt.state.roomVideoRef = wt.db.ref("rooms/" + id + "/video");
  if (
    setupToken !== Number(wt.state.roomSetupToken || 0) ||
    wt.state.roomSetupId !== id ||
    roomId() !== id
  ) {
    return;
  }

  wt.state.roomVideoRef.on("value",function(snapshot){
    if (
      setupToken !== Number(wt.state.roomSetupToken || 0) ||
      wt.state.roomSetupId !== id ||
      roomId() !== id
    ) {
      return;
    }

    var video = snapshot.val();
    if (video && video.id) wt.rememberVideo(video);
  });
}

function stopRoomEnhancements() {
  wt.state.roomSetupToken = Number(wt.state.roomSetupToken || 0) + 1;
  try { wt.state.roomChatRef && wt.state.roomChatRef.off(); } catch (_) {}
  try { wt.state.roomVideoRef && wt.state.roomVideoRef.off(); } catch (_) {}
  wt.state.roomChatRef = null;
  wt.state.roomVideoRef = null;
  wt.state.roomMeta = null;
  wt.state.roomSetupId = "";
  wt.state.roomLastObservedId = "";
  wt.state.roomLastObservedName = "";
}

function observeRoom() {
  var id = roomId();
  if (id) {
    ensureRoomToolbar();
    ensureRoomChat(id);
    enhanceRoomMembers();
  }

  if (id !== wt.state.roomId) {
    if (wt.state.roomId && !id) {
      var oldId = wt.state.roomId;
      var oldName = String($("roomTitle") && $("roomTitle").textContent || "一起看").trim();
      wt.rememberRoom(oldId,oldName || "一起看");
      wt.state.roomLastObservedId = "";
      wt.state.roomLastObservedName = "";
      stopRoomEnhancements();
    }

    wt.state.roomId = id;

    if (id) {
      wt.state.roomLastObservedId = id;
      wt.state.roomLastObservedName = "";
      void setupRoom(id);
    }
  }

  if (id) {
    var title = String($("roomTitle") && $("roomTitle").textContent || "").trim();
    if (
      title &&
      title !== "一起看" &&
      (wt.state.roomLastObservedId !== id || wt.state.roomLastObservedName !== title)
    ) {
      wt.state.roomLastObservedId = id;
      wt.state.roomLastObservedName = title;
      wt.rememberRoom(id,title);
    }
  } else {
    wt.renderHome();
  }
}

wt.openQr = openQr;
wt.openRoomSettings = openRoomSettings;
wt.observeRoom = observeRoom;
wt.setupRoom = setupRoom;
wt.renderRoomChat = renderRoomChat;
wt.sendRoomSticker = sendRoomSticker;
wt.enhanceRoomMembers = enhanceRoomMembers;

})();

(() => {
"use strict";
var wt = window.WT_ENHANCEMENTS;
if (!wt) return;
var $ = wt.$;

function buildStatusModal() {
  if ($("wtStatusModal")) return;
  var modal = document.createElement("div");
  modal.id = "wtStatusModal";
  modal.className = "wt-modal hidden";
  modal.setAttribute("aria-hidden","true");
  modal.innerHTML =
    '<div class="wt-modal-card narrow"><div class="wt-modal-header"><div><div class="wt-panel-title">系統狀態</div><div class="wt-small">網站服務與目前裝置狀態</div></div><button class="wt-close-btn" id="wtStatusClose" type="button">×</button></div>' +
    '<div class="wt-status-grid" id="wtStatusGrid"></div>' +
    '<div class="wt-settings-actions"><button class="wt-action-btn primary" id="wtStatusRefresh" type="button">重新檢查</button></div></div>';
  document.body.appendChild(modal);
  $("wtStatusClose").addEventListener("click",function(){ wt.closeModal("wtStatusModal"); });
  $("wtStatusRefresh").addEventListener("click",runStatusChecks);
}

function statusRow(label,id) {
  return '<div class="wt-status-row"><span>' + wt.esc(label) + '</span><strong id="' + id + '" class="wt-status-warn">檢查中…</strong></div>';
}

function setStatus(id,textValue,className) {
  var el = $(id);
  if (!el) return;
  el.textContent = textValue;
  el.className = className;
}

async function ping(url) {
  var controller = new AbortController();
  var timer = setTimeout(function(){ controller.abort(); },6000);
  try {
    return await fetch(url,{method:"GET",cache:"no-store",credentials:"omit",signal:controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

async function runStatusChecks() {
  buildStatusModal();
  var box = $("wtStatusGrid");
  if (!box) return;
  box.innerHTML =
    statusRow("網站","wtStatSite") +
    statusRow("Firebase","wtStatFirebase") +
    statusRow("YouTube Proxy","wtStatProxy") +
    statusRow("Service Worker","wtStatSw") +
    statusRow("通知","wtStatNotification") +
    statusRow("登入","wtStatAuth");

  setStatus("wtStatSite","🟢 正常","wt-status-good");

  wt.db.ref(".info/connected").once("value").then(function(snapshot){
    setStatus("wtStatFirebase",snapshot.val() === true ? "🟢 Online" : "🟡 尚未連線",snapshot.val() === true ? "wt-status-good" : "wt-status-warn");
  }).catch(function(){ setStatus("wtStatFirebase","🔴 失敗","wt-status-bad"); });

  var config = window.WATCHTOGETHER_CONFIG || {};
  var proxy = String(config.youtubeSearchProxyUrl || "").replace(/\/search\/?$/,"/health");
  if (!proxy) {
    setStatus("wtStatProxy","🟡 未設定","wt-status-warn");
  } else {
    ping(proxy).then(function(response){
      setStatus("wtStatProxy",response.ok ? "🟢 Online" : "🟡 HTTP " + response.status,response.ok ? "wt-status-good" : "wt-status-warn");
    }).catch(function(){ setStatus("wtStatProxy","🟡 尚未回應","wt-status-warn"); });
  }

  setStatus("wtStatSw",navigator.serviceWorker && navigator.serviceWorker.controller ? "🟢 已啟用" : "🟡 等待更新",navigator.serviceWorker && navigator.serviceWorker.controller ? "wt-status-good" : "wt-status-warn");

  if (!("Notification" in window)) {
    setStatus("wtStatNotification","🟡 不支援","wt-status-warn");
  } else if (Notification.permission === "granted") {
    setStatus("wtStatNotification","🟢 已允許","wt-status-good");
  } else if (Notification.permission === "denied") {
    setStatus("wtStatNotification","🔴 已拒絕","wt-status-bad");
  } else {
    setStatus("wtStatNotification","🟡 未設定","wt-status-warn");
  }

  var user = wt.auth.currentUser;
  setStatus("wtStatAuth",user ? (user.isAnonymous ? "🟢 訪客" : "🟢 Google") : "🔴 未登入",user ? "wt-status-good" : "wt-status-bad");
}

function openStatus() {
  buildStatusModal();
  wt.openModal("wtStatusModal");
  void runStatusChecks();
}

function installListener() {
  window.addEventListener("beforeinstallprompt",function(event){
    event.preventDefault();
    wt.state.pwaPrompt = event;
    if ($("wtInstallPwaBtn")) $("wtInstallPwaBtn").disabled = false;
  });
  window.addEventListener("appinstalled",function(){
    wt.state.pwaPrompt = null;
    wt.toast("WatchTogether 已安裝");
  });
}

async function installPwa() {
  if (wt.state.pwaPrompt) {
    wt.state.pwaPrompt.prompt();
    try { await wt.state.pwaPrompt.userChoice; } catch (_) {}
    wt.state.pwaPrompt = null;
    return;
  }
  wt.toast("iPhone 可用 Safari 的「加入主畫面」；Android / Chrome 支援時可從瀏覽器選單安裝。");
}

function setupStickerOutsideClick() {
  document.addEventListener("click",function(event){
    document.querySelectorAll(".wt-sticker-picker:not(.hidden)").forEach(function(picker){
      var parent = picker.parentElement;
      if (!parent || !parent.contains(event.target)) picker.classList.add("hidden");
    });
  });
}

function setupFriendsLiveListener() {
  try { wt.state.friendRef && wt.state.friendRef.off(); } catch (_) {}
  wt.state.friendRef = null;
  var user = wt.auth.currentUser;
  if (!user || user.isAnonymous) {
    wt.state.friends = {};
    return;
  }
  var ref = wt.db.ref("friendships/" + user.uid);
  wt.state.friendRef = ref;
  var listenerToken = Number(wt.state.friendListenerToken || 0) + 1;
  wt.state.friendListenerToken = listenerToken;

  ref.on("value",async function(snapshot){
    var ids = Object.keys(snapshot.val() || {});
    var pairs = await Promise.all(ids.map(async function(uid){
      var p = (await wt.db.ref("profiles/" + uid).once("value").catch(function(){ return null; })).val() || {};
      return [uid,p];
    }));

    if (
      listenerToken !== Number(wt.state.friendListenerToken || 0) ||
      !isCurrentAuthUser(user)
    ) {
      return;
    }

    wt.state.friends = Object.fromEntries(pairs);
    if (typeof wt.renderFriends === "function") wt.renderFriends();
  });
}

function setupAuthListeners() {
  wt.auth.onAuthStateChanged(function(user){
    var sequence = Number(wt.state.authStateSequence || 0) + 1;
    wt.state.authStateSequence = sequence;
    wt.state.user = user || null;

    if (user && !user.isAnonymous) {
      void wt.loadProfile(user).then(function(){
        if (
          sequence !== Number(wt.state.authStateSequence || 0) ||
          !isCurrentAuthUser(user)
        ) {
          return;
        }

        wt.listenRequests();
        setupFriendsLiveListener();
        if (typeof wt.renderFriends === "function") wt.renderFriends();
      }).catch(function(error){
        if (
          sequence === Number(wt.state.authStateSequence || 0) &&
          isCurrentAuthUser(user)
        ) {
          console.warn("WatchTogether profile setup failed",error);
        }
      });
    } else {
      wt.stopDmListener &&
        wt.stopDmListener();

      if (
        typeof wt.stopRequestListener ===
        "function"
      ) {
        wt.stopRequestListener();
      }
      try { wt.state.friendRef && wt.state.friendRef.off(); } catch (_) {}
      wt.state.friendRef = null;
      wt.state.profile = null;
      wt.state.friends = {};
      wt.state.requests = {};
      wt.applyTheme(localStorage.getItem(wt.KEYS.theme) || "aurora");
    }
  });
}


function ensureAllUi() {
  if (typeof wt.renderHome === "function") wt.renderHome();
  wt.ensureTopbar();
  setupRoomCode();
  if (wt.openRoomSettings) wt.openRoomSettingsReady = true;
  if (wt.state.roomId) {
    try { wt.setupRoom(wt.state.roomId); } catch (_) {}
  }
}


function setupRoomCode() {
  var input = $("joinCodeInput");
  if (!input || input.dataset.wtSixCode) return;
  input.maxLength = 6;
  input.value = String(input.value || "").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
  input.placeholder = "輸入 6 碼房間碼";
  input.addEventListener("input",function(){
    input.value = String(input.value || "").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
  });
  input.dataset.wtSixCode = "1";
}

function setupRoomObserver() {
  if (wt.state.roomObserverTimer) return;
  wt.state.roomObserverTimer = setInterval(function(){
    try { wt.observeRoom(); } catch (error) { console.warn("Room enhancement observer",error); }
  },1000);
  setTimeout(function(){ try { wt.observeRoom(); } catch (_) {} },200);
  setTimeout(function(){ try { wt.observeRoom(); } catch (_) {} },1200);
}

function setupMain() {
  if (wt.state.initialized) return;
  wt.state.initialized = true;
  wt.ensureTopbar();
  if (typeof wt.renderHome === "function") wt.renderHome();
  setupRoomCode();
  buildStatusModal();
  if ($("wtInstallPwaBtn")) $("wtInstallPwaBtn").disabled = !wt.state.pwaPrompt;
  installListener();
  setupStickerOutsideClick();
  setupAuthListeners();
  setupRoomObserver();

  window.addEventListener("online",function(){
    if ($("authStatus")) $("authStatus").textContent = "已連線";
    wt.toast("網路已恢復，正在重新同步…");
    try { wt.observeRoom(); } catch (_) {}
  });

  window.addEventListener("offline",function(){
    if ($("authStatus")) $("authStatus").textContent = "離線";
    wt.toast("網路連線中斷");
  });

  window.addEventListener("keydown",function(event){
    var target = event.target;
    var tag = String(target && target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) return;
    if (!wt.state.roomId) return;
    if (event.code === "KeyF") {
      var btn = document.getElementById("fullscreenBtn");
      if (btn) { event.preventDefault(); btn.click(); }
    } else if (event.code === "KeyM") {
      var volume = document.getElementById("volumeInput");
      if (volume) { event.preventDefault(); volume.value = volume.value > 0 ? 0 : 1; volume.dispatchEvent(new Event("input",{bubbles:true})); }
    }
  });

  window.addEventListener("pageshow",function(){ try { wt.observeRoom(); } catch (_) {} });
  window.addEventListener("popstate",function(){ try { wt.observeRoom(); } catch (_) {} });
}

wt.openStatus = openStatus;
wt.installPwa = installPwa;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded",setupMain,{once:true});
} else {
  setupMain();
}

})();

(() => {
"use strict";
var wt = window.WT_ENHANCEMENTS;
if (!wt) return;
var $ = wt.$;
var searchTimer = null;
var searchController = null;
var searchVersion = 0;

function normalizeSearchItem(item) {
  var id = item && item.id && item.id.videoId || item && item.id || "";
  id = String(id || "").trim();
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  var snippet = item && item.snippet || {};
  return {
    id:id,
    platform:"youtube",
    title:String(snippet.title || "未命名影片"),
    thumbnail:String(snippet.thumbnails && (snippet.thumbnails.medium && snippet.thumbnails.medium.url || snippet.thumbnails.high && snippet.thumbnails.high.url || snippet.thumbnails.default && snippet.thumbnails.default.url) || ""),
    channel:String(snippet.channelTitle || "YouTube"),
    publishedAt:String(snippet.publishedAt || ""),
    viewCount:Number(item && item.viewCount || 0),
    durationSeconds:Number(item && item.durationSeconds || 0)
  };
}

function formatDuration(seconds) {
  seconds = Math.max(0,Math.floor(Number(seconds)||0));
  var h = Math.floor(seconds/3600);
  var m = Math.floor((seconds%3600)/60);
  var s = seconds%60;
  if (h > 0) return h + ":" + String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");
  return m + ":" + String(s).padStart(2,"0");
}

function renderHomeSearchMessage(text) {
  var box = $("videoSearchResults");
  if (!box) return;
  box.innerHTML = '<div class="wt-card-section"><div class="wt-small">' + wt.esc(text) + '</div></div>';
}

function renderHomeSearch(results) {
  var box = $("videoSearchResults");
  if (!box) return;
  if (!results.length) {
    renderHomeSearchMessage("找不到符合的影片。");
    return;
  }
  box.innerHTML = results.map(function(video){
    return '<button type="button" class="video-search-item" data-wt-home-video="' + wt.esc(video.id) + '" style="display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px;width:100%;margin-top:8px;padding:8px;text-align:left;">' +
      '<span style="display:block;aspect-ratio:16/9;overflow:hidden;border-radius:10px;background:#111827;">' +
        (video.thumbnail ? '<img src="' + wt.esc(video.thumbnail) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;">' : '') +
      '</span>' +
      '<span style="min-width:0;display:block;"><strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + wt.esc(video.title) + '</strong>' +
      '<small class="muted" style="display:block;margin-top:4px;">' + wt.esc(video.channel) + (video.durationSeconds ? " · " + wt.esc(formatDuration(video.durationSeconds)) : "") + '</small></span>' +
    '</button>';
  }).join("");
  box.querySelectorAll("[data-wt-home-video]").forEach(function(button){
    button.addEventListener("click",function(){
      var video = results.find(function(item){ return item.id === button.dataset.wtHomeVideo; });
      if (!video) return;
      wt.state.createVideo = video;
      var card = $("selectedVideoCard");
      if (card) card.classList.remove("hidden");
      var title = $("selectedVideoTitle");
      var meta = $("selectedVideoMeta");
      var thumb = $("selectedVideoThumbnail");
      if (title) title.textContent = video.title;
      if (meta) meta.textContent = video.channel + (video.durationSeconds ? " · " + formatDuration(video.durationSeconds) : "");
      if (thumb) {
        thumb.innerHTML = video.thumbnail ? '<img src="' + wt.esc(video.thumbnail) + '" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;">' : "";
      }
      wt.toast("已選擇影片，建立房間後會自動播放");
    });
  });
}

async function searchHome(query) {
  var config = window.WATCHTOGETHER_CONFIG || {};
  var base = String(config.youtubeSearchProxyUrl || "").replace(/\/search\/?$/,"/search");
  if (!base) throw new Error("YouTube 搜尋服務未設定");
  if (searchController) {
    try { searchController.abort(); } catch (_) {}
  }
  searchController = new AbortController();
  var version = ++searchVersion;
  var url = base + "?q=" + encodeURIComponent(query) + "&maxResults=8&regionCode=TW&relevanceLanguage=zh-Hant&safeSearch=moderate";
  var response = await fetch(url,{method:"GET",headers:{Accept:"application/json"},credentials:"omit",cache:"no-store",signal:searchController.signal});
  if (!response.ok) throw new Error("YouTube 搜尋失敗");
  var data = await response.json();
  if (version !== searchVersion) return;
  var results = Array.isArray(data.items) ? data.items.map(normalizeSearchItem).filter(Boolean) : [];
  renderHomeSearch(results);
}

function bindHomeSearch() {
  var input = $("videoSearchInput");
  var button = $("searchVideoBtn");
  var hint = $("searchHint");
  if (!input || !button || input.dataset.wtFastSearch) return;

  function getQueryHistory() {
    var list = wt.readJson("wt_search_history_v1",[]);
    if (!Array.isArray(list)) return [];
    return list.map(function(item){ return String(item || "").trim(); }).filter(function(item){ return item.length >= 2; }).slice(0,8);
  }

  function saveQuery(query) {
    query = String(query || "").trim();
    if (query.length < 2) return;
    var list = getQueryHistory().filter(function(item){ return item !== query; });
    list.unshift(query);
    wt.writeJson("wt_search_history_v1",list.slice(0,8));
    renderHistory();
  }

  function renderHistory() {
    if (!hint) return;
    var list = getQueryHistory();
    if (!list.length) {
      hint.textContent = "停止輸入約 350ms 後會自動搜尋。";
      return;
    }
    hint.innerHTML =
      '<span class="muted">最近搜尋：</span> ' +
      list.map(function(item){
        return '<button type="button" class="wt-search-history-chip" data-wt-history-query="' + wt.esc(item) + '">' + wt.esc(item) + '</button>';
      }).join(" ");
    hint.querySelectorAll("[data-wt-history-query]").forEach(function(chip){
      chip.addEventListener("click",function(){
        input.value = chip.dataset.wtHistoryQuery || "";
        void run();
      });
    });
  }

  var runSerial = 0;
  async function run() {
    var query = String(input.value || "").trim();
    if (query.length < 2) {
      renderHomeSearchMessage("輸入至少 2 個字元開始即時搜尋。");
      renderHistory();
      return;
    }

    var serial = ++runSerial;
    button.disabled = true;
    button.textContent = "搜尋中…";
    renderHomeSearchMessage("正在搜尋…");

    try {
      await searchHome(query);
      if (serial === runSerial) saveQuery(query);
    } catch (error) {
      if (error && error.name === "AbortError") return;
      if (serial === runSerial) renderHomeSearchMessage(error && error.message || "搜尋失敗");
    } finally {
      if (serial === runSerial) {
        button.disabled = false;
        button.textContent = "搜尋";
      }
    }
  }

  button.addEventListener("click",function(){ void run(); });
  input.addEventListener("keydown",function(event){
    if (event.key === "Enter") {
      event.preventDefault();
      void run();
    }
  });
  input.addEventListener("input",function(){
    clearTimeout(searchTimer);
    var value = String(input.value || "").trim();
    if (value.length < 2) {
      renderHomeSearchMessage("輸入至少 2 個字元開始即時搜尋。");
      renderHistory();
      return;
    }
    searchTimer = setTimeout(function(){ void run(); },350);
  });
  $("clearSelectedVideoBtn") && $("clearSelectedVideoBtn").addEventListener("click",function(){
    wt.state.createVideo = null;
    if ($("selectedVideoCard")) $("selectedVideoCard").classList.add("hidden");
    if ($("videoSearchInput")) $("videoSearchInput").value = "";
    if ($("videoSearchResults")) $("videoSearchResults").innerHTML = "";
    renderHistory();
  });
  input.addEventListener("focus",renderHistory);
  renderHistory();
  input.dataset.wtFastSearch = "1";

  var config = window.WATCHTOGETHER_CONFIG || {};
  var warmUrl = String(config.youtubeSearchProxyUrl || "").replace(/\/search\/?$/,"/health");
  if (warmUrl) {
    fetch(warmUrl,{method:"GET",cache:"no-store",credentials:"omit"}).catch(function(){});
  }
}

function initSearchAndCreate() {
  bindHomeSearch();
}

wt.state.createVideo = wt.state.createVideo || null;

var oldObserve = wt.observeRoom;
wt.observeRoom = function(){
  try { oldObserve(); } catch (_) {}
  initSearchAndCreate();
};

initSearchAndCreate();
})();