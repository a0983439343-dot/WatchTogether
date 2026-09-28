(() => {
"use strict";
const wt = window.WT_ENHANCEMENTS = window.WT_ENHANCEMENTS || {};
const core = window.WT_CORE || null;
const $ = id => document.getElementById(id);
const db = window.firebase && firebase.apps.length ? firebase.database() : null;
const auth = window.firebase && firebase.apps.length ? firebase.auth() : null;
const PREFS_KEY = "wt_preferences_v1";
const NOTIFY_KEY = "wt_notifications_v2";
const STATS_KEY = "wt_stats_v1";
const SEARCH_KEY = "wt_search_queries_v1";
const LOGIN_KEY = "wt_login_history_v1";
const seen = {};
let lastTrackedRoom = "";
let lastTrackedVideo = "";

function esc(v){return String(v == null ? "" : v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c];});}
function toast(v){try{if(typeof wt.toast==="function")return wt.toast(v);if(typeof window.toast==="function")window.toast(v);}catch(_){}}
function prefs(){var p={browserNotifications:false,friendNotifications:true,dmNotifications:true,roomNotifications:true,defaultPlatform:"youtube",compactControls:false};try{var x=JSON.parse(localStorage.getItem(PREFS_KEY)||"{}");if(x&&typeof x==="object")Object.assign(p,x);}catch(_){}return p;}
function savePrefs(p){try{localStorage.setItem(PREFS_KEY,JSON.stringify(p));}catch(_){}}
function user(){return auth && auth.currentUser || null;}
function st(){return core && core.state || {};}
function roomId(){return String(st().roomId || wt.roomIdFromUrl && wt.roomIdFromUrl() || "").toUpperCase();}
function fmtDate(v){var d=new Date(Number(v)||0);return isFinite(d.getTime())&&d.getTime()>0?d.toLocaleString("zh-TW"):"—";}
function fmtDur(v){var n=Math.max(0,Math.floor(Number(v)||0)),h=Math.floor(n/3600);n%=3600;var m=Math.floor(n/60);var s=n%60;return h?(h+" 小時 "+m+" 分"):(m?(m+" 分 "+s+" 秒"):(s+" 秒"));}
function stats(){var x={watchSeconds:0,videosStarted:0,roomsJoined:0,messagesSent:0,lastAt:0};try{Object.assign(x,JSON.parse(localStorage.getItem(STATS_KEY)||"{}")||{});}catch(_){}return x;}
function saveStats(x){var s=stats();Object.assign(s,x);try{localStorage.setItem(STATS_KEY,JSON.stringify(s));}catch(_){}}

const ROOM_FAV_KEY = "wt_room_favorites_v1";
function roomFavorites(){try{var x=JSON.parse(localStorage.getItem(ROOM_FAV_KEY)||"{}");return x&&typeof x==="object"?x:{};}catch(_){return {};}}
function saveRoomFavorites(x){try{localStorage.setItem(ROOM_FAV_KEY,JSON.stringify(x||{}));}catch(_){}}
function roomFavoriteKey(x){return String(x&& (x.id||x.roomId) || "").trim().toUpperCase();}
function isRoomFavorite(x){var k=roomFavoriteKey(x);return Boolean(k&&roomFavorites()[k]);}
function toggleRoomFavorite(x){
  var k=roomFavoriteKey(x);if(!k)return false;
  var map=roomFavorites();
  if(map[k]){delete map[k];saveRoomFavorites(map);toast("已取消房間收藏");return false;}
  map[k]={id:k,name:String(x?.name||x?.roomName||"一起看").slice(0,40),sourceType:String(x?.sourceType||"youtube").slice(0,30),owner:String(x?.owner||"").slice(0,128),savedAt:Date.now()};
  saveRoomFavorites(map);toast("已收藏房間");return true;
}
function renderRoomFavoriteButton(button,x){
  if(!button)return;
  var active=isRoomFavorite(x);
  button.textContent=active?"★":"☆";
  button.title=active?"取消房間收藏":"收藏房間";
  button.setAttribute("aria-label",button.title);
  button.dataset.roomFavorite=roomFavoriteKey(x);
}
function removeRoomFavorite(roomIdValue){var k=String(roomIdValue||"").trim().toUpperCase();if(!k)return;var map=roomFavorites();delete map[k];saveRoomFavorites(map);}


function modal(id,title,bodyHtml){
  var m=$(id);
  if(!m){
    m=document.createElement("div");m.id=id;m.className="modal hidden wt-feature-modal";m.setAttribute("aria-hidden","true");
    m.innerHTML='<div class="modal-card wt-feature-card"><div class="wt-feature-head"><div class="panel-title">'+esc(title)+'</div><button type="button" class="tiny-btn" data-close-feature="1">關閉</button></div><div id="'+id+'Body"></div></div>';
    document.body.appendChild(m);
    m.addEventListener("click",function(e){if(e.target===m)close(id);});
    m.querySelector("[data-close-feature]").addEventListener("click",function(){close(id);});
  }
  $(id+"Body").innerHTML=bodyHtml;
  m.hidden=false;m.style.removeProperty("display");m.classList.remove("hidden");m.setAttribute("aria-hidden","false");
  document.body.classList.add("wt-modal-open");
  return $(id+"Body");
}
function close(id){var m=$(id);if(!m)return;m.classList.add("hidden");m.hidden=true;m.setAttribute("aria-hidden","true");m.style.setProperty("display","none","important");if(!document.querySelector(".modal:not(.hidden)"))document.body.classList.remove("wt-modal-open");}

function injectCss(){
  if($("wtFeatureCenterStyle"))return;
  var s=document.createElement("style");s.id="wtFeatureCenterStyle";s.textContent=
".wt-feature-modal .wt-feature-card{width:min(820px,calc(100vw - 28px));max-height:88vh;overflow:auto}.wt-feature-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.wt-feature-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wt-feature-grid label{display:grid;gap:6px;font-size:12px}.wt-feature-grid .full{grid-column:1/-1}.wt-feature-grid input,.wt-feature-grid select,.wt-feature-grid textarea{width:100%;box-sizing:border-box}.wt-feature-stat-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.wt-feature-stat{padding:12px;border:1px solid rgba(148,163,184,.16);border-radius:14px;background:rgba(15,23,42,.45)}.wt-feature-stat strong{display:block;font-size:18px;margin-top:4px}.wt-feature-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px}.wt-feature-list{display:grid;gap:8px;max-height:380px;overflow:auto;margin-top:12px}.wt-feature-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border-bottom:1px solid rgba(148,163,184,.11)}.wt-feature-empty{padding:16px;text-align:center;color:#94a3b8}.wt-feature-link{word-break:break-all;padding:10px;border:1px solid rgba(148,163,184,.14);border-radius:12px}.wt-nav-wrap{position:relative;display:inline-flex}.wt-notice-dot{position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#ef4444;color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:800}@media(max-width:640px){.wt-feature-grid,.wt-feature-stat-grid{grid-template-columns:1fr}.wt-feature-grid .full{grid-column:auto}}";
  document.head.appendChild(s);
}

function ensureTopbar(){
  var r=document.querySelector(".topbar-right");if(!r)return;var anchor=$("googleLoginBtn");
  if(!$("wtFeatureSearchBtn")){var sb=document.createElement("button");sb.id="wtFeatureSearchBtn";sb.className="wt-nav-btn";sb.type="button";sb.textContent="🔎 搜尋";sb.title="站內搜尋";sb.addEventListener("click",openGlobalSearch);r.insertBefore(sb,anchor||null);}
  if(!$("wtFeatureNotificationBtn")){var w=document.createElement("span");w.className="wt-nav-wrap";w.innerHTML='<button id="wtFeatureNotificationBtn" class="wt-nav-btn" type="button" title="通知中心">🔔</button><span id="wtFeatureNotificationBadge" class="wt-notice-dot" style="display:none"></span>';w.firstElementChild.addEventListener("click",openNotifications);r.insertBefore(w,anchor||null);}
  if(!$("wtFeatureInviteBtn")){var iv=document.createElement("button");iv.id="wtFeatureInviteBtn";iv.className="wt-nav-btn";iv.type="button";iv.textContent="✉ 邀請";iv.addEventListener("click",openInvites);r.insertBefore(iv,anchor||null);}
  if(!$("wtFeatureStatsBtn")){var sc=document.createElement("button");sc.id="wtFeatureStatsBtn";sc.className="wt-nav-btn";sc.type="button";sc.textContent="📊 統計";sc.addEventListener("click",openStats);r.insertBefore(sc,anchor||null);}
  if(!$("wtFeatureFavoritesBtn")){var b=document.createElement("button");b.id="wtFeatureFavoritesBtn";b.className="wt-nav-btn";b.type="button";b.textContent="☆ 收藏";b.addEventListener("click",openFavorites);r.insertBefore(b,anchor||null);}
  if(!$("wtFeatureMyReportsBtn")){var mr=document.createElement("button");mr.id="wtFeatureMyReportsBtn";mr.className="wt-nav-btn";mr.type="button";mr.textContent="📋 我的回報";mr.addEventListener("click",openMyReports);r.insertBefore(mr,anchor||null);}
  if(!$("wtFeatureReportBtn")){var x=document.createElement("button");x.id="wtFeatureReportBtn";x.className="wt-nav-btn";x.type="button";x.textContent="🐛 回報";x.addEventListener("click",function(){openReport("other");});r.insertBefore(x,anchor||null);}
}

var notifications=[];
function loadNotifications(){try{var x=JSON.parse(localStorage.getItem(NOTIFY_KEY)||"[]");notifications=Array.isArray(x)?x.slice(0,100):[];}catch(_){notifications=[];}updateBadge();}
function saveNotifications(){notifications=notifications.slice(0,100);try{localStorage.setItem(NOTIFY_KEY,JSON.stringify(notifications));}catch(_){}updateBadge();}
function updateBadge(){var b=$("wtFeatureNotificationBadge");if(!b)return;var n=notifications.filter(function(x){return !x.read;}).length;b.textContent=n>99?"99+":String(n);b.style.display=n?"block":"none";}
function pushNotification(title,body,kind){
  var type=String(kind||"system"),p=prefs();
  if(type==="dm"&&!p.dmNotifications)return;
  if((type==="friend"||type==="friend-request")&&!p.friendNotifications)return;
  if(["room","room-invite","connection","report"].includes(type)&&!p.roomNotifications)return;
  var n={id:"n_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),title:String(title||"WatchTogether"),body:String(body||""),kind:type,createdAt:Date.now(),read:false};
  notifications.unshift(n);saveNotifications();
  if(p.browserNotifications&&"Notification" in window&&Notification.permission==="granted"&&document.visibilityState!=="visible"){try{new Notification(n.title,{body:n.body,tag:n.id});}catch(_){}}
  else if(document.visibilityState==="visible")toast(n.title+(n.body?"｜"+n.body:""));
}
function openNotifications(){
  var html='<div class="wt-feature-actions"><span class="small">最近 '+notifications.length+' 則</span><span><button id="wtNotifAll" class="tiny-btn">全部已讀</button> <button id="wtNotifClear" class="tiny-btn danger">清空</button></span></div><div class="wt-feature-list">';
  html+=notifications.length?notifications.map(function(n){return '<div class="wt-feature-row" style="'+(n.read?"":"background:rgba(59,130,246,.07);")+'"><div><strong>'+esc(n.title)+'</strong><div class="small">'+esc(n.body)+'</div><div class="small muted">'+esc(fmtDate(n.createdAt))+'</div></div>'+(n.read?'<span class="small muted">已讀</span>':'<button class="tiny-btn" data-read-notif="'+esc(n.id)+'">已讀</button>')+'</div>';}).join(""):'<div class="wt-feature-empty">目前沒有通知。</div>';
  html+='</div>';
  var body=modal("wtNotificationsModal","通知中心",html);
  body.querySelector("#wtNotifAll").onclick=function(){notifications.forEach(function(x){x.read=true;});saveNotifications();openNotifications();};
  body.querySelector("#wtNotifClear").onclick=function(){notifications=[];saveNotifications();openNotifications();};
  body.querySelectorAll("[data-read-notif]").forEach(function(b){b.onclick=function(){var x=notifications.find(function(n){return n.id===b.dataset.readNotif;});if(x)x.read=true;saveNotifications();openNotifications();};});
}

function openSettings(){
  var p=prefs(),pr=wt.state && wt.state.profile || {},s=stats(),themes=wt.THEMES||[],langs=window.WT_I18N && window.WT_I18N.languages || {},loc=window.WT_I18N && window.WT_I18N.getLocale && window.WT_I18N.getLocale() || "zh-TW";
  var html='<div class="wt-feature-stat-grid"><div class="wt-feature-stat"><span class="small muted">觀看時間</span><strong>'+esc(fmtDur(s.watchSeconds))+'</strong></div><div class="wt-feature-stat"><span class="small muted">播放影片</span><strong>'+esc(s.videosStarted)+' 部</strong></div><div class="wt-feature-stat"><span class="small muted">加入房間</span><strong>'+esc(s.roomsJoined)+' 次</strong></div></div>';
  html+='<div class="wt-feature-grid"><label>顯示名稱<input id="wtFeatureName" maxlength="30" value="'+esc(pr.displayName||wt.currentName&&wt.currentName()||"玩家")+'"></label><label>頭像 Emoji<input id="wtFeatureAvatar" maxlength="4" value="'+esc(pr.avatarEmoji||wt.currentAvatar&&wt.currentAvatar()||"🙂")+'"></label><label>使用者 ID<input id="wtFeatureCode" maxlength="6" value="'+esc(pr.publicCode||"")+'" style="text-transform:uppercase"></label><label>主題<select id="wtFeatureTheme">'+themes.map(function(t){return '<option value="'+esc(t.id)+'" '+(String(pr.theme||"aurora")===t.id?"selected":"")+'>'+esc(t.name)+'</option>';}).join("")+'</select></label><label>語言<select id="wtFeatureLang">'+Object.keys(langs).map(function(k){return '<option value="'+esc(k)+'" '+(k===loc?"selected":"")+'>'+esc(langs[k].name||k)+'</option>';}).join("")+'</select></label><label>預設平台<select id="wtFeaturePlatform"><option value="youtube" '+(p.defaultPlatform==="youtube"?"selected":"")+'>YouTube</option><option value="vimeo" '+(p.defaultPlatform==="vimeo"?"selected":"")+'>Vimeo</option><option value="dailymotion" '+(p.defaultPlatform==="dailymotion"?"selected":"")+'>Dailymotion</option><option value="twitch" '+(p.defaultPlatform==="twitch"?"selected":"")+'>Twitch</option></select></label></div>';
  html+='<div class="panel-title" style="margin-top:16px">通知與介面</div><label class="wt-feature-switch"><input id="wtFeatureBrowser" type="checkbox" '+(p.browserNotifications?"checked":"")+'> 瀏覽器通知</label><label class="wt-feature-switch"><input id="wtFeatureFriend" type="checkbox" '+(p.friendNotifications?"checked":"")+'> 好友與房間申請通知</label><label class="wt-feature-switch"><input id="wtFeatureDm" type="checkbox" '+(p.dmNotifications?"checked":"")+'> 私聊通知</label><label class="wt-feature-switch"><input id="wtFeatureRoom" type="checkbox" '+(p.roomNotifications?"checked":"")+'> 房間與系統通知</label><label class="wt-feature-switch"><input id="wtFeatureCompact" type="checkbox" '+(p.compactControls?"checked":"")+'> 緊湊控制列</label>';
  html+='<div class="wt-feature-actions" style="justify-content:flex-start"><button id="wtFeatureNotifPerm" class="tiny-btn">允許瀏覽器通知</button><button id="wtFeatureClearHistory" class="tiny-btn danger">清除觀看紀錄</button><button id="wtFeatureClearFav" class="tiny-btn danger">清除收藏</button></div><div class="wt-feature-actions"><button id="wtFeatureSave" class="primary-btn">儲存設定</button></div>';
  var body=modal("wtSettingsModal","帳號與設定",html);
  body.querySelector("#wtFeatureLang").onchange=function(e){try{window.WT_I18N&&window.WT_I18N.setLocale&&window.WT_I18N.setLocale(e.target.value);}catch(_){}};
  body.querySelector("#wtFeatureNotifPerm").onclick=function(){if(!("Notification" in window)){toast("瀏覽器不支援通知");return;}Notification.requestPermission().then(function(x){if(x==="granted")toast("瀏覽器通知已允許");openSettings();});};  body.querySelector("#wtFeatureClearHistory").onclick=function(){localStorage.removeItem("wt_watch_history_v1");localStorage.removeItem("wt_watch_history_v2");wt.renderHome&&wt.renderHome();toast("已清除觀看紀錄");};
  body.querySelector("#wtFeatureClearFav").onclick=function(){localStorage.removeItem("wt_favorites_v1");toast("已清除收藏");};
  body.querySelector("#wtFeatureSave").onclick=function(){saveSettings().catch(function(e){toast(e.message||"設定儲存失敗");});};
}
async function saveSettings(){
  var u=user();if(!u||u.isAnonymous)throw new Error("請先登入 Google 帳號");if(!db)throw new Error("Firebase 尚未準備完成");
  var pr=wt.state.profile||{},name=String($("wtFeatureName").value||"").trim().slice(0,30),avatar=String($("wtFeatureAvatar").value||"").trim().slice(0,4),code=String($("wtFeatureCode").value||"").trim().toUpperCase(),theme=String($("wtFeatureTheme").value||"aurora"),platform=String($("wtFeaturePlatform").value||"youtube");
  if(!name||!avatar)throw new Error("顯示名稱與頭像不能為空");if(!/^[A-Z0-9]{6}$/.test(code))throw new Error("使用者 ID 必須是 6 碼英數字");
  var oldCode=String(pr.publicCode||"").toUpperCase();
  if(code!==oldCode){var t=await db.ref("profileCodes/"+code).once("value");if(t.exists()&&String(t.val())!==u.uid)throw new Error("這個使用者 ID 已被使用");var tx=await db.ref("profileCodes/"+code).transaction(function(v){return v===null||String(v)===u.uid?u.uid:v;});if(String(tx.snapshot.val()||"")!==u.uid)throw new Error("使用者 ID 已被其他帳號搶先使用");}
  var updated={displayName:name,publicCode:code,avatarEmoji:avatar,theme:theme,notifications:Boolean($("wtFeatureFriend").checked||$("wtFeatureDm").checked||$("wtFeatureRoom").checked),createdAt:pr.createdAt||firebase.database.ServerValue.TIMESTAMP,updatedAt:firebase.database.ServerValue.TIMESTAMP};
  var up={};up["profiles/"+u.uid]=updated;up["profileCodes/"+code]=u.uid;up["publicUsers/"+u.uid]={displayName:name,publicCode:code,avatarEmoji:avatar,searchName:name.toLowerCase(),updatedAt:firebase.database.ServerValue.TIMESTAMP};if(oldCode&&oldCode!==code)up["profileCodes/"+oldCode]=null;await db.ref().update(up);
  wt.state.profile=Object.assign({},wt.state.profile||{},updated);wt.state.memberName=name;localStorage.setItem("wt_name",name);wt.applyTheme&&wt.applyTheme(theme);if(core&&core.updateCurrentMemberName)try{await core.updateCurrentMemberName(name);}catch(_){}
  savePrefs({browserNotifications:$("wtFeatureBrowser").checked,friendNotifications:$("wtFeatureFriend").checked,dmNotifications:$("wtFeatureDm").checked,roomNotifications:$("wtFeatureRoom").checked,defaultPlatform:platform,compactControls:$("wtFeatureCompact").checked});
  if($("sourceTypeInput"))$("sourceTypeInput").value=platform;if($("sourceTypeModal"))$("sourceTypeModal").value=platform;toast("設定已儲存");close("wtSettingsModal");
}

function openFavorites(){
  var map=wt.readJson?wt.readJson("wt_favorites_v1",{}):{},list=Object.values(map||{}).filter(Boolean);
  var rooms=Object.values(roomFavorites()).filter(Boolean).sort(function(a,b){return Number(b.savedAt||0)-Number(a.savedAt||0);});
  var body=modal("wtFavoritesModal","收藏",'<div class="wt-feature-actions" style="justify-content:flex-start"><button id="wtFavTabVideos" class="tiny-btn primary">影片</button><button id="wtFavTabRooms" class="tiny-btn">房間</button></div><div id="wtFavContent"></div>');
  var content=body.querySelector("#wtFavContent");
  function render(tab){
    body.querySelector("#wtFavTabVideos").classList.toggle("primary",tab==="videos");
    body.querySelector("#wtFavTabRooms").classList.toggle("primary",tab==="rooms");
    if(tab==="rooms"){
      content.innerHTML='<div class="small muted">房間收藏保留在目前裝置。</div><div class="wt-feature-list">'+
        (rooms.length?rooms.map(function(x){return '<div class="wt-feature-row"><div><strong>'+esc(x.name||"一起看")+'</strong><div class="small muted">'+esc(x.id||"")+'｜'+esc(x.sourceType||"youtube")+'</div></div><div class="wt-feature-actions" style="margin-top:0"><button class="tiny-btn primary" data-room-fav-join="'+esc(x.id||"")+'">加入</button><button class="tiny-btn danger" data-room-fav-delete="'+esc(x.id||"")+'">刪除</button></div></div>';}).join(""):'<div class="wt-feature-empty">目前沒有房間收藏。</div>')+
      '</div>';
      content.querySelectorAll("[data-room-fav-join]").forEach(function(b){b.onclick=function(){location.href=location.pathname+"?room="+encodeURIComponent(String(b.dataset.roomFavJoin||"").toUpperCase());};});
      content.querySelectorAll("[data-room-fav-delete]").forEach(function(b){b.onclick=function(){removeRoomFavorite(b.dataset.roomFavDelete);openFavorites();setTimeout(function(){body.querySelector("#wtFavTabRooms")?.click();},0);};});
      return;
    }
    content.innerHTML='<div class="small muted">影片收藏保留在目前裝置。</div><div class="wt-feature-list">'+
      (list.length?list.map(function(x){return '<div class="wt-feature-row"><div><strong>'+esc(x.title||"未命名影片")+'</strong><div class="small muted">'+esc(x.platform||"")+'｜'+esc(x.channel||"")+'</div></div><div class="wt-feature-actions" style="margin-top:0"><button class="tiny-btn primary" data-fav-room="'+esc(x.key||"")+'">建立房間</button><button class="tiny-btn danger" data-fav-delete="'+esc(x.key||"")+'">刪除</button></div></div>';}).join(""):'<div class="wt-feature-empty">目前沒有影片收藏。</div>')+
      '</div><div class="wt-feature-actions"><button id="wtFavClear" class="tiny-btn danger">清空影片收藏</button></div>';
    content.querySelector("#wtFavClear").onclick=function(){localStorage.removeItem("wt_favorites_v1");openFavorites();};
    content.querySelectorAll("[data-fav-delete]").forEach(function(b){b.onclick=function(){var m=wt.readJson("wt_favorites_v1",{})||{};delete m[b.dataset.favDelete];wt.writeJson("wt_favorites_v1",m);openFavorites();};});
    content.querySelectorAll("[data-fav-room]").forEach(function(b){b.onclick=async function(){var item=list.find(function(x){return String(x.key||"")===String(b.dataset.favRoom||"");});if(!item||!core||!core.createRoomWithVideo)return;try{await core.createRoomWithVideo(item);close("wtFavoritesModal");}catch(e){toast(e.message||"建立房間失敗");}};});
  }
  body.querySelector("#wtFavTabVideos").onclick=function(){render("videos");};
  body.querySelector("#wtFavTabRooms").onclick=function(){render("rooms");};
  render("videos");
}function openStats(){
  var s=stats(),fav=wt.readJson?wt.readJson("wt_favorites_v1",{}):{},lang=window.WT_I18N&&window.WT_I18N.getLocale&&window.WT_I18N.getLocale()||"zh-TW";
  var html='<div class="wt-feature-stat-grid"><div class="wt-feature-stat"><span class="small muted">觀看時間</span><strong>'+esc(fmtDur(s.watchSeconds))+'</strong></div><div class="wt-feature-stat"><span class="small muted">播放影片</span><strong>'+esc(s.videosStarted||0)+' 部</strong></div><div class="wt-feature-stat"><span class="small muted">加入房間</span><strong>'+esc(s.roomsJoined||0)+' 次</strong></div></div>';
  html+='<div class="wt-feature-list"><div class="wt-feature-row"><span>訊息數</span><strong>'+esc(s.messagesSent||0)+'</strong></div><div class="wt-feature-row"><span>收藏數</span><strong>'+esc(Object.keys(fav||{}).length)+'</strong></div><div class="wt-feature-row"><span>語言</span><strong>'+esc(lang)+'</strong></div><div class="wt-feature-row"><span>最近活動</span><strong>'+esc(fmtDate(s.lastAt))+'</strong></div></div>';
  var ps=s.platformStarts&&typeof s.platformStarts==="object"?s.platformStarts:{};
  html+='<div class="panel-title" style="margin-top:16px">平台使用次數</div><div class="wt-feature-list"><div class="wt-feature-row"><span>YouTube</span><strong>'+esc(ps.youtube||0)+'</strong></div><div class="wt-feature-row"><span>Vimeo</span><strong>'+esc(ps.vimeo||0)+'</strong></div><div class="wt-feature-row"><span>Dailymotion</span><strong>'+esc(ps.dailymotion||0)+'</strong></div><div class="wt-feature-row"><span>Twitch</span><strong>'+esc(ps.twitch||0)+'</strong></div></div>';
  modal("wtStatsModal","個人統計",html);
}


async function searchPublicUsers(query){
  var q=String(query||"").trim().toLowerCase();
  if(!q)return [];
  var matches=[];
  if(/^[a-z0-9]{6}$/i.test(q)){
    var code=(await db.ref("profileCodes/"+q.toUpperCase()).once("value").catch(function(){return null;}))?.val();
    if(code){
      var p=(await db.ref("publicUsers/"+code).once("value").catch(function(){return null;}))?.val();
      if(p)matches.push([String(code),p]);
    }
    return matches;
  }
  try{
    var end=q+String.fromCharCode(0xf8ff);
    var snap=await db.ref("publicUsers").orderByChild("searchName").startAt(q).endAt(end).limitToFirst(30).once("value");
    snap.forEach(function(child){var p=child.val();if(p&&matches.length<30)matches.push([child.key,p]);});
  }catch(_){}
  return matches;
}

async function searchPublicRooms(query){
  var q=String(query||"").trim().toLowerCase();
  if(!q)return [];
  var results=[];
  if(/^[a-z0-9]{6}$/i.test(q)){
    var exact=await db.ref("publicRooms/"+q.toUpperCase()).once("value").catch(function(){return null;});
    if(exact?.exists())results.push([q.toUpperCase(),exact.val()||{}]);
    return results;
  }
  try{
    var end=q+String.fromCharCode(0xf8ff);
    var snap=await db.ref("publicRooms").orderByChild("searchName").startAt(q).endAt(end).limitToFirst(30).once("value");
    snap.forEach(function(child){var p=child.val();if(p&&p.id&&results.length<30)results.push([child.key,p]);});
  }catch(_){}
  return results;
}

function renderGlobalSearchResults(body,query){
  var q=String(query||"").trim();
  var recent=wt.readJson?wt.readJson("wt_recent_rooms_v2",[]):[];
  if(!Array.isArray(recent))recent=[];
  recent=recent.filter(function(x){return x&&String(x.id||"").toUpperCase().includes(q.toUpperCase())||String(x.name||"").toLowerCase().includes(q.toLowerCase());}).slice(0,10);
  var recentHtml=recent.map(function(x){var fav=isRoomFavorite(x),star='<button type="button" class="tiny-btn" data-global-room-fav="'+esc(x.id||"")+'" title="'+(fav?"取消房間收藏":"收藏房間")+'">'+(fav?"★":"☆")+'</button>';return '<div class="wt-feature-row"><div><strong>'+esc(x.name||"一起看")+'</strong><div class="small muted">最近房間｜'+esc(String(x.id||"").toUpperCase())+'</div></div><div class="wt-feature-actions" style="margin-top:0">'+star+'<button class="tiny-btn primary" data-global-room="'+esc(String(x.id||""))+'">加入</button></div></div>;}).join("");
  return Promise.all([searchPublicUsers(q),searchPublicRooms(q)]).then(function(data){
    var users=data[0],rooms=data[1];
    body.innerHTML=
      '<div class="small muted">搜尋使用者與公開房間。輸入 6 碼 ID／房間碼可直接查找。</div>'+
      '<div class="panel-title" style="margin-top:14px">使用者</div>'+
      '<div class="wt-feature-list">'+
        (users.length?users.map(function(x){
          var uid=x[0],p=x[1]||{};
          return '<div class="wt-feature-row"><div style="display:flex;gap:10px;align-items:center"><span style="font-size:24px">'+esc(p.avatarEmoji||"🙂")+'</span><div><strong>'+esc(p.displayName||"玩家")+'</strong><div class="small muted">ID：'+esc(p.publicCode||"—")+'</div></div></div><button class="tiny-btn primary" data-global-add="'+esc(p.publicCode||"")+'">好友</button></div>';
        }).join(""):'<div class="wt-feature-empty">沒有找到使用者。</div>')+
      '</div>'+
      '<div class="panel-title" style="margin-top:16px">公開房間</div>'+
      '<div class="wt-feature-list">'+
        (rooms.length?rooms.map(function(x){var p=x[1]||{},fav=isRoomFavorite(p),star='<button type="button" class="tiny-btn" data-global-room-fav="'+esc(p.id||x[0])+'" title="'+(fav?"取消房間收藏":"收藏房間")+'">'+(fav?"★":"☆")+'</button>';return '<div class="wt-feature-row"><div><strong>'+esc(p.name||"一起看")+'</strong><div class="small muted">房間 '+esc(p.id||x[0])+'｜'+esc(p.sourceType||"youtube")+'</div></div><div class="wt-feature-actions" style="margin-top:0">'+star+'<button class="tiny-btn primary" data-global-public-room="'+esc(p.id||x[0])+'">加入</button></div></div>';}).join(""):'<div class="wt-feature-empty">沒有找到公開房間。</div>')+
      '</div>'+
      '<div class="panel-title" style="margin-top:16px">最近房間</div>'+
      '<div class="wt-feature-list">'+
        (recentHtml||'<div class="wt-feature-empty">沒有符合的最近房間。</div>')+
      '</div>';
    body.querySelectorAll("[data-global-add]").forEach(function(btn){
      btn.onclick=async function(){
        try{
          if(!wt.openFriends)throw new Error("好友功能尚未準備完成");
          await wt.openFriends();
          setTimeout(function(){
            var input=document.getElementById("wtChatFriendCode");
            if(input){input.value=btn.dataset.globalAdd;input.dispatchEvent(new Event("input",{bubbles:true}));input.focus();}
          },100);
          toast("已帶入好友 ID");
        }catch(e){toast(e.message||"無法開啟好友功能");}
      };
    });
    body.querySelectorAll("[data-global-public-room],[data-global-room]").forEach(function(btn){
      btn.onclick=function(){location.href=location.pathname+"?room="+encodeURIComponent(btn.dataset.globalPublicRoom||btn.dataset.globalRoom||"");};
    });
  });
}

function searchQueries(){
  try{var list=JSON.parse(localStorage.getItem(SEARCH_KEY)||"[]");return Array.isArray(list)?list.filter(Boolean).slice(0,15):[];}catch(_){return [];}
}
function rememberSearchQuery(query){
  var q=String(query||"").trim().slice(0,100);if(!q)return;
  var list=searchQueries().filter(function(x){return String(x).toLowerCase()!==q.toLowerCase();});
  list.unshift(q);try{localStorage.setItem(SEARCH_KEY,JSON.stringify(list.slice(0,15)));}catch(_){}
}
function loginHistory(){
  try{var list=JSON.parse(localStorage.getItem(LOGIN_KEY)||"[]");return Array.isArray(list)?list.slice(0,20):[];}catch(_){return [];}
}
function recordLogin(current){
  if(!current||current.isAnonymous)return;
  var item={uid:String(current.uid||"").slice(0,128),email:String(current.email||"").slice(0,320),provider:String((current.providerData&&current.providerData[0]&&current.providerData[0].providerId)||"google.com").slice(0,50),at:Date.now(),device:/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)?"mobile":"desktop"};
  var list=loginHistory();
  if(list[0]&&list[0].uid===item.uid&&Date.now()-Number(list[0].at||0)<60000)return;
  list.unshift(item);try{localStorage.setItem(LOGIN_KEY,JSON.stringify(list.slice(0,20)));}catch(_){}
}
function openLoginHistory(){
  var list=loginHistory();
  var html='<div class="small muted">登入活動只儲存在目前裝置。</div><div class="wt-feature-list">'+(list.length?list.map(function(x){return '<div class="wt-feature-row"><div><strong>'+esc(x.email||"Google 帳號")+'</strong><div class="small muted">'+esc(x.provider||"google.com")+'｜'+esc(x.device||"")+'｜UID '+esc(x.uid||"")+'</div></div><span class="small muted">'+esc(fmtDate(x.at))+'</span></div>';}).join(""):'<div class="wt-feature-empty">目前沒有登入紀錄。</div>')+'</div><div class="wt-feature-actions"><button id="wtLoginHistoryClear" class="tiny-btn danger">清除登入紀錄</button></div>';
  var body=modal("wtLoginHistoryModal","登入活動",html);
  body.querySelector("#wtLoginHistoryClear").onclick=function(){localStorage.removeItem(LOGIN_KEY);openLoginHistory();};
}
function openGlobalSearch(){
  var body=modal("wtGlobalSearchModal","站內搜尋",'<div class="wt-feature-actions" style="margin-top:0"><input id="wtGlobalSearchInput" class="search" type="search" maxlength="100" placeholder="搜尋使用者、公開房間或好友…" style="flex:1"><button id="wtGlobalSearchGo" class="primary-btn">搜尋</button></div><div id="wtGlobalSearchBody" class="wt-feature-list"><div class="wt-feature-empty">輸入關鍵字後開始搜尋。</div></div>');
  var input=$("wtGlobalSearchInput"),results=$("wtGlobalSearchBody");
  var queryBox=document.createElement("div");queryBox.className="wt-feature-actions";queryBox.style.cssText="justify-content:flex-start;margin:8px 0 0";results.parentElement.insertBefore(queryBox,results);
  function renderQueries(){
    var qs=searchQueries();
    queryBox.innerHTML=qs.length?'<span class="small muted">最近</span>'+qs.map(function(q){return '<button type="button" class="tiny-btn" data-search-query="'+esc(q)+'">'+esc(q)+'</button>';}).join(""):"";
    queryBox.querySelectorAll("[data-search-query]").forEach(function(btn){btn.onclick=function(){input.value=btn.dataset.searchQuery;run();};});
  }
  var run=function(){var q=String(input.value||"").trim();if(!q)return results.innerHTML='<div class="wt-feature-empty">請輸入搜尋內容。</div>';rememberSearchQuery(q);renderQueries();results.innerHTML='<div class="wt-feature-empty">搜尋中…</div>';renderGlobalSearchResults(results,q).catch(function(){results.innerHTML='<div class="wt-feature-empty">搜尋失敗，請稍後再試。</div>';});};
  renderQueries();
  body.querySelector("#wtGlobalSearchGo").onclick=run;
  input.onkeydown=function(e){if(e.key==="Enter"){e.preventDefault();run();}};
  setTimeout(function(){input.focus();},30);
}

function openStatus(){
  var s=st(),net=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  var html='<div class="wt-feature-stat-grid"><div class="wt-feature-stat"><span class="small muted">登入</span><strong>'+(s.uid?(user()&&user().isAnonymous?"訪客":"Google"):"未登入")+'</strong></div><div class="wt-feature-stat"><span class="small muted">Firebase</span><strong>'+(s.databaseConnected===false?"離線":"線上")+'</strong></div><div class="wt-feature-stat"><span class="small muted">同步</span><strong>'+esc($("syncStatus")&&$("syncStatus").textContent||"尚未同步")+'</strong></div></div>';
  html+='<div class="wt-feature-list"><div class="wt-feature-row"><span>房間</span><strong>'+esc(s.roomId||"—")+'</strong></div><div class="wt-feature-row"><span>平台</span><strong>'+esc(s.room&&s.room.sourceType||"—")+'</strong></div><div class="wt-feature-row"><span>播放器</span><strong>'+esc(s.playerType||"—")+'｜'+(s.playerReady?"Ready":"準備中")+'</strong></div><div class="wt-feature-row"><span>播放狀態</span><strong>'+esc(s.playbackLastPlayerState||"—")+'</strong></div><div class="wt-feature-row"><span>網路</span><strong>'+(navigator.onLine?"Online":"Offline")+(net&&net.effectiveType?"｜"+esc(net.effectiveType):"")+'</strong></div></div>';
  modal("wtStatusModal","狀態中心",html);
}

async function openReport(category){
  var u=user();
  if(!u) return toast("請先完成登入");
  var cats=["playback","search","room","chat","account","ui","other"];
  var labels={playback:"播放／同步",search:"搜尋",room:"房間",chat:"聊天室",account:"帳號",ui:"介面",other:"其他"};
  var current=cats.indexOf(category)>=0?category:"other";
  var body=modal("wtReportModal","回報問題",
    '<div class="wt-feature-grid">'+
      '<label>問題類型<select id="wtReportCat">'+cats.map(function(x){return '<option value="'+x+'" '+(x===current?"selected":"")+'>'+labels[x]+'</option>';}).join("")+'</select></label>'+
      '<label>優先程度<select id="wtReportPriority"><option value="normal">一般</option><option value="high">高</option><option value="urgent">緊急</option></select></label>'+
      '<label class="full">問題描述<textarea id="wtReportDetails" maxlength="2000" rows="7" placeholder="描述發生什麼、如何重現，以及原本期待的結果。"></textarea></label>'+
      '<label class="full">截圖（可選）<input id="wtReportScreenshot" type="file" accept="image/png,image/jpeg,image/webp"></label>'+
      '<label class="full">目前頁面<input value="'+esc(location.href)+'" readonly></label>'+
    '</div>'+
    '<div class="small muted">系統會附上瀏覽器、螢幕尺寸、房間、播放器、網路狀態與目前版本等診斷資訊。截圖會壓縮成小型資料直接附在回報中。</div>'+
    '<div class="wt-feature-actions"><button id="wtReportSend" class="primary-btn">送出回報</button></div>'
  );
  body.querySelector("#wtReportSend").onclick=async function(){
    try{
      var details=String($("wtReportDetails").value||"").trim();
      if(details.length<8)throw new Error("請至少描述 8 個字的問題");
      var context={
        page:location.href.slice(0,2000),
        userAgent:navigator.userAgent.slice(0,1000),
        language:navigator.language||"",
        screenWidth:window.screen.width,
        screenHeight:window.screen.height,
        viewportWidth:window.innerWidth,
        viewportHeight:window.innerHeight,
        online:navigator.onLine===true,
        connectionType:navigator.connection?.effectiveType||"",
        roomId:String(st().roomId||"").slice(0,6),
        playerType:String(st().playerType||"").slice(0,50),
        videoId:String(st().currentVideoId||"").slice(0,200),
        syncStatus:String($("syncStatus")?.textContent||"").slice(0,300)
      };
      var screenshot="";
      var file=$("wtReportScreenshot")?.files?.[0]||null;
      if(file){
        if(!/^image\/(png|jpeg|webp)$/.test(file.type))throw new Error("截圖格式只支援 PNG、JPG、WebP");
        if(file.size>700000)throw new Error("截圖檔案請控制在 700 KB 以內");
        screenshot=await new Promise(function(resolve,reject){
          var reader=new FileReader();
          reader.onload=function(){var value=String(reader.result||"");if(value.length>900000)reject(new Error("截圖資料過大，請換一張較小的圖片"));else resolve(value);};
          reader.onerror=function(){reject(new Error("截圖讀取失敗"));};
          reader.readAsDataURL(file);
        });
      }
      var ref=db.ref("reports").push();
      var payload={
        uid:u.uid,
        category:$("wtReportCat").value,
        details:details,
        createdAt:firebase.database.ServerValue.TIMESTAMP,
        status:"open",
        source:"manual",
        autoDetected:false,
        autoVerifyEnabled:true,
        priority:$("wtReportPriority").value,
        buildVersion:String(window.__WATCHTOGETHER_BUILD__||"").slice(0,100),
        firstSeenAt:firebase.database.ServerValue.TIMESTAMP,
        lastSeenAt:firebase.database.ServerValue.TIMESTAMP,
        occurrences:1,
        page:context.page,
        roomId:context.roomId,
        userAgent:context.userAgent,
        context:JSON.stringify(context).slice(0,5000)
      };
      if(screenshot)payload.screenshotDataUrl=screenshot.slice(0,900000);
      await ref.set(payload);
      try{var ids=JSON.parse(localStorage.getItem("wt_my_report_ids_v1")||"[]");if(!Array.isArray(ids))ids=[];ids=[ref.key].concat(ids.filter(function(x){return String(x)!==String(ref.key);})).slice(0,30);localStorage.setItem("wt_my_report_ids_v1",JSON.stringify(ids));}catch(_){}
      try{window.reportWatchTogetherBug&&window.reportWatchTogetherBug($("wtReportCat").value,details,context);}catch(_){}
      pushNotification("問題回報已送出","管理系統已收到你的回報。","report");
      toast("問題回報已送出");
      close("wtReportModal");
    }catch(e){toast(e.message||"回報送出失敗");}
  };
}


async function openMyReports(){
  var u=user();
  if(!u)return toast("請先完成登入");
  var ids=[];
  try{ids=JSON.parse(localStorage.getItem("wt_my_report_ids_v1")||"[]");}catch(_){ids=[];}
  ids=Array.isArray(ids)?ids.filter(Boolean).slice(0,30):[];
  var list=[];
  for(var i=0;i<ids.length;i++){
    try{
      var snap=await db.ref("reports/"+ids[i]).once("value");
      if(snap.exists())list.push(Object.assign({id:ids[i]},snap.val()||{}));
    }catch(_){}
  }
  var labels={playback:"播放／同步",search:"搜尋",room:"房間",chat:"聊天室",account:"帳號",ui:"介面",other:"其他"};
  var statuses={open:"待處理",in_progress:"處理中",resolved:"已處理"};
  list.sort(function(a,b){return Number(b.createdAt||0)-Number(a.createdAt||0);});
  var html='<div class="small muted">只顯示你自己送出的回報。</div><div class="wt-feature-list">';
  html+=list.length?list.map(function(x){
    return '<div class="wt-feature-row"><div><strong>'+esc(labels[x.category]||x.category||"其他")+'</strong><div class="small">'+esc(x.details||"")+'</div><div class="small muted">建立：'+esc(fmtDate(x.createdAt))+(x.handledAt?'｜處理：'+esc(fmtDate(x.handledAt)):"")+'</div></div><span class="small">'+esc(statuses[x.status]||x.status||"待處理")+'</span></div>';
  }).join(""):'<div class="wt-feature-empty">目前沒有已記錄的回報。</div>';
  html+='</div><div class="wt-feature-actions"><button id="wtMyReportsRefresh" class="primary-btn">重新整理</button></div>';
  var body=modal("wtMyReportsModal","我的回報",html);
  body.querySelector("#wtMyReportsRefresh").onclick=function(){openMyReports();};
}

function openInvite(){
  var id=roomId();if(!id)return toast("目前不在房間內");
  var link=wt.roomLink?wt.roomLink(id):location.origin+location.pathname+"?room="+encodeURIComponent(id);
  var m=$("wtInviteFeatureModal");
  if(!m){
    m=document.createElement("div");m.id="wtInviteFeatureModal";m.className="modal hidden wt-feature-modal";m.setAttribute("aria-hidden","true");
    m.innerHTML='<div class="modal-card wt-feature-card"><div class="wt-feature-head"><div class="panel-title">房間邀請</div><button type="button" class="tiny-btn" id="wtInviteClose">關閉</button></div><div class="wt-feature-link" id="wtInviteLink"></div><div class="wt-feature-grid" style="margin-top:12px"><label>好友 ID（6 碼）<input id="wtInviteFriendCode" maxlength="6" placeholder="例如 A1B2C3" style="text-transform:uppercase"></label><div style="align-self:end"><button id="wtInviteSend" class="primary-btn" type="button">發送房間邀請</button></div></div><div class="wt-feature-actions" style="justify-content:flex-start"><button id="wtInviteCopy" class="primary-btn">複製連結</button><button id="wtInviteCode" class="secondary-btn">複製房間碼</button></div><div id="wtInviteQr" style="display:grid;place-items:center;padding:16px;background:#fff;border-radius:16px;margin-top:14px;min-height:220px"></div></div>';
    document.body.appendChild(m);
    m.addEventListener("click",function(e){if(e.target===m)close("wtInviteFeatureModal");});
    $("wtInviteClose").onclick=function(){close("wtInviteFeatureModal");};
    $("wtInviteCopy").onclick=async function(){try{await navigator.clipboard.writeText(link);toast("已複製邀請連結");}catch(_){toast(link);}};
    $("wtInviteCode").onclick=async function(){try{await navigator.clipboard.writeText(id);toast("已複製房間碼");}catch(_){toast(id);}};
    $("wtInviteSend").onclick=function(){sendRoomInvite().catch(function(e){toast(e.message||"邀請發送失敗");});};
  }
  $("wtInviteLink").textContent=link;
  var q=$("wtInviteQr");q.innerHTML="";
  try{if(typeof window.qrcode==="function"){var qr=window.qrcode(0,"M");qr.addData(link);qr.make();var img=document.createElement("img");img.alt="房間邀請 QR Code";img.src=qr.createDataURL(5,0);img.style.maxWidth="100%";q.appendChild(img);}else{q.textContent="QR Code 元件尚未載入";}}catch(_){q.textContent="QR Code 產生失敗";}
  openModal("wtInviteFeatureModal");
}

async function sendRoomInvite(){
  var id=roomId(),u=user();if(!id||!u)throw new Error("請先進入房間並完成登入");
  var isCohost=Boolean(window.WT_ROOM_ACCESS&&window.WT_ROOM_ACCESS.isCohost&&window.WT_ROOM_ACCESS.isCohost(u.uid));
  if(!st().isOwner&&!isCohost)throw new Error("只有房主或 Co-host 可以發送房間邀請");
  var code=String($("wtInviteFriendCode")&&$("wtInviteFriendCode").value||"").trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code))throw new Error("請輸入有效的好友 ID");
  var target=(await db.ref("profileCodes/"+code).once("value")).val();if(!target)throw new Error("找不到這個使用者 ID");if(String(target)===String(u.uid))throw new Error("不能邀請自己");var friendship=(await db.ref("friendships/"+u.uid+"/"+target).once("value")).exists();if(!friendship)throw new Error("這個使用者還不是你的好友");
  var link=wt.roomLink?wt.roomLink(id):location.origin+location.pathname+"?room="+encodeURIComponent(id);
  var ref=db.ref("roomInvites/"+target).push();
  await ref.set({inviteId:ref.key,roomId:id,roomName:String(st().room&&st().room.name||"一起看").slice(0,40),toUid:String(target),fromUid:u.uid,fromName:String(wt.currentName&&wt.currentName()||"玩家").slice(0,30),createdAt:firebase.database.ServerValue.TIMESTAMP,status:"pending",link:link});
  toast("房間邀請已送出");
}


function openQueueHistory(){
  var list=core?.queueHistory?core.queueHistory():[];
  var html='<div class="small muted">最近 50 次由待播放清單啟動的影片會保留在目前裝置。</div><div class="wt-feature-list">';
  html+=list.length?list.map(function(x){return '<div class="wt-feature-row"><div><strong>'+esc(x.title||"未命名影片")+'</strong><div class="small muted">'+esc(x.platform||"")+'｜'+esc(x.channel||"")+'</div><div class="small muted">'+esc(fmtDate(x.playedAt))+'｜'+esc(x.playedByName||"玩家")+'</div></div></div>';}).join(""):'<div class="wt-feature-empty">目前沒有佇列播放紀錄。</div>';
  html+='</div>';
  modal("wtQueueHistoryModal","佇列播放歷史",html);
}

function openQueueMode(){
  var s=st(),settings=s.room&&s.room.settings||window.WT_ROOM_ACCESS&&window.WT_ROOM_ACCESS.state&&window.WT_ROOM_ACCESS.state.meta&&window.WT_ROOM_ACCESS.state.meta.settings||{},current=String(settings.queueMode||"normal");
  var body=modal("wtQueueModeModal","佇列播放模式",'<label>播放模式<select id="wtQueueModeSelect"><option value="normal" '+(current==="normal"?"selected":"")+'>依序播放</option><option value="repeat_one" '+(current==="repeat_one"?"selected":"")+'>重播目前影片</option><option value="shuffle" '+(current==="shuffle"?"selected":"")+'>隨機播放下一部</option></select></label><div class="small muted" style="margin-top:10px">房間會同步這個設定。影片播完後由房主依此模式處理。</div><div class="wt-feature-actions"><button id="wtQueueModeSave" class="primary-btn">儲存</button></div>');
  body.querySelector("#wtQueueModeSave").onclick=async function(){
    try{
      if(!s.isOwner&&!window.WT_ROOM_ACCESS?.isCohost?.(s.uid))throw new Error("只有房主或 Co-host 可以設定佇列模式");
      var mode=$("wtQueueModeSelect").value;
      if(!["normal","repeat_one","shuffle"].includes(mode))throw new Error("佇列模式無效");
      await db.ref("roomMeta/"+roomId()+"/settings").update({queueMode:mode});
      if(s.room)s.room.settings=Object.assign({},s.room.settings||{},{queueMode:mode});
      toast(mode==="repeat_one"?"已設定重播目前影片":mode==="shuffle"?"已設定隨機播放":"已設定依序播放");
      close("wtQueueModeModal");
    }catch(e){toast(e.message||"佇列模式儲存失敗");}
  };
}

async function openRoomTools(){
  var id=roomId(),s=st(),u=user();
  if(!id||!u)return;
  if(!s.isOwner)return toast("只有房主可以使用房主工具");
  var snap=await db.ref("members/"+id).once("value").catch(function(){return null;}),members=snap?.val()||{};
  var entries=Object.entries(members).filter(function(x){return x[0]!==u.uid;});
  var settings=(s.room&&s.room.settings)||window.WT_ROOM_ACCESS?.state?.meta?.settings||{};
  var moderationHtml=entries.length?'<div class="panel-title" style="margin-top:16px">成員管理</div><div class="wt-feature-list">'+entries.map(function(x){
    var uid=String(x[0]||""),member=x[1]||{},name=String(member.name||uid);
    return '<div class="wt-feature-row"><div><strong>'+esc(name)+'</strong><div class="small muted">'+esc(uid)+'</div></div><div class="wt-feature-actions" style="margin-top:0"><button class="tiny-btn" data-room-mute="'+esc(uid)+'">禁言</button><button class="tiny-btn" data-room-ban="'+esc(uid)+'">封鎖</button><button class="tiny-btn danger" data-room-kick="'+esc(uid)+'">踢出</button></div></div>';
  }).join("")+'</div>':'<div class="panel-title" style="margin-top:16px">成員管理</div><div class="wt-feature-empty">目前沒有其他成員。</div>';
  var body=modal("wtRoomToolsModal","房主工具",'<div class="wt-feature-grid"><label class="full">房間名稱<input id="wtRoomRename" maxlength="40" value="'+esc(s.room&&s.room.name||"一起看")+'"></label><label class="full">轉移房主<select id="wtTransferOwner"><option value="">不轉移</option>'+entries.map(function(x){return '<option value="'+esc(x[0])+'">'+esc(x[1]?.name||x[0])+'｜'+esc(x[0])+'</option>';}).join("")+'</select></label><label class="full wt-feature-switch"><input id="wtSyncVolume" type="checkbox" '+(settings.syncVolume===true?"checked":"")+'> 同步房主音量給所有成員</label></div><div class="wt-feature-actions"><button id="wtRoomRenameSave" class="secondary-btn">儲存房名</button><button id="wtSyncVolumeSave" class="secondary-btn">儲存音量同步</button><button id="wtTransferOwnerBtn" class="primary-btn">轉移房主</button></div>'+moderationHtml);
  body.querySelector("#wtRoomRenameSave").onclick=async function(){
    try{
      var name=String($("wtRoomRename").value||"").trim().slice(0,40);if(!name)throw new Error("房間名稱不能為空");
      var updates={};updates["rooms/"+id+"/name"]=name;updates["roomMeta/"+id+"/name"]=name;await db.ref().update(updates);
      if(s.room)s.room.name=name;
      if($("roomTitle"))$("roomTitle").textContent=name;
      toast("房間名稱已更新");
    }catch(e){toast(e.message||"房間名稱更新失敗");}
  };
  body.querySelector("#wtSyncVolumeSave").onclick=async function(){
    try{
      var enabled=$("wtSyncVolume")?.checked===true;
      await db.ref("roomMeta/"+id+"/settings/syncVolume").set(enabled);
      if(s.room) s.room.settings=Object.assign({},s.room.settings||{},{syncVolume:enabled});
      toast(enabled?"已開啟音量同步":"已關閉音量同步");
    }catch(e){toast(e.message||"音量同步設定失敗");}
  };  body.querySelectorAll("[data-room-mute]").forEach(function(btn){btn.onclick=async function(){
    var uid=btn.dataset.roomMute,member=members[uid]||{};
    try{await core?.toggleRoomMute?.(uid,member.name||uid);openRoomTools();}catch(e){toast(e.message||"禁言操作失敗");}
  };});
  body.querySelectorAll("[data-room-ban]").forEach(function(btn){btn.onclick=async function(){
    var uid=btn.dataset.roomBan,member=members[uid]||{};
    try{await core?.toggleRoomBan?.(uid,member.name||uid);openRoomTools();}catch(e){toast(e.message||"封鎖操作失敗");}
  };});
  body.querySelectorAll("[data-room-kick]").forEach(function(btn){btn.onclick=async function(){
    var uid=btn.dataset.roomKick,member=members[uid]||{};
    try{await core?.kickMember?.(uid,member.name||uid);openRoomTools();}catch(e){toast(e.message||"踢人失敗");}
  };});

  body.querySelector("#wtTransferOwnerBtn").onclick=async function(){
    var target=$("wtTransferOwner").value;if(!target)return toast("請先選擇新房主");
    var name=String(members[target]?.name||target);
    if(!window.confirm("確定把房主權限轉移給「"+name+"」嗎？"))return;
    try{
      await db.ref("rooms/"+id+"/owner").set(target);
      toast("房主已轉移給 "+name);
      close("wtRoomToolsModal");
    }catch(e){toast(e.message||"房主轉移失敗");}
  };
}

function ensureRoomTools(){
  var id=roomId(),copy=$("copyRoomBtn");if(!id||!copy)return;
  if(!$("wtRoomInviteBtn")){var b=document.createElement("button");b.id="wtRoomInviteBtn";b.className="tiny-btn";b.type="button";b.textContent="邀請";b.onclick=openInvite;copy.insertAdjacentElement("afterend",b);}
  if(!$("wtRoomReportBtn")){var c=document.createElement("button");c.id="wtRoomReportBtn";c.className="tiny-btn";c.type="button";c.textContent="回報";c.onclick=function(){openReport("room");};copy.insertAdjacentElement("afterend",c);}
  if(!$("wtRoomHostToolsBtn")){var h=document.createElement("button");h.id="wtRoomHostToolsBtn";h.className="tiny-btn";h.type="button";h.textContent="房主工具";h.onclick=openRoomTools;copy.insertAdjacentElement("afterend",h);}
  if(!$("wtQueueModeBtn")){var q=document.createElement("button");q.id="wtQueueModeBtn";q.className="tiny-btn";q.type="button";q.textContent="佇列模式";q.onclick=openQueueMode;$("playQueueNowBtn")?.insertAdjacentElement("afterend",q);}
  if(!$("wtQueueClearBtn")){var qc=document.createElement("button");qc.id="wtQueueClearBtn";qc.className="tiny-btn danger";qc.type="button";qc.textContent="清空佇列";qc.onclick=async function(){try{await core?.clearQueue?.();}catch(e){toast(e.message||"清空佇列失敗");}};$("playQueueNowBtn")?.insertAdjacentElement("afterend",qc);}
  if(!$("wtQueueHistoryBtn")){var qh=document.createElement("button");qh.id="wtQueueHistoryBtn";qh.className="tiny-btn";qh.type="button";qh.textContent="佇列歷史";qh.onclick=openQueueHistory;$("playQueueNowBtn")?.insertAdjacentElement("afterend",qh);}
}


function installFriendRequestWatcher(){
  var u=user();if(!u||u.isAnonymous||!db)return;
  if(seen.friendReqUid===u.uid&&seen.friendReqRef)return;
  if(seen.friendReqRef){try{seen.friendReqRef.off();}catch(_){}}
  var ref=db.ref("friendRequests/"+u.uid);
  ref.on("child_added",function(snapshot){
    var item=snapshot.val();if(!item)return;
    var key="wt_feature_friendreq_"+u.uid+"_"+snapshot.key+"_"+String(item.createdAt||"");
    if(localStorage.getItem(key))return;
    try{localStorage.setItem(key,String(Date.now()));}catch(_){}
    if(prefs().friendNotifications)pushNotification("新的好友邀請",String(item.fromName||item.name||"有人")+" 想加你為好友。","friend");
  });
  seen.friendReqUid=u.uid;seen.friendReqRef=ref;
}

function openInvites(){
  var u=user();if(!u||u.isAnonymous)return toast("請先登入 Google 帳號");
  db.ref("roomInvites/"+u.uid).once("value").then(function(snap){
    var list=[];snap.forEach(function(child){var x=child.val();if(x&&x.status==="pending")list.push(Object.assign({key:child.key},x));});
    list.sort(function(a,b){return Number(b.createdAt||0)-Number(a.createdAt||0);});
    var html='<div class="small muted">好友傳給你的房間邀請會保留在這裡。</div><div class="wt-feature-list">';
    html+=list.length?list.map(function(x){return '<div class="wt-feature-row"><div><strong>'+esc(x.roomName||"一起看")+'</strong><div class="small">'+esc(x.fromName||"好友")+' 邀請你加入</div><div class="small muted">'+esc(fmtDate(x.createdAt))+'</div></div><div class="wt-feature-actions" style="margin-top:0"><button class="tiny-btn primary" data-invite-join="'+esc(x.key)+'">加入</button><button class="tiny-btn danger" data-invite-decline="'+esc(x.key)+'">忽略</button></div></div>';}).join(""):'<div class="wt-feature-empty">目前沒有待處理邀請。</div>';
    html+='</div>';
    var body=modal("wtInvitesModal","房間邀請",html);
    body.querySelectorAll("[data-invite-join]").forEach(function(b){b.onclick=async function(){var item=list.find(function(x){return x.key===b.dataset.inviteJoin;});if(!item)return;try{await db.ref("roomInvites/"+u.uid+"/"+item.key+"/status").set("accepted");location.href=location.pathname+"?room="+encodeURIComponent(item.roomId)+"&invite="+encodeURIComponent(item.key);}catch(e){toast(e.message||"無法加入房間");}};});
    body.querySelectorAll("[data-invite-decline]").forEach(function(b){b.onclick=async function(){try{await db.ref("roomInvites/"+u.uid+"/"+b.dataset.inviteDecline+"/status").set("declined");openInvites();}catch(e){toast(e.message||"操作失敗");}};});
  }).catch(function(e){toast(e.message||"載入邀請失敗");});
}
function installRoomInviteWatcher(){
  var u=user();if(!u||u.isAnonymous||!db)return;
  if(window.__WT_ROOM_INVITE_WATCHER_UID===u.uid)return;
  if(window.__WT_ROOM_INVITE_WATCHER_REF){try{window.__WT_ROOM_INVITE_WATCHER_REF.off();}catch(_){}}
  window.__WT_ROOM_INVITE_WATCHER_UID=u.uid;
  var ref=db.ref("roomInvites/"+u.uid);
  window.__WT_ROOM_INVITE_WATCHER_REF=ref;
  ref.on("child_added",function(s){
    var x=s.val();if(!x||x.status!=="pending")return;
    var k="wt_room_invite:"+u.uid+":"+s.key+":"+String(x.createdAt||"");
    if(localStorage.getItem(k))return;
    localStorage.setItem(k,String(Date.now()));
    if(prefs().roomNotifications)pushNotification("新的房間邀請",String(x.fromName||"好友")+" 邀請你加入「"+String(x.roomName||"一起看")+"」。","room");
  });
}

function installFriendshipWatcher(){
  var u=user();if(!u||u.isAnonymous||!db)return;
  if(window.__WT_FRIENDSHIP_WATCHER_UID===u.uid)return;
  if(window.__WT_FRIENDSHIP_WATCHER_REF){try{window.__WT_FRIENDSHIP_WATCHER_REF.off();}catch(_){}}
  window.__WT_FRIENDSHIP_WATCHER_UID=u.uid;
  var ref=db.ref("friendships/"+u.uid);
  window.__WT_FRIENDSHIP_WATCHER_REF=ref;
  ref.once("value").then(function(initial){
    var known={};
    initial.forEach(function(child){known[String(child.key||"")]=true;});
    ref.on("child_added",function(snap){
      var uid=String(snap.key||"");if(!uid||known[uid])return;
      known[uid]=true;
      db.ref("profiles/"+uid).once("value").then(function(ps){
        var p=ps.val()||{};
        if(prefs().friendNotifications)pushNotification("好友已加入",String(p.displayName||"你的好友")+" 現在已成為好友。","friend");
      }).catch(function(){});
    });
  }).catch(function(){});
}

function installFeatureKeyboard(){
  if(document.documentElement.dataset.wtFeatureKeyboard)return;
  document.documentElement.dataset.wtFeatureKeyboard="1";
  document.addEventListener("keydown",function(e){
    var tag=String(e.target&&e.target.tagName||"").toLowerCase();
    if(["input","textarea","select","button"].includes(tag)||e.isComposing)return;
    var s=st();
    if(!s.roomId||!s.player)return;
    try{
      if(e.code==="Space"){
        e.preventDefault();
        $("playPauseBtn")&&$("playPauseBtn").click();
      }else if(e.key==="ArrowLeft"){
        e.preventDefault();
        $("backBtn")&&$("backBtn").click();
      }else if(e.key==="ArrowRight"){
        e.preventDefault();
        $("forwardBtn")&&$("forwardBtn").click();
      }else if(e.key.toLowerCase()==="f"){
        e.preventDefault();
        $("fullscreenBtn")&&$("fullscreenBtn").click();
      }else if(e.key.toLowerCase()==="m"){
        e.preventDefault();
        $("volumeInput")&&$("volumeInput").click();
      }
    }catch(_){}
  });
}

function track(){
  var s=st(),key=String(s.room&&s.room.sourceType||"")+":"+String(s.currentVideoId||"");
  if(s.isPlaying){var x=stats();saveStats({watchSeconds:Number(x.watchSeconds||0)+5,lastAt:Date.now()});}
  var rid=String(s.roomId||"");
  if(rid&&rid!==lastTrackedRoom){lastTrackedRoom=rid;var rs=stats();saveStats({roomsJoined:Number(rs.roomsJoined||0)+1,lastAt:Date.now()});}
  if(key!==":"&&key!==""&&key!==lastTrackedVideo){lastTrackedVideo=key;var vs=stats();saveStats({videosStarted:Number(vs.videosStarted||0)+1,lastAt:Date.now()});}
}
function init(){
  if(document.documentElement.dataset.wtFeatureCenter)return;
  document.documentElement.dataset.wtFeatureCenter="1";
  injectCss();
  loadNotifications();
  ensureTopbar();
  var p=prefs();
  if($("sourceTypeInput")&&["youtube","vimeo","dailymotion","twitch"].includes(p.defaultPlatform))$("sourceTypeInput").value=p.defaultPlatform;
  installRoomInviteWatcher();
  if(auth)auth.onAuthStateChanged(function(current){
    recordLogin(current);
    if (!current) {
      try { window.__WT_FRIENDSHIP_WATCHER_REF?.off(); } catch (_) {}
      try { window.__WT_ROOM_INVITE_WATCHER_REF?.off(); } catch (_) {}
      window.__WT_FRIENDSHIP_WATCHER_REF = null;
      window.__WT_ROOM_INVITE_WATCHER_REF = null;
      window.__WT_FRIENDSHIP_WATCHER_UID = "";
      window.__WT_ROOM_INVITE_WATCHER_UID = "";
    } else {
      installFriendRequestWatcher();
      installFriendshipWatcher();
      installRoomInviteWatcher();
      ensureTopbar();
    }
  });
  setInterval(ensureRoomTools,1000);
  setInterval(track,5000);
  installFeatureKeyboard();
  setInterval(installFriendRequestWatcher,5000);
  setInterval(installFriendshipWatcher,5000);
  setInterval(installRoomInviteWatcher,5000);
}wt.openLoginHistory=openLoginHistory;wt.openGlobalSearch=openGlobalSearch;wt.openSettings=openSettings
wt.openMyReports=openMyReports;wt.openStatus=openStatus;wt.openStats=openStats;wt.openNotifications=openNotifications;wt.openFavorites=openFavorites;wt.openReport=openReport;wt.openInvite=openInvite;wt.openInvites=openInvites;wt.sendRoomInvite=sendRoomInvite;wt.pushNotification=pushNotification;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();