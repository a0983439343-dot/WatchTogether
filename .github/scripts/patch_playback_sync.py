from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")

if "function attachPlaybackSyncListener()" in text:
    print("Playback sync already patched")
    raise SystemExit(0)

state_marker = "    kickedLocally: false,\n"
state_insert = """    kickedLocally: false,\n\n    playbackListenerAttached: false,\n\n    playbackApplyingRemote: false,\n\n    playbackReadyAt: 0,\n\n    playbackLastPosition: null,\n\n    playbackLastPlaying: null,\n\n    playbackSeekTimer: null,\n"""
if state_marker not in text:
    raise SystemExit("STATE marker not found")
text = text.replace(state_marker, state_insert, 1)

sync_code = r'''  /*
   * =========================================================
   * EVENT-BASED PLAYBACK SYNC
   * =========================================================
   * 同步：播放、暫停、拖曳跳轉。
   * 不做每秒 Firebase 播放進度寫入。
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

      await applyPlayerPosition(position);

      if (event.action === "play") {
        await playPlayer();
      } else if (event.action === "pause") {
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
  }


  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();

    state.playbackReadyAt = Date.now() + 1500;

    state.playbackSeekTimer = setInterval(
      async () => {
        if (
          !state.playerReady ||
          !state.player ||
          state.playbackApplyingRemote
        ) {
          return;
        }

        const position = await asyncCurrentPosition();
        const playing = await asyncIsPlaying();

        if (
          Date.now() <
          Number(state.playbackReadyAt || 0)
        ) {
          state.playbackLastPosition = position;
          state.playbackLastPlaying = playing;
          return;
        }

        if (
          state.playbackLastPosition === null ||
          state.playbackLastPlaying === null
        ) {
          state.playbackLastPosition = position;
          state.playbackLastPlaying = playing;
          return;
        }

        const delta =
          position - Number(state.playbackLastPosition);

        if (Math.abs(delta) >= 1.35) {
          void publishPlaybackEvent(
            "seek",
            position
          );
        }

        if (playing !== state.playbackLastPlaying) {
          void publishPlaybackEvent(
            playing ? "play" : "pause",
            position
          );
        }

        state.playbackLastPosition = position;
        state.playbackLastPlaying = playing;
      },
      300
    );
  }


'''

room_ui_marker = '''  /*
   * =========================================================
   * ROOM UI
   * =========================================================
   */
'''
if room_ui_marker not in text:
    raise SystemExit("ROOM UI marker not found")
text = text.replace(room_ui_marker, sync_code + room_ui_marker, 1)

no_video_old = """    if (!video) {\n      state.youtubeRequestedId =\n        null;\n"""
no_video_new = """    if (!video) {\n      stopPlaybackSeekDetector();\n\n      state.youtubeRequestedId =\n        null;\n"""
if no_video_old not in text:
    raise SystemExit("handleRoomVideo marker not found")
text = text.replace(no_video_old, no_video_new, 1)

yt_build_old = """      await buildYoutubePlayer(\n        videoId,\n        true\n      );\n\n      return;\n"""
yt_build_new = """      await buildYoutubePlayer(\n        videoId,\n        true\n      );\n\n      startPlaybackSeekDetector();\n\n      return;\n"""
if yt_build_old not in text:
    raise SystemExit("YouTube build marker not found")
text = text.replace(yt_build_old, yt_build_new, 1)

other_build_old = """    await buildPlatformPlayer(\n      normalized\n    );\n  }\n"""
other_build_new = """    await buildPlatformPlayer(\n      normalized\n    );\n\n    startPlaybackSeekDetector();\n  }\n"""
if other_build_old not in text:
    raise SystemExit("other build marker not found")
text = text.replace(other_build_old, other_build_new, 1)

enter_old = """    updateRoomOwnerUI();\n\n    state.roomRef =\n"""
enter_new = """    updateRoomOwnerUI();\n\n    stopPlaybackSeekDetector();\n\n    state.roomRef =\n"""
if enter_old not in text:
    raise SystemExit("enterRoom marker not found")
text = text.replace(enter_old, enter_new, 1)

chat_marker = """    if (\n      !state.chatListenerAttached\n    ) {\n"""
chat_replacement = """    attachPlaybackSyncListener();\n\n    if (\n      !state.chatListenerAttached\n    ) {\n"""
if chat_marker not in text:
    raise SystemExit("chat listener marker not found")
text = text.replace(chat_marker, chat_replacement, 1)

cleanup_old = """      state.roomRef\n        ?.child("video")\n        .off();\n"""
cleanup_new = """      state.roomRef\n        ?.child("video")\n        .off();\n\n      playbackSyncRef()?.off();\n\n      stopPlaybackSeekDetector();\n"""
if cleanup_old not in text:
    raise SystemExit("cleanup marker not found")
text = text.replace(cleanup_old, cleanup_new, 1)

cleanup_state_old = """    state.videoListenerAttached =\n      false;\n"""
cleanup_state_new = """    state.videoListenerAttached =\n      false;\n\n    state.playbackListenerAttached =\n      false;\n\n    state.playbackApplyingRemote =\n      false;\n"""
if cleanup_state_old not in text:
    raise SystemExit("cleanup state marker not found")
text = text.replace(cleanup_state_old, cleanup_state_new, 1)

unload_old = """      clearInterval(\n        state.memberHeartbeatTimer\n      );\n\n      unlockPageScroll();\n"""
unload_new = """      clearInterval(\n        state.memberHeartbeatTimer\n      );\n\n      stopPlaybackSeekDetector();\n\n      unlockPageScroll();\n"""
if unload_old not in text:
    raise SystemExit("unload marker not found")
text = text.replace(unload_old, unload_new, 1)

path.write_text(text, encoding="utf-8")
print("app.js patched successfully")
