(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /*
   * =========================================
   * YouTube Data API
   * =========================================
   *
   * 這裡填你的 YouTube Data API v3 Key。
   *
   * 例如：
   * const YOUTUBE_API_KEY = "AIza...";
   *
   * 沒有 API Key 時：
   * - 房間功能仍可用
   * - 聊天仍可用
   * - 已選影片的播放同步仍可用
   * - 但首頁的「搜尋影片」不能使用
   */
  const YOUTUBE_API_KEY = "AIzaSyA77rYYAE8G6BVrY91aQztCA-8L5WyLzGY";


  /*
   * =========================================
   * 平台資訊
   * =========================================
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
   * =========================================
   * 房間狀態
   * =========================================
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

    vimeoPlayer: null,

    dailymotionFrame: null,

    applyingRemote: false,

    lastRemoteKey: "",

    lastWriteAt: 0,

    searchResults: [],

    selectedVideo: null,

    modalSelectedVideo: null,

    searchBusy: false,

    syncTimer: null,

    seekTimer: null

  };


  let db = null;

  let auth = null;


  /*
   * =========================================
   * 基本工具
   * =========================================
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

        return map[
          character
        ];

      }
    );

  }


  function formatTime(seconds) {

    seconds =
      Number(seconds);

    if (
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      return "00:00";
    }

    seconds =
      Math.floor(seconds);

    const hours =
      Math.floor(
        seconds / 3600
      );

    const minutes =
      Math.floor(
        (seconds % 3600) / 60
      );

    const secs =
      seconds % 60;

    if (hours > 0) {

      return (
        String(hours)
          .padStart(2, "0") +
        ":" +
        String(minutes)
          .padStart(2, "0") +
        ":" +
        String(secs)
          .padStart(2, "0")
      );

    }

    return (
      String(minutes)
        .padStart(2, "0") +
      ":" +
      String(secs)
        .padStart(2, "0")
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
        .get("room")
        ?.trim()
        .toUpperCase() ||
      ""
    );

  }


  function roomLink(roomId) {

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
          Math.random() * 900 +
          100
        );

      localStorage.setItem(
        "wt_name",
        name
      );

    }

    return name;

  }


  /*
   * =========================================
   * Firebase
   * =========================================
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


    await auth
      .signInAnonymously();


    state.uid =
      auth.currentUser?.uid ||
      null;


    if (!state.uid) {

      throw new Error(
        "Firebase 匿名登入失敗"
      );

    }


    $("authStatus")
      .textContent =
      "已連線";

  }


  /*
   * =========================================
   * YouTube ID
   * =========================================
   */

  function getYoutubeId(value) {

    if (!value) {
      return null;
    }

    const text =
      String(value)
        .trim();

    /*
     * 允許直接傳 ID
     */
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
            .replace(
              /^\/+/,
              ""
            )
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
            url.searchParams.get(
              "v"
            ) || null
          );

        }


        if (
          url.pathname.startsWith(
            "/shorts/"
          )
        ) {

          return (
            url.pathname.split(
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
            url.pathname.split(
              "/"
            )[2] ||
            null
          );

        }

      }

    } catch (_) {}

    return null;

  }


  /*
   * =========================================
   * YouTube 搜尋
   * =========================================
   */

  async function searchYoutube(
    query,
    target = "home"
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


    if (!YOUTUBE_API_KEY) {

      throw new Error(
        "目前還沒有設定 YouTube Data API Key"
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

        const error =
          await response.json();

        message =
          error?.error?.message ||
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


    const results =
      items
        .map(
          (item) => {

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

          }
        )
        .filter(Boolean);


    state.searchResults =
      results;


    if (
      target === "modal"
    ) {

      renderSearchResults(
        results,
        "modal"
      );

    } else {

      renderSearchResults(
        results,
        "home"
      );

    }


    return results;

  }


  /*
   * =========================================
   * 搜尋結果 UI
   * =========================================
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
        .map(
          (video) => {

            return `
              <button
                type="button"
                class="video-result-card"
                data-video-id="${escapeHtml(video.id)}"
                data-target="${target}"
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

          }
        )
        .join("");


    container
      .querySelectorAll(
        ".video-result-card"
      )
      .forEach(
        (card) => {

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


              if (
                target === "modal"
              ) {

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

        }
      );

  }


  function renderSelectedVideo(
    video
  ) {

    const card =
      $("selectedVideoCard");

    const title =
      $("selectedVideoTitle");

    const meta =
      $("selectedVideoMeta");

    const thumbnail =
      $("selectedVideoThumbnail");


    if (card) {
      card.classList.remove(
        "hidden"
      );
    }


    if (title) {
      title.textContent =
        video.title;
    }


    if (meta) {
      meta.textContent =
        video.channel ||
        "YouTube";
    }


    if (thumbnail) {

      thumbnail.style.backgroundImage =
        `url("${video.thumbnail}")`;

    }


    toast(
      "已選擇影片"
    );

  }


  function clearSelectedVideo() {

    state.selectedVideo =
      null;


    $("selectedVideoCard")
      ?.classList.add(
        "hidden"
      );

  }


  function renderModalSelectedVideo(
    video
  ) {

    const results =
      $("modalVideoSearchResults");

    if (!results) {
      return;
    }


    results.innerHTML =
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
   * =========================================
   * 選中影片
   * =========================================
   */

  function videoForRoom() {

    if (
      state.room?.video
    ) {
      return state.room.video;
    }

    return null;

  }


  /*
   * =========================================
   * 建立房間
   * =========================================
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
      !PLATFORMS[
        platform
      ]
    ) {

      throw new Error(
        "不支援的平台"
      );

    }


    /*
     * YouTube 房間必須先選影片
     */

    if (
      platform ===
      "youtube"
    ) {

      if (
        !state.selectedVideo
      ) {

        throw new Error(
          "請先搜尋並選擇一部 YouTube 影片"
        );

      }

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


    let video =
      null;


    if (
      platform ===
      "youtube"
    ) {

      video = {

        id:
          state.selectedVideo.id,

        title:
          state.selectedVideo.title,

        thumbnail:
          state.selectedVideo.thumbnail,

        channel:
          state.selectedVideo.channel

      };

    }


    const room = {

      owner:
        state.uid,

      name:
        roomName,

      sourceType:
        platform,

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
   * =========================================
   * 加入房間
   * =========================================
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
   * =========================================
   * 進入房間
   * =========================================
   */

  async function enterRoom() {

    showView(
      "room"
    );


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
     * 播放同步
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
          snapshot.val() ||
          {}
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
            snapshot.val() ||
            {}
          );

        }
      );


    /*
     * 載入影片
     */

    buildRoomPlayer();


    /*
     * 顯示目前房間狀態
     */

    if (
      $("syncStatus")
    ) {

      $("syncStatus")
        .textContent =
        "房間已連線";

    }

  }


  /*
   * =========================================
   * 建立播放器
   * =========================================
   */

  function hideAllPlayers() {

    [
      "youtubePlayer",
      "vimeoPlayer",
      "dailymotionPlayer",
      "bilibiliPlayer",
      "directVideo",
      "emptyPlayer",
      "platformPlayerNotice"
    ]
      .forEach(
        (id) => {

          $(id)
            ?.classList
            .add(
              "hidden"
            );

        }
      );

  }


  function buildRoomPlayer() {

    hideAllPlayers();


    const platform =
      state.room?.sourceType ||
      "youtube";


    const info =
      PLATFORMS[
        platform
      ];


    if (
      platform ===
      "youtube"
    ) {

      const videoId =
        state.room?.video?.id;


      if (!videoId) {

        $("emptyPlayer")
          ?.classList
          .remove(
            "hidden"
          );

        return;

      }


      buildYoutubePlayer(
        videoId
      );

      return;

    }


    /*
     * Vimeo / Dailymotion / Bilibili
     * 先保留播放器容器。
     *
     * 真正的影片 ID 之後由各平台
     * 官方 API / Embed 再接入。
     */

    if (
      platform ===
        "vimeo" ||
      platform ===
        "dailymotion" ||
      platform ===
        "bilibili"
    ) {

      $("platformPlayerNotice")
        ?.classList
        .remove(
          "hidden"
        );


      $("roomPlatformIcon")
        .textContent =
        info.icon;


      $("roomPlatformName")
        .textContent =
        info.name;


      $("roomPlatformDescription")
        .textContent =
        "這個平台的播放器需要使用該平台提供的影片 ID／官方嵌入方式。";


      return;

    }


    /*
     * 其他平台
     */

    $("platformPlayerNotice")
      ?.classList
      .remove(
        "hidden"
      );


    $("roomPlatformIcon")
      .textContent =
      info?.icon ||
      "🌐";


    $("roomPlatformName")
      .textContent =
      info?.name ||
      platform;


    $("roomPlatformDescription")
      .textContent =
      "房間已選定這個平台。實際站內播放需要該平台提供官方播放器整合能力。";


  }


  /*
   * =========================================
   * YouTube 播放器
   * =========================================
   */

  function buildYoutubePlayer(
    videoId
  ) {

    const container =
      $("youtubePlayer");


    if (!container) {
      return;
    }


    hideAllPlayers();


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

      $("playerPlaceholder")
        ?.classList
        .remove(
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
          buildYoutubePlayer(
            videoId
          );
        },
        700
      );


      return;

    }


    if (
      state.player
    ) {

      try {
        state.player.destroy();
      } catch (_) {}

    }


    state.player =
      new YT.Player(
        "youtubePlayer",
        {

          videoId,

          playerVars: {

            autoplay:
              0,

            controls:
              1,

            playsinline:
              1,

            rel:
              0,

            modestbranding:
              1

          },


          events: {

            onReady:
              () => {

                state.playerReady =
                  true;


                updateTimeUI();


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
              () => {

                toast(
                  "這支 YouTube 影片無法嵌入播放"
                );

              }

          }

        }
      );

  }


  /*
   * =========================================
   * 播放器狀態
   * =========================================
   */

  function currentPosition() {

    if (
      state.playerReady &&
      state.player
    ) {

      try {

        return (
          state.player
            .getCurrentTime() ||
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
          state.player
            .getDuration() ||
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
        state.player
          .getPlayerState() ===
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
   * =========================================
   * 同步寫入
   * =========================================
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
      now - state.lastWriteAt <
        300
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
        Boolean(
          playing ??
          isPlaying()
        ),

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
        error
      );

      toast(
        "播放同步失敗"
      );

    }

  }


  /*
   * =========================================
   * 遠端同步
   * =========================================
   */

  async function applyRemotePlayback(
    data
  ) {

    if (!data) {
      return;
    }


    if (
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
      Number(
        data.position
      ) || 0;


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

          state.player
            .playVideo();

        }


        if (
          data.playing === false
        ) {

          state.player
            .pauseVideo();

        }

      }


      if (
        $("syncStatus")
      ) {

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
   * =========================================
   * 自動校正
   * =========================================
   */

  async function syncLatestPlayback() {
  if (!state.stateRef) {
    return;
  }

  try {
    const snapshot = await state.stateRef.once("value");
    const data = snapshot.val();

    if (!data) {
      return;
    }

    state.lastRemoteKey = "";

    await applyRemotePlayback(data);

  } catch (error) {
    console.error("同步初始播放狀態失敗:", error);
  }
}function startSyncHeartbeat() {

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
           * 房主定期送目前時間。
           */

          if (
            state.isOwner
          ) {

            await writePlayback(
              "sync"
            );

          }

        },
        3000
      );

  }


  /*
   * =========================================
   * 成員
   * =========================================
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
      entries.length ===
      0
    ) {

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


            const isOwner =
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
                      isOwner
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
   * =========================================
   * 聊天
   * =========================================
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
      !state.chatRef
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


    if (
      !$("chatMessages")
    ) {

      return;

    }


    if (
      !list.length
    ) {

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
   * =========================================
   * 更換影片
   * =========================================
   */

  async function changeYoutubeVideo(
    video
  ) {

    if (
      !state.isOwner
    ) {

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


    state.room
      .sourceType =
      "youtube";


    state.room.video =
      roomVideo;


    buildRoomPlayer();


    $("sourceModal")
      ?.classList
      .add(
        "hidden"
      );


    toast(
      "已切換影片"
    );

  }


  /*
   * =========================================
   * UI 事件
   * =========================================
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

          if (
            state.searchBusy
          ) {
            return;
          }


          const input =
            $("videoSearchInput");


          const query =
            input?.value.trim();


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

            console.error(
              error
            );

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
     * 清除選擇
     */

    $("clearSelectedVideoBtn")
      ?.addEventListener(
        "click",
        clearSelectedVideo
      );


    /*
     * 平台選擇
     */

    $("sourceTypeInput")
      ?.addEventListener(
        "change",
        (event) => {

          const platform =
            event.target.value;


          const info =
            PLATFORMS[
              platform
            ];


          if (!info) {
            return;
          }


          /*
           * 非 YouTube 時，
           * 現階段先隱藏搜尋結果區。
           */

          if (
            platform !==
            "youtube"
          ) {

            clearSelectedVideo();

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
                card.dataset
                  .platform;


              const select =
                $("sourceTypeInput");


              if (!select) {
                return;
              }


              select.value =
                platform;


              select.dispatchEvent(
                new Event(
                  "change"
                )
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

            await navigator
              .clipboard
              .writeText(
                roomLink(
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


          if (
            isPlaying()
          ) {

            state.player
              .pauseVideo();

          } else {

            state.player
              .playVideo();

          }

        }
      );


    /*
     * 後退
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


          state.player
            .seekTo(
              target,
              true
            );


          writePlayback(
            "seek"
          );

        }
      );


    /*
     * 快轉
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


          state.player
            .seekTo(
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

          if (
            !state.stateRef
          ) {

            return;

          }


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

            state.player
              .setVolume(
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

          const wrap =
            $("playerWrap");


          if (
            document.fullscreenElement
          ) {

            document.exitFullscreen?.();

          } else {

            wrap
              ?.requestFullscreen?.();

          }

        }
      );


    /*
     * 複製時間
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


            await navigator
              .clipboard
              .writeText(
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
     * 開啟外部平台
     */

    $("openPlatformBtn")
      ?.addEventListener(
        "click",
        () => {

          toast(
            "目前請先使用平台官方播放器"
          );

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
     * 開啟更換影片
     */

    $("changeSourceBtn")
      ?.addEventListener(
        "click",
        () => {

          if (
            !state.isOwner
          ) {

            return;

          }


          $("sourceModal")
            ?.classList
            .remove(
              "hidden"
            );


          $("sourceTypeModal")
            .value =
            "youtube";


          state.modalSelectedVideo =
            null;


          $("modalVideoSearchResults")
            .innerHTML =
            "";

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

            await searchYoutube(
              query,
              "modal"
            );

          } catch (error) {

            console.error(
              error
            );

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
            .add(
              "hidden"
            );

          setError(
            $("modalError"),
            ""
          );

        }
      );


    /*
     * Modal 確認
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

            console.error(
              error
            );

            setError(
              $("modalError"),
              error.message
            );

          }

        }
      );

  }


  /*
   * =========================================
   * 啟動
   * =========================================
   */

  async function start() {

    try {

      state.memberName =
        getMemberName();


      await initializeFirebase();


      setupEvents();


      const roomId =
        getRoomIdFromUrl();


      if (
        roomId
      ) {

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
   * =========================================
   * YouTube API Ready
   * =========================================
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


  start();

})();
