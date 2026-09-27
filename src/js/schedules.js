(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  function escapeHtml(value){
    return String(value ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  function currentUser(){
    const user=window.firebase?.auth?.().currentUser;
    return user && !user.isAnonymous ? user : null;
  }

  function db(){
    return window.db || window.firebase?.database?.();
  }

  function localDateTime(value){
    const date=new Date(Number(value||0));
    if(!Number.isFinite(date.getTime()))return "—";
    return date.toLocaleString();
  }

  function ensureModal(){
    if($("wt2ScheduleModal"))return;
    const modal=document.createElement("div");
    modal.id="wt2ScheduleModal";
    modal.className="wt2-schedule-modal hidden";
    modal.innerHTML='<div class="wt2-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="wt2ScheduleTitle"><div class="wt2-schedule-head"><div><strong id="wt2ScheduleTitle">預約觀看</strong><span>安排一場即將開始的觀看場次</span></div><button type="button" id="wt2ScheduleClose">×</button></div><div class="wt2-schedule-form"><label>房間代碼<input id="wt2ScheduleRoom" maxlength="6" placeholder="例如 K7M4Q9"></label><label>場次名稱<input id="wt2ScheduleName" maxlength="80" placeholder="例如：今晚一起看"></label><label>開始時間<input id="wt2ScheduleStart" type="datetime-local"></label><label>提前提醒<select id="wt2ScheduleReminder"><option value="0">不提醒</option><option value="5">5 分鐘前</option><option value="15" selected>15 分鐘前</option><option value="30">30 分鐘前</option><option value="60">1 小時前</option></select></label><div id="wt2ScheduleError" class="wt2-schedule-error"></div></div><div class="wt2-schedule-actions"><button type="button" id="wt2ScheduleCancel">取消</button><button type="button" id="wt2ScheduleSave">建立預約</button></div></div>';
    document.body.appendChild(modal);
    $("wt2ScheduleClose")?.addEventListener("click",closeModal);
    $("wt2ScheduleCancel")?.addEventListener("click",closeModal);
    modal.addEventListener("click",event=>{if(event.target===modal)closeModal();});
    $("wt2ScheduleSave")?.addEventListener("click",()=>void saveSchedule());
  }

  function openModal(prefillRoom=""){
    ensureModal();
    const user=currentUser();
    if(!user){
      $("wt2ScheduleError").textContent="請先使用 Google 登入。";
      $("wt2ScheduleModal").classList.remove("hidden");
      return;
    }
    $("wt2ScheduleRoom").value=String(prefillRoom||"").toUpperCase().slice(0,6);
    $("wt2ScheduleName").value="";
    const start=new Date(Date.now()+60*60*1000);
    start.setSeconds(0,0);
    const offset=start.getTimezoneOffset()*60000;
    $("wt2ScheduleStart").value=new Date(start-offset).toISOString().slice(0,16);
    $("wt2ScheduleReminder").value="15";
    $("wt2ScheduleError").textContent="";
    $("wt2ScheduleModal").classList.remove("hidden");
    $("wt2ScheduleName")?.focus();
  }

  function closeModal(){ $("wt2ScheduleModal")?.classList.add("hidden"); }

  async function saveSchedule(){
    const user=currentUser(),database=db(),error=$("wt2ScheduleError");
    if(!user||!database){if(error)error.textContent="登入狀態尚未準備完成。";return}
    const roomId=String($("wt2ScheduleRoom")?.value||"").trim().toUpperCase();
    const name=String($("wt2ScheduleName")?.value||"預約觀看").trim().slice(0,80)||"預約觀看";
    const startValue=String($("wt2ScheduleStart")?.value||"");
    const startAt=Date.parse(startValue);
    const reminderMinutes=Math.max(0,Math.min(1440,Number($("wt2ScheduleReminder")?.value||0)));
    if(!/^[A-Z0-9]{6}$/.test(roomId)){if(error)error.textContent="請輸入 6 碼房間代碼。";return}
    if(!Number.isFinite(startAt)||startAt<=Date.now()){if(error)error.textContent="開始時間必須在未來。";return}
    try{
      const roomSnap=await database.ref("rooms/"+roomId).once("value");
      if(!roomSnap.exists()){if(error)error.textContent="找不到這個房間。";return}
      const key=database.ref("profiles/"+user.uid+"/watchSchedules").push().key;
      await database.ref("profiles/"+user.uid+"/watchSchedules/"+key).set({
        id:key,
        roomId,
        name,
        startAt,
        reminderMinutes,
        createdAt:firebase.database.ServerValue.TIMESTAMP,
        updatedAt:firebase.database.ServerValue.TIMESTAMP
      });
      closeModal();
      await renderSchedules();
    }catch(e){
      console.error("[WT2] schedule save",e);
      if(error)error.textContent=String(e?.message||"預約建立失敗。");
    }
  }

  function renderList(items){
    const root=$("wt2ScheduleList");if(!root)return;
    const list=Object.values(items||{})
      .filter(x=>x&&x.startAt&&Number(x.startAt)>Date.now()-10*60*1000)
      .sort((a,b)=>Number(a.startAt)-Number(b.startAt))
      .slice(0,20);
    if(!list.length){root.innerHTML='<div class="wt2-empty">目前沒有預約場次。</div>';return}
    root.innerHTML=list.map(item=>{
      const id=escapeHtml(item.id||"");
      return '<article class="wt2-schedule-row"><div class="wt2-schedule-dot">◷</div><div class="wt2-schedule-main"><strong>'+escapeHtml(item.name||"預約觀看")+'</strong><span>'+escapeHtml(item.roomId||"")+" · "+escapeHtml(localDateTime(item.startAt))+(Number(item.reminderMinutes||0)?' · 提前 '+Number(item.reminderMinutes)+' 分鐘提醒':"")+'</span></div><button type="button" data-schedule-join="'+id+'">進入</button></article>';
    }).join("");
    root.querySelectorAll("[data-schedule-join]").forEach(button=>{
      button.addEventListener("click",async()=>{
        const item=list.find(x=>String(x.id)===String(button.dataset.scheduleJoin||""));
        if(!item)return;
        const fn=window.WT_CORE?.joinRoom;
        if(typeof fn!=="function"){alert("加入房間功能尚未準備完成。");return}
        await fn(String(item.roomId||""));
      });
    });
  }

  async function renderSchedules(){
    const user=currentUser(),database=db(),root=$("wt2ScheduleList");
    if(!root)return;
    if(!user){root.innerHTML='<div class="wt2-empty">登入後可以建立與查看預約場次。</div>';updateBadge(0);return}
    try{
      const snap=await database.ref("profiles/"+user.uid+"/watchSchedules").limitToLast(50).once("value");
      const values=snap.val()||{};
      const future=Object.values(values).filter(x=>x&&Number(x.startAt)>Date.now());
      renderList(values);
      updateBadge(future.length);
    }catch(error){console.warn("[WT2] schedule load",error);root.innerHTML='<div class="wt2-empty">預約資料暫時無法載入。</div>';}
  }

  function updateBadge(count){
    const badge=$("wt2ScheduleCount");
    if(!badge)return;
    badge.textContent=String(count);
    badge.classList.toggle("hidden",count===0);
  }

  function injectPanel(){
    if($("wt2SchedulePanel"))return;
    const home=$("homeView");
    const directory=$("wt2RoomDirectory");
    const panel=document.createElement("section");
    panel.id="wt2SchedulePanel";
    panel.className="wt2-schedule-panel";
    panel.innerHTML='<div class="wt2-schedule-panel-head"><div><div class="wt2-ai-kicker">WATCH PLANNER</div><h2>預約觀看</h2><p>先排好時間，之後直接進入既有房間。</p></div><button type="button" id="wt2ScheduleAdd">＋ 建立預約</button></div><div id="wt2ScheduleList" class="wt2-schedule-list"></div>';
    if(directory?.parentNode)directory.parentNode.insertBefore(panel,directory.nextSibling);
    else home?.parentNode?.insertBefore(panel,home);
    $("wt2ScheduleAdd")?.addEventListener("click",()=>openModal(window.WT_CORE?.state?.roomId||""));
  }

  function bind(){
    injectPanel();
    ensureModal();
    const auth=window.firebase?.auth?.();
    auth?.onAuthStateChanged(()=>renderSchedules());
    void renderSchedules();
  }

  window.WT2_SCHEDULES={open:openModal,refresh:renderSchedules};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",bind,{once:true});else bind();
})();