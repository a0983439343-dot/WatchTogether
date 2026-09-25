(() => {
  "use strict";

  const config=window.WATCHTOGETHER_CONFIG||{};
  const adminEmail=String(config.adminEmail||"").trim().toLowerCase();
  let auth=null,db=null,currentUser=null,accounts={},whitelist={};
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

  function encodeEmail(email){
    const bytes=new TextEncoder().encode(email);
    let binary="";
    for(const byte of bytes)binary+=String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  }

  function isAdminUser(user){
    return Boolean(user&&!user.isAnonymous&&user.email&&adminEmail&&String(user.email).trim().toLowerCase()===adminEmail&&user.emailVerified===true);
  }

  async function loadAccounts(){
    const snapshot=await db.ref("accounts").once("value");
    accounts=snapshot.val()||{};
    renderAccounts();
    updateStats();
  }

  async function loadWhitelist(){
    const snapshot=await db.ref("admin/whitelist").once("value");
    whitelist=snapshot.val()||{};
    renderWhitelist();
    updateStats();
  }

  function updateStats(){
    const list=Object.values(accounts||{}),wl=Object.values(whitelist||{});
    $("statAccounts").textContent=list.length;
    $("statWhitelist").textContent=wl.length;
    $("statWhitelistEnabled").textContent=wl.filter(x=>x&&x.enabled!==false).length;
    $("statCurrent").textContent=currentUser?1:0;
    const u=currentUser||{};
    $("adminInfo").innerHTML=[
      ["Email",u.email||"—"],["UID",u.uid||"—"],["Email 驗證",u.emailVerified===true?"已驗證":"未驗證"],["登入方式",(u.providerData&&u.providerData[0]&&u.providerData[0].providerId)||"Google"]
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
      return '<tr><td><div class="primary-text">'+escapeHtml(item.email||"—")+'</div><span class="small">'+(item.emailVerified===true?"Email 已驗證":"Email 未驗證")+'</span></td><td>'+escapeHtml(item.displayName||"—")+'</td><td><span class="small">'+escapeHtml(item.uid||"—")+(self?" · 管理員":"")+'</span></td><td>'+escapeHtml(item.provider||"—")+'</td><td>'+escapeHtml(formatDate(item.lastLoginAt))+'</td></tr>';
    }).join(""):'<tr><td colspan="5" class="muted">沒有符合條件的帳號。</td></tr>';
  }

  function renderWhitelist(){
    const query=String($("whitelistSearch")?.value||"").trim().toLowerCase();
    const rows=Object.entries(whitelist||{}).map(([key,item])=>({key,item})).filter(({item})=>item&&(!query||String(item.email||"").toLowerCase().includes(query))).sort((a,b)=>Number(b.item.addedAt||0)-Number(a.item.addedAt||0));
    $("whitelistCount").textContent=rows.length+" 筆";
    $("whitelistBody").innerHTML=rows.length?rows.map(({key,item})=>{
      const enabled=item.enabled!==false;
      return '<tr><td><div class="primary-text">'+escapeHtml(item.email||"—")+'</div></td><td><span class="status '+(enabled?"":"off")+'">'+(enabled?"啟用":"停用")+'</span></td><td>'+escapeHtml(formatDate(item.addedAt))+'</td><td>'+escapeHtml(item.addedByEmail||"—")+'</td><td><div class="row-actions"><button class="btn" data-toggle="'+escapeHtml(key)+'">'+(enabled?"停用":"啟用")+'</button><button class="btn" data-remove="'+escapeHtml(key)+'">刪除</button></div></td></tr>';
    }).join(""):'<tr><td colspan="5" class="muted">目前沒有白名單帳號。</td></tr>';
    $("whitelistBody").querySelectorAll("[data-toggle]").forEach(btn=>btn.addEventListener("click",()=>toggleWhitelist(btn.dataset.toggle)));
    $("whitelistBody").querySelectorAll("[data-remove]").forEach(btn=>btn.addEventListener("click",()=>removeWhitelist(btn.dataset.remove)));
  }

  async function addWhitelist(){
    const input=$("whitelistEmail");
    const email=String(input?.value||"").trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){toast("請輸入有效的 Email");return;}
    const key=encodeEmail(email);
    await db.ref("admin/whitelist/"+key).set({email,enabled:true,addedAt:firebase.database.ServerValue.TIMESTAMP,addedByUid:currentUser.uid,addedByEmail:currentUser.email||""});
    input.value="";
    await loadWhitelist();
    toast("已加入白名單");
  }

  async function toggleWhitelist(key){
    const item=whitelist[key]; if(!item)return;
    await db.ref("admin/whitelist/"+key).update({enabled:item.enabled===false,updatedAt:firebase.database.ServerValue.TIMESTAMP,updatedByUid:currentUser.uid});
    await loadWhitelist();
    toast(item.enabled===false?"已啟用":"已停用");
  }

  async function removeWhitelist(key){
    const item=whitelist[key]; if(!item)return;
    if(!window.confirm("確定刪除 "+(item.email||"這個帳號")+" 的白名單資格？"))return;
    await db.ref("admin/whitelist/"+key).remove();
    await loadWhitelist();
    toast("已刪除");
  }

  async function initialize(){
    if(!window.firebase||!window.FIREBASE_CONFIG){hide("loadingScreen");show("deniedScreen");$("deniedMessage").textContent="Firebase 設定未載入。";return;}
    if(!adminEmail){hide("loadingScreen");show("setupScreen");return;}
    if(!firebase.apps.length)firebase.initializeApp(window.FIREBASE_CONFIG);
    auth=firebase.auth();
    db=firebase.database();
    auth.onAuthStateChanged(async user=>{
      currentUser=user||null;
      if(!isAdminUser(user)){hide("loadingScreen");hide("app");show("deniedScreen");return;}
      $("adminAccount").textContent=user.email||"";
      hide("loadingScreen");hide("deniedScreen");show("app");
      try{await Promise.all([loadAccounts(),loadWhitelist()]);}
      catch(error){console.error(error);toast("後台資料讀取失敗，請檢查 Firebase Rules");}
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
    $("whitelistSearch")?.addEventListener("input",renderWhitelist);
    $("addWhitelistBtn")?.addEventListener("click",()=>addWhitelist().catch(error=>{console.error(error);toast("加入白名單失敗");}));
    $("whitelistEmail")?.addEventListener("keydown",event=>{if(event.key==="Enter")void addWhitelist().catch(error=>{console.error(error);toast("加入白名單失敗");});});
    $("refreshBtn")?.addEventListener("click",()=>Promise.all([loadAccounts(),loadWhitelist()]).then(()=>toast("已重新整理")).catch(()=>toast("重新整理失敗")));
    $("accountsRefreshBtn")?.addEventListener("click",()=>loadAccounts().then(()=>toast("已重新整理")).catch(()=>toast("重新整理失敗")));
    $("logoutBtn")?.addEventListener("click",()=>auth.signOut());
    $("switchAccountBtn")?.addEventListener("click",async()=>{
      try{const provider=new firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:"select_account"});await auth.signInWithPopup(provider);}
      catch(error){console.error(error);toast("切換帳號失敗");}
    });
  }

  setupEvents();
  initialize();
})();
