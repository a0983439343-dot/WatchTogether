from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")


def replace_once(old, new, name):
    global text
    if old not in text:
        raise SystemExit(f"{name} marker not found")
    text = text.replace(old, new, 1)

replace_once(
'''  function playbackWriteRef() {
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
''',
'''  function playbackWriteRef() {
    if (
      !db ||
      !state.roomRef ||
      !state.roomId ||
      !state.uid
    ) {
      return null;
    }

    return state.roomRef
      .child("video")
      .child("playback");
  }
''',
"playback write ref"
)

start_marker = "  async function handleRemotePlaybackSnapshot(\n"
end_marker = "  function stopPlaybackSeekDetector() {\n"
start = text.find(start_marker)
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit("remote playback handler markers not found")

remote_code = r'''  async function handleRemotePlaybackSnapshot(
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

    state.playbackMembersHandler =
      (snapshot) => {
        void handleRemotePlaybackSnapshot(
          snapshot
        );
      };

    state.roomRef
      .child("video")
      .child("playback")
      .on(
        "value",
        state.playbackMembersHandler
      );

    state.playbackListenerAttached = true;
  }


'''

text = text[:start] + remote_code + text[end:]

replace_once(
'''      if (
        state.membersRef &&
        state.playbackMembersHandler
      ) {
        state.membersRef.off(
          "value",
          state.playbackMembersHandler
        );
      }
''',
'''      if (
        state.roomRef &&
        state.playbackMembersHandler
      ) {
        state.roomRef
          .child("video")
          .child("playback")
          .off(
            "value",
            state.playbackMembersHandler
          );
      }
''',
"cleanup playback listener"
)

path.write_text(text, encoding="utf-8")
print("room video playback sync patch generated successfully")
