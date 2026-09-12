from pathlib import Path
import re

APP = Path('app.js')
s = APP.read_text(encoding='utf-8')

if 'WATCHTOGETHER_UNIFIED_SYNC_V4' in s:
    print('Sync V4 already applied')
    raise SystemExit(0)

state_marker = '    playbackRecoveryTimer: null,\n'
state_add = '''    playbackServerTimeOffset: 0,\n    playbackServerClockHandler: null,\n    playbackActionSeq: 0,\n    playbackPendingRecovery: false,\n'''
if 'playbackServerTimeOffset: 0' not in s:
    if state_marker not in s:
        raise SystemExit('state marker not found')
    s = s.replace(state_marker, state_marker + state_add, 1)

start_marker = '  /*\n   * =========================================================\n   * SHARED ROOM TIMELINE PLAYBACK SYNC\n   * =========================================================\n'
end_marker = '  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */\n'
start = s.find(start_marker)
end = s.find(end_marker, start + len(start_marker))
if start < 0 or end < 0:
    raise SystemExit('playback section markers not found')

sync = r'''  /*
   * =========================================================
   * SHARED ROOM TIMELINE PLAYBACK SYNC
   * WATCHTOGETHER_UNIFIED_SYNC_V4
   * =========================================================
   *
   * 房間本身是唯一的同步來源，不指定任何成員為主機。
   * updatedAt 使用 Firebase server clock offset 估算的伺服器時間，
   * 接收端用 position + (serverNow - updatedAt) 算目前應在秒數，
   * 因此網路來回延遲不會直接變成播放落差。
   */

  function playbackSyncRef() {
    if (!db || !state.roomId) return null;
    return db.ref(`rooms/${state.roomId}/playbackEvent`);
  }

  function getServerNow() {
    return Date.now() + Number(state.playbackServerTimeOffset || 0);
  }

  function attachServerClockSync() {
    if (!db) return;

    const ref = db.ref('.info/serverTimeOffset');
    const handler = (snapshot) => {
      const offset = Number(snapshot.val());
      if (Number.isFinite(offset)) {
        state.playbackServerTimeOffset = offset;
      }
    };

    if (state.playbackServerClockHandler) {
      ref.off('value', state.playbackServerClockHandler);
    }

    state.playbackServerClockHandler = handler;
    ref.on('value', handler);
  }

  function getTimelinePosition(event, now = getServerNow()) {
    const base = Math.max(0, Number(event?.position) || 0);
    if (event?.playing !== true) return base;

    const updatedAt = Number(event?.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return base;

    return base + Math.min(
      Math.max(0, (now - updatedAt) / 1000),
      7200
    );
  }

  function rememberRoomTimeline(event) {
    if (!event?.eventId) return;

    state.playbackRemoteEvent = event;
    state.playbackTimeline = {
      videoId: String(event.videoId || ''),
      position: Math.max(0, Number(event.position) || 0),
      playing: event.playing === true,
      updatedAt: Number(event.updatedAt) || getServerNow(),
      eventId: String(event.eventId)
    };
  }

  async function readRoomPlaybackEvent() {
    const ref = playbackSyncRef();
    if (!ref) return null;

    const snapshot = await ref.once('value');
    const event = snapshot.val();
    if (!event?.eventId) return null;

    rememberRoomTimeline(event);
    return event;
  }

  async function writePlaybackCommand(action, position, playing) {
    if (
      !state.uid ||
      !state.roomId ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId ||
      state.playbackApplyingRemote
    ) {
      return false;
    }

    if (state.playerType === 'bilibili' || state.playerType === 'external') {
      return false;
    }

    const ref = playbackSyncRef();
    if (!ref) return false;

    const actionAt = getServerNow();
    const eventId = `${state.uid}_${actionAt}_${++state.playbackActionSeq}`;
    const event = {
      action,
      position: Math.max(0, Number(position) || 0),
      videoId: String(state.currentVideoId),
      updatedAt: actionAt,
      updatedBy: state.uid,
      eventId,
      playing: Boolean(playing)
    };

    try {
      await ref.set(event);

      rememberRoomTimeline(event);
      state.playbackLastRemoteEventId = eventId;
      state.playbackLastRemoteUpdatedAt = actionAt;
      state.playbackLastPosition = event.position;
      state.playbackLastPlaying = event.playing;
      state.playbackIgnoreStateChanges = 8;
      state.playbackIgnoreStateUntil = Date.now() + 2500;
      state.playbackReadyAt = Date.now() + 600;
      return true;
    } catch (error) {
      console.warn('播放同步寫入失敗:', error);
      return false;
    }
  }

  async function publishPlaybackEvent(action, position = null, forcedPlaying = null) {
    if (!state.playerReady || !state.player || !state.currentVideoId) return false;

    let finalPosition = Number(position);
    if (!Number.isFinite(finalPosition)) {
      finalPosition = await asyncCurrentPosition();
    }

    let playing = forcedPlaying;
    if (playing === null) {
      playing = await asyncIsPlaying();
    }

    return writePlaybackCommand(
      action === 'pause' ? 'pause' : action === 'seek' ? 'seek' : 'play',
      finalPosition,
      playing === true
    );
  }

  async function applyRemotePlaybackEvent(event, force = false) {
    if (
      !event ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId
    ) return;

    if (String(event.videoId || '') !== String(state.currentVideoId || '')) return;
    if (!['play', 'pause', 'seek'].includes(event.action)) return;
    if (event.updatedBy === state.uid && !force) {
      rememberRoomTimeline(event);
      return;
    }

    if (state.playerType === 'bilibili' || state.playerType === 'external') return;

    const eventId = String(event.eventId || '');
    const updatedAt = Number(event.updatedAt || 0);
    const lastUpdatedAt = Number(state.playbackLastRemoteUpdatedAt || 0);

    if (!force && state.playbackLastRemoteEventId === eventId) return;
    if (!force && updatedAt > 0 && lastUpdatedAt > 0 && updatedAt < lastUpdatedAt) return;

    rememberRoomTimeline(event);
    state.playbackLastRemoteEventId = eventId;
    state.playbackLastRemoteUpdatedAt = updatedAt || state.playbackLastRemoteUpdatedAt;
    state.playbackApplyingRemote = true;
    state.playbackApplyingRemoteEventId = eventId;
    state.playbackIgnoreStateChanges = 8;
    state.playbackIgnoreStateUntil = Date.now() + 3500;
    state.playbackReadyAt = Date.now() + 800;

    try {
      const targetPosition = getTimelinePosition(event, getServerNow());
      const currentPosition = await asyncCurrentPosition();

      if (!Number.isFinite(currentPosition) || Math.abs(currentPosition - targetPosition) > 0.6) {
        await applyPlayerPosition(targetPosition);
      }

      const wantPlaying = event.playing === true;
      const currentlyPlaying = await asyncIsPlaying();

      if (wantPlaying !== currentlyPlaying) {
        if (wantPlaying) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      }

      state.playbackLastPosition = await asyncCurrentPosition();
      state.playbackLastPlaying = await asyncIsPlaying();

      if ($('syncStatus')) {
        $('syncStatus').textContent = `已同步 ${formatTime(targetPosition)}`;
      }
    } catch (error) {
      console.warn('套用房間播放時間軸失敗:', error);
    } finally {
      state.playbackApplyingRemote = false;
      state.playbackApplyingRemoteEventId = null;
    }
  }

  async function applyLatestRoomPlaybackState(force = false) {
    const event = await readRoomPlaybackEvent();
    if (!event) return;
    if (event.updatedBy === state.uid && !force) return;
    await applyRemotePlaybackEvent(event, force);
  }

  function attachPlaybackSyncListener() {
    if (!state.roomRef || state.playbackListenerAttached) return;

    const ref = playbackSyncRef();
    if (!ref) return;

    ref.on('value', (snapshot) => {
      const event = snapshot?.val?.() || null;
      if (!event?.eventId) return;
      rememberRoomTimeline(event);
      if (event.updatedBy === state.uid) return;
      void applyRemotePlaybackEvent(event);
    });

    state.playbackListenerAttached = true;
  }

  function stopPlaybackSeekDetector() {
    clearInterval(state.playbackSeekTimer);
    state.playbackSeekTimer = null;
    state.playbackLastPosition = null;
    state.playbackLastPlaying = null;
    state.playbackLastPlayerState = null;
    state.playbackLastObservedPosition = null;
  }

  async function reconcileRoomTimeline() {
    if (
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId ||
      state.playbackApplyingRemote
    ) return;

    const timeline = state.playbackTimeline;
    if (!timeline || String(timeline.videoId || '') !== String(state.currentVideoId || '')) return;

    const position = await asyncCurrentPosition();
    const playing = await asyncIsPlaying();
    const expected = getTimelinePosition(timeline, getServerNow());

    if (
      Date.now() < Number(state.playbackReadyAt || 0) ||
      Date.now() < Number(state.playbackIgnoreStateUntil || 0)
    ) return;

    const drift = Math.abs(position - expected);

    if (drift > 1.35) {
      state.playbackApplyingRemote = true;
      state.playbackIgnoreStateChanges = 5;
      state.playbackIgnoreStateUntil = Date.now() + 2200;

      try {
        await applyPlayerPosition(expected);
      } finally {
        state.playbackApplyingRemote = false;
      }

      return;
    }

    if ((timeline.playing === true) !== playing) {
      state.playbackApplyingRemote = true;
      state.playbackIgnoreStateChanges = 5;
      state.playbackIgnoreStateUntil = Date.now() + 2200;

      try {
        if (timeline.playing === true) await playPlayer();
        else await pausePlayer();
      } finally {
        state.playbackApplyingRemote = false;
      }
    }

    state.playbackLastPosition = position;
    state.playbackLastPlaying = playing;
    state.playbackLastObservedPosition = position;
  }

  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();
    state.playbackReadyAt = Date.now() + 900;

    state.playbackSeekTimer = setInterval(async () => {
      try {
        if (!state.playerReady || !state.player || !state.currentVideoId) return;
        await reconcileRoomTimeline();
      } catch (error) {
        console.warn('播放時間軸校正失敗:', error);
      }
    }, 750);
  }

  async function resyncAfterResume() {
    if (
      document.visibilityState === 'hidden' ||
      !state.roomId ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId
    ) return;

    clearTimeout(state.playbackRecoveryTimer);
    state.playbackRecoveryTimer = setTimeout(async () => {
      state.playbackRecoveryTimer = null;
      try {
        await applyLatestRoomPlaybackState(true);
        await reconcileRoomTimeline();
        startPlaybackSeekDetector();
      } catch (error) {
        console.warn('頁面恢復後同步失敗:', error);
      }
    }, 300);
  }

'''

s = s[:start] + sync + s[end:]

# Replace YouTube state-change handling with a conservative observer.
state_start = s.find('              onStateChange:\n                async (event) => {')
state_end = s.find('              onError:', state_start)
if state_start < 0 or state_end < 0:
    raise SystemExit('YouTube state handler markers not found')

handler = r'''              onStateChange:
                async (event) => {
                  if (
                    state.youtubeBuildToken !== token ||
                    state.player !== event.target
                  ) {
                    return;
                  }

                  forceYoutubeVisible();

                  if (event.data === YT.PlayerState.BUFFERING) {
                    state.playbackLastPlayerState = 'buffering';
                    updateTimeUI();
                    return;
                  }

                  if (
                    event.data === YT.PlayerState.PLAYING ||
                    event.data === YT.PlayerState.PAUSED
                  ) {
                    const isPlaying =
                      event.data === YT.PlayerState.PLAYING;

                    state.playbackLastPlayerState =
                      isPlaying ? 'playing' : 'paused';
                    state.playbackLastObservedPosition =
                      await asyncCurrentPosition();

                    if (
                      state.playbackApplyingRemote ||
                      Date.now() < Number(state.playbackIgnoreStateUntil || 0)
                    ) {
                      updateTimeUI();
                      return;
                    }

                    /*
                     * 不把 YouTube 廣告/緩衝的 iframe 狀態直接寫回房間。
                     * 播放同步由本站自己的播放/暫停控制與 seek 按鈕寫入。
                     */
                    updateTimeUI();
                    return;
                  }

                  if (event.data === YT.PlayerState.ENDED) {
                    if (state.isOwner) {
                      setTimeout(async () => {
                        await playNextQueueItem();
                      }, 300);
                    }
                  }

                  updateTimeUI();
                },

'''
s = s[:state_start] + handler + s[state_end:]

# Ensure server clock sync when entering a room.
enter_marker = '  async function enterRoom() {\n'
if '    attachServerClockSync();\n' not in s:
    if enter_marker not in s:
        raise SystemExit('enterRoom marker not found')
    s = s.replace(enter_marker, enter_marker + '    attachServerClockSync();\n', 1)

# Make late join / freshly loaded player apply room timeline from onReady.
onready_marker = '                  startLocalTimeUpdate();\n\n\n                  setTimeout(\n'
if onready_marker in s and 'await applyLatestRoomPlaybackState(true);' not in s[s.find('onReady:'):s.find('onStateChange:')]:
    s = s.replace(
        onready_marker,
        '                  startLocalTimeUpdate();\n\n                  setTimeout(async () => {\n                    try {\n                      await applyLatestRoomPlaybackState(true);\n                      startPlaybackSeekDetector();\n                    } catch (error) {\n                      console.warn("播放器就緒後同步失敗:", error);\n                    }\n                  }, 250);\n\n\n                  setTimeout(\n',
        1
    )

# Native custom controls are authoritative room commands.
play_marker = '    $("playPauseBtn")\n      ?.addEventListener(\n        "click",\n        async () => {'
play_start = s.find(play_marker)
play_end = s.find('    /*\n     * BACK\n', play_start)
if play_start < 0 or play_end < 0:
    raise SystemExit('playPause handler markers not found')

play_block = r'''    $("playPauseBtn")
      ?.addEventListener(
        "click",
        async () => {
          if (!state.playerReady || !state.player) {
            toast("請先選擇影片");
            return;
          }

          if (
            state.playerType === "bilibili" ||
            state.playerType === "external"
          ) {
            toast("此平台目前無法由本站控制播放");
            return;
          }

          const playing = await asyncIsPlaying();
          const position = await asyncCurrentPosition();

          state.playbackApplyingRemote = true;
          state.playbackIgnoreStateChanges = 8;
          state.playbackIgnoreStateUntil = Date.now() + 2500;

          try {
            if (playing) {
              await pausePlayer();
              await publishPlaybackEvent("pause", position, false);
            } else {
              await publishPlaybackEvent("play", position, true);
              await playPlayer();
            }
          } finally {
            state.playbackApplyingRemote = false;
          }

          updateTimeUI();
        }
      );


'''
s = s[:play_start] + play_block + s[play_end:]

# Back and forward are also shared room commands.
s = s.replace(
    '          await applyPlayerPosition(\n            target\n          );\n\n          void publishPlaybackEvent("seek", target);',
    '          await applyPlayerPosition(target);\n          await publishPlaybackEvent("seek", target);',
    1
)
s = s.replace(
    '          await applyPlayerPosition(\n            target\n          );\n\n          void publishPlaybackEvent("seek", target);',
    '          await applyPlayerPosition(target);\n          await publishPlaybackEvent("seek", target);',
    1
)

# Cleanup server clock listener on room disconnect.
disconnect_marker = '  function disconnectRoomListeners() {\n'
if 'state.playbackServerClockHandler = null;' not in s[s.find(disconnect_marker):s.find(disconnect_marker) + 1500]:
    if disconnect_marker not in s:
        raise SystemExit('disconnect marker not found')
    cleanup = '''    if (db && state.playbackServerClockHandler) {\n      db.ref('.info/serverTimeOffset').off('value', state.playbackServerClockHandler);\n      state.playbackServerClockHandler = null;\n    }\n\n'''
    s = s.replace(disconnect_marker, disconnect_marker + cleanup, 1)

# Remove the old kick multi-location write: live rules already allow owner -> member deletion.
kick_start = s.find('  async function kickMember(\n')
kick_end = s.find('  /*\n   * 被踢後立即離開。\n   */', kick_start)
if kick_start < 0 or kick_end < 0:
    raise SystemExit('kick markers not found')

kick_block = r'''  async function kickMember(
    targetUid,
    targetName
  ) {
    if (!state.isOwner) {
      toast("只有房主可以踢人");
      return;
    }

    if (!targetUid || targetUid === state.uid) {
      return;
    }

    if (!state.membersRef || !state.roomId) {
      toast("目前不在房間內");
      return;
    }

    const confirmed = window.confirm(
      `確定要踢出「${targetName || "這名成員"}」嗎？`
    );

    if (!confirmed) return;

    try {
      await state.membersRef
        .child(targetUid)
        .remove();

      toast(`已踢出 ${targetName || "成員"}`);
    } catch (error) {
      console.error("踢人失敗:", error);
      toast(error?.message || "踢人失敗，請檢查 Firebase Rules");
    }
  }


'''
s = s[:kick_start] + kick_block + s[kick_end:]

APP.write_text(s, encoding='utf-8')
print('Applied WatchTogether unified sync V4')
