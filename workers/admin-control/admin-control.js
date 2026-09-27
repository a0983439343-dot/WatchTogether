import { verifyFirebaseIdToken } from "../youtube-search.js";

const passwordAttempts = new Map();

const json=(data,status=200,origin="*")=>new Response(JSON.stringify(data),{
  status,
  headers:{
    "content-type":"application/json; charset=utf-8",
    "access-control-allow-origin":origin,
    "access-control-allow-headers":"authorization, content-type",
    "access-control-allow-methods":"GET, POST, OPTIONS"
  }
});

const b64url=s=>s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4);
function decodeJwtPayload(token){
  try{return JSON.parse(atob(b64url(token.split(".")[1])))}catch(_){return null}
}
function constantTimeEqual(a,b){
  a=String(a||"");b=String(b||"");if(a.length!==b.length)return false;
  let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;
}
async function hmacHex(secret,value){
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function pbkdf2Hex(password,saltB64,iterations){
  const raw=Uint8Array.from(atob(saltB64),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),{name:"PBKDF2"},false,["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({name:"PBKDF2",salt:raw,iterations,hash:"SHA-256"},key,256);
  return [...new Uint8Array(bits)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function randomSalt(){
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  let s="";bytes.forEach(x=>s+=String.fromCharCode(x));return btoa(s);
}
async function dbFetch(env,path,token,method="GET",body){
  const url="https://"+env.FIREBASE_PROJECT_ID+"-default-rtdb.asia-southeast1.firebasedatabase.app/"+path+".json?auth="+encodeURIComponent(token);
  const res=await fetch(url,{method,headers:{"content-type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await res.text();
  let data=null;try{data=JSON.parse(text)}catch(_){}
  return {ok:res.ok,data,status:res.status};
}
async function dbPatchRoot(env,token,patch){
  const url="https://"+env.FIREBASE_PROJECT_ID+"-default-rtdb.asia-southeast1.firebasedatabase.app/.json?auth="+encodeURIComponent(token);
  const res=await fetch(url,{
    method:"PATCH",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(patch)
  });
  const text=await res.text();
  let data=null;try{data=JSON.parse(text)}catch(_){}
  return {ok:res.ok,data,status:res.status};
}
async function authenticateAdmin(request,env){
  const auth=String(request.headers.get("authorization")||"");
  const token=auth.startsWith("Bearer ")?auth.slice(7).trim():"";
  if(!token)return {ok:false,status:401};

  const projectId=String(env.FIREBASE_PROJECT_ID||"watchtogether-3f4f9").trim();
  let claims;
  try{
    claims=await verifyFirebaseIdToken(token,projectId);
  }catch(_){
    return {ok:false,status:401};
  }

  const uid=String(claims?.sub||claims?.user_id||"").trim();
  if(!uid)return {ok:false,status:401};

  if(uid===env.MASTER_ADMIN_UID){
    return {ok:true,uid,token,role:"master",email:String(claims.email||""),hasCustomRole:false,permissions:{}};
  }

  const whitelist=await dbFetch(env,"admin/whitelistByUid/"+uid,token);
  const item=whitelist.data;
  if(!(item?.uid===uid && item?.enabled===true && ["admin","master"].includes(String(item.role||"admin")))){
    return {ok:false,status:404};
  }

  const roleSnap=await dbFetch(env,"admin/userRoles/"+uid,token);
  const roleId=String(roleSnap.data?.roleId||"").trim();
  let permissions=null;
  if(roleId){
    const roleSnap2=await dbFetch(env,"admin/roles/"+roleId,token);
    permissions={};
    Object.entries(roleSnap2.data?.permissions||{}).forEach(([key,value])=>{if(value===true)permissions[key]=true;});
    const override=await dbFetch(env,"admin/userPermissionOverrides/"+uid,token);
    const allow=override.data?.allow||{};
    const deny=override.data?.deny||{};
    Object.entries(allow).forEach(([key,value])=>{if(value===true)permissions[key]=true;});
    Object.entries(deny).forEach(([key,value])=>{if(value===true)delete permissions[key];});
  }

  return {
    ok:true,
    uid,
    token,
    role:"admin",
    email:String(claims.email||""),
    hasCustomRole:Boolean(roleId),
    roleId,
    permissions:permissions||{}
  };
}
function hasPermission(ctx,permission){
  if(ctx.role==="master")return true;
  if(ctx.hasCustomRole!==true)return true;
  return ctx.permissions?.[permission]===true;
}
async function getCredential(env,ctx){
  const r=await dbFetch(env,"admin/security/maintenanceCredential",ctx.token);
  return r.data;
}
function allowPasswordAttempt(key){
  const now=Date.now();
  const item=passwordAttempts.get(key);
  if(!item || now-item.windowStartedAt >= 10*60*1000){
    passwordAttempts.set(key,{windowStartedAt:now,failures:0,lockedUntil:0});
    return true;
  }
  if(item.lockedUntil && now<item.lockedUntil) return false;
  return true;
}
function recordPasswordFailure(key){
  const now=Date.now();
  const item=passwordAttempts.get(key)||{windowStartedAt:now,failures:0,lockedUntil:0};
  if(now-item.windowStartedAt >= 10*60*1000){
    item.windowStartedAt=now;item.failures=0;item.lockedUntil=0;
  }
  item.failures += 1;
  if(item.failures >= 5) item.lockedUntil=now+10*60*1000;
  passwordAttempts.set(key,item);
}
function clearPasswordFailures(key){passwordAttempts.delete(key);}

async function verifyMaintenancePassword(env,ctx,password){
  const key=ctx.uid+":"+String(ctx.requestIp||"unknown");
  if(!allowPasswordAttempt(key)) return false;
  const credential=await getCredential(env,ctx);
  if(!credential?.hash||!credential?.salt||!credential?.iterations)return false;
  const hash=await pbkdf2Hex(password,credential.salt,Number(credential.iterations));
  const ok=constantTimeEqual(hash,credential.hash);
  if(ok) clearPasswordFailures(key); else recordPasswordFailure(key);
  return ok;
}
async function writeAudit(env,ctx,action,targetUid,targetName,details){
  try{
    await dbFetch(env,"admin/auditLogs",ctx.token,"POST",{
      action:String(action||"admin").slice(0,40),
      actorUid:String(ctx.uid||"").slice(0,128),
      actorEmail:String(ctx.email||"").slice(0,320),
      actorRole:String(ctx.role||"admin").slice(0,40),
      targetUid:String(targetUid||"").slice(0,128),
      targetName:String(targetName||"").slice(0,200),
      details:String(details||"").slice(0,1000),
      createdAt:Date.now()
    });
  }catch(_){}
}

async function writeMaintenance(env,ctx,data){
  const publicData={
    enabled:Boolean(data?.enabled),
    mode:String(data?.mode||"maintenance").slice(0,40),
    message:String(data?.message||"系統維護").slice(0,200),
    startedAt:Number(data?.startedAt||0),
    endsAt:Number(data?.endsAt||0)
  };
  if(data?.enabled===false){
    publicData.mode=String(data?.mode||"").slice(0,40);
    publicData.message=String(data?.message||"").slice(0,200);
  }
  return dbPatchRoot(env,ctx.token,{
    system:{
      maintenance:data,
      publicMaintenance:publicData
    }
  });
}
export default {
  async fetch(request,env){
    const origin=env.ALLOWED_ORIGIN||"*";
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{
      "access-control-allow-origin":origin,
      "access-control-allow-headers":"authorization, content-type",
      "access-control-allow-methods":"GET, POST, OPTIONS"
    }});
    if(new URL(request.url).pathname==="/health")return json({ok:true,service:"watchtogether-admin-control"},200,origin);

    const ctx=await authenticateAdmin(request,env);
    if(!ctx.ok)return json({ok:false,error:"not_found"},ctx.status||404,origin);
  ctx.requestIp = String(request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim();

    const url=new URL(request.url);
    if(request.method==="GET" && url.pathname==="/maintenance"){
      if(!hasPermission(ctx,"maintenance.manage"))return json({ok:false,error:"forbidden"},403,origin);
      const r=await dbFetch(env,"system/maintenance",ctx.token);
      return json(r.data||{enabled:false},r.ok?200:502,origin);
    }

    if(request.method!=="POST")return json({ok:false,error:"method_not_allowed"},405,origin);

    let body={};try{body=await request.json()}catch(_){return json({ok:false,error:"invalid_json"},400,origin)}
    const action=String(body.action||"").trim();

    if(action==="set-password"){
      if(ctx.role!=="master")return json({ok:false,error:"master_required"},403,origin);
      const newPassword=String(body.newPassword||"");
      const currentPassword=String(body.currentPassword||"");
      const oldCredential=await getCredential(env,ctx);
      if(oldCredential && !await verifyMaintenancePassword(env,ctx,currentPassword)){
        return json({ok:false,error:"invalid_current_password"},403,origin);
      }
      if(newPassword.length<8)return json({ok:false,error:"password_too_short"},400,origin);
      const salt=randomSalt(),iterations=120000,hash=await pbkdf2Hex(newPassword,salt,iterations);
      const r=await dbFetch(env,"admin/security/maintenanceCredential",ctx.token,"PUT",{
        hash,salt,iterations,updatedAt:Date.now(),updatedBy:ctx.uid
      });
      if(r.ok) await writeAudit(env,ctx,"maintenance.password.update",ctx.uid,ctx.email,"更新網站維護密碼");
      return json({ok:r.ok},r.ok?200:502,origin);
    }

    if(action==="enable"){
      if(!hasPermission(ctx,"maintenance.manage"))return json({ok:false,error:"forbidden"},403,origin);
      const password=String(body.password||"");
      if(password.length<1 || !await verifyMaintenancePassword(env,ctx,password)){
        return json({ok:false,error:"invalid_password"},403,origin);
      }
      const message=String(body.message||"系統維護").trim().slice(0,200)||"系統維護";
      const endsAt=Math.max(0,Number(body.endsAt||0));
      const r=await writeMaintenance(env,ctx,{
        enabled:true,mode:String(body.mode||"maintenance"),message,
        startedAt:Date.now(),endsAt:Number.isFinite(endsAt)?endsAt:0,updatedAt:Date.now(),updatedBy:ctx.uid
      });
      if(r.ok) await writeAudit(env,ctx,"maintenance.enable",ctx.uid,ctx.email,"啟用網站維護模式："+message);
      return json({ok:r.ok},r.ok?200:502,origin);
    }

    if(action==="disable"){
      if(!hasPermission(ctx,"maintenance.manage"))return json({ok:false,error:"forbidden"},403,origin);

      if(password.length<1 || !await verifyMaintenancePassword(env,ctx,password)){
        return json({ok:false,error:"invalid_password"},403,origin);
      }
      const r=await writeMaintenance(env,ctx,{enabled:false,updatedAt:Date.now(),updatedBy:ctx.uid});
      if(r.ok) await writeAudit(env,ctx,"maintenance.disable",ctx.uid,ctx.email,"恢復網站服務");
      return json({ok:r.ok},r.ok?200:502,origin);
    }

    return json({ok:false,error:"unknown_action"},400,origin);
  }
};