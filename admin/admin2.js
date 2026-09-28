(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const DB=()=>window.db||window.firebase?.database?.();
  const state={maintenance:null,chart:null,restrictionSelection:new Set(),rolePermissions:new Set(),customRoleId:"",customPermissions:new Set(),hasCustomRole:false,permissionOverrides:{allow:{},deny:{}}};
  const features=[
    ["建立房間","create_room"],["加入公開房間","join_public_room"],["聊天室","chat"],["播放控制","playback_control"],["AI","ai"],["AI Agent","ai_agent"],
    ["檔案/圖片上傳","uploads"],["好友系統","friends"],["投票","polls"],["播放清單","playlists"],["公開房間探索","public_explore"],["預約觀看","schedules"],["YouTube 搜尋","youtube_search"],["聊天翻譯","translation"]
  ];
  const permissions=["users.view","users.ban","users.manage","rooms.view","rooms.manage","reports.handle","chat.moderate","analytics.view","settings.edit","maintenance.manage","maintenance.autonomous","restrictions.manage","roles.manage","whitelist.manage","ai.use","audit.view","audit.delete"];

  const PERMISSION_DB_KEYS = Object.fromEntries(permissions.map(p=>[p,p.replace(/\./g,"__")]));
  function encodePermissions(source){
    const out={};
    Object.entries(source||{}).forEach(([key,value])=>{
      const dbKey=PERMISSION_DB_KEYS[key]||String(key||"").replace(/[^A-Za-z0-9_-]/g,"__");
      if(value===true) out[dbKey]=true;
    });
    return out;
  }
  function decodePermissions(source){
    const out={};
    Object.entries(source||{}).forEach(([key,value])=>{
      if(value!==true)return;
      const match=Object.entries(PERMISSION_DB_KEYS).find(([,dbKey])=>dbKey===key);
      if(match) out[match[0]]=true;
    });
    return out;
  }
  function isAdminContext(){
    const text=(document.querySelector("#adminAccount")?.textContent||"").toLowerCase();
    return Boolean(text && !text.includes("—"));
  }
  function showSection(name){
    document.querySelectorAll("#app .admin-section").forEach(s=>s.classList.toggle("hidden",s.id!=="section-"+name));
    document.querySelectorAll("#app .nav-item[data-section]").forEach(b=>b.classList.toggle("active",b.dataset.section===name));
    try{history.replaceState(null,"","#"+name);sessionStorage.setItem("watchtogether-admin-section",name)}catch(_){}
  }
  function isMaster(){
    const user=window.firebase?.auth?.().currentUser;
    return Boolean(
      user &&
      (String(user.email||"").trim().toLowerCase()==="a0983439343@gmail.com" ||
       String(user.uid||"")==="35d45a23-b648-4caf-a6d5-a69112860551")
    );
  }

  function hasPermission(permission){
    if(isMaster())return true;
    if(state.permissionOverrides?.deny?.[permission]===true)return false;
    if(state.permissionOverrides?.allow?.[permission]===true)return true;
    const role=String(window.WT2_ADMIN_ROLE||window.WT_ADMIN_CONTEXT?.getRole?.()||"").trim().toLowerCase();
    if(role==="viewer"){
      return new Set(["users.view","rooms.view","analytics.view","audit.view"]).has(permission);
    }
    if(!state.hasCustomRole) return permission === "roles.manage" ? false : true;
    return state.customPermissions.has(permission);
  }

  async function loadAdminPermissionContext(){
    const db=DB(),user=window.firebase?.auth?.().currentUser;
    if(!db||!user||user.isAnonymous)return;
    if(isMaster()){
      state.hasCustomRole=false;
      state.customPermissions=new Set();
      state.permissionOverrides={allow:{},deny:{}};
      return;
    }
    try{
      const roleSnap=await db.ref("admin/userRoles/"+user.uid).once("value");
      const roleId=String(roleSnap.val()?.roleId||"").trim();
      state.customRoleId=roleId;
      state.hasCustomRole=Boolean(roleId);
      state.customPermissions=new Set();

      if(roleId){
        const roleSnap2=await db.ref("admin/roles/"+roleId).once("value");
        const role=roleSnap2.val()||{};
        state.customPermissions=new Set(Object.keys(decodePermissions(role.permissions||{})));
      }

      const overrideSnap=await db.ref("admin/userPermissionOverrides/"+user.uid).once("value").catch(()=>null);
      const override=overrideSnap?.val?.()||{};
      state.permissionOverrides={
        allow:decodePermissions(override.allow||{}),
        deny:decodePermissions(override.deny||{})
      };
    }catch(error){
      console.warn("[WT2 Admin] role/override context:",error);
      state.hasCustomRole=false;
      state.customPermissions=new Set();
      state.permissionOverrides={allow:{},deny:{}};
    }
  }

  function applyPermissionVisibility(){
    const sectionPermissions={
      accounts:"users.view",
      rooms:"rooms.view",
      whitelist:"whitelist.manage",
      reports:"reports.handle",
      audit:"audit.view",
      security:"audit.view",
      analytics:"analytics.view",
      maintenance:"maintenance.manage",
      restrictions:"restrictions.manage",
      roles:"roles.manage",
      ai:"ai.use",
      debug:"audit.view",
      versions:"settings.edit",
      settings:"settings.edit"
    };
    Object.entries(sectionPermissions).forEach(([section,permission])=>{
      const allowed=hasPermission(permission);
      document.querySelectorAll('#app [data-section="'+section+'"]').forEach(node=>{
        node.classList.toggle("hidden",!allowed);
      });
      if(section === "accounts" || section === "rooms" || section === "reports"){
        // Fine-grained button visibility for legacy Admin 2.0 sections is applied below.
      }
      const sectionNode=$("section-"+section);
      if(sectionNode && !allowed)sectionNode.classList.add("hidden");
    });
  }

  function publishPermissionContext(){
    window.__WT2_ADMIN_PERMISSION_CONTEXT__={
      hasCustomRole:Boolean(state.hasCustomRole),
      roleId:String(state.customRoleId||""),
      permissions:Array.from(state.customPermissions||[]),
      allow:Object.assign({},state.permissionOverrides?.allow||{}),
      deny:Object.assign({},state.permissionOverrides?.deny||{}),
      baseRole:String(window.WT2_ADMIN_ROLE||window.WT_ADMIN_CONTEXT?.getRole?.()||"")
    };
    window.dispatchEvent(new Event("wt2-admin-permission-ready"));
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
    addSection("maintenance",'<div class="section-head"><div><div class="eyebrow">MAINTENANCE CENTER</div><h2>網站維護 / 關站</h2></div><button class="btn" id="ad2MaintenanceReload">重新讀取</button></div><div class="ad2-card" style="margin-bottom:14px"><div class="ad2-form"><label>Admin Control Worker URL<input id="ad2MaintWorkerUrl" type="url" placeholder="https://你的-worker.workers.dev" autocomplete="off"></label><div class="ad2-row"><button class="btn" id="ad2MaintSetWorkerUrl">設定 Worker URL</button><button class="btn" id="ad2MaintTestWorkerUrl">測試連線</button><span class="ad2-muted">網址會同步儲存在 Admin 設定；真正的關站仍由 Worker + Firebase Token 驗證。</span></div></div></div><div class="ad2-grid cols-2"><div class="ad2-card"><div class="ad2-row"><div><div class="ad2-kicker">CURRENT STATUS</div><h3 id="ad2MaintStatus">讀取中…</h3></div><span id="ad2MaintChip" class="ad2-chip off">OFF</span></div><div class="ad2-list"><div class="ad2-list-row"><strong>開始時間</strong><span id="ad2MaintStart">—</span></div><div class="ad2-list-row"><strong>預計恢復</strong><span id="ad2MaintEnd">—</span></div></div></div><div class="ad2-card ad2-danger"><h3>🔴 關閉網站</h3><p>這會啟用全站維護畫面。一般使用者被擋下，管理員仍可進入 Admin。</p><div class="ad2-form"><label>維護原因<input id="ad2MaintMessage" maxlength="200" placeholder="例如：系統更新"></label><label>預計恢復時間<input id="ad2MaintEnds" type="datetime-local"></label><label>維護密碼<input id="ad2MaintPassword" type="password" autocomplete="current-password" placeholder="輸入已設定的維護密碼"></label><div class="ad2-confirm-box">按下確認前會再次詢問「確定要關閉網站嗎？」；密碼通過後才會寫入維護狀態。</div><div class="ad2-row"><button class="btn" id="ad2SetPasswordBtn">設定/變更維護密碼</button><button class="btn danger" id="ad2CloseSiteBtn">🔴 確定要關閉網站嗎？</button></div><button class="btn primary" id="ad2OpenSiteBtn">🟢 恢復網站</button><div class="ad2-muted" id="ad2MaintHint"></div></div></div></div>');
    addSection("restrictions",'<div class="section-head"><div><div class="eyebrow">USER RESTRICTIONS</div><h2>指定使用者功能限制</h2></div><button class="btn" id="ad2RestrictionReload">重新整理</button></div><div class="ad2-grid cols-3"><div class="ad2-card"><div class="ad2-form"><label>使用者 UID<input id="ad2RestrictionUid" placeholder="Google 使用者 UID"></label><label>限制時間<select id="ad2RestrictionDuration"><option value="permanent">永久</option><option value="3600000">1 小時</option><option value="86400000">1 天</option><option value="604800000">7 天</option><option value="2592000000">30 天</option></select></label><label>原因<textarea id="ad2RestrictionReason" maxlength="300" placeholder="限制原因"></textarea></label></div><h3 style="margin-top:14px">限制功能</h3><div class="ad2-checks" id="ad2RestrictionChecks"></div><div class="ad2-row" style="margin-top:12px"><button class="btn danger" id="ad2ApplyRestriction">套用限制</button><button class="btn" id="ad2ClearRestriction">解除限制</button></div><div class="ad2-muted" id="ad2RestrictionHint"></div></div><div class="ad2-card"><h3>目前選定使用者</h3><div id="ad2RestrictionCurrent" class="ad2-list"><div class="ad2-muted">輸入 UID 後讀取。</div></div></div><div class="ad2-card"><h3>已設定功能限制</h3><div id="ad2RestrictionList" class="ad2-list"><div class="ad2-muted">載入中…</div></div></div></div>');
    addSection("roles",'<div class="section-head"><div><div class="eyebrow">ROLES & PERMISSIONS</div><h2>角色與權限</h2></div><button class="btn" id="ad2RoleReload">重新讀取</button></div><div class="ad2-grid cols-2"><div class="ad2-card"><h3>共用角色</h3><div class="ad2-form"><label>角色 ID<input id="ad2RoleId" maxlength="80" placeholder="例如 core_admin"></label><label>角色名稱<input id="ad2RoleName" maxlength="80" placeholder="例如 核心管理員"></label><label>指定使用者 UID（可留空）<input id="ad2RoleAssignUid" maxlength="128" placeholder="把此角色套用給一個使用者"></label></div><div class="ad2-list" id="ad2RoleList" style="margin-top:12px"></div><p class="ad2-muted" style="margin-top:10px">同一角色的使用者共用同一份權限定義；修改角色後，所有套用該角色的人一起更新。</p></div><div class="ad2-card"><h3>角色權限</h3><div class="ad2-checks" id="ad2PermissionChecks"></div><div class="ad2-row" style="margin-top:12px"><button class="btn" id="ad2CopyRoleBtn">全部允許</button><button class="btn" id="ad2MasterEquivalentBtn">套用與主帳號相同權限</button><button class="btn" id="ad2ClearRoleAssignmentBtn">清除指定使用者角色</button><button class="btn primary" id="ad2SaveRoleBtn">儲存角色</button></div><div class="ad2-muted" id="ad2RoleHint" style="margin-top:9px"></div><div class="ad2-subcard" style="margin-top:14px"><h4>指定使用者權限例外</h4><div class="ad2-form"><label>使用者 UID<input id="ad2OverrideUid" maxlength="128" placeholder="指定要額外允許／拒絕的 UID"></label><label>權限<select id="ad2OverridePermission"></select></label><label>模式<select id="ad2OverrideMode"><option value="allow">允許</option><option value="deny" selected>拒絕</option></select></label></div><div class="ad2-row" style="margin-top:10px"><button class="btn primary" id="ad2OverrideApply">套用例外</button><button class="btn" id="ad2OverrideClear">清除此例外</button></div><div id="ad2OverrideCurrent" class="ad2-list" style="margin-top:10px"></div><div class="ad2-muted" id="ad2OverrideHint" style="margin-top:8px">可用來對特定管理員做單一權限的允許／拒絕覆寫。</div></div></div></div>');
    addSection("ai",'<div class="section-head"><div><div class="eyebrow">AI CENTER</div><h2>AI 管理中心</h2></div></div><div class="ad2-grid cols-3"><div class="ad2-card"><h3>🧠 診斷</h3><p>分析錯誤、檢舉、房間與 API 異常。</p></div><div class="ad2-card"><h3>🔎 查詢</h3><p>用自然語言查 Admin 已授權資料。</p></div><div class="ad2-card"><h3>⚙️ Agent</h3><p>可執行管理工具，但刪除、停權、關站等高風險操作仍需人工確認。</p></div></div><div class="ad2-card" style="margin-top:14px"><div class="ad2-form"><label>詢問 AI<textarea id="ad2AiPrompt" placeholder="例如：最近有哪些房間異常？"></textarea></label><button class="btn primary" id="ad2AiAsk">送出分析</button></div><div id="ad2AiOutput" class="ad2-code" style="margin-top:12px"></div></div>');
    addSection("debug",'<div class="section-head"><div><div class="eyebrow">DEBUG CENTER</div><h2>Debug Center</h2></div><button class="btn" id="ad2DebugRefresh">重新整理</button></div><div class="ad2-card"><div class="ad2-list" id="ad2DebugList"></div></div>');
    addSection("versions",'<div class="section-head"><div><div class="eyebrow">VERSION CENTER</div><h2>版本中心</h2></div></div><div class="ad2-card"><div class="ad2-list"><div class="ad2-list-row"><strong>目前前台 build</strong><span id="ad2Build">—</span></div><div class="ad2-list-row"><strong>目前 Admin build</strong><span>20260928-admin-v31</span></div><div class="ad2-list-row"><strong>下一階段</strong><span>2.0 功能模組已接入，持續優化</span></div></div></div>');
    addSection("settings",'<div class="section-head"><div><div class="eyebrow">SYSTEM SETTINGS</div><h2>系統設定</h2></div></div><div class="ad2-grid cols-2"><div class="ad2-card"><div class="ad2-row"><h3 style="margin:0">功能旗標</h3><button class="btn primary" id="ad2FeatureFlagsSave">儲存</button></div><div class="ad2-list" id="ad2FeatureFlags"></div><p class="ad2-muted" style="margin-top:10px">關閉後重要資料寫入也會由 Firebase Rules 拒絕，不只是隱藏按鈕。</p></div><div class="ad2-card"><h3>系統資訊</h3><div class="ad2-list"><div class="ad2-list-row"><strong>Firebase</strong><span>Realtime Database + Auth</span></div><div class="ad2-list-row"><strong>YouTube 搜尋</strong><span>Cloudflare Worker Proxy</span></div><div class="ad2-list-row"><strong>UI Base</strong><span>Tabler 1.6</span></div></div></div></div>');
  }

  async function askAdminAi(){
    const prompt=String($("ad2AiPrompt")?.value||"").trim().slice(0,2000);
    if(!prompt){
      if($("ad2AiOutput"))$("ad2AiOutput").textContent="請輸入要分析的內容。";
      return;
    }
    if(window.WT2_ADMIN_AI?.run){
      $("ad2AiOutput").textContent="";
      await window.WT2_ADMIN_AI.run(prompt);
      $("ad2AiPrompt").value="";
      return;
    }
    throw new Error("Admin AI 模組尚未載入");
  }


  async function loadRoles(){
    const db=DB(); const wrap=$("ad2RoleList"); if(!db||!wrap)return;
    try{
      const snap=await db.ref("admin/roles").once("value"); const values=snap.val()||{};
      const entries=Object.entries(values).sort((a,b)=>String(a[1]?.name||a[0]).localeCompare(String(b[1]?.name||b[0])));
      wrap.innerHTML=entries.length?entries.map(([id,v])=>'<button type="button" class="ad2-list-row" data-role-id="'+escapeHtml(id)+'" style="width:100%;text-align:left;color:inherit"><strong>'+escapeHtml(v?.name||id)+'</strong><span>'+Object.keys(decodePermissions(v?.permissions||{})).length+' 個權限</span></button>').join(""):'<div class="ad2-muted">尚未建立自訂角色。</div>';
      wrap.querySelectorAll("[data-role-id]").forEach(b=>b.addEventListener("click",()=>loadRoleIntoEditor(b.dataset.roleId)));
    }catch(e){wrap.innerHTML='<div class="ad2-muted">無法讀取角色資料。</div>';console.warn("[WT2 Admin] roles:",e)}
  }
  async function loadRoleIntoEditor(roleId){
    try{
      const s=await DB().ref("admin/roles/"+roleId).once("value"); const v=s.val(); if(!v)return;
      if($("ad2RoleId"))$("ad2RoleId").value=roleId; if($("ad2RoleName"))$("ad2RoleName").value=v.name||"";
      const decoded=decodePermissions(v.permissions||{});
      document.querySelectorAll("#ad2PermissionChecks input").forEach(x=>x.checked=decoded[x.dataset.permission]===true);
    }catch(e){console.warn("[WT2 Admin] load role:",e)}
  }
  async function saveRole(){
    const user=window.firebase?.auth?.().currentUser;
    if(!user || !hasPermission("roles.manage")){ $("ad2RoleHint").textContent="你沒有修改角色定義的權限。"; return; }
    const roleId=String($("ad2RoleId")?.value||"").trim().replace(/[^A-Za-z0-9_-]/g,"").slice(0,80);
    const name=String($("ad2RoleName")?.value||"").trim().slice(0,80);
    if(!roleId||!name){$("ad2RoleHint").textContent="請填寫角色 ID 與名稱。";return}
    const selected={}; document.querySelectorAll("#ad2PermissionChecks input").forEach(x=>selected[x.dataset.permission]=x.checked);
    const permissionsOut=encodePermissions(selected);
    await DB().ref("admin/roles/"+roleId).set({name,permissions:permissionsOut,updatedAt:Date.now(),updatedBy:user.uid});
    const assignUid=String($("ad2RoleAssignUid")?.value||"").trim();
    if(assignUid) await DB().ref("admin/userRoles/"+assignUid).set({roleId,updatedAt:Date.now(),updatedBy:user.uid});
    await writeAudit("role.save",assignUid||roleId,name,assignUid?"儲存角色並套用給指定 UID":"儲存共用角色");
    $("ad2RoleHint").textContent=assignUid?"角色已儲存，並套用給指定 UID。":"角色已儲存。";
    await loadRoles();
  }
  async function assignSelectedRole(){
    const user=window.firebase?.auth?.().currentUser; const uid=String($("ad2RoleAssignUid")?.value||"").trim(); const roleId=String($("ad2RoleId")?.value||"").trim();
    if(!hasPermission("roles.manage")){toast("你沒有套用角色的權限");return}
    if(!uid||!roleId){$("ad2RoleHint").textContent="請先填角色 ID 與使用者 UID。";return}
    await DB().ref("admin/userRoles/"+uid).set({roleId,updatedAt:Date.now(),updatedBy:user.uid});
    $("ad2RoleHint").textContent="角色已套用。";
  }

  async function clearSelectedRole(){
    const user=window.firebase?.auth?.().currentUser;
    const uid=String($("ad2RoleAssignUid")?.value||"").trim();
    const hint=$("ad2RoleHint");
    if(!user||!hasPermission("roles.manage")){if(hint)hint.textContent="你沒有清除角色指派的權限。";return}
    if(!uid){if(hint)hint.textContent="請先輸入使用者 UID。";return}
    if(uid===String(user.uid||"") && isMaster()){if(hint)hint.textContent="最高管理員不需要自訂角色。";return}
    if(!confirm("確定清除這個使用者的自訂角色嗎？"))return;
    try{
      await DB().ref("admin/userRoles/"+uid).remove();
      await writeAudit("role.clearAssignment",uid,uid,"清除指定使用者自訂角色");
      if(hint)hint.textContent="自訂角色已清除。";
      await loadRoles();
    }catch(error){
      if(hint)hint.textContent="清除角色失敗："+String(error?.message||error);
    }
  }

  async function applyMasterEquivalentRole(){
    const user=window.firebase?.auth?.().currentUser;
    const uid=String($("ad2RoleAssignUid")?.value||"").trim();
    const hint=$("ad2RoleHint");
    if(!isMaster()){if(hint)hint.textContent="只有最高管理員可以套用主帳號同權限角色。";return}
    if(!uid){if(hint)hint.textContent="請先輸入要授予同等權限的使用者 UID。";return}
    if(uid===String(user?.uid||"")){if(hint)hint.textContent="主帳號本身不需要套用。";return}
    const targetSnap=await DB().ref("accounts/"+uid).once("value");
    const target=targetSnap.val()||{};
    const targetEmail=String(target.email||"").trim().toLowerCase();
    if(!targetEmail){if(hint)hint.textContent="找不到此 UID 對應的已登入帳號。請先讓對方登入一次。";return}
    const permissionsOut=encodePermissions(Object.fromEntries(permissions.map(p=>[p,true])));
    const db=DB();
    const now=Date.now();
    await db.ref().update({
      ["admin/roles/master_equivalent"]:{
        name:"主帳號同權限",
        permissions:permissionsOut,
        managedEquivalent:true,
        updatedAt:now,
        updatedBy:user.uid
      },
      ["admin/whitelistByUid/"+uid]:{
        uid,
        email:targetEmail,
        role:"admin",
        enabled:true,
        addedAt:firebase.database.ServerValue.TIMESTAMP,
        addedByUid:user.uid,
        addedByEmail:String(user.email||"").trim().toLowerCase()
      },
      ["admin/userRoles/"+uid]:{
        roleId:"master_equivalent",
        managedEquivalent:true,
        updatedAt:now,
        updatedBy:user.uid
      }
    });
    await writeAudit("role.masterEquivalent",uid,uid,"授予與主帳號相同的 Admin 管理權限");
    $("ad2RoleId").value="master_equivalent";$("ad2RoleName").value="主帳號同權限";
    if(hint)hint.textContent="已套用與主帳號相同權限。";
    await loadRoles();
  }

  function renderOverridePermissions(){
    const select=$("ad2OverridePermission");
    if(!select)return;
    select.innerHTML=permissions.map(p=>'<option value="'+escapeHtml(p)+'">'+escapeHtml(p)+'</option>').join("");
  }

  async function loadPermissionOverride(){
    const db=DB(),uid=String($("ad2OverrideUid")?.value||"").trim(),box=$("ad2OverrideCurrent");
    if(!db||!uid||!box)return;
    try{
      const snap=await db.ref("admin/userPermissionOverrides/"+uid).once("value");
      const value=snap.val()||{};
      const allow=Object.keys(decodePermissions(value.allow||{}));
      const deny=Object.keys(decodePermissions(value.deny||{}));
      box.innerHTML='<div class="ad2-list-row"><strong>允許</strong><span>'+escapeHtml(allow.join("、")||"無")+'</span></div><div class="ad2-list-row"><strong>拒絕</strong><span>'+escapeHtml(deny.join("、")||"無")+'</span></div>';
    }catch(error){
      box.innerHTML='<div class="ad2-muted">無法讀取這個 UID 的權限例外。</div>';
    }
  }

  async function applyPermissionOverride(clear=false){
    const db=DB(),user=window.firebase?.auth?.().currentUser;
    const uid=String($("ad2OverrideUid")?.value||"").trim();
    const permission=String($("ad2OverridePermission")?.value||"").trim();
    const mode=String($("ad2OverrideMode")?.value||"deny");
    const hint=$("ad2OverrideHint");
    if(!db||!user||!uid||!permission){if(hint)hint.textContent="請填寫 UID 與權限。";return}
    if(!isMaster()&&!hasPermission("roles.manage")){if(hint)hint.textContent="你沒有修改例外權限的權限。";return}
    try{
      const base="admin/userPermissionOverrides/"+uid;
      const updates={};
      if(clear){
        updates[mode+"/"+(PERMISSION_DB_KEYS[permission]||permission.replace(/\./g,"__"))]=null;
      }else{
        updates[mode+"/"+(PERMISSION_DB_KEYS[permission]||permission.replace(/\./g,"__"))]=true;
      }
      updates.updatedAt=Date.now();
      updates.updatedBy=user.uid;
      await db.ref(base).update(updates);
      await writeAudit(clear?"permissionOverride.clear":"permissionOverride.apply",uid,uid,(clear?"清除":"套用")+" "+mode+" 例外權限："+permission);
      if(hint)hint.textContent=clear?"例外已清除。":"例外已套用。";
    }catch(error){
      if(hint)hint.textContent="操作失敗："+String(error?.message||error);
    }
  }

  function renderFeatureChecks(){
    const wrap=$("ad2RestrictionChecks");
    if(wrap)wrap.innerHTML=features.map(([label,key])=>'<label class="ad2-check"><input type="checkbox" data-feature="'+key+'"> '+label+"</label>").join("");
    const pw=$("ad2PermissionChecks");
    if(pw)pw.innerHTML=permissions.map(p=>'<label class="ad2-check"><input type="checkbox" data-permission="'+p+'"> '+p+"</label>").join("");
  }

  async function loadFeatureFlags(){
    const db=DB(),wrap=$("ad2FeatureFlags");
    if(!db||!wrap)return;
    try{
      const snap=await db.ref("system/featureFlags").once("value");
      const values=snap.val()||{};
      wrap.innerHTML=features.map(([label,key])=>{
        const enabled=values[key]!==false;
        return '<label class="ad2-list-row" style="cursor:pointer"><span><strong>'+label+'</strong><small style="display:block;color:var(--ad2-muted);font-size:9px;margin-top:3px">'+key+"</small></span><input type=\"checkbox\" data-global-feature=\""+key+"\" "+(enabled?"checked":"")+" aria-label=\""+label+"\"></label>";
      }).join("");
    }catch(error){
      wrap.innerHTML='<div class="ad2-muted">無法讀取功能旗標。</div>';
      console.warn("[WT2 Admin] feature flags:",error);
    }
  }

  async function saveFeatureFlags(){
    const db=DB();if(!db)return;
    const user=window.firebase?.auth?.().currentUser;
    if(!user||user.isAnonymous){toast("管理員登入狀態無效");return}
    if(!hasPermission("settings.edit")){toast("你沒有修改系統功能旗標的權限");return}
    const updates={};
    document.querySelectorAll("[data-global-feature]").forEach(input=>{
      updates[input.dataset.globalFeature]=input.checked;
    });
    try{
      await db.ref("system/featureFlags").update(updates);
      await writeAudit("featureFlags.update",user.uid,"系統","更新全站功能旗標");
      toast("功能旗標已更新");
      await loadFeatureFlags();
    }catch(error){
      console.error("[WT2 Admin] feature flags:",error);
      toast("功能旗標更新失敗");
    }
  }

  function ensureAdminCommandPalette(){
    if(document.getElementById("ad2CommandPalette"))return;
    const dialog=document.createElement("dialog");
    dialog.id="ad2CommandPalette";
    dialog.className="ad2-command-palette";
    dialog.innerHTML='<div class="ad2-command-inner"><div class="ad2-command-search"><span>⌘</span><input id="ad2CommandInput" placeholder="搜尋管理功能…" autocomplete="off"><kbd>Esc</kbd></div><div id="ad2CommandList" class="ad2-command-list"></div></div>';
    document.body.appendChild(dialog);

    const commands=[
      ["overview","總覽","Dashboard","users.view"],
      ["accounts","使用者管理","Users","users.view"],
      ["rooms","房間管理","Rooms","rooms.view"],
      ["reports","檢舉中心","Reports","reports.handle"],
      ["audit","Audit Log","Audit","audit.view"],
      ["security","安全中心","Security","audit.view"],
      ["analytics","Analytics","Analytics","analytics.view"],
      ["maintenance","維護中心","Maintenance","maintenance.manage"],
      ["restrictions","使用者功能限制","Restrictions","restrictions.manage"],
      ["roles","角色與權限","Roles","roles.manage"],
      ["ai","AI 管理中心","AI","ai.use"],
      ["debug","Debug Center","Debug","analytics.view"],
      ["versions","版本中心","Versions","users.view"],
      ["settings","系統設定","Settings","settings.edit"]
    ].filter(item=>hasPermission(item[3]));
    let filtered=commands.slice(),index=0;
    const list=()=>document.getElementById("ad2CommandList");
    const render=()=>{
      const box=list();if(!box)return;
      box.innerHTML=filtered.map((item,i)=>'<button type="button" class="'+(i===index?"active":"")+'" data-ad2-command="'+item[0]+'"><span>'+item[1]+'</span><small>'+item[2]+'</small></button>').join("")||'<div class="ad2-muted">找不到功能。</div>';
      box.querySelectorAll("[data-ad2-command]").forEach(b=>b.addEventListener("click",()=>{
        showSection(b.dataset.ad2Command);dialog.close();
      }));
    };
    const input=$("ad2CommandInput");
    input?.addEventListener("input",()=>{
      const q=String(input.value||"").trim().toLowerCase();
      filtered=commands.filter(x=>!q||x[1].toLowerCase().includes(q)||x[2].toLowerCase().includes(q));
      index=0;render();
    });
    input?.addEventListener("keydown",e=>{
      if(e.key==="ArrowDown"){e.preventDefault();index=filtered.length?(index+1)%filtered.length:0;render();}
      if(e.key==="ArrowUp"){e.preventDefault();index=filtered.length?(index-1+filtered.length)%filtered.length:0;render();}
      if(e.key==="Enter"){e.preventDefault();const item=filtered[index];if(item){showSection(item[0]);dialog.close();}}
      if(e.key==="Escape"){dialog.close();}
    });
    dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close();});
    render();
  }

  function openAdminCommandPalette(){
    ensureAdminCommandPalette();
    const dialog=$("ad2CommandPalette");if(!dialog)return;
    if(!dialog.open)dialog.showModal();
    const input=$("ad2CommandInput");if(input){input.value="";input.dispatchEvent(new Event("input"));input.focus();}
  }

  function toast(message){
    const el=$("toast");
    if(!el)return;
    el.textContent=String(message||"");
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>el.classList.remove("show"),2400);
  }

  async function writeAudit(action,targetUid,targetName,details){
    const db=DB();
    const user=window.firebase?.auth?.().currentUser;
    if(!db||!user||user.isAnonymous)return;
    try{
      await db.ref("admin/auditLogs").push({
        action:String(action||"admin").slice(0,40),
        actorUid:String(user.uid||"").slice(0,128),
        actorEmail:String(user.email||"").slice(0,320),
        actorRole:String(window.WT2_ADMIN_ROLE||"admin").slice(0,40),
        targetUid:String(targetUid||"").slice(0,128),
        targetName:String(targetName||"").slice(0,200),
        details:String(details||"").slice(0,1000),
        createdAt:firebase.database.ServerValue.TIMESTAMP
      });
    }catch(error){console.warn("[WT2 Admin] audit:",error);}
  }

  function readStat(id){return Number(($(id)?.textContent||"").replace(/[^\d.-]/g,""))||0}
  function renderAnalytics(){
    const now=Date.now();
    const accountsValues=Object.values(window.__WT_ADMIN_ACCOUNTS__||{});
    const accounts=accountsValues.length || Number(readStat("statAccounts")||0);
    const whitelist=Number(readStat("statWhitelist")||0);
    const blocked=Number(readStat("statBlocked")||0);
    const rooms=Number(readStat("statRooms")||0);
    const activeSince24h=now-86400000;
    const activeSince7d=now-604800000;
    const activeSince30d=now-2592000000;
    const lastSeen=item=>Number(item?.lastLoginAt||item?.lastSeenAt||item?.updatedAt||0);
    const dau=accountsValues.filter(item=>lastSeen(item)>=activeSince24h).length;
    const wau=accountsValues.filter(item=>lastSeen(item)>=activeSince7d).length;
    const mau=accountsValues.filter(item=>lastSeen(item)>=activeSince30d).length;
    const data=[accounts,whitelist,blocked,rooms];
    const labels=["帳號","白名單","封鎖","房間"];
    const list=$("ad2AnalyticsList");
    if(list){
      const rows=[
        ["帳號總數",accounts],
        ["24 小時活躍帳號",dau],
        ["7 天活躍帳號",wau],
        ["30 天活躍帳號",mau],
        ["白名單",whitelist],
        ["封鎖",blocked],
        ["房間",rooms]
      ];
      list.innerHTML=rows.map(([label,value])=>'<div class="ad2-list-row"><strong>'+label+'</strong><span>'+value+'</span></div>').join("");
    }
    if(!window.Chart||!$("ad2StatsChart"))return;
    if(state.chart)state.chart.destroy();
    state.chart=new Chart($("ad2StatsChart").getContext("2d"),{type:"bar",data:{labels,datasets:[{label:"目前資料",data,borderWidth:1}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}});
  }

  function renderSecurity(){ if($("ad2SecAccounts"))$("ad2SecAccounts").textContent=readStat("statAccounts"); if($("ad2SecBlocked"))$("ad2SecBlocked").textContent=readStat("statBlocked"); if($("ad2SecReports"))$("ad2SecReports").textContent=readStat("statOpenReports"); if($("ad2SecMaintenance"))$("ad2SecMaintenance").textContent=state.maintenance?.enabled?"ON":"OFF"; const list=$("ad2SecurityList"); if(list)list.innerHTML=["Google Auth","Firebase Rules","Admin Whitelist","Audit Log","Maintenance Lock","User Restrictions"].map(x=>'<div class="ad2-list-row"><strong>'+x+'</strong><span class="ad2-chip on">ENABLED</span></div>').join(""); }

  function controlUrl(){
    let configured=String(window.WATCHTOGETHER_CONFIG?.adminControlUrl||"").trim();
    if(configured)return configured.replace(/\/+$/,"");
    try{
      configured=String(localStorage.getItem("wt_admin_control_url")||"").trim();
    }catch(_){}
    return configured.replace(/\/+$/,"");
  }
  async function loadControlUrlFromDatabase(){
    const db=DB();const user=window.firebase?.auth?.().currentUser;
    if(!db||!user||user.isAnonymous)return;
    try{
      const snap=await db.ref("admin/settings/adminControlUrl").once("value");
      const value=String(snap.val()||"").trim().replace(/\/+$/,"");
      if(value){
        try{localStorage.setItem("wt_admin_control_url",value);}catch(_){}
        if($("ad2MaintWorkerUrl"))$("ad2MaintWorkerUrl").value=value;
      }
    }catch(error){
      console.warn("[WT2 Admin] control URL settings:",error);
    }
  }
  async function saveControlUrl(){
    if(!hasPermission("settings.edit")){toast("你沒有設定 Admin Control Worker 的權限");return}
    const current=controlUrl();
    const entered=prompt("輸入 Admin Control Worker URL",current);
    if(entered===null)return;
    const value=String(entered).trim().replace(/\/+$/,"");
    if(value && !/^https:\/\//i.test(value)){toast("Worker URL 必須使用 HTTPS");return}
    try{
      await DB().ref("admin/settings/adminControlUrl").set(value);
      if(value)localStorage.setItem("wt_admin_control_url",value);
      else localStorage.removeItem("wt_admin_control_url");
    }catch(error){
      toast(error?.message||"Worker URL 儲存失敗");return;
    }
    if($("ad2MaintWorkerUrl"))$("ad2MaintWorkerUrl").value=value;
    if($("ad2MaintHint"))$("ad2MaintHint").textContent=value?"Admin Control Worker URL 已同步給管理員。":"已清除 Admin Control Worker URL。";
    await writeAudit("adminControl.url.update",window.firebase?.auth?.().currentUser?.uid||"","Admin Control Worker",value?"更新 Worker URL":"清除 Worker URL");
    void readMaintenance();
  }
  async function testControlUrl(){
    const url=controlUrl();
    const hint=$("ad2MaintHint");
    if(!url){if(hint)hint.textContent="請先設定 Worker URL。";return}
    try{
      const response=await fetch(url+"/health",{method:"GET",cache:"no-store",credentials:"omit"});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data?.ok!==true)throw new Error(String(data?.error?.message||data?.error||"健康檢查失敗"));
      if(hint)hint.textContent="Worker 連線成功："+String(data.service||"Admin Control");
    }catch(error){
      if(hint)hint.textContent="Worker 連線失敗："+String(error?.message||error);
    }
  }
  async function controlRequest(payload,method="POST"){
    const url=controlUrl();
    const token=await window.firebase?.auth?.().currentUser?.getIdToken?.();
    if(!url) throw new Error("尚未設定 Admin Control Worker URL");
    if(!token) throw new Error("管理員登入 Token 尚未準備完成");
    const response=await fetch(url+"/maintenance",{method,headers:{"content-type":"application/json","authorization":"Bearer "+token},body:method==="GET"?undefined:JSON.stringify(payload)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(data.error||"Admin Control Worker 請求失敗");
    return data;
  }

  async function readMaintenance(){
    const url=controlUrl();
    if(!url){
      state.maintenance={enabled:false};
      if($("ad2MaintWorkerUrl"))$("ad2MaintWorkerUrl").value="";
      if($("ad2MaintHint"))$("ad2MaintHint").textContent="尚未設定 Admin Control Worker URL；按「設定 Worker URL」即可在此瀏覽器儲存。";
    }else{
      try{state.maintenance=await controlRequest({}, "GET");}
      catch(e){state.maintenance={enabled:false};if($("ad2MaintHint"))$("ad2MaintHint").textContent=e?.message||"無法讀取網站狀態。";}
    }
    const m=state.maintenance;
    if($("ad2MaintStatus"))$("ad2MaintStatus").textContent=m.enabled?"🔴 維護中":"🟢 正常運行";
    if($("ad2MaintChip")){$("ad2MaintChip").textContent=m.enabled?"ON":"OFF";$("ad2MaintChip").className="ad2-chip "+(m.enabled?"on":"off")}
    if($("ad2MaintStart"))$("ad2MaintStart").textContent=m.startedAt?new Date(Number(m.startedAt)).toLocaleString():"—";
    if($("ad2MaintEnd"))$("ad2MaintEnd").textContent=m.endsAt?new Date(Number(m.endsAt)).toLocaleString():"—";
  }

  async function setPassword(){
    if(!isMaster()){toast("只有最高管理員可以修改維護密碼");return}
    const currentPassword=prompt("請輸入目前維護密碼（首次設定可留空）：")||"";
    const newPassword=prompt("請輸入新的維護密碼（至少 8 個字元）：")||"";
    if(newPassword.length<8){alert("密碼至少 8 個字元");return}
    await controlRequest({action:"set-password",currentPassword,newPassword});
    if($("ad2MaintHint"))$("ad2MaintHint").textContent="維護密碼已更新。";
  }

  async function closeSite(){
    if(!hasPermission("maintenance.manage")){toast("你沒有網站維護權限");return}
    const message=String($("ad2MaintMessage")?.value||"系統維護").trim()||"系統維護";
    const raw=$("ad2MaintEnds")?.value||"";
    const ends=raw?Date.parse(raw):0;
    const password=$("ad2MaintPassword")?.value||"";
    if(!confirm("確定要關閉網站嗎？"))return;
    if(!password){$("ad2MaintHint").textContent="請輸入維護密碼。";return}
    try{
      await controlRequest({action:"enable",password,message,endsAt:Number.isFinite(ends)?ends:0});
      $("ad2MaintPassword").value="";$("ad2MaintHint").textContent="網站已進入維護模式。";await readMaintenance();
    }catch(e){$("ad2MaintHint").textContent=e?.message||"維護密碼錯誤，沒有關站。";}
  }

  async function openSite(){
    if(!hasPermission("maintenance.manage")){toast("你沒有網站維護權限");return}
    if(!confirm("確定要恢復網站嗎？"))return;
    const password=$("ad2MaintPassword")?.value||"";
    if(!password){$("ad2MaintHint").textContent="請輸入維護密碼後再恢復網站。";return}
    try{
      await controlRequest({action:"disable",password});
      $("ad2MaintPassword").value="";$("ad2MaintHint").textContent="網站已恢復。";await readMaintenance();
    }catch(e){$("ad2MaintHint").textContent=e?.message||"維護密碼錯誤。";}
  }

  const FEATURE_LABELS=Object.fromEntries(features.map(([label,key])=>[key,label]));
  async function loadRestrictedUsers(){
    const db=DB(),wrap=$("ad2RestrictionList");
    if(!db||!wrap)return;
    try{
      const snap=await db.ref("admin/restrictionsByUid").once("value");
      const now=Date.now();
      const entries=Object.entries(snap.val()||{}).filter(([uid,value])=>{
        if(!value||typeof value!=="object" || uid==="35d45a23-b648-4caf-a6d5-a69112860551")return false;
        const until=Number(value.blockedUntil||0);
        const any=Object.values(value.features||{}).some(Boolean);
        return any && (until===0 || until>now);
      }).sort((a,b)=>Number(b[1]?.updatedAt||0)-Number(a[1]?.updatedAt||0));
      wrap.innerHTML=entries.length?entries.map(([uid,value])=>{
        const active=Object.entries(value.features||{}).filter(([,x])=>x===true).map(([k])=>FEATURE_LABELS[k]||k);
        const until=Number(value.blockedUntil||0);
        const time=until===0?"永久":new Date(until).toLocaleString();
        const reason=String(value.reason||"未填寫原因").slice(0,100);
        return '<button type="button" class="ad2-list-row" data-restrict-uid="'+escapeHtml(uid)+'"><span><strong>'+escapeHtml(uid)+'</strong><small style="display:block;color:var(--ad2-muted);margin-top:3px">'+escapeHtml(active.join("、"))+'</small><small style="display:block;color:var(--ad2-muted);margin-top:3px">原因：'+escapeHtml(reason)+'</small></span><span>'+escapeHtml(time)+'</span></button>';
      }).join(""):'<div class="ad2-muted">目前沒有啟用中的功能限制。</div>';
      wrap.querySelectorAll("[data-restrict-uid]").forEach(button=>button.addEventListener("click",()=>{
        const input=$("ad2RestrictionUid");if(input){input.value=button.dataset.restrictUid||"";input.dispatchEvent(new Event("change"))}
      }));
    }catch(error){
      wrap.innerHTML='<div class="ad2-muted">無法載入功能限制。</div>';
      console.warn("[WT2 Admin] restrictions:",error);
    }
  }

  async function loadRestriction(){
    const uid=String($("ad2RestrictionUid")?.value||"").trim();const box=$("ad2RestrictionCurrent");if(!uid||!box)return;
    try{
      const snap=await DB().ref("admin/restrictionsByUid/"+uid).once("value");const v=snap.val();
      if(!v){box.innerHTML='<div class="ad2-muted">目前沒有功能限制。</div>';document.querySelectorAll("#ad2RestrictionChecks input").forEach(x=>x.checked=false);return}
      const until=Number(v.blockedUntil||0);
      const activeUntil=until===0?"永久":new Date(until).toLocaleString();
      const active=Object.entries(v.features||{}).filter(([,x])=>x===true).map(([k])=>FEATURE_LABELS[k]||k);
      box.innerHTML='<div class="ad2-list-row"><strong>限制功能</strong><span>'+escapeHtml(active.join("、")||"無")+'</span></div><div class="ad2-list-row"><strong>到期時間</strong><span>'+escapeHtml(activeUntil)+'</span></div><div class="ad2-list-row"><strong>原因</strong><span>'+escapeHtml(String(v.reason||"未填寫原因"))+'</span></div>';
      document.querySelectorAll("#ad2RestrictionChecks input").forEach(x=>x.checked=v.features?.[x.dataset.feature]===true);
      if($("ad2RestrictionReason"))$("ad2RestrictionReason").value=String(v.reason||"");
    }catch(e){box.innerHTML='<div class="ad2-muted">無法讀取限制資料。</div>'}
  }

  async function applyRestriction(clear=false){
    if(!hasPermission("restrictions.manage")){toast("你沒有管理指定使用者功能限制的權限");return}
    const db=DB(),user=window.firebase?.auth?.().currentUser;
    const uid=String($("ad2RestrictionUid")?.value||"").trim();
    const hint=$("ad2RestrictionHint");
    if(!uid){if(hint)hint.textContent="請輸入 UID。";return}
    if(uid==="35d45a23-b648-4caf-a6d5-a69112860551"){if(hint)hint.textContent="最高管理員不能被功能限制。";return}
    const accountSnap=await db.ref("accounts/"+uid).once("value");
    if(!accountSnap.exists()){if(hint)hint.textContent="找不到這個 UID 對應的帳號。";return}

    if(clear){
      if(!confirm("確定解除這個使用者的全部功能限制嗎？"))return;
      await db.ref("admin/restrictionsByUid/"+uid).remove();
      await writeAudit("userRestriction.clear",uid,uid,"解除指定使用者全部功能限制");
      if(hint)hint.textContent="限制已解除。";
      await loadRestriction();await loadRestrictedUsers();return;
    }

    const selected=[];
    document.querySelectorAll("#ad2RestrictionChecks input").forEach(x=>{if(x.checked)selected.push(x.dataset.feature);});
    if(!selected.length){if(hint)hint.textContent="至少要選擇一個限制功能。";return}
    const reason=String($("ad2RestrictionReason")?.value||"").trim().slice(0,300);
    if(!reason){if(hint)hint.textContent="請填寫限制原因。";return}
    const duration=$("ad2RestrictionDuration")?.value||"permanent";
    const until=duration==="permanent"?0:Date.now()+Number(duration);
    const featuresOut={};selected.forEach(key=>featuresOut[key]=true);
    await db.ref("admin/restrictionsByUid/"+uid).set({
      features:featuresOut,
      reason,
      blockedUntil:until,
      updatedAt:Date.now(),
      updatedBy:user?.uid||""
    });
    await writeAudit("userRestriction.apply",uid,uid,"套用功能限制："+selected.map(k=>FEATURE_LABELS[k]||k).join("、")+" · "+(duration==="permanent"?"永久":new Date(until).toLocaleString())+" · 原因："+reason);
    if(hint)hint.textContent="功能限制已套用。";
    await loadRestriction();await loadRestrictedUsers();
  }
  function refreshAll(){renderAnalytics();renderSecurity();void readMaintenance();void loadRestriction();void loadRestrictedUsers();void loadRoles();void loadFeatureFlags();}
  async function boot(){
    if(!document.querySelector("#app"))return;
    renderNewUI();renderFeatureChecks();renderOverridePermissions();bindNav();
    ensureAdminCommandPalette();
    await loadAdminPermissionContext();
    publishPermissionContext();
    applyPermissionVisibility();
    window.addEventListener("wt2-admin-role-ready",()=>applyPermissionVisibility());
    $("ad2MaintenanceReload")?.addEventListener("click",readMaintenance);
    $("ad2MaintSetWorkerUrl")?.addEventListener("click",()=>saveControlUrl().catch(e=>toast(e?.message||"Worker URL 設定失敗")));
    $("ad2MaintTestWorkerUrl")?.addEventListener("click",()=>void testControlUrl());
    void loadControlUrlFromDatabase();
    try{ if($("ad2MaintWorkerUrl"))$("ad2MaintWorkerUrl").value=controlUrl(); }catch(_){}
    $("ad2SetPasswordBtn")?.addEventListener("click",()=>setPassword().catch(e=>{console.error(e);$("ad2MaintHint").textContent="設定密碼失敗。"}));
    $("ad2CloseSiteBtn")?.addEventListener("click",()=>closeSite().catch(e=>{console.error(e);$("ad2MaintHint").textContent=e?.message||"關站失敗。"}));
    $("ad2OpenSiteBtn")?.addEventListener("click",()=>openSite().catch(e=>{console.error(e);$("ad2MaintHint").textContent=e?.message||"恢復網站失敗。"}));
    $("ad2RestrictionUid")?.addEventListener("change",loadRestriction);
    $("ad2RestrictionReload")?.addEventListener("click",()=>{void loadRestriction();void loadRestrictedUsers();});
    $("ad2ApplyRestriction")?.addEventListener("click",()=>applyRestriction(false).then(()=>loadRestrictedUsers()).catch(e=>{console.error(e);$("ad2RestrictionHint").textContent="套用失敗。"}));
    $("ad2ClearRestriction")?.addEventListener("click",()=>applyRestriction(true).then(()=>loadRestrictedUsers()).catch(e=>{console.error(e);$("ad2RestrictionHint").textContent="解除失敗。"}));
    $("ad2SecurityRefresh")?.addEventListener("click",refreshAll);
    document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openAdminCommandPalette();}});
    $("ad2DebugRefresh")?.addEventListener("click",()=>{
      const el=$("ad2DebugList");if(el)el.innerHTML=(window.__WT_EARLY_ERRORS__||[]).slice(-20).map(x=>'<div class="ad2-list-row"><strong>'+String(x.message||"Unknown").replace(/[<>]/g,"")+'</strong><span>'+String(x.source||"unknown")+"</span></div>").join("")||'<div class="ad2-muted">目前沒有前端 Early Errors。</div>';
    });
    $("ad2Build")&&( $("ad2Build").textContent=window.__WATCHTOGETHER_BUILD__||"—");
    $("ad2AiAsk")?.addEventListener("click",()=>void askAdminAi().catch(error=>{
      console.error("[WT2 Admin] AI:",error);
      $("ad2AiOutput").textContent="⚠️ "+String(error?.message||error||"AI 分析失敗");
    }));
    $("ad2CopyRoleBtn")?.addEventListener("click",()=>{document.querySelectorAll("#ad2PermissionChecks input").forEach(x=>x.checked=true);});
    $("ad2SaveRoleBtn")?.addEventListener("click",()=>saveRole().catch(e=>{console.error(e);$("ad2RoleHint").textContent="角色儲存失敗。";}));
    $("ad2OverrideApply")?.addEventListener("click",()=>applyPermissionOverride(false).then(loadPermissionOverride));
    $("ad2OverrideClear")?.addEventListener("click",()=>applyPermissionOverride(true).then(loadPermissionOverride));
    $("ad2OverrideUid")?.addEventListener("change",loadPermissionOverride);
    $("ad2RoleReload")?.addEventListener("click",()=>loadRoles());
    $("ad2MasterEquivalentBtn")?.addEventListener("click",()=>applyMasterEquivalentRole().catch(e=>{$("ad2RoleHint").textContent=e?.message||"套用同權限失敗。"}));
    $("ad2ClearRoleAssignmentBtn")?.addEventListener("click",()=>void clearSelectedRole());
    $("ad2FeatureFlagsSave")?.addEventListener("click",()=>saveFeatureFlags());
    void loadFeatureFlags();
    loadRoles();
    const denied=new MutationObserver(()=>{const d=$("deniedScreen"),s=$("setupScreen");if((d&&!d.classList.contains("hidden"))||(s&&!s.classList.contains("hidden"))){try{location.replace("../404.html")}catch(_){}}});
    denied.observe(document.body,{subtree:true,attributes:true,attributeFilter:["class"]});
    void loadRestrictedUsers();
    refreshAll();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();