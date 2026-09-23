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

applyTheme(currentTheme());

})();

(() => {
"use strict";
var wt = window.WT_ENHANCEMENTS;
if (!wt) return;

var $ = wt.$ || function(id){ return document.getElementById(id); };
wt.$ = $;

function ensurePublicCode(profile) {
  if (profile && FRIEND_CODE_RE.test(String(profile.publicCode || "").toUpperCase())) {
    return Promise.resolve(String(profile.publicCode).toUpperCase());
  }
  return (async function(){
    for (var attempt=0;attempt<24;attempt++) {
      var code = randomCode(8);
      var ref = wt.db.ref("profileCodes/" + code);
      var result = await ref.transaction(function(value){
        return value === null ? wt.auth.currentUser.uid : value;
      });
      if (result.committed && String(result.snapshot.val()) === String(wt.auth.currentUser.uid)) {
        return code;
      }
    }
    throw new Error("好友代碼建立失敗");
  })();
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
  var code = await ensurePublicCode(old);
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
  await wt.db.ref("profileCodes/" + code).set(user.uid);
  wt.state.profile = Object.assign({},old,profile);
  localStorage.setItem("wt_name",displayName);
  localStorage.setItem(wt.KEYS.notifications,profile.notifications ? "1" : "0");
  wt.applyTheme(theme);
  renderProfile();
  return wt.state.profile;
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

  $("wtSettingsClose").addEventListener("click",function(){ closeModal("wtSettingsModal"); });
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
  $("wtOpenStatusBtn").addEventListener("click",function(){ closeModal("wtSettingsModal"); wt.openStatus(); });
  $("wtOpenReportBtn").addEventListener("click",function(){ closeModal("wtSettingsModal"); wt.openReport(); });
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
  $("wtInfoClose").addEventListener("click",function(){ closeModal("wtInfoModal"); });
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
  openModal("wtInfoModal");
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
  $("wtReportClose").addEventListener("click",function(){ closeModal("wtReportModal"); });
  $("wtReportCancel").addEventListener("click",function(){ closeModal("wtReportModal"); });
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
    setTimeout(function(){ closeModal("wtReportModal"); },500);
  } catch (error) {
    $("wtReportHint").textContent = error && error.message || "回報失敗";
  }
}

function openSettings() {
  buildSettingsModal();
  renderProfile();
  renderThemes();
  renderFavorites();
  openModal("wtSettingsModal");
}

function openReport() {
  buildReportModal();
  openModal("wtReportModal");
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