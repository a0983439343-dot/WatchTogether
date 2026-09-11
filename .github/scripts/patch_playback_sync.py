from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")


def replace_once(old, new, name):
    global text
    if old not in text:
        raise SystemExit(f"{name} marker not found")
    text = text.replace(old, new, 1)


replace_once(
    "    kickedLocally: false,\n",
    """    kickedLocally: false,\n\n    playbackListenerAttached: false,\n\n    playbackApplyingRemote: false,\n\n    playbackReadyAt: 0,\n\n    playbackLastPosition: null,\n\n    playbackLastPlaying: null,\n\n    playbackLastSampleAt: 0,\n\n    playbackSeekTimer: null,\n""",
    "state"
)

sync_code = r'''  /*
   * =========================================================
   * EVENT-BASED PLAYBACK SYNC
   * =========================================================
   * 同步：播放、暫停、拖曳跳轉。
   * 不做持續性的播放進度同步。
   */

  function playbackSyncRef() {
    if (!db || !state.roomId) {
      return null;
    }

    return db.ref(
      `rooms/${state.roomId}/playbackEvent`
    );
  }


  async function publishPlaybackEvent(
    action,
    position = null
  ) {
    if (
      !state.uid ||
      !state.roomId ||
      !state.playerReady ||
      !state.player ||
      state.playbackApplyingRemote ||
      Date.now() < Number(state.playbackReadyAt || 0)
    ) {
      return;
    }

    if (
      state.playerType === "bilibili" ||
      state.playerType === "external"
    ) {
      return;
    }

    const ref = playbackSyncRef();

    if (!ref || !state.currentVideoId) {
      return;
    }

    let finalPosition = Number(position);

    if (!Number.isFinite(finalPosition)) {
      finalPosition = await asyncCurrentPosition();
    }

    finalPosition = Math.max(
      0,
      Number(finalPosition) || 0
    );

    try {
      await ref.set({
        action:
          action === "pause"
            ? "pause"
            : action === "seek"
              ? "seek"
              : "play",

        position: finalPosition,

        videoId:
          String(state.currentVideoId),

        updatedAt:
          firebase.database
            .ServerValue
            .TIMESTAMP,

        updatedBy:
          state.uid,

        eventId:
          `${state.uid}_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2)}`
      });
    } catch (error) {
      console.warn(
        "播放同步寫入失敗:",
        error
      );
    }
  }


  async function applyRemotePlaybackEvent(
    event
  ) {
    if (
      !event ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId
    ) {
      return;
    }

    if (
      String(event.videoId || "") !==
      String(state.currentVideoId || "")
    ) {
      return;
    }

    if (
      event.action !== "play" &&
      event.action !== "pause" &&
      event.action !== "seek"
    ) {
      return;
    }

    if (
      state.playerType === "bilibili" ||
      state.playerType === "external"
    ) {
      return;
    }

    state.playbackApplyingRemote = true;
    state.playbackReadyAt = Date.now() + 1400;

    try {
      const position = Math.max(
        0,
        Number(event.position) || 0
      );

      if (event.action === "seek") {
        await applyPlayerPosition(position);
      }

      if (event.action === "play") {
        await applyPlayerPosition(position);
        await playPlayer();
      }

      if (event.action === "pause") {
        await applyPlayerPosition(position);
        await pausePlayer();
      }
    } catch (error) {
      console.warn(
        "套用遠端播放狀態失敗:",
        error
      );
    } finally {
      state.playbackApplyingRemote = false;

      state.playbackLastPosition =
        await asyncCurrentPosition();

      state.playbackLastPlaying =
        await asyncIsPlaying();

      state.playbackLastSampleAt =
        Date.now();
    }
  }


  async function handleRemotePlaybackSnapshot(
    snapshot
  ) {
    const event = snapshot?.val?.() || null;

    if (!event) {
      return;
    }

    if (
      !event.eventId ||
      event.updatedBy === state.uid
    ) {
      return;
    }

    await applyRemotePlaybackEvent(event);
  }


  function attachPlaybackSyncListener() {
    if (
      !state.roomRef ||
      state.playbackListenerAttached
    ) {
      return;
    }

    const ref = playbackSyncRef();

    if (!ref) {
      return;
    }

    ref.on(
      "value",
      (snapshot) => {
        void handleRemotePlaybackSnapshot(snapshot);
      }
    );

    state.playbackListenerAttached = true;
  }


  function stopPlaybackSeekDetector() {
    clearInterval(state.playbackSeekTimer);
    state.playbackSeekTimer = null;
    state.playbackLastPosition = null;
    state.playbackLastPlaying = null;
    state.playbackLastSampleAt = 0;
  }


  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();

    state.playbackReadyAt = Date.now() + 1500;
    state.playbackLastSampleAt = Date.now();

    state.playbackSeekTimer = setInterval(
      async () => {
        if (
          !state.playerReady ||
          !state.player ||
          state.playbackApplyingRemote
        ) {
          return;
        }

        const now = Date.now();
        const position = await asyncCurrentPosition();
        const playing = await asyncIsPlaying();

        if (now < Number(state.playbackReadyAt || 0)) {
          state.playbackLastPosition = position;
          state.playbackLastPlaying = playing;
          state.playbackLastSampleAt = now;
          return;
        }

        if (
          state.playbackLastPosition === null ||
          state.playbackLastPlaying === null ||
          !state.playbackLastSampleAt
        ) {
          state.playbackLastPosition = position;
          state.playbackLastPlaying = playing;
          state.playbackLastSampleAt = now;
          return;
        }

        const elapsed = Math.max(
          0.05,
          (now - state.playbackLastSampleAt) / 1000
        );

        const delta =
          position - Number(state.playbackLastPosition);

        const expectedDelta =
          playing ? elapsed : 0;

        const seekError =
          Math.abs(delta - expectedDelta);

        if (seekError >= 1.5) {
          void publishPlaybackEvent(
            "seek",
            position
          );

          state.playbackReadyAt = now + 600;
        }

        state.playbackLastPosition = position;
        state.playbackLastPlaying = playing;
        state.playbackLastSampleAt = now;
      },
      350
    );
  }


'''

replace_once(
    '''  /*
   * =========================================================
   * ROOM UI
   * =========================================================
   */
''',
    sync_code + '''  /*
   * =========================================================
   * ROOM UI
   * =========================================================
   */
''',
    "sync insertion"
)

replace_once(
    '''                  forceYoutubeVisible();

                  if (
                    event.data ===
                    YT.PlayerState.ENDED
                  ) {''',
    '''                  forceYoutubeVisible();

                  if (
                    event.data ===
                    YT.PlayerState.PLAYING
                  ) {
                    if (!state.playbackApplyingRemote) {
                      void publishPlaybackEvent(
                        "play"
                      );
                    }
                  }

                  if (
                    event.data ===
                    YT.PlayerState.PAUSED
                  ) {
                    if (!state.playbackApplyingRemote) {
                      void publishPlaybackEvent(
                        "pause"
                      );
                    }
                  }

                  if (
                    event.data ===
                    YT.PlayerState.ENDED
                  ) {''',
    "youtube events"
)

replace_once(
    '''          if (
            await asyncIsPlaying()
          ) {
            await pausePlayer();
          } else {
            await playPlayer();
          }

          updateTimeUI();''',
    '''          const position =
            await asyncCurrentPosition();

          if (
            await asyncIsPlaying()
          ) {
            await pausePlayer();
            void publishPlaybackEvent(
              "pause",
              position
            );
          } else {
            await playPlayer();
            void publishPlaybackEvent(
              "play",
              position
            );
          }

          updateTimeUI();''',
    "play pause button"
)

seek_block = '''          await applyPlayerPosition(
            target
          );
        }
      );'''
if text.count(seek_block) != 2:
    raise SystemExit(
        f"expected 2 seek blocks, got {text.count(seek_block)}"
    )
text = text.replace(
    seek_block,
    '''          await applyPlayerPosition(
            target
          );

          void publishPlaybackEvent(
            "seek",
            target
          );
        }
      );''',
    2
)

replace_once(
    '''    if (!video) {
      state.youtubeRequestedId =
        null;
''',
    '''    if (!video) {
      stopPlaybackSeekDetector();

      state.youtubeRequestedId =
        null;
''',
    "empty video"
)

replace_once(
    '''      await buildYoutubePlayer(
        videoId,
        true
      );

      return;
''',
    '''      await buildYoutubePlayer(
        videoId,
        true
      );

      startPlaybackSeekDetector();

      return;
''',
    "youtube build"
)

replace_once(
    '''    await buildPlatformPlayer(
      normalized
    );
  }
''',
    '''    await buildPlatformPlayer(
      normalized
    );

    startPlaybackSeekDetector();
  }
''',
    "other platform build"
)

replace_once(
    '''    updateRoomOwnerUI();

    state.roomRef =
''',
    '''    updateRoomOwnerUI();

    stopPlaybackSeekDetector();
    state.playbackLastSampleAt = 0;

    state.roomRef =
''',
    "enter room"
)

replace_once(
    '''    if (
      !state.chatListenerAttached
    ) {
''',
    '''    attachPlaybackSyncListener();

    if (
      !state.chatListenerAttached
    ) {
''',
    "attach listener"
)

replace_once(
    '''      state.roomRef
        ?.child("video")
        .off();
''',
    '''      state.roomRef
        ?.child("video")
        .off();

      playbackSyncRef()?.off();

      stopPlaybackSeekDetector();
''',
    "cleanup ref"
)

replace_once(
    '''    state.videoListenerAttached =
      false;
''',
    '''    state.videoListenerAttached =
      false;

    state.playbackListenerAttached =
      false;

    state.playbackApplyingRemote =
      false;
''',
    "cleanup state"
)

replace_once(
    '''      clearInterval(
        state.memberHeartbeatTimer
      );

      unlockPageScroll();
''',
    '''      clearInterval(
        state.memberHeartbeatTimer
      );

      stopPlaybackSeekDetector();

      unlockPageScroll();
''',
    "unload"
)

path.write_text(text, encoding="utf-8")
print("app.js patch generated successfully")
