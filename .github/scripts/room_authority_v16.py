from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")

start = text.find("  /* =========================================================\n     ROOM AUTHORITY PLAYBACK V15")
if start < 0:
    raise SystemExit("V15 playback authority section not found")
tail = text.rfind("\n})();")
if tail < start:
    raise SystemExit("IIFE tail is before V15 section")

new_sync = r'''

  /* =========================================================
     ROOM AUTHORITY PLAYBACK V16
     =========================================================
     One shared room timeline. No participant is a playback master.

     Firebase stores only:
       videoId + position + updatedAt + playing + eventId

     A user's button/seek action writes a room command.
     Native YouTube PLAYING/PAUSED callbacks are observations only.
     They NEVER write playback commands, because ads/buffering/background
     recovery can produce those callbacks without a user intent.
     ========================================================= */

  state.roomAuthorityV16 = true;
  state.roomAuthorityBusyV16 = false;
  state.roomAuthorityTimerV16 = null;
  state.roomAuthorityRecoveryTimerV16 = null;
  state.roomAuthorityLocalStateTimerV16 = null;
  state.roomAuthorityApplyingV16 = false;
  state.roomAuthorityLastEventIdV16 = null;
  state.roomAuthorityLastUpdatedAtV16 = 0;
  state.roomAuthorityLastObservedPositionV16 = null;
  state.roomAuthorityLastNativeStateV16 = null;
  state.roomAuthorityLastNativeStateAtV16 = 0;
  state.roomAuthorityAdGraceUntilV16 = 0;
  state.roomAuthorityLocalCommandAtV16 = 0;
  state.roomAuthorityLocalCommandKindV16 = "";
  state.roomAuthorityCommandSeqV16 = 0;
  state.roomAuthorityRecoveryTokenV16 = 0;

  function roomAuthorityNowV16() {
    return typeof serverNow === "function"
      ? Number(serverNow())
      : Date.now();
  }

  function roomAuthorityExpectedV16(event, now = roomAuthorityNowV16()) {
    if (!event) return null;

    const base = Number(event.position);
    if (!Number.isFinite(base)) return null;

    if (event.playing !== true) {
      return Math.max(0, base);
    }

    const updatedAt = Number(event.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
      return Math.max(0, base);
    }

    const elapsed = Math.max(0, (now - updatedAt) / 1000);
    return Math.max(0, base + Math.min(7200, elapsed));
  }

  function roomAuthorityRememberV16(event) {
    if (!event || !event.eventId) return false;

    const incomingUpdatedAt = Number(event.updatedAt || 0);
    const currentUpdatedAt = Number(state.roomAuthorityLastUpdatedAtV16 || 0);

    if (
      incomingUpdatedAt > 0 &&
      currentUpdatedAt > 0 &&
      incomingUpdatedAt < currentUpdatedAt
    ) {
      return false;
    }

    const normalized = {
      videoId: String(event.videoId || ""),
      position: Math.max(0, Number(event.position) || 0),
      playing: event.playing === true,
      updatedAt: incomingUpdatedAt || roomAuthorityNowV16(),
      eventId: String(event.eventId),
      action: String(event.action || ""),
      updatedBy: String(event.updatedBy || "")
    };

    state.playbackTimeline = normalized;
    state.playbackRemoteEvent = normalized;
    state.roomAuthorityLastEventIdV16 = normalized.eventId;
    state.roomAuthorityLastUpdatedAtV16 = normalized.updatedAt;
    state.playbackLastRemoteEventId = normalized.eventId;
    state.playbackLastRemoteUpdatedAt = normalized.updatedAt;

    return true;
  }

  function playbackSyncRef() {
    if (!db || !state.roomId) return null;
    return db.ref(`rooms/${state.roomId}/playbackEvent`);
  }

  function roomAuthorityCanRunV16() {
    return Boolean(
      db &&
      state.roomId &&
      state.currentVideoId &&
      state.player &&
      state.playerReady &&
      state.playerType === "youtube"
    );
  }

  async function roomAuthorityReadV16() {
    const ref = playbackSyncRef();
    if (!ref || !state.currentVideoId) return null;

    const snapshot = await ref.once("value");
    const event = snapshot.val();

    if (
      !event ||
      String(event.videoId || "") !== String(state.currentVideoId || "")
    ) {
      return null;
    }

    roomAuthorityRememberV16(event);
    return event;
  }

  function roomAuthorityCreateEventV16(action, position, playing) {
    const now = Date.now();
    const seq = ++state.roomAuthorityCommandSeqV16;

    return {
      action,
      position: Math.max(0, Number(position) || 0),
      videoId: String(state.currentVideoId),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid,
      eventId: `${state.uid}_${now}_${seq}_${Math.random().toString(36).slice(2)}`,
      playing: playing === true
    };
  }

  async function roomAuthorityWriteV16(action, position, playing) {
    if (
      !state.uid ||
      !state.roomId ||
      !state.currentVideoId ||
      !db
    ) {
      return null;
    }

    const ref = playbackSyncRef();
    if (!ref) return null;

    const event = roomAuthorityCreateEventV16(
      action,
      position,
      playing
    );

    const localNow = roomAuthorityNowV16();
    roomAuthorityRememberV16({
      ...event,
      updatedAt: localNow
    });

    state.playbackLastPosition = Number(position) || 0;
    state.playbackLastPlaying = playing === true;

    await ref.set(event);
    return event;
  }

  async function roomAuthorityForceStateV16(wantPlaying, attempts = 15) {
    for (let index = 0; index < attempts; index += 1) {
      if (!roomAuthorityCanRunV16()) return false;

      const current = await asyncIsPlaying().catch(() => null);
      if (current === wantPlaying) return true;

      try {
        if (wantPlaying) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      } catch (_) {}

      if (index + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 160));
      }
    }

    return (await asyncIsPlaying().catch(() => null)) === wantPlaying;
  }

  async function roomAuthorityApplyV16(event, force = false) {
    if (!roomAuthorityCanRunV16() || !event) return;

    if (
      String(event.videoId || "") !==
      String(state.currentVideoId || "")
    ) {
      return;
    }

    const expected = roomAuthorityExpectedV16(event);
    if (expected === null) return;

    state.roomAuthorityApplyingV16 = true;
    state.playbackApplyingRemote = true;
    state.playbackPendingRecovery = true;
    state.playbackIgnoreStateChanges = 50;
    state.playbackIgnoreStateUntil = Date.now() + 8000;
    state.playbackReadyAt = Date.now() + 900;

    try {
      const currentPosition = await asyncCurrentPosition();
      const currentPlaying = await asyncIsPlaying();
      const wantPlaying = event.playing === true;
      const drift = Math.abs(currentPosition - expected);

      if (force || drift > 0.55) {
        await applyPlayerPosition(expected);
      }

      if (currentPlaying !== wantPlaying) {
        await roomAuthorityForceStateV16(
          wantPlaying,
          wantPlaying ? 15 : 18
        );
      }

      state.playbackLastPosition = await asyncCurrentPosition().catch(() => expected);
      state.playbackLastPlaying = await asyncIsPlaying().catch(() => wantPlaying);
      state.playbackLastObservedPosition = state.playbackLastPosition;
      state.roomAuthorityLastObservedPositionV16 = state.playbackLastPosition;

      if ($("syncStatus")) {
        $("syncStatus").textContent = `已同步 ${formatTime(expected)}`;
      }
    } catch (error) {
      console.warn("房間播放狀態套用失敗:", error);
    } finally {
      state.roomAuthorityApplyingV16 = false;
      state.playbackApplyingRemote = false;
      state.playbackPendingRecovery = false;
    }
  }

  async function roomAuthorityApplyLatestV16(force = true) {
    if (!roomAuthorityCanRunV16()) return;

    const token = ++state.roomAuthorityRecoveryTokenV16;

    try {
      const event = await roomAuthorityReadV16();
      if (!event) return;

      if (token !== state.roomAuthorityRecoveryTokenV16) return;
      await roomAuthorityApplyV16(event, force);
    } catch (error) {
      console.warn("讀取房間播放時間軸失敗:", error);
    }
  }

  async function roomAuthorityCommandV16(action, requestedPosition = null) {
    if (
      !roomAuthorityCanRunV16() ||
      state.roomAuthorityBusyV16
    ) {
      return;
    }

    state.roomAuthorityBusyV16 = true;
    state.roomAuthorityLocalCommandAtV16 = Date.now();
    state.roomAuthorityLocalCommandKindV16 = action;
    state.playbackLocalIntentAt = Date.now();
    state.playbackIgnoreStateChanges = 50;
    state.playbackIgnoreStateUntil = Date.now() + 8000;

    try {
      const event = await roomAuthorityReadV16();
      if (!event) return;

      const sharedPosition = roomAuthorityExpectedV16(event);
      if (!Number.isFinite(sharedPosition)) return;

      let targetPosition = sharedPosition;
      let targetPlaying = event.playing === true;

      if (action === "pause") {
        targetPlaying = false;
      } else if (action === "play") {
        targetPlaying = true;
      } else if (action === "seek") {
        const requested = Number(requestedPosition);
        if (!Number.isFinite(requested)) return;
        targetPosition = Math.max(0, requested);
      } else {
        return;
      }

      state.playbackApplyingRemote = true;
      state.roomAuthorityApplyingV16 = true;

      try {
        if (action === "pause") {
          await applyPlayerPosition(targetPosition);
          await roomAuthorityForceStateV16(false, 18);
        } else if (action === "play") {
          await applyPlayerPosition(targetPosition);
          await roomAuthorityForceStateV16(true, 18);
        } else {
          await applyPlayerPosition(targetPosition);
          await roomAuthorityForceStateV16(targetPlaying, 18);
        }
      } finally {
        state.roomAuthorityApplyingV16 = false;
        state.playbackApplyingRemote = false;
      }

      await roomAuthorityWriteV16(
        action,
        targetPosition,
        targetPlaying
      );

      state.playbackLastPosition = targetPosition;
      state.playbackLastPlaying = targetPlaying;
    } catch (error) {
      console.warn("房間播放指令失敗:", error);
    } finally {
      setTimeout(() => {
        state.roomAuthorityBusyV16 = false;
      }, 100);
    }
  }

  async function roomAuthorityInitializeVideoV16(ownerAutoplay) {
    if (!roomAuthorityCanRunV16()) return;

    try {
      const existing = await roomAuthorityReadV16();

      if (existing) {
        await roomAuthorityApplyV16(existing, true);
        return;
      }

      if (ownerAutoplay && state.isOwner) {
        await roomAuthorityWriteV16("play", 0, true);
        const created = await roomAuthorityReadV16();
        if (created) {
          await roomAuthorityApplyV16(created, true);
        }
        return;
      }

      await roomAuthorityForceStateV16(false, 12);
    } catch (error) {
      console.warn("新影片房間時間軸初始化失敗:", error);
    }
  }

  async function roomAuthorityObserveYoutubeStateV16(data) {
    if (
      !roomAuthorityCanRunV16() ||
      state.roomAuthorityApplyingV16 ||
      state.playbackApplyingRemote ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    const now = Date.now();

    if (
      state.roomAuthorityLastNativeStateV16 === data &&
      now - Number(state.roomAuthorityLastNativeStateAtV16 || 0) < 350
    ) {
      return;
    }

    state.roomAuthorityLastNativeStateV16 = data;
    state.roomAuthorityLastNativeStateAtV16 = now;

    /*
     * Native state is observation only.
     * Do not publish it and do not immediately force it back.
     * Ads, buffering and mobile background/resume may all emit PAUSED/PLAYING.
     * The shared Firebase command remains authoritative.
     */
    clearTimeout(state.roomAuthorityLocalStateTimerV16);
    state.roomAuthorityLocalStateTimerV16 = setTimeout(async () => {
      if (
        !roomAuthorityCanRunV16() ||
        state.roomAuthorityApplyingV16 ||
        state.playbackApplyingRemote
      ) {
        return;
      }

      if (
        Date.now() - Number(state.roomAuthorityLocalCommandAtV16 || 0) < 1800
      ) {
        return;
      }

      try {
        const event = await roomAuthorityReadV16();
        if (!event) return;

        const roomPlaying = event.playing === true;
        const localPlaying = await asyncIsPlaying();
        const position = await asyncCurrentPosition();
        const expected = roomAuthorityExpectedV16(event);

        if (!Number.isFinite(expected)) return;

        /*
         * Only a large, persistent content-time discrepancy is corrected here.
         * A brief PAUSED/PLAYING transition is ignored so ads do not become
         * fake room commands.
         */
        if (
          roomPlaying &&
          localPlaying &&
          position < expected - 4
        ) {
          state.roomAuthorityAdGraceUntilV16 = Math.max(
            Number(state.roomAuthorityAdGraceUntilV16 || 0),
            Date.now() + 30000
          );
          return;
        }

        if (
          !roomPlaying &&
          localPlaying &&
          Date.now() >= Number(state.roomAuthorityAdGraceUntilV16 || 0)
        ) {
          await roomAuthorityApplyV16(event, false);
          return;
        }

        if (
          roomPlaying &&
          !localPlaying &&
          Date.now() >= Number(state.roomAuthorityAdGraceUntilV16 || 0)
        ) {
          await roomAuthorityApplyV16(event, false);
        }
      } catch (error) {
        console.warn("YouTube 狀態觀察失敗:", error);
      }
    }, 1200);
  }

  async function roomAuthorityObserverTickV16() {
    if (
      state.roomAuthorityBusyV16 ||
      state.roomAuthorityApplyingV16 ||
      !roomAuthorityCanRunV16() ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    const event = await roomAuthorityReadV16();
    if (!event) return;

    const expected = roomAuthorityExpectedV16(event);
    if (!Number.isFinite(expected)) return;

    const position = await asyncCurrentPosition();
    const playing = await asyncIsPlaying();
    const roomPlaying = event.playing === true;
    const now = Date.now();
    const previous = Number(state.roomAuthorityLastObservedPositionV16);

    const localCommandAge =
      now - Number(state.roomAuthorityLocalCommandAtV16 || 0);

    /* Detect ad/buffering/background discontinuity without writing it to Firebase. */
    if (
      roomPlaying &&
      Number.isFinite(previous) &&
      Number.isFinite(position) &&
      position < previous - 2 &&
      localCommandAge > 1500
    ) {
      state.roomAuthorityAdGraceUntilV16 = Math.max(
        Number(state.roomAuthorityAdGraceUntilV16 || 0),
        now + 45000
      );
    }

    if (
      roomPlaying &&
      Number.isFinite(position) &&
      position + 3 < expected &&
      localCommandAge > 1500
    ) {
      state.roomAuthorityAdGraceUntilV16 = Math.max(
        Number(state.roomAuthorityAdGraceUntilV16 || 0),
        now + 45000
      );
    }

    state.roomAuthorityLastObservedPositionV16 = position;
    state.playbackLastObservedPosition = position;

    const adGrace =
      now < Number(state.roomAuthorityAdGraceUntilV16 || 0);

    /* During a suspected ad, never publish or fight the local player. */
    if (adGrace) {
      return;
    }

    if (roomPlaying && !playing) {
      /* A remote/shared PLAY command must still win once grace is over. */
      await roomAuthorityApplyV16(event, false);
      return;
    }

    if (!roomPlaying && playing) {
      /* A remote/shared PAUSE command always wins. */
      await roomAuthorityApplyV16(event, false);
      return;
    }

    if (
      Date.now() < Number(state.playbackReadyAt || 0) ||
      Date.now() < Number(state.playbackIgnoreStateUntil || 0)
    ) {
      return;
    }

    const drift = Math.abs(position - expected);

    if (drift > 1.15) {
      state.playbackApplyingRemote = true;
      state.roomAuthorityApplyingV16 = true;
      state.playbackPendingRecovery = true;
      state.playbackIgnoreStateChanges = 25;
      state.playbackIgnoreStateUntil = Date.now() + 5000;

      try {
        await applyPlayerPosition(expected);
      } catch (error) {
        console.warn("房間播放位置校正失敗:", error);
      } finally {
        state.roomAuthorityApplyingV16 = false;
        state.playbackApplyingRemote = false;
        state.playbackPendingRecovery = false;
      }
    }
  }

  function roomAuthorityStartObserverV16() {
    clearInterval(state.roomAuthorityTimerV16);
    state.roomAuthorityTimerV16 = setInterval(() => {
      void roomAuthorityObserverTickV16().catch((error) => {
        console.warn("房間播放校正失敗:", error);
      });
    }, 650);
  }

  function roomAuthorityRecoverV16() {
    clearTimeout(state.roomAuthorityRecoveryTimerV16);

    state.roomAuthorityRecoveryTimerV16 = setTimeout(() => {
      if (document.visibilityState && document.visibilityState !== "visible") {
        return;
      }
      void roomAuthorityApplyLatestV16(true);
    }, 450);
  }

  function roomAuthorityInstallControlsV16() {
    roomAuthorityRoomButtonV16("playPauseBtn", async () => {
      const event = await roomAuthorityReadV16();
      if (!event) return;
      await roomAuthorityCommandV16(
        event.playing === true ? "pause" : "play"
      );
    });

    roomAuthorityRoomButtonV16("backBtn", async () => {
      const event = await roomAuthorityReadV16();
      const position = event
        ? roomAuthorityExpectedV16(event)
        : null;
      if (Number.isFinite(position)) {
        await roomAuthorityCommandV16(
          "seek",
          Math.max(0, position - 10)
        );
      }
    });

    roomAuthorityRoomButtonV16("forwardBtn", async () => {
      const event = await roomAuthorityReadV16();
      const position = event
        ? roomAuthorityExpectedV16(event)
        : null;
      if (Number.isFinite(position)) {
        await roomAuthorityCommandV16(
          "seek",
          position + 10
        );
      }
    });
  }

  function roomAuthorityRoomButtonV16(id, handler) {
    const oldButton = $(id);
    if (!oldButton) return;

    const replacement = oldButton.cloneNode(true);
    oldButton.replaceWith(replacement);
    replacement.addEventListener("click", handler);
  }

  function handleRemotePlaybackSnapshot(snapshot) {
    const event = snapshot?.val?.() || null;

    if (!event || !event.eventId) return;
    if (!roomAuthorityRememberV16(event)) return;

    if (
      String(event.videoId || "") !==
      String(state.currentVideoId || "")
    ) {
      return;
    }

    if (event.updatedBy === state.uid) return;

    if (
      state.roomAuthorityLastEventIdV16 ===
      String(event.eventId) &&
      state.playbackLastRemoteEventId === String(event.eventId)
    ) {
      return;
    }

    void roomAuthorityApplyV16(event, false);
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
    clearInterval(state.roomAuthorityTimerV16);
    state.roomAuthorityTimerV16 = null;
    clearTimeout(state.roomAuthorityLocalStateTimerV16);
    state.roomAuthorityLocalStateTimerV16 = null;
  }

  function startPlaybackSeekDetector() {
    if (!state.roomAuthorityTimerV16) {
      roomAuthorityStartObserverV16();
    }
  }

  function recoverPlaybackAfterPageResume() {
    roomAuthorityRecoverV16();
  }

  async function applyLatestRoomPlaybackState(force = true) {
    await roomAuthorityApplyLatestV16(force);
  }

  async function publishPlaybackEvent(
    action,
    position = null,
    explicitPlaying = undefined
  ) {
    if (!roomAuthorityCanRunV16()) return;

    const normalized =
      action === "pause"
        ? "pause"
        : action === "seek"
          ? "seek"
          : "play";

    let targetPosition = Number(position);

    if (!Number.isFinite(targetPosition)) {
      const event = await roomAuthorityReadV16();
      targetPosition = event
        ? roomAuthorityExpectedV16(event)
        : await asyncCurrentPosition();
    }

    if (!Number.isFinite(targetPosition)) return;

    let playing;

    if (normalized === "pause") {
      playing = false;
    } else if (normalized === "play") {
      playing = true;
    } else if (typeof explicitPlaying === "boolean") {
      playing = explicitPlaying;
    } else {
      const event = await roomAuthorityReadV16();
      playing = event
        ? event.playing === true
        : await asyncIsPlaying();
    }

    await roomAuthorityCommandV16(
      normalized,
      targetPosition
    );
  }

  roomAuthorityInstallControlsV16();
  roomAuthorityStartObserverV16();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      roomAuthorityRecoverV16();
    }
  });

  window.addEventListener("pageshow", roomAuthorityRecoverV16);
'''

text = text[:start] + new_sync + text[tail:]

text = text.replace(
    "state.roomAuthorityV15",
    "state.roomAuthorityV16"
)
text = text.replace(
    "roomAuthorityObserveYoutubeStateV15",
    "roomAuthorityObserveYoutubeStateV16"
)
text = text.replace(
    "roomAuthorityInitializeVideoV15",
    "roomAuthorityInitializeVideoV16"
)

text = text.replace(
    "state.roomAuthorityV16 &&\n                    (data === YT.PlayerState.PLAYING || YT.PlayerState.PAUSED)",
    "state.roomAuthorityV16 &&\n                    (data === YT.PlayerState.PLAYING || data === YT.PlayerState.PAUSED)"
)

path.write_text(text, encoding="utf-8")
print("installed room authority playback v16")
