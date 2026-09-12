from pathlib import Path
import json

app = Path("app.js")
rules_file = Path("database.rules.json")
s = app.read_text(encoding="utf-8")

if "function playbackSyncRef()" in s:
    print("Playback sync already present")
    raise SystemExit(0)

state_old = '''    youtubeBuildToken: 0,\n\n    queue: {},'''
state_new = '''    youtubeBuildToken: 0,\n\n    playbackListenerAttached: false,\n    playbackApplyingRemote: false,\n    playbackReadyAt: 0,\n    playbackLastPosition: null,\n    playbackLastPlaying: null,\n    playbackSeekTimer: null,\n    playbackRemoteEvent: null,\n\n    queue: {},'''
if state_old not in s:
    raise SystemExit("state anchor not found")
s = s.replace(state_old, state_new, 1)

sync_block = '''

  /*
   * =========================================================
   * EVENT-BASED PLAYBACK SYNC
   * =========================================================
   */

  function playbackSyncRef() {
    if (!db || !state.roomId) return null;
    return db.ref(`rooms/${state.roomId}/playbackEvent`);
  }

  function getExpectedPlaybackPosition(event) {
    const base = Math.max(0, Number(event?.position) || 0);
    if (!event?.playing) return base;
    const updatedAt = Number(event?.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return base;
    const elapsed = Math.max(0, (Date.now() - updatedAt) / 1000);
    return base + Math.min(elapsed, 30);
  }

  async function publishPlaybackEvent(action, position = null) {
    if (!state.uid || !state.roomId || !state.playerReady || !state.player || state.playbackApplyingRemote) return;
    if (state.playerType === "bilibili" || state.playerType === "external") return;
    const ref = playbackSyncRef();
    if (!ref || !state.currentVideoId) return;

    const normalizedAction = action === "pause" ? "pause" : action === "seek" ? "seek" : "play";
    let finalPosition = Number(position);
    if (!Number.isFinite(finalPosition)) finalPosition = await asyncCurrentPosition();
    finalPosition = Math.max(0, Number(finalPosition) || 0);

    let playing = true;
    if (normalizedAction === "pause") playing = false;
    if (normalizedAction === "seek") playing = await asyncIsPlaying();

    state.playbackRemoteEvent = null;

    try {
      await ref.set({
        action: normalizedAction,
        position: finalPosition,
        videoId: String(state.currentVideoId),
        updatedAt: firebase.database.ServerValue.TIMESTAMP,
        updatedBy: state.uid,
        eventId: `${state.uid}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        playing
      });
      state.playbackLastPosition = finalPosition;
      state.playbackLastPlaying = playing;
    } catch (error) {
      console.warn("播放同步寫入失敗:", error);
    }
  }

  async function applyRemotePlaybackEvent(event) {
    if (!event || !state.playerReady || !state.player || !state.currentVideoId) return;
    if (String(event.videoId || "") !== String(state.currentVideoId || "")) return;
    if (!["play", "pause", "seek"].includes(event.action)) return;
    if (event.updatedBy === state.uid) return;
    if (state.playerType === "bilibili" || state.playerType === "external") return;

    state.playbackRemoteEvent = event;
    state.playbackApplyingRemote = true;
    state.playbackReadyAt = Date.now() + 1200;
    try {
      const position = getExpectedPlaybackPosition(event);
      await applyPlayerPosition(position);
      if (event.playing === true) await playPlayer();
      else await pausePlayer();
      if ($("syncStatus")) $("syncStatus").textContent = `已同步 ${formatTime(position)}`;
    } catch (error) {
      console.warn("套用遠端播放狀態失敗:", error);
    } finally {
      state.playbackApplyingRemote = false;
      state.playbackLastPosition = await asyncCurrentPosition();
      state.playbackLastPlaying = await asyncIsPlaying();
    }
  }

  async function applyLatestRoomPlaybackState() {
    const ref = playbackSyncRef();
    if (!ref || !state.playerReady || !state.player || !state.currentVideoId) return;
    try {
      const event = (await ref.once("value")).val();
      if (event && event.eventId && event.updatedBy !== state.uid) await applyRemotePlaybackEvent(event);
    } catch (error) {
      console.warn("讀取最新播放狀態失敗:", error);
    }
  }

  function attachPlaybackSyncListener() {
    if (!state.roomRef || state.playbackListenerAttached) return;
    const ref = playbackSyncRef();
    if (!ref) return;
    ref.on("value", handleRemotePlaybackSnapshot);
    state.playbackListenerAttached = true;
  }

  function handleRemotePlaybackSnapshot(snapshot) {
    const event = snapshot?.val?.() || null;
    if (!event || !event.eventId || event.updatedBy === state.uid) return;
    void applyRemotePlaybackEvent(event);
  }

  function stopPlaybackSeekDetector() {
    clearInterval(state.playbackSeekTimer);
    state.playbackSeekTimer = null;
    state.playbackLastPosition = null;
    state.playbackLastPlaying = null;
  }

  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();
    state.playbackReadyAt = Date.now() + 1500;
    state.playbackSeekTimer = setInterval(async () => {
      if (!state.playerReady || !state.player || state.playbackApplyingRemote) return;
      const position = await asyncCurrentPosition();
      const playing = await asyncIsPlaying();
      const remote = state.playbackRemoteEvent;

      if (remote && remote.updatedBy !== state.uid && String(remote.videoId || "") === String(state.currentVideoId || "")) {
        const expected = getExpectedPlaybackPosition(remote);
        if (Math.abs(position - expected) > 0.85) {
          state.playbackApplyingRemote = true;
          try { await applyPlayerPosition(expected); }
          finally {
            state.playbackApplyingRemote = false;
            state.playbackLastPosition = await asyncCurrentPosition();
            state.playbackLastPlaying = await asyncIsPlaying();
          }
          return;
        }
        if (playing !== Boolean(remote.playing)) {
          state.playbackApplyingRemote = true;
          try {
            if (remote.playing) await playPlayer();
            else await pausePlayer();
          } finally { state.playbackApplyingRemote = false; }
        }
      }

      if (Date.now() < Number(state.playbackReadyAt || 0)) {
        state.playbackLastPosition = position;
        state.playbackLastPlaying = playing;
        return;
      }
      if (state.playbackLastPosition === null || state.playbackLastPlaying === null) {
        state.playbackLastPosition = position;
        state.playbackLastPlaying = playing;
        return;
      }
      if (Math.abs(position - Number(state.playbackLastPosition)) >= 1.35) void publishPlaybackEvent("seek", position);
      if (playing !== state.playbackLastPlaying) void publishPlaybackEvent(playing ? "play" : "pause", position);
      state.playbackLastPosition = position;
      state.playbackLastPlaying = playing;
    }, 750);
  }
'''
anchor = '''  /*
   * =========================================================
   * ROOM UI
   * =========================================================
   */'''
if anchor not in s: raise SystemExit("ROOM UI anchor not found")
s = s.replace(anchor, sync_block + "\n" + anchor, 1)

s = s.replace('''      await buildYoutubePlayer(\n        videoId,\n        true\n      );\n\n      return;''', '''      state.playbackRemoteEvent = null;\n      await buildYoutubePlayer(videoId, state.isOwner);\n      await applyLatestRoomPlaybackState();\n      startPlaybackSeekDetector();\n      return;''', 1)

s = s.replace('''      await buildYoutubePlayer(\n        getYoutubeId(\n          video.id\n        ) ||\n        video.id,\n        true\n      );\n\n      return;''', '''      await buildYoutubePlayer(\n        getYoutubeId(\n          video.id\n        ) ||\n        video.id,\n        state.isOwner\n      );\n      await applyLatestRoomPlaybackState();\n      startPlaybackSeekDetector();\n      return;''', 1)

s = s.replace('''          void buildYoutubePlayer(\n            id,\n            true\n          );''', '''          void buildYoutubePlayer(\n            id,\n            state.isOwner\n          );''', 1)

s = s.replace('''                  startLocalTimeUpdate();\n\n                  setTimeout(''', '''                  startLocalTimeUpdate();\n\n                  void applyLatestRoomPlaybackState();\n\n                  setTimeout(''', 1)

state_change_old = '''                  forceYoutubeVisible();\n\n                  if (\n                    event.data ===\n                    YT.PlayerState.ENDED\n                  ) {'''
state_change_new = '''                  forceYoutubeVisible();\n\n                  if (!state.playbackApplyingRemote) {\n                    if (event.data === YT.PlayerState.PLAYING) void publishPlaybackEvent("play");\n                    else if (event.data === YT.PlayerState.PAUSED) void publishPlaybackEvent("pause");\n                  }\n\n                  if (\n                    event.data ===\n                    YT.PlayerState.ENDED\n                  ) {'''
if state_change_old not in s: raise SystemExit("YouTube state anchor not found")
s = s.replace(state_change_old, state_change_new, 1)

play_old = '''          if (\n            await asyncIsPlaying()\n          ) {\n            await pausePlayer();\n          } else {\n            await playPlayer();\n          }'''
play_new = '''          if (\n            await asyncIsPlaying()\n          ) {\n            await pausePlayer();\n            void publishPlaybackEvent("pause");\n          } else {\n            await playPlayer();\n            void publishPlaybackEvent("play");\n          }'''
if play_old not in s: raise SystemExit("play/pause anchor not found")
s = s.replace(play_old, play_new, 1)

back_forward = '''          await applyPlayerPosition(\n            target\n          );'''
if s.count(back_forward) < 2: raise SystemExit("seek button anchors not found")
s = s.replace(back_forward, back_forward + '''\n\n          void publishPlaybackEvent("seek", target);''', 2)

enter_anchor = '''    if (\n      !state.videoListenerAttached\n    ) {'''
if enter_anchor not in s: raise SystemExit("enterRoom anchor not found")
s = s.replace(enter_anchor, '''    attachPlaybackSyncListener();\n\n''' + enter_anchor, 1)

initial_old = '''    if (initialVideo) {\n      await handleRoomVideo(\n        initialVideo\n      );\n    } else {'''
initial_new = '''    if (initialVideo) {\n      await handleRoomVideo(\n        initialVideo\n      );\n      await applyLatestRoomPlaybackState();\n      startPlaybackSeekDetector();\n    } else {'''
if initial_old not in s: raise SystemExit("initial video anchor not found")
s = s.replace(initial_old, initial_new, 1)

cleanup_old = '''      state.roomRef\n        ?.child("video")\n        .off();\n    } catch (_) {}'''
cleanup_new = '''      state.roomRef\n        ?.child("video")\n        .off();\n      playbackSyncRef()?.off();\n      stopPlaybackSeekDetector();\n    } catch (_) {}'''
if cleanup_old not in s: raise SystemExit("cleanup anchor not found")
s = s.replace(cleanup_old, cleanup_new, 1)

cleanup_state_old = '''    state.videoListenerAttached =\n      false;\n\n    state.membersListenerAttached ='''
cleanup_state_new = '''    state.videoListenerAttached =\n      false;\n    state.playbackListenerAttached =\n      false;\n    state.playbackApplyingRemote =\n      false;\n    state.playbackRemoteEvent =\n      null;\n\n    state.membersListenerAttached ='''
if cleanup_state_old not in s: raise SystemExit("cleanup state anchor not found")
s = s.replace(cleanup_state_old, cleanup_state_new, 1)

rules = json.loads(rules_file.read_text(encoding="utf-8"))
room = rules["rules"]["rooms"]["$roomId"]
room["playbackEvent"] = {
    ".read": "auth != null && root.child('members').child($roomId).child(auth.uid).exists()",
    ".write": "auth != null && root.child('members').child($roomId).child(auth.uid).exists() && newData.child('updatedBy').val() === auth.uid",
    ".validate": "!newData.exists() || (newData.hasChildren(['action','position','videoId','updatedAt','updatedBy','eventId','playing']) && newData.child('action').isString() && (newData.child('action').val() === 'play' || newData.child('action').val() === 'pause' || newData.child('action').val() === 'seek') && newData.child('position').isNumber() && newData.child('position').val() >= 0 && newData.child('videoId').isString() && newData.child('videoId').val().length > 0 && newData.child('videoId').val().length <= 200 && newData.child('updatedAt').isNumber() && newData.child('updatedBy').isString() && newData.child('updatedBy').val() === auth.uid && newData.child('eventId').isString() && newData.child('eventId').val().length > 0 && newData.child('eventId').val().length <= 200 && newData.child('playing').isBoolean())"
}

app.write_text(s, encoding="utf-8")
rules_file.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Playback repair v2 applied")
