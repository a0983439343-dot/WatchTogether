from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")


def replace_once(old, new, name):
    global text
    if old not in text:
        raise SystemExit(f"{name} marker not found")
    text = text.replace(old, new, 1)

replace_once(
'''  async function handleRemotePlaybackSnapshot(
    snapshot
  ) {
    const event =
      snapshot?.val?.() ||
      null;

    if (!event || !event.eventId) {
      return;
    }

    if (
      event.updatedBy === state.uid
    ) {
      return;
    }

    if (
      event.eventId ===
      state.lastPlaybackEventId
    ) {
      return;
    }

    await applyRemotePlaybackEvent(
      event
    );
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
        void handleRemotePlaybackSnapshot(
          snapshot
        );
      }
    );

    state.playbackListenerAttached = true;
  }


''',
'''  async function handleRemotePlaybackSnapshot(
    snapshot
  ) {
    const event =
      snapshot?.val?.() ||
      null;

    if (!event) {
      state.playbackState = null;
      return;
    }

    state.playbackState = event;

    if (
      event.updatedBy === state.uid
    ) {
      return;
    }

    if (
      event.eventId &&
      event.eventId ===
        state.lastPlaybackEventId
    ) {
      return;
    }

    if (event.eventId) {
      state.lastPlaybackEventId =
        event.eventId;
    }

    await applyRemotePlaybackEvent(
      event
    );
  }


  async function synchronizePlaybackFromRoom(
    force = false
  ) {
    const event =
      state.playbackState;

    if (
      !event ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId ||
      String(event.videoId || "") !==
        String(state.currentVideoId || "")
    ) {
      return;
    }

    if (
      event.updatedBy === state.uid &&
      !force
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

    let targetPosition = basePosition;

    if (
      event.action === "play"
    ) {
      const serverUpdatedAt =
        Number(event.updatedAt) || 0;

      const elapsed =
        serverUpdatedAt > 0
          ? Math.max(
              0,
              (Date.now() - serverUpdatedAt) / 1000
            )
          : 0;

      targetPosition =
        basePosition +
        Math.min(elapsed, 30);
    }

    const current =
      await asyncCurrentPosition();

    const difference =
      targetPosition - current;

    if (
      force ||
      Math.abs(difference) >= 0.75
    ) {
      state.playbackApplyingRemote = true;
      state.playbackReadyAt =
        Date.now() + 1800;

      try {
        await applyPlayerPosition(
          targetPosition
        );

        if (
          event.action === "play"
        ) {
          await playPlayer();
        }

        if (
          event.action === "pause"
        ) {
          await pausePlayer();
        }
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
    } else {
      const localPlaying =
        await asyncIsPlaying();

      if (
        event.action === "play" &&
        !localPlaying
      ) {
        state.playbackApplyingRemote = true;
        state.playbackReadyAt =
          Date.now() + 1800;

        try {
          await playPlayer();
        } finally {
          state.playbackApplyingRemote =
            false;
        }
      }

      if (
        event.action === "pause" &&
        localPlaying
      ) {
        state.playbackApplyingRemote = true;
        state.playbackReadyAt =
          Date.now() + 1800;

        try {
          await pausePlayer();
        } finally {
          state.playbackApplyingRemote =
            false;
        }
      }
    }
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
        void handleRemotePlaybackSnapshot(
          snapshot
        );
      }
    );

    state.playbackListenerAttached = true;

    void ref.once(
      "value"
    ).then((snapshot) => {
      void handleRemotePlaybackSnapshot(
        snapshot
      );
    }).catch(() => {});
  }


''',
"remote state sync"
)

replace_once(
'''  function startPlaybackSeekDetector() {
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
''',
'''  function startPlaybackSeekDetector() {
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

        const roomPlayback =
          state.playbackState;

        if (
          roomPlayback &&
          roomPlayback.updatedBy !== state.uid &&
          String(roomPlayback.videoId || "") ===
            String(state.currentVideoId || "")
        ) {
          await synchronizePlaybackFromRoom();
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
      700
    );
  }
''',
"continuous drift correction"
)

replace_once(
'''    state.playbackListenerAttached =
      false;

    state.playbackApplyingRemote =
      false;
''',
'''    state.playbackListenerAttached =
      false;

    state.playbackApplyingRemote =
      false;

    state.playbackState =
      null;

    state.lastPlaybackEventId =
      null;
''',
"cleanup playback state"
)

path.write_text(text, encoding="utf-8")
print("room playback authoritative-state patch generated successfully")
