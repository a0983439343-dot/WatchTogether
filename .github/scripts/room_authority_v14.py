from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")

# Remove older duplicated playback implementations so only V15 remains.
legacy_start = text.find("  /*\n   * =========================================================\n   * SHARED ROOM TIMELINE PLAYBACK SYNC\n")
legacy_end_marker = "  /*\n   * =========================================================\n   * ROOM UI\n"
if legacy_start >= 0:
    legacy_end = text.find(legacy_end_marker, legacy_start)
    if legacy_end < 0:
        raise SystemExit("legacy playback section end marker not found")
    text = text[:legacy_start] + text[legacy_end:]

for marker in (
    "  /*\n     * =========================================================\n     * ROOM AUTHORITY PLAYBACK V12",
    "  /* =========================================================\n     ROOM AUTHORITY PLAYBACK V12",
):
    authority_start = text.find(marker)
    if authority_start >= 0:
        tail = text.rfind("\n})();")
        if tail < authority_start:
            raise SystemExit("IIFE tail is before authority section")
        text = text[:authority_start] + text[tail:]
        break

# Make YouTube native PLAYING/PAUSED callbacks passive. They are not room
# commands because ads, buffering and background recovery can produce them.
old_callback = '''                  if (\n                    state.roomAuthorityV12 &&\n                    (data === YT.PlayerState.PLAYING || data === YT.PlayerState.PAUSED)\n                  ) {\n                    updateTimeUI();\n                    if (state.roomAuthorityV14) {\n                      void roomAuthorityObserveYoutubeStateV14(data);\n                    }\n                    return;\n                  }'''
new_callback = '''                  if (\n                    state.roomAuthorityV15 &&\n                    (data === YT.PlayerState.PLAYING || data === YT.PlayerState.PAUSED)\n                  ) {\n                    updateTimeUI();\n                    void roomAuthorityObserveYoutubeStateV15(data);\n                    return;\n                  }'''
if old_callback in text:
    text = text.replace(old_callback, new_callback, 1)
else:
    fallback = '''                  if (data === YT.PlayerState.PLAYING || data === YT.PlayerState.PAUSED) {\n                    updateTimeUI();\n                    return;\n                  }'''
    if fallback in text:
        text = text.replace(fallback, new_callback, 1)

# Remove eager YouTube autoplay/owner-publish from onReady and let the room
# timeline decide whether this player should play or pause.
old_autoplay = '''                  if (\n                    autoplay &&\n                    state.player ===\n                      event.target\n                  ) {\n                    try {\n                      event.target.mute();\n                      event.target.playVideo();\n                    } catch (_) {}\n                  }\n\n                  forceYoutubeVisible();\n\n                  startLocalTimeUpdate();\n\n                  if (\n                    state.isOwner &&\n                    autoplay &&\n                    state.player === event.target\n                  ) {\n                    setTimeout(async () => {\n                      try {\n                        if (\n                          state.playerReady &&\n                          state.player === event.target &&\n                          state.currentVideoId === videoId\n                        ) {\n                          await publishPlaybackEvent(\n                            "play",\n                            await asyncCurrentPosition(),\n                            true\n                          );\n                        }\n                      } catch (error) {\n                        console.warn("新影片播放狀態建立失敗:", error);\n                      }\n                    }, 450);\n                  }\n\n                  setTimeout(async () => {\n                    try {\n                      await applyLatestRoomPlaybackState(true);\n                      startPlaybackSeekDetector();\n                    } catch (error) {\n                      console.warn("播放器就緒後同步失敗:", error);\n                    }\n                  }, 250);'''
new_autoplay = '''                  forceYoutubeVisible();\n\n                  startLocalTimeUpdate();\n\n                  setTimeout(async () => {\n                    try {\n                      await roomAuthorityInitializeVideoV15(autoplay && state.isOwner);\n                      startPlaybackSeekDetector();\n                    } catch (error) {\n                      console.warn("播放器就緒後同步失敗:", error);\n                    }\n                  }, 250);'''
if old_autoplay in text:
    text = text.replace(old_autoplay, new_autoplay, 1)
else:
    print("onReady autoplay block already changed")

new_sync = r'''

  /* =========================================================
     ROOM AUTHORITY PLAYBACK V15
     =========================================================
     One shared Firebase timeline. No participant is a master.
     ========================================================= */

  state.roomAuthorityV15 = true;
  state.roomAuthorityBusyV15 = false;
  state.roomAuthorityTimerV15 = null;
  state.roomAuthorityRecoveryTimerV15 = null;
  state.roomAuthorityLocalStateTimerV15 = null;
  state.roomAuthorityLastNativeStateV15 = null;
  state.roomAuthorityLastNativeStateAtV15 = 0;
  state.roomAuthorityLastObservedPositionV15 = null;
  state.roomAuthorityAdGraceUntilV15 = 0;
  state.roomAuthorityApplyingV15 = false;

  function roomAuthorityNowV15() {
    return typeof serverNow === "function" ? Number(serverNow()) : Date.now();
  }

  function roomAuthorityExpectedV15(event, now = roomAuthorityNowV15()) {
    if (!event) return null;
    const base = Number(event.position);
    if (!Number.isFinite(base)) return null;
    if (event.playing !== true) return Math.max(0, base);
    const updatedAt = Number(event.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return Math.max(0, base);
    return Math.max(0, base + Math.min(7200, Math.max(0, (now - updatedAt) / 1000)));
  }

  function roomAuthorityRememberV15(event) {
    if (!event || !event.eventId) return false;
    const incoming = Number(event.updatedAt || 0);
    const current = Number(state.playbackTimeline?.updatedAt || 0);
    if (incoming > 0 && current > 0 && incoming < current) return false;
    state.playbackTimeline = {
      videoId: String(event.videoId || ""),
      position: Math.max(0, Number(event.position) || 0),
      playing: event.playing === true,
      updatedAt: incoming || roomAuthorityNowV15(),
      eventId: String(event.eventId),
      action: event.action || "",
      updatedBy: event.updatedBy || ""
    };
    state.playbackRemoteEvent = state.playbackTimeline;
    return true;
  }

  function playbackSyncRef() {
    if (!db || !state.roomId) return null;
    return db.ref(`rooms/${state.roomId}/playbackEvent`);
  }

  async function roomAuthorityReadV15() {
    const ref = playbackSyncRef();
    if (!ref || !state.currentVideoId) return null;
    const snapshot = await ref.once("value");
    const event = snapshot.val();
    if (!event || String(event.videoId || "") !== String(state.currentVideoId || "")) return null;
    roomAuthorityRememberV15(event);
    return event;
  }

  function roomAuthorityCanRunV15() {
    return Boolean(
      db && state.roomId && state.currentVideoId && state.player &&
      state.playerReady && state.playerType === "youtube"
    );
  }

  function roomAuthorityEventV15(action, position, playing) {
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

  async function roomAuthorityWriteV15(action, position, playing) {
    if (!state.uid || !state.roomId || !state.currentVideoId || !db) return null;
    const ref = playbackSyncRef();
    if (!ref) return null;
    const event = roomAuthorityEventV15(action, position, playing);
    const localNow = roomAuthorityNowV15();
    roomAuthorityRememberV15({ ...event, updatedAt: localNow });
    state.playbackLastRemoteEventId = event.eventId;
    state.playbackLastRemoteUpdatedAt = localNow;
    await ref.set(event);
    return event;
  }

  async function roomAuthorityForcePlayingV15(wantPlaying, attempts = 12) {
    for (let index = 0; index < attempts; index += 1) {
      if (!roomAuthorityCanRunV15()) return;
      const current = await asyncIsPlaying().catch(() => null);
      if (current === wantPlaying) return;
      try {
        if (wantPlaying) await playPlayer();
        else await pausePlayer();
      } catch (_) {}
      if (index + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 180));
    }
  }

  async function roomAuthorityApplyV15(event, force = false) {
    if (!roomAuthorityCanRunV15() || !event) return;
    if (String(event.videoId || "") !== String(state.currentVideoId || "")) return;
    const expected = roomAuthorityExpectedV15(event);
    if (expected === null) return;

    state.roomAuthorityApplyingV15 = true;
    state.playbackApplyingRemote = true;
    state.playbackPendingRecovery = true;
    state.playbackIgnoreStateChanges = 30;
    state.playbackIgnoreStateUntil = Date.now() + 6000;
    state.playbackReadyAt = Date.now() + 500;

    try {
      const localPosition = await asyncCurrentPosition();
      const localPlaying = await asyncIsPlaying();
      const wantPlaying = event.playing === true;

      if (force || Math.abs(localPosition - expected) > 0.80) {
        await applyPlayerPosition(expected);
      }

      if (localPlaying !== wantPlaying) {
        await roomAuthorityForcePlayingV15(wantPlaying, wantPlaying ? 10 : 12);
      }

      state.playbackLastPosition = expected;
      state.playbackLastPlaying = wantPlaying;
      state.playbackLastObservedPosition = await asyncCurrentPosition().catch(() => expected);
      state.roomAuthorityLastObservedPositionV15 = state.playbackLastObservedPosition;

      if ($("syncStatus")) $("syncStatus").textContent = `已同步 ${formatTime(expected)}`;
    } catch (error) {
      console.warn("房間播放狀態套用失敗:", error);
    } finally {
      state.roomAuthorityApplyingV15 = false;
      state.playbackApplyingRemote = false;
      state.playbackPendingRecovery = false;
    }
  }

  async function roomAuthorityApplyLatestV15(force = true) {
    if (!roomAuthorityCanRunV15()) return;
    try {
      const event = await roomAuthorityReadV15();
      if (event) await roomAuthorityApplyV15(event, force);
    } catch (error) {
      console.warn("讀取房間播放時間軸失敗:", error);
    }
  }

  async function roomAuthorityCommandV15(action, requestedPosition = null) {
    if (!roomAuthorityCanRunV15() || state.roomAuthorityBusyV15) return;

    state.roomAuthorityBusyV15 = true;
    state.playbackUserActionUntil = Date.now() + 5000;
    state.playbackUserActionKind = action;
    state.playbackLocalIntentAt = Date.now();
    state.playbackIgnoreStateChanges = 30;
    state.playbackIgnoreStateUntil = Date.now() + 6000;

    try {
      const event = await roomAuthorityReadV15();
      if (!event) return;

      const sharedPosition = roomAuthorityExpectedV15(event);
      if (sharedPosition === null) return;

      let targetPosition = sharedPosition;
      let targetPlaying = event.playing === true;

      if (action === "pause") {
        targetPlaying = false;
      } else if (action === "play") {
        targetPlaying = true;
      } else if (action === "seek") {
        const value = Number(requestedPosition);
        if (!Number.isFinite(value)) return;
        targetPosition = Math.max(0, value);
      } else {
        return;
      }

      if (action === "pause") {
        await pausePlayer();
      } else if (action === "play") {
        await applyPlayerPosition(targetPosition);
        await playPlayer();
      } else {
        await applyPlayerPosition(targetPosition);
        if (targetPlaying) await playPlayer();
        else await pausePlayer();
      }

      await roomAuthorityWriteV15(action, targetPosition, targetPlaying);
      state.playbackLastPosition = targetPosition;
      state.playbackLastPlaying = targetPlaying;
    } catch (error) {
      console.warn("房間播放指令失敗:", error);
    } finally {
      setTimeout(() => { state.roomAuthorityBusyV15 = false; }, 150);
    }
  }

  async function roomAuthorityInitializeVideoV15(ownerAutoplay) {
    if (!roomAuthorityCanRunV15()) return;

    try {
      const existing = await roomAuthorityReadV15();

      if (existing) {
        await roomAuthorityApplyV15(existing, true);
        return;
      }

      if (ownerAutoplay && state.isOwner) {
        await roomAuthorityWriteV15("play", 0, true);
        const created = await roomAuthorityReadV15();
        if (created) await roomAuthorityApplyV15(created, true);
      } else {
        await pausePlayer();
      }
    } catch (error) {
      console.warn("新影片房間時間軸初始化失敗:", error);
    }
  }

  async function roomAuthorityObserveYoutubeStateV15(data) {
    if (
      !roomAuthorityCanRunV15() ||
      state.roomAuthorityApplyingV15 ||
      state.playbackApplyingRemote ||
      state.playbackPendingRecovery ||
      document.visibilityState !== "visible"
    ) return;

    const now = Date.now();
    if (
      state.roomAuthorityLastNativeStateV15 === data &&
      now - Number(state.roomAuthorityLastNativeStateAtV15 || 0) < 500
    ) return;

    state.roomAuthorityLastNativeStateV15 = data;
    state.roomAuthorityLastNativeStateAtV15 = now;

    clearTimeout(state.roomAuthorityLocalStateTimerV15);
    state.roomAuthorityLocalStateTimerV15 = setTimeout(async () => {
      if (!roomAuthorityCanRunV15() || state.roomAuthorityApplyingV15 || state.playbackApplyingRemote) return;
      try {
        const event = await roomAuthorityReadV15();
        if (!event) return;
        if ((await asyncIsPlaying()) !== (event.playing === true)) {
          await roomAuthorityApplyV15(event, false);
        }
      } catch (error) {
        console.warn("YouTube 狀態觀察失敗:", error);
      }
    }, 550);
  }

  async function roomAuthorityObserverTickV15() {
    if (
      state.roomAuthorityBusyV15 ||
      state.roomAuthorityApplyingV15 ||
      !roomAuthorityCanRunV15() ||
      document.visibilityState !== "visible"
    ) return;

    const event = await roomAuthorityReadV15();
    if (!event) return;

    const expected = roomAuthorityExpectedV15(event);
    if (expected === null) return;

    const position = await asyncCurrentPosition();
    const playing = await asyncIsPlaying();
    const roomPlaying = event.playing === true;
    const now = Date.now();
    const previous = Number(state.roomAuthorityLastObservedPositionV15);

    /* Detect an ad/buffering discontinuity. Never feed it back into Firebase. */
    if (
      roomPlaying &&
      Number.isFinite(previous) &&
      Number.isFinite(position) &&
      position < previous - 2.0 &&
      now - Number(state.playbackLocalIntentAt || 0) > 1000
    ) {
      state.roomAuthorityAdGraceUntilV15 = now + 45000;
    }

    /* Also tolerate a local content-time stall while the shared room clock keeps moving. */
    if (
      roomPlaying &&
      playing &&
      Number.isFinite(previous) &&
      Number.isFinite(position) &&
      now - Number(state.playbackLocalIntentAt || 0) > 1500 &&
      position <= previous + 0.08 &&
      expected - position > 1.35
    ) {
      state.roomAuthorityAdGraceUntilV15 = Math.max(
        Number(state.roomAuthorityAdGraceUntilV15 || 0),
        now + 45000
      );
    }

    state.roomAuthorityLastObservedPositionV15 = position;
    state.playbackLastObservedPosition = position;

    if (
      roomPlaying &&
      playing &&
      now < Number(state.roomAuthorityAdGraceUntilV15 || 0)
    ) return;

    const drift = Math.abs(position - expected);
    if (drift > 1.35 || roomPlaying !== playing) {
      await roomAuthorityApplyV15(event, false);
    }
  }

  function roomAuthorityStartObserverV15() {
    clearInterval(state.roomAuthorityTimerV15);
    state.roomAuthorityTimerV15 = setInterval(() => {
      void roomAuthorityObserverTickV15().catch((error) => console.warn("房間播放校正失敗:", error));
    }, 650);
  }

  function roomAuthorityRecoverV15() {
    clearTimeout(state.roomAuthorityRecoveryTimerV15);
    state.roomAuthorityRecoveryTimerV15 = setTimeout(() => {
      void roomAuthorityApplyLatestV15(true);
    }, 400);
  }

  function roomAuthorityInstallControlsV15() {
    roomAuthorityRoomButtonV15("playPauseBtn", async () => {
      const event = await roomAuthorityReadV15();
      if (event) await roomAuthorityCommandV15(event.playing === true ? "pause" : "play");
    });

    roomAuthorityRoomButtonV15("backBtn", async () => {
      const event = await roomAuthorityReadV15();
      const position = event ? roomAuthorityExpectedV15(event) : null;
      if (position !== null) await roomAuthorityCommandV15("seek", Math.max(0, position - 10));
    });

    roomAuthorityRoomButtonV15("forwardBtn", async () => {
      const event = await roomAuthorityReadV15();
      const position = event ? roomAuthorityExpectedV15(event) : null;
      if (position !== null) await roomAuthorityCommandV15("seek", position + 10);
    });
  }

  function roomAuthorityRoomButtonV15(id, handler) {
    const oldButton = $(id);
    if (!oldButton) return;
    const replacement = oldButton.cloneNode(true);
    oldButton.replaceWith(replacement);
    replacement.addEventListener("click", handler);
  }

  /* Compatibility functions used by the existing room lifecycle. */
  function handleRemotePlaybackSnapshot(snapshot) {
    const event = snapshot?.val?.() || null;
    if (!event || !event.eventId) return;
    if (!roomAuthorityRememberV15(event)) return;
    if (event.updatedBy === state.uid) return;
    if (String(event.videoId || "") !== String(state.currentVideoId || "")) return;
    void roomAuthorityApplyV15(event, false);
  }

  function attachPlaybackSyncListener() {
    if (!state.roomRef || state.playbackListenerAttached) return;
    const ref = playbackSyncRef();
    if (!ref) return;
    ref.on("value", handleRemotePlaybackSnapshot);
    state.playbackListenerAttached = true;
  }

  function stopPlaybackSeekDetector() {
    clearInterval(state.playbackSeekTimer);
    state.playbackSeekTimer = null;
    clearInterval(state.roomAuthorityTimerV15);
    state.roomAuthorityTimerV15 = null;
  }

  function startPlaybackSeekDetector() {
    if (!state.roomAuthorityTimerV15) roomAuthorityStartObserverV15();
  }

  function recoverPlaybackAfterPageResume() {
    roomAuthorityRecoverV15();
  }

  async function applyLatestRoomPlaybackState(force = true) {
    await roomAuthorityApplyLatestV15(force);
  }

  async function publishPlaybackEvent(action, position = null, explicitPlaying = undefined) {
    if (!roomAuthorityCanRunV15()) return;
    let targetPosition = Number(position);
    if (!Number.isFinite(targetPosition)) {
      const event = await roomAuthorityReadV15();
      targetPosition = event ? roomAuthorityExpectedV15(event) : await asyncCurrentPosition();
    }
    if (!Number.isFinite(targetPosition)) return;
    const playing = typeof explicitPlaying === "boolean"
      ? explicitPlaying
      : action === "pause" ? false : action === "play" ? true : await asyncIsPlaying();
    await roomAuthorityWriteV15(
      action === "pause" ? "pause" : action === "seek" ? "seek" : "play",
      targetPosition,
      playing
    );
  }

  roomAuthorityInstallControlsV15();
  roomAuthorityStartObserverV15();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") roomAuthorityRecoverV15();
  });

  window.addEventListener("pageshow", roomAuthorityRecoverV15);
'''

tail = text.rfind("\n})();")
if tail < 0:
    raise SystemExit("IIFE tail not found")
text = text[:tail] + new_sync + text[tail:]
path.write_text(text, encoding="utf-8")
print("installed single room timeline authority v15")
