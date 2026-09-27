(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const DB=()=>window.db||window.firebase?.database?.();
  const state={maintenance:null,chart:null,restrictionSelection:new Set(),rolePermissions:new Set()};
  const features=[
    ["建立房間","create_room"],["加入公開房間","join_public_room"],["聊天室","chat"],["AI","ai"],["AI Agent","ai_agent"],
    ["檔案/圖片上傳","uploads"],["好友系統","friends"],["投票","polls"],["播放清單","playlists"],["公開房間探索","public_explore"]
  ];
  const permissions=["users.view","users.ban","rooms.view","rooms.manage","reports.handle","chat.moderate","analytics.view","settings.edit","maintenance.manage","restrictions.manage","roles.manage","ai.use","audit.view"];

  function isAdminContext(){
    const text=(document.querySelector("#adminAccount")?.textContent||"").toLowerCase();
    return Boolean(text && !text.includes("—"));
  }
  function showSection(name){
    document.querySelectorAll("#app .admin-section").forEach(s=>s.classList.toggle("hidden",s.id!=="section-"+name));
    document.querySelectorAll("#app .nav-item[data-section]").forEach(b=>b.classList.toggle("active",b.dataset.section===name));
    try{history.replaceState(null,"","#"+name);sessionStorage.setItem("watchtogether-admin-section",name)}catch(_){}
  }
  function addNav(name,label,icon){
    const sidebar=document.querySelector("#app .sidebar");if(!sidebar||sidebar.querySelector('[data-section="'+name+'"]'))return;
    const b=document.createElement("button");b.type="button";b.className="nav-item";b.dataset.section=name;b.textContent=(icon?icon+" ":"")+label;sidebar.appendChild(b);
  }
  function addSection(name,html){
    const content=document.querySelector("#app .content");if(!content||$( "section-"+name))return;
    const s=document.createElement("section");s.id="section-"+name;s.className="admin-section hidden";s.innerHTML=html;content.appendChild(s);
  }
  function bindNav(){
    document.querySelectorAll("#app .nav-item[data-section]").forEach(b=>{
      if(b.dataset.wt2Bound==="1")return;b.dataset.wt2Bound="1";
      b.addEventListener("click",()=>showSection(b.dataset.section));
    });
  }
  function renderNewUI(){
    [
      ["security","安全中心","🛡️"],["analytics","Analytics","📊"],["maintenance","維護中心","🔴"],
      ["restrictions","使用者功能限制","🚫"],["roles","角色與權限","👑"],["ai","AI 管理中心","🤖"],
      ["debug","Debug Center","🐛"],["versions","版本中心","🚀"],["settings","系統設定","⚙️"]
    ].forEach(x=>addNav(x[0],x[1],x[2]));
    addSection("security",'<div class="section-head"><div><div class="eyebrow">SECURITY CENTER</div><h2>安全中心</h2></div><button class="btn primary" id="ad2SecurityRefresh">重新整理</button></div><div class="ad2-grid cols-4"><div class="ad2-card"><div class="ad2-kicker">AUTH</div><div class="ad2-kpi" id="ad2SecAccounts">—</div><div class="ad2-muted">目前帳號</div></div><div class="ad2-card"><div class="ad2-kicker">BLOCKS</div><div class="ad2-kpi" id="ad2SecBlocked">—</div><div class="ad2-muted">封鎖帳號</div></div><div class="ad2-card"><div class="ad2-kicker">REPORTS</div><div class="ad2-kpi" id="ad2SecReports">—</div><div class="ad2-muted">待處理回報</div></div><div class="ad2-card"><div class="ad2-kicker">MAINTENANCE</div><div class="ad2-kpi" id="ad2SecMaintenance">—</div><div class="ad2-muted">網站狀態</div></div></div><div class="ad2-card" style="margin-top:14px"><h3>安全控制項</h3><div class="ad2-list" id="ad2SecurityList"></div></div>');
    addSection("analytics",'<div class="section-head"><div><div class="eyebrow">ANALYTICS</div><h2>Analytics</h2></div></div><div class="ad2-grid cols-2"><div class="ad2-card"><h3>平台概況</h3><canvas id="ad2StatsChart" height="130"></canvas></div><div class="ad2-card"><h3>資料說明</h3><p>這裡只繪製目前 Admin 已讀取到的資料，不用假數據填圖。後續可再接 DAU、WAU、MAU、觀看時長等事件統計。</p><div class="ad2-list" id="ad2AnalyticsList"></div></div></div>');
    addSection("maintenance",'<div class="section-head"><div><div class="eyebrow">MAINTENANCE CENTER</div><h2>網站維護 / 關站</h2></div><button class="btn" id="ad2MaintenanceReload">重新讀取</button></div><div class="ad2-grid cols-2"><div class="ad2-card"><div class="ad2-row"><div><div class="ad2-kicker">CURRENT STATUS</div><h3 id="ad2MaintStatus">讀取中…</h3></div><span id="ad2MaintChip" class="ad2-chip off">OFF</span></div><div class="ad2-list"><div class="ad2-list-row"><strong>開始時間</strong><span id="ad2MaintStart">—</span></div><div class="ad2-list-row"><strong>預計恢復</strong><span id="ad2MaintEnd">—</span></div></div></div><div class="ad2-card ad2-danger"><h3>🔴 關閉網站</h3><p>這會啟用全站維護畫面。一般使用者被擋下，管理員仍可進入 Admin。</p><div class="ad2-form"><label>維護原因<input id="ad2MaintMessage" maxlength="200" placeholder="例如：系統更新"></label><label>預計恢復時間<input id="ad2MaintEnds" type="datetime-local"></label><label>維護密碼<input id="ad2MaintPassword" type="password" autocomplete="current-password" placeholder="輸入已設定的維護密碼"></label><div class="ad2-confirm-box">按下確認前會再次詢問「確定要關閉網站嗎？」；密碼通過後才會寫入維護狀態。</div><div class="ad2-row"><button class="btn" id="ad2SetPasswordBtn">設定/變更維護密碼</button><button class="btn danger" id="ad2CloseSiteBtn">🔴 確定要關閉網站嗎？</button></div><button class="btn primary" id="ad2OpenSiteBtn">🟢 恢復網站</button><div class="ad2-muted" id="ad2MaintHint"></div></div></div></div>');
    addSection("restrictions",'<div class="section-head"><div><div class="eyebrow">USER RESTRICTIONS</div><h2>指定使用者功能限制</h2></div><button class="btn" id="ad2RestrictionReload">重新讀取</button></div><div class="ad2-grid cols-2"><div class="ad2-card"><div class="ad2-form"><label>使用者 UID<input id="ad2RestrictionUid" placeholder="Google 使用者 UID"></label><label>限制時間<select id="ad2RestrictionDuration"><option value="permanent">永久</option><option value="3600000">1 小時</option><option value="86400000">1 天</option><option value="604800000">7 天</option><option value="2592000000">30 天</option></select></label><label>原因<textarea id="ad2RestrictionReason" maxlength="300" placeholder="限制原因"></textarea></label></div><h3 style="margin-top:14px">限制功能</h3><div class="ad2-checks" id="ad2RestrictionChecks"></div><div class="ad2-row" style="margin-top:12px"><button class="btn danger" id="ad2ApplyRestriction">套用限制</button><button class="btn" id="ad2ClearRestriction">解除限制</button></div><div class="ad2-muted" id="ad2RestrictionHint"></div></div><div class="ad2-card"><h3>目前限制</h3><div id="ad2RestrictionCurrent" class="ad2-list"><div class="ad2-muted">輸入 UID 後讀取。</div></div></div></div>');
    addSection("roles",'<div class="section-head"><div><div class="eyebrow">ROLES & PERMISSIONS</div><h2>角色與權限</h2></div></div><div class="ad2-grid cols-2"><div class="ad2-card"><h3>角色</h3><div class="ad2-list"><div class="ad2-list-row"><strong>Super Admin</strong><span>全部權限</span></div><div class="ad2-list-row"><strong>Admin</strong><span>管理核心功能</span></div><div class="ad2-list-row"><strong>Moderator</strong><span>房間 / Chat / 檢舉</span></div><div class="ad2-list-row"><strong>Support</strong><span>使用者支援</span></div><div class="ad2-list-row"><strong>Analyst</strong><span>僅統計與稽核</span></div></div><p class="ad2-muted" style="margin-top:10px">角色資料會集中於 Admin 2.0；同角色使用者自動同步權限，另可加個別禁止項目。</p></div><div class="ad2-card"><h3>目前權限模型</h3><div class="ad2-checks" id="ad2PermissionChecks"></div><div class="ad2-row" style="margin-top:12px"><button class="btn" id="ad2CopyRoleBtn">複製目前角色權限</button><button class="btn primary" id="ad2SaveRoleBtn">儲存角色</button></div></div></div>');
    addSection("ai",'<div class="section-head"><div><div class="eyebrow">AI CENTER</div><h2>AI 管理中心</h2></div></div><div class="ad2-grid cols-3"><div class="ad2-card"><h3>🧠 診斷</h3><p>分析錯誤、檢舉、房間與 API 異常。</p></div><div class="ad2-card"><h3>🔎 查詢</h3><p>用自然語言查 Admin 已授權資料。</p></div><div class="ad2-card"><h3>⚙️ Agent</h3><p>可執行管理工具，但刪除、停權、關站等高風險操作仍需人工確認。</p></div></div><div class="ad2-card" style="margin-top:14px"><div class="ad2-form"><label>詢問 AI<textarea id="ad2AiPrompt" placeholder="例如：最近有哪些房間異常？"></textarea></label><button class="btn primary" id="ad2AiAsk">送出分析</button></div><div id="ad2AiOutput" class="ad2-code" style="margin-top:12px"></div></div>');
    addSection("debug",'<div class="section-head"><div><div class="eyebrow">DEBUG CENTER</div><h2>Debug Center</h2></div><button class="btn" id="ad2DebugRefresh">重新整理</button></div><div class="ad2-card"><div class="ad2-list" id="ad2DebugList"></div></div>');
    addSection("versions",'<div class="section-head"><div><div class="eyebrow">VERSION CENTER</div><h2>版本中心</h2></div></div><div class="ad2-card"><div class="ad2-list"><div class="ad2-list-row"><strong>目前前台 build</strong><span id="ad2Build">—</span></div><div class="ad2-list-row"><strong>目前 Admin build</strong><span>20260927-admin-v30</span></div><div class="ad2-list-row"><strong>下一階段</strong><span>2.0 功能模組逐項接入</span></div></div></div>');
    addSection("settings",'<div class="section-head"><div><div class="eyebrow">SYSTEM SETTINGS</div><h2>系統設定</h2></div></div><div class="ad2-grid cols-2"><div class="ad2-card"><h3>功能旗標</h3><div class="ad2-list" id="ad2FeatureFlags"></div></div><div class="ad2-card"><h3>系統資訊</h3><div class="ad2-list"><div class="ad2-list-row"><strong>Firebase</strong><span>Realtime Database + Auth</span></div><div class="ad2-list-row"><strong>YouTube 搜尋</strong><span>Cloudflare Worker Proxy</span></div><div class="ad2-list-row"><strong>UI Base</strong><span>Tabler 1.6</span></div></div></div></div>');
  }

  function renderFeatureChecks(){
    const wrap=$("ad2RestrictionChecks");if(wrap)wrap.innerHTML=features.map(([label,key])=>'<label class="ad2-check"><input type="checkbox" data-feature="'+key+'"> '+label+"</label>").join("");
    const pw=$("ad2PermissionChecks");if(pw)pw.innerHTML=permissions.map(p=>'<label class="ad2-check"><input type="checkbox" data-permission="'+p+'"> '+p+"</label>").join("");
    const ff=$("ad2FeatureFlags");if(ff)ff.innerHTML=features.map(([label,key])=>'<div class="ad2-list-row"><strong>'+label+'</strong><span class="ad2-chip on">ON</span></div>').join("");
  }

  function readStat(id){return Number(($(id)?.textContent||"").replace(/[^d.-]/g,""))||0}
  function renderAnalytics(){
    const data=[readStat("statAccounts"),readStat("statWhitelist"),readStat("statBlocked"),readStat("statRooms")];
    const labels=["帳號","白名單","封鎖","房間"];
    const list=$("ad2AnalyticsList");if(list)list.innerHTML=labels.map((x,i)=>'<div class="ad2-list-row"><strong>'+x+'</strong><span>'+data[i]+"</span></div>").join("");
    if(!window.Chart||!$("ad2StatsChart"))return;
    if(state.chart)state.chart.destroy();
    state.chart=new Chart($("ad2StatsChart").getContext("2d"),{type:"bar",data:{labels,datasets:[{label:"目前資料",data,borderWidth:1}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
  }

  function renderSecurity(){ if($("ad2SecAccounts"))$("ad2SecAccounts").textContent=readStat("statAccounts"); if($("ad2SecBlocked"))$("ad2SecBlocked").textContent=readStat("statBlocked"); if($("ad2SecReports"))$("ad2SecReports").textContent=readStat("statOpenReports"); if($("ad2SecMaintenance"))$("ad2SecMaintenance").textContent=state.maintenance?.enabled?"ON":"OFF"; const list=$("ad2SecurityList"); if(list)list.innerHTML=["Google Auth","Firebase Rules","Admin Whitelist","Audit Log","Maintenance Lock","User Restrictions"].map(x=>'<div class="ad2-list-row"><strong>'+x+'</strong><span class="ad2-chip on">ENABLED</span></div>').join(""); }

  async function readMaintenance(){
    const db=DB();if(!db)return;
    try{const snap=await db.ref("system/maintenance").once("value");state.maintenance=snap.val()||{enabled:false};}
    catch(e){state.maintenance={enabled:false};}
    const m=state.maintenance;
    if($("ad2MaintStatus"))$("ad2MaintStatus").textContent=m.enabled?"🔴 維護中":"🟢 正常運行";
    if($("ad2MaintChip")){$("ad2MaintChip").textContent=m.enabled?"ON":"OFF";$("ad2MaintChip").className="ad2-chip "+(m.enabled?"on":"off")}
    if($("ad2MaintStart"))$("ad2MaintStart").textContent=m.startedAt?new Date(Number(m.startedAt)).toLocaleString():"—";
    if($("ad2MaintEnd"))$("ad2MaintEnd").textContent=m.endsAt?new Date(Number(m.endsAt)).toLocaleString():"—";
  }

  async function derivePBKDF2(password,salt,iterations=120000){
    const enc=new TextEncoder();
    const base=await crypto.subtle.importKey("raw",enc.encode(password),{name:"PBKDF2"},false,["deriveBits"]);
    const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt,iterations,hash:"SHA-256"},base,256);
    return Array.from(new Uint8Array(bits)).map(x=>x.toString(16).padStart(2,"0")).join("");
  }
  function b64(buf){let s="";new Uint8Array(buf).forEach(x=>s+=String.fromCharCode(x));return btoa(s)}
  async function hashPassword(password,saltB64,iterations){const salt=Uint8Array.from(atob(saltB64),c=>c.charCodeAt(0));return derivePBKDF2(password,salt,iterations)}
  async function credentialRef(){return DB().ref("admin/security/maintenanceCredential")}
  async function getCredential(){try{const s=await (await credentialRef()).once("value");return s.val()||null}catch(_){return null}}
  async function verifyPassword(password){
    const c=await getCredential();if(!c)return false;
    return (await hashPassword(password,c.salt,c.iterations))===String(c.hash||"");
  }
  async function setPassword(){
    const password=prompt("請設定新的維護密碼（至少 8 個字元）：")||"";
    if(password.length<8){alert("密碼至少 8 個字元");return}
    const salt=new Uint8Array(16);crypto.getRandomValues(salt);const saltB64=b64(salt),iterations=120000,hash=await derivePBKDF2(password,salt,iterations);
    await (await credentialRef()).set({hash,salt:saltB64,iterations,updatedAt:Date.now()});
    if($("ad2MaintHint"))$("ad2MaintHint").textContent="維護密碼已更新。"; 
  }
  async function closeSite(){
    const message=String($("ad2MaintMessage")?.value||"系統維護").trim()||"系統維護";
    const raw=$("ad2MaintEnds")?.value||"";
    const ends=raw?Date.parse(raw):0;
    const password=$("ad2MaintPassword")?.value||"";
    if(!confirm("確定要關閉網站嗎？"))return;
    if(!password){$("ad2MaintHint").textContent="請輸入維護密碼。";return}
    if(!await verifyPassword(password)){$("ad2MaintHint").textContent="維護密碼錯誤，沒有關站。";return}
    await DB().ref("system/maintenance").set({enabled:true,mode:"maintenance",message,startedAt:Date.now(),endsAt:Number.isFinite(ends)?ends:0,updatedAt:Date.now(),updatedBy:window.firebase?.auth?.().currentUser?.uid||""});
    await readMaintenance();
    $("ad2MaintPassword").value="";
    $("ad2MaintHint").textContent="網站已進入維護模式。";
  }
  async function openSite(){
    if(!confirm("確定要恢復網站嗎？"))return;
    const password=$("ad2MaintPassword")?.value||"";
    if(!password){$("ad2MaintHint").textContent="請輸入維護密碼後再恢復網站。";return}
    if(!await verifyPassword(password)){$("ad2MaintHint").textContent="維護密碼錯誤。";return}
    await DB().ref("system/maintenance").set({enabled:false,updatedAt:Date.now(),updatedBy:window.firebase?.auth?.().currentUser?.uid||""});
    await readMaintenance();$("ad2MaintPassword").value="";$("ad2MaintHint").textContent="網站已恢復。";
  }

  async function loadRestriction(){
    const uid=String($("ad2RestrictionUid")?.value||"").trim();const box=$("ad2RestrictionCurrent");if(!uid||!box)return;
    try{const s=await DB().ref("admin/restrictionsByUid/"+uid).once("value");const v=s.val(); if(!v){box.innerHTML='<div class="ad2-muted">目前沒有功能限制。</div>';return}
      box.innerHTML=Object.entries(v.features||{}).filter(([,x])=>x===true).map(([k])=>'<div class="ad2-list-row"><strong>'+k+'</strong><span class="ad2-chip off">BLOCKED</span></div>').join("")||'<div class="ad2-muted">沒有啟用中的功能限制。</div>';
      document.querySelectorAll("#ad2RestrictionChecks input").forEach(x=>x.checked=v.features?.[x.dataset.feature]===true);
    }catch(e){box.innerHTML='<div class="ad2-muted">無法讀取限制資料。</div>'}
  }
  async function applyRestriction(clear=false){
    const uid=String($("ad2RestrictionUid")?.value||"").trim();if(!uid){$("ad2RestrictionHint").textContent="請輸入 UID。";return}
    const featuresOut={};document.querySelectorAll("#ad2RestrictionChecks input").forEach(x=>featuresOut[x.dataset.feature]=x.checked);
    if(clear)Object.keys(featuresOut).forEach(k=>featuresOut[k]=false);
    const duration=$("ad2RestrictionDuration")?.value||"permanent";const until=duration==="permanent"?0:Date.now()+Number(duration);
    await DB().ref("admin/restrictionsByUid/"+uid).set({features:featuresOut,reason:String($("ad2RestrictionReason")?.value||"").trim().slice(0,300),blockedUntil:until,updatedAt:Date.now(),updatedBy:window.firebase?.auth?.().currentUser?.uid||""});
    $("ad2RestrictionHint").textContent=clear?"限制已解除。":"功能限制已套用。";await loadRestriction();
  }
  function refreshAll(){renderAnalytics();renderSecurity();readMaintenance();loadRestriction();}
  function boot(){
    if(!document.querySelector("#app"))return;
    renderNewUI();renderFeatureChecks();bindNav();
    $("ad2MaintenanceReload")?.addEventListener("click",readMaintenance);
    $("ad2SetPasswordBtn")?.addEventListener("click",()=>setPassword().catch(e=>{console.error(e);$("ad2MaintHint").textContent="設定密碼失敗。"}));
    $("ad2CloseSiteBtn")?.addEventListener("click",()=>closeSite().catch(e=>{console.error(e);$("ad2MaintHint").textContent=e?.message||"關站失敗。"}));
    $("ad2OpenSiteBtn")?.addEventListener("click",()=>openSite().catch(e=>{console.error(e);$("ad2MaintHint").textContent=e?.message||"恢復網站失敗。"}));
    $("ad2RestrictionUid")?.addEventListener("change",loadRestriction);
    $("ad2RestrictionReload")?.addEventListener("click",loadRestriction);
    $("ad2ApplyRestriction")?.addEventListener("click",()=>applyRestriction(false).catch(e=>{console.error(e);$("ad2RestrictionHint").textContent="套用失敗。"}));
    $("ad2ClearRestriction")?.addEventListener("click",()=>applyRestriction(true).catch(e=>{console.error(e);$("ad2RestrictionHint").textContent="解除失敗。"}));
    $("ad2SecurityRefresh")?.addEventListener("click",refreshAll);
    $("ad2DebugRefresh")?.addEventListener("click",()=>{
      const el=$("ad2DebugList");if(el)el.innerHTML=(window.__WT_EARLY_ERRORS__||[]).slice(-20).map(x=>'<div class="ad2-list-row"><strong>'+String(x.message||"Unknown").replace(/[<>]/g,"")+'</strong><span>'+String(x.source||"unknown")+"</span></div>").join("")||'<div class="ad2-muted">目前沒有前端 Early Errors。</div>';
    });
    $("ad2Build")&&( $("ad2Build").textContent=window.__WATCHTOGETHER_BUILD__||"—");
    $("ad2AiAsk")?.addEventListener("click",()=>{$("ad2AiOutput").textContent="AI 管理代理的工具層已預留；目前這個 UI 不會假裝有分析結果。下一階段會接入真正的 AI Core / tools。"});
    $("ad2CopyRoleBtn")?.addEventListener("click",()=>{document.querySelectorAll("#ad2PermissionChecks input").forEach(x=>x.checked=true);});
    $("ad2SaveRoleBtn")?.addEventListener("click",()=>alert("角色 UI 已建立；角色資料模型與 Firebase Rules 將在下一個資料層提交中。"));
    const denied=new MutationObserver(()=>{const d=$("deniedScreen"),s=$("setupScreen");if((d&&!d.classList.contains("hidden"))||(s&&!s.classList.contains("hidden"))){try{location.replace("../404.html")}catch(_){}}});
    denied.observe(document.body,{subtree:true,attributes:true,attributeFilter:["class"]});
    refreshAll();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();