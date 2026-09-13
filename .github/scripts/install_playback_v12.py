from pathlib import Path

path = Path('app.js')
text = path.read_text(encoding='utf-8')

marker = 'ROOM AUTHORITY PLAYBACK V12'
if marker in text:
    print('v12 already installed')
    raise SystemExit(0)

layer = r'''

  /* =========================================================
     ROOM AUTHORITY PLAYBACK V12
     =========================================================
     Shared Firebase playbackEvent is the only playback clock.
     No member and no player instance is a master.
     Local player time is never used as the room timeline source.
  ========================================================= */

  let roomAuthorityObserverBusy = false;


  function roomAuthorityClock() {
    return typeof serverNow === "function"
      ? serverNow()
      : Date.now();
  }


  function roomAuthorityPlayerReady() {
    return Boolean(
      state.roomId &&
      state.player &&
      state.playerReady &&
      state.currentVideoId &&
      typeof asyncCurrentPosition === "function"
    );
  }


  function roomAuthorityExpectedPosition(event, now = roomAuthorityClock()) {
    if (!event) {
      return null;
    }

    const position = Number(event.position);
    if (!Number.isFinite(position)) {
      return null;
    }

    if (event.playing !== true) {
      return Math.max(0, position);
    }

    const updatedAt = Number(event.updatedAt);
    if (!Number.isFinite(updatedAt)) {
      return Math.max(0, position);
    }

    return Math.max(
      0,
      position + Math.min(
        7200,
        Math.max(0, (now - updatedAt) / 1000)
      )
    );
  }


  async function roomAuthorityRead() {
    if (!state.roomId || !db || !state.currentVideoId) {
      return null;
    }

    const snapshot = await db
      .ref(`rooms/${state.roomId}/playbackEvent`)
      .once("value");

    const event = snapshot.val();

    if (!event || event.videoId !== state.currentVideoId) {
      return null;
    }

    state.playbackTimeline = event;
    return event;
  }


  async function roomAuthorityApply(event, force = true) {
    if (!roomAuthorityPlayerReady() || !event) {
      return;
    }

    if (event.videoId !== state.currentVideoId) {
      return;
    }

    const expected = roomAuthorityExpectedPosition(event);
    if (expected === null) {
      return;
    }

    const localPosition = await asyncCurrentPosition();
    const localPlaying = await asyncIsPlaying();
    const roomPlaying = event.playing === true;
    const positionDifference = Math.abs(expected - localPosition);

    if (positionDifference > 0.65) {
      state.playbackIgnoreStateChanges = 8;
      state.playbackIgnoreStateUntil = Date.now() + 3000;

      try {
        await applyPlayerPosition(expected);
      } catch (_) {}
    }

    if (roomPlaying && !localPlaying) {
      state.playbackIgnoreStateChanges = 8;
      state.playbackIgnoreStateUntil = Date.now() + 3000;

      try {
        await playPlayer();
      } catch (_) {}
    }

    if (!roomPlaying && localPlaying) {
      state.playbackIgnoreStateChanges = 8;
      state.playbackIgnoreStateUntil = Date.now() + 3000;

      try {
        await pausePlayer();
      } catch (_) {}
    }

    state.playbackLastPosition = expected;
    state.playbackLastPlaying = roomPlaying;
    state.playbackLastObservedPosition = expected;
    state.playbackLastPlayerState = roomPlaying ? "playing" : "paused";
  }


  async function roomAuthorityApplyLatest(force = true) {
    try {
      const event = await roomAuthorityRead();
      if (event) {
        await roomAuthorityApply(event, force);
      }
    } catch (error) {
      console.warn("共享播放狀態讀取失敗:", error);
    }
  }


  async function roomAuthorityCommand(action, position = null) {
    if (!state.roomId || !state.currentVideoId || !db) {
      return;
    }

    const event = await roomAuthorityRead();

    if (!event) {
      return;
    }

    const sharedPosition = roomAuthorityExpectedPosition(event);
    if (sharedPosition === null) {
      return;
    }

    let targetPosition = sharedPosition;
    let targetPlaying = event.playing === true;

    if (action === "pause") {
      targetPosition = sharedPosition;
      targetPlaying = false;
    } else if (action === "play") {
      targetPosition = sharedPosition;
      targetPlaying = true;
    } else if (action === "seek") {
      targetPosition = Math.max(0, Number(position));
    }

    state.playbackUserActionUntil = Date.now() + 3000;
    state.playbackUserActionKind = action;
    state.playbackLocalIntentAt = Date.now();
    state.playbackIgnoreStateChanges = 10;
    state.playbackIgnoreStateUntil = Date.now() + 3500;
    state.playbackLocalStateCandidate = null;
    state.playbackLocalStateCandidateAt = 0;

    if (action === "pause") {
      await pausePlayer();
    } else if (action === "play") {
      try {
        await applyPlayerPosition(targetPosition);
      } catch (_) {}
      await playPlayer();
    } else if (action === "seek") {
      await applyPlayerPosition(targetPosition);
    }

    if (typeof publishPlaybackEvent === "function") {
      await publishPlaybackEvent(
        action,
        targetPosition,
        targetPlaying
      );
    }
  }


  function roomAuthorityReplaceButton(id, handler) {
    const oldButton = $(id);
    if (!oldButton) {
      return;
    }

    const replacement = oldButton.cloneNode(true);
    oldButton.replaceWith(replacement);
    replacement.addEventListener("click", handler);
  }


  function roomAuthorityInstallControls() {
    roomAuthorityReplaceButton("playPauseBtn", async () => {
      if (!roomAuthorityPlayerReady() || state.playbackApplyingRemote) {
        return;
      }

      try {
        const event = await roomAuthorityRead();
        if (!event) return;

        if (event.playing === true) {
          await roomAuthorityCommand("pause");
        } else {
          await roomAuthorityCommand("play");
        }
      } catch (error) {
        console.warn("共享播放按鈕失敗:", error);
      }
    });

    roomAuthorityReplaceButton("backBtn", async () => {
      if (!roomAuthorityPlayerReady() || state.playbackApplyingRemote) {
        return;
      }

      try {
        const event = await roomAuthorityRead();
        if (!event) return;

        const sharedPosition = roomAuthorityExpectedPosition(event);
        if (sharedPosition === null) return;

        await roomAuthorityCommand(
          "seek",
          Math.max(0, sharedPosition - 10)
        );
      } catch (error) {
        console.warn("共享倒退失敗:", error);
      }
    });

    roomAuthorityReplaceButton("forwardBtn", async () => {
      if (!roomAuthorityPlayerReady() || state.playbackApplyingRemote) {
        return;
      }

      try {
        const event = await roomAuthorityRead();
        if (!event) return;

        const sharedPosition = roomAuthorityExpectedPosition(event);
        if (sharedPosition === null) return;

        await roomAuthorityCommand(
          "seek",
          sharedPosition + 10
        );
      } catch (error) {
        console.warn("共享快轉失敗:", error);
      }
    });
  }


  function roomAuthorityStartObserver() {
    if (state.roomAuthorityTimer) {
      clearInterval(state.roomAuthorityTimer);
    }

    state.roomAuthorityTimer = setInterval(async () => {
      if (
        roomAuthorityObserverBusy ||
        !roomAuthorityPlayerReady()
      ) {
        return;
      }

      roomAuthorityObserverBusy = true;

      try {
        let event = state.playbackTimeline;

        if (!event || event.videoId !== state.currentVideoId) {
          event = await roomAuthorityRead();
        }

        if (!event || event.videoId !== state.currentVideoId) {
          return;
        }

        state.playbackTimeline = event;

        const expected = roomAuthorityExpectedPosition(event);
        if (expected === null) {
          return;
        }

        const localPosition = await asyncCurrentPosition();
        const localPlaying = await asyncIsPlaying();
        const roomPlaying = event.playing === true;

        if (Math.abs(expected - localPosition) > 1.15) {
          state.playbackIgnoreStateChanges = 8;
          state.playbackIgnoreStateUntil = Date.now() + 3000;

          try {
            await applyPlayerPosition(expected);
          } catch (_) {}
        }

        /*
         * 絕對不能因為本機播放器突然 PAUSED/PLAYING 就寫回房間。
         * 廣告、buffering、分頁切換、手機背景都可能產生這種狀態。
         * 房間已經有 playing 狀態時，播放器只能被拉回該狀態。
         */
        if (roomPlaying && !localPlaying) {
          state.playbackIgnoreStateChanges = 8;
          state.playbackIgnoreStateUntil = Date.now() + 3000;
          try {
            await playPlayer();
          } catch (_) {}
        } else if (!roomPlaying && localPlaying) {
          state.playbackIgnoreStateChanges = 8;
          state.playbackIgnoreStateUntil = Date.now() + 3000;
          try {
            await pausePlayer();
          } catch (_) {}
        }

        state.playbackLastPosition = expected;
        state.playbackLastPlaying = roomPlaying;
        state.playbackLastObservedPosition = expected;
        state.playbackLastPlayerState = roomPlaying ? "playing" : "paused";
      } catch (error) {
        console.warn("共享播放校正失敗:", error);
      } finally {
        roomAuthorityObserverBusy = false;
      }
    }, 350);
  }


  function roomAuthorityRecover() {
    clearTimeout(state.roomAuthorityRecoveryTimer);

    state.roomAuthorityRecoveryTimer = setTimeout(async () => {
      if (!state.roomId || !roomAuthorityPlayerReady()) {
        return;
      }

      state.playbackPendingRecovery = true;

      try {
        await roomAuthorityApplyLatest(true);
      } finally {
        state.playbackPendingRecovery = false;
      }
    }, 300);
  }


  roomAuthorityInstallControls();
  roomAuthorityStartObserver();
  setTimeout(() => roomAuthorityApplyLatest(true), 250);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      roomAuthorityRecover();
    }
  });

  window.addEventListener("pageshow", roomAuthorityRecover);

'''

idx = text.rfind('\n})();')
if idx < 0:
    idx = text.rfind('})();')
if idx < 0:
    raise SystemExit('IIFE tail not found')

text = text[:idx] + layer + text[idx:]
path.write_text(text, encoding='utf-8')
print('installed room authority playback v12')
