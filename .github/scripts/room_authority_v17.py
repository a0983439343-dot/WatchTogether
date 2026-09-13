from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")

if "ROOM AUTHORITY PLAYBACK V17" in text:
    raise SystemExit("V17 already installed")

tail = text.rfind("\n})();")
if tail < 0:
    raise SystemExit("IIFE tail not found")

patch = r'''

  /* =========================================================
     ROOM AUTHORITY PLAYBACK V17
     ========================================================= */

  state.roomAuthorityV17 = true;
  state.roomAuthorityLastCommandAtV17 = Number(state.roomAuthorityLastCommandAtV17 || 0);
  state.roomAuthorityLastCommandEventIdV17 = state.roomAuthorityLastCommandEventIdV17 || null;
  state.roomAuthorityLastAppliedAtV17 = Number(state.roomAuthorityLastAppliedAtV17 || 0);
  state.roomAuthorityAdGuardUntilV17 = Number(state.roomAuthorityAdGuardUntilV17 || 0);
  state.roomAuthorityLastPositionV17 = null;
  state.roomAuthorityLastPositionAtV17 = 0;
  state.roomAuthorityBusyV17 = false;

  function roomAuthorityCanRunV17() {
    return Boolean(
      db &&
      state.roomId &&
      state.currentVideoId &&
      state.player &&
      state.playerReady &&
      state.playerType === "youtube"
    );
  }

  function roomAuthorityNowV17() {
    if (typeof serverNow === "function") {
      const value = Number(serverNow());
      if (Number.isFinite(value)) return value;
    }
    return Date.now();
  }

  function roomAuthorityExpectedV17(event, now = roomAuthorityNowV17()) {
    if (!event) return null;

    const position = Number(event.position);
    if (!Number.isFinite(position)) return null;

    if (event.playing !== true) {
      return Math.max(0, position);
    }

    const updatedAt = Number(event.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
      return Math.max(0, position);
    }

    const elapsed = Math.max(0, (now - updatedAt) / 1000);
    return Math.max(0, position + Math.min(elapsed, 7200));
  }

  function playbackSyncRef() {
    if (!db || !state.roomId) return null;
    return db.ref(`rooms/${state.roomId}/playbackEvent`);
  }

  function roomAuthorityRememberV17(event) {
    if (!event || !event.eventId) return false;

    const eventId = String(event.eventId);
    const updatedAt = Number(event.updatedAt || 0);
    const current = Number(state.playbackTimeline?.updatedAt || 0);

    if (
      updatedAt > 0 &&
      current > 0 &&
      updatedAt < current
    ) {
      return false;
    }

    const normalized = {
      action: String(event.action || ""),
      position: Math.max(0, Number(event.position) || 0),
      videoId: String(event.videoId || ""),
      updatedAt: updatedAt || roomAuthorityNowV17(),
      updatedBy: String(event.updatedBy || ""),
      eventId,
      playing: event.playing === true
    };

    state.playbackTimeline = normalized;
    state.playbackRemoteEvent = normalized;
    state.playbackLastRemoteEventId = eventId;
    state.playbackLastRemoteUpdatedAt = normalized.updatedAt;
    state.roomAuthorityLastEventIdV16 = eventId;
    state.roomAuthorityLastUpdatedAtV16 = normalized.updatedAt;
    state.roomAuthorityLastCommandEventIdV17 = eventId;

    return true;
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

    roomAuthorityRememberV17(event);
    return event;
  }

  async function roomAuthorityForceStateV17(wantPlaying) {
    const attempts = wantPlaying ? 22 : 24;

    for (let i = 0; i < attempts; i += 1) {
      if (!roomAuthorityCanRunV17()) return false;

      const current = await asyncIsPlaying().catch(() => null);
      if (current === wantPlaying) return true;

      try {
        if (wantPlaying) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      } catch (_) {}

      if (i + 1 < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 140));
      }
    }

    return (await asyncIsPlaying().catch(() => null)) === wantPlaying;
  }

  async function roomAuthorityApplyV16(event, force = false) {
    if (!roomAuthorityCanRunV17() || !event) return;

    if (
      String(event.videoId || "") !== String(state.currentVideoId || "")
    ) {
      return;
    }

    const expected = roomAuthorityExpectedV17(event);
    if (!Number.isFinite(expected)) return;

    const eventId = String(event.eventId || "");
    if (!eventId) return;

    if (
      !force &&
      eventId === String(state.roomAuthorityLastAppliedEventIdV17 || "") &&
      Date.now() - Number(state.roomAuthorityLastAppliedAtV17 || 0) < 900
    ) {
      return;
    }

    state.roomAuthorityLastAppliedEventIdV17 = eventId;
    state.roomAuthorityLastAppliedAtV17 = Date.now();
    state.roomAuthorityLastCommandAtV17 = Date.now();
    state.roomAuthorityAdGuardUntilV17 = Date.now() + 4500;

    state.roomAuthorityApplyingV16 = true;
    state.playbackApplyingRemote = true;
    state.playbackPendingRecovery = true;
    state.playbackIgnoreStateChanges = 100;
    state.playbackIgnoreStateUntil = Date.now() + 10000;
    state.playbackReadyAt = Date.now() + 1000;

    try {
      const before = await asyncCurrentPosition().catch(() => expected);
      const beforePlaying = await asyncIsPlaying().catch(() => event.playing === true);
      const drift = Math.abs(Number(before) - expected);

      if (force || drift > 0.45) {
        await applyPlayerPosition(expected);
      }

      const wantPlaying = event.playing === true;
      if (beforePlaying !== wantPlaying || force) {
        await roomAuthorityForceStateV17(wantPlaying);
      }

      if (!wantPlaying) {
        await roomAuthorityForceStateV17(false);
      }

      state.playbackLastPosition = await asyncCurrentPosition().catch(() => expected);
      state.playbackLastPlaying = await asyncIsPlaying().catch(() => wantPlaying);
      state.roomAuthorityLastPositionV17 = state.playbackLastPosition;
      state.roomAuthorityLastPositionAtV17 = Date.now();

      if ($("syncStatus")) {
        $("syncStatus").textContent = `已同步 ${formatTime(expected)}`;
      }
    } catch (error) {
      console.warn("房間共享時間軸套用失敗:", error);
    } finally {
      state.roomAuthorityApplyingV16 = false;
      state.playbackApplyingRemote = false;
      state.playbackPendingRecovery = false;
    }
  }

  async function roomAuthorityApplyLatestV16(force = true) {
    if (!roomAuthorityCanRunV17()) return;

    try {
      const event = await roomAuthorityReadV16();
      if (!event) return;
      await roomAuthorityApplyV16(event, force);
    } catch (error) {
      console.warn("房間最新時間軸恢復失敗:", error);
    }
  }

  async function roomAuthorityCommandV16(action, requestedPosition = null) {
    if (
      !roomAuthorityCanRunV17() ||
      state.roomAuthorityBusyV17
    ) {
      return;
    }

    const normalizedAction =
      action === "pause" ? "pause" :
      action === "seek" ? "seek" :
      action === "play" ? "play" :
      "";

    if (!normalizedAction) return;

    state.roomAuthorityBusyV17 = true;
    state.roomAuthorityLastCommandAtV17 = Date.now();
    state.playbackLocalIntentAt = Date.now();

    try {
      const currentEvent = await roomAuthorityReadV16();
      if (!currentEvent) return;

      const sharedPosition = roomAuthorityExpectedV17(currentEvent);
      if (!Number.isFinite(sharedPosition)) return;

      let targetPosition = sharedPosition;
      let targetPlaying = currentEvent.playing === true;

      if (normalizedAction === "pause") {
        targetPlaying = false;
      } else if (normalizedAction === "play") {
        targetPlaying = true;
      } else {
        const requested = Number(requestedPosition);
        if (!Number.isFinite(requested)) return;
        targetPosition = Math.max(0, requested);
      }

      const optimisticEvent = {
        action: normalizedAction,
        position: targetPosition,
        videoId: String(state.currentVideoId),
        updatedAt: Date.now(),
        updatedBy: String(state.uid),
        eventId: `${state.uid}_v17_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        playing: targetPlaying
      };

      roomAuthorityRememberV17(optimisticEvent);
      state.roomAuthorityLastCommandAtV17 = Date.now();
      state.roomAuthorityLastAppliedAtV17 = Date.now();
      state.roomAuthorityAdGuardUntilV17 = Date.now() + 4500;

      state.playbackApplyingRemote = true;
      state.roomAuthorityApplyingV16 = true;
      state.playbackIgnoreStateChanges = 100;
      state.playbackIgnoreStateUntil = Date.now() + 10000;

      try {
        await applyPlayerPosition(targetPosition);
        await roomAuthorityForceStateV17(targetPlaying);
      } finally {
        state.roomAuthorityApplyingV16 = false;
        state.playbackApplyingRemote = false;
      }

      const event = {
        action: normalizedAction,
        position: targetPosition,
        videoId: String(state.currentVideoId),
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
        updatedBy: state.uid,
        eventId: `${state.uid}_v17_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        playing: targetPlaying
      };

      const ref = playbackSyncRef();
      if (!ref) return;

      await ref.set(event);

      const localCommitted = {
        ...event,
        updatedAt: roomAuthorityNowV17()
      };
      roomAuthorityRememberV17(localCommitted);
      state.roomAuthorityLastCommandAtV17 = Date.now();
      state.roomAuthorityLastAppliedAtV17 = Date.now();

      if (normalizedAction === "pause") {
        await roomAuthorityForceStateV17(false);
      } else if (normalizedAction === "play") {
        await roomAuthorityForceStateV17(true);
      }
    } catch (error) {
      console.warn("房間共享播放指令失敗:", error);
    } finally {
      setTimeout(() => {
        state.roomAuthorityBusyV17 = false;
      }, 120);
    }
  }

  async function roomAuthorityInitializeVideoV16(ownerAutoplay) {
    if (!roomAuthorityCanRunV17()) return;

    try {
      const event = await roomAuthorityReadV16();

      if (event) {
        await roomAuthorityApplyV16(event, true);
        return;
      }

      if (ownerAutoplay && state.isOwner) {
        const ref = playbackSyncRef();
        if (!ref) return;

        const eventToCreate = {
          action: "play",
          position: 0,
          videoId: String(state.currentVideoId),
          updatedAt: firebase.database.ServerValue.TIMESTAMP,
          updatedBy: state.uid,
          eventId: `${state.uid}_v17_initial_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          playing: true
        };

        await ref.set(eventToCreate);
        const created = await roomAuthorityReadV16();
        if (created) {
          await roomAuthorityApplyV16(created, true);
        }
        return;
      }

      await roomAuthorityForceStateV17(false);
    } catch (error) {
      console.warn("影片房間時間軸初始化失敗:", error);
    }
  }

  async function roomAuthorityObserveYoutubeStateV16(data) {
    state.roomAuthorityLastNativeStateV16 = data;
    state.roomAuthorityLastNativeStateAtV16 = Date.now();
  }

  async function roomAuthorityObserverTickV16() {
    if (
      state.roomAuthorityBusyV17 ||
      state.roomAuthorityApplyingV16 ||
      !roomAuthorityCanRunV17() ||
      document.visibilityState !== "visible"
    ) {
      return;
    }

    try {
      const event = await roomAuthorityReadV16();
      if (!event) return;

      const expected = roomAuthorityExpectedV17(event);
      if (!Number.isFinite(expected)) return;

      const now = Date.now();
      const position = await asyncCurrentPosition();
      const playing = await asyncIsPlaying();
      const wantPlaying = event.playing === true;
      const recentCommand =
        now - Number(state.roomAuthorityLastCommandAtV17 || 0) < 8000 ||
        now - Number(state.roomAuthorityLastAppliedAtV17 || 0) < 8000;

      const previous = Number(state.roomAuthorityLastPositionV17);
      const previousAt = Number(state.roomAuthorityLastPositionAtV17 || 0);

      if (
        Number.isFinite(previous) &&
        previousAt > 0 &&
        now - previousAt < 5000 &&
        previous - Number(position) > 2.0 &&
        wantPlaying
      ) {
        state.roomAuthorityAdGuardUntilV17 = Math.max(
          Number(state.roomAuthorityAdGuardUntilV17 || 0),
          now + 45000
        );
      }

      state.roomAuthorityLastPositionV17 = Number(position);
      state.roomAuthorityLastPositionAtV17 = now;

      const adGuard = now < Number(state.roomAuthorityAdGuardUntilV17 || 0);

      if (!wantPlaying) {
        if (playing) {
          await roomAuthorityForceStateV17(false);
        }
        return;
      }

      if (recentCommand) {
        if (!playing) {
          await roomAuthorityForceStateV17(true);
        }
      }

      if (adGuard) {
        if (Math.abs(Number(position) - expected) < 2.5) {
          state.roomAuthorityAdGuardUntilV17 = 0;
        }
        return;
      }

      if (!playing) {
        return;
      }

      const drift = Math.abs(Number(position) - expected);
      if (drift > 5.0) {
        state.roomAuthorityApplyingV16 = true;
        state.playbackApplyingRemote = true;
        state.playbackPendingRecovery = true;
        state.playbackIgnoreStateChanges = 30;
        state.playbackIgnoreStateUntil = now + 5000;

        try {
          await applyPlayerPosition(expected);
        } finally {
          state.roomAuthorityApplyingV16 = false;
          state.playbackApplyingRemote = false;
          state.playbackPendingRecovery = false;
        }
      }
    } catch (error) {
      console.warn("房間共享時間軸校正失敗:", error);
    }
  }

  async function reconcileRoomTimeline() {
    return roomAuthorityObserverTickV16();
  }

  async function applyLatestRoomPlaybackState(force = true) {
    return roomAuthorityApplyLatestV16(force);
  }

  async function publishPlaybackEvent() {
    return;
  }

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;

    clearTimeout(state.roomAuthorityRecoveryTimerV16);
    state.roomAuthorityRecoveryTimerV16 = setTimeout(() => {
      if (!roomAuthorityCanRunV17()) return;
      void roomAuthorityApplyLatestV16(true);
    }, 500);
  });

  window.addEventListener("pageshow", () => {
    clearTimeout(state.roomAuthorityRecoveryTimerV16);
    state.roomAuthorityRecoveryTimerV16 = setTimeout(() => {
      if (!roomAuthorityCanRunV17()) return;
      void roomAuthorityApplyLatestV16(true);
    }, 500);
  });
'''

path.write_text(text[:tail] + patch + text[tail:], encoding="utf-8")
print("Installed shared timeline authority V17")
