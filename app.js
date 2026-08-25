(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const state = {
    uid: null,
    roomId: null,
    room: null,
    isOwner: false,
    memberName: "看片玩家",

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

    directVideo: $("directVideo")
  };

  let db = null;
  let auth = null;

  // Firebase Web App 設定
  // 這些是你目前專案的公開 Web SDK 設定。
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDZntXy7hLNzBlADp94MyoRmiFWSSdvDLE",
    authDomain: "watchtogether-3f4f9.firebaseapp.com",
    databaseURL:
      "https://watchtogether-3f4f9-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "watchtogether-3f4f9",
    storageBucket: "watchtogether-3f4f9.firebasestorage.app",
    messagingSenderId: "726694766811",
    appId: "1:726694766811:web:238f98e46330d0f65884fe"
  };

  function toast(message) {
    const el = $("toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    clearTimeout(toast.timer);

    toast.timer = setTimeout(() => {
      el.classList.remove("show");
    }, 2400);
  }

  function setError(el, message) {
    if (el) el.textContent = message || "";
  }

  function show(view) {
    $("homeView")?.classList.toggle("hidden", view !== "home");
    $("roomView")?.classList.toggle("hidden", view !== "room");
  }

  function fmt(sec) {
    sec = Number(sec);

    if (!Number.isFinite(sec) || sec < 0) {
      return "00:00";
    }

    sec = Math.floor(sec);

    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;

    if (h > 0) {
      return (
        String(h).padStart(2, "0") +
        ":" +
        String(m).padStart(2, "0") +
        ":" +
        String(s).padStart(2, "0")
      );
    }

    return (
      String(m).padStart(2, "0") +
      ":" +
      String(s).padStart(2, "0")
    );
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      const map = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      };

      return map[char];
    });
  }

  function randomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    let result = "";

    for (let i = 0; i < 6; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }

    return result;
  }

  function getRoomFromUrl() {
    return (
      new URLSearchParams(location.search)
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
    let name = localStorage.getItem("wt_name");

    if (!name) {
      name = "玩家" + Math.floor(Math.random() * 900 + 100);
      localStorage.setItem("wt_name", name);
    }

    return name;
  }

  function extractYoutubeId(url) {
    try {
      const u = new URL(url);

      if (u.hostname.includes("youtu.be")) {
        return u.pathname.replace("/", "").split("/")[0] || null;
      }

      if (u.hostname.includes("youtube.com")) {
        if (u.pathname === "/watch") {
          return u.searchParams.get("v");
        }

        if (u.pathname.startsWith("/shorts/")) {
          return u.pathname.split("/")[2] || null;
        }

        if (u.pathname.startsWith("/embed/")) {
          return u.pathname.split("/")[2] || null;
        }
      }
    } catch (_) {}

    return null;
  }

  function currentPosition() {
    if (state.room?.sourceType === "youtube") {
      if (!state.playerReady || !state.player) {
        return 0;
      }

      try {
        return state.player.getCurrentTime() || 0;
      } catch (_) {
        return 0;
      }
    }

    if (state.room?.sourceType === "direct") {
      return state.directVideo?.currentTime || 0;
    }

    return 0;
  }

  function duration() {
    if (state.room?.sourceType === "youtube") {
      if (!state.playerReady || !state.player) {
        return 0;
      }

      try {
        return state.player.getDuration() || 0;
      } catch (_) {
        return 0;
      }
    }

    if (state.room?.sourceType === "direct") {
      return Number.isFinite(state.directVideo?.duration)
        ? state.directVideo.duration
        : 0;
    }

    return 0;
  }

  function isPlaying() {
    if (state.room?.sourceType === "youtube") {
      if (!state.playerReady || !state.player) {
        return false;
      }

      try {
        return (
          window.YT &&
          state.player.getPlayerState() === YT.PlayerState.PLAYING
        );
      } catch (_) {
        return false;
      }
    }

    if (state.room?.sourceType === "direct") {
      return !!state.directVideo && !state.directVideo.paused;
    }

    return false;
  }

  function updateTimeUI() {
    const el = $("timeReadout");

    if (!el) return;

    el.textContent =
      fmt(currentPosition()) +
      " / " +
      fmt(duration());
  }

  function isYoutubeSource() {
    return state.room?.sourceType === "youtube";
  }

  function isDirectSource() {
    return state.room?.sourceType === "direct";
  }

  function isExternalSource() {
    return (
      state.room?.sourceType &&
      !isYoutubeSource() &&
      !isDirectSource()
    );
  }

  async function initFirebase() {
    if (!window.firebase) {
      throw new Error("Firebase SDK 尚未載入");
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }

    auth = firebase.auth();
    db = firebase.database();

    await auth.signInAnonymously();

    state.uid = auth.currentUser?.uid || null;

    if (!state.uid) {
      throw new Error("Firebase 匿名登入失敗");
    }

    $("authStatus").textContent = "已連線";
  }

  async function writePlayback(action, explicitPosition = null) {
    if (!state.stateRef || !state.uid) {
      return;
    }

    if (state.applyingRemote) {
      return;
    }

    const now = Date.now();

    if (
      action === "sync" &&
      now - state.lastWriteAt < 350
    ) {
      return;
    }

    state.lastWriteAt = now;

    const payload = {
      action,
      position: Math.max(
        0,
        Number(explicitPosition ?? currentPosition()) || 0
      ),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid
    };

    try {
      await state.stateRef.set(payload);
    } catch (error) {
      console.error(error);
      toast("同步失敗，請檢查 Firebase 規則");
    }
  }

  async function applyRemotePlayback(data) {
    if (!data) return;

    if (data.updatedBy === state.uid) {
      return;
    }

    const key =
      String(data.updatedAt || "") +
      "|" +
      String(data.updatedBy || "") +
      "|" +
      String(data.action || "") +
      "|" +
      String(data.position || "");

    if (key === state.lastRemoteKey) {
      return;
    }

    state.lastRemoteKey = key;
    state.applyingRemote = true;

    try {
      const position = Math.max(
        0,
        Number(data.position) || 0
      );

      if (isYoutubeSource()) {
        if (!state.playerReady || !state.player) {
          return;
        }

        const localPosition =
          state.player.getCurrentTime?.() || 0;

        const diff = Math.abs(localPosition - position);

        if (
          diff > 0.7 ||
          data.action === "seek" ||
          data.action === "sync"
        ) {
          state.player.seekTo(position, true);
        }

        if (data.action === "play") {
          state.player.playVideo();
        }

        if (data.action === "pause") {
          state.player.pauseVideo();
        }

        if (
          data.action === "seek" ||
          data.action === "sync"
        ) {
          if (data.playing === false) {
            state.player.pauseVideo();
          } else if (data.playing === true) {
            state.player.playVideo();
          }
        }
      }

      if (isDirectSource()) {
        if (!state.directVideo) {
          return;
        }

        const diff = Math.abs(
          state.directVideo.currentTime - position
        );

        if (
          diff > 0.7 ||
          data.action === "seek" ||
          data.action === "sync"
        ) {
          state.directVideo.currentTime = position;
        }

        if (data.action === "play") {
          await state.directVideo.play().catch(() => {});
        }

        if (data.action === "pause") {
          state.directVideo.pause();
        }

        if (
          data.action === "seek" ||
          data.action === "sync"
        ) {
          if (data.playing === false) {
            state.directVideo.pause();
          } else if (data.playing === true) {
            await state.directVideo.play().catch(() => {});
          }
        }
      }

      $("syncStatus").textContent =
        "已同步 " + fmt(position);

      updateTimeUI();
    } finally {
      setTimeout(() => {
        state.applyingRemote = false;
      }, 250);
    }
  }

  async function syncLatestState() {
    if (!state.stateRef) {
      return;
    }

    const snap = await state.stateRef.once("value");
    const data = snap.val();

    if (!data) {
      await writePlayback("sync", 0);
      return;
    }

    state.lastRemoteKey = "";

    await applyRemotePlayback({
      ...data,
      updatedBy:
        data.updatedBy === state.uid
          ? null
          : data.updatedBy
    });
  }

  function showExternalSource() {
    $("youtubePlayer")?.classList.add("hidden");
    $("directVideo")?.classList.add("hidden");

    const external = $("externalPlayer");

    if (!external) {
      return;
    }

    external.classList.remove("hidden");

    const title = $("externalPlayerTitle");

    const link = $("externalPlayerLink");

    const sourceNames = {
      bilibili: "Bilibili",
      vimeo: "Vimeo",
      dailymotion: "Dailymotion",
      twitch: "Twitch",
      facebook: "Facebook Video",
      x: "X / Twitter",
      tiktok: "TikTok",
      rumble: "Rumble",
      streamable: "Streamable",
      archive: "Internet Archive",
      crunchyroll: "Crunchyroll",
      netflix: "Netflix",
      disneyplus: "Disney+",
      primevideo: "Prime Video",
      hbomax: "Max",
      "apple-tv": "Apple TV+",
      hulu: "Hulu",
      paramount: "Paramount+",
      peacock: "Peacock",
      other: "影片網站"
    };

    const name =
      sourceNames[state.room?.sourceType] ||
      "影片網站";

    if (title) {
      title.textContent =
        name +
        " 目前使用官方網站觀看";
    }

    if (link) {
      link.href = state.room?.sourceUrl || "#";
      link.textContent =
        "開啟 " + name;
    }

    $("syncStatus").textContent =
      "外部平台";
  }

  function buildPlayer() {
    const type = state.room?.sourceType;

    state.playerReady = false;

    $("youtubePlayer")?.classList.add("hidden");
    $("directVideo")?.classList.add("hidden");
    $("externalPlayer")?.classList.add("hidden");
    $("playerPlaceholder")?.classList.add("hidden");

    if (type === "youtube") {
      const videoId =
        extractYoutubeId(
          state.room?.sourceUrl || ""
        );

      if (!videoId) {
        $("playerPlaceholder").textContent =
          "YouTube 網址無法辨識";

        $("playerPlaceholder").classList.remove(
          "hidden"
        );

        return;
      }

      $("youtubePlayer").classList.remove(
        "hidden"
      );

      if (
        !window.YT ||
        typeof YT.Player !== "function"
      ) {
        $("playerPlaceholder").textContent =
          "YouTube 播放器載入中…";

        $("playerPlaceholder").classList.remove(
          "hidden"
        );

        setTimeout(buildPlayer, 700);
        return;
      }

      if (state.player) {
        try {
          state.player.destroy();
        } catch (_) {}
      }

      state.player =
        new YT.Player("youtubePlayer", {
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
              state.playerReady = true;

              updateTimeUI();

              syncLatestState();
            },

            onStateChange: (event) => {
              if (state.applyingRemote) {
                return;
              }

              if (
                event.data ===
                YT.PlayerState.PLAYING
              ) {
                writePlayback("play");
              }

              if (
                event.data ===
                YT.PlayerState.PAUSED
              ) {
                writePlayback("pause");
              }

              if (
                event.data ===
                YT.PlayerState.ENDED
              ) {
                writePlayback("pause");
              }

              updateTimeUI();
            },

            onError: () => {
              toast(
                "YouTube 無法播放這支影片"
              );
            }
          }
        });

      if ($("volumeInput")) {
        $("volumeInput").value = "100";
      }

      return;
    }

    if (type === "direct") {
      $("directVideo").classList.remove(
        "hidden"
      );

      const video = state.directVideo;

      video.pause();
      video.removeAttribute("src");

      video.src =
        state.room?.sourceUrl || "";

      video.load();

      video.onloadedmetadata = () => {
        state.playerReady = true;

        updateTimeUI();

        syncLatestState();
      };

      video.onplay = () => {
        if (state.applyingRemote) {
          return;
        }

        writePlayback("play");
      };

      video.onpause = () => {
        if (state.applyingRemote) {
          return;
        }

        writePlayback("pause");
      };

      video.onseeking = () => {
        if (state.applyingRemote) {
          return;
        }

        clearTimeout(state.seekTimer);

        state.seekTimer = setTimeout(() => {
          writePlayback(
            "seek",
            video.currentTime
          );
        }, 100);
      };

      video.ontimeupdate = updateTimeUI;

      video.onerror = () => {
        toast(
          "這個影片網址無法直接播放"
        );
      };

      return;
    }

    showExternalSource();
  }

  async function createRoom() {
    if (!db || !state.uid) {
      throw new Error(
        "Firebase 尚未連線"
      );
    }

    const name =
      $("roomNameInput")
        .value
        .trim() ||
      "一起看片";

    const sourceType =
      $("sourceTypeInput").value;

    const sourceUrl =
      $("sourceUrlInput")
        .value
        .trim();

    if (!sourceUrl) {
      throw new Error(
        "請輸入影片網址"
      );
    }

    if (
      sourceType === "youtube" &&
      !extractYoutubeId(sourceUrl)
    ) {
      throw new Error(
        "請輸入正確的 YouTube 網址"
      );
    }

    let roomId = randomCode();

    while (
      (
        await db
          .ref(`rooms/${roomId}`)
          .once("value")
      ).exists()
    ) {
      roomId = randomCode();
    }

    const room = {
      owner: state.uid,
      name,
      sourceType,
      sourceUrl,

      state: {
        action: "pause",
        position: 0,
        playing: false,
        updatedAt:
          firebase.database.ServerValue.TIMESTAMP,
        updatedBy: state.uid
      }
    };

    await db
      .ref(`rooms/${roomId}`)
      .set(room);

    state.roomId = roomId;
    state.room = room;
    state.isOwner = true;

    history.replaceState(
      {},
      "",
      `?room=${encodeURIComponent(roomId)}`
    );

    await enterRoom();
  }

  async function joinRoom(roomId) {
    roomId = String(roomId || "")
      .trim()
      .toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(roomId)) {
      throw new Error(
        "房間碼必須是 6 碼"
      );
    }

    const snapshot = await db
      .ref(`rooms/${roomId}`)
      .once("value");

    if (!snapshot.exists()) {
      throw new Error(
        "找不到這個房間"
      );
    }

    state.roomId = roomId;
    state.room = snapshot.val();
    state.isOwner =
      state.room.owner === state.uid;

    history.replaceState(
      {},
      "",
      `?room=${encodeURIComponent(roomId)}`
    );

    await enterRoom();
  }

  async function enterRoom() {
    if (!state.room || !state.roomId) {
      throw new Error(
        "房間資料不存在"
      );
    }

    $("roomTitle").textContent =
      state.room.name ||
      "一起看片";

    $("roomCodeLabel").textContent =
      state.roomId;

    document
      .querySelectorAll(".owner-only")
      .forEach((element) => {
        element.classList.toggle(
          "hidden",
          !state.isOwner
        );
      });

    show("room");

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
        name: state.memberName,
        joinedAt:
          firebase.database.ServerValue.TIMESTAMP
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
          snapshot.val() || {}
        );
      }
    );

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

    buildPlayer();
  }

  function renderMembers(members) {
    const entries =
      Object.entries(members);

    entries.sort(
      (a, b) =>
        (a[1]?.joinedAt || 0) -
        (b[1]?.joinedAt || 0)
    );

    $("memberCount").textContent =
      String(entries.length);

    if (!entries.length) {
      $("memberList").innerHTML =
        '<div class="muted">目前沒有成員</div>';

      return;
    }

    $("memberList").innerHTML =
      entries
        .map(([uid, member]) => {
          const name =
            member?.name ||
            "看片玩家";

          const isOwner =
            uid === state.room?.owner;

          return `
            <div class="member">
              <div class="avatar">
                ${escapeHtml(
                  name
                    .slice(0, 1)
                    .toUpperCase()
                )}
              </div>

              <div class="member-name">
                <b>
                  ${escapeHtml(name)}
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
        })
        .join("");
  }

  function renderChat(messages) {
    const list =
      Object.values(messages)
        .sort(
          (a, b) =>
            (a.createdAt || 0) -
            (b.createdAt || 0)
        );

    if (!list.length) {
      $("chatMessages").innerHTML =
        '<div class="muted" style="padding:12px;">開始聊天吧 👋</div>';

      return;
    }

    $("chatMessages").innerHTML =
      list
        .map((message) => {
          const name =
            message?.name ||
            "玩家";

          const text =
            message?.text ||
            "";

          return `
            <div class="message">
              <b>
                ${escapeHtml(name)}
              </b>

              <p>
                ${escapeHtml(text)}
              </p>
            </div>
          `;
        })
        .join("");

    const box =
      $("chatMessages");

    box.scrollTop =
      box.scrollHeight;
  }

  async function sendChat(text) {
    text = String(text || "").trim();

    if (
      !text ||
      !state.chatRef ||
      !state.uid
    ) {
      return;
    }

    await state.chatRef.push({
      uid: state.uid,
      name: state.memberName,
      text: text.slice(0, 300),
      createdAt:
        firebase.database.ServerValue.TIMESTAMP
    });
  }

  async function changeSource(
    sourceType,
    sourceUrl
  ) {
    if (!state.isOwner) {
      toast("只有房主可以換影片");
      return;
    }

    if (!sourceUrl) {
      throw new Error(
        "請輸入影片網址"
      );
    }

    if (
      sourceType === "youtube" &&
      !extractYoutubeId(sourceUrl)
    ) {
      throw new Error(
        "YouTube 網址無法辨識"
      );
    }

    await db
      .ref(
        `rooms/${state.roomId}/sourceType`
      )
      .set(sourceType);

    await db
      .ref(
        `rooms/${state.roomId}/sourceUrl`
      )
      .set(sourceUrl);

    await db
      .ref(
        `rooms/${state.roomId}/state`
      )
      .set({
        action: "pause",
        position: 0,
        playing: false,
        updatedAt:
          firebase.database.ServerValue.TIMESTAMP,
        updatedBy: state.uid
      });

    state.room.sourceType =
      sourceType;

    state.room.sourceUrl =
      sourceUrl;

    buildPlayer();

    toast("影片已切換");
  }

  function playPause() {
    if (
      isYoutubeSource() &&
      state.playerReady &&
      state.player
    ) {
      const playing = isPlaying();

      if (playing) {
        state.player.pauseVideo();
      } else {
        state.player.playVideo();
      }

      return;
    }

    if (
      isDirectSource() &&
      state.directVideo
    ) {
      if (state.directVideo.paused) {
        state.directVideo
          .play()
          .catch(() => {
            toast(
              "瀏覽器阻止自動播放，請直接點影片播放"
            );
          });
      } else {
        state.directVideo.pause();
      }

      return;
    }

    toast(
      "這個平台需要在官方網站觀看"
    );
  }

  function seekRelative(seconds) {
    if (
      !isYoutubeSource() &&
      !isDirectSource()
    ) {
      toast(
        "外部平台目前不能由房間控制進度"
      );

      return;
    }

    const target = Math.max(
      0,
      currentPosition() + seconds
    );

    if (isYoutubeSource()) {
      state.player.seekTo(
        target,
        true
      );
    }

    if (isDirectSource()) {
      state.directVideo.currentTime =
        target;
    }

    writePlayback(
      "seek",
      target
    );
  }

  function syncNow() {
    if (
      !isYoutubeSource() &&
      !isDirectSource()
    ) {
      toast(
        "外部平台沒有可控制的播放器"
      );

      return;
    }

    const position =
      currentPosition();

    writePlayback(
      "sync",
      position
    );

    toast("已發送同步");
  }

  function setupEvents() {
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

    $("joinRoomBtn")
      ?.addEventListener(
        "click",
        async () => {
          try {
            await joinRoom(
              $("joinCodeInput")
                .value
                .trim()
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

    $("leaveRoomBtn")
      ?.addEventListener(
        "click",
        () => {
          location.href =
            location.pathname;
        }
      );

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
              "無法自動複製連結"
            );
          }
        }
      );

    $("playPauseBtn")
      ?.addEventListener(
        "click",
        playPause
      );

    $("backBtn")
      ?.addEventListener(
        "click",
        () => {
          seekRelative(-10);
        }
      );

    $("forwardBtn")
      ?.addEventListener(
        "click",
        () => {
          seekRelative(10);
        }
      );

    $("syncNowBtn")
      ?.addEventListener(
        "click",
        syncNow
      );

    $("volumeInput")
      ?.addEventListener(
        "input",
        (event) => {
          const volume =
            Number(
              event.target.value
            );

          if (
            isYoutubeSource() &&
            state.playerReady &&
            state.player
          ) {
            state.player.setVolume(
              volume
            );
          }

          if (
            isDirectSource() &&
            state.directVideo
          ) {
            state.directVideo.volume =
              volume / 100;
          }
        }
      );

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
            wrap?.requestFullscreen?.();
          }
        }
      );

    $("copyTimeBtn")
      ?.addEventListener(
        "click",
        async () => {
          try {
            const time =
              fmt(
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

    $("chatForm")
      ?.addEventListener(
        "submit",
        async (event) => {
          event.preventDefault();

          const input =
            $("chatInput");

          const text =
            input.value.trim();

          if (!text) {
            return;
          }

          input.value = "";

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

    $("changeSourceBtn")
      ?.addEventListener(
        "click",
        () => {
          if (!state.isOwner) {
            return;
          }

          $("sourceModal")
            ?.classList.remove(
              "hidden"
            );

          $("sourceTypeModal").value =
            state.room.sourceType;

          $("sourceUrlModal").value =
            state.room.sourceUrl || "";
        }
      );

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

    $("saveSourceBtn")
      ?.addEventListener(
        "click",
        async () => {
          try {
            setError(
              $("modalError"),
              ""
            );

            const type =
              $("sourceTypeModal").value;

            const url =
              $("sourceUrlModal")
                .value
                .trim();

            await changeSource(
              type,
              url
            );

            $("sourceModal")
              .classList.add(
                "hidden"
              );
          } catch (error) {
            setError(
              $("modalError"),
              error.message ||
                "切換影片失敗"
            );
          }
        }
      );

    $("sourceTypeInput")
      ?.addEventListener(
        "change",
        () => {
          const type =
            $("sourceTypeInput").value;

          const label =
            $("sourceUrlLabel");

          const input =
            $("sourceUrlInput");

          if (
            label &&
            input
          ) {
            if (
              type ===
              "youtube"
            ) {
              label.textContent =
                "YouTube 影片網址";

              input.placeholder =
                "https://www.youtube.com/watch?v=...";
            } else {
              label.textContent =
                "影片／網站網址";

              input.placeholder =
                "貼上影片或網站網址";
            }
          }
        }
      );
  }

  async function start() {
    try {
      state.memberName =
        getMemberName();

      await initFirebase();

      setupEvents();

      const roomId =
        getRoomFromUrl();

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

          show("home");

          toast(
            error.message ||
              "房間不存在"
          );
        }
      } else {
        show("home");
      }
    } catch (error) {
      console.error(error);

      $("authStatus").textContent =
        "Firebase 連線失敗";

      toast(
        error.message ||
          "網站初始化失敗"
      );
    }
  }

  // YouTube API 載入完成時
  window.onYouTubeIframeAPIReady =
    () => {
      if (
        state.room &&
        isYoutubeSource()
      ) {
        buildPlayer();
      }
    };

  start();
})();
