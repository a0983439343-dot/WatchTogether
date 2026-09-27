(() => {
  "use strict";

  const history=[];
  const $=id=>document.getElementById(id);

  function apiUrl(){
    const raw=String(window.WATCHTOGETHER_CONFIG?.aiBugDetectorUrl||"").trim();
    if(raw.endsWith("/ai/analyze")) return raw.slice(0,-"/ai/analyze".length)+"/agent";
    return raw.replace(/\/+$/,"")+"/agent";
  }

  const tools=[
    {type:"function",function:{name:"admin_overview",description:"取得 Admin 平台概況，唯讀。",parameters:{type:"object",properties:{}}}},
    {type:"function",function:{name:"search_users",description:"依 UID、Email 或名稱搜尋使用者，唯讀。",parameters:{type:"object",properties:{query:{type:"string"}},required:["query"]}}},
    {type:"function",function:{name:"search_rooms",description:"依房間 ID、名稱或房主搜尋房間，唯讀。",parameters:{type:"object",properties:{query:{type:"string"}},required:["query"]}}},
    {type:"function",function:{name:"reports_summary",description:"取得最近的檢舉摘要，唯讀。",parameters:{type:"object",properties:{}}}},
    {type:"function",function:{name:"recent_audit",description:"取得最近的 Admin 稽核紀錄，唯讀。",parameters:{type:"object",properties:{}}}},
    {type:"function",function:{name:"maintenance_status",description:"取得目前網站維護狀態，唯讀。",parameters:{type:"object",properties:{}}}}
  ];

  async function token(){
    const user=window.firebase?.auth?.().currentUser;
    if(!user||user.isAnonymous) throw new Error("請先登入管理員帳號");
    return user.getIdToken();
  }

  async function askAgent(messages){
    const t=await token();
    const response=await fetch(apiUrl(),{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":"Bearer "+t},
      body:JSON.stringify({messages,tools})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data?.ok!==true)throw new Error(data?.error||"Admin AI 失敗");
    return data;
  }

  function render(text,kind){
    const out=$("ad2AiOutput");
    if(!out)return;
    const row=document.createElement("div");
    row.className="ad2-ai-msg "+(kind||"assistant");
    row.textContent=String(text||"");
    out.appendChild(row);
    out.scrollTop=out.scrollHeight;
  }

  async function execute(name,args){
    const ctx=window.WT_ADMIN_CONTEXT;
    if(!ctx?.isAuthorized?.())throw new Error("Admin 權限尚未確認");
    switch(name){
      case "admin_overview": return ctx.overview();
      case "search_users": return {results:ctx.searchUsers(args?.query||"")};
      case "search_rooms": return {results:ctx.searchRooms(args?.query||"")};
      case "reports_summary": return {results:ctx.reportsSummary()};
      case "recent_audit": return {results:ctx.recentAudit()};
      case "maintenance_status": return ctx.maintenance();
      default: throw new Error("未知的 Admin AI 工具");
    }
  }

  async function run(prompt){
    const clean=String(prompt||"").trim().slice(0,2000);
    if(!clean)return;
    render(clean,"user");
    history.push({role:"user",content:clean});
    for(let step=0;step<4;step++){
      const result=await askAgent(history);
      const message=result.message||{};
      const calls=Array.isArray(message.tool_calls)?message.tool_calls:[];
      if(message.content)render(message.content,"assistant");
      history.push({role:"assistant",content:String(message.content||""),tool_calls:calls});
      if(!calls.length)return;
      for(const call of calls){
        const name=String(call?.function?.name||"");
        let args={};try{args=JSON.parse(String(call?.function?.arguments||"{}"));}catch(_){args={};}
        try{
          const data=await execute(name,args);
          history.push({role:"tool",tool_call_id:String(call.id||""),content:JSON.stringify(data).slice(0,10000)});
          render("已查詢："+name,"tool");
        }catch(error){
          const data={ok:false,error:String(error?.message||"tool_failed").slice(0,300)};
          history.push({role:"tool",tool_call_id:String(call.id||""),content:JSON.stringify(data)});
          render("查詢失敗："+data.error,"error");
        }
      }
    }
    throw new Error("AI 分析步驟過多，已停止。");
  }

  function init(){
    const button=$("ad2AiAsk");
    if(!button||button.dataset.wt2AgentBound==="1")return;
    button.dataset.wt2AgentBound="1";
    const prompt=$("ad2AiPrompt");
    button.addEventListener("click",async()=>{
      const value=prompt?.value||"";
      if(prompt)prompt.value="";
      try{button.disabled=true;await run(value);}catch(e){render(e?.message||"Admin AI 失敗","error");}finally{button.disabled=false;}
    });
  }

  window.WT2_ADMIN_AI={run,tools};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();