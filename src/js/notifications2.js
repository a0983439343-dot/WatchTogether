(() => {
  "use strict";

  const $=id=>document.getElementById(id);
  let bound=false;

  function escapeHtml(value){
    return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  function ensureBell(){
    if(bound)return;
    const top=document.querySelector(".wt2-top-actions");
    if(!top)return;
    bound=true;
    const b=document.createElement("button");
    b.type="button";
    b.id="wt2NotificationBtn";
    b.className="wt2-notification-button";
    b.setAttribute("aria-label","通知");
    b.innerHTML='<span class="wt2-notification-icon">🔔</span><span id="wt2NotificationCount" class="wt2-notification-count hidden">0</span>';
    top.insertBefore(b,top.firstChild);
    b.addEventListener("click",togglePanel);
    buildPanel();
    bindRealtime();
  }

  function buildPanel(){
    if($("wt2NotificationPanel"))return;
    const p=document.createElement("section");
    p.id="wt2NotificationPanel";
    p.className="wt2-notification-panel hidden";
    p.innerHTML='<div class="wt2-notification-head"><div><strong>通知</strong><span id="wt2NotificationSub">好友邀請與系統狀態</span></div><button type="button" id="wt2NotificationClose">×</button></div><div id="wt2NotificationList" class="wt2-notification-list"></div>';
    document.body.appendChild(p);
    $("wt2NotificationClose")?.addEventListener("click",hidePanel);
    document.addEventListener("click",event=>{
      const panel=$("wt2NotificationPanel"),btn=$("wt2NotificationBtn");
      if(!panel||panel.classList.contains("hidden"))return;
      if(event.target===panel||panel.contains(event.target)||event.target===btn||btn?.contains(event.target))return;
      hidePanel();
    });
  }

  function hidePanel(){ $("wt2NotificationPanel")?.classList.add("hidden"); }
  function togglePanel(){ const p=$("wt2NotificationPanel");if(!p)return;p.classList.toggle("hidden");if(!p.classList.contains("hidden"))render(); }

  async function getUser(){
    const auth=window.firebase?.auth?.();
    const user=auth?.currentUser;
    return user && !user.isAnonymous ? user : null;
  }

  function renderData(requests,maintenance){
    const list=$("wt2NotificationList");if(!list)return;
    const entries=[];
    Object.entries(requests||{}).forEach(([uid,item])=>{
      if(!item||typeof item!=="object")return;
      entries.push({type:"friend",uid,createdAt:Number(item.createdAt||0),name:String(item.fromName||item.name||"有人"),avatar:String(item.avatarEmoji||"👤")});
    });
    if(maintenance?.enabled===true){
      entries.unshift({type:"system",createdAt:Number(maintenance.startedAt||0),name:"網站維護",message:String(maintenance.message||"網站目前正在維護。")});
    }
    entries.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
    if(!entries.length){
      list.innerHTML='<div class="wt2-empty">目前沒有新通知。</div>';
      return;
    }
    list.innerHTML=entries.slice(0,30).map(item=>{
      if(item.type==="system"){
        return '<article class="wt2-notification-item"><div class="wt2-notification-avatar">🔧</div><div class="wt2-notification-main"><strong>'+escapeHtml(item.name)+'</strong><p>'+escapeHtml(item.message)+'</p></div></article>';
      }
      return '<article class="wt2-notification-item"><div class="wt2-notification-avatar">'+escapeHtml(item.avatar)+'</div><div class="wt2-notification-main"><strong>'+escapeHtml(item.name)+'</strong><p>想加你為好友</p><div class="wt2-notification-actions"><button type="button" data-friend-approve="'+escapeHtml(item.uid)+'">核准</button><button type="button" data-friend-reject="'+escapeHtml(item.uid)+'">拒絕</button><button type="button" data-open-friends="1">查看好友</button></div></div></article>';
    }).join("");

    list.querySelectorAll("[data-friend-approve]").forEach(button=>{
      button.addEventListener("click",async()=>{
        button.disabled=true;
        try{
          const fn=window.WT_ENHANCEMENTS?.acceptFriend;
          if(typeof fn!=="function")throw new Error("好友系統尚未準備完成");
          await fn(button.dataset.friendApprove);
          await render();
        }catch(e){console.error(e);button.disabled=false;}
      });
    });
    list.querySelectorAll("[data-friend-reject]").forEach(button=>{
      button.addEventListener("click",async()=>{
        button.disabled=true;
        try{
          const fn=window.WT_ENHANCEMENTS?.declineFriend;
          if(typeof fn!=="function")throw new Error("好友系統尚未準備完成");
          await fn(button.dataset.friendReject);
          await render();
        }catch(e){console.error(e);button.disabled=false;}
      });
    });
    list.querySelectorAll("[data-open-friends]").forEach(button=>{
      button.addEventListener("click",()=>window.WT_ENHANCEMENTS?.openFriends?.());
    });
  }

  async function load(){
    const user=await getUser();
    const count=$("wt2NotificationCount");
    if(!user){
      if(count){count.classList.add("hidden");count.textContent="0";}
      renderData({},null);
      return;
    }
    const db=window.db||window.firebase?.database?.();
    if(!db)return;
    try{
      const [requestsSnap,maintenanceSnap]=await Promise.all([
        db.ref("friendRequests/"+user.uid).once("value"),
        db.ref("system/publicMaintenance").once("value")
      ]);
      const requests=requestsSnap.val()||{};
      const maintenance=maintenanceSnap.val()||null;
      const total=Object.keys(requests).length+(maintenance?.enabled===true?1:0);
      if(count){count.textContent=String(total);count.classList.toggle("hidden",total===0);}
      renderData(requests,maintenance);
    }catch(error){console.warn("[WT2] notifications:",error);}
  }

  async function render(){await load();}

  function bindRealtime(){
    const wait=()=>{
      const auth=window.firebase?.auth?.(),db=window.db||window.firebase?.database?.();
      if(!auth||!db){setTimeout(wait,1000);return;}
      auth.onAuthStateChanged(user=>{
        if(!user||user.isAnonymous){load();return;}
        db.ref("friendRequests/"+user.uid).on("value",load,error=>console.warn("[WT2] notification requests:",error));
        db.ref("system/publicMaintenance").on("value",load,error=>console.warn("[WT2] notification maintenance:",error));
      });
    };
    wait();
  }

  function boot(){
    ensureBell();
    if(!bound)setTimeout(boot,600);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
  window.WT2_NOTIFICATIONS={refresh:load,open:()=>{ensureBell();togglePanel();}};
})();