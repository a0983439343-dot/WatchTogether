(() => {
  "use strict";

  const config = window.WATCHTOGETHER_CONFIG || {};
  const adminEmail = String(config.adminEmail || "").trim().toLowerCase();
  const MASTER_EMAIL = "a0983439343@gmail.com";
  const MASTER_UID = "35d45a23-b648-4caf-a6d5-a69112860551";

  let auth = null;
  let db = null;
  let currentUser = null;
  let currentHasAdminAccess = false;
  let currentRole = null;
  let currentRoleSource = "none";
  let currentRolePermissions = {};
  let accounts = {};
  let whitelist = {};
  let blocks = {};
  let rooms = {};
  let reports = {};
  let auditLogs = {};
  let profiles = {};
  let reportsLoadError = "";
  let reportHistory = {};
  let reportScanTimer = null;
  let reportScanRunning = false;
  let autonomousMaintenanceEnabled = false;
  let autonomousMaintenanceRef = null;
  let accountsRef = null;
  let reportsRef = null;
  let auditLogsRef = null;
  let aiStatus = null;
  let chatModerationRoomId = "";
  let chatModerationMessages = {};
  let systemSettings = {};
  let systemSettingsRef = null;

  const $ = id => document.getElementById(id);
  const show = id => $(id)?.classList.remove("hidden");
  const hide = id => $(id)?.classList.add("hidden");

  function toast(message) {
    const el = $("toast");
    if (!el) return;
    el.textContent = String(message || "");
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2400);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  function formatDate(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return "—";
    return new Date(n).toLocaleString("zh-TW", {
      year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"
    });
  }

  function formatRemaining(block) {
    if (!block) return "";
    if (block.permanent === true || Number(block.blockedUntil || 0) === 0) return "永久封鎖";
    const remaining = Number(block.blockedUntil || 0) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return "已過期";
    const minutes = Math.max(1, Math.ceil(remaining / 60000));
    if (minutes >= 1440) return "剩餘 " + Math.ceil(minutes / 1440) + " 天";
    if (minutes >= 60) return "剩餘 " + Math.ceil(minutes / 60) + " 小時";
    return "剩餘 " + minutes + " 分鐘";
  }

  function isActiveBlock(block) {
    if (!block || typeof block !== "object") return false;
    if (block.permanent === true || Number(block.blockedUntil || 0) === 0) return true;
    return Number(block.blockedUntil || 0) > Date.now();
  }

  function isMasterUser(user) {
    if (!user || user.isAnonymous) return false;
    return String(user.uid || "") === MASTER_UID ||
      String(user.email || "").trim().toLowerCase() === MASTER_EMAIL;
  }

  async function resolveAdminRole(user) {
    currentRolePermissions = {};
    currentRoleSource = "none";
    if (!user || user.isAnonymous) return null;
    if (isMasterUser(user)) {
      currentRoleSource = "master";
      return "master";
    }

    try {
      const assignedSnapshot = await db.ref("admin/access/roleByUid/" + user.uid).once("value");
      const assignedRole = String(assignedSnapshot.val() || "").trim();
      if (assignedRole) {
        const roleSnapshot = await db.ref("admin/access/roles/" + assignedRole).once("value");
        const definition = roleSnapshot.val();
        if (definition && definition.permissions && typeof definition.permissions === "object") {
          currentRolePermissions = Object.fromEntries(
            Object.entries(definition.permissions)
              .filter(([, enabled]) => enabled === true)
              .map(([permission]) => [
                permission === "__all__" ? "*" : permission.replace(/__/g, "."),
                true
              ])
          );
          if (currentRolePermissions["admin.read"] === true || currentRolePermissions["*"] === true) {
            currentRoleSource = "custom";
            return assignedRole;
          }
        }
      }
    } catch (error) {
      console.warn("custom admin role resolve failed:", error);
    }

    const [snapshot, blockSnapshot] = await Promise.all([
      db.ref("admin/whitelistByUid/" + user.uid).once("value"),
      db.ref("admin/blocksByUid/" + user.uid).once("value")
    ]);
    const block = blockSnapshot.val();
    if (block && (
      block.permanent === true ||
      Number(block.blockedUntil || 0) > Date.now()
    )) {
      return null;
    }
    const item = snapshot.val();
    if (!item || item.uid !== user.uid || item.enabled !== true) return null;
    currentRoleSource = "whitelist";
    return item.role === "viewer" ? "viewer" : "admin";
  }

  function isAdminOperator() {
    return isMasterOperator() || currentCan("users.update");
  }

  const ROLE_LEVELS = {
    viewer: 1,
    admin: 2,
    master: 3
  };

  function getRoleLevel(role) {
    return ROLE_LEVELS[String(role || "").trim().toLowerCase()] || 0;
  }

  function canCurrentUserSelfUnblock(block, uid) {
    if (!currentUser || !block || String(uid || "") !== String(currentUser.uid || "")) {
      return false;
    }

    if (currentRole === "master") {
      return true;
    }

    const actorLevel = getRoleLevel(currentRole);
    const blockerLevel = getRoleLevel(block.blockedByRole);

    return actorLevel > 0 && blockerLevel > 0 && actorLevel >= blockerLevel;
  }

  async function loadAccounts() {
    if (!currentHasAdminAccess) {
      accounts = {};
      renderAccounts();
      updateStats();
      return;
    }
    const snapshot = await db.ref("accounts").once("value");
    accounts = snapshot.val() || {};
    renderAccounts();
    updateStats();
  }

  function stopAccountsListener() {
    if (!accountsRef) return;
    try { accountsRef.off(); } catch (_) {}
    accountsRef = null;
  }

  function startAccountsListener() {
    stopAccountsListener();
    if (!currentHasAdminAccess) return;
    accountsRef = db.ref("accounts");
    accountsRef.on("value", snapshot => {
      if (!currentHasAdminAccess) return;
      accounts = snapshot.val() || {};
      renderAccounts();
      updateStats();
    }, error => {
      console.error("accounts realtime listener failed", error);
    });
  }

  async function loadWhitelist() {
    const ref = isMasterUser(currentUser)
      ? db.ref("admin/whitelistByUid")
      : db.ref("admin/whitelistByUid/" + currentUser.uid);
    const snapshot = await ref.once("value");
    if (isMasterUser(currentUser)) {
      whitelist = snapshot.val() || {};
    } else {
      const item = snapshot.val();
      whitelist = item ? {[currentUser.uid]: item} : {};
    }
    renderWhitelist();
    updateStats();
  }

  async function loadBlocks() {
    if (!currentHasAdminAccess) {
      blocks = {};
      renderAccounts();
      return;
    }
    const snapshot = await db.ref("admin/blocksByUid").once("value");
    blocks = snapshot.val() || {};
    renderAccounts();
    updateStats();
  }

  async function loadRooms() {
    if (!currentHasAdminAccess) {
      rooms = {};
      renderRooms();
      return;
    }

    const [roomsSnapshot, metaSnapshot, memberSnapshot] = await Promise.all([
      db.ref("rooms").once("value"),
      db.ref("roomMeta").once("value"),
      db.ref("members").once("value").catch(() => null)
    ]);

    const rawRooms = roomsSnapshot.val() || {};
    const rawMeta = metaSnapshot.val() || {};
    const members = memberSnapshot?.val?.() || {};
    const valid = {};

    Object.entries(rawRooms).forEach(([id, item]) => {
      const key = String(id).toUpperCase();
      const meta = rawMeta[id] || rawMeta[key];
      if (!item || !meta || !/^[A-Z0-9]{6}$/.test(key)) return;
      valid[key] = {
        ...item,
        __meta: meta,
        __members: Object.values(members[id] || members[key] || {}).filter(
          member => member && member.online === true
        ).length
      };
    });

    rooms = valid;
    renderRooms();
    updateStats();
  }

  async function loadChatModeration() {
    if (!currentCan("chat.moderate")) {
      chatModerationRoomId = "";
      chatModerationMessages = {};
      renderChatModeration();
      throw new Error("目前沒有 chat.moderate 權限");
    }
    const roomId = String($("chatModerationRoomId")?.value || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(roomId)) {
      throw new Error("請輸入 6 碼房間 ID");
    }
    const snapshot = await db.ref("chat/" + roomId).once("value");
    chatModerationRoomId = roomId;
    chatModerationMessages = snapshot.val() || {};
    renderChatModeration();
  }

  function renderChatModeration() {
    const body = $("chatModerationBody");
    const count = $("chatModerationCount");
    if (!body || !count) return;

    const query = String($("chatModerationSearch")?.value || "").trim().toLowerCase();
    const rows = Object.entries(chatModerationMessages || {})
      .filter(([id,item]) => {
        if (!item || typeof item !== "object") return false;
        const hay = [
          id,
          item.uid,
          item.name,
          item.text,
          item.type,
          item.sticker
        ].join(" ").toLowerCase();
        return !query || hay.includes(query);
      })
      .sort((a,b) => Number(a[1]?.createdAt || 0) - Number(b[1]?.createdAt || 0));

    count.textContent = rows.length + " 筆";
    body.innerHTML = rows.length
      ? rows.map(([id,item]) => {
          const type = String(item.type || "text");
          let content = "";
          if (type === "image") content = "📷 圖片";
          else if (type === "audio") content = "🎤 語音";
          else if (type === "sticker") content = "貼圖：" + String(item.sticker || "");
          else content = String(item.text || "");
          return '<tr>' +
            '<td><span class="small">' + escapeHtml(formatDate(item.createdAt)) + '</span></td>' +
            '<td><div class="primary-text">' + escapeHtml(item.name || "—") + '</div><span class="small uid-text">' + escapeHtml(item.uid || "") + '</span></td>' +
            '<td><span class="chat-type">' + escapeHtml(type) + '</span></td>' +
            '<td class="chat-moderation-content">' + escapeHtml(content) + '</td>' +
            '<td>' + (currentCan("chat.moderate")
              ? '<button class="btn danger" type="button" data-chat-delete="' + escapeHtml(id) + '">🗑️ 刪除</button>'
              : '<span class="muted">僅可查看</span>') + '</td>' +
          '</tr>';
        }).join("")
      : '<tr><td colspan="5" class="muted">目前沒有符合條件的聊天訊息。</td></tr>';

    body.querySelectorAll("[data-chat-delete]").forEach(button => {
      button.addEventListener("click", () => deleteChatModerationMessage(button.dataset.chatDelete)
        .catch(error => {
          console.error(error);
          toast(error?.message || "刪除聊天訊息失敗");
        }));
    });
  }

  async function deleteChatModerationMessage(messageId) {
    if (!currentCan("chat.moderate")) throw new Error("目前沒有 chat.moderate 權限");
    const roomId = String(chatModerationRoomId || "").trim().toUpperCase();
    const id = String(messageId || "").trim();
    const item = chatModerationMessages?.[id];
    if (!/^[A-Z0-9]{6}$/.test(roomId) || !id || !item) throw new Error("找不到要刪除的聊天訊息");

    const confirmed = window.confirm(
      "確定要刪除這則聊天訊息嗎？\n\n" +
      "使用者：" + String(item.name || item.uid || "—") + "\n" +
      "內容：" + String(item.text || (item.type === "image" ? "圖片" : item.type === "audio" ? "語音" : item.sticker || item.type || "—")).slice(0, 300)
    );
    if (!confirmed) return;

    await db.ref("chat/" + roomId + "/" + id).remove();
    await writeAuditLog(
      "chat.message.delete",
      String(item.uid || ""),
      String(item.name || item.uid || ""),
      "房間 " + roomId + " 刪除聊天訊息 " + id
    );
    delete chatModerationMessages[id];
    renderChatModeration();
    toast("聊天訊息已刪除，操作已記錄");
  }

  function renderRooms() {
    const query = String($("roomSearch")?.value || "").trim().toLowerCase();
    const accountByUid = {};
    Object.values(accounts || {}).forEach(item => {
      if (item && item.uid) accountByUid[item.uid] = item;
    });

    const rows = Object.entries(rooms || {})
      .filter(([id, item]) => {
        if (!item || !/^[A-Z0-9]{6}$/.test(String(id).toUpperCase())) return false;
        const owner = accountByUid[item.owner]?.email || item.owner || "";
        const meta = item.__meta || {};
        const hay = [
          id, item.name, meta.name, owner, item.sourceType,
          item.video?.title, item.video?.platform
        ].join(" ").toLowerCase();
        return !query || hay.includes(query);
      })
      .sort((a,b) => Number(b[1].__meta?.createdAt || b[1].createdAt || 0) -
                      Number(a[1].__meta?.createdAt || a[1].createdAt || 0));

    $("roomCount").textContent = rows.length + " 間";
    $("roomsBody").innerHTML = rows.length
      ? rows.map(([id,item]) => {
          const key = String(id).toUpperCase();
          const owner = accountByUid[item.owner];
          const meta = item.__meta || {};
          const members = Number(item.__members || 0);
          const platform = String(item.video?.platform || item.sourceType || "—");
          const title = String(item.video?.title || "目前沒有影片");
          const href = "../?room=" + encodeURIComponent(key) + "&adminJoin=1";
          return '<tr>' +
            '<td><div class="primary-text">' + escapeHtml(item.name || meta.name || "一起看") + '</div><span class="small">房間碼：' + escapeHtml(key) + '</span></td>' +
            '<td>' + escapeHtml(owner?.email || item.owner || "—") + '</td>' +
            '<td><strong>' + members + '</strong></td>' +
            '<td><span class="small">' + escapeHtml(platform) + ' · ' + escapeHtml(title) + '</span></td>' +
            '<td>' + escapeHtml(formatDate(meta.createdAt || item.createdAt)) + '</td>' +
            '<td><div class="room-actions"><a class="btn primary" href="' + href + '">🚪 進入房間</a>' +
              (currentCan("rooms.manage") ? '<button class="btn danger" type="button" data-room-delete="' + escapeHtml(key) + '">🗑️ 刪除</button>' : '<span class="muted">僅可查看</span>') +
              '</div></td>' +
          '</tr>';
        }).join("")
      : '<tr><td colspan="6" class="muted">目前沒有符合條件的房間。</td></tr>';

    $("roomsBody").querySelectorAll("[data-room-delete]").forEach(button => {
      button.addEventListener("click", () => deleteRoom(button.dataset.roomDelete)
        .catch(error => { console.error(error); toast(error?.message || "刪除房間失敗"); }));
    });
  }

  function renderAccounts() {
    const query = String($("accountSearch")?.value || "").trim().toLowerCase();
    const rows = Object.values(accounts || {})
      .filter(item => {
        if (!item) return false;
        const hay = [item.email,item.displayName,item.uid,item.provider].join(" ").toLowerCase();
        return !query || hay.includes(query);
      })
      .sort((a,b) => Number(b.lastLoginAt || 0) - Number(a.lastLoginAt || 0));

    $("accountCount").textContent = rows.length + " 筆";
    $("accountsBody").innerHTML = rows.length
      ? rows.map(item => {
          const uid = String(item.uid || "");
          const master = uid === MASTER_UID || String(item.email || "").trim().toLowerCase() === MASTER_EMAIL;
          const block = blocks[uid];
          const active = isActiveBlock(block);
          const status = master
            ? '<span class="status admin">最高管理員</span>'
            : active
              ? '<span class="status off">已封鎖 · ' + escapeHtml(formatRemaining(block)) + '</span>'
              : '<span class="status">正常</span>';

          const canManage = currentCan("users.update");
          let actions = '<div class="row-actions">';
          if (master) {
            actions += '<span class="muted">最高管理員</span>';
          } else if (!canManage) {
            actions += '<span class="muted">僅可查看</span>';
          } else {
            actions += '<button class="btn" type="button" data-edit-user="' + escapeHtml(uid) + '">✏️ 編輯</button>';
            if (active) {
              if (uid === currentUser?.uid && !canCurrentUserSelfUnblock(block, uid)) {
                actions += '<button class="btn" type="button" disabled title="封鎖者權限比自己高，不能自行解除">無法自行解除</button>';
              } else if (uid === currentUser?.uid) {
                actions += '<button class="btn" type="button" data-unblock-user="' + escapeHtml(uid) + '">解除自己的封鎖</button>';
              } else {
                actions += '<button class="btn" type="button" data-unblock-user="' + escapeHtml(uid) + '">解除封鎖</button>';
              }
            } else {
              actions += '<button class="btn danger" type="button" data-block-user="' + escapeHtml(uid) + '">封鎖</button>';
            }
          }
          actions += '</div>';

          return '<tr>' +
            '<td><div class="primary-text">' + escapeHtml(item.email || "—") + '</div><span class="small">' + (item.emailVerified === true ? "Email 已驗證" : "Email 未驗證") + '</span></td>' +
            '<td>' + escapeHtml(item.displayName || "—") + '</td>' +
            '<td><div class="row-actions"><span class="small uid-text">' + escapeHtml(uid) + '</span><button class="btn" type="button" data-copy-uid="' + escapeHtml(uid) + '">複製 UID</button></div></td>' +
            '<td>' + status + '</td>' +
            '<td>' + escapeHtml(item.provider || "—") + '</td>' +
            '<td>' + escapeHtml(formatDate(item.lastLoginAt)) + '</td>' +
            '<td>' + actions + '</td>' +
          '</tr>';
        }).join("")
      : '<tr><td colspan="7" class="muted">沒有符合條件的帳號。</td></tr>';

    $("accountsBody").querySelectorAll("[data-edit-user]").forEach(button => {
      button.addEventListener("click", () => openEditUser(button.dataset.editUser)
        .catch(error => { console.error(error); toast("載入使用者資料失敗"); }));
    });
    $("accountsBody").querySelectorAll("[data-block-user]").forEach(button => {
      button.addEventListener("click", () => openBlockUser(button.dataset.blockUser));
    });
    $("accountsBody").querySelectorAll("[data-unblock-user]").forEach(button => {
      button.addEventListener("click", () => unblockUser(button.dataset.unblockUser)
        .catch(error => { console.error(error); toast(error?.message || "解除封鎖失敗"); }));
    });
    $("accountsBody").querySelectorAll("[data-copy-uid]").forEach(button => {
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(button.dataset.copyUid || "");
          toast("UID 已複製");
        } catch (error) {
          console.error(error);
          toast("複製 UID 失敗，請手動複製");
        }
      });
    });
  }

  function renderWhitelist() {
    const master = isMasterUser(currentUser);
    const query = String($("whitelistSearch")?.value || "").trim().toLowerCase();
    const rows = Object.entries(whitelist || {})
      .map(([key,item]) => ({key,item}))
      .filter(({item}) => item && (!query || String(item.email || "").toLowerCase().includes(query)))
      .sort((a,b) => Number(b.item.addedAt || 0) - Number(a.item.addedAt || 0));

    $("whitelistCount").textContent = rows.length + " 筆";
    $("whitelistBody").innerHTML = rows.length
      ? rows.map(({key,item}) => {
          const enabled = item.enabled === true;
          const role = item.role === "viewer" ? "viewer" : "admin";
          const roleLabel = role === "viewer" ? "觀察員" : "管理員";
          const actions = master
            ? '<div class="row-actions"><select class="search" data-role-select="' + escapeHtml(key) + '" aria-label="權限級別"><option value="admin"' + (role === "admin" ? " selected" : "") + '>管理員</option><option value="viewer"' + (role === "viewer" ? " selected" : "") + '>觀察員</option></select><button class="btn" data-role-save="' + escapeHtml(key) + '">套用</button><button class="btn" data-toggle="' + escapeHtml(key) + '">' + (enabled ? "停用" : "啟用") + '</button><button class="btn" data-remove="' + escapeHtml(key) + '">刪除</button></div>'
            : '<span class="muted">僅最高管理員可管理</span>';
          return '<tr><td><div class="primary-text">' + escapeHtml(item.email || "—") + '</div><span class="small uid-text">' + escapeHtml(item.uid || key) + '</span></td><td><span class="status admin">' + escapeHtml(roleLabel) + '</span></td><td><span class="status ' + (enabled ? "" : "off") + '">' + (enabled ? "啟用" : "停用") + '</span></td><td>' + escapeHtml(formatDate(item.addedAt)) + '</td><td>' + escapeHtml(item.addedByEmail || "—") + '</td><td>' + actions + '</td></tr>';
        }).join("")
      : '<tr><td colspan="5" class="muted">目前沒有白名單帳號。</td></tr>';

    $("whitelistBody").querySelectorAll("[data-role-save]").forEach(btn =>
      btn.addEventListener("click", () => changeWhitelistRole(btn.dataset.roleSave).catch(error => { console.error(error); toast(error?.message || "權限更新失敗"); }))
    );
    $("whitelistBody").querySelectorAll("[data-toggle]").forEach(btn =>
      btn.addEventListener("click", () => toggleWhitelist(btn.dataset.toggle).catch(error => { console.error(error); toast("操作失敗"); }))
    );
    $("whitelistBody").querySelectorAll("[data-remove]").forEach(btn =>
      btn.addEventListener("click", () => removeWhitelist(btn.dataset.remove).catch(error => { console.error(error); toast("刪除失敗"); }))
    );
  }

  const AUDIT_ACTION_LABELS = {
    block: "封鎖",
    unblock: "解除封鎖",
    "user.update": "編輯使用者",
    "room.delete": "刪除房間",
    "report.status": "處理回報",
    "report.delete": "刪除回報",
    "whitelist.add": "加入白名單",
    "whitelist.role": "調整白名單角色",
    "whitelist.toggle": "啟用 / 停用白名單",
    "whitelist.remove": "移除白名單",
    "access.role.create": "建立自訂角色",
    "access.role.delete": "刪除自訂角色",
    "access.role.assign": "指派自訂角色",
    "access.role.unassign": "解除自訂角色",
    "access.role.full_admin": "授予完整管理權限",
    "access.permission.override": "設定個人 Allow / Deny",
    "access.permission.clear": "移除個人權限覆寫",
    "access.user.restriction": "設定使用者功能限制",
    "access.user.restriction.clear": "解除使用者功能限制",
    "feature.flag": "更新 Feature Flag",
    "feature.flag.delete": "刪除 Feature Flag",
    "maintenance.on": "進入網站維護模式",
    "maintenance.off": "重新開站",
    "maintenance.toggle": "切換全自動維護",
    "system.settings.update": "更新系統設定",
    "ai.analyze": "AI 分析",
    "ai.agent": "AI Agent 操作",
    "audit.delete": "刪除操作紀錄"
  };

  function refreshAuditActionFilter() {
    const select = $("auditActionFilter");
    if (!select) return;
    const current = String(select.value || "all");
    const actions = new Set(Object.keys(AUDIT_ACTION_LABELS));
    Object.values(auditLogs || {}).forEach(item => {
      const action = String(item?.action || "").trim();
      if (action) actions.add(action);
    });
    const optionKeys = ["all", ...Array.from(actions).filter(action => action !== "all").sort()];
    const currentKeys = Array.from(select.options || []).map(option => String(option.value || ""));
    if (currentKeys.length === optionKeys.length && currentKeys.every((key, index) => key === optionKeys[index])) {
      return;
    }
    select.innerHTML = '<option value="all">全部操作</option>' +
      optionKeys.slice(1).map(action =>
        '<option value="' + escapeHtml(action) + '">' +
        escapeHtml(AUDIT_ACTION_LABELS[action] || action) +
        '</option>'
      ).join("");
    select.value = optionKeys.includes(current) ? current : "all";
  }

  function stopAuditLogsListener() {
    if (!auditLogsRef) return;
    try { auditLogsRef.off(); } catch (_) {}
    auditLogsRef = null;
  }


  function renderAutonomousMaintenance() {
    const panel = $("autonomousMaintenancePanel");
    const toggle = $("autonomousMaintenanceToggle");
    const status = $("autonomousMaintenanceStatus");
    const hint = $("autonomousMaintenanceHint");
    if (!panel || !toggle || !status || !hint) return;
    const enabled = autonomousMaintenanceEnabled === true;
    toggle.checked = enabled;
    toggle.disabled = !isMasterOperator();
    panel.classList.toggle("is-enabled", enabled);
    panel.classList.toggle("is-disabled", !enabled);
    status.textContent = enabled ? "已啟用 · 全自動維護中" : "未啟用";
    hint.textContent = enabled
      ? "符合條件的 Bug 會自動進入修復流程，不會要求人工確認。"
      : (currentRole === "master"
        ? "目前需要人工確認後才會開始修復。只有你可以切換此設定。"
        : "目前需要人工確認後才會開始修復；此設定只有最高管理員可以切換。");
  }

  function stopAutonomousMaintenanceListener() {
    if (!autonomousMaintenanceRef) return;
    try { autonomousMaintenanceRef.off(); } catch (_) {}
    autonomousMaintenanceRef = null;
  }

  async function loadAutonomousMaintenance() {
    if (!currentHasAdminAccess) {
      autonomousMaintenanceEnabled = false;
      renderAutonomousMaintenance();
      return;
    }
    const snapshot = await db.ref("admin/autonomousMaintenance").once("value");
    const value = snapshot.val();
    autonomousMaintenanceEnabled = value === true || value?.enabled === true;
    renderAutonomousMaintenance();
  }

  function startAutonomousMaintenanceListener() {
    stopAutonomousMaintenanceListener();
    if (!currentHasAdminAccess) return;
    autonomousMaintenanceRef = db.ref("admin/autonomousMaintenance");
    autonomousMaintenanceRef.on("value", snapshot => {
      if (!currentHasAdminAccess) return;
      const value = snapshot.val();
      autonomousMaintenanceEnabled = value === true || value?.enabled === true;
      renderAutonomousMaintenance();
      renderReports();
    }, error => {
      console.error("autonomous maintenance listener failed", error);
    });
  }

  async function setAutonomousMaintenance(enabled) {
    if (!isMasterOperator()) {
      renderAutonomousMaintenance();
      throw new Error("只有最高管理員可以切換全自動維護");
    }
    const next = enabled === true;
    const warningText = next
      ? "啟用全自動維護後，符合條件的 Bug 會自動分析、修改、部署、驗證，無需人工確認。\n\n確定要啟用全自動維護嗎？"
      : "停用全自動維護後，系統將恢復需要人工確認才能開始修復的模式。\n\n確定要停用全自動維護嗎？";
    if (!window.confirm(warningText)) {
      renderAutonomousMaintenance();
      return;
    }
    await writeAuditedUpdates({
      ["admin/autonomousMaintenance"]: {
        enabled:next,
        updatedAt:firebase.database.ServerValue.TIMESTAMP,
        updatedByUid:currentUser.uid,
        updatedByEmail:currentUser.email || ""
      }
    },"maintenance.toggle",currentUser.uid,"全自動維護",next ? "啟用全自動維護" : "停用全自動維護");
    autonomousMaintenanceEnabled = next;
    renderAutonomousMaintenance();
    toast(next ? "已啟用全自動維護" : "已停用全自動維護");
  }
  function buildAuditEntry(action, targetUid, targetName, details) {
    return {
      action:String(action || "other").slice(0,40),
      actorUid:String(currentUser?.uid || "").slice(0,128),
      actorEmail:String(currentUser?.email || "").slice(0,320),
      actorRole:String(currentRole || "").slice(0,40),
      targetUid:String(targetUid || "").slice(0,128),
      targetName:String(targetName || "").slice(0,200),
      details:String(details || "").slice(0,1000),
      createdAt:firebase.database.ServerValue.TIMESTAMP
    };
  }

  async function writeAuditedUpdates(updates, action, targetUid, targetName, details) {
    const normalizedAction = String(action || "other").slice(0,40);
    const canWrite = currentCan("audit.write") ||
      (normalizedAction === "audit.delete" && currentCan("audit.delete"));
    if (!currentUser || !canWrite) {
      throw new Error("目前沒有足夠的 Audit 權限");
    }
    const auditRef = db.ref("admin/auditLogs").push();
    const auditId = auditRef.key;
    if (!auditId) throw new Error("無法建立 Audit Log ID");
    const next = {...(updates || {})};
    next["admin/auditLogs/" + auditId] = buildAuditEntry(
      normalizedAction,
      targetUid,
      targetName,
      details
    );
    await db.ref().update(next);
    return auditId;
  }

  async function writeAuditLog(action, targetUid, targetName, details) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await writeAuditedUpdates({}, action, targetUid, targetName, details);
        return true;
      } catch (error) {
        if (attempt === 3) {
          console.warn("寫入管理員操作紀錄失敗:", error);
          return false;
        }
        await new Promise(resolve => setTimeout(resolve, 250 * attempt));
      }
    }
    return false;
  }
  async function loadAuditLogs() {
    if (!currentHasAdminAccess) {
      auditLogs = {};
      renderAuditLogs();
      return;
    }
    const snapshot = await db.ref("admin/auditLogs").limitToLast(300).once("value");
    auditLogs = snapshot.val() || {};
    refreshAuditActionFilter();
    renderAuditLogs();
  }

  function startAuditLogsListener() {
    stopAuditLogsListener();
    if (!currentHasAdminAccess) return;
    auditLogsRef = db.ref("admin/auditLogs").limitToLast(300);
    auditLogsRef.on("value", snapshot => {
      if (!currentHasAdminAccess) return;
      auditLogs = snapshot.val() || {};
      refreshAuditActionFilter();
      renderAuditLogs();
    }, error => {
      console.error("audit logs realtime listener failed", error);
    });
  }

  async function deleteAuditLog(id) {
    if (!currentCan("audit.delete")) {
      toast("目前沒有 audit.delete 權限");
      return;
    }
    const key = String(id || "").trim();
    if (!key || !auditLogs?.[key]) {
      toast("找不到這筆操作紀錄");
      return;
    }
    const item = auditLogs[key];
    const label = AUDIT_ACTION_LABELS[String(item.action || "other")] || String(item.action || "other");
    const confirmed = window.confirm(
      "確定要刪除這筆操作紀錄嗎？\n\n" +
      "時間：" + formatDate(item.createdAt) + "\n" +
      "操作：" + label + "\n" +
      "內容：" + String(item.details || "—").slice(0, 300) + "\n\n" +
      "刪除後無法復原。"
    );
    if (!confirmed) return;

    const auditRef = db.ref("admin/auditLogs").push();
    const auditId = auditRef.key;
    if (!auditId) throw new Error("無法建立刪除操作紀錄");

    const auditEntry = {
      action: "audit.delete",
      actorUid: String(currentUser?.uid || ""),
      actorEmail: String(currentUser?.email || "").slice(0,320),
      actorRole: String(currentRole || "").slice(0,20),
      targetUid: String(item.targetUid || "").slice(0,128),
      targetName: String(item.targetName || "操作紀錄").slice(0,200),
      details: "刪除操作紀錄 " + key + "（原操作：" + label + "）",
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    const updates = {};
    updates["admin/auditLogs/" + key] = null;
    updates["admin/auditLogs/" + auditId] = auditEntry;
    await db.ref().update(updates);
    delete auditLogs[key];
    renderAuditLogs();
    toast("操作紀錄已刪除，刪除動作已留下紀錄");
  }

  function renderAuditLogs() {
    refreshAuditActionFilter();
    const query = String($("auditSearch")?.value || "").trim().toLowerCase();
    const filter = String($("auditActionFilter")?.value || "all");
    const userFilter = String($("auditUserFilter")?.value || "").trim().toLowerCase();
    const fromRaw = String($("auditFrom")?.value || "").trim();
    const toRaw = String($("auditTo")?.value || "").trim();
    const fromTime = fromRaw ? new Date(fromRaw).getTime() : 0;
    const toTime = toRaw ? new Date(toRaw).getTime() : 0;
    const rows = Object.entries(auditLogs || {})
      .filter(([id,item]) => {
        if (!item || typeof item !== "object") return false;
        const action = String(item.action || "other");
        if (filter !== "all" && action !== filter) return false;
        const createdAt = Number(item.createdAt || 0);
        if (fromTime > 0 && (!Number.isFinite(createdAt) || createdAt < fromTime)) return false;
        if (toTime > 0 && (!Number.isFinite(createdAt) || createdAt > toTime)) return false;
        if (userFilter) {
          const userHay = [
            item.actorEmail,item.actorUid,item.targetName,item.targetUid
          ].join(" ").toLowerCase();
          if (!userHay.includes(userFilter)) return false;
        }
        const hay = [
          id,item.actorEmail,item.actorUid,item.actorRole,
          item.targetName,item.targetUid,item.details,
          AUDIT_ACTION_LABELS[action] || action
        ].join(" ").toLowerCase();
        return !query || hay.includes(query);
      })
      .sort((a,b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0));

    $("auditCount").textContent = rows.length + " 筆";
    $("auditBody").innerHTML = rows.length
      ? rows.map(([id,item]) => {
          const action = String(item.action || "other");
          const label = AUDIT_ACTION_LABELS[action] || action;
          const actor = String(item.actorEmail || item.actorUid || "—");
          const target = String(item.targetName || item.targetUid || "—");
          const canDelete = currentCan("audit.delete");
          return '<tr>' +
            '<td><span class="small">' + escapeHtml(formatDate(item.createdAt)) + '</span></td>' +
            '<td><div class="primary-text">' + escapeHtml(actor) + '</div><span class="small">' + escapeHtml(item.actorRole || "") + '</span></td>' +
            '<td><span class="audit-action">' + escapeHtml(label) + '</span></td>' +
            '<td class="audit-target"><div class="primary-text">' + escapeHtml(target) + '</div><span class="small">' + escapeHtml(item.targetUid || "") + '</span></td>' +
            '<td class="audit-content">' + escapeHtml(item.details || "") + '</td>' +
            '<td><div class="row-actions">' + (canDelete ? '<button class="btn danger" type="button" data-audit-delete="' + escapeHtml(id) + '">🗑️ 刪除</button>' : '<span class="muted">僅可查看</span>') + '</div></td>' +
          '</tr>';
        }).join("")
      : '<tr><td colspan="6" class="muted">目前沒有操作紀錄。</td></tr>';

    $("auditBody").querySelectorAll("[data-audit-delete]").forEach(button => {
      button.addEventListener("click", () => deleteAuditLog(button.dataset.auditDelete)
        .catch(error => { console.error(error); toast(error?.message || "刪除操作紀錄失敗"); }));
    });
  }

  function getBugServiceBase() {
    try {
      const explicit = String(config.youtubeStreamProxyUrl || config.youtubeSearchProxyUrl || "").trim();
      if (!explicit) return "";
      return explicit.replace(/\/+search\/?$/, "").replace(/\/+$/, "");
    } catch (_) {
      return "";
    }
  }

  function getBugVerifyEndpoint() {
    const base = getBugServiceBase();
    return base ? base + "/verify" : "";
  }

  function getBugAiEndpoint() {
    const explicit = String(config.aiBugDetectorUrl || "").trim();
    if (explicit) return explicit;
    const base = getBugServiceBase();
    return base ? base + "/ai/analyze" : "";
  }

  function reportSourceLabel(item) {
    if (item?.source === "scanner" || item?.autoScanner === true) return "系統掃描";
    if (item?.source === "auto" || item?.autoDetected === true) return "自動偵測";
    return "使用者回報";
  }

  function buildReportFingerprint(category, details, prefix = "scanner") {
    let h = 2166136261;
    const value = String(prefix + "|" + category + "|" + details).slice(0, 3000);
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return prefix + "-" + (h >>> 0).toString(16);
  }

  async function runBugServiceVerify(category = "all") {
    const endpoint = getBugVerifyEndpoint();
    if (!endpoint) throw new Error("尚未設定 Bug 驗證服務");
    const url = endpoint + "?category=" + encodeURIComponent(category);
    const response = await fetch(url,{method:"GET",cache:"no-store",credentials:"omit"});
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok) {
      const error = new Error(String(result?.error || "網站自動檢查未通過"));
      error.result = result;
      throw error;
    }
    return result;
  }

  async function analyzeReportOnAdmin(id, report, verification, phase = "admin_review") {
    const endpoint = getBugAiEndpoint();
    if (!endpoint) return null;
    let idToken = "";
    try {
      idToken = await currentUser.getIdToken();
    } catch (_) {}
    if (!idToken) throw new Error("管理員登入驗證尚未準備完成");
    const response = await fetch(endpoint,{
      method:"POST",
      cache:"no-store",
      credentials:"omit",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer " + idToken
      },
      body:JSON.stringify({
        phase,
        report:{
          category:String(report?.category || "other"),
          details:String(report?.details || "").slice(0,2000),
          fingerprint:String(report?.fingerprint || "").slice(0,100),
          buildVersion:String(report?.buildVersion || "").slice(0,120),
          source:report?.source || "manual",
          occurrences:Number(report?.occurrences || 1) || 1,
          createdAt:Number(report?.createdAt || 0)
        },
        evidence:{
          deployment:verification || {},
          adminPage:{
            url:location.href,
            pageReady:document.readyState,
            reportId:id
          }
        },
        current:{
          page:location.href,
          buildVersion:location.pathname,
          healthy:verification?.ok === true
        }
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result?.ok || !result?.analysis || result?.degraded === true) {
      throw new Error(String(result?.error || result?.analysis?.summary || "AI 分析目前不可用"));
    }
    void writeAuditLog(
      "ai.analyze",
      String(report?.uid || ""),
      String(id || "問題回報"),
      "AI " + String(phase || "admin_review") + " 分析完成"
    );
    return result;
  }

  async function writeReportHistory(id,event,details,source = "admin") {
    if (!id || !currentUser) return false;
    const allowedSource = ["watchdog","admin","autonomous_repair"].includes(String(source || "").trim())
      ? String(source).trim()
      : "admin";
    try {
      await db.ref("reportHistoryEvents/" + id).push({
        reportId:String(id).slice(0,128),
        event,
        createdAt:firebase.database.ServerValue.TIMESTAMP,
        actorUid:currentUser.uid,
        actorEmail:currentUser.email || "",
        source:allowedSource,
        details:String(details || "").slice(0,500)
      });
      return true;
    } catch (error) {
      console.warn("report history write failed",error);
      return false;
    }
  }

  async function upsertScannerFinding(finding, scanResult) {
    if (!currentUser || !isAdminOperator() || finding?.ok === true) return null;
    const categoryMap = {
      playback:"playback",
      search:"search",
      room:"room",
      chat:"chat",
      account:"account",
      ui:"ui"
    };
    const category = categoryMap[finding.name] || "other";
    const details = [
      "自動網站掃描發現問題",
      "檢查項目：" + String(finding.name || "unknown"),
      finding.status ? "HTTP：" + finding.status : "",
      Array.isArray(finding.missing) && finding.missing.length ? "缺少：" + finding.missing.join(", ") : "",
      Array.isArray(finding.forbidden) && finding.forbidden.length ? "禁止內容出現：" + finding.forbidden.join(", ") : "",
      finding.error ? "錯誤：" + finding.error : ""
    ].filter(Boolean).join("\n");
    const fingerprint = buildReportFingerprint(category,details);
    const existingEntry = Object.entries(reports || {}).find(([id,item]) =>
      item && (item.source === "scanner" || item.autoScanner === true) &&
      String(item.fingerprint || "") === fingerprint
    );
    if (existingEntry) {
      const [id,item] = existingEntry;
      await db.ref("reports/" + id).update({
        lastSeenAt:firebase.database.ServerValue.TIMESTAMP,
        occurrences:Math.max(1,Number(item.occurrences || 0) + 1),
        scanBuildVersion:String(scanResult?.buildVersion || ""),
        scanCheckedAt:firebase.database.ServerValue.TIMESTAMP,
        status:item.status === "resolved" ? "open" : normalizeReportStatus(item.status)
      });
      return id;
    }

    const ref = db.ref("reports").push();
    const id = ref.key;
    await ref.set({
      uid:currentUser.uid,
      category,
      details,
      roomId:"",
      page:String(scanResult?.site || location.href).slice(0,1000),
      userAgent:"server-verification",
      status:"open",
      source:"scanner",
      autoScanner:true,
      autoVerifyEnabled:true,
      fingerprint,
      buildVersion:String(scanResult?.buildVersion || "").slice(0,100),
      occurrences:1,
      firstSeenAt:firebase.database.ServerValue.TIMESTAMP,
      lastSeenAt:firebase.database.ServerValue.TIMESTAMP,
      createdAt:firebase.database.ServerValue.TIMESTAMP,
      verificationState:"failed"
    });
    await writeReportHistory(id,"scanner_detected","系統網站掃描發現：" + String(finding.name || "unknown"),"watchdog");
    return id;
  }

  const ADMIN_AI_REFRESH_MS = 30 * 60 * 1000;

  async function scanUserReports(limit = 5) {
    const entries = Object.entries(reports || {})
      .filter(([,item]) => item && (item.source === "manual" || item.source === "auto") && normalizeReportStatus(item.status) !== "resolved")
      .sort((a,b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0))
      .slice(0,limit);

    for (const [id,item] of entries) {
      try {
        const verification = await runBugServiceVerify(String(item.category || "other"));
        let result = null;
        let analysis = null;
        const lastAiAt = Number(item.aiCheckedAt || 0);
        if (!lastAiAt || Date.now() - lastAiAt >= ADMIN_AI_REFRESH_MS) {
          result = await analyzeReportOnAdmin(id,item,verification,"admin_review");
          analysis = result?.analysis || null;
        }
        const verificationData = {
          state:verification.ok ? "passed" : "failed",
          checkedAt:firebase.database.ServerValue.TIMESTAMP,
          deterministicPassed:verification.ok === true,
          deploymentStatus:verification.status || "",
          deploymentChecks:Array.isArray(verification.checks) ? verification.checks : [],
          buildVersion:String(verification.buildVersion || ""),
          mode:"admin_auto_scan"
        };
        const updates = {
          verification:verificationData,
          verificationState:verification.ok ? "passed" : "failed",
          ...(result ? {
            aiCheckedAt:firebase.database.ServerValue.TIMESTAMP,
            aiStatus:String(analysis?.status || "inconclusive"),
            aiConfidence:Number(analysis?.confidence || 0),
            aiTitle:String(analysis?.title || "").slice(0,220),
            aiSummary:String(analysis?.summary || "").slice(0,900),
            aiRootCause:String(analysis?.rootCause || "").slice(0,900),
            aiSuggestion:String(analysis?.suggestion || "").slice(0,900),
            aiModel:String(result?.model || "").slice(0,100),
            aiError:null
          } : {})
        };
        await db.ref("reports/" + id).update(updates);
      } catch (error) {
        await db.ref("reports/" + id).update({
          verificationState:"failed",
          aiStatus:"unavailable",
          aiError:String(error?.message || "自動檢查失敗").slice(0,500),
          aiCheckedAt:firebase.database.ServerValue.TIMESTAMP,
          verificationCheckedAt:firebase.database.ServerValue.TIMESTAMP
        }).catch(() => {});
      }
    }
  }

  async function scanWebsiteAndReports() {
    if (!currentHasAdminAccess || !isAdminOperator() || reportScanRunning) return;
    reportScanRunning = true;
    const banner = $("reportScanBanner");
    if (banner) {
      banner.classList.remove("hidden");
      banner.textContent = "🔎 正在自動檢查網站與近期回報…";
    }
    try {
      const result = await runBugServiceVerify("all");
      const findings = Array.isArray(result?.checks) ? result.checks.filter(check => check && check.ok !== true) : [];
      for (const finding of findings.slice(0,3)) {
        const id = await upsertScannerFinding(finding,result);
        if (id) {
          try {
            const item = (await db.ref("reports/" + id).once("value")).val() || reports[id] || {};
            const lastAiAt = Number(item?.aiCheckedAt || 0);
            if (lastAiAt && Date.now() - lastAiAt < ADMIN_AI_REFRESH_MS) continue;
            const ai = await analyzeReportOnAdmin(id,item,result,"scanner");
            if (ai?.analysis) {
              await db.ref("reports/" + id).update({
                aiStatus:String(ai.analysis.status || "inconclusive"),
                aiConfidence:Number(ai.analysis.confidence || 0),
                aiTitle:String(ai.analysis.title || "").slice(0,220),
                aiSummary:String(ai.analysis.summary || "").slice(0,900),
                aiRootCause:String(ai.analysis.rootCause || "").slice(0,900),
                aiSuggestion:String(ai.analysis.suggestion || "").slice(0,900),
                aiModel:String(ai.model || "").slice(0,100),
                aiCheckedAt:firebase.database.ServerValue.TIMESTAMP,
                aiError:null
              });
            }
          } catch (error) {
            await db.ref("reports/" + id).update({
              aiStatus:"unavailable",
              aiError:String(error?.message || "AI 分析失敗").slice(0,500),
              aiCheckedAt:firebase.database.ServerValue.TIMESTAMP
            }).catch(() => {});
          }
        }
      }

      await scanUserReports(2);

      if (banner) {
        banner.textContent = findings.length
          ? "⚠️ 自動掃描發現 " + findings.length + " 個需要查看的問題；系統已建立／更新回報。"
          : "✅ 自動掃描目前沒有發現結構性網站問題；近期使用者回報也已重新分析。";
      }
    } catch (error) {
      const result = error?.result || {};
      const findings = Array.isArray(result?.checks) ? result.checks.filter(check => check && check.ok !== true) : [];
      for (const finding of findings.slice(0,10)) {
        try { await upsertScannerFinding(finding,result); } catch (_) {}
      }
      if (banner) banner.textContent = "⚠️ 自動掃描沒有完全通過，已把可辨識問題放入問題回報。";
      console.error("automatic site scan failed",error);
    } finally {
      renderReports();
      updateStats();
      reportScanRunning = false;
    }
  }

  function startReportAutomation() {
    if (reportScanTimer) clearInterval(reportScanTimer);
    if (!currentHasAdminAccess || !isAdminOperator()) return;
    void scanWebsiteAndReports();
    reportScanTimer = setInterval(() => void scanWebsiteAndReports(), 90000);
  }

  async function repairDecisionStart() {
    if (!isAdminOperator()) return;
    const id = String($("reportId").value || "").trim();
    const item = reports[id];
    if (!id || !item) return;
    if (!window.confirm("系統已分析這個 Bug。要開始處理它嗎？")) return;
    await db.ref("reports/" + id).update({
      status:"in_progress",
      handledAt:firebase.database.ServerValue.TIMESTAMP,
      handledByUid:currentUser.uid,
      handledByEmail:currentUser.email || "",
      repairRequestedAt:firebase.database.ServerValue.TIMESTAMP,
      repairRequestedByUid:currentUser.uid
    });
    await writeReportHistory(id,"repair_started","管理員確認開始處理這個 Bug");
    $("reportStatus").value = "in_progress";
    $("reportHandledBy").textContent = currentUser.email || currentUser.uid || "—";
    $("reportRepairBtn").textContent = "處理中";
    toast("已標記為處理中");
  }

  async function recheckCurrentReport() {
    if (!isAdminOperator()) return;
    const id = String($("reportId").value || "").trim();
    const item = reports[id];
    if (!id || !item) return;
    $("reportHint").textContent = "正在重新檢查這個 Bug…";
    try {
      const verification = await runBugServiceVerify(String(item.category || "other"));
      const ai = await analyzeReportOnAdmin(id,item,verification,"manual_verify");
      await db.ref("reports/" + id).update({
        verification:{
          state:verification.ok ? "passed" : "failed",
          checkedAt:firebase.database.ServerValue.TIMESTAMP,
          deterministicPassed:verification.ok === true,
          deploymentStatus:verification.status || "",
          deploymentChecks:Array.isArray(verification.checks) ? verification.checks : [],
          buildVersion:String(verification.buildVersion || ""),
          mode:"manual_verify"
        },
        verificationState:verification.ok ? "passed" : "failed",
        ...(ai?.analysis ? {
          aiStatus:String(ai.analysis.status || "inconclusive"),
          aiConfidence:Number(ai.analysis.confidence || 0),
          aiTitle:String(ai.analysis.title || "").slice(0,220),
          aiSummary:String(ai.analysis.summary || "").slice(0,900),
          aiRootCause:String(ai.analysis.rootCause || "").slice(0,900),
          aiSuggestion:String(ai.analysis.suggestion || "").slice(0,900),
          aiModel:String(ai.model || "").slice(0,100),
          aiCheckedAt:firebase.database.ServerValue.TIMESTAMP
        } : {})
      });
      await writeReportHistory(id,"manual_verify","管理員重新檢查網站與此回報");
      await loadReports();
      await openReport(id);
      $("reportHint").textContent = verification.ok ? "重新檢查通過，AI 已完成分析。" : "重新檢查發現問題，請查看診斷結果。";
    } catch (error) {
      $("reportHint").textContent = String(error?.message || "重新檢查失敗");
    }
  }

  function exportReports() {
    if (!currentHasAdminAccess) return;
    const payload = Object.entries(reports || {}).map(([id,item]) => ({id,...item}));
    const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "watchtogether-reports-" + new Date().toISOString().replace(/[:.]/g,"-") + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("回報資料已匯出");
  }

  const REPORT_CATEGORY_LABELS = {
    playback: "播放 / 同步",
    search: "YouTube 搜尋",
    room: "房間",
    chat: "好友 / 聊天",
    account: "登入 / 帳號",
    ui: "畫面 / 手機",
    other: "其他"
  };

  const REPORT_STATUS_LABELS = {
    open: "待處理",
    in_progress: "處理中",
    resolved: "已處理"
  };

  function normalizeReportStatus(value) {
    const status = String(value || "").trim().toLowerCase();
    return REPORT_STATUS_LABELS[status] ? status : "open";
  }

  function stopReportsListener() {
    if (!reportsRef) return;
    try { reportsRef.off(); } catch (_) {}
    reportsRef = null;
  }

  async function loadReports() {
    if (!currentHasAdminAccess) {
      reports = {};
      reportsLoadError = "";
      renderReports();
      updateStats();
      return;
    }
    try {
      const snapshot = await db.ref("reports").once("value");
      reports = snapshot.val() || {};
      reportsLoadError = "";
      renderReports();
      updateStats();
    } catch (error) {
      reports = {};
      reportsLoadError = String(error?.message || "問題回報資料讀取失敗");
      renderReports();
      updateStats();
      throw error;
    }
  }

  function startReportsListener() {
    stopReportsListener();
    if (!currentHasAdminAccess) return;
    reportsRef = db.ref("reports");
    reportsRef.on("value", snapshot => {
      if (!currentHasAdminAccess) return;
      reports = snapshot.val() || {};
      reportsLoadError = "";
      renderReports();
      updateStats();
    }, error => {
      reportsLoadError = String(error?.message || "問題回報即時資料讀取失敗");
      console.error("reports realtime listener failed", error);
      renderReports();
      updateStats();
    });
  }

  function renderReports() {
    const query = String($("reportSearch")?.value || "").trim().toLowerCase();
    const statusFilter = String($("reportStatusFilter")?.value || "all");
    const rows = Object.entries(reports || {})
      .filter(([id, item]) => {
        if (!item || typeof item !== "object") return false;
        const status = normalizeReportStatus(item.status);
        if (statusFilter !== "all" && status !== statusFilter) return false;
        const account = accounts[String(item.uid || "")] || {};
        const hay = [
          id,
          item.uid,
          account.email,
          account.displayName,
          item.roomId,
          item.category,
          REPORT_CATEGORY_LABELS[item.category] || "",
          item.details
        ].join(" ").toLowerCase();
        return !query || hay.includes(query);
      })
      .sort((a,b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0));

    $("reportCount").textContent = rows.length + " 筆";
    if (reportsLoadError && !Object.keys(reports || {}).length) {
      $("reportsBody").innerHTML =
        '<tr><td colspan="7"><div class="report-load-error"><strong>問題回報資料目前無法載入</strong><span>' +
        escapeHtml(reportsLoadError) +
        '</span><button class="btn primary" type="button" id="reportRetryInline">重新載入</button></div></td></tr>';
      $("reportRetryInline")?.addEventListener("click", () => {
        loadReports().then(() => toast("問題回報已重新載入")).catch(error => {
          console.error(error);
          toast(error?.message || "問題回報載入失敗");
        });
      });
      return;
    }

    $("reportsBody").innerHTML = rows.length
      ? rows.map(([id,item]) => {
          const uid = String(item.uid || "");
          const account = accounts[uid] || {};
          const status = normalizeReportStatus(item.status);
          const statusClass = status.replace("_","-");
          const category = REPORT_CATEGORY_LABELS[item.category] || "其他";
          const details = String(item.details || "");
          const preview = details.length > 120 ? details.slice(0,120) + "…" : details;
          const room = String(item.roomId || "").trim();
          const canManage = currentCan("users.update");
          const actions = canManage
            ? '<button class="btn" type="button" data-report-open="' + escapeHtml(id) + '">查看 / 處理</button>'
            : '<button class="btn" type="button" data-report-open="' + escapeHtml(id) + '">查看</button>';
          const sourceLabel = reportSourceLabel(item);
          const occurrenceText = Number(item.occurrences || 0) > 1 ? " · " + Number(item.occurrences) + " 次" : "";
          return '<tr>' +
            '<td><span class="small">' + escapeHtml(formatDate(item.createdAt)) + '</span></td>' +
            '<td><span class="report-source ' + (item.source === "auto" || item.autoDetected === true ? "auto" : "manual") + '">' + escapeHtml(sourceLabel) + '</span><span class="small">' + escapeHtml(category) + escapeHtml(occurrenceText) + '</span></td>' +
            '<td><div class="primary-text">' + escapeHtml(account.email || item.uid || "—") + '</div><span class="small">' + escapeHtml(account.displayName || "") + '</span></td>' +
            '<td>' + escapeHtml(room || "—") + '</td>' +
            '<td class="report-description-cell">' + escapeHtml(preview) + '</td>' +
            '<td><span class="report-status ' + statusClass + '">' + escapeHtml(REPORT_STATUS_LABELS[status]) + '</span></td>' +
            '<td><div class="row-actions">' + actions + '</div></td>' +
          '</tr>';
        }).join("")
      : '<tr><td colspan="7" class="muted">目前沒有符合條件的問題回報。</td></tr>';

    $("reportsBody").querySelectorAll("[data-report-open]").forEach(button => {
      button.addEventListener("click", () => openReport(button.dataset.reportOpen).catch(error => {
        console.error(error);
        toast(error?.message || "開啟問題回報失敗");
      }));
    });
  }

  async function loadReportHistory(id) {
    const body = $("reportHistoryBody");
    if (!body) return;
    body.innerHTML = '<div class="muted">載入處理紀錄…</div>';
    try {
      const snapshot = await db.ref("reportHistoryEvents/" + id).once("value");
      const legacySnapshot = await db.ref("reportHistory/" + id).once("value");
      const merged = {
        ...(legacySnapshot.val() || {}),
        ...(snapshot.val() || {})
      };
      reportHistory[id] = merged;
      const rows = Object.values(reportHistory[id]).sort((a,b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      body.innerHTML = rows.length
        ? rows.map(entry => '<div class="report-history-item"><div class="report-history-meta"><strong>' +
            escapeHtml(entry.event || "事件") + '</strong><span>' + escapeHtml(formatDate(entry.createdAt)) + '</span></div><div>' +
            escapeHtml(entry.details || "") + '</div></div>').join("")
        : '<div class="muted">目前沒有處理紀錄。</div>';
    } catch (error) {
      console.error("載入問題回報處理紀錄失敗:", error);
      body.innerHTML = '<div class="muted">處理紀錄載入失敗：' + escapeHtml(error?.message || "未知錯誤") + '</div>';
    }
  }

  async function openReport(id) {
    const item = reports[String(id || "")];
    if (!item) {
      toast("這筆回報已不存在");
      return;
    }

    const uid = String(item.uid || "");
    const account = accounts[uid] || {};
    const auto = item.source === "auto" || item.autoDetected === true;
    $("reportId").value = String(id || "");
    $("reportCreatedAt").textContent = formatDate(item.createdAt);
    $("reportSource").textContent = auto ? "自動偵測" : "使用者手動回報";
    $("reportCategoryLabel").textContent = REPORT_CATEGORY_LABELS[item.category] || "其他";
    $("reportOccurrences").textContent = Number(item.occurrences || 0) || 1;
    $("reportFirstSeenAt").textContent = formatDate(item.firstSeenAt || item.createdAt);
    $("reportLastSeenAt").textContent = formatDate(item.lastSeenAt || item.createdAt);
    $("reportBuildVersion").textContent = String(item.buildVersion || "—");
    $("reportUid").textContent = uid || "—";
    $("reportRoomId").textContent = String(item.roomId || "").trim() || "—";
    $("reportPage").textContent = String(item.page || "").trim() || "—";
    $("reportUserAgent").textContent = String(item.userAgent || "").trim() || "—";
    $("reportFingerprint").textContent = String(item.fingerprint || "—");
    $("reportAiStatus").textContent = item.aiStatus === "resolved_candidate"
      ? "可自動結案"
      : item.aiStatus === "confirmed"
        ? "確認為問題"
        : item.aiStatus === "still_present"
          ? "仍存在"
          : item.aiStatus === "unavailable"
            ? "AI 暫不可用"
            : item.aiStatus || "尚未分析";
    const aiConfidence = Number(item.aiConfidence || 0);
    $("reportAiConfidence").textContent = aiConfidence > 0 ? Math.round(aiConfidence * 100) + "%" : "—";
    $("reportAiRootCause").textContent = String(item.aiRootCause || "—");
    $("reportAiSuggestion").textContent = String(item.aiSuggestion || "—");
    $("reportDetails").value = String(item.details || "");
    $("reportStatus").value = normalizeReportStatus(item.status);
    $("reportHandledBy").textContent = item.handledByEmail || item.handledByUid || (item.autoResolvedAt ? "自動監控" : "—");
    $("reportAutoResolve").textContent = item.autoResolvedAt
      ? "已自動處理 · " + formatDate(item.autoResolvedAt) + " · " + String(item.autoResolveReason || "穩定檢查通過")
      : auto || item.autoVerifyEnabled === true ? "監控中" : "不適用";
    const verification = item.verification && typeof item.verification === "object" ? item.verification : {};
    const verificationState = String(verification.state || item.verificationState || "monitoring");
    const stateLabel = verificationState === "approved"
      ? "已通過"
      : verificationState === "passed"
        ? "檢查通過，等待穩定確認"
        : verificationState === "needs_review"
          ? "需要人工確認"
          : verificationState === "failed"
            ? "檢查未通過"
            : "監控中";
    $("reportVerificationState").textContent = stateLabel;
    const failed = []
      .concat(Array.isArray(verification.localChecks) ? verification.localChecks.filter(x => x && x.ok !== true).map(x => x.name) : [])
      .concat(Array.isArray(verification.deploymentChecks) ? verification.deploymentChecks.filter(x => x && x.ok !== true).map(x => x.name) : []);
    $("reportVerificationSummary").textContent = verification.checkedAt
      ? (failed.length ? "失敗：" + failed.slice(0,4).join("、") : "所有目前檢查通過 · " + String(verification.stableChecks || 0) + " 次穩定")
      : "尚未開始";
    const aiStatus = String(item.aiStatus || "");
    const aiStateText = aiStatus === "confirmed" || aiStatus === "still_present"
      ? "已發現疑似 Bug"
      : aiStatus === "resolved_candidate"
        ? "目前看起來可能已修復"
        : aiStatus === "unavailable"
          ? "AI 暫時無法分析"
          : "等待分析";
    $("reportDiagnosisBadge").textContent = aiStateText;
    $("reportDetectedBug").textContent =
      String(item.aiTitle || "") ||
      String(item.aiRootCause || "") ||
      String(item.details || "").split("\n")[0] ||
      "尚未完成診斷";
    $("reportDetectedReason").textContent =
      String(item.aiSummary || "") ||
      (failed.length ? "網站驗證發現：" + failed.slice(0,4).join("、") : "目前自動檢查沒有找到結構性錯誤，但這不代表所有實際行為問題都已排除。");
    $("reportRepairPlan").textContent =
      String(item.aiSuggestion || "") ||
      "先閱讀回報與驗證結果，再決定是否開始處理。";
    const canManageReport = currentCan("reports.manage");
    const fullAuto = autonomousMaintenanceEnabled === true;
    $("reportRepairBtn").classList.toggle("hidden", !canManageReport || fullAuto || normalizeReportStatus(item.status) === "resolved");
    $("reportRepairBtn").textContent = normalizeReportStatus(item.status) === "in_progress" ? "處理中" : "開始處理";
    const repairQuestion = document.querySelector(".report-repair-question");
    if (repairQuestion) {
      repairQuestion.classList.toggle("hidden", fullAuto || normalizeReportStatus(item.status) === "resolved");
    }
    $("reportHint").textContent = account.email ? "回報帳號：" + account.email + " · 來源：" + reportSourceLabel(item) : "來源：" + reportSourceLabel(item);
    $("reportDelete").classList.toggle("hidden", !currentCan("reports.manage"));
    $("reportSave").classList.toggle("hidden", !currentCan("reports.manage"));
    show("reportModal");
    await loadReportHistory(String(id || ""));
  }

  function closeReportModal() {
    hide("reportModal");
  }

  async function saveReportStatus() {
    if (!currentCan("reports.manage") || !currentCan("audit.write")) throw new Error("需要 reports.manage 與 audit.write 權限");
    const id = String($("reportId").value || "").trim();
    const item = reports[id];
    if (!id || !item) { toast("找不到這筆回報"); return; }
    const status = normalizeReportStatus($("reportStatus").value);
    const historyRef = db.ref("reportHistoryEvents/" + id).push();
    if (!historyRef.key) throw new Error("無法建立回報處理紀錄 ID");
    const updates = {
      ["reports/" + id + "/status"]:status,
      ["reports/" + id + "/handledAt"]:firebase.database.ServerValue.TIMESTAMP,
      ["reports/" + id + "/handledByUid"]:currentUser.uid,
      ["reports/" + id + "/handledByEmail"]:currentUser.email || "",
      ...(status !== "resolved" ? {
        ["reports/" + id + "/autoResolvedAt"]:null,
        ["reports/" + id + "/autoResolvedBuild"]:null,
        ["reports/" + id + "/autoResolveReason"]:null
      } : {}),
      ["reportHistoryEvents/" + id + "/" + historyRef.key]: {
        reportId:String(id).slice(0,128),
        event:"manual_status",
        createdAt:firebase.database.ServerValue.TIMESTAMP,
        actorUid:currentUser.uid,
        actorEmail:currentUser.email || "",
        source:"admin",
        details:"管理員將狀態改為 " + REPORT_STATUS_LABELS[status]
      }
    };
    await writeAuditedUpdates(
      updates,
      "report.status",
      String(item.uid || ""),
      String(item.uid || ""),
      "回報 " + id + " 狀態改為 " + REPORT_STATUS_LABELS[status]
    );
    await loadReports();
    $("reportHandledBy").textContent = currentUser.email || currentUser.uid || "—";
    $("reportAutoResolve").textContent = status === "resolved" ? "已處理（手動）" : "監控中";
    $("reportHint").textContent = "狀態已更新。";
    void loadReportHistory(id);
    toast("回報狀態已更新");
  }
  async function deleteReport() {
    if (!currentCan("reports.manage") || !currentCan("audit.write")) throw new Error("需要 reports.manage 與 audit.write 權限");
    const id = String($("reportId").value || "").trim();
    const item = reports[id];
    if (!id || !item) { toast("找不到這筆回報"); return; }
    if (!window.confirm("確定刪除這筆問題回報？刪除後無法復原。")) return;
    const historySnapshot = await db.ref("reportHistoryEvents/" + id).once("value");
    const updates = {["reports/" + id]:null};
    historySnapshot.forEach(child => {
      updates["reportHistoryEvents/" + id + "/" + child.key] = null;
    });
    await writeAuditedUpdates(
      updates,
      "report.delete",
      String(item.uid || ""),
      String(item.uid || ""),
      "刪除回報 " + id
    );
    await loadReports();
    closeReportModal();
    toast("問題回報已刪除");
  }
  function renderAnalytics() {
    const accountsCount = Object.keys(accounts || {}).length;
    const roomsList = Object.entries(rooms || {});
    let onlineMembers = 0;
    let onlineKnown = true;
    roomsList.forEach(([, room]) => {
      const count = Number(room?.__members);
      if (!Number.isFinite(count)) {
        onlineKnown = false;
        return;
      }
      onlineMembers += count;
    });

    let openReports = 0;
    let resolvedReports = 0;
    Object.values(reports || {}).forEach(item => {
      const status = normalizeReportStatus(item?.status);
      if (status === "resolved") resolvedReports += 1;
      else openReports += 1;
    });

    const since = Date.now() - 24 * 60 * 60 * 1000;
    const actionCounts = {};
    Object.values(auditLogs || {}).forEach(item => {
      if (!item || Number(item.createdAt || 0) < since) return;
      const action = String(item.action || "other");
      actionCounts[action] = (actionCounts[action] || 0) + 1;
    });

    if ($("analyticsAccounts")) $("analyticsAccounts").textContent = accountsCount;
    if ($("analyticsOnlineMembers")) $("analyticsOnlineMembers").textContent = onlineKnown ? onlineMembers : "—";
    if ($("analyticsRooms")) $("analyticsRooms").textContent = roomsList.length;
    if ($("analyticsOpenReports")) $("analyticsOpenReports").textContent = openReports;
    if ($("analyticsResolvedReports")) $("analyticsResolvedReports").textContent = resolvedReports;
    if ($("analyticsAudit24h")) $("analyticsAudit24h").textContent = Object.values(actionCounts).reduce((sum, value) => sum + value, 0);

    const container = $("analyticsAuditActions");
    if (!container) return;
    const rows = Object.entries(actionCounts).sort((a,b) => b[1] - a[1]);
    container.innerHTML = rows.length
      ? rows.map(([action,count]) =>
          '<div class="access-policy-row"><div><strong>' +
          escapeHtml(AUDIT_ACTION_LABELS[action] || action) +
          '</strong><span class="small">' + escapeHtml(action) +
          '</span></div><strong>' + count + '</strong></div>'
        ).join("")
      : '<div class="muted">最近 24 小時沒有 Audit 操作。</div>';
  }

  async function loadAiStatus() {
    const grid = $("aiStatusGrid");
    const hint = $("aiStatusHint");
    const permission = $("aiPermissionSummary");
    if (!grid || !hint || !permission) return;
    if (!currentCan("ai.use")) {
      grid.innerHTML = '<div class="info-item"><span>權限</span><strong>禁止使用 AI</strong></div>';
      hint.textContent = "目前帳號沒有 ai.use 權限。";
      permission.textContent = "需要 ai.use 才能呼叫 AI 分析服務。";
      aiStatus = null;
      return;
    }

    const endpoint = getBugServiceBase();
    if (!endpoint) {
      grid.innerHTML = '<div class="info-item"><span>AI 服務</span><strong>未設定</strong></div>';
      hint.textContent = "尚未設定 AI 服務端點。";
      permission.textContent = "ai.use 已授權，但服務端點尚未設定。";
      aiStatus = null;
      return;
    }

    try {
      const response = await fetch(endpoint + "/ai/health", {
        method:"GET",
        cache:"no-store",
        credentials:"omit"
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error("AI Health HTTP " + response.status);
      aiStatus = result;
      grid.innerHTML = [
        ["服務", result.ok === true ? "正常" : "不可用"],
        ["Provider", result.provider || "—"],
        ["一般模型", result.model || "—"],
        ["修復模型", result.repairModel || "—"],
        ["已設定 API Key", Number(result.configuredKeys || 0)],
        ["目前角色", currentRole || "—"]
      ].map(([label,value]) =>
        '<div class="info-item"><span>' + escapeHtml(label) +
        '</span><strong>' + escapeHtml(value) + '</strong></div>'
      ).join("");
      hint.textContent = result.ok === true
        ? "AI 服務目前可用；個人限制與 Feature Flag 仍會在後端再次驗證。"
        : "AI 服務目前沒有可用的 Gemini Key。";
      permission.textContent = "目前帳號具備 ai.use；管理員 AI 分析會留下操作紀錄。";
    } catch (error) {
      aiStatus = null;
      grid.innerHTML = '<div class="info-item"><span>服務</span><strong>無法連線</strong></div>';
      hint.textContent = String(error?.message || "AI 狀態檢查失敗");
      permission.textContent = "後端目前無法回應 AI 健康檢查。";
    }
  }

  function updateStats() {
    const list = Object.values(accounts || {});
    const wl = Object.values(whitelist || {});
    const blocked = Object.values(blocks || {}).filter(isActiveBlock);
    $("statAccounts").textContent = list.length;
    $("statWhitelist").textContent = isMasterUser(currentUser) ? wl.length : (currentHasAdminAccess ? "1" : "0");
    $("statWhitelistEnabled").textContent = wl.filter(x => x && x.enabled === true).length;
    $("statBlocked").textContent = blocked.length;
    $("statCurrent").textContent = currentUser ? 1 : 0;
    if ($("statRooms")) $("statRooms").textContent = Object.keys(rooms || {}).length;
    renderAnalytics();

    const u = currentUser || {};
    const roleLabel = currentRole === "master" ? "最高管理員" : currentRole === "admin" ? "管理員" : currentRole === "viewer" ? "觀察員" : "—";
    $("adminInfo").innerHTML = [
      ["權限", roleLabel],
      ["Email", u.email || "—"],
      ["UID", u.uid || "—"],
      ["Email 驗證", u.emailVerified === true ? "已驗證" : "未驗證"],
      ["登入方式", u.providerData?.[0]?.providerId || "Google"]
    ].map(([a,b]) => '<div class="info-item"><span>' + escapeHtml(a) + '</span><strong>' + escapeHtml(b) + '</strong></div>').join("");
  }

  async function addWhitelist() {
    if (!isMasterUser(currentUser)) { toast("只有最高管理員可以管理白名單"); return; }
    const input = $("whitelistEmail");
    const uid = String(input?.value || "").trim();
    if (!uid) { toast("請輸入使用者 UID"); return; }
    if (uid === MASTER_UID) { toast("這個帳號已經是最高管理員"); return; }
    const match = Object.values(accounts || {}).find(item => item && String(item.uid || "") === uid);
    if (!match?.uid) {
      toast("找不到這個 UID，請先讓該使用者登入 WatchTogether 一次");
      return;
    }
    const email = String(match.email || "").trim().toLowerCase();
    const role = $("whitelistRole")?.value === "viewer" ? "viewer" : "admin";
    await writeAuditedUpdates({
      ["admin/whitelistByUid/" + uid]: {
        uid,
        email,
        role,
        enabled:true,
        addedAt:firebase.database.ServerValue.TIMESTAMP,
        addedByUid:currentUser.uid,
        addedByEmail:currentUser.email || ""
      }
    },"whitelist.add",uid,email,"新增 " + role + " 權限");
    input.value = "";
    await loadWhitelist();
    toast("已加入白名單管理員");
  }
  async function changeWhitelistRole(uid) {
    if (!isMasterUser(currentUser)) { toast("只有最高管理員可以調整權限"); return; }
    const item = whitelist[uid];
    if (!item) return;
    if (uid === MASTER_UID) { toast("最高管理員的權限不可修改"); return; }
    const role = $("whitelistBody")?.querySelector('[data-role-select="' + uid.replace(/"/g, '"') + '"]')?.value === "viewer" ? "viewer" : "admin";
    await writeAuditedUpdates({
      ["admin/whitelistByUid/" + uid]: {role,updatedAt:firebase.database.ServerValue.TIMESTAMP,updatedByUid:currentUser.uid}
    },"whitelist.role",uid,item.email || uid,"調整為 " + role);
    await loadWhitelist();
    toast(role === "viewer" ? "已設為觀察員" : "已設為管理員");
  }
  async function toggleWhitelist(uid) {
    if (!isMasterUser(currentUser)) { toast("只有最高管理員可以管理白名單"); return; }
    const item = whitelist[uid];
    if (!item) return;
    const enabled = item.enabled !== true;
    await writeAuditedUpdates({
      ["admin/whitelistByUid/" + uid]: {enabled,updatedAt:firebase.database.ServerValue.TIMESTAMP,updatedByUid:currentUser.uid}
    },"whitelist.toggle",uid,item.email || uid,enabled ? "啟用管理員資格" : "停用管理員資格");
    await loadWhitelist();
    toast(enabled ? "已啟用" : "已停用");
  }
  async function removeWhitelist(uid) {
    if (!isMasterUser(currentUser)) { toast("只有最高管理員可以管理白名單"); return; }
    const item = whitelist[uid];
    if (!item) return;
    if (!window.confirm("確定刪除 " + (item.email || "這個帳號") + " 的管理員資格？")) return;
    await writeAuditedUpdates(
      {["admin/whitelistByUid/" + uid]:null},
      "whitelist.remove",
      uid,
      item.email || uid,
      "移除管理員資格"
    );
    await loadWhitelist();
    toast("已刪除白名單管理員");
  }
  async function openEditUser(uid) {
    if (!isAdminOperator()) return;
    const item = accounts[uid];
    if (!item) return;
    if (uid === MASTER_UID || String(item.email || "").trim().toLowerCase() === MASTER_EMAIL) {
      toast("最高管理員資料不能由後台修改");
      return;
    }

    const snapshot = await db.ref("profiles/" + uid).once("value");
    const profile = snapshot.val() || {};
    profiles[uid] = profile;

    $("editUserUid").value = uid;
    $("editUserEmail").value = item.email || "";
    $("editUserDisplayName").value = profile.displayName || item.displayName || "";
    $("editUserPhotoURL").value = profile.photoURL || item.photoURL || "";
    $("editUserAvatar").value = profile.avatarEmoji || "🙂";
    $("editUserTheme").value = profile.theme || "aurora";
    $("editUserNotifications").checked = profile.notifications !== false;
    $("editUserHint").textContent = "UID：" + uid + " · Email / UID 只讀，其他 WatchTogether 使用者資料可由管理員修改。";
    show("userEditModal");
  }

  function closeUserEdit() {
    hide("userEditModal");
  }

  async function saveUser() {
    if (!isAdminOperator() || !currentCan("audit.write")) throw new Error("需要 users.update 與 audit.write 權限");
    const uid = String($("editUserUid").value || "").trim();
    const item = accounts[uid];
    if (!uid || !item) { toast("找不到使用者"); return; }
    if (uid === MASTER_UID || String(item.email || "").trim().toLowerCase() === MASTER_EMAIL) {
      toast("最高管理員資料不能由後台修改");
      return;
    }

    const snapshot = await db.ref("profiles/" + uid).once("value");
    const profile = snapshot.val() || {};
    if (!profile.publicCode) {
      toast("這個帳號的個人資料不完整，暫時無法修改");
      return;
    }

    const displayName = String($("editUserDisplayName").value || "").trim().slice(0,30);
    const photoURL = String($("editUserPhotoURL").value || "").trim().slice(0,2000);
    const avatarEmoji = String($("editUserAvatar").value || "").trim().slice(0,4);
    const theme = String($("editUserTheme").value || "aurora");
    const notifications = $("editUserNotifications").checked === true;
    if (!displayName) { toast("顯示名稱不能是空白"); return; }
    if (!avatarEmoji) { toast("頭像 Emoji 不能是空白"); return; }

    const updates = {};
    updates["accounts/" + uid + "/displayName"] = displayName;
    updates["accounts/" + uid + "/photoURL"] = photoURL;
    updates["accounts/" + uid + "/updatedAt"] = firebase.database.ServerValue.TIMESTAMP;
    updates["profiles/" + uid + "/displayName"] = displayName;
    updates["profiles/" + uid + "/avatarEmoji"] = avatarEmoji;
    updates["profiles/" + uid + "/theme"] = theme;
    updates["profiles/" + uid + "/notifications"] = notifications;

    await writeAuditedUpdates(
      updates,
      "user.update",
      uid,
      displayName,
      "管理員更新使用者資料"
    );

    try {
      const membersSnapshot = await db.ref("members").once("value");
      const memberUpdates = {};
      Object.entries(membersSnapshot.val() || {}).forEach(([roomId,members]) => {
        if (members && members[uid]) memberUpdates["members/" + roomId + "/" + uid + "/name"] = displayName;
      });
      if (Object.keys(memberUpdates).length) await db.ref().update(memberUpdates);
    } catch (error) {
      console.warn("同步現有房間名稱失敗:", error);
    }

    accounts[uid] = {...accounts[uid],displayName,photoURL};
    profiles[uid] = {...profile,displayName,avatarEmoji,theme,notifications};
    renderAccounts();
    closeUserEdit();
    toast("使用者資料已更新");
  }
  function openBlockUser(uid) {
    if (!currentCan("users.restrict")) return;
    const item = accounts[uid];
    if (!item) return;
    if (uid === MASTER_UID || String(item.email || "").trim().toLowerCase() === MASTER_EMAIL) {
      toast("最高管理員不能被封鎖");
      return;
    }
    $("blockUserUid").value = uid;
    $("blockUserLabel").textContent = (item.displayName || item.email || uid) + " · " + uid;
    $("blockDuration").value = "3600000";
    show("blockModal");
  }

  function closeBlockModal() {
    hide("blockModal");
  }

  async function confirmBlock() {
    if (!currentCan("users.restrict") || !currentCan("audit.write")) throw new Error("需要 users.restrict 與 audit.write 權限");
    const uid = String($("blockUserUid").value || "").trim();
    const item = accounts[uid];
    if (!uid || !item) { toast("找不到使用者"); return; }
    if (uid === MASTER_UID || String(item.email || "").trim().toLowerCase() === MASTER_EMAIL) {
      toast("最高管理員不能被封鎖");
      return;
    }
    const duration = String($("blockDuration").value || "");
    const allowed = new Set(["600000","3600000","86400000","604800000","2592000000","permanent"]);
    if (!allowed.has(duration)) throw new Error("不支援的封鎖時間");
    const permanent = duration === "permanent";
    const blockedUntil = permanent ? 0 : Date.now() + Number(duration);
    await writeAuditedUpdates({
      ["admin/blocksByUid/" + uid]: {
        uid,
        email:item.email || "",
        displayName:item.displayName || "",
        permanent,
        blockedUntil,
        blockedAt:firebase.database.ServerValue.TIMESTAMP,
        blockedByUid:currentUser.uid,
        blockedByEmail:currentUser.email || "",
        blockedByRole:isMasterOperator() ? "master" : "admin"
      }
    },"block",uid,item.displayName || item.email || uid,permanent ? "永久封鎖" : "封鎖 " + formatRemaining({blockedUntil,permanent}));
    await loadBlocks();
    closeBlockModal();
    toast(permanent ? "已永久封鎖使用者" : "已封鎖使用者");
  }
   async function unblockUser(uid, options = {}) {
    if (!currentCan("users.restrict") || !currentCan("audit.write")) throw new Error("需要 users.restrict 與 audit.write 權限");
    const item = accounts[uid];
    if (!item) return;
    if (uid === MASTER_UID || String(item.email || "").trim().toLowerCase() === MASTER_EMAIL) {
      toast("最高管理員不能解除或修改封鎖");
      return;
    }
    const block = blocks[uid];
    if (!block) {
      await loadBlocks();
      return;
    }
    if (String(uid) === String(currentUser?.uid || "") && !canCurrentUserSelfUnblock(block, uid)) {
      throw new Error("這個封鎖是由權限更高的管理員建立，你不能自行解除");
    }
    if (options.skipConfirm !== true && !window.confirm("確定解除「" + (item.displayName || item.email || uid) + "」的封鎖？")) return;
    await writeAuditedUpdates(
      {["admin/blocksByUid/" + uid]:null},
      "unblock",
      uid,
      item.displayName || item.email || uid,
      options.source === "ai" ? "AI Agent 解除封鎖" : "解除封鎖"
    );
    await loadBlocks();
    toast("已解除封鎖");
  }
  async function deleteRoom(roomId, options = {}) {
    if (!currentCan("rooms.manage") || !currentCan("audit.write")) throw new Error("需要 rooms.manage 與 audit.write 權限");
    const key = String(roomId || "").trim().toUpperCase();
    const item = rooms[key];
    if (!item) { toast("這個房間已不存在"); await loadRooms(); return; }
    const name = item.name || item.__meta?.name || "一起看";
    if (options.skipConfirm !== true && !window.confirm("確定刪除房間「" + name + "」(" + key + ")？
房間與播放、聊天、成員、待播放資料都會一起刪除。")) return;
    const updates = {};
    ["rooms/","roomMeta/","members/","playback/","chat/","queue/","kicked/","controlRequests/"].forEach(prefix => {
      updates[prefix + key] = null;
    });
    await writeAuditedUpdates(updates,"room.delete",key,name,options.source === "ai" ? "AI Agent 刪除房間" : "刪除房間");
    delete rooms[key];
    renderRooms();
    updateStats();
    toast("房間已刪除");
  }
  function encodeAccessPermission(permission) {
    return String(permission || "").trim().replace(/\./g, "__").replace(/[^A-Za-z0-9_-]/g, "_").slice(0,80);
  }

  const ACCESS_PERMISSION_CATALOG = [
    "admin.read",
    "users.read",
    "users.update",
    "users.restrict",
    "rooms.read",
    "rooms.manage",
    "chat.read",
    "chat.moderate",
    "reports.read",
    "reports.manage",
    "analytics.read",
    "ai.use",
    "ai.agent",
    "audit.read",
    "audit.write",
    "audit.delete",
    "sync.control",
    "sync.manual",
    "room.create",
    "room.join",
    "room.queue",
    "chat.send",
    "chat.media",
    "chat.dm",
    "youtube.search",
    "youtube.queue",
    "favorites.manage",
    "maintenance.manage",
    "featureflags.manage",
    "settings.manage"
  ];

  let accessRoles = {};
  let accessAssignments = {};
  let accessOverrides = {};
  let accessRestrictions = {};
  let accessFeatureFlags = {};

  function isMasterOperator() {
    return currentRole === "master" || isMasterUser(currentUser);
  }

  function currentCan(permission) {
    if (isMasterOperator()) return true;
    const key = String(permission || "").trim();
    if (currentRolePermissions[key] === true) return true;
    if (currentRole === "admin" && currentRoleSource !== "custom") {
      const adminDefaults = [
        "admin.read","users.read","users.update","users.restrict",
        "rooms.read","rooms.manage","chat.read","chat.moderate",
        "reports.read","reports.manage","analytics.read","ai.use","ai.agent",
        "audit.read","audit.write","audit.delete","sync.control","sync.manual",
        "room.create","room.join","room.queue","chat.send","chat.media",
        "chat.dm","youtube.search","youtube.queue","favorites.manage",
        "maintenance.manage","featureflags.manage","settings.manage"
      ];
      return adminDefaults.includes(key);
    }
    if (currentRole === "viewer" && currentRoleSource !== "custom") {
      return [
        "admin.read","users.read","rooms.read","chat.read",
        "reports.read","analytics.read","audit.read"
      ].includes(key);
    }
    try {
      return window.WT_ACCESS_CONTROL?.hasPermission?.(key) === true;
    } catch (_) {
      return false;
    }
  }

  function safeKey(value, max = 80) {
    return String(value || "")
      .trim()
      .slice(0, max)
      .replace(/[.#$[\]/]/g, "_");
  }

  function accessPermissionList() {
    const fromCore = (() => {
      try {
        return window.WT_ACCESS_CONTROL?.getPermissionCatalog?.() || [];
      } catch (_) {
        return [];
      }
    })();
    return Array.from(new Set([
      ...ACCESS_PERMISSION_CATALOG,
      ...fromCore,
      ...Object.keys(accessFeatureFlags || {}),
      ...Object.keys(accessOverrides || {}),
      ...Object.keys(accessRestrictions || {})
    ].filter(Boolean))).sort();
  }

  function populateAccessPermissionCatalog() {
    const list = $("accessPermissionCatalog");
    if (list) {
      list.innerHTML = accessPermissionList()
        .map(permission => '<option value="' + escapeHtml(permission) + '"></option>')
        .join("");
    }
  }

  function renderAccessSummary() {
    const el = $("accessSummary");
    if (!el) return;
    const roleCount = Object.keys(accessRoles || {}).length;
    const assignmentCount = Object.keys(accessAssignments || {}).length;
    const overrideCount = Object.values(accessOverrides || {}).reduce((n, item) => n + Object.keys(item || {}).length, 0);
    const restrictionCount = Object.values(accessRestrictions || {}).reduce((n, item) => n + Object.keys(item || {}).length, 0);
    const flagCount = Object.keys(accessFeatureFlags || {}).length;
    el.innerHTML = [
      ["目前角色", currentRole || "—"],
      ["自訂角色", String(roleCount)],
      ["自訂角色指派", String(assignmentCount)],
      ["Allow / Deny", String(overrideCount)],
      ["功能限制", String(restrictionCount)],
      ["Feature Flags", String(flagCount)]
    ].map(([label,value]) => '<div class="info-item"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join("");
  }

  function renderAccessRoles() {
    const box = $("accessRoleList");
    if (!box) return;
    const entries = Object.entries(accessRoles || {}).sort((a,b) => a[0].localeCompare(b[0]));
    box.innerHTML = entries.length
      ? entries.map(([id,item]) => {
          const permissions = item && item.permissions && typeof item.permissions === "object"
            ? Object.keys(item.permissions).filter(key => item.permissions[key] === true).map(key => key === "__all__" ? "*" : key.replace(/__/g, ".")).sort()
            : [];
          return '<div class="access-policy-row">' +
            '<div><strong>' + escapeHtml(item?.name || id) + '</strong><span class="small">' + escapeHtml(id) + '</span></div>' +
            '<div class="access-policy-details">' + escapeHtml(permissions.join(", ") || "沒有權限") + '</div>' +
            (isMasterOperator() ? '<button class="btn danger" type="button" data-access-role-delete="' + escapeHtml(id) + '">刪除</button>' : '') +
          '</div>';
        }).join("")
      : '<div class="muted">目前尚未建立自訂角色。</div>';

    box.querySelectorAll("[data-access-role-delete]").forEach(button => {
      button.addEventListener("click", () => deleteAccessRole(button.dataset.accessRoleDelete)
        .catch(error => { console.error(error); toast(error?.message || "刪除角色失敗"); }));
    });
  }

  function renderAccessAssignments() {
    const box = $("accessAssignmentList");
    if (!box) return;
    const entries = Object.entries(accessAssignments || {}).sort((a,b) => a[0].localeCompare(b[0]));
    box.innerHTML = entries.length
      ? entries.map(([uid,role]) =>
          '<div class="access-policy-row">' +
            '<div><strong>' + escapeHtml(uid) + '</strong><span class="small">指派角色</span></div>' +
            '<div class="access-policy-details">' + escapeHtml(String(role || "—")) + '</div>' +
            (isMasterOperator() ? '<button class="btn danger" type="button" data-access-assignment-delete="' + escapeHtml(uid) + '">解除</button>' : '') +
          '</div>'
        ).join("")
      : '<div class="muted">目前沒有自訂角色指派。</div>';
    box.querySelectorAll("[data-access-assignment-delete]").forEach(button => {
      button.addEventListener("click", () => removeAccessAssignment(button.dataset.accessAssignmentDelete)
        .catch(error => { console.error(error); toast(error?.message || "解除角色失敗"); }));
    });
  }

  function renderAccessOverrides() {
    const box = $("accessOverrideList");
    if (!box) return;
    const rows = [];
    Object.entries(accessOverrides || {}).forEach(([uid, map]) => {
      Object.entries(map || {}).forEach(([permission,effect]) => rows.push({uid,permission,effect}));
    });
    rows.sort((a,b) => (a.uid + a.permission).localeCompare(b.uid + b.permission));
    box.innerHTML = rows.length
      ? rows.map(row =>
          '<div class="access-policy-row">' +
            '<div><strong>' + escapeHtml(row.uid) + '</strong><span class="small">' + escapeHtml(row.permission.replace(/__/g, ".")) + '</span></div>' +
            '<span class="status ' + (row.effect === "deny" ? "off" : "admin") + '">' + escapeHtml(String(row.effect || "").toUpperCase()) + '</span>' +
            '<button class="btn danger" type="button" data-access-override-delete="' + escapeHtml(row.uid) + '" data-access-override-permission="' + escapeHtml(row.permission.replace(/__/g, ".")) + '">移除</button>' +
          '</div>'
        ).join("")
      : '<div class="muted">目前沒有個人權限覆寫。</div>';
    box.querySelectorAll("[data-access-override-delete]").forEach(button => {
      button.addEventListener("click", () => removeAccessOverride(button.dataset.accessOverrideDelete, button.dataset.accessOverridePermission)
        .catch(error => { console.error(error); toast(error?.message || "移除覆寫失敗"); }));
    });
  }

  function restrictionActive(item) {
    if (!item || item.enabled !== true) return false;
    if (item.permanent === true) return true;
    const until = Number(item.until || 0);
    return Number.isFinite(until) && until > Date.now();
  }

  function renderAccessRestrictions() {
    const box = $("accessRestrictionList");
    if (!box) return;
    const rows = [];
    Object.entries(accessRestrictions || {}).forEach(([uid,map]) => {
      Object.entries(map || {}).forEach(([permission,item]) => rows.push({uid,permission,item}));
    });
    rows.sort((a,b) => Number(b.item?.createdAt || 0) - Number(a.item?.createdAt || 0));
    box.innerHTML = rows.length
      ? rows.map(row => {
          const active = restrictionActive(row.item);
          const until = row.item?.permanent === true || Number(row.item?.until || 0) === 0 ? "永久" : formatDate(row.item.until);
          return '<div class="access-policy-row">' +
            '<div><strong>' + escapeHtml(row.uid) + '</strong><span class="small">' + escapeHtml(row.permission) + '</span></div>' +
            '<div class="access-policy-details">' + escapeHtml(row.item?.reason || "—") + '<br><span class="small">' + escapeHtml(until) + '</span></div>' +
            '<span class="status ' + (active ? "off" : "") + '">' + (active ? "限制中" : "已到期") + '</span>' +
            '<button class="btn" type="button" data-access-restriction-delete="' + escapeHtml(row.uid) + '" data-access-restriction-permission="' + escapeHtml(row.permission) + '">解除</button>' +
          '</div>';
        }).join("")
      : '<div class="muted">目前沒有指定功能限制。</div>';
    box.querySelectorAll("[data-access-restriction-delete]").forEach(button => {
      button.addEventListener("click", () => removeAccessRestriction(button.dataset.accessRestrictionDelete, button.dataset.accessRestrictionPermission)
        .catch(error => { console.error(error); toast(error?.message || "解除限制失敗"); }));
    });
  }

  function renderAccessFeatureFlags() {
    const box = $("accessFeatureFlagList");
    if (!box) return;
    const entries = Object.entries(accessFeatureFlags || {}).sort((a,b) => a[0].localeCompare(b[0]));
    box.innerHTML = entries.length
      ? entries.map(([name,item]) =>
          '<div class="access-policy-row">' +
            '<div><strong>' + escapeHtml(name.replace(/__/g, ".")) + '</strong><span class="small">' + escapeHtml(item?.reason || "—") + '</span></div>' +
            '<span class="status ' + (item?.enabled === false ? "off" : "admin") + '">' + (item?.enabled === false ? "關閉" : "啟用") + '</span>' +
            '<span class="small">' + escapeHtml(formatDate(item?.updatedAt)) + '</span>' +
            (currentCan("featureflags.manage") ? '<button class="btn danger" type="button" data-access-flag-delete="' + escapeHtml(name) + '">刪除</button>' : '') +
          '</div>'
        ).join("")
      : '<div class="muted">目前沒有 Feature Flag。</div>';
    box.querySelectorAll("[data-access-flag-delete]").forEach(button => {
      button.addEventListener("click", () => deleteAccessFeatureFlag(button.dataset.accessFlagDelete)
        .catch(error => { console.error(error); toast(error?.message || "刪除 Feature Flag 失敗"); }));
    });
  }

  function renderMaintenanceControl() {
    const status = $("maintenanceControlStatus");
    const hint = $("maintenanceControlHint");
    const openBtn = $("maintenanceOpenBtn");
    const closeBtn = $("maintenanceCloseBtn");
    if (!status || !hint) return;
    const item = window.WT_ACCESS_CONTROL?.getMaintenance?.() || {enabled:false};
    const active = item.enabled === true;
    status.textContent = active ? "網站維護中" : "網站運作中";
    status.className = "status " + (active ? "off" : "");
    hint.textContent = active
      ? "原因：" + String(item.reason || "未提供") + " · 預計恢復：" + (Number(item.restoreAt || 0) > 0 ? formatDate(item.restoreAt) : "未設定")
      : "目前沒有啟用網站維護模式。";
    const canManageMaintenance = currentCan("maintenance.manage") && currentCan("audit.write");
    if (openBtn) openBtn.disabled = !canManageMaintenance || active;
    if (closeBtn) closeBtn.disabled = !canManageMaintenance || !active;
  }

  async function setSiteMaintenance(enabled) {
    if (!currentCan("maintenance.manage") || !currentCan("audit.write")) throw new Error("需要 maintenance.manage 與 audit.write 權限");
    const passwordEl = $("maintenancePassword");
    const reasonEl = $("maintenanceReason");
    const restoreEl = $("maintenanceRestoreAt");
    const password = String(passwordEl?.value || "");
    const reason = String(reasonEl?.value || "").trim().slice(0,500);
    const rawRestore = String(restoreEl?.value || "").trim();
    let restoreAt = 0;
    if (rawRestore) {
      const parsed = new Date(rawRestore).getTime();
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("預計恢復時間格式錯誤");
      restoreAt = parsed;
    }
    if (!password) throw new Error("請輸入維護密碼");
    if (enabled && !reason) throw new Error("關站前請輸入維護原因");

    const confirmed = window.confirm(
      enabled
        ? "確定要關閉網站嗎？\n\n關站後一般使用者會看到維護頁面，管理系統仍可使用。"
        : "確定要重新開站嗎？\n\n網站會立即恢復給一般使用者使用。"
    );
    if (!confirmed) return;

    const base = String(
      window.WATCHTOGETHER_CONFIG?.adminControlUrl ||
      window.WATCHTOGETHER_CONFIG?.youtubeStreamProxyUrl ||
      ""
    ).trim().replace(/\/+$/,"");
    if (!base) throw new Error("尚未設定管理控制服務網址");

    const token = await currentUser.getIdToken(true);
    const response = await fetch(base + "/admin/maintenance", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":"Bearer " + token
      },
      body:JSON.stringify({
        enabled:enabled === true,
        password,
        reason: enabled ? reason : "管理員手動重新開站",
        restoreAt: enabled ? restoreAt : 0
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error === "maintenance_password_locked"
        ? "維護密碼錯誤次數過多，已暫時鎖定。"
        : data.error === "maintenance_password_not_configured"
          ? "Render 尚未設定維護密碼雜湊。"
          : data.error === "invalid_password"
            ? "維護密碼錯誤。剩餘嘗試次數：" + String(data.attemptsRemaining ?? "—")
            : data.error === "master_only"
              ? "目前管理員沒有網站維護權限。"
              : String(data.message || data.error || "維護模式操作失敗");
      throw new Error(message);
    }
    if (passwordEl) passwordEl.value = "";
    await window.WT_ACCESS_CONTROL?.refresh?.();
    renderMaintenanceControl();
    toast(enabled ? "網站已進入維護模式" : "網站已重新開站");
  }
  const SYSTEM_SETTINGS_DEFAULTS = {
    siteName: "WatchTogether｜一起看",
    siteDescription: "WatchTogether - 和朋友一起同步看影片、聊天與加好友",
    announcementEnabled: false,
    announcementText: ""
  };

  function stopSystemSettingsListener() {
    if (!systemSettingsRef) return;
    try { systemSettingsRef.off(); } catch (_) {}
    systemSettingsRef = null;
  }

  function normalizeSystemSettings(value) {
    const item = value && typeof value === "object" ? value : {};
    return {
      siteName: String(item.siteName || SYSTEM_SETTINGS_DEFAULTS.siteName).trim().slice(0,80) || SYSTEM_SETTINGS_DEFAULTS.siteName,
      siteDescription: String(item.siteDescription || SYSTEM_SETTINGS_DEFAULTS.siteDescription).trim().slice(0,300),
      announcementEnabled: item.announcementEnabled === true,
      announcementText: String(item.announcementText || "").trim().slice(0,500),
      updatedAt: Number(item.updatedAt || 0),
      updatedByUid: String(item.updatedByUid || "")
    };
  }

  function renderSystemSettings() {
    const current = normalizeSystemSettings(systemSettings);
    const status = $("systemSettingsStatus");
    const hint = $("systemSettingsHint");
    const name = $("systemSiteName");
    const description = $("systemSiteDescription");
    const announcementEnabled = $("systemAnnouncementEnabled");
    const announcementText = $("systemAnnouncementText");
    if (name) name.value = current.siteName;
    if (description) description.value = current.siteDescription;
    if (announcementEnabled) announcementEnabled.checked = current.announcementEnabled;
    if (announcementText) announcementText.value = current.announcementText;

    const canManage = currentCan("settings.manage") && currentCan("audit.write");
    [name,description,announcementEnabled,announcementText,$("systemSettingsSaveBtn")]
      .filter(Boolean)
      .forEach(el => { el.disabled = !canManage; });

    if (status) {
      status.textContent = isMasterOperator() ? "Master Admin" : (canManage ? "可管理" : "唯讀");
      status.className = "status " + (canManage ? "admin" : "");
    }
    if (hint) {
      hint.textContent = canManage
        ? "目前帳號具備 settings.manage，可修改系統設定；變更會寫入 Audit Log。"
        : "你目前只有查看權限，系統設定不可修改。";
    }

    const summary = $("systemSettingsLiveSummary");
    if (summary) {
      summary.innerHTML = [
        '<div><span>網站名稱</span><strong>' + escapeHtml(current.siteName) + '</strong></div>',
        '<div><span>網站描述</span><strong>' + escapeHtml(current.siteDescription || "—") + '</strong></div>',
        '<div><span>首頁公告</span><strong>' + (current.announcementEnabled && current.announcementText ? "已啟用" : "未啟用") + '</strong></div>',
        '<div><span>最後更新</span><strong>' + escapeHtml(current.updatedAt ? formatDate(current.updatedAt) : "尚未設定") + '</strong></div>'
      ].join("");
    }
  }

  async function loadSystemSettings() {
    if (!currentHasAdminAccess) {
      systemSettings = {...SYSTEM_SETTINGS_DEFAULTS};
      renderSystemSettings();
      return;
    }
    const snapshot = await db.ref("site/settings").once("value");
    systemSettings = normalizeSystemSettings(snapshot.val());
    renderSystemSettings();
  }

  function startSystemSettingsListener() {
    stopSystemSettingsListener();
    if (!currentHasAdminAccess) return;
    systemSettingsRef = db.ref("site/settings");
    systemSettingsRef.on("value", snapshot => {
      if (!currentHasAdminAccess) return;
      systemSettings = normalizeSystemSettings(snapshot.val());
      renderSystemSettings();
    }, error => {
      console.error("system settings realtime listener failed", error);
    });
  }

  async function saveSystemSettings() {
    if (!currentCan("settings.manage") || !currentCan("audit.write")) {
      throw new Error("需要 settings.manage 與 audit.write 權限");
    }
    const siteName = String($("systemSiteName")?.value || "").trim().slice(0,80);
    const siteDescription = String($("systemSiteDescription")?.value || "").trim().slice(0,300);
    const announcementEnabled = $("systemAnnouncementEnabled")?.checked === true;
    const announcementText = String($("systemAnnouncementText")?.value || "").trim().slice(0,500);
    if (!siteName) throw new Error("網站名稱不能是空白");
    if (!siteDescription) throw new Error("網站描述不能是空白");
    if (announcementEnabled && !announcementText) throw new Error("啟用首頁公告時，公告內容不能是空白");

    await writeAuditedUpdates({
      "site/settings": {
        siteName,
        siteDescription,
        announcementEnabled,
        announcementText,
        updatedAt:firebase.database.ServerValue.TIMESTAMP,
        updatedByUid:currentUser.uid,
        updatedByEmail:currentUser.email || ""
      }
    },"system.settings.update",currentUser.uid,"網站系統設定","網站名稱：" + siteName + " · 公告：" + (announcementEnabled ? "啟用" : "停用"));
    await loadSystemSettings();
    toast("系統設定已儲存");
  }
  async function loadAccessControl() {
    if (!currentHasAdminAccess) return;
    const [rolesSnap, assignmentsSnap, overridesSnap, restrictionsSnap, flagsSnap] = await Promise.all([
      db.ref("admin/access/roles").once("value"),
      db.ref("admin/access/roleByUid").once("value"),
      db.ref("admin/access/permissionsByUid").once("value"),
      db.ref("admin/access/restrictionsByUid").once("value"),
      db.ref("admin/featureFlags").once("value")
    ]);
    accessRoles = rolesSnap.val() || {};
    accessAssignments = assignmentsSnap.val() || {};
    accessOverrides = overridesSnap.val() || {};
    accessRestrictions = restrictionsSnap.val() || {};
    accessFeatureFlags = flagsSnap.val() || {};
    populateAccessPermissionCatalog();
    renderAccessSummary();
    renderAccessRoles();
    renderAccessAssignments();
    renderAccessOverrides();
    renderAccessRestrictions();
    renderAccessFeatureFlags();
    renderMaintenanceControl();
    const master = isMasterOperator();
    const canRestrict = currentCan("users.restrict");
    const canManageFlags = currentCan("featureflags.manage") && currentCan("audit.write");
    [
      "accessRoleId","accessRoleName","accessRolePermissions","accessRoleSaveBtn",
      "accessAssignUid","accessAssignRole","accessAssignBtn",
      "accessOverrideUid","accessOverridePermission","accessOverrideEffect","accessOverrideBtn"
    ].forEach(id => { const el = $(id); if (el) el.disabled = !master; });
    [
      "accessFlagName","accessFlagEnabled","accessFlagReason","accessFlagBtn"
    ].forEach(id => { const el = $(id); if (el) el.disabled = !canManageFlags; });
    ["accessRestrictionUid","accessRestrictionPermission","accessRestrictionDuration","accessRestrictionReason","accessRestrictionBtn"]
      .forEach(id => { const el = $(id); if (el) el.disabled = !canRestrict; });
    const select = $("accessAssignRole");
    if (select) {
      const options = Object.entries(accessRoles || {}).sort((a,b) => a[0].localeCompare(b[0]));
      select.innerHTML = '<option value="">選擇自訂角色</option>' +
        options.map(([id,item]) => '<option value="' + escapeHtml(id) + '">' + escapeHtml(item?.name || id) + ' (' + escapeHtml(id) + ')</option>').join("");
    }
  }

  async function saveAccessRole() {
    if (!isMasterOperator()) throw new Error("只有最高管理員可以建立自訂角色");
    const id = safeKey($("accessRoleId")?.value, 80);
    const name = String($("accessRoleName")?.value || "").trim().slice(0,80);
    const permissions = String($("accessRolePermissions")?.value || "").split(",").map(item => item.trim()).filter(Boolean);
    if (!id) throw new Error("請輸入角色 ID");
    if (!name) throw new Error("請輸入角色名稱");
    if (!permissions.length) throw new Error("至少需要一項權限");
    const map = {};
    permissions.forEach(permission => {
      const normalized = String(permission || "").trim();
      if (normalized === "*") map.__all__ = true;
      else map[encodeAccessPermission(normalized)] = true;
    });
    await writeAuditedUpdates({
      ["admin/access/roles/" + id]: {
        name,
        permissions: map,
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
        updatedByUid: currentUser.uid,
        updatedByEmail: currentUser.email || ""
      }
    },"access.role.create",currentUser.uid,name,"建立自訂角色 " + id);
    await loadAccessControl();
    $("accessRoleId").value = "";
    $("accessRoleName").value = "";
    $("accessRolePermissions").value = "";
    toast("自訂角色已儲存");
  }
  async function deleteAccessRole(id) {
    if (!isMasterOperator()) throw new Error("只有最高管理員可以刪除自訂角色");
    const key = safeKey(id);
    if (!key || !accessRoles[key]) return;
    if (Object.values(accessAssignments || {}).some(role => String(role) === key)) throw new Error("這個角色仍有使用者指派，請先解除指派");
    const roleName = String(accessRoles[key]?.name || key);
    if (!window.confirm("確定刪除自訂角色「" + roleName + "」？")) return;
    await writeAuditedUpdates({["admin/access/roles/" + key]:null},"access.role.delete","",roleName,"刪除自訂角色 " + key);
    await loadAccessControl();
    toast("自訂角色已刪除");
  }
  async function assignFullAdminRole() {
    if (!isMasterOperator()) throw new Error("只有最高管理員可以授予完整管理權限");
    const uid = String($("accessAssignUid")?.value || "").trim();
    if (!uid) throw new Error("請先輸入使用者 UID");
    if (uid === MASTER_UID) throw new Error("最高管理員不需要被重新指派權限");
    const roleId = "full_admin";
    await writeAuditedUpdates({
      ["admin/access/roles/" + roleId]: {
        name: "完整管理員（與 Master 相同）",
        permissions: {__all__: true},
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
        updatedByUid: currentUser.uid,
        updatedByEmail: currentUser.email || ""
      },
      ["admin/access/roleByUid/" + safeKey(uid,128)]: roleId
    },"access.role.full_admin",uid,roleId,"授予與最高管理員相同的完整管理權限");
    await loadAccessControl();
    $("accessAssignUid").value = "";
    toast("已授予完整管理權限");
  }
  async function assignAccessRole() {
    if (!isMasterOperator()) throw new Error("只有最高管理員可以指派自訂角色");
    const uid = String($("accessAssignUid")?.value || "").trim();
    const role = safeKey($("accessAssignRole")?.value, 80);
    if (!uid) throw new Error("請輸入使用者 UID");
    if (!role || !accessRoles[role]) throw new Error("請選擇有效的自訂角色");
    if (uid === MASTER_UID) throw new Error("最高管理員不能被重新指派角色");
    await writeAuditedUpdates({["admin/access/roleByUid/" + safeKey(uid,128)]:role},"access.role.assign",uid,role,"指派自訂角色 " + role);
    await loadAccessControl();
    $("accessAssignUid").value = "";
    toast("角色已指派");
  }
  async function removeAccessAssignment(uid) {
    if (!isMasterOperator()) throw new Error("只有最高管理員可以解除角色");
    const key = safeKey(uid,128);
    if (!key) return;
    await writeAuditedUpdates({["admin/access/roleByUid/" + key]:null},"access.role.unassign",key,key,"解除自訂角色");
    await loadAccessControl();
    toast("角色指派已解除");
  }
  async function saveAccessOverride() {
    if (!isMasterOperator()) throw new Error("只有最高管理員可以設定個人 Allow / Deny");
    const uid = String($("accessOverrideUid")?.value || "").trim();
    const permission = String($("accessOverridePermission")?.value || "").trim().slice(0,80);
    const effect = $("accessOverrideEffect")?.value === "deny" ? "deny" : "allow";
    if (!uid) throw new Error("請輸入使用者 UID");
    if (!permission) throw new Error("請輸入權限名稱");
    if (uid === MASTER_UID) throw new Error("最高管理員不能被限制權限");
    await writeAuditedUpdates({
      ["admin/access/permissionsByUid/" + safeKey(uid,128) + "/" + encodeAccessPermission(permission)]:effect
    },"access.permission.override",uid,permission,effect.toUpperCase() + " " + permission);
    await loadAccessControl();
    $("accessOverrideUid").value = "";
    $("accessOverridePermission").value = "";
    toast("個人權限覆寫已套用");
  }
  async function removeAccessOverride(uid, permission) {
    if (!isMasterOperator()) throw new Error("只有最高管理員可以移除個人權限覆寫");
    const u = safeKey(uid,128), p = encodeAccessPermission(permission);
    if (!u || !p) return;
    await writeAuditedUpdates({["admin/access/permissionsByUid/" + u + "/" + p]:null},"access.permission.clear",u,p.replace(/__/g,"."),"移除個人權限覆寫");
    await loadAccessControl();
    toast("個人權限覆寫已移除");
  }
  async function saveAccessRestriction() {
    if (!currentCan("users.restrict")) throw new Error("目前管理員權限不足，不能設定功能限制");
    const uid = String($("accessRestrictionUid")?.value || "").trim();
    const permission = String($("accessRestrictionPermission")?.value || "").trim().slice(0,80);
    const duration = String($("accessRestrictionDuration")?.value || "3600000");
    const reason = String($("accessRestrictionReason")?.value || "").trim().slice(0,500);
    if (!uid) throw new Error("請輸入使用者 UID");
    if (!permission) throw new Error("請輸入要限制的功能");
    if (!reason) throw new Error("請輸入限制原因");
    if (uid === MASTER_UID || uid === currentUser?.uid) throw new Error("不能限制最高管理員或自己");
    const allowedDurations = new Set(["3600000","86400000","604800000","2592000000","permanent"]);
    if (!allowedDurations.has(duration)) throw new Error("不支援的限制時間");
    const permanent = duration === "permanent";
    const until = permanent ? 0 : Date.now() + Number(duration);
    await writeAuditedUpdates({
      ["admin/access/restrictionsByUid/" + safeKey(uid,128) + "/" + encodeAccessPermission(permission)]: {
        enabled:true, permanent, until, reason,
        createdAt:firebase.database.ServerValue.TIMESTAMP,
        createdByUid:currentUser.uid,
        createdByEmail:currentUser.email || ""
      }
    },"access.user.restriction",uid,permission,reason + " · " + (permanent ? "永久" : formatDate(until)));
    await loadAccessControl();
    $("accessRestrictionUid").value = "";
    $("accessRestrictionPermission").value = "";
    $("accessRestrictionReason").value = "";
    toast("功能限制已套用");
  }
  async function removeAccessRestriction(uid, permission) {
    if (!currentCan("users.restrict")) throw new Error("目前管理員權限不足，不能解除功能限制");
    const u = safeKey(uid,128), p = encodeAccessPermission(permission);
    if (!u || !p) return;
    await writeAuditedUpdates({["admin/access/restrictionsByUid/" + u + "/" + p]:null},"access.user.restriction.clear",u,p,"解除功能限制");
    await loadAccessControl();
    toast("功能限制已解除");
  }
  async function saveAccessFeatureFlag() {
    if (!currentCan("featureflags.manage") || !currentCan("audit.write")) throw new Error("需要 featureflags.manage 與 audit.write 權限");
    const name = encodeAccessPermission($("accessFlagName")?.value);
    const enabled = $("accessFlagEnabled")?.value !== "false";
    const reason = String($("accessFlagReason")?.value || "").trim().slice(0,500);
    if (!name) throw new Error("請輸入功能名稱");
    await writeAuditedUpdates({
      ["admin/featureFlags/" + name]: {enabled,reason,updatedAt:firebase.database.ServerValue.TIMESTAMP,updatedByUid:currentUser.uid,updatedByEmail:currentUser.email || ""}
    },"feature.flag",currentUser.uid,name,(enabled ? "啟用 " : "關閉 ") + name + (reason ? " · " + reason : ""));
    await loadAccessControl();
    $("accessFlagName").value = "";
    $("accessFlagReason").value = "";
    toast("Feature Flag 已更新");
  }
  async function deleteAccessFeatureFlag(name) {
    if (!currentCan("featureflags.manage") || !currentCan("audit.write")) throw new Error("需要 featureflags.manage 與 audit.write 權限");
    const key = encodeAccessPermission(name);
    if (!key) return;
    if (!window.confirm("確定刪除 Feature Flag「" + key + "」？")) return;
    await writeAuditedUpdates({["admin/featureFlags/" + key]:null},"feature.flag.delete",currentUser.uid,key,"刪除 Feature Flag");
    await loadAccessControl();
    toast("Feature Flag 已刪除");
  }
  function applyNavigationPermissions() {
    const sectionPermissions = {
      overview: "admin.read",
      accounts: "users.read",
      rooms: "rooms.read",
      chat: "chat.read",
      whitelist: "users.update",
      access: "admin.read",
      settings: "settings.manage",
      reports: "reports.read",
      analytics: "analytics.read",
      ai: "ai.use",
      audit: "audit.read"
    };
    let activeSection = "";
    document.querySelectorAll(".nav-item").forEach(btn => {
      const section = String(btn.dataset.section || "");
      const required = sectionPermissions[section];
      const allowed = required === "__master__"
        ? isMasterOperator()
        : currentCan(required || "admin.read");
      btn.classList.toggle("hidden", !allowed);
      btn.setAttribute("aria-hidden", allowed ? "false" : "true");
      if (!allowed && btn.classList.contains("active")) {
        activeSection = section;
      }
    });
    if (activeSection) {
      const fallback = document.querySelector('.nav-item[data-section="overview"]');
      if (fallback && !fallback.classList.contains("hidden")) {
        document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
        fallback.classList.add("active");
        document.querySelectorAll(".admin-section").forEach(x => x.classList.add("hidden"));
        show("section-overview");
        try {
          history.replaceState(null, "", "#overview");
          localStorage.setItem("watchtogether-admin-section", "overview");
          sessionStorage.setItem("watchtogether-admin-section", "overview");
        } catch (_) {}
      }
    }
  }

  function applyRoleUi() {
    const master = isMasterOperator();
    const addPanel = $("whitelistAddPanel");
    const help = $("whitelistHelp");
    if (master) {
      addPanel?.classList.remove("hidden");
      if (help) help.textContent = "到「登入帳號」查看使用者 UID，按「複製 UID」後貼到這裡；新增時可指定「管理員」或「觀察員」。";
    } else if (currentCan("users.update")) {
      addPanel?.classList.add("hidden");
      if (help) help.textContent = "你目前具備管理權限，可依自訂角色允許的功能操作；白名單與最高權限由最高管理員管理。";
    } else {
      addPanel?.classList.add("hidden");
      if (help) help.textContent = "你目前是觀察型管理角色，僅可使用被授予的查看權限。";
    }
    applyNavigationPermissions();
  }

  async function initialize() {
    if (!window.firebase || !window.FIREBASE_CONFIG) {
      hide("loadingScreen");
      show("deniedScreen");
      $("deniedMessage").textContent = "Firebase 設定未載入。";
      return;
    }
    if (adminEmail !== MASTER_EMAIL) {
      hide("loadingScreen");
      show("setupScreen");
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();

    auth.onAuthStateChanged(async user => {
      stopAccountsListener();
      stopReportsListener();
      stopAuditLogsListener();
      stopAutonomousMaintenanceListener();
      currentUser = user || null;
      currentHasAdminAccess = false;
      currentRole = null;
      currentRoleSource = "none";
      currentRolePermissions = {};
      if (reportScanTimer) {
        clearInterval(reportScanTimer);
        reportScanTimer = null;
      }
      accounts = {};
      whitelist = {};
      blocks = {};
      rooms = {};
      reports = {};
      auditLogs = {};
      reportHistory = {};
      chatModerationRoomId = "";
      chatModerationMessages = {};

      hide("loadingScreen");
      hide("setupScreen");
      hide("app");
      hide("deniedScreen");

      if (!user || user.isAnonymous) {
        show("deniedScreen");
        $("deniedMessage").textContent = "請先使用 Google 帳號登入。";
        return;
      }

      try {
        currentRole = await resolveAdminRole(user);
        currentHasAdminAccess = Boolean(currentRole);
        if (!currentHasAdminAccess) {
          show("deniedScreen");
          const title = document.querySelector("#deniedScreen h1");
          if (title) title.textContent = "404";
          $("deniedMessage").textContent = "找不到這個頁面。";
          hide("switchAccountBtn");
          return;
        }

        $("adminAccount").textContent = user.email || "";
        show("app");
        applyRoleUi();
        restoreAdminSection();

        await Promise.all([
          loadAccounts(),
          loadWhitelist(),
          loadBlocks(),
          loadRooms(),
          loadReports().catch(error => console.warn("載入問題回報失敗:", error)),
          loadAuditLogs().catch(error => console.warn("載入操作紀錄失敗:", error)),
          loadAccessControl().catch(error => console.warn("載入 2.0 控制中心失敗:", error)),
          loadSystemSettings().catch(error => console.warn("載入系統設定失敗:", error)),
          loadAiStatus().catch(error => console.warn("載入 AI 狀態失敗:", error)),
          loadAutonomousMaintenance().catch(error => {
            console.warn("載入全自動維護設定失敗:", error);
            autonomousMaintenanceEnabled = false;
            renderAutonomousMaintenance();
          })
        ]);
        startAccountsListener();
        startReportsListener();
        startAuditLogsListener();
        startAutonomousMaintenanceListener();
        startSystemSettingsListener();
        window.addEventListener("wt-access-changed", renderMaintenanceControl);
        populateAccessPermissionCatalog();
        renderAccessSummary();
        renderAutonomousMaintenance();
        startReportAutomation();
      } catch (error) {
        console.error(error);
        show("deniedScreen");
        $("deniedMessage").textContent = "管理員資料載入失敗，請檢查 Firebase Rules。";
      }
    });
  }

  function buildAgentSnapshot() {
    const safeAccounts = Object.entries(accounts || {}).slice(-120).map(([uid,item]) => ({
      uid,
      email: String(item?.email || "").slice(0,320),
      name: String(item?.displayName || item?.name || "").slice(0,80),
      enabled: item?.enabled !== false
    }));
    const safeRooms = Object.entries(rooms || {}).slice(-120).map(([id,item]) => ({
      roomId:id,
      owner:String(item?.owner || "").slice(0,128),
      name:String(item?.name || "").slice(0,120),
      sourceType:String(item?.sourceType || "").slice(0,40),
      updatedAt:Number(item?.updatedAt || item?.createdAt || 0)
    }));
    const safeReports = Object.entries(reports || {}).slice(-120).map(([id,item]) => ({
      id,
      uid:String(item?.uid || "").slice(0,128),
      category:String(item?.category || "").slice(0,80),
      status:String(item?.status || "open").slice(0,40),
      occurrences:Number(item?.occurrences || 0),
      fingerprint:String(item?.fingerprint || "").slice(0,80),
      details:String(item?.details || "").slice(0,600)
    }));
    const safeAudit = Object.entries(auditLogs || {}).slice(-120).map(([id,item]) => ({
      id,
      action:String(item?.action || "").slice(0,80),
      actorUid:String(item?.actorUid || "").slice(0,128),
      actorEmail:String(item?.actorEmail || "").slice(0,320),
      targetUid:String(item?.targetUid || "").slice(0,128),
      targetName:String(item?.targetName || "").slice(0,120),
      createdAt:Number(item?.createdAt || 0),
      details:String(item?.details || "").slice(0,600)
    }));
    return {
      generatedAt:Date.now(),
      currentAdmin:{uid:String(currentUser?.uid || ""),role:String(currentRole || ""),roleSource:String(currentRoleSource || "")},
      accounts:safeAccounts,
      rooms:safeRooms,
      reports:safeReports,
      auditLogs:safeAudit
    };
  }

  async function executeAgentAction(action,args) {
    const name = String(action || "");
    const data = args && typeof args === "object" ? args : {};
    const uid = String(data.uid || "").trim();
    const permission = String(data.permission || "").trim();
    const reason = String(data.reason || "").trim().slice(0,500);

    if (name === "block_user") {
      if (!currentCan("users.restrict")) throw new Error("沒有 users.restrict 權限");
      if (!uid || uid === MASTER_UID || uid === currentUser?.uid) throw new Error("無效或禁止的 UID");
      if (!accounts[uid]) throw new Error("找不到指定使用者");
      const rawDuration = String(data.durationMs || "3600000");
      const allowedDurations = new Set(["600000","3600000","86400000","604800000","2592000000","permanent"]);
      if (!allowedDurations.has(rawDuration)) throw new Error("不支援的封鎖時間");
      $("blockUserUid").value = uid;
      $("blockDuration").value = rawDuration;
      await confirmBlock();
      return;
    }

    if (name === "unblock_user") {
      if (!currentCan("users.restrict")) throw new Error("沒有 users.restrict 權限");
      if (!uid || uid === MASTER_UID) throw new Error("無效或禁止的 UID");
      await unblockUser(uid, {skipConfirm:true, source:"ai"});
      return;
    }

    if (name === "delete_room") {
      if (!currentCan("rooms.manage")) throw new Error("沒有 rooms.manage 權限");
      const roomId = String(data.roomId || "").trim().toUpperCase();
      if (!roomId) throw new Error("缺少房間 ID");
      await deleteRoom(roomId, {skipConfirm:true, source:"ai"});
      return;
    }

    if (name === "set_user_restriction") {
      if (!currentCan("users.restrict")) throw new Error("沒有 users.restrict 權限");
      if (!uid || uid === MASTER_UID || uid === currentUser?.uid) throw new Error("無效或禁止的 UID");
      if (!permission) throw new Error("缺少限制功能");
      if (!reason) throw new Error("限制原因不可空白");
      const duration = String(data.durationMs || "3600000");
      const allowedDurations = new Set(["3600000","86400000","604800000","2592000000","permanent"]);
      if (!allowedDurations.has(duration)) throw new Error("不支援的限制時間");
      const permanent = duration === "permanent";
      const until = permanent ? 0 : Date.now() + Number(duration);
      await writeAuditedUpdates({
        ["admin/access/restrictionsByUid/" + safeKey(uid,128) + "/" + encodeAccessPermission(permission)]: {
          enabled:true, permanent, until, reason,
          createdAt:firebase.database.ServerValue.TIMESTAMP,
          createdByUid:currentUser.uid,
          createdByEmail:currentUser.email || ""
        }
      },"access.user.restriction",uid,permission,reason + " · " + (permanent ? "永久" : formatDate(until)));
      await loadAccessControl();
      return;
    }

    if (name === "clear_user_restriction") {
      if (!currentCan("users.restrict")) throw new Error("沒有 users.restrict 權限");
      if (!uid || !permission) throw new Error("缺少 UID 或功能");
      await writeAuditedUpdates(
        {["admin/access/restrictionsByUid/" + safeKey(uid,128) + "/" + encodeAccessPermission(permission)]:null},
        "access.user.restriction.clear",
        uid,
        permission,
        "AI Agent 解除功能限制"
      );
      await loadAccessControl();
      return;
    }

    if (name === "set_feature_flag") {
      if (!currentCan("featureflags.manage") || !currentCan("audit.write")) {
        throw new Error("需要 featureflags.manage 與 audit.write 權限");
      }
      const flag = encodeAccessPermission(permission);
      if (!flag) throw new Error("缺少 Feature Flag 名稱");
      await writeAuditedUpdates({
        ["admin/featureFlags/" + flag]: {
          enabled:data.enabled !== false,
          reason,
          updatedAt:firebase.database.ServerValue.TIMESTAMP,
          updatedByUid:currentUser.uid,
          updatedByEmail:currentUser.email || ""
        }
      },"feature.flag",currentUser.uid,flag,(data.enabled === false ? "關閉 " : "啟用 ") + flag + (reason ? " · " + reason : ""));
      await loadAccessControl();
      return;
    }

    if (name === "assign_role") {
      if (!isMasterOperator()) throw new Error("只有最高管理員可以指派角色");
      if (!uid || uid === MASTER_UID) throw new Error("無效或禁止的 UID");
      const role = safeKey(data.role,80);
      if (!role || !accessRoles[role]) throw new Error("角色不存在");
      await writeAuditedUpdates(
        {["admin/access/roleByUid/" + safeKey(uid,128)]:role},
        "access.role.assign",
        uid,
        role,
        "AI Agent 指派自訂角色"
      );
      await loadAccessControl();
      return;
    }

    if (name === "set_override") {
      if (!isMasterOperator()) throw new Error("只有最高管理員可以設定個人 Allow / Deny");
      if (!uid || uid === MASTER_UID || !permission) throw new Error("無效或禁止的目標");
      const effect = String(data.effect || "").toLowerCase();
      if (effect !== "allow" && effect !== "deny") throw new Error("effect 必須是 allow 或 deny");
      await writeAuditedUpdates(
        {["admin/access/permissionsByUid/" + safeKey(uid,128) + "/" + encodeAccessPermission(permission)]:effect},
        "access.permission.override",
        uid,
        permission,
        effect.toUpperCase() + " " + permission
      );
      await loadAccessControl();
      return;
    }

    if (name === "set_whitelist") {
      if (!isMasterOperator()) throw new Error("只有最高管理員可以管理白名單");
      if (!uid || uid === MASTER_UID) throw new Error("無效或禁止的 UID");
      const role = data.role === "viewer" ? "viewer" : "admin";
      const whitelistEmail = String(data.email || accounts[uid]?.email || "").trim().toLowerCase().slice(0,320);
      if (whitelistEmail.length < 4) throw new Error("找不到指定使用者 Email");
      await writeAuditedUpdates({
        ["admin/whitelistByUid/" + safeKey(uid,128)]: {
          uid,
          email:whitelistEmail,
          role,
          enabled:data.enabled !== false,
          addedAt:firebase.database.ServerValue.TIMESTAMP,
          updatedAt:firebase.database.ServerValue.TIMESTAMP,
          updatedByUid:currentUser.uid,
          addedByUid:currentUser.uid,
          addedByEmail:currentUser.email || ""
        }
      },
      data.enabled === false ? "whitelist.toggle" : "whitelist.add",
      uid,
      role,
      "AI Agent 更新白名單"
      );
      await loadWhitelist();
      return;
    }

    if (name === "delete_audit") {
      if (!currentCan("audit.delete")) throw new Error("沒有 audit.delete 權限");
      if (!uid && !data.id) throw new Error("缺少 Audit ID");
      const id = safeKey(data.id || uid,256);
      if (!id) throw new Error("無效的 Audit ID");
      await deleteAuditLog(id);
      return;
    }

    throw new Error("不支援的 AI Agent 操作");
  }

  function restoreAdminSection() {
    let section = String(window.location.hash || "").replace(/^#/, "").trim();
    if (!section) {
      try {
        section =
          localStorage.getItem("watchtogether-admin-section") ||
          sessionStorage.getItem("watchtogether-admin-section") ||
          "overview";
      } catch (_) {
        try {
          section = sessionStorage.getItem("watchtogether-admin-section") || "overview";
        } catch (__) {
          section = "overview";
        }
      }
    }
    const validSections = new Set(Array.from(document.querySelectorAll(".nav-item")).map(btn => btn.dataset.section));
    if (!validSections.has(section)) section = "overview";
    const btn = document.querySelector('.nav-item[data-section="' + CSS.escape(section) + '"]') ||
      document.querySelector('.nav-item[data-section="overview"]');
    if (!btn) return;
    document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".admin-section").forEach(x => x.classList.add("hidden"));
    show("section-" + btn.dataset.section);
    try { history.replaceState(null, "", "#" + btn.dataset.section); } catch (_) {}
    try {
      localStorage.setItem("watchtogether-admin-section", btn.dataset.section);
      sessionStorage.setItem("watchtogether-admin-section", btn.dataset.section);
    } catch (_) {}
  }

  function setupEvents() {
    document.addEventListener("dblclick", event => {
      if (event.target?.closest("button,a,input,select")) {
        event.preventDefault();
      }
    }, {passive:false});
    document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".admin-section").forEach(section => section.classList.add("hidden"));
      show("section-" + btn.dataset.section);
      try { history.replaceState(null, "", "#" + btn.dataset.section); } catch (_) {}
      try {
        localStorage.setItem("watchtogether-admin-section", btn.dataset.section);
        sessionStorage.setItem("watchtogether-admin-section", btn.dataset.section);
      } catch (_) {
        try { sessionStorage.setItem("watchtogether-admin-section", btn.dataset.section); } catch (__) {}
      }
    }));

    $("accountSearch")?.addEventListener("input", renderAccounts);
     $("accountStatusFilter")?.addEventListener("change", renderAccounts);
    $("roomSearch")?.addEventListener("input", renderRooms);
    $("whitelistSearch")?.addEventListener("input", renderWhitelist);
    $("reportSearch")?.addEventListener("input", renderReports);
    $("reportStatusFilter")?.addEventListener("change", renderReports);

    $("addWhitelistBtn")?.addEventListener("click", () => addWhitelist().catch(error => { console.error(error); toast("加入白名單失敗"); }));
    $("whitelistEmail")?.addEventListener("keydown", event => {
      if (event.key === "Enter") void addWhitelist().catch(error => { console.error(error); toast("加入白名單失敗"); });
    });

    $("refreshBtn")?.addEventListener("click", () => Promise.all([
      loadAccounts(),loadWhitelist(),loadBlocks(),loadRooms(),loadReports(),loadAuditLogs(),loadSystemSettings()
    ]).then(() => toast("已重新整理")).catch(() => toast("重新整理失敗")));

    $("accountsRefreshBtn")?.addEventListener("click", () => Promise.all([
      loadAccounts(),loadBlocks()
    ]).then(() => toast("已重新整理")).catch(() => toast("重新整理失敗")));

    $("roomsRefreshBtn")?.addEventListener("click", () => loadRooms().then(() => toast("已重新整理")).catch(() => toast("重新整理失敗")));
    $("chatModerationLoadBtn")?.addEventListener("click", () => loadChatModeration().then(() => toast("聊天紀錄已載入")).catch(error => {
      console.error(error);
      toast(error?.message || "聊天紀錄載入失敗");
    }));
    $("chatModerationRefreshBtn")?.addEventListener("click", () => loadChatModeration().then(() => toast("聊天紀錄已重新整理")).catch(error => {
      console.error(error);
      toast(error?.message || "聊天紀錄重新整理失敗");
    }));
    $("chatModerationSearch")?.addEventListener("input", renderChatModeration);
    $("chatModerationRoomId")?.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        event.preventDefault();
        void loadChatModeration().catch(error => toast(error?.message || "聊天紀錄載入失敗"));
      }
    });

    $("reportsRefreshBtn")?.addEventListener("click", () => loadReports().then(() => toast("問題回報已重新整理")).catch(error => {
      console.error(error);
      toast(error?.message || "問題回報重新整理失敗");
    }));
    $("reportsExportBtn")?.addEventListener("click", exportReports);
    $("reportsScanBtn")?.addEventListener("click", () => scanWebsiteAndReports().then(() => toast("自動掃描完成")).catch(error => toast(error?.message || "自動掃描失敗")));
    $("autonomousMaintenanceToggle")?.addEventListener("change", event => {
      setAutonomousMaintenance(event.target.checked).catch(error => {
        console.error("切換全自動維護失敗:", error);
        autonomousMaintenanceEnabled = !event.target.checked;
        renderAutonomousMaintenance();
        toast(error?.message || "全自動維護設定失敗");
      });
    });
    $("reportRepairBtn")?.addEventListener("click", () => repairDecisionStart().catch(error => { console.error(error); toast(error?.message || "開始處理失敗"); }));
    $("reportRecheckBtn")?.addEventListener("click", () => recheckCurrentReport().catch(error => { console.error(error); toast(error?.message || "重新檢查失敗"); }));
    $("reportLaterBtn")?.addEventListener("click", () => {
      $("reportHint").textContent = "已保留這筆回報，狀態維持待處理。";
    });
    $("accessRefreshBtn")?.addEventListener("click", () => loadAccessControl().then(() => toast("2.0 控制中心已重新整理")).catch(error => { console.error(error); toast(error?.message || "重新整理失敗"); }));
    $("systemSettingsRefreshBtn")?.addEventListener("click", () => loadSystemSettings().then(() => toast("系統設定已重新整理")).catch(error => { console.error(error); toast(error?.message || "重新整理失敗"); }));
    $("systemSettingsSaveBtn")?.addEventListener("click", () => saveSystemSettings().catch(error => { console.error(error); toast(error?.message || "系統設定儲存失敗"); }));
    $("analyticsRefreshBtn")?.addEventListener("click", () => {
      renderAnalytics();
      toast("Analytics 已重新整理");
    });
    $("aiStatusRefreshBtn")?.addEventListener("click", () => {
      loadAiStatus().then(() => toast("AI 狀態已更新")).catch(error => toast(error?.message || "AI 狀態檢查失敗"));
    });
    $("maintenanceOpenBtn")?.addEventListener("click", () => setSiteMaintenance(true).catch(error => { console.error(error); toast(error?.message || "關站失敗"); }));
    $("maintenanceCloseBtn")?.addEventListener("click", () => setSiteMaintenance(false).catch(error => { console.error(error); toast(error?.message || "重新開站失敗"); }));

    $("accessRoleSaveBtn")?.addEventListener("click", () => saveAccessRole().catch(error => { console.error(error); toast(error?.message || "儲存角色失敗"); }));
    $("accessAssignBtn")?.addEventListener("click", () => assignAccessRole().catch(error => { console.error(error); toast(error?.message || "指派角色失敗"); }));
    $("accessFullAdminBtn")?.addEventListener("click", () => assignFullAdminRole().catch(error => { console.error(error); toast(error?.message || "授予完整管理權限失敗"); }));
    $("accessOverrideBtn")?.addEventListener("click", () => saveAccessOverride().catch(error => { console.error(error); toast(error?.message || "設定 Allow / Deny 失敗"); }));
    $("accessRestrictionBtn")?.addEventListener("click", () => saveAccessRestriction().catch(error => { console.error(error); toast(error?.message || "設定功能限制失敗"); }));
    $("accessFlagBtn")?.addEventListener("click", () => saveAccessFeatureFlag().catch(error => { console.error(error); toast(error?.message || "更新 Feature Flag 失敗"); }));
    $("accessAssignUid")?.addEventListener("keydown", event => {
      if (event.key === "Enter") void assignAccessRole().catch(error => { console.error(error); toast(error?.message || "指派角色失敗"); });
    });
    $("accessOverrideUid")?.addEventListener("keydown", event => {
      if (event.key === "Enter") void saveAccessOverride().catch(error => { console.error(error); toast(error?.message || "設定 Allow / Deny 失敗"); });
    });
    $("accessRestrictionUid")?.addEventListener("keydown", event => {
      if (event.key === "Enter") void saveAccessRestriction().catch(error => { console.error(error); toast(error?.message || "設定功能限制失敗"); });
    });

    $("auditSearch")?.addEventListener("input", renderAuditLogs);
    $("auditActionFilter")?.addEventListener("change", renderAuditLogs);
    $("auditUserFilter")?.addEventListener("input", renderAuditLogs);
    $("auditFrom")?.addEventListener("change", renderAuditLogs);
    $("auditTo")?.addEventListener("change", renderAuditLogs);
    $("auditRefreshBtn")?.addEventListener("click", () => loadAuditLogs().then(() => toast("已重新整理")).catch(() => toast("重新整理失敗")));

    $("logoutBtn")?.addEventListener("click", () => auth.signOut());

    $("switchAccountBtn")?.addEventListener("click", async () => {
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({prompt:"select_account"});
        await auth.signInWithPopup(provider);
      } catch (error) {
        console.error(error);
        toast("切換帳號失敗");
      }
    });

    $("userEditClose")?.addEventListener("click", closeUserEdit);
    $("userEditCancel")?.addEventListener("click", closeUserEdit);
    $("userEditSave")?.addEventListener("click", () => saveUser().catch(error => { console.error(error); toast("儲存失敗"); }));

    $("blockClose")?.addEventListener("click", closeBlockModal);
    $("blockCancel")?.addEventListener("click", closeBlockModal);
    $("blockConfirm")?.addEventListener("click", () => confirmBlock().catch(error => { console.error(error); toast(error?.message || "封鎖失敗"); }));

    $("reportClose")?.addEventListener("click", closeReportModal);
    $("reportCancel")?.addEventListener("click", closeReportModal);
    $("reportSave")?.addEventListener("click", () => saveReportStatus().catch(error => { console.error(error); $("reportHint").textContent = error?.message || "儲存狀態失敗"; toast(error?.message || "儲存狀態失敗"); }));
    $("reportDelete")?.addEventListener("click", () => deleteReport().catch(error => { console.error(error); $("reportHint").textContent = error?.message || "刪除回報失敗"; toast(error?.message || "刪除回報失敗"); }));

    document.querySelectorAll(".admin-modal").forEach(modal => {
      modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.add("hidden");
      });
    });
  }

  window.WT_ADMIN_CONTEXT = {
    isAuthorized: () => Boolean(currentHasAdminAccess),
    isMaster: () => Boolean(isMasterOperator()),
    hasPermission: (permission) => currentCan(permission),
    snapshot: () => buildAgentSnapshot(),
    executeAction: (action,args) => executeAgentAction(action,args),
    overview: () => buildAgentSnapshot().currentAdmin,
    searchUsers: (query) => {
      const q=String(query||"").trim().toLowerCase();
      return Object.entries(accounts||{}).filter(([uid,item]) => !q || [uid,item?.email,item?.displayName,item?.name].join(" ").toLowerCase().includes(q)).slice(0,50).map(([uid,item])=>({uid,email:item?.email||"",name:item?.displayName||item?.name||""}));
    },
    searchRooms: (query) => {
      const q=String(query||"").trim().toLowerCase();
      return Object.entries(rooms||{}).filter(([id,item]) => !q || [id,item?.name,item?.owner,item?.sourceType].join(" ").toLowerCase().includes(q)).slice(0,50).map(([id,item])=>({roomId:id,name:item?.name||"",owner:item?.owner||"",sourceType:item?.sourceType||""}));
    },
    reportsSummary: () => Object.entries(reports||{}).slice(-50).map(([id,item])=>({id,status:item?.status||"open",category:item?.category||"",uid:item?.uid||"",details:item?.details||""})),
    recentAudit: () => Object.entries(auditLogs||{}).slice(-50).map(([id,item])=>({id,action:item?.action||"",actorUid:item?.actorUid||"",targetUid:item?.targetUid||"",createdAt:item?.createdAt||0,details:item?.details||""})),
    maintenance: () => window.WT_ACCESS_CONTROL?.getMaintenance?.() || {enabled:false}
  };

  setupEvents();
  initialize();
})();