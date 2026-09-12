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
    if (!db || !state.roomId) {
      return null;
    }

    return db.ref(
      `rooms/${state.roomId}/playbackEvent`
    );
  }
''',
'''  function playbackSyncRef() {
    if (!db || !state.roomRef || !state.roomId) {
      return null;
    }

    return state.roomRef
      .child("video")
      .child("playback");
  }
''',
"playback ref"
)

start_marker = "  async function handleRemotePlaybackSnapshot(\n"
end_marker = "  function stopPlaybackSeekDetector() {\n"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("remote handler markers not found")

replacement = r'''  async function handleRemotePlaybackSnapshot(
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


'''
text = text[:start] + replacement + text[end:]

path.write_text(text, encoding="utf-8")
print("room video playback sync patch generated successfully")
