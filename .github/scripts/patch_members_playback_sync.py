from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")


def replace_once(old, new, name):
    global text
    if old not in text:
        raise SystemExit(f"{name} marker not found")
    text = text.replace(old, new, 1)


replace_once(
'''  function playbackSyncRef() {
    if (!db || !state.roomRef || !state.roomId) {
      return null;
    }

    return state.roomRef
      .child("video")
      .child("playback");
  }
''',
'''  function playbackSyncRef() {
    if (!db || !state.membersRef || !state.roomId) {
      return null;
    }

    return state.membersRef;
  }


  function playbackWriteRef() {
    if (
      !state.membersRef ||
      !state.uid ||
      !state.roomId
    ) {
      return null;
    }

    return state.membersRef
      .child(state.uid)
      .child("playback");
  }
''',
"member playback refs"
)

replace_once(
'''    const ref = playbackSyncRef();

    if (!ref || !state.currentVideoId) {
      return;
    }
''',
'''    const ref = playbackWriteRef();

    if (!ref || !state.currentVideoId) {
      return;
    }
''',
"playback write ref"
)

replace_once(
'''      state.playbackApplyingRemote ||
      Date.now() < Number(state.playbackReadyAt || 0)
''',
'''      state.playbackApplyingRemote
''',
"local publish guard"
)

replace_once(
'''    playbackSeekTimer: null,
''',
'''    playbackSeekTimer: null,

    playbackState: null,

    lastPlaybackEventId: null,
''',
"playback state fields"
)

start_marker = "  async function applyRemotePlaybackEvent(\n"
end_marker = "  function attachPlaybackSyncListener() {\n"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("remote playback section markers not found")

replacement = r'''  async function applyRemotePlaybackEvent(
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

    const basePosition = Math.max(
      0,
      Number(event.position) || 0
    );

    let targetPosition =
      basePosition;

    if (event.action === "play") {
      const updatedAt =
        Number(event.updatedAt) ||
        0;

      const elapsed =
        updatedAt > 0
          ? Math.max(
              0,
              (Date.now() - updatedAt) / 1000
            )
          : 0;

      targetPosition =
        basePosition +
        Math.min(elapsed, 30);
    }

    const current =
      await asyncCurrentPosition();

    const localPlaying =
      await asyncIsPlaying();

    const positionDifference =
      Math.abs(
        targetPosition -
        current
      );

    const playStateMismatch =
      event.action === "play"
        ? !localPlaying
        : event.action === "pause"
          ? localPlaying
          : false;

    if (
      positionDifference < 0.65 &&
      !playStateMismatch
    ) {
      return;
    }

    state.playbackApplyingRemote = true;
    state.playbackReadyAt =
      Date.now() + 1200;

    try {
      if (
        positionDifference >= 0.65 ||
        event.action === "seek"
      ) {
        await applyPlayerPosition(
          targetPosition
        );
      }

      if (event.action === "play") {
        await playPlayer();
      }

      if (event.action === "pause") {
        await pausePlayer();
      }
    } catch (error) {
      console.warn(
        "套用遠端播放狀態失敗:",
        error
      );
    } finally {
      state.playbackApplyingRemote =
        false;

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
      snapshot?.val?.() ||
      {};

    let latest = null;

    Object.entries(
      members
    ).forEach(([uid, member]) => {
      const playback =
        member?.playback ||
        null;

      if (!playback) {
        return;
      }

      const updatedAt =
        Number(playback.updatedAt) ||
        0;

      if (
        !latest ||
        updatedAt >
          Number(latest.updatedAt || 0)
      ) {
        latest = {
          ...playback,
          updatedBy:
            playback.updatedBy ||
            uid
        };
      }
    });

    if (!latest) {
      state.playbackState =
        null;
      return;
    }

    const changed =
      latest.eventId !==
      state.lastPlaybackEventId;

    state.playbackState =
      latest;

    if (
      !changed ||
      latest.updatedBy === state.uid
    ) {
      return;
    }

    state.lastPlaybackEventId =
      latest.eventId ||
      String(latest.updatedAt || "");

    await applyRemotePlaybackEvent(
      latest
    );
  }


  async function synchronizePlaybackFromRoom() {
    const event =
      state.playbackState;

    if (
      !event ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId
    ) {
      return;
    }

    if (
      event.updatedBy === state.uid
    ) {
      return;
    }

    if (
      String(event.videoId || "") !==
      String(state.currentVideoId || "")
    ) {
      return;
    }

    await applyRemotePlaybackEvent(
      event
    );
  }


'''
text = text[:start] + replacement + text[end:]

start_marker = "  function startPlaybackSeekDetector() {\n"
end_marker = "  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */\n"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("seek detector markers not found")

seek_replacement = r'''  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();

    state.playbackReadyAt =
      Date.now() + 1200;

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
                state.playbackReadyAt ||
                0
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

          const roomPlayback =
            state.playbackState;

          if (
            roomPlayback &&
            roomPlayback.updatedBy !==
              state.uid &&
            String(
              roomPlayback.videoId ||
              ""
            ) ===
              String(
                state.currentVideoId ||
                ""
              )
          ) {
            await synchronizePlaybackFromRoom();
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
              delta -
              expectedDelta
            );

          if (
            seekError >= 1.5
          ) {
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
        700
      );
  }


'''
text = text[:start] + seek_replacement + text[end:]

path.write_text(text, encoding="utf-8")
print("member-owned authoritative playback sync patch generated successfully")
