from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")

marker = "ROOM AUTHORITY PLAYBACK V14"
if marker in text:
    print("v14 already installed")
    raise SystemExit(0)

patch = r'''

  /* =========================================================
     ROOM AUTHORITY PLAYBACK V14
     =========================================================
     One shared room timeline. No participant is a playback master.
     The last Firebase command is the room clock.
  ========================================================= */

  state.roomAuthorityV14 = true;
  state.roomAuthorityBusyV14 = false;
  state.roomAuthorityTimerV14 = null;
  state.roomAuthorityLocalStateTimerV14 = null;
  state.roomAuthorityLastNativeStateV14 = null;
  state.roomAuthorityLastNativeStateAtV14 = 0;


  function roomAuthorityClockV14() {
    return typeof serverNow === "function" ? serverNow() : Date.now();
  }


  function roomAuthorityExpectedV14(event, now = roomAuthorityClockV14()) {
    if (!event) return null;

    const base = Number(event.position);
    if (!Number.isFinite(base)) return null;

    if (event.playing !== true) {
      return Math.max(0, base);
    }

    const updatedAt = Number(event.updatedAt);
    if (!Number.isFinite(updatedAt)) {
      return Math.max(0, base);
    }

    return Math.max(
      0,
      base + Math.min(7200, Math.max(0, (now - updatedAt) / 1000))
    );
  }


  async function roomAuthorityReadV14() {
    if (!db || !state.roomId || !state.currentVideoId) return null;

    const snapshot = await db
      .ref(`rooms/${state.roomId}/playbackEvent`)
      .once("value");

    const event = snapshot.val();

    if (!event || String(event.videoId || "") !== String(state.currentVideoId)) {
      return null;
    }

    state.playbackTimeline = event;
    return event;
  }


  function roomAuthorityCanControlV14() {
    return Boolean(
      db &&
      state.roomId &&
      state.currentVideoId &&
      state.player &&
      state.playerReady &&
      state.playerType === "youtube"
    );
  }


  function roomAuthorityEventV14(action, position, playing) {
    const now = Date.now();

    return {
      action,
      position: Math.max(0, Number(position) || 0),
      videoId: String(state.currentVideoId),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid,
      eventId: `${state.uid}_${now}_${++state.playbackActionSeq}_${Math.random().toString(36).slice(2)}`,
      playing: playing === true
    };
  }


  async function roomAuthorityWriteV14(action, position, playing) {
    if (!roomAuthorityCanControlV14()) return;

    const ref = db.ref(`rooms/${state.roomId}/playbackEvent`);
    const event = roomAuthorityEventV14(action, position, playing);
    const localNow = Date.now();

    state.playbackTimeline = {
      videoId: String(state.currentVideoId),
      position: Number(event.position),
      playing: event.playing === true,
      updatedAt: localNow,
      eventId: event.eventId,
      action: event.action,
      updatedBy: state.uid
    };
    state.playbackLastRemoteEventId = event.eventId;
    state.playbackLastRemoteUpdatedAt = localNow;

    await ref.set(event);
  }


  async function roomAuthorityApplyV14(event, force = true) {
    if (!roomAuthorityCanControlV14() || !event) return;
    if (String(event.videoId || "") !== String(state.currentVideoId || "")) return;

    const expected = roomAuthorityExpectedV14(event);
    if (expected === null) return;

    const localPosition = await asyncCurrentPosition();
    const localPlaying = await asyncIsPlaying();
    const roomPlaying = event.playing === true;

    state.playbackApplyingRemote = true;
    state.playbackPendingRecovery = true;
    state.playbackIgnoreStateChanges = 20;
    state.playbackIgnoreStateUntil = Date.now() + 5000;
    state.playbackReadyAt = Date.now() + 600;

    try {
      if (force || Math.abs(localPosition - expected) > 0.85) {
        await applyPlayerPosition(expected);
      }

      if (roomPlaying !== localPlaying) {
        if (roomPlaying) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      }

      state.playbackLastPosition = expected;
      state.playbackLastPlaying = roomPlaying;
      state.playbackLastObservedPosition = expected;
      state.playbackLastPlayerState = roomPlaying ? "playing" : "paused";
    } catch (error) {
      console.warn("房間時間軸套用失敗:", error);
    } finally {
      state.playbackApplyingRemote = false;
      state.playbackPendingRecovery = false;
    }
  }


  async function roomAuthorityApplyLatestV14(force = true) {
    if (!roomAuthorityCanControlV14()) return;

    try {
      let event = await roomAuthorityReadV14();

      if (!event) {
        const currentPosition = await asyncCurrentPosition().catch(() => 0);
        const currentPlaying = await asyncIsPlaying().catch(() => false);
        await roomAuthorityWriteV14(
          currentPlaying ? "play" : "pause",
          Number.isFinite(currentPosition) ? currentPosition : 0,
          currentPlaying
        );
        event = await roomAuthorityReadV14();
      }

      if (event) {
        await roomAuthorityApplyV14(event, force);
      }
    } catch (error) {
      console.warn("房間最新播放狀態讀取失敗:", error);
    }
  }


  async function roomAuthorityCommandV14(action, requestedPosition = null) {
    if (!roomAuthorityCanControlV14() || state.roomAuthorityBusyV14) return;

    state.roomAuthorityBusyV14 = true;
    state.playbackUserActionUntil = Date.now() + 5000;
    state.playbackUserActionKind = action;
    state.playbackLocalIntentAt = Date.now();
    state.playbackIgnoreStateChanges = 20;
    state.playbackIgnoreStateUntil = Date.now() + 5000;

    try {
      let event = await roomAuthorityReadV14();

      if (!event) {
        const position = await asyncCurrentPosition().catch(() => 0);
        const playing = await asyncIsPlaying().catch(() => false);
        event = {
          position: Number.isFinite(position) ? position : 0,
          playing,
          videoId: String(state.currentVideoId)
        };
      }

      const sharedPosition = roomAuthorityExpectedV14(event);
      if (sharedPosition === null) return;

      let targetPosition = sharedPosition;
      let targetPlaying = event.playing === true;

      if (action === "pause") {
        targetPosition = sharedPosition;
        targetPlaying = false;
      } else if (action === "play") {
        targetPosition = sharedPosition;
        targetPlaying = true;
      } else if (action === "seek") {
        const value = Number(requestedPosition);
        if (!Number.isFinite(value)) return;
        targetPosition = Math.max(0, value);
        targetPlaying = event.playing === true;
      }

      if (action === "pause") {
        await pausePlayer();
      } else if (action === "play") {
        await applyPlayerPosition(targetPosition).catch(() => {});
        await playPlayer();
      } else if (action === "seek") {
        await applyPlayerPosition(targetPosition);
        if (targetPlaying) {
          await playPlayer().catch(() => {});
        } else {
          await pausePlayer().catch(() => {});
        }
      }

      await roomAuthorityWriteV14(action, targetPosition, targetPlaying);
      state.playbackLastPosition = targetPosition;
      state.playbackLastPlaying = targetPlaying;
    } catch (error) {
      console.warn("房間播放指令失敗:", error);
    } finally {
      setTimeout(() => {
        state.roomAuthorityBusyV14 = false;
      }, 120);
    }
  }


  function roomAuthorityReplaceButtonV14(id, handler) {
    const button = $(id);
    if (!button) return;

    const replacement = button.cloneNode(true);
    button.replaceWith(replacement);
    replacement.addEventListener("click", handler);
  }


  function roomAuthorityInstallControlsV14() {
    roomAuthorityReplaceButtonV14("playPauseBtn", async () => {
      if (!roomAuthorityCanControlV14()) return;

      try {
        const event = await roomAuthorityReadV14();
        if (event?.playing === true) {
          await roomAuthorityCommandV14("pause");
        } else {
          await roomAuthorityCommandV14("play");
        }
      } catch (error) {
        console.warn("共享播放按鈕失敗:", error);
      }
    });

    roomAuthorityReplaceButtonV14("backBtn", async () => {
      const event = await roomAuthorityReadV14();
      const position = roomAuthorityExpectedV14(event);
      if (position !== null) {
        await roomAuthorityCommandV14("seek", Math.max(0, position - 10));
      }
    });

    roomAuthorityReplaceButtonV14("forwardBtn", async () => {
      const event = await roomAuthorityReadV14();
      const position = roomAuthorityExpectedV14(event);
      if (position !== null) {
        await roomAuthorityCommandV14("seek", position + 10);
      }
    });
  }


  async function roomAuthorityObserveYoutubeStateV14(data) {
    if (
      !state.roomAuthorityV14 ||
      !roomAuthorityCanControlV14() ||
      document.visibilityState !== "visible" ||
      state.playbackApplyingRemote ||
      Date.now() < Number(state.playbackIgnoreStateUntil || 0)
    ) {
      return;
    }

    const now = Date.now();

    if (
      state.roomAuthorityLastNativeStateV14 === data &&
      now - Number(state.roomAuthorityLastNativeStateAtV14 || 0) < 500
    ) {
      return;
    }

    state.roomAuthorityLastNativeStateV14 = data;
    state.roomAuthorityLastNativeStateAtV14 = now;

    clearTimeout(state.roomAuthorityLocalStateTimerV14);

    state.roomAuthorityLocalStateTimerV14 = setTimeout(async () => {
      if (
        document.visibilityState !== "visible" ||
        state.playbackApplyingRemote ||
        Date.now() < Number(state.playbackIgnoreStateUntil || 0)
      ) {
        return;
      }

      try {
        const event = await roomAuthorityReadV14();
        if (!event) return;

        const roomPlaying = event.playing === true;
        const localPlaying = await asyncIsPlaying();

        if (data === YT.PlayerState.PAUSED && roomPlaying && !localPlaying) {
          const localPosition = await asyncCurrentPosition();
          if (Number.isFinite(localPosition)) {
            await roomAuthorityCommandV14("pause", localPosition);
          }
        } else if (data === YT.PlayerState.PLAYING && !roomPlaying && localPlaying) {
          await roomAuthorityCommandV14("play");
        }
      } catch (error) {
        console.warn("本機播放器狀態同步失敗:", error);
      }
    }, 450);
  }


  function roomAuthorityStartObserverV14() {
    clearInterval(state.roomAuthorityTimerV14);

    state.roomAuthorityTimerV14 = setInterval(async () => {
      if (
        state.roomAuthorityBusyV14 ||
        !roomAuthorityCanControlV14() ||
        state.playbackApplyingRemote
      ) {
        return;
      }

      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const event = await roomAuthorityReadV14();
        if (!event) return;

        const expected = roomAuthorityExpectedV14(event);
        if (expected === null) return;

        const position = await asyncCurrentPosition();
        const playing = await asyncIsPlaying();
        const roomPlaying = event.playing === true;

        if (
          Math.abs(position - expected) > 1.35 ||
          roomPlaying !== playing
        ) {
          await roomAuthorityApplyV14(event, false);
        }

        state.playbackLastPosition = expected;
        state.playbackLastPlaying = roomPlaying;
        state.playbackLastObservedPosition = position;
      } catch (error) {
        console.warn("房間時間軸校正失敗:", error);
      }
    }, 500);
  }


  function roomAuthorityRecoverV14() {
    clearTimeout(state.roomAuthorityRecoveryTimerV14);

    state.roomAuthorityRecoveryTimerV14 = setTimeout(async () => {
      if (!roomAuthorityCanControlV14()) return;

      state.playbackPendingRecovery = true;
      try {
        await roomAuthorityApplyLatestV14(true);
      } finally {
        state.playbackPendingRecovery = false;
      }
    }, 350);
  }


  async function roomAuthoritySeekFromRangeV14(value) {
    const position = Number(value);
    if (Number.isFinite(position)) {
      await roomAuthorityCommandV14("seek", position);
    }
  }


  roomAuthorityInstallControlsV14();
  roomAuthorityStartObserverV14();
  setTimeout(() => roomAuthorityApplyLatestV14(true), 400);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      roomAuthorityRecoverV14();
    }
  });

  window.addEventListener("pageshow", roomAuthorityRecoverV14);

'''

if 'ROOM AUTHORITY PLAYBACK V14' in patch and marker not in text:
    tail = text.rfind("\n})();")
    if tail < 0:
        tail = text.rfind("})();")
    if tail < 0:
        raise SystemExit("IIFE tail not found")
    text = text[:tail] + patch + text[tail:]

old = '''                  if (\n                    state.roomAuthorityV12 &&\n                    (data === YT.PlayerState.PLAYING || data === YT.PlayerState.PAUSED)\n                  ) {\n                    updateTimeUI();\n                    return;\n                  }'''
new = '''                  if (\n                    state.roomAuthorityV12 &&\n                    (data === YT.PlayerState.PLAYING || data === YT.PlayerState.PAUSED)\n                  ) {\n                    updateTimeUI();\n                    if (state.roomAuthorityV14) {\n                      void roomAuthorityObserveYoutubeStateV14(data);\n                    }\n                    return;\n                  }'''

if old in text:
    text = text.replace(old, new, 1)
else:
    print("V13 callback bridge already patched or not found")

path.write_text(text, encoding="utf-8")
print("installed room authority playback v14")
