from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")

start_marker = "  function disconnectRoomListeners() {"
end_marker = "  function detachRoomListeners() {"

start = text.find(start_marker)
end = text.find(end_marker, start)

if start < 0 or end < 0 or end <= start:
    raise SystemExit("could not locate disconnectRoomListeners function")

replacement = '''  function disconnectRoomListeners() {
    try {
      state.membersRef?.off();

      state.chatRef?.off();

      state.queueRef?.off();

    state.roomRef
        ?.child("video")
        .off();

    } catch (_) {}
  }


'''

text = text[:start] + replacement + text[end:]

state_marker = "    state.membersListenerAttached =\n"
if state_marker not in text:
    raise SystemExit("members listener marker not found")

if "state.playbackApplyingRemote =\n      false;" not in text:
    text = text.replace(
        state_marker,
        "    state.playbackApplyingRemote =\n      false;\n\n" + state_marker,
        1
    )

path.write_text(text, encoding="utf-8")
print("playback cleanup and state markers prepared")
