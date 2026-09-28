(() => {
  "use strict";
  const wt=window.WT_ENHANCEMENTS||{}, core=window.WT_CORE||{};
  const $=id=>document.getElementById(id);
  const auth=wt.auth||(window.firebase?.apps?.length?firebase.auth():null);
  const db=wt.db||(window.firebase?.apps?.length?firebase.database():null);
  const SET_KEY="wt_v3_settings_v1", LOCAL_NOTIF="wt_notifications_v2", LOCAL_HIST="wt_watch_history_v2", LOCAL_STATS="wt_stats_v1";
  const PLATFORMS=new Set(["youtube","vimeo","dailymotion","twitch"]);
  let notifRef=null,presenceRef=null,cloudNotifs={},cloudHistoryData={};
  let notifReady=false,lastHistKey="",lastHistAt=0,statsAt=0,lastTrackedRoom="",lastTrackedVideo="";

  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const toast=m=>{try{if(typeof wt.toast==="function")return wt.toast(m);if(typeof window.toast==="function")window.toast(m)}catch(_){}};
  const user=()=>{const u=auth?.currentUser;return u&&!u.isAnonymous?u:null};
  const st=()=>core.state||{};
  const local=(k,f)=>{try{const v=JSON.parse(localStorage.getItem(k)||"");return v==null?f:v}catch(_){return f}};
  const saveLocal=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v));return true}catch(_){return false}};
  const settings=()=>Object.assign({showOnline:true,browserNotifications:true,cloudHistory:true,cloudStats:true},local(SET_KEY,{}));
  async function loadUserSettings(){const u=user();if(!u||!db)return;try{const snap=await db.ref("userSettings/"+u.uid).once("value");const cloud=snap.val();if(cloud&&typeof cloud==="object"){const merged={showOnline:cloud.showOnline!==false,browserNotifications:cloud.browserNotifications!==false,cloudHistory:cloud.cloudHistory!==false,cloudStats:cloud.cloudStats!==false};saveLocal(SET_KEY,Object.assign({},settings(),merged));}}catch(e){console.warn("雲端使用設定讀取失敗",e)}}
  const key=v=>v?.id?String(v.platform||"youtube").toLowerCase()+":"+String(v.id):"";
  const safe=v=>String(v||"").slice(0,180).replace(/[.#$\[\]/]/g,"_");
  const date=v=>{const n=Number(v||0);return n>0?new Date(n).toLocaleString("zh-TW"):"—"};
  const dur=s=>{let n=Math.max(0,Math.floor(Number(s)||0)),h=Math.floor(n/3600);n%=3600;let m=Math.floor(n/60),x=n%60;return h?h+" 小時 "+m+" 分":m?m+" 分 "+x+" 秒":x+" 秒"};
  const video=()=>st().room?.video&&typeof st().room.video==="object"?st().room.video:null;

  function pos(){
    const s=st(),p=s.player;
    try{
      if(s.playerType==="youtube")return Number($("directVideo")?.currentTime||0);
      if(s.playerType==="vimeo"&&typeof p?.getCurrentTime==="function")return Number(p.getCurrentTime())||0;
      if(s.playerType==="dailymotion"&&typeof p?.getState==="function"){const x=p.getState();return Number(x?.videoTime||0)||0}
      if(s.playerType==="twitch"&&typeof p?.getCurrentTime==="function")return Number(p.getCurrentTime())||0;
    }catch(_){}
    return 0;
  }

  async function recordCloudHistory(force=false){
    const u=user(),v=video(),cfg=settings();
    if(!u||!db||!cfg.cloudHistory||!v?.id||!PLATFORMS.has(String(v.platform||"youtube").toLowerCase()))return;
    const k=key(v),now=Date.now();
    if(!force&&k===lastHistKey&&now-lastHistAt<20000)return;
    const platform=String(v.platform||"youtube").toLowerCase();
    const id=safe(platform+"_"+v.id);
    try{
      await db.ref("watchHistory/"+u.uid+"/"+id).set({
        id:String(v.id).slice(0,200),platform,title:String(v.title||"未命名影片").slice(0,200),
        thumbnail:String(v.thumbnail||"").slice(0,2000),channel:String(v.channel||"").slice(0,100),
        url:String(v.url||"").slice(0,2000),twitchType:String(v.twitchType||"").slice(0,30),
        position:Math.max(0,pos()),roomId:String(st().roomId||"").slice(0,6),
        lastWatchedAt:firebase.database.ServerValue.TIMESTAMP,updatedAt:firebase.database.ServerValue.TIMESTAMP
      });
      lastHistKey=k;lastHistAt=now;
    }catch(e){console.warn("雲端觀看紀錄寫入失敗",e)}
  }

  async function loadHistory(){
    const u=user();
    if(!u||!db||!settings().cloudHistory){cloudHistoryData={};return}
    try{cloudHistoryData=(await db.ref("watchHistory/"+u.uid).limitToLast(100).once("value")).val()||{}}
    catch(_){cloudHistoryData={}}
  }

  function mergedHistory(){
    const arr=Array.isArray(local(LOCAL_HIST,[]))?local(LOCAL_HIST,[]):[];
    const map=new Map();
    arr.forEach(x=>{const k=key(x);if(k)map.set(k,x)});
    Object.values(cloudHistoryData||{}).forEach(x=>{const k=key(x);if(k)map.set(k,Object.assign({},map.get(k)||{},x))});
    return [...map.values()].sort((a,b)=>Number(b.lastWatchedAt||0)-Number(a.lastWatchedAt||0)).slice(0,100);
  }

  function stats(){
    const x=local(LOCAL_STATS,{watchSeconds:0,videosStarted:0,roomsJoined:0,messagesSent:0,platformStarts:{}});
    x.platformStarts=x.platformStarts&&typeof x.platformStarts==="object"?x.platformStarts:{};
    return x;
  }

  async function syncStats(){
    const u=user();if(!u||!db||!settings().cloudStats)return;
    if(Date.now()-statsAt<15000)return;
    statsAt=Date.now();const x=stats();
    try{await db.ref("watchStats/"+u.uid).set({
      watchSeconds:Number(x.watchSeconds||0),videosStarted:Number(x.videosStarted||0),
      roomsJoined:Number(x.roomsJoined||0),messagesSent:Number(x.messagesSent||0),
      platformStarts:x.platformStarts,lastAt:firebase.database.ServerValue.TIMESTAMP
    })}catch(e){console.warn("雲端統計寫入失敗",e)}
  }

  async function startPresence(){
    try{presenceRef?.onDisconnect?.().cancel();presenceRef?.off()}catch(_){}
    presenceRef=null;const u=user();if(!u||!db)return;
    const ref=db.ref("presence/"+u.uid);presenceRef=ref;const cfg=settings();
    await ref.set({online:cfg.showOnline===true,lastSeen:firebase.database.ServerValue.TIMESTAMP,device:/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)?"mobile":"desktop"}).catch(()=>{});
    if(cfg.showOnline===true)await ref.onDisconnect().set({online:false,lastSeen:firebase.database.ServerValue.TIMESTAMP}).catch(()=>{});
  }

  async function presenceBeat(){
    const u=user();if(!u||!presenceRef)return;
    await presenceRef.update({online:settings().showOnline===true,lastSeen:firebase.database.ServerValue.TIMESTAMP}).catch(()=>{});
  }

  function allNotifications(){
    const arr=Array.isArray(local(LOCAL_NOTIF,[]))?local(LOCAL_NOTIF,[]):[];
    const map=new Map();arr.forEach(x=>{if(x?.id)map.set(String(x.id),x)});
    Object.entries(cloudNotifs||{}).forEach(([id,x])=>{if(x)map.set(id,Object.assign({id},x))});
    return [...map.values()].sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)).slice(0,100);
  }

  async function persistNotification(title,body,type){
    const u=user();if(!u||!db)return;
    try{
      await db.ref("notifications/"+u.uid).push({
        title:String(title||"通知").slice(0,120),body:String(body||"").slice(0,500),
        type:String(type||"system").slice(0,30),read:false,createdAt:firebase.database.ServerValue.TIMESTAMP
      })
    }catch(e){console.warn("通知雲端同步失敗",e)}
  }

  function patchPush(){
    const original=wt.pushNotification;
    if(typeof original!=="function"||original.__wtV3||original.__wtCloudPersistent)return;
    const wrapped=function(title,body,type){
      let r;try{r=original.apply(this,arguments)}catch(_){}
      void persistNotification(title,body,type);return r;
    };
    wrapped.__wtV3=true;wt.pushNotification=wrapped;
  }

  function startNotifications(){
    try{notifRef?.off()}catch(_){}
    notifRef=null;cloudNotifs={};notifReady=false;const u=user();if(!u||!db)return;
    const ref=db.ref("notifications/"+u.uid).limitToLast(100);notifRef=ref;
    ref.once("value").then(s=>{cloudNotifs=s.val()||{};notifReady=true}).catch(()=>{notifReady=true});
    ref.on("child_added",s=>{
      const x=s.val();if(!x)return;cloudNotifs[s.key]=x;
      if(notifReady&&x.read!==true&&settings().browserNotifications&&document.hidden){
        try{if("Notification"in window&&Notification.permission==="granted")new Notification(String(x.title||"WatchTogether"),{body:String(x.body||"").slice(0,160)})}catch(_){}
      }
    });
    ref.on("child_changed",s=>{if(s.val())cloudNotifs[s.key]=s.val()});
    ref.on("child_removed",s=>delete cloudNotifs[s.key]);
  }

  function modal(id,title,html){
    let m=$(id);
    if(!m){
      m=document.createElement("div");m.id=id;m.className="modal hidden";m.setAttribute("aria-hidden","true");
      m.innerHTML='<div class="modal-card wt-v3-card"><div class="wt-v3-head"><div class="panel-title"></div><button type="button" class="tiny-btn" data-v3-close>關閉</button></div><div class="wt-v3-body"></div></div>';
      document.body.appendChild(m);m.addEventListener("click",e=>{if(e.target===m)close(id)});m.querySelector("[data-v3-close]").onclick=()=>close(id);
    }
    m.querySelector(".panel-title").textContent=title;m.querySelector(".wt-v3-body").innerHTML=html;
    m.classList.remove("hidden");m.hidden=false;m.style.removeProperty("display");m.setAttribute("aria-hidden","false");document.body.classList.add("wt-modal-open");return m.querySelector(".wt-v3-body");
  }
  function close(id){const m=$(id);if(!m)return;m.classList.add("hidden");m.hidden=true;m.style.setProperty("display","none","important");m.setAttribute("aria-hidden","true")}

  function openNotifications(){
    const items=allNotifications(),unread=items.filter(x=>x.read!==true).length;
    const body=modal("wtV3NotificationsModal","通知中心（跨裝置）",
      '<div class="small muted">Google 帳號通知會同步；訪客通知只保留在本機。</div><div class="wt-v3-actions"><button id="v3ReadAll" class="secondary-btn">全部已讀</button><span class="small muted">未讀 '+unread+' 筆</span></div>'+
      '<div class="wt-v3-list">'+(items.length?items.map(x=>'<button type="button" class="wt-v3-row '+(x.read===true?'':'unread')+'" data-v3-nid="'+esc(x.id||"")+'"><div><strong>'+esc(x.title||"通知")+'</strong><span class="small">'+esc(x.body||"")+'</span><span class="small muted">'+esc(date(x.createdAt))+'</span></div></button>').join(""):'<div class="wt-v3-empty">目前沒有通知。</div>')+'</div>'
    );
    body.querySelectorAll("[data-v3-nid]").forEach(b=>b.onclick=async()=>{
      const u=user(),id=String(b.dataset.v3Nid||"");
      if(u&&db&&id){await db.ref("notifications/"+u.uid+"/"+safe(id)+"/read").set(true).catch(()=>{});if(cloudNotifs[id])cloudNotifs[id].read=true}
      const a=local(LOCAL_NOTIF,[]);if(Array.isArray(a)){const x=a.find(y=>String(y.id||"")===id);if(x)x.read=true;saveLocal(LOCAL_NOTIF,a)};openNotifications();
    });
    body.querySelector("#v3ReadAll").onclick=async()=>{
      const u=user();if(u&&db){const up={};Object.keys(cloudNotifs).forEach(id=>up[id+"/read"]=true);if(Object.keys(up).length)await db.ref("notifications/"+u.uid).update(up).catch(()=>{})}
      const a=local(LOCAL_NOTIF,[]);if(Array.isArray(a)){a.forEach(x=>x.read=true);saveLocal(LOCAL_NOTIF,a)};openNotifications();
    };
  }

  async function openCloudHistory(){
    await loadHistory();const h=mergedHistory();
    const body=modal("wtV3HistoryModal","雲端觀看紀錄",
      '<div class="small muted">最近 100 部影片，跨裝置同步。</div><div class="wt-v3-list">'+(h.length?h.map(x=>'<div class="wt-v3-row"><div><strong>'+esc(x.title||"未命名影片")+'</strong><span class="small muted">'+esc(String(x.platform||"").toUpperCase())+' · '+esc(x.channel||"")+' · '+esc(date(x.lastWatchedAt))+'</span></div><div class="wt-v3-actions"><button class="tiny-btn primary" data-v3-play="'+esc(key(x))+'">播放</button><button class="tiny-btn danger" data-v3-del="'+esc(String(x.platform||""))+'|'+esc(String(x.id||""))+'">刪除</button></div></div>').join(""):'<div class="wt-v3-empty">目前沒有雲端觀看紀錄。</div>')+'</div>'
    );
    body.querySelectorAll("[data-v3-play]").forEach(b=>b.onclick=async()=>{const x=h.find(v=>key(v)===b.dataset.v3Play);if(!x)return;try{if(st().roomId&&typeof core.changeVideo==="function")await core.changeVideo(x);else if(typeof core.createRoomWithVideo==="function")await core.createRoomWithVideo(x);close("wtV3HistoryModal")}catch(e){toast(e?.message||"播放失敗")}});
    body.querySelectorAll("[data-v3-del]").forEach(b=>b.onclick=async()=>{const [p,id]=String(b.dataset.v3Del||"").split("|"),u=user();if(u&&db){await db.ref("watchHistory/"+u.uid+"/"+safe(p+"_"+id)).remove().catch(()=>{})}openCloudHistory()});
  }

  async function openPresence(){
    const me=user();if(!me)return toast("Google 登入後才能查看好友在線狀態");
    const f=(await db.ref("friendships/"+me.uid).once("value").catch(()=>null))?.val?.()||{};
    const rows=[];
    for(const uid of Object.keys(f).slice(0,50)){
      const [pSnap,pr]=await Promise.all([db.ref("profiles/"+uid).once("value").catch(()=>null),db.ref("presence/"+uid).once("value").catch(()=>null)]);
      const p=pSnap?.val?.()||{},x=pr?.val?.()||{},live=x.online===true&&Number(x.lastSeen||0)>Date.now()-60000;
      rows.push('<div class="wt-v3-row"><div><strong>'+esc(p.displayName||"好友")+'</strong><span class="small muted">'+esc(uid)+'</span></div><span class="wt-v3-online '+(live?'on':'')+'">'+(live?'● 在線':'○ 離線')+(x.device?' · '+esc(x.device):'')+(x.lastSeen&&!live?' · '+esc(date(x.lastSeen)):'')+'</span></div>');
    }
    rows.sort((a,b)=>Number(b.includes("● 在線"))-Number(a.includes("● 在線")));
    modal("wtV3PresenceModal","好友在線狀態",'<div class="small muted">在線狀態只會讓好友查詢。可在完整設定關閉。</div><div class="wt-v3-list">'+(rows.length?rows.join(""):'<div class="wt-v3-empty">目前沒有好友。</div>')+'</div>');
  }

  async function openSettings(){
    const s=settings(),x=stats();
    const body=modal("wtV3SettingsModal","完整使用設定",
      '<div class="wt-v3-grid">'+
      '<label class="wt-v3-check"><input id="v3Online" type="checkbox" '+(s.showOnline?'checked':'')+'> 顯示在線狀態</label>'+
      '<label class="wt-v3-check"><input id="v3Browser" type="checkbox" '+(s.browserNotifications?'checked':'')+'> 瀏覽器通知</label>'+
      '<label class="wt-v3-check"><input id="v3History" type="checkbox" '+(s.cloudHistory?'checked':'')+'> 雲端觀看紀錄</label>'+
      '<label class="wt-v3-check"><input id="v3Stats" type="checkbox" '+(s.cloudStats?'checked':'')+'> 雲端統計</label></div>'+
      '<div class="wt-v3-stat-grid"><div class="wt-v3-stat"><span>觀看時間</span><strong>'+esc(dur(x.watchSeconds))+'</strong></div><div class="wt-v3-stat"><span>影片</span><strong>'+esc(x.videosStarted)+'</strong></div><div class="wt-v3-stat"><span>房間</span><strong>'+esc(x.roomsJoined)+'</strong></div><div class="wt-v3-stat"><span>訊息</span><strong>'+esc(x.messagesSent)+'</strong></div></div>'+
      '<div class="wt-v3-actions"><button id="v3NotifyPerm" class="secondary-btn">允許瀏覽器通知</button><button id="v3Export" class="secondary-btn">匯出完整資料</button><button id="v3Save" class="primary-btn">儲存設定</button></div>'
    );
    body.querySelector("#v3NotifyPerm").onclick=async()=>{if(!("Notification"in window))return toast("此瀏覽器不支援通知");const p=await Notification.requestPermission().catch(()=> "denied");toast(p==="granted"?"通知已啟用":"通知沒有啟用")};
    body.querySelector("#v3Export").onclick=async()=>{
      const u=user(),data={exportedAt:new Date().toISOString(),settings:s,localStats:x,localHistory:local(LOCAL_HIST,[]),cloudHistory:mergedHistory(),notifications:allNotifications()};
      if(u&&db){data.profile=(await db.ref("profiles/"+u.uid).once("value").catch(()=>null))?.val?.()||null;data.friendships=(await db.ref("friendships/"+u.uid).once("value").catch(()=>null))?.val?.()||{}}
      const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="watchtogether-data-"+Date.now()+".json";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    body.querySelector("#v3Save").onclick=async()=>{
      const n={showOnline:$("v3Online").checked,browserNotifications:$("v3Browser").checked,cloudHistory:$("v3History").checked,cloudStats:$("v3Stats").checked};saveLocal(SET_KEY,n);
      const u=user();if(u&&db)await db.ref("userSettings/"+u.uid).update({...n,updatedAt:firebase.database.ServerValue.TIMESTAMP}).catch(e=>toast(e?.message||"設定同步失敗"));
      await startPresence();await loadHistory();toast("設定已儲存");close("wtV3SettingsModal");
    };
  }

  function track(){
    setInterval(()=>{
      const s=st(),v=video(),x=stats();
      if(s.roomId&&String(s.roomId)!==lastTrackedRoom){
        lastTrackedRoom=String(s.roomId);
        let seen=[];try{seen=JSON.parse(sessionStorage.getItem("wt_v3_rooms_seen")||"[]")}catch(_){}
        if(!Array.isArray(seen))seen=[];
        if(!seen.includes(lastTrackedRoom)){seen.push(lastTrackedRoom);while(seen.length>50)seen.shift();try{sessionStorage.setItem("wt_v3_rooms_seen",JSON.stringify(seen))}catch(_){}x.roomsJoined=Number(x.roomsJoined||0)+1;}
      }
      const vk=key(v);
      if(vk&&vk!==lastTrackedVideo){
        lastTrackedVideo=vk;
        let seen=[];try{seen=JSON.parse(sessionStorage.getItem("wt_v3_videos_seen")||"[]")}catch(_){}
        if(!Array.isArray(seen))seen=[];
        if(!seen.includes(vk)){seen.push(vk);while(seen.length>100)seen.shift();try{sessionStorage.setItem("wt_v3_videos_seen",JSON.stringify(seen))}catch(_){}x.videosStarted=Number(x.videosStarted||0)+1;const p=String(v.platform||"youtube").toLowerCase();x.platformStarts[p]=Number(x.platformStarts[p]||0)+1;}
      }
      if(v?.id&&s.isPlaying){x.watchSeconds=Number(x.watchSeconds||0)+5;x.lastAt=Date.now();saveLocal(LOCAL_STATS,x);void recordCloudHistory(false);void syncStats();}
      else if(Number(x.roomsJoined||0)>0||Number(x.videosStarted||0)>0){saveLocal(LOCAL_STATS,x);void syncStats();}
    },5000);
  }

  function init(){
    if(document.documentElement.dataset.wtV3Init)return;
    document.documentElement.dataset.wtV3Init="1";
    const style=document.createElement("style");style.id="wtV3Style";style.textContent='.wt-v3-card{width:min(920px,calc(100vw - 24px));max-height:90vh;overflow:auto}.wt-v3-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.wt-v3-list{display:grid;gap:8px}.wt-v3-row{width:100%;display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(15,23,42,.28);color:inherit;text-align:left}.wt-v3-row.unread{border-color:rgba(96,165,250,.45)}.wt-v3-row>div{display:grid;gap:3px;min-width:0}.wt-v3-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}.wt-v3-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.wt-v3-check{display:flex;gap:8px;align-items:center;padding:11px;border:1px solid rgba(148,163,184,.14);border-radius:12px}.wt-v3-stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px}.wt-v3-stat{padding:10px;border:1px solid rgba(148,163,184,.14);border-radius:12px}.wt-v3-stat span{display:block;font-size:11px;color:#94a3b8}.wt-v3-stat strong{display:block;margin-top:4px}.wt-v3-online{font-size:12px;color:#94a3b8;white-space:nowrap}.wt-v3-online.on{color:#86efac}.wt-v3-empty{padding:18px;text-align:center;color:#94a3b8}@media(max-width:650px){.wt-v3-stat-grid{grid-template-columns:1fr 1fr}}@media(max-width:430px){.wt-v3-grid,.wt-v3-stat-grid{grid-template-columns:1fr}}';document.head.appendChild(style);
    patchPush();startNotifications();void loadUserSettings().then(()=>startPresence());void loadHistory();track();setInterval(()=>{ensureTopbar();patchPush();void presenceBeat()},25000);ensureTopbar();
    auth?.onAuthStateChanged?.(u=>{startNotifications();void loadUserSettings().then(()=>startPresence());if(u&&!u.isAnonymous)void loadHistory()});
  }

  function ensureTopbar(){
    const bar=document.querySelector(".topbar-right");if(!bar)return;
    const add=(id,t,fn)=>{if($(id))return;const b=document.createElement("button");b.id=id;b.type="button";b.className="wt-nav-btn";b.textContent=t;b.addEventListener("click",fn);const a=$("googleLoginBtn");bar.insertBefore(b,a||null)};
    add("wtV3NotifBtn","🔔 雲端通知",openNotifications);
    add("wtV3PresenceBtn","🟢 好友在線",()=>void openPresence());
    add("wtV3HistoryBtn","☁️ 雲端紀錄",()=>void openCloudHistory());
    add("wtV3SettingsBtn","⚙️ 完整設定",()=>void openSettings());
  }

  wt.openCloudHistory=openCloudHistory;wt.openFriendPresence=openPresence;wt.openCompleteSettings=openSettings;wt.openSyncedNotifications=openNotifications;wt.persistNotification=persistNotification;wt.recordCloudHistory=recordCloudHistory;
  window.WT_FEATURE_COMPLETE_V3={openCloudHistory,openFriendPresence:openPresence,openCompleteSettings:openSettings,openSyncedNotifications:openNotifications,persistNotification,recordCloudHistory};

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();