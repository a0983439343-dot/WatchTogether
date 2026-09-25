(() => {
  "use strict";

  const config=window.WATCHTOGETHER_CONFIG||{};
  const adminEmail=String(config.adminEmail||"").trim().toLowerCase();
  const MASTER_EMAIL="a0983439343@gmail.com";
  let auth=null,db=null,currentUser=null,accounts={},whitelist={},rooms={},currentHasAdminAccess=false;
  const $=id=>document.getElementById(id);
  const show=id=>$(id)?.classList.remove("hidden");
  const hide=id=>$(id)?.classList.add("hidden");

  function toast(message){
    const el=$("toast"); if(!el)return;
    el.textContent=String(message||"");
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer=setTimeout(()=>el.classList.remove("show"),2200);
  }

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  function formatDate(value){
    const n=Number(value||0);
    if(!Number.isFinite(n)||n<=0)return "—";
    return new Date(n).toLocaleString("zh-TW",{year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
  }

  function isMasterUser(user){
    return Boolean(user&&!user.isAnonymous&&user.email&&user.emailVerified===true&&String(user.email).trim().toLowerCase()===MASTER_EMAIL&&adminEmail===MASTER_EMAIL);
  }

  function isWhitelistedAdmin(user){
    return Boolean(user&&!user.isAnonymous&&user.email&&user.emailVerified===true&&whitelist&&whitelist[user.uid]&&whitelist[user.uid].enabled===true);
  }

  async function hasAdminAccess(user){
    if(!user||user.isAnonymous||user.emailVerified!==true)return false;
    if(isMasterUser(user))return true;
    const snapshot=await db.ref("admin/whitelistByUid/"+user.uid).once("value");
    const item=snapshot.val();
    return Boolean(item&&item.enabled===true);
  }

  async function loadAccounts(){
    if(!currentHasAdminAccess){
      accounts={};
      renderAccounts();
      updateStats();
      return;
    }
    const snapshot=await db.ref("accounts").once("value");
    accounts=snapshot.val()||{};
    renderAccounts();
    updateStats();
  }

  async function loadWhitelist(){
    const ref=isMasterUser(currentUser)?db.ref("admin/whitelistByUid"):db.ref("admin/whitelistByUid/"+currentUser.uid);
    const snapshot=await ref.once("value");
    if(isMasterUser(currentUser)){
      whitelist=snapshot.val()||{};
    }else{
      const item=snapshot.val();
      whitelist=item?{[currentUser.uid]:item}:{};
    }
    renderWhitelist();
    updateStats();
  }

  async function loadRooms(){
    if(!currentHasAdminAccess){
      rooms={};
      renderRooms();
      return;
    }
    const snapshot=await db.ref("rooms").once("value");
    rooms=snapshot.val()||{};
    const memberSnapshot=await db.ref("members").once("value").catch(()=>null);
    const members=memberSnapshot?.val?.()||{};
    Object.keys(rooms).forEach(id=>{
      rooms[id].__members=Object.values(members[id]||{}).filter(x=>x&&x.online===true).length;
    });
    renderRooms();
  }

  function renderRooms(){
    const query=String($("roomSearch")?.value||"").trim().toLowerCase();
    const accountByUid={};
    Object.values(accounts||{}).forEach(item=>{
      if(item&&item.uid)accountByUid[item.uid]=item;
    });
    const rows=Object.entries(rooms||{}).map(([id,item])=>({id,item})).filter(({id,item})=>{
      if(!item||!/^[A-Z0-9]{6}$/.test(String(id).toUpperCase()))return false;
      const owner=accountByUid[item.owner]?.email||item.owner||"";
      const hay=[id,item.name,owner,item.sourceType,item.video?.title,item.video?.platform].join(" ").toLowerCase();
      return !query||hay.includes(query);
    }).sort((a,b)=>Number(b.item.createdAt||0)-Number(a.item.createdAt||0));
    $("roomCount").textContent=rows.length+" 間";
    $("roomsBody").innerHTML=rows.length?rows.map(({id,item})=>{
      const key=String(id).toUpperCase();
      const owner=accountByUid[item.owner];
      const members=Number(item.__members||0);
      const platform=String(item.video?.platform||item.sourceType||"—");
      const title=String(item.video?.title||"目前沒有影片");
      const href="./?room="+encodeURIComponent(key)+"&adminJoin=1";
      return '<tr><td><div class="primary-text">'+escapeHtml(item.name||"一起看")+'</div><span class="small">房間碼：'+escapeHtml(key)+'</span></td><td>'+escapeHtml(owner?.email||item.owner||"—")+'</td><td><strong>'+members+'</strong></td><td><span class="small">'+escapeHtml(platform)+' · '+escapeHtml(title)+'</span></td><td>'+escapeHtml(formatDate(item.createdAt))+'</td><td><a class="btn primary" href="'+href+'">🚪 管理員直接進入</a></td></tr>';
    }).join(""):'<tr><td colspan="6" class="muted">目前沒有符合條件的房間。</td></tr>';
  }

  function updateStats(){
    const list=Object.values(accounts||{}),wl=Object.values(whitelist||{});
    $("statAccounts").textContent=list.length;
    $("statWhitelist").textContent=isMasterUser(currentUser)?wl.length:(currentHasAdminAccess?"1":"0");
    $("statWhitelistEnabled").textContent=wl.filter(x=>x&&x.enabled===true).length;
    $("statCurrent").textContent=currentUser?1:0;
    if($("statRooms"))$("statRooms").textContent=Object.keys(rooms||{}).length;
    const u=currentUser||{};
    $("adminInfo").innerHTML=[
      ["權限",isMasterUser(u)?"最高管理員":"白名單管理員"],
      ["Email",u.email||"—"],
      ["UID",u.uid||"—"],
      ["Email 驗證",u.emailVerified===true?"已驗證":"未驗證"],
      ["登入方式",(u.providerData&&u.providerData[0]&&u.providerData[0].providerId)||"Google"]
    ].map(([a,b])=>'<div class="info-item"><span>'+escapeHtml(a)+'</span><strong>'+escapeHtml(b)+'</strong></div>').join("");
  }

  function renderAccounts(){
    const query=String($("accountSearch")?.value||"").trim().toLowerCase();
    const rows=Object.values(accounts||{}).filter(item=>{
      if(!item)return false;
      const hay=[item.email,item.displayName,item.uid,item.provider].join(" ").toLowerCase();
      return !query||hay.includes(query);
    }).sort((a,b)=>Number(b.lastLoginAt||0)-Number(a.lastLoginAt||0));
    $("accountCount").textContent=rows.length+" 筆";
    $("accountsBody").innerHTML=rows.length?rows.map(item=>{
      const self=currentUser&&String(currentUser.uid)===String(item.uid);
      return '<tr><td><div class="primary-text">'+escapeHtml(item.email||"—")+'</div><span class="small">'+(item.emailVerified===true?"Email 已驗證":"Email 未驗證")+'</span></td><td>'+escapeHtml(item.displayName||"—")+'</td><td><span class="small">'+escapeHtml(item.uid||"—")+(self?" · 目前帳號":"")+'</span></td><td>'+escapeHtml(item.provider||"—")+'</td><td>'+escapeHtml(formatDate(item.lastLoginAt))+'</td></tr>';
    }).join(""):'<tr><td colspan="5" class="muted">沒有符合條件的帳號。</td></tr>';
  }

  function renderWhitelist(){
    const master=isMasterUser(currentUser);
    const query=String($("whitelistSearch")?.value||"").trim().toLowerCase();
    const rows=Object.entries(whitelist||{}).map(([key,item])=>({key,item}))
      .filter(({item})=>item&&(!query||String(item.email||"").toLowerCase().includes(query)))
      .sort((a,b)=>Number(b.item.addedAt||0)-Number(a.item.addedAt||0));

    $("whitelistCount").textContent=rows.length+" 筆";

    $("whitelistBody").innerHTML=rows.length?rows.map(({key,item})=>{
      const enabled=item.enabled===true;
      const actions=master
        ? '<div class="row-actions"><button class="btn" data-toggle="'+escapeHtml(key)+'">'+(enabled?"停用":"啟用")+'</button><button class="btn" data-remove="'+escapeHtml(key)+'">刪除</button></div>'
        : '<span class="muted">僅最高管理員可管理</span>';
      return '<tr><td><div class="primary-text">'+escapeHtml(item.email||"—")+'</div></td><td><span class="status '+(enabled?"":"off")+'">'+(enabled?"啟用":"停用")+'</span></td><td>'+escapeHtml(formatDate(item.addedAt))+'</td><td>'+escapeHtml(item.addedByEmail||"—")+'</td><td>'+actions+'</td></tr>';
    }).join(""):'<tr><td colspan="5" class="muted">目前沒有白名單帳號。</td></tr>';

    $("whitelistBody").querySelectorAll("[data-toggle]").forEach(btn=>btn.addEventListener("click",()=>toggleWhitelist(btn.dataset.toggle).catch(error=>{console.error(error);toast("操作失敗");})));
    $("whitelistBody").querySelectorAll("[data-remove]").forEach(btn=>btn.addEventListener("click",()=>removeWhitelist(btn.dataset.remove).catch(error=>{console.error(error);toast("刪除失敗");})));
  }

  async function addWhitelist(){
    if(!isMasterUser(currentUser)){toast("只有最高管理員可以管理白名單");return;}
    const input=$("whitelistEmail");
    const email=String(input?.value||"").trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){toast("請輸入有效的 Email");return;}
    if(email===MASTER_EMAIL){toast("這個帳號已經是最高管理員");return;}

    const match=Object.values(accounts||{}).find(item=>item&&String(item.email||"").trim().toLowerCase()===email);
    if(!match||!match.uid){
      toast("找不到這個登入帳號，請先讓該 Google 帳號登入一次");
      return;
    }

    const uid=String(match.uid);
    await db.ref("admin/whitelistByUid/"+uid).set({
      uid,
      email,
      enabled:true,
      addedAt:firebase.database.ServerValue.TIMESTAMP,
      addedByUid:currentUser.uid,
      addedByEmail:currentUser.email||""
    });
    input.value="";
    await loadWhitelist();
    toast("已加入白名單管理員");
  }

  async function toggleWhitelist(uid){
    if(!isMasterUser(currentUser)){toast("只有最高管理員可以管理白名單");return;}
    const item=whitelist[uid]; if(!item)return;
    await db.ref("admin/whitelistByUid/"+uid).update({
      enabled:item.enabled!==true,
      updatedAt:firebase.database.ServerValue.TIMESTAMP,
      updatedByUid:currentUser.uid
    });
    await loadWhitelist();
    toast(item.enabled===true?"已停用":"已啟用");
  }

  async function removeWhitelist(uid){
    if(!isMasterUser(currentUser)){toast("只有最高管理員可以管理白名單");return;}
    const item=whitelist[uid]; if(!item)return;
    if(!window.confirm("確定刪除 "+(item.email||"這個帳號")+" 的管理員資格？"))return;
    await db.ref("admin/whitelistByUid/"+uid).remove();
    await loadWhitelist();
    toast("已刪除白名單管理員");
  }

  function applyRoleUi(){
    const master=isMasterUser(currentUser);
    const addPanel=$("whitelistAddPanel");
    const help=$("whitelistHelp");
    if(master){
      addPanel?.classList.remove("hidden");
      if(help)help.textContent="輸入已經登入過 WatchTogether 的 Google Email，即可加入管理員白名單。只有最高管理員可以變更白名單。";
    }else{
      addPanel?.classList.add("hidden");
      if(help)help.textContent="你目前是白名單管理員，可以進入管理後台；白名單的新增、停用與刪除只有最高管理員可以操作。";
    }
  }

  async function initialize(){
    if(!window.firebase||!window.FIREBASE_CONFIG){hide("loadingScreen");show("deniedScreen");$("deniedMessage").textContent="Firebase 設定未載入。";return;}
    if(adminEmail!==MASTER_EMAIL){hide("loadingScreen");show("setupScreen");return;}
    if(!firebase.apps.length)firebase.initializeApp(window.FIREBASE_CONFIG);
    auth=firebase.auth();
    db=firebase.database();

    auth.onAuthStateChanged(async user=>{
      currentUser=user||null;
      currentHasAdminAccess=false;
      hide("loadingScreen");
      hide("setupScreen");
      hide("app");
      hide("deniedScreen");

      if(!user||user.isAnonymous||user.emailVerified!==true){
        show("deniedScreen");
        $("deniedMessage").textContent="請使用已驗證 Email 的 Google 帳號登入。";
        return;
      }

      try{
        currentHasAdminAccess=await hasAdminAccess(user);
        if(!currentHasAdminAccess){
          show("deniedScreen");
          $("deniedMessage").textContent="目前登入的 Google 帳號沒有管理員權限。";
          return;
        }

        $("adminAccount").textContent=user.email||"";
        show("app");
        applyRoleUi();
        await loadAccounts();
        await loadWhitelist();
        await loadRooms();
      }catch(error){
        console.error(error);
        show("deniedScreen");
        $("deniedMessage").textContent="管理員權限驗證失敗，請檢查 Firebase Rules。";
      }
    });
  }

  function setupEvents(){
    document.querySelectorAll(".nav-item").forEach(btn=>btn.addEventListener("click",()=>{
      document.querySelectorAll(".nav-item").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".admin-section").forEach(section=>section.classList.add("hidden"));
      show("section-"+btn.dataset.section);
    }));
    $("accountSearch")?.addEventListener("input",renderAccounts);
    $("roomSearch")?.addEventListener("input",renderRooms);
    $("whitelistSearch")?.addEventListener("input",renderWhitelist);
    $("addWhitelistBtn")?.addEventListener("click",()=>addWhitelist().catch(error=>{console.error(error);toast("加入白名單失敗");}));
    $("whitelistEmail")?.addEventListener("keydown",event=>{if(event.key==="Enter")void addWhitelist().catch(error=>{console.error(error);toast("加入白名單失敗");});});
    $("refreshBtn")?.addEventListener("click",()=>Promise.all([loadAccounts(),loadWhitelist()]).then(()=>toast("已重新整理")).catch(()=>toast("重新整理失敗")));
    $("accountsRefreshBtn")?.addEventListener("click",()=>loadAccounts().then(()=>toast("已重新整理")).catch(()=>toast("重新整理失敗")));
    $("roomsRefreshBtn")?.addEventListener("click",()=>loadRooms().then(()=>toast("已重新整理")).catch(()=>toast("重新整理失敗")));
    $("logoutBtn")?.addEventListener("click",()=>auth.signOut());
    $("switchAccountBtn")?.addEventListener("click",async()=>{
      try{
        const provider=new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({prompt:"select_account"});
        await auth.signInWithPopup(provider);
      }catch(error){
        console.error(error);
        toast("切換帳號失敗");
      }
    });
  }

  setupEvents();
  initialize();
})();