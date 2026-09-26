(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /*
   * =========================================================
   * CONFIG
   * =========================================================
   */

  const APP_CONFIG =
    window.WATCHTOGETHER_CONFIG ||
    {};

  const YOUTUBE_SEARCH_PROXY_URL =
    String(
      APP_CONFIG.youtubeSearchProxyUrl ||
      ""
    ).trim();

  const YOUTUBE_STREAM_PROXY_URL =
    String(
      APP_CONFIG.youtubeStreamProxyUrl ||
      window.YOUTUBE_STREAM_PROXY_URL ||
      ""
    ).trim().replace(/\/+$/, "");

  const DAILYMOTION_PLAYER_ID =
    String(
      APP_CONFIG.dailymotionPlayerId ||
      ""
    ).trim();

  const YOUTUBE_SEARCH_PAGE_SIZE = 25;
  const YOUTUBE_MAX_SEARCH_PAGES = 1;
  const YOUTUBE_SEARCH_COOLDOWN_MS = 650;
  const MEMBER_HEARTBEAT_INTERVAL_MS = 15000;
  const MEMBER_PRESENCE_TIMEOUT_MS = 45000;
  const LAST_ROOM_STORAGE_KEY = "wt_last_room_id";

  const PLATFORMS = {
    youtube: {
      name: "YouTube",
      icon: "▶",
      searchable: true,
      player: "youtube"
    },

    vimeo: {
      name: "Vimeo",
      icon: "▶",
      searchable: false,
      player: "vimeo"
    },

    dailymotion: {
      name: "Dailymotion",
      icon: "▶",
      searchable: false,
      player: "dailymotion"
    },

    bilibili: {
      name: "Bilibili",
      icon: "📺",
      searchable: false,
      player: "bilibili"
    },

    twitch: {
      name: "Twitch",
      icon: "🎮",
      searchable: false,
      player: "twitch"
    },

    netflix: {
      name: "Netflix",
      icon: "🔴",
      searchable: false,
      player: "external"
    },

    crunchyroll: {
      name: "Crunchyroll",
      icon: "🟠",
      searchable: false,
      player: "external"
    },

    disneyplus: {
      name: "Disney+",
      icon: "🔵",
      searchable: false,
      player: "external"
    },

    primevideo: {
      name: "Prime Video",
      icon: "🟦",
      searchable: false,
      player: "external"
    },

    appletv: {
      name: "Apple TV+",
      icon: "🍎",
      searchable: false,
      player: "external"
    },

    max: {
      name: "Max",
      icon: "🟣",
      searchable: false,
      player: "external"
    },

    hulu: {
      name: "Hulu",
      icon: "🟢",
      searchable: false,
      player: "external"
    },

    paramount: {
      name: "Paramount+",
      icon: "🟦",
      searchable: false,
      player: "external"
    },

    peacock: {
      name: "Peacock",
      icon: "🦚",
      searchable: false,
      player: "external"
    }
  };


  /*
   * =========================================================
   * STATE
   * =========================================================
   */

  const MASTER_ADMIN_EMAIL = "a0983439343@gmail.com";
  const MASTER_ADMIN_UID = "35d45a23-b648-4caf-a6d5-a69112860551";

  async function isPrivilegedAdminUser() {
    const user = auth?.currentUser || null;
    if (!user || user.isAnonymous || user.emailVerified !== true) return false;
    const uid = String(user.uid || "");
    const email = String(user.email || "").trim().toLowerCase();
    if (uid === MASTER_ADMIN_UID || email === MASTER_ADMIN_EMAIL) return true;
    try {
      const snapshot = await db.ref("admin/whitelistByUid/" + user.uid).once("value");
      const value = snapshot.val();
      const role = value && String(value.role || "admin").trim().toLowerCase();
      return Boolean(
        value &&
        value.enabled === true &&
        (role === "admin" || role === "master")
      );
    } catch (_) {
      return false;
    }
  }

  async function getGlobalBlockState(user = auth?.currentUser || null) {
    if (!user || user.isAnonymous || !db) return null;
    try {
      const snapshot = await db.ref("admin/blocksByUid/" + user.uid).once("value");
      const value = snapshot.val();
      if (!value || typeof value !== "object") return null;
      const permanent = value.permanent === true || Number(value.blockedUntil || 0) === 0;
      const blockedUntil = Number(value.blockedUntil || 0);
      if (permanent || (Number.isFinite(blockedUntil) && blockedUntil > Date.now())) {
        return {...value, blockedUntil};
      }
    } catch (_) {}
    return null;
  }

  function formatBlockMessage(block) {
    if (!block) return "";
    if (block.permanent === true || Number(block.blockedUntil || 0) === 0) return "你的帳號目前已被管理員永久封鎖";
    const remaining = Math.max(0, Number(block.blockedUntil || 0) - Date.now());
    const minutes = Math.max(1, Math.ceil(remaining / 60000));
    if (minutes >= 1440) return `你的帳號目前已被管理員封鎖，剩餘約 ${Math.ceil(minutes / 1440)} 天`;
    if (minutes >= 60) return `你的帳號目前已被管理員封鎖，剩餘約 ${Math.ceil(minutes / 60)} 小時`;
    return `你的帳號目前已被管理員封鎖，剩餘約 ${minutes} 分鐘`;
  }

  function clearGlobalBlockTimer() {
    if (state.globalBlockTimer) {
      clearInterval(state.globalBlockTimer);
      state.globalBlockTimer = null;
    }
  }

  function hideGlobalBlockScreen() {
    clearGlobalBlockTimer();
    state.globalBlocked = false;
    state.globalBlockData = null;
    $("globalBlockScreen")?.classList.add("hidden");
    document.body?.classList.remove("wt-account-blocked");
  }

  function renderGlobalBlockScreen(block) {
    const message = $("globalBlockMessage");
    const meta = $("globalBlockMeta");
    if (!message || !meta || !block) return;

    const permanent = block.permanent === true || Number(block.blockedUntil || 0) === 0;
    const blockedUntil = Number(block.blockedUntil || 0);
    message.textContent = formatBlockMessage(block);

    if (permanent) {
      meta.textContent = "狀態：永久封鎖";
    } else if (Number.isFinite(blockedUntil) && blockedUntil > Date.now()) {
      meta.textContent = "解除時間：" + new Date(blockedUntil).toLocaleString("zh-TW", {
        year:"numeric",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"
      });
    } else {
      meta.textContent = "封鎖期限已到，正在重新確認帳號狀態…";
    }
  }

  function showGlobalBlockScreen(block) {
    const screen = $("globalBlockScreen");
    if (!screen || !block) return;

    clearGlobalBlockTimer();
    state.globalBlocked = true;
    state.globalBlockData = {...block};
    renderGlobalBlockScreen(state.globalBlockData);
    screen.classList.remove("hidden");
    document.body?.classList.add("wt-account-blocked");

    const blockedUntil = Number(block.blockedUntil || 0);
    const permanent = block.permanent === true || blockedUntil === 0;
    if (!permanent) {
      state.globalBlockTimer = setInterval(async () => {
        const current = state.globalBlockData;
        const until = Number(current?.blockedUntil || 0);
        if (!until || until > Date.now()) {
          if (current) renderGlobalBlockScreen(current);
          return;
        }

        clearGlobalBlockTimer();
        const latest = await getGlobalBlockState(auth?.currentUser || null);
        if (latest) {
          showGlobalBlockScreen(latest);
        } else {
          hideGlobalBlockScreen();
        }
      }, 1000);
    }
  }

  async function ensureNotGloballyBlocked(user = auth?.currentUser || null) {
    if (!user || user.isAnonymous) return;
    if (String(user.uid || "") === MASTER_ADMIN_UID) return;
    const block = await getGlobalBlockState(user);
    if (block) {
      showGlobalBlockScreen(block);
      throw new Error(formatBlockMessage(block));
    }
  }
  const state = {
    uid: null,

    memberName:
      "使用者",

    roomId: null,

    room: null,

    isOwner: false,

    adminJoinRequested: false,
    adminJoinOverride: false,
    globalBlockListenerRef: null,
    globalBlockListenerAttached: false,
    globalBlockHandler: null,
    globalBlocked: false,
    globalBlockData: null,
    globalBlockTimer: null,

    roomRef: null,

    membersRef: null,

    kickedRef: null,

    chatRef: null,

    queueRef: null,

    player: null,

    playerReady: false,

    playerType: null,

    currentVideoId: null,

    currentVideoUrl: null,

    twitchPlaybackKind: null,

    localTimer: null,
    queueNextTimer: null,

    memberHeartbeatTimer: null,

    searchResults: [],

    searchNextPageToken: "",

    searchQuery: "",

    searchLoadingMore: false,

    searchPageCount: 0,

    lastYoutubeSearchAt: 0,

    searchBusy: false,

    modalSelectedVideo: null,

    modalSelectedVideoId: "",

    videoListenerAttached: false,

    membersListenerAttached: false,

    roomOwnerListenerAttached: false,

    chatListenerAttached: false,

    queueListenerAttached: false,

    youtubeNativeListenersAttached: false,
    youtubeNativeVideoElement: null,
    youtubeNativeEventHandlers: null,
    youtubeNativeSuppressEvent: "",
    youtubeNativeSuppressUntil: 0,
    youtubeStreamRefreshInFlight: false,
    youtubeStreamRefreshAttempts: 0,
    youtubeStreamRefreshWindowStartedAt: 0,
    youtubeStreamStallTimer: null,
    youtubePlaybackMode: "iframe",
    youtubeIframeInitialSyncUntil: 0,

    youtubeLoading: false,

    youtubeRequestedId: null,

    youtubeBuildToken: 0,

    playbackListenerAttached: false,
    playbackApplyingRemote: false,
    playbackIgnoreStateChanges: 0,
    playbackIgnoreStateUntil: 0,
    playbackReadyAt: 0,
    playbackLastPosition: null,
    playbackLastPlaying: null,
    playbackSeekTimer: null,
    playbackRemoteEvent: null,
    playbackLastRemoteEventId: null,
    playbackApplyingRemoteEventId: null,
    playbackLastRemoteUpdatedAt: 0,
    playbackLastLocalActionKey: "",
    playbackLastLocalActionAt: 0,
    playbackLastLocalSeekWriteAt: 0,
    playbackRecoveryTimer: null,
    playbackServerTimeOffset: 0,
    playbackServerClockHandler: null,
    playbackClockBaseServerMs: 0,
    playbackClockBaseMonoMs: 0,
    playbackClockOffsetSamples: [],
    playbackClockLastCalibratedAt: 0,
    playbackActionSeq: 0,
    playbackPendingRecovery: false,
    playbackReconcileInFlight: false,
    playbackPausePublishTimer: null,
    playbackLocalIntentAt: 0,
    playbackLocalActionTimer: null,
    playbackLocalActionSerial: 0,
    playbackUserActionUntil: 0,
    playbackUserActionKind: "",
    playbackUiBridgeBound: false,

    playbackMeasuredRttMs: 0,
    playbackRttSamples: [],
    playbackLocalScheduledEventId: "",
    playbackLocalControlUntil: 0,
    playbackLocalSeekSuppressUntil: 0,
    playbackLocalSeekTimer: null,
    playbackRemotePlayTimer: null,
    playbackRemoteSeekTimer: null,
    playbackResumeRecoveryUntil: 0,

    playbackTimeline: null,
    playbackAdGuardUntil: 0,
    playbackTransientStateUntil: 0,
    playbackLastPlayerState: null,
    playbackLastObservedPosition: null,
    playbackAppliedRate: null,
    playbackIsBuffering: false,
    playbackYoutubeRates: null,
    playbackYoutubeRatesVideoId: "",
    playbackYoutubeRatesCheckedAt: 0,
    playbackAwaitingActualStart: false,
    playbackActualStartTimer: null,
    playbackInitialHardSyncUntil: 0,
    playbackInitialHardSyncEventId: "",
    playbackInitialHardSyncAt: 0,
    playbackSyncPhase: "idle",
    playbackFineRateSupported: null,
    playbackNativeEventSuppressKind: "",
    playbackNativeEventSuppressUntil: 0,

    controlRequestRef: null,
    controlRequestListenerAttached: false,
    controlRequestProcessing: false,
    controlRequestQueue: [],
    controlRequestLastAt: 0,
    ownerFailoverSequence: 0,

    timeUiRequestId: 0,

    queue: {},

    googleRedirectHandled: false,

    modalBodyScrollLocked: false,

    wasMemberInRoom: false,

    kickedLocally: false,

    leavingRoom: false,

    authReady: false,
    authRetrying: false,

    databaseConnected: false,
    databaseConnectionListenerAttached: false,
    memberRecoveryInFlight: false,

    sdk: {
      vimeo: false,
      dailymotion: false,
      twitch: false
    }
  };


  let db = null;
  let auth = null;


  /*
   * =========================================================
   * BASIC
   * =========================================================
   */

  function toast(message) {
    const element = $("toast");

    if (!element) {
      return;
    }

    element.textContent =
      message || "";

    element.classList.add(
      "show"
    );

    clearTimeout(
      toast.timer
    );

    toast.timer =
      setTimeout(() => {
        element.classList.remove(
          "show"
        );
      }, 2400);
  }


  function setError(
    element,
    message
  ) {
    if (!element) {
      return;
    }

    element.textContent =
      message || "";
  }


  function showView(view) {
    $("homeView")?.classList.toggle(
      "hidden",
      view !== "home"
    );

    $("roomView")?.classList.toggle(
      "hidden",
      view !== "room"
    );
  }


  function escapeHtml(value) {
    return String(
      value ?? ""
    ).replace(
      /[&<>"']/g,
      (character) => {
        const map = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        };

        return map[character];
      }
    );
  }


  function formatTime(seconds) {
    const number =
      Number(seconds);

    if (
      !Number.isFinite(number) ||
      number < 0
    ) {
      return "00:00";
    }

    const total =
      Math.floor(number);

    const hours =
      Math.floor(
        total / 3600
      );

    const minutes =
      Math.floor(
        (total % 3600) / 60
      );

    const secs =
      total % 60;

    if (hours > 0) {
      return (
        String(hours).padStart(2, "0") +
        ":" +
        String(minutes).padStart(2, "0") +
        ":" +
        String(secs).padStart(2, "0")
      );
    }

    return (
      String(minutes).padStart(2, "0") +
      ":" +
      String(secs).padStart(2, "0")
    );
  }


  function formatViews(value) {
    const number =
      Number(value);

    if (
      !Number.isFinite(number) ||
      number <= 0
    ) {
      return "";
    }

    if (number >= 100000000) {
      return (
        (number / 100000000)
          .toFixed(1)
          .replace(/\.0$/, "") +
        " 億次觀看"
      );
    }

    if (number >= 10000) {
      return (
        (number / 10000)
          .toFixed(1)
          .replace(/\.0$/, "") +
        " 萬次觀看"
      );
    }

    return (
      number.toLocaleString("zh-TW") +
      " 次觀看"
    );
  }


  function formatDuration(seconds) {
    const number =
      Number(seconds);

    if (
      !Number.isFinite(number) ||
      number < 0
    ) {
      return "";
    }

    const total =
      Math.floor(number);

    const hours =
      Math.floor(total / 3600);

    const minutes =
      Math.floor(
        (total % 3600) / 60
      );

    const secs =
      total % 60;

    if (hours > 0) {
      return (
        String(hours) +
        ":" +
        String(minutes).padStart(2, "0") +
        ":" +
        String(secs).padStart(2, "0")
      );
    }

    return (
      String(minutes) +
      ":" +
      String(secs).padStart(2, "0")
    );
  }


  function parseISO8601Duration(value) {
    if (!value) {
      return 0;
    }

    const match =
      String(value).match(
        /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
      );

    if (!match) {
      return 0;
    }

    const days =
      Number(match[1] || 0);

    const hours =
      Number(match[2] || 0);

    const minutes =
      Number(match[3] || 0);

    const seconds =
      Number(match[4] || 0);

    return (
      days * 86400 +
      hours * 3600 +
      minutes * 60 +
      seconds
    );
  }


  function randomRoomCode() {
    const chars =
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    const values =
      new Uint32Array(
        6
      );

    if (
      window.crypto?.getRandomValues
    ) {
      window.crypto.getRandomValues(
        values
      );
    } else {
      for (
        let i = 0;
        i < values.length;
        i++
      ) {
        values[i] =
          Math.floor(
            Math.random() *
            0xffffffff
          );
      }
    }

    let result = "";

    for (
      let i = 0;
      i < 6;
      i++
    ) {
      result +=
        chars[
          values[i] %
          chars.length
        ];
    }

    return result;
  }


  function getRoomIdFromUrl() {
    return (
      new URLSearchParams(
        location.search
      )
        .get("room")
        ?.trim()
        .toUpperCase() ||
      ""
    );
  }


  function getRoomLink(roomId) {
    return (
      location.origin +
      location.pathname +
      "?room=" +
      encodeURIComponent(roomId)
    );
  }


  function getSavedRoomId() {
    const value =
      localStorage.getItem(
        LAST_ROOM_STORAGE_KEY
      );

    if (
      !value ||
      !/^[A-Z0-9]{6}$/.test(
        value
      )
    ) {
      return "";
    }

    return value.toUpperCase();
  }


  function saveRoomId(roomId) {
    const normalized =
      String(roomId || "")
        .trim()
        .toUpperCase();

    if (
      /^[A-Z0-9]{6}$/.test(
        normalized
      )
    ) {
      localStorage.setItem(
        LAST_ROOM_STORAGE_KEY,
        normalized
      );
    }
  }


  function clearSavedRoomId() {
    localStorage.removeItem(
      LAST_ROOM_STORAGE_KEY
    );
  }


  function isGuestName(name) {
    return /^訪客\d{3}$/.test(
      String(name || "").trim()
    );
  }

  const GUEST_NAME_STORAGE_KEY =
    "wt_guest_name";

  function getMemberName() {
    const user =
      state.user ||
      auth?.currentUser ||
      null;

    if (user && !user.isAnonymous) {
      const loginName = String(
        localStorage.getItem("wt_name") ||
        state.memberName ||
        user.displayName ||
        ""
      ).trim();

      return loginName ? loginName.slice(0, 30) : "玩家";
    }

    let guestName = String(
      localStorage.getItem(GUEST_NAME_STORAGE_KEY) ||
      ""
    ).trim();

    if (!isGuestName(guestName)) {
      guestName = "訪客" + Math.floor(Math.random() * 900 + 100);
      localStorage.setItem(GUEST_NAME_STORAGE_KEY, guestName);
    }

    localStorage.removeItem("wt_name");
    return guestName;
  }


  function setMemberName(name) {
    const normalized =
      String(name || "")
        .trim()
        .slice(0, 30);

    if (!normalized) {
      throw new Error(
        "名稱不能是空白"
      );
    }

    state.memberName =
      normalized;

    localStorage.setItem(
      "wt_name",
      normalized
    );
  }


  /*
   * =========================================================
   * MODAL SCROLL
   * =========================================================
   */

  function lockPageScroll() {
    if (
      state.modalBodyScrollLocked
    ) {
      return;
    }

    state.modalBodyScrollLocked =
      true;

    document.documentElement.style.overflow =
      "hidden";

    document.body.style.overflow =
      "hidden";

    document.body.style.overscrollBehavior =
      "none";
  }


  function unlockPageScroll() {
    if (
      !state.modalBodyScrollLocked
    ) {
      return;
    }

    state.modalBodyScrollLocked =
      false;

    document.documentElement.style.overflow =
      "";

    document.body.style.overflow =
      "";

    document.body.style.overscrollBehavior =
      "";
  }


  function isMobileViewport() {
    return (
      window.innerWidth <= 760 ||
      (window.innerHeight <= 600 && window.innerWidth >= 700 && window.matchMedia?.("(orientation: landscape)")?.matches)
    );
  }


  function configureSearchScroll() {
    const modal = $("sourceModal");
    const card = modal?.querySelector(".modal-card");
    const searchArea = $("modalVideoSearchArea");
    const container = $("modalVideoSearchResults");
    const actions = card?.querySelector(".modal-actions");
    const error = $("modalError");

    if (!modal || !card || !searchArea || !container) {
      return;
    }

    const viewportHeight =
      window.visualViewport?.height ||
      window.innerHeight ||
      700;

    const isCompactLandscape =
      window.innerHeight <= 600 &&
      window.innerWidth >= 700 &&
      window.matchMedia?.(
        "(orientation: landscape)"
      )?.matches;

    const isMobile =
      window.innerWidth <= 760 ||
      Boolean(isCompactLandscape);

    /* =====================================================
       Modal 本身固定滿版
       ===================================================== */
    Object.assign(modal.style, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100dvh",
      maxHeight: "100dvh",
      padding: "0",
      overflow: "hidden",
      boxSizing: "border-box",
      overscrollBehavior: "none"
    });

    /* =====================================================
       真正的 modal-card 佈局
       HTML 結構是：

       modal-card
       ├─ panel-title
       ├─ label
       ├─ select
       ├─ modalVideoSearchArea
       ├─ modal-actions
       └─ modalError

       所以不能再把 > div:nth-child(2) 當搜尋 body。
       ===================================================== */
    Object.assign(card.style, {
      width: "100%",
      maxWidth: "none",
      height: "100%",
      maxHeight: "100%",
      margin: "0",
      border: "0",
      borderRadius: "0",
      boxSizing: "border-box",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      minHeight: "0",
      padding: isMobile ? "10px" : "22px"
    });

    /* =====================================================
       頂部固定內容不要參與滾動
       ===================================================== */
    const title = card.querySelector(":scope > .panel-title");
    const platformLabel = card.querySelector(
      ":scope > label[for='sourceTypeModal']"
    );
    const platformSelect = $("sourceTypeModal");

    [title, platformLabel, platformSelect].forEach((el) => {
      if (!el) return;
      el.style.flex = "0 0 auto";
    });

    if (platformLabel) {
      platformLabel.style.marginTop = isMobile ? "10px" : "15px";
    }

    /* =====================================================
       搜尋區吃掉剩餘高度
       ===================================================== */
    Object.assign(searchArea.style, {
      flex: "1 1 auto",
      minHeight: "0",
      minWidth: "0",
      width: "100%",
      height: "auto",
      maxHeight: "none",
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      boxSizing: "border-box",
      marginTop: isMobile ? "10px" : "14px"
    });

    const searchLabel = searchArea.querySelector(
      ":scope > label"
    );

    const searchRow = searchArea.querySelector(
      ":scope > .search-row"
    );

    if (searchLabel) {
      searchLabel.style.flex = "0 0 auto";
      searchLabel.style.marginTop = "0";
    }

    if (searchRow) {
      Object.assign(searchRow.style, {
        flex: "0 0 auto",
        minHeight: isMobile ? "44px" : "46px",
        width: "100%",
        boxSizing: "border-box"
      });
    }

    /* =====================================================
       真正的搜尋滾動容器
       ===================================================== */
    Object.assign(container.style, {
      position: "relative",
      display: "grid",
      gridTemplateColumns: isMobile
        ? "1fr"
        : "repeat(auto-fill, minmax(280px, 1fr))",
      gridAutoRows: "max-content",
      alignContent: "start",
      gap: isMobile ? "10px" : "14px",
      flex: "1 1 auto",
      minHeight: "0",
      minWidth: "0",
      width: "100%",
      height: "auto",
      maxHeight: "none",
      overflowY: "auto",
      overflowX: "hidden",
      boxSizing: "border-box",
      WebkitOverflowScrolling: "touch",
      touchAction: "pan-y",
      overscrollBehaviorY: "contain",
      scrollBehavior: "auto",
      padding: isMobile
        ? "8px 2px 30px"
        : "12px 10px 30px"
    });

    /* =====================================================
       搜尋結果卡片：桌面維持原本橫向縮圖式樣；
       手機改成單欄、固定可預期高度，避免擠在一起。
       ===================================================== */
    container.querySelectorAll(".video-result-card").forEach((cardEl) => {
      Object.assign(cardEl.style, {
        width: "100%",
        minWidth: "0",
        maxWidth: "100%",
        boxSizing: "border-box",
        minHeight: isMobile ? "92px" : "0",
        height: "auto",
        flex: "0 0 auto",
        overflow: "hidden"
      });

      if (isMobile) {
        cardEl.style.display = "grid";
        cardEl.style.gridTemplateColumns = "112px minmax(0, 1fr)";
        cardEl.style.gridTemplateRows = "auto auto";
        cardEl.style.columnGap = "10px";
        cardEl.style.rowGap = "6px";
        cardEl.style.padding = "8px";

        const main = cardEl.querySelector(".video-result-main");
        const thumbWrap = main?.querySelector(":scope > div");
        const info = main?.querySelector(".video-result-info");
        const actionRow = cardEl.querySelector(":scope > div:last-child");
        const img = main?.querySelector("img");

        if (main) {
          Object.assign(main.style, {
            gridColumn: "1 / -1",
            gridRow: "1",
            width: "100%",
            minWidth: "0",
            minHeight: "0",
            display: "grid",
            gridTemplateColumns: "112px minmax(0, 1fr)",
            alignItems: "center",
            gap: "10px",
            margin: "0",
            padding: "0",
            boxSizing: "border-box"
          });
        }

        if (thumbWrap) {
          Object.assign(thumbWrap.style, {
            width: "112px",
            minWidth: "112px",
            height: "63px",
            minHeight: "63px",
            overflow: "hidden",
            borderRadius: "7px",
            boxSizing: "border-box"
          });
        }

        if (img) {
          Object.assign(img.style, {
            width: "112px",
            minWidth: "112px",
            maxWidth: "112px",
            height: "63px",
            minHeight: "63px",
            maxHeight: "63px",
            display: "block",
            objectFit: "cover",
            borderRadius: "7px"
          });
        }

        if (info) {
          Object.assign(info.style, {
            minWidth: "0",
            width: "100%",
            padding: "0",
            margin: "0",
            overflow: "hidden",
            display: "grid",
            gap: "3px",
            alignContent: "center",
            boxSizing: "border-box"
          });

          const strong = info.querySelector("strong");
          if (strong) {
            Object.assign(strong.style, {
              display: "-webkit-box",
              overflow: "hidden",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: "2",
              whiteSpace: "normal",
              textOverflow: "ellipsis",
              wordBreak: "break-word",
              fontSize: "13px",
              lineHeight: "1.35"
            });
          }
        }

        if (actionRow) {
          Object.assign(actionRow.style, {
            gridColumn: "1 / -1",
            gridRow: "2",
            width: "100%",
            minWidth: "0",
            margin: "0",
            padding: "0",
            display: "flex",
            flexWrap: "wrap",
            gap: "6px",
            boxSizing: "border-box"
          });
        }
      } else {
        cardEl.style.display = "block";
      }
    });

    /* =====================================================
       底部按鈕與錯誤訊息固定，不搶走搜尋滾動空間
       ===================================================== */
    if (actions) {
      Object.assign(actions.style, {
        flex: "0 0 auto",
        width: "100%",
        boxSizing: "border-box",
        marginTop: isMobile ? "8px" : "18px"
      });
    }

    if (error) {
      Object.assign(error.style, {
        flex: "0 0 auto",
        minHeight: "20px",
        boxSizing: "border-box"
      });
    }

    /* =====================================================
       滑鼠滾輪：只有真正有 scroll range 時才攔截。
       ===================================================== */
    if (!container.__wtWheelAttached) {
      container.addEventListener(
        "wheel",
        (event) => {
          if (Math.abs(event.deltaY) < 0.01) {
            return;
          }

          const maxScroll =
            container.scrollHeight -
            container.clientHeight;

          if (maxScroll <= 0) {
            return;
          }

          event.preventDefault();
          container.scrollTop = Math.max(
            0,
            Math.min(
              maxScroll,
              container.scrollTop + event.deltaY
            )
          );
        },
        { passive: false }
      );

      container.__wtWheelAttached = true;
    }

    /* =====================================================
       手機觸控：完全交給瀏覽器原生 pan-y。
       ===================================================== */
    if (!container.__wtTouchConfigured) {
      container.addEventListener(
        "touchstart",
        () => {},
        { passive: true }
      );

      container.addEventListener(
        "touchmove",
        () => {},
        { passive: true }
      );

      container.__wtTouchConfigured = true;
    }

    /* 強制重新計算一次 layout，避免動態插入結果後高度還沒更新。 */
    requestAnimationFrame(() => {
      if (!document.body.contains(container)) {
        return;
      }

      container.style.overflowY = "auto";
      container.style.height = "auto";
      container.style.maxHeight = "none";

      if (container.scrollHeight > container.clientHeight) {
        container.style.overflowY = "auto";
      }
    });
  }


  /*
   * =========================================================
   * AUTH UI
   * =========================================================
   */

  function updateAuthUI(user = undefined) {
    const loginButton =
      $("googleLoginBtn");

    const logoutButton =
      $("logoutBtn");

    const authStatus =
      $("authStatus");

    const currentUser =
      user !== undefined
        ? user
        : (
            auth?.currentUser ||
            null
          );

    if (currentUser) {
      if (authStatus) {
        authStatus.textContent =
          "已連線";
      }

      const isGoogleUser =
        !currentUser.isAnonymous;

      loginButton?.classList.toggle(
        "hidden",
        isGoogleUser
      );

      logoutButton?.classList.toggle(
        "hidden",
        !isGoogleUser
      );

      return;
    }

    if (authStatus) {
      authStatus.textContent =
        "未登入";
    }

    loginButton?.classList.remove(
      "hidden"
    );

    logoutButton?.classList.add(
      "hidden"
    );
  }


  /*
   * =========================================================
   * FIREBASE
   * =========================================================
   */

  async function persistAuthenticatedAccount(user) {
    if (!user || user.isAnonymous || !user.uid || !user.email || !db) {
      return false;
    }

    const current = auth?.currentUser;
    if (current && String(current.uid) !== String(user.uid)) {
      return false;
    }

    const ref = db.ref("accounts/" + user.uid);
    const provider = user.providerData && user.providerData.length
      ? String(user.providerData[0].providerId || "google.com")
      : "google.com";

    const snapshot = await ref.once("value");
    const old = snapshot.val() || {};

    await ref.set({
      uid: String(user.uid),
      email: String(user.email).trim().toLowerCase(),
      emailVerified: user.emailVerified === true,
      displayName: String(user.displayName || "").trim().slice(0, 100),
      photoURL: String(user.photoURL || "").trim().slice(0, 2000),
      provider: provider.slice(0, 50),
      createdAt: Number(old.createdAt || 0) > 0
        ? Number(old.createdAt)
        : firebase.database.ServerValue.TIMESTAMP,
      lastLoginAt: firebase.database.ServerValue.TIMESTAMP,
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    });

    return true;
  }


  async function initializeFirebase() {
    if (!window.firebase) {
      throw new Error(
        "Firebase SDK 尚未載入"
      );
    }

    if (!window.FIREBASE_CONFIG) {
      throw new Error(
        "找不到 Firebase 設定"
      );
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(
        window.FIREBASE_CONFIG
      );
    }

    auth =
      firebase.auth();

    db =
      firebase.database();

    attachDatabaseConnectionListener();

    /*
     * 使用 LOCAL 持久化，確保 Google Popup 完成後
     * 重新載入頁面仍能正確恢復 Firebase 使用者。
     */
    try {
      await auth.setPersistence(
        firebase.auth.Auth.Persistence.LOCAL
      );
    } catch (persistenceError) {
      console.warn(
        "Firebase Auth 持久化設定失敗:",
        persistenceError
      );
    }

    auth.onAuthStateChanged(
      (user) => {
        if (user) {
          state.uid =
            user.uid;

          state.authReady =
            true;

          if (
            !user.isAnonymous &&
            user.displayName &&
            (
              !localStorage.getItem("wt_name") ||
              isGuestName(localStorage.getItem("wt_name"))
            )
          ) {
            try {
              setMemberName(
                user.displayName
              );
            } catch (_) {}
          }

          if (user.isAnonymous) {
            try {
              state.memberName =
                window.WT_CORE?.setGuestName?.() ||
                getMemberName();
            } catch (_) {
              state.memberName =
                getMemberName();
            }
          }
        } else {
          state.uid =
            null;

          state.authReady =
            false;
        }

        updateAuthUI(user);
        if (user && !user.isAnonymous) {
          setupGlobalBlockListener(user);
          void persistAuthenticatedAccount(user).catch((error) => {
            console.warn("核心帳號同步失敗:", error);
          });
        } else {
          detachGlobalBlockListener();
        }
      }
    );

    /*
     * 不要在這裡直接 signInAnonymously()。
     * 必須先讓 onAuthStateChanged 完成初始狀態判斷，
     * 避免 Firebase Auth 尚未恢復時就建立新的匿名 UID。
     */
    updateAuthUI(
      auth.currentUser || null
    );
  }


  function detachGlobalBlockListener() {
    if (state.globalBlockListenerRef && state.globalBlockListenerAttached) {
      try {
        state.globalBlockListenerRef.off("value", state.globalBlockHandler);
      } catch (_) {}
    }
    state.globalBlockListenerRef = null;
    state.globalBlockListenerAttached = false;
    state.globalBlockHandler = null;
  }

  function setupGlobalBlockListener(user) {
    if (!db || !user || user.isAnonymous) return;
    detachGlobalBlockListener();
    const ref = db.ref("admin/blocksByUid/" + user.uid);
    const handler = async (snapshot) => {
      const value = snapshot.val();
      if (!value || typeof value !== "object") {
        hideGlobalBlockScreen();
        return;
      }
      const permanent = value.permanent === true || Number(value.blockedUntil || 0) === 0;
      const blockedUntil = Number(value.blockedUntil || 0);
      if (!permanent && (!Number.isFinite(blockedUntil) || blockedUntil <= Date.now())) {
        hideGlobalBlockScreen();
        return;
      }
      showGlobalBlockScreen(value);
      const message = formatBlockMessage(value);
      if (state.roomId && !state.leavingRoom) {
        try { await leaveRoomLocally(message); } catch (_) {}
      } else {
        setError($("homeError"), message);
        toast(message);
      }
    };
    state.globalBlockListenerRef = ref;
    state.globalBlockHandler = handler;
    state.globalBlockListenerAttached = true;
    ref.on("value", handler);
  }

  async function waitForGoogleAuthUser(timeoutMs = 3500) {
    if (!auth) {
      return null;
    }

    const currentUser =
      auth.currentUser;

    if (
      currentUser &&
      !currentUser.isAnonymous
    ) {
      return currentUser;
    }

    return new Promise((resolve) => {
      let finished = false;
      let unsubscribe = null;

      const finish = (user) => {
        if (finished) {
          return;
        }

        finished = true;

        try {
          unsubscribe?.();
        } catch (_) {}

        clearTimeout(
          timer
        );

        resolve(
          user ||
          null
        );
      };

      unsubscribe =
        auth.onAuthStateChanged(
          (user) => {
            if (
              user &&
              !user.isAnonymous
            ) {
              finish(user);
            }
          }
        );

      const timer =
        setTimeout(() => {
          finish(null);
        }, timeoutMs);
    });
  }


  async function googleLogin() {
    if (!auth) {
      throw new Error(
        "Firebase Auth 尚未初始化"
      );
    }

    const provider =
      new firebase.auth.GoogleAuthProvider();

    provider.setCustomParameters({
      prompt:
        "select_account"
    });

    const currentUser =
      auth.currentUser;

    try {
      /*
       * 新的 Google 帳號：
       * 直接把目前匿名訪客帳號綁定到 Google。
       */
      if (
        currentUser &&
        currentUser.isAnonymous
      ) {
        try {
          const result =
            await currentUser.linkWithPopup(
              provider
            );

          const user =
            result?.user ||
            auth.currentUser ||
            null;

          if (!user) {
            throw new Error(
              "Google 登入成功，但找不到 Firebase 使用者"
            );
          }

          state.uid =
            user.uid;

          updateAuthUI(user);
          try {
            if (typeof window.WT_ENHANCEMENTS?.saveLoginAccount === "function") {
              await window.WT_ENHANCEMENTS.saveLoginAccount(user);
            }
          } catch (syncError) {
            console.warn("登入帳號同步失敗:", syncError);
          }

          toast(
            "Google 登入成功"
          );

          return user;
        } catch (linkError) {
          /*
           * 原本已經註冊過的 Google 帳號會走到這裡。
           *
           * 最重要的是：
           * 不要再開第二個 Popup。
           *
           * Firebase 在 credential-already-in-use
           * 錯誤中會帶回原本的 Google credential，
           * 可以直接 signInWithCredential() 登入既有帳號。
           */
          if (
            linkError?.code ===
              "auth/credential-already-in-use" &&
            linkError?.credential
          ) {
            const result =
              await auth.signInWithCredential(
                linkError.credential
              );

            const user =
              result?.user ||
              auth.currentUser ||
              null;

            if (!user) {
              throw new Error(
                "Google 帳號已存在，但 Firebase 沒有回傳使用者"
              );
            }

            state.uid =
              user.uid;

            updateAuthUI(user);
            try {
              if (typeof window.WT_ENHANCEMENTS?.saveLoginAccount === "function") {
                await window.WT_ENHANCEMENTS.saveLoginAccount(user);
              }
            } catch (syncError) {
              console.warn("登入帳號同步失敗:", syncError);
            }

            toast(
              "Google 登入成功"
            );

            return user;
          }

          /*
           * 部分 Firebase 版本可能沒有把 credential
           * 附在錯誤物件上；這種情況才退回一般 Popup
           * 登入，避免影響其他帳號的正常流程。
           */
          if (
            linkError?.code !==
            "auth/credential-already-in-use"
          ) {
            throw linkError;
          }
        }
      }

      const result =
        await auth.signInWithPopup(
          provider
        );

      const user =
        result?.user ||
        auth.currentUser ||
        null;

      if (!user) {
        throw new Error(
          "Google 登入完成，但 Firebase 沒有回傳使用者"
        );
      }

      state.uid =
        user.uid;

      updateAuthUI(user);
      try {
        await persistAuthenticatedAccount(user);
        if (typeof window.WT_ENHANCEMENTS?.saveLoginAccount === "function") {
          await window.WT_ENHANCEMENTS.saveLoginAccount(user);
        }
      } catch (syncError) {
        console.warn("登入帳號同步失敗:", syncError);
      }

      toast(
        "Google 登入成功"
      );

      return user;
    } catch (error) {
      console.error(
        "Google 登入失敗:",
        error
      );

      const code =
        error?.code ||
        "unknown";

      const message =
        error?.message ||
        "Google 登入失敗";

      /*
       * Chrome / Firebase Popup 在 COOP 下可能只是
       * 無法正確偵測 popup.closed，但 Firebase Auth
       * 實際上已經完成登入。
       */
      if (
        code ===
          "auth/popup-blocked" ||
        code ===
          "auth/popup-closed-by-user" ||
        code ===
          "auth/cancelled-popup-request"
      ) {
        const recoveredUser =
          await waitForGoogleAuthUser();

        if (
          recoveredUser &&
          !recoveredUser.isAnonymous
        ) {
          state.uid =
            recoveredUser.uid;

          updateAuthUI(
            recoveredUser
          );
          try {
            if (typeof window.WT_ENHANCEMENTS?.saveLoginAccount === "function") {
              await window.WT_ENHANCEMENTS.saveLoginAccount(recoveredUser);
            }
          } catch (syncError) {
            console.warn("登入帳號同步失敗:", syncError);
          }

          toast(
            "Google 登入成功"
          );

          return recoveredUser;
        }
      }

      if (
        code ===
          "auth/popup-blocked"
      ) {
        throw new Error(
          "Google 登入視窗被瀏覽器阻擋，請允許此網站開啟登入視窗後再試一次"
        );
      }

      throw new Error(
        `Google 登入失敗 [${code}]：${message}`
      );
    }
  }


  async function handleGoogleRedirectResult() {
    /*
     * 目前正式登入流程使用 Popup。
     * 保留 Redirect 結果處理，避免使用者在舊版 Redirect
     * 流程中回站時卡住，但正常 Popup 登入不依賴這裡。
     */
    if (
      !auth ||
      state.googleRedirectHandled
    ) {
      return null;
    }

    state.googleRedirectHandled =
      true;

    try {
      const result =
        await auth.getRedirectResult();

      if (result?.user) {
        const user =
          result.user;

        state.uid =
          user.uid;

        if (
          user.displayName &&
          (
            !localStorage.getItem("wt_name") ||
            isGuestName(localStorage.getItem("wt_name"))
          )
        ) {
          try {
            setMemberName(
              user.displayName
            );
          } catch (_) {}
        }

        updateAuthUI(user);
        try {
          await persistAuthenticatedAccount(user);
          if (typeof window.WT_ENHANCEMENTS?.saveLoginAccount === "function") {
            await window.WT_ENHANCEMENTS.saveLoginAccount(user);
          }
        } catch (syncError) {
          console.warn("Redirect 登入帳號同步失敗:", syncError);
        }

        toast(
          "Google 登入成功"
        );

        return user;
      }

      return null;
    } catch (error) {
      console.error(
        "Google Redirect 登入失敗:",
        error
      );

      /*
       * 舊 Redirect 流程發生錯誤時只顯示訊息，
       * 不阻止目前頁面的匿名訪客模式啟動。
       */
      toast(
        error?.message ||
        "Google 登入失敗"
      );

      return null;
    }
  }


  async function logout() {
    if (!auth) {
      return;
    }

    const currentUser =
      auth.currentUser;

    if (!currentUser) {
      updateAuthUI();
      return;
    }

    try {
      /*
       * 登出前先離開目前房間，
       * 避免 Firebase Auth UID 改變後，
       * 房間成員 / owner 還留著舊 UID。
       */
      if (state.roomId) {
        await exitCurrentRoom();
      }

      localStorage.removeItem("wt_name");
      state.profile = null;
      state.memberName = "";
      await auth.signOut();

      await ensureAnonymousAuth();

      state.memberName =
        window.WT_CORE?.setGuestName?.() ||
        getMemberName();

      updateAuthUI();

      toast(
        "已登出，現在使用訪客模式"
      );
    } catch (error) {
      console.error(
        "登出失敗:",
        error
      );

      toast(
        error?.message ||
        "登出失敗"
      );
    }
  }



  async function updateCurrentMemberName() {
    if (
      !state.roomId ||
      !state.membersRef ||
      !state.uid ||
      !state.wasMemberInRoom ||
      state.leavingRoom
    ) {
      return;
    }

    try {
      const memberRef =
        state.membersRef.child(
          state.uid
        );

      await memberRef.transaction(
        (current) => {
          if (
            !current ||
            state.leavingRoom
          ) {
            return;
          }

          return {
            ...current,
            name: state.memberName,
            online: true,
            lastSeen: Date.now(),
            ...(state.user && !state.user.isAnonymous && window.WT_ENHANCEMENTS?.state?.profile?.publicCode
              ? { publicCode: String(window.WT_ENHANCEMENTS.state.profile.publicCode).toUpperCase().slice(0, 6) }
              : {})
          };
        }
      );
    } catch (error) {
      if (!state.leavingRoom) {
        console.warn(
          "Firebase 成員名稱同步失敗:",
          error
        );
      }
    }
  }



function waitForDatabaseConnection(timeoutMs = 8000) {
    if (!db || state.leavingRoom) {
      return Promise.resolve(false);
    }

    if (state.databaseConnected === true) {
      return Promise.resolve(true);
    }

    return new Promise(resolve => {
      const connectedRef = db.ref(".info/connected");
      let settled = false;
      let timer = null;

      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        try {
          connectedRef.off("value", handle);
        } catch (_) {}
      };

      const finish = connected => {
        cleanup();
        if (connected) {
          state.databaseConnected = true;
        }
        resolve(Boolean(connected));
      };

      const handle = snapshot => {
        if (snapshot.val() === true) {
          finish(true);
        }
      };

      connectedRef.on("value", handle);
      timer = setTimeout(() => finish(false), Math.max(1000, Number(timeoutMs) || 8000));

      connectedRef.once("value").then(handle).catch(() => {});
    });
  }

  async function ensureRoomMembership() {
    if (
      !state.roomId ||
      !state.uid ||
      !state.membersRef ||
      state.leavingRoom
    ) {
      return false;
    }

    if (!(await waitForDatabaseConnection())) {
      return false;
    }

    if (!state.adminJoinOverride && await isMemberKicked()) {
      await leaveRoomLocally("你已被房主移出房間");
      return false;
    }

    const memberRef =
      state.membersRef.child(
        state.uid
      );

    let snapshot =
      await memberRef.once(
        "value"
      ).catch(() => null);

    if (
      !snapshot?.exists() ||
      snapshot.val()?.online !== true
    ) {
      const restored =
        await markMemberOnline();

      if (!restored) {
        return false;
      }

      snapshot =
        await memberRef.once(
          "value"
        ).catch(() => null);
    }

    return Boolean(snapshot?.exists());
  }

  async function getMembersOnce() {
    if (!state.membersRef) {
      return {};
    }

    try {
      const snapshot =
        await state.membersRef.once(
          "value"
        );

      return (
        snapshot.val() ||
        {}
      );
    } catch (_) {
      return {};
    }
  }

  async function enforceRoomCapacity() {
    if (
      !state.roomId ||
      !state.membersRef ||
      !state.uid ||
      state.isOwner ||
      state.adminJoinOverride
    ) {
      return true;
    }

    const roomId = String(state.roomId);
    const uid = String(state.uid);

    let maxMembers;

    try {
      const metaSnapshot =
        await db.ref(
          "roomMeta/" + roomId
        ).once("value");

      const settings =
        metaSnapshot.val()?.settings || {};

      maxMembers = Math.max(
        2,
        Math.min(
          10,
          Number(settings.maxMembers || 2)
        )
      );
    } catch (_) {
      return true;
    }

    let members;

    try {
      const memberSnapshot =
        await state.membersRef.once(
          "value"
        );

      members =
        memberSnapshot.val() || {};
    } catch (_) {
      return true;
    }

    const entries =
      Object.entries(members || {})
        .filter(
          ([memberUid, member]) =>
            Boolean(memberUid) &&
            isMemberPresenceLive(member)
        )
        .sort(
          ([uidA, memberA], [uidB, memberB]) =>
            Number(memberA?.joinedAt || 0) -
              Number(memberB?.joinedAt || 0) ||
            String(uidA).localeCompare(
              String(uidB)
            )
        );

    const ownIndex =
      entries.findIndex(
        ([memberUid]) =>
          String(memberUid) === uid
      );

    if (
      ownIndex < 0 ||
      ownIndex < maxMembers
    ) {
      return ownIndex >= 0;
    }

    try {
      await state.membersRef
        .child(uid)
        .onDisconnect()
        .cancel();
    } catch (_) {}

    try {
      await state.membersRef
        .child(uid)
        .remove();
    } catch (_) {}

    return false;
  }

  /*
   * =========================================================
   * ID PARSERS
   * =========================================================
   */

  function getYoutubeId(value) {
    if (!value) {
      return null;
    }

    const text =
      String(value).trim();

    if (
      /^[A-Za-z0-9_-]{11}$/.test(
        text
      )
    ) {
      return text;
    }

    try {
      const url =
        new URL(text);

      if (
        url.hostname.includes(
          "youtu.be"
        )
      ) {
        return (
          url.pathname
            .replace(/^\/+/, "")
            .split("/")[0] ||
          null
        );
      }

      if (
        url.hostname.includes(
          "youtube.com"
        )
      ) {
        if (
          url.pathname ===
          "/watch"
        ) {
          return (
            url.searchParams.get("v") ||
            null
          );
        }

        if (
          url.pathname.startsWith(
            "/shorts/"
          )
        ) {
          return (
            url.pathname.split("/")[2] ||
            null
          );
        }

        if (
          url.pathname.startsWith(
            "/embed/"
          )
        ) {
          return (
            url.pathname.split("/")[2] ||
            null
          );
        }
      }

      if (
        url.hostname.includes(
          "youtube-nocookie.com"
        )
      ) {
        if (
          url.pathname.startsWith(
            "/embed/"
          )
        ) {
          return (
            url.pathname.split("/")[2] ||
            null
          );
        }
      }
    } catch (_) {}

    return null;
  }


  function getVimeoId(value) {
    if (!value) {
      return null;
    }

    const text =
      String(value).trim();

    if (/^\d+$/.test(text)) {
      return text;
    }

    try {
      const url =
        new URL(text);

      if (
        url.hostname.includes("vimeo.com") ||
        url.hostname.includes("player.vimeo.com")
      ) {
        const videoMatch =
          url.pathname.match(
            /\/video\/(\d+)/i
          );

        if (videoMatch?.[1]) {
          return videoMatch[1];
        }

        const numericMatches = [
          ...url.pathname.matchAll(
            /(?:^|\/)(\d+)(?=\/|$)/g
          )
        ];

        if (numericMatches.length) {
          return numericMatches[numericMatches.length - 1][1];
        }
      }
    } catch (_) {}

    const match =
      text.match(
        /vimeo\.com\/(\d+)/
      );

    return (
      match?.[1] ||
      null
    );
  }


  function getDailymotionId(value) {
    if (!value) {
      return null;
    }

    const text =
      String(value).trim();

    try {
      const url =
        new URL(text);

      if (
        url.hostname.includes(
          "dailymotion.com"
        )
      ) {
        const match =
          url.pathname.match(
            /video\/([A-Za-z0-9]+)/
          );

        return (
          match?.[1] ||
          null
        );
      }

      if (
        url.hostname.includes("dai.ly")
      ) {
        return (
          url.pathname
            .replace(/^\/+/, "")
            .split("/")[0] ||
          null
        );
      }
    } catch (_) {}

    if (
      /^[A-Za-z0-9]+$/.test(text) &&
      text.length >= 5
    ) {
      return text;
    }

    return null;
  }


  function getBilibiliId(value) {
    if (!value) {
      return null;
    }

    const text =
      String(value).trim();

    if (
      /^BV[a-zA-Z0-9]+$/.test(text)
    ) {
      return text;
    }

    if (
      /^av\d+$/i.test(text)
    ) {
      return text;
    }

    try {
      const url =
        new URL(text);

      const bv =
        url.pathname.match(
          /(BV[a-zA-Z0-9]+)/
        );

      if (bv?.[1]) {
        return bv[1];
      }

      const av =
        url.pathname.match(
          /\/av(\d+)/i
        );

      if (av?.[1]) {
        return "av" + av[1];
      }
    } catch (_) {}

    return null;
  }


  function getTwitchValue(value) {
    if (!value) {
      return null;
    }

    const text =
      String(value).trim();

    try {
      const url =
        new URL(text);

      if (
        !url.hostname.includes(
          "twitch.tv"
        )
      ) {
        return {
          type:
            "channel",
          value:
            text
        };
      }

      const parts =
        url.pathname
          .split("/")
          .filter(Boolean);

      if (!parts.length) {
        return null;
      }

      /*
       * Twitch Clip 可能出現兩種常見網址：
       * 1. https://clips.twitch.tv/<slug>
       * 2. https://www.twitch.tv/<channel>/clip/<slug>
       *
       * 官方嵌入使用 clip slug。
       */
      if (
        url.hostname ===
          "clips.twitch.tv" &&
        parts[0]
      ) {
        return {
          type:
            "clip",
          value:
            parts[0]
        };
      }

      if (
        parts[0] === "clip" &&
        parts[1]
      ) {
        return {
          type:
            "clip",
          value:
            parts[1]
        };
      }

      if (
        parts.length >= 3 &&
        parts[1] === "clip" &&
        parts[2]
      ) {
        return {
          type:
            "clip",
          value:
            parts[2]
        };
      }

      if (parts[0] === "videos" && parts[1]) {
        return {
          type: "video",
          value: "v" + parts[1].replace(/^v/i, "")
        };
      }

      return {
        type:
          "channel",
        value:
          parts[0]
      };
    } catch (_) {}

    if (/^v?\d+$/i.test(text)) {
      return {
        type: "video",
        value: "v" + text.replace(/^v/i, "")
      };
    }

    return {
      type:
        "channel",
      value:
        text.replace(/^@/, "")
    };
  }


  /*
   * =========================================================
   * YOUTUBE SEARCH
   * =========================================================
   */

  async function searchYoutube(
    query,
    append = false
  ) {
    query =
      String(
        query || ""
      ).trim();

    if (!query) {
      throw new Error(
        "請輸入影片名稱"
      );
    }

    if (!YOUTUBE_SEARCH_PROXY_URL) {
      throw new Error(
        "YouTube 搜尋服務尚未設定，請先部署搜尋 Worker 並填入網址"
      );
    }

    if (
      append &&
      state.searchPageCount >=
        YOUTUBE_MAX_SEARCH_PAGES
    ) {
      state.searchNextPageToken =
        "";

      toast(
        "為避免濫用，單次搜尋最多載入 " +
        YOUTUBE_MAX_SEARCH_PAGES +
        " 頁"
      );

      return [];
    }

    const now =
      Date.now();

    if (
      now -
      Number(
        state.lastYoutubeSearchAt || 0
      ) <
      YOUTUBE_SEARCH_COOLDOWN_MS
    ) {
      throw new Error(
        "搜尋太頻繁，請稍候再試"
      );
    }

    const url =
      new URL(
        YOUTUBE_SEARCH_PROXY_URL
      );

    url.searchParams.set(
      "q",
      query
    );

    url.searchParams.set(
      "maxResults",
      String(
        YOUTUBE_SEARCH_PAGE_SIZE
      )
    );

    url.searchParams.set(
      "regionCode",
      "TW"
    );

    url.searchParams.set(
      "relevanceLanguage",
      "zh-Hant"
    );

    url.searchParams.set(
      "safeSearch",
      "moderate"
    );

    if (
      append &&
      state.searchNextPageToken
    ) {
      url.searchParams.set(
        "pageToken",
        state.searchNextPageToken
      );
    }

    let response = null;
    let fetchError = null;

    try {
      response = await fetch(
        url.toString(),
        {
          method: "GET",
          headers: {
            Accept: "application/json"
          },
          credentials: "omit",
          mode: "cors"
        }
      );
    } catch (error) {
      fetchError = error;
    }

    if (!response) {
      console.error(
        "YouTube 搜尋 Render 服務連線失敗:",
        fetchError
      );

      throw new Error(
        "YouTube 搜尋服務無法連線，請確認 Render 搜尋服務已部署最新版本"
      );
    }

    /*
     * 只有成功請求才啟動前端冷卻。
     * 401 認證問題不能把使用者鎖進「搜尋太頻繁」。
     */
    if (response.ok) {
      state.lastYoutubeSearchAt =
        Date.now();
    }

    if (!response.ok) {
      let message =
        "YouTube 搜尋失敗";

      try {
        const data =
          await response.json();

        message =
          data?.error?.message ||
          message;
      } catch (_) {}

      throw new Error(
        message
      );
    }

    const data =
      await response.json();

    const items =
      Array.isArray(
        data?.items
      )
        ? data.items
        : [];

    const results =
      items
        .map((item) => {
          const id =
            item?.id?.videoId;

          const snippet =
            item?.snippet ||
            {};

          if (!id) {
            return null;
          }

          return {
            id,

            platform:
              "youtube",

            title:
              snippet.title ||
              "未命名影片",

            description:
              snippet.description ||
              "",

            channel:
              snippet.channelTitle ||
              "",

            publishedAt:
              snippet.publishedAt ||
              "",

            thumbnail:
              snippet.thumbnails?.maxres?.url ||
              snippet.thumbnails?.high?.url ||
              snippet.thumbnails?.medium?.url ||
              snippet.thumbnails?.default?.url ||
              "",

            viewCount:
              Number(
                item?.viewCount ||
                0
              ),

            likeCount:
              Number(
                item?.likeCount ||
                0
              ),

            duration:
              item?.duration ||
              "",

            durationSeconds:
              Number(
                item?.durationSeconds ||
                0
              ),

            live:
              Boolean(
                snippet.liveBroadcastContent &&
                snippet.liveBroadcastContent !==
                  "none"
              )
          };
        })
        .filter(Boolean);

    state.searchPageCount =
      append
        ? Number(
            state.searchPageCount || 0
          ) + 1
        : 1;

    state.searchNextPageToken =
      state.searchPageCount <
        YOUTUBE_MAX_SEARCH_PAGES &&
      data?.nextPageToken
        ? String(
            data.nextPageToken
          )
        : "";

    if (append) {
      state.searchResults =
        state.searchResults.concat(
          results
        );
    } else {
      state.searchResults =
        results;
    }

    renderSearchResults();

    return results;
  }


  function disconnectSearchObserver() {
    const container =
      $("modalVideoSearchResults");

    if (!container) {
      return;
    }

    if (
      container.__youtubeObserver
    ) {
      try {
        container
          .__youtubeObserver
          .disconnect();
      } catch (_) {}

      container.__youtubeObserver =
        null;
    }
  }


  async function loadMoreYoutubeResults() {
    if (
      state.searchLoadingMore
    ) {
      return;
    }

    if (
      !state.searchNextPageToken
    ) {
      toast(
        "已經沒有更多結果"
      );

      return;
    }

    if (!state.searchQuery) {
      return;
    }

    state.searchLoadingMore =
      true;

    const button =
      $("youtubeLoadMoreBtn");

    if (button) {
      button.disabled =
        true;

      button.textContent =
        "載入更多中…";
    }

    try {
      await searchYoutube(
        state.searchQuery,
        true
      );
    } catch (error) {
      console.error(
        "載入更多 YouTube 失敗:",
        error
      );

      toast(
        error.message ||
        "載入更多失敗"
      );
    } finally {
      state.searchLoadingMore =
        false;

      const currentButton =
        $("youtubeLoadMoreBtn");

      if (currentButton) {
        currentButton.disabled =
          false;

        currentButton.textContent =
          state.searchNextPageToken
            ? "載入更多 YouTube 影片"
            : "已載入全部結果";
      }

      configureSearchScroll();
    }
  }


  function setupYoutubeInfiniteScroll() {
    /*
     * 不再使用捲動自動分頁，避免公開 API Key
     * 被自動連續消耗配額。
     * 使用者只能透過按鈕載入下一頁。
     */
    disconnectSearchObserver();
  }


  /*
   * =========================================================
   * SEARCH RESULT RENDER
   * =========================================================
   */

  function renderSearchResults(
    results = state.searchResults
  ) {
    const container =
      $("modalVideoSearchResults");

    if (!container) {
      return;
    }

    disconnectSearchObserver();

    state.searchResults =
      Array.isArray(results)
        ? results
        : [];

    container.dataset.selectedVideoId =
      state.modalSelectedVideoId ||
      "";

    if (
      !state.searchResults.length
    ) {
      container.innerHTML = `
        <div
          class="muted"
          style="
            grid-column:1/-1;
            width:100%;
            min-height:220px;
            display:flex;
            align-items:center;
            justify-content:center;
            text-align:center;
            padding:20px;
          "
        >
          找不到符合的影片。
        </div>
      `;

      configureSearchScroll();

      return;
    }

    container.innerHTML =
      state.searchResults
        .map((video) => {
          const selected =
            String(
              state.modalSelectedVideoId ||
              ""
            ) ===
            String(video.id);

          const durationText =
            formatDuration(
              video.durationSeconds
            );

          const selectedForPlayback =
            String(
              state.modalSelectedVideoId ||
              ""
            ) ===
            String(video.id);

          const inCurrentQueue =
            isVideoInQueue(video);

          const currentVideo =
            isCurrentVideo(video);

          const viewsText =
            formatViews(
              video.viewCount
            );

          const liveBadge =
            video.live
              ? `
                <span
                  style="
                    display:inline-flex;
                    align-items:center;
                    padding:2px 5px;
                    border-radius:5px;
                    background:#dc2626;
                    color:#fff;
                    font-size:9px;
                    font-weight:800;
                  "
                >
                  LIVE
                </span>
              `
              : "";

          return `
            <div
              class="video-result-card${
                selected
                  ? " selected"
                  : ""
              }"
              data-video-id="${escapeHtml(
                video.id
              )}"
            >

              <button
                type="button"
                class="video-result-main"
                data-video-select="${escapeHtml(
                  video.id
                )}"
              >

                <div
                  style="
                    position:relative;
                    width:100%;
                  "
                >

                  <img
                    src="${escapeHtml(
                      video.thumbnail
                    )}"
                    alt=""
                    loading="lazy"
                  >

                  ${
                    durationText
                      ? `
                        <span
                          style="
                            position:absolute;
                            right:5px;
                            bottom:5px;
                            padding:3px 6px;
                            border-radius:5px;
                            background:rgba(0,0,0,.88);
                            color:#fff;
                            font-size:10px;
                            font-weight:700;
                          "
                        >
                          ${escapeHtml(
                            durationText
                          )}
                        </span>
                      `
                      : ""
                  }

                </div>

                <span
                  class="video-result-info"
                >

                  <strong>
                    ${escapeHtml(
                      video.title
                    )}
                  </strong>

                  <small>
                    ${escapeHtml(
                      video.channel
                    )}
                  </small>

                  <small
                    style="
                      display:flex;
                      align-items:center;
                      gap:5px;
                    "
                  >

                    ${
                      viewsText
                        ? escapeHtml(
                            viewsText
                          )
                        : ""
                    }

                    ${liveBadge}

                  </small>

                </span>

              </button>

              <div
                style="
                  display:flex;
                  gap:7px;
                  padding:0 12px 12px;
                  flex-wrap:wrap;
                "
              >

                <button
                  type="button"
                  class="tiny-btn"
                  data-video-play="${escapeHtml(
                    video.id
                  )}"
                >
                  ▶ 播放
                </button>

                ${currentVideo
                  ? `
                    <button
                      type="button"
                      class="tiny-btn"
                      disabled
                      aria-disabled="true"
                      style="opacity:.55;cursor:not-allowed;"
                    >
                      ✓ 目前播放中
                    </button>
                  `
                  : selectedForPlayback
                    ? `
                      <button
                        type="button"
                        class="tiny-btn"
                        disabled
                        aria-disabled="true"
                        style="opacity:.55;cursor:not-allowed;"
                      >
                        ✓ 已選擇
                      </button>
                    `
                    : inCurrentQueue
                      ? `
                        <button
                          type="button"
                          class="tiny-btn"
                          disabled
                          aria-disabled="true"
                          style="opacity:.55;cursor:not-allowed;"
                        >
                          ✓ 已在待播放
                        </button>
                      `
                      : `
                        <button
                          type="button"
                          class="tiny-btn"
                          data-video-queue="${escapeHtml(
                            video.id
                          )}"
                        >
                          ＋ 待播放
                        </button>
                      `}

              </div>

            </div>
          `;
        })
        .join("");

    if (
      state.searchNextPageToken
    ) {
      container.insertAdjacentHTML(
        "beforeend",
        `
          <div
            id="youtubeLoadMore"
            style="
              grid-column:1/-1;
              width:100%;
              padding:18px 4px 24px;
            "
          >

            <button
              type="button"
              class="secondary-btn"
              id="youtubeLoadMoreBtn"
              style="
                width:100%;
              "
            >
              載入更多 YouTube 影片
            </button>

            <div
              class="muted"
              style="
                margin-top:8px;
                text-align:center;
                font-size:11px;
              "
            >
              單次搜尋最多載入 2 頁，請按按鈕載入下一頁。
            </div>

          </div>
        `
      );
    } else {
      container.insertAdjacentHTML(
        "beforeend",
        `
          <div
            style="
              grid-column:1/-1;
              width:100%;
              padding:20px 8px 28px;
              text-align:center;
              color:#71717a;
              font-size:11px;
            "
          >
            已經載入全部搜尋結果
          </div>
        `
      );
    }

    container
      .querySelectorAll(
        "[data-video-select]"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          () => {
            selectSearchVideo(
              button.dataset
                .videoSelect
            );
          }
        );
      });

    container
      .querySelectorAll(
        "[data-video-play]"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const video =
              state.searchResults.find(
                (item) =>
                  String(item.id) ===
                  String(
                    button.dataset
                      .videoPlay
                  )
              );

            if (!video) {
              return;
            }

            try {
              await changeVideo({
                ...video,
                platform:
                  "youtube"
              });
            } catch (error) {
              console.error(
                error
              );

              setError(
                $("modalError"),
                error.message ||
                  "播放影片失敗"
              );
            }
          }
        );
      });

    container
      .querySelectorAll(
        "[data-video-queue]"
      )
      .forEach((button) => {
        button.addEventListener(
          "click",
          async (event) => {
            event.preventDefault();
            event.stopPropagation();

            const video =
              state.searchResults.find(
                (item) =>
                  String(item.id) ===
                  String(
                    button.dataset
                      .videoQueue
                  )
              );

            if (!video) {
              return;
            }

            try {
              await addToQueue({
                ...video,
                platform:
                  "youtube"
              });

              toast(
                "已加入待播放清單"
              );
            } catch (error) {
              console.error(
                error
              );

              setError(
                $("modalError"),
                error.message ||
                  "加入待播放失敗"
              );
            }
          }
        );
      });

    const moreButton =
      $("youtubeLoadMoreBtn");

    moreButton?.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        void loadMoreYoutubeResults();
      }
    );

    configureSearchScroll();

    setupYoutubeInfiniteScroll();
  }


  function selectSearchVideo(id) {
    const video =
      state.searchResults.find(
        (item) =>
          String(item.id) ===
          String(id)
      );

    if (!video) {
      return;
    }

    state.modalSelectedVideo = {
      ...video,
      platform:
        "youtube"
    };

    state.modalSelectedVideoId =
      String(id);

    const container =
      $("modalVideoSearchResults");

    if (container) {
      container.dataset.selectedVideoId =
        String(id);

      container
        .querySelectorAll(
          "[data-video-id]"
        )
        .forEach((item) => {
          item.classList.toggle(
            "selected",
            String(
              item.dataset.videoId
            ) ===
            String(id)
          );
        });
    }

    const saveButton =
      $("saveSourceBtn");

    if (saveButton) {
      saveButton.disabled =
        false;

      saveButton.textContent =
        "播放這部影片";
    }

    setError(
      $("modalError"),
      ""
    );

    toast(
      "已選擇影片"
    );
  }


  function getSelectedModalYoutubeVideo() {
    const container =
      $("modalVideoSearchResults");

    const storedId =
      String(
        container?.dataset
          ?.selectedVideoId ||
        state.modalSelectedVideoId ||
        ""
      ).trim();

    if (!storedId) {
      return null;
    }

    const video =
      state.searchResults.find(
        (item) =>
          String(item.id) ===
          storedId
      );

    if (!video) {
      return null;
    }

    return {
      ...video,
      platform:
        "youtube"
    };
  }


  /*
   * =========================================================
   * VIDEO OBJECT
   * =========================================================
   */

  function createVideoObject(
    platform,
    rawValue,
    title = ""
  ) {
    if (!rawValue) {
      return null;
    }

    if (platform === "youtube") {
      const id =
        getYoutubeId(rawValue);

      if (!id) {
        return null;
      }

      return {
        id,
        platform,
        title:
          title ||
          "YouTube 影片",
        thumbnail:
          `https://i.ytimg.com/vi/${encodeURIComponent(
            id
          )}/hqdefault.jpg`,
        channel:
          "YouTube"
      };
    }

    if (platform === "vimeo") {
      const id =
        getVimeoId(rawValue);

      if (!id) {
        return null;
      }

      return {
        id,
        url:
          String(rawValue),
        platform,
        title:
          title ||
          "Vimeo 影片",
        thumbnail:
          "",
        channel:
          "Vimeo"
      };
    }

    if (platform === "dailymotion") {
      const id =
        getDailymotionId(rawValue);

      if (!id) {
        return null;
      }

      return {
        id,
        url:
          String(rawValue),
        platform,
        title:
          title ||
          "Dailymotion 影片",
        thumbnail:
          "",
        channel:
          "Dailymotion"
      };
    }

    if (platform === "bilibili") {
      const id =
        getBilibiliId(rawValue);

      if (!id) {
        return null;
      }

      return {
        id,
        url:
          String(rawValue),
        platform,
        title:
          title ||
          "Bilibili 影片",
        thumbnail:
          "",
        channel:
          "Bilibili"
      };
    }

    if (platform === "twitch") {
      const value =
        getTwitchValue(rawValue);

      if (!value) {
        return null;
      }

      return {
        id:
          value.value,
        twitchType:
          value.type,
        url:
          String(rawValue),
        platform,
        title:
          title ||
          "Twitch",
        thumbnail:
          "",
        channel:
          "Twitch"
      };
    }

    return {
      id:
        String(rawValue),

      url:
        String(rawValue),

      platform,

      title:
        title ||
        PLATFORMS[platform]?.name ||
        platform,

      thumbnail:
        "",

      channel:
        PLATFORMS[platform]?.name ||
        platform
    };
  }


  /*
   * =========================================================
   * QUEUE
   * =========================================================
   */

  function normalizeVideoIdentity(video) {
    if (!video) return null;

    const platform = String(video.platform || "youtube").trim().toLowerCase();
    let id = String(video.id || video.url || "").trim();

    if (!id) return null;

    if (platform === "youtube") {
      try {
        const parsed = getYoutubeId(id);
        if (parsed) id = parsed;
      } catch (_) {}
    }

    return {platform,id};
  }

  function isSameVideo(a, b) {
    const left = normalizeVideoIdentity(a);
    const right = normalizeVideoIdentity(b);
    if (!left || !right) return false;
    return left.platform === right.platform && left.id === right.id;
  }

  function isCurrentVideo(video) {
    return Boolean(state.room?.video && isSameVideo(state.room.video, video));
  }

  function isVideoInQueue(video) {
    return Object.values(state.queue || {}).some(function(item) {
      return isSameVideo(item, video);
    });
  }

  async function removeQueuedCopiesOfVideo(video) {
    if (!state.queueRef || !video) return;

    const matches = Object.entries(state.queue || {}).filter(function(entry) {
      return isSameVideo(entry[1], video);
    });

    if (!matches.length) return;

    await Promise.all(matches.map(async function(entry) {
      try {
        await state.queueRef.child(entry[0]).remove();
      } catch (error) {
        console.warn("移除目前影片的待播放重複項失敗:", error);
      }
    }));

    matches.forEach(function(entry) {
      delete state.queue[entry[0]];
    });

    renderQueue();
  }

  async function addToQueue(video) {
    if (!state.queueRef || !state.uid) {
      throw new Error("目前不在房間內");
    }

    if (!video?.id) {
      throw new Error("無效的影片");
    }

    if (isCurrentVideo(video)) {
      throw new Error("這部影片目前正在播放，不能加入待播放清單");
    }

    if (isVideoInQueue(video)) {
      throw new Error("這部影片已經在待播放清單");
    }

    const item = {
      id: String(video.id),
      platform: video.platform || "youtube",
      title: video.title || "未命名影片",
      thumbnail: video.thumbnail || "",
      channel: video.channel || "YouTube",
      addedBy: state.uid,
      addedByName: state.memberName,
      addedAt: firebase.database.ServerValue.TIMESTAMP
    };

    if (video.url) item.url = String(video.url);
    if (video.twitchType) item.twitchType = video.twitchType;

    const newRef = await state.queueRef.push(item);

    if (newRef?.key) {
      state.queue[newRef.key] = {...item,addedAt:Date.now()};
      renderQueue();
      renderSearchResults();
    }
  }

  async function removeFromQueue(queueId) {
    if (
      !state.queueRef ||
      !queueId
    ) {
      return;
    }

    await state.queueRef
      .child(queueId)
      .remove();

    toast(
      "已從待播放清單移除"
    );
  }


  async function playQueueItem(queueId) {
    cancelScheduledQueuePlayback();

    if (!state.isOwner) {
      throw new Error("只有房主可以播放待播放清單");
    }

    if (!state.uid || !state.roomId) {
      throw new Error("目前不在房間內");
    }

    const item =
      state.queue?.[queueId];

    if (!item) {
      throw new Error(
        "找不到待播放影片"
      );
    }

    const video = {
      id:
        item.id,

      platform:
        item.platform ||
        "youtube",

      title:
        item.title,

      thumbnail:
        item.thumbnail,

      channel:
        item.channel
    };

    if (item.url) {
      video.url =
        item.url;
    }

    if (item.twitchType) {
      video.twitchType =
        item.twitchType;
    }

    await changeVideo(
      video
    );

    if (
      state.queueRef &&
      (
        state.isOwner ||
        String(item.addedBy || "") ===
          String(state.uid || "")
      )
    ) {
      await state.queueRef
        .child(queueId)
        .remove();
    }
  }


  function getSortedQueue() {
    return Object.entries(
      state.queue || {}
    )
      .map(
        ([id, item]) => ({
          ...item,
          queueId:
            id
        })
      )
      .sort(
        (a, b) =>
          Number(
            a.addedAt || 0
          ) -
          Number(
            b.addedAt || 0
          )
      );
  }


  function renderQueue() {
    const container =
      $("queueList");

    if (!container) {
      return;
    }

    const list =
      getSortedQueue().filter(function(item) {
        return !isCurrentVideo(item);
      });

    if (!list.length) {
      container.innerHTML = `
        <div
          class="muted"
          style="
            padding:8px 0;
            text-align:center;
          "
        >
          待播放清單是空的。
        </div>
      `;

      return;
    }

    container.innerHTML =
      list
        .map(
          (
            item,
            index
          ) => `
            <div
              class="queue-item"
              data-queue-id="${escapeHtml(
                item.queueId
              )}"
            >

              <div
                style="
                  display:flex;
                  align-items:center;
                  gap:10px;
                  min-width:0;
                "
              >

                <div
                  style="
                    width:28px;
                    flex:0 0 28px;
                    text-align:center;
                    font-weight:800;
                    color:#93c5fd;
                  "
                >
                  ${index + 1}
                </div>

                ${
                  item.thumbnail
                    ? `
                      <img
                        src="${escapeHtml(
                          item.thumbnail
                        )}"
                        alt=""
                        style="
                          width:72px;
                          height:40px;
                          object-fit:cover;
                          border-radius:7px;
                        "
                      >
                    `
                    : ""
                }

                <div
                  style="
                    min-width:0;
                    flex:1;
                  "
                >

                  <div
                    style="
                      overflow:hidden;
                      text-overflow:ellipsis;
                      white-space:nowrap;
                      font-size:13px;
                      font-weight:700;
                    "
                  >
                    ${escapeHtml(
                      item.title ||
                      "未命名影片"
                    )}
                  </div>

                  <div
                    class="muted"
                    style="
                      margin-top:3px;
                      font-size:10px;
                    "
                  >
                    ${escapeHtml(
                      item.addedByName ||
                      "玩家"
                    )}
                  </div>

                </div>

              </div>

              <div
                style="
                  display:flex;
                  gap:6px;
                  margin-top:8px;
                "
              >

                ${state.isOwner ? `
                  <button
                    type="button"
                    class="tiny-btn"
                    data-queue-play="${item.queueId}"
                  >
                    ▶ 播放
                  </button>
                ` : ""}

                ${
                  state.isOwner || String(item.addedBy || "") === String(state.uid || "")
                    ? `<button
                        type="button"
                        class="tiny-btn"
                        data-queue-remove="${escapeHtml(item.queueId)}"
                      >
                        移除
                      </button>`
                    : ""
                }

              </div>

            </div>
          `
        )
        .join("");

    container
      .querySelectorAll(
        "[data-queue-play]"
      )
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            async () => {
              try {
                await playQueueItem(
                  button.dataset
                    .queuePlay
                );
              } catch (error) {
                console.error(
                  error
                );

                toast(
                  error.message ||
                  "播放失敗"
                );
              }
            }
          );
        }
      );

    container
      .querySelectorAll(
        "[data-queue-remove]"
      )
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            async () => {
              try {
                await removeFromQueue(
                  button.dataset
                    .queueRemove
                );
              } catch (error) {
                console.error(
                  error
                );

                toast(
                  "移除失敗"
                );
              }
            }
          );
        }
      );
  }


  function cancelScheduledQueuePlayback() {
    clearTimeout(state.queueNextTimer);
    state.queueNextTimer = null;
  }

  async function playNextQueueItem() {
    cancelScheduledQueuePlayback();

    if (!state.isOwner) {
      return false;
    }

    const list =
      getSortedQueue();

    if (!list.length) {
      return false;
    }

    try {
      await playQueueItem(
        list[0].queueId
      );

      return true;
    } catch (error) {
      console.error(
        "播放下一部失敗:",
        error
      );

      return false;
    }
  }


  /*
   * =========================================================
   * PLAYER VISIBILITY
   * =========================================================
   */

  function hidePlayers() {
    [
      "vimeoPlayer",
      "dailymotionPlayer",
      "bilibiliPlayer",
      "twitchPlayer",
      "directVideo",
      "youtubePlayer",
      "emptyPlayer",
      "platformPlayerNotice"
    ].forEach(
      (id) => {
        $(id)?.classList.add(
          "hidden"
        );
      }
    );
  }


  function showPlayerElement(id) {
    $(id)?.classList.remove(
      "hidden"
    );
  }


  function forceDirectVideoVisible() {
    const element =
      $("directVideo");

    if (!element) {
      return;
    }

    element.classList.remove(
      "hidden"
    );

    element.style.display =
      "block";

    element.style.visibility =
      "visible";

    element.style.opacity =
      "1";

    element.style.width =
      "100%";

    element.style.height =
      "100%";

    element.style.position =
      "relative";

    element.style.zIndex =
      "3";
  }

  function forceYoutubePlayerVisible() {
    if (state.youtubePlaybackMode === "iframe") {
      const element = $("youtubePlayer");
      if (!element) {
        return;
      }

      element.classList.remove("hidden");
      element.style.display = "block";
      element.style.visibility = "visible";
      element.style.opacity = "1";
      element.style.width = "100%";
      element.style.height = "100%";
      element.style.position = "relative";
      element.style.zIndex = "3";

      const direct = $("directVideo");
      direct?.classList.add("hidden");
      return;
    }

    forceDirectVideoVisible();
  }

  function detachYoutubeNativeEvents() {
    const element = state.youtubeNativeVideoElement;
    const handlers = state.youtubeNativeEventHandlers;

    if (!element || !handlers) {
      state.youtubeNativeListenersAttached = false;
      state.youtubeNativeVideoElement = null;
      state.youtubeNativeEventHandlers = null;
      return;
    }

    for (const [eventName, handler] of Object.entries(handlers)) {
      try {
        element.removeEventListener(eventName, handler);
      } catch (_) {}
    }

    state.youtubeNativeListenersAttached = false;
    state.youtubeNativeVideoElement = null;
    state.youtubeNativeEventHandlers = null;
    state.youtubeNativeSuppressEvent = "";
    state.youtubeNativeSuppressUntil = 0;
  }

  function markYoutubeNativeUserGesture(kind = "") {
    if (state.playerType !== "youtube") {
      return;
    }

    markLocalPlaybackIntent(kind);
    state.playbackUserActionUntil =
      Date.now() + 1400;
  }

  function suppressYoutubeNativeEvent(
    kind,
    durationMs = 300
  ) {
    state.youtubeNativeSuppressEvent =
      String(kind || "");

    state.youtubeNativeSuppressUntil =
      Date.now() +
      Math.max(
        0,
        Number(durationMs) || 0
      );
  }

  function nativeYoutubeGuestActionAllowed(
    kind = ""
  ) {
    if (
      state.isOwner ||
      !state.playerReady ||
      !state.player ||
      state.playerType !== "youtube" ||
      state.playbackApplyingRemote
    ) {
      return false;
    }

    const now = Date.now();
    if (String(state.youtubeNativeSuppressEvent || "") === String(kind || "") && now < Number(state.youtubeNativeSuppressUntil || 0)) return false;
    if (now > Number(state.playbackUserActionUntil || 0)) return false;
    if (now < Number(state.playbackLocalControlUntil || 0)) return false;
    if (now < Number(state.playbackLocalSeekSuppressUntil || 0)) return false;
    return true;
  }

  function nativeYoutubeActionAllowed(
    kind = ""
  ) {
    if (
      !state.isOwner ||
      !state.playerReady ||
      !state.player ||
      state.playerType !== "youtube" ||
      state.playbackApplyingRemote
    ) {
      return false;
    }

    const now =
      Date.now();

    if (
      String(state.youtubeNativeSuppressEvent || "") ===
        String(kind || "") &&
      now <
        Number(
          state.youtubeNativeSuppressUntil || 0
        )
    ) {
      return false;
    }

    if (
      now >
      Number(
        state.playbackUserActionUntil || 0
      )
    ) {
      return false;
    }

    if (
      Number(state.playbackIgnoreStateChanges || 0) > 0 &&
      now <
        Number(
          state.playbackIgnoreStateUntil || 0
        )
    ) {
      return false;
    }

    if (
      now <
        Number(
          state.playbackLocalControlUntil || 0
        )
    ) {
      return false;
    }

    if (
      now <
        Number(
          state.playbackLocalSeekSuppressUntil || 0
        )
    ) {
      return false;
    }

    if (
      now <
        Number(
          state.playbackAdGuardUntil || 0
        )
    ) {
      return false;
    }

    return true;
  }

  async function refreshYoutubeStreamIfNeeded(reason = "") {
    const videoElement =
      $("directVideo");

    if (
      state.playerType !== "youtube" ||
      state.youtubePlaybackMode === "iframe" ||
      !state.player ||
      !videoElement ||
      !state.currentVideoId ||
      state.youtubeStreamRefreshInFlight
    ) {
      return false;
    }

    const now =
      Date.now();

    if (
      now -
        Number(
          state.youtubeStreamRefreshWindowStartedAt || 0
        ) >
      60000
    ) {
      state.youtubeStreamRefreshWindowStartedAt = now;
      state.youtubeStreamRefreshAttempts = 0;
    }

    if (
      Number(
        state.youtubeStreamRefreshAttempts || 0
      ) >= 2
    ) {
      return false;
    }

    const player =
      state.player;

    const videoId =
      String(
        state.currentVideoId || ""
      );

    const buildToken =
      Number(
        state.youtubeBuildToken || 0
      );

    const target =
      Math.max(
        0,
        Number(
          videoElement.currentTime || 0
        )
      );

    const wasPlaying =
      !videoElement.paused &&
      !videoElement.ended;

    const muted =
      Boolean(
        videoElement.muted
      );

    state.youtubeStreamRefreshAttempts =
      Number(
        state.youtubeStreamRefreshAttempts || 0
      ) + 1;

    state.youtubeStreamRefreshInFlight =
      true;

    state.playbackApplyingRemote =
      true;

    state.playbackTransientStateUntil =
      now + 1000;

    try {
      const streamUrl =
        YOUTUBE_STREAM_PROXY_URL +
        "/stream?v=" +
        encodeURIComponent(videoId) +
        "&refresh=" +
        String(now);

      if ($("syncStatus")) {
        $("syncStatus").textContent =
          "YouTube 串流重新連線中…";
      }

      await new Promise((resolve, reject) => {
        let settled = false;

        const finish = (
          error = null
        ) => {
          if (settled) return;
          settled = true;
          videoElement.removeEventListener(
            "loadedmetadata",
            onLoaded
          );
          videoElement.removeEventListener(
            "error",
            onError
          );
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve();
        };

        const onLoaded = async () => {
          try {
            if (
              state.youtubeBuildToken !== buildToken ||
              state.player !== player ||
              state.playerType !== "youtube"
            ) {
              finish();
              return;
            }

            videoElement.currentTime =
              Number.isFinite(
                videoElement.duration
              )
                ? Math.min(
                    target,
                    Math.max(
                      0,
                      Number(videoElement.duration) || 0
                    )
                  )
                : target;

            videoElement.muted =
              muted;

            if (wasPlaying) {
              await videoElement.play();
            } else {
              videoElement.pause();
            }

            finish();
          } catch (error) {
            finish(error);
          }
        };

        const onError = () => {
          finish(
            new Error(
              "YouTube 串流重新連線失敗"
            )
          );
        };

        const timeout =
          setTimeout(
            () => finish(
              new Error(
                "YouTube 串流重新連線逾時"
              )
            ),
            15000
          );

        videoElement.addEventListener(
          "loadedmetadata",
          onLoaded,
          {once:true}
        );

        videoElement.addEventListener(
          "error",
          onError,
          {once:true}
        );

        try {
          videoElement.pause();
          videoElement.src =
            streamUrl;
          videoElement.load();
        } catch (error) {
          finish(error);
        }
      });

      if ($("syncStatus")) {
        $("syncStatus").textContent =
          "YouTube 串流已重新連線";
      }

      state.playbackReadyAt =
        Date.now() + 500;

      state.playbackResumeRecoveryUntil =
        Math.max(
          Number(
            state.playbackResumeRecoveryUntil || 0
          ),
          Date.now() + 1200
        );

      return true;
    } catch (error) {
      console.warn(
        "YouTube 串流重新連線失敗:",
        reason,
        error
      );

      if ($("syncStatus")) {
        $("syncStatus").textContent =
          "YouTube 串流連線失敗";
      }

      return false;
    } finally {
      state.playbackApplyingRemote =
        false;

      state.youtubeStreamRefreshInFlight =
        false;
    }
  }

  function attachYoutubeNativeEvents(videoElement) {
    if (!videoElement) {
      return;
    }

    if (
      state.youtubeNativeListenersAttached &&
      state.youtubeNativeVideoElement === videoElement
    ) {
      return;
    }

    detachYoutubeNativeEvents();

    const handlers = {
      pointerdown: () => {
        markYoutubeNativeUserGesture("control");
      },

      mousedown: () => {
        markYoutubeNativeUserGesture("control");
      },

      touchstart: () => {
        markYoutubeNativeUserGesture("control");
      },

      keydown: (event) => {
        if (
          [
            " ",
            "Spacebar",
            "ArrowLeft",
            "ArrowRight",
            "Home",
            "End"
          ].includes(event.key)
        ) {
          markYoutubeNativeUserGesture("control");
        }
      },

      play: () => {
        if (
          state.playerType !== "youtube" ||
          !state.player ||
          state.youtubeNativeVideoElement !== videoElement
        ) {
          return;
        }

        state.playbackIsBuffering = false;
        state.playbackTransientStateUntil = 0;
        state.playbackLastPlayerState = "playing";
        state.playbackLastObservedPosition =
          Number(videoElement.currentTime) || 0;

        if (!state.isOwner && nativeYoutubeGuestActionAllowed("play")) {
          void requestPlaybackControl("play", Number(videoElement.currentTime) || 0, true);
        }

        if (nativeYoutubeActionAllowed("play")) {
          state.playbackAwaitingActualStart = false;
          clearTimeout(
            state.playbackActualStartTimer
          );
          state.playbackActualStartTimer = null;

          void (async () => {
            try {
              const position =
                await asyncCurrentPosition();

              publishPlaybackEvent(
                "play",
                position,
                true,
                playbackClockNow()
              );

              await reconcileRoomTimeline();
            } catch (error) {
              console.warn(
                "原生影片播放同步失敗:",
                error
              );
            }
          })();
        }

        updateTimeUI();
      },

      playing: () => {
        if (
          state.playerType !== "youtube" ||
          state.youtubeNativeVideoElement !== videoElement
        ) {
          return;
        }

        state.playbackIsBuffering = false;
        state.playbackTransientStateUntil = 0;
        state.playbackLastPlayerState = "playing";
        state.playbackLastObservedPosition =
          Number(videoElement.currentTime) || 0;

        updateTimeUI();
      },

      pause: () => {
        if (
          state.playerType !== "youtube" ||
          !state.player ||
          state.youtubeNativeVideoElement !== videoElement
        ) {
          return;
        }

        state.playbackIsBuffering = false;
        state.playbackTransientStateUntil = 0;
        state.playbackLastPlayerState = "paused";
        state.playbackLastObservedPosition =
          Number(videoElement.currentTime) || 0;

        if (!state.isOwner && nativeYoutubeGuestActionAllowed("pause")) {
          void requestPlaybackControl("pause", Number(videoElement.currentTime) || 0, false);
        }

        if (nativeYoutubeActionAllowed("pause")) {
          const position =
            Number(videoElement.currentTime) || 0;

          const issuedAt =
            playbackClockNow();

          const effectiveAt =
            issuedAt +
            getControlLeadMs();

          publishPlaybackEvent(
            "pause",
            position,
            false,
            issuedAt,
            effectiveAt
          );
        }

        updateTimeUI();
      },

      seeking: () => {
        if (
          state.playerType !== "youtube" ||
          state.youtubeNativeVideoElement !== videoElement
        ) {
          return;
        }

        state.playbackLastPlayerState =
          videoElement.paused
            ? "paused"
            : "playing";

        state.playbackLastObservedPosition =
          Number(videoElement.currentTime) || 0;

        updateTimeUI();
      },

      seeked: () => {
        if (
          state.playerType !== "youtube" ||
          !state.player ||
          state.youtubeNativeVideoElement !== videoElement
        ) {
          return;
        }

        state.playbackLastPlayerState =
          videoElement.paused
            ? "paused"
            : "playing";

        state.playbackLastObservedPosition =
          Number(videoElement.currentTime) || 0;

        if (!state.isOwner && nativeYoutubeGuestActionAllowed("seek")) {
          void requestPlaybackControl(
            "seek",
            Number(videoElement.currentTime) || 0,
            !videoElement.paused && !videoElement.ended
          );
        }

        if (nativeYoutubeActionAllowed("seek")) {
          void (async () => {
            try {
              const position =
                await asyncCurrentPosition();

              const playing =
                !videoElement.paused &&
                !videoElement.ended;

              publishPlaybackEvent(
                "seek",
                position,
                playing,
                playbackClockNow()
              );

              await reconcileRoomTimeline();
            } catch (error) {
              console.warn(
                "原生影片跳轉同步失敗:",
                error
              );
            }
          })();
        }

        updateTimeUI();
      },

      waiting: () => {
        if (
          state.playerType !== "youtube" ||
          state.youtubeNativeVideoElement !== videoElement
        ) {
          return;
        }

        state.playbackIsBuffering = true;
        state.playbackTransientStateUntil = 0;
        state.playbackLastPlayerState = "buffering";
        state.playbackLastObservedPosition =
          Number(videoElement.currentTime) || 0;

        updateTimeUI();
      },

      ended: () => {
        if (
          state.playerType !== "youtube" ||
          state.youtubeNativeVideoElement !== videoElement
        ) {
          return;
        }

        state.playbackIsBuffering = false;
        state.playbackTransientStateUntil = 0;
        state.playbackLastPlayerState = "ended";
        state.playbackLastObservedPosition =
          Number(videoElement.currentTime) || 0;

        updateTimeUI();

        if (
          state.isOwner &&
          !state.playbackApplyingRemote
        ) {
          cancelScheduledQueuePlayback();

          const roomIdAtEnd =
            String(state.roomId || "");
          const playerAtEnd =
            state.player;
          const videoIdAtEnd =
            String(state.currentVideoId || "");

          state.queueNextTimer =
            setTimeout(
              async () => {
                state.queueNextTimer = null;

                if (
                  String(state.roomId || "") !== roomIdAtEnd ||
                  state.player !== playerAtEnd ||
                  String(state.currentVideoId || "") !== videoIdAtEnd ||
                  !state.isOwner ||
                  state.leavingRoom
                ) {
                  return;
                }

                await playNextQueueItem();
              },
              300
            );
        }
      },

      error: () => {
        if (
          state.youtubeNativeVideoElement !== videoElement
        ) {
          return;
        }

        state.playbackIsBuffering = false;
        state.playbackLastPlayerState = "error";

        console.error(
          "原生 YouTube 影片錯誤:",
          videoElement.error
        );

        void refreshYoutubeStreamIfNeeded("media-error")
          .then((refreshed) => {
            if (refreshed) {
              updateTimeUI();
              return;
            }

            if ($("syncStatus")) {
              $("syncStatus").textContent =
                "YouTube 串流播放錯誤";
            }

            const code =
              Number(
                videoElement.error?.code || 0
              );

            if (code === 2) {
              toast("YouTube 串流網址無效");
            } else if (code === 3) {
              toast("YouTube 影片解碼失敗");
            } else if (code === 4) {
              toast(
                "這支 YouTube 影片無法由目前的串流代理播放"
              );
            } else {
              toast("YouTube 串流播放失敗");
            }

            updateTimeUI();
          });
      },

      stalled: () => {
        if (
          state.youtubeNativeVideoElement !== videoElement
        ) {
          return;
        }

        clearTimeout(
          state.youtubeStreamStallTimer
        );

        state.youtubeStreamStallTimer =
          setTimeout(
            () => {
              state.youtubeStreamStallTimer = null;

              if (
                state.playerType !== "youtube" ||
                state.youtubeNativeVideoElement !== videoElement
              ) {
                return;
              }

              if (
                videoElement.readyState < 3 &&
                !videoElement.ended
              ) {
                void refreshYoutubeStreamIfNeeded(
                  "media-stalled"
                );
              }
            },
            3500
          );
      }
    };

    for (
      const [eventName, handler] of
      Object.entries(handlers)
    ) {
      const capture =
        eventName === "pointerdown" ||
        eventName === "mousedown" ||
        eventName === "touchstart" ||
        eventName === "keydown";

      videoElement.addEventListener(
        eventName,
        handler,
        capture
      );
    }

    state.youtubeNativeListenersAttached = true;
    state.youtubeNativeVideoElement = videoElement;
    state.youtubeNativeEventHandlers = handlers;
  }

  function createYoutubeNativePlayer(
    videoElement,
    videoId
  ) {
    const element =
      videoElement;

    return {
      getCurrentTime() {
        return (
          Number(
            element.currentTime
          ) || 0
        );
      },

      getDuration() {
        return (
          Number(
            element.duration
          ) || 0
        );
      },

      getPlayerState() {
        if (element.ended) {
          return 0;
        }

        return element.paused
          ? 2
          : 1;
      },

      getAvailablePlaybackRates() {
        return [
          0.5,
          0.75,
          0.9,
          0.95,
          0.975,
          0.99,
          1,
          1.01,
          1.025,
          1.05,
          1.1,
          1.25,
          1.5,
          1.75,
          2
        ];
      },

      setPlaybackRate(rate) {
        const value =
          Number(rate);

        if (
          !Number.isFinite(value) ||
          value <= 0
        ) {
          return;
        }

        element.playbackRate =
          value;
      },

      seekTo(seconds) {
        const target =
          Math.max(
            0,
            Number(seconds) || 0
          );

        if (
          Number.isFinite(
            element.duration
          )
        ) {
          element.currentTime =
            Math.min(
              target,
              element.duration
            );
        } else {
          element.currentTime =
            target;
        }

        return target;
      },

      async playVideo() {
        try {
          await element.play();
          return true;
        } catch (_) {
          return false;
        }
      },

      pauseVideo() {
        try {
          element.pause();
        } catch (_) {}
      },

      mute() {
        element.muted =
          true;
      },

      unMute() {
        element.muted =
          false;
      },

      setVolume(value) {
        const normalized =
          Math.max(
            0,
            Math.min(
              100,
              Number(value)
            )
          );

        if (
          Number.isFinite(
            normalized
          )
        ) {
          element.volume =
            normalized / 100;

          if (normalized > 0) {
            element.muted =
              false;
          }
        }
      },

      destroy() {
        try {
          element.pause();
        } catch (_) {}

        try {
          element.removeAttribute("src");
          element.load();
        } catch (_) {}

        return Promise.resolve();
      },

      getVideoData() {
        return {
          video_id:
            videoId
        };
      }
    };
  }


  /*
   * =========================================================
   * PLAYER DESTROY
   * =========================================================
   */

  async function destroyCurrentPlayer() {
    const old =
      state.player;

    const oldType =
      state.playerType;

    if (oldType === "youtube") {
      detachYoutubeNativeEvents();
    }

    state.player =
      null;

    state.playerReady =
      false;

    state.playerType =
      null;

    state.currentVideoId =
      null;

    state.currentVideoUrl =
      null;

    state.twitchPlaybackKind = null;

    state.youtubePlaybackMode = "iframe";
    state.youtubeIframeInitialSyncUntil = 0;

    if (!old) {
      clearTimeout(state.youtubeStreamStallTimer);
      state.youtubeStreamStallTimer = null;
      state.youtubeStreamRefreshInFlight = false;
      state.youtubeStreamRefreshAttempts = 0;
      state.youtubeStreamRefreshWindowStartedAt = 0;
      return;
    }

    clearTimeout(state.youtubeStreamStallTimer);
    state.youtubeStreamStallTimer = null;
    state.youtubeStreamRefreshInFlight = false;
    state.youtubeStreamRefreshAttempts = 0;
    state.youtubeStreamRefreshWindowStartedAt = 0;

    try {
      if (
        oldType ===
        "youtube"
      ) {
        old.destroy?.();
      }

      if (
        oldType ===
        "vimeo"
      ) {
        await old.destroy?.();
      }

      if (
        oldType ===
        "dailymotion"
      ) {
        await old.destroy?.();
      }

      if (
        oldType ===
        "twitch"
      ) {
        await old.destroy?.();
      }

      if (
        oldType === "bilibili" ||
        oldType === "dailymotion-iframe" ||
        oldType === "twitch-clip"
      ) {
        try {
          old.src = "about:blank";
        } catch (_) {}

        try {
          if (old.contentWindow) {
            old.contentWindow.location.replace("about:blank");
          }
        } catch (_) {}
      }
    } catch (_) {}
  }


  /*
   * =========================================================
   * LOCAL PLAYER STATE
   * =========================================================
   *
   * 完全不使用 rooms/{room}/state。
   * 每個人自己控制自己的播放。
   */

  async function currentPosition() {
    return asyncCurrentPosition();
  }


  async function asyncCurrentPosition() {
    const player =
      state.player;

    const type =
      state.playerType;

    if (
      !state.playerReady ||
      !player
    ) {
      return 0;
    }

    try {
      if (type === "youtube") {
        return (
          Number(
            player.getCurrentTime()
          ) || 0
        );
      }

      if (type === "vimeo") {
        return (
          Number(
            await player.getCurrentTime()
          ) || 0
        );
      }

      if (type === "dailymotion") {
        if (typeof player.getState === "function") {
          const playerState = await player.getState();
          return Number(playerState?.videoTime) || 0;
        }
        if (typeof player.currentTime === "function") {
          return Number(await player.currentTime()) || 0;
        }
        return Number(player.currentTime) || 0;
      }

      if (type === "twitch") {
        return (
          Number(
            player.getCurrentTime()
          ) || 0
        );
      }
    } catch (_) {}

    return 0;
  }


  function duration() {
    const player =
      state.player;

    if (
      !state.playerReady ||
      !player
    ) {
      return 0;
    }

    try {
      if (
        state.playerType ===
        "youtube"
      ) {
        return (
          Number(
            player.getDuration()
          ) || 0
        );
      }
    } catch (_) {}

    return 0;
  }


  async function asyncDuration() {
    const player =
      state.player;

    const type =
      state.playerType;

    if (
      !state.playerReady ||
      !player
    ) {
      return 0;
    }

    try {
      if (type === "youtube") {
        return (
          Number(
            player.getDuration()
          ) || 0
        );
      }

      if (type === "vimeo") {
        return (
          Number(
            await player.getDuration()
          ) || 0
        );
      }

      if (type === "dailymotion") {
        if (typeof player.getState === "function") {
          const playerState = await player.getState();
          return Number(playerState?.videoDuration) || 0;
        }
        if (typeof player.duration === "function") {
          return Number(await player.duration()) || 0;
        }
        return Number(player.duration) || 0;
      }

      if (type === "twitch") {
        return (
          Number(
            player.getDuration()
          ) || 0
        );
      }
    } catch (_) {}

    return 0;
  }


  async function asyncIsPlaying() {
    const player =
      state.player;

    const type =
      state.playerType;

    if (
      !state.playerReady ||
      !player
    ) {
      return false;
    }

    try {
      if (type === "youtube") {
        return (
          Number(
            player.getPlayerState()
          ) === 1
        );
      }

      if (type === "vimeo") {
        return !(
          await player.getPaused()
        );
      }

      if (type === "dailymotion") {
        if (typeof player.getState === "function") {
          const playerState = await player.getState();
          return playerState?.playerIsPlaying === true;
        }
        if (typeof player.paused === "function") {
          return !(await player.paused());
        }
        return !player.paused;
      }

      if (type === "twitch") {
        return !player.isPaused();
      }
    } catch (_) {}

    return false;
  }


  async function updateTimeUI() {
    const readout =
      $("timeReadout");

    if (!readout) {
      return;
    }

    const unsupportedTypes = [
      "bilibili",
      "external",
      "dailymotion-iframe",
      "twitch-clip"
    ];

    if (
      unsupportedTypes.includes(
        state.playerType
      )
    ) {
      readout.textContent =
        "此平台不支援本站同步時間";
      return;
    }

    if (
      !state.playerReady ||
      !state.player
    ) {
      readout.textContent =
        "00:00 / 00:00";
      return;
    }

    const requestId =
      Number(
        state.timeUiRequestId || 0
      ) + 1;

    state.timeUiRequestId =
      requestId;

    try {
      const [
        position,
        total
      ] = await Promise.all([
        asyncCurrentPosition(),
        asyncDuration()
      ]);

      if (
        requestId !==
        Number(
          state.timeUiRequestId
        )
      ) {
        return;
      }

      readout.textContent =
        `${formatTime(
          position
        )} / ${formatTime(
          total
        )}`;
    } catch (_) {}
  }

  function startLocalTimeUpdate() {
    clearInterval(
      state.localTimer
    );

    state.localTimer =
      setInterval(() => {
        void updateTimeUI();

        if (
          state.playerType ===
          "youtube"
        ) {
          forceYoutubePlayerVisible();
        }
      }, 1000);
  }


  async function applyPlayerPosition(
    seconds
  ) {
    state.playbackLocalSeekSuppressUntil =
      Date.now() + 650;

    const player =
      state.player;

    const type =
      state.playerType;

    if (
      !state.playerReady ||
      !player
    ) {
      return;
    }

    const target =
      Math.max(
        0,
        Number(seconds) || 0
      );

    try {
      if (type === "youtube") {
        player.seekTo(
          target,
          true
        );
      }

      if (type === "vimeo") {
        suppressPlatformNativeEvent("seek");
        await player.setCurrentTime(
          target
        );
      }

      if (
        type === "dailymotion"
      ) {
        suppressPlatformNativeEvent("seek");
        if (
          typeof player.seek ===
          "function"
        ) {
          await player.seek(
            target
          );
        }
      }

      if (type === "twitch") {
        if (state.twitchPlaybackKind !== "video") return;
        suppressPlatformNativeEvent("seek");
        if (typeof player.seek === "function") {
          player.seek(target);
        }
      }
    } catch (error) {
      console.warn(
        "播放器跳轉失敗:",
        error
      );
    }

    updateTimeUI();
  }


  async function playPlayer(options = {}) {
    const muteForAutoplay =
      options?.muteForAutoplay === true;
    if (
      !state.playerReady ||
      !state.player
    ) {
      return;
    }

    try {
      if (
        state.playerType ===
        "youtube"
      ) {
        if (muteForAutoplay) {
          state.player.mute();
        }
        suppressYoutubeNativeEvent(
          "play"
        );
        await state.player.playVideo();
      }

      if (
        state.playerType ===
        "vimeo"
      ) {
        suppressPlatformNativeEvent("play");
        await state.player.play();
      }

      if (
        state.playerType ===
        "dailymotion"
      ) {
        suppressPlatformNativeEvent("play");
        await state.player.play();
      }

      if (
        state.playerType ===
        "twitch"
      ) {
        suppressPlatformNativeEvent("play");
        state.player.play();
      }
    } catch (_) {}
  }


  async function pausePlayer() {
    if (
      !state.playerReady ||
      !state.player
    ) {
      return;
    }

    suppressPlatformNativeEvent("pause");

    try {
      if (
        state.playerType ===
        "youtube"
      ) {
        suppressYoutubeNativeEvent(
          "pause"
        );
        state.player.pauseVideo();
      }

      if (
        state.playerType ===
        "vimeo"
      ) {
        await state.player.pause();
      }

      if (
        state.playerType ===
        "dailymotion"
      ) {
        await state.player.pause();
      }

      if (
        state.playerType ===
        "twitch"
      ) {
        state.player.pause();
      }
    } catch (_) {}
  }

  function suppressPlatformNativeEvent(kind, durationMs = 900) {
    state.playbackNativeEventSuppressKind = String(kind || "");
    state.playbackNativeEventSuppressUntil = Date.now() + Math.max(0, Number(durationMs) || 0);
  }

  function platformNativeEventSuppressed(kind = "") {
    return (
      String(state.playbackNativeEventSuppressKind || "") === String(kind || "") &&
      Date.now() < Number(state.playbackNativeEventSuppressUntil || 0)
    );
  }

  async function handlePlatformNativeEvent(kind, positionOverride = null) {
    if (
      !state.roomId ||
      !state.uid ||
      !state.playerReady ||
      !state.player ||
      !["vimeo", "dailymotion", "twitch"].includes(state.playerType)
    ) {
      return;
    }

    if (
      state.playbackApplyingRemote ||
      platformNativeEventSuppressed(kind) ||
      Date.now() < Number(state.playbackIgnoreStateUntil || 0) ||
      Date.now() < Number(state.playbackInitialHardSyncUntil || 0)
    ) {
      return;
    }

    if (
      kind === "seek" &&
      state.playerType === "twitch" &&
      state.twitchPlaybackKind !== "video"
    ) {
      return;
    }

    const position = Number.isFinite(Number(positionOverride))
      ? Math.max(0, Number(positionOverride))
      : await asyncCurrentPosition().catch(() => 0);

    let playing;
    if (kind === "play") {
      playing = true;
    } else if (kind === "pause") {
      playing = false;
    } else {
      playing = await asyncIsPlaying().catch(() => false);
    }

    if (!state.isOwner) {
      await requestPlaybackControl(kind, position, playing);
      return;
    }

    const now = playbackClockNow();
    publishPlaybackEvent(
      kind,
      position,
      playing,
      now,
      now,
      false
    );
  }


  /*
   * =========================================================
   * SDK LOADERS
   * =========================================================
   */

  async function loadVimeoSdk() {
    if (
      window.Vimeo?.Player
    ) {
      state.sdk.vimeo =
        true;

      return;
    }

    await new Promise(
      (
        resolve,
        reject
      ) => {
        const existing =
          document.querySelector(
            'script[src="https://player.vimeo.com/api/player.js"]'
          );

        if (existing) {
          const timer =
            setInterval(() => {
              if (
                window.Vimeo?.Player
              ) {
                clearInterval(
                  timer
                );

                state.sdk.vimeo =
                  true;

                resolve();
              }
            }, 100);

          setTimeout(() => {
            clearInterval(
              timer
            );

            if (
              window.Vimeo?.Player
            ) {
              state.sdk.vimeo =
                true;

              resolve();
            } else {
              reject(
                new Error(
                  "Vimeo SDK 載入失敗"
                )
              );
            }
          }, 10000);

          return;
        }

        const script =
          document.createElement(
            "script"
          );

        script.src =
          "https://player.vimeo.com/api/player.js";

        script.async =
          true;

        script.onload =
          () => {
            if (
              window.Vimeo?.Player
            ) {
              state.sdk.vimeo =
                true;

              resolve();
            } else {
              reject(
                new Error(
                  "Vimeo SDK 載入失敗"
                )
              );
            }
          };

        script.onerror =
          () =>
            reject(
              new Error(
                "Vimeo SDK 載入失敗"
              )
            );

        document.head.appendChild(
          script
        );
      }
    );
  }


  async function loadDailymotionSdk() {
    if (
      window.dailymotion
    ) {
      state.sdk.dailymotion =
        true;

      return;
    }

    await new Promise(
      (
        resolve,
        reject
      ) => {
        const existing =
          document.querySelector(
            'script[data-wt-dailymotion-sdk="1"]'
          );

        if (existing) {
          const timer =
            setInterval(() => {
              if (
                window.dailymotion
              ) {
                clearInterval(
                  timer
                );

                state.sdk.dailymotion =
                  true;

                resolve();
              }
            }, 100);

          setTimeout(() => {
            clearInterval(
              timer
            );

            if (
              window.dailymotion
            ) {
              state.sdk.dailymotion =
                true;

              resolve();
            } else {
              reject(
                new Error(
                  "Dailymotion SDK 載入失敗"
                )
              );
            }
          }, 10000);

          return;
        }

        const playerId =
          DAILYMOTION_PLAYER_ID ||
          String(window.DAILYMOTION_PLAYER_ID || "").trim();

        if (!playerId) {
          reject(
            new Error(
              "尚未設定 DAILYMOTION_PLAYER_ID"
            )
          );

          return;
        }

        const script =
          document.createElement(
            "script"
          );

        script.src =
          `https://geo.dailymotion.com/libs/player/${encodeURIComponent(
            playerId
          )}.js`;

        script.async =
          true;

        script.dataset
          .wtDailymotionSdk =
          "1";

        script.onload =
          () => {
            if (
              window.dailymotion
            ) {
              state.sdk.dailymotion =
                true;

              resolve();
            } else {
              reject(
                new Error(
                  "Dailymotion SDK 載入失敗"
                )
              );
            }
          };

        script.onerror =
          () =>
            reject(
              new Error(
                "Dailymotion SDK 載入失敗"
              )
            );

        document.head.appendChild(
          script
        );
      }
    );
  }


  async function loadTwitchSdk() {
    if (
      window.Twitch?.Player
    ) {
      state.sdk.twitch =
        true;

      return;
    }

    await new Promise(
      (
        resolve,
        reject
      ) => {
        const existing =
          document.querySelector(
            'script[src="https://player.twitch.tv/js/embed/v1.js"]'
          );

        if (existing) {
          const timer =
            setInterval(() => {
              if (
                window.Twitch?.Player
              ) {
                clearInterval(
                  timer
                );

                state.sdk.twitch =
                  true;

                resolve();
              }
            }, 100);

          setTimeout(() => {
            clearInterval(
              timer
            );

            if (
              window.Twitch?.Player
            ) {
              state.sdk.twitch =
                true;

              resolve();
            } else {
              reject(
                new Error(
                  "Twitch SDK 載入失敗"
                )
              );
            }
          }, 10000);

          return;
        }

        const script =
          document.createElement(
            "script"
          );

        script.src =
          "https://player.twitch.tv/js/embed/v1.js";

        script.async =
          true;

        script.onload =
          () => {
            if (
              window.Twitch?.Player
            ) {
              state.sdk.twitch =
                true;

              resolve();
            } else {
              reject(
                new Error(
                  "Twitch SDK 載入失敗"
                )
              );
            }
          };

        script.onerror =
          () =>
            reject(
              new Error(
                "Twitch SDK 載入失敗"
              )
            );

        document.head.appendChild(
          script
        );
      }
    );
  }


  /*
   * =========================================================
   * YOUTUBE PLAYER
   * =========================================================
   */

  async function buildYoutubeNativePlayer(
    videoId,
    autoplay = false
  ) {
    if (!videoId) {
      return;
    }

    const token =
      ++state.youtubeBuildToken;

    state.youtubeRequestedId =
      videoId;

    state.youtubeLoading =
      true;

    try {
      if (state.player) {
        await destroyCurrentPlayer();
      }

      if (
        state.youtubeBuildToken !== token ||
        state.youtubeRequestedId !== videoId
      ) {
        return;
      }

      const videoElement =
        $("directVideo");

      if (!videoElement) {
        throw new Error(
          "找不到 directVideo"
        );
      }

      hidePlayers();

      videoElement.controls = true;
      videoElement.playsInline = true;
      videoElement.autoplay = false;
      videoElement.preload = "metadata";

      try {
        videoElement.pause();
        videoElement.removeAttribute("src");
        videoElement.load();
      } catch (_) {}

      state.youtubePlaybackMode =
        "native";

      state.youtubeIframeInitialSyncUntil =
        0;

      state.playbackRemoteEvent =
        null;
      state.playbackLastRemoteEventId =
        null;
      state.playbackApplyingRemoteEventId =
        null;

      const adapter =
        createYoutubeNativePlayer(
          videoElement,
          videoId
        );

      state.player =
        adapter;

      state.playerReady =
        false;

      state.playerType =
        "youtube";

      state.currentVideoId =
        videoId;

      state.currentVideoUrl =
        null;

      const streamUrl =
        YOUTUBE_STREAM_PROXY_URL +
        "/stream?v=" +
        encodeURIComponent(
          videoId
        );

      if (!YOUTUBE_STREAM_PROXY_URL) {
        throw new Error(
          "YouTube 串流代理尚未設定"
        );
      }

      if ($("syncStatus")) {
        $("syncStatus").textContent =
          "正在載入無廣告 YouTube 串流…";
      }

      await new Promise(
        (resolve, reject) => {
          let settled =
            false;

          const finish = (
            error = null
          ) => {
            if (settled) {
              return;
            }

            settled = true;

            videoElement.removeEventListener(
              "loadedmetadata",
              onLoaded
            );

            videoElement.removeEventListener(
              "error",
              onError
            );

            clearTimeout(
              timeout
            );

            if (error) {
              reject(error);
            } else {
              resolve();
            }
          };

          const onLoaded =
            () => {
              finish();
            };

          const onError =
            () => {
              const mediaError =
                videoElement.error;

              finish(
                new Error(
                  "YouTube 原生串流載入失敗" +
                  (
                    mediaError?.code
                      ? " (code " +
                        String(
                          mediaError.code
                        ) +
                        ")"
                      : ""
                  )
                )
              );
            };

          const timeout =
            setTimeout(
              () => {
                finish(
                  new Error(
                    "YouTube 原生串流載入逾時"
                  )
                );
              },
              60000
            );

          videoElement.addEventListener(
            "loadedmetadata",
            onLoaded,
            {once:true}
          );

          videoElement.addEventListener(
            "error",
            onError,
            {once:true}
          );

          try {
            videoElement.src =
              streamUrl;

            videoElement.load();
          } catch (error) {
            finish(error);
          }
        }
      );

      if (
        state.youtubeBuildToken !== token ||
        state.youtubeRequestedId !== videoId ||
        state.player !== adapter
      ) {
        return;
      }

      state.playerReady =
        true;

      state.playbackReadyAt =
        Date.now() + 250;

      state.playbackSyncPhase =
        "initializing";

      attachYoutubeNativeEvents(
        videoElement
      );

      forceYoutubePlayerVisible();
      updateRoomOwnerUI();

      await applyLatestRoomPlaybackState(
        true
      );

      startPlaybackSeekDetector();

      if (
        autoplay &&
        !state.playbackTimeline &&
        state.player === adapter &&
        state.playerReady
      ) {
        try {
          await playPlayer({
            muteForAutoplay:
              true
          });
        } catch (_) {}
      }

      if ($("syncStatus")) {
        $("syncStatus").textContent =
          "YouTube 已載入（無廣告串流）";
      }
    } catch (error) {
      if (
        state.youtubeBuildToken === token &&
        state.playerType === "youtube" &&
        state.youtubePlaybackMode === "native"
      ) {
        try {
          detachYoutubeNativeEvents();
        } catch (_) {}

        try {
          state.player?.destroy?.();
        } catch (_) {}

        state.player =
          null;

        state.playerReady =
          false;

        state.playerType =
          null;

        state.currentVideoId =
          null;

        state.currentVideoUrl =
          null;

        state.youtubePlaybackMode =
          "iframe";

        state.youtubeIframeInitialSyncUntil =
          0;

        try {
          videoElement.pause();
          videoElement.removeAttribute("src");
          videoElement.load();
          videoElement.classList.add(
            "hidden"
          );
        } catch (_) {}
      }

      throw error;
    } finally {
      if (
        state.youtubeBuildToken === token
      ) {
        state.youtubeLoading =
          false;
      }
    }
  }

  async function buildYoutubePlayer(
    videoId,
    autoplay = true
  ) {
    if (!videoId) {
      return;
    }

    return buildYoutubeNativePlayer(
      videoId,
      autoplay
    );
  }

  async function buildVimeoPlayer(video) {
    await destroyCurrentPlayer();
    await loadVimeoSdk();
    hidePlayers();
    showPlayerElement("vimeoPlayer");

    const container = $("vimeoPlayer");
    if (!container) {
      throw new Error("找不到 vimeoPlayer");
    }

    const rawUrl = String(video.url || "").trim();
    let embedUrl = `https://player.vimeo.com/video/${encodeURIComponent(video.id)}?autoplay=0&playsinline=1`;
    try {
      const parsedUrl = new URL(rawUrl);
      const host = parsedUrl.hostname.toLowerCase();
      const pathMatch = parsedUrl.pathname.match(/\/video\/(\d+)/i);
      const directIdMatch = parsedUrl.pathname.match(/\/(\d+)(?:\/)?$/);

      if (
        (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") &&
        host === "player.vimeo.com" &&
        pathMatch?.[1]
      ) {
        const params = new URLSearchParams(parsedUrl.search);
        params.set("autoplay", "0");
        params.set("playsinline", "1");
        embedUrl = `https://player.vimeo.com/video/${encodeURIComponent(pathMatch[1])}?${params.toString()}`;
      } else if (
        (parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:") &&
        (host === "vimeo.com" || host === "www.vimeo.com") &&
        directIdMatch?.[1]
      ) {
        const params = new URLSearchParams(parsedUrl.search);
        params.set("autoplay", "0");
        params.set("playsinline", "1");
        embedUrl = `https://player.vimeo.com/video/${encodeURIComponent(directIdMatch[1])}?${params.toString()}`;
      }
    } catch (_) {}

    container.src = embedUrl;
    container.allow = "autoplay; fullscreen; picture-in-picture";
    container.allowFullscreen = true;
    container.frameBorder = "0";
    container.referrerPolicy = "strict-origin-when-cross-origin";

    const player = new Vimeo.Player(container);

    state.player = player;
    state.currentVideoId = String(video.id);
    state.currentVideoUrl = embedUrl;
    state.playerType = "vimeo";
    state.playerReady = false;

    player.on("play", () => {
      if (state.player !== player) return;
      void handlePlatformNativeEvent("play");
    });

    player.on("pause", () => {
      if (state.player !== player) return;
      void handlePlatformNativeEvent("pause");
    });

    player.on("seeked", event => {
      if (state.player !== player) return;
      const seconds = Number(event?.seconds);
      void handlePlatformNativeEvent(
        "seek",
        Number.isFinite(seconds) ? seconds : null
      );
    });

    player.on("ended", async () => {
      if (state.player !== player) return;
      state.playbackLastPlayerState = "ended";
      state.playbackLastPlaying = false;
      if (!state.isOwner || state.playbackApplyingRemote) return;
      const position = await asyncCurrentPosition().catch(() => 0);
      const issuedAt = playbackClockNow();
      await publishPlaybackEvent(
        "pause",
        position,
        false,
        issuedAt,
        issuedAt,
        true
      );
    });

    player.on("timeupdate", () => {
      void updateTimeUI();
    });

    await player.ready();

    if (state.player !== player) return;

    const durationValue = await player.getDuration().catch(() => 0);
    if (!Number.isFinite(Number(durationValue)) || Number(durationValue) <= 0) {
      throw new Error("Vimeo 影片無法取得有效長度");
    }

    state.playerReady = true;
    state.playbackLastPlayerState = "paused";
    updateRoomOwnerUI();
    startLocalTimeUpdate();
    void updateTimeUI();
    await applyLatestRoomPlaybackState(true);
    startPlaybackSeekDetector();
  }


  async function buildDailymotionPlayer(video) {
    await destroyCurrentPlayer();
    await loadDailymotionSdk();
    hidePlayers();
    showPlayerElement("dailymotionPlayer");

    const container = $("dailymotionPlayer");
    if (!container) {
      throw new Error("找不到 dailymotionPlayer");
    }

    const playerId = DAILYMOTION_PLAYER_ID || String(window.DAILYMOTION_PLAYER_ID || "").trim();
    if (!playerId) {
      throw new Error("尚未設定 DAILYMOTION_PLAYER_ID");
    }

    container.innerHTML = "";

    const targetId = "dm_" + Math.random().toString(36).slice(2);
    const target = document.createElement("div");
    target.id = targetId;
    target.style.width = "100%";
    target.style.height = "100%";
    container.appendChild(target);

    const player = await window.dailymotion.createPlayer(targetId, {
      video: String(video.id),
      params: {
        autoplay: false,
        startTime: 0
      }
    });

    state.player = player;
    state.currentVideoId = video.id;
    state.currentVideoUrl = video.url || null;
    state.playerType = "dailymotion";
    state.playerReady = false;

    updateRoomOwnerUI();

    const refreshPlaybackState = () => {
      if (state.player !== player) return;
      void applyLatestRoomPlaybackState(true);
      startPlaybackSeekDetector();
      void updateTimeUI();
    };

    player.on(dailymotion.events.PLAYER_VIDEOCHANGE, refreshPlaybackState);

    player.on(dailymotion.events.PLAYER_CRITICALPATHREADY, () => {
      if (state.player !== player) return;
      void updateTimeUI();
    });

    player.on(dailymotion.events.VIDEO_PLAYING, () => {
      if (state.player !== player) return;
      void handlePlatformNativeEvent("play");
    });

    player.on(dailymotion.events.VIDEO_PAUSE, () => {
      if (state.player !== player) return;
      void handlePlatformNativeEvent("pause");
    });

    player.on(dailymotion.events.VIDEO_SEEKEND, async event => {
      if (state.player !== player) return;
      const eventPosition = Number(event?.videoTime);
      if (Number.isFinite(eventPosition)) {
        void handlePlatformNativeEvent("seek", eventPosition);
        return;
      }
      const playerState = await player.getState().catch(() => null);
      void handlePlatformNativeEvent("seek", Number(playerState?.videoTime));
    });

    player.on(dailymotion.events.VIDEO_END, async () => {
      if (state.player !== player) return;
      state.playbackLastPlayerState = "ended";
      if (!state.isOwner || state.playbackApplyingRemote) return;
      const playerState = await player.getState().catch(() => null);
      const position = Number(playerState?.videoTime) || await asyncCurrentPosition().catch(() => 0);
      const issuedAt = playbackClockNow();
      await publishPlaybackEvent("pause", position, false, issuedAt, issuedAt, true);
    });

    player.on(dailymotion.events.VIDEO_TIMECHANGE, () => {
      void updateTimeUI();
    });

    await new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (state.player === player) {
          state.playerReady = true;
          updateRoomOwnerUI();
        }
        resolve();
      };
      player.on(dailymotion.events.PLAYER_CRITICALPATHREADY, finish);
      player.on(dailymotion.events.PLAYER_PLAYBACKPERMISSION, finish);
      setTimeout(finish, 10000);
    });

    if (state.player !== player) return;

    startLocalTimeUpdate();
    void updateTimeUI();
    await applyLatestRoomPlaybackState(true);
    startPlaybackSeekDetector();
  }


  async function buildBilibiliPlayer(
    video
  ) {
    await destroyCurrentPlayer();

    hidePlayers();

    showPlayerElement(
      "bilibiliPlayer"
    );

    const iframe =
      $("bilibiliPlayer");

    if (!iframe) {
      throw new Error(
        "找不到 bilibiliPlayer"
      );
    }

    let src = "";

    if (
      /^BV/.test(
        video.id
      )
    ) {
      src =
        "https://player.bilibili.com/player.html?bvid=" +
        encodeURIComponent(
          video.id
        ) +
        "&page=1&autoplay=1";
    } else if (
      /^av/i.test(
        video.id
      )
    ) {
      src =
        "https://player.bilibili.com/player.html?aid=" +
        encodeURIComponent(
          video.id.replace(
            /^av/i,
            ""
          )
        ) +
        "&page=1&autoplay=1";
    } else {
      src =
        video.url ||
        "https://www.bilibili.com/video/" +
        encodeURIComponent(
          video.id
        );
    }

    iframe.src =
      src;

    iframe.allow =
      "autoplay; fullscreen; picture-in-picture";

    state.currentVideoId =
      video.id;

    state.currentVideoUrl =
      video.url ||
      null;

    state.playerType =
      "bilibili";

    state.player =
      iframe;

    state.playerReady =
      true;

    updateRoomOwnerUI();

    startLocalTimeUpdate();
  }


  async function buildTwitchPlayer(video) {
    await destroyCurrentPlayer();
    await loadTwitchSdk();
    hidePlayers();
    showPlayerElement("twitchPlayer");

    const container = $("twitchPlayer");
    if (!container) {
      throw new Error("找不到 twitchPlayer");
    }

    container.innerHTML = "";

    const host = location.hostname || "localhost";

    if (video.twitchType === "clip") {
      const iframe = document.createElement("iframe");
      const params = new URLSearchParams();
      params.set("clip", video.id);
      params.set("parent", host);
      iframe.title = video.title || "Twitch Clip";
      iframe.src = "https://clips.twitch.tv/embed?" + params.toString();
      iframe.allow = "autoplay; fullscreen; picture-in-picture";
      iframe.allowFullscreen = true;
      iframe.frameBorder = "0";
      Object.assign(iframe.style, {
        width: "100%",
        height: "100%",
        display: "block",
        border: "0",
        minHeight: "300px"
      });
      container.appendChild(iframe);

      state.player = iframe;
      state.currentVideoId = video.id;
      state.currentVideoUrl = video.url || null;
      state.playerType = "twitch-clip";
      state.twitchPlaybackKind = "clip";
      state.playerReady = false;
      void updateTimeUI();
      return;
    }

    const wrapperId = "tw_" + Math.random().toString(36).slice(2);
    const target = document.createElement("div");
    target.id = wrapperId;
    target.style.width = "100%";
    target.style.height = "100%";
    container.appendChild(target);

    const options = {
      width: "100%",
      height: "100%",
      autoplay: false,
      muted: true,
      parent: [host],
      layout: "video"
    };

    if (video.twitchType === "video") {
      options.video = String(video.id);
    } else {
      options.channel = String(video.id || "").replace(/^@/, "");
    }

    const player = new Twitch.Player(wrapperId, options);

    state.player = player;
    state.currentVideoId = video.id;
    state.currentVideoUrl = video.url || null;
    state.playerType = "twitch";
    state.twitchPlaybackKind = video.twitchType === "video" ? "video" : "channel";
    state.playerReady = false;

    if (player.addEventListener) {
      player.addEventListener(Twitch.Player.PLAYING, () => {
        if (state.player !== player) return;
        void handlePlatformNativeEvent("play");
        void updateTimeUI();
      });

      player.addEventListener(Twitch.Player.PAUSE, () => {
        if (state.player !== player) return;
        void handlePlatformNativeEvent("pause");
      });

      player.addEventListener(Twitch.Player.SEEK, () => {
        if (state.player !== player || state.twitchPlaybackKind !== "video") return;
        void handlePlatformNativeEvent("seek");
      });

      player.addEventListener(Twitch.Player.ENDED, async () => {
        if (state.player !== player) return;
        state.playbackLastPlayerState = "ended";
        if (!state.isOwner || state.playbackApplyingRemote) return;
        const position = await asyncCurrentPosition().catch(() => 0);
        const issuedAt = playbackClockNow();
        await publishPlaybackEvent("pause", position, false, issuedAt, issuedAt, true);
      });

      player.addEventListener(Twitch.Player.PLAYBACK_BLOCKED, () => {
        if (state.player !== player) return;
        if ($("syncStatus")) {
          $("syncStatus").textContent = "Twitch 需要點擊播放器後才能開始播放";
        }
      });
    }

    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (state.player === player) {
          state.playerReady = true;
          updateRoomOwnerUI();
        }
        resolve();
      };
      if (player.addEventListener) {
        player.addEventListener(Twitch.Player.READY, finish);
        setTimeout(finish, 8000);
      } else {
        setTimeout(finish, 1500);
      }
    });

    if (state.player !== player) return;

    if (state.twitchPlaybackKind === "video") {
      const currentVideo = await Promise.resolve(player.getVideo()).catch(() => null);
      if (currentVideo && String(currentVideo) !== String(video.id)) {
        player.setVideo(String(video.id));
      }
    }

    startLocalTimeUpdate();
    void updateTimeUI();
    await applyLatestRoomPlaybackState(true);
    startPlaybackSeekDetector();
  }


  async function buildExternalPlayer(
    video
  ) {
    await destroyCurrentPlayer();

    hidePlayers();

    const notice =
      $("platformPlayerNotice");

    if (!notice) {
      throw new Error(
        "找不到外部平台提示"
      );
    }

    notice.classList.remove(
      "hidden"
    );

    const name =
      PLATFORMS[
        video.platform
      ]?.name ||
      video.platform;

    const url =
      video.url ||
      "";

    if (
      $("roomPlatformIcon")
    ) {
      $("roomPlatformIcon")
        .textContent =
        PLATFORMS[
          video.platform
        ]?.icon ||
        "🌐";
    }

    if (
      $("roomPlatformName")
    ) {
      $("roomPlatformName")
        .textContent =
        name;
    }

    if (
      $("roomPlatformDescription")
    ) {
      $("roomPlatformDescription")
        .textContent =
        "此平台請使用官方網站播放。";
    }

    const button =
      $("openPlatformBtn");

    if (button) {
      button.onclick =
        () => {
          if (!url) {
            return;
          }

          window.open(
            url,
            "_blank",
            "noopener,noreferrer"
          );
        };
    }

    state.playerType =
      "external";

    state.player =
      null;

    state.playerReady =
      false;
  }


  /*
   * =========================================================
   * PLAYER ROUTER
   * =========================================================
   */

  async function buildPlatformPlayer(
    video
  ) {
    if (!video) {
      hidePlayers();

      showPlayerElement(
        "emptyPlayer"
      );

      return;
    }

    if (
      video.platform ===
      "youtube"
    ) {
      await buildYoutubePlayer(
        getYoutubeId(
          video.id
        ) ||
        video.id,
        state.isOwner
      );
      await applyLatestRoomPlaybackState();
      startPlaybackSeekDetector();
      return;
    }

    if (
      video.platform ===
      "vimeo"
    ) {
      await buildVimeoPlayer(
        video
      );

      return;
    }

    if (
      video.platform ===
      "dailymotion"
    ) {
      await buildDailymotionPlayer(
        video
      );

      return;
    }

    if (
      video.platform ===
      "bilibili"
    ) {
      await buildBilibiliPlayer(
        video
      );

      return;
    }

    if (
      video.platform ===
      "twitch"
    ) {
      await buildTwitchPlayer(
        video
      );

      return;
    }

    await buildExternalPlayer(
      video
    );
  }


  /*
   * =========================================================
   * CREATE ROOM
   * =========================================================
   */

  async function createRoom(initialVideo = null) {
    setError(
      $("homeError"),
      ""
    );

    const roomName =
      $("roomNameInput")
        ?.value
        .trim() ||
      "一起看";

    const selectedSourceType =
      String(
        $("sourceTypeInput")?.value ||
        "youtube"
      ).trim();

    let selectedVideo =
      initialVideo ||
      window.WT_ENHANCEMENTS?.state?.createVideo ||
      null;

    if (
      !selectedVideo &&
      ["vimeo", "dailymotion", "twitch"].includes(selectedSourceType)
    ) {
      const raw = $("platformManualInput")?.value?.trim() || "";
      if (!raw) {
        throw new Error("請輸入影片網址或 ID");
      }

      selectedVideo = createVideoObject(
        selectedSourceType,
        raw
      );

      if (!selectedVideo) {
        throw new Error("無法辨識目前平台的影片網址或 ID");
      }
    }

    const sourceType =
      selectedVideo?.id &&
      PLATFORMS[
        String(
          selectedVideo.platform ||
          ""
        )
      ]
        ? String(
            selectedVideo.platform
          )
        : (
            PLATFORMS[
              selectedSourceType
            ]
              ? selectedSourceType
              : "youtube"
          );

    await ensureAuthReady({
      silent: false,
      maxAttempts: 4
    });

    if (
      !state.uid ||
      !auth?.currentUser
    ) {
      throw new Error(
        "Firebase 登入狀態尚未準備完成，請稍後再試"
      );
    }

    await ensureNotGloballyBlocked(auth?.currentUser || null);

    let roomId =
      randomRoomCode();

    while (
      (
        await db
          .ref(
            `roomMeta/${roomId}`
          )
          .once("value")
      ).exists()
    ) {
      roomId =
        randomRoomCode();
    }

    /*
     * 分開建立 rooms 與 roomMeta。
     *
     * 不使用 root.update() 一次寫兩個不同權限節點，
     * 避免 Realtime Database Rules 在多路徑寫入時把整筆
     * 操作判定為 permission_denied。
     */
    const room = {
      owner:
        state.uid,

      name:
        roomName,

      sourceType:
        sourceType
    };

    try {
      await db
        .ref(
          `rooms/${roomId}`
        )
        .set(room);

      const ownerMemberRef =
        db.ref(
          `members/${roomId}/${state.uid}`
        );

      await ownerMemberRef.set({
        name:
          state.memberName,
        joinedAt:
          firebase.database.ServerValue.TIMESTAMP,
        online:
          true,
        lastSeen:
          firebase.database.ServerValue.TIMESTAMP
      });

      await ownerMemberRef
        .onDisconnect()
        .update({
          online: false,
          lastSeen:
            firebase.database.ServerValue.TIMESTAMP
        });

    } catch (error) {
      console.error(
        "建立 rooms/房主成員節點失敗:",
        error
      );

      try {
        await db
          .ref(
            `members/${roomId}/${state.uid}`
          )
          .onDisconnect()
          .cancel();
      } catch (_) {}

      try {
        await db
          .ref(
            `members/${roomId}/${state.uid}`
          )
          .remove();
      } catch (_) {}

      try {
        await db
          .ref(
            `rooms/${roomId}`
          )
          .remove();
      } catch (_) {}

      throw new Error(
        "建立房間失敗：Firebase 不允許建立房間資料"
      );
    }

    try {
      await db
        .ref(
          `roomMeta/${roomId}`
        )
        .set({
          owner:
            state.uid,

          name:
            roomName,

          settings: {
            locked:
              false,

            maxMembers:
              2,

            controlMode:
              "host"
          },

          createdAt:
            firebase.database
              .ServerValue
              .TIMESTAMP
        });
    } catch (error) {
      console.error(
        "建立 roomMeta 節點失敗:",
        error
      );

      /*
       * roomMeta 建立失敗時清掉剛建立的房間，
       * 避免留下沒有邀請入口的孤兒房間。
       */
      try {
        await db
          .ref(
            `members/${roomId}/${state.uid}`
          )
          .onDisconnect()
          .cancel();
      } catch (_) {}

      try {
        await db
          .ref(
            `members/${roomId}/${state.uid}`
          )
          .remove();
      } catch (_) {}

      try {
        await db
          .ref(
            `rooms/${roomId}`
          )
          .remove();
      } catch (_) {}

      throw new Error(
        "建立房間失敗：Firebase 不允許建立房間索引"
      );
    }

    state.roomId =
      roomId;

    /*
     * 本地狀態可以保留 video:null，
     * 但資料庫目前不要建立 rooms/{roomId}/video。
     */
    state.room = {
      ...room,
      video:
        null
    };

    state.isOwner =
      true;

    history.replaceState(
      {},
      "",
      `?room=${encodeURIComponent(roomId)}${state.adminJoinOverride ? "&adminJoin=1" : ""}`
    );

    try {
      await enterRoom();

      if (
        String(state.roomId || "") !== roomId ||
        state.wasMemberInRoom !== true
      ) {
        throw new Error(
          "房間建立後進入房間失敗"
        );
      }
    } catch (error) {
      try {
        await db
          .ref("members/" + roomId + "/" + state.uid)
          .onDisconnect()
          .cancel();
      } catch (_) {}

      try {
        await db
          .ref("members/" + roomId + "/" + state.uid)
          .remove();
      } catch (_) {}

      try {
        await db
          .ref("roomMeta/" + roomId)
          .remove();
      } catch (_) {}

      try {
        await db
          .ref("rooms/" + roomId)
          .remove();
      } catch (_) {}

      try {
        disconnectRoomListeners();
      } catch (_) {}

      ++state.youtubeBuildToken;
      state.youtubeRequestedId = null;
      state.youtubeLoading = false;

      try {
        await destroyCurrentPlayer();
      } catch (_) {}

      state.roomId = null;
      state.roomRef = null;
      state.membersRef = null;
      state.kickedRef = null;
      state.chatRef = null;
      state.queueRef = null;
      state.room = null;
      state.isOwner = false;
      state.adminJoinRequested = false;
      state.adminJoinOverride = false;
      state.wasMemberInRoom = false;
      state.kickedLocally = false;
      state.leavingRoom = false;

      history.replaceState(
        {},
        "",
        location.pathname
      );

      showView("home");
      throw new Error(
        error?.message ||
        "房間建立後進入房間失敗"
      );
    }

    try {
      window.WT_ENHANCEMENTS?.rememberRoom?.(
        roomId,
        state.room?.name ||
          roomName ||
          "一起看"
      );
    } catch (_) {}

    saveRoomId(roomId);

    if (
      selectedVideo &&
      selectedVideo.id &&
      state.isOwner &&
      state.roomId === roomId
    ) {
      try {
        const selectedPlatform =
          PLATFORMS[
            String(
              selectedVideo.platform ||
              ""
            )
          ]
            ? String(
                selectedVideo.platform
              )
            : "youtube";

        await changeVideo({
          id:
            String(
              selectedVideo.id
            ),
          platform:
            selectedPlatform,
          title:
            String(
              selectedVideo.title ||
              PLATFORMS[selectedPlatform]?.name ||
              "未命名影片"
            ).slice(0, 200),
          thumbnail:
            String(
              selectedVideo.thumbnail ||
              ""
            ).slice(0, 2000),
          channel:
            String(
              selectedVideo.channel ||
              PLATFORMS[selectedPlatform]?.name ||
              selectedPlatform
            ).slice(0, 100),
          ...(selectedVideo.url
            ? {
                url:
                  String(
                    selectedVideo.url
                  ).slice(0, 2000)
              }
            : {}),
          ...(selectedVideo.twitchType
            ? {
                twitchType:
                  String(
                    selectedVideo.twitchType
                  )
              }
            : {})
        });
      } catch (error) {
        console.warn(
          "建立房間後套用已選影片失敗:",
          error
        );
        toast(
          "房間已建立，但自動載入已選影片失敗"
        );
      }
    }

    saveRoomId(roomId);
  }

  async function createRoomWithVideo(video) {
    if (
      !video ||
      !video.id
    ) {
      throw new Error(
        "沒有可建立的影片"
      );
    }

    const platform =
      PLATFORMS[
        String(
          video.platform ||
          ""
        )
      ]
        ? String(
            video.platform
          )
        : "youtube";

    return createRoom({
      id:
        String(
          video.id
        ),
      platform,
      title:
        String(
          video.title ||
          PLATFORMS[platform]?.name ||
          "未命名影片"
        ).slice(0,200),
      thumbnail:
        String(
          video.thumbnail ||
          ""
        ).slice(0,2000),
      channel:
        String(
          video.channel ||
          PLATFORMS[platform]?.name ||
          platform
        ).slice(0,100),
      ...(video.url
        ? {
            url:
              String(
                video.url
              ).slice(0,2000)
          }
        : {}),
      ...(video.twitchType
        ? {
            twitchType:
              String(
                video.twitchType
              )
          }
        : {})
    });
  }

  /*
   * =========================================================
   * JOIN ROOM
   * =========================================================
   */

  async function joinRoom(roomId) {
    roomId =
      String(
        roomId || ""
      )
        .trim()
        .toUpperCase();

    if (
      !/^[A-Z0-9]{6}$/.test(
        roomId
      )
    ) {
      throw new Error(
        "房間碼必須是 6 碼"
      );
    }

    await ensureAuthReady({
      silent: false,
      maxAttempts: 4
    });

    await ensureNotGloballyBlocked(auth?.currentUser || null);

    let adminJoinAllowed = false;
    if (state.adminJoinRequested) {
      try {
        adminJoinAllowed = await isPrivilegedAdminUser();
      } catch (_) {
        adminJoinAllowed = false;
      }
    }
    state.adminJoinOverride = Boolean(adminJoinAllowed);

    const metaSnapshot =
      await db
        .ref(
          `roomMeta/${roomId}`
        )
        .once("value");

    if (
      !metaSnapshot.exists()
    ) {
      throw new Error(
        "找不到這個房間"
      );
    }

    const roomOwnerSnapshot =
      await db
        .ref(
          `rooms/${roomId}/owner`
        )
        .once("value");

    if (
      !roomOwnerSnapshot.exists()
    ) {
      throw new Error(
        "這個房間資料不完整"
      );
    }

    const metaData =
      metaSnapshot.val() ||
      {};

    const metaSettings =
      metaData.settings ||
      {};

    const actualOwnerUid =
      String(
        roomOwnerSnapshot.val() ||
        ""
      );

    const maxMembers =
      Math.max(
        2,
        Math.min(
          10,
          Number(
            metaSettings.maxMembers ||
            2
          )
        )
      );

    const currentMemberSnapshot =
      await db
        .ref(
          `members/${roomId}/${state.uid}`
        )
        .once("value");

    const isExistingMember =
      currentMemberSnapshot.exists();

    const isRoomOwner =
      actualOwnerUid ===
      String(
        state.uid ||
        ""
      );

    const isAdminJoin =
      Boolean(state.adminJoinOverride);

    if (
      !state.adminJoinOverride &&
      !isRoomOwner &&
      !isExistingMember &&
      metaSettings.locked === true
    ) {
      throw new Error(
        "這個房間目前已鎖定，暫停新成員加入"
      );
    }

    if (
      !state.adminJoinOverride &&
      !isRoomOwner &&
      !isExistingMember &&
      Number.isFinite(maxMembers) &&
      maxMembers < 2
    ) {
      throw new Error(
        "這個房間的人數設定無效"
      );
    }

    const kickRemainingMs =
      await getKickRemainingMs(
        roomId,
        state.uid
      );

    if (!state.adminJoinOverride && kickRemainingMs > 0) {
      const remainingMinutes = Math.max(
        1,
        Math.ceil(
          kickRemainingMs / 60000
        )
      );

      throw new Error(
        `你已被房主移出這個房間，請 ${remainingMinutes} 分鐘後再加入`
      );
    }

    state.roomId =
      roomId;

    state.room = {
      /*
       * roomMeta 只負責確認房間存在與提供名稱。
       * 真正 owner 必須以 rooms/{roomId}/owner 為準。
       */
      owner: actualOwnerUid,
      name: metaSnapshot.val()?.name || "一起看",
      sourceType: "youtube",
      video: null
    };

    state.isOwner =
      isRoomOwner || isAdminJoin;

    state.kickedLocally =
      false;

    state.wasMemberInRoom =
      false;

    history.replaceState(
      {},
      "",
      `?room=${encodeURIComponent(roomId)}${state.adminJoinOverride ? "&adminJoin=1" : ""}`
    );

    await enterRoom();

    if (
      String(state.roomId || "") !== roomId ||
      state.wasMemberInRoom !== true
    ) {
      throw new Error(
        "加入房間失敗，使用者未成功成為房間成員"
      );
    }

    try {
      window.WT_ENHANCEMENTS?.rememberRoom?.(
        roomId,
        state.room?.name ||
          metaData?.name ||
          "一起看"
      );
    } catch (_) {}

    saveRoomId(roomId);
  }


  /*
   * =========================================================
   * ROOM VIDEO
   * =========================================================
   */

  async function handleRoomVideo(
    video
  ) {
    cancelScheduledQueuePlayback();
    cancelScheduledLocalPause();
    cancelScheduledRemotePause();
    cancelScheduledRemotePlay();
    cancelScheduledRemoteSeek();

    clearTimeout(state.playbackLocalSeekTimer);
    state.playbackLocalSeekTimer = null;
    state.playbackLocalScheduledEventId = "";
    state.playbackLocalControlUntil = 0;

    if (!video) {
      state.youtubeRequestedId =
        null;

      ++state.youtubeBuildToken;

      state.youtubeLoading =
        false;

      await destroyCurrentPlayer();

      hidePlayers();

      showPlayerElement(
        "emptyPlayer"
      );

      if ($("syncStatus")) {
        $("syncStatus")
          .textContent =
          "等待有人選擇影片";
      }

      return;
    }

    const normalized = {
      ...video,

      platform:
        video.platform ||
        state.room?.sourceType ||
        "youtube"
    };

    state.room.video =
      normalized;

    state.room.sourceType =
      normalized.platform;

    updateRoomOwnerUI();

    if (
      normalized.platform ===
      "youtube"
    ) {
      const videoId =
        getYoutubeId(
          normalized.id
        );

      if (!videoId) {
        throw new Error(
          "Firebase 中的 YouTube ID 無效"
        );
      }

      if (
        state.currentVideoId ===
          videoId &&
        state.youtubeLoading &&
        state.youtubeRequestedId ===
          videoId
      ) {
        return;
      }

      if (
        state.currentVideoId ===
          videoId &&
        state.playerReady &&
        state.player &&
        state.playerType ===
          "youtube"
      ) {
        forceYoutubePlayerVisible();
        return;
      }

      state.playbackRemoteEvent = null;
      state.playbackLastRemoteEventId = null;
      state.playbackApplyingRemoteEventId = null;
      state.playbackIgnoreStateChanges = 0;
      state.playbackIgnoreStateUntil = 0;
      state.playbackLastRemoteUpdatedAt = 0;
      state.playbackLastLocalActionKey = "";
      state.playbackLastLocalActionAt = 0;
      state.playbackLastLocalSeekWriteAt = 0;

      state.playbackTimeline = null;
      state.playbackAppliedRate = null;
      state.playbackIsBuffering = false;
      state.playbackYoutubeRates = null;
      state.playbackYoutubeRatesVideoId = "";
      state.playbackYoutubeRatesCheckedAt = 0;
      state.playbackAwaitingActualStart = false;
      clearTimeout(state.playbackActualStartTimer);
      state.playbackActualStartTimer = null;
      state.playbackInitialHardSyncUntil = 0;
      state.playbackInitialHardSyncEventId = "";
      state.playbackInitialHardSyncAt = 0;
      state.playbackAdGuardUntil = 0;
      state.playbackTransientStateUntil = 0;
      state.playbackLastPlayerState = null;
      state.playbackLastObservedPosition = null;
      state.playbackPendingRecovery = false;
      state.playbackLocalIntentAt = 0;
      state.playbackSyncPhase = "initializing";
      state.playbackFineRateSupported = null;
      const shouldAutoplay = state.isOwner && !isMobileViewport();

      if (!YOUTUBE_STREAM_PROXY_URL) {
        throw new Error(
          "YouTube 串流代理尚未設定"
        );
      }

      try {
        await buildYoutubeNativePlayer(
          videoId,
          shouldAutoplay
        );
        return;
      } catch (nativeError) {
        console.error(
          "原生 YouTube 串流建立失敗:",
          nativeError
        );

        if ($("syncStatus")) {
          $("syncStatus").textContent =
            "YouTube 無法建立無廣告串流";
        }

        throw nativeError;
      }
    }

    await buildPlatformPlayer(
      normalized
    );
    if (state.playerReady && state.player && state.playerType !== "bilibili" && state.playerType !== "external") {
      await applyLatestRoomPlaybackState(true);
      startPlaybackSeekDetector();
    }
  }




















  /*
   * =========================================================
   * AUTHORITATIVE PREDICTIVE PLAYBACK SYNC
   * =========================================================
   *
   * One room timeline, one listener, one local correction loop.
   * Network delivery time is never treated as media time.
   * The timeline is anchored to Firebase's calibrated server clock.
   * Guests predict the current position locally and use playbackRate
   * to remove small drift. A hard seek is only used for large drift
   * or an explicit seek command.
   */

  function playbackClockNow() {
    const mono = Number(performance?.now?.() || 0);
    const baseServer = Number(state.playbackClockBaseServerMs || 0);
    const baseMono = Number(state.playbackClockBaseMonoMs || 0);

    if (
      mono > 0 &&
      baseServer > 0 &&
      baseMono >= 0
    ) {
      return baseServer + Math.max(0, mono - baseMono);
    }

    return Date.now() + Number(state.playbackServerTimeOffset || 0);
  }

  function serverNow() {
    return playbackClockNow();
  }

  function calibratePlaybackClock(offset) {
    const numeric = Number(offset);
    if (!Number.isFinite(numeric)) return;

    const nowServer = Date.now() + numeric;
    const nowMono = Number(performance?.now?.() || 0);

    state.playbackServerTimeOffset = numeric;

    if (
      !state.playbackClockBaseServerMs ||
      !state.playbackClockBaseMonoMs
    ) {
      state.playbackClockBaseServerMs = nowServer;
      state.playbackClockBaseMonoMs = nowMono;
      state.playbackClockLastCalibratedAt = Date.now();
      state.playbackClockOffsetSamples = [numeric];
      return;
    }

    const samples = Array.isArray(state.playbackClockOffsetSamples)
      ? state.playbackClockOffsetSamples.slice()
      : [];

    samples.push(numeric);
    while (samples.length > 9) samples.shift();
    state.playbackClockOffsetSamples = samples;

    const sorted = samples.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? numeric;

    const projected = playbackClockNow();
    const target = Date.now() + median;
    const delta = target - projected;

    if (Math.abs(delta) > 750) {
      state.playbackClockBaseServerMs = target;
      state.playbackClockBaseMonoMs = nowMono;
    } else {
      state.playbackClockBaseServerMs += delta * 0.18;
      state.playbackClockBaseMonoMs = nowMono;
    }

    state.playbackServerTimeOffset = median;
    state.playbackClockLastCalibratedAt = Date.now();
  }

  function attachServerClockSync() {
    if (!db) return;
    const ref = db.ref(".info/serverTimeOffset");
    if (state.playbackServerClockHandler) {
      try { ref.off("value", state.playbackServerClockHandler); } catch (_) {}
    }
    state.playbackServerClockHandler = (snapshot) => {
      calibratePlaybackClock(snapshot?.val());
    };
    ref.on("value", state.playbackServerClockHandler);
    ref.once("value").then((snapshot) => {
      calibratePlaybackClock(snapshot?.val());
    }).catch(() => {});
  }

  function playbackSyncRef() {
    if (!db || !state.roomId) return null;
    return db.ref(`playback/${state.roomId}`);
  }

  function controlRequestsRef() {
    if (!db || !state.roomId) return null;
    return db.ref("controlRequests/" + state.roomId);
  }

  function detachPlaybackControlRequestListener() {
    try { state.controlRequestRef?.off(); } catch (_) {}
    state.controlRequestRef = null;
    state.controlRequestListenerAttached = false;
    state.controlRequestQueue = [];
    state.controlRequestProcessing = false;
  }

  async function requestPlaybackControl(action, position = null, playing = null) {
    if (state.isOwner || !state.roomId || !state.uid || !state.membersRef || !state.currentVideoId || !state.playerType) return false;
    if (!["play", "pause", "seek"].includes(action)) return false;

    const now = Date.now();
    if (now - Number(state.controlRequestLastAt || 0) < 250) return false;

    if (!(await ensureRoomMembership())) {
      toast("你已不在這個房間");
      return false;
    }

    const ref = controlRequestsRef();
    if (!ref) return false;

    let targetPosition = Number(position);
    if (!Number.isFinite(targetPosition)) targetPosition = await asyncCurrentPosition();
    targetPosition = Math.max(0, Math.min(86400, Number(targetPosition) || 0));

    state.controlRequestLastAt = now;
    if (action === "seek") state.playbackLocalSeekSuppressUntil = now + 1200;
    else state.playbackLocalControlUntil = now + 1200;

    try {
      const child = ref.push();
      await child.set({
        uid: state.uid,
        name: String(state.memberName || getMemberName()).slice(0, 30),
        action: action,
        position: targetPosition,
        playing: typeof playing === "boolean" ? playing : action === "play",
        videoId: String(state.currentVideoId),
        platform: String(state.playerType),
        createdAt: firebase.database.ServerValue.TIMESTAMP
      });
      return true;
    } catch (error) {
      state.controlRequestLastAt = 0;
      console.warn("播放控制請求送出失敗:", error);
      toast("播放控制請求送出失敗");
      return false;
    }
  }

  async function processPlaybackControlRequest(snapshot) {
    if (!snapshot || !state.isOwner || !state.roomId || !state.membersRef) return;

    const request = snapshot.val() || {};
    const requesterUid = String(request.uid || "");

    try {
      const now = Date.now();
      const createdAt = Number(request.createdAt || 0);
      if (!createdAt || createdAt < now - 15000 || createdAt > now + 15000) return;
      if (!requesterUid || requesterUid === String(state.uid)) return;

      const requester = await state.membersRef.child(requesterUid).once("value").catch(() => null);
      if (!requester?.exists()) return;

      const action = String(request.action || "");
      if (!["play", "pause", "seek"].includes(action)) return;

      if (
        String(request.videoId || "") !== String(state.currentVideoId || "") ||
        String(request.platform || "") !== String(state.playerType || "")
      ) return;

      let position = Number(request.position);
      if (!Number.isFinite(position)) position = await asyncCurrentPosition();
      position = Math.max(0, Math.min(86400, Number(position) || 0));

      if (action === "pause") {
        const issuedAt = playbackClockNow();
        const effectiveAt = issuedAt + getControlLeadMs();
        state.playbackAwaitingActualStart = false;
        clearTimeout(state.playbackActualStartTimer);
        state.playbackActualStartTimer = null;
        cancelScheduledLocalPause();
        cancelScheduledRemotePause();
        await pausePlayer();
        const actualPosition = await asyncCurrentPosition();
        await publishPlaybackEvent("pause", actualPosition, false, issuedAt, effectiveAt);
      } else if (action === "seek") {
        const wasPlaying = await asyncIsPlaying();
        markLocalPlaybackIntent("seek");
        await applyPlayerPosition(position);
        await publishPlaybackEvent("seek", position, wasPlaying, playbackClockNow());
      } else {
        cancelScheduledLocalPause();
        cancelScheduledRemotePause();
        state.playbackAwaitingActualStart = false;
        clearTimeout(state.playbackActualStartTimer);
        state.playbackActualStartTimer = null;
        const issuedAt = playbackClockNow();
        await playPlayer({muteForAutoplay: false});
        await publishPlaybackEvent(
          "play",
          position,
          true,
          issuedAt,
          issuedAt
        );
      }
    } catch (error) {
      console.warn("處理成員播放控制請求失敗:", error);
    } finally {
      try { await snapshot.ref.remove(); } catch (_) {}
    }
  }

  async function drainPlaybackControlRequests() {
    if (state.controlRequestProcessing) return;
    state.controlRequestProcessing = true;
    try {
      while (state.isOwner && state.controlRequestQueue.length) {
        const snapshot = state.controlRequestQueue.shift();
        await processPlaybackControlRequest(snapshot);
      }
    } finally {
      state.controlRequestProcessing = false;
    }
  }

  function attachPlaybackControlRequestListener() {
    if (!state.isOwner || !state.roomId || !state.uid) {
      detachPlaybackControlRequestListener();
      return;
    }

    const ref = controlRequestsRef();
    if (!ref) return;
    if (state.controlRequestListenerAttached && state.controlRequestRef) return;

    detachPlaybackControlRequestListener();
    const limited = ref.limitToLast(25);
    limited.on("child_added", snapshot => {
      state.controlRequestQueue.push(snapshot);
      void drainPlaybackControlRequests();
    });
    state.controlRequestRef = limited;
    state.controlRequestListenerAttached = true;
  }

  function timelineKey(event) {
    return `${String(event?.platform || "")}:${String(event?.videoId || "")}`;
  }
  function getTimelinePosition(timeline, now = playbackClockNow()) {
    const base = Math.max(0, Number(timeline?.position) || 0);
    const anchor = Number(timeline?.issuedAt || 0);
    const rate = Math.max(0.01, Number(timeline?.playbackRate) || 1);

    if (!Number.isFinite(anchor) || anchor <= 0) return base;

    if (
      timeline?.action === "pause" &&
      Number(timeline?.effectiveAt || 0) > anchor
    ) {
      const effectiveAt = Number(timeline.effectiveAt);
      const until = Math.min(now, effectiveAt);
      const elapsed = Math.max(0, (until - anchor) / 1000);
      return base + Math.min(elapsed * rate, 7200);
    }

    if (timeline?.playing !== true) return base;

    const elapsed = Math.max(0, (now - anchor) / 1000);
    return base + Math.min(elapsed * rate, 7200);
  }

  function rememberRoomTimeline(event) {
    if (!event || !event.eventId) return false;
    const incomingUpdatedAt =
      Number(event.updatedAt || 0);

    const currentUpdatedAt =
      Number(
        state.playbackTimeline?.updatedAt || 0
      );

    if (
      incomingUpdatedAt > 0 &&
      currentUpdatedAt > 0 &&
      incomingUpdatedAt < currentUpdatedAt
    ) {
      return false;
    }

    const issuedAt = Number(event.issuedAt || event.updatedAt || playbackClockNow());
    state.playbackRemoteEvent = event;
    state.playbackTimeline = {
      action: String(event.action || ""),
      videoId: String(event.videoId || ""),
      platform: String(event.platform || ""),
      position: Math.max(0, Number(event.position) || 0),
      playing: event.playing === true,
      ended: event.ended === true,
      playbackRate: Math.max(0.01, Number(event.playbackRate) || 1),
      issuedAt: Number.isFinite(issuedAt) && issuedAt > 0 ? issuedAt : playbackClockNow(),
      effectiveAt: Number(event.effectiveAt || 0),
      updatedAt: incomingUpdatedAt || 0,
      updatedBy: String(event.updatedBy || ""),
      eventId: String(event.eventId)
    };
    return true;
  }

  function roomTimelineMatchesPlayer() {
    const timeline = state.playbackTimeline;
    return Boolean(
      timeline &&
      String(timeline.videoId || "") === String(state.currentVideoId || "") &&
      String(timeline.platform || "") === String(state.playerType || "")
    );
  }

  function roomTimelinePlaying() {
    if (!roomTimelineMatchesPlayer()) return null;
    return state.playbackTimeline.playing === true;
  }

  function markLocalPlaybackIntent(kind = "") {
    state.playbackLocalIntentAt = Date.now();
    state.playbackUserActionKind = kind;
    state.playbackUserActionUntil = Date.now() + 900;
  }

  async function replayVideo() {
    if (
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId ||
      !["youtube", "vimeo", "dailymotion", "twitch"].includes(state.playerType)
    ) {
      return false;
    }

    cancelScheduledLocalPause();
    cancelScheduledRemotePause();
    cancelScheduledRemotePlay();
    cancelScheduledRemoteSeek();

    state.playbackAwaitingActualStart = false;
    clearTimeout(state.playbackActualStartTimer);
    state.playbackActualStartTimer = null;

    markLocalPlaybackIntent("replay");
    state.playbackSyncPhase = "user-action";
    state.playbackLocalControlUntil = Date.now() + 1000;
    state.playbackLocalSeekSuppressUntil = Date.now() + 1000;

    try {
      await applyPlayerPosition(0);
      await setPlaybackRateSafe(1);
      await playPlayer({ muteForAutoplay: false });

      const issuedAt = playbackClockNow();

      if (state.isOwner) {
        await publishPlaybackEvent(
          "play",
          0,
          true,
          issuedAt,
          issuedAt,
          false
        );
      } else {
        void requestPlaybackControl("seek", 0, true);
      }

      state.playbackLastPosition = 0;
      state.playbackLastPlaying = true;
      state.playbackLastPlayerState = "playing";
      return true;
    } catch (error) {
      console.warn("重播影片失敗:", error);
      return false;
    }
  }


  async function applyOptimisticLocalPlaybackAction(
    action,
    position = null,
    playing = null
  ) {
    if (
      !state.playerReady ||
      !state.player ||
      !["youtube", "vimeo", "dailymotion", "twitch"].includes(state.playerType)
    ) {
      return false;
    }

    const normalized =
      action === "pause"
        ? "pause"
        : action === "seek"
          ? "seek"
          : "play";

    state.playbackSyncPhase = "user-action";
    markLocalPlaybackIntent(normalized);
    state.playbackLocalControlUntil = Date.now() + 1000;
    state.playbackLocalSeekSuppressUntil = Date.now() + 1000;

    try {
      if (normalized === "seek") {
        await applyPlayerPosition(position);
        if (playing === true) {
          const active = await asyncIsPlaying();
          if (!active) await playPlayer();
        } else if (playing === false) {
          const active = await asyncIsPlaying();
          if (active) await pausePlayer();
        }
      } else if (normalized === "pause") {
        await pausePlayer();
      } else {
        await playPlayer();
      }

      state.playbackLastPosition =
        await asyncCurrentPosition().catch(() => Number(position) || 0);
      state.playbackLastPlaying =
        await asyncIsPlaying().catch(() => normalized === "play");

      return true;
    } catch (error) {
      console.warn("本機播放控制失敗:", error);
      return false;
    }
  }

  function cancelPendingPausePublish() {
    clearTimeout(state.playbackPausePublishTimer);
    state.playbackPausePublishTimer = null;
  }

  function cancelScheduledLocalPause() {
    clearTimeout(state.playbackLocalPauseTimer);
    state.playbackLocalPauseTimer = null;
  }

  function cancelScheduledRemotePause() {
    clearTimeout(state.playbackRemotePauseTimer);
    state.playbackRemotePauseTimer = null;
    state.playbackRemotePauseEventId = "";
  }

  function getControlLeadMs() {
    const connection =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;

    const browserRtt =
      Number(connection?.rtt);

    const measuredRtt =
      Number(
        state.playbackMeasuredRttMs || 0
      );

    let rtt =
      measuredRtt > 0
        ? measuredRtt
        : browserRtt;

    if (
      !Number.isFinite(rtt) ||
      rtt <= 0
    ) {
      rtt = 100;
    }

    return Math.max(
      80,
      Math.min(
        180,
        Math.round(
          rtt * 0.45 + 20
        )
      )
    );
  }

  function getPauseLeadMs() {
    return getControlLeadMs();
  }

  function rememberPlaybackWriteRtt(
    sampleMs
  ) {
    const sample =
      Number(sampleMs);

    if (
      !Number.isFinite(sample) ||
      sample <= 0 ||
      sample > 5000
    ) {
      return;
    }

    const samples =
      Array.isArray(
        state.playbackRttSamples
      )
        ? state.playbackRttSamples
        : [];

    samples.push(sample);

    while (samples.length > 8) {
      samples.shift();
    }

    state.playbackRttSamples =
      samples.slice();

    const sorted =
      samples.slice().sort(
        (a, b) => a - b
      );

    state.playbackMeasuredRttMs =
      sorted[
        Math.min(
          1,
          sorted.length - 1
        )
      ];
  }

  async function pauseAtPosition(position) {
    if (!state.playerReady || !state.player) return;

    state.playbackApplyingRemote = true;

    try {
      await pausePlayer();

      const target = Math.max(0, Number(position) || 0);
      const current = await asyncCurrentPosition().catch(() => target);

      if (Math.abs(current - target) >= 0.08) {
        await applyPlayerPosition(target);
      }

      await setPlaybackRateSafe(1);
      state.playbackLastPosition = await asyncCurrentPosition().catch(() => target);
      state.playbackLastPlaying = false;
    } finally {
      state.playbackApplyingRemote = false;
    }
  }

  function scheduleLocalPause(
    effectiveAt,
    position,
    eventId = ""
  ) {
    cancelScheduledLocalPause();

    const run = async () => {
      if (
        !state.roomId ||
        !state.playerReady ||
        !state.player
      ) {
        return;
      }

      const timeline =
        state.playbackTimeline;

      if (
        eventId &&
        timeline?.eventId &&
        String(timeline.eventId) !== String(eventId)
      ) {
        return;
      }

      await pauseAtPosition(position);

      if (
        !eventId ||
        String(state.playbackTimeline?.eventId || "") ===
          String(eventId)
      ) {
        state.playbackLocalScheduledEventId =
          "";
        state.playbackLocalControlUntil =
          0;
      }
    };

    const delay =
      Math.max(
        0,
        Number(effectiveAt) -
          playbackClockNow()
      );

    if (delay <= 8) {
      void run();
      return;
    }

    state.playbackLocalPauseTimer =
      setTimeout(() => {
        state.playbackLocalPauseTimer =
          null;
        void run();
      }, delay);
  }

  function scheduleLocalSeekReanchor(
    effectiveAt,
    position,
    eventId = ""
  ) {
    clearTimeout(
      state.playbackLocalSeekTimer
    );

    const run = async () => {
      if (
        !state.roomId ||
        !state.playerReady ||
        !state.player
      ) {
        return;
      }

      const timeline =
        state.playbackTimeline;

      if (
        eventId &&
        timeline?.eventId &&
        String(timeline.eventId) !== String(eventId)
      ) {
        return;
      }

      const currentPosition =
        await asyncCurrentPosition().catch(
          () => Number(position) || 0
        );

      const currentPlaying =
        await asyncIsPlaying().catch(
          () => false
        );

      const rate =
        Math.max(
          0.01,
          Number(
            state.playbackTimeline?.playbackRate ||
            1
          )
        );

      const effectiveClock =
        Number(effectiveAt || 0) ||
        playbackClockNow();

      const elapsedSinceEffective =
        Math.max(
          0,
          playbackClockNow() -
            effectiveClock
        ) / 1000;

      const expectedLocalPosition =
        currentPlaying
          ? Math.max(
              0,
              Number(position) || 0
            ) +
            elapsedSinceEffective *
              rate
          : Number(position) || 0;

      const shouldReanchor =
        currentPlaying
          ? currentPosition + 0.12 <
            expectedLocalPosition
          : Math.abs(
              currentPosition -
                expectedLocalPosition
            ) >= 0.08;

      if (shouldReanchor) {
        await applyPlayerPosition(
          expectedLocalPosition
        );
      }

      if (
        !eventId ||
        String(state.playbackTimeline?.eventId || "") ===
          String(eventId)
      ) {
        state.playbackLocalScheduledEventId =
          "";
        state.playbackLocalControlUntil =
          0;
        state.playbackLocalSeekSuppressUntil =
          Date.now() + 450;
      }
    };

    const delay =
      Math.max(
        0,
        Number(effectiveAt) -
          playbackClockNow()
      );

    if (delay <= 8) {
      void run();
      return;
    }

    state.playbackLocalSeekTimer =
      setTimeout(() => {
        state.playbackLocalSeekTimer =
          null;
        void run();
      }, delay);
  }

  function scheduleRemotePause(event) {
    cancelScheduledRemotePause();

    const eventId =
      String(event?.eventId || "");

    const effectiveAt =
      Number(event?.effectiveAt || 0);

    const target =
      getTimelinePosition(
        {
          ...event,
          action: "pause"
        },
        effectiveAt ||
          playbackClockNow()
      );

    const run = async () => {
      if (
        !state.roomId ||
        !state.playerReady ||
        !state.player
      ) {
        return;
      }

      const timeline =
        state.playbackTimeline;

      if (
        eventId &&
        timeline?.eventId &&
        String(timeline.eventId) !== eventId
      ) {
        return;
      }

      await pauseAtPosition(target);
    };

    const delay =
      effectiveAt > 0
        ? Math.max(
            0,
            effectiveAt -
              playbackClockNow()
          )
        : 0;

    state.playbackRemotePauseEventId =
      eventId;

    if (delay <= 8) {
      void run();
      return;
    }

    state.playbackRemotePauseTimer =
      setTimeout(() => {
        state.playbackRemotePauseTimer =
          null;
        state.playbackRemotePauseEventId =
          "";
        void run();
      }, delay);
  }

  function cancelScheduledRemotePlay() {
    clearTimeout(
      state.playbackRemotePlayTimer
    );

    state.playbackRemotePlayTimer =
      null;
  }

  function cancelScheduledRemoteSeek() {
    clearTimeout(
      state.playbackRemoteSeekTimer
    );

    state.playbackRemoteSeekTimer =
      null;
  }

  function scheduleRemotePlay(event) {
    cancelScheduledRemotePlay();

    const eventId =
      String(event?.eventId || "");

    const effectiveAt =
      Number(event?.effectiveAt || 0);

    const target =
      getTimelinePosition(
        event,
        effectiveAt ||
          playbackClockNow()
      );

    const run = async () => {
      if (
        !state.roomId ||
        !state.playerReady ||
        !state.player
      ) {
        return;
      }

      const timeline =
        state.playbackTimeline;

      if (
        eventId &&
        timeline?.eventId &&
        String(timeline.eventId) !== eventId
      ) {
        return;
      }

      state.playbackApplyingRemote =
        true;

      try {
        await applyPlayerPosition(
          target
        );

        await setPlaybackRateSafe(
          Number(
            event.playbackRate || 1
          )
        );

        if (
          event.playing === true
        ) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      } finally {
        state.playbackApplyingRemote =
          false;
      }
    };

    const delay =
      effectiveAt > 0
        ? Math.max(
            0,
            effectiveAt -
              playbackClockNow()
          )
        : 0;

    if (delay <= 8) {
      void run();
      return;
    }

    state.playbackRemotePlayTimer =
      setTimeout(() => {
        state.playbackRemotePlayTimer =
          null;
        void run();
      }, delay);
  }

  function scheduleRemoteSeek(event) {
    cancelScheduledRemoteSeek();

    const eventId =
      String(event?.eventId || "");

    const effectiveAt =
      Number(event?.effectiveAt || 0);

    const target =
      Math.max(
        0,
        Number(event?.position) || 0
      );

    const run = async () => {
      if (
        !state.roomId ||
        !state.playerReady ||
        !state.player
      ) {
        return;
      }

      const timeline =
        state.playbackTimeline;

      if (
        eventId &&
        timeline?.eventId &&
        String(timeline.eventId) !== eventId
      ) {
        return;
      }

      state.playbackApplyingRemote =
        true;

      try {
        await applyPlayerPosition(
          target
        );

        await setPlaybackRateSafe(
          Number(
            event.playbackRate || 1
          )
        );

        if (
          event.playing === true
        ) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      } finally {
        state.playbackApplyingRemote =
          false;
      }
    };

    const delay =
      effectiveAt > 0
        ? Math.max(
            0,
            effectiveAt -
              playbackClockNow()
          )
        : 0;

    if (delay <= 8) {
      void run();
      return;
    }

    state.playbackRemoteSeekTimer =
      setTimeout(() => {
        state.playbackRemoteSeekTimer =
          null;
        void run();
      }, delay);
  }

  function getLocalPlaybackRevision() {
    state.playbackActionSeq = Number(state.playbackActionSeq || 0) + 1;
    return state.playbackActionSeq;
  }

  async function writePlaybackCommand(
    action,
    position,
    playing,
    issuedAt = playbackClockNow(),
    effectiveAt = 0,
    ended = false
  ) {
    if (
      !state.isOwner ||
      !state.uid ||
      !state.roomId ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId ||
      state.playbackApplyingRemote
    ) return null;

    const ref = playbackSyncRef();
    if (!ref) return null;

    const roomVideoId =
      String(state.room?.video?.id || "");

    const activeVideoId =
      String(state.currentVideoId || "");

    if (
      roomVideoId &&
      activeVideoId &&
      roomVideoId !== activeVideoId
    ) {
      return null;
    }

    const finalPosition =
      Math.max(
        0,
        Number(position) || 0
      );
    const safeIssuedAt = Number.isFinite(Number(issuedAt)) && Number(issuedAt) > 0
      ? Number(issuedAt)
      : playbackClockNow();
    const revision = getLocalPlaybackRevision();
    const eventId = `${state.uid}-${revision}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const playbackRate = 1;
    const event = {
      action,
      position: finalPosition,
      videoId: String(state.currentVideoId),
      platform: String(state.playerType || ""),
      issuedAt: safeIssuedAt,
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid,
      eventId,
      playing: Boolean(playing),
      ended: Boolean(ended),
      playbackRate,
      ...(Number.isFinite(Number(effectiveAt)) && Number(effectiveAt) > 0
        ? { effectiveAt: Number(effectiveAt) }
        : {})
    };

    const localEvent = {
      ...event,
      updatedAt: 0
    };

    const previousTimeline =
      state.playbackTimeline;

    cancelScheduledRemotePause();
    cancelScheduledRemotePlay();
    cancelScheduledRemoteSeek();

    rememberRoomTimeline(localEvent);

    state.playbackLastRemoteEventId =
      eventId;

    state.playbackLastRemoteUpdatedAt =
      0;

    state.playbackLastPosition =
      finalPosition;

    state.playbackLastPlaying =
      Boolean(playing);

    const finalEffectiveAt =
      Number(event.effectiveAt || 0);

    if (
      finalEffectiveAt >
      safeIssuedAt
    ) {
      state.playbackLocalScheduledEventId =
        eventId;

      state.playbackLocalControlUntil =
        finalEffectiveAt + 500;
    } else {
      state.playbackLocalScheduledEventId =
        "";
      state.playbackLocalControlUntil =
        0;
    }

    try {
      const writeStartedAt =
        performance.now();

      await ref.set(event);

      rememberPlaybackWriteRtt(
        performance.now() -
          writeStartedAt
      );

      if (
        finalEffectiveAt >
        safeIssuedAt
      ) {
        if (action === "pause") {
          const localTarget =
            finalPosition +
            Math.max(
              0,
              finalEffectiveAt -
                safeIssuedAt
            ) / 1000 *
              playbackRate;

          scheduleLocalPause(
            finalEffectiveAt,
            localTarget,
            eventId
          );
        } else if (action === "seek") {
          scheduleLocalSeekReanchor(
            finalEffectiveAt,
            finalPosition,
            eventId
          );
        }
      }

      return event;
    } catch (error) {
      if (
        String(
          state.playbackTimeline?.eventId || ""
        ) === eventId
      ) {
        state.playbackTimeline =
          previousTimeline || null;
        state.playbackRemoteEvent =
          previousTimeline || null;
      }

      if (
        state.playbackLocalScheduledEventId ===
        eventId
      ) {
        state.playbackLocalScheduledEventId =
          "";
        state.playbackLocalControlUntil =
          0;
      }

      console.warn(
        "播放同步寫入失敗:",
        error
      );

      return null;
    }
  }

  function publishPlaybackEvent(
    action,
    position = null,
    explicitPlaying = undefined,
    issuedAtOverride = null,
    effectiveAt = 0,
    endedOverride = false
  ) {
    if (
      !state.isOwner ||
      !state.uid ||
      !state.roomId ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId ||
      state.playbackApplyingRemote
    ) return;
    if (state.playerType === "bilibili" || state.playerType === "external") return;
    if (Date.now() < Number(state.playbackAdGuardUntil || 0)) return;

    const roomVideoId =
      String(state.room?.video?.id || "");

    if (
      roomVideoId &&
      String(state.currentVideoId || "") !==
        roomVideoId
    ) {
      return;
    }

    const normalized = action === "pause" ? "pause" : action === "seek" ? "seek" : "play";
    markLocalPlaybackIntent(normalized);

    return (async () => {
      try {
        let finalPosition = Number(position);
        if (!Number.isFinite(finalPosition)) finalPosition = await asyncCurrentPosition();
        finalPosition = Math.max(0, Number(finalPosition) || 0);

        let playing;
        if (normalized === "pause") playing = false;
        else if (normalized === "play") playing = true;
        else if (typeof explicitPlaying === "boolean") playing = explicitPlaying;
        else playing = await asyncIsPlaying();

        const now = Date.now();
        const key = `${normalized}:${Math.round(finalPosition * 20) / 20}:${playing ? 1 : 0}`;
        if (key === state.playbackLastLocalActionKey && now - Number(state.playbackLastLocalActionAt || 0) < 120) return;
        if (normalized === "seek" && now - Number(state.playbackLastLocalSeekWriteAt || 0) < 100) return;
        state.playbackLastLocalActionKey = key;
        state.playbackLastLocalActionAt = now;
        if (normalized === "seek") state.playbackLastLocalSeekWriteAt = now;

        const issuedAt =
          Number.isFinite(
            Number(issuedAtOverride)
          ) &&
          Number(issuedAtOverride) > 0
            ? Number(issuedAtOverride)
            : playbackClockNow();

        const requestedEffectiveAt =
          Number.isFinite(
            Number(effectiveAt)
          ) &&
          Number(effectiveAt) > 0
            ? Number(effectiveAt)
            : 0;

        const syncEffectiveAt =
          normalized === "seek"
            ? (requestedEffectiveAt > 0
                ? requestedEffectiveAt
                : issuedAt + getControlLeadMs())
            : issuedAt;

        const timelineIssuedAt =
          normalized === "seek"
            ? syncEffectiveAt
            : issuedAt;

        await writePlaybackCommand(
          normalized,
          finalPosition,
          playing,
          timelineIssuedAt,
          syncEffectiveAt,
          endedOverride === true
        );
      } catch (error) {
        console.warn("播放控制同步寫入失敗:", error);
      }
    })();
  }

  async function enforceRoomPlayingState(wantPlaying) {
    if (!state.playerReady || !state.player || !state.currentVideoId) return false;
    if (state.playerType === "youtube" && state.playbackIsBuffering && wantPlaying) return false;
    try {
      const current = await asyncIsPlaying();
      if (current === wantPlaying) return true;
      if (wantPlaying) await playPlayer();
      else await pausePlayer();
      return (await asyncIsPlaying()) === wantPlaying;
    } catch (error) {
      console.warn("套用房間播放狀態失敗:", error);
      return false;
    }
  }

  function correctionPlaybackRate(drift, baseRate = 1) {
    const abs = Math.abs(drift);
    if (abs < 0.08) return baseRate;
    if (abs < 0.25) return baseRate * (drift > 0 ? 1.01 : 0.99);
    if (abs < 0.60) return baseRate * (drift > 0 ? 1.025 : 0.975);
    if (abs < 1.25) return baseRate * (drift > 0 ? 1.05 : 0.95);
    return baseRate;
  }

  function getYoutubeAvailablePlaybackRates() {
    if (
      state.playerType !== "youtube" ||
      !state.player ||
      typeof state.player.getAvailablePlaybackRates !== "function"
    ) {
      return [1];
    }

    const videoId = String(state.currentVideoId || "");
    const now = Date.now();
    if (
      state.playbackYoutubeRatesVideoId === videoId &&
      Array.isArray(state.playbackYoutubeRates) &&
      state.playbackYoutubeRates.length &&
      now - Number(state.playbackYoutubeRatesCheckedAt || 0) < 5000
    ) {
      return state.playbackYoutubeRates;
    }

    try {
      const rates = state.player
        .getAvailablePlaybackRates()
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      const normalized = rates.length ? [...new Set(rates)] : [1];
      if (!normalized.includes(1)) normalized.push(1);
      normalized.sort((a, b) => a - b);
      state.playbackYoutubeRates = normalized;
      state.playbackYoutubeRatesVideoId = videoId;
      state.playbackYoutubeRatesCheckedAt = now;
      return normalized;
    } catch (_) {
      state.playbackYoutubeRates = [1];
      state.playbackYoutubeRatesVideoId = videoId;
      state.playbackYoutubeRatesCheckedAt = now;
      return [1];
    }
  }

  async function detectYoutubeFineRateSupport() {
    if (
      state.playerType !== "youtube" ||
      !state.player ||
      typeof state.player.getPlaybackRate !== "function" ||
      typeof state.player.setPlaybackRate !== "function"
    ) {
      state.playbackFineRateSupported = false;
      return false;
    }

    if (state.playbackFineRateSupported !== null) {
      return state.playbackFineRateSupported === true;
    }

    try {
      const original =
        Number(state.player.getPlaybackRate()) || 1;

      const probe =
        original > 1.01
          ? 0.95
          : 1.05;

      state.player.setPlaybackRate(probe);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const actual =
        Number(state.player.getPlaybackRate()) || 1;

      state.player.setPlaybackRate(original);

      state.playbackFineRateSupported =
        Math.abs(actual - probe) <= 0.025;

      return state.playbackFineRateSupported;
    } catch (_) {
      state.playbackFineRateSupported = false;
      return false;
    }
  }

  function youtubeHasFinePlaybackCorrection() {
    return state.playbackFineRateSupported === true;
  }

  function chooseSupportedPlaybackRate(rate, rates) {
    const target = Math.max(0.25, Math.min(2, Number(rate) || 1));
    const list = Array.isArray(rates) && rates.length ? rates : [1];
    return list.reduce((best, current) =>
      Math.abs(current - target) < Math.abs(best - target)
        ? current
        : best
    , list[0]);
  }

  async function setPlaybackRateSafe(rate) {
    const requested = Math.max(0.5, Math.min(2, Number(rate) || 1));
    const type = state.playerType;
    const player = state.player;
    if (!player) return;

    let normalized = requested;

    try {
      if (type === "youtube" && typeof player.setPlaybackRate === "function") {
        const available = getYoutubeAvailablePlaybackRates();
        normalized = chooseSupportedPlaybackRate(requested, available);
        if (Math.abs(normalized - requested) > 0.001 && Math.abs(normalized - 1) < 0.001) {
          normalized = 1;
        }
        if (Array.isArray(available) && available.length === 1 && available[0] === 1) {
          normalized = 1;
        }
        if (Number.isFinite(Number(state.playbackAppliedRate)) && Math.abs(Number(state.playbackAppliedRate) - normalized) < 0.002) {
          return;
        }
        player.setPlaybackRate(normalized);
      } else if (type === "vimeo" && typeof player.setPlaybackRate === "function") {
        if (Number.isFinite(Number(state.playbackAppliedRate)) && Math.abs(Number(state.playbackAppliedRate) - normalized) < 0.002) return;
        await player.setPlaybackRate(normalized);
      } else if (type === "dailymotion" && typeof player.setPlaybackSpeed === "function") {
        if (Number.isFinite(Number(state.playbackAppliedRate)) && Math.abs(Number(state.playbackAppliedRate) - normalized) < 0.002) return;
        await player.setPlaybackSpeed(normalized);
      } else {
        return;
      }
      state.playbackAppliedRate = normalized;
    } catch (_) {}
  }

  async function hardSyncPlaybackToTimeline(event) {
    if (
      !event ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId
    ) {
      return false;
    }

    if (
      String(event.videoId || "") !==
        String(state.currentVideoId || "") ||
      String(event.platform || "") !==
        String(state.playerType || "")
    ) {
      return false;
    }

    const eventId = String(event.eventId || "");
    if (!eventId) return false;

    const now = Date.now();
    if (
      state.playbackInitialHardSyncEventId === eventId &&
      now - Number(state.playbackInitialHardSyncAt || 0) < 1200
    ) {
      return true;
    }

    rememberRoomTimeline(event);
    state.playbackLastRemoteEventId = eventId;
    state.playbackLastRemoteUpdatedAt = Number(event.updatedAt || 0);
    state.playbackApplyingRemoteEventId = eventId;
    state.playbackApplyingRemote = true;
    state.playbackPendingRecovery = true;
    state.playbackSyncPhase = "initializing";

    state.playbackInitialHardSyncUntil = now + 1400;
    state.playbackInitialHardSyncEventId = eventId;
    state.playbackInitialHardSyncAt = now;

    state.playbackIgnoreStateChanges = 6;
    state.playbackIgnoreStateUntil = now + 900;
    state.playbackLocalSeekSuppressUntil = now + 1400;

    cancelPendingPausePublish();
    cancelScheduledLocalPause();
    cancelScheduledRemotePause();
    cancelScheduledRemotePlay();
    cancelScheduledRemoteSeek();

    clearTimeout(state.playbackLocalSeekTimer);
    state.playbackLocalSeekTimer = null;
    state.playbackLocalScheduledEventId = "";
    state.playbackLocalControlUntil = 0;

    try {
      const target = getTimelinePosition(
        event,
        playbackClockNow()
      );

      await setPlaybackRateSafe(1);

      const current = await asyncCurrentPosition();

      if (
        !Number.isFinite(current) ||
        Math.abs(current - target) >= 0.02
      ) {
        await applyPlayerPosition(target);
      }

      await setPlaybackRateSafe(1);

      if (event.playing === true) {
        await playPlayer();
      } else {
        await pausePlayer();
      }

      await setPlaybackRateSafe(1);

      const settledPosition =
        await asyncCurrentPosition().catch(() => target);

      if (
        Math.abs(
          settledPosition -
            getTimelinePosition(event, playbackClockNow())
        ) >= 0.25
      ) {
        await applyPlayerPosition(
          getTimelinePosition(event, playbackClockNow())
        );
      }

      if (event.playing === true) {
        await playPlayer();
      } else {
        await pausePlayer();
      }

      state.playbackLastPosition =
        await asyncCurrentPosition().catch(() => target);
      state.playbackLastPlaying =
        await asyncIsPlaying().catch(
          () => event.playing === true
        );
      state.playbackLastObservedPosition =
        state.playbackLastPosition;
      state.playbackSyncPhase = "locked";

      if ($("syncStatus")) {
        $("syncStatus").textContent = "已鎖定同步";
      }

      return true;
    } catch (error) {
      console.warn("初始硬同步失敗:", error);
      return false;
    } finally {
      state.playbackApplyingRemote = false;
      state.playbackPendingRecovery = false;
      state.playbackApplyingRemoteEventId = null;
      state.playbackReadyAt = Date.now() + 450;
    }
  }

  async function applyRemotePlaybackEvent(event, force = false) {
    if (!event || !state.playerReady || !state.player || !state.currentVideoId) return;
    if (String(event.videoId || "") !== String(state.currentVideoId || "")) return;
    if (String(event.platform || "") !== String(state.playerType || "")) return;
    if (!["play", "pause", "seek"].includes(event.action)) return;
    if (state.playerType === "bilibili" || state.playerType === "external") return;

    const eventId = String(event.eventId || "");
    if (!eventId) return;

    if (force) {
      return hardSyncPlaybackToTimeline(event);
    }

    const incoming = Number(event.updatedAt || 0);
    const previous = Number(state.playbackLastRemoteUpdatedAt || 0);
    if (!force && incoming > 0 && previous > 0 && incoming < previous) return;
    if (!force && state.playbackLastRemoteEventId === eventId) return;
    if (!force && event.updatedBy === state.uid) return;

    rememberRoomTimeline(event);
    cancelPendingPausePublish();
    cancelScheduledRemotePause();

    if (event.action === "play" || event.action === "seek") {
      cancelScheduledLocalPause();
    }

    state.playbackLastRemoteEventId = eventId;
    if (incoming > 0) state.playbackLastRemoteUpdatedAt = incoming;

    state.playbackApplyingRemoteEventId = eventId;
    state.playbackApplyingRemote = true;
    state.playbackPendingRecovery = true;
    state.playbackAwaitingActualStart = false;
    clearTimeout(state.playbackActualStartTimer);
    state.playbackActualStartTimer = null;
    state.playbackIgnoreStateChanges = 3;
    state.playbackIgnoreStateUntil = Date.now() + 300;
    state.playbackReadyAt = Date.now() + 120;

    try {
      if (event.ended === true) {
        const endedPosition = Math.max(0, Number(event.position) || 0);
        const endedPlaying = await asyncIsPlaying();

        if (endedPlaying) {
          await pausePlayer();
        }

        const endedCurrent = await asyncCurrentPosition().catch(() => endedPosition);

        if (Math.abs(endedCurrent - endedPosition) >= 0.08) {
          await applyPlayerPosition(endedPosition);
        }

        await setPlaybackRateSafe(1);
        state.playbackLastPosition = endedPosition;
        state.playbackLastPlaying = false;
        state.playbackLastPlayerState = "ended";
        state.playbackReadyAt = Date.now() + 120;

        if ($("syncStatus")) {
          $("syncStatus").textContent =
            "影片結束 " + formatTime(endedPosition);
        }

        return;
      }

      const effectiveAt =
        Number(event.effectiveAt || 0);

      if (
        effectiveAt >
        playbackClockNow() + 8
      ) {
        state.playbackApplyingRemote =
          false;

        if (event.action === "pause") {
          scheduleRemotePause(event);
        } else if (event.action === "play") {
          scheduleRemotePlay(event);
        } else if (event.action === "seek") {
          scheduleRemoteSeek(event);
        }

        return;
      }

      const expected =
        getTimelinePosition(event);

      const current =
        await asyncCurrentPosition();

      const drift =
        expected - current;

      const absDrift =
        Math.abs(drift);

      const useYoutubeFineRate =
        state.playerType === "youtube" &&
        state.playbackFineRateSupported === true;

      const youtubeHardSeekThreshold =
        1.0;

      if (event.action === "pause") {
        if (await asyncIsPlaying()) {
          await pausePlayer();
        }

        const target = getTimelinePosition(
          { ...event, action: "pause" },
          effectiveAt || playbackClockNow()
        );

        const pausedPosition =
          await asyncCurrentPosition().catch(() => target);

        if (Math.abs(pausedPosition - target) >= 0.08) {
          await applyPlayerPosition(target);
        }

        await setPlaybackRateSafe(1);
        state.playbackReadyAt = Date.now() + 80;
      } else if (event.action === "seek") {
        if (Math.abs(current - expected) > 0.08) {
          await applyPlayerPosition(expected);
        }
        const seekPlaying = await asyncIsPlaying();
        if (event.playing === true && !seekPlaying) {
          await playPlayer();
        } else if (event.playing !== true && seekPlaying) {
          await pausePlayer();
        }
        await setPlaybackRateSafe(1);
      } else {
        if (!state.playbackIsBuffering) {
          const shouldSeek =
            state.playerType === "youtube"
              ? absDrift >= youtubeHardSeekThreshold && !useYoutubeFineRate
              : absDrift >= 1.0;

          if (shouldSeek) {
            try {
              await applyPlayerPosition(expected);
            } finally {
              state.playbackApplyingRemote = true;
            }
            await setPlaybackRateSafe(1);
          } else if (state.playerType !== "youtube" || useYoutubeFineRate) {
            const correction = correctionPlaybackRate(drift, 1);
            await setPlaybackRateSafe(correction);
          } else {
            await setPlaybackRateSafe(1);
          }
        }

        if (event.playing === true && !state.playbackIsBuffering) {
          const alreadyPlaying = await asyncIsPlaying();
          if (!alreadyPlaying) {
            await playPlayer();
          }
        } else if (event.playing !== true) {
          const alreadyPlaying = await asyncIsPlaying();
          if (alreadyPlaying) {
            await pausePlayer();
          }
        }
      }

      state.playbackLastPosition = await asyncCurrentPosition();
      state.playbackLastPlaying = await asyncIsPlaying();
      if ($("syncStatus")) {
        const target = event.action === "pause" ? Number(event.position || 0) : expected;
        $("syncStatus").textContent = `已同步 ${formatTime(target)}`;
      }
    } catch (error) {
      console.warn("套用房間播放命令失敗:", error);
    } finally {
      state.playbackApplyingRemote = false;
      state.playbackPendingRecovery = false;
      state.playbackApplyingRemoteEventId = null;
      if (event.action === "play" && state.playbackIsBuffering) {
        state.playbackReadyAt = Date.now() + 100;
      }
    }
  }

  async function applyLatestRoomPlaybackState(force = true) {
    const ref = playbackSyncRef();
    if (!ref || !state.playerReady || !state.player || !state.currentVideoId) return;
    try {
      const event = (await ref.once("value")).val();
      if (!event || !event.eventId) return;
      if (!roomTimelineMatchesPlayer() || timelineKey(event) !== `${state.playerType}:${state.currentVideoId}`) {
        if (String(event.videoId || "") !== String(state.currentVideoId || "")) return;
      }
      rememberRoomTimeline(event);
      await applyRemotePlaybackEvent(event, force);
    } catch (error) {
      state.playbackPendingRecovery = false;
      console.warn("讀取最新房間播放時間軸失敗:", error);
    }
  }

  function attachPlaybackSyncListener() {
    if (!state.roomRef || state.playbackListenerAttached) return;
    const ref = playbackSyncRef();
    if (!ref) return;
    ref.on("value", handleRemotePlaybackSnapshot);
    state.playbackListenerAttached = true;
  }

  function handleRemotePlaybackSnapshot(snapshot) {
    const event = snapshot?.val?.() || null;
    if (!event || !event.eventId) return;
    if (!rememberRoomTimeline(event)) return;
    if (event.updatedBy === state.uid) return;
    if (state.playbackLastRemoteEventId === String(event.eventId)) return;
    state.playbackPendingRecovery = true;
    void applyRemotePlaybackEvent(event, false);
  }

  function stopPlaybackSeekDetector() {
    clearInterval(state.playbackSeekTimer);
    state.playbackSeekTimer = null;
    state.playbackLastPosition = null;
    state.playbackLastPlaying = null;
    state.playbackLastPlayerState = null;
    state.playbackLastObservedPosition = null;
    state.playbackIsBuffering = false;
    state.playbackYoutubeRates = null;
    state.playbackYoutubeRatesVideoId = "";
    state.playbackYoutubeRatesCheckedAt = 0;
    state.playbackAppliedRate = null;
    state.playbackAwaitingActualStart = false;
    clearTimeout(state.playbackActualStartTimer);
    state.playbackActualStartTimer = null;
  }

  async function reconcileRoomTimeline() {
    if (!state.playerReady || !state.player || !state.currentVideoId) return;
    if (state.playbackApplyingRemote) return;
    if (state.playbackReconcileInFlight) return;

    state.playbackReconcileInFlight = true;

    try {

    const timeline = state.playbackTimeline;
    if (!roomTimelineMatchesPlayer()) return;
    if (state.playerType === "youtube" && state.playbackIsBuffering) return;

    const now = playbackClockNow();
    const position = await asyncCurrentPosition();
    const playing = await asyncIsPlaying();
    const previousObservedPosition =
      Number(
        state.playbackLastObservedPosition
      );

    const expected =
      getTimelinePosition(
        timeline,
        now
      );
    const drift = expected - position;
    const absDrift = Math.abs(drift);

    state.playbackLastObservedPosition =
      position;

    if (
      Date.now() <
      Number(
        state.playbackTransientStateUntil || 0
      )
    ) {
      return;
    }

    if (
      state.playbackSyncPhase === "initializing" ||
      state.playbackSyncPhase === "recovering" ||
      Date.now() <
      Number(
        state.playbackInitialHardSyncUntil || 0
      )
    ) {
      return;
    }

    if (
      Date.now() <
        Number(state.playbackUserActionUntil || 0) ||
      Date.now() <
        Number(state.playbackLocalControlUntil || 0)
    ) {
      return;
    }

    if (
      Date.now() <
      Number(
        state.playbackReadyAt || 0
      )
    ) {
      return;
    }

    const seekJump =
      Number.isFinite(
        previousObservedPosition
      ) &&
      Math.abs(
        position -
        previousObservedPosition
      ) >= 1.25;

    if (
      seekJump &&
      Date.now() >=
        Number(
          state.playbackResumeRecoveryUntil || 0
        ) &&
      Date.now() >=
        Number(
          state.playbackLocalSeekSuppressUntil || 0
        ) &&
      Date.now() >=
        Number(
          state.playbackLocalControlUntil || 0
        ) &&
      Date.now() >=
        Number(
          state.playbackAdGuardUntil || 0
        )
    ) {
      publishPlaybackEvent(
        "seek",
        position,
        playing,
        playbackClockNow()
      );

      state.playbackLastObservedPosition =
        position;

      return;
    }

    const pendingEffectiveAt =
      Number(timeline.effectiveAt || 0);

    if (
      pendingEffectiveAt >
      now + 8
    ) {
      if (
        String(
          state.playbackLocalScheduledEventId || ""
        ) ===
        String(
          timeline.eventId || ""
        )
      ) {
        return;
      }

      if (timeline.action === "pause") {
        if (!playing) {
          await enforceRoomPlayingState(true);
        }
      } else if (timeline.action === "play") {
        if (playing) {
          await enforceRoomPlayingState(false);
        }
      } else if (timeline.action === "seek") {
        await enforceRoomPlayingState(
          timeline.playing === true
        );
      }

      return;
    }

    if (timeline.playing) {
      if (!playing && !state.playbackIsBuffering) {
        await enforceRoomPlayingState(true);
      }

      if (state.playerType === "youtube") {
        const fineRate = state.playbackFineRateSupported === true;

        if (absDrift >= 1.0) {
          state.playbackSyncPhase = "hard-correcting";
          state.playbackApplyingRemote = true;
          try {
            await applyPlayerPosition(expected);
            await setPlaybackRateSafe(1);
          } catch (error) {
            console.warn("播放位置校正失敗:", error);
          } finally {
            state.playbackApplyingRemote = false;
          }
          state.playbackSyncPhase = "locked";
        } else if (fineRate && absDrift >= 0.1) {
          state.playbackSyncPhase = "correcting";
          const rate =
            1 +
            Math.max(
              -0.05,
              Math.min(
                0.05,
                drift * 0.05
              )
            );
          await setPlaybackRateSafe(rate);
        } else {
          state.playbackSyncPhase = "locked";
          await setPlaybackRateSafe(1);
        }
      } else if (absDrift >= 1.0) {
        state.playbackApplyingRemote = true;
        try {
          await applyPlayerPosition(expected);
          await setPlaybackRateSafe(1);
        } catch (error) {
          console.warn("播放位置校正失敗:", error);
        } finally {
          state.playbackApplyingRemote = false;
        }
      } else {
        const rate = correctionPlaybackRate(drift, timeline.playbackRate || 1);
        await setPlaybackRateSafe(rate);
      }
    } else {
      state.playbackSyncPhase = "locked";
      if (playing) {
        await enforceRoomPlayingState(false);
      }

      const target = getTimelinePosition(timeline, now);

      if (Math.abs(position - target) >= 0.08) {
        state.playbackApplyingRemote = true;
        try {
          await applyPlayerPosition(target);
        } catch (_) {}
        finally { state.playbackApplyingRemote = false; }
      }

      await setPlaybackRateSafe(1);
    }

    state.playbackLastObservedPosition =
      await asyncCurrentPosition().catch(
        () => position
      );

    if ($("syncStatus")) {
      if (absDrift < 0.08) {
        $("syncStatus").textContent = "同步鎖定";
      } else if (timeline.playing) {
        $("syncStatus").textContent = `同步中 ${drift >= 0 ? "+" : ""}${drift.toFixed(2)}s`;
      }
    }
     } finally {
      state.playbackReconcileInFlight = false;
    }
  }

  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();
    state.playbackReadyAt = Date.now() + 400;
    state.playbackSeekTimer = setInterval(() => {
      void reconcileRoomTimeline();
    }, 500);
  }

  function recoverPlaybackAfterPageResume() {
    clearTimeout(
      state.playbackRecoveryTimer
    );

    state.playbackRecoveryTimer =
      setTimeout(
        async () => {
          state.playbackRecoveryTimer =
            null;

          state.playbackSyncPhase = "recovering";
          state.playbackResumeRecoveryUntil =
            Date.now() + 2200;

          const ref =
            playbackSyncRef();

          try {
            const directVideo =
              $("directVideo");

            if (
              state.playerType === "youtube" &&
              state.player &&
              directVideo?.error
            ) {
              await refreshYoutubeStreamIfNeeded(
                "page-resume"
              );
            }

            if (ref) {
              const event =
                (
                  await ref.once("value")
                ).val();

              if (
                event &&
                event.eventId &&
                String(event.videoId || "") === String(state.currentVideoId || "") &&
                String(event.platform || "") === String(state.playerType || "")
              ) {
                rememberRoomTimeline(event);
                await hardSyncPlaybackToTimeline(event);
              }
            }
          } catch (error) {
            console.warn(
              "恢復同步時間軸失敗:",
              error
            );
          }

          state.playbackLocalSeekSuppressUntil =
            Date.now() + 1800;

          state.playbackSyncPhase = "locked";
          startPlaybackSeekDetector();

          setTimeout(() => {
            if (
              state.roomId &&
              state.playerReady &&
              state.player
            ) {
              void reconcileRoomTimeline();
            }
          }, 120);
        },
        120
      );
  }

  /*
   * =========================================================
   * ROOM UI
   * =========================================================
   */





  function updateRoomOwnerUI() {
    const element =
      $("roomOwnerStatus");

    if (element) {
      element.textContent =
        state.adminJoinOverride
          ? "🛠️ 管理員 · 房主權限"
          : state.isOwner
            ? "👑 房主"
            : "👥 成員";
    }

    const playbackControlSupported =
      [
        "youtube",
        "vimeo",
        "dailymotion",
        "twitch"
      ].includes(
        state.playerType
      );

    const changeSourceButton =
      $("changeSourceBtn");

    if (changeSourceButton) {
      const canChangeSource =
        Boolean(
          state.roomId &&
          state.uid &&
          state.room
        );

      changeSourceButton.disabled =
        !canChangeSource;

      changeSourceButton.title =
        canChangeSource
          ? "所有房間成員都可以更換影片"
          : "目前尚未進入房間";
    }

    [
      "playPauseBtn",
      "backBtn",
      "forwardBtn"
    ].forEach((id) => {
      const button =
        $(id);

      if (!button) {
        return;
      }

      const canControl =
        Boolean(
          state.roomId &&
          state.uid &&
          state.wasMemberInRoom &&
          state.playerReady &&
          state.player &&
          playbackControlSupported
        );

      button.disabled =
        !canControl;

      if (!playbackControlSupported) {
        button.title =
          "此平台目前不支援本站播放控制";
      } else if (!state.isOwner) {
        button.title =
          "送出控制請求，由房主執行";
      } else {
        button.title =
          "";
      }
    });

    const queueButton =
      $("playQueueNowBtn");

    if (queueButton) {
      queueButton.disabled =
        !state.isOwner ||
        !playbackControlSupported;

      if (!state.isOwner) {
        queueButton.title =
          "只有房主可以立即播放待播放清單";
      } else if (!playbackControlSupported) {
        queueButton.title =
          "此平台目前不支援本站播放控制";
      } else {
        queueButton.title =
          "";
      }
    }
  }


  /*
   * =========================================================
   * MEMBERS
   * =========================================================
   */

  async function isMemberKicked() {
    if (!state.kickedRef) {
      return false;
    }

    try {
      const snapshot = await state.kickedRef.once("value");
      const value = snapshot.val();

      if (value === true) {
        return false;
      }

      if (!value || typeof value !== "object") {
        return false;
      }

      const kickedAt = Number(value.kickedAt || 0);

      if (!Number.isFinite(kickedAt) || kickedAt <= 0) {
        return false;
      }

      return Date.now() - kickedAt < 5 * 60 * 1000;
    } catch (error) {
      console.warn("讀取踢出狀態失敗:", error);
      return false;
    }
  }

  async function getKickRemainingMs(roomId, uid) {
    if (!db || !roomId || !uid) {
      return 0;
    }

    try {
      const snapshot = await db.ref(`kicked/${roomId}/${uid}`).once("value");
      const value = snapshot.val();

      if (value === true) {
        return 0;
      }

      const kickedAt = Number(value?.kickedAt || 0);
      if (!Number.isFinite(kickedAt) || kickedAt <= 0) {
        return 0;
      }

      return Math.max(0, 5 * 60 * 1000 - (Date.now() - kickedAt));
    } catch (_) {
      return 0;
    }
  }


  async function handleKickState() {
    if (state.adminJoinOverride) return false;
    if (!state.kickedRef || !state.roomId || !state.uid) {
      return false;
    }

    if (!(await isMemberKicked())) {
      return false;
    }

    await leaveRoomLocally("你已被房主移出房間");
    return true;
  }


  function attachKickListener() {
    if (!state.kickedRef) {
      return;
    }

    state.kickedRef.off();
    state.kickedRef.on("value", () => {
      if (!state.roomId || !state.uid) {
        return;
      }

      void handleKickState();
    });
  }


  function isMemberPresenceLive(member, now = Date.now()) {
    if (!member || typeof member !== "object") {
      return false;
    }

    if (member.online !== true) {
      return false;
    }

    const lastSeen = Number(member.lastSeen || 0);

    return (
      Number.isFinite(lastSeen) &&
      lastSeen > 0 &&
      lastSeen >= now - MEMBER_PRESENCE_TIMEOUT_MS
    );
  }


  function countLiveMembers(members, now = Date.now()) {
    return Object.values(members || {}).filter(
      member => isMemberPresenceLive(member, now)
    ).length;
  }


  async function markMemberOnline() {
    if (
      !state.membersRef ||
      !state.uid
    ) {
      return false;
    }

    if (
      !(await waitForDatabaseConnection())
    ) {
      return false;
    }

    const memberRef =
      state.membersRef.child(
        state.uid
      );

    if (!state.adminJoinOverride && await isMemberKicked()) {
      await leaveRoomLocally("你已被房主移出房間");
      return false;
    }

    try {
      let publicProfile = null;

      if (
        auth?.currentUser &&
        !auth.currentUser.isAnonymous
      ) {
        publicProfile = (
          await db
            .ref("profiles/" + state.uid)
            .once("value")
            .catch(() => null)
        )?.val?.() || null;
      }

      const existingSnapshot =
        await memberRef
          .once("value")
          .catch(() => null);

      const existingMember =
        existingSnapshot?.val?.() || {};

      const existingJoinedAt =
        Number(existingMember.joinedAt || 0);

      const memberData = {
        name:
          state.memberName,

        joinedAt:
          Number.isFinite(existingJoinedAt) &&
          existingJoinedAt > 0
            ? existingJoinedAt
            : firebase.database.ServerValue.TIMESTAMP,

        online:
          true,

        lastSeen:
          firebase.database
            .ServerValue
            .TIMESTAMP
      };

      const publicCode =
        String(
          publicProfile?.publicCode || ""
        )
          .trim()
          .toUpperCase();

      const avatarEmoji =
        String(
          publicProfile?.avatarEmoji || ""
        ).slice(0, 4);

      if (/^[A-Z0-9]{6}$/.test(publicCode)) {
        memberData.publicCode = publicCode;
      }

      if (avatarEmoji) {
        memberData.avatarEmoji = avatarEmoji;
      }

      await memberRef.set(
        memberData
      );

      await memberRef
        .onDisconnect()
        .update({
          online: false,
          lastSeen:
            firebase.database.ServerValue.TIMESTAMP
        });

      const confirmed =
        await memberRef
          .once("value")
          .catch(
            () => null
          );

      if (!confirmed?.exists()) {
        console.warn(
          "成員節點建立後無法確認"
        );
        return false;
      }

      state.wasMemberInRoom =
        true;

      return true;
    } catch (error) {
      console.warn(
        "成員狀態寫入失敗:",
        error
      );
      return false;
    }
  }


  async function heartbeatMember() {
    if (
      !state.membersRef ||
      !state.uid ||
      state.leavingRoom ||
      state.databaseConnected !== true
    ) {
      return;
    }

    try {
      if (!state.adminJoinOverride && await isMemberKicked()) {
        await leaveRoomLocally("你已被房主移出房間");
        return;
      }

      const memberRef =
        state.membersRef.child(state.uid);

      const snapshot =
        await memberRef.once("value");

      if (!snapshot.exists()) {
        await markMemberOnline();
        return;
      }

      await memberRef.update({
        online: true,
        lastSeen:
          firebase.database.ServerValue.TIMESTAMP
      });

      state.wasMemberInRoom = true;
    } catch (error) {
      if (!state.leavingRoom) {
        console.warn(
          "Firebase 成員 heartbeat 失敗:",
          error
        );
      }
    }
  }


  /*
   * 房主踢人。
   *
   * 做法：
   * 1. 由房主刪除對方 members/uid
   * 2. 對方自己的 member listener 發現自己消失
   * 3. 對方自動離開房間
   *
   * 這樣不用碰播放同步 state。
   */

  async function kickMember(
    targetUid,
    targetName
  ) {
    if (!state.isOwner) {
      toast("只有房主可以踢人");
      return;
    }

    if (!targetUid || targetUid === state.uid) {
      return;
    }

    if (!state.membersRef || !state.roomId) {
      toast("目前不在房間內");
      return;
    }

    const confirmed = window.confirm(
      `確定要踢出「${targetName || "這名成員"}」嗎？`
    );

    if (!confirmed) return;

    try {
      await db
        .ref(`kicked/${state.roomId}/${targetUid}`)
        .set({
          kickedAt: firebase.database.ServerValue.TIMESTAMP,
          kickedBy: state.uid
        });

      await state.membersRef
        .child(targetUid)
        .remove();

      toast(`已踢出 ${targetName || "成員"}`);
    } catch (error) {
      console.error("踢人失敗:", error);
      toast(error?.message || "踢人失敗，請檢查 Firebase Rules");
    }
  }


  /*
   * 被踢後立即離開。
   */

  async function transferOwnershipBeforeLeave() {
    if (
      state.adminJoinOverride ||
      !state.isOwner ||
      !state.roomId ||
      !state.uid
    ) {
      return null;
    }

    const roomIdAtTransfer =
      String(state.roomId);
    const roomRefAtTransfer =
      state.roomRef;
    const oldOwnerUid =
      String(state.uid);

    state.ownerFailoverSequence =
      Number(state.ownerFailoverSequence || 0) + 1;

    const members =
      await getMembersOnce();

    if (
      String(state.roomId || "") !== roomIdAtTransfer ||
      state.roomRef !== roomRefAtTransfer ||
      String(state.uid || "") !== oldOwnerUid
    ) {
      return null;
    }

    const candidates =
      Object.entries(
        members || {}
      )
        .filter(
          ([uid, member]) =>
            uid !== state.uid &&
            isMemberPresenceLive(member) &&
            member &&
            typeof member === "object"
        )
        .sort(
          ([, a], [, b]) => {
            const onlineDiff =
              Boolean(b?.online) -
              Boolean(a?.online);

            if (onlineDiff !== 0) {
              return onlineDiff;
            }

            return (
              Number(a?.joinedAt || 0) -
              Number(b?.joinedAt || 0)
            );
          }
        );

    if (!candidates.length) {
      return null;
    }

    const nextOwnerUid =
      candidates[0][0];

    /*
     * roomMeta 只是建立房間時的索引。
     * 真正的房主只以 rooms/{roomId}/owner 為準，
     * 因此轉移房主時只更新 rooms。
     */
    const result =
      await roomRefAtTransfer
        .child("owner")
        .transaction(
          currentOwner => {
            if (
              String(currentOwner || "") !==
              oldOwnerUid
            ) {
              return;
            }

            if (
              !members?.[nextOwnerUid]
            ) {
              return;
            }

            return nextOwnerUid;
          }
        );

    if (!result.committed) {
      return null;
    }

    try {
      await roomRefAtTransfer
        ?.child("owner")
        .onDisconnect()
        .cancel();
    } catch (_) {}

    return nextOwnerUid;
  }


  async function scheduleOwnerFailover() {
    if (
      state.adminJoinOverride ||
      !state.isOwner ||
      !state.roomId ||
      !state.uid ||
      !state.roomRef
    ) {
      return;
    }

    const sequence =
      Number(state.ownerFailoverSequence || 0) + 1;

    state.ownerFailoverSequence =
      sequence;

    const roomIdAtSchedule =
      String(state.roomId);

    const roomRefAtSchedule =
      state.roomRef;

    const ownerUidAtSchedule =
      String(state.uid);

    const members =
      await getMembersOnce();

    if (
      sequence !==
        Number(state.ownerFailoverSequence || 0) ||
      String(state.roomId || "") !==
        roomIdAtSchedule ||
      state.roomRef !== roomRefAtSchedule ||
      String(state.uid || "") !==
        ownerUidAtSchedule ||
      !state.isOwner
    ) {
      return;
    }

    const candidates =
      Object.entries(
        members || {}
      )
        .filter(
          ([uid, member]) =>
            uid !== state.uid &&
            isMemberPresenceLive(member) &&
            member &&
            typeof member === "object"
        )
        .sort(
          ([, a], [, b]) =>
            (
              Boolean(b?.online) -
              Boolean(a?.online)
            ) ||
            (
              Number(a?.joinedAt || 0) -
              Number(b?.joinedAt || 0)
            )
        );

    if (!candidates.length) {
      return;
    }

    const nextOwnerUid =
      candidates[0][0];

    try {
      await roomRefAtSchedule
        .child("owner")
        .onDisconnect()
        .set(nextOwnerUid);
    } catch (error) {
      console.warn(
        "房主斷線轉移設定失敗:",
        error
      );
    }
  }


  async function exitCurrentRoom() {
    if (
      !state.roomId
    ) {
      return;
    }

    const leftRoomId =
      String(
        state.roomId || ""
      );

    const leftRoomName =
      String(
        state.room?.name ||
        $("roomTitle")?.textContent ||
        "一起看"
      )
        .trim() ||
      "一起看";

    state.leavingRoom =
      true;

    if (
      state.isOwner &&
      !state.adminJoinOverride
    ) {
      try {
        const nextOwner =
          await transferOwnershipBeforeLeave();

        if (!nextOwner) {
          /*
           * 房內沒有其他成員時，不做錯誤的 owner 刪除，
           * 只離開目前頁面。房間資料會保留。
           */
        }
      } catch (error) {
        /*
         * 房主轉移失敗不能阻止使用者離開。
         * 讓成員先正常退出，避免卡在房間頁。
         */
        console.warn(
          "離開房間時轉移房主失敗:",
          error
        );
      }
    }

    try {
      if (
        state.membersRef &&
        state.uid
      ) {
        await state.membersRef
          .child(
            state.uid
          )
          .remove();
      }
    } catch (error) {
      console.warn(
        "離開房間時移除成員失敗:",
        error
      );
    }

    await leaveRoomLocally();
  }


  async function leaveRoomLocally(
    reason = ""
  ) {
    const leftRoomId =
      String(
        state.roomId || ""
      );

    const leftRoomName =
      String(
        state.room?.name ||
        $("roomTitle")?.textContent ||
        "一起看"
      )
        .trim() ||
      "一起看";

    const hadSuccessfulMembership =
      state.wasMemberInRoom === true;

    state.kickedLocally =
      true;

    clearInterval(
      state.localTimer
    );

    try {
      const memberRef =
        state.membersRef?.child(
          state.uid || ""
        );

      if (
        memberRef &&
        state.uid &&
        state.membersRef
      ) {
        await memberRef.onDisconnect().cancel();
      }
    } catch (_) {}

    clearInterval(
      state.memberHeartbeatTimer
    );

    clearTimeout(
      state.playbackRecoveryTimer
    );

    state.playbackRecoveryTimer =
      null;

    disconnectRoomListeners();

    ++state.youtubeBuildToken;

    state.youtubeRequestedId =
      null;

    state.youtubeLoading =
      false;

    await destroyCurrentPlayer();

    state.roomId =
      null;

    state.roomRef =
      null;

    state.membersRef =
      null;

    state.kickedRef =
      null;

    state.chatRef =
      null;

    state.queueRef =
      null;

    state.room =
      null;

    state.isOwner =
      false;

    state.wasMemberInRoom =
      false;

    state.timeUiRequestId =
      Number(
        state.timeUiRequestId || 0
      ) + 1;

    state.kickedLocally =
      false;

    state.leavingRoom =
      false;

    if (
      leftRoomId &&
      hadSuccessfulMembership &&
      window.WT_ENHANCEMENTS?.rememberRoom
    ) {
      try {
        window.WT_ENHANCEMENTS.rememberRoom(
          leftRoomId,
          leftRoomName
        );
      } catch (_) {}
    }

    clearSavedRoomId();

    history.replaceState(
      {},
      "",
      location.pathname
    );

    showView(
      "home"
    );

    if (reason) {
      toast(reason);
    }
  }


  /*
   * =========================================================
   * ENTER ROOM
   * =========================================================
   */

  async function syncRoomMetaOwner(ownerUid = state.uid) {
    const normalizedOwnerUid =
      String(ownerUid || "").trim();

    if (state.adminJoinOverride) {
      return true;
    }

    if (
      !db ||
      !state.roomId ||
      !state.roomRef ||
      !normalizedOwnerUid
    ) {
      return false;
    }

    const roomIdAtSync =
      String(state.roomId);

    const roomRefAtSync =
      state.roomRef;

    try {
      const ownerSnapshot =
        await roomRefAtSync
          .child("owner")
          .once("value");

      if (
        String(ownerSnapshot.val() || "") !==
        normalizedOwnerUid
      ) {
        return false;
      }

      if (
        String(state.roomId || "") !==
          roomIdAtSync ||
        state.roomRef !==
          roomRefAtSync
      ) {
        return false;
      }

      await db
        .ref(
          `roomMeta/${roomIdAtSync}/owner`
        )
        .set(normalizedOwnerUid);

      return true;
    } catch (error) {
      console.warn(
        "同步 roomMeta 房主失敗:",
        error
      );
      return false;
    }
  }


  function attachRoomOwnerListener() {
    if (
      !state.roomRef ||
      state.roomOwnerListenerAttached
    ) {
      return;
    }

    state.roomRef
      .child("owner")
      .on(
        "value",
        (snapshot) => {
          if (
            !state.roomId ||
            !state.uid
          ) {
            return;
          }

          const ownerUid =
            snapshot.val() ||
            null;

          if (state.room) {
            state.room.owner =
              ownerUid;
          }

          const nextIsOwner =
            state.adminJoinOverride ||
            ownerUid ===
            state.uid;

          if (
            state.isOwner !==
            nextIsOwner
          ) {
            state.isOwner =
              nextIsOwner;

            updateRoomOwnerUI();

            if (state.isOwner && !state.adminJoinOverride) {
              attachPlaybackControlRequestListener();
              void syncRoomMetaOwner(ownerUid);
              void reconcileRoomTimeline();
            } else if (!state.isOwner) {
              detachPlaybackControlRequestListener();
            }
          }
        }
      );

    state.roomOwnerListenerAttached =
      true;
  }


  async function enterRoom() {
    attachServerClockSync();
    attachDatabaseConnectionListener();
    showView(
      "room"
    );

    if ($("roomTitle")) {
      $("roomTitle")
        .textContent =
        state.room?.name ||
        "一起看";
    }

    if ($("roomCodeLabel")) {
      $("roomCodeLabel")
        .textContent =
        state.roomId;
    }

    updateRoomOwnerUI();

    state.roomRef =
      db.ref(
        `rooms/${state.roomId}`
      );

    state.membersRef =
      db.ref(
        `members/${state.roomId}`
      );

    state.kickedRef =
      db.ref(
        `kicked/${state.roomId}/${state.uid}`
      );

    if (await handleKickState()) {
      return;
    }

    const connected =
      await waitForDatabaseConnection();

    if (!connected) {
      await leaveRoomLocally(
        "Firebase 目前正在重新連線，請稍後再加入房間"
      );
      return;
    }

    const memberReady =
      await markMemberOnline();

    if (
      !memberReady ||
      state.kickedLocally
    ) {
      if (
        !state.kickedLocally &&
        state.roomId
      ) {
        await leaveRoomLocally(
          "加入房間失敗，請重新嘗試"
        );
      }
      return;
    }

    const roomSnapshot =
      await state.roomRef.once("value");

    if (!roomSnapshot.exists()) {
      await leaveRoomLocally("房間已不存在");
      return;
    }

    state.room =
      roomSnapshot.val();

    state.isOwner =
      state.room.owner ===
      state.uid;

    if (
      !state.isOwner &&
      state.roomId &&
      state.uid
    ) {
      const capacityOk =
        await enforceRoomCapacity();

      if (!capacityOk) {
        await leaveRoomLocally(
          "這個房間剛好已達人數上限"
        );
        return;
      }


      try {
        const currentOwnerUid =
          String(
            state.room.owner ||
            ""
          );

        let ownerCanBeClaimed =
          !currentOwnerUid;

        if (
          currentOwnerUid
        ) {
          const ownerMemberSnapshot =
            await state.membersRef
              .child(
                currentOwnerUid
              )
              .once("value");

          ownerCanBeClaimed =
            !isMemberPresenceLive(
              ownerMemberSnapshot.val()
            );
        }

        if (
          ownerCanBeClaimed
        ) {
          const result =
            await state.roomRef
              .child("owner")
              .transaction(
                currentValue => {
                  if (
                    currentValue === null ||
                    String(
                      currentValue ||
                      ""
                    ) ===
                    currentOwnerUid
                  ) {
                    return state.uid;
                  }

                  return;
                }
              );

          if (
            result.committed &&
            String(
              result.snapshot.val() ||
              ""
            ) ===
            String(
              state.uid
            )
          ) {
            state.room.owner =
              state.uid;
            state.isOwner =
              true;
          }
        }
      } catch (error) {
        console.warn(
          "空房房主接管失敗:",
          error
        );
      }
    }
    if (
      state.isOwner &&
      !state.adminJoinOverride &&
      state.roomId &&
      state.uid
    ) {
      try {
        const metaOwnerSnapshot =
          await db
            .ref(
              `roomMeta/${state.roomId}/owner`
            )
            .once("value");

        if (
          String(
            metaOwnerSnapshot.val() || ""
          ) !==
          String(
            state.uid
          )
        ) {
          await db
            .ref(
              `roomMeta/${state.roomId}/owner`
            )
            .set(
              state.uid
            );
        }
      } catch (error) {
        console.warn(
          "同步房主索引失敗:",
          error
        );
      }
    }

    if (state.isOwner && !state.adminJoinOverride) {
      attachPlaybackControlRequestListener();
    }

    updateRoomOwnerUI();
    attachRoomOwnerListener();

    if ($("roomTitle")) {
      $("roomTitle").textContent =
        state.room?.name || "一起看";
    }

    attachKickListener();

    state.chatRef =
      db.ref(
        `chat/${state.roomId}`
      );

    state.queueRef =
      db.ref(
        `queue/${state.roomId}`
      );

    clearInterval(
      state.memberHeartbeatTimer
    );

    state.memberHeartbeatTimer =
      setInterval(
        () => {
          void heartbeatMember();
        },
        MEMBER_HEARTBEAT_INTERVAL_MS
      );

    void heartbeatMember();

    attachPlaybackSyncListener();

    if (
      !state.videoListenerAttached
    ) {
      state.roomRef
        .child("video")
        .on(
          "value",
          async (snapshot) => {
            try {
              await handleRoomVideo(
                snapshot.val()
              );
            } catch (error) {
              console.error(
                "影片載入失敗:",
                error
              );

              toast(
                error.message ||
                "影片載入失敗"
              );
            }
          }
        );

      state.videoListenerAttached =
        true;
    }

    if (
      !state.membersListenerAttached
    ) {
      state.membersRef.on(
        "value",
        async (snapshot) => {
          const members =
            snapshot.val() ||
            {};

          /*
           * 自己原本已經進來，
           * 後來突然不存在，
           * 視為被房主踢出。
           */
          if (
            state.wasMemberInRoom &&
            state.uid &&
            state.databaseConnected === true &&
            !state.leavingRoom &&
            !Object.prototype.hasOwnProperty.call(
              members,
              state.uid
            ) &&
            !state.isOwner &&
            !state.adminJoinOverride &&
            !state.kickedLocally
          ) {
            const kicked =
              await isMemberKicked();

            if (kicked) {
              await leaveRoomLocally(
                "你已被房主移出房間"
              );

              return;
            }

            try {
              await markMemberOnline();
            } catch (error) {
              console.warn(
                "成員 reconnect 恢復失敗:",
                error
              );
            }

            return;
          }

          renderMembers(
            members
          );

          if (
            state.isOwner &&
            !state.adminJoinOverride
          ) {
            void scheduleOwnerFailover();
          }
        }
      );

      state.membersListenerAttached =
        true;
    }

    if (
      !state.chatListenerAttached
    ) {
      state.chatRef
        .limitToLast(100)
        .on(
          "value",
          (snapshot) => {
            renderChat(
              snapshot.val() ||
              {}
            );
          }
        );

      state.chatListenerAttached =
        true;
    }

    if (
      !state.queueListenerAttached
    ) {
      state.queueRef.on(
        "value",
        (snapshot) => {
          state.queue =
            snapshot.val() ||
            {};

          if (state.room) {
            state.room.queue =
              state.queue;
          }

          renderQueue();
        }
      );

      state.queueListenerAttached =
        true;
    }

    renderQueue();
  }


  /*
   * =========================================================
   * MEMBERS UI
   * =========================================================
   */

  function renderMembers(
    members
  ) {
    const entries =
      Object.entries(
        members || {}
      );

    entries.sort(
      (a, b) =>
        Number(
          a[1]?.joinedAt || 0
        ) -
        Number(
          b[1]?.joinedAt || 0
        )
    );

    if ($("memberCount")) {
      $("memberCount")
        .textContent =
        String(
          entries.length
        );
    }

    if (!$("memberList")) {
      return;
    }

    if (!entries.length) {
      $("memberList")
        .innerHTML = `
          <div class="muted">
            目前沒有成員。
          </div>
        `;

      return;
    }

    $("memberList")
      .innerHTML =
      entries
        .map(
          (
            [uid, member]
          ) => {
            const name =
              member?.name ||
              "使用者";

            const owner =
              uid ===
              state.room?.owner;

            const online =
              member?.online !==
              false;

            /*
             * 房主可以踢其他人，
             * 但不能踢自己。
             */
            const kickButton =
              state.isOwner &&
              !owner &&
              uid !== state.uid
                ? `
                  <button
                    type="button"
                    class="tiny-btn"
                    data-member-kick="${escapeHtml(
                      uid
                    )}"
                    data-member-name="${escapeHtml(
                      name
                    )}"
                    style="
                      margin-left:6px;
                      color:#fda4af;
                      border-color:rgba(244,63,94,.2);
                    "
                  >
                    踢出
                  </button>
                `
                : "";

            return `
              <div
                class="member"
                data-member-uid="${escapeHtml(uid)}"
                data-member-public-code="${escapeHtml(
                  String(member?.publicCode || "")
                    .trim()
                    .toUpperCase()
                )}"
              >

                <div
                  class="avatar"
                >
                  ${escapeHtml(
                    name.slice(
                      0,
                      1
                    )
                  )}
                </div>

                <div
                  class="member-name"
                  style="
                    min-width:0;
                    flex:1;
                  "
                >

                  <b>
                    ${escapeHtml(
                      name
                    )}
                  </b>

                  <span>
                    ${
                      owner
                        ? "房主"
                        : online
                          ? "在線"
                          : "離線"
                    }
                  </span>

                </div>

                <span
                  class="online"
                  style="
                    ${
                      online
                        ? ""
                        : "background:#64748b;box-shadow:none;"
                    }
                  "
                ></span>

                ${kickButton}

              </div>
            `;
          }
        )
        .join("");

    $("memberList")
      .querySelectorAll(
        "[data-member-kick]"
      )
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            async () => {
              await kickMember(
                button.dataset
                  .memberKick,
                button.dataset
                  .memberName
              );
            }
          );
        }
      );
  }


  /*
   * =========================================================
   * CHAT
   * =========================================================
   */

  async function sendChat(
    text
  ) {
    text =
      String(
        text || ""
      )
        .trim()
        .slice(0, 300);

    if (
      !text ||
      !state.chatRef ||
      !state.uid ||
      state.leavingRoom
    ) {
      return;
    }

    if (
      state.databaseConnected !== true
    ) {
      throw new Error(
        "目前正在重新連線，請稍後再送出"
      );
    }

    if (
      !(await ensureRoomMembership())
    ) {
      throw new Error(
        "目前不在這個房間"
      );
    }

    try {
      await state.chatRef.push({
        uid:
          state.uid,

        name:
          state.memberName,

        type:
          "text",

        text,

        createdAt:
          firebase.database
            .ServerValue
            .TIMESTAMP
      });
    } catch (error) {
      if (
        error?.code ===
        "PERMISSION_DENIED"
      ) {
        const restored =
          await ensureRoomMembership();

        if (restored) {
          await state.chatRef.push({
            uid:
              state.uid,

            name:
              state.memberName,

            type:
              "text",

            text,

            createdAt:
              firebase.database
                .ServerValue
                .TIMESTAMP
          });

          return;
        }
      }

      throw error;
    }
  }


  function renderChat(messages) {
    const list =
      Object.entries(
        messages || {}
      )
        .map(([id, message]) => ({
          id,
          ...(message || {})
        }))
        .sort(
          (a, b) =>
            Number(a.createdAt || 0) -
            Number(b.createdAt || 0)
        );

    if (!$("chatMessages")) {
      return;
    }

    if (!list.length) {
      $("chatMessages")
        .innerHTML = `
          <div
            class="muted"
            style="
              padding:12px;
            "
          >
            開始聊天吧 👋
          </div>
        `;

      return;
    }

    $("chatMessages")
      .innerHTML =
      list
        .map(
          (message) => {
            const isSticker =
              message?.type === "sticker";

            const body =
              isSticker
                ? `
                  <div
                    class="wt-sticker"
                    aria-label="貼圖"
                  >
                    ${escapeHtml(
                      message?.sticker ||
                      "😊"
                    )}
                  </div>
                `
                : `
                  <p>
                    ${escapeHtml(
                      message?.text ||
                      ""
                    )}
                  </p>
                `;

            const isOwnMessage =
              Boolean(
                state.uid &&
                message?.uid &&
                String(message.uid) ===
                  String(state.uid)
              );

            const deleteButton =
              isOwnMessage
                ? `
                  <button
                    type="button"
                    class="wt-message-delete"
                    data-chat-delete="${escapeHtml(
                      message.id
                    )}"
                  >
                    刪除訊息
                  </button>
                `
                : "";

            return `
              <div
                class="message wt-message${isOwnMessage ? " self" : ""}"
              >
                <div
                  class="wt-message-top"
                >
                  <b
                    class="wt-message-name"
                  >
                    ${escapeHtml(
                      message?.name ||
                      "玩家"
                    )}
                  </b>
                  <span
                    class="wt-message-time"
                  >
                    ${escapeHtml(
                      message?.createdAt
                        ? new Date(
                            Number(message.createdAt)
                          ).toLocaleTimeString(
                            "zh-TW",
                            {
                              hour: "2-digit",
                              minute: "2-digit"
                            }
                          )
                        : ""
                    )}
                  </span>
                </div>

                ${body}
                ${deleteButton}
              </div>
            `;
          }
        )
        .join("");

    const box =
      $("chatMessages");

    box.scrollTop =
      box.scrollHeight;

    box
      .querySelectorAll(
        "[data-chat-delete]"
      )
      .forEach(
        (button) => {
          button.addEventListener(
            "click",
            async () => {
              if (
                !state.chatRef ||
                !state.uid
              ) {
                return;
              }

              try {
                await state.chatRef
                  .child(
                    button.dataset
                      .chatDelete
                  )
                  .remove();

                toast(
                  "訊息已刪除"
                );
              } catch (error) {
                console.error(
                  "刪除聊天室訊息失敗:",
                  error
                );

                toast(
                  error?.message ||
                  "刪除訊息失敗"
                );
              }
            }
          );
        }
      );
  }


  /*
   * =========================================================
   * CHANGE VIDEO
   * =========================================================
   */

  async function changeVideo(
    video,
    options = {}
  ) {
    if (!state.uid || !state.roomId || !state.room || !state.membersRef) {
      throw new Error("目前不在房間內");
    }

    if (!(await ensureRoomMembership())) {
      throw new Error("你已不在這個房間");
    }

    if (
      !video?.id &&
      !video?.url
    ) {
      throw new Error(
        "沒有選擇影片"
      );
    }

    if (!state.roomRef) {
      throw new Error(
        "尚未進入房間"
      );
    }

    const platformCandidate =
      String(
        video.platform ||
        "youtube"
      ).trim();

    if (
      !PLATFORMS[
        platformCandidate
      ]
    ) {
      throw new Error(
        "不支援的影片平台"
      );
    }

    const platform =
      platformCandidate;

    const normalizedVideoId =
      String(
        video.id ||
        video.url ||
        ""
      ).trim();

    if (!normalizedVideoId) {
      throw new Error(
        "影片缺少必要識別資訊"
      );
    }

    const roomVideo = {
      id:
        normalizedVideoId.slice(
          0,
          200
        ),

      platform,

      title:
        video.title ||
        PLATFORMS[
          platform
        ]?.name ||
        platform,

      thumbnail:
        video.thumbnail ||
        "",

      channel:
        video.channel ||
        PLATFORMS[
          platform
        ]?.name ||
        platform
    };

    if (video.url) {
      roomVideo.url =
        String(video.url);
    }

    if (video.twitchType) {
      roomVideo.twitchType =
        video.twitchType;
    }

    /*
     * Realtime Database rules 對 rooms/{roomId}
     * 的父層 .write 僅允許建立 / 刪除房間。
     * 因此不能用 roomRef.update() 一次寫 sourceType + video，
     * 必須逐一寫入子節點，讓子節點自己的 .write rule 生效。
     */
    const writeRoomVideo = async () => {
      await state.roomRef
        .child("sourceType")
        .set(platform);

      await state.roomRef
        .child("video")
        .set(roomVideo);
    };

    try {
      await writeRoomVideo();
    } catch (error) {
      if (
        error?.code !== "PERMISSION_DENIED" ||
        !(await ensureRoomMembership())
      ) {
        throw error;
      }

      await writeRoomVideo();
    }

    cancelScheduledLocalPause();
    cancelScheduledRemotePause();
    cancelScheduledRemotePlay();
    cancelScheduledRemoteSeek();

    clearTimeout(
      state.playbackLocalSeekTimer
    );

    state.playbackLocalSeekTimer =
      null;

    state.playbackLocalScheduledEventId =
      "";

    state.playbackLocalControlUntil =
      0;

    state.playbackTimeline =
      null;

    state.playbackRemoteEvent =
      null;

    state.playbackLastRemoteEventId =
      null;

    state.playbackLastRemoteUpdatedAt =
      0;

    state.playbackLastObservedPosition =
      null;

    state.playbackAppliedRate =
      null;

    state.room.sourceType =
      platform;

    state.room.video =
      roomVideo;

    closeSourceModal();

    toast(
      `已切換到${
        PLATFORMS[
          platform
        ]?.name ||
        platform
      }`
    );
  }


  function getYoutubeSearchHistory() {
    try {
      const value = JSON.parse(localStorage.getItem("wt_search_history_v1") || "[]");
      if (!Array.isArray(value)) return [];
      return value.map((item) => String(item || "").trim()).filter((item) => item.length >= 2).slice(0, 8);
    } catch (_) {
      return [];
    }
  }

  function saveYoutubeSearchHistory(query) {
    const normalized = String(query || "").trim();
    if (normalized.length < 2) return;
    const list = getYoutubeSearchHistory().filter((item) => item !== normalized);
    list.unshift(normalized);
    try {
      localStorage.setItem("wt_search_history_v1", JSON.stringify(list.slice(0, 8)));
    } catch (_) {}
  }

  function deleteYoutubeSearchHistory(query) {
    const normalized = String(query || "").trim();
    if (normalized.length < 2) return;
    const list = getYoutubeSearchHistory().filter((item) => item !== normalized);
    try {
      localStorage.setItem("wt_search_history_v1", JSON.stringify(list));
    } catch (_) {}
    renderYoutubeSearchHistory();
  }

  function renderYoutubeSearchHistory(query = "") {
    const box = $("modalSearchHistory");
    if (!box) return;

    const normalizedQuery = String(query || "").trim().toLowerCase();
    let list = getYoutubeSearchHistory();

    if (normalizedQuery) {
      list = list.filter(function(item) {
        return String(item || "").toLowerCase().includes(normalizedQuery);
      });
    }

    if (!list.length) {
      box.innerHTML = normalizedQuery
        ? '<span class="muted">沒有符合的最近搜尋。</span>'
        : '<span class="muted">還沒有最近搜尋。</span>';
      return;
    }

    box.innerHTML =
      '<span class="muted">最近搜尋：</span> ' +
      list.map(function(item) {
        return '<span class="wt-search-history-item">' +
          '<button type="button" class="wt-search-history-chip" data-wt-room-search-history="' + escapeHtml(item) + '">' + escapeHtml(item) + '</button>' +
          '<button type="button" class="wt-search-history-delete" data-wt-room-search-history-delete="' + escapeHtml(item) + '" aria-label="刪除搜尋紀錄" title="刪除搜尋紀錄">×</button>' +
        '</span>';
      }).join(" ");

    box.querySelectorAll("[data-wt-room-search-history]").forEach(function(button) {
      button.addEventListener("click", function() {
        const input = $("modalVideoSearchInput");
        if (!input) return;
        input.value = button.dataset.wtRoomSearchHistory || "";
        renderYoutubeSearchHistory(input.value);
        $("modalSearchVideoBtn")?.click();
      });
    });

    box.querySelectorAll("[data-wt-room-search-history-delete]").forEach(function(button) {
      button.addEventListener("click", function(event) {
        event.preventDefault();
        event.stopPropagation();
        deleteYoutubeSearchHistory(button.dataset.wtRoomSearchHistoryDelete || "");
        renderYoutubeSearchHistory($("modalVideoSearchInput")?.value || "");
      });
    });
  }

  /*
   * =========================================================
   * SOURCE MODAL
   * =========================================================
   */

  function openSourceModal() {
    const modal =
      $("sourceModal");

    if (!modal) {
      toast(
        "找不到影片搜尋視窗"
      );

      return;
    }

    lockPageScroll();

    disconnectSearchObserver();

    state.modalSelectedVideo =
      null;

    state.modalSelectedVideoId =
      "";

    state.searchResults =
      [];

    state.searchNextPageToken =
      "";

    state.searchPageCount =
      0;

    state.searchQuery =
      "";

    state.searchLoadingMore =
      false;

    modal.classList.remove(
      "hidden"
    );

    if (
      $("sourceTypeModal")
    ) {
      $("sourceTypeModal")
        .value =
        "youtube";
    }

    if (
      $("modalVideoSearchInput")
    ) {
      $("modalVideoSearchInput")
        .value =
        "";
    }

    renderYoutubeSearchHistory();

    if (
      $("modalVideoSearchResults")
    ) {
      $("modalVideoSearchResults")
        .innerHTML =
        "";

      $("modalVideoSearchResults")
        .dataset
        .selectedVideoId =
        "";

      configureSearchScroll();

      $("modalVideoSearchResults")
        .scrollTop =
        0;
    }

    if (
      $("modalSourceUrlInput")
    ) {
      $("modalSourceUrlInput")
        .value =
        "";
    }

    setError(
      $("modalError"),
      ""
    );

    updateModalPlatformUI();

    const saveButton =
      $("saveSourceBtn");

    if (saveButton) {
      saveButton.disabled =
        false;

      saveButton.textContent =
        "播放這部影片";
    }

    setTimeout(() => {
      configureSearchScroll();

      $("modalVideoSearchInput")
        ?.focus();
    }, 50);
  }


  function closeSourceModal() {
    disconnectSearchObserver();

    $("sourceModal")
      ?.classList.add(
        "hidden"
      );

    state.modalSelectedVideo =
      null;

    state.modalSelectedVideoId =
      "";

    state.searchResults =
      [];

    state.searchNextPageToken =
      "";

    state.searchPageCount =
      0;

    state.searchQuery =
      "";

    state.searchLoadingMore =
      false;

    unlockPageScroll();

    setError(
      $("modalError"),
      ""
    );
  }


  function updatePlatformInputUI() {
    const platform =
      $("sourceTypeInput")?.value ||
      "youtube";

    const searchArea =
      $("videoSearchArea");

    const manualArea =
      $("platformManualArea");

    const notice =
      $("platformNotice");

    const searchable =
      PLATFORMS[platform]?.searchable === true;

    const manual =
      ["vimeo", "dailymotion", "twitch"].includes(platform);

    if (searchArea) {
      searchArea.classList.toggle("hidden", !searchable);
    }

    if (manualArea) {
      manualArea.classList.toggle("hidden", !manual);
    }

    if (notice) {
      notice.classList.toggle("hidden", !manual);
    }

    if (manual && window.WT_ENHANCEMENTS?.state) {
      window.WT_ENHANCEMENTS.state.createVideo = null;
      $("selectedVideoCard")?.classList.add("hidden");
    }

    if (manual) {
      const label = $("platformManualLabel");
      const input = $("platformManualInput");
      const hint = $("platformManualHint");

      if (label) {
        label.textContent =
          platform === "twitch"
            ? "Twitch 頻道名稱、VOD ID 或網址"
            : "影片網址或 ID";
      }

      if (input) {
        input.placeholder =
          platform === "vimeo"
            ? "例如 76979871 或 https://vimeo.com/..."
            : platform === "dailymotion"
              ? "例如 x84sh87 或 https://www.dailymotion.com/video/..."
              : "例如 twitchdev、40464143 或 Twitch 網址";
        input.type = "text";
      }

      if (hint) {
        hint.textContent =
          platform === "twitch"
            ? "直播可輸入頻道名稱；VOD 可輸入影片 ID。"
            : "可以直接貼上影片網址，也可以輸入影片 ID。";
      }
    }
  }

  function updateModalPlatformUI() {
    const platform =
      $("sourceTypeModal")
        ?.value ||
      "youtube";

    const searchArea =
      $("modalVideoSearchArea");

    const externalArea =
      $("modalExternalSourceArea");

    if (externalArea) {
      const input = $("modalSourceUrlInput");
      const label = externalArea.querySelector("label[for='modalSourceUrlInput']");
      if (label) {
        label.textContent =
          platform === "twitch"
            ? "Twitch 頻道名稱、VOD ID 或網址"
            : "影片網址或 ID";
      }
      if (input) {
        input.placeholder =
          platform === "vimeo"
            ? "例如 76979871 或 https://vimeo.com/..."
            : platform === "dailymotion"
              ? "例如 x84sh87 或 https://www.dailymotion.com/video/..."
              : platform === "twitch"
                ? "例如 twitchdev、40464143 或 Twitch 網址"
                : "影片網址或 ID";
      }
    }

    const searchable =
      PLATFORMS[
        platform
      ]?.searchable === true;

    if (searchArea) {
      searchArea.classList.toggle(
        "hidden",
        !searchable
      );
    }

    if (externalArea) {
      externalArea.classList.toggle(
        "hidden",
        searchable
      );
    }

    if (!searchable) {
      disconnectSearchObserver();

      state.modalSelectedVideo =
        null;

      state.modalSelectedVideoId =
        "";

      if (
        $("modalVideoSearchResults")
      ) {
        $("modalVideoSearchResults")
          .innerHTML =
          "";

        $("modalVideoSearchResults")
          .dataset
          .selectedVideoId =
          "";
      }
    } else {
      setTimeout(
        configureSearchScroll,
        0
      );
    }
  }


  /*
   * =========================================================
   * CLEANUP
   * =========================================================
   */

  function disconnectRoomListeners() {
    cancelScheduledQueuePlayback();

    if (db && state.playbackServerClockHandler) {
      db.ref('.info/serverTimeOffset').off('value', state.playbackServerClockHandler);
      state.playbackServerClockHandler = null;
    }

    clearInterval(
      state.memberHeartbeatTimer
    );
    state.memberHeartbeatTimer = null;

    try {
      state.membersRef?.off();
      state.kickedRef?.off();

      state.chatRef?.off();

      state.queueRef?.off();

      state.roomRef
        ?.child("video")
        .off();
      state.roomRef
        ?.child("owner")
        .off();
      playbackSyncRef()?.off();
      stopPlaybackSeekDetector();
    } catch (_) {}

    state.videoListenerAttached =
      false;
    state.playbackListenerAttached =
      false;
    state.playbackApplyingRemote =
      false;
    state.playbackRemoteEvent =
      null;
    state.playbackLastRemoteEventId =
      null;
    state.playbackApplyingRemoteEventId =
      null;
    state.playbackIgnoreStateChanges =
      0;
    state.playbackIgnoreStateUntil =
      0;
    state.playbackLastRemoteUpdatedAt =
      0;
    state.playbackLastLocalActionKey =
      "";
    state.playbackLastLocalActionAt =
      0;
    state.playbackLastLocalSeekWriteAt =
      0;
    state.playbackMeasuredRttMs =
      0;
    state.playbackRttSamples =
      [];
    state.playbackLocalScheduledEventId =
      "";
    state.playbackLocalControlUntil =
      0;
    state.playbackLocalSeekSuppressUntil =
      0;
    state.playbackResumeRecoveryUntil =
      0;
    state.playbackIsBuffering = false;
    state.playbackYoutubeRates = null;
    state.playbackYoutubeRatesVideoId = "";
    state.playbackYoutubeRatesCheckedAt = 0;
    state.playbackAwaitingActualStart = false;
    clearTimeout(state.playbackActualStartTimer);
    state.playbackActualStartTimer = null;
    state.playbackNativeEventSuppressKind = "";
    state.playbackNativeEventSuppressUntil = 0;
    detachPlaybackControlRequestListener();
    cancelScheduledLocalPause();
    cancelScheduledRemotePause();
    cancelScheduledRemotePlay();
    cancelScheduledRemoteSeek();

    clearTimeout(
      state.playbackLocalSeekTimer
    );

    state.playbackLocalSeekTimer =
      null;

    state.playbackLocalScheduledEventId =
      "";

    state.playbackLocalControlUntil =
      0;

    state.membersListenerAttached =
      false;

    state.roomOwnerListenerAttached =
      false;

    state.chatListenerAttached =
      false;

    state.queueListenerAttached =
      false;

    state.queue =
      {};
  }


  /*
   * 保留舊名稱，避免其他地方呼叫時出問題。
   */
  function detachRoomListeners() {
    disconnectRoomListeners();
  }


  /*
   * =========================================================
   * EVENTS
   * =========================================================
   */

  function setupEvents() {

    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") {
          recoverPlaybackAfterPageResume();
        }
      }
    );

    window.addEventListener(
      "pageshow",
      () => {
        recoverPlaybackAfterPageResume();
      }
    );


    /*
     * CREATE
     */

    $("createRoomBtn")
      ?.addEventListener(
        "click",
        async () => {
          const button = $("createRoomBtn");

          if (button?.disabled) {
            return;
          }

          const originalText =
            button?.textContent ||
            "建立房間";

          if (button) {
            button.disabled = true;
            button.textContent = "連線中…";
          }

          try {
            setError(
              $("homeError"),
              ""
            );

            await createRoom();
          } catch (error) {
            console.error(
              error
            );

            setError(
              $("homeError"),
              error.message ||
                "建立房間失敗"
            );
          } finally {
            if (button) {
              button.disabled = false;
              button.textContent = originalText;
            }
          }
        }
      );


    /*
     * JOIN
     */

    $("joinRoomBtn")
      ?.addEventListener(
        "click",
        async () => {
          const button = $("joinRoomBtn");

          if (button?.disabled) {
            return;
          }

          const originalText =
            button?.textContent ||
            "加入朋友的房間";

          if (button) {
            button.disabled = true;
            button.textContent = "連線中…";
          }

          try {
            await joinRoom(
              $("joinCodeInput")
                ?.value
            );
          } catch (error) {
            console.error(
              error
            );

            const friendlyError =
              getFriendlyAuthError(error);

            setError(
              $("homeError"),
              friendlyError
            );

            setTimeout(() => {
              const current = $("homeError")?.textContent || "";
              if (current === friendlyError) {
                setError($("homeError"), "");
              }
            }, 4500);

            toast(
              error.message ||
              "加入房間失敗"
            );
          } finally {
            if (button) {
              button.disabled = false;
              button.textContent = originalText;
            }
          }
        }
      );


    $("joinCodeInput")
      ?.addEventListener(
        "input",
        (event) => {
          event.target.value =
            event.target.value
              .toUpperCase()
              .replace(
                /[^A-Z0-9]/g,
                ""
              );
        }
      );


    /*
     * GOOGLE
     */

    $("googleLoginBtn")
      ?.addEventListener(
        "click",
        async () => {
          try {
            await googleLogin();
          } catch (error) {
            console.error(
              "Google 登入錯誤:",
              error
            );

            toast(
              error?.message ||
              "Google 登入失敗"
            );
          }
        }
      );


    $("logoutBtn")
      ?.addEventListener(
        "click",
        async () => {
          const button = $("logoutBtn");

          if (button?.disabled) {
            return;
          }

          if (!window.confirm("確定要登出嗎？")) {
            return;
          }

          if (button) {
            button.disabled = true;
          }

          try {
            await logout();
          } finally {
            if (button) {
              button.disabled = false;
            }
          }
        }
      );


    $("globalBlockRefreshBtn")?.addEventListener("click", async () => {
      const block = await getGlobalBlockState(auth?.currentUser || null);
      if (block) {
        showGlobalBlockScreen(block);
      } else {
        hideGlobalBlockScreen();
        toast("帳號已解除封鎖");
      }
    });



    /*
     * COPY ROOM
     */

    $("copyRoomBtn")
      ?.addEventListener(
        "click",
        async () => {
          try {
            await navigator.clipboard.writeText(
              getRoomLink(
                state.roomId
              )
            );

            toast(
              "房間連結已複製"
            );
          } catch (_) {
            toast(
              "複製失敗"
            );
          }
        }
      );


    /*
     * LEAVE
     */

    $("leaveRoomBtn")
      ?.addEventListener(
        "click",
        async () => {
          const confirmed =
            window.confirm(
              "確定要離開這個房間嗎？"
            );

          if (!confirmed) {
            return;
          }

          try {
            await exitCurrentRoom();
          } catch (error) {
            console.error(
              "離開房間失敗:",
              error
            );

            toast(
              error?.message ||
              "離開房間失敗"
            );
          }
        }
      );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (
          document.visibilityState ===
          "visible"
        ) {
          if (
            state.roomId
          ) {
            void heartbeatMember();
          }
        }
      }
    );

    /*
     * PLAY / PAUSE
     */

    $("playPauseBtn")
      ?.addEventListener(
        "click",
        async () => {
          if (!state.playerReady || !state.player) {
            toast("請先選擇影片");
            return;
          }

          if (
            ![
              "youtube",
              "vimeo",
              "dailymotion",
              "twitch"
            ].includes(
              state.playerType
            )
          ) {
            toast("此平台目前無法由本站控制播放");
            return;
          }

          const playing =
             await asyncIsPlaying();

           const position =
             await asyncCurrentPosition();

           if (!state.isOwner) {
             if (!playing && state.playbackLastPlayerState === "ended") {
               await replayVideo();
             } else {
               const action =
                 playing ? "pause" : "play";

               await applyOptimisticLocalPlaybackAction(
                 action,
                 position,
                 !playing
               );

               void requestPlaybackControl(
                 action,
                 position,
                 !playing
               );
             }

             updateTimeUI();
             return;
           }

           try {
            markLocalPlaybackIntent(playing ? "pause" : "play");
            if (playing) {
              state.playbackAwaitingActualStart = false;
              clearTimeout(state.playbackActualStartTimer);
              state.playbackActualStartTimer = null;

              const issuedAt = playbackClockNow();
              const effectiveAt =
                issuedAt +
                getControlLeadMs();

              cancelScheduledRemotePause();
              cancelScheduledLocalPause();

              await pausePlayer();

              publishPlaybackEvent(
                "pause",
                position,
                false,
                issuedAt,
                effectiveAt
              );
            } else {
              if (state.playbackLastPlayerState === "ended") {
                await replayVideo();
              } else {
                cancelScheduledLocalPause();
                cancelScheduledRemotePause();
                state.playbackAwaitingActualStart = false;
                clearTimeout(state.playbackActualStartTimer);
                state.playbackActualStartTimer = null;
                const issuedAt = playbackClockNow();
                await playPlayer();
                publishPlaybackEvent(
                  "play",
                  position,
                  true,
                  issuedAt,
                  issuedAt
                );
              }
            }
          } catch (error) {
            console.warn("播放控制同步失敗:", error);
            toast(error?.message || "播放同步失敗");
          }

          updateTimeUI();
        }
      );


    /*
     * BACK
     */

    $("backBtn")
      ?.addEventListener(
        "click",
        async () => {
          if (
            !state.playerReady ||
            !state.player ||
            
            ![
              "youtube",
              "vimeo",
              "dailymotion",
              "twitch"
            ].includes(
              state.playerType
            )
          ) {
            return;
          }

          const target =
            Math.max(
              0,
              (
                await asyncCurrentPosition()
              ) - 10
            );

          const wasPlaying =
            await asyncIsPlaying();

          if (!state.isOwner) {
            await applyOptimisticLocalPlaybackAction(
              "seek",
              target,
              wasPlaying
            );

            void requestPlaybackControl(
              "seek",
              target,
              wasPlaying
            );

            updateTimeUI();
            return;
          }

           markLocalPlaybackIntent(
            "seek"
          );

          await applyPlayerPosition(
            target
          );

          publishPlaybackEvent(
            "seek",
            target,
            wasPlaying,
            playbackClockNow()
          );
        }
      );


    /*
     * FORWARD
     */

    $("forwardBtn")
      ?.addEventListener(
        "click",
        async () => {
          if (
            !state.playerReady ||
            !state.player ||
            
            ![
              "youtube",
              "vimeo",
              "dailymotion",
              "twitch"
            ].includes(
              state.playerType
            )
          ) {
            return;
          }

          const total =
            await asyncDuration();

          const target =
            Math.min(
              total || Infinity,
              (
                await asyncCurrentPosition()
              ) + 10
            );

          const wasPlaying =
            await asyncIsPlaying();

          if (!state.isOwner) {
            await applyOptimisticLocalPlaybackAction(
              "seek",
              target,
              wasPlaying
            );

            void requestPlaybackControl(
              "seek",
              target,
              wasPlaying
            );

            updateTimeUI();
            return;
          }

           markLocalPlaybackIntent(
            "seek"
          );

          await applyPlayerPosition(
            target
          );

          publishPlaybackEvent(
            "seek",
            target,
            wasPlaying,
            playbackClockNow()
          );
        }
      );


    /*
     * 舊同步按鈕直接隱藏。
     */
/*
     * VOLUME
     */

    $("volumeInput")
      ?.addEventListener(
        "input",
        (event) => {
          const value =
            Number(
              event.target.value
            );

          try {
            if (
              state.playerType ===
              "youtube"
            ) {
              state.player?.setVolume(
                value
              );

              if (
                value > 0
              ) {
                state.player?.unMute();
              } else {
                state.player?.mute();
              }
            }

            if (
              state.playerType ===
              "vimeo"
            ) {
              state.player?.setVolume(
                value / 100
              );
            }

            if (
              state.playerType ===
              "twitch"
            ) {
              state.player?.setVolume(
                value / 100
              );
            }

            if (
              state.playerType ===
              "dailymotion"
            ) {
              state.player?.setVolume?.(
                value / 100
              );
            }
          } catch (_) {}
        }
      );


    /*
     * FULLSCREEN
     */

    $("fullscreenBtn")
      ?.addEventListener(
        "click",
        () => {
          const playerWrap =
            $("playerWrap");

          if (
            document.fullscreenElement
          ) {
            document.exitFullscreen?.();
            return;
          }

          playerWrap
            ?.requestFullscreen?.();
        }
      );


    /*
     * COPY TIME
     */

    $("copyTimeBtn")
      ?.addEventListener(
        "click",
        async () => {
          try {
            const time =
              formatTime(
                await asyncCurrentPosition()
              );

            await navigator.clipboard.writeText(
              time
            );

            toast(
              `已複製 ${time}`
            );
          } catch (_) {
            toast(
              "複製失敗"
            );
          }
        }
      );


    /*
     * CHAT
     */

    $("chatForm")
      ?.addEventListener(
        "submit",
        async (event) => {
          event.preventDefault();

          const input =
            $("chatInput");

          const text =
            input?.value.trim();

          if (!text) {
            return;
          }

          try {
            await sendChat(
              text
            );

            input.value =
              "";
          } catch (error) {
            console.error(
              "聊天室送出失敗:",
              error
            );

            toast(
              error?.message ||
              "訊息送出失敗"
            );

            input?.focus();
          }
        }
      );


    /*
     * SOURCE
     */

    $("changeSourceBtn")
      ?.addEventListener(
        "click",
        openSourceModal
      );

    $("cancelModalBtn")
      ?.addEventListener(
        "click",
        closeSourceModal
      );

    $("sourceTypeModal")
      ?.addEventListener(
        "change",
        updateModalPlatformUI
      );

    $("sourceTypeInput")
      ?.addEventListener(
        "change",
        updatePlatformInputUI
      );

    updatePlatformInputUI();


    /*
     * ESC
     */

    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key !==
          "Escape"
        ) {
          return;
        }

        const sourceModal =
          $("sourceModal");

        if (
          sourceModal &&
          !sourceModal.classList.contains(
            "hidden"
          )
        ) {
          closeSourceModal();
        }

      }
    );


    /*
     * 點背景關閉搜尋。
     */

    $("sourceModal")
      ?.addEventListener(
        "click",
        (event) => {
          if (
            event.target ===
            $("sourceModal")
          ) {
            closeSourceModal();
          }
        }
      );


    /*
     * =====================================================
     * YOUTUBE SEARCH
     * =====================================================
     */

    $("modalSearchVideoBtn")
      ?.addEventListener(
        "click",
        async () => {
          const platform =
            $("sourceTypeModal")
              ?.value ||
            "youtube";

          if (
            platform !==
            "youtube"
          ) {
            return;
          }

          if (
            state.searchBusy
          ) {
            return;
          }

          const query =
            $("modalVideoSearchInput")
              ?.value
              .trim();

          saveYoutubeSearchHistory(query);
          renderYoutubeSearchHistory();

          if (!query) {
            setError(
              $("modalError"),
              "請輸入影片名稱"
            );

            return;
          }

          state.searchBusy =
            true;

          state.searchLoadingMore =
            false;

          disconnectSearchObserver();

          state.searchResults =
            [];

          state.searchNextPageToken =
            "";

          state.searchPageCount =
            0;

          state.searchQuery =
            query;

          state.modalSelectedVideo =
            null;

          state.modalSelectedVideoId =
            "";

          const button =
            $("modalSearchVideoBtn");

          if (button) {
            button.disabled =
              true;

            button.textContent =
              "搜尋中…";
          }

          setError(
            $("modalError"),
            ""
          );

          try {
            await searchYoutube(
              query,
              false
            );

            const resultsContainer =
              $("modalVideoSearchResults");

            if (
              resultsContainer
            ) {
              resultsContainer.scrollTop =
                0;

              requestAnimationFrame(
                () => {
                  configureSearchScroll();
                  resultsContainer.scrollTop =
                    0;
                }
              );
            }
          } catch (error) {
            console.error(
              error
            );

            setError(
              $("modalError"),
              error.message ||
                "搜尋失敗"
            );
          } finally {
            state.searchBusy =
              false;

            if (button) {
              button.disabled =
                false;

              button.textContent =
                "搜尋";
            }

            configureSearchScroll();
          }
        }
      );


    $("modalVideoSearchInput")
      ?.addEventListener(
        "keydown",
        (event) => {
          if (
            event.key ===
            "Enter"
          ) {
            event.preventDefault();

            $("modalSearchVideoBtn")
              ?.click();
          }
        }
      );

    $("modalVideoSearchInput")
      ?.addEventListener(
        "input",
        () => {
          renderYoutubeSearchHistory(
            $("modalVideoSearchInput")?.value || ""
          );
        }
      );

    $("modalVideoSearchInput")
      ?.addEventListener(
        "focus",
        () => {
          renderYoutubeSearchHistory(
            $("modalVideoSearchInput")?.value || ""
          );
        }
      );

    /*
     * REALTIME YOUTUBE SEARCH
     */
    $("modalVideoSearchInput")
      ?.setAttribute(
        "data-wt-realtime-youtube-search",
        "0"
      );


    /*
     * SAVE SOURCE
     */

    $("saveSourceBtn")
      ?.addEventListener(
        "click",
        async () => {
          try {
            setError(
              $("modalError"),
              ""
            );

            const platform =
              $("sourceTypeModal")
                ?.value ||
              "youtube";

            if (
              platform ===
              "youtube"
            ) {
              const video =
                getSelectedModalYoutubeVideo();

              if (
                !video ||
                !video.id
              ) {
                throw new Error(
                  "請先點選搜尋結果中的影片"
                );
              }

              await changeVideo(
                video
              );

              return;
            }

            const raw =
              $("modalSourceUrlInput")
                ?.value
                ?.trim();

            if (!raw) {
              throw new Error(
                `請輸入${
                  PLATFORMS[
                    platform
                  ]?.name ||
                  platform
                }影片網址或 ID`
              );
            }

            const video =
              createVideoObject(
                platform,
                raw
              );

            if (!video) {
              throw new Error(
                `無法辨識${
                  PLATFORMS[
                    platform
                  ]?.name ||
                  platform
                }影片網址或 ID`
              );
            }

            await changeVideo(
              video
            );
          } catch (error) {
            console.error(
              error
            );

            setError(
              $("modalError"),
              error.message ||
                "選擇影片失敗"
            );
          }
        }
      );


    /*
     * NEXT QUEUE
     */

    $("playQueueNowBtn")
      ?.addEventListener(
        "click",
        async () => {
          try {
            const played =
              await playNextQueueItem();

            if (!played) {
              toast(
                "待播放清單是空的"
              );
            }
          } catch (error) {
            console.error(
              error
            );

            toast(
              error.message ||
              "播放待播放清單失敗"
            );
          }
        }
      );


    /*
     * RESIZE
     */

    window.addEventListener(
      "resize",
      () => {
        const modal =
          $("sourceModal");

        if (
          modal &&
          !modal.classList.contains(
            "hidden"
          )
        ) {
          configureSearchScroll();
        }
      }
    );


    /*
     * MOBILE VISUAL VIEWPORT
     */

    window.visualViewport?.addEventListener(
      "resize",
      () => {
        const modal =
          $("sourceModal");

        if (
          modal &&
          !modal.classList.contains(
            "hidden"
          )
        ) {
          configureSearchScroll();
        }
      }
    );
  }



  function attachDatabaseConnectionListener() {
    if (
      !db ||
      state.databaseConnectionListenerAttached
    ) {
      return;
    }

    const connectedRef =
      db.ref(".info/connected");

    connectedRef.on(
      "value",
      async (snapshot) => {
        const connected =
          snapshot.val() === true;

        state.databaseConnected =
          connected;

        if ($("authStatus")) {
          $("authStatus").textContent =
            connected
              ? "已連線"
              : "重新連線中…";
        }

        if (
          !connected ||
          !state.roomId ||
          !state.uid ||
          !state.membersRef ||
          state.leavingRoom ||
          state.memberRecoveryInFlight
        ) {
          return;
        }

        state.memberRecoveryInFlight =
          true;

        try {
          if (!state.adminJoinOverride && await isMemberKicked()) {
            await leaveRoomLocally(
              "你已被房主移出房間"
            );
            return;
          }

          await heartbeatMember();

          renderMembers(
            await getMembersOnce()
          );
        } catch (error) {
          console.warn(
            "Firebase reconnect 成員恢復失敗:",
            error
          );
        } finally {
          state.memberRecoveryInFlight =
            false;
        }
      }
    );

    state.databaseConnectionListenerAttached =
      true;
  }



  function getFriendlyAuthError(error) {
    const code =
      String(error?.code || "");

    if (
      code ===
      "auth/network-request-failed"
    ) {
      return "Firebase 網路連線失敗，請稍後再試";
    }

    if (
      code ===
      "auth/too-many-requests"
    ) {
      return "Firebase 請求過於頻繁，請稍後再試";
    }

    if (
      code ===
      "auth/operation-not-allowed"
    ) {
      return "Firebase Anonymous Auth 尚未啟用";
    }

    return (
      error?.message ||
      "Firebase 登入失敗，請稍後再試"
    );
  }


  function showAuthFailure(error) {
    state.authReady =
      false;

    if ($("authStatus")) {
      $("authStatus").textContent =
        "連線失敗";
    }

    setError(
      $("homeError"),
      "Firebase 目前無法連線。請再次按「建立房間」或「加入朋友的房間」重試。"
    );

    toast(
      getFriendlyAuthError(error)
    );
  }


  async function ensureAuthReady(
    options = {}
  ) {
    const maxAttempts =
      Math.max(
        1,
        Number(options.maxAttempts || 4)
      );

    const silent =
      Boolean(options.silent);

    if (!auth) {
      await initializeFirebase();
    }

    const currentUser =
      auth?.currentUser ||
      null;

    if (currentUser) {
      state.uid =
        currentUser.uid;

      state.authReady =
        true;

      updateAuthUI(
        currentUser
      );

      return currentUser;
    }

    if (state.authRetrying) {
      while (state.authRetrying) {
        await new Promise(
          resolve =>
            setTimeout(resolve, 120)
        );
      }

      if (auth?.currentUser) {
        state.uid =
          auth.currentUser.uid;

        state.authReady =
          true;

        return auth.currentUser;
      }
    }

    state.authRetrying =
      true;

    try {
      let lastError =
        null;

      for (
        let attempt = 1;
        attempt <= maxAttempts;
        attempt++
      ) {
        try {
          if ($("authStatus")) {
            $("authStatus").textContent =
              attempt === 1
                ? "連線中…"
                : `重新連線中… ${attempt}/${maxAttempts}`;
          }

          const user =
            await ensureAnonymousAuth();

          if (!user) {
            throw new Error(
              "Firebase Anonymous Auth 沒有回傳使用者"
            );
          }

          state.uid =
            user.uid;

          state.authReady =
            true;

          updateAuthUI(
            user
          );

          setError(
            $("homeError"),
            ""
          );

          return user;
        } catch (error) {
          lastError =
            error;

          state.authReady =
            false;

          if (
            attempt < maxAttempts
          ) {
            const delay =
              Math.min(
                5000,
                800 *
                Math.pow(
                  2,
                  attempt - 1
                )
              );

            if (!silent) {
              toast(
                `Firebase 連線失敗，${Math.ceil(
                  delay / 1000
                )} 秒後重試`
              );
            }

            await new Promise(
              resolve =>
                setTimeout(
                  resolve,
                  delay
                )
            );
          }
        }
      }

      throw (
        lastError ||
        new Error(
          "Firebase Auth 初始化失敗"
        )
      );
    } finally {
      state.authRetrying =
        false;
    }
  }


  /*
   * =========================================================
   * START
   * =========================================================
   */

  async function waitForInitialAuthState(timeoutMs = 5000) {
    if (!auth) {
      return null;
    }

    return new Promise((resolve) => {
      let finished = false;
      let unsubscribe = null;
      let timer = null;

      const finish = (user) => {
        if (finished) {
          return;
        }

        finished = true;

        try {
          unsubscribe?.();
        } catch (_) {}

        clearTimeout(timer);

        resolve(
          user ||
          null
        );
      };

      unsubscribe =
        auth.onAuthStateChanged(
          (user) => {
            finish(user);
          }
        );

      timer =
        setTimeout(
          () => {
            finish(null);
          },
          Math.max(
            1000,
            Number(timeoutMs) || 5000
          )
        );
    });
  }


  async function ensureAnonymousAuth() {
    if (!auth) {
      throw new Error(
        "Firebase Auth 尚未初始化"
      );
    }

    const existingUser =
      auth.currentUser;

    if (existingUser) {
      state.uid =
        existingUser.uid;
      if (existingUser.isAnonymous) {
        if (!isGuestName(localStorage.getItem("wt_name"))) {
          window.WT_CORE?.setGuestName?.();
        }
        state.memberName = localStorage.getItem("wt_name");
      }

      updateAuthUI(
        existingUser
      );

      return existingUser;
    }

    try {
      const credential =
        await auth.signInAnonymously();

      const user =
        credential?.user ||
        auth.currentUser ||
        null;

      state.uid =
        user?.uid ||
        null;

      if (user?.isAnonymous) {
        window.WT_CORE?.setGuestName?.();
      }

      if (!state.uid) {
        throw new Error(
          "Firebase 匿名登入失敗"
        );
      }

      updateAuthUI(
        user
      );

      return user;
    } catch (error) {
      const wrapped = new Error(
        error?.message ||
        "Firebase 匿名登入失敗"
      );

      if (error?.code) {
        wrapped.code = error.code;
      }

      throw wrapped;
    }
  }





  async function start() {
    state.memberName =
      getMemberName();

    setupEvents();

    try {
      await initializeFirebase();

      await handleGoogleRedirectResult();

      await ensureNotGloballyBlocked(auth?.currentUser || null);

      const initialUser =
        await waitForInitialAuthState(
          5000
        );

      if (initialUser) {
        state.uid =
          initialUser.uid;

        state.authReady =
          true;

        updateAuthUI(
          initialUser
        );
      } else {
        await ensureAuthReady({
          silent: false,
          maxAttempts: 4
        });
      }
    } catch (error) {
      console.error(
        "WatchTogether Auth 初始化失敗:",
        error
      );

      showAuthFailure(
        error
      );

      showView(
        "home"
      );

      return;
    }

    const urlParams = new URLSearchParams(location.search);
    state.adminJoinRequested = urlParams.get("adminJoin") === "1";
    state.adminJoinOverride = Boolean(
      state.adminJoinRequested && await isPrivilegedAdminUser()
    );

    const urlRoomId =
      getRoomIdFromUrl();

    const savedRoomId =
      getSavedRoomId();

    const roomId =
      urlRoomId ||
      savedRoomId;

    if (!roomId) {
      showView(
        "home"
      );
      return;
    }

    try {
      await ensureAuthReady({
        silent: false,
        maxAttempts: 4
      });

      await joinRoom(
        roomId
      );
    } catch (error) {
      console.error(
        "自動加入房間失敗:",
        error
      );

      if (
        !urlRoomId &&
        /房間已不存在|找不到這個房間|你已被房主移出/.test(
          error?.message ||
          ""
        )
      ) {
        clearSavedRoomId();
      }

      history.replaceState(
        {},
        "",
        location.pathname
      );

      showView(
        "home"
      );

      const friendlyError =
        getFriendlyAuthError(error);

      setError(
        $("homeError"),
        friendlyError
      );

      if (
        /你已被房主移出/.test(
          String(error?.message || "")
        )
      ) {
        setTimeout(() => {
          const current = $("homeError")?.textContent || "";
          if (current === friendlyError) {
            setError($("homeError"), "");
          }
        }, 4500);
      }

      toast(
        error?.message ||
        "無法進入房間"
      );
    }
  }


  /*
   * =========================================================
   * YOUTUBE CALLBACK
   * =========================================================
   */




  /*
   * =========================================================
   * PAGE UNLOAD
   * =========================================================
   */

  window.WT_CORE =
    window.WT_CORE ||
    {};

  window.WT_CORE.createRoom =
    createRoom;

  window.WT_CORE.createRoomWithVideo =
    createRoomWithVideo;

  window.WT_CORE.setMemberName = setMemberName;
  window.WT_CORE.getMemberName = getMemberName;
  window.WT_CORE.setGuestName = function() {
    const key = "wt_guest_name";
    let name =
      String(
        localStorage.getItem(key) ||
        ""
      ).trim();

    if (!/^訪客\d{3}$/.test(name)) {
      name =
        "訪客" +
        Math.floor(
          Math.random() * 900 + 100
        );
      localStorage.setItem(
        key,
        name
      );
    }

    localStorage.removeItem("wt_name");
    state.memberName = name;
    return name;
  };
  window.WT_CORE.updateCurrentMemberName = updateCurrentMemberName;
  window.WT_CORE.state = state;
  window.WT_CORE.isPrivilegedAdminUser = isPrivilegedAdminUser;
  window.WT_CORE.persistAuthenticatedAccount = persistAuthenticatedAccount;

  window.addEventListener(
    "beforeunload",
    () => {
      clearInterval(
        state.localTimer
      );

      clearInterval(
        state.memberHeartbeatTimer
      );

      unlockPageScroll();
    }
  );


  /*
   * =========================================================
   * RUN
   * =========================================================
   */

  start();







})();
