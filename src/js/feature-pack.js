(() => {
  "use strict";

  const wt = window.WT_ENHANCEMENTS || {};
  const core = window.WT_CORE || null;
  const $ = id => document.getElementById(id);
  const db = wt.db || (window.firebase && firebase.apps.length ? firebase.database() : null);
  const auth = wt.auth || (window.firebase && firebase.apps.length ? firebase.auth() : null);

  const PREFS_KEY = "wt_preferences_v1";
  const HISTORY_KEY = "wt_watch_history_v1";
  const FAV_KEY = "wt_favorites_v1";
  const ROOMS_KEY = "wt_recent_rooms_v2";
  const STATS_KEY = "wt_stats_v1";
  let installPrompt = null;
  let currentHealth = "idle";
  let lastRecoveryAt = 0;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => (
      {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]
    ));
  }

  function toast(message) {
    try {
      if (typeof wt.toast === "function") return wt.toast(message);
      if (typeof window.toast === "function") return window.toast(message);
    } catch (_) {}
  }

  function roomId() {
    return String(core?.state?.roomId || "").trim().toUpperCase();
  }

  function user() {
    return auth?.currentUser || null;
  }

  function inRoom() {
    const view = $("roomView");
    return Boolean(view && !view.classList.contains("hidden"));
  }

  function localJson(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function getStats() {
    const base = {
      watchSeconds: 0,
      videosStarted: 0,
      roomsJoined: 0,
      messagesSent: 0,
      lastAt: 0,
      platformStarts: {}
    };
    const raw = localJson(STATS_KEY, {});
    if (raw && typeof raw === "object") Object.assign(base, raw);
    if (!base.platformStarts || typeof base.platformStarts !== "object") base.platformStarts = {};
    return base;
  }

  function formatDuration(seconds) {
    let n = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(n / 3600);
    n %= 3600;
    const m = Math.floor(n / 60);
    const s = n % 60;
    if (h) return h + " 小時 " + m + " 分";
    if (m) return m + " 分 " + s + " 秒";
    return s + " 秒";
  }

  function formatDate(value) {
    const d = new Date(Number(value) || 0);
    if (!Number.isFinite(d.getTime()) || d.getTime() <= 0) return "—";
    return d.toLocaleString("zh-TW");
  }

  function ensureCss() {
    if ($("wtFeaturePackStyle")) return;
    const style = document.createElement("style");
    style.id = "wtFeaturePackStyle";
    style.textContent = [
      ".wt-pack-health{display:inline-flex;align-items:center;gap:6px;margin-left:8px;padding:4px 8px;border-radius:999px;border:1px solid rgba(148,163,184,.18);font-size:11px;color:#94a3b8}",
      ".wt-pack-health.good{color:#86efac}.wt-pack-health.warn{color:#fde68a}.wt-pack-health.bad{color:#fca5a5}",
      ".wt-chat-mention{font-weight:800;color:#93c5fd;background:rgba(59,130,246,.12);border-radius:5px;padding:1px 3px}",
      ".wt-room-chat-mention{font-weight:800;color:#93c5fd;background:rgba(59,130,246,.12);border-radius:5px;padding:1px 3px}",
      ".wt-room-chat-image-btn{display:block;border:0;background:transparent;padding:0;max-width:min(360px,75vw);cursor:pointer}",
      ".wt-room-chat-image-btn img{display:block;width:auto;max-width:100%;max-height:320px;border-radius:12px;object-fit:contain}",
      ".wt-room-chat-audio{width:min(360px,75vw);max-width:100%}",
      ".wt-room-chat-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}",
      ".wt-room-chat-pin-badge{display:inline-flex;margin:5px 0;padding:3px 7px;border-radius:999px;background:rgba(245,158,11,.13);color:#fcd34d;font-size:10px}",

      ".wt-chat-pinned-bar{display:grid;gap:6px;padding:8px 10px;margin:0 0 8px;border:1px solid rgba(148,163,184,.16);border-radius:12px;background:rgba(15,23,42,.34)}",
      ".wt-chat-pinned-list{display:flex;gap:6px;overflow:auto}.wt-chat-pinned-item{flex:0 0 auto;max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid rgba(148,163,184,.14);background:rgba(59,130,246,.08);color:inherit;border-radius:999px;padding:6px 9px;cursor:pointer}",
      ".queue-item[draggable='true']{cursor:grab}.queue-item.queue-dragging{opacity:.55}.queue-item.queue-drag-over{outline:2px dashed rgba(96,165,250,.7);outline-offset:2px}",
      ".wt-explore-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wt-explore-grid .full{grid-column:1/-1}",
      ".wt-explore-result{padding:12px;border:1px solid rgba(148,163,184,.14);border-radius:14px;background:rgba(15,23,42,.32);display:flex;align-items:center;justify-content:space-between;gap:12px}",
      ".wt-explore-result strong{display:block}.wt-explore-result .small{word-break:break-all}",
      ".wt-explore-stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.wt-explore-stat{padding:12px;border:1px solid rgba(148,163,184,.14);border-radius:14px;background:rgba(15,23,42,.32)}.wt-explore-stat strong{display:block;font-size:18px;margin-top:5px}",
      ".wt-explore-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:14px}",
      "@media(max-width:760px){.wt-explore-grid,.wt-explore-stat-grid{grid-template-columns:1fr}.wt-explore-grid .full{grid-column:auto}}"
    ].join("");
    document.head.appendChild(style);
  }

  function makeModal(id, title, html) {
    let modal = $(id);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = id;
      modal.className = "modal hidden";
      modal.setAttribute("aria-hidden", "true");
      modal.innerHTML =
        '<div class="modal-card wt-feature-card">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px">' +
            '<div class="panel-title">' + escapeHtml(title) + '</div>' +
            '<button id="' + id + 'Close" class="tiny-btn" type="button">關閉</button>' +
          '</div>' +
          '<div id="' + id + 'Body"></div>' +
        '</div>';
      document.body.appendChild(modal);
      $(id + "Close").addEventListener("click", () => closeModal(id));
      modal.addEventListener("click", event => { if (event.target === modal) closeModal(id); });
    }
    $(id + "Body").innerHTML = html;
    modal.hidden = false;
    modal.style.removeProperty("display");
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("wt-modal-open");
    return $(id + "Body");
  }

  function closeModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.add("hidden");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.style.setProperty("display", "none", "important");
    if (!document.querySelector(".modal:not(.hidden),.wt-modal:not(.hidden)")) {
      document.body.classList.remove("wt-modal-open");
    }
  }

  async function searchExplore(query) {
    const q = String(query || "").trim();
    const results = [];
    if (!q) return results;
    const upper = q.toUpperCase();

    if (/^[A-Z0-9]{6}$/.test(upper) && db) {
      const [codeSnap, roomSnap] = await Promise.all([
        db.ref("profileCodes/" + upper).once("value").catch(() => null),
        db.ref("roomMeta/" + upper).once("value").catch(() => null)
      ]);

      const targetUid = codeSnap?.val ? String(codeSnap.val() || "") : "";
      if (targetUid) {
        const profile = (await db.ref("profiles/" + targetUid).once("value").catch(() => null))?.val?.() || {};
        results.push({
          kind:"user",
          title:String(profile.displayName || "使用者"),
          detail:upper + " · " + targetUid,
          uid:targetUid
        });
      }

      const room = roomSnap?.val?.() || null;
      if (room && (room.name || room.owner)) {
        results.push({
          kind:"room",
          title:String(room.name || "一起看"),
          detail:"房間 " + upper + " · " + (room.settings?.visibility === "private" ? "私人" : "公開"),
          roomId:upper
        });
      }
    }

    if (db && auth?.currentUser && !auth.currentUser.isAnonymous) {
      try {
        const friendSnapshot = await db.ref("friendships/" + auth.currentUser.uid).once("value");
        const friendIds = Object.keys(friendSnapshot.val() || {}).filter(uid => uid && uid !== auth.currentUser.uid);
        const friendRows = await Promise.all(friendIds.map(async uid => {
          const profile = (await db.ref("profiles/" + uid).once("value").catch(() => null))?.val?.() || {};
          return [uid, profile];
        }));
        friendRows.forEach(([uid, profile]) => {
          const name = String(profile?.displayName || "");
          const code = String(profile?.publicCode || "").toUpperCase();
          if (
            name.toLowerCase().includes(q.toLowerCase()) ||
            code.includes(upper)
          ) {
            results.push({
              kind:"friend",
              title:name || "好友",
              detail:(code || "沒有公開 ID") + " · " + uid,
              uid
            });
          }
        });
      } catch (_) {}
    }

    const dedupe = new Map();
    results.forEach(item => dedupe.set(item.kind + ":" + (item.uid || item.roomId || item.detail), item));
    return Array.from(dedupe.values()).slice(0,20);
  }

  function openExplore() {
    if (!inRoom()) {
      toast("進入觀看房間後才能使用探索搜尋");
      return;
    }

    const stats = getStats();
    const history = localJson(HISTORY_KEY, []);
    const favorites = localJson(FAV_KEY, {});
    const rooms = localJson(ROOMS_KEY, []);
    const body = makeModal("wtExploreModal","探索與資料中心",
      '<div class="wt-explore-grid">' +
        '<label class="full">搜尋好友 ID、好友名稱或 6 碼房間碼<div style="display:flex;gap:8px"><input id="wtExploreInput" class="search" maxlength="80" placeholder="例如 A1B2C3 或好友名稱"><button id="wtExploreSearch" class="primary-btn" type="button">搜尋</button></div></label>' +
      '</div>' +
      '<div id="wtExploreResults" style="display:grid;gap:8px;margin-top:14px"></div>' +
      '<div class="panel-title" style="margin-top:20px">使用統計</div>' +
      '<div class="wt-explore-stat-grid">' +
        '<div class="wt-explore-stat"><span class="small muted">觀看時間</span><strong>' + escapeHtml(formatDuration(stats.watchSeconds)) + '</strong></div>' +
        '<div class="wt-explore-stat"><span class="small muted">播放影片</span><strong>' + escapeHtml(stats.videosStarted) + '</strong></div>' +
        '<div class="wt-explore-stat"><span class="small muted">加入房間</span><strong>' + escapeHtml(stats.roomsJoined) + '</strong></div>' +
        '<div class="wt-explore-stat"><span class="small muted">收藏</span><strong>' + escapeHtml(Object.keys(favorites || {}).length) + '</strong></div>' +
      '</div>' +
      '<div class="small muted" style="margin-top:10px">最後活動：' + escapeHtml(formatDate(stats.lastAt)) + ' · 最近觀看 ' + escapeHtml(history.length) + ' 筆 · 最近房間 ' + escapeHtml(rooms.length) + ' 筆</div>' +
      '<div class="wt-explore-actions">' +
        '<button id="wtExportData" class="secondary-btn" type="button">匯出我的資料</button>' +
        '<button id="wtClearLocalData" class="tiny-btn danger" type="button">清除本機活動資料</button>' +
        (installPrompt ? '<button id="wtInstallApp" class="primary-btn" type="button">安裝 WatchTogether</button>' : '') +
      '</div>' +
      '<div class="small muted" style="margin-top:10px">匯出內容只來自目前帳號可讀取的 Firebase 資料與本機儲存資料，不包含其他使用者的私訊內容。</div>'
    );

    const renderResults = list => {
      const box = $("wtExploreResults");
      if (!box) return;
      if (!list.length) {
        box.innerHTML = '<div class="muted" style="padding:12px 0">沒有找到符合的資料。6 碼可搜尋使用者 ID 或房間碼；名稱搜尋會使用你目前好友清單。</div>';
        return;
      }
      box.innerHTML = list.map(item => {
        if (item.kind === "room") {
          return '<div class="wt-explore-result"><div><strong>🏠 ' + escapeHtml(item.title) + '</strong><span class="small muted">' + escapeHtml(item.detail) + '</span></div><button class="tiny-btn primary" data-explore-room="' + escapeHtml(item.roomId) + '" type="button">加入</button></div>';
        }
        if (item.kind === "user") {
          return '<div class="wt-explore-result"><div><strong>👤 ' + escapeHtml(item.title) + '</strong><span class="small muted">' + escapeHtml(item.detail) + '</span></div><button class="tiny-btn" data-explore-copy="' + escapeHtml(item.detail.split(" · ")[0]) + '" type="button">複製 ID</button></div>';
        }
        return '<div class="wt-explore-result"><div><strong>👥 ' + escapeHtml(item.title) + '</strong><span class="small muted">' + escapeHtml(item.detail) + '</span></div><button class="tiny-btn" data-explore-friend="' + escapeHtml(item.uid) + '" type="button">開啟聊天</button></div>';
      }).join("");

      box.querySelectorAll("[data-explore-room]").forEach(button => {
        button.addEventListener("click", () => { location.href = location.pathname + "?room=" + encodeURIComponent(button.dataset.exploreRoom); });
      });
      box.querySelectorAll("[data-explore-copy]").forEach(button => {
        button.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(button.dataset.exploreCopy); toast("已複製"); } catch (_) { toast(button.dataset.exploreCopy); }
        });
      });
      box.querySelectorAll("[data-explore-friend]").forEach(button => {
        button.addEventListener("click", () => {
          closeModal("wtExploreModal");
          if (typeof wt.openFriends === "function") wt.openFriends();
        });
      });
    };

    const input = $("wtExploreInput");
    const doSearch = async () => {
      const box = $("wtExploreResults");
      if (box) box.innerHTML = '<div class="muted">搜尋中…</div>';
      try { renderResults(await searchExplore(input?.value || "")); }
      catch (error) { if (box) box.innerHTML = '<div class="error-text">' + escapeHtml(error?.message || "搜尋失敗") + '</div>'; }
    };
    $("wtExploreSearch")?.addEventListener("click", doSearch);
    input?.addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); void doSearch(); } });
    $("wtExportData")?.addEventListener("click", exportData);
    $("wtClearLocalData")?.addEventListener("click", () => {
      if (!window.confirm("確定清除本機觀看紀錄、收藏、最近房間、偏好與通知嗎？Firebase 帳號資料不會被刪除。")) return;      [HISTORY_KEY,"wt_watch_history_v2",FAV_KEY,ROOMS_KEY,STATS_KEY,PREFS_KEY,"wt_notifications_v1","wt_notifications_v2"].forEach(key => localStorage.removeItem(key));
      toast("已清除本機活動資料");
      closeModal("wtExploreModal");
    });
    $("wtInstallApp")?.addEventListener("click", installApp);
    input?.focus();
  }

  async function exportData() {
    const u = user();
    const payload = {
      exportedAt:new Date().toISOString(),
      appBuild:String(window.__WATCHTOGETHER_BUILD__ || ""),
      account:u ? {uid:u.uid,isAnonymous:Boolean(u.isAnonymous),email:String(u.email || ""),displayName:String(u.displayName || "")} : null,
      profile:wt.state?.profile || null,
      local:{
        preferences:localJson(PREFS_KEY,{}),
        recentRooms:localJson(ROOMS_KEY,[]),
        history:localJson(HISTORY_KEY,[]),
        favorites:localJson(FAV_KEY,{}),
        stats:getStats()
      }
    };

    if (db && u && !u.isAnonymous) {
      const uid = u.uid;
      payload.firebase = {
        profile:(await db.ref("profiles/"+uid).once("value").catch(()=>null))?.val?.() || null,
        friendships:(await db.ref("friendships/"+uid).once("value").catch(()=>null))?.val?.() || {},
        friendRequests:(await db.ref("friendRequests/"+uid).once("value").catch(()=>null))?.val?.() || {}
      };
    }

    const blob = new Blob([JSON.stringify(payload,null,2)],{type:"application/json;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "watchtogether-data-" + new Date().toISOString().replace(/[:.]/g,"-") + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    toast("資料已匯出");
  }

  function setHealth(kind, textValue) {
    currentHealth = kind;
    const wrap = $("playerWrap");
    if (!wrap) return;
    let badge = $("wtPlayerHealth");
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "wtPlayerHealth";
      badge.className = "wt-pack-health";
      wrap.insertBefore(badge, wrap.firstChild);
    }
    badge.className = "wt-pack-health " + (kind || "");
    badge.textContent = "播放狀態： " + textValue;
  }

  async function recoverNativePlayer(reason) {
    const s = core?.state;
    if (!s || s.playerType !== "youtube" || !s.currentVideoId) return false;
    const now = Date.now();
    if (now - lastRecoveryAt < 8000) return false;
    lastRecoveryAt = now;

    try {
      if (typeof core.refreshYoutubeStreamIfNeeded === "function") {
        await core.refreshYoutubeStreamIfNeeded();
        setHealth("warn","正在重新載入串流");
        return true;
      }
      const video = $("directVideo");
      if (video?.src) {
        const current = Number(video.currentTime || 0);
        video.load();
        try { video.currentTime = current; } catch (_) {}
        setHealth("warn","正在重新載入串流");
        return true;
      }
    } catch (error) {
      console.warn("[WatchTogether] player recovery failed:", reason, error);
      setHealth("bad","重新載入失敗");
    }
    return false;
  }

  function installPlayerHealth() {
    const video = $("directVideo");
    if (!video || video.dataset.wtHealthBound) return;
    video.dataset.wtHealthBound = "1";

    video.addEventListener("loadstart",() => setHealth("","載入中"));
    video.addEventListener("loadedmetadata",() => setHealth("good","已載入"));
    video.addEventListener("playing",() => setHealth("good","播放中"));
    video.addEventListener("pause",() => {
      const s = core?.state;
      if (s?.playbackLastPlayerState === "ended") setHealth("","已結束");
      else setHealth("","已暫停");
    });
    video.addEventListener("waiting",() => setHealth("warn","等待資料"));
    video.addEventListener("stalled",() => { setHealth("warn","串流停滯"); void recoverNativePlayer("stalled"); });
    video.addEventListener("error",() => {
      setHealth("bad","串流錯誤");
      void recoverNativePlayer("error");
    });
    video.addEventListener("abort",() => setHealth("warn","串流中止"));
    setHealth("","待命");
  }

  function roomStickerList() {
    return Array.isArray(wt.STICKERS) && wt.STICKERS.length
      ? wt.STICKERS
      : ["😀","😂","❤️","🔥","👏","🎉","🍿","🎬","👍","✨"];
  }

  async function sendRoomSticker(sticker) {
    const s = core?.state;
    if (!s?.roomId || !s?.chatRef || !s?.uid || s.leavingRoom) {
      toast("請先進入房間");
      return;
    }
    const value = String(sticker || "😀").slice(0,4);
    try {
      const access = window.WT_ACCESS_CONTROL;
      if (access) {
        await access.waitUntilReady?.(2500);
        if (access.state?.ready && !access.hasPermission("chat.send")) {
          throw new Error("你目前無法在聊天室發言");
        }
      }
      await s.chatRef.push({
        uid:s.uid,
        name:String(s.memberName || wt.currentName?.() || "玩家").slice(0,30),
        type:"sticker",
        sticker:value,
        createdAt:firebase.database.ServerValue.TIMESTAMP
      });
      document.querySelectorAll(".wt-room-sticker-picker").forEach(el => el.remove());
    } catch (error) {
      toast(error?.message || "貼圖送出失敗");
    }
  }

  async function uploadRoomImage(file) {
    const s = core?.state;
    if (!s?.roomId || !s?.uid || !s?.chatRef) throw new Error("請先進入房間");
    if (!file || String(file.type || "").indexOf("image/") !== 0) throw new Error("請選擇圖片");
    if (Number(file.size || 0) > 8 * 1024 * 1024) throw new Error("圖片太大，單檔上限 8 MB");

    const access = window.WT_ACCESS_CONTROL;
    if (access) {
      await access.waitUntilReady?.(2500);
      if (access.state?.ready && !access.hasPermission("chat.media")) {
        throw new Error("你目前無法傳送圖片");
      }
    }
    if (s.databaseConnected !== true) throw new Error("目前正在重新連線，請稍後再試");

    let blob = file;
    let type = String(file.type || "image/*");
    let name = String(file.name || "chat-image").replace(/[^a-zA-Z0-9._-]/g,"_").slice(0,80);

    if (type !== "image/gif") {
      blob = await new Promise((resolve,reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("圖片讀取失敗"));
        reader.onload = () => {
          const image = new Image();
          image.onerror = () => reject(new Error("圖片格式無法讀取"));
          image.onload = () => {
            const scale = Math.min(1,1600 / Math.max(image.width,image.height));
            const width = Math.max(1,Math.round(image.width * scale));
            const height = Math.max(1,Math.round(image.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("圖片處理失敗"));
              return;
            }
            ctx.drawImage(image,0,0,width,height);
            canvas.toBlob(result => {
              if (!result) {
                reject(new Error("圖片壓縮失敗"));
                return;
              }
              resolve(result);
            },"image/webp",0.84);
          };
          image.src = String(reader.result || "");
        };
        reader.readAsDataURL(file);
      });
      type = "image/webp";
      name = name.replace(/.[^.]+$/,"") + ".webp";
    }

    if (Number(blob.size || 0) > 8 * 1024 * 1024) throw new Error("圖片處理後仍過大");

    if (!firebase.storage) throw new Error("Firebase Storage 尚未載入");
    const fileId = Date.now() + "_" + (window.crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2));
    const path = "chatRoomMedia/" + s.roomId + "/" + s.uid + "/" + fileId + (type === "image/gif" ? ".gif" : ".webp");
    const ref = firebase.storage().ref(path);
    await ref.put(blob,{
      contentType:type,
      customMetadata:{
        roomId:String(s.roomId),
        ownerUid:String(s.uid),
        name:name
      }
    });
    const url = await ref.getDownloadURL();

    await s.chatRef.push({
      uid:s.uid,
      name:String(s.memberName || wt.currentName?.() || "玩家").slice(0,30),
      type:"image",
      mediaUrl:url,
      mediaPath:path,
      mediaName:name,
      mediaSize:Number(blob.size || 0),
      createdAt:firebase.database.ServerValue.TIMESTAMP
    });
    toast("圖片已送出");
  }

  async function handleRoomImagePick(event) {
    const files = Array.from(event?.target?.files || []).slice(0,4);
    event.target.value = "";
    if (!files.length) return;
    for (const file of files) {
      try {
        await uploadRoomImage(file);
      } catch (error) {
        toast(error?.message || "圖片送出失敗");
        break;
      }
    }
  }

  function ensureRoomChatExtras() {
    if (!inRoom()) return;

    const form = $("chatForm");
    const input = $("chatInput");
    if (!form || !input || $("wtRoomImageBtn")) return;

    const mediaInput = document.createElement("input");
    mediaInput.type = "file";
    mediaInput.accept = "image/*";
    mediaInput.multiple = true;
    mediaInput.id = "wtRoomImageInput";
    mediaInput.hidden = true;
    mediaInput.addEventListener("change", handleRoomImagePick);

    const imageWrap = document.createElement("span");
    imageWrap.style.cssText = "display:inline-flex;align-items:center";
    const imageButton = document.createElement("button");
    imageButton.id = "wtRoomImageBtn";
    imageButton.type = "button";
    imageButton.className = "tiny-btn";
    imageButton.textContent = "🖼️";
    imageButton.title = "傳送圖片";
    imageButton.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      mediaInput.click();
    });
    imageWrap.appendChild(imageButton);
    imageWrap.appendChild(mediaInput);
    form.insertBefore(imageWrap, input);

    if (!form.dataset.wtRoomImagePasteDrop) {
      form.dataset.wtRoomImagePasteDrop = "1";

      form.addEventListener("paste", event => {
        if (!inRoom()) return;
        const files = Array.from(event.clipboardData?.files || [])
          .filter(file => String(file.type || "").indexOf("image/") === 0)
          .slice(0, 4);
        if (!files.length) return;
        event.preventDefault();
        files.forEach(file => void uploadRoomImage(file));
      });

      form.addEventListener("dragover", event => {
        if (!inRoom()) return;
        if (Array.from(event.dataTransfer?.types || []).includes("Files")) {
          event.preventDefault();
        }
      });

      form.addEventListener("drop", event => {
        if (!inRoom()) return;
        const files = Array.from(event.dataTransfer?.files || [])
          .filter(file => String(file.type || "").indexOf("image/") === 0)
          .slice(0, 4);
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        files.forEach(file => void uploadRoomImage(file));
      });
    }

    const box = $("chatMessages");
    if (box && !box.dataset.wtRoomImagePreview) {
      box.dataset.wtRoomImagePreview = "1";
      box.addEventListener("click", event => {
        const target = event.target?.closest?.("[data-chat-image]");
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();

        const url = String(target.dataset.chatImage || target.querySelector("img")?.src || "").trim();
        if (!url) return;

        document.getElementById("wtRoomImageLightbox")?.remove();

        const overlay = document.createElement("div");
        overlay.id = "wtRoomImageLightbox";
        Object.assign(overlay.style, {
          position:"fixed",
          inset:"0",
          zIndex:"1900",
          display:"grid",
          placeItems:"center",
          padding:"20px",
          background:"rgba(0,0,0,.82)"
        });

        const image = document.createElement("img");
        image.src = url;
        image.alt = "聊天室圖片預覽";
        Object.assign(image.style, {
          position:"relative",
          maxWidth:"94vw",
          maxHeight:"92dvh",
          objectFit:"contain",
          borderRadius:"14px",
          boxShadow:"0 24px 80px rgba(0,0,0,.5)"
        });

        const close = document.createElement("button");
        close.type = "button";
        close.textContent = "×";
        close.setAttribute("aria-label","關閉圖片預覽");
        Object.assign(close.style, {
          position:"absolute",
          top:"16px",
          right:"16px",
          zIndex:"2",
          width:"42px",
          height:"42px",
          border:"1px solid rgba(255,255,255,.18)",
          borderRadius:"50%",
          background:"rgba(0,0,0,.55)",
          color:"#fff",
          fontSize:"24px",
          cursor:"pointer"
        });

        const closeOverlay = () => overlay.remove();
        overlay.addEventListener("click", event2 => {
          if (event2.target === overlay) closeOverlay();
        });
        close.addEventListener("click", closeOverlay);

        overlay.appendChild(image);
        overlay.appendChild(close);
        document.body.appendChild(overlay);
      });
    }
  }

  function ensureRoomToolsButton() {
    if (!inRoom()) return;
    const anchor = $("copyRoomBtn");
    if (!anchor || $("wtExploreBtn")) return;
    const button = document.createElement("button");
    button.id = "wtExploreBtn";
    button.className = "tiny-btn";
    button.type = "button";
    button.textContent = "🔎 探索";
    button.title = "探索好友、房間與資料";
    button.addEventListener("click",openExplore);
    anchor.insertAdjacentElement("afterend",button);
  }

  function ensureShortcutsNotice() {
    if ($("wtShortcutHint") || !inRoom()) return;
    const toolbar = document.querySelector(".room-toolbar");
    if (!toolbar) return;
    const hint = document.createElement("span");
    hint.id = "wtShortcutHint";
    hint.className = "small muted";
    hint.textContent = "快捷鍵：Ctrl+K 探索 · 空白鍵播放/暫停 · / 搜尋影片";
    hint.style.cssText = "display:block;margin-top:6px;font-size:11px";
    toolbar.appendChild(hint);
  }

  function installShortcuts() {
    if (document.documentElement.dataset.wtShortcuts) return;
    document.documentElement.dataset.wtShortcuts = "1";
    document.addEventListener("keydown", event => {
      const target = event.target;
      const typing = target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      );

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (inRoom()) {
          event.preventDefault();
          openExplore();
        }
        return;
      }

      if (!inRoom() || typing || event.altKey || event.ctrlKey || event.metaKey) return;

      if (event.key === " " && core?.state?.playerReady && !event.repeat) {
        event.preventDefault();
        $("playPauseBtn")?.click();
        return;
      }

      if (event.key === "/" && $("sourceModal")?.classList.contains("hidden")) {
        event.preventDefault();
        $("changeSourceBtn")?.click();
        setTimeout(() => $("modalVideoSearchInput")?.focus(),50);
      }
    });
  }

  async function installApp() {
    if (!installPrompt) {
      toast("瀏覽器目前沒有提供安裝選項");
      return;
    }
    installPrompt.prompt();
    const choice = await installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") toast("WatchTogether 已加入裝置");
    installPrompt = null;
  }

  function installPwaHook() {
    window.addEventListener("beforeinstallprompt",event => {
      event.preventDefault();
      installPrompt = event;
    });
  }

  function track() {
    const s = core?.state;
    if (!s) return;
    const stats = getStats();
    const key = String(s.room?.sourceType || "") + ":" + String(s.currentVideoId || "");
    if (!key || key === ":" || key === track.lastVideo) return;
    const platform = String(s.room?.sourceType || "youtube");
    stats.platformStarts[platform] = Number(stats.platformStarts[platform] || 0) + 1;
    stats.lastAt = Date.now();
    track.lastVideo = key;
    localStorage.setItem(STATS_KEY,JSON.stringify(stats));
  }

  function init() {
    ensureCss();
    installPwaHook();
    installShortcuts();
    setInterval(() => {
      ensureRoomToolsButton();
      ensureShortcutsNotice();
      ensureRoomChatExtras();
      installPlayerHealth();
    },1000);
    setInterval(track,5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded",init,{once:true});
  } else {
    init();
  }

  wt.openExplore = openExplore;
  wt.exportData = exportData;
  wt.getEnhancedStats = getStats;
  wt.installWatchTogetherApp = installApp;
  window.WT_FEATURE_PACK = {
    openImage: url => {
      if (!url) return;
      window.open(String(url),"_blank","noopener,noreferrer");
    }
  };
})();
