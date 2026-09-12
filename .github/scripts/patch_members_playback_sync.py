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
''',
'''  async function handleRemotePlaybackSnapshot(
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
        updatedAt > Number(latest.updatedAt || 0)
      ) {
        latest = {
          ...playback,
          updatedBy:
            playback.updatedBy || uid
        };
      }
    });

    if (!latest) {
      state.playbackState = null;
      return;
    }

    state.playbackState = latest;

    if (
      latest.updatedBy === state.uid
    ) {
      return;
    }

    if (
      latest.eventId &&
      latest.eventId ===
        state.lastPlaybackEventId
    ) {
      return;
    }

    if (latest.eventId) {
      state.lastPlaybackEventId =
        latest.eventId;
    }

    await applyRemotePlaybackEvent(
      latest
    );
  }
''',
"aggregate member playback state"
)

replace_once(
'''    const ref = playbackSyncRef();

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
''',
'''    const ref = playbackSyncRef();

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
''',
"member playback listener"
)

path.write_text(text, encoding="utf-8")
print("member-owned playback state patch generated successfully")
