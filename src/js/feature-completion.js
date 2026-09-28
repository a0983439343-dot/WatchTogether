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
    add("wtCompletionAccountBtn","👤 帳號管理",() => { void openAccountManager().catch(error => toast(error?.message || "帳號管理開啟失敗")); });
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

  async function openAccountManager() {
    await wt.loadOwnProfile?.();
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
    await wt.loadOwnProfile?.();
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
    profileLoadUid="";
    state().profile=null;
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

(() => {
  "use strict";
  const wt=window.WT_ENHANCEMENTS=window.WT_ENHANCEMENTS||{}, core=window.WT_CORE||{};
  const $=id=>document.getElementById(id), auth=()=>window.firebase?.apps?.length?firebase.auth():null, db=()=>window.firebase?.apps?.length?firebase.database():null;
  const PREF="wt_preferences_v1", NOTIF="wt_notifications_v2"; let notifRef=null,notifUid="",cloud={};
  const esc=v=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const toast=v=>{try{if(typeof wt.toast==="function")return wt.toast(v);if(typeof window.toast==="function")return window.toast(v)}catch(_){}};
  const user=()=>auth()?.currentUser||null, state=()=>core.state||wt.state||{}, isGoogle=()=>{const u=user();return !!(u&&!u.isAnonymous)};
  const local=(k,f)=>{try{const x=JSON.parse(localStorage.getItem(k)||"null");return x==null?f:x}catch(_){return f}};
  const save=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(_){}};
  const prefs=()=>Object.assign({browserNotifications:false,friendNotifications:true,dmNotifications:true,roomNotifications:true,defaultPlatform:"youtube",compactControls:false},local(PREF,{}));
  const close=id=>{const m=$(id);if(!m)return;m.classList.add("hidden");m.hidden=true;m.style.setProperty("display","none","important");m.setAttribute("aria-hidden","true");};
  function modal(id,title,html){
    let m=$(id);
    if(!m){m=document.createElement("div");m.id=id;m.className="modal hidden";m.innerHTML='<div class="modal-card wt-account-v6-card"><div class="wt-account-v6-head"><div class="panel-title"></div><button class="tiny-btn" type="button" data-v6-close>關閉</button></div><div class="wt-account-v6-body"></div></div>';document.body.appendChild(m);m.querySelector("[data-v6-close]").onclick=()=>close(id);m.onclick=e=>{if(e.target===m)close(id)}}
    m.querySelector(".panel-title").textContent=title;m.querySelector(".wt-account-v6-body").innerHTML=html;m.classList.remove("hidden");m.hidden=false;m.style.removeProperty("display");m.setAttribute("aria-hidden","false");document.body.classList.add("wt-modal-open");return m.querySelector(".wt-account-v6-body");
  }
  const cloudDefaults=()=>({showOnline:true,browserNotifications:false,cloudHistory:true,cloudStats:true});
  async function cloudSettings(){const u=user(),d=db();if(!u||u.isAnonymous||!d)return cloudDefaults();try{return Object.assign(cloudDefaults(),(await d.ref("userSettings/"+u.uid).once("value")).val()||{})}catch(_){return cloudDefaults()}}
  const profile=()=>state().profile&&typeof state().profile==="object"?state().profile:{};
  const validCode=c=>/^[A-Z0-9]{6}$/.test(String(c||"").toUpperCase());
  async function claimCode(code,uid){const d=db(),v=String(code||"").toUpperCase();if(!d||!validCode(v))throw new Error("使用者 ID 必須是 6 碼英數字");const tx=await d.ref("profileCodes/"+v).transaction(x=>x==null||String(x)===String(uid)?String(uid):x);if(String(tx.snapshot?.val?.()||"")!==String(uid))throw new Error("這個使用者 ID 已被使用")}
  async function releaseCode(code,uid){const d=db(),v=String(code||"").toUpperCase();if(!d||!validCode(v))return;try{const s=await d.ref("profileCodes/"+v).once("value");if(String(s.val()||"")===String(uid))await d.ref("profileCodes/"+v).remove()}catch(_){}}
  async function generateCode(uid){const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";for(let n=0;n<12;n++){let c="";for(let i=0;i<6;i++)c+=a[Math.floor(Math.random()*a.length)];try{await claimCode(c,uid);return c}catch(_){}}throw new Error("暫時無法產生新的使用者 ID")}
  let profileLoadUid="";
  async function loadOwnProfile(){
    const u=user(),d=db();
    if(!u||u.isAnonymous||!d){
      profileLoadUid="";
      if(state().profile)state().profile=null;
      return null;
    }
    const uid=String(u.uid||"");
    if(!uid)return null;
    if(profileLoadUid===uid&&state().profile&&typeof state().profile==="object")return state().profile;
    profileLoadUid=uid;
    try{
      const snap=await d.ref("profiles/"+uid).once("value");
      if(profileLoadUid!==uid||String(user()?.uid||"")!==uid)return null;
      let p=snap.val();
      if(!p||typeof p!=="object"){
        const code=await generateCode(uid);
        const name=String(u.displayName||"玩家").trim().slice(0,30)||"玩家";
        p={displayName:name,publicCode:code,avatarEmoji:"🙂",theme:"aurora",notifications:true,createdAt:Date.now()};
        await d.ref().update({
          ["profiles/"+uid]:p,
          ["publicUsers/"+uid]:{displayName:name,publicCode:code,avatarEmoji:"🙂",searchName:name.toLowerCase(),updatedAt:firebase.database.ServerValue.TIMESTAMP}
        });
      }
      state().profile=Object.assign({},p);
      const storedName=String(localStorage.getItem("wt_name")||"").trim();
      if(p.displayName&&(!storedName||/^訪客\d{3}$/.test(storedName))){
        state().memberName=String(p.displayName).slice(0,30);
        localStorage.setItem("wt_name",state().memberName);
      }
      if(p.theme&&typeof wt.applyTheme==="function")wt.applyTheme(p.theme);
      return state().profile;
    }catch(error){
      if(profileLoadUid===uid)profileLoadUid="";
      console.warn("個人資料載入失敗:",error);
      return null;
    }
  }
  const themeOptions=sel=>{const a=Array.isArray(wt.THEMES)&&wt.THEMES.length?wt.THEMES:[{id:"aurora",name:"Aurora"},{id:"cyber",name:"Cyber"},{id:"paper",name:"Paper"},{id:"terminal",name:"Terminal"},{id:"sakura",name:"Sakura"},{id:"ocean",name:"Ocean"},{id:"sunset",name:"Sunset"},{id:"mono",name:"Mono"},{id:"glass",name:"Glass"},{id:"retro",name:"Retro"},{id:"forest",name:"Forest"},{id:"blueprint",name:"Blueprint"}];return a.map(x=>'<option value="'+esc(x.id)+'" '+(String(x.id)===String(sel||"aurora")?"selected":"")+'>'+esc(x.name||x.id)+'</option>').join("")};
  const languageOptions=sel=>{const a=window.WT_I18N?.languages||{},ks=Object.keys(a),mode=String(sel||window.WT_I18N?.getMode?.()||"auto");return '<option value="auto" '+(mode==="auto"?"selected":"")+'>自動（瀏覽器語言）</option>'+(ks.length?ks.map(k=>'<option value="'+esc(k)+'" '+(String(k)===mode?"selected":"")+'>'+esc(a[k]?.name||k)+'</option>').join(""):'<option value="zh-TW" '+(mode==="zh-TW"?"selected":"")+'>繁體中文</option>')};
  async function saveSettings(){
    const u=user(),p=profile(),l=prefs(),guest=!u||u.isAnonymous;
    const name=String($("wtAccountV6Name")?.value||"").trim().slice(0,30),avatar=String($("wtAccountV6Avatar")?.value||"").trim().slice(0,4),theme=String($("wtAccountV6Theme")?.value||"aurora"),language=String($("wtAccountV6Language")?.value||"zh-TW"),platform=String($("wtAccountV6Platform")?.value||"youtube");
    if(!name||!avatar)throw new Error("顯示名稱與頭像不能為空");
    const next=Object.assign({},l,{browserNotifications:$("wtAccountV6Browser")?.checked===true,friendNotifications:$("wtAccountV6Friend")?.checked===true,dmNotifications:$("wtAccountV6Dm")?.checked===true,roomNotifications:$("wtAccountV6Room")?.checked===true,defaultPlatform:platform,compactControls:$("wtAccountV6Compact")?.checked===true});
    save(PREF,next);try{window.WT_I18N?.setLocale?.(language)}catch(_){}
    if(guest){state().memberName=name;localStorage.setItem("wt_name",name);try{wt.applyTheme?.(theme)}catch(_){}}
    else{
      const d=db();if(!d)throw new Error("Firebase 尚未準備完成");
      let code=String($("wtAccountV6Code")?.value||"").trim().toUpperCase()||String(p.publicCode||"").toUpperCase(),oldCode=String(p.publicCode||"").toUpperCase();
      if(!validCode(code))code=await generateCode(u.uid);else if(code!==oldCode)await claimCode(code,u.uid);
      const updated={displayName:name,publicCode:code,avatarEmoji:avatar,theme,notifications:Boolean(next.friendNotifications||next.dmNotifications||next.roomNotifications),createdAt:Number(p.createdAt||0)>0?Number(p.createdAt):Date.now(),updatedAt:firebase.database.ServerValue.TIMESTAMP};
      try{
        await d.ref().update({["profiles/"+u.uid]:updated,["publicUsers/"+u.uid]:{displayName:name,publicCode:code,avatarEmoji:avatar,searchName:name.toLowerCase(),updatedAt:firebase.database.ServerValue.TIMESTAMP}});
        if(oldCode&&oldCode!==code)await releaseCode(oldCode,u.uid);
        await d.ref("userSettings/"+u.uid).set({showOnline:$("wtAccountV6Online")?.checked!==false,browserNotifications:next.browserNotifications,cloudHistory:$("wtAccountV6History")?.checked!==false,cloudStats:$("wtAccountV6Stats")?.checked!==false,updatedAt:firebase.database.ServerValue.TIMESTAMP});
      }catch(e){if(code!==oldCode)await releaseCode(code,u.uid);throw e}
      state().profile=Object.assign({},p,updated);profileLoadUid=u.uid;state().memberName=name;localStorage.setItem("wt_name",name);try{wt.applyTheme?.(theme)}catch(_){}try{await core.updateCurrentMemberName?.(name)}catch(_){}
    }
    if($("sourceTypeInput"))$("sourceTypeInput").value=platform;if($("sourceTypeModal"))$("sourceTypeModal").value=platform;
    document.documentElement.classList.toggle("wt-account-v6-compact",next.compactControls===true);toast("帳號與設定已儲存");close("wtAccountV6SettingsModal");
  }
  async function openSettings(){
    await loadOwnProfile();
    const p=profile(),l=prefs(),c=await cloudSettings(),guest=!isGoogle();
    const body=modal("wtAccountV6SettingsModal",guest?"帳號與設定（訪客）":"帳號與設定",
      '<div class="wt-account-v6-grid"><label>顯示名稱<input id="wtAccountV6Name" maxlength="30" value="'+esc(p.displayName||wt.currentName?.()||(guest?"訪客":"玩家"))+'"></label><label>頭像 Emoji<input id="wtAccountV6Avatar" maxlength="4" value="'+esc(p.avatarEmoji||wt.currentAvatar?.()||"🙂")+'"></label><label>使用者 ID<input id="wtAccountV6Code" maxlength="6" value="'+esc(p.publicCode||"")+'" style="text-transform:uppercase" '+(guest?"disabled":"")+'></label><label>主題<select id="wtAccountV6Theme">'+themeOptions(p.theme)+'</select></label><label>語言<select id="wtAccountV6Language">'+languageOptions(window.WT_I18N?.getMode?.()||"auto")+'</select></label><label>預設平台<select id="wtAccountV6Platform"><option value="youtube">YouTube</option><option value="vimeo">Vimeo</option><option value="dailymotion">Dailymotion</option><option value="twitch">Twitch</option></select></label></div><div class="panel-title" style="margin-top:16px">隱私、通知與雲端</div><div class="wt-account-v6-grid"><label class="wt-account-v6-check"><input id="wtAccountV6Online" type="checkbox" '+(c.showOnline!==false?"checked":"")+'> 允許好友看到我在線上</label><label class="wt-account-v6-check"><input id="wtAccountV6Browser" type="checkbox" '+(l.browserNotifications===true?"checked":"")+'> 瀏覽器通知</label><label class="wt-account-v6-check"><input id="wtAccountV6Friend" type="checkbox" '+(l.friendNotifications!==false?"checked":"")+'> 好友／房間申請通知</label><label class="wt-account-v6-check"><input id="wtAccountV6Dm" type="checkbox" '+(l.dmNotifications!==false?"checked":"")+'> 私訊通知</label><label class="wt-account-v6-check"><input id="wtAccountV6Room" type="checkbox" '+(l.roomNotifications!==false?"checked":"")+'> 房間與系統通知</label><label class="wt-account-v6-check"><input id="wtAccountV6History" type="checkbox" '+(c.cloudHistory!==false?"checked":"")+'> 雲端觀看紀錄</label><label class="wt-account-v6-check"><input id="wtAccountV6Stats" type="checkbox" '+(c.cloudStats!==false?"checked":"")+'> 雲端統計</label><label class="wt-account-v6-check"><input id="wtAccountV6Compact" type="checkbox" '+(l.compactControls===true?"checked":"")+'> 緊湊控制列</label></div>'+(guest?'<div class="wt-account-v6-note">訪客模式的設定只保存在此裝置。</div>':"")+'<div class="wt-account-v6-actions"><button id="wtAccountV6Notify" type="button" class="secondary-btn">允許瀏覽器通知</button><button id="wtAccountV6Save" type="button" class="primary-btn">儲存設定</button></div>');
    if($("wtAccountV6Platform"))$("wtAccountV6Platform").value=["youtube","vimeo","dailymotion","twitch"].includes(l.defaultPlatform)?l.defaultPlatform:"youtube";
    $("wtAccountV6Notify").onclick=async()=>{if(!("Notification"in window))return toast("此瀏覽器不支援通知");const x=await Notification.requestPermission().catch(()=>"denied");if(x==="granted")$("wtAccountV6Browser").checked=true;toast(x==="granted"?"瀏覽器通知已允許":"通知沒有啟用")};
    $("wtAccountV6Save").onclick=()=>saveSettings().catch(e=>toast(e.message||"設定儲存失敗"));
  }
  const localNotifs=()=>{const x=local(NOTIF,[]);return Array.isArray(x)?x:[]};
  const allNotifs=()=>{const m=new Map();localNotifs().forEach(x=>{if(x?.id)m.set(String(x.id),Object.assign({__source:"local"},x))});Object.entries(cloud).forEach(([id,x])=>{if(!x)return;const key=String(x.id||id);m.set(key,Object.assign({id:key,__source:"cloud"},x))});return [...m.values()].sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)).map(x=>{const y=Object.assign({},x);delete y.__source;return y}).slice(0,100)};
  const badge=()=>{const n=allNotifs().filter(x=>x.read!==true).length,b=$("wtFeatureNotificationBadge");if(b){b.textContent=n>99?"99+":String(n);b.style.display=n?"block":"none"}};
  async function openNotifications(){
    const items=allNotifs(),b=modal("wtAccountV6NotificationsModal",isGoogle()?"通知中心（跨裝置）":"通知中心",'<div class="wt-account-v6-actions"><span class="small muted">未讀 '+items.filter(x=>x.read!==true).length+' 筆</span><span><button id="wtAccountV6ReadAll" class="tiny-btn" type="button">全部已讀</button><button id="wtAccountV6Clear" class="tiny-btn danger" type="button">清空本機通知</button></span></div><div class="wt-account-v6-list">'+(items.length?items.map(x=>'<button type="button" class="wt-account-v6-row '+(x.read===true?"":"unread")+'" data-v6-notif="'+esc(x.id||"")+'"><div><strong>'+esc(x.title||"通知")+'</strong><span class="small">'+esc(x.body||"")+'</span><span class="small muted">'+esc(x.createdAt?new Date(Number(x.createdAt)).toLocaleString("zh-TW"):"—")+'</span></div></button>').join(""):'<div class="wt-account-v6-empty">目前沒有通知。</div>')+'</div>');
    b.querySelector("#wtAccountV6ReadAll").onclick=async()=>{const u=user(),d=db(),up={};if(u&&!u.isAnonymous&&d){Object.keys(cloud).forEach(id=>up[id+"/read"]=true);if(Object.keys(up).length)await d.ref("notifications/"+u.uid).update(up).catch(()=>{})}const a=localNotifs();a.forEach(x=>x.read=true);save(NOTIF,a);badge();openNotifications()};
    b.querySelector("#wtAccountV6Clear").onclick=()=>{save(NOTIF,[]);badge();openNotifications()};
    b.querySelectorAll("[data-v6-notif]").forEach(x=>x.onclick=async()=>{const id=String(x.dataset.v6Notif||""),u=user(),d=db();const a=localNotifs();a.forEach(n=>{if(String(n.id||"")===id)n.read=true});save(NOTIF,a);if(u&&!u.isAnonymous&&d)await d.ref("notifications/"+u.uid+"/"+id+"/read").set(true).catch(()=>{});if(cloud[id])cloud[id].read=true;badge();openNotifications()});
  }
  const bind=(id,fn,title)=>{const x=$(id);if(!x||x.dataset.wtAccountV6)return;const y=x.cloneNode(true);y.dataset.wtAccountV6="1";if(title)y.title=title;y.onclick=e=>{e.preventDefault();e.stopImmediatePropagation();Promise.resolve(fn()).catch(err=>toast(err?.message||"操作失敗"))};x.replaceWith(y)};
  function bindUi(){bind("wtSettingsBtn",openSettings,"帳號與設定");bind("wtV3SettingsBtn",openSettings,"帳號與設定");bind("wtHomeSettings",openSettings,"帳號與設定");bind("wtV3NotifBtn",openNotifications,"通知中心");bind("wtFeatureNotificationBtn",openNotifications,"通知中心");const copy=$("copyRoomBtn");if(copy&&!$("wtAccountV6QrBtn")){const b=document.createElement("button");b.id="wtAccountV6QrBtn";b.className="tiny-btn";b.type="button";b.textContent="🔳 QR";b.title="顯示房間 QR Code";b.onclick=()=>{if(typeof wt.createRoomQrCode==="function")Promise.resolve(wt.createRoomQrCode()).catch(e=>toast(e.message||"QR Code 建立失敗"));else {const rid=String(document.body?.dataset?.roomId||window.WT_ROOM_ID||new URLSearchParams(location.search).get("room")||"").toUpperCase();if(!rid)return toast("目前沒有房間");const url=location.origin+location.pathname+"?room="+encodeURIComponent(rid);const m=modal("wtAccountV6QrFallbackModal","房間 QR Code",'<div style="display:grid;gap:10px;text-align:center"><div style="font-size:14px;word-break:break-all">'+esc(url)+'</div><div class="small muted">目前未載入 QR 產生器，請使用上方房間連結或複製網址。</div><button id="wtAccountV6CopyQrUrl" class="primary-btn" type="button">複製房間連結</button></div>');m.querySelector("#wtAccountV6CopyQrUrl").onclick=()=>navigator.clipboard?.writeText(url).then(()=>toast("房間連結已複製")).catch(()=>toast(url))}};copy.insertAdjacentElement("afterend",b)}}
  function cloudWatch(){const u=user(),d=db();if(notifUid===String(u?.uid||"")&&notifRef)return;try{notifRef?.off()}catch(_){}notifRef=null;cloud={};notifUid=String(u?.uid||"");if(!u||u.isAnonymous||!d){badge();return}notifRef=d.ref("notifications/"+u.uid).limitToLast(100);notifRef.once("value").then(s=>{cloud=s.val()||{};badge()}).catch(()=>{});notifRef.on("child_added",s=>{if(s.val())cloud[s.key]=s.val();badge()});notifRef.on("child_changed",s=>{if(s.val())cloud[s.key]=s.val();badge()});notifRef.on("child_removed",s=>{delete cloud[s.key];badge()})}
  function bridge(){const f=wt.pushNotification;if(typeof f!=="function"||f.__wtAccountV6)return;const g=function(){const r=f.apply(this,arguments);setTimeout(badge,0);return r};g.__wtAccountV6=true;wt.pushNotification=g}
  function init(){if(document.documentElement.dataset.wtAccountV6)return;document.documentElement.dataset.wtAccountV6="1";const activeAuth=auth();activeAuth?.onAuthStateChanged?.(()=>{profileLoadUid="";void loadOwnProfile();notifUid="";try{notifRef?.off()}catch(_){}notifRef=null;cloud={};bindUi();cloudWatch();badge()});void loadOwnProfile();const s=document.createElement("style");s.id="wtAccountV6Style";s.textContent=".wt-account-v6-card{width:min(920px,calc(100vw - 24px));max-height:90vh;overflow:auto}.wt-account-v6-head,.wt-account-v6-actions{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}.wt-account-v6-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.wt-account-v6-grid label{display:grid;gap:6px;font-size:12px}.wt-account-v6-grid input,.wt-account-v6-grid select{width:100%;box-sizing:border-box}.wt-account-v6-check{display:flex!important;align-items:center;gap:8px;padding:10px;border:1px solid rgba(148,163,184,.14);border-radius:12px}.wt-account-v6-check input{width:auto!important}.wt-account-v6-list{display:grid;gap:8px;max-height:58vh;overflow:auto;margin-top:12px}.wt-account-v6-row{display:flex;width:100%;justify-content:space-between;gap:10px;padding:11px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:transparent;color:inherit;text-align:left}.wt-account-v6-row.unread{background:rgba(59,130,246,.07)}.wt-account-v6-row>div{display:grid;gap:3px}.wt-account-v6-row .small{display:block;word-break:break-word}.wt-account-v6-empty{text-align:center;padding:18px;color:#94a3b8}.wt-account-v6-note{margin-top:12px;padding:10px;border-radius:12px;background:rgba(59,130,246,.07);color:#94a3b8;font-size:11px}.wt-account-v6-compact .room-controls .control-btn,.wt-account-v6-compact .room-controls .volume{transform:scale(.94);transform-origin:left center}@media(max-width:650px){.wt-account-v6-card{width:calc(100vw - 16px);max-height:88svh;margin:8px auto}.wt-account-v6-grid{grid-template-columns:1fr}.wt-account-v6-grid input,.wt-account-v6-grid select{font-size:16px;min-height:42px}.wt-account-v6-check{min-height:42px}.wt-account-v6-actions{gap:7px}.wt-account-v6-actions>.primary-btn,.wt-account-v6-actions>.secondary-btn{min-height:42px}}";document.head.appendChild(s);bindUi();bridge();cloudWatch();document.documentElement.classList.toggle("wt-account-v6-compact",prefs().compactControls===true)}
  auth()?.onAuthStateChanged?.(()=>{notifUid="";try{notifRef?.off()}catch(_){}notifRef=null;cloud={};bindUi();cloudWatch();badge()});
  wt.openSettings=openSettings;wt.openNotifications=openNotifications;wt.openCompleteSettings=openSettings;wt.openSyncedNotifications=openNotifications;wt.loadAccountSettings=cloudSettings;wt.loadOwnProfile=loadOwnProfile;wt.updateNotificationBadge=badge;
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
