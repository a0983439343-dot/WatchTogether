from pathlib import Path
import re

path = Path("app.js")
text = path.read_text(encoding="utf-8")

pattern = re.compile(
    r'  /\*\n   \* =========================================================\n   \* CLEANUP\n   \* =========================================================\n   \*/\n\n  function disconnectRoomListeners\(\) \{.*?\n  \}\n\n\n  /\*\n   \* 保留舊名稱',
    re.DOTALL
)

replacement = '''  /*
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

text, count = pattern.subn(replacement, text, count=1)

if count != 1:
    raise SystemExit(f"playback cleanup function rebuild failed: {count}")

path.write_text(text, encoding="utf-8")
print("playback cleanup function rebuilt")
