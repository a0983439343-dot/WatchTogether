(() => {
"use strict";
if (!window.firebase) return;

var wt = window.WT_ENHANCEMENTS = window.WT_ENHANCEMENTS || {};
var $ = function(id) { return document.getElementById(id); };
if (!firebase.apps.length && window.FIREBASE_CONFIG) {
  firebase.initializeApp(window.FIREBASE_CONFIG);
}
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
  recentRoomSelectionMode:false,
  selectedRecentRooms:{},
  historySelectionMode:false,
  selectedHistoryItems:{},
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

var showToast = toast;
wt.toast = toast;

function openModal(id) {
  var modal = $(id);
  if (!modal) return;
  modal.hidden = false;
  modal.style.removeProperty("display");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden","false");
  document.body.classList.add("wt-modal-open");
}

function closeModal(id) {
  var modal = $(id);
  if (!modal) return;
  modal.classList.add("hidden");
  modal.hidden = true;
  modal.setAttribute("aria-hidden","true");
  modal.style.setProperty("display","none","important");
  if (!document.querySelector(".wt-modal:not(.hidden)")) {
    document.body.classList.remove("wt-modal-open");
  }
}

function closeAllModals() {
  document.querySelectorAll(".wt-modal").forEach(function(modal) {
    modal.classList.add("hidden");
    modal.hidden = true;
    modal.setAttribute("aria-hidden","true");
    modal.style.setProperty("display","none","important");
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
  var user = state.user || wt.auth.currentUser || null;
  if (user && user.isAnonymous) {
    var guest = String(localStorage.getItem("wt_guest_name") || "").trim();
    if (/^訪客\d{3}$/.test(guest)) return guest;
    guest = "訪客" + Math.floor(Math.random() * 900 + 100);
    localStorage.setItem("wt_guest_name",guest);
    localStorage.removeItem("wt_name");
    return guest;
  }
  var local = String(localStorage.getItem("wt_name") || "").trim();
  if (local) return local.slice(0,30);
  if (state.profile && state.profile.displayName) return String(state.profile.displayName).slice(0,30);
  if (user && user.displayName) return String(user.displayName).slice(0,30);
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
  id = String(id || "").toUpperCase();
  delete state.selectedRecentRooms[id];
  writeJson(KEYS.recentRooms, recentRooms().filter(function(item){ return item.id !== id; }));
  if (!Object.keys(state.selectedRecentRooms).length && state.recentRoomSelectionMode) {
    state.recentRoomSelectionMode = false;
  }
  renderRecentRooms();
}

function historyList() {
  var list = readJson(KEYS.history, []);
  return Array.isArray(list) ? list.slice(0,30) : [];
}

function deleteHistoryItem(key) {
  key = String(key || "");
  if (!key) return;
  delete state.selectedHistoryItems[key];
  writeJson(KEYS.history, historyList().filter(function(item){ return String(item.key || "") !== key; }));
  if (!Object.keys(state.selectedHistoryItems).length && state.historySelectionMode) {
    state.historySelectionMode = false;
  }
  renderHomeActivity();
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

function renderFavorites() {
  var count = Object.keys(favoritesMap()).length;
  var button = document.getElementById("wtFeatureFavoritesBtn");
  if (button) {
    button.textContent = count ? "☆ 收藏 (" + count + ")" : "☆ 收藏";
  }
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
  var access = window.WT_ACCESS_CONTROL;
  if (access && access.state && access.state.ready && !access.hasPermission("favorites.manage")) {
    toast("你目前無法使用收藏功能");
    return;
  }
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

async function updateAdminButton(user) {
  var button = document.getElementById("wtAdminBtn");
  if (!button) return;
  var email = String(user && user.email || "").trim().toLowerCase();
  var configuredAdminEmail = String((window.WATCHTOGETHER_CONFIG || {}).adminEmail || "a0983439343@gmail.com").trim().toLowerCase();
  var master = Boolean(user && !user.isAnonymous && user.emailVerified === true && email === configuredAdminEmail);
  if (master) {
    button.classList.remove("hidden");
    return;
  }
  button.classList.add("hidden");
  if (!user || user.isAnonymous) return;
  try {
    var snapshot = await wt.db.ref("admin/whitelistByUid/" + user.uid).once("value");
    var item = snapshot.val();
    if (
      isCurrentAuthUser(user) &&
      item &&
      item.uid === user.uid &&
      item.enabled === true
    ) {
      button.classList.remove("hidden");
    }
  } catch (_) {
    button.classList.add("hidden");
  }
}

wt.updateAdminButton = updateAdminButton;

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
  if (!document.getElementById("wtAdminBtn")) {
    var b4 = document.createElement("button");
    b4.id = "wtAdminBtn";
    b4.className = "wt-nav-btn hidden";
    b4.type = "button";
    b4.textContent = "🛠️ 管理";
    b4.addEventListener("click",function(){ location.href = "./admin/admin.html"; });
    right.insertBefore(b4, document.getElementById("googleLoginBtn") || null);
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

function selectedRecentRoomCount() {
  return Object.keys(state.selectedRecentRooms || {}).filter(function(id){ return state.selectedRecentRooms[id] === true; }).length;
}

function selectedHistoryCount() {
  return Object.keys(state.selectedHistoryItems || {}).filter(function(key){ return state.selectedHistoryItems[key] === true; }).length;
}

function clearRecentRoomSelection() {
  state.selectedRecentRooms = {};
  state.recentRoomSelectionMode = false;
}

function clearHistorySelection() {
  state.selectedHistoryItems = {};
  state.historySelectionMode = false;
}

function toggleRecentRoomSelection(id, checked) {
  id = String(id || "").toUpperCase();
  if (!ROOM_RE.test(id)) return;
  state.selectedRecentRooms[id] = checked === true;
  if (!checked) delete state.selectedRecentRooms[id];
  renderRecentRooms();
}

function toggleHistorySelection(key, checked) {
  key = String(key || "");
  if (!key) return;
  state.selectedHistoryItems[key] = checked === true;
  if (!checked) delete state.selectedHistoryItems[key];
  renderHomeHistory();
}

function deleteSelectedRecentRooms() {
  var selected = new Set(Object.keys(state.selectedRecentRooms || {}).filter(function(id){ return state.selectedRecentRooms[id] === true; }));
  if (!selected.size) {
    toast("請先選取要刪除的房間紀錄");
    return;
  }
  writeJson(KEYS.recentRooms, recentRooms().filter(function(item){ return !selected.has(item.id); }));
  clearRecentRoomSelection();
  renderRecentRooms();
  toast("已刪除 " + selected.size + " 筆房間紀錄");
}

function deleteSelectedHistory() {
  var selected = new Set(Object.keys(state.selectedHistoryItems || {}).filter(function(key){ return state.selectedHistoryItems[key] === true; }));
  if (!selected.size) {
    toast("請先選取要刪除的影片紀錄");
    return;
  }
  writeJson(KEYS.history, historyList().filter(function(item){ return !selected.has(String(item.key || "")); }));
  clearHistorySelection();
  renderHomeHistory();
  toast("已刪除 " + selected.size + " 筆影片紀錄");
}

function toggleRecentRoomSelectionMode() {
  state.recentRoomSelectionMode = !state.recentRoomSelectionMode;
  if (!state.recentRoomSelectionMode) state.selectedRecentRooms = {};
  renderRecentRooms();
}

function toggleHistorySelectionMode() {
  state.historySelectionMode = !state.historySelectionMode;
  if (!state.historySelectionMode) state.selectedHistoryItems = {};
  renderHomeHistory();
}

function selectAllRecentRooms() {
  var list = recentRooms();
  state.selectedRecentRooms = {};
  list.forEach(function(item){ state.selectedRecentRooms[item.id] = true; });
  state.recentRoomSelectionMode = true;
  renderRecentRooms();
}

function selectAllHistoryItems() {
  var list = historyList().slice(0,6);
  state.selectedHistoryItems = {};
  list.forEach(function(item){ if (item.key) state.selectedHistoryItems[item.key] = true; });
  state.historySelectionMode = true;
  renderHomeHistory();
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
      '<div class="wt-selection-bar hidden" id="wtRecentRoomsSelectionBar"><span id="wtRecentRoomsSelectionCount">已選 0 筆</span><div class="wt-card-actions"><button class="wt-mini-btn" id="wtRecentRoomsSelectAll" type="button">全選</button><button class="wt-mini-btn danger" id="wtRecentRoomsDeleteSelected" type="button">刪除選取</button><button class="wt-mini-btn" id="wtRecentRoomsCancelSelect" type="button">取消</button></div></div>' +
      '<div class="wt-section-title wt-recent-section-title"><span class="wt-panel-title" style="font-size:15px;">最近房間</span><button class="wt-mini-btn" id="wtRecentRoomsSelectMode" type="button">選取刪除</button></div>' +
      '<div class="wt-recent-grid" id="wtRecentRooms"></div>' +
      '<div class="wt-section-title wt-recent-section-title" style="margin-top:22px;"><span><span class="wt-panel-title" style="font-size:15px;">最近觀看</span><span class="wt-small wt-section-note">只保留在目前裝置。</span></span><button class="wt-mini-btn" id="wtHistorySelectMode" type="button">選取刪除</button></div>' +
      '<div class="wt-selection-bar hidden" id="wtHistorySelectionBar"><span id="wtHistorySelectionCount">已選 0 筆</span><div class="wt-card-actions"><button class="wt-mini-btn" id="wtHistorySelectAll" type="button">全選</button><button class="wt-mini-btn danger" id="wtHistoryDeleteSelected" type="button">刪除選取</button><button class="wt-mini-btn" id="wtHistoryCancelSelect" type="button">取消</button></div></div>' +
      '<div class="wt-recent-grid" id="wtHomeHistory"></div>';
    var platformPanel = home.querySelector(".platform-panel");
    home.insertBefore(section, platformPanel || home.lastElementChild);
    $("wtHomeFriends").addEventListener("click",function(){ wt.openFriends(); });
    $("wtHomeSettings").addEventListener("click",function(){ wt.openSettings(); });
    $("wtRecentRoomsSelectMode").addEventListener("click",toggleRecentRoomSelectionMode);
    $("wtRecentRoomsSelectAll").addEventListener("click",selectAllRecentRooms);
    $("wtRecentRoomsDeleteSelected").addEventListener("click",deleteSelectedRecentRooms);
    $("wtRecentRoomsCancelSelect").addEventListener("click",function(){ clearRecentRoomSelection(); renderRecentRooms(); });
    $("wtHistorySelectMode").addEventListener("click",toggleHistorySelectionMode);
    $("wtHistorySelectAll").addEventListener("click",selectAllHistoryItems);
    $("wtHistoryDeleteSelected").addEventListener("click",deleteSelectedHistory);
    $("wtHistoryCancelSelect").addEventListener("click",function(){ clearHistorySelection(); renderHomeHistory(); });
  }
  renderHomeActivity();
}

function updateRecentRoomSelectionBar() {
  var bar = $("wtRecentRoomsSelectionBar");
  if (!bar) return;
  var active = state.recentRoomSelectionMode === true;
  bar.classList.toggle("hidden", !active);
  var count = selectedRecentRoomCount();
  if ($("wtRecentRoomsSelectionCount")) $("wtRecentRoomsSelectionCount").textContent = "已選 " + count + " 筆";
  var modeBtn = $("wtRecentRoomsSelectMode");
  if (modeBtn) modeBtn.textContent = active ? "完成選取" : "選取刪除";
}

function updateHistorySelectionBar() {
  var bar = $("wtHistorySelectionBar");
  if (!bar) return;
  var active = state.historySelectionMode === true;
  bar.classList.toggle("hidden", !active);
  var count = selectedHistoryCount();
  if ($("wtHistorySelectionCount")) $("wtHistorySelectionCount").textContent = "已選 " + count + " 筆";
  var modeBtn = $("wtHistorySelectMode");
  if (modeBtn) modeBtn.textContent = active ? "完成選取" : "選取刪除";
}

async function pruneInvalidRecentRooms() {
  if (state.recentRoomValidationAt && Date.now() - state.recentRoomValidationAt < 60000) return false;
  if (!firebase || !firebase.database || !auth || !auth.currentUser) return false;
  state.recentRoomValidationAt = Date.now();
  var list = recentRooms();
  if (!list.length) return false;
  var keep = [];
  var changed = false;
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    try {
      var snap = await firebase.database().ref("rooms/" + item.id).once("value");
      if (snap.exists()) keep.push(item);
      else changed = true;
    } catch (_) {
      keep.push(item);
    }
  }
  if (!changed) return false;
  writeJson(KEYS.recentRooms, keep);
  return true;
}

function renderRecentRooms() {
  var box = $("wtRecentRooms");
  if (!box) return;
  var list = recentRooms();
  updateRecentRoomSelectionBar();
  void pruneInvalidRecentRooms().then(function(changed){
    if (changed && $("wtRecentRooms")) renderRecentRooms();
  });
  if (!list.length) {
    box.innerHTML = '<div class="wt-card-section" style="grid-column:1/-1;"><div class="wt-small">目前沒有最近房間。加入或建立房間後會顯示在這裡。</div></div>';
    return;
  }
  box.innerHTML = list.map(function(item) {
    var selected = state.selectedRecentRooms[item.id] === true;
    return '<article class="wt-room-card' + (selected ? ' wt-selection-active' : '') + '">' +
      '<div class="wt-room-card-main">' +
        '<div class="wt-selection-check' + (state.recentRoomSelectionMode ? '' : ' hidden') + '"><label><input type="checkbox" data-wt-room-select="' + esc(item.id) + '"' + (selected ? ' checked' : '') + '><span>選取刪除</span></label></div>' +
        '<div class="wt-room-card-title">' + esc(item.name) + '</div>' +
        '<div class="wt-room-code">' + esc(item.id) + '</div>' +
        '<div class="wt-room-card-meta">最近加入：' + esc(formatDate(item.joinedAt)) + '</div>' +
      '</div>' +
      '<div class="wt-card-actions' + (state.recentRoomSelectionMode ? ' wt-selection-actions' : '') + '"><button class="wt-mini-btn primary" data-wt-rejoin="' + esc(item.id) + '" type="button">重新加入</button><button class="wt-mini-btn danger" data-wt-delete-room="' + esc(item.id) + '" type="button">刪除紀錄</button></div>' +
    '</article>';
  }).join("");
  box.querySelectorAll("[data-wt-room-select]").forEach(function(input){
    input.addEventListener("change",function(){ toggleRecentRoomSelection(input.dataset.wtRoomSelect,input.checked); });
  });
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
  updateHistorySelectionBar();
  if (!list.length) {
    box.innerHTML = '<div class="wt-card-section" style="grid-column:1/-1;"><div class="wt-small">開始播放影片後，最近觀看會顯示在這裡。</div></div>';
    return;
  }
  box.innerHTML = list.map(function(video){
    var selected = state.selectedHistoryItems[String(video.key || "")] === true;
    return '<article class="wt-room-card' + (selected ? ' wt-selection-active' : '') + '">' +
      '<div class="wt-room-card-main">' +
        '<div class="wt-selection-check' + (state.historySelectionMode ? '' : ' hidden') + '"><label><input type="checkbox" data-wt-history-select="' + esc(video.key) + '"' + (selected ? ' checked' : '') + '><span>選取刪除</span></label></div>' +
        '<div class="wt-room-card-title">' + esc(video.title) + '</div><div class="wt-room-code" style="letter-spacing:normal;">' + esc(video.platform) + '</div><div class="wt-room-card-meta">' + esc(video.channel || "") + '</div>' +
      '</div>' +
      '<div class="wt-card-actions' + (state.historySelectionMode ? ' wt-selection-actions' : '') + '"><button class="wt-mini-btn" data-wt-history-fav="' + esc(video.key) + '" type="button">' + (isFavorite(video) ? "★ 已收藏" : "☆ 收藏") + '</button><button class="wt-mini-btn primary" data-wt-history-room="' + esc(video.key) + '" type="button">建立房間</button><button class="wt-mini-btn danger" data-wt-history-delete="' + esc(video.key) + '" type="button">刪除</button></div>' +
    '</article>';
  }).join("");
  box.querySelectorAll("[data-wt-history-select]").forEach(function(input){
    input.addEventListener("change",function(){ toggleHistorySelection(input.dataset.wtHistorySelect,input.checked); });
  });
  box.querySelectorAll("[data-wt-history-fav]").forEach(function(btn){
    var video = list.find(function(item){ return item.key === btn.dataset.wtHistoryFav; });
    btn.addEventListener("click",function(){ toggleFavorite(video); });
  });
  box.querySelectorAll("[data-wt-history-room]").forEach(function(btn){
    var video = list.find(function(item){ return item.key === btn.dataset.wtHistoryRoom; });
    btn.addEventListener("click",function(){ void createRoomWithVideo(video); });
  });
  box.querySelectorAll("[data-wt-history-delete]").forEach(function(btn){
    btn.addEventListener("click",function(){
      deleteHistoryItem(btn.dataset.wtHistoryDelete);
      toast("已刪除最近觀看紀錄");
    });
  });
}

function renderHomeActivity() {
  renderRecentRooms();
  renderHomeHistory();
}

async function createRoomWithVideo(video) {
  var access = window.WT_ACCESS_CONTROL;
  if (access) {
    await access.waitUntilReady(2500);
    if (access.state && access.state.ready && !access.hasPermission("room.create")) {
      toast("你目前無法建立房間");
      return;
    }
  }
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
wt.updateAdminButton = updateAdminButton;
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
wt.renderFavorites = renderFavorites;

applyTheme(currentTheme());

})();

