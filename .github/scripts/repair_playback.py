from pathlib import Path
import json

APP = Path("app.js")
RULES = Path("database.rules.json")

s = APP.read_text(encoding="utf-8")

# Add playback state fields without duplicating them.
state_marker = '''    youtubeBuildToken: 0,\n\n    queue: {},'''
state_insert = '''    youtubeBuildToken: 0,\n\n    playbackListenerAttached: false,\n    playbackApplyingRemote: false,\n    playbackReadyAt: 0,\n    playbackLastPosition: null,\n    playbackLastPlaying: null,\n    playbackSeekTimer: null,\n    playbackRemoteEvent: null,\n    playbackLastRemoteEventId: null,\n\n    queue: {},'''
if "playbackListenerAttached" not in s:
    if state_marker not in s:
        raise SystemExit("state marker not found")
    s = s.replace(state_marker, state_insert, 1)
elif "playbackLastRemoteEventId" not in s:
    marker = "    playbackRemoteEvent: null,"
    if marker not in s:
        raise SystemExit("playbackRemoteEvent state marker not found")
    s = s.replace(marker, marker + "\n    playbackLastRemoteEventId: null,", 1)

# If an older file does not have playback sync yet, inject it.
if "function playbackSyncRef()" not in s:
    sync_block = '''\n  /*\n   * =========================================================\n   * EVENT-BASED PLAYBACK SYNC\n   * =========================================================\n   */\n\n  function playbackSyncRef() {\n    if (!db || !state.roomId) return null;\n    return db.ref(`rooms/${state.roomId}/playbackEvent`);\n  }\n\n  function getExpectedPlaybackPosition(event) {\n    const base = Math.max(0, Number(event?.position) || 0);\n    if (!event?.playing) return base;\n    const updatedAt = Number(event?.updatedAt);\n    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return base;\n    const elapsed = Math.max(0, (Date.now() - updatedAt) / 1000);\n    return base + Math.min(elapsed, 30);\n  }\n\n  async function publishPlaybackEvent(action, position = null) {\n    if (!state.uid || !state.roomId || !state.playerReady || !state.player || state.playbackApplyingRemote) return;\n    if (state.playerType === "bilibili" || state.playerType === "external") return;\n    const ref = playbackSyncRef();\n    if (!ref || !state.currentVideoId) return;\n\n    const normalizedAction = action === "pause" ? "pause" : action === "seek" ? "seek" : "play";\n    let finalPosition = Number(position);\n    if (!Number.isFinite(finalPosition)) finalPosition = await asyncCurrentPosition();\n    finalPosition = Math.max(0, Number(finalPosition) || 0);\n\n    let playing = true;\n    if (normalizedAction === "pause") playing = false;\n    if (normalizedAction === "seek") playing = await asyncIsPlaying();\n\n    state.playbackRemoteEvent = null;\n\n    try {\n      await ref.set({\n        action: normalizedAction,\n        position: finalPosition,\n        videoId: String(state.currentVideoId),\n        updatedAt: firebase.database.ServerValue.TIMESTAMP,\n        updatedBy: state.uid,\n        eventId: `${state.uid}_${Date.now()}_${Math.random().toString(36).slice(2)}`,\n        playing\n      });\n      state.playbackLastPosition = finalPosition;\n      state.playbackLastPlaying = playing;\n    } catch (error) {\n      console.warn("播放同步寫入失敗:", error);\n    }\n  }\n\n  async function applyRemotePlaybackEvent(event) {\n    if (!event || !state.playerReady || !state.player || !state.currentVideoId) return;\n    if (String(event.videoId || "") !== String(state.currentVideoId || "")) return;\n    if (!["play", "pause", "seek"].includes(event.action)) return;\n    if (event.updatedBy === state.uid) return;\n    if (event.eventId && event.eventId === state.playbackLastRemoteEventId) return;\n    if (state.playerType === "bilibili" || state.playerType === "external") return;\n\n    state.playbackLastRemoteEventId = event.eventId || null;\n    state.playbackRemoteEvent = event;\n    state.playbackApplyingRemote = true;\n    state.playbackReadyAt = Date.now() + 1200;\n    try {\n      const position = getExpectedPlaybackPosition(event);\n      await applyPlayerPosition(position);\n      if (event.playing === true) await playPlayer();\n      else await pausePlayer();\n      if ($("syncStatus")) $("syncStatus").textContent = `已同步 ${formatTime(position)}`;\n    } catch (error) {\n      console.warn("套用遠端播放狀態失敗:", error);\n    } finally {\n      state.playbackApplyingRemote = false;\n      state.playbackLastPosition = await asyncCurrentPosition();\n      state.playbackLastPlaying = await asyncIsPlaying();\n    }\n  }\n\n  async function applyLatestRoomPlaybackState() {\n    const ref = playbackSyncRef();\n    if (!ref || !state.playerReady || !state.player || !state.currentVideoId) return;\n    try {\n      const event = (await ref.once("value")).val();\n      if (event && event.eventId && event.updatedBy !== state.uid) await applyRemotePlaybackEvent(event);\n    } catch (error) {\n      console.warn("讀取最新播放狀態失敗:", error);\n    }\n  }\n\n  function handleRemotePlaybackSnapshot(snapshot) {\n    const event = snapshot?.val?.() || null;\n    if (!event || !event.eventId || event.updatedBy === state.uid) return;\n    void applyRemotePlaybackEvent(event);\n  }\n\n  function attachPlaybackSyncListener() {\n    if (!state.roomRef || state.playbackListenerAttached) return;\n    const ref = playbackSyncRef();\n    if (!ref) return;\n    ref.on("value", handleRemotePlaybackSnapshot);\n    state.playbackListenerAttached = true;\n  }\n\n  function stopPlaybackSeekDetector() {\n    clearInterval(state.playbackSeekTimer);\n    state.playbackSeekTimer = null;\n    state.playbackLastPosition = null;\n    state.playbackLastPlaying = null;\n  }\n\n  function startPlaybackSeekDetector() {\n    stopPlaybackSeekDetector();\n    state.playbackReadyAt = Date.now() + 1500;\n    state.playbackSeekTimer = setInterval(async () => {\n      if (!state.playerReady || !state.player || state.playbackApplyingRemote) return;\n      const position = await asyncCurrentPosition();\n      const playing = await asyncIsPlaying();\n      const remote = state.playbackRemoteEvent;\n\n      if (remote && remote.updatedBy !== state.uid && String(remote.videoId || "") === String(state.currentVideoId || "")) {\n        const expected = getExpectedPlaybackPosition(remote);\n        if (Math.abs(position - expected) > 0.85) {\n          state.playbackApplyingRemote = true;\n          try { await applyPlayerPosition(expected); }\n          finally {\n            state.playbackApplyingRemote = false;\n            state.playbackLastPosition = await asyncCurrentPosition();\n            state.playbackLastPlaying = await asyncIsPlaying();\n          }\n          return;\n        }\n        if (playing !== Boolean(remote.playing)) {\n          state.playbackApplyingRemote = true;\n          try {\n            if (remote.playing) await playPlayer();\n            else await pausePlayer();\n          } finally { state.playbackApplyingRemote = false; }\n        }\n      }\n\n      if (Date.now() < Number(state.playbackReadyAt || 0)) {\n        state.playbackLastPosition = position;\n        state.playbackLastPlaying = playing;\n        return;\n      }\n      if (state.playbackLastPosition === null || state.playbackLastPlaying === null) {\n        state.playbackLastPosition = position;\n        state.playbackLastPlaying = playing;\n        return;\n      }\n      if (Math.abs(position - Number(state.playbackLastPosition)) >= 1.35) void publishPlaybackEvent("seek", position);\n      if (playing !== state.playbackLastPlaying) void publishPlaybackEvent(playing ? "play" : "pause", position);\n      state.playbackLastPosition = position;\n      state.playbackLastPlaying = playing;\n    }, 750);\n  }\n\n'''
    anchor = '''  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */'''
    if anchor not in s:
        raise SystemExit("ROOM UI anchor not found")
    s = s.replace(anchor, sync_block + anchor, 1)

# Existing sync implementation: add strict event de-duplication.
if "state.playbackLastRemoteEventId" not in s:
    raise SystemExit("playbackLastRemoteEventId missing after state setup")
old = '''    if (event.updatedBy === state.uid) return;\n    if (state.playerType === "bilibili" || state.playerType === "external") return;\n\n    state.playbackRemoteEvent = event;'''
new = '''    if (event.updatedBy === state.uid) return;\n    if (event.eventId && event.eventId === state.playbackLastRemoteEventId) return;\n    if (state.playerType === "bilibili" || state.playerType === "external") return;\n\n    state.playbackLastRemoteEventId = event.eventId || null;\n    state.playbackRemoteEvent = event;'''
if old in s:
    s = s.replace(old, new, 1)

# Never clear the remote reference just because a local playback command is published;
# only update the dedupe id from a new remote event.
s = s.replace('    state.playbackRemoteEvent = null;\n\n    try {\n      await ref.set({', '    try {\n      await ref.set({', 1)

# Reset dedupe when changing the actual room video.
old = '''      state.playbackRemoteEvent = null;\n      await buildYoutubePlayer(videoId, state.isOwner);'''
new = '''      state.playbackRemoteEvent = null;\n      state.playbackLastRemoteEventId = null;\n      await buildYoutubePlayer(videoId, state.isOwner);'''
if old in s:
    s = s.replace(old, new, 1)

# Reset dedupe on cleanup.
old = '''    state.playbackRemoteEvent =\n      null;\n\n    state.membersListenerAttached ='''
new = '''    state.playbackRemoteEvent =\n      null;\n\n    state.playbackLastRemoteEventId =\n      null;\n\n    state.membersListenerAttached ='''
if old in s:
    s = s.replace(old, new, 1)

# Firebase Rules for playbackEvent.
rules = json.loads(RULES.read_text(encoding="utf-8"))
room_rule = rules["rules"]["rooms"]["$roomId"]
room_rule["playbackEvent"] = {
    ".read": "auth != null && root.child('members').child($roomId).child(auth.uid).exists()",
    ".write": "auth != null && root.child('members').child($roomId).child(auth.uid).exists() && newData.child('updatedBy').val() === auth.uid",
    ".validate": "!newData.exists() || (newData.hasChildren(['action','position','videoId','updatedAt','updatedBy','eventId','playing']) && newData.child('action').isString() && (newData.child('action').val() === 'play' || newData.child('action').val() === 'pause' || newData.child('action').val() === 'seek') && newData.child('position').isNumber() && newData.child('position').val() >= 0 && newData.child('videoId').isString() && newData.child('videoId').val().length > 0 && newData.child('videoId').val().length <= 200 && newData.child('updatedAt').isNumber() && newData.child('updatedBy').isString() && newData.child('updatedBy').val() === auth.uid && newData.child('eventId').isString() && newData.child('eventId').val().length > 0 && newData.child('eventId').val().length <= 200 && newData.child('playing').isBoolean())"
}

APP.write_text(s, encoding="utf-8")
RULES.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

print("Playback repair applied.")
