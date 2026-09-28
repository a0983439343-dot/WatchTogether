(() => {
  "use strict";

  const wt = window.WT_ENHANCEMENTS || {};
  const core = window.WT_CORE || {};
  const $ = id => document.getElementById(id);
  const db = wt.db || (window.firebase?.apps?.length ? firebase.database() : null);

  let activeRoom = "";
  let refs = {};
  let replies = {};
  let edits = {};
  let pins = {};
  let reactions = {};
  let observer = null;
  let lastRoomCheck = 0;

  const st = () => core.state || wt.state || {};
  const user = () => {
    const u = (wt.auth || (window.firebase?.apps?.length ? firebase.auth() : null))?.currentUser;
    return u || null;
  };
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => (
    {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]
  ));
  const safe = value => String(value || "").replace(/[.#$\[\]/]/g, "_").slice(0, 200);
  const toast = message => {
    try {
      if (typeof wt.toast === "function") return wt.toast(message);
      if (typeof window.toast === "function") return window.toast(message);
    } catch (_) {}
  };

  function roomId() {
    return String(st().roomId || "").trim().toUpperCase();
  }

  function currentUid() {
    return String(st().uid || user()?.uid || "");
  }

  function isMember() {
    const id = roomId(), uid = currentUid();
    return Boolean(id && uid && st().room?.id ? true : id && uid);
  }

  function canPin() {
    const uid = currentUid();
    if (!uid) return false;
    if (st().isOwner === true) return true;
    const role =
      st().roomRoles?.[uid]?.role ||
      st().roomRoleByUid?.[uid] ||
      "";
    if (role === "cohost") return true;
    try {
      const access = window.WT_ACCESS_CONTROL;
      if (access?.state?.ready && access.hasPermission("chat.moderate")) return true;
    } catch (_) {}
    return false;
  }

  function closeRefs() {
    Object.values(refs).forEach(ref => {
      try { ref?.off(); } catch (_) {}
    });
    refs = {};
    replies = {};
    edits = {};
    pins = {};
    reactions = {};
  }

  function roomRef(path) {
    if (!db || !activeRoom) return null;
    return db.ref(path + "/" + activeRoom);
  }

  function connect(room) {
    if (!db || !room || room === activeRoom) return;
    closeRefs();
    activeRoom = room;

    refs.replies = roomRef("roomChatReplies");
    refs.edits = roomRef("roomChatEdits");
    refs.pins = roomRef("roomChatPins");
    refs.reactions = roomRef("roomChatReactions");

    refs.replies?.on("value", snap => {
      replies = snap.val() || {};
      decorate();
    });
    refs.edits?.on("value", snap => {
      edits = snap.val() || {};
      decorate();
    });
    refs.pins?.on("value", snap => {
      pins = snap.val() || {};
      decorate();
    });
    refs.reactions?.on("value", snap => {
      reactions = snap.val() || {};
      decorate();
    });
  }

  function disconnectIfNeeded() {
    const id = roomId();
    if (id !== activeRoom) {
      closeRefs();
      activeRoom = "";
    }
  }

  function messageSnapshot(el) {
    const id = String(el.dataset.chatId || "");
    const p = el.querySelector("p");
    const name = el.querySelector(".wt-message-name")?.textContent?.trim() || "玩家";
    const body = p?.textContent?.trim() || el.querySelector(".wt-sticker")?.textContent?.trim() || "[媒體訊息]";
    const own = String(el.classList.contains("self"));
    return {id, name, text:body.slice(0,300), own:own === "true"};
  }

  function findReplyForMessage(messageId) {
    const list = Object.values(replies || {}).filter(x => String(x?.replyToId || "") === messageId);
    list.sort((a,b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
    return list[0] || null;
  }

  function reactionCounts(messageId) {
    const row = reactions?.[messageId] || {};
    const counts = {};
    Object.values(row).forEach(item => {
      const emoji = String(item?.emoji || "").slice(0,4);
      if (!emoji) return;
      counts[emoji] = (counts[emoji] || 0) + 1;
    });
    return counts;
  }

  function myReaction(messageId) {
    return String(reactions?.[messageId]?.[currentUid()]?.emoji || "");
  }

  async function sendSticker(emoji) {
    const s = st();
    const uid = currentUid();
    if (!db || !s.chatRef || !uid) return;
    const mute = s.roomMutes?.[uid];
    if (mute && (mute.permanent === true || Number(mute.until || 0) > Date.now())) {
      toast("你目前被房間禁言");
      return;
    }
    try {
      const access = window.WT_ACCESS_CONTROL;
      if (access) {
        await access.waitUntilReady(2500).catch(() => {});
        if (access.state?.ready && !access.hasPermission("chat.send")) {
          toast("你目前無法在聊天室發言");
          return;
        }
      }
      await s.chatRef.push({
        uid,
        name:String(s.memberName || "玩家").slice(0,30),
        type:"sticker",
        sticker:String(emoji || "😊").slice(0,4),
        createdAt:firebase.database.ServerValue.TIMESTAMP
      });
    } catch (error) {
      toast(error?.message || "貼圖送出失敗");
    }
  }

  async function sendRoomImage(file) {
    const s = st();
    const uid = currentUid();
    const room = roomId();
    if (!db || !s.chatRef || !uid || !room || !s.wasMemberInRoom) {
      toast("目前不在房間內");
      return;
    }
    if (!file || String(file.type || "").indexOf("image/") !== 0) {
      toast("請選擇圖片檔案");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      toast("圖片太大，單檔上限 8 MB");
      return;
    }

    const mute = s.roomMutes?.[uid];
    if (mute && (mute.permanent === true || Number(mute.until || 0) > Date.now())) {
      toast("你目前被房間禁言");
      return;
    }

    try {
      const access = window.WT_ACCESS_CONTROL;
      if (access) {
        await access.waitUntilReady(2500).catch(() => {});
        if (access.state?.ready && !access.hasPermission("chat.send")) {
          toast("你目前無法在聊天室發言");
          return;
        }
        if (access.state?.ready && !access.hasPermission("chat.media")) {
          toast("你目前無法傳送圖片");
          return;
        }
      }

      let blob = file;
      let contentType = String(file.type || "image/jpeg");
      let safeName = String(file.name || "image").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);

      if (contentType !== "image/gif") {
        blob = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("圖片讀取失敗"));
          reader.onload = () => {
            const image = new Image();
            image.onerror = () => reject(new Error("圖片格式無法讀取"));
            image.onload = () => {
              const scale = Math.min(1, 1600 / Math.max(image.width || 1, image.height || 1));
              const width = Math.max(1, Math.round((image.width || 1) * scale));
              const height = Math.max(1, Math.round((image.height || 1) * scale));
              const canvas = document.createElement("canvas");
              canvas.width = width;
              canvas.height = height;
              const ctx = canvas.getContext("2d");
              if (!ctx) {
                reject(new Error("圖片處理失敗"));
                return;
              }
              ctx.drawImage(image, 0, 0, width, height);
              canvas.toBlob(result => {
                if (!result) {
                  reject(new Error("圖片壓縮失敗"));
                  return;
                }
                resolve(result);
              }, "image/webp", 0.84);
            };
            image.src = String(reader.result || "");
          };
          reader.readAsDataURL(file);
        });
        contentType = "image/webp";
        safeName = safeName.replace(/.[^.]+$/, "") + ".webp";
      }

      if (blob.size > 8 * 1024 * 1024) {
        throw new Error("圖片壓縮後仍超過 8 MB");
      }

      if (!firebase.storage) {
        throw new Error("Firebase Storage 尚未載入");
      }

      const fileId =
        Date.now() + "_" +
        (window.crypto?.randomUUID
          ? window.crypto.randomUUID()
          : Math.random().toString(36).slice(2));

      const path =
        "chatRoomMedia/" + room + "/" + uid + "/" + fileId + ".webp";

      const storageRef = firebase.storage().ref(path);
      await storageRef.put(blob, {
        contentType,
        customMetadata: {
          ownerUid: uid,
          roomId: room
        }
      });

      const url = await storageRef.getDownloadURL();

      await s.chatRef.push({
        uid,
        name: String(s.memberName || "玩家").slice(0, 30),
        type: "image",
        mediaUrl: String(url).slice(0, 1000000),
        mediaPath: path.slice(0, 500),
        mediaName: safeName.slice(0, 100),
        mediaSize: Number(blob.size),
        createdAt: firebase.database.ServerValue.TIMESTAMP
      });

      toast("圖片已送出");
    } catch (error) {
      toast(error?.message || "圖片上傳失敗");
    }
  }

  function openRoomImage(url) {
    const safeUrl = String(url || "").trim();
    if (!safeUrl) return;

    document.getElementById("wtRoomImageLightbox")?.remove();

    const box = document.createElement("div");
    box.id = "wtRoomImageLightbox";
    box.className = "wt-room-image-lightbox";
    box.innerHTML =
      '<div class="wt-room-image-lightbox-backdrop"></div>' +
      '<button type="button" class="wt-room-image-lightbox-close" aria-label="關閉圖片">×</button>' +
      '<img src="' + esc(safeUrl) + '" alt="聊天室圖片預覽">';

    document.body.appendChild(box);

    const close = () => box.remove();
    box.querySelector(".wt-room-image-lightbox-backdrop")?.addEventListener("click", close);
    box.querySelector(".wt-room-image-lightbox-close")?.addEventListener("click", close);
  }

  function ensureImageToolbar() {
    const form = $("chatForm");
    if (!form || $("wtRoomChatImageBtn") || $("wtRoomChatImageInput")) return;

    const input = document.createElement("input");
    input.id = "wtRoomChatImageInput";
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.hidden = true;

    const button = document.createElement("button");
    button.id = "wtRoomChatImageBtn";
    button.type = "button";
    button.className = "tiny-btn";
    button.textContent = "🖼️ 圖片";
    button.title = "傳送房間圖片";

    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      input.click();
    });

    input.addEventListener("change", event => {
      const files = Array.from(event.target.files || []).filter(file =>
        String(file.type || "").indexOf("image/") === 0
      ).slice(0, 6);
      event.target.value = "";
      files.forEach(file => void sendRoomImage(file));
    });

    form.insertBefore(button, form.firstChild);
    form.appendChild(input);

    const onPaste = event => {
      const files = Array.from(event.clipboardData?.files || []).filter(file =>
        String(file.type || "").indexOf("image/") === 0
      );
      if (!files.length) return;
      event.preventDefault();
      files.slice(0, 6).forEach(file => void sendRoomImage(file));
    };

    const onDrop = event => {
      const files = Array.from(event.dataTransfer?.files || []).filter(file =>
        String(file.type || "").indexOf("image/") === 0
      );
      if (!files.length) return;
      event.preventDefault();
      event.stopPropagation();
      files.slice(0, 6).forEach(file => void sendRoomImage(file));
    };

    form.addEventListener("paste", onPaste);
    form.addEventListener("dragover", event => event.preventDefault());
    form.addEventListener("drop", onDrop);
  }

  function ensureStickerToolbar() {
    const tools = $("wtRoomChatTools");
    const form = $("chatForm");
    if ((!tools && !form) || $("wtRoomChatStickerBtn")) return;
    const host = tools || form;
    const button = document.createElement("button");
    button.id = "wtRoomChatStickerBtn";
    button.type = "button";
    button.className = "tiny-btn";
    button.textContent = "😊 貼圖";
    const menu = document.createElement("div");
    menu.id = "wtRoomChatStickerMenu";
    menu.className = "wt-room-chat-sticker-menu hidden";
    ["😊","😂","👍","❤️","🔥","🎉","😍","😎","🤔","🥳","😢","😮","👏","🙏","🍿","🎬"].forEach(emoji => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "wt-room-chat-sticker-item";
      item.textContent = emoji;
      item.title = "送出 " + emoji;
      item.addEventListener("click", () => {
        void sendSticker(emoji);
        menu.classList.add("hidden");
      });
      menu.appendChild(item);
    });
    button.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      menu.classList.toggle("hidden");
    });
    host.appendChild(button);
    host.appendChild(menu);
    document.addEventListener("click", e => {
      if (!host.contains(e.target)) menu.classList.add("hidden");
    });
  }

  async function writeReply(message) {
    if (!db || !activeRoom || !currentUid()) return;
    const text = String(prompt("回覆這則訊息：", "") || "").trim().slice(0,300);
    if (!text) return;

    const ref = refs.replies?.push();
    if (!ref) return;

    try {
      await ref.set({
        uid:currentUid(),
        name:String(st().memberName || message.name || "玩家").slice(0,30),
        replyToId:String(message.id).slice(0,120),
        replyToName:String(message.name || "玩家").slice(0,30),
        replyToText:String(message.text || "").slice(0,300),
        replyToType:"text",
        text,
        createdAt:firebase.database.ServerValue.TIMESTAMP
      });
      toast("已回覆訊息");
    } catch (error) {
      toast(error?.message || "回覆失敗");
    }
  }

  async function writeEdit(message) {
    if (!db || !activeRoom || !currentUid() || !message.id || !message.own) return;
    const next = String(prompt("編輯訊息：", message.text || "") || "").trim().slice(0,300);
    if (!next || next === message.text) return;

    try {
      await refs.edits?.child(safe(message.id)).set({
        uid:currentUid(),
        text:next,
        editedAt:firebase.database.ServerValue.TIMESTAMP
      });
      toast("訊息已編輯");
    } catch (error) {
      toast(error?.message || "編輯失敗");
    }
  }

  async function togglePin(message) {
    if (!canPin() || !message.id) return;
    const old = pins?.[message.id];
    const nextPinned = old?.pinned !== true;
    try {
      await refs.pins?.child(safe(message.id)).set({
        pinned:nextPinned,
        uid:currentUid(),
        updatedAt:firebase.database.ServerValue.TIMESTAMP
      });
      toast(nextPinned ? "已置頂訊息" : "已取消置頂");
    } catch (error) {
      toast(error?.message || "置頂失敗");
    }
  }

  async function toggleReaction(message, emoji) {
    const uid = currentUid();
    if (!uid || !message.id || !refs.reactions) return;
    const ref = refs.reactions.child(safe(message.id)).child(uid);
    const current = myReaction(message.id);
    try {
      if (current === emoji) {
        await ref.remove();
      } else {
        await ref.set({
          emoji:String(emoji).slice(0,4),
          updatedAt:firebase.database.ServerValue.TIMESTAMP
        });
      }
    } catch (error) {
      toast(error?.message || "反應更新失敗");
    }
  }

  function replyHtml(reply) {
    if (!reply) return "";
    return '<div class="wt-room-reply-preview"><span>↩ 回覆 ' + esc(reply.replyToName || "玩家") + '</span><small>' + esc(reply.replyToText || "") + '</small><strong>' + esc(reply.text || "") + '</strong></div>';
  }

  function decorateMessage(el) {
    const id = String(el.dataset.chatId || "");
    if (!id) return;

    el.querySelectorAll("[data-chat-pin]").forEach(node => node.remove());

    const oldReply = el.querySelector("[data-wt-room-reply-preview]");
    const reply = findReplyForMessage(id);
    if (oldReply) oldReply.remove();
    if (reply) {
      const holder = document.createElement("div");
      holder.dataset.wtRoomReplyPreview = "1";
      holder.innerHTML = replyHtml(reply);
      const body = el.querySelector("p, .wt-sticker, .wt-room-chat-image-btn, .wt-room-chat-audio");
      if (body) body.parentNode.insertBefore(holder.firstElementChild, body);
      else el.insertBefore(holder.firstElementChild, el.firstChild);
    }

    const currentEdit = edits?.[id];
    const text = el.querySelector("p");
    if (text && currentEdit?.text) {
      text.textContent = String(currentEdit.text).slice(0,300);
      text.dataset.wtRoomEditedText = "1";
    }
    el.querySelectorAll("[data-wt-room-edited]").forEach(node => node.remove());
    if (currentEdit?.text) {
      const edited = document.createElement("span");
      edited.className = "wt-room-chat-edited";
      edited.dataset.wtRoomEdited = "1";
      edited.textContent = "已編輯";
      const top = el.querySelector(".wt-message-top");
      top?.appendChild(edited);
    }

    el.querySelectorAll("[data-wt-room-rich-actions]").forEach(node => node.remove());

    const message = messageSnapshot(el);
    const actions = document.createElement("div");
    actions.className = "wt-room-chat-rich-actions";
    actions.dataset.wtRoomRichActions = "1";

    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.className = "wt-message-delete";
    replyBtn.textContent = "↩ 回覆";
    replyBtn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      void writeReply(message);
    });
    actions.appendChild(replyBtn);

    if (message.own && text) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "wt-message-delete";
      editBtn.textContent = "✎ 編輯";
      editBtn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        void writeEdit(message);
      });
      actions.appendChild(editBtn);
    }

    if (canPin()) {
      const pinBtn = document.createElement("button");
      pinBtn.type = "button";
      pinBtn.className = "wt-message-delete";
      pinBtn.textContent = pins?.[id]?.pinned === true ? "取消置頂" : "📌 置頂";
      pinBtn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        void togglePin(message);
      });
      actions.appendChild(pinBtn);
    }

    const counts = reactionCounts(id);
    ["👍","❤️","😂","🔥","🎉"].forEach(emoji => {
      const count = Number(counts[emoji] || 0);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wt-message-delete" + (myReaction(id) === emoji ? " active" : "");
      button.textContent = emoji + (count ? " " + count : "");
      button.title = "反應";
      button.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        void toggleReaction(message, emoji);
      });
      actions.appendChild(button);
    });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "wt-message-delete";
    copyBtn.textContent = "複製";
    copyBtn.addEventListener("click", async e => {
      e.preventDefault();
      e.stopPropagation();
      const value = currentEdit?.text || message.text || "";
      try {
        await navigator.clipboard.writeText(value);
        toast("已複製訊息");
      } catch (_) {
        toast("無法複製訊息");
      }
    });
    actions.appendChild(copyBtn);

    el.appendChild(actions);

    if (pins?.[id]?.pinned === true) {
      el.classList.add("wt-room-message-pinned");
      if (!el.querySelector("[data-wt-room-pin-badge]")) {
        const badge = document.createElement("span");
        badge.className = "wt-room-chat-pin-badge";
        badge.dataset.wtRoomPinBadge = "1";
        badge.textContent = "📌 已置頂";
        el.insertBefore(badge, el.firstChild);
      }
    } else {
      el.classList.remove("wt-room-message-pinned");
      el.querySelector("[data-wt-room-pin-badge]")?.remove();
    }
  }

  function decorate() {
    const box = $("chatMessages");
    if (!box) return;
    box.querySelectorAll(".wt-message[data-chat-id]").forEach(decorateMessage);
    box.querySelectorAll("[data-chat-image]").forEach(node => {
      if (node.dataset.wtRoomImageBound === "1") return;
      node.dataset.wtRoomImageBound = "1";
      node.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        openRoomImage(node.dataset.chatImage || node.querySelector("img")?.src || "");
      });
    });
  }

  function interceptLegacyPin() {
    const box = $("chatMessages");
    if (!box || box.dataset.wtRoomRichPinIntercept) return;
    box.dataset.wtRoomRichPinIntercept = "1";
    box.addEventListener("click", event => {
      const target = event.target?.closest?.("[data-chat-pin]");
      if (!target) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function installObserver() {
    const box = $("chatMessages");
    if (!box || observer) return;
    observer = new MutationObserver(() => decorate());
    observer.observe(box,{childList:true,subtree:true});
    interceptLegacyPin();
    decorate();
  }

  function tick() {
    const id = roomId();
    if (id !== activeRoom) connect(id);
    disconnectIfNeeded();
    const now = Date.now();
    if (now - lastRoomCheck < 900) return;
    lastRoomCheck = now;
    installObserver();
    ensureStickerToolbar();
    ensureImageToolbar();
    if (!id) {
      closeRefs();
      observer?.disconnect();
      observer = null;
    }
  }

  function injectCss() {
    if ($("wtRoomRichChatStyle")) return;
    const style = document.createElement("style");
    style.id = "wtRoomRichChatStyle";
    style.textContent = [
      ".wt-room-chat-rich-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;opacity:.88}",
      ".wt-room-chat-rich-actions .wt-message-delete{font-size:11px;padding:3px 7px}",
      ".wt-room-reply-preview{display:flex;flex-direction:column;gap:2px;margin:4px 0 7px;padding:7px 9px;border-left:3px solid currentColor;border-radius:6px;background:rgba(148,163,184,.08);font-size:11px}",
      ".wt-room-reply-preview small{opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}",
      ".wt-room-reply-preview strong{font-size:12px;font-weight:600;line-height:1.45;white-space:pre-wrap;word-break:break-word}",
      ".wt-room-chat-edited{font-size:10px;opacity:.55;margin-left:6px}",
      ".wt-room-message-pinned{outline:1px solid rgba(250,204,21,.25)}",
      ".wt-room-chat-rich-actions .active{box-shadow:0 0 0 1px currentColor inset}",
      ".wt-room-chat-sticker-menu{position:absolute;z-index:1000;margin-top:6px;padding:7px;display:grid;grid-template-columns:repeat(8,1fr);gap:4px;background:#0f172a;border:1px solid rgba(148,163,184,.18);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.3)}",
      ".wt-room-chat-sticker-menu.hidden{display:none!important}",
      ".wt-room-chat-sticker-item{border:0;background:transparent;border-radius:8px;padding:5px;font-size:19px;cursor:pointer}.wt-room-chat-sticker-item:hover{background:rgba(148,163,184,.12)}",
      ".wt-room-image-lightbox{position:fixed;inset:0;z-index:1900;display:grid;place-items:center;padding:20px}",
      ".wt-room-image-lightbox-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.82);backdrop-filter:blur(10px)}",
      ".wt-room-image-lightbox img{position:relative;z-index:1;max-width:min(94vw,1200px);max-height:92dvh;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.5)}",
      ".wt-room-image-lightbox-close{position:absolute;right:16px;top:16px;z-index:2;width:42px;height:42px;border:1px solid rgba(255,255,255,.16);border-radius:50%;background:rgba(0,0,0,.5);color:#fff;font-size:24px}"
    ].join("");
    document.head.appendChild(style);
  }

  function init() {
    if (document.documentElement.dataset.wtRoomRichChatInit) return;
    document.documentElement.dataset.wtRoomRichChatInit = "1";
    injectCss();
    setInterval(tick,1000);
    tick();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded",init,{once:true});
  } else {
    init();
  }

  window.WT_ROOM_CHAT_RICH = {
    connect,
    decorate,
    writeReply,
    writeEdit,
    togglePin,
    toggleReaction
  };
})();