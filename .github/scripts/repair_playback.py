from pathlib import Path
import json
import re

APP = Path("app.js")
RULES = Path("database.rules.json")

s = APP.read_text(encoding="utf-8")

state_marker = "    playbackRemoteEvent: null,"
if "playbackLastRemoteEventId:" not in s:
    if state_marker not in s:
        raise SystemExit("playbackRemoteEvent state marker not found")
    s = s.replace(
        state_marker,
        state_marker + "\n    playbackLastRemoteEventId: null,\n    playbackApplyingRemoteEventId: null,",
        1,
    )

start = s.find("  async function applyRemotePlaybackEvent(event) {")
end = s.find("\n  async function applyLatestRoomPlaybackState()", start)
if start < 0 or end < 0:
    raise SystemExit("playback function boundaries not found")

new_apply = r'''  async function applyRemotePlaybackEvent(event) {
    if (!event || !state.playerReady || !state.player || !state.currentVideoId) return;
    if (String(event.videoId || "") !== String(state.currentVideoId || "")) return;
    if (!["play", "pause", "seek"].includes(event.action)) return;
    if (event.updatedBy === state.uid) return;
    if (state.playerType === "bilibili" || state.playerType === "external") return;

    const eventId = String(event.eventId || "");
    if (!eventId) return;
    if (state.playbackLastRemoteEventId === eventId) return;
    if (state.playbackApplyingRemoteEventId === eventId) return;

    state.playbackApplyingRemoteEventId = eventId;
    state.playbackLastRemoteEventId = eventId;
    state.playbackRemoteEvent = event;
    state.playbackApplyingRemote = true;
    state.playbackReadyAt = Date.now() + 1200;

    try {
      const position = getExpectedPlaybackPosition(event);
      await applyPlayerPosition(position);

      if (event.playing === true) {
        await playPlayer();
      } else {
        await pausePlayer();
      }

      if ($("syncStatus")) {
        $("syncStatus").textContent = `已同步 ${formatTime(position)}`;
      }

      state.playbackLastPosition = await asyncCurrentPosition();
      state.playbackLastPlaying = await asyncIsPlaying();
    } catch (error) {
      console.warn("套用遠端播放狀態失敗:", error);
    } finally {
      state.playbackApplyingRemote = false;
      state.playbackApplyingRemoteEventId = null;
    }
  }
'''

s = s[:start] + new_apply + s[end:]

old_snapshot = '''  function handleRemotePlaybackSnapshot(snapshot) {
    const event = snapshot?.val?.() || null;
    if (!event || !event.eventId || event.updatedBy === state.uid) return;
    void applyRemotePlaybackEvent(event);
  }
'''
new_snapshot = '''  function handleRemotePlaybackSnapshot(snapshot) {
    const event = snapshot?.val?.() || null;
    if (!event || !event.eventId || event.updatedBy === state.uid) return;
    if (state.playbackLastRemoteEventId === String(event.eventId || "")) return;
    void applyRemotePlaybackEvent(event);
  }
'''
if old_snapshot in s:
    s = s.replace(old_snapshot, new_snapshot, 1)
else:
    snap_start = s.find("  function handleRemotePlaybackSnapshot(snapshot) {")
    snap_end = s.find("\n  function attachPlaybackSyncListener()", snap_start)
    if snap_start >= 0 and snap_end >= 0:
        s = s[:snap_start] + new_snapshot + s[snap_end:]

s = s.replace(
    '    state.playbackRemoteEvent = null;\n\n    try {\n      await ref.set({',
    '    try {\n      await ref.set({',
    1,
)

if "playbackLastRemoteEventId = null" not in s:
    cleanup_marker = '''    state.playbackRemoteEvent =
      null;'''
    if cleanup_marker in s:
        s = s.replace(
            cleanup_marker,
            cleanup_marker + '''

    state.playbackLastRemoteEventId =
      null;

    state.playbackApplyingRemoteEventId =
      null;''',
            1,
        )

APP.write_text(s, encoding="utf-8")

rules = json.loads(RULES.read_text(encoding="utf-8"))
room_rule = rules["rules"]["rooms"]["$roomId"]
room_rule["playbackEvent"] = {
    ".read": "auth != null && root.child('members').child($roomId).child(auth.uid).exists()",
    ".write": "auth != null && root.child('members').child($roomId).child(auth.uid).exists() && newData.child('updatedBy').val() === auth.uid",
    ".validate": "!newData.exists() || (newData.hasChildren(['action','position','videoId','updatedAt','updatedBy','eventId','playing']) && newData.child('action').isString() && (newData.child('action').val() === 'play' || newData.child('action').val() === 'pause' || newData.child('action').val() === 'seek') && newData.child('position').isNumber() && newData.child('position').val() >= 0 && newData.child('videoId').isString() && newData.child('videoId').val().length > 0 && newData.child('videoId').val().length <= 200 && newData.child('updatedAt').isNumber() && newData.child('updatedBy').isString() && newData.child('updatedBy').val() === auth.uid && newData.child('eventId').isString() && newData.child('eventId').val().length > 0 && newData.child('eventId').val().length <= 200 && newData.child('playing').isBoolean())"
}
RULES.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("Playback repair applied.")
