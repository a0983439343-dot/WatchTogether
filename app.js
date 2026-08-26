(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /*
   * =========================================================
   * YouTube Data API v3
   * =========================================================
   *
   * 把你目前已建立的 YouTube API Key 放在這裡。
   *
   * 例如：
   * const YOUTUBE_API_KEY = "AIza....";
   *
   * 注意：
   * 這個網站是 GitHub Pages，API Key 本身會出現在前端。
   * 請務必在 Google Cloud 限制：
   * 1. HTTP referrer：你的 GitHub Pages 網域
   * 2. API：YouTube Data API v3
   */

  const YOUTUBE_API_KEY = "AIzaSyA77rYYAE8G6BVrY91aQztCA-8L5WyLzGY";


  /*
   * =========================================================
   * 平台
   * =========================================================
   */

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
   * 狀態
   * =========================================================
   */

  const state = {

    uid: null,

    memberName: "看片玩家",

    roomId: null,

    room: null,

    isOwner: false,

    roomRef: null,

    stateRef: null,

    membersRef: null,

    chatRef: null,

    player: null,

    playerReady: false,

    currentVideoId: null,

    applyingRemote: false,

    lastRemoteKey: "",

    lastWriteAt: 0,

    syncTimer: null,

    seekTimer: null,

    searchResults: [],

    selectedVideo: null,

    modalSelectedVideo: null,

    searchBusy: false

  };


  let db = null;

  let auth = null;


  /*
   * =========================================================
   * UI
   * =========================================================
   */

  function toast(message) {

    const element = $("toast");

    if (!element) {
      return;
    }

    element.textContent = message;

    element.classList.add("show");

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
      element.classList.remove("show");
    }, 2400);

  }


  function setError(element, message) {

    if (!element) {
      return;
    }

    element.textContent =
      message || "";

  }


  function showView(view) {

    $("homeView")
      ?.classList
      .toggle(
        "hidden",
        view !== "home"
      );

    $("roomView")
      ?.classList
      .toggle(
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

    seconds = Number(seconds);

    if (
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      return "00:00";
    }

    seconds = Math.floor(seconds);

    const hours =
      Math.floor(seconds / 3600);

    const minutes =
      Math.floor(
        (seconds % 3600) / 60
      );

    const secs =
      seconds % 60;

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


  function randomRoomCode() {

    const chars =
      "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let result = "";

    for (let i = 0; i < 6; i++) {

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


  function getMemberName() {

    let name =
      localStorage.getItem(
        "wt_name"
      );

    if (!name) {

      name =
        "玩家" +
        Math.floor(
          Math.random() * 900 + 100
        );

      localStorage.setItem(
        "wt_name",
        name
      );

    }

    return name;

  }


  /*
   * =========================================================
   * Firebase
   * =========================================================
   */

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

    auth = firebase.auth();

    db = firebase.database();

    await auth.signInAnonymously();

    state.uid =
      auth.currentUser?.uid ||
      null;

    if (!state.uid) {

      throw new Error(
        "Firebase 匿名登入失敗"
      );

    }

    $("authStatus").textContent =
      "已連線";

  }


  /*
   * =========================================================
   * YouTube ID
   * =========================================================
   */

  function getYoutubeId(value) {

    if (!value) {
      return null;
    }

    const text =
      String(value).trim();

    if (
      /^[A-Za-z0-9_-]{11}$/.test(text)
    ) {
      return text;
    }

    try {

      const url = new URL(text);

      if (
        url.hostname.includes("youtu.be")
      ) {

        return (
          url.pathname
            .replace(/^\/+/, "")
            .split("/")[0] ||
          null
        );

      }

      if (
        url.hostname.includes("youtube.com")
      ) {

        if (
          url.pathname === "/watch"
        ) {

          return (
            url.searchParams.get("v") ||
            null
          );

        }

        if (
          url.pathname.startsWith("/shorts/")
        ) {

          return (
            url.pathname.split("/")[2] ||
            null
          );

        }

        if (
          url.pathname.startsWith("/embed/")
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


  /*
   * =========================================================
   * YouTube 搜尋
   * =========================================================
   */

  async function searchYoutube(
    query,
    target = "home"
  ) {

    query =
      String(query || "").trim();

    if (!query) {

      throw new Error(
        "請輸入影片名稱"
      );

    }

    if (
      !YOUTUBE_API_KEY ||
      YOUTUBE_API_KEY.startsWith("請填入")
    ) {

      throw new Error(
        "尚未設定 YouTube Data API Key"
      );

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
      "12"
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

    url.searchParams.set(
      "videoEmbeddable",
      "true"
    );

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

      throw new Error(message);

    }

    const data =
      await response.json();

    const items =
      Array.isArray(data.items)
        ? data.items
        : [];

    const results =
      items
        .map((item) => {

          const id =
            item?.id?.videoId;

          const snippet =
            item?.snippet || {};

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

            thumbnail:
              snippet.thumbnails?.high?.url ||
              snippet.thumbnails?.medium?.url ||
              snippet.thumbnails?.default?.url ||
              ""

          };

        })
        .filter(Boolean);

    state.searchResults =
      results;

    renderSearchResults(
      results,
      target
    );

    return results;

  }


  /*
   * =========================================================
   * 搜尋結果
   * =========================================================
   */

  function renderSearchResults(
    results,
    target
  ) {

    const container =
      target === "modal"
        ? $("modalVideoSearchResults")
        : $("videoSearchResults");

    if (!container) {
      return;
    }

    if (!results.length) {

      container.innerHTML =
        `
          <div
            class="muted"
            style="
              padding:14px 4px;
              text-align:center;
            "
          >
            找不到符合的影片。
          </div>
        `;

      return;

    }

    container.innerHTML =
      results
        .map((video) => {

          return `
            <button
              type="button"
              class="video-result-card"
              data-video-id="${escapeHtml(video.id)}"
            >

              <img
                src="${escapeHtml(video.thumbnail)}"
                alt=""
                loading="lazy"
              >

              <span class="video-result-info">

                <strong>
                  ${escapeHtml(video.title)}
                </strong>

                <small>
                  ${escapeHtml(video.channel)}
                </small>

              </span>

            </button>
          `;

        })
        .join("");

    container
      .querySelectorAll(
        ".video-result-card"
      )
      .forEach((card) => {

        card.addEventListener(
          "click",
          () => {

            const id =
              card.dataset.videoId;

            const video =
              results.find(
                (item) =>
                  item.id === id
              );

            if (!video) {
              return;
            }

            if (target === "modal") {

              state.modalSelectedVideo =
                video;

              renderModalSelectedVideo(
                video
              );

            } else {

              state.selectedVideo =
                video;

              renderSelectedVideo(
                video
              );

            }

          }
        );

      });

  }


  function renderSelectedVideo(video) {

    $("selectedVideoCard")
      ?.classList
      .remove("hidden");

    if ($("selectedVideoTitle")) {

      $("selectedVideoTitle")
        .textContent =
        video.title;

    }

    if ($("selectedVideoMeta")) {

      $("selectedVideoMeta")
        .textContent =
        video.channel ||
        "YouTube";

    }

    if ($("selectedVideoThumbnail")) {

      $("selectedVideoThumbnail")
        .style.backgroundImage =
        `url("${video.thumbnail}")`;

    }

    toast("已選擇影片");

  }


  function clearSelectedVideo() {

    state.selectedVideo =
      null;

    $("selectedVideoCard")
      ?.classList
      .add("hidden");

  }


  function renderModalSelectedVideo(video) {

    const container =
      $("modalVideoSearchResults");

    if (!container) {
      return;
    }

    container.innerHTML =
      `
        <button
          type="button"
          class="video-result-card selected"
        >

          <img
            src="${escapeHtml(video.thumbnail)}"
            alt=""
          >

          <span class="video-result-info">

            <strong>
              ${escapeHtml(video.title)}
            </strong>

            <small>
              ${escapeHtml(video.channel)}
            </small>

          </span>

        </button>
      `;

  }


  /*
   * =========================================================
   * 播放器狀態
   * =========================================================
   */

  function currentPosition() {

    if (
      state.playerReady &&
      state.player
    ) {

      try {

        return (
          state.player.getCurrentTime() ||
          0
        );

      } catch (_) {}

    }

    return 0;

  }


  function duration() {

    if (
      state.playerReady &&
      state.player
    ) {

      try {

        return (
          state.player.getDuration() ||
          0
        );

      } catch (_) {}

    }

    return 0;

  }


  function isPlaying() {

    if (
      !state.playerReady ||
      !state.player ||
      !window.YT
    ) {

      return false;

    }

    try {

      return (
        state.player.getPlayerState() ===
        YT.PlayerState.PLAYING
      );

    } catch (_) {

      return false;

    }

  }


  function updateTimeUI() {

    const readout =
      $("timeReadout");

    if (!readout) {
      return;
    }

    readout.textContent =
      `${formatTime(
        currentPosition()
      )} / ${formatTime(
        duration()
      )}`;

  }


  /*
   * =========================================================
   * 播放同步：寫入 Firebase
   * =========================================================
   */

  async function writePlayback(
    action,
    playing
  ) {

    if (
      !state.stateRef ||
      !state.uid
    ) {
      return;
    }

    if (
      state.applyingRemote
    ) {
      return;
    }

    const now =
      Date.now();

    if (
      action === "sync" &&
      now - state.lastWriteAt < 300
    ) {
      return;
    }

    state.lastWriteAt =
      now;

    const payload = {

      action,

      position:
        currentPosition(),

      playing:
        typeof playing === "boolean"
          ? playing
          : isPlaying(),

      updatedAt:
        firebase.database
          .ServerValue
          .TIMESTAMP,

      updatedBy:
        state.uid

    };

    try {

      await state.stateRef.set(
        payload
      );

    } catch (error) {

      console.error(
        "播放同步失敗：",
        error
      );

      toast(
        "播放同步失敗，請檢查 Firebase 規則"
      );

    }

  }


  /*
   * =========================================================
   * 這就是先前漏掉的函式
   * =========================================================
   *
   * YouTube onReady 時：
   * 1. 讀取 Firebase 裡目前播放狀態
   * 2. 把新加入的人跳到相同秒數
   * 3. 恢復相同播放 / 暫停狀態
   */

  async function syncLatestPlayback() {

    if (!state.stateRef) {
      return;
    }

    try {

      const snapshot =
        await state.stateRef.once(
          "value"
        );

      const data =
        snapshot.val();

      if (!data) {

        /*
         * 房間還沒有播放狀態。
         * 房主第一次建立狀態。
         */

        if (state.isOwner) {

          await writePlayback(
            "sync",
            false
          );

        }

        return;
      }

      /*
       * 暫時清掉去重 Key，
       * 確保剛加入房間的人一定會套用一次。
       */

      state.lastRemoteKey =
        "";

      await applyRemotePlayback(
        data,
        true
      );

    } catch (error) {

      console.error(
        "讀取初始播放狀態失敗：",
        error
      );

      toast(
        "無法取得目前播放進度"
      );

    }

  }


  /*
   * =========================================================
   * 套用另一個人的播放狀態
   * =========================================================
   */

  async function applyRemotePlayback(
    data,
    force = false
  ) {

    if (!data) {
      return;
    }

    if (
      !force &&
      data.updatedBy ===
      state.uid
    ) {
      return;
    }

    const key =
      [
        data.updatedAt,
        data.updatedBy,
        data.action,
        data.position,
        data.playing
      ].join("|");

    if (
      key ===
      state.lastRemoteKey
    ) {
      return;
    }

    state.lastRemoteKey =
      key;

    const remotePosition =
      Math.max(
        0,
        Number(data.position) || 0
      );

    state.applyingRemote =
      true;

    try {

      if (
        state.playerReady &&
        state.player
      ) {

        const localPosition =
          currentPosition();

        const difference =
          Math.abs(
            localPosition -
            remotePosition
          );

        /*
         * 差超過 0.8 秒就校正
         */

        if (
          difference > 0.8 ||
          data.action === "seek" ||
          data.action === "sync"
        ) {

          state.player.seekTo(
            remotePosition,
            true
          );

        }

        if (
          data.playing === true
        ) {

          try {
            state.player.playVideo();
          } catch (_) {}

        }

        if (
          data.playing === false
        ) {

          try {
            state.player.pauseVideo();
          } catch (_) {}

        }

      }

      if ($("syncStatus")) {

        $("syncStatus")
          .textContent =
          `已同步 ${formatTime(
            remotePosition
          )}`;

      }

      updateTimeUI();

    } finally {

      setTimeout(
        () => {
          state.applyingRemote =
            false;
        },
        250
      );

    }

  }


  /*
   * =========================================================
   * 房主自動同步心跳
   * =========================================================
   */

  function startSyncHeartbeat() {

    clearInterval(
      state.syncTimer
    );

    state.syncTimer =
      setInterval(
        async () => {

          if (
            !state.stateRef ||
            !state.playerReady ||
            state.applyingRemote
          ) {
            return;
          }

          /*
           * 只有房主定期廣播目前位置。
           */

          if (
            state.isOwner
          ) {

            await writePlayback(
              "sync"
            );

          }

          updateTimeUI();

        },
        3000
      );

  }


  /*
   * =========================================================
   * YouTube 播放器
   * =========================================================
   */

  function buildYoutubePlayer(
    videoId
  ) {

    const container =
      $("youtubePlayer");

    if (!container) {
      return;
    }

    if (
      state.player &&
      state.currentVideoId === videoId
    ) {
      return;
    }

    /*
     * 隱藏其他播放器
     */

    [
      "vimeoPlayer",
      "dailymotionPlayer",
      "bilibiliPlayer",
      "directVideo",
      "emptyPlayer",
      "platformPlayerNotice"
    ]
      .forEach((id) => {

        $(id)
          ?.classList
          .add("hidden");

      });

    container.classList.remove(
      "hidden"
    );

    state.playerReady =
      false;

    if (
      !window.YT ||
      typeof YT.Player !==
      "function"
    ) {

      if ($("playerPlaceholder")) {

        $("playerPlaceholder")
          .textContent =
          "YouTube 播放器載入中…";

        $("playerPlaceholder")
          .classList
          .remove("hidden");

      }

      setTimeout(
        () => {
          buildYoutubePlayer(
            videoId
          );
        },
        700
      );

      return;

    }

    $("playerPlaceholder")
      ?.classList
      .add("hidden");

    if (state.player) {

      try {

        state.player.destroy();

      } catch (_) {}

    }


    state.currentVideoId =
      videoId;

    state.player =
      new YT.Player(
        "youtubePlayer",
        {

          videoId,

          /*
           * 很重要：
           * 明確指定目前 GitHub Pages Origin。
           */

          playerVars: {

            autoplay: 0,

            controls: 1,

            playsinline: 1,

            rel: 0,

            modestbranding: 1,

            enablejsapi: 1,

            origin:
              location.origin

          },

          events: {

            onReady: () => {

              state.playerReady =
                true;

              updateTimeUI();

              /*
               * 這裡現在一定存在。
               */

              syncLatestPlayback();

              startSyncHeartbeat();

            },


            onStateChange:
              (event) => {

                if (
                  state.applyingRemote
                ) {
                  return;
                }

                if (
                  event.data ===
                  YT.PlayerState.PLAYING
                ) {

                  writePlayback(
                    "play",
                    true
                  );

                }

                if (
                  event.data ===
                  YT.PlayerState.PAUSED
                ) {

                  writePlayback(
                    "pause",
                    false
                  );

                }

                if (
                  event.data ===
                  YT.PlayerState.ENDED
                ) {

                  writePlayback(
                    "pause",
                    false
                  );

                }

                updateTimeUI();

              },


            onError:
              (event) => {

                console.error(
                  "YouTube player error:",
                  event
                );

                toast(
                  "這支 YouTube 影片無法嵌入播放"
                );

              }

          }

        }
      );

  }


  /*
   * =========================================================
   * 建立房間
   * =========================================================
   */

  async function createRoom() {

    const roomName =
      $("roomNameInput")
        ?.value
        .trim() ||
      "一起看";


    const platform =
      $("sourceTypeInput")
        ?.value ||
      "youtube";


    if (
      platform !== "youtube"
    ) {

      throw new Error(
        "目前這一版先完成 YouTube 站內同步播放器"
      );

    }


    if (
      !state.selectedVideo
    ) {

      throw new Error(
        "請先搜尋並選擇一部 YouTube 影片"
      );

    }


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


    const video = {

      id:
        state.selectedVideo.id,

      title:
        state.selectedVideo.title,

      thumbnail:
        state.selectedVideo.thumbnail,

      channel:
        state.selectedVideo.channel

    };


    const room = {

      owner:
        state.uid,

      name:
        roomName,

      sourceType:
        "youtube",

      video,

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
      .set(room);


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
   * 加入房間
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
   * 進入房間
   * =========================================================
   */

  async function enterRoom() {

    showView("room");


    $("roomTitle").textContent =
      state.room?.name ||
      "一起看";


    $("roomCodeLabel").textContent =
      state.roomId;


    document
      .querySelectorAll(
        ".owner-only"
      )
      .forEach(
        (element) => {

          element.classList.toggle(
            "hidden",
            !state.isOwner
          );

        }
      );


    state.roomRef =
      db.ref(
        `rooms/${state.roomId}`
      );


    state.stateRef =
      db.ref(
        `rooms/${state.roomId}/state`
      );


    state.membersRef =
      db.ref(
        `members/${state.roomId}`
      );


    state.chatRef =
      db.ref(
        `rooms/${state.roomId}/chat`
      );


    /*
     * 加入成員
     */

    await state.membersRef
      .child(
        state.uid
      )
      .set({

        name:
          state.memberName,

        joinedAt:
          firebase.database
            .ServerValue
            .TIMESTAMP

      });


    state.membersRef
      .child(
        state.uid
      )
      .onDisconnect()
      .remove();


    /*
     * 播放狀態
     */

    state.stateRef.on(
      "value",
      (snapshot) => {

        applyRemotePlayback(
          snapshot.val()
        );

      }
    );


    /*
     * 成員
     */

    state.membersRef.on(
      "value",
      (snapshot) => {

        renderMembers(
          snapshot.val() || {}
        );

      }
    );


    /*
     * 聊天
     */

    state.chatRef
      .limitToLast(100)
      .on(
        "value",
        (snapshot) => {

          renderChat(
            snapshot.val() || {}
          );

        }
      );


    /*
     * 建立播放器
     */

    if (
      state.room.sourceType ===
      "youtube" &&
      state.room.video?.id
    ) {

      buildYoutubePlayer(
        state.room.video.id
      );

    } else {

      $("emptyPlayer")
        ?.classList
        .remove("hidden");

    }


    if ($("syncStatus")) {

      $("syncStatus")
        .textContent =
        "房間已連線";

    }

  }


  /*
   * =========================================================
   * 成員
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
        (
          a[1]?.joinedAt ||
          0
        ) -
        (
          b[1]?.joinedAt ||
          0
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
        .innerHTML =
        `
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
          ([uid, member]) => {

            const name =
              member?.name ||
              "看片玩家";


            const owner =
              uid ===
              state.room?.owner;


            return `
              <div class="member">

                <div class="avatar">
                  ${escapeHtml(
                    name.slice(0, 1)
                  )}
                </div>

                <div class="member-name">

                  <b>
                    ${escapeHtml(
                      name
                    )}
                  </b>

                  <span>
                    ${
                      owner
                        ? "房主"
                        : "成員"
                    }
                  </span>

                </div>

                <span class="online"></span>

              </div>
            `;

          }
        )
        .join("");

  }


  /*
   * =========================================================
   * 聊天
   * =========================================================
   */

  async function sendChat(
    text
  ) {

    text =
      String(text || "")
        .trim()
        .slice(0, 300);


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
        messages || {}
      ).sort(
        (a, b) =>
          (
            a.createdAt ||
            0
          ) -
          (
            b.createdAt ||
            0
          )
      );


    if (!$("chatMessages")) {
      return;
    }


    if (!list.length) {

      $("chatMessages")
        .innerHTML =
        `
          <div
            class="muted"
            style="padding:12px;"
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

            return `
              <div class="message">

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
   * 更換影片
   * =========================================================
   */

  async function changeYoutubeVideo(
    video
  ) {

    if (!state.isOwner) {

      toast(
        "只有房主可以更換影片"
      );

      return;

    }


    if (!video?.id) {

      throw new Error(
        "沒有選擇影片"
      );

    }


    const roomVideo = {

      id:
        video.id,

      title:
        video.title,

      thumbnail:
        video.thumbnail,

      channel:
        video.channel

    };


    await state.roomRef
      .child("sourceType")
      .set("youtube");


    await state.roomRef
      .child("video")
      .set(roomVideo);


    await state.stateRef
      .set({

        action:
          "seek",

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

      });


    state.room.sourceType =
      "youtube";

    state.room.video =
      roomVideo;


    buildYoutubePlayer(
      roomVideo.id
    );


    $("sourceModal")
      ?.classList
      .add("hidden");


    toast(
      "已切換影片"
    );

  }


  /*
   * =========================================================
   * 事件
   * =========================================================
   */

  function setupEvents() {

    /*
     * 建立房間
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

            console.error(error);

            setError(
              $("homeError"),
              error.message ||
                "建立房間失敗"
            );

          }

        }
      );


    /*
     * 加入房間
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

            console.error(error);

            toast(
              error.message ||
                "加入房間失敗"
            );

          }

        }
      );


    /*
     * 房間碼
     */

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
     * YouTube 搜尋
     */

    $("searchVideoBtn")
      ?.addEventListener(
        "click",
        async () => {

          if (state.searchBusy) {
            return;
          }


          const query =
            $("videoSearchInput")
              ?.value
              .trim();


          state.searchBusy =
            true;


          const button =
            $("searchVideoBtn");


          if (button) {

            button.disabled =
              true;

            button.textContent =
              "搜尋中…";

          }


          try {

            await searchYoutube(
              query,
              "home"
            );

          } catch (error) {

            console.error(error);

            setError(
              $("homeError"),
              error.message
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

          }

        }
      );


    $("videoSearchInput")
      ?.addEventListener(
        "keydown",
        (event) => {

          if (
            event.key ===
            "Enter"
          ) {

            event.preventDefault();

            $("searchVideoBtn")
              ?.click();

          }

        }
      );


    /*
     * 清除影片
     */

    $("clearSelectedVideoBtn")
      ?.addEventListener(
        "click",
        clearSelectedVideo
      );


    /*
     * 平台切換
     */

    $("sourceTypeInput")
      ?.addEventListener(
        "change",
        (event) => {

          const platform =
            event.target.value;

          if (
            platform !==
            "youtube"
          ) {

            clearSelectedVideo();

            toast(
              "目前先完成 YouTube 站內播放器"
            );

          }

        }
      );


    /*
     * 平台卡片
     */

    document
      .querySelectorAll(
        ".platform-card"
      )
      .forEach(
        (card) => {

          card.addEventListener(
            "click",
            () => {

              const platform =
                card.dataset.platform;


              const select =
                $("sourceTypeInput");


              if (!select) {
                return;
              }


              select.value =
                platform;


              select.dispatchEvent(
                new Event("change")
              );


              document
                .querySelector(
                  ".creator-panel"
                )
                ?.scrollIntoView({
                  behavior:
                    "smooth",
                  block:
                    "center"
                });

            }
          );

        }
      );


    /*
     * 複製房間
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
     * 離開
     */

    $("leaveRoomBtn")
      ?.addEventListener(
        "click",
        () => {

          location.href =
            location.pathname;

        }
      );


    /*
     * 播放 / 暫停
     */

    $("playPauseBtn")
      ?.addEventListener(
        "click",
        () => {

          if (
            !state.playerReady ||
            !state.player
          ) {

            toast(
              "目前沒有可控制的影片"
            );

            return;

          }


          if (isPlaying()) {

            state.player
              .pauseVideo();

          } else {

            state.player
              .playVideo();

          }

        }
      );


    /*
     * 倒退 10 秒
     */

    $("backBtn")
      ?.addEventListener(
        "click",
        () => {

          if (
            !state.playerReady ||
            !state.player
          ) {

            return;

          }


          const target =
            Math.max(
              0,
              currentPosition() -
              10
            );


          state.player.seekTo(
            target,
            true
          );


          writePlayback(
            "seek"
          );

        }
      );


    /*
     * 快轉 10 秒
     */

    $("forwardBtn")
      ?.addEventListener(
        "click",
        () => {

          if (
            !state.playerReady ||
            !state.player
          ) {

            return;

          }


          const target =
            Math.min(
              duration() ||
              Infinity,
              currentPosition() +
              10
            );


          state.player.seekTo(
            target,
            true
          );


          writePlayback(
            "seek"
          );

        }
      );


    /*
     * 立即同步
     */

    $("syncNowBtn")
      ?.addEventListener(
        "click",
        async () => {

          await writePlayback(
            "sync"
          );

          toast(
            "已重新同步"
          );

        }
      );


    /*
     * 音量
     */

    $("volumeInput")
      ?.addEventListener(
        "input",
        (event) => {

          const value =
            Number(
              event.target.value
            );


          if (
            state.playerReady &&
            state.player
          ) {

            state.player.setVolume(
              value
            );

          }

        }
      );


    /*
     * 全螢幕
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

          } else {

            playerWrap
              ?.requestFullscreen?.();

          }

        }
      );


    /*
     * 複製目前時間
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
     * 聊天
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


          input.value =
            "";


          try {

            await sendChat(
              text
            );

          } catch (error) {

            console.error(error);

            toast(
              "訊息送出失敗"
            );

          }

        }
      );


    /*
     * 更換影片
     */

    $("changeSourceBtn")
      ?.addEventListener(
        "click",
        () => {

          if (!state.isOwner) {
            return;
          }


          $("sourceModal")
            ?.classList
            .remove("hidden");


          state.modalSelectedVideo =
            null;


          if (
            $("modalVideoSearchResults")
          ) {

            $("modalVideoSearchResults")
              .innerHTML =
              "";

          }

        }
      );


    /*
     * Modal 搜尋
     */

    $("modalSearchVideoBtn")
      ?.addEventListener(
        "click",
        async () => {

          const query =
            $("modalVideoSearchInput")
              ?.value
              .trim();


          try {

            setError(
              $("modalError"),
              ""
            );


            await searchYoutube(
              query,
              "modal"
            );

          } catch (error) {

            console.error(error);

            setError(
              $("modalError"),
              error.message
            );

          }

        }
      );


    /*
     * Modal Enter
     */

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


    /*
     * Modal 取消
     */

    $("cancelModalBtn")
      ?.addEventListener(
        "click",
        () => {

          $("sourceModal")
            ?.classList
            .add("hidden");

          setError(
            $("modalError"),
            ""
          );

        }
      );


    /*
     * Modal 儲存
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


            if (
              !state.modalSelectedVideo
            ) {

              throw new Error(
                "請先搜尋並選擇一部影片"
              );

            }


            await changeYoutubeVideo(
              state.modalSelectedVideo
            );

          } catch (error) {

            console.error(error);

            setError(
              $("modalError"),
              error.message
            );

          }

        }
      );

  }


  /*
   * =========================================================
   * 啟動
   * =========================================================
   */

  async function start() {

    try {

      state.memberName =
        getMemberName();


      await initializeFirebase();


      setupEvents();


      const roomId =
        getRoomIdFromUrl();


      if (roomId) {

        try {

          await joinRoom(
            roomId
          );

        } catch (error) {

          console.error(error);

          history.replaceState(
            {},
            "",
            location.pathname
          );

          showView("home");

          toast(
            error.message ||
            "無法進入房間"
          );

        }

      } else {

        showView("home");

      }

    } catch (error) {

      console.error(error);


      if ($("authStatus")) {

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
   * YouTube API Ready
   * =========================================================
   */

  window.onYouTubeIframeAPIReady =
    () => {

      if (
        state.room &&
        state.room.sourceType ===
        "youtube" &&
        state.room.video?.id
      ) {

        buildYoutubePlayer(
          state.room.video.id
        );

      }

    };


  /*
   * =========================================================
   * 啟動網站
   * =========================================================
   */

  start();

})();
