(() => {
  "use strict";

  const history = [];
  const sideEffectTools = new Set([
    "create_room","join_room","add_to_queue","remove_from_queue","play_queue_item","send_chat_message"
  ]);

  const $ = id => document.getElementById(id);
  const config = () => window.WATCHTOGETHER_CONFIG || {};

  function agentUrl(){
    const raw = String(config().aiBugDetectorUrl || "").trim();
    if(raw.endsWith("/ai/analyze")) return raw.slice(0,-"/ai/analyze".length)+"/agent";
    return raw.replace(/\/+$/,"") + "/agent";
  }

  function toolDefinitions(){
    return [
      {
        type:"function",
        function:{
          name:"search_videos",
          description:"搜尋 YouTube 影片。這是唯讀操作，可以直接執行。",
          parameters:{type:"object",properties:{query:{type:"string",description:"要搜尋的內容"}},required:["query"]}
        }
      },
      {
        type:"function",
        function:{
          name:"get_room_info",
          description:"取得目前房間的基本資訊與成員數。唯讀。",
          parameters:{type:"object",properties:{}}
        }
      },
      {
        type:"function",
        function:{
          name:"create_room",
          description:"建立新的 WatchTogether 房間。建立前必須取得使用者確認。",
          parameters:{type:"object",properties:{
            name:{type:"string",description:"房間名稱"},
            visibility:{type:"string",enum:["personal","public"]},
            joinMode:{type:"string",enum:["open","approval","invite_only"]}
          },required:["name"]}
        }
      },
      {
        type:"function",
        function:{
          name:"join_room",
          description:"加入指定房間。執行前必須取得使用者確認。",
          parameters:{type:"object",properties:{roomId:{type:"string"}},required:["roomId"]}
        }
      },
      {
        type:"function",
        function:{
          name:"add_to_queue",
          description:"把指定影片加入目前房間待播放清單。執行前必須取得使用者確認。",
          parameters:{type:"object",properties:{
            id:{type:"string"},
            platform:{type:"string"},
            title:{type:"string"},
            thumbnail:{type:"string"},
            channel:{type:"string"},
            url:{type:"string"}
          },required:["id","title"]}
        }
      },
      {
        type:"function",
        function:{
          name:"remove_from_queue",
          description:"從目前房間移除指定 queueId。執行前必須取得使用者確認。",
          parameters:{type:"object",properties:{queueId:{type:"string"}},required:["queueId"]}
        }
      },
      {
        type:"function",
        function:{
          name:"play_queue_item",
          description:"立即播放待播放清單中的指定項目。執行前必須取得使用者確認。",
          parameters:{type:"object",properties:{queueId:{type:"string"}},required:["queueId"]}
        }
      },
      {
        type:"function",
        function:{
          name:"send_chat_message",
          description:"代表使用者在目前房間發送聊天訊息。執行前必須取得使用者確認。",
          parameters:{type:"object",properties:{text:{type:"string"}},required:["text"]}
        }
      }
    ];
  }

  async function authToken(){
    const user=window.firebase?.auth?.().currentUser;
    if(!user || user.isAnonymous) throw new Error("請先登入 Google 帳號後使用 AI Agent");
    return user.getIdToken();
  }

  async function callAgent(messages){
    const token=await authToken();
    const response=await fetch(agentUrl(),{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer "+token
      },
      body:JSON.stringify({messages,tools:toolDefinitions()})
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok || data?.ok!==true) throw new Error(String(data?.error||"AI Agent 請求失敗").slice(0,240));
    return data;
  }

  async function executeTool(name,args){
    const core=window.WT_CORE || {};
    switch(name){
      case "search_videos":{
        const rows=await core.searchYoutube?.(String(args?.query||""));
        return {results:Array.isArray(rows)?rows.slice(0,10):[]};
      }
      case "get_room_info":{
        const db=window.db||window.firebase?.database?.();
        const state=core.state||{};
        let members={};
        if(db && state.roomId){
          members=(await db.ref("members/"+state.roomId).once("value")).val()||{};
        }
        return {roomId:state.roomId||"",name:state.room?.name||"",owner:state.room?.owner||"",isOwner:Boolean(state.isOwner),memberCount:Object.keys(members).length};
      }
      case "create_room":{
        const name=String(args?.name||"一起看").slice(0,40);
        const visibility=args?.visibility==="public"?"public":"personal";
        const joinMode=["open","approval","invite_only"].includes(args?.joinMode)?args.joinMode:(visibility==="public"?"open":"invite_only");
        const nameInput=$("roomNameInput");
        if(nameInput)nameInput.value=name;
        document.querySelectorAll('input[name="wt2-room-visibility"]').forEach(x=>{x.checked=x.value===visibility;x.dispatchEvent(new Event("change",{bubbles:true}))});
        if($("wt2PublicJoinMode") && visibility==="public") $("wt2PublicJoinMode").value=joinMode==="invite_only"?"approval":joinMode;
        await core.createRoom?.();
        return {ok:true,roomId:core.getRoomId?.()||"",name};
      }
      case "join_room":{
        const roomId=String(args?.roomId||"").trim().toUpperCase();
        await core.joinRoom?.(roomId);
        return {ok:true,roomId};
      }
      case "add_to_queue":{
        if(!core.addToQueue)throw new Error("目前版本沒有可用的佇列工具");
        await core.addToQueue({
          id:String(args?.id||""),
          platform:String(args?.platform||"youtube"),
          title:String(args?.title||"未命名影片"),
          thumbnail:String(args?.thumbnail||""),
          channel:String(args?.channel||"YouTube"),
          url:args?.url?String(args.url):undefined
        });
        return {ok:true,title:String(args?.title||"")};
      }
      case "remove_from_queue":{
        await core.removeFromQueue?.(String(args?.queueId||""));
        return {ok:true,queueId:String(args?.queueId||"")};
      }
      case "play_queue_item":{
        await core.playQueueItem?.(String(args?.queueId||""));
        return {ok:true,queueId:String(args?.queueId||"")};
      }
      case "send_chat_message":{
        await core.sendChat?.(String(args?.text||""));
        return {ok:true,text:String(args?.text||"")};
      }
      default: throw new Error("不允許的 Agent 工具");
    }
  }

  function render(message,kind="assistant"){
    const box=$("wt2AiConversation")||$("wt2AiChat"); if(!box)return;
    const item=document.createElement("div");
    item.className="wt2-ai-msg "+kind;
    item.textContent=String(message||"");
    box.appendChild(item);
    box.scrollTop=box.scrollHeight;
  }

  async function run(prompt){
    const globalDb=window.firebase?.database?.();
    if(globalDb){
      try{
        const globalSnap=await globalDb.ref("system/featureFlags/ai_agent").once("value");
        if(globalSnap.val()===false) throw new Error("目前暫停使用 AI Agent");
      }catch(error){
        if(error?.message==="目前暫停使用 AI Agent") throw error;
      }
    }
    const user=window.firebase?.auth?.().currentUser;
    if(!user || user.isAnonymous) throw new Error("請先登入 Google 帳號後使用 AI Agent");
    if(window.WT_ENHANCEMENTS?.isFeatureBlocked && await window.WT_ENHANCEMENTS.isFeatureBlocked("ai_agent")){
      throw new Error("你的帳號目前無法使用 AI Agent");
    }
    const clean=String(prompt||"").trim().slice(0,2000);
    if(!clean)return;
    render(clean,"user");
    history.push({role:"user",content:clean});

    let safety=0;
    while(safety++<5){
      const result=await callAgent(history);
      const msg=result.message||{};
      const calls=Array.isArray(msg.tool_calls)?msg.tool_calls:[];
      history.push({role:"assistant",content:String(msg.content||""),tool_calls:calls});
      if(msg.content)render(msg.content,"assistant");
      if(!calls.length)return result;

      for(const call of calls){
        const name=String(call?.function?.name||"");
        let args={};try{args=JSON.parse(String(call?.function?.arguments||"{}"));}catch(_){throw new Error("AI Agent 回傳了無效工具參數");}

        let approved=true;
        if(sideEffectTools.has(name)){
          approved=window.confirm("AI Agent 想執行：\n"+name+"\n\n參數：\n"+JSON.stringify(args,null,2)+"\n\n確定執行嗎？");
        }
        if(!approved){
          history.push({role:"tool",tool_call_id:String(call.id||""),content:JSON.stringify({ok:false,cancelled:true})});
          render("已取消："+name,"system");
          continue;
        }

        try{
          const toolResult=await executeTool(name,args);
          history.push({role:"tool",tool_call_id:String(call.id||""),content:JSON.stringify(toolResult).slice(0,6000)});
          render("已執行："+name,"tool");
        }catch(error){
          const toolError={ok:false,error:String(error?.message||"tool_failed").slice(0,300)};
          history.push({role:"tool",tool_call_id:String(call.id||""),content:JSON.stringify(toolError)});
          render("執行失敗："+toolError.error,"error");
        }
      }
    }
    throw new Error("AI Agent 步驟過多，已停止。");
  }

  function init(){
    const prompt=$("wt2AiPrompt")||$("wt2AiInput"),send=$("wt2AiSend");
    if(!prompt||!send||send.dataset.wt2Bound==="1")return;
    send.dataset.wt2Bound="1";
    send.addEventListener("click",async()=>{
      const value=prompt.value;prompt.value="";
      try{send.disabled=true;await run(value);}catch(error){render(error?.message||"AI Agent 失敗","error");}finally{send.disabled=false;}
    });
    prompt.addEventListener("keydown",event=>{
      if((event.ctrlKey||event.metaKey)&&event.key==="Enter"){event.preventDefault();send.click();}
    });
    render("AI Agent 已就緒。你可以直接說「找 5 部科幻片加進佇列」。","system");
  }

  window.WT2_AI_AGENT={run,tools:toolDefinitions};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();