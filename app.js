(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    uid: null,
    roomId: null,
    room: null,
    isOwner: false,
    memberName: "使用者",

    roomRef: null,
    stateRef: null,
    membersRef: null,
    chatRef: null,

    player: null,
    playerReady: false,

    applyingRemote: false,
    lastRemoteKey: "",

    lastWriteAt: 0,
    seekTimer: null,

    directVideo: $("directVideo"),

    firebaseReady: false
  };

  let db = null;
  let auth = null;


  /* =========================================
     平台資料
  ========================================== */

  const PLATFORMS = {
    youtube: {
      name: "YouTube",
      icon: "▶",
      url: "https://www.youtube.com/",
      type: "影片平台",
      description: "使用 YouTube 官方網站與播放器。"
    },

    netflix: {
      name: "Netflix",
      icon: "🔴",
      url: "https://www.netflix.com/",
      type: "串流平台",
      description: "使用你自己的 Netflix 帳號觀看。"
    },

    bilibili: {
      name: "Bilibili",
      icon: "📺",
      url: "https://www.bilibili.com/",
      type: "影片平台",
      description: "使用 Bilibili 官方網站觀看。"
    },

    crunchyroll: {
      name: "Crunchyroll",
      icon: "🟠",
      url: "https://www.crunchyroll.com/",
      type: "動漫串流",
      description: "使用自己的 Crunchyroll 帳號觀看動漫。"
    },

    disneyplus: {
      name: "Disney+",
      icon: "🔵",
      url: "https://www.disneyplus.com/",
      type: "串流平台",
      description: "使用自己的 Disney+ 帳號觀看。"
    },

    primevideo: {
      name: "Prime Video",
      icon: "🟦",
      url: "https://www.primevideo.com/",
      type: "串流平台",
      description: "使用自己的 Prime Video 帳號觀看。"
    },

    appletv: {
      name: "Apple TV+",
      icon: "🍎",
      url: "https://tv.apple.com/",
      type: "串流平台",
      description: "使用自己的 Apple TV+ 帳號觀看。"
    },

    max: {
      name: "Max",
      icon: "🟣",
      url: "https://www.max.com/",
      type: "串流平台",
      description: "使用自己的 Max 帳號觀看。"
    },

    hulu: {
      name: "Hulu",
      icon: "🟢",
      url: "https://www.hulu.com/",
      type: "串流平台",
      description: "使用自己的 Hulu 帳號觀看。"
    },

    paramount: {
      name: "Paramount+",
      icon: "🟦",
      url: "https://www.paramountplus.com/",
      type: "串流平台",
      description: "使用自己的 Paramount+ 帳號觀看。"
    },

    peacock: {
      name: "Peacock",
      icon: "🦚",
      url: "https://www.peacocktv.com/",
      type: "串流平台",
      description: "使用自己的 Peacock 帳號觀看。"
    },

    twitch: {
      name: "Twitch",
      icon: "🎮",
      url: "https://www.twitch.tv/",
      type: "直播平台",
      description: "使用 Twitch 官方網站觀看直播。"
    },

    vimeo: {
      name: "Vimeo",
      icon: "▶",
      url: "https://vimeo.com/",
      type: "影片平台",
      description: "使用 Vimeo 官方網站觀看。"
    },

    dailymotion: {
      name: "Dailymotion",
      icon: "▶",
      url: "https://www.dailymotion.com/",
      type: "影片平台",
      description: "使用 Dailymotion 官方網站觀看。"
    },

    tiktok: {
      name: "TikTok",
      icon: "🎵",
      url: "https://www.tiktok.com/",
      type: "短影片",
      description: "使用 TikTok 官方網站觀看。"
    },

    facebook: {
      name: "Facebook Video",
      icon: "🔵",
      url: "https://www.facebook.com/watch/",
      type: "影片平台",
      description: "使用 Facebook 官方網站觀看影片。"
    },

    x: {
      name: "X / Twitter",
      icon: "𝕏",
      url: "https://x.com/",
      type: "社群影片",
      description: "使用 X 官方網站觀看影片。"
    },

    rumble: {
      name: "Rumble",
      icon: "▶",
      url: "https://rumble.com/",
      type: "影片平台",
      description: "使用 Rumble 官方網站觀看。"
    },

    streamable: {
      name: "Streamable",
      icon: "▶",
      url: "https://streamable.com/",
      type: "影片平台",
      description: "使用 Streamable 官方網站觀看。"
    },

    internetarchive: {
      name: "Internet Archive",
      icon: "🗂",
      url: "https://archive.org/",
      type: "公開影片",
      description: "使用 Internet Archive 官方網站觀看公開內容。"
    },

    other: {
      name: "其他網站",
      icon: "🌐",
      url: "https://www.google.com/",
      type: "其他平台",
      description: "使用其他合法影片平台。"
    }
  };


  /* =========================================
     基本工具
  ========================================== */

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

    element.textContent = message || "";
  }


  function show(view) {
    const home = $("homeView");
    const room = $("roomView");

    if (home) {
      home.classList.toggle("hidden", view !== "home");
    }

    if (room) {
      room.classList.toggle("hidden", view !== "room");
    }
  }


  function escapeHtml(value) {
    return String(value ?? "").replace(
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
      Math.floor((seconds % 3600) / 60);

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
        .toUpperCase() || ""
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


  function isValidRoomCode(roomId) {
    return /^[A-Z0-9]{6}$/.test(
      roomId
    );
  }


  /* =========================================
     Firebase
  ========================================== */

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

    if (!firebase.apps.length) {
      firebase.initializeApp(
        window.FIREBASE_CONFIG
      );
    }

    auth =
      firebase.auth();

    db =
      firebase.database();

    await auth.signInAnonymously();

    state.uid =
      auth.currentUser?.uid ||
      null;

    if (!state.uid) {
      throw new Error(
        "Firebase 匿名登入失敗"
      );
    }

    state.firebaseReady = true;

    if ($("authStatus")) {
      $("authStatus").textContent =
        "已連線";
    }
  }


  /* =========================================
     平台 UI
  ========================================== */

  function updatePlatformPreview(
    platformId
  ) {
    const data =
      PLATFORMS[platformId] ||
      PLATFORMS.youtube;

    const icon =
      $("platformPreviewIcon");

    const name =
      $("platformPreviewName");

    const type =
      $("platformPreviewType");

    const description =
      $("platformDescription");

    if (icon) {
      icon.textContent =
        data.icon;
    }

    if (name) {
      name.textContent =
        data.name;
    }

    if (type) {
      type.textContent =
        data.type;
    }

    if (description) {
      description.textContent =
        data.description;
    }
  }


  function updateModalPlatform(
    platformId
  ) {
    const data =
      PLATFORMS[platformId] ||
      PLATFORMS.youtube;

    const description =
      $("modalPlatformDescription");

    if (description) {
      description.textContent =
        data.description;
    }
  }


  function renderRoomPlatform() {
    const platformId =
      state.room?.sourceType ||
      "youtube";

    const data =
      PLATFORMS[platformId] ||
      PLATFORMS.youtube;

    const icon =
      $("roomPlatformIcon");

    const name =
      $("roomPlatformName");

    const description =
      $("roomPlatformDescription");

    const syncText =
      $("platformSyncText");

    if (icon) {
      icon.textContent =
        data.icon;
    }

    if (name) {
      name.textContent =
        data.name;
    }

    if (description) {
      description.textContent =
        data.description;
    }

    if (syncText) {
      syncText.textContent =
        `${data.name} 房間已連線`;
    }
  }


  function openCurrentPlatform() {
    const platformId =
      state.room?.sourceType ||
      "youtube";

    const data =
      PLATFORMS[platformId] ||
      PLATFORMS.youtube;

    if (!data.url) {
      toast(
        "目前沒有可開啟的平台網址"
      );

      return;
    }

    window.open(
      data.url,
      "_blank",
      "noopener,noreferrer"
    );

    toast(
      `${data.name} 已開啟`
    );
  }


  /* =========================================
     YouTube
  ========================================== */

  function getYoutubeId(url) {
    if (!url) {
      return null;
    }

    try {
      const parsed =
        new URL(url);

      if (
        parsed.hostname.includes(
          "youtu.be"
        )
      ) {
        return (
          parsed.pathname
            .replace("/", "")
            .split("/")[0] ||
          null
        );
      }

      if (
        parsed.hostname.includes(
          "youtube.com"
        )
      ) {
        if (
          parsed.pathname ===
          "/watch"
        ) {
          return (
            parsed.searchParams.get(
              "v"
            ) || null
          );
        }

        if (
          parsed.pathname.startsWith(
            "/shorts/"
          )
        ) {
          return (
            parsed.pathname.split(
              "/"
            )[2] || null
          );
        }

        if (
          parsed.pathname.startsWith(
            "/embed/"
          )
        ) {
          return (
            parsed.pathname.split(
              "/"
            )[2] || null
          );
        }
      }
    } catch (_) {}

    return null;
  }


  function hasYoutubeVideo() {
    return (
      state.room?.sourceType ===
        "youtube" &&
      !!state.room?.sourceUrl &&
      !!getYoutubeId(
        state.room.sourceUrl
      )
    );
  }


  function buildYoutubePlayer() {
    if (
      !hasYoutubeVideo()
    ) {
      return;
    }

    const playerElement =
      $("youtubePlayer");

    if (!playerElement) {
      return;
    }

    const videoId =
      getYoutubeId(
        state.room.sourceUrl
      );

    if (!videoId) {
      return;
    }

    $("platformView")
      ?.classList.add(
        "hidden"
      );

    $("directVideo")
      ?.classList.add(
        "hidden"
      );

    playerElement.classList.remove(
      "hidden"
    );

    if (
      !window.YT ||
      typeof YT.Player !==
        "function"
    ) {
      $("playerPlaceholder").textContent =
        "YouTube 播放器載入中…";

      $("playerPlaceholder")
        .classList.remove(
          "hidden"
        );

      setTimeout(
        buildYoutubePlayer,
        600
      );

      return;
    }

    $("playerPlaceholder")
      ?.classList.add(
        "hidden"
      );

    if (state.player) {
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
            autoplay: 0,
            controls: 1,
            playsinline: 1,
            rel: 0,
            modestbranding: 1
          },

          events: {

            onReady: () => {
              state.playerReady =
                true;

              updateTimeUI();

              syncLatestPlayback();
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


                updateTimeUI();
              },


            onError: () => {
              toast(
                "YouTube 無法播放這支影片"
              );
            }

          }
        }
      );
  }


  function currentPlaybackPosition() {
    if (
      state.room?.sourceType ===
      "youtube"
    ) {
      if (
        state.playerReady &&
        state.player
      ) {
        try {
          return (
            state.player.getCurrentTime() ||
            0
          );
        } catch (_) {
          return 0;
        }
      }

      return 0;
    }

    if (
      state.directVideo
    ) {
      return (
        state.directVideo.currentTime ||
        0
      );
    }

    return 0;
  }


  function currentDuration() {
    if (
      state.room?.sourceType ===
      "youtube"
    ) {
      if (
        state.playerReady &&
        state.player
      ) {
        try {
          return (
            state.player.getDuration() ||
            0
          );
        } catch (_) {
          return 0;
        }
      }

      return 0;
    }

    return (
      Number(
        state.directVideo?.duration
      ) || 0
    );
  }


  function isCurrentlyPlaying() {
    if (
      state.room?.sourceType ===
      "youtube"
    ) {
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

    if (
      state.directVideo
    ) {
      return (
        !state.directVideo.paused
      );
    }

    return false;
  }


  function updateTimeUI() {
    const readout =
      $("timeReadout");

    if (!readout) {
      return;
    }

    readout.textContent =
      formatTime(
        currentPlaybackPosition()
      ) +
      " / " +
      formatTime(
        currentDuration()
      );
  }


  /* =========================================
     播放狀態同步
  ========================================== */

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

    state.lastWriteAt = now;

    const payload = {
      action,
      position:
        currentPlaybackPosition(),

      playing:
        typeof playing ===
        "boolean"
          ? playing
          : isCurrentlyPlaying(),

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
      console.error(error);

      toast(
        "同步失敗，請檢查 Firebase 規則"
      );
    }
  }


  async function syncLatestPlayback() {
    if (
      !state.stateRef
    ) {
      return;
    }

    const snapshot =
      await state.stateRef.once(
        "value"
      );

    const data =
      snapshot.val();

    if (!data) {
      await writePlayback(
        "sync"
      );

      return;
    }

    await applyRemotePlayback(
      data,
      true
    );
  }


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

    const position =
      Math.max(
        0,
        Number(data.position) ||
          0
      );

    state.applyingRemote =
      true;

    try {

      if (
        hasYoutubeVideo() &&
        state.playerReady &&
        state.player
      ) {

        const local =
          state.player.getCurrentTime?.() ||
          0;

        if (
          Math.abs(
            local - position
          ) > 0.8 ||
          data.action === "seek" ||
          data.action === "sync"
        ) {
          state.player.seekTo(
            position,
            true
          );
        }

        if (
          data.playing === true
        ) {
          state.player.playVideo();
        }

        if (
          data.playing === false
        ) {
          state.player.pauseVideo();
        }
      }


      if (
        state.room?.sourceType ===
        "direct" &&
        state.directVideo
      ) {

        const local =
          state.directVideo.currentTime ||
          0;

        if (
          Math.abs(
            local - position
          ) > 0.8 ||
          data.action === "seek" ||
          data.action === "sync"
        ) {
          state.directVideo.currentTime =
            position;
        }

        if (
          data.playing === true
        ) {
          await state.directVideo
            .play()
            .catch(
              () => {}
            );
        }

        if (
          data.playing === false
        ) {
          state.directVideo.pause();
        }
      }

      if ($("syncStatus")) {
        $("syncStatus").textContent =
          "已同步 " +
          formatTime(
            position
          );
      }

      updateTimeUI();

    } finally {

      setTimeout(() => {
        state.applyingRemote =
          false;
      }, 250);

    }
  }


  /* =========================================
     房間
  ========================================== */

  async function createRoom() {
    if (
      !state.firebaseReady
    ) {
      throw new Error(
        "Firebase 尚未連線"
      );
    }

    const name =
      $("roomNameInput")
        ?.value
        .trim() ||
      "一起看";


    const platform =
      $("sourceTypeInput")
        ?.value ||
      "youtube";


    if (
      !PLATFORMS[platform]
    ) {
      throw new Error(
        "找不到這個平台"
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
          .once("value")
      ).exists()
    ) {
      roomId =
        randomRoomCode();
    }


    const room = {
      owner:
        state.uid,

      name,

      sourceType:
        platform,

      sourceUrl:
        platform === "youtube"
          ? ""
          : "",

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


  async function joinRoom(
    roomId
  ) {
    roomId =
      String(roomId || "")
        .trim()
        .toUpperCase();


    if (
      !isValidRoomCode(
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
        .once("value");


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


  async function enterRoom() {
    if (
      !state.room ||
      !state.roomId
    ) {
      throw new Error(
        "房間資料不存在"
      );
    }


    show("room");


    $("roomTitle").textContent =
      state.room.name ||
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


    await state.membersRef
      .child(state.uid)
      .set({
        name:
          state.memberName,

        joinedAt:
          firebase.database
            .ServerValue
            .TIMESTAMP
      });


    state.membersRef
      .child(state.uid)
      .onDisconnect()
      .remove();


    state.stateRef.on(
      "value",
      (snapshot) => {
        applyRemotePlayback(
          snapshot.val()
        );
      }
    );


    state.membersRef.on(
      "value",
      (snapshot) => {
        renderMembers(
          snapshot.val() ||
          {}
        );
      }
    );


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


    renderRoomPlatform();


    if (
      hasYoutubeVideo()
    ) {
      buildYoutubePlayer();
    } else {

      $("youtubePlayer")
        ?.classList.add(
          "hidden"
        );

      $("directVideo")
        ?.classList.add(
          "hidden"
        );

      $("platformView")
        ?.classList.remove(
          "hidden"
        );

      $("playerPlaceholder")
        ?.classList.add(
          "hidden"
        );
    }


    if ($("syncStatus")) {
      $("syncStatus").textContent =
        "房間已連線";
    }
  }


  /* =========================================
     成員
  ========================================== */

  function renderMembers(
    members
  ) {
    const entries =
      Object.entries(
        members || {}
      );


    entries.sort(
      (a, b) =>
        (a[1]?.joinedAt || 0) -
        (b[1]?.joinedAt || 0)
    );


    if ($("memberCount")) {
      $("memberCount").textContent =
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
      entries.length === 0
    ) {
      $("memberList").innerHTML =
        '<div class="muted">目前沒有成員。</div>';

      return;
    }


    $("memberList").innerHTML =
      entries
        .map(
          ([uid, member]) => {

            const name =
              member?.name ||
              "使用者";

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


  /* =========================================
     聊天室
  ========================================== */

  async function sendMessage(
    text
  ) {
    if (
      !state.chatRef ||
      !state.uid
    ) {
      return;
    }


    text =
      String(text || "")
        .trim();


    if (!text) {
      return;
    }


    text =
      text.slice(0, 300);


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
          (a.createdAt || 0) -
          (b.createdAt || 0)
      );


    if (
      !$("chatMessages")
    ) {
      return;
    }


    if (
      list.length === 0
    ) {

      $("chatMessages").innerHTML =
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


    $("chatMessages").innerHTML =
      list
        .map(
          (message) => `
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
          `
        )
        .join("");


    const box =
      $("chatMessages");


    box.scrollTop =
      box.scrollHeight;
  }


  /* =========================================
     平台切換
  ========================================== */

  async function changePlatform(
    platformId
  ) {
    if (
      !state.isOwner
    ) {
      toast(
        "只有房主可以切換平台"
      );

      return;
    }


    if (
      !PLATFORMS[
        platformId
      ]
    ) {
      throw new Error(
        "不支援的平台"
      );
    }


    await db
      .ref(
        `rooms/${state.roomId}/sourceType`
      )
      .set(
        platformId
      );


    await db
      .ref(
        `rooms/${state.roomId}/sourceUrl`
      )
      .set("");


    await db
      .ref(
        `rooms/${state.roomId}/state`
      )
      .set({
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
      });


    state.room.sourceType =
      platformId;

    state.room.sourceUrl =
      "";


    renderRoomPlatform();


    if (
      hasYoutubeVideo()
    ) {
      buildYoutubePlayer();
    } else {

      $("youtubePlayer")
        ?.classList.add(
          "hidden"
        );

      $("directVideo")
        ?.classList.add(
          "hidden"
        );

      $("platformView")
        ?.classList.remove(
          "hidden"
        );
    }


    toast(
      `已切換到 ${
        PLATFORMS[
          platformId
        ].name
      }`
    );
  }


  /* =========================================
     播放控制
  ========================================== */

  function playPause() {
    if (
      hasYoutubeVideo() &&
      state.playerReady &&
      state.player
    ) {

      if (
        isCurrentlyPlaying()
      ) {
        state.player.pauseVideo();
      } else {
        state.player.playVideo();
      }

      return;
    }


    if (
      state.room?.sourceType ===
      "direct" &&
      state.directVideo
    ) {

      if (
        state.directVideo.paused
      ) {

        state.directVideo
          .play()
          .catch(
            () => {
              toast(
                "瀏覽器阻止自動播放"
              );
            }
          );

      } else {

        state.directVideo.pause();

      }

      return;
    }


    openCurrentPlatform();
  }


  function seekRelative(
    seconds
  ) {

    if (
      !hasYoutubeVideo() &&
      state.room?.sourceType !==
        "direct"
    ) {
      openCurrentPlatform();

      return;
    }


    const target =
      Math.max(
        0,
        currentPlaybackPosition() +
          seconds
      );


    if (
      hasYoutubeVideo() &&
      state.player
    ) {
      state.player.seekTo(
        target,
        true
      );
    }


    if (
      state.room?.sourceType ===
        "direct" &&
      state.directVideo
    ) {
      state.directVideo.currentTime =
        target;
    }


    writePlayback(
      "seek"
    );
  }


  /* =========================================
     事件
  ========================================== */

  function setupEvents() {

    /* 建立房間 */

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


    /* 加入房間 */

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


    /* 平台選擇 */

    $("sourceTypeInput")
      ?.addEventListener(
        "change",
        (event) => {

          updatePlatformPreview(
            event.target.value
          );
        }
      );


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

              if (
                select &&
                PLATFORMS[
                  platform
                ]
              ) {

                select.value =
                  platform;

                updatePlatformPreview(
                  platform
                );

                select.scrollIntoView({
                  behavior:
                    "smooth",
                  block:
                    "center"
                });
              }
            }
          );

        }
      );


    /* 房間複製 */

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


    /* 離開 */

    $("leaveRoomBtn")
      ?.addEventListener(
        "click",
        () => {

          location.href =
            location.pathname;
        }
      );


    /* 播放 */

    $("playPauseBtn")
      ?.addEventListener(
        "click",
        playPause
      );


    /* 倒退 */

    $("backBtn")
      ?.addEventListener(
        "click",
        () => {
          seekRelative(-10);
        }
      );


    /* 快轉 */

    $("forwardBtn")
      ?.addEventListener(
        "click",
        () => {
          seekRelative(10);
        }
      );


    /* 立即同步 */

    $("syncNowBtn")
      ?.addEventListener(
        "click",
        async () => {

          if (
            hasYoutubeVideo() ||
            state.room?.sourceType ===
              "direct"
          ) {

            await writePlayback(
              "sync"
            );

            toast(
              "已重新同步"
            );

          } else {

            openCurrentPlatform();

          }
        }
      );


    /* 音量 */

    $("volumeInput")
      ?.addEventListener(
        "input",
        (event) => {

          const value =
            Number(
              event.target.value
            );


          if (
            hasYoutubeVideo() &&
            state.playerReady &&
            state.player
          ) {

            state.player.setVolume(
              value
            );

          }


          if (
            state.directVideo
          ) {

            state.directVideo
              .volume =
              value / 100;

          }

        }
      );


    /* 全螢幕 */

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

            playerWrap?.requestFullscreen?.();

          }

        }
      );


    /* 複製時間 */

    $("copyTimeBtn")
      ?.addEventListener(
        "click",
        async () => {

          try {

            const time =
              formatTime(
                currentPlaybackPosition()
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


    /* 開啟平台 */

    $("openPlatformBtn")
      ?.addEventListener(
        "click",
        openCurrentPlatform
      );


    /* 聊天 */

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

          input.value = "";

          try {

            await sendMessage(
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


    /* 更換平台 */

    $("changeSourceBtn")
      ?.addEventListener(
        "click",
        () => {

          if (
            !state.isOwner
          ) {
            return;
          }

          const modal =
            $("sourceModal");

          if (!modal) {
            return;
          }

          modal.classList.remove(
            "hidden"
          );

          if (
            $("sourceTypeModal")
          ) {
            $("sourceTypeModal").value =
              state.room?.sourceType ||
              "youtube";
          }

          updateModalPlatform(
            state.room?.sourceType ||
              "youtube"
          );
        }
      );


    /* Modal 取消 */

    $("cancelModalBtn")
      ?.addEventListener(
        "click",
        () => {

          $("sourceModal")
            ?.classList.add(
              "hidden"
            );

          setError(
            $("modalError"),
            ""
          );

        }
      );


    /* Modal 平台選擇 */

    $("sourceTypeModal")
      ?.addEventListener(
        "change",
        (event) => {

          updateModalPlatform(
            event.target.value
          );

        }
      );


    /* Modal 儲存 */

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
                ?.value;

            await changePlatform(
              platform
            );

            $("sourceModal")
              ?.classList.add(
                "hidden"
              );

          } catch (error) {

            console.error(
              error
            );

            setError(
              $("modalError"),
              error.message ||
                "切換平台失敗"
            );
          }
        }
      );


    /* Direct Video 播放器 */

    if (
      state.directVideo
    ) {

      state.directVideo
        .addEventListener(
          "play",
          () => {

            if (
              !state.applyingRemote
            ) {
              writePlayback(
                "play",
                true
              );
            }

          }
        );


      state.directVideo
        .addEventListener(
          "pause",
          () => {

            if (
              !state.applyingRemote
            ) {
              writePlayback(
                "pause",
                false
              );
            }

          }
        );


      state.directVideo
        .addEventListener(
          "timeupdate",
          updateTimeUI
        );


      state.directVideo
        .addEventListener(
          "seeking",
          () => {

            if (
              state.applyingRemote
            ) {
              return;
            }

            clearTimeout(
              state.seekTimer
            );

            state.seekTimer =
              setTimeout(
                () => {
                  writePlayback(
                    "seek"
                  );
                },
                120
              );

          }
        );

    }
  }


  /* =========================================
     啟動
  ========================================== */

  async function start() {

    try {

      state.memberName =
        getMemberName();


      await initializeFirebase();


      setupEvents();


      updatePlatformPreview(
        $("sourceTypeInput")
          ?.value ||
        "youtube"
      );


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

          show("home");

          toast(
            error.message ||
              "無法進入房間"
          );
        }

      } else {

        show("home");

      }

    } catch (error) {

      console.error(
        error
      );

      if (
        $("authStatus")
      ) {
        $("authStatus").textContent =
          "連線失敗";
      }

      toast(
        error.message ||
          "網站初始化失敗"
      );
    }
  }


  /* =========================================
     YouTube API Ready
  ========================================== */

  window.onYouTubeIframeAPIReady =
    () => {

      if (
        state.room &&
        hasYoutubeVideo()
      ) {
        buildYoutubePlayer();
      }

    };


  /* 開始 */
  start();

})();
