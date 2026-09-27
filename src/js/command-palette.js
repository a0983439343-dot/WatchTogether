(() => {
  "use strict";
  let initialized=false;
  const commands=[
    {id:"home",label:"前往首頁",hint:"Home",run:()=>document.querySelector('[data-action="home"]')?.click()},
    {id:"rooms",label:"我的房間",hint:"Rooms",run:()=>document.querySelector('[data-action="rooms"]')?.click()},
    {id:"explore",label:"搜尋／探索影片",hint:"Explore",run:()=>document.querySelector('[data-action="explore"]')?.click()},
    {id:"ai",label:"開啟 AI 中心",hint:"AI",run:()=>document.querySelector('[data-action="ai"]')?.click()},
    {id:"friends",label:"開啟好友",hint:"Friends",run:()=>window.WT_ENHANCEMENTS?.openFriends?.()},
    {id:"settings",label:"開啟設定",hint:"Settings",run:()=>window.WT_ENHANCEMENTS?.openSettings?.()},
    {id:"notifications",label:"開啟通知",hint:"Notifications",run:()=>window.WT2_NOTIFICATIONS?.open?.()}
  ];
  let items=commands.slice(),index=0;

  const $=id=>document.getElementById(id);
  function build(){
    if($("wt2CommandPalette"))return;
    const dialog=document.createElement("dialog");
    dialog.id="wt2CommandPalette";
    dialog.className="wt2-command-palette";
    dialog.innerHTML='<div class="wt2-command-inner"><div class="wt2-command-search"><span>⌘</span><input id="wt2CommandInput" autocomplete="off" placeholder="搜尋功能或輸入指令…"><kbd>Esc</kbd></div><div id="wt2CommandList" class="wt2-command-list"></div><div class="wt2-command-foot"><span>↑↓ 選擇</span><span>Enter 執行</span><span>Ctrl/⌘ K 開啟</span></div></div>';
    document.body.appendChild(dialog);
    const input=$("wt2CommandInput");
    input?.addEventListener("input",()=>filter(input.value));
    input?.addEventListener("keydown",e=>{
      if(e.key==="ArrowDown"){e.preventDefault();index=(index+1)%items.length;renderList();}
      else if(e.key==="ArrowUp"){e.preventDefault();index=(index-1+items.length)%items.length;renderList();}
      else if(e.key==="Enter"){e.preventDefault();execute();}
      else if(e.key==="Escape"){dialog.close();}
    });
    dialog.addEventListener("click",e=>{if(e.target===dialog)dialog.close();});
    renderList();
  }

  function filter(value){
    const q=String(value||"").trim().toLowerCase();
    items=commands.filter(c=>!q||c.label.toLowerCase().includes(q)||c.hint.toLowerCase().includes(q));
    index=0;renderList();
  }

  function renderList(){
    const list=$("wt2CommandList");if(!list)return;
    list.innerHTML=items.length?items.map((c,i)=>'<button type="button" class="'+(i===index?"active":"")+'" data-cmd="'+c.id+'"><span>'+c.label+'</span><small>'+c.hint+'</small></button>').join(""):'<div class="wt2-empty">找不到指令。</div>';
    list.querySelectorAll("[data-cmd]").forEach(b=>b.addEventListener("click",()=>{index=Math.max(0,items.findIndex(c=>c.id===b.dataset.cmd));execute();}));
  }

  function execute(){
    const item=items[index];if(!item)return;
    try{item.run();}finally{$("wt2CommandPalette")?.close();}
  }

  function open(){
    build();
    const dialog=$("wt2CommandPalette");if(!dialog)return;
    if(!dialog.open)dialog.showModal();
    const input=$("wt2CommandInput");if(input){input.value="";filter("");input.focus();}
  }

  function bind(){
    if(initialized)return;
    initialized=true;
    document.addEventListener("keydown",e=>{
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){
        e.preventDefault();open();
      }
    });
  }

  function boot(){build();bind();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
  window.WT2_COMMAND_PALETTE={open};
})();