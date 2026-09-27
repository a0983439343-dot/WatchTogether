(() => {
  "use strict";

  const state = {
    messages: [],
    pendingConfirm: null
  };

  const TOOL_META = {
    searchVideos: {
      risk: "safe",
      description: "搜尋 YouTube 影片並把結果顯示在首頁搜尋區",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "搜尋關鍵字" } },
        required: ["query"]
      }
    },
    getRoomState: {
      risk: "safe",
      description: "讀取目前房間的基本狀態",
      parameters: { type: "object", properties: {} }
    },
    addToQueue: {
      risk: "confirm",
      description: "把指定影片加入目前房間待播放清單",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          platform: { type: "string" },
          title: { type: "string" },
          thumbnail: { type: "string" },
          channel: { type: "string" }
        },
        required: ["id","title"]
      }
    },
    createRoom: {
      risk: "confirm",
      description: "建立新的 WatchTogether 房間",
      parameters: { type: "object", properties: {} }
    },
    sendChat: {
      risk: "confirm",
      description: "在目前房間聊天室發送訊息",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"]
      }
    },
    removeFromQueue: {
      risk: "confirm",
      description: "從目前房間待播放清單移除指定項目",
      parameters: {
        type: "object",
        properties: { queueId: { type: "string" } },
        required: ["queueId"]
      }
    },
    reorderQueue: {
      risk: "confirm",
      description: "重新排序目前房間待播放清單",
      parameters: {
        type: "object",
        properties: {
          queueIds: { type: "array", items: { type: "string" } }
        },
        required: ["queueIds"]
      }
    },
    removeFromQueue: {
      risk: "confirm",
      description: "從目前房間待播放清單移除指定項目",
      parameters: {
        type: "object",
        properties: { queueId: { type: "string" } },
        required: ["queueId"]
      }
    },
    listQueue: {
      risk: "safe",
      description: "讀取目前房間待播放清單",
      parameters: { type: "object", properties: {} }
    },
    getQueue: {
      risk: "safe",
      description: "讀取目前房間待播放清單",
      parameters: { type: "object", properties: {} }
    },
    playQueueItem: {
      risk: "confirm",
      description: "由房主播放指定待播放項目",
      parameters: {
        type: "object",
        properties: { queueId: { type: "string" } },
        required: ["queueId"]
      }
    }
  };

  function config(){
    return window.WATCHTOGETHER_CONFIG || {};
  }

  function endpoint(path){
    return String(config().aiCoreUrl || "").trim().replace(/\/$/,"") + path;
  }

  async function token(){
    const auth = window.firebase?.auth?.();
    const user = auth?.currentUser;
    if(!user || user.isAnonymous) throw new Error("請先使用 Google 登入");
    return user.getIdToken();
  }

  function toolDefinitions(){
    return Object.entries(TOOL_META).map(([name,meta]) => ({
      type: "function",
      function: {
        name,
        description: meta.description,
        parameters: meta.parameters
      }
    }));
  }

  function roomContext(){
    const s = window.WT_CORE?.state;
    if(!s) return {};
    return {
      roomId: String(s.roomId || ""),
      roomName: String(s.room?.name || ""),
      visibility: String(s.room?.visibility || ""),
      joinMode: String(s.room?.joinMode || ""),
      isOwner: Boolean(s.isOwner),
      memberCount: Object.keys(s.members || {}).length,
      currentVideo: s.room?.video ? {
        id: String(s.room.video.id || ""),
        platform: String(s.room.video.platform || ""),
        title: String(s.room.video.title || "")
      } : null
    };
  }

  async function request(path,messages,tools=[]){
    const base = String(config().aiCoreUrl || "").trim().replace(/\/$/,"");
    if(!base) throw new Error("AI Core 尚未設定");
    const idToken = await token();
    const response = await fetch(base + path,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer " + idToken
      },
      body:JSON.stringify({
        messages,
        tools,
        temperature:0.2,
        max_tokens:900
      })
    });
    const data = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(String(data?.error?.message || "AI Core 請求失敗"));
    return data;
  }

  async function executeTool(name,args){
    if(!TOOL_META[name]) throw new Error("不允許的 AI 工具");
    const parsed = args && typeof args === "object" ? args : {};

    if(name === "getRoomState"){
      return { ok:true, room:roomContext() };
    }

    if(name === "searchVideos"){
      const query = String(parsed.query || "").trim().slice(0,100);
      if(query.length < 2) throw new Error("搜尋內容太短");
      const search = window.WT_ENHANCEMENTS?.searchHome;
      if(typeof search !== "function") throw new Error("YouTube 搜尋功能尚未準備完成");
      const results = await search(query);
      return {
        ok:true,
        count:Array.isArray(results) ? results.length : 0,
        results:Array.isArray(results) ? results.slice(0,8) : []
      };
    }

    if(name === "addToQueue"){
      const fn = window.WT_CORE?.addToQueue;
      if(typeof fn !== "function") throw new Error("待播放清單功能尚未準備完成");
      await fn({
        id:String(parsed.id || ""),
        platform:String(parsed.platform || "youtube"),
        title:String(parsed.title || "未命名影片"),
        thumbnail:String(parsed.thumbnail || ""),
        channel:String(parsed.channel || "YouTube")
      });
      return {ok:true,message:"已加入待播放清單"};
    }

    if(name === "createRoom"){
      const fn = window.WT_CORE?.createRoom;
      if(typeof fn !== "function") throw new Error("建立房間功能尚未準備完成");
      await fn();
      return {ok:true,message:"房間建立完成",roomId:String(window.WT_CORE?.state?.roomId || "")};
    }

    if(name === "getQueue"){
      const s = window.WT_CORE?.state;
      const queue = s?.queue || {};
      const items = Object.entries(queue).map(([queueId,item])=>({
        queueId,
        id:String(item?.id||""),
        platform:String(item?.platform||""),
        title:String(item?.title||"未命名影片"),
        addedByName:String(item?.addedByName||""),
        queueOrder:Number(item?.queueOrder||item?.addedAt||0)
      })).sort((a,b)=>a.queueOrder-b.queueOrder);
      return {ok:true,items};
    }

    if(name === "playQueueItem"){
      const fn = window.WT_CORE?.playQueueItem;
      if(typeof fn !== "function") throw new Error("播放佇列功能尚未準備完成");
      const queueId = String(parsed.queueId || "").trim();
      if(!queueId) throw new Error("queueId 不能為空");
      await fn(queueId);
      return {ok:true,message:"已切換到指定待播放項目"};
    }

    if(name === "removeFromQueue"){
      const fn=window.WT_CORE?.removeFromQueue;
      if(typeof fn!=="function") throw new Error("待播放清單移除功能尚未準備完成");
      const queueId=String(parsed.queueId||"").trim();
      if(!queueId) throw new Error("缺少 queueId");
      await fn(queueId);
      return {ok:true,message:"已移除待播放項目",queueId};
    }

    if(name === "listQueue"){
      const s=window.WT_CORE?.state;
      if(!s?.roomId) throw new Error("目前不在房間內");
      const items=Object.entries(s.queue||{})
        .sort((a,b)=>Number(a[1]?.queueOrder||a[1]?.addedAt||0)-Number(b[1]?.queueOrder||b[1]?.addedAt||0))
        .slice(0,30)
        .map(([queueId,item])=>({queueId,id:item?.id||"",platform:item?.platform||"youtube",title:item?.title||"未命名影片",addedByName:item?.addedByName||""}));
      return {ok:true,count:items.length,items};
    }

    if(name === "sendChat"){
      const fn = window.WT_CORE?.sendChat;
      if(typeof fn !== "function") throw new Error("聊天室功能尚未準備完成");
      const text = String(parsed.text || "").trim().slice(0,300);
      if(!text) throw new Error("訊息不能為空");
      await fn(text);
      return {ok:true,message:"訊息已送出"};
    }

    if(name === "removeFromQueue"){
      const fn = window.WT_CORE?.removeFromQueue;
      if(typeof fn !== "function") throw new Error("待播放清單移除功能尚未準備完成");
      const queueId = String(parsed.queueId || "").trim();
      if(!queueId) throw new Error("缺少 queueId");
      await fn(queueId);
      return {ok:true,message:"已移除待播放項目"};
    }

    if(name === "reorderQueue"){
      const fn = window.WT_CORE?.reorderQueue;
      if(typeof fn !== "function") throw new Error("待播放清單排序功能尚未準備完成");
      const queueIds = Array.isArray(parsed.queueIds) ? parsed.queueIds.map(x=>String(x||"").trim()).filter(Boolean).slice(0,100) : [];
      if(!queueIds.length) throw new Error("queueIds 不可為空");
      await fn(queueIds);
      return {ok:true,message:"待播放清單已重新排序"};
    }

    throw new Error("未知 AI 工具");
  }

  async function handleToolCalls(message,conversation){
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls.slice(0,6) : [];
    if(!calls.length) return {message,conversation};

    conversation.push({
      role:"assistant",
      content:message.content || "",
      tool_calls:calls
    });

    const agentBlocked=await isFeatureBlocked("ai_agent");
    for(const call of calls){
      const name=String(call?.function?.name || "");
      let args={};
      try{args=JSON.parse(String(call?.function?.arguments || "{}"));}catch(_){}

      if(agentBlocked){
        conversation.push({
          role:"tool",
          tool_call_id:String(call.id || ""),
          content:JSON.stringify({ok:false,blocked:true,message:"此帳號目前無法使用 AI Agent 操作工具"})
        });
        continue;
      }

      if(TOOL_META[name]?.risk === "confirm"){
        const approved = window.confirm(
          "AI 想執行操作：\n\n" +
          name +
          "\n" +
          JSON.stringify(args,null,2) +
          "\n\n確定執行嗎？"
        );
        if(!approved){
          conversation.push({
            role:"tool",
            tool_call_id:String(call.id || ""),
            content:JSON.stringify({ok:false,cancelled:true,message:"使用者取消操作"})
          });
          continue;
        }
      }

      try{
        const result=await executeTool(name,args);
        conversation.push({
          role:"tool",
          tool_call_id:String(call.id || ""),
          content:JSON.stringify(result)
        });
      }catch(error){
        conversation.push({
          role:"tool",
          tool_call_id:String(call.id || ""),
          content:JSON.stringify({ok:false,error:String(error?.message || error)})
        });
      }
    }

    return {message:null,conversation};
  }

  async function isFeatureBlocked(feature){
    const auth=window.firebase?.auth?.(),db=window.db||window.firebase?.database?.();
    const user=auth?.currentUser;
    if(!user||user.isAnonymous||!db||!feature)return false;
    try{
      const snap=await db.ref("admin/restrictionsByUid/"+user.uid+"/features/"+feature).once("value");
      return snap.val()===true;
    }catch(_){return false;}
  }

  async function ask(prompt, options={}){
    const text=String(prompt || "").trim().slice(0,2000);
    if(!text) throw new Error("請先輸入內容");
    if(await isFeatureBlocked("ai")) throw new Error("你的帳號目前無法使用 AI");
    if(await isFeatureBlocked("ai_agent")) throw new Error("你的帳號目前無法使用 AI Agent");

    const system = {
      role:"system",
      content:
        "你是 WatchTogether 2.0 的 AI Core。你可以協助使用者搜尋影片、查看房間狀態、管理待播放清單、建立房間及發送聊天室訊息。"+
        "先理解需求再使用工具；不確定時先詢問。涉及新增、建立、發送等會改變資料的工具必須由前端要求人工確認。"+
        "不要捏造不存在的影片、房間或操作結果。"
    };

    const conversation=[system,...state.messages.slice(-12),{
      role:"user",
      content:text + "\n\n目前房間上下文：" + JSON.stringify(roomContext())
    }];

    for(let turn=0;turn<4;turn++){
      const data=await request("/agent",conversation,toolDefinitions());
      const message=data?.message;
      if(!message) throw new Error("AI Core 沒有返回訊息");

      if(Array.isArray(message.tool_calls) && message.tool_calls.length){
        const handled=await handleToolCalls(message,conversation);
        conversation.splice(0,conversation.length,...handled.conversation);
        if(turn>=3) return message;
        continue;
      }

      state.messages.push({role:"user",content:text});
      state.messages.push({role:"assistant",content:String(message.content || "")});
      state.messages=state.messages.slice(-12);
      return message;
    }

    throw new Error("AI 工具執行輪數過多");
  }

  window.WT2_AI = {
    ask,
    clear(){state.messages=[];}
  };

  window.WT2_AI_META = TOOL_META;
})();