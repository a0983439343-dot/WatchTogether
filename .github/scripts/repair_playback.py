from pathlib import Path
import json

APP = Path("app.js")
RULES = Path("database.rules.json")

s = APP.read_text(encoding="utf-8")

state_marker = '''    youtubeBuildToken: 0,\n\n    queue: {},'''
state_insert = '''    youtubeBuildToken: 0,\n\n    playbackListenerAttached: false,\n    playbackApplyingRemote: false,\n    playbackReadyAt: 0,\n    playbackLastPosition: null,\n    playbackLastPlaying: null,\n    playbackSeekTimer: null,\n    playbackRemoteEvent: null,\n\n    queue: {},'''
if "playbackListenerAttached" not in s:
    if state_marker not in s:
        raise SystemExit("state marker not found")
    s = s.replace(state_marker, state_insert, 1)

sync_block = r'''\n  /*\n   * =========================================================\n   * EVENT-BASED PLAYBACK SYNC\n   * =========================================================\n   */\n\n  function playbackSyncRef() {\n    if (!db || !state.roomId) {\n      return null;\n    }\n\n    return db.ref(\n      `rooms/${state.roomId}/playbackEvent`\n    );\n  }\n\n  function getExpectedPlaybackPosition(event) {\n    const base = Math.max(\n      0,\n      Number(event?.position) || 0\n    );\n\n    if (!event?.playing) {\n      return base;\n    }\n\n    const updatedAt = Number(event?.updatedAt);\n    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {\n      return base;\n    }\n\n    const elapsed = Math.max(\n      0,\n      (Date.now() - updatedAt) / 1000\n    );\n\n    return base + Math.min(elapsed, 30);\n  }\n\n  async function publishPlaybackEvent(action, position = null) {\n    if (\n      !state.uid ||\n      !state.roomId ||\n      !state.playerReady ||\n      !state.player ||\n      state.playbackApplyingRemote\n    ) {\n      return;\n    }\n\n    if (\n      state.playerType === "bilibili" ||\n      state.playerType === "external"\n    ) {\n      return;\n    }\n\n    const ref = playbackSyncRef();\n    if (!ref || !state.currentVideoId) {\n      return;\n    }\n\n    const normalizedAction =\n      action === "pause"\n        ? "pause"\n        : action === "seek"\n          ? "seek"\n          : "play";\n\n    let finalPosition = Number(position);\n    if (!Number.isFinite(finalPosition)) {\n      finalPosition = await asyncCurrentPosition();\n    }\n    finalPosition = Math.max(0, Number(finalPosition) || 0);\n\n    let playing;\n    if (normalizedAction === "play") {\n      playing = true;\n    } else if (normalizedAction === "pause") {\n      playing = false;\n    } else {\n      playing = await asyncIsPlaying();\n    }\n\n    state.playbackRemoteEvent = null;\n\n    try {\n      await ref.set({\n        action: normalizedAction,\n        position: finalPosition,\n        videoId: String(state.currentVideoId),\n        updatedAt: firebase.database.ServerValue.TIMESTAMP,\n        updatedBy: state.uid,\n        eventId: `${state.uid}_${Date.now()}_${Math.random().toString(36).slice(2)}`,\n        playing\n      });\n\n      state.playbackLastPosition = finalPosition;\n      state.playbackLastPlaying = playing;\n    } catch (error) {\n      console.warn("播放同步寫入失敗:", error);\n    }\n  }\n\n  async function applyRemotePlaybackEvent(event) {\n    if (\n      !event ||\n      !state.playerReady ||\n      !state.player ||\n      !state.currentVideoId\n    ) {\n      return;\n    }\n\n    if (\n      String(event.videoId || "") !==\n      String(state.currentVideoId || "")\n    ) {\n      return;\n    }\n\n    if (\n      event.action !== "play" &&\n      event.action !== "pause" &&\n      event.action !== "seek"\n    ) {\n      return;\n    }\n\n    if (\n      event.updatedBy &&\n      event.updatedBy === state.uid\n    ) {\n      return;\n    }\n\n    if (\n      state.playerType === "bilibili" ||\n      state.playerType === "external"\n    ) {\n      return;\n    }\n\n    state.playbackRemoteEvent = event;\n    state.playbackApplyingRemote = true;\n    state.playbackReadyAt = Date.now() + 1200;\n\n    try {\n      const position = getExpectedPlaybackPosition(event);\n      await applyPlayerPosition(position);\n\n      if (event.playing === true) {\n        await playPlayer();\n      } else {\n        await pausePlayer();\n      }\n\n      if ($("syncStatus")) {\n        $("syncStatus").textContent =\n          `已同步 ${formatTime(position)}`;\n      }\n    } catch (error) {\n      console.warn("套用遠端播放狀態失敗:", error);\n    } finally {\n      state.playbackApplyingRemote = false;\n      state.playbackLastPosition = await asyncCurrentPosition();\n      state.playbackLastPlaying = await asyncIsPlaying();\n    }\n  }\n\n  async function applyLatestRoomPlaybackState() {\n    const ref = playbackSyncRef();\n    if (!ref || !state.playerReady || !state.player) {\n      return;\n    }\n\n    try {\n      const snapshot = await ref.once("value");\n      const event = snapshot.val();\n      if (!event || event.updatedBy === state.uid) {\n        return;\n      }\n      await applyRemotePlaybackEvent(event);\n    } catch (error) {\n      console.warn("讀取初始播放狀態失敗:", error);\n    }\n  }\n\n  function handleRemotePlaybackSnapshot(snapshot) {\n    const event = snapshot?.val?.() || null;\n    if (!event || !event.eventId || event.updatedBy === state.uid) {\n      return;\n    }\n    void applyRemotePlaybackEvent(event);\n  }\n\n  function attachPlaybackSyncListener() {\n    if (!state.roomRef || state.playbackListenerAttached) {\n      return;\n    }\n\n    const ref = playbackSyncRef();\n    if (!ref) {\n      return;\n    }\n\n    ref.on("value", handleRemotePlaybackSnapshot);\n    state.playbackListenerAttached = true;\n  }\n\n  function stopPlaybackSeekDetector() {\n    clearInterval(state.playbackSeekTimer);\n    state.playbackSeekTimer = null;\n    state.playbackLastPosition = null;\n    state.playbackLastPlaying = null;\n  }\n\n  function startPlaybackSeekDetector() {\n    stopPlaybackSeekDetector();\n    state.playbackReadyAt = Date.now() + 1500;\n\n    state.playbackSeekTimer = setInterval(async () => {\n      if (\n        !state.playerReady ||\n        !state.player ||\n        state.playbackApplyingRemote\n      ) {\n        return;\n      }\n\n      const position = await asyncCurrentPosition();\n      const playing = await asyncIsPlaying();\n\n      const remote = state.playbackRemoteEvent;\n      if (\n        remote &&\n        remote.updatedBy !== state.uid &&\n        String(remote.videoId || "") === String(state.currentVideoId || "")\n      ) {\n        const expected = getExpectedPlaybackPosition(remote);\n        const drift = Math.abs(position - expected);\n\n        if (drift > 0.85) {\n          state.playbackApplyingRemote = true;\n          try {\n            await applyPlayerPosition(expected);\n          } finally {\n            state.playbackApplyingRemote = false;\n            state.playbackLastPosition = await asyncCurrentPosition();\n            state.playbackLastPlaying = await asyncIsPlaying();\n          }\n          return;\n        }\n\n        if (playing !== Boolean(remote.playing)) {\n          state.playbackApplyingRemote = true;\n          try {\n            if (remote.playing) {\n              await playPlayer();\n            } else {\n              await pausePlayer();\n            }\n          } finally {\n            state.playbackApplyingRemote = false;\n          }\n        }\n      }\n\n      if (Date.now() < Number(state.playbackReadyAt || 0)) {\n        state.playbackLastPosition = position;\n        state.playbackLastPlaying = playing;\n        return;\n      }\n\n      if (\n        state.playbackLastPosition === null ||\n        state.playbackLastPlaying === null\n      ) {\n        state.playbackLastPosition = position;\n        state.playbackLastPlaying = playing;\n        return;\n      }\n\n      const delta = position - Number(state.playbackLastPosition);\n      if (Math.abs(delta) >= 1.35) {\n        void publishPlaybackEvent("seek", position);\n      }\n\n      if (playing !== state.playbackLastPlaying) {\n        void publishPlaybackEvent(\n          playing ? "play" : "pause",\n          position\n        );\n      }\n\n      state.playbackLastPosition = position;\n      state.playbackLastPlaying = playing;\n    }, 750);\n  }\n\n'''
if "function playbackSyncRef()" not in s:
    anchor = '''  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */'''
    if anchor not in s:
        raise SystemExit("ROOM UI anchor not found")
    s = s.replace(anchor, sync_block + anchor, 1)

# YouTube room loading should not autoplay for members.
old = '''      await buildYoutubePlayer(\n        videoId,\n        true\n      );\n\n      return;'''
new = '''      state.playbackRemoteEvent = null;\n\n      await buildYoutubePlayer(\n        videoId,\n        state.isOwner\n      );\n\n      await applyLatestRoomPlaybackState();\n      startPlaybackSeekDetector();\n\n      return;'''
if old not in s:
    raise SystemExit("handleRoomVideo YouTube block not found")
s = s.replace(old, new, 1)

# Generic YouTube route.
old = '''      await buildYoutubePlayer(\n        getYoutubeId(\n          video.id\n        ) ||\n        video.id,\n        true\n      );'''
new = '''      await buildYoutubePlayer(\n        getYoutubeId(\n          video.id\n        ) ||\n        video.id,\n        state.isOwner\n      );\n\n      await applyLatestRoomPlaybackState();\n      startPlaybackSeekDetector();'''
if old not in s:
    raise SystemExit("generic YouTube route not found")
s = s.replace(old, new, 1)

# YouTube API callback.
old = '''          void buildYoutubePlayer(\n            id,\n            true\n          );'''
new = '''          void buildYoutubePlayer(\n            id,\n            state.isOwner\n          );'''
if old not in s:
    raise SystemExit("YouTube callback block not found")
s = s.replace(old, new, 1)

# Add remote-sync call when YouTube becomes ready.
old = '''                  startLocalTimeUpdate();\n\n                  setTimeout('''
new = '''                  startLocalTimeUpdate();\n\n                  void applyLatestRoomPlaybackState();\n\n                  setTimeout('''
if old not in s:
    raise SystemExit("YouTube onReady anchor not found")
s = s.replace(old, new, 1)

# Replace YouTube onStateChange body portion with guarded play/pause publishing while preserving END behavior.
old = '''                  if (\n                    event.data ===\n                    YT.PlayerState.ENDED\n                  ) {\n                    if (\n                      state.isOwner\n                    ) {\n                      setTimeout(\n                        async () => {\n                          await playNextQueueItem();\n                        },\n                        300\n                      );\n                    }\n                  }\n\n                  updateTimeUI();'''
new = '''                  if (\n                    event.data ===\n                    YT.PlayerState.ENDED\n                  ) {\n                    if (\n                      state.isOwner\n                    ) {\n                      setTimeout(\n                        async () => {\n                          await playNextQueueItem();\n                        },\n                        300\n                      );\n                    }\n                  } else if (!state.playbackApplyingRemote) {\n                    if (event.data === YT.PlayerState.PLAYING) {\n                      void publishPlaybackEvent("play");\n                    } else if (event.data === YT.PlayerState.PAUSED) {\n                      void publishPlaybackEvent("pause");\n                    }\n                  }\n\n                  updateTimeUI();'''
if old not in s:
    raise SystemExit("YouTube onStateChange block not found")
s = s.replace(old, new, 1)

# Play/pause button: direct publish fallback for non-YouTube providers too.
old = '''          if (\n            await asyncIsPlaying()\n          ) {\n            await pausePlayer();\n          } else {\n            await playPlayer();\n          }\n\n          updateTimeUI();'''
new = '''          if (\n            await asyncIsPlaying()\n          ) {\n            await pausePlayer();\n            void publishPlaybackEvent("pause");\n          } else {\n            await playPlayer();\n            void publishPlaybackEvent("play");\n          }\n\n          updateTimeUI();'''
if old not in s:
    raise SystemExit("playPause handler block not found")
s = s.replace(old, new, 1)

# Back button.
old = '''          await applyPlayerPosition(\n            target\n          );'''
new = '''          await applyPlayerPosition(\n            target\n          );\n\n          void publishPlaybackEvent(\n            "seek",\n            target\n          );'''
# Only first occurrence is back button.
s = s.replace(old, new, 1)

# Forward button (next occurrence).
s = s.replace(old, new, 1)

# Attach playback listener before initial video handling and apply after initial player build.
old = '''    if (\n      !state.videoListenerAttached\n    ) {'''
new = '''    attachPlaybackSyncListener();\n\n    if (\n      !state.videoListenerAttached\n    ) {'''
if old not in s:
    raise SystemExit("enterRoom video listener anchor not found")
s = s.replace(old, new, 1)

old = '''    if (initialVideo) {\n      await handleRoomVideo(\n        initialVideo\n      );\n    } else {'''
new = '''    if (initialVideo) {\n      await handleRoomVideo(\n        initialVideo\n      );\n      await applyLatestRoomPlaybackState();\n      startPlaybackSeekDetector();\n    } else {'''
if old not in s:
    raise SystemExit("initialVideo block not found")
s = s.replace(old, new, 1)

# Cleanup.
old = '''      state.roomRef\n        ?.child("video")\n        .off();\n    } catch (_) {}\n\n    state.videoListenerAttached ='''
new = '''      state.roomRef\n        ?.child("video")\n        .off();\n\n      playbackSyncRef()?.off();\n      stopPlaybackSeekDetector();\n    } catch (_) {}\n\n    state.videoListenerAttached ='''
if old not in s:
    raise SystemExit("cleanup block not found")
s = s.replace(old, new, 1)

old = '''    state.videoListenerAttached =\n      false;\n\n    state.membersListenerAttached ='''
new = '''    state.videoListenerAttached =\n      false;\n\n    state.playbackListenerAttached =\n      false;\n\n    state.playbackApplyingRemote =\n      false;\n\n    state.playbackRemoteEvent =\n      null;\n\n    state.membersListenerAttached ='''
if old not in s:
    raise SystemExit("cleanup state reset anchor not found")
s = s.replace(old, new, 1)

# beforeunload cleanup.
old = '''      clearInterval(\n        state.memberHeartbeatTimer\n      );\n\n      unlockPageScroll();'''
new = '''      clearInterval(\n        state.memberHeartbeatTimer\n      );\n\n      playbackSyncRef()?.off();\n      stopPlaybackSeekDetector();\n\n      unlockPageScroll();'''
if old not in s:
    raise SystemExit("beforeunload block not found")
s = s.replace(old, new, 1)

# Add playbackEvent rules safely via JSON mutation.
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
