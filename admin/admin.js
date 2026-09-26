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
  let accountsRef = null;
  let reportsRef = null;
  let auditLogsRef = null;

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
    if (!user || user.isAnonymous) return null;
    if (isMasterUser(user)) return "master";
    const snapshot = await db.ref("admin/whitelistByUid/" + user.uid).once("value");
    const item = snapshot.val();
    if (!item || item.uid !== user.uid || item.enabled !== true) return null;
    return item.role === "viewer" ? "viewer" : "admin";
  }

  function isAdminOperator() {
    return currentRole === "master" || currentRole === "admin";
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
              (isAdminOperator() ? '<button class="btn danger" type="button" data-room-delete="' + escapeHtml(key) + '">🗑️ 刪除</button>' : '<span class="muted">僅可查看</span>') +
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

          const canManage = currentRole === "master" || currentRole === "admin";
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
    "whitelist.role": "調整權限",
    "whitelist.toggle": "啟用 / 停用",
    "whitelist.remove": "移除白名單"
  };

  function stopAuditLogsListener() {
    if (!auditLogsRef) return;
    try { auditLogsRef.off(); } catch (_) {}
    auditLogsRef = null;
  }

  async function writeAuditLog(action, targetUid, targetName, details) {
    if (currentRole !== "master" && currentRole !== "admin") return;
    try {
      await db.ref("admin/auditLogs").push({
        action:String(action || "other").slice(0,40),
        actorUid:String(currentUser?.uid || "").slice(0,128),
        actorEmail:String(currentUser?.email || "").slice(0,320),
        actorRole:String(currentRole || "").slice(0,20),
        targetUid:String(targetUid || "").slice(0,128),
        targetName:String(targetName || "").slice(0,200),
        details:String(details || "").slice(0,1000),
        createdAt:firebase.database.ServerValue.TIMESTAMP
      });
    } catch (error) {
      console.warn("寫入管理員操作紀錄失敗:", error);
    }
  }

  async function loadAuditLogs() {
    if (!currentHasAdminAccess) {
      auditLogs = {};
      renderAuditLogs();
      return;
    }
    const snapshot = await db.ref("admin/auditLogs").limitToLast(300).once("value");
    auditLogs = snapshot.val() || {};
    renderAuditLogs();
  }

  function startAuditLogsListener() {
    stopAuditLogsListener();
    if (!currentHasAdminAccess) return;
    auditLogsRef = db.ref("admin/auditLogs").limitToLast(300);
    auditLogsRef.on("value", snapshot => {
      if (!currentHasAdminAccess) return;
      auditLogs = snapshot.val() || {};
      renderAuditLogs();
    }, error => {
      console.error("audit logs realtime listener failed", error);
    });
  }

  function renderAuditLogs() {
    const query = String($("auditSearch")?.value || "").trim().toLowerCase();
    const filter = String($("auditActionFilter")?.value || "all");
    const rows = Object.entries(auditLogs || {})
      .filter(([id,item]) => {
        if (!item || typeof item !== "object") return false;
        const action = String(item.action || "other");
        if (filter !== "all" && action !== filter) return false;
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
          return '<tr>' +
            '<td><span class="small">' + escapeHtml(formatDate(item.createdAt)) + '</span></td>' +
            '<td><div class="primary-text">' + escapeHtml(actor) + '</div><span class="small">' + escapeHtml(item.actorRole || "") + '</span></td>' +
            '<td><span class="audit-action">' + escapeHtml(label) + '</span></td>' +
            '<td class="audit-target"><div class="primary-text">' + escapeHtml(target) + '</div><span class="small">' + escapeHtml(item.targetUid || "") + '</span></td>' +
            '<td class="audit-content">' + escapeHtml(item.details || "") + '</td>' +
          '</tr>';
        }).join("")
      : '<tr><td colspan="5" class="muted">目前沒有操作紀錄。</td></tr>';
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
    const response = await fetch(endpoint,{
      method:"POST",
      cache:"no-store",
      credentials:"omit",
      headers:{"Content-Type":"application/json"},
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
    if (!response.ok || !result?.ok || !result?.analysis) {
      throw new Error(String(result?.error || "AI 分析失敗"));
    }
    return result;
  }

  async function writeReportHistory(id,event,details) {
    if (!id || !currentUser) return;
    try {
      await db.ref("reportHistoryEvents/" + id).push({
        reportId:String(id).slice(0,128),
        event,
        createdAt:firebase.database.ServerValue.TIMESTAMP,
        actorUid:currentUser.uid,
        actorEmail:currentUser.email || "",
        source:"admin",
        details:String(details || "").slice(0,500)
      });
    } catch (error) {
      console.warn("report history write failed",error);
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
    await writeReportHistory(id,"scanner_detected","系統網站掃描發現：" + String(finding.name || "unknown"));
    return id;
  }

  async function scanUserReports(limit = 5) {
    const entries = Object.entries(reports || {})
      .filter(([,item]) => item && (item.source === "manual" || item.source === "auto") && normalizeReportStatus(item.status) !== "resolved")
      .sort((a,b) => Number(b[1]?.createdAt || 0) - Number(a[1]?.createdAt || 0))
      .slice(0,limit);

    for (const [id,item] of entries) {
      try {
        const verification = await runBugServiceVerify(String(item.category || "other"));
        const result = await analyzeReportOnAdmin(id,item,verification,"admin_review");
        const analysis = result?.analysis || null;
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
          aiCheckedAt:firebase.database.ServerValue.TIMESTAMP,
          aiStatus:String(analysis?.status || "inconclusive"),
          aiConfidence:Number(analysis?.confidence || 0),
          aiTitle:String(analysis?.title || "").slice(0,220),
          aiSummary:String(analysis?.summary || "").slice(0,900),
          aiRootCause:String(analysis?.rootCause || "").slice(0,900),
          aiSuggestion:String(analysis?.suggestion || "").slice(0,900),
          aiModel:String(result?.model || "").slice(0,100)
        };
        await db.ref("reports/" + id).update(updates);
      } catch (error) {
        await db.ref("reports/" + id).update({
          verificationState:"failed",
          aiStatus:"unavailable",
          aiError:String(error?.message || "自動檢查失敗").slice(0,500),
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
      for (const finding of findings.slice(0,10)) {
        const id = await upsertScannerFinding(finding,result);
        if (id) {
          try {
            const item = (await db.ref("reports/" + id).once("value")).val() || reports[id] || {};
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
                aiCheckedAt:firebase.database.ServerValue.TIMESTAMP
              });
            }
          } catch (_) {}
        }
      }

      await scanUserReports(5);

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
          const canManage = currentRole === "master" || currentRole === "admin";
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
    const canManageReport = currentRole === "master" || currentRole === "admin";
    $("reportRepairBtn").classList.toggle("hidden", !canManageReport || normalizeReportStatus(item.status) === "resolved");
    $("reportRepairBtn").textContent = normalizeReportStatus(item.status) === "in_progress" ? "處理中" : "開始處理";
    $("reportHint").textContent = account.email ? "回報帳號：" + account.email + " · 來源：" + reportSourceLabel(item) : "來源：" + reportSourceLabel(item);
    $("reportDelete").classList.toggle("hidden", !(currentRole === "master" || currentRole === "admin"));
    $("reportSave").classList.toggle("hidden", !(currentRole === "master" || currentRole === "admin"));
    show("reportModal");
    await loadReportHistory(String(id || ""));
  }

  function closeReportModal() {
    hide("reportModal");
  }

  async function saveReportStatus() {
    if (currentRole !== "master" && currentRole !== "admin") return;
    const id = String($("reportId").value || "").trim();
    const item = reports[id];
    if (!id || !item) {
      toast("找不到這筆回報");
      return;
    }

    const status = normalizeReportStatus($("reportStatus").value);
    await db.ref("reports/" + id).update({
      status,
      handledAt: firebase.database.ServerValue.TIMESTAMP,
      handledByUid: currentUser.uid,
      handledByEmail: currentUser.email || "",
      ...(status !== "resolved" ? {autoResolvedAt: null, autoResolvedBuild: null, autoResolveReason: null} : {})
    });
    try {
      const historyRef = db.ref("reportHistory/" + id).push();
      await historyRef.set({
        event: "manual_status",
        createdAt: firebase.database.ServerValue.TIMESTAMP,
        actorUid: currentUser.uid,
        actorEmail: currentUser.email || "",
        source: "admin",
        details: "管理員將狀態改為 " + REPORT_STATUS_LABELS[status]
      });
    } catch (historyError) {
      console.warn("寫入問題回報處理紀錄失敗:", historyError);
    }
    await loadReports();
    $("reportHandledBy").textContent = currentUser.email || currentUser.uid || "—";
    $("reportAutoResolve").textContent = status === "resolved" ? "已處理（手動）" : "監控中";
    $("reportHint").textContent = "狀態已更新。";
    void loadReportHistory(id);
    void writeAuditLog("report.status", item.uid, item.uid, "回報 " + id + " 狀態改為 " + REPORT_STATUS_LABELS[status]);
    toast("回報狀態已更新");
  }

  async function deleteReport() {
    if (currentRole !== "master" && currentRole !== "admin") return;
    const id = String($("reportId").value || "").trim();
    const item = reports[id];
    if (!id || !item) {
      toast("找不到這筆回報");
      return;
    }
    if (!window.confirm("確定刪除這筆問題回報？刪除後無法復原。")) return;
    const historySnapshot = await db.ref("reportHistoryEvents/" + id).once("value");
    const updates = {
      ["reports/" + id]: null,
      ["reportHistory/" + id]: null
    };
    historySnapshot.forEach(child => {
      updates["reportHistoryEvents/" + id + "/" + child.key] = null;
    });
    await db.ref().update(updates);
    await loadReports();
    closeReportModal();
    void writeAuditLog("report.delete", item.uid, item.uid, "刪除回報 " + id);
    toast("問題回報已刪除");
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

    const match = Object.values(accounts || {}).find(item =>
      item && String(item.uid || "") === uid
    );
    if (!match?.uid) {
      toast("找不到這個 UID，請先讓該使用者登入 WatchTogether 一次");
      return;
    }

    const email = String(match.email || "").trim().toLowerCase();
    const role = $("whitelistRole")?.value === "viewer" ? "viewer" : "admin";
    await db.ref("admin/whitelistByUid/" + uid).set({
      uid,
      email,
      role,
      enabled:true,
      addedAt:firebase.database.ServerValue.TIMESTAMP,
      addedByUid:currentUser.uid,
      addedByEmail:currentUser.email || ""
    });
    input.value = "";
    await loadWhitelist();
    void writeAuditLog("whitelist.add", uid, email, "新增 " + role + " 權限");
    toast("已加入白名單管理員");
  }

  async function changeWhitelistRole(uid) {
    if (!isMasterUser(currentUser)) { toast("只有最高管理員可以調整權限"); return; }
    const item = whitelist[uid];
    if (!item) return;
    if (uid === MASTER_UID) { toast("最高管理員的權限不可修改"); return; }
    const role = $("whitelistBody")?.querySelector('[data-role-select="' + uid.replace(/"/g, '\"') + '"]')?.value === "viewer" ? "viewer" : "admin";
    await db.ref("admin/whitelistByUid/" + uid).update({
      role,
      updatedAt:firebase.database.ServerValue.TIMESTAMP,
      updatedByUid:currentUser.uid
    });
    await loadWhitelist();
    void writeAuditLog("whitelist.role", uid, item.email || uid, "調整為 " + role);
    toast(role === "viewer" ? "已設為觀察員" : "已設為管理員");
  }

  async function toggleWhitelist(uid) {
    if (!isMasterUser(currentUser)) { toast("只有最高管理員可以管理白名單"); return; }
    const item = whitelist[uid];
    if (!item) return;
    await db.ref("admin/whitelistByUid/" + uid).update({
      enabled:item.enabled !== true,
      updatedAt:firebase.database.ServerValue.TIMESTAMP,
      updatedByUid:currentUser.uid
    });
    await loadWhitelist();
    void writeAuditLog("whitelist.toggle", uid, item.email || uid, item.enabled === true ? "停用管理員資格" : "啟用管理員資格");
    toast(item.enabled === true ? "已停用" : "已啟用");
  }

  async function removeWhitelist(uid) {
    if (!isMasterUser(currentUser)) { toast("只有最高管理員可以管理白名單"); return; }
    const item = whitelist[uid];
    if (!item) return;
    if (!window.confirm("確定刪除 " + (item.email || "這個帳號") + " 的管理員資格？")) return;
    await db.ref("admin/whitelistByUid/" + uid).remove();
    await loadWhitelist();
    void writeAuditLog("whitelist.remove", uid, item.email || uid, "移除管理員資格");
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
    if (!isAdminOperator()) return;
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

    try {
      await db.ref().update(updates);

      try {
        const membersSnapshot = await db.ref("members").once("value");
        const memberUpdates = {};
        Object.entries(membersSnapshot.val() || {}).forEach(([roomId,members]) => {
          if (members && members[uid]) {
            memberUpdates["members/" + roomId + "/" + uid + "/name"] = displayName;
          }
        });
        if (Object.keys(memberUpdates).length) await db.ref().update(memberUpdates);
      } catch (error) {
        console.warn("同步現有房間名稱失敗:", error);
      }

      accounts[uid] = {...accounts[uid],displayName,photoURL};
      profiles[uid] = {...profile,displayName,avatarEmoji,theme,notifications};
      renderAccounts();
      closeUserEdit();
      void writeAuditLog("user.update", uid, displayName, "管理員更新使用者資料");
      toast("使用者資料已更新");
    } catch (error) {
      console.error(error);
      toast(error?.message || "使用者資料更新失敗");
    }
  }

  function openBlockUser(uid) {
    if (!isAdminOperator()) return;
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
    if (!isAdminOperator()) return;
    const uid = String($("blockUserUid").value || "").trim();
    const item = accounts[uid];
    if (!uid || !item) { toast("找不到使用者"); return; }
    if (uid === MASTER_UID || String(item.email || "").trim().toLowerCase() === MASTER_EMAIL) {
      toast("最高管理員不能被封鎖");
      return;
    }

    const duration = String($("blockDuration").value || "");
    const permanent = duration === "permanent";
    const blockedUntil = permanent ? 0 : Date.now() + Number(duration || 3600000);

    await db.ref("admin/blocksByUid/" + uid).set({
      uid,
      email:item.email || "",
      displayName:item.displayName || "",
      permanent,
      blockedUntil,
      blockedAt:firebase.database.ServerValue.TIMESTAMP,
      blockedByUid:currentUser.uid,
      blockedByEmail:currentUser.email || "",
       blockedByRole:currentRole
    });

    await loadBlocks();
    closeBlockModal();
    void writeAuditLog("block", uid, item.displayName || item.email || uid, permanent ? "永久封鎖" : "封鎖 " + formatRemaining({blockedUntil,permanent}));
    toast(permanent ? "已永久封鎖使用者" : "已封鎖使用者");
  }

   async function unblockUser(uid) {
     if (!isAdminOperator()) return;
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

     if (!window.confirm("確定解除「" + (item.displayName || item.email || uid) + "」的封鎖？")) return;
     await db.ref("admin/blocksByUid/" + uid).remove();
     await loadBlocks();
     void writeAuditLog("unblock", uid, item.displayName || item.email || uid, "解除封鎖");
     toast("已解除封鎖");
   }

  async function deleteRoom(roomId) {
    if (!isAdminOperator()) return;
    const key = String(roomId || "").trim().toUpperCase();
    const item = rooms[key];
    if (!item) { toast("這個房間已不存在"); await loadRooms(); return; }
    const name = item.name || item.__meta?.name || "一起看";

    if (!window.confirm("確定刪除房間「" + name + "」(" + key + ")？\n房間與播放、聊天、成員、待播放資料都會一起刪除。")) {
      return;
    }

    const updates = {};
    ["rooms/","roomMeta/","members/","playback/","chat/","queue/","kicked/","controlRequests/"].forEach(prefix => {
      updates[prefix + key] = null;
    });

    await db.ref().update(updates);
    delete rooms[key];
    renderRooms();
    updateStats();
    void writeAuditLog("room.delete", key, name, "刪除房間");
    toast("房間已刪除");
  }

  function applyRoleUi() {
    const master = currentRole === "master";
    const addPanel = $("whitelistAddPanel");
    const help = $("whitelistHelp");
    if (master) {
      addPanel?.classList.remove("hidden");
      if (help) help.textContent = "到「登入帳號」查看使用者 UID，按「複製 UID」後貼到這裡；新增時可指定「管理員」或「觀察員」。";
    } else if (currentRole === "admin") {
      addPanel?.classList.add("hidden");
      if (help) help.textContent = "你目前是管理員，可管理使用者、封鎖帳號、刪除房間與控制房間；白名單由最高管理員管理。";
    } else {
      addPanel?.classList.add("hidden");
      if (help) help.textContent = "你目前是觀察員，僅可查看後台資料，不可修改使用者、封鎖帳號或刪除房間。";
    }
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
      currentUser = user || null;
      currentHasAdminAccess = false;
      currentRole = null;
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
          $("deniedMessage").textContent = "目前登入的 Google 帳號沒有管理員權限。";
          return;
        }

        $("adminAccount").textContent = user.email || "";
        show("app");
        applyRoleUi();

        await Promise.all([
          loadAccounts(),
          loadWhitelist(),
          loadBlocks(),
          loadRooms(),
          loadReports().catch(error => console.warn("載入問題回報失敗:", error)),
          loadAuditLogs().catch(error => console.warn("載入操作紀錄失敗:", error))
        ]);
        startAccountsListener();
        startReportsListener();
        startAuditLogsListener();
        startReportAutomation();
      } catch (error) {
        console.error(error);
        show("deniedScreen");
        $("deniedMessage").textContent = "管理員資料載入失敗，請檢查 Firebase Rules。";
      }
    });
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
      loadAccounts(),loadWhitelist(),loadBlocks(),loadRooms(),loadReports(),loadAuditLogs()
    ]).then(() => toast("已重新整理")).catch(() => toast("重新整理失敗")));

    $("accountsRefreshBtn")?.addEventListener("click", () => Promise.all([
      loadAccounts(),loadBlocks()
    ]).then(() => toast("已重新整理")).catch(() => toast("重新整理失敗")));

    $("roomsRefreshBtn")?.addEventListener("click", () => loadRooms().then(() => toast("已重新整理")).catch(() => toast("重新整理失敗")));

    $("reportsRefreshBtn")?.addEventListener("click", () => loadReports().then(() => toast("問題回報已重新整理")).catch(error => {
      console.error(error);
      toast(error?.message || "問題回報重新整理失敗");
    }));
    $("reportsExportBtn")?.addEventListener("click", exportReports);
    $("reportsScanBtn")?.addEventListener("click", () => scanWebsiteAndReports().then(() => toast("自動掃描完成")).catch(error => toast(error?.message || "自動掃描失敗")));
    $("reportRepairBtn")?.addEventListener("click", () => repairDecisionStart().catch(error => { console.error(error); toast(error?.message || "開始處理失敗"); }));
    $("reportRecheckBtn")?.addEventListener("click", () => recheckCurrentReport().catch(error => { console.error(error); toast(error?.message || "重新檢查失敗"); }));
    $("reportLaterBtn")?.addEventListener("click", () => {
      $("reportHint").textContent = "已保留這筆回報，狀態維持待處理。";
    });
    $("auditSearch")?.addEventListener("input", renderAuditLogs);
    $("auditActionFilter")?.addEventListener("change", renderAuditLogs);
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

  setupEvents();
  initialize();
})();