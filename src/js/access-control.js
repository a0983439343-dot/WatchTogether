(() => {
  "use strict";

  const config = window.WATCHTOGETHER_CONFIG || {};
  const MASTER_UID = "35d45a23-b648-4caf-a6d5-a69112860551";
  const MASTER_EMAIL = String(config.adminEmail || "a0983439343@gmail.com").trim().toLowerCase();

  const BUILTIN_ROLES = {
    master: ["*"],
    admin: [
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
      "audit.read",
      "audit.write",
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
      "favorites.manage"
    ],
    viewer: [
      "admin.read",
      "users.read",
      "rooms.read",
      "chat.read",
      "reports.read",
      "analytics.read",
      "audit.read"
    ]
  };

  const state = {
    ready: false,
    user: null,
    role: null,
    roleSource: "none",
    roleDefinition: null,
    userOverrides: {},
    restrictions: {},
    featureFlags: {},
    maintenance: null,
    loading: false,
    error: "",
    refs: {
      role: null,
      overrides: null,
      restrictions: null,
      featureFlags: null,
      maintenance: null
    }
  };

  let auth = null;
  let db = null;

  function isMaster(user = state.user) {
    if (!user || user.isAnonymous) return false;
    return String(user.uid || "") === MASTER_UID ||
      String(user.email || "").trim().toLowerCase() === MASTER_EMAIL;
  }

  function normalizeRole(value) {
    const role = String(value || "").trim().toLowerCase();
    return role || "viewer";
  }

  function isActiveRestriction(item) {
    if (!item || typeof item !== "object" || item.enabled !== true) return false;
    if (item.permanent === true) return true;
    const until = Number(item.until || item.restrictedUntil || 0);
    return Number.isFinite(until) && until > Date.now();
  }

  function normalizeFlag(item) {
    if (typeof item === "boolean") return item;
    return item && item.enabled === false ? false : true;
  }

  function encodePermissionKey(permission) {
    return String(permission || "").trim().replace(/\./g, "__").replace(/[^A-Za-z0-9_-]/g, "_");
  }

  function decodePermissionKey(key) {
    return String(key || "").replace(/__/g, ".");
  }

  function rolePermissions(role, definition) {
    if (Array.isArray(definition)) return new Set(definition.map(String));
    if (definition && Array.isArray(definition.permissions)) {
      return new Set(definition.permissions.map(String));
    }
    if (definition && definition.permissions && typeof definition.permissions === "object") {
      return new Set(Object.entries(definition.permissions)
        .filter(([, value]) => value === true)
        .map(([key]) => key === "__all__" ? "*" : decodePermissionKey(key)));
    }
    return new Set(BUILTIN_ROLES[role] || []);
  }

  function getPermissionCatalog() {
    return Array.from(new Set(
      Object.values(BUILTIN_ROLES)
        .flat()
        .filter(permission => permission !== "*")
        .concat(
          Object.values(state.roleDefinition || {}).flatMap(value => {
            if (Array.isArray(value)) return value.map(String);
            if (value && typeof value === "object") {
              return Object.entries(value).filter(([, enabled]) => enabled === true).map(([key]) => key === "__all__" ? "*" : decodePermissionKey(key));
            }
            return [];
          }),
          Object.keys(state.userOverrides || {}),
          Object.keys(state.restrictions || {}),
          Object.keys(state.featureFlags || {})
        )
    )).sort();
  }

  function overrideEffect(permission) {
    const value = state.userOverrides && state.userOverrides[permission];
    if (!value) return "";
    if (typeof value === "string") {
      const effect = value.trim().toLowerCase();
      return effect === "allow" || effect === "deny" ? effect : "";
    }
    if (typeof value === "object") {
      const effect = String(value.effect || "").trim().toLowerCase();
      return effect === "allow" || effect === "deny" ? effect : "";
    }
    return "";
  }

  function hasPermission(permission, options = {}) {
    const key = String(permission || "").trim();
    if (!key) return false;
    const user = options.user || state.user;
    if (!user) return false;
    if (isMaster(user)) return true;
    if (user.isAnonymous) {
      const flag = state.featureFlags[key];
      return normalizeFlag(flag);
    }

    const restriction = state.restrictions[key];
    if (isActiveRestriction(restriction)) return false;

    const override = overrideEffect(key);
    if (override === "deny") return false;
    if (override === "allow") {
      const flag = state.featureFlags[key];
      return normalizeFlag(flag);
    }

    const role = normalizeRole(options.role || state.role);
    if (!state.role) return false;

    const permissions = rolePermissions(role, state.roleDefinition);
    if (!permissions.has("*") && !permissions.has(key)) {
      return false;
    }

    const flag = state.featureFlags[key];
    return normalizeFlag(flag);
  }

  function getRestriction(permission) {
    return state.restrictions[String(permission || "").trim()] || null;
  }

  function isMaintenanceActive() {
    const item = state.maintenance;
    return Boolean(item && item.enabled === true);
  }

  function getMaintenance() {
    return state.maintenance && typeof state.maintenance === "object"
      ? {...state.maintenance}
      : {enabled:false};
  }

  function emit() {
    try {
      window.dispatchEvent(new CustomEvent("wt-access-changed", {
        detail: {
          ready: state.ready,
          role: state.role,
          roleSource: state.roleSource,
          user: state.user,
          maintenance: getMaintenance()
        }
      }));
    } catch (_) {}
  }

  function detach() {
    Object.values(state.refs).forEach(ref => {
      try { ref && ref.off(); } catch (_) {}
    });
    Object.keys(state.refs).forEach(key => { state.refs[key] = null; });
  }

  async function loadRole(user) {
    if (!user || user.isAnonymous) {
      state.role = null;
      state.roleSource = "none";
      state.roleDefinition = null;
      return;
    }
    if (isMaster(user)) {
      state.role = "master";
      state.roleSource = "master";
      state.roleDefinition = null;
      return;
    }

    const roleRef = db.ref("admin/access/roleByUid/" + user.uid);
    const custom = await roleRef.once("value");
    if (custom.exists()) {
      state.role = normalizeRole(custom.val());
      state.roleSource = "custom";
      const roleSnapshot = await db.ref("admin/access/roles/" + state.role).once("value");
      state.roleDefinition = roleSnapshot.val() || null;
      return;
    }

    const legacy = await db.ref("admin/whitelistByUid/" + user.uid).once("value");
    const legacyValue = legacy.val();
    if (legacyValue && legacyValue.uid === user.uid && legacyValue.enabled === true) {
      state.role = normalizeRole(legacyValue.role === "viewer" ? "viewer" : "admin");
      state.roleSource = "whitelist";
      state.roleDefinition = null;
      return;
    }

    state.role = null;
    state.roleSource = "none";
    state.roleDefinition = null;
  }

  async function loadUserPolicies(user) {
    state.userOverrides = {};
    state.restrictions = {};
    if (!user || user.isAnonymous) return;

    const [overrideSnapshot, restrictionSnapshot] = await Promise.all([
      db.ref("admin/access/permissionsByUid/" + user.uid).once("value"),
      db.ref("admin/access/restrictionsByUid/" + user.uid).once("value")
    ]);
    state.userOverrides = overrideSnapshot.val() || {};
    state.restrictions = restrictionSnapshot.val() || {};
  }

  async function loadGlobalPolicies() {
    const [flags, maintenance] = await Promise.all([
      db.ref("admin/featureFlags").once("value").catch(() => null),
      db.ref("site/maintenance").once("value").catch(() => null)
    ]);
    state.featureFlags = flags?.val?.() || {};
    state.maintenance = maintenance?.val?.() || {enabled:false};
  }

  function attachGlobalListeners() {
    try {
      state.refs.featureFlags = db.ref("admin/featureFlags");
      state.refs.featureFlags.on("value", snapshot => {
        state.featureFlags = snapshot.val() || {};
        renderMaintenance();
        renderRestrictionNotice();
        emit();
      });
    } catch (_) {}

    try {
      state.refs.maintenance = db.ref("site/maintenance");
      state.refs.maintenance.on("value", snapshot => {
        state.maintenance = snapshot.val() || {enabled:false};
        renderMaintenance();
        emit();
      });
    } catch (_) {}
  }

  function attachUserListeners(user) {
    if (!user || user.isAnonymous) return;

    try {
      state.refs.role = db.ref("admin/access/roleByUid/" + user.uid);
      state.refs.role.on("value", async () => {
        try {
          await loadRole(user);
          emit();
        } catch (_) {}
      });
    } catch (_) {}

    try {
      state.refs.overrides = db.ref("admin/access/permissionsByUid/" + user.uid);
      state.refs.overrides.on("value", snapshot => {
        state.userOverrides = snapshot.val() || {};
        emit();
      });
    } catch (_) {}

    try {
      state.refs.restrictions = db.ref("admin/access/restrictionsByUid/" + user.uid);
      state.refs.restrictions.on("value", snapshot => {
        state.restrictions = snapshot.val() || {};
        renderRestrictionNotice();
        emit();
      });
    } catch (_) {}
  }

  function createRestrictionNotice() {
    if (location.pathname.includes("/admin/")) return;
    if (document.getElementById("wtRestrictionNotice")) return;
    const notice = document.createElement("div");
    notice.id = "wtRestrictionNotice";
    notice.style.cssText = [
      "position:fixed",
      "left:16px",
      "right:16px",
      "bottom:16px",
      "z-index:2147482999",
      "display:none",
      "padding:14px 16px",
      "border:1px solid rgba(251,191,36,.35)",
      "border-radius:16px",
      "background:rgba(30,25,12,.96)",
      "color:#fff",
      "font:13px/1.6 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "box-shadow:0 16px 40px rgba(0,0,0,.3)"
    ].join(";");
    notice.innerHTML = '<strong style="display:block;margin-bottom:4px">目前有功能限制</strong><div id="wtRestrictionNoticeBody"></div>';
    document.body.appendChild(notice);
  }

  function renderRestrictionNotice() {
    if (location.pathname.includes("/admin/") || !document.body) return;
    createRestrictionNotice();
    const notice = document.getElementById("wtRestrictionNotice");
    const body = document.getElementById("wtRestrictionNoticeBody");
    if (!notice || !body) return;
    const rows = Object.entries(state.restrictions || {})
      .filter(([, item]) => isActiveRestriction(item))
      .map(([permission, item]) => {
        const until = item.permanent === true || Number(item.until || 0) === 0
          ? "永久"
          : new Date(Number(item.until)).toLocaleString("zh-TW");
        return '<div style="margin-top:5px"><strong>' + String(permission).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])) + '</strong> · ' +
          String(item.reason || "管理員設定的功能限制").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])) +
          ' · 到期：' + until + '</div>';
      });
    body.innerHTML = rows.join("");
    notice.style.display = rows.length ? "block" : "none";
  }

  function createMaintenanceScreen() {
    if (document.getElementById("wtMaintenanceScreen")) return;
    const screen = document.createElement("div");
    screen.id = "wtMaintenanceScreen";
    screen.setAttribute("aria-live", "polite");
    screen.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483000",
      "display:none",
      "align-items:center",
      "justify-content:center",
      "padding:24px",
      "background:rgba(7,10,18,.98)",
      "color:#fff",
      "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
    ].join(";");
    screen.innerHTML = '<div style="width:min(680px,100%);padding:32px;border:1px solid rgba(148,163,184,.28);border-radius:24px;background:rgba(15,23,42,.96);box-shadow:0 30px 80px rgba(0,0,0,.45);text-align:center"><div style="font-size:48px">🛠️</div><div style="font-size:12px;letter-spacing:.16em;opacity:.62;margin-top:8px">WATCHTOGETHER</div><h1 id="wtMaintenanceTitle" style="font-size:32px;margin:10px 0">網站維護中</h1><p id="wtMaintenanceReason" style="font-size:16px;line-height:1.7;opacity:.88;margin:0"></p><p id="wtMaintenanceEta" style="font-size:13px;line-height:1.6;opacity:.58;margin:14px 0 0"></p><div id="wtMaintenanceStatus" style="margin-top:22px;font-size:12px;opacity:.45"></div></div>';
    document.body.appendChild(screen);
  }

  function renderMaintenance() {
    if (location.pathname.includes("/admin/")) return;
    if (!document.body) return;
    createMaintenanceScreen();
    const screen = document.getElementById("wtMaintenanceScreen");
    if (!screen) return;
    const active = isMaintenanceActive() && !isMaster(auth?.currentUser || null) && !hasAdminLikeAccess();
    screen.style.display = active ? "flex" : "none";
    if (!active) return;
    const item = getMaintenance();
    const reason = String(item.reason || "網站目前暫時停止服務，請稍後再回來。").trim();
    const eta = Number(item.restoreAt || item.estimatedRestoreAt || 0);
    const reasonEl = document.getElementById("wtMaintenanceReason");
    const etaEl = document.getElementById("wtMaintenanceEta");
    const statusEl = document.getElementById("wtMaintenanceStatus");
    if (reasonEl) reasonEl.textContent = reason;
    if (etaEl) etaEl.textContent = eta > Date.now() ? "預計恢復：" + new Date(eta).toLocaleString("zh-TW") : "恢復時間尚未提供";
    if (statusEl) statusEl.textContent = state.ready ? "系統會在維護結束後自動恢復。" : "正在確認系統狀態…";
  }

  function hasAdminLikeAccess() {
    return hasPermission("admin.read");
  }

  async function refresh() {
    if (!window.firebase || !window.FIREBASE_CONFIG) return false;
    if (!firebase.apps.length) firebase.initializeApp(window.FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.database();
    state.loading = true;
    state.error = "";
    state.user = auth.currentUser || null;
    detach();
    try {
      await Promise.all([
        loadRole(state.user),
        loadUserPolicies(state.user),
        loadGlobalPolicies()
      ]);
      attachGlobalListeners();
      attachUserListeners(state.user);
      state.ready = true;
      state.loading = false;
      renderMaintenance();
      renderRestrictionNotice();
      emit();
      return true;
    } catch (error) {
      state.error = String(error?.message || error || "Access control load failed");
      state.loading = false;
      state.ready = true;
      renderMaintenance();
      emit();
      return false;
    }
  }

  function bindAuth() {
    if (!auth) return;
    auth.onAuthStateChanged(async user => {
      state.user = user || null;
      state.ready = false;
      detach();
      await refresh();
    });
  }

  function guard(permission, message) {
    if (hasPermission(permission)) return true;
    const text = String(message || "你目前沒有使用這項功能的權限。");
    try {
      if (window.WT_ENHANCEMENTS?.toast) window.WT_ENHANCEMENTS.toast(text);
      else if (window.WT_CORE?.toast) window.WT_CORE.toast(text);
      else if (typeof window.alert === "function") window.alert(text);
    } catch (_) {}
    return false;
  }

  async function waitUntilReady(timeout = 6000) {
    if (state.ready) return true;
    const started = Date.now();
    while (!state.ready && Date.now() - started < timeout) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return state.ready;
  }

  window.WT_ACCESS_CONTROL = {
    state,
    refresh,
    waitUntilReady,
    hasPermission,
    guard,
    getRestriction,
    isMaintenanceActive,
    getMaintenance,
    isMaster,
    getRole: () => state.role,
    getRoleSource: () => state.roleSource,
    getFeatureFlags: () => ({...state.featureFlags}),
    getPermissionCatalog

  };

  if (!window.WT_ACCESS_CONTROL_READY) {
    window.WT_ACCESS_CONTROL_READY = true;
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        void refresh().then(bindAuth);
      }, {once:true});
    } else {
      void refresh().then(bindAuth);
    }
  }

  window.addEventListener("wt-access-changed", () => {
    try { renderMaintenance(); } catch (_) {}
  });
})();