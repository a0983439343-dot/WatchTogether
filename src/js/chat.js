(() => {
"use strict";

var wt = window.WT_ENHANCEMENTS;
if (!wt || !wt.db || !wt.auth) return;

var $ = wt.$ || function(id){ return document.getElementById(id); };
var esc = wt.esc || function(value){ return String(value == null ? "" : value).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c];}); };

var EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃",
  "😉","😌","😍","🥰","😘","😗","😙","😚","😋","😛","😝","😜",
  "🤪","🤨","🧐","🤓","😎","🤩","🥳","😏","😒","😞","😔","😟",
  "😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠",
  "😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗",
  "🤔","🤭","🤫","🤥","😶","😐","😑","😬","🙄","😯","😦","😧",
  "😮","😲","🥱","😴","🤤","😪","😵","🤐","🥴","🤢","🤮","🤧",
  "😷","🤒","🤕","❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎",
  "💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","👍","👎",
  "👏","🙌","🙏","🤝","💪","🔥","✨","⭐","💯","🎉","🎊","🍿",
  "🎬","🎮","🎵","🎶","✅","❌","💡","👀","💬"
];

var state = {
  built:false,
  friends:{},
  requests:{},
  summaries:{},
  readAt:{},
  summaryRefs:{},
  requestRef:null,
  activeUid:"",
  activeProfile:null,
  messages:{},
  messageRef:null,
  readsRef:null,
  typingRef:null,
  typingTimer:null,
  typingValue:false,
  typingOtherUntil:0,
  typingPoll:null,
  selectionToken:0,
  replyTo:null,
  editingId:"",
  search:"",
  messageSearch:"",
  draftFiles:[],
  pendingUploads:0,
  lightbox:null,
  recording:null,
  recordingChunks:[],
  recordingStartedAt:0,
  recordingTargetUid:""
};

function user() {
  var value = wt.auth.currentUser;
  return value && !value.isAnonymous ? value : null;
}

function privateId(a,b) {
  return [String(a),String(b)].sort().join("_");
}

function displayName() {
  return String(wt.currentName ? wt.currentName() : (wt.state.profile && wt.state.profile.displayName) || "玩家").slice(0,30);
}

function avatarEmoji() {
  return String(wt.currentAvatar ? wt.currentAvatar() : (wt.state.profile && wt.state.profile.avatarEmoji) || "🙂").slice(0,4) || "🙂";
}

function formatTime(value) {
  var date = new Date(Number(value) || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
  return date.toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"});
}

function formatDay(value) {
  var date = new Date(Number(value) || 0);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= 0) return "";
  var now = new Date();
  var today = new Date(now.getFullYear(),now.getMonth(),now.getDate());
  var target = new Date(date.getFullYear(),date.getMonth(),date.getDate());
  var diff = Math.round((today-target)/86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return date.toLocaleDateString("zh-TW",{month:"numeric",day:"numeric"});
}

function setTyping(value) {
  var me = user();
  var active = state.activeUid;
  if (!me || !active || !state.typingRef) return;
  value = Boolean(value);
  if (state.typingValue === value) return;
  state.typingValue = value;
  if (value) {
    state.typingRef.child(me.uid).set({name:displayName(),at:firebase.database.ServerValue.TIMESTAMP}).catch(function(){});
  } else {
    state.typingRef.child(me.uid).remove().catch(function(){});
  }
}

function clearTyping() {
  if (state.typingTimer) {
    clearTimeout(state.typingTimer);
    state.typingTimer = null;
  }
  setTyping(false);
}

function stopSummaryListeners() {
  Object.keys(state.summaryRefs).forEach(function(uid){
    var refs = state.summaryRefs[uid] || {};
    try { refs.last && refs.last.off(); } catch (_) {}
    try { refs.read && refs.read.off(); } catch (_) {}
  });
  state.summaryRefs = {};
}

function stopActiveListeners() {
  clearTyping();
  if (state.typingPoll) {
    clearInterval(state.typingPoll);
    state.typingPoll = null;
  }
  try { state.messageRef && state.messageRef.off(); } catch (_) {}
  try { state.readsRef && state.readsRef.off(); } catch (_) {}
  try { state.typingRef && state.typingRef.off(); } catch (_) {}
  state.messageRef = null;
  state.readsRef = null;
  state.typingRef = null;
  state.messages = {};
  state.readAt = {};
  state.typingOtherUntil = 0;
}

function stopRequestListener() {
  try { state.requestRef && state.requestRef.off(); } catch (_) {}
  state.requestRef = null;
}

function chatIsOpen() {
  var modal = $("wtChatCenter");
  return Boolean(modal && !modal.classList.contains("hidden"));
}

function ensureLogin() {
  if (user()) return true;
  wt.toast("Google 登入後才能使用聊天功能");
  return false;
}

async function fetchFriends() {
  var me = user();
  if (!me) {
    state.friends = {};
    renderSidebar();
    return;
  }
  var snapshot = await wt.db.ref("friendships/" + me.uid).once("value");
  var ids = Object.keys(snapshot.val() || {});
  var pairs = await Promise.all(ids.map(async function(uid){
    var profile = (await wt.db.ref("profiles/" + uid).once("value").catch(function(){ return null; })).val() || {};
    return [uid,profile];
  }));
  state.friends = Object.fromEntries(pairs);
  Object.keys(state.summaries).forEach(function(uid){
    if (!state.friends[uid]) delete state.summaries[uid];
  });
  renderSidebar();
  subscribeSummaries();
}

function subscribeSummaries() {
  stopSummaryListeners();
  var me = user();
  if (!me) return;
  Object.keys(state.friends).forEach(function(uid){
    var id = privateId(me.uid,uid);
    var last = wt.db.ref("conversations/" + id + "/lastMessage");
    var read = wt.db.ref("conversations/" + id + "/reads/" + me.uid);
    state.summaryRefs[uid] = {last:last,read:read};
    last.on("value",function(snapshot){
      state.summaries[uid] = snapshot.val() || null;
      renderSidebar();
    },function(){
      state.summaries[uid] = null;
      renderSidebar();
    });
    read.on("value",function(snapshot){
      state.readAt[uid] = Number(snapshot.val() || 0);
      renderSidebar();
    });
  });
}

function listenRequests() {
  stopRequestListener();
  var me = user();
  if (!me) {
    state.requests = {};
    renderRequests();
    return;
  }
  var ref = wt.db.ref("friendRequests/" + me.uid);
  state.requestRef = ref;
  ref.on("value",function(snapshot){
    state.requests = snapshot.val() || {};
    renderRequests();
    renderChatBadge();
  });
}

async function sendFriendRequest(code) {
  if (!ensureLogin()) return;
  var me = user();
  code = String(code || "").trim().toUpperCase();
  if (!wt.FRIEND_CODE_RE.test(code)) throw new Error("ID 必須是 6 碼英數字");
  var codeSnapshot = await wt.db.ref("profileCodes/" + code).once("value");
  var targetUid = String(codeSnapshot.val() || "");
  if (!targetUid) throw new Error("找不到這個 ID");
  if (targetUid === me.uid) throw new Error("不能加自己為好友");
  var friendship = await wt.db.ref("friendships/" + me.uid + "/" + targetUid).once("value");
  if (friendship.exists()) throw new Error("你們已經是好友");
  var incoming = await wt.db.ref("friendRequests/" + me.uid + "/" + targetUid).once("value");
  if (incoming.exists()) {
    await acceptRequest(targetUid);
    return;
  }
  var outgoingRef = wt.db.ref("friendRequests/" + targetUid + "/" + me.uid);
  if ((await outgoingRef.once("value")).exists()) throw new Error("好友邀請已經送出");
  var profile = wt.state.profile || {};
  await outgoingRef.set({
    uid:me.uid,
    name:displayName(),
    fromName:displayName(),
    avatarEmoji:avatarEmoji(),
    fromCode:String(profile.publicCode || "").slice(0,6),
    createdAt:firebase.database.ServerValue.TIMESTAMP
  });
  wt.toast("好友邀請已送出");
}

async function acceptRequest(uid) {
  if (!ensureLogin()) return;
  var me = user();
  var requestRef = wt.db.ref("friendRequests/" + me.uid + "/" + uid);
  var request = (await requestRef.once("value")).val();
  if (!request) throw new Error("好友邀請已不存在");
  var since = firebase.database.ServerValue.TIMESTAMP;
  var updates = {};
  updates["friendships/" + me.uid + "/" + uid] = {since:since};
  updates["friendships/" + uid + "/" + me.uid] = {since:since};
  updates["friendRequests/" + me.uid + "/" + uid] = null;
  updates["friendRequests/" + uid + "/" + me.uid] = null;
  await wt.db.ref().update(updates);
  var profile = (await wt.db.ref("profiles/" + uid).once("value").catch(function(){ return null; })).val() || {};
  state.friends[uid] = profile;
  state.activeUid = uid;
  state.activeProfile = profile;
  renderSidebar();
  renderRequests();
  renderChatBadge();
  await openConversation(uid);
  wt.toast("已新增好友");
}

async function declineRequest(uid) {
  if (!ensureLogin()) return;
  await wt.db.ref("friendRequests/" + user().uid + "/" + uid).remove();
  wt.toast("已拒絕好友邀請");
}

async function removeFriendPlus(uid) {
  if (!ensureLogin()) return;
  var me = user();
  if (!window.confirm("確定要刪除這位好友嗎？")) return;
  var updates = {};
  updates["friendships/" + me.uid + "/" + uid] = null;
  updates["friendships/" + uid + "/" + me.uid] = null;
  updates["friendRequests/" + me.uid + "/" + uid] = null;
  updates["friendRequests/" + uid + "/" + me.uid] = null;
  await wt.db.ref().update(updates);
  if (state.activeUid === uid) {
    stopActiveListeners();
    state.activeUid = "";
    state.activeProfile = null;
    state.editingId = "";
    state.replyTo = null;
  }
  delete state.friends[uid];
  delete state.summaries[uid];
  renderSidebar();
  renderChatHeader();
  renderMessages();
  wt.toast("好友已刪除");
}

async function ensureConversation(uid) {
  var me = user();
  if (!me) throw new Error("Google 登入後才能私聊");
  var friendship = await wt.db.ref("friendships/" + me.uid + "/" + uid).once("value");
  if (!friendship.exists()) throw new Error("只有好友可以私聊");
  var id = privateId(me.uid,uid);
  var ref = wt.db.ref("conversations/" + id);
  var snap = await ref.once("value").catch(function(){ return null; });
  if (!snap || !snap.exists()) {
    var pair = [me.uid,uid].sort();
    await ref.set({userA:pair[0],userB:pair[1],createdAt:firebase.database.ServerValue.TIMESTAMP}).catch(async function(error){
      var retry = await ref.once("value").catch(function(){ return null; });
      if (!retry || !retry.exists()) throw error;
    });
  }
  return id;
}

function messagePreview(message) {
  if (!message) return "";
  if (message.type === "image") return "📷 圖片";
  if (message.type === "audio") return "🎤 語音";
  if (message.type === "sticker") return String(message.sticker || "貼圖");
  return String(message.text || "");
}

async function updateSummary(id,message,targetUid) {
  var me = user();
  targetUid = String(targetUid || state.activeUid || "");
  if (!me || !targetUid) return;
  var summary = {
    uid:me.uid,
    name:displayName(),
    type:String(message.type || "text"),
    preview:messagePreview(message),
    createdAt:firebase.database.ServerValue.TIMESTAMP,
    messageId:String(id)
  };
  await wt.db.ref("conversations/" + privateId(me.uid,targetUid) + "/lastMessage").set(summary);
}

async function sendMessagePayload(payload,targetUid) {
  var me = user();
  targetUid = String(targetUid || state.activeUid || "");
  if (!me || !targetUid) throw new Error("請先選擇好友");
  var conversationId = await ensureConversation(targetUid);
  payload = Object.assign({
    uid:me.uid,
    name:displayName(),
    createdAt:firebase.database.ServerValue.TIMESTAMP
  },payload);
  var messageRef = await wt.db.ref("conversations/" + conversationId + "/messages").push(payload);
  try {
    await updateSummary(messageRef.key,payload,targetUid);
  } catch (error) {
    console.warn("聊天摘要更新失敗，訊息本身仍已送出:", error);
  }
  return messageRef.key;
}

function clearReplyEdit() {
  state.replyTo = null;
  state.editingId = "";
  renderComposerState();
}

function buildReplyFields(message) {
  return {
    replyToId:String(message.id || "").slice(0,120),
    replyToName:String(message.name || "玩家").slice(0,30),
    replyToText:messagePreview(message).slice(0,300),
    replyToType:String(message.type || "text").slice(0,20)
  };
}

async function sendText() {
  var input = $("wtChatInput");
  if (!input || !state.activeUid) {
    wt.toast("請先選擇好友");
    return;
  }
  var text = String(input.value || "").trim();
  if (!text) return;
  if (state.editingId) {
    var message = state.messages[state.editingId];
    if (!message || message.uid !== user().uid || message.type !== "text") return;
    await wt.db.ref("conversations/" + privateId(user().uid,state.activeUid) + "/messages/" + state.editingId).update({
      text:text.slice(0,2000),
      editedAt:firebase.database.ServerValue.TIMESTAMP
    });
    clearReplyEdit();
    input.value = "";
    return;
  }
  var payload = Object.assign({type:"text",text:text.slice(0,2000)},state.replyTo ? buildReplyFields(state.replyTo) : {});
  await sendMessagePayload(payload);
  input.value = "";
  clearReplyEdit();
  setTyping(false);
}

async function sendSticker(sticker) {
  if (!state.activeUid) return;
  var payload = Object.assign({type:"sticker",sticker:String(sticker || "😊").slice(0,4)},state.replyTo ? buildReplyFields(state.replyTo) : {});
  await sendMessagePayload(payload);
  clearReplyEdit();
  hidePicker("wtChatStickerPicker");
}

function blobFromFile(file,maxBytes) {
  return new Promise(function(resolve,reject){
    if (file.size > maxBytes) {
      reject(new Error("檔案太大，單檔上限 8 MB"));
      return;
    }
    if (file.type === "image/gif") {
      resolve({blob:file,type:file.type,name:file.name});
      return;
    }
    var reader = new FileReader();
    reader.onerror = function(){ reject(new Error("圖片讀取失敗")); };
    reader.onload = function(){
      var image = new Image();
      image.onerror = function(){ reject(new Error("圖片格式無法讀取")); };
      image.onload = function(){
        var scale = Math.min(1,1600 / Math.max(image.width,image.height));
        var width = Math.max(1,Math.round(image.width * scale));
        var height = Math.max(1,Math.round(image.height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        var ctx = canvas.getContext("2d");
        ctx.drawImage(image,0,0,width,height);
        canvas.toBlob(function(blob){
          if (!blob) {
            reject(new Error("圖片壓縮失敗"));
            return;
          }
          resolve({blob:blob,type:"image/webp",name:(file.name || "image").replace(/\.[^.]+$/,"") + ".webp"});
        },"image/webp",0.84);
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob) {
  return new Promise(function(resolve,reject){
    var reader = new FileReader();
    reader.onerror = function(){ reject(new Error("圖片備援資料建立失敗")); };
    reader.onload = function(){ resolve(String(reader.result || "")); };
    reader.readAsDataURL(blob);
  });
}

async function uploadMediaBlob(blob,type,name,targetUid) {
  var me = user();
  targetUid = String(targetUid || state.activeUid || "");
  if (!me || !targetUid) throw new Error("聊天對象不存在");
  var conversationId = privateId(me.uid,targetUid);
  var ext = type.indexOf("audio/") === 0 ? ".webm" : (type === "image/gif" ? ".gif" : ".webp");
  var safeName = String(name || "media").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,60);
  var fileId = Date.now() + "_" + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));

  if (type.indexOf("image/") === 0 && blob.size <= 720 * 1024) {
    if (firebase.storage) {
      try {
        var pair = [me.uid,targetUid].sort();
        var storagePath = "chatMedia/" + pair[0] + "/" + pair[1] + "/" + fileId + ext;
        var ref = firebase.storage().ref(storagePath);
        var metadata = {
          contentType:type,
          customMetadata:{
            ownerUid:me.uid,
            friendUid:targetUid,
            conversationId:conversationId
          }
        };
        await ref.put(blob,metadata);
        var url = await ref.getDownloadURL();
        return {url:url,path:storagePath,size:blob.size,name:safeName,type:type};
      } catch (error) {
        console.warn("Firebase Storage 圖片上傳失敗，改用 RTDB 圖片備援:", error);
      }
    }

    var dataUrl = await blobToDataUrl(blob);
    if (dataUrl.length > 900000) {
      throw new Error("圖片壓縮後仍太大，請選擇較小的圖片");
    }
    return {url:dataUrl,path:"",size:blob.size,name:safeName,type:type,inline:true};
  }

  if (!firebase.storage) throw new Error("Firebase Storage 尚未載入");
  var pair = [me.uid,targetUid].sort();
  var path = "chatMedia/" + pair[0] + "/" + pair[1] + "/" + fileId + ext;
  var storageRef = firebase.storage().ref(path);
  var storageMetadata = {contentType:type,customMetadata:{ownerUid:me.uid,friendUid:targetUid,conversationId:conversationId}};
  await storageRef.put(blob,storageMetadata);
  var storageUrl = await storageRef.getDownloadURL();
  return {url:storageUrl,path:path,size:blob.size,name:safeName,type:type};
}

async function sendImageFile(file,targetUid) {
  targetUid = String(targetUid || state.activeUid || "");
  if (!targetUid) throw new Error("請先選擇好友");
  var prepared = await blobFromFile(file,8 * 1024 * 1024);
  var media = await uploadMediaBlob(prepared.blob,prepared.type,prepared.name,targetUid);
  var payload = Object.assign({
    type:"image",
    mediaUrl:media.url,
    mediaPath:media.path || "",
    mediaName:media.name,
    mediaSize:media.size
  },state.replyTo ? buildReplyFields(state.replyTo) : {});
  await sendMessagePayload(payload,targetUid);
}

async function handleImageFiles(files) {
  if (!ensureLogin() || !state.activeUid) {
    if (!state.activeUid) wt.toast("請先選擇好友");
    return;
  }
  var list = Array.from(files || []).filter(function(file){ return String(file.type || "").indexOf("image/") === 0; }).slice(0,8);
  if (!list.length) return;
  state.pendingUploads = list.length;
  renderComposerState();
  try {
    var targetUid = state.activeUid;
    for (var i=0;i<list.length;i++) {
      await sendImageFile(list[i],targetUid);
      state.pendingUploads--;
      renderComposerState();
    }
  } catch (error) {
    wt.toast(error && error.message || "圖片上傳失敗");
  } finally {
    state.pendingUploads = 0;
    renderComposerState();
  }
}

function mediaRecorderMime() {
  if (!window.MediaRecorder) return "";
  var types = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus"];
  for (var i=0;i<types.length;i++) {
    if (MediaRecorder.isTypeSupported(types[i])) return types[i];
  }
  return "";
}

async function toggleRecording() {
  if (!ensureLogin() || !state.activeUid) {
    if (!state.activeUid) wt.toast("請先選擇好友");
    return;
  }
  if (state.recording) {
    state.recording.stop();
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
    wt.toast("此瀏覽器不支援語音訊息");
    return;
  }
  var stream = null;
  var targetUid = state.activeUid;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:true});
    var mime = mediaRecorderMime();
    var recorder = new MediaRecorder(stream,mime ? {mimeType:mime} : undefined);
    state.recordingChunks = [];
    state.recordingStartedAt = Date.now();
    state.recordingTargetUid = targetUid;
    state.recording = recorder;
    recorder.addEventListener("dataavailable",function(event){
      if (event.data && event.data.size) state.recordingChunks.push(event.data);
    });
    recorder.addEventListener("stop",async function(){
      var duration = Math.min(120,Math.max(1,Math.round((Date.now()-state.recordingStartedAt)/1000)));
      state.recording = null;
      stream.getTracks().forEach(function(track){ track.stop(); });
      renderComposerState();
      var blob = new Blob(state.recordingChunks,{type:recorder.mimeType || "audio/webm"});
      state.recordingChunks = [];
      if (!blob.size) return;
      try {
        var media = await uploadMediaBlob(blob,blob.type,"voice.webm",targetUid);
        var payload = Object.assign({
          type:"audio",
          mediaUrl:media.url,
          mediaPath:media.path,
          mediaName:media.name,
          mediaSize:media.size,
          duration:duration
        },state.replyTo ? buildReplyFields(state.replyTo) : {});
        await sendMessagePayload(payload,targetUid);
        clearReplyEdit();
      } catch (error) {
        wt.toast(error && error.message || "語音訊息上傳失敗");
      }
    });
    recorder.start();
    renderComposerState();
    setTimeout(function(){
      if (state.recording === recorder) recorder.stop();
    },120000);
  } catch (error) {
    if (stream) stream.getTracks().forEach(function(track){ track.stop(); });
    state.recording = null;
    renderComposerState();
    wt.toast("無法啟用麥克風，請允許瀏覽器使用麥克風");
  }
}

async function toggleReaction(messageId,emoji) {
  var me = user();
  if (!me || !state.activeUid) return;
  var ref = wt.db.ref("conversations/" + privateId(me.uid,state.activeUid) + "/messages/" + messageId + "/reactions/" + me.uid);
  var current = state.messages[messageId] && state.messages[messageId].reactions && state.messages[messageId].reactions[me.uid];
  if (current === emoji) await ref.remove();
  else await ref.set(emoji);
}

function replyToMessage(id) {
  var message = state.messages[id];
  if (!message) return;
  state.replyTo = message;
  state.editingId = "";
  renderComposerState();
  $("wtChatInput")?.focus();
}

function editMessage(id) {
  var message = state.messages[id];
  if (!message || message.uid !== user()?.uid || message.type !== "text") return;
  state.editingId = id;
  state.replyTo = null;
  var input = $("wtChatInput");
  if (input) {
    input.value = message.text || "";
    input.focus();
    input.setSelectionRange(input.value.length,input.value.length);
  }
  renderComposerState();
}

async function deleteMessage(id) {
  var message = state.messages[id];
  if (!message || message.uid !== user()?.uid) return;
  if (!window.confirm("刪除這則訊息？")) return;
  var path = "conversations/" + privateId(user().uid,state.activeUid) + "/messages/" + id;
  if (message.mediaPath && firebase.storage) {
    firebase.storage().ref(message.mediaPath).delete().catch(function(){});
  }
  await wt.db.ref(path).remove();
  if (state.editingId === id) clearReplyEdit();
}

function copyMessage(id) {
  var message = state.messages[id];
  if (!message) return;
  var text = message.type === "text" ? String(message.text || "") : messagePreview(message);
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function(){ wt.toast("已複製"); }).catch(function(){ wt.toast(text); });
  } else {
    wt.toast(text);
  }
}

function openLightbox(url) {
  closeLightbox();
  var box = document.createElement("div");
  box.className = "wt-chat-lightbox";
  box.innerHTML = '<div class="wt-chat-lightbox-backdrop"></div><button class="wt-chat-lightbox-close" type="button">×</button><img src="' + esc(url) + '" alt="圖片預覽">';
  document.body.appendChild(box);
  box.querySelector(".wt-chat-lightbox-backdrop").addEventListener("click",closeLightbox);
  box.querySelector(".wt-chat-lightbox-close").addEventListener("click",closeLightbox);
  state.lightbox = box;
}

function closeLightbox() {
  if (state.lightbox) {
    state.lightbox.remove();
    state.lightbox = null;
  }
}

function renderChatBadge() {
  var count = Object.keys(state.requests || {}).length;
  var label = count ? "👥 好友 · " + count : "👥 好友";
  [$("wtFriendsBtn"),$("wtHomeFriends")].forEach(function(btn){
    if (btn) btn.textContent = label;
  });
}

function renderRequests() {
  var box = $("wtChatRequests");
  var badge = $("wtChatRequestCount");
  if (!box) return;
  var entries = Object.entries(state.requests || {});
  if (badge) badge.textContent = entries.length ? String(entries.length) : "";
  if (!entries.length) {
    box.innerHTML = '<div class="wt-chat-empty-small">目前沒有新的好友邀請。</div>';
    return;
  }
  box.innerHTML = entries.map(function(pair){
    var uid = pair[0];
    var request = pair[1] || {};
    return '<div class="wt-chat-request"><div class="wt-chat-avatar">' + esc(request.avatarEmoji || "🙂") + '</div><div class="wt-chat-request-body"><strong>' + esc(request.fromName || request.name || "玩家") + '</strong><span>' + esc(request.fromCode || "") + '</span><div class="wt-chat-actions"><button type="button" class="wt-chat-action primary" data-chat-accept="' + esc(uid) + '">接受</button><button type="button" class="wt-chat-action" data-chat-decline="' + esc(uid) + '">拒絕</button></div></div></div>';
  }).join("");
  box.querySelectorAll("[data-chat-accept]").forEach(function(btn){
    btn.addEventListener("click",function(){ acceptRequest(btn.dataset.chatAccept).catch(function(error){ wt.toast(error && error.message || "接受失敗"); }); });
  });
  box.querySelectorAll("[data-chat-decline]").forEach(function(btn){
    btn.addEventListener("click",function(){ declineRequest(btn.dataset.chatDecline).catch(function(error){ wt.toast(error && error.message || "拒絕失敗"); }); });
  });
}

function renderSidebar() {
  var box = $("wtChatList");
  var count = $("wtChatFriendCount");
  if (!box) return;
  var query = String(state.search || "").trim().toLowerCase();
  var entries = Object.entries(state.friends || {}).filter(function(pair){
    var uid=pair[0], profile=pair[1]||{}, summary=state.summaries[uid]||{};
    var hay=[profile.displayName,profile.publicCode,summary.preview,uid].join(" ").toLowerCase();
    return !query || hay.indexOf(query)>=0;
  }).sort(function(a,b){
    var sa=state.summaries[a[0]]||{}, sb=state.summaries[b[0]]||{};
    var at=Number(sa.createdAt||0), bt=Number(sb.createdAt||0);
    if (at !== bt) return bt-at;
    return String(a[1]?.displayName||"").localeCompare(String(b[1]?.displayName||""),"zh-Hant");
  });
  if (count) count.textContent = Object.keys(state.friends || {}).length ? String(Object.keys(state.friends || {}).length) : "";
  if (!entries.length) {
    box.innerHTML = '<div class="wt-chat-empty-small">' + (query ? "沒有符合搜尋的好友。" : "還沒有好友，先加一位好友吧。") + '</div>';
    return;
  }
  var me = user();
  box.innerHTML = entries.map(function(pair){
    var uid=pair[0], profile=pair[1]||{}, summary=state.summaries[uid]||{};
    var unread = summary && String(summary.uid||"") !== String(me && me.uid||"") && Number(summary.createdAt||0) > Number(state.readAt[uid]||0);
    var avatar = String(profile.avatarEmoji || String(profile.displayName || "🙂").slice(0,1) || "🙂").slice(0,4);
    return '<button type="button" class="wt-chat-list-item' + (uid===state.activeUid ? ' active' : '') + '" data-chat-friend="' + esc(uid) + '"><div class="wt-chat-avatar">' + esc(avatar) + '</div><div class="wt-chat-list-text"><strong>' + esc(profile.displayName || "玩家") + '</strong><span>' + esc(summary.preview || "開始聊天吧 👋") + '</span></div><div class="wt-chat-list-meta">' + (summary.createdAt ? '<time>' + esc(formatTime(summary.createdAt)) + '</time>' : '') + (unread ? '<b>未讀</b>' : '') + '</div></button>';
  }).join("");
  box.querySelectorAll("[data-chat-friend]").forEach(function(btn){
    btn.addEventListener("click",function(){ openConversation(btn.dataset.chatFriend); });
  });
}

function renderChatHeader() {
  var profile=state.activeProfile;
  var title=$("wtChatTitle"), sub=$("wtChatSubtitle"), avatar=$("wtChatHeaderAvatar"), remove=$("wtChatRemoveFriend");
  if (!title || !sub || !avatar) return;
  if (!profile || !state.activeUid) {
    title.textContent="選擇好友";
    sub.textContent="選擇一位好友開始聊天";
    avatar.textContent="💬";
    if (remove) remove.disabled=true;
    return;
  }
  title.textContent=profile.displayName || "玩家";
  sub.textContent="ID：" + String(profile.publicCode || "好友");
  avatar.textContent=String(profile.avatarEmoji || String(profile.displayName || "🙂").slice(0,1) || "🙂").slice(0,4);
  if (remove) remove.disabled=false;
}

function renderComposerState() {
  var reply=$("wtChatReplyBar"), edit=$("wtChatEditBar"), send=$("wtChatSend"), status=$("wtChatUploadStatus"), input=$("wtChatInput");
  if (reply) {
    reply.classList.toggle("hidden",!state.replyTo);
    if (state.replyTo) reply.querySelector(".wt-chat-reply-text").textContent="回覆 " + String(state.replyTo.name || "玩家") + "： " + messagePreview(state.replyTo);
  }
  if (edit) {
    edit.classList.toggle("hidden",!state.editingId);
    if (state.editingId) {
      var message=state.messages[state.editingId];
      var label=edit.querySelector(".wt-chat-edit-text");
      if(label) label.textContent="編輯訊息：" + String(message && message.text || "").slice(0,80);
    }
  }
  if (send) send.textContent=state.editingId ? "儲存" : "送出";
  if (input) input.placeholder=state.editingId ? "編輯訊息…" : "傳送訊息…";
  if (status) {
    status.textContent=state.recording ? "🔴 錄音中，點麥克風停止" : (state.pendingUploads ? "📤 正在上傳 " + state.pendingUploads + " 張圖片…" : "");
    status.classList.toggle("show",Boolean(state.recording || state.pendingUploads));
  }
}

function renderMessages() {
  var box=$("wtChatMessages");
  if(!box) return;
  var me=user();
  var active=state.activeUid;
  if(!active) {
    box.innerHTML='<div class="wt-chat-empty"><div class="wt-chat-empty-icon">💬</div><strong>選擇好友開始聊天</strong><span>支援文字、貼圖、圖片、語音、回覆、反應與已讀。</span></div>';
    renderComposerState();
    return;
  }
  var query=String(state.messageSearch||"").trim().toLowerCase();
  var list=Object.entries(state.messages || {}).map(function(pair){ return Object.assign({id:pair[0]},pair[1]||{}); }).sort(function(a,b){ return Number(a.createdAt||0)-Number(b.createdAt||0); });
  if(query) list=list.filter(function(m){ return [m.text,m.name,m.replyToText,m.replyToName].join(" ").toLowerCase().indexOf(query)>=0; });
  if(!list.length) {
    box.innerHTML='<div class="wt-chat-empty"><div class="wt-chat-empty-icon">👋</div><strong>' + (query ? "找不到訊息" : "還沒有訊息") + '</strong><span>' + (query ? "換個關鍵字試試看。" : "傳送第一則訊息開始聊天吧。") + '</span></div>';
    renderComposerState();
    return;
  }
  var html="";
  var lastDay="";
  list.forEach(function(message){
    var day=formatDay(message.createdAt);
    if(day && day!==lastDay) {
      html+='<div class="wt-chat-day"><span>' + esc(day) + '</span></div>';
      lastDay=day;
    }
    var self=String(message.uid||"")===String(me&&me.uid||"");
    var reactions=message.reactions || {};
    var reactionCounts={};
    Object.values(reactions).forEach(function(value){ value=String(value||""); if(value) reactionCounts[value]=(reactionCounts[value]||0)+1; });
    var reactionHtml=Object.keys(reactionCounts).map(function(key){
      return '<button type="button" class="wt-chat-reaction ' + (reactions[me&&me.uid]===key ? 'mine' : '') + '" data-chat-react="' + esc(message.id) + '" data-chat-reaction="' + esc(key) + '">' + esc(key) + ' ' + reactionCounts[key] + '</button>';
    }).join("");
    var replyHtml=message.replyToId ? '<button type="button" class="wt-chat-quoted" data-chat-reply-jump="' + esc(message.replyToId) + '"><strong>' + esc(message.replyToName || "玩家") + '</strong><span>' + esc(message.replyToText || "原訊息") + '</span></button>' : "";
    var body="";
    if(message.type==="sticker") {
      body='<div class="wt-chat-sticker">' + esc(message.sticker || "😊") + '</div>';
    } else if(message.type==="image" && message.mediaUrl) {
      body='<button type="button" class="wt-chat-image-btn" data-chat-image="' + esc(message.mediaUrl) + '"><img src="' + esc(message.mediaUrl) + '" alt="' + esc(message.mediaName || "圖片") + '" loading="lazy"></button>';
    } else if(message.type==="audio" && message.mediaUrl) {
      body='<audio class="wt-chat-audio" controls preload="metadata" src="' + esc(message.mediaUrl) + '"></audio><span class="wt-chat-audio-meta">🎤 ' + Math.max(1,Number(message.duration||0)) + ' 秒</span>';
    } else {
      body='<div class="wt-chat-text">' + esc(message.text || "") + '</div>';
    }
    var edited=message.editedAt ? '<span class="wt-chat-edited">已編輯</span>' : "";
    var seen=self && Number(state.readAt[active+"__friend"]||0)>=Number(message.createdAt||0) ? '<span class="wt-chat-seen">已讀</span>' : "";
    var actions='<div class="wt-chat-message-actions"><button type="button" data-chat-reply="' + esc(message.id) + '">↩ 回覆</button><button type="button" data-chat-react="' + esc(message.id) + '" data-chat-reaction="❤️">❤️</button><button type="button" data-chat-copy="' + esc(message.id) + '">複製</button>';
    if(self && message.type==="text") actions+='<button type="button" data-chat-edit="' + esc(message.id) + '">編輯</button>';
    if(self) actions+='<button type="button" class="danger" data-chat-delete="' + esc(message.id) + '">刪除</button>';
    actions+='</div>';
    html+='<article class="wt-chat-message ' + (self ? 'self':'') + '" id="wt-chat-message-' + esc(message.id) + '">' +
      '<div class="wt-chat-message-avatar">' + esc(self ? avatarEmoji() : String(state.activeProfile && state.activeProfile.avatarEmoji || "🙂").slice(0,4)) + '</div>' +
      '<div class="wt-chat-message-stack"><div class="wt-chat-message-head"><strong>' + esc(message.name || "玩家") + '</strong><span>' + esc(formatTime(message.createdAt)) + '</span>' + edited + seen + '</div>' +
      replyHtml + body + (reactionHtml ? '<div class="wt-chat-reactions">' + reactionHtml + '</div>' : '') + actions + '</div></article>';
  });
  box.innerHTML=html;
  box.querySelectorAll("[data-chat-image]").forEach(function(btn){ btn.addEventListener("click",function(){ openLightbox(btn.dataset.chatImage); }); });
  box.querySelectorAll("[data-chat-reply]").forEach(function(btn){ btn.addEventListener("click",function(){ replyToMessage(btn.dataset.chatReply); }); });
  box.querySelectorAll("[data-chat-react]").forEach(function(btn){ btn.addEventListener("click",function(){ toggleReaction(btn.dataset.chatReact,btn.dataset.chatReaction || "❤️").catch(function(error){wt.toast(error&&error.message||"反應失敗");}); }); });
  box.querySelectorAll("[data-chat-copy]").forEach(function(btn){ btn.addEventListener("click",function(){ copyMessage(btn.dataset.chatCopy); }); });
  box.querySelectorAll("[data-chat-edit]").forEach(function(btn){ btn.addEventListener("click",function(){ editMessage(btn.dataset.chatEdit); }); });
  box.querySelectorAll("[data-chat-delete]").forEach(function(btn){ btn.addEventListener("click",function(){ deleteMessage(btn.dataset.chatDelete).catch(function(error){wt.toast(error&&error.message||"刪除失敗");}); }); });
  box.querySelectorAll("[data-chat-reply-jump]").forEach(function(btn){ btn.addEventListener("click",function(){
    var target=$("wt-chat-message-"+btn.dataset.chatReplyJump);
    if(target) target.scrollIntoView({behavior:"smooth",block:"center"});
  }); });
  if (!query) box.scrollTop=box.scrollHeight;
  renderComposerState();
}

function renderTyping() {
  var box=$("wtChatTyping");
  if(!box) return;
  var active=state.activeUid;
  var visible=Boolean(active && state.typingOtherUntil>Date.now());
  box.textContent=visible ? String(state.activeProfile && state.activeProfile.displayName || "好友") + " 正在輸入…" : "";
  box.classList.toggle("show",visible);
}

async function markRead() {
  var me=user();
  if(!me || !state.activeUid || !state.readsRef) return;
  var list=Object.values(state.messages || {});
  var latest=list.sort(function(a,b){return Number(a.createdAt||0)-Number(b.createdAt||0);}).pop();
  if(!latest || !latest.createdAt) return;
  await state.readsRef.child(me.uid).set(firebase.database.ServerValue.TIMESTAMP).catch(function(){});
}

function startActiveListeners(uid) {
  stopActiveListeners();
  var me=user();
  if(!me || !uid) return;
  var id=privateId(me.uid,uid);
  state.messageRef=wt.db.ref("conversations/"+id+"/messages").limitToLast(200);
  state.readsRef=wt.db.ref("conversations/"+id+"/reads");
  state.typingRef=wt.db.ref("conversations/"+id+"/typing");
  state.messageRef.on("value",function(snapshot){
    state.messages=snapshot.val()||{};
    renderMessages();
    void markRead();
  });
  state.readsRef.on("value",function(snapshot){
    var values=snapshot.val()||{};
    state.readAt[uid]=Number(values[me.uid]||0);
    state.readAt[uid+"__friend"]=Number(values[uid]||0);
    renderMessages();
    renderSidebar();
  });
  state.typingRef.on("value",function(snapshot){
    var values=snapshot.val()||{};
    var entry=values[uid];
    state.typingOtherUntil=entry && Number(entry.at||0)>Date.now()-3500 ? Date.now()+1500 : 0;
    renderTyping();
  });
  state.typingPoll=setInterval(function(){
    if(state.typingOtherUntil && state.typingOtherUntil<=Date.now()) {
      state.typingOtherUntil=0;
      renderTyping();
    }
  },800);
}

async function openConversation(uid) {
  if(!state.friends[uid]) return;
  var card = document.querySelector("#wtChatCenter .wt-chat-modal-card");
  if (card) card.classList.remove("wt-chat-show-sidebar");
  var token=++state.selectionToken;
  state.activeUid=uid;
  state.activeProfile=state.friends[uid];
  state.replyTo=null;
  state.editingId="";
  state.messageSearch="";
  renderSidebar();
  renderChatHeader();
  renderMessages();
  renderTyping();
  try {
    await ensureConversation(uid);
    if(token!==state.selectionToken || state.activeUid!==uid) return;
    startActiveListeners(uid);
    await markRead();
    renderSidebar();
  } catch(error) {
    if(token===state.selectionToken) wt.toast(error&&error.message||"聊天載入失敗");
  }
}

function hidePicker(id) {
  $(id)?.classList.add("hidden");
}

function showPicker(id) {
  var box=$(id);
  if(!box) return;
  box.classList.toggle("hidden");
  if(!box.dataset.built) {
    var list=id==="wtChatEmojiPicker" ? EMOJIS : (wt.STICKERS || ["😀","😂","❤️","🔥","👏","🎉"]);
    box.innerHTML=list.map(function(item){ return '<button type="button" data-chat-pick-emoji="' + esc(item) + '">' + esc(item) + '</button>'; }).join("");
    box.querySelectorAll("[data-chat-pick-emoji]").forEach(function(btn){
      btn.addEventListener("click",function(){
        var input=$("wtChatInput");
        if(input) {
          var start=input.selectionStart || input.value.length;
          var end=input.selectionEnd || start;
          input.value=input.value.slice(0,start)+btn.dataset.chatPickEmoji+input.value.slice(end);
          input.focus();
          input.setSelectionRange(start+btn.dataset.chatPickEmoji.length,start+btn.dataset.chatPickEmoji.length);
        }
        hidePicker(id);
      });
    });
    box.dataset.built="1";
  }
}

function buildModal() {
  if($("wtChatCenter")) return;
  var modal=document.createElement("div");
  modal.id="wtChatCenter";
  modal.className="wt-modal hidden";
  modal.setAttribute("aria-hidden","true");
  modal.innerHTML=
    '<div class="wt-modal-card wt-chat-modal-card">' +
      '<div class="wt-chat-topbar">' +
        '<div><div class="wt-panel-title">好友與聊天</div><div class="wt-small">像聊天 App 一樣管理好友、私訊、圖片、貼圖、語音與訊息互動。</div></div>' +
        '<button class="wt-close-btn" id="wtChatClose" type="button">×</button>' +
      '</div>' +
      '<div class="wt-chat-tools">' +
        '<div class="wt-chat-add"><input id="wtChatFriendCode" maxlength="6" placeholder="輸入好友 6 碼 ID" autocomplete="off" spellcheck="false"><button class="wt-action-btn primary" id="wtChatAddFriend" type="button">＋ 加好友</button></div>' +
        '<div class="wt-chat-search-wrap"><span>⌕</span><input id="wtChatFriendSearch" type="search" placeholder="搜尋好友或最近訊息"></div>' +
        '<button class="wt-action-btn" id="wtChatRequestsBtn" type="button">邀請 <b id="wtChatRequestCount"></b></button>' +
      '</div>' +
      '<div class="wt-chat-layout">' +
        '<aside class="wt-chat-sidebar">' +
          '<div class="wt-chat-sidebar-head"><strong>聊天室</strong><span id="wtChatFriendCount"></span></div>' +
          '<div id="wtChatList" class="wt-chat-list"></div>' +
          '<div id="wtChatRequestsPanel" class="wt-chat-requests-panel hidden"><div class="wt-chat-sidebar-head"><strong>好友邀請</strong><button type="button" class="wt-chat-mini-close" id="wtChatRequestsClose">×</button></div><div id="wtChatRequests"></div></div>' +
        '</aside>' +
        '<section class="wt-chat-main">' +
          '<header class="wt-chat-header">' +
            '<div class="wt-chat-header-user"><div class="wt-chat-avatar large" id="wtChatHeaderAvatar">💬</div><div><strong id="wtChatTitle">選擇好友</strong><span id="wtChatSubtitle">選擇一位好友開始聊天</span></div></div>' +
            '<div class="wt-chat-header-actions"><button class="wt-chat-icon-btn wt-chat-mobile-back" id="wtChatBackBtn" type="button">←</button><button class="wt-chat-icon-btn" id="wtChatSearchToggle" type="button">⌕</button><button class="wt-chat-icon-btn danger" id="wtChatRemoveFriend" type="button" disabled>刪除好友</button></div>' +
          '</header>' +
          '<div id="wtChatMessageSearchBar" class="wt-chat-message-search hidden"><input id="wtChatMessageSearch" type="search" placeholder="搜尋這個聊天室的訊息"><button type="button" id="wtChatMessageSearchClear">清除</button></div>' +
          '<div id="wtChatMessages" class="wt-chat-messages"></div>' +
          '<div id="wtChatTyping" class="wt-chat-typing"></div>' +
          '<div id="wtChatReplyBar" class="wt-chat-composer-state hidden"><span class="icon">↩</span><span class="wt-chat-reply-text"></span><button type="button" data-chat-clear-reply="1">×</button></div>' +
          '<div id="wtChatEditBar" class="wt-chat-composer-state edit hidden"><span class="icon">✎</span><span class="wt-chat-edit-text"></span><button type="button" data-chat-clear-edit="1">×</button></div>' +
          '<div id="wtChatUploadStatus" class="wt-chat-upload-status"></div>' +
          '<form id="wtChatComposer" class="wt-chat-composer">' +
            '<input id="wtChatImageInput" type="file" accept="image/*" multiple hidden>' +
            '<button class="wt-chat-icon-btn" id="wtChatImageBtn" type="button" title="圖片">＋</button>' +
            '<div class="wt-chat-picker-wrap"><button class="wt-chat-icon-btn" id="wtChatEmojiBtn" type="button" title="Emoji">😊</button><div id="wtChatEmojiPicker" class="wt-chat-picker hidden"></div></div>' +
            '<div class="wt-chat-picker-wrap"><button class="wt-chat-icon-btn" id="wtChatStickerBtn" type="button" title="貼圖">⭐</button><div id="wtChatStickerPicker" class="wt-chat-picker stickers hidden"></div></div>' +
            '<textarea id="wtChatInput" rows="1" maxlength="2000" placeholder="傳送訊息…" autocomplete="off"></textarea>' +
            '<button class="wt-chat-icon-btn" id="wtChatMicBtn" type="button" title="語音">🎙️</button>' +
            '<button class="wt-action-btn primary wt-chat-send-btn" id="wtChatSend" type="submit">送出</button>' +
          '</form>' +
        '</section>' +
      '</div>' +
    '</div>';
  document.body.appendChild(modal);

  $("wtChatClose").addEventListener("click",closeChat);
  $("wtChatBackBtn").addEventListener("click",function(){
    var card=document.querySelector("#wtChatCenter .wt-chat-modal-card");
    if(card) card.classList.add("wt-chat-show-sidebar");
  });
  $("wtChatAddFriend").addEventListener("click",function(){
    sendFriendRequest($("wtChatFriendCode").value).then(function(){
      $("wtChatFriendCode").value="";
      fetchFriends();
    }).catch(function(error){wt.toast(error&&error.message||"加好友失敗");});
  });
  $("wtChatFriendCode").addEventListener("input",function(event){
    event.target.value=String(event.target.value||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
  });
  $("wtChatFriendCode").addEventListener("keydown",function(event){
    if(event.key==="Enter"){event.preventDefault();$("wtChatAddFriend").click();}
  });
  $("wtChatFriendSearch").addEventListener("input",function(event){
    state.search=event.target.value||"";
    renderSidebar();
  });
  $("wtChatRequestsBtn").addEventListener("click",function(){ $("wtChatRequestsPanel")?.classList.toggle("hidden"); });
  $("wtChatRequestsClose").addEventListener("click",function(){ $("wtChatRequestsPanel")?.classList.add("hidden"); });
  $("wtChatSearchToggle").addEventListener("click",function(){ $("wtChatMessageSearchBar")?.classList.toggle("hidden"); if(!$("wtChatMessageSearchBar")?.classList.contains("hidden")) $("wtChatMessageSearch")?.focus(); });
  $("wtChatMessageSearch").addEventListener("input",function(event){ state.messageSearch=event.target.value||""; renderMessages(); });
  $("wtChatMessageSearchClear").addEventListener("click",function(){ state.messageSearch=""; $("wtChatMessageSearch").value=""; renderMessages(); });
  $("wtChatRemoveFriend").addEventListener("click",function(){ if(state.activeUid) removeFriendPlus(state.activeUid).catch(function(error){wt.toast(error&&error.message||"刪除好友失敗");}); });
  $("wtChatImageBtn").addEventListener("click",function(){ $("wtChatImageInput").click(); });
  $("wtChatImageInput").addEventListener("change",function(event){ void handleImageFiles(event.target.files); event.target.value=""; });
  $("wtChatEmojiBtn").addEventListener("click",function(){ showPicker("wtChatEmojiPicker"); hidePicker("wtChatStickerPicker"); });
  $("wtChatStickerBtn").addEventListener("click",function(){ showPicker("wtChatStickerPicker"); hidePicker("wtChatEmojiPicker"); });
  $("wtChatMicBtn").addEventListener("click",function(){ void toggleRecording(); });
  $("wtChatComposer").addEventListener("submit",function(event){
    event.preventDefault();
    sendText().catch(function(error){ wt.toast(error&&error.message||"訊息送出失敗"); });
  });
  $("wtChatInput").addEventListener("keydown",function(event){
    if(event.key==="Enter" && !event.shiftKey){
      event.preventDefault();
      $("wtChatComposer").requestSubmit();
      return;
    }
    clearTimeout(state.typingTimer);
    state.typingTimer=setTimeout(function(){setTyping(false);},1200);
    setTyping(true);
  });
  $("wtChatInput").addEventListener("paste",function(event){
    var files=Array.from(event.clipboardData && event.clipboardData.files || []).filter(function(file){return String(file.type||"").indexOf("image/")===0;});
    if(files.length){ event.preventDefault(); void handleImageFiles(files); }
  });
  $("wtChatInput").addEventListener("dragover",function(event){event.preventDefault();});
  $("wtChatMessages").addEventListener("dragover",function(event){event.preventDefault();});
  $("wtChatMessages").addEventListener("drop",function(event){
    event.preventDefault();
    var files=Array.from(event.dataTransfer && event.dataTransfer.files || []);
    if(files.length) void handleImageFiles(files);
  });
  $("wtChatComposer").addEventListener("click",function(event){
    var clearReply=event.target.closest("[data-chat-clear-reply]");
    var clearEdit=event.target.closest("[data-chat-clear-edit]");
    if(clearReply){ clearReplyEdit(); return; }
    if(clearEdit){ clearReplyEdit(); $("wtChatInput").value=""; return; }
  });
  state.built=true;
}

function closeChat() {
  stopActiveListeners();
  stopSummaryListeners();
  stopRequestListener();
  closeLightbox();
  var modal=$("wtChatCenter");
  if(modal) wt.closeModal("wtChatCenter");
  state.activeUid="";
  state.activeProfile=null;
  state.replyTo=null;
  state.editingId="";
  state.search="";
  state.messageSearch="";
}

async function openChat() {
  buildModal();
  if(!ensureLogin()) return;
  var modal=$("wtChatCenter");
  var card=modal && modal.querySelector(".wt-chat-modal-card");
  if (card) card.classList.toggle("wt-chat-show-sidebar",window.innerWidth <= 700 && !state.activeUid);
  wt.openModal("wtChatCenter");
  $("wtChatFriendCode").focus();
  try {
    await fetchFriends();
    listenRequests();
    renderRequests();
    renderChatBadge();
    renderChatHeader();
    renderMessages();
    if(state.activeUid && state.friends[state.activeUid]) await openConversation(state.activeUid);
  } catch(error) {
    wt.toast(error&&error.message||"聊天資料載入失敗");
  }
}

wt.openFriends = openChat;
wt.openChat = openChat;

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",function(){ buildModal(); },{once:true});
} else {
  buildModal();
}

})();