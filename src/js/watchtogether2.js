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
    visibilityWrap.innerHTML='<div class="wt2-section-label">房間類型</div><div class="wt2-visibility-options"><label class="wt2-visibility-option active"><input id="roomVisibilityInput" type="radio" name="wt2-room-visibility" value="personal" checked><span><strong>🔐 專屬房間</strong><small>與你的帳號綁定，永久保存</small></span></label><label class="wt2-visibility-option"><input type="radio" name="wt2-room-visibility" value="public"><span><strong>🌎 公開房間</strong><small>會出現在公開房間探索</small></span></label></div><div id="wt2PublicJoinModeWrap" class="wt2-public-join-mode hidden"><label for="wt2PublicJoinMode">公開房間加入方式<select id="wt2PublicJoinMode"><option value="open">立即加入</option><option value="approval">房主審核後加入</option></select></label></div><div id="wt2VisibilityHint" class="wt2-visibility-hint">專屬房間會固定保留房主身份，不會因房主暫時離線而轉移。</div>';
    const creatorPanel=document.querySelector(".creator-panel");
    const roomName=document.querySelector("#roomNameInput");
    if(creatorPanel && roomName) creatorPanel.insertBefore(visibilityWrap,roomName.nextElementSibling);
    $("wt2PublicJoinModeWrap")?.classList.add("hidden");
    visibilityWrap.querySelectorAll("input[name=wt2-room-visibility]").forEach(input=>{
      input.addEventListener("change",()=>{
        visibilityWrap.querySelectorAll(".wt2-visibility-option").forEach(x=>x.classList.toggle("active",x.querySelector("input")===input));
        const hint=$("wt2VisibilityHint");
        $("wt2PublicJoinModeWrap")?.classList.toggle("hidden",input.value!=="public");
        if(hint) hint.textContent=input.value==="public"?"公開房間會出現在探索列表，可選立即加入或房主審核。":"專屬房間會固定保留房主身份，不會因房主暫時離線而轉移。";
      });
    });

    const accountCard=document.createElement("div");
    accountCard.id="wt2AccountCard";
    accountCard.className="wt2-account-card";
    accountCard.innerHTML='<div class="wt2-account-avatar" id="wt2AccountAvatar">👤</div><div class="wt2-account-main"><strong id="wt2AccountName">訪客</strong><span id="wt2AccountCode">未登入</span></div><button type="button" id="wt2AccountAction">登入</button>';
    sidebar.querySelector(".wt2-sidebar-foot")?.prepend(accountCard);

    const moduleStrip=document.createElement("div");
    moduleStrip.className="wt2-module-strip";
    moduleStrip.innerHTML=
      '<button class="wt2-module-card" type="button" data-quick="create"><div class="icon">＋</div><strong>建立房間</strong><span>建立新的專屬或公開房間</span></button>'+
      '<button class="wt2-module-card" type="button" data-quick="join"><div class="icon">↗</div><strong>加入房間</strong><span>輸入房間碼快速加入</span></button>'+
      '<button class="wt2-module-card" type="button" data-quick="search"><div class="icon">⌕</div><strong>搜尋影片</strong><span>使用現有 YouTube 搜尋功能</span></button>'+
      '<button class="wt2-module-card" type="button" data-quick="ai"><div class="icon">✦</div><strong>AI 中心</strong><span>AI 搜尋與房間助手入口</span></button>';
    const home=$("homeView");
    home?.parentNode?.insertBefore(moduleStrip,home);

    const directory=document.createElement("section");
    directory.id="wt2RoomDirectory";
    directory.className="wt2-room-directory";
    directory.innerHTML='<div class="wt2-directory-head"><div><strong>房間中心</strong><span>專屬房間永久保存；公開房間可探索</span></div><button type="button" class="wt2-directory-refresh" id="wt2DirectoryRefresh">重新整理</button></div><div class="wt2-room-toggle"><button type="button" class="active" data-directory-tab="personal">🔐 專屬房間</button><button type="button" data-directory-tab="public">🌎 公開房間</button></div><div id="wt2PublicRoomSearchWrap" class="hidden wt2-public-room-search"><input id="wt2PublicRoomSearch" type="search" maxlength="80" placeholder="搜尋公開房間名稱或房間碼"><span id="wt2PublicRoomCount"></span></div><div id="wt2PersonalRoomList"></div><div id="wt2PublicRoomList" class="hidden"></div>';
    home?.insertBefore(directory,home.querySelector(".home-grid"));

    const aiPanel=document.createElement("section");
    aiPanel.id="wt2AiCenter";
    aiPanel.className="wt2-ai-center";
    aiPanel.innerHTML='<div class="wt2-ai-head"><div><div class="wt2-ai-kicker">AI CORE</div><h2>AI 中心</h2><p>用自然語言搜尋影片、查看房間、整理佇列與執行需要你確認的操作。</p></div><button type="button" id="wt2AiClear">清除對話</button></div><div class="wt2-ai-quick"><button type="button" data-ai-quick="找三部兩小時內的科幻片">找三部兩小時內的科幻片</button><button type="button" data-ai-quick="查看目前房間狀態">查看目前房間狀態</button><button type="button" data-ai-quick="幫我整理目前待播放清單">整理目前待播放清單</button></div><div class="wt2-ai-chat" id="wt2AiChat"><div class="wt2-ai-empty">還沒有 AI 對話。輸入你的需求開始。</div></div><div class="wt2-ai-input"><textarea id="wt2AiInput" rows="3" maxlength="2000" placeholder="例如：幫我找 5 部兩小時內的科幻片，然後挑出最適合大家看的。"></textarea><button type="button" id="wt2AiSend">送出</button></div><div id="wt2AiStatus" class="wt2-ai-status"></div>';
    const directoryNode=document.getElementById("wt2RoomDirectory");
    if(directoryNode) directoryNode.parentNode?.insertBefore(aiPanel,directoryNode);
    else home?.parentNode?.insertBefore(aiPanel,home);

    const mobileNav=document.createElement("nav");
    mobileNav.className="wt2-mobile-nav";
    mobileNav.setAttribute("aria-label","行動版主導覽");
    items.slice(0,5).forEach(([icon,label,action,active])=>{
      const b=document.createElement("button");b.type="button";b.dataset.action=action;b.textContent=icon+" "+label;if(active)b.classList.add("active");mobileNav.appendChild(b);
    });
    document.body.appendChild(mobileNav);

    bindNavigation();
    bindQuickActions();
    bindDirectoryTabs();
    bindAiPanel();
    bindThemePicker();
    bindAccountCard();
    watchRoomState();
    updateAccountCard();
  }

  function appendAiMessage(role,text){
    const chat=$("wt2AiChat");if(!chat)return;
    chat.querySelector(".wt2-ai-empty")?.remove();
    const item=document.createElement("div");
    item.className="wt2-ai-message "+(role==="user"?"user":"assistant");
    item.innerHTML='<div class="wt2-ai-role">'+(role==="user"?"你":"AI")+'</div><div class="wt2-ai-message-body">'+escapeHtml(String(text||""))+"</div>";
    chat.appendChild(item);
    chat.scrollTop=chat.scrollHeight;
  }

  async function sendAiPrompt(prompt){
    const input=$("wt2AiInput"),status=$("wt2AiStatus"),button=$("wt2AiSend");
    const text=String(prompt||input?.value||"").trim();
    if(!text)return;
    appendAiMessage("user",text);
    if(input)input.value="";
    if(button)button.disabled=true;
    if(status)status.textContent="AI 處理中…";
    try{
      if(!window.WT2_AI?.ask)throw new Error("AI Core 尚未載入");
      const message=await window.WT2_AI.ask(text);
      appendAiMessage("assistant",String(message?.content||"操作已完成。"));
      if(status)status.textContent="完成";
    }catch(error){
      appendAiMessage("assistant","⚠️ "+String(error?.message||error||"AI 操作失敗"));
      if(status)status.textContent="未完成";
    }finally{
      if(button)button.disabled=false;
    }
  }

  function openAICenter(){
    const panel=$("wt2AiCenter");
    if(panel){panel.scrollIntoView({behavior:"smooth",block:"start"});$("wt2AiInput")?.focus();}
  }

  function bindAiPanel(){
    $("wt2AiSend")?.addEventListener("click",()=>void sendAiPrompt());
    $("wt2AiInput")?.addEventListener("keydown",event=>{
      if(event.key==="Enter" && !event.shiftKey){
        event.preventDefault();
        void sendAiPrompt();
      }
    });
    $("wt2AiClear")?.addEventListener("click",()=>{
      window.WT2_AI?.clear?.();
      const chat=$("wt2AiChat");if(chat)chat.innerHTML='<div class="wt2-ai-empty">還沒有 AI 對話。輸入你的需求開始。</div>';
    });
    document.querySelectorAll("[data-ai-quick]").forEach(button=>{
      button.addEventListener("click",()=>{if($("wt2AiInput"))$("wt2AiInput").value=button.dataset.aiQuick||"";openAICenter();});
    });
  }

  function updateAccountCard(){
    const auth=window.firebase?.auth?.(),user=auth?.currentUser;
    const name=$("wt2AccountName"),code=$("wt2AccountCode"),avatar=$("wt2AccountAvatar"),action=$("wt2AccountAction");
    const enhancement=window.WT_ENHANCEMENTS;
    if(!user||user.isAnonymous){
      if(name)name.textContent="訪客";
      if(code)code.textContent="匿名觀看";
      if(avatar)avatar.textContent="👤";
      if(action){action.textContent="Google 登入";action.onclick=()=>document.getElementById("googleLoginBtn")?.click();}
      return;
    }
    const profile=enhancement?.state?.profile||{};
    if(name)name.textContent=String(user.displayName||"已登入").slice(0,30);
    if(code)code.textContent=String(profile.publicCode||"已登入").slice(0,20);
    if(avatar){
      avatar.innerHTML=user.photoURL?'<img src="'+escapeHtml(user.photoURL)+'" alt="">':'👤';
    }
    if(action){action.textContent="登出";action.onclick=()=>document.getElementById("logoutBtn")?.click();}
  }

  function bindAccountCard(){
    $("wt2PublicRoomSearch")?.addEventListener("input",renderPublicRoomEntries);
    const auth=window.firebase?.auth?.();
    auth?.onAuthStateChanged(()=>updateAccountCard());
  }

  function bindThemePicker(){
    let panel=$("wt2ThemePanel");
    if(panel)return;
    panel=document.createElement("section");
    panel.id="wt2ThemePanel";
    panel.className="wt2-theme-panel hidden";
    panel.innerHTML='<div class="wt2-theme-head"><strong>主題</strong><button type="button" id="wt2ThemeClose">×</button></div><div id="wt2ThemeGrid" class="wt2-theme-grid"></div>';
    document.body.appendChild(panel);
    const themes=window.WT_ENHANCEMENTS?.THEMES||window.WT_ENHANCEMENTS?.themes||[];
    const source=Array.isArray(themes)?themes:[];
    const grid=$("wt2ThemeGrid");
    if(grid){
      grid.innerHTML=source.map(theme=>{
        const id=String(theme.id||"");
        return '<button type="button" class="wt2-theme-choice" data-theme="'+escapeHtml(id)+'"><strong>'+escapeHtml(theme.name||id)+'</strong><small>'+escapeHtml(theme.desc||"")+'</small></button>';
      }).join("")||'<div class="wt2-empty">目前沒有可用主題。</div>';
      grid.querySelectorAll("[data-theme]").forEach(button=>{
        button.addEventListener("click",()=>{
          const id=String(button.dataset.theme||"");
          if(window.WT_ENHANCEMENTS?.applyTheme)window.WT_ENHANCEMENTS.applyTheme(id);
          panel.classList.add("hidden");
        });
      });
    }
    $("wt2ThemeClose")?.addEventListener("click",()=>panel.classList.add("hidden"));
    const settingsAction=document.querySelector('[data-action="settings"]');
    settingsAction?.addEventListener("dblclick",()=>{
      panel.classList.toggle("hidden");
    });
    window.addEventListener("watchtogether:settings-ready",()=>{
      panel.classList.add("hidden");
    });
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
        if(action==="rooms"){ safeShowView("home"); scrollToId("homeView"); const t=document.querySelector('[data-directory-tab="personal"]'); t?.click(); return; }
        if(action==="explore"){ safeShowView("home"); scrollToId("videoSearchArea"); $("videoSearchInput")?.focus(); return; }
        if(action==="ai"){ safeShowView("home"); openAICenter(); return; }
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
      if(action==="ai"){ safeShowView("home"); scrollToId("wt2AiCenter"); $("wt2AiPrompt")?.focus(); }
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

  async function deletePersonalRoom(roomId){
    const db=window.db||window.firebase?.database?.();
    const user=window.firebase?.auth?.().currentUser;
    const id=String(roomId||"").trim().toUpperCase();
    if(!db||!user||user.isAnonymous||!id)return;
    if(!window.confirm("確定要刪除這個專屬房間嗎？\n刪除後房間將不再出現在你的房間中心。"))return;
    const roomSnap=await db.ref("rooms/"+id).once("value");
    const room=roomSnap.val()||{};
    if(String(room.owner||"")!==String(user.uid||""))throw new Error("只有房主可以刪除專屬房間");
    await db.ref("rooms/"+id).remove();
    try{await db.ref("roomMeta/"+id).remove();}catch(error){console.warn("[WT2] roomMeta cleanup:",error);}
    try{await db.ref("publicRooms/"+id).remove();}catch(_){}
    try{await db.ref("profiles/"+user.uid+"/personalRooms/"+id).remove();}catch(error){console.warn("[WT2] personal index cleanup:",error);}
    await renderPersonalRooms();
  }

  async function renderPersonalRooms(){
    const user=window.firebase?.auth?.().currentUser,db=window.db||window.firebase?.database?.();
    const list=$("wt2PersonalRoomList"); if(!list)return;
    if(!user || user.isAnonymous || !db){list.innerHTML='<div class="wt2-empty">登入後可查看永久專屬房間。</div>';return;}
    try{
      const snap=await db.ref("profiles/"+user.uid+"/personalRooms").once("value");
      const value=snap.val()||{};
      const entries=Object.values(value).filter(room=>room&&typeof room==="object")
        .sort((a,b)=>Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0));
      list.innerHTML=entries.length
        ? entries.map(room=>{
            const id=escapeHtml(room.roomId||"");
            return '<article class="wt2-room-row"><span class="room-icon">🔐</span><span class="room-main"><strong>'+escapeHtml(room.name||"一起看")+'</strong><small>'+id+'</small></span><button type="button" class="room-go" data-open-room="'+id+'">進入 →</button><button type="button" class="room-delete" data-delete-room="'+id+'" title="刪除專屬房間">刪除</button></article>';
          }).join("")
        : '<div class="wt2-empty">還沒有專屬房間。建立一個就會永久保存在這裡。</div>';
      list.querySelectorAll("[data-open-room]").forEach(button=>button.addEventListener("click",()=>{
        window.WT_CORE?.joinRoom?.(button.dataset.openRoom).catch?.(error=>console.warn("[WT2] room join:",error));
      }));
      list.querySelectorAll("[data-delete-room]").forEach(button=>button.addEventListener("click",()=>{
        void deletePersonalRoom(button.dataset.deleteRoom).catch(error=>console.warn("[WT2] room delete:",error));
      }));
    }catch(error){
      list.innerHTML='<div class="wt2-empty">無法載入專屬房間。</div>';
      console.warn("[WT2] personal room list",error);
    }
  }

  let cachedPublicRooms=[];

  function currentPublicRoomQuery(){
    return String($("wt2PublicRoomSearch")?.value||"").trim().toLowerCase();
  }

  function renderPublicRoomEntries(){
    const list=$("wt2PublicRoomList"),count=$("wt2PublicRoomCount");
    if(!list)return;
    const query=currentPublicRoomQuery();
    const filtered=cachedPublicRooms.filter(room=>{
      if(!query)return true;
      return [room.name,room.roomId,room.sourceType].join(" ").toLowerCase().includes(query);
    });
    if(count)count.textContent=filtered.length+" 間";
    list.innerHTML=filtered.length
      ? filtered.map(room=>{
          const name=escapeHtml(room.name||"公開房間");
          const roomId=escapeHtml(room.roomId||"");
          const people=Number(room.memberCount||0);
          const mode=String(room.joinMode||"open")==="approval"?"需房主審核":"立即加入";
          return '<button type="button" class="wt2-room-row" data-open-room="'+roomId+'"><span class="room-icon">🌎</span><span class="room-main"><strong>'+name+'</strong><small>'+roomId+(people>0?" · "+people+" 人":"")+" · "+mode+'</small></span><span class="room-go">加入 →</span></button>';
        }).join("")
      : '<div class="wt2-empty">'+(query?"找不到符合的公開房間。":"目前沒有公開房間。")+'</div>';
    list.querySelectorAll("[data-open-room]").forEach(button=>button.addEventListener("click",()=>{
      window.WT_CORE?.joinRoom?.(button.dataset.openRoom).catch?.(error=>console.warn("[WT2] room join:",error));
    }));
  }

  async function renderPublicRooms(){
    const db=window.db||window.firebase?.database?.(),list=$("wt2PublicRoomList");
    if(!list||!db)return;
    try{
      const snap=await db.ref("publicRooms").once("value");
      cachedPublicRooms=Object.values(snap.val()||{})
        .filter(room=>room&&typeof room==="object")
        .sort((a,b)=>Number(b.updatedAt||b.createdAt||0)-Number(a.updatedAt||a.createdAt||0))
        .slice(0,100);
      renderPublicRoomEntries();
    }catch(error){
      list.innerHTML='<div class="wt2-empty">公開房間暫時無法載入。</div>';
      console.warn("[WT2] public room list",error);
    }
  }

  function bindDirectoryTabs(){
    document.querySelectorAll("[data-directory-tab]").forEach(b=>b.addEventListener("click",()=>{
      const tab=b.dataset.directoryTab;
      document.querySelectorAll("[data-directory-tab]").forEach(x=>x.classList.toggle("active",x===b));
      $("wt2PersonalRoomList")?.classList.toggle("hidden",tab!=="personal");
      $("wt2PublicRoomList")?.classList.toggle("hidden",tab!=="public");
      $("wt2PublicRoomSearchWrap")?.classList.toggle("hidden",tab!=="public");
      if(tab==="personal")void renderPersonalRooms();else void renderPublicRooms();
    }));
    const auth=window.firebase?.auth?.();
    auth?.onAuthStateChanged(()=>void renderPersonalRooms());
    $("wt2DirectoryRefresh")?.addEventListener("click",()=>{ const active=document.querySelector("[data-directory-tab].active")?.dataset.directoryTab; if(active==="public") void renderPublicRooms(); else void renderPersonalRooms(); });
    void renderPersonalRooms();
  }

  async function renderCohostPanel(){
    const roomState=window.WT_CORE?.state;
    const roomView=$("roomView");
    if(!roomView||!roomState)return;
    const show=Boolean(!roomView.classList.contains("hidden") && roomState.isOwner===true && roomState.roomId);
    let panel=$("wt2CohostPanel");
    if(!show){panel?.classList.add("hidden");return;}
    if(!panel){
      panel=document.createElement("section");
      panel.id="wt2CohostPanel";
      panel.className="wt2-cohost-panel";
      roomView.appendChild(panel);
    }
    panel.classList.remove("hidden");
    const db=window.db||window.firebase?.database?.();
    if(!db){panel.innerHTML='<strong>副房主管理</strong><div class="wt2-empty">資料庫尚未就緒。</div>';return;}
    try{
      const snapshot=await db.ref("members/"+roomState.roomId).once("value");
      const members=Object.entries(snapshot.val()||{}).filter(([uid])=>String(uid)!==String(roomState.uid));
      const roles=roomState.roomRoles||{};
      panel.innerHTML='<div class="wt2-approval-head"><div><strong>副房主管理</strong><span>可授予播放與佇列管理權</span></div><button type="button" id="wt2CohostRefresh">重新整理</button></div><div id="wt2CohostList"></div>';
      const list=$("wt2CohostList");
      if(!members.length){list.innerHTML='<div class="wt2-empty">目前沒有其他成員。</div>';return;}
      list.innerHTML=members.map(([uid,member])=>{
        const role=String(roles?.[uid]?.role||"viewer").toLowerCase();
        const name=escapeHtml(member?.name||uid);
        const safeUid=escapeHtml(uid);
        return '<div class="wt2-approval-row"><div><strong>'+name+'</strong><small>'+safeUid+' · '+(role==="cohost"?"副房主":"一般成員")+'</small></div><div class="wt2-approval-actions"><button type="button" data-cohost="'+safeUid+'" data-role="'+(role==="cohost"?"viewer":"cohost")+'">'+(role==="cohost"?"降為一般":"升為副房主")+'</button></div></div>';
      }).join("");
      list.querySelectorAll("[data-cohost]").forEach(button=>{
        button.addEventListener("click",async()=>{
          const uid=String(button.dataset.cohost||"").trim();
          const role=String(button.dataset.role||"viewer");
          if(!uid)return;
          button.disabled=true;
          try{
            await db.ref("roomRoles/"+roomState.roomId+"/"+uid).set({
              role,
              updatedAt:firebase.database.ServerValue.TIMESTAMP,
              updatedBy:roomState.uid
            });
            await renderCohostPanel();
          }catch(error){
            console.error("副房主設定失敗:",error);
            button.disabled=false;
          }
        });
      });
      $("wt2CohostRefresh")?.addEventListener("click",()=>void renderCohostPanel());
    }catch(error){
      console.warn("[WT2] cohost panel:",error);
      panel.innerHTML='<strong>副房主管理</strong><div class="wt2-empty">目前無法讀取成員。</div>';
    }
  }

  async function renderJoinApprovalPanel(){
    const roomState=window.WT_CORE?.state;
    const roomView=$("roomView");
    if(!roomView||!roomState)return;
    const shouldShow=Boolean(
      !roomView.classList.contains("hidden") &&
      roomState.isOwner === true &&
      String(roomState.room?.visibility || "") === "public" &&
      String(roomState.room?.joinMode || "") === "approval"
    );

    let panel=$("wt2JoinApprovalPanel");
    if(!shouldShow){
      panel?.classList.add("hidden");
      return;
    }

    if(!panel){
      panel=document.createElement("section");
      panel.id="wt2JoinApprovalPanel";
      panel.className="wt2-join-approval-panel";
      roomView.appendChild(panel);
    }

    panel.classList.remove("hidden");
    const db=window.db||window.firebase?.database?.();
    const roomId=String(roomState.roomId||"").trim().toUpperCase();
    if(!db||!roomId){
      panel.innerHTML='<strong>加入申請</strong><div class="wt2-empty">資料庫尚未就緒。</div>';
      return;
    }

    try{
      const snapshot=await db.ref("roomJoinRequests/"+roomId).once("value");
      const requests=Object.values(snapshot.val()||{})
        .filter(item=>item&&item.status==="pending"&&item.approved!==true)
        .sort((a,b)=>Number(a.requestedAt||0)-Number(b.requestedAt||0));

      panel.innerHTML='<div class="wt2-approval-head"><div><strong>加入申請</strong><span>'+requests.length+' 筆待處理</span></div><button type="button" id="wt2ApprovalRefresh">重新整理</button></div><div id="wt2ApprovalList"></div>';
      const list=$("wt2ApprovalList");
      if(!requests.length){
        list.innerHTML='<div class="wt2-empty">目前沒有待審核的加入申請。</div>';
      }else{
        list.innerHTML=requests.map(item=>{
          const uid=escapeHtml(item.uid||"");
          const name=escapeHtml(item.name||"玩家");
          const id=escapeHtml(item.uid||"");
          return '<div class="wt2-approval-row"><div><strong>'+name+'</strong><small>'+id+'</small></div><div class="wt2-approval-actions"><button type="button" data-approve="'+uid+'">核准</button><button type="button" data-reject="'+uid+'">拒絕</button></div></div>';
        }).join("");
      }

      list?.querySelectorAll("[data-approve]").forEach(button=>{
        button.addEventListener("click",async()=>{
          const uid=String(button.dataset.approve||"");
          if(!uid)return;
          button.disabled=true;
          try{
            await db.ref("roomJoinRequests/"+roomId+"/"+uid).update({
              status:"approved",
              approved:true,
              approvedAt:firebase.database.ServerValue.TIMESTAMP,
              approvedBy:roomState.uid
            });
            await renderJoinApprovalPanel();
          }catch(error){
            console.error("核准加入申請失敗:",error);
            button.disabled=false;
          }
        });
      });

      list?.querySelectorAll("[data-reject]").forEach(button=>{
        button.addEventListener("click",async()=>{
          const uid=String(button.dataset.reject||"");
          if(!uid)return;
          button.disabled=true;
          try{
            await db.ref("roomJoinRequests/"+roomId+"/"+uid).update({
              status:"rejected",
              approved:false,
              rejectedAt:firebase.database.ServerValue.TIMESTAMP,
              rejectedBy:roomState.uid
            });
            await renderJoinApprovalPanel();
          }catch(error){
            console.error("拒絕加入申請失敗:",error);
            button.disabled=false;
          }
        });
      });

      $("wt2ApprovalRefresh")?.addEventListener("click",()=>void renderJoinApprovalPanel());
    }catch(error){
      console.warn("[WT2] join approval:",error);
      panel.innerHTML='<strong>加入申請</strong><div class="wt2-empty">目前無法讀取加入申請。</div>';
    }
  }


  function ensureRoomSettingsPanel(){
    const roomView=$("roomView");
    if(!roomView || $("wt2RoomSettings")) return;
    const toolbar=roomView.querySelector(".room-toolbar");
    const left=toolbar?.querySelector(".room-meta");
    if(left){
      const button=document.createElement("button");
      button.type="button";
      button.id="wt2RoomSettingsBtn";
      button.className="tiny-btn hidden";
      button.textContent="⚙ 房間設定";
      left.appendChild(button);
    }

    const panel=document.createElement("section");
    panel.id="wt2RoomSettings";
    panel.className="panel wt2-room-settings hidden";
    panel.innerHTML='<div class="wt2-room-settings-head"><div><strong>房間設定</strong><small>只有房主可以修改</small></div><button type="button" id="wt2RoomSettingsClose">×</button></div><div class="wt2-room-settings-form"><label class="wt2-room-setting-check"><input id="wt2RoomLocked" type="checkbox"><span><strong>鎖定新成員</strong><small>開啟後，不再接受新的成員加入；目前成員不受影響。</small></span></label><label>最大成員數<select id="wt2RoomMaxMembers"><option value="2">2 人</option><option value="3">3 人</option><option value="4">4 人</option><option value="5">5 人</option><option value="6">6 人</option><option value="7">7 人</option><option value="8">8 人</option><option value="9">9 人</option><option value="10">10 人</option></select></label><label>新成員加入方式<select id="wt2RoomJoinMode"><option value="open">立即加入</option><option value="approval">房主審核</option><option value="invite_only">邀請制</option></select></label><div id="wt2InviteManager" class="wt2-invite-manager hidden"><div class="wt2-section-label">邀請名單</div><div class="wt2-invite-form"><input id="wt2InviteUid" maxlength="128" placeholder="輸入要邀請的使用者 UID"><button type="button" class="tiny-btn" id="wt2InviteAdd">加入邀請名單</button></div><div id="wt2InviteList" class="wt2-invite-list"></div></div><div id="wt2RoomSettingsHint" class="wt2-muted"></div><button type="button" class="primary-btn" id="wt2RoomSettingsSave">儲存設定</button></div>';
    roomView.appendChild(panel);

    $("wt2RoomSettingsBtn")?.addEventListener("click",()=>{refreshRoomSettingsPanel();panel.classList.toggle("hidden");});
    $("wt2RoomSettingsClose")?.addEventListener("click",()=>panel.classList.add("hidden"));
    $("wt2RoomSettingsSave")?.addEventListener("click",()=>void saveRoomSettings());
    $("wt2InviteAdd")?.addEventListener("click",()=>void addRoomInvite());
  }

  function refreshRoomSettingsPanel(){
    const state=window.WT_CORE?.state;
    const button=$("wt2RoomSettingsBtn"),panel=$("wt2RoomSettings");
    if(!state||!button||!panel)return;
    const owner=state.isOwner===true;
    button.classList.toggle("hidden",!owner);
    if(!owner){panel.classList.add("hidden");return}
    const settings=state.room?.settings||{};
    const locked=settings.locked===true;
    const max=Math.max(2,Math.min(10,Number(settings.maxMembers||2)));
    const visibility=String(state.room?.visibility||"personal");
    const joinMode=visibility==="personal"?"invite_only":String(state.room?.joinMode||"open");
    if($("wt2RoomLocked"))$("wt2RoomLocked").checked=locked;
    if($("wt2RoomMaxMembers"))$("wt2RoomMaxMembers").value=String(max);
    if($("wt2RoomJoinMode")){
      $("wt2RoomJoinMode").value=joinMode;
      $("wt2RoomJoinMode").disabled=visibility==="personal";
      $("wt2InviteManager")?.classList.toggle("hidden",joinMode!=="invite_only");
    }
    if(joinMode==="invite_only")void renderRoomInvites();
  }

  async function renderRoomInvites(){
    const state=window.WT_CORE?.state;
    const db=window.db||window.firebase?.database?.();
    const roomId=String(state?.roomId||"").trim().toUpperCase();
    const list=$("wt2InviteList");
    if(!state?.isOwner||!db||!roomId||!list)return;
    try{
      const snap=await db.ref("roomInvites/"+roomId).once("value");
      const entries=Object.entries(snap.val()||{}).filter(([,v])=>v===true);
      list.innerHTML=entries.length
        ? entries.map(([uid])=>'<div class="wt2-invite-row"><span>'+escapeHtml(uid)+'</span><button type="button" class="tiny-btn" data-remove-invite="'+escapeHtml(uid)+'">移除</button></div>').join("")
        : '<div class="wt2-empty">目前沒有邀請成員。</div>';
      list.querySelectorAll("[data-remove-invite]").forEach(button=>{
        button.addEventListener("click",async()=>{
          const uid=String(button.dataset.removeInvite||"").trim();
          if(!uid)return;
          button.disabled=true;
          try{await db.ref("roomInvites/"+roomId+"/"+uid).remove();await renderRoomInvites();}
          catch(error){button.disabled=false;console.warn("[WT2] remove invite:",error);}
        });
      });
    }catch(error){
      list.innerHTML='<div class="wt2-empty">無法讀取邀請名單。</div>';
      console.warn("[WT2] room invites:",error);
    }
  }

  async function addRoomInvite(){
    const state=window.WT_CORE?.state;
    const db=window.db||window.firebase?.database?.();
    const roomId=String(state?.roomId||"").trim().toUpperCase();
    const uid=String($("wt2InviteUid")?.value||"").trim();
    const hint=$("wt2RoomSettingsHint");
    if(!state?.isOwner||!db||!roomId||!uid)return;
    if(uid.length<8||uid.length>128){if(hint)hint.textContent="UID 長度不正確。";return}
    try{
      await db.ref("roomInvites/"+roomId+"/"+uid).set(true);
      $("wt2InviteUid").value="";
      if(hint)hint.textContent="已加入邀請名單。";
      await renderRoomInvites();
      setTimeout(()=>{if(hint)hint.textContent=""},1600);
    }catch(error){
      if(hint)hint.textContent="加入邀請名單失敗："+String(error?.message||error);
      console.warn("[WT2] add invite:",error);
    }
  }


  async function saveRoomSettings(){
    const state=window.WT_CORE?.state;
    const db=window.db||window.firebase?.database?.();
    const roomId=String(state?.roomId||"").trim().toUpperCase();
    if(!state?.isOwner||!db||!roomId){return}
    const locked=Boolean($("wt2RoomLocked")?.checked);
    const maxMembers=Math.max(2,Math.min(10,Number($("wt2RoomMaxMembers")?.value||2)));
    const visibility=String(state.room?.visibility||"personal");
    const joinMode=visibility==="personal"?"invite_only":String($("wt2RoomJoinMode")?.value||"open");
    const allowedJoinModes=new Set(["open","approval","invite_only"]);
    const safeJoinMode=allowedJoinModes.has(joinMode)?joinMode:"open";
    const hint=$("wt2RoomSettingsHint");
    try{
      await db.ref("roomMeta/"+roomId).update({
        joinMode:safeJoinMode,
        settings:{locked,maxMembers}
      });
      if(state.room) state.room.settings={...(state.room.settings||{}),locked,maxMembers};
      if(state.room) state.room.joinMode=safeJoinMode;
      if(hint)hint.textContent="設定已儲存。";
      setTimeout(()=>hint&&(hint.textContent=""),1600);
    }catch(error){
      if(hint)hint.textContent="儲存失敗："+String(error?.message||error);
      console.warn("[WT2] room settings:",error);
    }
  }

  function watchRoomState(){
    const roomView=$("roomView");
    if(!roomView) return;
    const observer=new MutationObserver(()=>{
      const inRoom=!roomView.classList.contains("hidden");
      if(inRoom){ setActive("rooms"); refreshRoomSettingsPanel(); }
    });
    observer.observe(roomView,{attributes:true,attributeFilter:["class"]});
    void renderJoinApprovalPanel();
    void renderCohostPanel();
    const timer=setInterval(()=>void renderJoinApprovalPanel(),5000);
    roomView.dataset.wt2ApprovalTimer="1";
    roomView.addEventListener("wt2-room-state-changed",()=>{ void renderJoinApprovalPanel(); void renderCohostPanel(); });
  }

    function initSortableQueue(){
    if(!window.Sortable || !$("queueList")) return;
    const list=$("queueList");
    if(list.dataset.wt2Sortable==="1") return;
    if(!window.WT_CORE?.canControlRoomPlayback?.() && !window.WT_CORE?.state?.isOwner) return;

    try{
      Sortable.create(list,{
        animation:160,
        handle:".wt2-queue-drag-handle",
        filter:"button,input,textarea,a,img",
        preventOnFilter:false,
        ghostClass:"wt2-sort-ghost",
        fallbackOnBody:true,
        onEnd:async()=>{
          const roomId=window.WT_CORE?.getRoomId?.();
          const db=window.db||window.firebase?.database?.();
          if(!roomId||!db||(!window.WT_CORE?.canControlRoomPlayback?.() && !window.WT_CORE?.state?.isOwner))return;

          const rows=[...list.querySelectorAll(".queue-item[data-queue-id]")];
          const base=Date.now();
          try{
            await Promise.all(rows.map((row,index)=>{
              const queueId=String(row.dataset.queueId||"").trim();
              return queueId ? db.ref("queue/"+roomId+"/"+queueId+"/queueOrder").set(base+index) : Promise.resolve();
            }));
            if(typeof window.WT_CORE.refreshQueue==="function") window.WT_CORE.refreshQueue();
          }catch(error){
            console.warn("[WT2] queue reorder failed:",error);
          }
        }
      });
      list.dataset.wt2Sortable="1";
    }catch(error){console.warn("[WT2] Sortable init failed",error);}
  }

  function applyGlobalFeatureFlags(flags){
    const normalized=flags&&typeof flags==="object"?flags:{};
    const map={
      create_room:["createRoomBtn"],
      chat:["chatForm","chatInput"],
      playlists:["queueList","playQueueNowBtn"],
      ai:[],
      ai_agent:[],
      uploads:[],
      friends:[],
      polls:[],
      public_explore:[],
      schedules:[]
    };
    const blocked=[];
    Object.entries(map).forEach(([feature,ids])=>{
      const isBlocked=normalized[feature]===false;
      ids.forEach(id=>{
        const node=$(id);if(!node)return;
        node.disabled=isBlocked;
        node.classList.toggle("wt2-feature-disabled",isBlocked);
        node.setAttribute("aria-disabled",isBlocked?"true":"false");
      });
      if(isBlocked)blocked.push(feature);
    });
    const existing=document.getElementById("wt2GlobalFeatureNotice");
    if(blocked.length){
      const notice=existing||document.createElement("div");
      notice.id="wt2GlobalFeatureNotice";
      notice.className="wt2-global-feature-notice";
      notice.textContent="部分網站功能目前暫停使用。";
      if(!existing)document.body.appendChild(notice);
    }else existing?.remove();
  }

  function initGlobalFeatureFlagListener(){
    const wait=()=>{
      const db=window.db||window.firebase?.database?.();
      if(!db){setTimeout(wait,1000);return;}
      db.ref("system/featureFlags").on("value",snap=>{
        applyGlobalFeatureFlags(snap.val()||{});
      },error=>console.warn("[WT2] feature flags:",error));
    };
    wait();
  }

  function applyUserRestrictions(value){
    const features=value?.features||{};
    const map={
      create_room:["createRoomBtn"],
      chat:["chatForm","chatInput"],
      ai:[],
      ai_agent:[],
      uploads:[],
      friends:[],
      polls:[],
      playlists:["queueList"],
      playback_control:["playPauseBtn","syncNowBtn"],
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
    if(features.playback_control) disabledLabels.push("播放控制");
    const existing=document.getElementById("wt2RestrictionNotice");
    if(disabledLabels.length){
      const notice=existing||document.createElement("div");
      notice.id="wt2RestrictionNotice";notice.className="wt2-restriction-notice";
      notice.textContent="此帳號目前有部分功能受到限制："+disabledLabels.join("、")+"。";
      if(!existing) document.body.appendChild(notice);
    }else existing?.remove();
    document.body.classList.toggle("wt2-user-restricted",Object.values(features).some(Boolean));
  }

  function applyFeatureFlags(flags){
    const value=flags&&typeof flags==="object"?flags:{};
    const map={
      create_room:["createRoomBtn"],
      chat:["chatForm","chatInput"],
      playlists:["queueList"],
      public_explore:["wt2PublicRoomList"],
      schedules:["wt2SchedulePanel"],
      ai:["wt2AiCenter"]
    };
    const disabled=[];
    Object.entries(map).forEach(([key,ids])=>{
      const off=value[key]===false;
      if(off) disabled.push(key);
      ids.forEach(id=>{
        const node=$(id);if(!node)return;
        node.disabled=off;
        node.classList.toggle("wt2-feature-off",off);
        if(off) node.setAttribute("aria-disabled","true"); else node.removeAttribute("aria-disabled");
      });
    });
    const ai=$("wt2AiCenter");if(ai)ai.classList.toggle("hidden",value.ai===false);
    const existing=$("wt2FeatureNotice");
    if(disabled.length){
      const notice=existing||document.createElement("div");
      notice.id="wt2FeatureNotice";notice.className="wt2-feature-notice";
      notice.textContent="部分網站功能目前暫停："+disabled.join("、");
      if(!existing)document.body.appendChild(notice);
    }else existing?.remove();
  }

  function initFeatureFlagListener(){
    const db=window.db||window.firebase?.database?.();
    if(!db){setTimeout(initFeatureFlagListener,1000);return;}
    try{
      db.ref("system/featureFlags").on("value",snap=>applyFeatureFlags(snap.val()||{}));
    }catch(error){console.warn("[WT2] feature flags:",error);}
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

  async function isAdminForMaintenance(){
    if(window.__WT2_ADMIN_AUTHORIZED__===true) return true;
    const auth=window.firebase?.auth?.();
    const db=window.db || window.firebase?.database?.();
    const user=auth?.currentUser;
    if(!user || user.isAnonymous || !db) return false;
    const MASTER_UID="35d45a23-b648-4caf-a6d5-a69112860551";
    if(String(user.uid||"")===MASTER_UID) return true;
    try{
      const snapshot=await db.ref("admin/whitelistByUid/"+user.uid).once("value");
      const value=snapshot.val();
      return Boolean(value?.enabled===true && ["admin","master"].includes(String(value.role||"admin")));
    }catch(_){ return false; }
  }

  function initMaintenanceListener(){
    const db=window.db || window.firebase?.database?.();
    if(!db){setTimeout(initMaintenanceListener,1000); return;}
    const apply=async(state)=>{
      if(!state || state.enabled!==true){ hideMaintenance(); return; }
      if(await isAdminForMaintenance()){ hideMaintenance(); return; }
      showMaintenance(state);
    };
    try{
      db.ref("system/maintenance").on("value",snap=>{ void apply(snap.val()); });
      const auth=window.firebase?.auth?.();
      auth?.onAuthStateChanged(()=>{ void db.ref("system/maintenance").once("value").then(snap=>apply(snap.val())); });
    }catch(error){ console.warn("[WT2] maintenance listener:", error); }
  }
  let maintenanceCountdownTimer=null;

  function formatMaintenanceCountdown(ms){
    const total=Math.max(0,Math.ceil(Number(ms||0)/1000));
    const days=Math.floor(total/86400);
    const hours=Math.floor((total%86400)/3600);
    const minutes=Math.floor((total%3600)/60);
    const seconds=total%60;
    if(days>0) return days+" 天 "+String(hours).padStart(2,"0")+" 時 "+String(minutes).padStart(2,"0")+" 分";
    return String(hours).padStart(2,"0")+":"+String(minutes).padStart(2,"0")+":"+String(seconds).padStart(2,"0");
  }

  function clearMaintenanceCountdown(){
    if(maintenanceCountdownTimer){
      clearInterval(maintenanceCountdownTimer);
      maintenanceCountdownTimer=null;
    }
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
    screen.innerHTML='<div class="wt2-maintenance-card"><div class="wt2-maintenance-icon">🔧</div><div class="wt2-ai-kicker">SERVER MAINTENANCE</div><h1>WatchTogether 維護中</h1><p>'+escapeHtml(state.message||"系統正在進行維護，請稍後再回來。")+'</p><div class="wt2-maintenance-meta"><div class="box"><small>狀態</small><strong>🔴 維護中</strong></div><div class="box"><small>預計恢復</small><strong id="wt2MaintenanceEnds">'+(ends?new Date(ends).toLocaleString():"尚未設定")+'</strong></div><div class="box"><small>剩餘時間</small><strong id="wt2MaintenanceCountdown">'+(ends?formatMaintenanceCountdown(ends-Date.now()):"未設定")+'</strong></div></div></div>';
    screen.classList.remove("hidden");
    clearMaintenanceCountdown();
    if(ends>0){
      const tick=()=>{
        const remain=ends-Date.now();
        const node=$("wt2MaintenanceCountdown");
        if(remain<=0){
          clearMaintenanceCountdown();
          location.reload();
          return;
        }
        if(node)node.textContent=formatMaintenanceCountdown(remain);
      };
      tick();
      maintenanceCountdownTimer=setInterval(tick,1000);
    }
  }

  function hideMaintenance(){
    clearMaintenanceCountdown();
    $("wt2MaintenanceScreen")?.classList.add("hidden");
  }

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  function boot(){
    renderShell();
    initSortableQueue();
    initMaintenanceListener();
    initRestrictionListener();
    initFeatureFlagListener();
    initGlobalFeatureFlagListener();
    window.WatchTogether2={build:BUILD,refresh:()=>{renderShell();initSortableQueue();}};
    const observer=new MutationObserver(()=>initSortableQueue());
    const queue=$("queueList"); if(queue) observer.observe(queue,{childList:true,subtree:true});
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot,{once:true}); else boot();
})();