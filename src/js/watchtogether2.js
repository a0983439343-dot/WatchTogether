(() => {
  "use strict";

  const BUILD = "watchtogether-2.0-ui-v1";
  const $ = (id) => document.getElementById(id);

  function makeButton(icon, label, action, active=false) {
    const b=document.createElement("button");
    b.type="button";
    b.dataset.action=action;
    b.className=active ? "active" : "";
    b.innerHTML='<span class="wt2-nav-icon" aria-hidden="true">'+icon+'</span><span class="label">'+label+"</span>";
    return b;
  }

  function safeShowView(name){
    try {
      if(typeof window.showView === "function"){ window.showView(name); return true; }
      if(name==="home"){ $("homeView")?.classList.remove("hidden"); $("roomView")?.classList.add("hidden"); return true; }
      if(name==="room"){ $("homeView")?.classList.add("hidden"); $("roomView")?.classList.remove("hidden"); return true; }
    } catch(error){ console.warn("[WT2] view switch failed", error); }
    return false;
  }

  function scrollToId(id){
    const node=$(id);
    node?.scrollIntoView({behavior:"smooth",block:"center"});
  }

  function renderShell(){
    if(document.body.dataset.wt2Ready==="1") return;
    document.body.dataset.wt2Ready="1";
    document.body.classList.add("wt2-theme");

    const shell=document.querySelector(".app-shell");
    const header=shell?.querySelector(":scope > .topbar");
    const main=shell?.querySelector(":scope > main");
    if(!shell || !header || !main) return;

    const frame=document.createElement("div");
    frame.className="wt2-frame";

    const sidebar=document.createElement("aside");
    sidebar.className="wt2-sidebar";
    sidebar.innerHTML=
      '<div class="wt2-brand"><div class="wt2-brand-mark">▶</div><div class="wt2-brand-text">WATCHTOGETHER<span>VERSION 2.0</span></div></div>' +
      '<div class="wt2-nav" role="navigation" aria-label="主導覽"></div>' +
      '<div class="wt2-sidebar-foot"><div class="wt2-status-card"><div class="k">SYSTEM</div><div class="v" id="wt2SystemStatus">ONLINE</div></div></div>';

    const nav=sidebar.querySelector(".wt2-nav");
    const items=[
      ["⌂","首頁","home",true],
      ["▣","我的房間","rooms"],
      ["◇","探索","explore"],
      ["✦","AI","ai"],
      ["♟","好友","friends"],
      ["⚙","設定","settings"]
    ];
    items.forEach(([icon,label,action,active])=>nav.appendChild(makeButton(icon,label,action,active)));

    const content=document.createElement("div");
    content.className="wt2-main";
    const top=document.createElement("div");
    top.className="wt2-topbar";
    top.innerHTML='<div class="wt2-top-left"><div><div class="wt2-page-title" id="wt2PageTitle">首頁</div><div class="wt2-breadcrumb">WatchTogether 2.0</div></div></div><div class="wt2-top-actions" id="wt2TopActions"></div>';

    const mainContent=document.createElement("div");
    mainContent.className="wt2-content";
    content.append(top,mainContent);
    mainContent.appendChild(main);

    shell.innerHTML="";
    frame.append(sidebar,content);
    shell.appendChild(frame);

    const topActions=$("wt2TopActions");
    if(topActions){
      const auth=document.querySelector("#authStatus");
      const login=document.querySelector("#googleLoginBtn");
      const logout=document.querySelector("#logoutBtn");
      [auth,login,logout].forEach(node=>{ if(node) topActions.appendChild(node); });
      header.remove();
    }

    const visibilityWrap=document.createElement("div");
    visibilityWrap.className="wt2-room-visibility-wrap";
    visibilityWrap.innerHTML='<div class="wt2-section-label">房間類型</div><div class="wt2-visibility-options"><label class="wt2-visibility-option active"><input id="roomVisibilityInput" type="radio" name="wt2-room-visibility" value="personal" checked><span><strong>🔐 專屬房間</strong><small>與你的帳號綁定，永久保存</small></span></label><label class="wt2-visibility-option"><input type="radio" name="wt2-room-visibility" value="public"><span><strong>🌎 公開房間</strong><small>會出現在公開房間探索</small></span></label></div><div id="wt2VisibilityHint" class="wt2-visibility-hint">專屬房間會固定保留房主身份，不會因房主暫時離線而轉移。</div>';
    const creatorPanel=document.querySelector(".creator-panel");
    const roomName=document.querySelector("#roomNameInput");
    if(creatorPanel && roomName) creatorPanel.insertBefore(visibilityWrap,roomName.nextElementSibling);
    visibilityWrap.querySelectorAll("input[name=wt2-room-visibility]").forEach(input=>{
      input.addEventListener("change",()=>{
        visibilityWrap.querySelectorAll(".wt2-visibility-option").forEach(x=>x.classList.toggle("active",x.querySelector("input")===input));
        const hint=$("wt2VisibilityHint");
        if(hint) hint.textContent=input.value==="public"?"公開房間會出現在探索列表；後續可從房間設定加入密碼/審核等進階加入方式。":"專屬房間會固定保留房主身份，不會因房主暫時離線而轉移。";
      });
    });

    const moduleStrip=document.createElement("div");
    moduleStrip.className="wt2-module-strip";
    moduleStrip.innerHTML=
      '<button class="wt2-module-card" type="button" data-quick="create"><div class="icon">＋</div><strong>建立房間</strong><span>建立新的專屬或公開房間</span></button>'+
      '<button class="wt2-module-card" type="button" data-quick="join"><div class="icon">↗</div><strong>加入房間</strong><span>輸入房間碼快速加入</span></button>'+
      '<button class="wt2-module-card" type="button" data-quick="search"><div class="icon">⌕</div><strong>搜尋影片</strong><span>使用現有 YouTube 搜尋功能</span></button>'+
      '<button class="wt2-module-card" type="button" data-quick="ai"><div class="icon">✦</div><strong>AI 中心</strong><span>AI 搜尋與房間助手入口</span></button>';
    const home=$("homeView");
    home?.parentNode?.insertBefore(moduleStrip,home);

    const roomToggle=document.createElement("div");
    roomToggle.className="wt2-room-toggle";
    roomToggle.innerHTML='<button type="button" class="active" data-room-tab="personal">🔐 專屬房間</button><button type="button" data-room-tab="public">🌎 公開房間</button>';
    home?.insertBefore(roomToggle,home.querySelector(".home-grid"));

    const directory=document.createElement("section");
    directory.id="wt2RoomDirectory";
    directory.className="wt2-room-directory";
    directory.innerHTML='<div class="wt2-directory-head"><div><strong id="wt2DirectoryTitle">我的專屬房間</strong><span id="wt2DirectoryHint">與帳號綁定、可永久重新進入</span></div><button type="button" class="wt2-directory-refresh" id="wt2DirectoryRefresh">重新整理</button></div><div id="wt2RoomDirectoryBody" class="wt2-directory-grid"></div>';
    roomToggle.parentNode?.insertBefore(directory,home.querySelector(".home-grid"));

    const mobileNav=document.createElement("nav");
    mobileNav.className="wt2-mobile-nav";
    mobileNav.setAttribute("aria-label","行動版主導覽");
    items.slice(0,5).forEach(([icon,label,action,active])=>{
      const b=document.createElement("button");b.type="button";b.dataset.action=action;b.textContent=icon+" "+label;if(active)b.classList.add("active");mobileNav.appendChild(b);
    });
    document.body.appendChild(mobileNav);

    bindNavigation();
    bindQuickActions();
    bindRoomTabs();
    initRoomDirectory();
    watchRoomState();
  }

  function setActive(action){
    document.querySelectorAll("[data-action]").forEach(b=>b.classList.toggle("active",b.dataset.action===action));
    const titleMap={home:"首頁",rooms:"我的房間",explore:"探索",ai:"AI 中心",friends:"好友",settings:"設定"};
    if($("wt2PageTitle")) $("wt2PageTitle").textContent=titleMap[action]||"WatchTogether 2.0";
  }

  function bindNavigation(){
    document.querySelectorAll("[data-action]").forEach(button=>{
      button.addEventListener("click",()=>{
        const action=button.dataset.action;
        setActive(action);
        if(action==="home"){ safeShowView("home"); scrollToId("homeView"); return; }
        if(action==="rooms"){ safeShowView("home"); scrollToId("homeView"); const t=document.querySelector('[data-room-tab="personal"]'); t?.click(); return; }
        if(action==="explore"){ safeShowView("home"); scrollToId("videoSearchArea"); $("videoSearchInput")?.focus(); return; }
        if(action==="ai"){ safeShowView("home"); scrollToId("videoSearchArea"); $("videoSearchInput")?.focus(); if($("searchHint")) $("searchHint").textContent="AI 搜尋入口已就緒；自然語言搜尋會使用後續 AI Core。"; return; }
        if(action==="friends"){ safeShowView("home"); const node=document.querySelector(".wt-friends-layout"); node ? scrollToId(node.id||"homeView") : scrollToId("homeView"); return; }
        if(action==="settings"){ safeShowView("home"); const node=document.querySelector(".wt-settings-grid"); node ? node.scrollIntoView({behavior:"smooth"}) : scrollToId("homeView"); return; }
      });
    });
  }

  function bindQuickActions(){
    document.querySelectorAll("[data-quick]").forEach(b=>b.addEventListener("click",()=>{
      const action=b.dataset.quick;
      if(action==="create"){ safeShowView("home"); scrollToId("roomNameInput"); $("roomNameInput")?.focus(); }
      if(action==="join"){ safeShowView("home"); scrollToId("joinCodeInput"); $("joinCodeInput")?.focus(); }
      if(action==="search"){ safeShowView("home"); scrollToId("videoSearchInput"); $("videoSearchInput")?.focus(); }
      if(action==="ai"){ safeShowView("home"); scrollToId("videoSearchInput"); $("videoSearchInput")?.focus(); }
    }));
  }

  function renderRoomCard(item, kind){
    const card=document.createElement("article");
    card.className="wt2-directory-card";
    const roomId=String(item.roomId||item.id||"").toUpperCase();
    const title=escapeHtml(item.name||"一起看");
    const platform=escapeHtml(item.sourceType||"youtube");
    const count=Number(item.memberCount||0);
    card.innerHTML='<div class="wt2-directory-icon">'+(kind==="public"?"🌎":"🔐")+'</div><div class="wt2-directory-info"><strong>'+title+'</strong><span>'+roomId+' · '+platform+(kind==="public"&&count>0?' · '+count+' 人在線索引':"")+'</span></div><button type="button" class="wt2-directory-join">'+(kind==="public"?"加入":"重新進入")+'</button>';
    card.querySelector(".wt2-directory-join")?.addEventListener("click",()=>{
      const input=$("joinCodeInput");const btn=$("joinRoomBtn");
      if(input) input.value=roomId;
      safeShowView("home");
      scrollToId("joinCodeInput");
      btn?.click();
    });
    return card;
  }

  function renderDirectory(items,kind){
    const body=$("wt2RoomDirectoryBody");if(!body)return;
    body.innerHTML="";
    const list=Object.values(items||{}).filter(x=>x&&typeof x==="object").sort((a,b)=>Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0));
    if(!list.length){body.innerHTML='<div class="wt2-empty">'+(kind==="public"?"目前沒有可探索的公開房間。":"登入後建立專屬房間，它會永久出現在這裡。")+"</div>";return}
    list.slice(0,30).forEach(x=>body.appendChild(renderRoomCard(x,kind)));
  }

  function setDirectoryTab(kind){
    const title=$("wt2DirectoryTitle"),hint=$("wt2DirectoryHint");
    if(kind==="public"){if(title)title.textContent="公開房間";if(hint)hint.textContent="可探索、可直接加入的公開房間";loadPublicRooms();}
    else{if(title)title.textContent="我的專屬房間";if(hint)hint.textContent="與帳號綁定、可永久重新進入";loadPersonalRooms();}
  }

  async function loadPublicRooms(){
    const db=window.db||window.firebase?.database?.();if(!db)return;
    try{const s=await db.ref("publicRooms").limitToLast(50).once("value");renderDirectory(s.val()||{},"public");}
    catch(e){console.warn("[WT2] public room load:",e);renderDirectory({},"public");}
  }

  async function loadPersonalRooms(){
    const db=window.db||window.firebase?.database?.();const user=window.firebase?.auth?.().currentUser;
    if(!db||!user||user.isAnonymous){renderDirectory({},"personal");return}
    try{const s=await db.ref("profiles/"+user.uid+"/personalRooms").limitToLast(50).once("value");renderDirectory(s.val()||{},"personal");}
    catch(e){console.warn("[WT2] personal room load:",e);renderDirectory({},"personal");}
  }

  function initRoomDirectory(){
    document.querySelectorAll("[data-room-tab]").forEach(b=>b.addEventListener("click",()=>setDirectoryTab(b.dataset.roomTab==="public"?"public":"personal")));
    $("wt2DirectoryRefresh")?.addEventListener("click",()=>setDirectoryTab(document.querySelector("[data-room-tab].active")?.dataset.roomTab==="public"?"public":"personal"));
    setDirectoryTab("personal");
  }

  function bindRoomTabs(){
    document.querySelectorAll("[data-room-tab]").forEach(b=>b.addEventListener("click",()=>{
      const value=b.dataset.roomTab;
      document.querySelectorAll("[data-room-tab]").forEach(x=>x.classList.toggle("active",x===b));
      const empty=$("wt2PublicRoomsEmpty");
      const grid=document.querySelector(".home-grid");
      if(value==="public"){
        empty?.classList.remove("hidden");
        if(grid) grid.classList.add("hidden");
      }else{
        empty?.classList.add("hidden");
        if(grid) grid.classList.remove("hidden");
      }
    }));
  }

  function watchRoomState(){
    const roomView=$("roomView");
    if(!roomView) return;
    const observer=new MutationObserver(()=>{
      const inRoom=!roomView.classList.contains("hidden");
      if(inRoom) setActive("rooms");
    });
    observer.observe(roomView,{attributes:true,attributeFilter:["class"]});
  }

  function initSortableQueue(){
    if(!window.Sortable || !$("queueList")) return;
    const list=$("queueList");
    if(list.dataset.wt2Sortable==="1") return;
    try{
      Sortable.create(list,{animation:160,ghostClass:"wt2-sort-ghost",handle:".queue-drag-handle",fallbackOnBody:true});
      list.dataset.wt2Sortable="1";
    }catch(error){console.warn("[WT2] Sortable init failed",error);}
  }

  function applyUserRestrictions(value){
    const features=value?.features||{};
    const map={
      create_room:["createRoomBtn"],
      join_public_room:["joinRoomBtn"],
      chat:["chatForm","chatInput"],
      ai:[],
      ai_agent:[],
      uploads:[],
      friends:[],
      polls:[],
      playlists:["queueList"],
      public_explore:[]
    };
    Object.entries(map).forEach(([feature,ids])=>{
      const blocked=features[feature]===true;
      ids.forEach(id=>{
        const node=$(id); if(!node) return;
        node.disabled=blocked;
        node.setAttribute("aria-disabled",blocked?"true":"false");
        node.classList.toggle("wt2-restricted",blocked);
      });
    });
    const disabledLabels=[];
    if(features.create_room) disabledLabels.push("建立房間");
    if(features.chat) disabledLabels.push("聊天室");
    if(features.playlists) disabledLabels.push("播放佇列");
    const existing=document.getElementById("wt2RestrictionNotice");
    if(disabledLabels.length){
      const notice=existing||document.createElement("div");
      notice.id="wt2RestrictionNotice";notice.className="wt2-restriction-notice";
      notice.textContent="此帳號目前有部分功能受到限制："+disabledLabels.join("、")+"。";
      if(!existing) document.body.appendChild(notice);
    }else existing?.remove();
    document.body.classList.toggle("wt2-user-restricted",Object.values(features).some(Boolean));
  }

  function initRestrictionListener(){
    const tryAttach=()=>{
      const auth=window.firebase?.auth?.();
      const db=window.firebase?.database?.();
      if(!auth||!db){setTimeout(tryAttach,1000);return;}
      auth.onAuthStateChanged(user=>{
        if(!user||user.isAnonymous){applyUserRestrictions(null);return;}
        db.ref("admin/restrictionsByUid/"+user.uid).on("value",snap=>{
          const value=snap.val()||null;
          const until=Number(value?.blockedUntil||0);
          if(value && until!==0 && until<=Date.now()){applyUserRestrictions(null);return;}
          applyUserRestrictions(value);
        },error=>console.warn("[WT2] restriction listener:",error));
      });
    };
    tryAttach();
  }

  function initMaintenanceListener(){
    const db=window.db || window.firebase?.database?.();
    if(!db){setTimeout(initMaintenanceListener,1000); return;}
    try{
      db.ref("system/maintenance").on("value",snap=>{
        const state=snap.val();
        if(!state || state.enabled!==true){ hideMaintenance(); return; }
        const u=window.firebase?.auth?.().currentUser;
        const privileged=window.__WT2_ADMIN_AUTHORIZED__===true;
        if(privileged){ hideMaintenance(); return; }
        showMaintenance(state);
      });
    }catch(error){ console.warn("[WT2] maintenance listener:",error); }
  }

  function showMaintenance(state){
    let screen=$("wt2MaintenanceScreen");
    if(!screen){
      screen=document.createElement("div");
      screen.id="wt2MaintenanceScreen";
      screen.className="wt2-maintenance-screen hidden";
      document.body.appendChild(screen);
    }
    const ends=Number(state.endsAt||0);
    screen.innerHTML='<div class="wt2-maintenance-card"><div class="wt2-maintenance-icon">🔧</div><h1>WatchTogether 維護中</h1><p>'+escapeHtml(state.message||"系統正在進行維護，請稍後再回來。")+'</p><div class="wt2-maintenance-meta"><div class="box"><small>狀態</small><strong>🔴 維護中</strong></div><div class="box"><small>預計恢復</small><strong>'+(ends?new Date(ends).toLocaleString():"尚未設定")+'</strong></div></div></div>';
    screen.classList.remove("hidden");
  }

  function hideMaintenance(){ $("wt2MaintenanceScreen")?.classList.add("hidden"); }

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  function boot(){
    renderShell();
    initSortableQueue();
    initMaintenanceListener();
    initRestrictionListener();
    window.WatchTogether2={build:BUILD,refresh:()=>{renderShell();initSortableQueue();}};
    const observer=new MutationObserver(()=>initSortableQueue());
    const queue=$("queueList"); if(queue) observer.observe(queue,{childList:true,subtree:true});
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true}); else boot();
})();