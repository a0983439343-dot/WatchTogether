from pathlib import Path

path = Path("app.js")
text = path.read_text(encoding="utf-8")

bad = '''    state.playbackRoomEvent =
      null;

    state.lastPlaybackEventId =
      null;
'''
text = text.replace(bad, "")

enter_old = '''    state.roomRef =
      db.ref(
        `rooms/${state.roomId}`
      );

    state.membersRef =
'''
enter_new = '''    state.roomRef =
      db.ref(
        `rooms/${state.roomId}`
      );

    state.playbackRoomEvent =
      null;

    state.lastPlaybackEventId =
      null;

    state.membersRef =
'''
if enter_old not in text:
    raise SystemExit("enter room reset marker not found")
text = text.replace(enter_old, enter_new, 1)

if 'function attachPlaybackSyncListener()' not in text:
    raise SystemExit("playback listener missing")
if 'membersRef.child(state.uid).child("playback")' not in text:
    raise SystemExit("member playback write path missing")
if 'playbackEvent' in text:
    raise SystemExit("obsolete playbackEvent reference remains in app.js")
if 'schedulePlayingPositionSync' in text:
    raise SystemExit("obsolete position sync function remains in app.js")

path.write_text(text, encoding="utf-8")
print("generated app.js post-verification passed")
