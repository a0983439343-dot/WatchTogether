from pathlib import Path
import re

APP = Path("app.js")
s = APP.read_text(encoding="utf-8")

fields = {
    "playbackLocalIntentAt: 0": "    playbackLocalIntentAt: 0,\n",
    "playbackPausePublishTimer: null": "    playbackPausePublishTimer: null,\n",
    "playbackAdGuardUntil: 0": "    playbackAdGuardUntil: 0,\n",
    "playbackTransientStateUntil: 0": "    playbackTransientStateUntil: 0,\n",
    "playbackLastPlayerState: null": "    playbackLastPlayerState: null,\n",
    "playbackLastObservedPosition: null": "    playbackLastObservedPosition: null,\n",
}
marker = "    playbackPendingRecovery: false,\n"
if marker not in s:
    raise SystemExit("playback pending recovery state marker not found")
for key, line in fields.items():
    if key not in s:
        s = s.replace(marker, marker + line, 1)

section_re = re.compile(
    r"\n  /\*\n   \* =========================================================\n"
    r"   \* (?:EVENT-BASED PLAYBACK SYNC|SHARED ROOM TIMELINE PLAYBACK SYNC(?: V[0-9]+)?)\n"
    r"[\s\S]*?\n  /\*\n   \* =========================================================\n"
    r"   \* ROOM UI\n   \* =========================================================\n   \*/\n"
)

new_sync = r'''
  /*
   * =========================================================
   * SHARED ROOM TIMELINE PLAYBACK SYNC V6
   * =========================================================
   *
   * Firebase is the only room timeline. No player is a master.
   * A command is position + playing + updatedAt + eventId.
   */

  function playbackClockNow() {
    if (typeof serverNow === "function") {
      const value = Number(serverNow());
      if (Number.isFinite(value) && value > 0) return value;
    }
    return Date.now() + Number(state.playbackServerTimeOffset || 0);
  }

  function playbackSyncRef() {
    if (!db || !state.roomId) return null;
    return db.ref(`rooms/${state.roomId}/playbackEvent`);
  }

  function getTimelinePosition(timeline, now = playbackClockNow()) {
    const base = Math.max(0, Number(timeline?.position) || 0);
    if (timeline?.playing !== true) return base;
    const updatedAt = Number(timeline?.updatedAt || 0);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return base;
    return base + Math.min(Math.max(0, (now - updatedAt) / 1000), 7200);
  }

  function rememberRoomTimeline(event) {
    if (!event || !event.eventId) return false;
    const incoming = Number(event.updatedAt || 0);
    const current = Number(state.playbackTimeline?.updatedAt || 0);
    if (incoming > 0 && current > 0 && incoming < current) return false;

    state.playbackRemoteEvent = event;
    state.playbackTimeline = {
      videoId: String(event.videoId || ""),
      position: Math.max(0, Number(event.position) || 0),
      playing: event.playing === true,
      updatedAt: incoming || playbackClockNow(),
      eventId: String(event.eventId),
    };
    return true;
  }

  function roomTimelinePlaying() {
    const timeline = state.playbackTimeline;
    if (!timeline || String(timeline.videoId || "") !== String(state.currentVideoId || "")) {
      return null;
    }
    return timeline.playing === true;
  }

  function markLocalPlaybackIntent() {
    state.playbackLocalIntentAt = Date.now();
  }

  function cancelPendingPausePublish() {
    clearTimeout(state.playbackPausePublishTimer);
    state.playbackPausePublishTimer = null;
  }

  async function writePlaybackCommand(action, position, playing) {
    if (!state.uid || !state.roomId || !state.playerReady || !state.player ||
        !state.currentVideoId || state.playbackApplyingRemote) return;

    const ref = playbackSyncRef();
    if (!ref) return;

    const finalPosition = Math.max(0, Number(position) || 0);
    const now = playbackClockNow();
    const eventId = `${state.uid}_${Date.now()}_${++state.playbackActionSeq}_${Math.random().toString(36).slice(2)}`;
    const event = {
      action,
      position: finalPosition,
      videoId: String(state.currentVideoId),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid,
      eventId,
      playing: Boolean(playing),
    };

    state.playbackRemoteEvent = { ...event, updatedAt: now };
    state.playbackTimeline = {
      videoId: String(state.currentVideoId),
      position: finalPosition,
      playing: Boolean(playing),
      updatedAt: now,
      eventId,
    };
    state.playbackLastRemoteEventId = eventId;
    state.playbackLastRemoteUpdatedAt = now;
    state.playbackLastPosition = finalPosition;
    state.playbackLastPlaying = Boolean(playing);

    try {
      await ref.set(event);
    } catch (error) {
      console.warn("播放同步寫入失敗:", error);
    }
  }

  async function publishPlaybackEvent(action, position = null, explicitPlaying = undefined) {
    if (!state.uid || !state.roomId || !state.playerReady || !state.player ||
        !state.currentVideoId || state.playbackApplyingRemote) return;

    if (state.playerType === "bilibili" || state.playerType === "external") return;
    if (Date.now() < Number(state.playbackAdGuardUntil || 0)) return;

    const normalized = action === "pause" ? "pause" : action === "seek" ? "seek" : "play";
    let finalPosition = Number(position);
    if (!Number.isFinite(finalPosition)) finalPosition = await asyncCurrentPosition();
    finalPosition = Math.max(0, Number(finalPosition) || 0);

    let playing;
    if (normalized === "pause") playing = false;
    else if (normalized === "play") playing = true;
    else if (typeof explicitPlaying === "boolean") playing = explicitPlaying;
    else playing = await asyncIsPlaying();

    const roomPlaying = roomTimelinePlaying();
    if ((normalized === "play" && roomPlaying === true) ||
        (normalized === "pause" && roomPlaying === false)) return;

    if (normalized === "pause") {
      cancelPendingPausePublish();
      markLocalPlaybackIntent();
      state.playbackPausePublishTimer = setTimeout(async () => {
        state.playbackPausePublishTimer = null;
        try {
          if (state.playbackApplyingRemote || !state.playerReady || !state.player) return;
          if (await asyncIsPlaying()) return;
          if (roomTimelinePlaying() === false) return;
          await writePlaybackCommand("pause", await asyncCurrentPosition(), false);
        } catch (error) {
          console.warn("本機暫停同步失敗:", error);
        }
      }, 180);
      return;
    }

    if (normalized === "play") {
      cancelPendingPausePublish();
      markLocalPlaybackIntent();
    }

    if (normalized === "seek") {
      const timeline = state.playbackTimeline;
      if (timeline && Math.abs(finalPosition - getTimelinePosition(timeline)) < 1.25) return;
      markLocalPlaybackIntent();
    }

    const now = Date.now();
    const key = `${normalized}:${Math.round(finalPosition * 4) / 4}:${playing ? 1 : 0}`;
    if (key === state.playbackLastLocalActionKey &&
        now - Number(state.playbackLastLocalActionAt || 0) < 650) return;
    if (normalized === "seek" && now - Number(state.playbackLastLocalSeekWriteAt || 0) < 400) return;

    state.playbackLastLocalActionKey = key;
    state.playbackLastLocalActionAt = now;
    if (normalized === "seek") state.playbackLastLocalSeekWriteAt = now;

    await writePlaybackCommand(normalized, finalPosition, playing);
  }

  async function enforceRoomPlayingState(wantPlaying, retries = 5) {
    for (let attempt = 0; attempt < retries; attempt += 1) {
      if (!state.playerReady || !state.player || !state.currentVideoId) return;
      try {
        if ((await asyncIsPlaying()) === wantPlaying) return;
        if (wantPlaying) await playPlayer();
        else await pausePlayer();
      } catch (error) {
        console.warn("強制套用房間播放狀態失敗:", error);
      }
      if (attempt + 1 < retries) await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  async function applyRemotePlaybackEvent(event, force = false) {
    if (!event || !state.playerReady || !state.player || !state.currentVideoId) return;
    if (String(event.videoId || "") !== String(state.currentVideoId || "")) return;
    if (!["play", "pause", "seek"].includes(event.action)) return;
    if (state.playerType === "bilibili" || state.playerType === "external") return;

    const eventId = String(event.eventId || "");
    if (!eventId) return;

    const incoming = Number(event.updatedAt || 0);
    const previous = Number(state.playbackLastRemoteUpdatedAt || 0);
    if (!force && incoming > 0 && previous > 0 && incoming < previous) return;
    if (!force && state.playbackLastRemoteEventId === eventId) {
      rememberRoomTimeline(event);
      return;
    }
    if (!force && event.updatedBy === state.uid) {
      rememberRoomTimeline(event);
      return;
    }

    rememberRoomTimeline(event);
    cancelPendingPausePublish();
    state.playbackLastRemoteEventId = eventId;
    if (incoming > 0) state.playbackLastRemoteUpdatedAt = incoming;

    state.playbackApplyingRemoteEventId = eventId;
    state.playbackApplyingRemote = true;
    state.playbackPendingRecovery = true;
    state.playbackIgnoreStateChanges = 20;
    state.playbackIgnoreStateUntil = Date.now() + 8000;
    state.playbackReadyAt = Date.now() + 1100;

    try {
      const expected = getTimelinePosition(event);
      const current = await asyncCurrentPosition();
      if (Math.abs(current - expected) > 0.30) await applyPlayerPosition(expected);
      await enforceRoomPlayingState(event.playing === true, 6);
      state.playbackLastPosition = await asyncCurrentPosition();
      state.playbackLastPlaying = await asyncIsPlaying();
      if ($("syncStatus")) $("syncStatus").textContent = `已同步 ${formatTime(expected)}`;
    } catch (error) {
      console.warn("套用房間播放命令失敗:", error);
    } finally {
      state.playbackApplyingRemote = false;
      state.playbackPendingRecovery = false;
      state.playbackApplyingRemoteEventId = null;
    }
  }

  async function applyLatestRoomPlaybackState(force = true) {
    const ref = playbackSyncRef();
    if (!ref || !state.playerReady || !state.player || !state.currentVideoId) return;
    try {
      const event = (await ref.once("value")).val();
      if (!event || !event.eventId) return;
      rememberRoomTimeline(event);
      await applyRemotePlaybackEvent(event, force);
    } catch (error) {
      state.playbackPendingRecovery = false;
      console.warn("讀取最新房間播放時間軸失敗:", error);
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
    if (!event || !event.eventId) return;
    if (!rememberRoomTimeline(event)) return;
    if (event.updatedBy === state.uid) return;
    if (state.playbackLastRemoteEventId === String(event.eventId)) return;
    state.playbackPendingRecovery = true;
    void applyRemotePlaybackEvent(event, false);
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
    if (!state.playerReady || !state.player || !state.currentVideoId ||
        state.playbackApplyingRemote || state.playbackPendingRecovery) return;

    const timeline = state.playbackTimeline;
    if (!timeline || String(timeline.videoId || "") !== String(state.currentVideoId || "")) return;

    const now = playbackClockNow();
    const position = await asyncCurrentPosition();
    const playing = await asyncIsPlaying();
    const expected = getTimelinePosition(timeline, now);
    const previousObserved = Number(state.playbackLastObservedPosition);

    if (timeline.playing === true && Number.isFinite(previousObserved) &&
        position < previousObserved - 3 &&
        now - Number(state.playbackLocalIntentAt || 0) > 1200) {
      state.playbackAdGuardUntil = Date.now() + 7500;
      state.playbackTransientStateUntil = Date.now() + 7500;
      state.playbackLastObservedPosition = position;
      return;
    }

    state.playbackLastObservedPosition = position;
    if (now < Number(state.playbackAdGuardUntil || 0)) return;
    if (Date.now() < Number(state.playbackTransientStateUntil || 0)) return;
    if (now < Number(state.playbackReadyAt || 0)) return;

    if (Math.abs(position - expected) > 1.75) {
      state.playbackApplyingRemote = true;
      state.playbackPendingRecovery = true;
      state.playbackIgnoreStateChanges = 10;
      state.playbackIgnoreStateUntil = Date.now() + 3500;
      try {
        await applyPlayerPosition(expected);
      } catch (error) {
        console.warn("播放位置校正失敗:", error);
      } finally {
        state.playbackApplyingRemote = false;
        state.playbackPendingRecovery = false;
      }
      if ($("syncStatus")) $("syncStatus").textContent = `已校正 ${formatTime(expected)}`;
      return;
    }

    if (timeline.playing === true && !playing || timeline.playing === false && playing) {
      state.playbackApplyingRemote = true;
      state.playbackPendingRecovery = true;
      state.playbackIgnoreStateChanges = 10;
      state.playbackIgnoreStateUntil = Date.now() + 3500;
      try {
        await enforceRoomPlayingState(timeline.playing === true, 4);
      } finally {
        state.playbackApplyingRemote = false;
        state.playbackPendingRecovery = false;
      }
    }
  }

  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();
    state.playbackReadyAt = Date.now() + 700;
    state.playbackSeekTimer = setInterval(() => void reconcileRoomTimeline(), 650);
  }

  function recoverPlaybackAfterPageResume() {
    clearTimeout(state.playbackRecoveryTimer);
    state.playbackRecoveryTimer = setTimeout(async () => {
      state.playbackRecoveryTimer = null;
      await applyLatestRoomPlaybackState(true);
      startPlaybackSeekDetector();
    }, 450);
  }
'''

m = section_re.search(s)
if not m:
    raise SystemExit("playback sync section not found")
s = s[:m.start()] + "\n" + new_sync + "\n  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */\n" + s[m.end():]

s = s.replace('                  void applyLatestRoomPlaybackState();\n',
              '                  void applyLatestRoomPlaybackState(true);\n')

APP.write_text(s, encoding="utf-8")
print("Applied shared playback timeline V6")
