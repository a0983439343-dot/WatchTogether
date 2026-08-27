```javascript
(() => {
  "use strict";

  const $ = (id) =>
    document.getElementById(id);

  /*
   * =========================================================
   * CONFIG
   * =========================================================
   *
   * 把你的 YouTube API Key 放這裡。
   *
   * 注意：
   * 這個 Key 不能放到正式公開網站而完全不限制，
   * 建議到 Google Cloud Console 限制 API Key 的網域與 API。
   */

  const YOUTUBE_API_KEY =
    "請放你的 YouTube API Key";

  const YOUTUBE_SEARCH_PAGE_SIZE = 50;

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

  const state = {

    uid: null,

    memberName:
      "看片玩家",

    roomId: null,

    room: null,

    isOwner: false,

    roomRef: null,

    membersRef: null,

    chatRef: null,

    queueRef: null,

    player: null,

    playerReady: false,

    playerType: null,

    currentVideoId: null,

    currentVideoUrl: null,

    syncTimer: null,

    memberHeartbeatTimer: null,

    searchResults: [],

    searchNextPageToken: "",

    searchQuery: "",

    searchLoadingMore: false,

    searchBusy: false,

    modalSelectedVideo: null,

    modalSelectedVideoId: "",

    videoListenerAttached: false,

    membersListenerAttached: false,

    chatListenerAttached: false,

    queueListenerAttached: false,

    youtubeReady: false,

    youtubeLoading: false,

    youtubeRequestedId: null,

    youtubeBuildToken: 0,

    queue: {},

    googleRedirectHandled: false,

    modalBodyScrollLocked: false,

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

    const element =
      $("toast");

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
      setTimeout(
        () => {

          element.classList.remove(
            "show"
          );

        },
        2400
      );

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


  function showView(
    view
  ) {

    $("homeView")?.classList.toggle(
      "hidden",
      view !== "home"
    );

    $("roomView")?.classList.toggle(
      "hidden",
      view !== "room"
    );

  }


  function escapeHtml(
    value
  ) {

    return String(
      value ?? ""
    ).replace(
      /[&<>"']/g,
      (character) => {

        const map = {

          "&":
            "&amp;",

          "<":
            "&lt;",

          ">":
            "&gt;",

          '"':
            "&quot;",

          "'":
            "&#039;"

        };

        return map[
          character
        ];

      }
    );

  }


  function formatTime(
    seconds
  ) {

    const number =
      Number(
        seconds
      );

    if (
      !Number.isFinite(
        number
      ) ||
      number < 0
    ) {

      return "00:00";

    }

    const total =
      Math.floor(
        number
      );

    const hours =
      Math.floor(
        total /
          3600
      );

    const minutes =
      Math.floor(
        (total % 3600) /
          60
      );

    const secs =
      total %
      60;

    if (
      hours > 0
    ) {

      return (
        String(
          hours
        ).padStart(
          2,
          "0"
        ) +
        ":" +
        String(
          minutes
        ).padStart(
          2,
          "0"
        ) +
        ":" +
        String(
          secs
        ).padStart(
          2,
          "0"
        )
      );

    }

    return (
      String(
        minutes
      ).padStart(
        2,
        "0"
      ) +
      ":" +
      String(
        secs
      ).padStart(
        2,
        "0"
      )
    );

  }


  function formatViews(
    value
  ) {

    const number =
      Number(
        value
      );

    if (
      !Number.isFinite(
        number
      ) ||
      number <= 0
    ) {

      return "";

    }

    if (
      number >=
      100000000
    ) {

      return (
        (
          number /
          100000000
        )
          .toFixed(
            1
          )
          .replace(
            /\.0$/,
            ""
          ) +
        " 億次觀看"
      );

    }

    if (
      number >=
      10000
    ) {

      return (
        (
          number /
          10000
        )
          .toFixed(
            1
          )
          .replace(
            /\.0$/,
            ""
          ) +
        " 萬次觀看"
      );

    }

    return (
      number.toLocaleString(
        "zh-TW"
      ) +
      " 次觀看"
    );

  }


  function formatDuration(
    seconds
  ) {

    const number =
      Number(
        seconds
      );

    if (
      !Number.isFinite(
        number
      ) ||
      number < 0
    ) {

      return "";

    }

    const total =
      Math.floor(
        number
      );

    const hours =
      Math.floor(
        total /
        3600
      );

    const minutes =
      Math.floor(
        (total % 3600) /
        60
      );

    const secs =
      total %
      60;

    if (
      hours > 0
    ) {

      return (
        String(
          hours
        ) +
        ":" +
        String(
          minutes
        ).padStart(
          2,
          "0"
        ) +
        ":" +
        String(
          secs
        ).padStart(
          2,
          "0"
        )
      );

    }

    return (
      String(
        minutes
      ) +
      ":" +
      String(
        secs
      ).padStart(
        2,
        "0"
      )
    );

  }


  function parseISO8601Duration(
    value
  ) {

    if (!value) {
      return 0;
    }

    const match =
      String(
        value
      ).match(
        /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
      );

    if (!match) {
      return 0;
    }

    const days =
      Number(
        match[1] || 0
      );

    const hours =
      Number(
        match[2] || 0
      );

    const minutes =
      Number(
        match[3] || 0
      );

    const seconds =
      Number(
        match[4] || 0
      );

    return (
      days *
        86400 +
      hours *
        3600 +
      minutes *
        60 +
      seconds
    );

  }


  function randomRoomCode() {

    const chars =
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let result = "";

    for (
      let i = 0;
      i < 6;
      i++
    ) {

      result +=
        chars[
          Math.floor(
            Math.random() *
            chars.length
          )
        ];

    }

    return result;

  }


  function getRoomIdFromUrl() {

    return (
      new URLSearchParams(
        location.search
      )
        .get(
          "room"
        )
        ?.trim()
        .toUpperCase() ||
      ""
    );

  }


  function getRoomLink(
    roomId
  ) {

    return (
      location.origin +
      location.pathname +
      "?room=" +
      encodeURIComponent(
        roomId
      )
    );

  }


  function getMemberName() {

    let name =
      localStorage.getItem(
        "wt_name"
      );

    if (!name) {

      name =
        "玩家" +
        Math.floor(
          Math.random() *
            900 +
            100
        );

      localStorage.setItem(
        "wt_name",
        name
      );

    }

    return name;

  }


  function setMemberName(
    name
  ) {

    const normalized =
      String(
        name || ""
      )
        .trim()
        .slice(
          0,
          30
        );

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
   * PAGE / MODAL SCROLL
   * =========================================================
   *
   * 重要：
   * 不再使用 body.touchAction = none。
   * 手機搜尋結果由真正的結果容器自己滾動。
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


  function configureSearchScroll() {

    const modal =
      $("sourceModal");

    const container =
      $("modalVideoSearchResults");

    if (
      !modal ||
      !container
    ) {

      return;

    }


    modal.style.position =
      "fixed";

    modal.style.inset =
      "0";

    modal.style.width =
      "100vw";

    modal.style.height =
      "100vh";

    modal.style.maxHeight =
      "100vh";

    modal.style.overflow =
      "hidden";

    modal.style.overscrollBehavior =
      "none";


    const isMobile =
      window.innerWidth <=
      760;

    const viewportHeight =
      window.visualViewport?.height ||
      window.innerHeight;


    container.style.position =
      "relative";

    container.style.display =
      "grid";

    container.style.width =
      "100%";

    container.style.boxSizing =
      "border-box";

    container.style.minHeight =
      "0";

    container.style.maxWidth =
      "100%";

    container.style.overflowX =
      "hidden";

    container.style.overflowY =
      "auto";

    container.style.webkitOverflowScrolling =
      "touch";

    container.style.overscrollBehaviorY =
      "contain";

    container.style.touchAction =
      "pan-y";

    container.style.scrollBehavior =
      "auto";


    if (isMobile) {

      const height =
        Math.max(
          200,
          viewportHeight -
            60
        );

      container.style.height =
        `${height}px`;

      container.style.maxHeight =
        `${height}px`;

      container.style.padding =
        "8px 10px 30px";

    } else {

      const height =
        Math.max(
          300,
          viewportHeight -
            150
        );

      container.style.height =
        `${height}px`;

      container.style.maxHeight =
        `${height}px`;

      container.style.paddingRight =
        "10px";

    }


    /*
     * 桌面滑鼠滾輪。
     */

    if (
      !container.__wtWheelAttached
    ) {

      container.addEventListener(
        "wheel",
        (event) => {

          if (
            Math.abs(
              event.deltaY
            ) < 0.01
          ) {

            return;

          }

          if (
            container.scrollHeight <=
            container.clientHeight
          ) {

            return;

          }

          event.preventDefault();

          container.scrollTop +=
            event.deltaY;

        },
        {
          passive:
            false
        }
      );

      container.__wtWheelAttached =
        true;

    }


    /*
     * 手機：
     * 不 preventDefault。
     * 完全交給瀏覽器原生觸控滾動。
     */

    if (
      !container.__wtTouchConfigured
    ) {

      container.addEventListener(
        "touchstart",
        () => {},
        {
          passive:
            true
        }
      );

      container.addEventListener(
        "touchmove",
        () => {},
        {
          passive:
            true
        }
      );

      container.__wtTouchConfigured =
        true;

    }

  }


  /*
   * =========================================================
   * AUTH UI
   * =========================================================
   */

  function updateAuthUI() {

    const loginButton =
      $("googleLoginBtn");

    const accountButton =
      $("accountBtn");

    const logoutButton =
      $("logoutBtn");

    const authStatus =
      $("authStatus");

    const currentUser =
      auth?.currentUser ||
      null;


    if (currentUser) {

      /*
       * 登入之後頂部只顯示「已連線」。
       */

      if (authStatus) {

        authStatus.textContent =
          "已連線";

      }


      /*
       * Google 已登入後：
       * 隱藏 Google 登入按鈕。
       */

      loginButton?.classList.toggle(
        "hidden",
        !currentUser.isAnonymous
      );


      /*
       * 帳號按鈕只有已登入 Firebase
       * 才顯示。
       */

      accountButton?.classList.remove(
        "hidden"
      );


      /*
       * 只有非匿名 Google 帳號才顯示登出。
       */

      logoutButton?.classList.toggle(
        "hidden",
        currentUser.isAnonymous
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

    accountButton?.classList.add(
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

  async function initializeFirebase() {

    if (!window.firebase) {

      throw new Error(
        "Firebase SDK 尚未載入"
      );

    }

    if (
      !window.FIREBASE_CONFIG
    ) {

      throw new Error(
        "找不到 Firebase 設定"
      );

    }


    if (
      !firebase.apps.length
    ) {

      firebase.initializeApp(
        window.FIREBASE_CONFIG
      );

    }


    auth =
      firebase.auth();

    db =
      firebase.database();


    auth.onAuthStateChanged(
      (user) => {

        if (user) {

          state.uid =
            user.uid;

          if (
            !user.isAnonymous &&
            user.displayName &&
            !localStorage.getItem(
              "wt_name"
            )
          ) {

            try {

              setMemberName(
                user.displayName
              );

            } catch (_) {}

          }

        } else {

          state.uid =
            null;

        }

        updateAuthUI();

      }
    );


    if (
      !auth.currentUser
    ) {

      await auth.signInAnonymously();

    }


    state.uid =
      auth.currentUser?.uid ||
      null;


    if (!state.uid) {

      throw new Error(
        "Firebase 匿名登入失敗"
      );

    }


    updateAuthUI();

  }


  /*
   * =========================================================
   * GOOGLE LOGIN
   * =========================================================
   */

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


    /*
     * 優先把匿名帳號連結 Google。
     * 成功後 UID 不會改變。
     */

    if (
      currentUser &&
      currentUser.isAnonymous
    ) {

      try {

        localStorage.setItem(
          "wt_google_link_pending",
          "1"
        );

        await currentUser.linkWithRedirect(
          provider
        );

        return;

      } catch (error) {

        localStorage.removeItem(
          "wt_google_link_pending"
        );


        if (
          error?.code ===
          "auth/credential-already-in-use"
        ) {

          await auth.signInWithRedirect(
            provider
          );

          return;

        }

        throw error;

      }

    }


    await auth.signInWithRedirect(
      provider
    );

  }


  async function handleGoogleRedirectResult() {

    if (
      !auth ||
      state.googleRedirectHandled
    ) {

      return;

    }

    state.googleRedirectHandled =
      true;


    try {

      const result =
        await auth.getRedirectResult();


      if (
        result?.user
      ) {

        const user =
          result.user;

        state.uid =
          user.uid;


        if (
          user.displayName &&
          !localStorage.getItem(
            "wt_name"
          )
        ) {

          try {

            setMemberName(
              user.displayName
            );

          } catch (_) {}

        }


        updateAuthUI();


        if (
          state.membersRef
        ) {

          try {

            await updateCurrentMemberName();

          } catch (error) {

            console.warn(
              "更新成員名稱失敗:",
              error
            );

          }

        }


        toast(
          "Google 登入成功"
        );

      }

    } catch (error) {

      console.error(
        "Google 登入失敗:",
        error
      );

      toast(
        error?.message ||
        "Google 登入失敗"
      );

    }

  }


  async function logout() {

    if (!auth) {
      return;
    }


    const currentUser =
      auth.currentUser;


    /*
     * 未登入或匿名使用者
     * 不應該執行登出流程。
     */

    if (
      !currentUser ||
      currentUser.isAnonymous
    ) {

      return;

    }


    try {

      await auth.signOut();

      await auth.signInAnonymously();


      state.uid =
        auth.currentUser?.uid ||
        null;


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
        "登出失敗"
      );

    }

  }


  /*
   * =========================================================
   * NAME
   * =========================================================
   */

  function openNameModal() {

    const modal =
      $("nameModal");

    if (!modal) {

      toast(
        "找不到修改名稱視窗"
      );

      return;

    }


    const input =
      $("nameInput");


    if (input) {

      input.value =
        state.memberName ||
        getMemberName();

    }


    setError(
      $("nameError"),
      ""
    );


    modal.classList.remove(
      "hidden"
    );


    setTimeout(
      () => {

        input?.focus();

        input?.select();

      },
      100
    );

  }


  function closeNameModal() {

    $("nameModal")?.classList.add(
      "hidden"
    );

    setError(
      $("nameError"),
      ""
    );

  }


  async function updateCurrentMemberName() {

    if (
      !state.membersRef ||
      !state.uid
    ) {

      return;

    }


    try {

      await state.membersRef
        .child(
          state.uid
        )
        .update({

          name:
            state.memberName,

          online:
            true,

          lastSeen:
            firebase.database
              .ServerValue
              .TIMESTAMP

        });

    } catch (error) {

      console.error(
        "更新成員資料失敗:",
        error
      );

      throw error;

    }

  }


  async function getMembersOnce() {

    if (
      !state.membersRef
    ) {

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


  async function saveName() {

    const input =
      $("nameInput");


    const newName =
      String(
        input?.value ||
        ""
      )
        .trim()
        .slice(
          0,
          30
        );


    if (!newName) {

      setError(
        $("nameError"),
        "名稱不能是空白"
      );

      return;

    }


    try {

      setMemberName(
        newName
      );


      const user =
        auth?.currentUser;


      if (
        user &&
        !user.isAnonymous
      ) {

        try {

          await user.updateProfile({
            displayName:
              newName
          });

        } catch (error) {

          console.warn(
            "更新 Google displayName 失敗:",
            error
          );

        }

      }


      try {

        await updateCurrentMemberName();

      } catch (error) {

        /*
         * 名稱先保存到 localStorage，
         * Firebase 權限錯誤不再讓整個改名失敗。
         */

        console.warn(
          "Firebase 成員名稱同步失敗:",
          error
        );

      }


      updateAuthUI();


      try {

        renderMembers(
          await getMembersOnce()
        );

      } catch (_) {}


      closeNameModal();


      toast(
        "名稱已更新"
      );

    } catch (error) {

      console.error(
        "修改名稱失敗:",
        error
      );


      setError(
        $("nameError"),
        error.message ||
          "修改名稱失敗"
      );

    }

  }


  /*
   * =========================================================
   * ID PARSERS
   * =========================================================
   */

  function getYoutubeId(
    value
  ) {

    if (!value) {
      return null;
    }


    const text =
      String(
        value
      ).trim();


    if (
      /^[A-Za-z0-9_-]{11}$/.test(
        text
      )
    ) {

      return text;

    }


    try {

      const url =
        new URL(
          text
        );


      if (
        url.hostname.includes(
          "youtu.be"
        )
      ) {

        return (
          url.pathname
            .replace(
              /^\/+/,
              ""
            )
            .split(
              "/"
            )[0] ||
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
            url.searchParams.get(
              "v"
            ) ||
            null
          );

        }


        if (
          url.pathname.startsWith(
            "/shorts/"
          )
        ) {

          return (
            url.pathname
              .split(
                "/"
              )[2] ||
            null
          );

        }


        if (
          url.pathname.startsWith(
            "/embed/"
          )
        ) {

          return (
            url.pathname
              .split(
                "/"
              )[2] ||
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
            url.pathname
              .split(
                "/"
              )[2] ||
            null
          );

        }

      }

    } catch (_) {}


    return null;

  }


  function getVimeoId(
    value
  ) {

    if (!value) {
      return null;
    }


    const text =
      String(
        value
      ).trim();


    if (
      /^\d+$/.test(
        text
      )
    ) {

      return text;

    }


    try {

      const url =
        new URL(
          text
        );


      if (
        url.hostname.includes(
          "vimeo.com"
        ) ||
        url.hostname.includes(
          "player.vimeo.com"
        )
      ) {

        const match =
          url.pathname.match(
            /(?:video\/)?(\d+)/
          );

        return (
          match?.[1] ||
          null
        );

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


  function getDailymotionId(
    value
  ) {

    if (!value) {
      return null;
    }


    const text =
      String(
        value
      ).trim();


    try {

      const url =
        new URL(
          text
        );


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
        url.hostname.includes(
          "dai.ly"
        )
      ) {

        return (
          url.pathname
            .replace(
              /^\/+/,
              ""
            )
            .split(
              "/"
            )[0] ||
          null
        );

      }

    } catch (_) {}


    if (
      /^[A-Za-z0-9]+$/.test(
        text
      ) &&
      text.length >= 5
    ) {

      return text;

    }


    return null;

  }


  function getBilibiliId(
    value
  ) {

    if (!value) {
      return null;
    }


    const text =
      String(
        value
      ).trim();


    if (
      /^BV[a-zA-Z0-9]+$/.test(
        text
      )
    ) {

      return text;

    }


    if (
      /^av\d+$/i.test(
        text
      )
    ) {

      return text;

    }


    try {

      const url =
        new URL(
          text
        );


      const bv =
        url.pathname.match(
          /(BV[a-zA-Z0-9]+)/
        );


      if (
        bv?.[1]
      ) {

        return bv[1];

      }


      const av =
        url.pathname.match(
          /\/av(\d+)/i
        );


      if (
        av?.[1]
      ) {

        return (
          "av" +
          av[1]
        );

      }

    } catch (_) {}


    return null;

  }


  function getTwitchValue(
    value
  ) {

    if (!value) {
      return null;
    }


    const text =
      String(
        value
      ).trim();


    try {

      const url =
        new URL(
          text
        );


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
          .split(
            "/"
          )
          .filter(
            Boolean
          );


      if (
        !parts.length
      ) {

        return null;

      }


      if (
        parts[0] ===
          "videos" &&
        parts[1]
      ) {

        return {

          type:
            "video",

          value:
            parts[1]

        };

      }


      if (
        parts[0] ===
          "clip" &&
        parts[1]
      ) {

        return {

          type:
            "clip",

          value:
            parts[1]

        };

      }


      return {

        type:
          "channel",

        value:
          parts[0]

      };

    } catch (_) {}


    if (
      /^\d+$/.test(
        text
      )
    ) {

      return {

        type:
          "video",

        value:
          text

      };

    }


    return {

      type:
        "channel",

      value:
        text.replace(
          /^@/,
          ""
        )

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


    if (
      !YOUTUBE_API_KEY ||
      YOUTUBE_API_KEY.startsWith(
        "請"
      )
    ) {

      throw new Error(
        "請先把 YouTube API Key 放到 app.js"
      );

    }


    if (
      append &&
      state.searchQuery ===
        query &&
      !state.searchNextPageToken
    ) {

      toast(
        "已經沒有更多結果"
      );

      return [];

    }


    const url =
      new URL(
        "https://www.googleapis.com/youtube/v3/search"
      );


    url.searchParams.set(
      "part",
      "snippet"
    );


    url.searchParams.set(
      "q",
      query
    );


    url.searchParams.set(
      "type",
      "video"
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


    /*
     * 只要求 YouTube 回傳可以嵌入的影片。
     */

    url.searchParams.set(
      "videoEmbeddable",
      "true"
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


    url.searchParams.set(
      "key",
      YOUTUBE_API_KEY
    );


    const response =
      await fetch(
        url.toString()
      );


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
        data.items
      )
        ? data.items
        : [];


    const ids =
      items
        .map(
          (item) =>
            item?.id?.videoId
        )
        .filter(
          Boolean
        );


    /*
     * 一次用 videos API 取得影片
     * 長度與觀看數。
     */

    let detailMap = {};


    if (
      ids.length
    ) {

      try {

        const detailUrl =
          new URL(
            "https://www.googleapis.com/youtube/v3/videos"
          );


        detailUrl.searchParams.set(
          "part",
          "contentDetails,statistics"
        );


        detailUrl.searchParams.set(
          "id",
          ids.join(
            ","
          )
        );


        detailUrl.searchParams.set(
          "key",
          YOUTUBE_API_KEY
        );


        const detailResponse =
          await fetch(
            detailUrl.toString()
          );


        if (
          detailResponse.ok
        ) {

          const detailData =
            await detailResponse.json();


          for (
            const item of
            Array.isArray(
              detailData.items
            )
              ? detailData.items
              : []
          ) {

            detailMap[
              item.id
            ] =
              item;

          }

        }

      } catch (error) {

        console.warn(
          "YouTube 詳細資料載入失敗:",
          error
        );

      }

    }


    const results =
      items
        .map(
          (item) => {

            const id =
              item?.id?.videoId;


            const snippet =
              item?.snippet ||
              {};


            if (!id) {
              return null;
            }


            const detail =
              detailMap[id] ||
              {};


            const statistics =
              detail.statistics ||
              {};


            const contentDetails =
              detail.contentDetails ||
              {};


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
                snippet.thumbnails
                  ?.maxres
                  ?.url ||
                snippet.thumbnails
                  ?.high
                  ?.url ||
                snippet.thumbnails
                  ?.medium
                  ?.url ||
                snippet.thumbnails
                  ?.default
                  ?.url ||
                "",

              viewCount:
                Number(
                  statistics.viewCount ||
                  0
                ),

              likeCount:
                Number(
                  statistics.likeCount ||
                  0
                ),

              duration:
                contentDetails.duration ||
                "",

              durationSeconds:
                parseISO8601Duration(
                  contentDetails.duration
                ),

              live:
                Boolean(
                  snippet.liveBroadcastContent &&
                  snippet.liveBroadcastContent !==
                    "none"
                )

            };

          }
        )
        .filter(
          Boolean
        );


    state.searchNextPageToken =
      data.nextPageToken ||
      "";


    state.searchQuery =
      query;


    if (append) {

      const existingIds =
        new Set(
          state.searchResults.map(
            (item) =>
              String(
                item.id
              )
          )
        );


      for (
        const item of
        results
      ) {

        if (
          !existingIds.has(
            String(
              item.id
            )
          )
        ) {

          state.searchResults.push(
            item
          );

        }

      }

    } else {

      state.searchResults =
        results;

      state.modalSelectedVideo =
        null;

      state.modalSelectedVideoId =
        "";

    }


    renderSearchResults(
      state.searchResults
    );


    return results;

  }


  /*
   * =========================================================
   * SEARCH OBSERVER
   * =========================================================
   */

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


    if (
      !state.searchQuery
    ) {

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

      configureSearchScroll();

    }

  }


  function setupYoutubeInfiniteScroll() {

    disconnectSearchObserver();


    const container =
      $("modalVideoSearchResults");


    if (!container) {
      return;
    }


    const sentinel =
      $("youtubeLoadMore");


    if (
      !sentinel ||
      !state.searchNextPageToken
    ) {

      return;

    }


    if (
      typeof IntersectionObserver ===
      "undefined"
    ) {

      return;

    }


    const observer =
      new IntersectionObserver(
        (entries) => {

          const entry =
            entries[0];


          if (
            !entry?.isIntersecting
          ) {

            return;

          }


          if (
            state.searchLoadingMore
          ) {

            return;

          }


          if (
            !state.searchNextPageToken
          ) {

            return;

          }


          void loadMoreYoutubeResults();

        },
        {

          root:
            container,

          rootMargin:
            "800px 0px",

          threshold:
            0.01

        }
      );


    container.__youtubeObserver =
      observer;


    observer.observe(
      sentinel
    );

  }


  /*
   * =========================================================
   * SEARCH RESULT RENDER
   * =========================================================
   */

  function renderSearchResults(
    results
  ) {

    const container =
      $("modalVideoSearchResults");


    if (!container) {
      return;
    }


    disconnectSearchObserver();


    state.searchResults =
      Array.isArray(
        results
      )
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
        .map(
          (video) => {

            const selected =
              String(
                state.modalSelectedVideoId ||
                ""
              ) ===
              String(
                video.id
              );


            const durationText =
              formatDuration(
                video.durationSeconds
              );


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
                    padding:
                      0 12px 12px;
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


                  <button
                    type="button"
                    class="tiny-btn"
                    data-video-queue="${escapeHtml(
                      video.id
                    )}"
                  >
                    ＋ 待播放
                  </button>

                </div>

              </div>
            `;

          }
        )
        .join("");


    /*
     * 載入更多。
     */

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
              繼續往下滑會自動載入更多
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


    /*
     * 選取。
     */

    container
      .querySelectorAll(
        "[data-video-select]"
      )
      .forEach(
        (button) => {

          button.addEventListener(
            "click",
            () => {

              selectSearchVideo(
                button.dataset
                  .videoSelect
              );

            }
          );

        }
      );


    /*
     * 直接播放。
     */

    container
      .querySelectorAll(
        "[data-video-play]"
      )
      .forEach(
        (button) => {

          button.addEventListener(
            "click",
            async (
              event
            ) => {

              event.preventDefault();

              event.stopPropagation();


              const video =
                state.searchResults.find(
                  (item) =>
                    String(
                      item.id
                    ) ===
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

        }
      );


    /*
     * 加入待播放。
     */

    container
      .querySelectorAll(
        "[data-video-queue]"
      )
      .forEach(
        (button) => {

          button.addEventListener(
            "click",
            async (
              event
            ) => {

              event.preventDefault();

              event.stopPropagation();


              const video =
                state.searchResults.find(
                  (item) =>
                    String(
                      item.id
                    ) ===
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

        }
      );


    const moreButton =
      $("youtubeLoadMoreBtn");


    moreButton?.addEventListener(
      "click",
      (event) => {

        event.preventDefault();

        void loadMoreYoutubeResults();

      }
    );


    /*
     * 重新建立手機 / 桌面 scroll host。
     */

    configureSearchScroll();


    setupYoutubeInfiniteScroll();

  }


  function selectSearchVideo(
    id
  ) {

    const video =
      state.searchResults.find(
        (item) =>
          String(
            item.id
          ) ===
          String(
            id
          )
      );


    if (!video) {
      return;
    }


    state.modalSelectedVideo =
      {

        ...video,

        platform:
          "youtube"

      };


    state.modalSelectedVideoId =
      String(
        id
      );


    const container =
      $("modalVideoSearchResults");


    if (container) {

      container.dataset.selectedVideoId =
        String(
          id
        );


      container
        .querySelectorAll(
          "[data-video-id]"
        )
        .forEach(
          (item) => {

            item.classList.toggle(
              "selected",

              String(
                item.dataset
                  .videoId
              ) ===
              String(
                id
              )

            );

          }
        );

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
          String(
            item.id
          ) ===
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


    if (
      platform ===
      "youtube"
    ) {

      const id =
        getYoutubeId(
          rawValue
        );


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


    if (
      platform ===
      "vimeo"
    ) {

      const id =
        getVimeoId(
          rawValue
        );


      if (!id) {
        return null;
      }


      return {

        id,

        url:
          String(
            rawValue
          ),

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


    if (
      platform ===
      "dailymotion"
    ) {

      const id =
        getDailymotionId(
          rawValue
        );


      if (!id) {
        return null;
      }


      return {

        id,

        url:
          String(
            rawValue
          ),

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


    if (
      platform ===
      "bilibili"
    ) {

      const id =
        getBilibiliId(
          rawValue
        );


      if (!id) {
        return null;
      }


      return {

        id,

        url:
          String(
            rawValue
          ),

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


    if (
      platform ===
      "twitch"
    ) {

      const value =
        getTwitchValue(
          rawValue
        );


      if (!value) {
        return null;
      }


      return {

        id:
          value.value,

        twitchType:
          value.type,

        url:
          String(
            rawValue
          ),

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
        String(
          rawValue
        ),

      url:
        String(
          rawValue
        ),

      platform,

      title:
        title ||
        PLATFORMS[
          platform
        ]?.name ||
        platform,

      thumbnail:
        "",

      channel:
        PLATFORMS[
          platform
        ]?.name ||
        platform

    };

  }


  /*
   * =========================================================
   * QUEUE
   * =========================================================
   */

  async function addToQueue(
    video
  ) {

    if (
      !state.queueRef ||
      !state.uid
    ) {

      throw new Error(
        "目前不在房間內"
      );

    }


    if (!video?.id) {

      throw new Error(
        "無效的影片"
      );

    }


    const duplicate =
      Object.values(
        state.queue ||
        {}
      ).some(
        (item) => {

          return (
            String(
              item?.id ||
              ""
            ) ===
            String(
              video.id
            ) &&
            String(
              item?.platform ||
              "youtube"
            ) ===
            String(
              video.platform ||
              "youtube"
            )
          );

        }
      );


    if (duplicate) {

      throw new Error(
        "這部影片已經在待播放清單"
      );

    }


    const item = {

      id:
        String(
          video.id
        ),

      platform:
        video.platform ||
        "youtube",

      title:
        video.title ||
        "未命名影片",

      thumbnail:
        video.thumbnail ||
        "",

      channel:
        video.channel ||
        "YouTube",

      addedBy:
        state.uid,

      addedByName:
        state.memberName,

      addedAt:
        firebase.database
          .ServerValue
          .TIMESTAMP

    };


    if (video.url) {

      item.url =
        String(
          video.url
        );

    }


    if (video.twitchType) {

      item.twitchType =
        video.twitchType;

    }


    await state.queueRef.push(
      item
    );

  }


  async function removeFromQueue(
    queueId
  ) {

    if (
      !state.queueRef ||
      !queueId
    ) {

      return;

    }


    await state.queueRef
      .child(
        queueId
      )
      .remove();


    toast(
      "已從待播放清單移除"
    );

  }


  async function playQueueItem(
    queueId
  ) {

    const item =
      state.queue?.[
        queueId
      ];


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
      state.queueRef
    ) {

      await state.queueRef
        .child(
          queueId
        )
        .remove();

    }

  }


  function getSortedQueue() {

    return Object.entries(
      state.queue ||
      {}
    )
      .map(
        ([id, item]) => ({

          ...item,

          queueId:
            id

        })
      )
      .sort(
        (a, b) => {

          return (
            Number(
              a.addedAt ||
              0
            ) -
            Number(
              b.addedAt ||
              0
            )
          );

        }
      );

  }


  function renderQueue() {

    const container =
      $("queueList");


    if (!container) {
      return;
    }


    const list =
      getSortedQueue();


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
          ) => {

            return `
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
                    ${
                      index +
                      1
                    }
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

                  <button
                    type="button"
                    class="tiny-btn"
                    data-queue-play="${escapeHtml(
                      item.queueId
                    )}"
                  >
                    ▶ 播放
                  </button>

                  <button
                    type="button"
                    class="tiny-btn"
                    data-queue-remove="${escapeHtml(
                      item.queueId
                    )}"
                  >
                    移除
                  </button>

                </div>

              </div>
            `;

          }
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


  async function playNextQueueItem() {

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

  function hidePlayers(
    keepYoutube = false
  ) {

    [

      "vimeoPlayer",

      "dailymotionPlayer",

      "bilibiliPlayer",

      "twitchPlayer",

      "directVideo",

      "emptyPlayer",

      "platformPlayerNotice"

    ].forEach(
      (id) => {

        $(id)?.classList.add(
          "hidden"
        );

      }
    );


    const youtube =
      $("youtubePlayer");


    if (
      youtube &&
      !keepYoutube
    ) {

      youtube.classList.add(
        "hidden"
      );

    }

  }


  function showPlayerElement(
    id
  ) {

    $(id)?.classList.remove(
      "hidden"
    );

  }


  function forceYoutubeVisible() {

    const element =
      $("youtubePlayer");


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


    if (
      element.tagName ===
      "IFRAME"
    ) {

      element.style.border =
        "0";

    }

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


    if (!old) {

      return;

    }


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

        old.destroy?.();

      }

    } catch (_) {}

  }


  /*
   * =========================================================
   * LOCAL PLAYER STATE
   * =========================================================
   *
   * 注意：
   * 這版刻意不再使用 Firebase /state。
   * 每個人的播放只由自己本地播放器控制。
   * 房間內所有人仍然是同一個影片。
   */

  function currentPosition() {

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
            player.getCurrentTime()
          ) || 0
        );

      }


      if (
        state.playerType ===
        "twitch"
      ) {

        return (
          Number(
            player.getCurrentTime()
          ) || 0
        );

      }

    } catch (_) {}


    return 0;

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

      if (
        type ===
        "youtube"
      ) {

        return (
          Number(
            player.getCurrentTime()
          ) || 0
        );

      }


      if (
        type ===
        "vimeo"
      ) {

        return (
          Number(
            await player.getCurrentTime()
          ) || 0
        );

      }


      if (
        type ===
        "dailymotion"
      ) {

        if (
          typeof player.currentTime ===
          "function"
        ) {

          return (
            Number(
              await player.currentTime()
            ) || 0
          );

        }

        return (
          Number(
            player.currentTime
          ) || 0
        );

      }


      if (
        type ===
        "twitch"
      ) {

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

      if (
        type ===
        "youtube"
      ) {

        return (
          Number(
            player.getDuration()
          ) || 0
        );

      }


      if (
        type ===
        "vimeo"
      ) {

        return (
          Number(
            await player.getDuration()
          ) || 0
        );

      }


      if (
        type ===
        "dailymotion"
      ) {

        if (
          typeof player.duration ===
          "function"
        ) {

          return (
            Number(
              await player.duration()
            ) || 0
          );

        }

        return (
          Number(
            player.duration
          ) || 0
        );

      }


      if (
        type ===
        "twitch"
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

      if (
        type ===
        "youtube" &&
        window.YT?.PlayerState
      ) {

        return (
          player.getPlayerState() ===
          YT.PlayerState.PLAYING
        );

      }


      if (
        type ===
        "vimeo"
      ) {

        return !(
          await player.getPaused()
        );

      }


      if (
        type ===
        "dailymotion"
      ) {

        if (
          typeof player.paused ===
          "function"
        ) {

          return !(
            await player.paused()
          );

        }

        return !player.paused;

      }


      if (
        type ===
        "twitch"
      ) {

        return !player.isPaused();

      }

    } catch (_) {}


    return false;

  }


  function updateTimeUI() {

    const readout =
      $("timeReadout");


    if (!readout) {
      return;
    }


    /*
     * updateTimeUI 保留，
     * 但是不再寫 Firebase。
     */

    readout.textContent =
      `${formatTime(
        currentPosition()
      )} / ${formatTime(
        duration()
      )}`;

  }


  function startLocalTimeUpdate() {

    clearInterval(
      state.syncTimer
    );


    state.syncTimer =
      setInterval(
        () => {

          updateTimeUI();


          if (
            state.playerType ===
            "youtube"
          ) {

            forceYoutubeVisible();

          }

        },
        1000
      );

  }


  async function applyPlayerPosition(
    seconds
  ) {

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
        Number(
          seconds
        ) || 0
      );


    try {

      if (
        type ===
        "youtube"
      ) {

        player.seekTo(
          target,
          true
        );

      }


      if (
        type ===
        "vimeo"
      ) {

        await player.setCurrentTime(
          target
        );

      }


      if (
        type ===
        "dailymotion"
      ) {

        if (
          typeof player.seek ===
          "function"
        ) {

          await player.seek(
            target
          );

        }

      }


      if (
        type ===
        "twitch"
      ) {

        if (
          typeof player.seek ===
          "function"
        ) {

          player.seek(
            target
          );

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


  async function playPlayer() {

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

        /*
         * 瀏覽器自動播放限制。
         * mute 只在程式自動播放時暫時使用。
         */

        state.player.mute();

        state.player.playVideo();

      }


      if (
        state.playerType ===
        "vimeo"
      ) {

        await state.player.play();

      }


      if (
        state.playerType ===
        "dailymotion"
      ) {

        await state.player.play();

      }


      if (
        state.playerType ===
        "twitch"
      ) {

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


    try {

      if (
        state.playerType ===
        "youtube"
      ) {

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
            setInterval(
              () => {

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

              },
              100
            );


          setTimeout(
            () => {

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

            },
            10000
          );


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
            setInterval(
              () => {

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

              },
              100
            );


          setTimeout(
            () => {

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

            },
            10000
          );


          return;

        }


        const playerId =
          window.DAILYMOTION_PLAYER_ID ||
          "";


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
          `https://geo.dailymotion.com/player/${encodeURIComponent(
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
            setInterval(
              () => {

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

              },
              100
            );


          setTimeout(
            () => {

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

            },
            10000
          );


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

  async function buildYoutubePlayer(
    videoId,
    autoplay = true
  ) {

    if (!videoId) {
      return;
    }


    const initial =
      $("youtubePlayer");


    if (!initial) {

      throw new Error(
        "找不到 youtubePlayer"
      );

    }


    if (
      state.playerReady &&
      state.player &&
      state.playerType ===
        "youtube" &&
      state.currentVideoId ===
        videoId
    ) {

      forceYoutubeVisible();


      if (autoplay) {

        try {

          state.player.mute();

          state.player.playVideo();

        } catch (_) {}

      }


      return;

    }


    if (
      state.youtubeLoading &&
      state.youtubeRequestedId ===
        videoId
    ) {

      return;

    }


    state.youtubeRequestedId =
      videoId;

    state.youtubeLoading =
      true;


    const token =
      ++state.youtubeBuildToken;


    try {

      /*
       * YT API 尚未準備好。
       */

      if (
        !window.YT ||
        typeof window.YT.Player !==
          "function"
      ) {

        initial.classList.remove(
          "hidden"
        );


        $("playerPlaceholder")
          ?.classList.remove(
            "hidden"
          );


        if (
          $("playerPlaceholder")
        ) {

          $("playerPlaceholder")
            .textContent =
            "YouTube 播放器載入中…";

        }


        setTimeout(
          () => {

            if (
              state.youtubeBuildToken !==
                token ||
              state.youtubeRequestedId !==
                videoId
            ) {

              return;

            }


            void buildYoutubePlayer(
              videoId,
              autoplay
            );

          },
          500
        );


        return;

      }


      /*
       * 清掉舊播放器。
       */

      if (
        state.player &&
        state.playerType ===
          "youtube"
      ) {

        const old =
          state.player;


        state.player =
          null;

        state.playerReady =
          false;

        state.playerType =
          null;


        try {

          old.destroy?.();

        } catch (_) {}

      } else if (
        state.player
      ) {

        await destroyCurrentPlayer();

      }


      if (
        state.youtubeBuildToken !==
          token ||
        state.youtubeRequestedId !==
          videoId
      ) {

        return;

      }


      let container =
        $("youtubePlayer");


      if (!container) {

        throw new Error(
          "找不到 youtubePlayer"
        );

      }


      /*
       * YouTube API 建立播放器時，
       * 必須使用乾淨 DIV。
       */

      if (
        container.tagName ===
        "IFRAME"
      ) {

        const replacement =
          document.createElement(
            "div"
          );


        replacement.id =
          "youtubePlayer";


        replacement.className =
          "youtube-player";


        container.replaceWith(
          replacement
        );


        container =
          replacement;

      }


      hidePlayers(
        true
      );


      container.classList.remove(
        "hidden"
      );


      container.style.display =
        "block";

      container.style.visibility =
        "visible";

      container.style.opacity =
        "1";

      container.style.width =
        "100%";

      container.style.height =
        "100%";


      $("playerPlaceholder")
        ?.classList.add(
          "hidden"
        );


      state.player =
        null;

      state.playerReady =
        false;

      state.playerType =
        "youtube";

      state.currentVideoId =
        videoId;

      state.currentVideoUrl =
        null;


      const player =
        new YT.Player(
          "youtubePlayer",
          {

            videoId,

            width:
              "100%",

            height:
              "100%",


            playerVars: {

              autoplay:
                autoplay
                  ? 1
                  : 0,

              controls:
                1,

              playsinline:
                1,

              rel:
                0,

              modestbranding:
                1,

              enablejsapi:
                1,

              origin:
                location.origin

            },


            events: {

              onReady:
                async (
                  event
                ) => {

                  if (
                    state.youtubeBuildToken !==
                      token ||
                    state.youtubeRequestedId !==
                      videoId
                  ) {

                    try {

                      event.target.destroy?.();

                    } catch (_) {}

                    return;

                  }


                  state.player =
                    event.target;

                  state.playerReady =
                    true;

                  state.playerType =
                    "youtube";

                  state.currentVideoId =
                    videoId;

                  state.currentVideoUrl =
                    null;


                  forceYoutubeVisible();


                  $("playerPlaceholder")
                    ?.classList.add(
                      "hidden"
                    );


                  try {

                    event.target.setVolume(
                      100
                    );

                  } catch (_) {}


                  if (
                    $("syncStatus")
                  ) {

                    $("syncStatus")
                      .textContent =
                      "影片已載入";

                  }


                  updateTimeUI();


                  /*
                   * 不再從 Firebase 讀取播放位置。
                   */

                  if (
                    autoplay &&
                    state.player ===
                      event.target
                  ) {

                    try {

                      event.target.mute();

                      event.target.playVideo();

                    } catch (_) {}

                  }


                  forceYoutubeVisible();


                  startLocalTimeUpdate();


                  setTimeout(
                    forceYoutubeVisible,
                    100
                  );

                  setTimeout(
                    forceYoutubeVisible,
                    500
                  );

                  setTimeout(
                    forceYoutubeVisible,
                    1200
                  );

                },


              onStateChange:
                async (
                  event
                ) => {

                  if (
                    state.youtubeBuildToken !==
                      token
                  ) {

                    return;

                  }


                  if (
                    state.player !==
                    event.target
                  ) {

                    return;

                  }


                  forceYoutubeVisible();


                  if (
                    event.data ===
                    YT.PlayerState.ENDED
                  ) {

                    /*
                     * 房主仍然可以自動播放
                     * 待播放清單下一部。
                     */

                    if (
                      state.isOwner
                    ) {

                      setTimeout(
                        async () => {

                          await playNextQueueItem();

                        },
                        300
                      );

                    }

                  }


                  updateTimeUI();

                },


              onError:
                (
                  event
                ) => {

                  console.error(
                    "YouTube player error:",
                    event
                  );


                  if (
                    $("syncStatus")
                  ) {

                    $("syncStatus")
                      .textContent =
                      "YouTube 播放器錯誤";

                  }


                  toast(
                    "這支 YouTube 影片無法嵌入播放"
                  );

                }

            }

          }
        );


      void player;

    } catch (error) {

      console.error(
        "YouTube 播放器建立失敗:",
        error
      );


      state.player =
        null;

      state.playerReady =
        false;

      state.playerType =
        null;

      state.currentVideoId =
        null;


      hidePlayers();


      showPlayerElement(
        "emptyPlayer"
      );


      toast(
        error.message ||
        "YouTube 播放器建立失敗"
      );

    } finally {

      if (
        state.youtubeBuildToken ===
        token
      ) {

        state.youtubeLoading =
          false;

      }

    }

  }


  /*
   * =========================================================
   * VIMEO
   * =========================================================
   */

  async function buildVimeoPlayer(
    video
  ) {

    await destroyCurrentPlayer();

    await loadVimeoSdk();

    hidePlayers();

    showPlayerElement(
      "vimeoPlayer"
    );


    const container =
      $("vimeoPlayer");


    if (!container) {

      throw new Error(
        "找不到 vimeoPlayer"
      );

    }


    container.src =
      video.url ||
      `https://player.vimeo.com/video/${encodeURIComponent(
        video.id
      )}`;


    container.allow =
      "autoplay; fullscreen; picture-in-picture";


    container.setAttribute(
      "allowfullscreen",
      ""
    );


    const player =
      new Vimeo.Player(
        container
      );


    state.player =
      player;

    state.currentVideoId =
      video.id;

    state.currentVideoUrl =
      video.url ||
      null;

    state.playerType =
      "vimeo";

    state.playerReady =
      false;


    player.on(
      "loaded",
      async () => {

        if (
          state.player !==
          player
        ) {

          return;

        }


        state.playerReady =
          true;


        startLocalTimeUpdate();

      }
    );


    player.on(
      "timeupdate",
      updateTimeUI
    );

  }


  /*
   * =========================================================
   * DAILYMOTION
   * =========================================================
   */

  async function buildDailymotionPlayer(
    video
  ) {

    await destroyCurrentPlayer();

    await loadDailymotionSdk();

    hidePlayers();

    showPlayerElement(
      "dailymotionPlayer"
    );


    const container =
      $("dailymotionPlayer");


    if (!container) {

      throw new Error(
        "找不到 dailymotionPlayer"
      );

    }


    container.innerHTML =
      "";


    const playerId =
      "dm_" +
      Math.random()
        .toString(
          36
        )
        .slice(
          2
        );


    const target =
      document.createElement(
        "div"
      );


    target.id =
      playerId;


    target.style.width =
      "100%";

    target.style.height =
      "100%";


    container.appendChild(
      target
    );


    const player =
      await window.dailymotion
        .createPlayer(
          playerId,
          {

            video:
              video.id,

            mute:
              true,

            controls:
              true

          }
        );


    state.player =
      player;

    state.currentVideoId =
      video.id;

    state.currentVideoUrl =
      video.url ||
      null;

    state.playerType =
      "dailymotion";

    state.playerReady =
      true;


    startLocalTimeUpdate();

  }


  /*
   * =========================================================
   * BILIBILI
   * =========================================================
   */

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


    let src =
      "";


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


    iframe.setAttribute(
      "allowfullscreen",
      ""
    );


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


    startLocalTimeUpdate();

  }


  /*
   * =========================================================
   * TWITCH
   * =========================================================
   */

  async function buildTwitchPlayer(
    video
  ) {

    await destroyCurrentPlayer();

    await loadTwitchSdk();

    hidePlayers();

    showPlayerElement(
      "twitchPlayer"
    );


    const container =
      $("twitchPlayer");


    if (!container) {

      throw new Error(
        "找不到 twitchPlayer"
      );

    }


    container.innerHTML =
      "";


    const wrapperId =
      "tw_" +
      Math.random()
        .toString(
          36
        )
        .slice(
          2
        );


    const target =
      document.createElement(
        "div"
      );


    target.id =
      wrapperId;


    target.style.width =
      "100%";

    target.style.height =
      "100%";


    container.appendChild(
      target
    );


    const host =
      location.hostname ||
      "localhost";


    const options = {

      width:
        "100%",

      height:
        "100%",

      autoplay:
        true,

      muted:
        true,

      parent: [
        host
      ]

    };


    if (
      video.twitchType ===
      "video"
    ) {

      options.video =
        video.id;

    } else {

      options.channel =
        video.id;

    }


    const player =
      new Twitch.Player(
        wrapperId,
        options
      );


    state.player =
      player;

    state.currentVideoId =
      video.id;

    state.currentVideoUrl =
      video.url ||
      null;

    state.playerType =
      "twitch";

    state.playerReady =
      false;


    await new Promise(
      (resolve) => {

        const ready =
          () => {

            if (
              state.player !==
              player
            ) {

              resolve();

              return;

            }


            state.playerReady =
              true;


            resolve();

          };


        if (
          player.addEventListener
        ) {

          player.addEventListener(
            Twitch.Player.READY,
            ready
          );

        } else {

          setTimeout(
            ready,
            1500
          );

        }

      }
    );


    startLocalTimeUpdate();

  }


  /*
   * =========================================================
   * EXTERNAL
   * =========================================================
   */

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
   * PLATFORM ROUTER
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
        true
      );

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

  async function createRoom() {

    const roomName =
      $("roomNameInput")
        ?.value
        .trim() ||
      "一起看";


    let roomId =
      randomRoomCode();


    while (
      (
        await db
          .ref(
            `rooms/${roomId}`
          )
          .once(
            "value"
          )
      ).exists()
    ) {

      roomId =
        randomRoomCode();

    }


    const room = {

      owner:
        state.uid,

      name:
        roomName,

      sourceType:
        "youtube",

      video:
        null,

      /*
       * 保留 room.state，
       * 但是本版不再使用它做播放同步。
       */

      state: {

        action:
          "pause",

        position:
          0,

        playing:
          false,

        updatedAt:
          firebase.database
            .ServerValue
            .TIMESTAMP,

        updatedBy:
          state.uid

      }

    };


    await db
      .ref(
        `rooms/${roomId}`
      )
      .set(
        room
      );


    state.roomId =
      roomId;

    state.room =
      room;

    state.isOwner =
      true;


    history.replaceState(
      {},
      "",
      `?room=${encodeURIComponent(
        roomId
      )}`
    );


    await enterRoom();

  }


  /*
   * =========================================================
   * JOIN ROOM
   * =========================================================
   */

  async function joinRoom(
    roomId
  ) {

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


    const snapshot =
      await db
        .ref(
          `rooms/${roomId}`
        )
        .once(
          "value"
        );


    if (
      !snapshot.exists()
    ) {

      throw new Error(
        "找不到這個房間"
      );

    }


    state.roomId =
      roomId;

    state.room =
      snapshot.val();

    state.isOwner =
      state.room.owner ===
      state.uid;


    history.replaceState(
      {},
      "",
      `?room=${encodeURIComponent(
        roomId
      )}`
    );


    await enterRoom();

  }


  /*
   * =========================================================
   * ROOM VIDEO
   * =========================================================
   */

  async function handleRoomVideo(
    video
  ) {

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


      if (
        $("syncStatus")
      ) {

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
        state.playerReady &&
        state.player &&
        state.playerType ===
          "youtube"
      ) {

        forceYoutubeVisible();

        return;

      }


      await buildYoutubePlayer(
        videoId,
        true
      );


      return;

    }


    await buildPlatformPlayer(
      normalized
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


    if (!element) {
      return;
    }


    element.textContent =
      state.isOwner
        ? "👑 房主"
        : "👥 成員";

  }


  /*
   * =========================================================
   * ONLINE
   * =========================================================
   */

  async function markMemberOnline() {

    if (
      !state.membersRef ||
      !state.uid
    ) {

      return;

    }


    const memberRef =
      state.membersRef.child(
        state.uid
      );


    try {

      await memberRef.set({

        name:
          state.memberName,

        joinedAt:
          firebase.database
            .ServerValue
            .TIMESTAMP,

        online:
          true,

        lastSeen:
          firebase.database
            .ServerValue
            .TIMESTAMP

      });


      memberRef
        .onDisconnect()
        .update({

          online:
            false,

          lastSeen:
            firebase.database
              .ServerValue
              .TIMESTAMP

        });

    } catch (error) {

      /*
       * 成員狀態權限若暫時有問題，
       * 不讓進房流程整個爆掉。
       */

      console.warn(
        "成員狀態寫入失敗:",
        error
      );

    }

  }


  async function heartbeatMember() {

    if (
      !state.membersRef ||
      !state.uid
    ) {

      return;

    }


    try {

      await state.membersRef
        .child(
          state.uid
        )
        .update({

          online:
            true,

          lastSeen:
            firebase.database
              .ServerValue
              .TIMESTAMP

        });

    } catch (_) {}

  }


  /*
   * =========================================================
   * ENTER ROOM
   * =========================================================
   */

  async function enterRoom() {

    showView(
      "room"
    );


    if (
      $("roomTitle")
    ) {

      $("roomTitle")
        .textContent =
        state.room?.name ||
        "一起看";

    }


    if (
      $("roomCodeLabel")
    ) {

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


    state.chatRef =
      db.ref(
        `rooms/${state.roomId}/chat`
      );


    state.queueRef =
      db.ref(
        `rooms/${state.roomId}/queue`
      );


    await markMemberOnline();


    clearInterval(
      state.memberHeartbeatTimer
    );


    state.memberHeartbeatTimer =
      setInterval(
        heartbeatMember,
        15000
      );


    /*
     * 不再建立 rooms/.../state listener。
     * 這就是移除播放同步後的核心。
     */


    if (
      !state.videoListenerAttached
    ) {

      state.roomRef
        .child(
          "video"
        )
        .on(
          "value",
          async (
            snapshot
          ) => {

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
        (
          snapshot
        ) => {

          renderMembers(
            snapshot.val() ||
            {}
          );

        }
      );


      state.membersListenerAttached =
        true;

    }


    if (
      !state.chatListenerAttached
    ) {

      state.chatRef
        .limitToLast(
          100
        )
        .on(
          "value",
          (
            snapshot
          ) => {

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
        (
          snapshot
        ) => {

          state.queue =
            snapshot.val() ||
            {};


          if (
            state.room
          ) {

            state.room.queue =
              state.queue;

          }


          renderQueue();

        }
      );


      state.queueListenerAttached =
        true;

    }


    const initialVideo =
      state.room?.video ||
      null;


    if (initialVideo) {

      await handleRoomVideo(
        initialVideo
      );

    } else {

      hidePlayers();

      showPlayerElement(
        "emptyPlayer"
      );


      if (
        $("syncStatus")
      ) {

        $("syncStatus")
          .textContent =
          "等待有人選擇影片";

      }

    }


    renderQueue();

  }


  /*
   * =========================================================
   * MEMBERS
   * =========================================================
   */

  function renderMembers(
    members
  ) {

    const entries =
      Object.entries(
        members ||
        {}
      );


    entries.sort(
      (
        a,
        b
      ) => {

        return (
          Number(
            a[1]?.joinedAt ||
            0
          ) -
          Number(
            b[1]?.joinedAt ||
            0
          )
        );

      }
    );


    if (
      $("memberCount")
    ) {

      $("memberCount")
        .textContent =
        String(
          entries.length
        );

    }


    if (
      !$("memberList")
    ) {

      return;

    }


    if (
      !entries.length
    ) {

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
              "看片玩家";


            const owner =
              uid ===
              state.room?.owner;


            const online =
              member?.online !==
              false;


            return `
              <div
                class="member"
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

              </div>
            `;

          }
        )
        .join("");

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
        .slice(
          0,
          300
        );


    if (
      !text ||
      !state.chatRef ||
      !state.uid
    ) {

      return;

    }


    await state.chatRef.push({

      uid:
        state.uid,

      name:
        state.memberName,

      text,

      createdAt:
        firebase.database
          .ServerValue
          .TIMESTAMP

    });

  }


  function renderChat(
    messages
  ) {

    const list =
      Object.values(
        messages ||
        {}
      ).sort(
        (
          a,
          b
        ) => {

          return (
            Number(
              a.createdAt ||
              0
            ) -
            Number(
              b.createdAt ||
              0
            )
          );

        }
      );


    if (
      !$("chatMessages")
    ) {

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
          (
            message
          ) => {

            return `
              <div
                class="message"
              >

                <b>
                  ${escapeHtml(
                    message?.name ||
                    "玩家"
                  )}
                </b>

                <p>
                  ${escapeHtml(
                    message?.text ||
                    ""
                  )}
                </p>

              </div>
            `;

          }
        )
        .join("");


    const box =
      $("chatMessages");


    box.scrollTop =
      box.scrollHeight;

  }


  /*
   * =========================================================
   * CHANGE VIDEO
   * =========================================================
   */

  async function changeVideo(
    video
  ) {

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


    const platform =
      video.platform ||
      "youtube";


    const roomVideo = {

      id:
        video.id ||
        null,

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
        String(
          video.url
        );

    }


    if (video.twitchType) {

      roomVideo.twitchType =
        video.twitchType;

    }


    /*
     * 只更新影片。
     *
     * 不再更新 rooms/.../state。
     */

    await state.roomRef.update({

      sourceType:
        platform,

      video:
        roomVideo

    });


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


    setTimeout(
      () => {

        configureSearchScroll();

        $("modalVideoSearchInput")
          ?.focus();

      },
      50
    );

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


  function updateModalPlatformUI() {

    const platform =
      $("sourceTypeModal")
        ?.value ||
      "youtube";


    const searchArea =
      $("modalVideoSearchArea");


    const externalArea =
      $("modalExternalSourceArea");


    const searchable =
      PLATFORMS[
        platform
      ]?.searchable ===
      true;


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

  function detachRoomListeners() {

    try {

      /*
       * 重要：
       * 這版沒有 stateRef。
       */

      state.membersRef?.off();

      state.chatRef?.off();

      state.queueRef?.off();

      state.roomRef
        ?.child(
          "video"
        )
        .off();

    } catch (_) {}


    state.videoListenerAttached =
      false;

    state.membersListenerAttached =
      false;

    state.chatListenerAttached =
      false;

    state.queueListenerAttached =
      false;

    state.queue =
      {};

  }


  /*
   * =========================================================
   * EVENTS
   * =========================================================
   */

  function setupEvents() {

    /*
     * CREATE
     */

    $("createRoomBtn")
      ?.addEventListener(
        "click",
        async () => {

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

          try {

            await joinRoom(
              $("joinCodeInput")
                ?.value
            );

          } catch (error) {

            console.error(
              error
            );


            toast(
              error.message ||
              "加入房間失敗"
            );

          }

        }
      );


    $("joinCodeInput")
      ?.addEventListener(
        "input",
        (
          event
        ) => {

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


    /*
     * ACCOUNT
     */

    $("accountBtn")
      ?.addEventListener(
        "click",
        openNameModal
      );


    /*
     * LOGOUT
     */

    $("logoutBtn")
      ?.addEventListener(
        "click",
        async () => {

          const user =
            auth?.currentUser;


          if (
            !user ||
            user.isAnonymous
          ) {

            return;

          }


          const confirmed =
            window.confirm(
              "確定要登出 Google 帳號嗎？"
            );


          if (!confirmed) {

            return;

          }


          await logout();

        }
      );


    /*
     * NAME
     */

    $("cancelNameBtn")
      ?.addEventListener(
        "click",
        closeNameModal
      );


    $("saveNameBtn")
      ?.addEventListener(
        "click",
        async () => {

          await saveName();

        }
      );


    $("nameInput")
      ?.addEventListener(
        "keydown",
        (
          event
        ) => {

          if (
            event.key ===
            "Enter"
          ) {

            event.preventDefault();

            $("saveNameBtn")
              ?.click();

          }


          if (
            event.key ===
            "Escape"
          ) {

            event.preventDefault();

            closeNameModal();

          }

        }
      );


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

          } catch (_) {}


          clearInterval(
            state.syncTimer
          );


          clearInterval(
            state.memberHeartbeatTimer
          );


          detachRoomListeners();


          ++state.youtubeBuildToken;


          state.youtubeRequestedId =
            null;


          state.youtubeLoading =
            false;


          await destroyCurrentPlayer();


          state.roomId =
            null;

          state.room =
            null;

          state.isOwner =
            false;


          history.replaceState(
            {},
            "",
            location.pathname
          );


          showView(
            "home"
          );

        }
      );


    /*
     * PLAY / PAUSE
     */

    $("playPauseBtn")
      ?.addEventListener(
        "click",
        async () => {

          if (
            !state.playerReady ||
            !state.player
          ) {

            toast(
              "請先選擇影片"
            );

            return;

          }


          if (
            state.playerType ===
              "bilibili" ||
            state.playerType ===
              "external"
          ) {

            toast(
              "此平台目前無法由本站控制播放"
            );

            return;

          }


          if (
            await asyncIsPlaying()
          ) {

            await pausePlayer();

          } else {

            await playPlayer();

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
            !state.player
          ) {

            return;

          }


          const target =
            Math.max(
              0,
              (
                await asyncCurrentPosition()
              ) -
              10
            );


          await applyPlayerPosition(
            target
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
            !state.player
          ) {

            return;

          }


          const total =
            await asyncDuration();


          const target =
            Math.min(
              total ||
                Infinity,

              (
                await asyncCurrentPosition()
              ) +
              10
            );


          await applyPlayerPosition(
            target
          );

        }
      );


    /*
     * 原本的 sync 按鈕：
     * 直接隱藏，不再做 Firebase 同步。
     */

    const syncButton =
      $("syncNowBtn");


    if (syncButton) {

      syncButton.classList.add(
        "hidden"
      );

    }


    /*
     * VOLUME
     */

    $("volumeInput")
      ?.addEventListener(
        "input",
        (
          event
        ) => {

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
                value /
                100
              );

            }


            if (
              state.playerType ===
              "twitch"
            ) {

              state.player?.setVolume(
                value /
                100
              );

            }


            if (
              state.playerType ===
              "dailymotion"
            ) {

              state.player?.setVolume?.(
                value /
                100
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
                currentPosition()
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
        async (
          event
        ) => {

          event.preventDefault();


          const input =
            $("chatInput");


          const text =
            input?.value.trim();


          if (!text) {
            return;
          }


          input.value =
            "";


          try {

            await sendChat(
              text
            );

          } catch (error) {

            console.error(
              error
            );


            toast(
              "訊息送出失敗"
            );

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


    /*
     * ESC
     */

    document.addEventListener(
      "keydown",
      (
        event
      ) => {

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


        const nameModal =
          $("nameModal");


        if (
          nameModal &&
          !nameModal.classList.contains(
            "hidden"
          )
        ) {

          closeNameModal();

        }

      }
    );


    /*
     * 點背景關閉搜尋。
     */

    $("sourceModal")
      ?.addEventListener(
        "click",
        (
          event
        ) => {

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


            if (resultsContainer) {

              resultsContainer.scrollTop =
                0;

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
        (
          event
        ) => {

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
     * Resize
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
     * Visual viewport
     * 手機鍵盤開關時重新計算。
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


  /*
   * =========================================================
   * START
   * =========================================================
   */

  async function start() {

    try {

      state.memberName =
        getMemberName();


      await initializeFirebase();


      await handleGoogleRedirectResult();


      setupEvents();


      const roomId =
        getRoomIdFromUrl();


      if (roomId) {

        try {

          await joinRoom(
            roomId
          );

        } catch (error) {

          console.error(
            error
          );


          history.replaceState(
            {},
            "",
            location.pathname
          );


          showView(
            "home"
          );


          toast(
            error.message ||
            "無法進入房間"
          );

        }

      } else {

        showView(
          "home"
        );

      }

    } catch (error) {

      console.error(
        error
      );


      if (
        $("authStatus")
      ) {

        $("authStatus")
          .textContent =
          "連線失敗";

      }


      toast(
        error.message ||
        "網站初始化失敗"
      );

    }

  }


  /*
   * =========================================================
   * YOUTUBE API CALLBACK
   * =========================================================
   */

  window.onYouTubeIframeAPIReady =
    () => {

      state.youtubeReady =
        true;


      if (
        state.youtubeLoading
      ) {

        return;

      }


      if (
        state.playerReady &&
        state.player &&
        state.playerType ===
          "youtube"
      ) {

        forceYoutubeVisible();

        return;

      }


      const video =
        state.room?.video;


      if (
        video &&
        (
          video.platform ===
            "youtube" ||
          !video.platform
        ) &&
        video.id
      ) {

        const id =
          getYoutubeId(
            video.id
          );


        if (id) {

          void buildYoutubePlayer(
            id,
            true
          );

        }

      }

    };


  /*
   * 頁面關閉
   */

  window.addEventListener(
    "beforeunload",
    () => {

      clearInterval(
        state.syncTimer
      );

      clearInterval(
        state.memberHeartbeatTimer
      );

      unlockPageScroll();

    }
  );


  /*
   * 開始。
   */

  start();

})();
```
