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

      detachPlaybackSyncListener();
      stopPlaybackSeekDetector();
    } catch (_) {}

    state.videoListenerAttached =
      false;

    state.membersListenerAttached =
      false;

    state.chatListenerAttached =
      false;

    state.queueListenerAttached =
      false;

    state.playbackApplyingRemote =
      false;

    state.playbackRoomEvent =
      null;

    state.lastPlaybackEventId =
      null;

    state.queue =
      {};
  }


'''

text = text[:start] + replacement + text[end:]

path.write_text(text, encoding="utf-8")
print("playback cleanup function prepared")
