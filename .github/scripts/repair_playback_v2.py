from pathlib import Path
import json

APP = Path("app.js")
RULES = Path("database.rules.json")
s = APP.read_text(encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"{label} not found")
    return text.replace(old, new, 1)


state_marker = "    playbackApplyingRemoteEventId: null,"
if "playbackIgnoreStateChanges:" not in s:
    s = replace_once(
        s,
        state_marker,
        state_marker + "\n    playbackIgnoreStateChanges: 0,\n    playbackIgnoreStateUntil: 0,",
        "playback state marker",
    )

# Replace the YouTube state-change publisher so callbacks caused by remote
# play/pause commands cannot immediately write a new Firebase event.
on_state_start = s.find("              onStateChange:\n                async (event) => {")
on_error_start = s.find("\n\n              onError:", on_state_start)
if on_state_start < 0 or on_error_start < 0:
    raise SystemExit("YouTube onStateChange boundaries not found")

new_on_state = '''              onStateChange:\n                async (event) => {\n                  if (\n                    state.youtubeBuildToken !==\n                      token\n                  ) {\n                    return;\n                  }\n\n                  if (\n                    state.player !==\n                    event.target\n                  ) {\n                    return;\n                  }\n\n                  forceYoutubeVisible();\n\n                  if (\n                    event.data === YT.PlayerState.PLAYING ||\n                    event.data === YT.PlayerState.PAUSED\n                  ) {\n                    const expectedPlaying =\n                      state.playbackRemoteEvent &&\n                      String(state.playbackRemoteEvent.videoId || "") ===\n                        String(state.currentVideoId || "")\n                        ? Boolean(state.playbackRemoteEvent.playing)\n                        : null;\n\n                    const now = Date.now();\n                    const isExpectedRemoteState =\n                      expectedPlaying !== null &&\n                      Boolean(event.data === YT.PlayerState.PLAYING) ===\n                        expectedPlaying;\n\n                    if (\n                      state.playbackApplyingRemote ||\n                      (isExpectedRemoteState &&\n                        state.playbackIgnoreStateChanges > 0 &&\n                        now < Number(state.playbackIgnoreStateUntil || 0))\n                    ) {\n                      if (\n                        !state.playbackApplyingRemote &&\n                        isExpectedRemoteState &&\n                        state.playbackIgnoreStateChanges > 0\n                      ) {\n                        state.playbackIgnoreStateChanges -= 1;\n                      }\n                    } else if (now >= Number(state.playbackIgnoreStateUntil || 0)) {\n                      state.playbackIgnoreStateChanges = 0;\n                      void publishPlaybackEvent(\n                        event.data === YT.PlayerState.PLAYING\n                          ? "play"\n                          : "pause"\n                      );\n                    }\n                  }\n\n                  if (\n                    event.data ===\n                    YT.PlayerState.ENDED\n                  ) {\n                    if (\n                      state.isOwner\n                    ) {\n                      setTimeout(\n                        async () => {\n                          await playNextQueueItem();\n                        },\n                        300\n                      );\n                    }\n                  }\n\n                  updateTimeUI();\n                },'''
s = s[:on_state_start] + new_on_state + s[on_error_start:]

# Replace remote event application with event-id dedupe plus a cooldown that
# also covers delayed YouTube callbacks after playVideo()/pauseVideo().
start = s.find("  async function applyRemotePlaybackEvent(event) {")
end = s.find("\n  async function applyLatestRoomPlaybackState()", start)
if start < 0 or end < 0:
    raise SystemExit("playback function boundaries not found")

new_apply = '''  async function applyRemotePlaybackEvent(event) {\n    if (!event || !state.playerReady || !state.player || !state.currentVideoId) return;\n    if (String(event.videoId || "") !== String(state.currentVideoId || "")) return;\n    if (!["play", "pause", "seek"].includes(event.action)) return;\n    if (event.updatedBy === state.uid) return;\n    if (state.playerType === "bilibili" || state.playerType === "external") return;\n\n    const eventId = String(event.eventId || "");\n    if (!eventId) return;\n    if (state.playbackLastRemoteEventId === eventId) return;\n    if (state.playbackApplyingRemoteEventId === eventId) return;\n\n    state.playbackLastRemoteEventId = eventId;\n    state.playbackApplyingRemoteEventId = eventId;\n    state.playbackRemoteEvent = event;\n    state.playbackApplyingRemote = true;\n    state.playbackIgnoreStateChanges = 4;\n    state.playbackIgnoreStateUntil = Date.now() + 3500;\n    state.playbackReadyAt = Date.now() + 1800;\n\n    try {\n      const position = getExpectedPlaybackPosition(event);\n      const current = await asyncCurrentPosition();\n      const difference = Math.abs(current - position);\n\n      if (difference > 0.35) {\n        await applyPlayerPosition(position);\n      }\n\n      const wantPlaying =\n        event.playing === true ||\n        (event.playing === undefined && event.action === "play");\n\n      const currentlyPlaying = await asyncIsPlaying();\n\n      if (wantPlaying !== currentlyPlaying) {\n        if (wantPlaying) {\n          await playPlayer();\n        } else {\n          await pausePlayer();\n        }\n      }\n\n      if ($("syncStatus")) {\n        $("syncStatus").textContent = `已同步 ${formatTime(position)}`;\n      }\n\n      state.playbackLastPosition = await asyncCurrentPosition();\n      state.playbackLastPlaying = await asyncIsPlaying();\n    } catch (error) {\n      console.warn("套用遠端播放狀態失敗:", error);\n    } finally {\n      state.playbackApplyingRemote = false;\n      state.playbackApplyingRemoteEventId = null;\n    }\n  }\n'''
s = s[:start] + new_apply + s[end:]

snap_start = s.find("  function handleRemotePlaybackSnapshot(snapshot) {")
snap_end = s.find("\n  function stopPlaybackSeekDetector()", snap_start)
if snap_start < 0 or snap_end < 0:
    raise SystemExit("remote snapshot boundaries not found")

new_snapshot = '''  function handleRemotePlaybackSnapshot(snapshot) {\n    const event = snapshot?.val?.() || null;\n    if (!event || !event.eventId || event.updatedBy === state.uid) return;\n    if (state.playbackLastRemoteEventId === String(event.eventId || "")) return;\n    void applyRemotePlaybackEvent(event);\n  }\n'''
s = s[:snap_start] + new_snapshot + s[snap_end:]

# Replace the detector so that it cannot fight the just-applied remote event,
# and so remote drift correction itself gets the same YouTube callback shield.
det_start = s.find("  function startPlaybackSeekDetector() {")
det_end = s.find("\n  /*\n   * =========================================================\n   * ROOM UI", det_start)
if det_start < 0 or det_end < 0:
    raise SystemExit("seek detector boundaries not found")

new_detector = '''  function startPlaybackSeekDetector() {\n    stopPlaybackSeekDetector();\n    state.playbackReadyAt = Date.now() + 1800;\n\n    state.playbackSeekTimer = setInterval(async () => {\n      if (!state.playerReady || !state.player || state.playbackApplyingRemote) return;\n\n      const position = await asyncCurrentPosition();\n      const playing = await asyncIsPlaying();\n      const remote = state.playbackRemoteEvent;\n      const now = Date.now();\n\n      if (\n        remote &&\n        remote.updatedBy !== state.uid &&\n        String(remote.videoId || "") === String(state.currentVideoId || "")\n      ) {\n        const expected = getExpectedPlaybackPosition(remote);\n\n        if (now >= Number(state.playbackReadyAt || 0)) {\n          const drift = Math.abs(position - expected);\n\n          if (drift > 1.25) {\n            state.playbackApplyingRemote = true;\n            state.playbackIgnoreStateChanges = 2;\n            state.playbackIgnoreStateUntil = Date.now() + 1800;\n\n            try {\n              await applyPlayerPosition(expected);\n            } finally {\n              state.playbackApplyingRemote = false;\n              state.playbackLastPosition = await asyncCurrentPosition();\n              state.playbackLastPlaying = await asyncIsPlaying();\n            }\n            return;\n          }\n\n          if (playing !== Boolean(remote.playing)) {\n            state.playbackApplyingRemote = true;\n            state.playbackIgnoreStateChanges = 2;\n            state.playbackIgnoreStateUntil = Date.now() + 1800;\n\n            try {\n              if (remote.playing) {\n                await playPlayer();\n              } else {\n                await pausePlayer();\n              }\n            } finally {\n              state.playbackApplyingRemote = false;\n              state.playbackLastPosition = await asyncCurrentPosition();\n              state.playbackLastPlaying = await asyncIsPlaying();\n            }\n            return;\n          }\n        }\n      }\n\n      if (now < Number(state.playbackIgnoreStateUntil || 0)) {\n        state.playbackLastPosition = position;\n        state.playbackLastPlaying = playing;\n        return;\n      }\n\n      if (now < Number(state.playbackReadyAt || 0)) {\n        state.playbackLastPosition = position;\n        state.playbackLastPlaying = playing;\n        return;\n      }\n\n      if (state.playbackLastPosition === null || state.playbackLastPlaying === null) {\n        state.playbackLastPosition = position;\n        state.playbackLastPlaying = playing;\n        return;\n      }\n\n      const positionDelta = Math.abs(\n        position - Number(state.playbackLastPosition)\n      );\n      const playingChanged =\n        playing !== state.playbackLastPlaying;\n\n      if (positionDelta >= 1.35) {\n        void publishPlaybackEvent("seek", position);\n      } else if (playingChanged) {\n        void publishPlaybackEvent(\n          playing ? "play" : "pause",\n          position\n        );\n      }\n\n      state.playbackLastPosition = position;\n      state.playbackLastPlaying = playing;\n    }, 750);\n  }\n'''
s = s[:det_start] + new_detector + s[det_end:]

# Reset the remote-event and callback shield whenever a new video loads.
new_video_reset = '''      state.playbackRemoteEvent = null;\n      state.playbackLastRemoteEventId = null;\n      state.playbackApplyingRemoteEventId = null;\n      state.playbackIgnoreStateChanges = 0;\n      state.playbackIgnoreStateUntil = 0;'''
if new_video_reset not in s:
    old_video_reset = "      state.playbackRemoteEvent = null;\n      state.playbackLastRemoteEventId = null;\n      state.playbackApplyingRemoteEventId = null;"
    s = replace_once(s, old_video_reset, new_video_reset, "video reset")

cleanup_marker = "    state.playbackApplyingRemoteEventId = null;"
cleanup_insert = cleanup_marker + "\n    state.playbackIgnoreStateChanges = 0;\n    state.playbackIgnoreStateUntil = 0;"
if "state.playbackIgnoreStateChanges =\n      0;" not in s:
    cleanup_pos = s.find("    state.playbackRemoteEvent =\n      null;", s.find("function disconnectRoomListeners"))
    if cleanup_pos < 0:
        raise SystemExit("cleanup marker not found")
    after = s.find("\n", cleanup_pos)
    # insert the two reset statements after the existing remote event id reset block
    target = "    state.playbackApplyingRemoteEventId =\n      null;"
    if target not in s:
        raise SystemExit("cleanup event id block not found")
    s = s.replace(target, target + "\n    state.playbackIgnoreStateChanges =\n      0;\n    state.playbackIgnoreStateUntil =\n      0;", 1)

APP.write_text(s, encoding="utf-8")

# Keep the stronger authorization/validation for playbackEvent already used by
# the app, while preserving all other existing rules.
rules = json.loads(RULES.read_text(encoding="utf-8"))
room = rules["rules"]["rooms"]["$roomId"]
room["playbackEvent"] = {
    ".read": "auth != null && root.child('members').child($roomId).child(auth.uid).exists()",
    ".write": "auth != null && root.child('members').child($roomId).child(auth.uid).exists() && newData.child('updatedBy').val() === auth.uid",
    ".validate": "!newData.exists() || (newData.hasChildren(['action','position','videoId','updatedAt','updatedBy','eventId','playing']) && newData.child('action').isString() && (newData.child('action').val() === 'play' || newData.child('action').val() === 'pause' || newData.child('action').val() === 'seek') && newData.child('position').isNumber() && newData.child('position').val() >= 0 && newData.child('videoId').isString() && newData.child('videoId').val().length > 0 && newData.child('videoId').val().length <= 200 && newData.child('updatedAt').isNumber() && newData.child('updatedBy').isString() && newData.child('updatedBy').val() === auth.uid && newData.child('eventId').isString() && newData.child('eventId').val().length > 0 && newData.child('eventId').val().length <= 200 && newData.child('playing').isBoolean())"
}
RULES.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Playback feedback-loop repair applied")
