(() => {
  "use strict";

  const wt = window.WT_ENHANCEMENTS = window.WT_ENHANCEMENTS || {};
  const core = window.WT_CORE || {};
  const $ = id => document.getElementById(id);
  const DB = () => window.firebase && firebase.apps && firebase.apps.length ? firebase.database() : null;
  const STORAGE = () => window.firebase && firebase.apps && firebase.apps.length && firebase.storage ? firebase.storage() : null;
  const PREF_KEY = "wt_preferences_v1";
  const PLAYER_KEY = "wt_player_preferences_v1";

  function toast(value) {
    try {
      if (typeof wt.toast === "function") return wt.toast(value);
      if (typeof window.toast === "function") return window.toast(value);
    } catch (_) {}
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  function state() { return core.state || {}; }
  function currentUser() { return window.firebase && firebase.auth ? firebase.auth().currentUser : null; }
  function db() { return DB(); }

  function localJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || "null");
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function saveLocal(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function readPrefs() {
    return Object.assign({ browserNotifications:false, friendNotifications:true, dmNotifications:true, roomNotifications:true, defaultPlatform:"youtube", compactControls:false }, localJson(PREF_KEY, {}));
  }

  function readPlayerPrefs() {
    return Object.assign({ autoplayNext:true, rememberVolume:true, resumeAfterBackground:true }, localJson(PLAYER_KEY, {}));
  }

  function writePlayerPrefs(p) { saveLocal(PLAYER_KEY, p); }

  function modal(id, title, html) {
    let m = $(id);
    if (!m) {
      m = document.createElement("div");
      m.id = id;
      m.className = "modal hidden wt-completion-modal";
      m.setAttribute("aria-hidden", "true");
      m.innerHTML = '<div class="modal-card wt-completion-card"><div class="wt-completion-head"><div class="panel-title"></div><button class="tiny-btn" type="button" data-close="1">關閉</button></div><div class="wt-completion-body"></div></div>';
      document.body.appendChild(m);
      m.querySelector("[data-close]").addEventListener("click", () => closeModal(id));
      m.addEventListener("click", e => { if (e.target === m) closeModal(id); });
    }
    m.querySelector(".panel-title").textContent = title;
    m.querySelector(".wt-completion-body").innerHTML = html;
    m.classList.remove("hidden");
    m.hidden = false;
    m.style.removeProperty("display");
    m.setAttribute("aria-hidden", "false");
    document.body.classList.add("wt-modal-open");
    return m.querySelector(".wt-completion-body");
  }

  function closeModal(id) {
    const m = $(id);
    if (!m) return;
    m.classList.add("hidden");
    m.hidden = true;
    m.style.setProperty("display", "none", "important");
    m.setAttribute("aria-hidden", "true");
    if (!document.querySelector(".modal:not(.hidden),.wt-modal:not(.hidden)")) document.body.classList.remove("wt-modal-open");
  }

  function injectCss() {
    if ($("wtCompletionStyle")) return;
    const style = document.createElement("style");
    style.id = "wtCompletionStyle";
    style.textContent = ".wt-completion-card{width:min(920px,calc(100vw - 24px));max-height:90vh;overflow:auto}.wt-completion-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.wt-completion-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.wt-completion-grid .full{grid-column:1/-1}.wt-completion-grid label{display:grid;gap:6px;font-size:12px}.wt-completion-grid input,.wt-completion-grid select,.wt-completion-grid textarea{width:100%;box-sizing:border-box}.wt-completion-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:14px}.wt-completion-muted{font-size:12px;color:#94a3b8;line-height:1.6}.wt-room-chat-tools{display:flex;gap:6px;align-items:center;margin-bottom:7px;flex-wrap:wrap}.wt-room-chat-search{flex:1;min-width:140px}.wt-room-chat-mention-menu{position:absolute;z-index:100;left:0;right:0;top:100%;margin-top:4px;background:#0f172a;border:1px solid rgba(148,163,184,.18);border-radius:12px;box-shadow:0 18px 40px rgba(0,0,0,.3);max-height:240px;overflow:auto;padding:6px}.wt-room-chat-mention-item{display:flex;width:100%;align-items:center;gap:8px;padding:8px 10px;border:0;background:transparent;color:inherit;border-radius:8px;text-align:left;cursor:pointer}.wt-room-chat-mention-item:hover{background:rgba(59,130,246,.12)}.wt-queue-tools{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.wt-queue-drag{cursor:grab}.wt-queue-drag:active{cursor:grabbing}.wt-queue-drop-target{outline:2px dashed rgba(96,165,250,.6);outline-offset:2px}.wt-room-chat-filtered .wt-message{display:none}.wt-room-chat-filter-note{font-size:11px;color:#94a3b8;padding:4px 0}.wt-account-danger{border:1px solid rgba(244,63,94,.2);border-radius:14px;padding:12px;margin-top:14px}@media(max-width:640px){.wt-completion-grid{grid-template-columns:1fr}.wt-completion-grid .full{grid-column:auto}}";
    document.head.appendChild(style);
  }

  function ensureTopbar() {
    const right = document.querySelector(".topbar-right");
    if (!right) return;
    const anchor = $("googleLoginBtn");
    const add = (id, text, handler) => {
      if ($(id)) return;
      const button = document.createElement("button");
      button.id = id;
      button.className = "wt-nav-btn";
      button.type = "button";
      button.textContent = text;
      button.addEventListener("click", handler);
      right.insertBefore(button, anchor || null);
    };
    add("wtCompletionLoginHistoryBtn","🕘 登入紀錄",() => {
      if (typeof wt.openLoginHistory === "function") wt.openLoginHistory();
      else toast("登入紀錄暫時不可用");
    });
    add("wtCompletionAccountBtn","👤 帳號管理",openAccountManager);
    add("wtCompletionToolsBtn","🧰 工具",openTools);
  }

  function openTools() {
    const s = state();
    const inRoom = Boolean(s.roomId);
    const body = modal("wtCompletionToolsModal","WatchTogether 工具中心",
      '<div class="wt-completion-grid">' +
        '<button id="wtToolFriends" class="secondary-btn" type="button">👥 好友與私訊</button>' +
        '<button id="wtToolSettings" class="secondary-btn" type="button">⚙️ 帳號設定</button>' +
        '<button id="wtToolExplore" class="secondary-btn" type="button">🔎 探索與資料</button>' +
        '<button id="wtToolFavorites" class="secondary-btn" type="button">☆ 收藏</button>' +
        '<button id="wtToolReports" class="secondary-btn" type="button">📋 我的回報</button>' +
        '<button id="wtToolNotifications" class="secondary-btn" type="button">🔔 通知中心</button>' +
        (inRoom ? '<button id="wtToolRoom" class="secondary-btn" type="button">🏠 房間設定</button><button id="wtToolQueue" class="secondary-btn" type="button">📋 佇列工具</button><button id="wtToolPlayer" class="secondary-btn" type="button">🎬 播放器設定</button>' : '') +
      '</div>'
    );
    const call = (fn, fallback) => () => { closeModal("wtCompletionToolsModal"); try { fn && fn(); } catch (_) { toast(fallback); } };
    $("wtToolFriends")?.addEventListener("click",call(wt.openFriends,"好友功能暫時不可用"));
    $("wtToolSettings")?.addEventListener("click",call(wt.openSettings,"設定功能暫時不可用"));
    $("wtToolExplore")?.addEventListener("click",call(wt.openExplore,"探索功能暫時不可用"));
    $("wtToolFavorites")?.addEventListener("click",call(wt.openFavorites,"收藏功能暫時不可用"));
    $("wtToolReports")?.addEventListener("click",call(wt.openMyReports,"回報功能暫時不可用"));
    $("wtToolNotifications")?.addEventListener("click",call(wt.openNotifications,"通知功能暫時不可用"));
    $("wtToolRoom")?.addEventListener("click",call(() => $("roomAccessManageBtn")?.click(),"房間設定暫時不可用"));
    $("wtToolQueue")?.addEventListener("click",call(openQueueTools,"佇列工具暫時不可用"));
    $("wtToolPlayer")?.addEventListener("click",call(openPlayerSettings,"播放器設定暫時不可用"));
  }

  const SESSION_STORAGE_KEY = "wt_watchtogether_session_id_v1";
  let sessionRef = null;
  let sessionListenerAttached = false;

  function getSessionId() {
    let id = "";
    try { id = String(localStorage.getItem(SESSION_STORAGE_KEY) || ""); } catch (_) {}
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(id)) {
      id = window.crypto?.randomUUID ? window.crypto.randomUUID().replace(/-/g, "") : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      id = id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
      try { localStorage.setItem(SESSION_STORAGE_KEY, id); } catch (_) {}
    }
    return id;
  }

  function getSessionDeviceLabel() {
    const ua = String(navigator.userAgent || "");
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    let browser = "瀏覽器";
    if (/Edg\//i.test(ua)) browser = "Edge";
    else if (/OPR\//i.test(ua)) browser = "Opera";
    else if (/Chrome\//i.test(ua)) browser = "Chrome";
    else if (/Firefox\//i.test(ua)) browser = "Firefox";
    else if (/Safari\//i.test(ua)) browser = "Safari";
    return (mobile ? "手機／平板" : "桌機") + " · " + browser;
  }

  async function ensureSessionTracking() {
    const u = currentUser();
    const database = db();
    if (!u || u.isAnonymous || !database) {
      if (sessionRef) {
        try { sessionRef.off(); } catch (_) {}
      }
      sessionRef = null;
      sessionListenerAttached = false;
      return;
    }
    if (sessionRef && sessionRef.__wtSessionUid !== u.uid) {
      try { sessionRef.off(); } catch (_) {}
      sessionRef = null;
      sessionListenerAttached = false;
    }
    const sid = getSessionId();
    const ref = database.ref("sessions/" + u.uid + "/" + sid);
    ref.__wtSessionUid = u.uid;
    sessionRef = ref;
    try {
      const snapshot = await ref.once("value");
      const existing = snapshot.val() || {};
      if (existing.revokedAt) {
        await firebase.auth().signOut();
        return;
      }
      await ref.update({
        id: sid,
        label: getSessionDeviceLabel(),
        createdAt: Number(existing.createdAt || Date.now()),
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
        revoked: false
      });
    } catch (error) {
      console.warn("登入工作階段同步失敗:", error);
      return;
    }
    if (sessionListenerAttached) return;
    sessionListenerAttached = true;
    ref.on("value", snapshot => {
      const value = snapshot.val() || {};
      if (!value.revokedAt) return;
      sessionRef = null;
      sessionListenerAttached = false;
      try { ref.off(); } catch (_) {}
      void firebase.auth().signOut();
    });
  }

  async function heartbeatSession() {
    const u = currentUser();
    if (!u || u.isAnonymous || !sessionRef) return;
    try {
      const snapshot = await sessionRef.once("value");
      const value = snapshot.val() || {};
      if (value.revokedAt) {
        await firebase.auth().signOut();
        return;
      }
      await sessionRef.update({
        lastSeen: firebase.database.ServerValue.TIMESTAMP,
        label: getSessionDeviceLabel()
      });
    } catch (_) {}
  }

  async function openSessionManager() {
    const u = currentUser();
    const database = db();
    if (!u || u.isAnonymous) return toast("訪客模式沒有跨裝置登入工作階段");
    if (!database) return toast("Firebase 尚未準備完成");
    await ensureSessionTracking();
    const sid = getSessionId();
    let data = {};
    try {
      data = (await database.ref("sessions/" + u.uid).limitToLast(30).once("value")).val() || {};
    } catch (error) {
      return toast(error?.message || "無法載入登入裝置");
    }
    const sessions = Object.entries(data).map(([id,value]) => Object.assign({id},value || {})).sort((a,b) => Number(b.lastSeen || 0) - Number(a.lastSeen || 0));
    const body = modal("wtSessionManagerModal","登入裝置與工作階段",
      '<div class="wt-completion-muted">撤銷後，該裝置的 WatchTogether 工作階段會自動登出。</div>' +
      '<div class="wt-feature-list" style="margin-top:12px">' +
      (sessions.length ? sessions.map(item => {
        const current = String(item.id) === sid;
        const revoked = Boolean(item.revokedAt);
        const when = Number(item.lastSeen || item.createdAt || 0);
        return '<div class="wt-feature-row"><div><strong>' + esc(current ? "目前裝置" : (item.label || "其他裝置")) + '</strong><div class="small muted">' + esc(item.label || "") + '｜最後活動 ' + esc(when ? new Date(when).toLocaleString() : "—") + '</div></div>' +
          (revoked ? '<span class="small muted">已撤銷</span>' : '<button type="button" class="tiny-btn ' + (current ? 'danger' : '') + '" data-wt-session-revoke="' + esc(item.id) + '">' + (current ? "登出此裝置" : "撤銷") + '</button>') +
          '</div>';
      }).join("") : '<div class="wt-feature-empty">目前沒有登入工作階段。</div>') +
      '</div><div class="wt-completion-actions"><button id="wtSessionRevokeOthers" class="secondary-btn" type="button">撤銷其他所有裝置</button><button id="wtSessionRefresh" class="primary-btn" type="button">重新整理</button></div>'
    );
    body.querySelectorAll("[data-wt-session-revoke]").forEach(button => {
      button.addEventListener("click", async () => {
        const target = String(button.dataset.wtSessionRevoke || "");
        if (!target) return;
        if (!window.confirm(target === sid ? "確定要登出這個目前裝置嗎？" : "確定撤銷這個登入裝置嗎？")) return;
        try {
          await database.ref("sessions/" + u.uid + "/" + target).update({revokedAt:firebase.database.ServerValue.TIMESTAMP,revokedBy:u.uid,revoked:true});
          if (target === sid) {
            await firebase.auth().signOut();
            location.href = location.pathname;
            return;
          }
          await openSessionManager();
        } catch (error) {
          toast(error?.message || "撤銷登入裝置失敗");
        }
      });
    });
    body.querySelector("#wtSessionRevokeOthers")?.addEventListener("click", async () => {
      const targets = sessions.filter(item => item.id !== sid && !item.revokedAt);
      if (!targets.length) return toast("沒有其他可撤銷的登入裝置");
      if (!window.confirm("確定撤銷其他所有登入裝置嗎？")) return;
      try {
        const updates = {};
        targets.forEach(item => {
          updates[item.id + "/revokedAt"] = firebase.database.ServerValue.TIMESTAMP;
          updates[item.id + "/revokedBy"] = u.uid;
          updates[item.id + "/revoked"] = true;
        });
        await database.ref("sessions/" + u.uid).update(updates);
        toast("其他登入裝置已撤銷");
        await openSessionManager();
      } catch (error) {
        toast(error?.message || "撤銷其他裝置失敗");
      }
    });
    body.querySelector("#wtSessionRefresh")?.addEventListener("click", () => { closeModal("wtSessionManagerModal"); void openSessionManager(); });
  }

  function openAccountManager() {
    const u = currentUser();
    const anonymous = Boolean(u?.isAnonymous);
    const publicCode = String(state().profile?.publicCode || "").toUpperCase();
    const body = modal("wtAccountManagerModal","帳號管理",
      '<div class="wt-completion-grid">' +
        '<label>UID<input value="' + esc(u?.uid || "未登入") + '" readonly></label>' +
        '<label>登入方式<input value="' + esc(anonymous ? "訪客模式" : (u?.providerData?.map(p => p.providerId).join(", ") || "Google")) + '" readonly></label>' +
        '<label>電子郵件<input value="' + esc(u?.email || "未提供") + '" readonly></label>' +
        '<label>使用者 ID<input value="' + esc(publicCode || "尚未設定") + '" readonly></label>' +
      '</div>' +
      '<div class="wt-completion-muted" style="margin-top:12px">帳號綁定會保留目前這個 Firebase 使用者的 UID。帳號刪除只會移除目前帳號可安全管理的個人資料節點；其他人共同使用的對話內容不會被破壞。</div>' +
      '<div class="wt-completion-actions" style="justify-content:flex-start">' +
        (anonymous ? '<button id="wtLinkGoogleBtn" class="primary-btn" type="button">🔗 綁定 Google</button>' : '') +
        '<button id="wtLoginHistoryFromAccount" class="secondary-btn" type="button">🕘 登入紀錄</button>' +
        '<button id="wtExportAccountData" class="secondary-btn" type="button">📦 匯出資料</button>' +
        (!anonymous ? '<button id="wtSessionManagerBtn" class="secondary-btn" type="button">🖥️ 登入裝置</button>' : '') +
      '</div>' +
      '<div class="wt-account-danger"><strong>帳號刪除</strong><div class="wt-completion-muted" style="margin-top:6px">這會刪除目前帳號的個人檔案節點並要求 Firebase 重新驗證後刪除登入帳號。</div><div class="wt-completion-actions"><button id="wtDeleteAccountBtn" class="tiny-btn danger" type="button">刪除帳號</button></div></div>'
    );
    $("wtLinkGoogleBtn")?.addEventListener("click",() => linkAnonymousToGoogle().catch(e => toast(e.message || "Google 綁定失敗")));
    $("wtLoginHistoryFromAccount")?.addEventListener("click",() => { closeModal("wtAccountManagerModal"); wt.openLoginHistory?.(); });
    $("wtExportAccountData")?.addEventListener("click",() => { wt.exportData?.(); });
    $("wtSessionManagerBtn")?.addEventListener("click",() => { closeModal("wtAccountManagerModal"); void openSessionManager(); });
    $("wtDeleteAccountBtn")?.addEventListener("click",() => deleteAccount().catch(e => toast(e.message || "帳號刪除失敗")));
  }

  async function linkAnonymousToGoogle() {
    const u = currentUser();
    if (!u?.isAnonymous) throw new Error("目前不是訪客帳號");
    if (!window.firebase?.auth) throw new Error("Firebase Auth 尚未載入");
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt:"select_account" });
    const result = await u.linkWithPopup(provider);
    toast("Google 已成功綁定，原帳號 UID 不變");
    if (result?.user) {
      closeModal("wtAccountManagerModal");
      setTimeout(openAccountManager,80);
    }
  }

  async function deleteAccount() {
    const u = currentUser();
    if (!u) throw new Error("目前沒有登入帳號");
    if (!window.confirm("確定要刪除這個 WatchTogether 帳號嗎？這項操作無法復原。")) return;
    const database = db();
    if (!database) throw new Error("Firebase 尚未準備完成");
    const profile = (await database.ref("profiles/" + u.uid).once("value").catch(() => null))?.val?.() || state().profile || {};
    const code = String(profile.publicCode || "").trim().toUpperCase();
    const updates = {};
    [
      "profiles/" + u.uid,
      "publicUsers/" + u.uid,
      "accounts/" + u.uid,
      "friendships/" + u.uid,
      "friendRequests/" + u.uid,
      "blockedUsers/" + u.uid,
      "watchHistory/" + u.uid,
      "watchStats/" + u.uid,
      "userSettings/" + u.uid,
      "presence/" + u.uid,
      "notifications/" + u.uid,
      "roomInvites/" + u.uid,
      "sessions/" + u.uid
    ].forEach(path => { updates[path] = null; });

    const friendshipsSnapshot = await database.ref("friendships/" + u.uid).once("value").catch(() => null);
    friendshipsSnapshot?.forEach?.(snap => {
      if (snap.key) updates["friendships/" + snap.key + "/" + u.uid] = null;
    });
    if (code) updates["profileCodes/" + code] = null;
    const publicRooms = await database.ref("publicRooms").orderByChild("owner").equalTo(u.uid).once("value").catch(() => null);
    publicRooms?.forEach?.(snap => { updates["publicRooms/" + snap.key] = null; });
    await database.ref().update(updates);
    try {
      await u.delete();
    } catch (error) {
      if (error?.code === "auth/requires-recent-login" && !u.isAnonymous) {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt:"select_account" });
        await u.reauthenticateWithPopup(provider);
        await u.delete();
      } else if (u.isAnonymous) {
        await firebase.auth().signOut();
      } else {
        throw error;
      }
    }
    localStorage.removeItem(PREF_KEY);
    localStorage.removeItem(PLAYER_KEY);
    toast("帳號已刪除");
    location.href = location.pathname;
  }

  function openPlayerSettings() {
    const p = readPlayerPrefs();
    const body = modal("wtPlayerSettingsModal","播放器設定",
      '<div class="wt-completion-grid">' +
        '<label class="full"><span><input id="wtPlayerAutoplayNext" type="checkbox" ' + (p.autoplayNext ? "checked" : "") + '> 影片結束後依佇列設定處理下一部</span></label>' +
        '<label class="full"><span><input id="wtPlayerRememberVolume" type="checkbox" ' + (p.rememberVolume ? "checked" : "") + '> 記住此裝置的音量</span></label>' +
        '<label class="full"><span><input id="wtPlayerResumeBg" type="checkbox" ' + (p.resumeAfterBackground ? "checked" : "") + '> 從背景切回時重新做一次同步檢查</span></label>' +
      '</div>' +
      '<div class="wt-completion-muted" style="margin-top:12px">同步核心仍由房主、伺服器時間、effectiveAt、issuedAt、playbackRate 與 drift correction 控制；這裡只管理裝置端偏好。</div>' +
      '<div class="wt-completion-actions"><button id="wtPlayerSyncNow" class="secondary-btn" type="button">立即同步</button><button id="wtPlayerSave" class="primary-btn" type="button">儲存</button></div>'
    );
    $("wtPlayerSave")?.addEventListener("click",() => {
      writePlayerPrefs({
        autoplayNext:$("wtPlayerAutoplayNext")?.checked === true,
        rememberVolume:$("wtPlayerRememberVolume")?.checked === true,
        resumeAfterBackground:$("wtPlayerResumeBg")?.checked === true
      });
      applyPlayerPrefs();
      toast("播放器設定已儲存");
      closeModal("wtPlayerSettingsModal");
    });
    $("wtPlayerSyncNow")?.addEventListener("click",() => { $("manualSyncBtn")?.click(); closeModal("wtPlayerSettingsModal"); });
  }

  function applyPlayerPrefs() {
    const p = readPlayerPrefs();
    const volume = $("volumeInput");
    if (p.rememberVolume && volume) {
      const saved = Number(localStorage.getItem("wt_volume_v2"));
      if (Number.isFinite(saved)) {
        volume.value = String(Math.max(0,Math.min(100,saved)));
        try { volume.dispatchEvent(new Event("input",{bubbles:true})); } catch (_) {}
      }
    }
  }

  function interceptVolumePersistence() {
    const input = $("volumeInput");
    if (!input || input.dataset.wtCompletionBound) return;
    input.dataset.wtCompletionBound = "1";
    input.addEventListener("input",() => {
      if (readPlayerPrefs().rememberVolume) {
        const value = Number(input.value);
        if (Number.isFinite(value)) localStorage.setItem("wt_volume_v2",String(Math.max(0,Math.min(100,value))));
      }
    });
    applyPlayerPrefs();
  }

  function openQueueTools() {
    const s = state();
    if (!s.roomId) return toast("目前不在房間內");
    const entries = Object.values(s.queue || {}).filter(Boolean);
    const canManage = Boolean(s.isOwner || window.WT_ROOM_ACCESS?.isCohost?.(s.uid));
    const body = modal("wtQueueToolsModal","佇列工具",
      '<div class="wt-completion-grid">' +
        '<label><span>待播放數量</span><input value="' + esc(entries.length) + '" readonly></label>' +
        '<label><span>目前模式</span><input value="' + esc(String(s.room?.settings?.queueMode || "normal")) + '" readonly></label>' +
      '</div>' +
      '<div class="wt-completion-actions" style="justify-content:flex-start">' +
        (canManage ? '<button id="wtQueueRebalance" class="secondary-btn" type="button">↕ 重新排序</button>' : '') +
        (s.isOwner ? '<button id="wtQueueClear" class="tiny-btn danger" type="button">清空整個佇列</button>' : '') +
        '<button id="wtQueueMode" class="secondary-btn" type="button">⚙ 播放模式</button>' +
        '<button id="wtQueueHistory" class="secondary-btn" type="button">🕘 播放歷史</button>' +
      '</div>' +
      '<div class="wt-completion-muted" style="margin-top:12px">拖曳排序會寫回目前佇列的 order 欄位，不會改動影片內容。</div>'
    );
    $("wtQueueClear")?.addEventListener("click",() => clearQueue().catch(e => toast(e.message || "清空佇列失敗")));
    $("wtQueueMode")?.addEventListener("click",() => { closeModal("wtQueueToolsModal"); wt.openQueueMode?.(); });
    $("wtQueueHistory")?.addEventListener("click",() => { closeModal("wtQueueToolsModal"); wt.openQueueHistory?.(); });
    $("wtQueueRebalance")?.addEventListener("click",() => { closeModal("wtQueueToolsModal"); toast("拖曳佇列項目即可重新排序"); });
  }

  async function clearQueue() {
    const s = state();
    if (!s.isOwner) throw new Error("只有房主可以清空整個佇列");
    if (!s.queueRef) throw new Error("佇列尚未準備完成");
    if (!window.confirm("確定清空整個待播放清單嗎？")) return;
    await s.queueRef.remove();
    toast("待播放清單已清空");
    closeModal("wtQueueToolsModal");
  }

  function getSortedQueue() {
    const s = state();
    return Object.entries(s.queue || {}).map(([queueId,item]) => Object.assign({queueId},item || {})).filter(Boolean).sort((a,b) => {
      const ao = Number(a.order ?? a.addedAt ?? 0), bo = Number(b.order ?? b.addedAt ?? 0);
      if (ao !== bo) return ao - bo;
      return String(a.queueId).localeCompare(String(b.queueId));
    });
  }

  async function reorderQueue(fromId,toId) {
    const s = state();
    if (!s.queueRef) throw new Error("佇列尚未準備完成");
    if (!(s.isOwner || window.WT_ROOM_ACCESS?.isCohost?.(s.uid))) throw new Error("只有房主或 Co-host 可以排序佇列");
    const list = getSortedQueue().filter(x => !(s.currentVideoId && String(x.id) === String(s.currentVideoId)));
    const fromIndex = list.findIndex(x => String(x.queueId) === String(fromId));
    const toIndex = list.findIndex(x => String(x.queueId) === String(toId));
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const moving = list.splice(fromIndex,1)[0];
    list.splice(toIndex,0,moving);
    const updates = {};
    const base = Date.now() * 1000;
    list.forEach((item,index) => { updates[item.queueId + "/order"] = base + index; });
    await s.queueRef.update(updates);
    toast("佇列順序已更新");
  }

  function decorateQueueItems() {
    const box = $("queueList");
    if (!box) return;
    const canManage = Boolean(state().isOwner || window.WT_ROOM_ACCESS?.isCohost?.(state().uid));
    box.querySelectorAll(".queue-item").forEach(item => {
      if (canManage) item.classList.add("wt-queue-drag"); else item.classList.remove("wt-queue-drag");
      item.draggable = canManage;
    });
  }

  function installQueueDrag() {
    const box = $("queueList");
    if (!box || box.dataset.wtCompletionQueue) return;
    box.dataset.wtCompletionQueue = "1";
    decorateQueueItems();
    box.addEventListener("dragstart",e => {
      const item = e.target.closest(".queue-item");
      if (!item || !item.draggable) return;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain",item.dataset.queueId || "");
    });
    box.addEventListener("dragover",e => {
      const target=e.target.closest(".queue-item");
      if (!target) return;
      e.preventDefault();
      box.querySelectorAll(".wt-queue-drop-target").forEach(x=>x.classList.remove("wt-queue-drop-target"));
      target.classList.add("wt-queue-drop-target");
    });
    box.addEventListener("dragleave",e => {
      if (!box.contains(e.relatedTarget)) box.querySelectorAll(".wt-queue-drop-target").forEach(x=>x.classList.remove("wt-queue-drop-target"));
    });
    box.addEventListener("drop",e => {
      e.preventDefault();
      const target=e.target.closest(".queue-item");
      const from=e.dataTransfer.getData("text/plain");
      box.querySelectorAll(".wt-queue-drop-target").forEach(x=>x.classList.remove("wt-queue-drop-target"));
      if (target && from) reorderQueue(from,target.dataset.queueId).catch(err=>toast(err.message || "排序失敗"));
    });
  }

  function ensureQueueToolbar() {
    const panel=document.querySelector(".queue-panel");
    if(!panel || $("wtQueueToolbar")) return;
    const head=panel.querySelector(".panel-title");
    if(!head) return;
    const oldButton=$("playQueueNowBtn");
    const wrap=document.createElement("div");
    wrap.id="wtQueueToolbar";
    wrap.className="wt-queue-tools";
    wrap.innerHTML='<button id="wtQueueToolsOpen" class="tiny-btn" type="button">🧰 工具</button><button id="wtQueueModeQuick" class="tiny-btn" type="button">⚙ 模式</button><button id="wtQueueHistoryQuick" class="tiny-btn" type="button">🕘 歷史</button>';
    if(oldButton) oldButton.insertAdjacentElement("afterend",wrap); else head.appendChild(wrap);
    $("wtQueueToolsOpen").addEventListener("click",openQueueTools);
    $("wtQueueModeQuick").addEventListener("click",()=>wt.openQueueMode?.());
    $("wtQueueHistoryQuick").addEventListener("click",()=>wt.openQueueHistory?.());
  }

  function ensureRoomChatTools() {
    const form=$("chatForm"),input=$("chatInput");
    if(!form||!input||$("wtRoomChatTools")) return;
    const wrap=document.createElement("div");
    wrap.id="wtRoomChatTools";
    wrap.className="wt-room-chat-tools";
    wrap.innerHTML='<div style="position:relative;display:flex;gap:6px;flex:1;min-width:150px"><input id="wtRoomChatSearchInput" class="wt-room-chat-search" type="search" maxlength="80" placeholder="搜尋聊天室訊息"><div id="wtRoomChatMentionMenu" class="wt-room-chat-mention-menu hidden"></div></div><button id="wtRoomChatSearchClear" class="tiny-btn" type="button">清除</button><button id="wtRoomChatMentionBtn" class="tiny-btn" type="button">@ 提及</button><input id="wtRoomChatMediaInput" type="file" accept="image/*" multiple hidden><button id="wtRoomChatMediaBtn" class="tiny-btn" type="button">🖼 圖片/GIF</button><span id="wtRoomChatFilterNote" class="wt-room-chat-filter-note"></span>';
    form.parentElement.insertBefore(wrap,form);
    $("wtRoomChatSearchInput").addEventListener("input",applyRoomChatFilter);
    $("wtRoomChatSearchClear").addEventListener("click",()=>{ $("wtRoomChatSearchInput").value=""; applyRoomChatFilter(); });
    $("wtRoomChatMentionBtn").addEventListener("click",()=>showRoomMentionMenu());
    $("wtRoomChatMediaBtn").addEventListener("click",()=>$("wtRoomChatMediaInput").click());
    $("wtRoomChatMediaInput").addEventListener("change",e=>{ void sendRoomChatMedia(e.target.files).catch(err=>toast(err.message || "圖片上傳失敗")); e.target.value=""; });
    input.addEventListener("input",()=>{ if(input.value.slice(-1)==="@") showRoomMentionMenu(); });
    document.addEventListener("click",e=>{ if(!wrap.contains(e.target)) $("wtRoomChatMentionMenu")?.classList.add("hidden"); });
  }

  function roomMentionCandidates() {
    const members = {};
    document.querySelectorAll("#memberList .member[data-member-uid]").forEach(el => {
      const uid = String(el.getAttribute("data-member-uid") || "");
      if (!uid) return;
      const code = String(el.getAttribute("data-member-public-code") || uid.slice(0,6)).toUpperCase().slice(0,6);
      const nameEl = el.querySelector(".member-name b");
      members[uid] = {name:String(nameEl?.textContent || "玩家").trim(),publicCode:code};
    });
    return Object.entries(members).map(([uid,m]) => ({
      uid,
      name:String(m?.name || "玩家"),
      code:String(m?.publicCode || uid.slice(0,6)).toUpperCase().slice(0,6)
    })).filter(x=>x.uid!==state().uid).slice(0,30);
  }

  function showRoomMentionMenu(filter="") {
    const box=$("wtRoomChatMentionMenu"),input=$("chatInput");
    if(!box||!input) return;
    const q=String(filter||"").trim().toLowerCase();
    const list=roomMentionCandidates().filter(x=>!q || x.name.toLowerCase().includes(q) || x.code.toLowerCase().includes(q));
    box.innerHTML=list.length?list.map(x=>'<button class="wt-room-chat-mention-item" type="button" data-mention-code="'+esc(x.code)+'"><span>👤</span><span><b>'+esc(x.name)+'</b><small style="display:block;color:#94a3b8">@'+esc(x.code)+'</small></span></button>').join(""):'<div style="padding:10px;color:#94a3b8;font-size:12px">沒有可提及的成員。</div>';
    box.classList.remove("hidden");
    box.querySelectorAll("[data-mention-code]").forEach(button=>button.addEventListener("click",()=>{
      const code=button.dataset.mentionCode||"";
      const value=input.value||"";
      const index=input.selectionStart ?? value.length;
      const before=value.slice(0,index).replace(/@[A-Z0-9]{0,6}$/i,"");
      input.value=before+"@"+code+" "+value.slice(index);
      input.focus();
      input.selectionStart=input.selectionEnd=before.length+code.length+2;
      box.classList.add("hidden");
    }));
  }

  function applyRoomChatFilter() {
    const box=$("chatMessages"),input=$("wtRoomChatSearchInput"),note=$("wtRoomChatFilterNote");
    if(!box||!input) return;
    const q=String(input.value||"").trim().toLowerCase();
    let visible=0,total=0;
    box.querySelectorAll(".wt-message").forEach(message=>{
      total++;
      const match=!q || String(message.textContent||"").toLowerCase().includes(q);
      message.style.display=match?"":"none";
      if(match) visible++;
    });
    if(note) note.textContent=q ? (visible+" / "+total+" 則") : "";
  }

  async function sendRoomChatMedia(files) {
    const s=state();
    const list=Array.from(files||[]).filter(f=>String(f.type||"").startsWith("image/")).slice(0,6);
    if(!list.length||!s.chatRef||!s.uid) return;
    if(!(await roomChatCanSend())) return;
    const storage=STORAGE();
    if(!storage) throw new Error("Firebase Storage 尚未載入");
    for(const file of list){
      if(file.size>8*1024*1024) throw new Error("單張圖片/GIF 不得超過 8 MB");
      const type=String(file.type||"");
      const ext=type==="image/gif"?"gif":(type==="image/png"?"png":"webp");
      const id=(window.crypto?.randomUUID?window.crypto.randomUUID():Date.now()+"_"+Math.random().toString(36).slice(2));
      const path="chatRoomMedia/"+s.roomId+"/"+s.uid+"/"+id+"."+ext;
      const ref=storage.ref(path);
      await ref.put(file,{contentType:type||"image/*",customMetadata:{ownerUid:String(s.uid),roomId:String(s.roomId)}});
      const url=await ref.getDownloadURL();
      await s.chatRef.push({uid:s.uid,name:String(s.memberName||"玩家").slice(0,30),type:"image",mediaUrl:url,mediaPath:path,mediaName:String(file.name||"圖片").slice(0,100),mediaSize:file.size,createdAt:firebase.database.ServerValue.TIMESTAMP});
    }
    toast("圖片/GIF 已送出");
  }

  async function roomChatCanSend() {
    const s=state(),uid=s.uid;
    if(!uid||!s.chatRef) return false;
    const mute=s.roomMutes?.[uid];
    if(mute&&(mute.permanent===true||Number(mute.until||0)>Date.now())) { toast("你目前被房間禁言"); return false; }
    const access=window.WT_ACCESS_CONTROL;
    if(access){
      try{await access.waitUntilReady(2500);}catch(_){ }
      if(access.state?.ready&&!access.hasPermission("chat.send")){toast("你目前無法在聊天室發言");return false;}
    }
    return true;
  }

  function monitorRoomChatRerender() {
    const box=$("chatMessages");
    if(!box||box.dataset.wtCompletionObserver) return;
    box.dataset.wtCompletionObserver="1";
    const observer=new MutationObserver(()=>applyRoomChatFilter());
    observer.observe(box,{childList:true,subtree:true});
    applyRoomChatFilter();
  }

  function installVisibilityResume() {
    if(document.documentElement.dataset.wtCompletionVisibility) return;
    document.documentElement.dataset.wtCompletionVisibility="1";
    let hiddenAt=0;
    document.addEventListener("visibilitychange",()=>{
      const p=readPlayerPrefs(),s=state();
      if(document.hidden){hiddenAt=Date.now();return;}
      if(!p.resumeAfterBackground||!s.roomId||!s.currentVideoId||!s.player)return;
      if(hiddenAt&&Date.now()-hiddenAt<700)return;
      try{ $("manualSyncBtn")?.click(); }catch(_){}
    });
  }

  function init() {
    if(document.documentElement.dataset.wtCompletionInit) return;
    document.documentElement.dataset.wtCompletionInit="1";
    injectCss();
    ensureTopbar();
    installQueueDrag();
    installVisibilityResume();
    setInterval(()=>{
      ensureTopbar();
      ensureQueueToolbar();
      decorateQueueItems();
      installQueueDrag();
      if(state().roomId){
        ensureRoomChatTools();
        monitorRoomChatRerender();
      }
      interceptVolumePersistence();
    },1000);
    interceptVolumePersistence();
    void ensureSessionTracking();
    setInterval(() => { void heartbeatSession(); void ensureSessionTracking(); },30000);
  }

  wt.openAccountManager=openAccountManager;
  wt.openTools=openTools;
  wt.openPlayerSettings=openPlayerSettings;
  wt.openQueueTools=openQueueTools;
  wt.clearQueue=clearQueue;
  wt.linkAnonymousToGoogle=linkAnonymousToGoogle;
  wt.deleteAccount=deleteAccount;
  wt.openSessionManager=openSessionManager;

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",init,{once:true}); else init();
})();