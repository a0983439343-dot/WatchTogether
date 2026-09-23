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
var FRIEND_CODE_RE = /^[A-Z0-9]{8}$/;
var THEMES = wt.THEMES = [
  {id:"aurora",name:"Aurora",desc:"流光玻璃、柔和層次、寬鬆留白"},
  {id:"cyber",name:"Cyber Grid",desc:"網格背景、切角卡片、霓虹結構"},
  {id:"paper",name:"Paper",desc:"紙張質感、襯線字、硬邊陰影"},
  {id:"terminal",name:"Terminal",desc:"終端字體、掃描線、零圓角"},
  {id:"sakura",name:"Sakura",desc:"柔和櫻花構圖、不對稱圓角"},
  {id:"ocean",name:"Ocean",desc:"深海層次、流體光暈、海浪式分區"},
  {id:"sunset",name:"Sunset",desc:"暖夕陽、斜角卡片、編輯風構圖"},
  {id:"mono",name:"Mono",desc:"黑白硬邊、極簡排版、紙卡陰影"}
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
  roomChatRef:null,
  roomVideoRef:null,
  roomMembersRef:null,
  pwaPrompt:null,
  roomId:"",
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
  renderFavorites();
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
  var list = historyList().slice(0,8);
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
  var user = auth.currentUser;
  if (!user) throw new Error("登入狀態尚未準備完成");
  var roomId = randomCode(6);
  while ((await db.ref("roomMeta/" + roomId).once("value")).exists()) roomId = randomCode(6);
  var name = String(video && video.title || "一起看").slice(0,40);
  var room = {owner:user.uid,name:name,sourceType:String(video && video.platform || "youtube")};
  var meta = {
    owner:user.uid,
    name:name,
    settings:{locked:false,maxMembers:2,controlMode:"host"},
    createdAt:serverTs()
  };
  await db.ref("rooms/" + roomId).set(room);
  try {
    await db.ref("roomMeta/" + roomId).set(meta);
    if (video && video.id) {
      var rv = {id:String(video.id),platform:String(video.platform || "youtube"),title:String(video.title || "未命名影片"),thumbnail:String(video.thumbnail || ""),channel:String(video.channel || "")};
      if (video.url) rv.url = String(video.url);
      if (video.twitchType) rv.twitchType = String(video.twitchType);
      await db.ref("rooms/" + roomId + "/video").set(rv);
    }
  } catch (error) {
    await db.ref("rooms/" + roomId).remove().catch(function(){});
    await db.ref("roomMeta/" + roomId).remove().catch(function(){});
    throw error;
  }
  rememberRoom(roomId,name);
  location.href = roomLink(roomId);
}

async function createRoomCapture(event) {
  if (event.target !== $("createRoomBtn")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  var button = $("createRoomBtn");
  var user = auth.currentUser;
  if (!user) {
    toast("登入狀態尚未準備完成");
    return;
  }
  button.disabled = true;
  var roomName = String($("roomNameInput") && $("roomNameInput").value || "一起看").trim().slice(0,40) || "一起看";
  var sourceType = String($("sourceTypeInput") && $("sourceTypeInput").value || "youtube");
  var roomId = randomCode(6);
  while ((await db.ref("roomMeta/" + roomId).once("value")).exists()) roomId = randomCode(6);
  var room = {owner:user.uid,name:roomName,sourceType:sourceType};
  var meta = {owner:user.uid,name:roomName,settings:{locked:false,maxMembers:2,controlMode:"host"},createdAt:serverTs()};
  try {
    await db.ref("rooms/" + roomId).set(room);
    await db.ref("roomMeta/" + roomId).set(meta);
    rememberRoom(roomId,roomName);
    location.href = roomLink(roomId);
  } catch (error) {
    await db.ref("rooms/" + roomId).remove().catch(function(){});
    await db.ref("roomMeta/" + roomId).remove().catch(function(){});
    button.disabled = false;
    toast(error && error.message || "建立房間失敗");
  }
}

function setupCreateCapture() {
  var button = $("createRoomBtn");
  if (!button || button.dataset.wtCreateCapture) return;
  button.addEventListener("click",createRoomCapture,true);
  button.dataset.wtCreateCapture = "1";
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

function setupPwaListener() {
  window.addEventListener("beforeinstallprompt",function(event){
    event.preventDefault();
    state.pwaPrompt = event;
    var btn = $("wtInstallPwaBtn");
    if (btn) btn.disabled = false;
  });
  window.addEventListener("appinstalled",function(){
    state.pwaPrompt = null;
    toast("WatchTogether 已安裝");
  });
}

function rememberCurrentRoomFromDom() {
  var id = roomIdFromUrl();
  if (!id) return;
  var title = String($("roomTitle") && $("roomTitle").textContent || "").trim();
  rememberRoom(id,title && title !== "一起看" ? title : "一起看");
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

applyTheme(currentTheme());

})();