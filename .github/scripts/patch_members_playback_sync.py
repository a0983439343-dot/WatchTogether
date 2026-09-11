from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")


def replace_once(old, new, name):
    global text
    if old not in text:
        raise SystemExit(f"{name} marker not found")
    text = text.replace(old, new, 1)

replace_once(
    "    playbackSeekTimer: null,\n",
    """    playbackSeekTimer: null,\n\n    playbackMembersHandler: null,\n\n    lastPlaybackEventId: null,\n\n    pendingPlaybackEvent: null,\n""",
    "playback state"
)

start_marker = "  /*\n   * =========================================================\n   * EVENT-BASED PLAYBACK SYNC\n"
end_marker = "  /*\n   * =========================================================\n   * ROOM UI\n"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("sync section markers not found")

sync_code = r'''  /*
   * =========================================================
   * ROOM PLAYBACK SYNC
   * =========================================================
   * 房間同步：播放、暫停、拖曳。
   * 每個成員只寫自己的最後播放事件，
   * 其他成員監聽 members/房間並立即套用。
   */

  function playbackWriteRef() {
    if (
      !db ||
      !state.membersRef ||
      !state.roomId ||
      !state.uid
    ) {
      return null;
    }

    return state.membersRef
      .child(state.uid)
      .child("playback");
  }


  async function publishPlaybackEvent(
    action,
    position = null
  ) {
    if (
      !state.uid ||
      !state.roomId ||
      !state.membersRef ||
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

    const ref = playbackWriteRef();

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

    const normalizedAction =
      action === "pause"
        ? "pause"
        : action === "seek"
          ? "seek"
          : "play";

    const eventId =
      `${state.uid}_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2)}`;

    try {
      await ref.set({
        action: normalizedAction,
        position: finalPosition,
        videoId: String(state.currentVideoId),
        updatedAt:
          firebase.database.ServerValue.TIMESTAMP,
        updatedBy: state.uid,
        eventId
      });

      state.lastPlaybackEventId = eventId;
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
      state.pendingPlaybackEvent = event || null;
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

    if (
      event.eventId &&
      event.eventId === state.lastPlaybackEventId
    ) {
      return;
    }

    state.lastPlaybackEventId =
      event.eventId || null;

    state.pendingPlaybackEvent =
      null;

    state.playbackApplyingRemote = true;
    state.playbackReadyAt = Date.now() + 1000;

    try {
      const position = Math.max(
        0,
        Number(event.position) || 0
      );

      await applyPlayerPosition(
        position
      );

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

      state.playbackLastSampleAt =
        Date.now();
    }
  }


  async function handleRemotePlaybackSnapshot(
    snapshot
  ) {
    const members =
      snapshot?.val?.() || {};

    let newestEvent = null;
    let newestTime = -1;

    Object.keys(members).forEach((uid) => {
      if (uid === state.uid) {
        return;
      }

      const event =
        members?.[uid]?.playback ||
        null;

      if (
        !event ||
        !event.eventId ||
        event.updatedBy === state.uid
      ) {
        return;
      }

      const updatedAt =
        Number(event.updatedAt) || 0;

      if (updatedAt >= newestTime) {
        newestTime = updatedAt;
        newestEvent = event;
      }
    });

    if (!newestEvent) {
      return;
    }

    if (
      newestEvent.eventId ===
      state.lastPlaybackEventId
    ) {
      return;
    }

    await applyRemotePlaybackEvent(
      newestEvent
    );
  }


  function attachPlaybackSyncListener() {
    if (
      !state.membersRef ||
      state.playbackListenerAttached
    ) {
      return;
    }

    state.playbackMembersHandler =
      (snapshot) => {
        void handleRemotePlaybackSnapshot(
          snapshot
        );
      };

    state.membersRef.on(
      "value",
      state.playbackMembersHandler
    );

    state.playbackListenerAttached = true;
  }


  function stopPlaybackSeekDetector() {
    clearInterval(
      state.playbackSeekTimer
    );

    state.playbackSeekTimer = null;
    state.playbackLastPosition = null;
    state.playbackLastPlaying = null;
    state.playbackLastSampleAt = 0;
  }


  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();

    state.playbackReadyAt =
      Date.now() + 1500;

    state.playbackLastSampleAt =
      Date.now();

    state.playbackSeekTimer =
      setInterval(
        async () => {
          if (
            !state.playerReady ||
            !state.player ||
            state.playbackApplyingRemote
          ) {
            return;
          }

          const now = Date.now();
          const position =
            await asyncCurrentPosition();
          const playing =
            await asyncIsPlaying();

          if (
            now <
            Number(
              state.playbackReadyAt || 0
            )
          ) {
            state.playbackLastPosition =
              position;
            state.playbackLastPlaying =
              playing;
            state.playbackLastSampleAt =
              now;
            return;
          }

          if (
            state.playbackLastPosition ===
              null ||
            state.playbackLastPlaying ===
              null ||
            !state.playbackLastSampleAt
          ) {
            state.playbackLastPosition =
              position;
            state.playbackLastPlaying =
              playing;
            state.playbackLastSampleAt =
              now;
            return;
          }

          const elapsed =
            Math.max(
              0.05,
              (now -
                state.playbackLastSampleAt) /
                1000
            );

          const delta =
            position -
            Number(
              state.playbackLastPosition
            );

          const expectedDelta =
            playing ? elapsed : 0;

          const seekError =
            Math.abs(
              delta - expectedDelta
            );

          if (seekError >= 1.5) {
            void publishPlaybackEvent(
              "seek",
              position
            );

            state.playbackReadyAt =
              now + 600;
          }

          state.playbackLastPosition =
            position;
          state.playbackLastPlaying =
            playing;
          state.playbackLastSampleAt =
            now;
        },
        350
      );
  }


'''

text = text[:start] + sync_code + text[end:]

replace_once(
    '''      playbackSyncRef()?.off();

      stopPlaybackSeekDetector();''',
    '''      if (
        state.membersRef &&
        state.playbackMembersHandler
      ) {
        state.membersRef.off(
          "value",
          state.playbackMembersHandler
        );
      }

      state.playbackMembersHandler =
        null;

      stopPlaybackSeekDetector();''',
    "cleanup playback listener"
)

replace_once(
    '''    state.playbackApplyingRemote =
      false;
''',
    '''    state.playbackApplyingRemote =
      false;

    state.playbackMembersHandler =
      null;

    state.lastPlaybackEventId =
      null;

    state.pendingPlaybackEvent =
      null;
''',
    "cleanup playback state"
)

path.write_text(text, encoding="utf-8")
print("members playback sync patch generated successfully")
