import {
  corsHeaders,
  jsonResponse,
  verifyFirebaseIdToken
} from "./youtube-search.js";

const DEFAULT_ALLOWED_ORIGIN = "https://a0983439343-dot.github.io";
const DEFAULT_FIREBASE_PROJECT_ID = "watchtogether-3f4f9";
const RATE_WINDOW_MS = 60 * 1000;
const IP_RATE_LIMIT = 20;
const USER_RATE_LIMIT = 12;
const MAX_BODY_BYTES = 32 * 1024;
const DEFAULT_FIREBASE_DATABASE_URL =
  "https://watchtogether-3f4f9-default-rtdb.asia-southeast1.firebasedatabase.app";
const PROVIDER_TIMEOUT_MS = 25 * 1000;

async function isUserFeatureBlocked(env, token, uid, feature){
  if(!token || !uid || !feature) return false;
  const base=String(env.FIREBASE_DATABASE_URL||DEFAULT_FIREBASE_DATABASE_URL).trim().replace(/\/+$/,"");
  const url=base+"/admin/restrictionsByUid/"+encodeURIComponent(uid)+"/features/"+encodeURIComponent(feature)+".json?auth="+encodeURIComponent(token);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),5000);
  try{
    const response=await fetch(url,{method:"GET",cache:"no-store",signal:controller.signal});
    if(!response.ok) return true;
    return (await response.json().catch(()=>false))===true;
  }catch(_){
    return true;
  }finally{
    clearTimeout(timer);
  }
}

function normalizeProviderMessage(message, mode){
  if(!message || typeof message!=="object") return null;
  const out={
    role:"assistant",
    content:typeof message.content==="string" ? message.content.slice(0,8000) : ""
  };
  if(mode==="agent" && Array.isArray(message.tool_calls)){
    out.tool_calls=message.tool_calls.slice(0,6).map((call,index)=>({
      id:String(call?.id||("call_"+Date.now()+"_"+index)).slice(0,100),
      type:"function",
      function:{
        name:String(call?.function?.name||"").slice(0,80),
        arguments:String(call?.function?.arguments||"{}").slice(0,4000)
      }
    })).filter(call=>/^[A-Za-z_][A-Za-z0-9_-]{0,79}$/.test(call.function.name));
  }
  return out;
}

const ipBuckets = new Map();
const userBuckets = new Map();

function rateLimited(map,key,limit){
  const now=Date.now();
  const current=map.get(key);
  if(!current || now-current.start>=RATE_WINDOW_MS){
    map.set(key,{start:now,count:1});
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

function normalizeMessages(messages){
  if(!Array.isArray(messages)) return [];
  return messages
    .filter(item => item && ["system","user","assistant","tool"].includes(item.role))
    .slice(-20)
    .map(item => {
      const out={role:item.role};
      if(typeof item.content==="string") out.content=item.content.slice(0,8000);
      if(item.name) out.name=String(item.name).slice(0,80);
      if(item.tool_call_id) out.tool_call_id=String(item.tool_call_id).slice(0,128);
      if(Array.isArray(item.tool_calls)) out.tool_calls=item.tool_calls.slice(0,8);
      return out;
    });
}

function normalizeTools(tools){
  if(!Array.isArray(tools)) return [];
  return tools
    .filter(tool => tool && tool.type==="function" && tool.function)
    .slice(0,12)
    .map(tool => ({
      type:"function",
      function:{
        name:String(tool.function.name||"").slice(0,80),
        description:String(tool.function.description||"").slice(0,500),
        parameters:tool.function.parameters && typeof tool.function.parameters==="object"
          ? tool.function.parameters
          : {type:"object",properties:{}}
      }
    }))
    .filter(tool => /^[A-Za-z_][A-Za-z0-9_-]{0,79}$/.test(tool.function.name));
}

export default {
  async fetch(request,env){
    const url=new URL(request.url);
    const origin=request.headers.get("Origin")||"";
    const allowedOrigin=String(env.ALLOWED_ORIGIN||DEFAULT_ALLOWED_ORIGIN).trim();

    if(request.method==="OPTIONS"){
      return new Response(null,{
        status:204,
        headers:corsHeaders(origin,allowedOrigin,request.headers.get("Access-Control-Request-Headers")||"")
      });
    }

    if(request.method==="GET" && url.pathname==="/health"){
      return jsonResponse({ok:true,service:"watchtogether-ai-core"},200,origin,allowedOrigin);
    }

    if(request.method!=="POST" || !["/chat","/agent"].includes(url.pathname)){
      return jsonResponse({error:{message:"只允許 POST /chat 或 POST /agent"}},405,origin,allowedOrigin);
    }

    if(allowedOrigin!=="*" && origin!==allowedOrigin){
      return jsonResponse({error:{message:"不允許的來源"}},403,origin,allowedOrigin);
    }

    if(request.method==="POST"){
      const contentType=String(request.headers.get("Content-Type")||"").trim();
      if(!/^application\/json(?:\s*;|$)/i.test(contentType)){
        return jsonResponse({error:{message:"Content-Type 必須是 application/json"}},415,origin,allowedOrigin);
      }
    }

    const contentLength=Number(request.headers.get("Content-Length")||0);
    if(Number.isFinite(contentLength) && contentLength>MAX_BODY_BYTES){
      return jsonResponse({error:{message:"請求內容過大"}},413,origin,allowedOrigin);
    }

    const authorization=request.headers.get("Authorization")||"";
    const fallbackToken=request.headers.get("X-Firebase-ID-Token")||"";
    const tokenMatch=authorization.match(/^Bearer\s+(.+)$/i);
    const firebaseIdToken=(tokenMatch?.[1]||fallbackToken).trim();
    if(!firebaseIdToken){
      return jsonResponse({error:{message:"缺少登入驗證"}},401,origin,allowedOrigin);
    }

    const projectId=String(env.FIREBASE_PROJECT_ID||DEFAULT_FIREBASE_PROJECT_ID).trim();
    let firebaseUser=null;
    try{
      firebaseUser=await verifyFirebaseIdToken(firebaseIdToken,projectId);
    }catch(_){
      return jsonResponse({error:{message:"登入驗證失敗"}},401,origin,allowedOrigin);
    }

    const ip=request.headers.get("CF-Connecting-IP")||"unknown";
    const requestedMode = url.pathname==="/agent" ? "agent" : "chat";
    const requestedFeature = requestedMode==="agent" ? "ai_agent" : "ai";
    if(await isUserFeatureBlocked(env,firebaseIdToken,firebaseUser.sub,requestedFeature)){
      return jsonResponse({error:{message:requestedMode==="agent"?"此帳號目前無法使用 AI Agent":"此帳號目前無法使用 AI"}},403,origin,allowedOrigin);
    }

    if(rateLimited(ipBuckets,ip,IP_RATE_LIMIT) || rateLimited(userBuckets,firebaseUser.sub,USER_RATE_LIMIT)){
      return jsonResponse({error:{message:"AI 請求太頻繁，請稍候再試"}},429,origin,allowedOrigin);
    }

    let body;
    try{
      const rawBody=await request.text();
      if(new TextEncoder().encode(rawBody).byteLength>MAX_BODY_BYTES){
        return jsonResponse({error:{message:"請求內容過大"}},413,origin,allowedOrigin);
      }
      body=JSON.parse(rawBody);
    }catch(_){
      return jsonResponse({error:{message:"JSON 格式錯誤"}},400,origin,allowedOrigin);
    }
    if(!body || typeof body!=="object" || Array.isArray(body)){
      return jsonResponse({error:{message:"請求內容必須是 JSON 物件"}},400,origin,allowedOrigin);
    }

    const messages=normalizeMessages(body?.messages);
    if(!messages.length){
      return jsonResponse({error:{message:"缺少 messages"}},400,origin,allowedOrigin);
    }

    const mode=url.pathname==="/agent" ? "agent" : "chat";
    const tools=mode==="agent" ? normalizeTools(body?.tools) : [];
    const model=String(body?.model||env.AI_MODEL||"").trim().slice(0,120);
    const apiUrl=String(env.AI_API_URL||"").trim().replace(/\/$/,"");
    const apiKey=String(env.AI_API_KEY||"").trim();

    if(!apiUrl){
      return jsonResponse({error:{message:"AI Core 尚未設定 AI_API_URL"}},503,origin,allowedOrigin);
    }
    if(!/^https:\/\//i.test(apiUrl)){
      return jsonResponse({error:{message:"AI_API_URL 必須使用 HTTPS"}},503,origin,allowedOrigin);
    }

    const payload={
      model,
      messages,
      temperature:typeof body?.temperature==="number" ? Math.max(0,Math.min(1.2,body.temperature)) : 0.2,
      max_tokens:typeof body?.max_tokens==="number" ? Math.max(128,Math.min(2500,Math.floor(body.max_tokens))) : 900
    };
    if(mode==="agent" && tools.length) payload.tools=tools;
    if(mode==="agent" && body?.tool_choice) payload.tool_choice=body.tool_choice;

    let response;
    const providerController=new AbortController();
    const providerTimer=setTimeout(()=>providerController.abort(),PROVIDER_TIMEOUT_MS);
    try{
      response=await fetch(apiUrl,{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Accept":"application/json",
          ...(apiKey?{"Authorization":"Bearer "+apiKey}:{})
        },
        body:JSON.stringify(payload),
        signal:providerController.signal
      });
    }catch(error){
      return jsonResponse({error:{message:error?.name==="AbortError"?"AI Provider 逾時":"AI Provider 無法連線"}},502,origin,allowedOrigin);
    }finally{
      clearTimeout(providerTimer);
    }

    const responseText=await response.text();
    let data={};
    try{
      data=responseText?JSON.parse(responseText):{};
    }catch(_){
      return jsonResponse({error:{message:"AI Provider 回傳無效 JSON"}},502,origin,allowedOrigin);
    }
    if(!response.ok){
      return jsonResponse({
        error:{
          message:String(data?.error?.message||"AI Provider 請求失敗").slice(0,300)
        }
      },502,origin,allowedOrigin);
    }

    const message=normalizeProviderMessage(data?.choices?.[0]?.message,mode);
    if(!message){
      return jsonResponse({error:{message:"AI Provider 沒有返回有效結果"}},502,origin,allowedOrigin);
    }

    return jsonResponse({
      ok:true,
      mode,
      userId:firebaseUser.sub,
      message,
      usage:data?.usage||null,
      model:data?.model||model||null
    },200,origin,allowedOrigin);
  }
};
