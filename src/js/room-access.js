(() => {
  "use strict";

  const wt = window.WT_CORE;
  if (!wt || !window.firebase) return;

  const state = wt.state;
  const auth = window.WT_ENHANCEMENTS?.auth || firebase.auth();
  const db = window.WT_ENHANCEMENTS?.db || firebase.database();
  const MASTER_UID = "35d45a23-b648-4caf-a6d5-a69112860551";

  const roomState = {
    applications: {},
    roles: {},
    meta: null,
    applicationListener: null,
    roleListener: null,
    readyRoom: ""
  };

  function user() {
    return auth.currentUser || null;
  }

  function isMaster() {
    const u = user();
    return Boolean(u && !u.isAnonymous && (u.uid === MASTER_UID || String(u.email || "").toLowerCase() === "a0983439343@gmail.com"));
  }

  function roomId() {
    return String(state.roomId || "").trim().toUpperCase();
  }

  function isOwner() {
    const u = user();
    return Boolean(u && roomId() && String(state.room?.owner || "") === u.uid);
  }

  function enforceRoomManagementPolicy() {
    const access = window.WT_ACCESS_CONTROL;
    if (!access || isMaster()) return;
    const restriction = access.getRestriction?.("rooms.manage") || access.state?.restrictions?.["rooms.manage"];
    if (restriction && access.isActiveRestriction?.(restriction) === true) {
      throw new Error(String(restriction.reason || "你目前無法管理房間"));
    }
    const flag = access.state?.featureFlags?.["rooms.manage"];
    if (flag && flag.enabled === false) {
      throw new Error(String(flag.reason || "房間管理功能目前暫停"));
    }
  }

  function isCohost(uid) {
    const key = String(uid || user()?.uid || "");
    return Boolean(key && roomState.roles && roomState.roles[key] && roomState.roles[key].role === "cohost");
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  }

  function disconnect() {
    try { roomState.applicationListener?.off(); } catch (_) {}
    try { roomState.roleListener?.off(); } catch (_) {}
    roomState.applicationListener = null;
    roomState.roleListener = null;
    roomState.applications = {};
    roomState.roles = {};
    roomState.meta = null;
    roomState.readyRoom = "";
  }

  async function loadRoomAccess() {
    const id = roomId();
    if (!id) {
      disconnect();
      return null;
    }
    if (roomState.readyRoom === id && roomState.meta) return roomState.meta;

    disconnect();

    const metaSnapshot = await db.ref("roomMeta/" + id).once("value");
    roomState.meta = metaSnapshot.val() || {};

    const roleRef = db.ref("roomRoles/" + id);
    roomState.roleListener = roleRef;
    roleRef.on("value", snapshot => {
      roomState.roles = snapshot.val() || {};
      renderManageModal();
    });

    const current = user();
    if (isOwner() || isMaster()) {
      const applicationsRef = db.ref("roomApplications/" + id);
      roomState.applicationListener = applicationsRef;
      applicationsRef.on("value", snapshot => {
        roomState.applications = snapshot.val() || {};
        renderManageModal();
      });
    } else if (current) {
      const ownRef = db.ref("roomApplications/" + id + "/" + current.uid);
      roomState.applicationListener = ownRef;
      ownRef.on("value", snapshot => {
        roomState.applications = {};
        roomState.applications[current.uid] = snapshot.val();
        renderManageModal();
      });
    }

    roomState.readyRoom = id;
    ensureRoomButton();
    renderManageModal();
    return roomState.meta;
  }

  async function authorizeJoin(info) {
    const id = String(info?.roomId || "").trim().toUpperCase();
    const settings = info?.metaSettings || {};
    const current = user();

    if (!current || !id || info?.isRoomOwner || info?.isExistingMember || info?.isAdminJoin) return true;

    if (
      info?.isInvited === true &&
      settings.locked !== true
    ) {
      return true;
    }

    const requiresApplication = settings.joinPolicy === "application" || settings.visibility === "private";
    if (!requiresApplication) return true;
    if (settings.locked === true) throw new Error("這個房間目前已鎖定，暫停新成員加入");

    const ref = db.ref("roomApplications/" + id + "/" + current.uid);
    const snapshot = await ref.once("value");
    const existing = snapshot.val() || {};

    if (existing.status === "approved") return true;
    if (existing.status === "pending") throw new Error("你已送出加入申請，請等待房主審核");
    if (existing.status === "rejected") throw new Error("房主拒絕了你的加入申請");

    await ref.set({
      uid: current.uid,
      name: String(info?.memberName || "使用者").trim().slice(0, 30) || "使用者",
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      status: "pending"
    });

    throw new Error("已送出加入申請，請等待房主審核");
  }

  async function saveRoomSettings() {
    if (!isOwner() && !isMaster()) throw new Error("只有房主可以修改房間設定");
    enforceRoomManagementPolicy();
    const id = roomId();
    if (!id) throw new Error("目前不在房間中");

    const roomName = String(document.getElementById("roomAccessName")?.value || roomState.meta?.name || "一起看").trim().slice(0, 40);
    const visibility = document.getElementById("roomAccessVisibility")?.value === "private" ? "private" : "public";
    const joinPolicy = document.getElementById("roomAccessJoinPolicy")?.value === "application" ? "application" : "open";
    if (!roomName) throw new Error("房間名稱不能為空");
    const maxMembers = Math.max(2, Math.min(10, Number(document.getElementById("roomAccessMaxMembers")?.value || 2)));
    const locked = document.getElementById("roomAccessLocked")?.checked === true;
    const queueModeValue = document.getElementById("roomAccessQueueMode")?.value || "normal";
    const queueMode = ["normal", "repeat_one", "shuffle"].includes(queueModeValue)
      ? queueModeValue
      : "normal";

    await db.ref("roomMeta/" + id).update({
      name: roomName,
      settings: {
        ...(roomState.meta?.settings || {}),
        visibility,
        joinPolicy,
        maxMembers,
        locked,
        queueMode
      }
    });
    await db.ref("rooms/" + id + "/name").set(roomName);

    if (visibility === "public") {
      await db.ref("publicRooms/" + id).update({
        id,
        name: roomName,
        searchName: roomName.toLowerCase().slice(0,40),
        owner: String(window.WT_CORE?.state?.room?.owner || user()?.uid || ""),
        sourceType: String(window.WT_CORE?.state?.room?.sourceType || "youtube"),
        createdAt: Number(roomState.meta?.createdAt || Date.now())
      }).catch(() => {});
    } else {
      await db.ref("publicRooms/" + id).remove().catch(() => {});
    }

    if (window.WT_CORE?.state?.room) {
      window.WT_CORE.state.room.name = roomName;
      window.WT_CORE.state.room.settings = Object.assign({}, window.WT_CORE.state.room.settings || {}, {
        visibility,
        joinPolicy,
        maxMembers,
        locked,
        queueMode
      });
    }

    await loadRoomAccess();
    showMessage("房間設定已更新");
  }

  async function reviewApplication(uid, status) {
    if (!isOwner() && !isMaster()) throw new Error("只有房主可以審核加入申請");

    const id = roomId();
    const key = String(uid || "").trim();
    const application = roomState.applications[key];
    if (!id || !key || !application || application.status !== "pending") return;

    await db.ref("roomApplications/" + id + "/" + key).update({
      status: status === "approved" ? "approved" : "rejected",
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      reviewedByUid: user().uid,
      reviewedAt: firebase.database.ServerValue.TIMESTAMP
    });

    showMessage(status === "approved" ? "已核准加入申請" : "已拒絕加入申請");
  }

  async function cancelOwnApplication() {
    const id = roomId();
    const uid = user()?.uid;
    if (!id || !uid) return;

    const ref = db.ref("roomApplications/" + id + "/" + uid);
    const snapshot = await ref.once("value");
    if (snapshot.val()?.status !== "pending") return;

    await ref.update({
      status: "cancelled",
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });
    showMessage("已取消加入申請");
  }

  async function setCohost(uid, role) {
    if (!isOwner() && !isMaster()) throw new Error("只有房主可以管理 Co-host");
    enforceRoomManagementPolicy();

    const id = roomId();
    const key = String(uid || "").trim();
    if (!id || !key || key === String(user()?.uid || "")) return;

    const ref = db.ref("roomRoles/" + id + "/" + key);
    if (role === "cohost") {
      await ref.set({
        uid: key,
        role: "cohost",
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
        updatedByUid: user().uid
      });
      showMessage("已授予 Co-host");
    } else {
      await ref.remove();
      showMessage("已解除 Co-host");
    }
  }

  function showMessage(message) {
    try {
      if (typeof wt.toast === "function") wt.toast(message);
      else if (typeof window.toast === "function") window.toast(message);
    } catch (_) {}
  }

  function ensureRoomButton() {
    if (!roomId()) return;

    const copy = document.getElementById("copyRoomBtn");
    if (!copy || document.getElementById("roomAccessManageBtn")) return;

    const button = document.createElement("button");
    button.id = "roomAccessManageBtn";
    button.className = "tiny-btn";
    button.type = "button";
    button.textContent = "房間設定";
    button.addEventListener("click", () => {
      ensureManageModal();
      document.getElementById("roomAccessModal")?.classList.remove("hidden");
      renderManageModal();
    });
    copy.insertAdjacentElement("afterend", button);
  }

  function ensureManageModal() {
    if (document.getElementById("roomAccessModal")) return;

    const modal = document.createElement("div");
    modal.id = "roomAccessModal";
    modal.className = "modal hidden";

    const card = document.createElement("div");
    card.className = "modal-card room-access-modal-card";
    card.innerHTML =
      '<div class="panel-title">房間權限與管理</div>' +
      '<div class="room-access-grid">' +
        '<label>房間名稱<input id="roomAccessName" maxlength="40" value=""></label>' +
        '<label>可見性<select id="roomAccessVisibility"><option value="public">公開</option><option value="private">私人</option></select></label>' +
        '<label>加入方式<select id="roomAccessJoinPolicy"><option value="open">直接加入</option><option value="application">需要房主審核</option></select></label>' +
        '<label>最多成員<input id="roomAccessMaxMembers" type="number" min="2" max="10" value="2"></label>' +
        '<label>佇列模式<select id="roomAccessQueueMode"><option value="normal">依序播放</option><option value="repeat_one">重播目前影片</option><option value="shuffle">隨機播放下一部</option></select></label>' +
        '<label class="room-access-check"><input id="roomAccessLocked" type="checkbox"> 鎖定新成員加入</label>' +
      '</div>' +
      '<div id="roomAccessOwnerArea">' +
        '<div class="panel-title" style="margin-top:18px;">加入申請</div>' +
        '<div id="roomAccessApplications" class="room-access-list"></div>' +
      '</div>' +
      '<div id="roomAccessCohostArea">' +
        '<div class="panel-title" style="margin-top:18px;">Co-host</div>' +
        '<div class="add-row">' +
          '<input id="roomAccessCohostUid" class="search" maxlength="128" placeholder="輸入成員 UID">' +
          '<select id="roomAccessCohostRole" class="search"><option value="cohost">授予 Co-host</option><option value="member">解除 Co-host</option></select>' +
          '<button id="roomAccessCohostBtn" class="btn primary" type="button">套用</button>' +
        '</div>' +
        '<div id="roomAccessCohostList" class="room-access-list"></div>' +
      '</div>' +
      '<div id="roomAccessOwnApplication"></div>' +
      '<div class="modal-actions">' +
        '<button id="roomAccessCloseBtn" class="secondary-btn" type="button">關閉</button>' +
        '<button id="roomAccessSaveBtn" class="primary-btn" type="button">儲存設定</button>' +
      '</div>';

    modal.appendChild(card);
    document.body.appendChild(modal);

    document.getElementById("roomAccessCloseBtn").addEventListener("click", () => modal.classList.add("hidden"));
    document.getElementById("roomAccessSaveBtn").addEventListener("click", () => saveRoomSettings().catch(error => showMessage(error?.message || "房間設定儲存失敗")));
    document.getElementById("roomAccessCohostBtn").addEventListener("click", () => {
      const uid = document.getElementById("roomAccessCohostUid")?.value || "";
      const role = document.getElementById("roomAccessCohostRole")?.value || "cohost";
      setCohost(uid, role).catch(error => showMessage(error?.message || "Co-host 操作失敗"));
    });
    modal.addEventListener("click", event => {
      if (event.target === modal) modal.classList.add("hidden");
    });
  }

  function renderManageModal() {
    if (!document.body) return;

    ensureManageModal();
    const owner = isOwner() || isMaster();
    const settings = roomState.meta?.settings || {};

    const nameEl = document.getElementById("roomAccessName");
    const visibilityEl = document.getElementById("roomAccessVisibility");
    const joinPolicyEl = document.getElementById("roomAccessJoinPolicy");
    const maxEl = document.getElementById("roomAccessMaxMembers");
    const lockedEl = document.getElementById("roomAccessLocked");
    const queueModeEl = document.getElementById("roomAccessQueueMode");
    const saveEl = document.getElementById("roomAccessSaveBtn");

    if (nameEl) nameEl.value = String(roomState.meta?.name || window.WT_CORE?.state?.room?.name || "一起看").slice(0, 40);
    if (visibilityEl) visibilityEl.value = settings.visibility === "private" ? "private" : "public";
    if (joinPolicyEl) joinPolicyEl.value = settings.joinPolicy === "application" ? "application" : "open";
    if (maxEl) maxEl.value = String(Math.max(2, Math.min(10, Number(settings.maxMembers || 2))));
    if (queueModeEl) queueModeEl.value = ["normal", "repeat_one", "shuffle"].includes(String(settings.queueMode || "")) ? String(settings.queueMode) : "normal";
    if (lockedEl) lockedEl.checked = settings.locked === true;

    [nameEl, visibilityEl, joinPolicyEl, maxEl, queueModeEl, lockedEl, saveEl].forEach(el => { if (el) el.disabled = !owner; });

    const ownerArea = document.getElementById("roomAccessOwnerArea");
    const cohostArea = document.getElementById("roomAccessCohostArea");
    if (ownerArea) ownerArea.style.display = owner ? "" : "none";
    if (cohostArea) cohostArea.style.display = owner ? "" : "none";

    const applications = document.getElementById("roomAccessApplications");
    if (applications && owner) {
      const pending = Object.entries(roomState.applications || {})
        .filter(([, item]) => item?.status === "pending")
        .sort((a,b) => Number(a[1]?.createdAt || 0) - Number(b[1]?.createdAt || 0));

      applications.innerHTML = pending.length
        ? pending.map(entry => {
            const uid = entry[0];
            const item = entry[1] || {};
            return '<div class="room-access-row">' +
              '<div><strong>' + esc(item.name || uid) + '</strong><span class="small">' + esc(uid) + '</span></div>' +
              '<button class="btn primary" data-room-application="approve" data-uid="' + esc(uid) + '" type="button">核准</button>' +
              '<button class="btn danger" data-room-application="reject" data-uid="' + esc(uid) + '" type="button">拒絕</button>' +
            '</div>';
          }).join("")
        : '<div class="muted">目前沒有待審核申請。</div>';

      applications.querySelectorAll("[data-room-application]").forEach(button => {
        button.addEventListener("click", () => reviewApplication(button.dataset.uid, button.dataset.roomApplication).catch(error => showMessage(error?.message || "申請審核失敗")));
      });
    } else if (applications) {
      applications.innerHTML = "";
    }

    const cohosts = document.getElementById("roomAccessCohostList");
    if (cohosts) {
      const rows = Object.entries(roomState.roles || {}).filter(([, item]) => item?.role === "cohost");
      cohosts.innerHTML = rows.length
        ? rows.map(entry => '<div class="room-access-row"><div><strong>' + esc(entry[0]) + '</strong><span class="small">Co-host</span></div><button class="btn danger" type="button" data-room-cohost-remove="' + esc(entry[0]) + '">解除</button></div>').join("")
        : '<div class="muted">目前沒有 Co-host。</div>';

      cohosts.querySelectorAll("[data-room-cohost-remove]").forEach(button => {
        button.addEventListener("click", () => setCohost(button.dataset.roomCohostRemove, "member").catch(error => showMessage(error?.message || "解除 Co-host 失敗")));
      });
    }

    const own = document.getElementById("roomAccessOwnApplication");
    const current = user();
    const ownApplication = current ? roomState.applications?.[current.uid] : null;
    if (own) {
      if (!owner && ownApplication?.status === "pending") {
        own.innerHTML = '<div class="room-access-own">你的加入申請正在等待房主審核。<button id="roomAccessCancelApplication" class="btn" type="button">取消申請</button></div>';
        document.getElementById("roomAccessCancelApplication")?.addEventListener("click", () => cancelOwnApplication().catch(error => showMessage(error?.message || "取消申請失敗")));
      } else if (!owner && ownApplication?.status === "rejected") {
        own.innerHTML = '<div class="room-access-own">房主已拒絕這次加入申請。</div>';
      } else {
        own.innerHTML = "";
      }
    }
  }

  async function refresh() {
    if (!roomId()) {
      disconnect();
      return;
    }
    try {
      await loadRoomAccess();
      ensureRoomButton();
    } catch (error) {
      console.warn("room access load failed", error);
    }
  }

  window.WT_ROOM_ACCESS = {
    state: roomState,
    refresh,
    authorizeJoin,
    saveRoomSettings,
    reviewApplication,
    cancelOwnApplication,
    setCohost,
    isCohost
  };

  const start = () => {
    ensureManageModal();
    void refresh();
    window.setInterval(() => {
      if (!roomId()) return;
      ensureRoomButton();
      if (roomState.readyRoom !== roomId()) void refresh();
    }, 1000);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, {once:true});
  } else {
    start();
  }
})();