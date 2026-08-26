(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const YOUTUBE_API_KEY = "AIzaSyA77rYYAE8G6BVrY91aQztCA-8L5WyLzGY";

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
    playerType: null,
    currentVideoId: null,
    currentVideoUrl: null,
    applyingRemote: false,
    lastRemoteKey: "",
    lastWriteAt: 0,
    syncTimer: null,
    searchResults: [],
    modalSelectedVideo: null,
    modalSelectedVideoId: "",
    searchBusy: false,
    videoListenerAttached: false,
    stateListenerAttached: false,
    membersListenerAttached: false,
    chatListenerAttached: false,
    youtubeReady: false,
    youtubeLoading: false,
    youtubeRequestedId: null,
    youtubeBuildToken: 0,
    sdk: {
      vimeo: false,
      dailymotion: false,
      twitch: false
    }
  };

  let db = null;
  let auth = null;

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
            Math.random() * chars.length
          )
        ];
    }

    return result;
  }

  function getRoomIdFromUrl() {
    return (
      new URLSearchParams(location.search)
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
      localStorage.getItem("wt_name");

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

    if (!auth.currentUser) {
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

    if ($("authStatus")) {
      $("authStatus").textContent =
        "已連線";
    }
  }

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
        if (url.pathname === "/watch") {
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

        return match?.[1] || null;
      }
    } catch (_) {}

    const match =
      text.match(
        /(?:vimeo\.com\/)(\d+)/
      );

    return match?.[1] || null;
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

        return match?.[1] || null;
      }

      if (
        url.hostname.includes(
          "dai.ly"
        )
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

    if (/^av\d+$/i.test(text)) {
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
          type: "channel",
          value: text
        };
      }

      const parts =
        url.pathname
          .split("/")
          .filter(Boolean);

      if (!parts.length) {
        return null;
      }

      if (
        parts[0] === "videos" &&
        parts[1]
      ) {
        return {
          type: "video",
          value: parts[1]
        };
      }

      if (
        parts[0] === "clip" &&
        parts[1]
      ) {
        return {
          type: "clip",
          value: parts[1]
        };
      }

      return {
        type: "channel",
        value: parts[0]
      };
    } catch (_) {}

    if (/^\d+$/.test(text)) {
      return {
        type: "video",
        value: text
      };
    }

    return {
      type: "channel",
      value: text.replace(
        /^@/,
        ""
      )
    };
  }

  async function searchYoutube(query) {
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

    const results =
      (
        Array.isArray(data.items)
          ? data.items
          : []
      )
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
            platform: "youtube",
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

    state.modalSelectedVideo =
      null;

    state.modalSelectedVideoId =
      "";

    renderSearchResults(
      results
    );

    return results;
  }

  function renderSearchResults(results) {
    const container =
      $("modalVideoSearchResults");

    if (!container) {
      return;
    }

    state.searchResults =
      Array.isArray(results)
        ? results
        : [];

    state.modalSelectedVideo =
      null;

    state.modalSelectedVideoId =
      "";

    container.dataset.selectedVideoId =
      "";

    if (
      !state.searchResults.length
    ) {
      container.innerHTML = `
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
      state.searchResults
        .map(
          (video) => `
            <button
              type="button"
              class="video-result-card"
              data-video-id="${escapeHtml(
                video.id
              )}"
            >
              <img
                src="${escapeHtml(
                  video.thumbnail
                )}"
                alt=""
                loading="lazy"
              >

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

              </span>
            </button>
          `
        )
        .join("");

    container.querySelectorAll(
      ".video-result-card"
    ).forEach(
      (card) => {
        card.addEventListener(
          "click",
          () => {
            const id =
              String(
                card.dataset.videoId ||
                ""
              );

            const video =
              state.searchResults.find(
                (item) =>
                  String(item.id) ===
                  id
              );

            if (!video) {
              return;
            }

            state.modalSelectedVideo = {
              ...video,
              platform: "youtube"
            };

            state.modalSelectedVideoId =
              id;

            container.dataset.selectedVideoId =
              id;

            container
              .querySelectorAll(
                ".video-result-card"
              )
              .forEach(
                (item) => {
                  item.classList.toggle(
                    "selected",
                    String(
                      item.dataset.videoId ||
                      ""
                    ) === id
                  );
                }
              );

            const saveButton =
              $("saveSourceBtn");

            if (saveButton) {
              saveButton.disabled =
                false;

              saveButton.textContent =
                "使用這部影片";
            }

            setError(
              $("modalError"),
              ""
            );

            toast(
              "已選擇影片"
            );
          }
        );
      }
    );
  }

  function getSelectedModalYoutubeVideo() {
    const container =
      $("modalVideoSearchResults");

    const storedId =
      String(
        container?.dataset?.selectedVideoId ||
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
      platform: "youtube"
    };
  }

  function hidePlayers(keepYoutube = false) {
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

  function showPlayerElement(id) {
    $(id)?.classList.remove(
      "hidden"
    );
  }

  function forceYoutubeVisible() {
    const element =
      document.getElementById(
        "youtubePlayer"
      );

    if (!element) {
      return;
    }

    if (
      !state.youtubeRequestedId &&
      !state.currentVideoId
    ) {
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
      "2";

    if (
      element.tagName ===
      "IFRAME"
    ) {
      element.style.border =
        "0";

      element.style.minWidth =
        "100%";

      element.style.minHeight =
        "100%";

      element.style.zIndex =
        "3";
    }
  }

  async function destroyCurrentPlayer(
    options = {}
  ) {
    const keepYoutube =
      options.keepYoutube === true;

    const old =
      state.player;

    const oldType =
      state.playerType;

    if (
      !old
    ) {
      state.playerReady =
        false;

      state.playerType =
        null;

      return;
    }

    if (
      keepYoutube &&
      oldType ===
        "youtube"
    ) {
      return;
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

    try {
      if (
        oldType ===
        "youtube"
      ) {
        old.destroy?.();
      } else if (
        oldType ===
        "vimeo"
      ) {
        await old.destroy?.();
      } else if (
        oldType ===
        "dailymotion"
      ) {
        old.destroy?.();
      }
    } catch (_) {}
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
        "twitch"
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
    } catch (_) {}

    return 0;
  }

  function currentPosition() {
    if (
      !state.playerReady ||
      !state.player
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
            state.player.getCurrentTime()
          ) || 0
        );
      }

      if (
        state.playerType ===
        "twitch"
      ) {
        return (
          Number(
            state.player.getCurrentTime()
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
        "twitch"
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
    } catch (_) {}

    return 0;
  }

  function duration() {
    if (
      !state.playerReady ||
      !state.player
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
            state.player.getDuration()
          ) || 0
        );
      }

      if (
        state.playerType ===
        "twitch"
      ) {
        return (
          Number(
            state.player.getDuration()
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
        "youtube"
      ) {
        return (
          player.getPlayerState() ===
          YT.PlayerState.PLAYING
        );
      }

      if (
        type ===
        "twitch"
      ) {
        return !player.isPaused();
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
    } catch (_) {}

    return false;
  }

  async function writePlayback(
    action,
    playing
  ) {
    if (
      !state.stateRef ||
      !state.uid ||
      !state.playerReady ||
      !state.player
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
      now -
        state.lastWriteAt <
        400
    ) {
      return;
    }

    state.lastWriteAt =
      now;

    const position =
      await asyncCurrentPosition();

    const actualPlaying =
      await asyncIsPlaying();

    try {
      await state.stateRef.set({
        action,

        position:
          Number.isFinite(
            Number(position)
          )
            ? Number(position)
            : 0,

        playing:
          typeof playing ===
          "boolean"
            ? playing
            : actualPlaying,

        updatedAt:
          firebase.database
            .ServerValue.TIMESTAMP,

        updatedBy:
          state.uid
      });
    } catch (error) {
      console.error(
        "播放同步失敗:",
        error
      );
    }
  }

  async function writePlaybackWithPosition(
    action,
    position,
    playing
  ) {
    if (
      !state.stateRef ||
      !state.uid ||
      !state.playerReady ||
      !state.player
    ) {
      return;
    }

    if (
      state.applyingRemote
    ) {
      return;
    }

    try {
      await state.stateRef.set({
        action,

        position:
          Math.max(
            0,
            Number(position) || 0
          ),

        playing:
          typeof playing ===
          "boolean"
            ? playing
            : await asyncIsPlaying(),

        updatedAt:
          firebase.database
            .ServerValue.TIMESTAMP,

        updatedBy:
          state.uid
      });
    } catch (error) {
      console.error(
        "播放同步失敗:",
        error
      );
    }
  }

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
        return;
      }

      state.lastRemoteKey =
        "";

      await applyRemotePlayback(
        data,
        true
      );
    } catch (error) {
      console.error(
        "讀取播放狀態失敗:",
        error
      );
    }
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

    const key = [
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
        Number(
          data.position
        ) || 0
      );

    state.applyingRemote =
      true;

    try {
      if (
        state.playerReady &&
        state.player &&
        state.playerType !==
          "bilibili" &&
        state.playerType !==
          "external"
      ) {
        await applyPlayerPosition(
          remotePosition,
          data.action ===
            "seek" ||
          data.action ===
            "sync"
        );

        if (
          data.playing ===
          true
        ) {
          await playPlayer();
        }

        if (
          data.playing ===
          false
        ) {
          await pausePlayer();
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

      if (
        state.playerType ===
        "youtube"
      ) {
        forceYoutubeVisible();
      }
    } finally {
      setTimeout(
        () => {
          state.applyingRemote =
            false;
        },
        400
      );
    }
  }

  async function applyPlayerPosition(
    seconds,
    force = false
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

    try {
      const local =
        await asyncCurrentPosition();

      const difference =
        Math.abs(
          local -
            seconds
        );

      if (
        !force &&
        difference <=
          0.8
      ) {
        return;
      }

      if (
        type ===
        "youtube"
      ) {
        player.seekTo(
          seconds,
          true
        );
      } else if (
        type ===
        "vimeo"
      ) {
        await player.setCurrentTime(
          seconds
        );
      } else if (
        type ===
        "dailymotion"
      ) {
        if (
          typeof player.seek ===
          "function"
        ) {
          await player.seek(
            seconds
          );
        }
      } else if (
        type ===
        "twitch"
      ) {
        if (
          typeof player.seek ===
          "function"
        ) {
          player.seek(
            seconds
          );
        }
      }
    } catch (_) {}
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
        state.player.playVideo();
      } else if (
        state.playerType ===
        "vimeo"
      ) {
        await state.player.play();
      } else if (
        state.playerType ===
        "dailymotion"
      ) {
        await state.player.play();
      } else if (
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
      } else if (
        state.playerType ===
        "vimeo"
      ) {
        await state.player.pause();
      } else if (
        state.playerType ===
        "dailymotion"
      ) {
        await state.player.pause();
      } else if (
        state.playerType ===
        "twitch"
      ) {
        state.player.pause();
      }
    } catch (_) {}
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
            !state.player ||
            state.applyingRemote
          ) {
            return;
          }

          if (
            state.isOwner
          ) {
            await writePlayback(
              "sync"
            );
          }

          updateTimeUI();

          if (
            state.playerType ===
            "youtube"
          ) {
            forceYoutubeVisible();
          }
        },
        2500
      );
  }

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
        thumbnail: "",
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
        thumbnail: "",
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
        thumbnail: "",
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
        thumbnail: "",
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
      thumbnail: "",
      channel:
        PLATFORMS[
          platform
        ]?.name ||
        platform
    };
  }

  async function loadVimeoSdk() {
    if (
      window.Vimeo?.Player
    ) {
      state.sdk.vimeo =
        true;

      return;
    }

    await new Promise(
      (resolve, reject) => {
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
          () => {
            reject(
              new Error(
                "Vimeo SDK 載入失敗"
              )
            );
          };

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
      (resolve, reject) => {
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

        script.dataset.wtDailymotionSdk =
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
          () => {
            reject(
              new Error(
                "Dailymotion SDK 載入失敗"
              )
            );
          };

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
      (resolve, reject) => {
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
          () => {
            reject(
              new Error(
                "Twitch SDK 載入失敗"
              )
            );
          };

        document.head.appendChild(
          script
        );
      }
    );
  }

  async function buildYoutubePlayer(videoId) {
    if (!videoId) {
      return;
    }

    const initial =
      document.getElementById(
        "youtubePlayer"
      );

    if (!initial) {
      return;
    }

    if (
      state.playerType ===
        "youtube" &&
      state.playerReady &&
      state.player &&
      state.currentVideoId ===
        videoId
    ) {
      state.youtubeRequestedId =
        videoId;

      forceYoutubeVisible();

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
      if (
        !window.YT ||
        typeof YT.Player !==
          "function"
      ) {
        const existing =
          document.getElementById(
            "youtubePlayer"
          );

        if (existing) {
          existing.classList.remove(
            "hidden"
          );

          existing.style.display =
            "block";

          existing.style.visibility =
            "visible";

          existing.style.opacity =
            "1";

          existing.style.width =
            "100%";

          existing.style.height =
            "100%";
        }

        if (
          $("playerPlaceholder")
        ) {
          $("playerPlaceholder")
            .classList.remove(
              "hidden"
            );

          $("playerPlaceholder")
            .textContent =
            "YouTube 播放器載入中…";
        }

        setTimeout(
          () => {
            if (
              state.youtubeRequestedId !==
                videoId ||
              state.youtubeBuildToken !==
                token
            ) {
              return;
            }

            buildYoutubePlayer(
              videoId
            );
          },
          500
        );

        return;
      }

      if (
        state.youtubeBuildToken !==
          token ||
        state.youtubeRequestedId !==
          videoId
      ) {
        return;
      }

      if (
        state.player &&
        state.playerType ===
          "youtube" &&
        state.currentVideoId ===
          videoId &&
        state.playerReady
      ) {
        forceYoutubeVisible();
        return;
      }

      if (
        state.player &&
        state.playerType ===
          "youtube"
      ) {
        const oldPlayer =
          state.player;

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

        try {
          oldPlayer.destroy();
        } catch (_) {}
      } else if (
        state.player &&
        state.playerType !==
          "youtube"
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

      let current =
        document.getElementById(
          "youtubePlayer"
        );

      if (!current) {
        throw new Error(
          "找不到 youtubePlayer"
        );
      }

      if (
        current.tagName ===
        "IFRAME"
      ) {
        const fresh =
          document.createElement(
            "div"
          );

        fresh.id =
          "youtubePlayer";

        fresh.className =
          "youtube-player";

        current.replaceWith(
          fresh
        );

        current =
          fresh;
      }

      const container =
        current;

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

      container.style.position =
        "relative";

      container.style.zIndex =
        "2";

      $("playerPlaceholder")
        ?.classList.add(
          "hidden"
        );

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
                      event.target.destroy();
                    } catch (_) {}

                    return;
                  }

                  if (
                    !document.documentElement.contains(
                      event.target.getIframe?.() ||
                      document.getElementById(
                        "youtubePlayer"
                      )
                    )
                  ) {
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

                  showPlayerElement(
                    "youtubePlayer"
                  );

                  forceYoutubeVisible();

                  $("playerPlaceholder")
                    ?.classList.add(
                      "hidden"
                    );

                  if (
                    $("syncStatus")
                  ) {
                    $("syncStatus")
                      .textContent =
                      "影片已載入";
                  }

                  updateTimeUI();

                  await syncLatestPlayback();

                  if (
                    state.youtubeBuildToken ===
                      token &&
                    state.player ===
                      event.target
                  ) {
                    forceYoutubeVisible();
                  }

                  startSyncHeartbeat();

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
                    1500
                  );
                },

              onStateChange:
                async (
                  event
                ) => {
                  if (
                    state.youtubeBuildToken !==
                      token ||
                    state.youtubeRequestedId !==
                      videoId
                  ) {
                    return;
                  }

                  if (
                    state.player !==
                    event.target &&
                    state.player !==
                      null
                  ) {
                    return;
                  }

                  forceYoutubeVisible();

                  if (
                    state.applyingRemote
                  ) {
                    return;
                  }

                  if (
                    event.data ===
                    YT.PlayerState.PLAYING
                  ) {
                    await writePlayback(
                      "play",
                      true
                    );
                  }

                  if (
                    event.data ===
                    YT.PlayerState.PAUSED
                  ) {
                    await writePlayback(
                      "pause",
                      false
                    );
                  }

                  if (
                    event.data ===
                    YT.PlayerState.ENDED
                  ) {
                    await writePlayback(
                      "pause",
                      false
                    );
                  }

                  updateTimeUI();
                },

              onError:
                (
                  event
                ) => {
                  if (
                    state.youtubeBuildToken !==
                    token
                  ) {
                    return;
                  }

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

      state.player =
        player;

      setTimeout(
        () => {
          if (
            state.youtubeBuildToken ===
              token &&
            state.player ===
              player
          ) {
            forceYoutubeVisible();
          }
        },
        250
      );

    } catch (error) {
      console.error(
        "YouTube 播放器建立失敗:",
        error
      );

      if (
        state.youtubeBuildToken ===
        token
      ) {
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

        hidePlayers();

        showPlayerElement(
          "emptyPlayer"
        );

        toast(
          "YouTube 播放器建立失敗"
        );
      }
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

        await syncLatestPlayback();

        startSyncHeartbeat();
      }
    );

    player.on(
      "play",
      async () => {
        if (
          state.applyingRemote ||
          state.player !==
            player
        ) {
          return;
        }

        await writePlayback(
          "play",
          true
        );
      }
    );

    player.on(
      "pause",
      async () => {
        if (
          state.applyingRemote ||
          state.player !==
            player
        ) {
          return;
        }

        await writePlayback(
          "pause",
          false
        );
      }
    );

    player.on(
      "seeked",
      async (
        data
      ) => {
        if (
          state.applyingRemote ||
          state.player !==
            player
        ) {
          return;
        }

        await writePlaybackWithPosition(
          "seek",
          Number(
            data?.seconds
          ) || 0,
          await asyncIsPlaying()
        );
      }
    );

    player.on(
      "timeupdate",
      updateTimeUI
    );
  }

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
      await window.dailymotion.createPlayer(
        playerId,
        {
          video:
            video.id,
          mute:
            false,
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

    if (
      player?.addEventListener
    ) {
      player.addEventListener(
        "play",
        async () => {
          if (
            state.applyingRemote ||
            state.player !==
              player
          ) {
            return;
          }

          await writePlayback(
            "play",
            true
          );
        }
      );

      player.addEventListener(
        "pause",
        async () => {
          if (
            state.applyingRemote ||
            state.player !==
              player
          ) {
            return;
          }

          await writePlayback(
            "pause",
            false
          );
        }
      );
    }

    startSyncHeartbeat();
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
      /^BV/.test(video.id)
    ) {
      src =
        "https://player.bilibili.com/player.html?bvid=" +
        encodeURIComponent(
          video.id
        ) +
        "&page=1&autoplay=0";
    } else if (
      /^av/i.test(video.id)
    ) {
      src =
        "https://player.bilibili.com/player.html?aid=" +
        encodeURIComponent(
          video.id.replace(
            /^av/i,
            ""
          )
        ) +
        "&page=1&autoplay=0";
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
  }

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
        false,

      muted:
        false,

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

          player.addEventListener(
            Twitch.Player.PLAY,
            async () => {
              if (
                state.applyingRemote ||
                state.player !==
                  player
              ) {
                return;
              }

              await writePlayback(
                "play",
                true
              );
            }
          );

          player.addEventListener(
            Twitch.Player.PAUSE,
            async () => {
              if (
                state.applyingRemote ||
                state.player !==
                  player
              ) {
                return;
              }

              await writePlayback(
                "pause",
                false
              );
            }
          );
        } else {
          setTimeout(
            ready,
            1500
          );
        }
      }
    );

    startSyncHeartbeat();
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
        video.id
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

      state: {
        action:
          "pause",

        position:
          0,

        playing:
          false,

        updatedAt:
          firebase.database
            .ServerValue.TIMESTAMP,

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
          state.isOwner
            ? "等待你選擇影片"
            : "等待房主選擇影片";
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
        state.youtubeRequestedId =
          videoId;

        forceYoutubeVisible();

        return;
      }

      await buildYoutubePlayer(
        videoId
      );

      return;
    }

    await buildPlatformPlayer(
      normalized
    );
  }

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
      .child(
        state.uid
      )
      .set({
        name:
          state.memberName,

        joinedAt:
          firebase.database
            .ServerValue.TIMESTAMP
      });

    state.membersRef
      .child(
        state.uid
      )
      .onDisconnect()
      .remove();

    if (
      !state.stateListenerAttached
    ) {
      state.stateRef.on(
        "value",
        (snapshot) => {
          applyRemotePlayback(
            snapshot.val()
          );
        }
      );

      state.stateListenerAttached =
        true;
    }

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
        (snapshot) => {
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
  }

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
      !entries.length
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

            const owner =
              uid ===
              state.room?.owner;

            return `
              <div class="member">

                <div class="avatar">
                  ${escapeHtml(
                    name.slice(
                      0,
                      1
                    )
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
          .ServerValue.TIMESTAMP
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

  async function changeVideo(
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

    if (
      !video?.id &&
      !video?.url
    ) {
      throw new Error(
        "沒有選擇影片"
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

    if (
      video.url
    ) {
      roomVideo.url =
        video.url;
    }

    if (
      video.twitchType
    ) {
      roomVideo.twitchType =
        video.twitchType;
    }

    await state.roomRef
      .child("sourceType")
      .set(
        platform
      );

    await state.roomRef
      .child("video")
      .set(
        roomVideo
      );

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
            .ServerValue.TIMESTAMP,

        updatedBy:
          state.uid
      });

    state.room.sourceType =
      platform;

    state.room.video =
      roomVideo;

    closeSourceModal();

    toast(
      `已選擇${
        PLATFORMS[
          platform
        ]?.name ||
        platform
      }影片`
    );
  }

  function openSourceModal() {
    if (
      !state.isOwner
    ) {
      return;
    }

    const modal =
      $("sourceModal");

    if (!modal) {
      toast(
        "找不到影片搜尋視窗"
      );

      return;
    }

    state.modalSelectedVideo =
      null;

    state.modalSelectedVideoId =
      "";

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
        .dataset.selectedVideoId =
        "";
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
        "選擇影片";
    }

    setTimeout(
      () => {
        $("modalVideoSearchInput")
          ?.focus();
      },
      100
    );
  }

  function closeSourceModal() {
    $("sourceModal")
      ?.classList.add(
        "hidden"
      );

    state.modalSelectedVideo =
      null;

    state.modalSelectedVideoId =
      "";

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

    if (
      searchArea
    ) {
      searchArea.classList.toggle(
        "hidden",
        platform !==
          "youtube"
      );
    }

    if (
      externalArea
    ) {
      externalArea.classList.toggle(
        "hidden",
        platform ===
          "youtube"
      );
    }

    if (
      platform !==
      "youtube"
    ) {
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
          .dataset.selectedVideoId =
          "";
      }
    }
  }

  function detachRoomListeners() {
    try {
      state.stateRef?.off();

      state.membersRef?.off();

      state.chatRef?.off();

      state.roomRef
        ?.child("video")
        .off();
    } catch (_) {}

    state.stateListenerAttached =
      false;

    state.videoListenerAttached =
      false;

    state.membersListenerAttached =
      false;

    state.chatListenerAttached =
      false;
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

    $("playPauseBtn")
      ?.addEventListener(
        "click",
        async () => {
          if (
            !state.playerReady ||
            !state.player
          ) {
            toast(
              state.isOwner
                ? "請先選擇影片"
                : "等待房主選擇影片"
            );

            return;
          }

          if (
            state.playerType ===
            "bilibili"
          ) {
            toast(
              "Bilibili 無法由本站直接控制播放"
            );

            return;
          }

          if (
            state.playerType ===
            "external"
          ) {
            toast(
              "此平台不支援本站播放控制"
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
        }
      );

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
              ) - 10
            );

          await applyPlayerPosition(
            target,
            true
          );

          await writePlaybackWithPosition(
            "seek",
            target,
            await asyncIsPlaying()
          );
        }
      );

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
              ) + 10
            );

          await applyPlayerPosition(
            target,
            true
          );

          await writePlaybackWithPosition(
            "seek",
            target,
            await asyncIsPlaying()
          );
        }
      );

    $("syncNowBtn")
      ?.addEventListener(
        "click",
        async () => {
          if (
            !state.stateRef
          ) {
            return;
          }

          const snapshot =
            await state.stateRef.once(
              "value"
            );

          await applyRemotePlayback(
            snapshot.val(),
            true
          );

          if (
            state.playerType ===
            "youtube"
          ) {
            forceYoutubeVisible();
          }

          toast(
            "已重新同步"
          );
        }
      );

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
            } else if (
              state.playerType ===
              "vimeo"
            ) {
              state.player?.setVolume(
                value / 100
              );
            } else if (
              state.playerType ===
              "twitch"
            ) {
              state.player?.setVolume(
                value / 100
              );
            } else if (
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

    $("modalSearchVideoBtn")
      ?.addEventListener(
        "click",
        async () => {
          if (
            (
              $("sourceTypeModal")
                ?.value ||
              "youtube"
            ) !==
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

          state.searchBusy =
            true;

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
              query
            );
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
  }

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

  window.onYouTubeIframeAPIReady =
    () => {
      state.youtubeReady =
        true;

      const roomVideo =
        state.room?.video;

      if (
        roomVideo &&
        (
          roomVideo.platform ===
            "youtube" ||
          !roomVideo.platform
        ) &&
        roomVideo.id &&
        !state.player &&
        !state.youtubeLoading
      ) {
        buildYoutubePlayer(
          roomVideo.id
        );
      }
    };

  start();
})();
