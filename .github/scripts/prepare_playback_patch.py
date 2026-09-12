from pathlib import Path
import re

path = Path("app.js")
text = path.read_text(encoding="utf-8")

cleanup_pattern = re.compile(
    r'  /\*\n   \* =========================================================\n   \* CLEANUP\n   \* =========================================================\n   \*/\n\n  function disconnectRoomListeners\(\) \{.*?\n  \}\n\n\n  /\*\n   \* 保留舊名稱',
    re.DOTALL
)

cleanup_replacement = '''  /*
   * =========================================================
   * CLEANUP
   * =========================================================
   */

  function disconnectRoomListeners() {
    try {
      state.membersRef?.off();

      state.chatRef?.off();

      state.queueRef?.off();

    state.roomRef
        ?.child("video")
        .off();

    } catch (_) {}
  }


  /*
   * 保留舊名稱'''

text, cleanup_count = cleanup_pattern.subn(
    cleanup_replacement,
    text,
    count=1
)

if cleanup_count != 1:
    raise SystemExit(
        f"playback cleanup function rebuild failed: {cleanup_count}"
    )

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
