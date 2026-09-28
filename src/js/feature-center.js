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
const seen = {};

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
  if(!$("wtFeatureNotificationBtn")){
    var w=document.createElement("span");w.className="wt-nav-wrap";w.innerHTML='<button id="wtFeatureNotificationBtn" class="wt-nav-btn" type="button" title="通知中心">🔔</button><span id="wtFeatureNotificationBadge" class="wt-notice-dot" style="display:none"></span>';
    w.firstElementChild.addEventListener("click",openNotifications);r.insertBefore(w,anchor||null);
  }
  if(!$("wtFeatureFavoritesBtn")){var b=document.createElement("button");b.id="wtFeatureFavoritesBtn";b.className="wt-nav-btn";b.type="button";b.textContent="☆ 收藏";b.addEventListener("click",openFavorites);r.insertBefore(b,anchor||null);}
  if(!$("wtFeatureReportBtn")){var c=document.createElement("button");c.id="wtFeatureReportBtn";c.className="wt-nav-btn";c.type="button";c.textContent="🐛 回報";c.addEventListener("click",function(){openReport("other");});r.insertBefore(c,anchor||null);}
}

var notifications=[];
function loadNotifications(){try{var x=JSON.parse(localStorage.getItem(NOTIFY_KEY)||"[]");notifications=Array.isArray(x)?x.slice(0,100):[];}catch(_){notifications=[];}updateBadge();}
function saveNotifications(){notifications=notifications.slice(0,100);try{localStorage.setItem(NOTIFY_KEY,JSON.stringify(notifications));}catch(_){}updateBadge();}
function updateBadge(){var b=$("wtFeatureNotificationBadge");if(!b)return;var n=notifications.filter(function(x){return !x.read;}).length;b.textContent=n>99?"99+":String(n);b.style.display=n?"block":"none";}
function pushNotification(title,body,kind){
  var n={id:"n_"+Date.now()+"_"+Math.random().toString(36).slice(2,8),title:String(title||"WatchTogether"),body:String(body||""),kind:kind||"system",createdAt:Date.now(),read:false};
  notifications.unshift(n);saveNotifications();
  var p=prefs();
  if(p.browserNotifications&&"Notification" in window&&Notification.permission==="granted"&&document.visibilityState!=="visible"){try{new Notification(n.title,{body:n.body});}catch(_){}}
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
  body.querySelector("#wtFeatureNotifPerm").onclick=function(){if(!("Notification" in window)){toast("瀏覽器不支援通知");return;}Notification.requestPermission().then(function(x){if(x==="granted")toast("瀏覽器通知已允許");openSettings();});};
  body.querySelector("#wtFeatureClearHistory").onclick=function(){localStorage.removeItem("wt_watch_history_v1");wt.renderHome&&wt.renderHome();toast("已清除觀看紀錄");};
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
  var up={};up["profiles/"+u.uid]=updated;up["profileCodes/"+code]=u.uid;if(oldCode&&oldCode!==code)up["profileCodes/"+oldCode]=null;await db.ref().update(up);
  wt.state.profile=Object.assign({},wt.state.profile||{},updated);wt.state.memberName=name;localStorage.setItem("wt_name",name);wt.applyTheme&&wt.applyTheme(theme);if(core&&core.updateCurrentMemberName)try{await core.updateCurrentMemberName(name);}catch(_){}
  savePrefs({browserNotifications:$("wtFeatureBrowser").checked,friendNotifications:$("wtFeatureFriend").checked,dmNotifications:$("wtFeatureDm").checked,roomNotifications:$("wtFeatureRoom").checked,defaultPlatform:platform,compactControls:$("wtFeatureCompact").checked});
  if($("sourceTypeInput"))$("sourceTypeInput").value=platform;if($("sourceTypeModal"))$("sourceTypeModal").value=platform;toast("設定已儲存");close("wtSettingsModal");
}

function openFavorites(){
  var map=wt.readJson?wt.readJson("wt_favorites_v1",{}):{};var list=Object.values(map||{}).filter(Boolean);
  var html='<div class="small muted">收藏保留在目前裝置。</div><div class="wt-feature-list">';
  html+=list.length?list.map(function(x){return '<div class="wt-feature-row"><div><strong>'+esc(x.title||"未命名影片")+'</strong><div class="small muted">'+esc(x.platform||"")+'｜'+esc(x.channel||"")+'</div></div><button class="tiny-btn danger" data-fav-delete="'+esc(x.key||"")+'">刪除</button></div>';}).join(""):'<div class="wt-feature-empty">目前沒有收藏。</div>';
  html+='</div><div class="wt-feature-actions"><button id="wtFavClear" class="tiny-btn danger">清空收藏</button></div>';
  var body=modal("wtFavoritesModal","收藏",html);body.querySelector("#wtFavClear").onclick=function(){localStorage.removeItem("wt_favorites_v1");openFavorites();};body.querySelectorAll("[data-fav-delete]").forEach(function(b){b.onclick=function(){var m=wt.readJson("wt_favorites_v1",{})||{};delete m[b.dataset.favDelete];wt.writeJson("wt_favorites_v1",m);openFavorites();};});
}

function openStatus(){
  var s=st(),net=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  var html='<div class="wt-feature-stat-grid"><div class="wt-feature-stat"><span class="small muted">登入</span><strong>'+(s.uid?(user()&&user().isAnonymous?"訪客":"Google"):"未登入")+'</strong></div><div class="wt-feature-stat"><span class="small muted">Firebase</span><strong>'+(s.databaseConnected===false?"離線":"線上")+'</strong></div><div class="wt-feature-stat"><span class="small muted">同步</span><strong>'+esc($("syncStatus")&&$("syncStatus").textContent||"尚未同步")+'</strong></div></div>';
  html+='<div class="wt-feature-list"><div class="wt-feature-row"><span>房間</span><strong>'+esc(s.roomId||"—")+'</strong></div><div class="wt-feature-row"><span>平台</span><strong>'+esc(s.room&&s.room.sourceType||"—")+'</strong></div><div class="wt-feature-row"><span>播放器</span><strong>'+esc(s.playerType||"—")+'｜'+(s.playerReady?"Ready":"準備中")+'</strong></div><div class="wt-feature-row"><span>播放狀態</span><strong>'+esc(s.playbackLastPlayerState||"—")+'</strong></div><div class="wt-feature-row"><span>網路</span><strong>'+(navigator.onLine?"Online":"Offline")+(net&&net.effectiveType?"｜"+esc(net.effectiveType):"")+'</strong></div></div>';
  modal("wtStatusModal","狀態中心",html);
}

async function openReport(category){
  var u=user();if(!u) return toast("請先完成登入");
  var cats=["playback","search","room","chat","account","ui","other"],c=cats.indexOf(category)>=0?category:"other";
  var body=modal("wtReportModal","回報問題",'<div class="wt-feature-grid"><label>問題類型<select id="wtReportCat">'+cats.map(function(x){return '<option value="'+x+'" '+(x===c?"selected":"")+'>'+({playback:"播放／同步",search:"搜尋",room:"房間",chat:"聊天室",account:"帳號",ui:"介面",other:"其他"})[x]+'</option>';}).join("")+'</select></label><label>目前頁面<input value="'+esc(location.href)+'" readonly></label><label class="full">問題描述<textarea id="wtReportDetails" maxlength="2000" rows="7" placeholder="描述發生什麼、如何重現，以及原本期待的結果。"></textarea></label></div><div class="small muted">送出時會附上目前頁面、瀏覽器、房間與播放器診斷資訊。</div><div class="wt-feature-actions"><button id="wtReportSend" class="primary-btn">送出回報</button></div>');
  body.querySelector("#wtReportSend").onclick=async function(){try{var details=String($("wtReportDetails").value||"").trim();if(details.length<8)throw new Error("請至少描述 8 個字的問題");var s=st(),ref=db.ref("reports").push();await ref.set({uid:u.uid,category:$("wtReportCat").value,details:details,createdAt:firebase.database.ServerValue.TIMESTAMP,status:"open",source:"manual",autoDetected:false,autoVerifyEnabled:true,buildVersion:String(window.__WATCHTOGETHER_BUILD__||"").slice(0,100),firstSeenAt:firebase.database.ServerValue.TIMESTAMP,lastSeenAt:firebase.database.ServerValue.TIMESTAMP,occurrences:1,page:location.href.slice(0,2000),roomId:String(s.roomId||"").slice(0,6),userAgent:navigator.userAgent.slice(0,1000)});try{window.reportWatchTogetherBug&&window.reportWatchTogetherBug($("wtReportCat").value,details,s);}catch(_){}pushNotification("問題回報已送出","管理系統已收到你的回報。","report");toast("問題回報已送出");close("wtReportModal");}catch(e){toast(e.message||"回報送出失敗");}};
}

function ensureRoomTools(){
  var id=roomId(),copy=$("copyRoomBtn");if(!id||!copy)return;
  if(!$("wtRoomInviteBtn")){var b=document.createElement("button");b.id="wtRoomInviteBtn";b.className="tiny-btn";b.type="button";b.textContent="邀請";b.onclick=function(){var link=wt.roomLink?wt.roomLink(id):location.origin+location.pathname+"?room="+encodeURIComponent(id);try{navigator.clipboard.writeText(link);toast("已複製邀請連結");}catch(_){toast(link);}};copy.insertAdjacentElement("afterend",b);}
  if(!$("wtRoomReportBtn")){var c=document.createElement("button");c.id="wtRoomReportBtn";c.className="tiny-btn";c.type="button";c.textContent="回報";c.onclick=function(){openReport("room");};copy.insertAdjacentElement("afterend",c);}
}

function track(){
  var s=st(),key=String(s.room&&s.room.sourceType||"")+":"+String(s.currentVideoId||"");
  if(s.isPlaying){var x=stats();saveStats({watchSeconds:x.watchSeconds+5,lastAt:Date.now()});}
  if(key!==":"&&key!=="")seen[key]=seen[key]||Date.now();
  var sk=Object.keys(seen).length;if(sk>0)saveStats({videosStarted:sk});
}

function init(){
  if(document.documentElement.dataset.wtFeatureCenter)return;document.documentElement.dataset.wtFeatureCenter="1";injectCss();loadNotifications();ensureTopbar();setInterval(ensureRoomTools,1000);setInterval(track,5000);
}
wt.openSettings=openSettings;wt.openStatus=openStatus;wt.openNotifications=openNotifications;wt.openFavorites=openFavorites;wt.renderFavorites=openFavorites;wt.openReport=openReport;wt.openInvite=function(){ensureRoomTools();$("wtRoomInviteBtn")&&$("wtRoomInviteBtn").click();};wt.pushNotification=pushNotification;
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();