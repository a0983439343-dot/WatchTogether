(() => {
  "use strict";

  const wt = window.WT_ENHANCEMENTS || {};
  const core = window.WT_CORE || {};
  const $ = id => document.getElementById(id);

  const MASTER_UID = "35d45a23-b648-4caf-a6d5-a69112860551";
  const SETTINGS_PATH = "userSettings";
  const LOCAL_KEY = "wt_suite_v4_local";

  const auth = wt.auth || (window.firebase?.apps?.length ? firebase.auth() : null);
  const db = wt.db || (window.firebase?.apps?.length ? firebase.database() : null);

  function user() {
    return auth?.currentUser || null;
  }

  function state() {
    return core.state || wt.state || {};
  }

  function roomId() {
    return String(state().roomId || wt.roomIdFromUrl?.() || "").trim().toUpperCase();
  }

  function esc(value) {
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

  function isMaster() {
    const u = user();
    return Boolean(
      u &&
      !u.isAnonymous &&
      (String(u.uid) === MASTER_UID ||
       String(u.email || "").trim().toLowerCase() === "a0983439343@gmail.com")
    );
  }

  function readLocal() {
    try {
      const value = JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (_) {
      return {};
    }
  }

  function writeLocal(value) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(value || {}));
    } catch (_) {}
  }

  function closeModal(id) {
    const modal = $(id);
    if (!modal) return;
    modal.classList.add("hidden");
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    modal.style.setProperty("display", "none", "important");
    if (!document.querySelector(".modal:not(.hidden)")) {
      document.body.classList.remove("wt-suite-modal-open");
    }
  }

  function makeModal(id, title, html) {
    let modal = $(id);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = id;
      modal.className = "modal hidden wt-suite-modal";
      modal.setAttribute("aria-hidden", "true");
      modal.innerHTML =
        '<div class="modal-card wt-suite-card">' +
          '<div class="wt-suite-head">' +
            '<div class="panel-title">' + esc(title) + '</div>' +
            '<button id="' + id + 'Close" type="button" class="tiny-btn">關閉</button>' +
          '</div>' +
          '<div id="' + id + 'Body"></div>' +
        '</div>';
      document.body.appendChild(modal);
      modal.addEventListener("click", event => {
        if (event.target === modal) closeModal(id);
      });
      modal.querySelector("#" + id + "Close").addEventListener("click", () => closeModal(id));
    }

    const body = $("#" + id + "Body");
    if (body) body.innerHTML = html;

    modal.hidden = false;
    modal.classList.remove("hidden");
    modal.style.removeProperty("display");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("wt-suite-modal-open");

    return body;
  }

  async function loadCloudSettings() {
    const u = user();
    const defaults = {
      showOnline: true,
      browserNotifications: false,
      cloudHistory: true,
      cloudStats: true
    };

    if (!u || u.isAnonymous || !db) return defaults;

    try {
      const snap = await db.ref(SETTINGS_PATH + "/" + u.uid).once("value");
      return Object.assign(defaults, snap.val() || {});
    } catch (error) {
      console.warn("[WT v4] cloud settings read failed", error);
      return defaults;
    }
  }

  async function saveCloudSettings(next) {
    const u = user();
    if (!u || u.isAnonymous || !db) {
      throw new Error("請先使用 Google 帳號登入");
    }

    const payload = {
      showOnline: next.showOnline === true,
      browserNotifications: next.browserNotifications === true,
      cloudHistory: next.cloudHistory === true,
      cloudStats: next.cloudStats === true,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    };

    await db.ref(SETTINGS_PATH + "/" + u.uid).set(payload);
    return payload;
  }

  async function requestBrowserNotifications() {
    if (!("Notification" in window)) {
      throw new Error("目前瀏覽器不支援通知");
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      throw new Error("你沒有允許瀏覽器通知");
    }
    return true;
  }

  async function openPrivacySettings() {
    const settings = await loadCloudSettings();
    const local = readLocal();

    const body = makeModal(
      "wtSuitePrivacyModal",
      "隱私與雲端設定",
      '<div class="wt-suite-grid">' +
        '<label class="wt-suite-check"><input id="wtSuiteShowOnline" type="checkbox" ' + (settings.showOnline ? "checked" : "") + '> 允許好友看到我在線上</label>' +
        '<label class="wt-suite-check"><input id="wtSuiteBrowserNotif" type="checkbox" ' + (settings.browserNotifications ? "checked" : "") + '> 啟用瀏覽器通知</label>' +
        '<label class="wt-suite-check"><input id="wtSuiteCloudHistory" type="checkbox" ' + (settings.cloudHistory ? "checked" : "") + '> 同步觀看歷史到雲端</label>' +
        '<label class="wt-suite-check"><input id="wtSuiteCloudStats" type="checkbox" ' + (settings.cloudStats ? "checked" : "") + '> 同步個人統計到雲端</label>' +
        '<label>預設搜尋平台<select id="wtSuiteDefaultPlatform">' +
          '<option value="youtube">YouTube</option>' +
          '<option value="vimeo">Vimeo</option>' +
          '<option value="dailymotion">Dailymotion</option>' +
          '<option value="twitch">Twitch</option>' +
        '</select></label>' +
        '<label>介面密度<select id="wtSuiteDensity"><option value="normal">標準</option><option value="compact">緊湊</option></select></label>' +
      '</div>' +
      '<div class="wt-suite-note">雲端設定只儲存目前 Google 帳號的偏好；訪客模式會使用本機設定。</div>' +
      '<div class="wt-suite-actions">' +
        '<button id="wtSuiteNotifPermission" type="button" class="tiny-btn">重新授權通知</button>' +
        '<button id="wtSuitePrivacySave" type="button" class="primary-btn">儲存設定</button>' +
      '</div>'
    );

    const defaultPlatform =
      String(local.defaultPlatform || "youtube").toLowerCase();
    const density =
      String(local.density || "normal").toLowerCase();

    if (body) {
      const platform = body.querySelector("#wtSuiteDefaultPlatform");
      const densityInput = body.querySelector("#wtSuiteDensity");
      if (platform) platform.value = ["youtube","vimeo","dailymotion","twitch"].includes(defaultPlatform) ? defaultPlatform : "youtube";
      if (densityInput) densityInput.value = density === "compact" ? "compact" : "normal";

      body.querySelector("#wtSuiteNotifPermission").onclick = async () => {
        try {
          await requestBrowserNotifications();
          toast("瀏覽器通知已允許");
        } catch (error) {
          toast(error.message || "通知授權失敗");
        }
      };

      body.querySelector("#wtSuitePrivacySave").onclick = async () => {
        try {
          const nextLocal = Object.assign({}, readLocal(), {
            defaultPlatform: String(platform?.value || "youtube"),
            density: String(densityInput?.value || "normal")
          });

          writeLocal(nextLocal);

          const payload = {
            showOnline: body.querySelector("#wtSuiteShowOnline")?.checked === true,
            browserNotifications: body.querySelector("#wtSuiteBrowserNotif")?.checked === true,
            cloudHistory: body.querySelector("#wtSuiteCloudHistory")?.checked === true,
            cloudStats: body.querySelector("#wtSuiteCloudStats")?.checked === true
          };

          if (payload.browserNotifications && "Notification" in window && Notification.permission !== "granted") {
            await requestBrowserNotifications();
          }

          const u = user();
          if (u && !u.isAnonymous && db) {
            await saveCloudSettings(payload);
          }

          if (typeof wt.applyTheme === "function") {
            const p = wt.readJson?.("wt_preferences_v1", {}) || {};
            const merged = Object.assign({}, p, {
              defaultPlatform: nextLocal.defaultPlatform,
              compactControls: nextLocal.density === "compact"
            });
            try { localStorage.setItem("wt_preferences_v1", JSON.stringify(merged)); } catch (_) {}
          }

          try {
            const current = state();
            if (current.player && typeof wt.attachRoomVolumeSync === "function") {
              wt.attachRoomVolumeSync();
            }
          } catch (_) {}

          toast("隱私與雲端設定已儲存");
          closeModal("wtSuitePrivacyModal");
        } catch (error) {
          toast(error.message || "設定儲存失敗");
        }
      };
    }
  }

  async function createRoomQrCode(roomCode) {
    const id = String(roomCode || roomId()).trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(id)) {
      throw new Error("目前沒有有效的房間碼");
    }

    const link =
      typeof wt.roomLink === "function"
        ? wt.roomLink(id)
        : location.origin + location.pathname + "?room=" + encodeURIComponent(id);

    if (!window.qrcode) {
      throw new Error("QR Code 元件尚未載入");
    }

    const qr = qrcode(0, "M");
    qr.addData(link);
    qr.make();

    const body = makeModal(
      "wtSuiteQrModal",
      "房間 QR Code",
      '<div class="wt-suite-qr-wrap">' +
        '<div id="wtSuiteQrImage" class="wt-suite-qr"></div>' +
        '<div class="wt-suite-link">' + esc(link) + '</div>' +
      '</div>' +
      '<div class="wt-suite-actions">' +
        '<button id="wtSuiteQrCopy" type="button" class="secondary-btn">複製連結</button>' +
        '<button id="wtSuiteQrShare" type="button" class="primary-btn">分享房間</button>' +
      '</div>'
    );

    if (body) {
      body.querySelector("#wtSuiteQrImage").innerHTML = qr.createImgTag(6, 8);

      body.querySelector("#wtSuiteQrCopy").onclick = async () => {
        try {
          await navigator.clipboard.writeText(link);
          toast("房間連結已複製");
        } catch (_) {
          toast("複製失敗");
        }
      };

      body.querySelector("#wtSuiteQrShare").onclick = async () => {
        try {
          if (!navigator.share) throw new Error("share_unavailable");
          await navigator.share({
            title: "WatchTogether 房間",
            text: "加入我的 WatchTogether 房間",
            url: link
          });
        } catch (error) {
          if (String(error?.name || "") !== "AbortError") toast("目前裝置不支援系統分享");
        }
      };
    }
  }

  async function copyOrShareRoomLink() {
    const id = roomId();
    if (!id) {
      toast("目前不在房間中");
      return;
    }

    const link =
      typeof wt.roomLink === "function"
        ? wt.roomLink(id)
        : location.origin + location.pathname + "?room=" + encodeURIComponent(id);

    if (navigator.share) {
      try {
        await navigator.share({
          title: "WatchTogether 房間",
          text: "加入我的 WatchTogether 房間",
          url: link
        });
        return;
      } catch (error) {
        if (String(error?.name || "") === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(link);
      toast("房間連結已複製");
    } catch (_) {
      toast("目前無法複製房間連結");
    }
  }

  function clickExisting(id, fallback) {
    const element = $(id);
    if (element) {
      element.click();
      return true;
    }
    if (typeof fallback === "function") {
      try {
        fallback();
        return true;
      } catch (_) {}
    }
    return false;
  }

  function openFeatureById(id, methodName, fallbackMessage) {
    if (methodName && typeof wt[methodName] === "function") {
      try {
        wt[methodName]();
        closeModal("wtSuiteFeatureHubModal");
        return;
      } catch (_) {}
    }
    if (clickExisting(id, null)) {
      closeModal("wtSuiteFeatureHubModal");
      return;
    }
    toast(fallbackMessage || "功能目前不可用");
  }

  function openFeatureHub() {
    const inRoom = Boolean(roomId());

    const body = makeModal(
      "wtSuiteFeatureHubModal",
      "WatchTogether 功能中心",
      '<div class="wt-suite-section">' +
        '<div class="panel-title">帳號與社交</div>' +
        '<div class="wt-suite-actions">' +
          '<button type="button" class="secondary-btn" data-suite-open="friends">👥 好友</button>' +
          '<button type="button" class="secondary-btn" data-suite-open="dm">💬 私訊</button>' +
          '<button type="button" class="secondary-btn" data-suite-open="notifications">🔔 通知</button>' +
          '<button type="button" class="secondary-btn" data-suite-open="history">☁️ 歷史</button>' +
          '<button type="button" class="secondary-btn" data-suite-open="settings">⚙️ 完整設定</button>' +
          '<button type="button" class="secondary-btn" data-suite-open="privacy">🛡️ 隱私／雲端</button>' +
          '<button type="button" class="secondary-btn" data-suite-open="favorites">☆ 收藏</button>' +
          '<button type="button" class="secondary-btn" data-suite-open="reports">🐛 我的回報</button>' +
          '<button type="button" class="secondary-btn" data-suite-open="explore">🔎 探索</button>' +
        '</div>' +
      '</div>' +
      (inRoom ?
        '<div class="wt-suite-section">' +
          '<div class="panel-title">觀看房間</div>' +
          '<div class="wt-suite-actions">' +
            '<button type="button" class="secondary-btn" data-suite-open="room">🏠 房間設定</button>' +
            '<button type="button" class="secondary-btn" data-suite-open="queue">📋 佇列工具</button>' +
            '<button type="button" class="secondary-btn" data-suite-open="player">🎬 播放器設定</button>' +
            '<button type="button" class="secondary-btn" data-suite-open="status">📡 狀態中心</button>' +
            '<button type="button" class="secondary-btn" data-suite-open="qr">🔳 QR Code</button>' +
            '<button type="button" class="secondary-btn" data-suite-open="share">📤 分享房間</button>' +
            '<button type="button" class="secondary-btn" data-suite-open="report">🐛 回報問題</button>' +
          '</div>' +
        '</div>' : '') +
      '<div class="wt-suite-note">快捷鍵仍沿用現有系統；這個功能中心只是統一入口，不會改動同步核心。</div>'
    );

    if (!body) return;

    body.querySelectorAll("[data-suite-open]").forEach(button => {
      button.addEventListener("click", async () => {
        const action = String(button.dataset.suiteOpen || "");

        if (action === "privacy") {
          closeModal("wtSuiteFeatureHubModal");
          await openPrivacySettings();
          return;
        }
        if (action === "qr") {
          closeModal("wtSuiteFeatureHubModal");
          try { await createRoomQrCode(); } catch (error) { toast(error.message || "QR Code 建立失敗"); }
          return;
        }
        if (action === "share") {
          closeModal("wtSuiteFeatureHubModal");
          await copyOrShareRoomLink();
          return;
        }
        if (action === "friends") return openFeatureById("wtFriendsBtn","openFriends","好友功能目前不可用");
        if (action === "dm") return openFeatureById("wtSocialV6DmBtn","openDmList","私訊功能目前不可用");
        if (action === "notifications") return openFeatureById("wtFeatureNotificationBtn","openNotifications","通知功能目前不可用");
        if (action === "history") return openFeatureById("wtV3HistoryBtn","openCloudHistory","歷史功能目前不可用");
        if (action === "settings") return openFeatureById("wtSettingsBtn","openSettings","設定功能目前不可用");
        if (action === "favorites") return openFeatureById("wtFeatureFavoritesBtn","openFavorites","收藏功能目前不可用");
        if (action === "reports") return openFeatureById("wtFeatureMyReportsBtn","openMyReports","回報功能目前不可用");
        if (action === "explore") return openFeatureById("wtExploreBtn","openExplore","探索功能目前不可用");
        if (action === "room") return openFeatureById("roomAccessManageBtn",null,"房間設定目前不可用");
        if (action === "queue") return openFeatureById("wtToolQueue","openQueueTools","佇列工具目前不可用");
        if (action === "player") return openFeatureById("wtToolPlayer","openPlayerSettings","播放器設定目前不可用");
        if (action === "status") return openFeatureById("wtStatusBtn","openStatus","狀態中心目前不可用");
        if (action === "report") return openFeatureById("wtFeatureReportBtn","openReport","回報功能目前不可用");
      });
    });
  }

  function installTwitchLiveSearchToggle() {
    const area = $("modalVideoSearchArea");
    if (!area || $("wtSuiteTwitchLiveOnly")) return;

    const searchRow = area.querySelector(".search-row");
    if (!searchRow) return;

    const wrap = document.createElement("label");
    wrap.id = "wtSuiteTwitchLiveWrap";
    wrap.className = "wt-suite-inline-check hidden";
    wrap.innerHTML =
      '<input id="wtSuiteTwitchLiveOnly" type="checkbox"> 只搜尋 Twitch 直播';
    searchRow.insertAdjacentElement("afterend", wrap);

    const update = () => {
      const platform = String($("sourceTypeModal")?.value || "youtube").toLowerCase();
      const visible = platform === "twitch";
      wrap.classList.toggle("hidden", !visible);
      window.__WT_TWITCH_LIVE_ONLY__ = visible && $("wtSuiteTwitchLiveOnly")?.checked === true;
      if (!visible && $("wtSuiteTwitchLiveOnly")) $("wtSuiteTwitchLiveOnly").checked = false;
    };

    $("wtSuiteTwitchLiveOnly").addEventListener("change", update);
    $("sourceTypeModal")?.addEventListener("change", () => {
      window.__WT_TWITCH_LIVE_ONLY__ = false;
      setTimeout(update, 0);
    });
    update();
  }

  function ensureTopbar() {
    const bar = document.querySelector(".topbar-right");
    if (!bar || $("wtSuiteFeatureHubBtn")) return;

    const anchor = $("googleLoginBtn");
    const button = document.createElement("button");
    button.id = "wtSuiteFeatureHubBtn";
    button.type = "button";
    button.className = "wt-nav-btn";
    button.textContent = "☰ 功能";
    button.title = "開啟全部功能";
    button.addEventListener("click", openFeatureHub);
    bar.insertBefore(button, anchor || null);
  }

  function applyDensity() {
    const local = readLocal();
    document.documentElement.classList.toggle(
      "wt-suite-compact",
      String(local.density || "normal") === "compact"
    );
  }

  function init() {
    if (document.documentElement.dataset.wtSuiteV4Init) return;
    document.documentElement.dataset.wtSuiteV4Init = "1";

    const style = document.createElement("style");
    style.id = "wtSuiteV4Style";
    style.textContent =
      ".wt-suite-modal .wt-suite-card{width:min(920px,calc(100vw - 24px));max-height:90vh;overflow:auto}" +
      ".wt-suite-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}" +
      ".wt-suite-section{padding:12px 0;border-bottom:1px solid rgba(148,163,184,.12)}" +
      ".wt-suite-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}" +
      ".wt-suite-grid label{display:grid;gap:6px;font-size:12px}" +
      ".wt-suite-check{display:flex!important;align-items:center;gap:8px;padding:10px;border:1px solid rgba(148,163,184,.14);border-radius:12px;background:rgba(15,23,42,.28)}" +
      ".wt-suite-check input{margin:0}" +
      ".wt-suite-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}" +
      ".wt-suite-note{margin-top:12px;padding:10px 12px;border-radius:12px;background:rgba(59,130,246,.07);color:#94a3b8;font-size:11px;line-height:1.55}" +
      ".wt-suite-inline-check{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:12px;color:#cbd5e1}" +
      ".wt-suite-inline-check.hidden{display:none!important}" +
      ".wt-suite-qr-wrap{text-align:center}" +
      ".wt-suite-qr{display:flex;justify-content:center;padding:12px;background:#fff;border-radius:14px;margin-bottom:12px}" +
      ".wt-suite-qr img{width:min(280px,70vw);height:auto;image-rendering:pixelated}" +
      ".wt-suite-link{padding:10px;border:1px solid rgba(148,163,184,.14);border-radius:12px;word-break:break-all;font-size:11px}" +
      ".wt-suite-modal-open{overflow:hidden}" +
      ".wt-suite-compact .room-controls .control-btn,.wt-suite-compact .room-controls .volume{transform:scale(.94);transform-origin:left center}" +
      "@media(max-width:650px){.wt-suite-grid{grid-template-columns:1fr}}" ;

    document.head.appendChild(style);

    ensureTopbar();
    applyDensity();
    installTwitchLiveSearchToggle();

    const timer = setInterval(() => {
      ensureTopbar();
      installTwitchLiveSearchToggle();
      applyDensity();
    }, 1200);

    window.addEventListener("beforeunload", () => clearInterval(timer));
  }

  wt.openFeatureHub = openFeatureHub;
  wt.openPrivacySettings = openPrivacySettings;
  wt.createRoomQrCode = createRoomQrCode;
  wt.copyOrShareRoomLink = copyOrShareRoomLink;

  window.WT_FEATURE_SUITE_V4 = {
    openFeatureHub,
    openPrivacySettings,
    createRoomQrCode,
    copyOrShareRoomLink
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {once:true});
  } else {
    init();
  }
})();