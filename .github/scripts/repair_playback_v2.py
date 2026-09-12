from pathlib import Path
import json
import re

APP = Path("app.js")
RULES = Path("database.rules.json")

s = APP.read_text(encoding="utf-8")


def ensure_once(text, needle, replacement, label):
    if needle in text:
        return text
    if label not in text:
        raise SystemExit(f"{label}: marker not found")
    return text.replace(label, label + replacement, 1)


# ---------------------------------------------------------
# Shared room timeline state
# ---------------------------------------------------------
state_marker = '    playbackRecoveryTimer: null,\n'
state_add = '''\n    playbackTimeline: null,\n    playbackAdGuardUntil: 0,\n    playbackTransientStateUntil: 0,\n    playbackLastPlayerState: null,\n    playbackLastObservedPosition: null,\n'''
if "playbackTimeline: null" not in s:
    if state_marker not in s:
        raise SystemExit("shared playback state marker not found")
    s = s.replace(state_marker, state_marker + state_add, 1)


# ---------------------------------------------------------
# The YouTube ready callback must not apply the same room event
# twice. The single playback sync engine below performs recovery.
# ---------------------------------------------------------
s = s.replace(
    '                  void applyLatestRoomPlaybackState();\n',
    '',
    1
)


# ---------------------------------------------------------
# Replace the old event sync engine with a shared-room timeline.
# No participant is a playback master. The latest room command is
# the timeline anchor and its timestamp advances while playing.
# ---------------------------------------------------------
start_marker = '  /*\n   * =========================================================\n   * EVENT-BASED PLAYBACK SYNC\n   * =========================================================\n   */\n'
end_marker = '  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */\n'

start = s.find(start_marker)
end = s.find(end_marker, start + len(start_marker))
if start < 0 or end < 0:
    raise SystemExit("playback sync section markers not found")

new_sync = r'''  /*
   * =========================================================
   * SHARED ROOM TIMELINE PLAYBACK SYNC
   * =========================================================
   *
   * 不指定任何人的播放器當主機。
   * Firebase 裡最後一個房間播放命令就是共享時間軸：
   *   position + updatedAt + playing + videoId
   *
   * playing=true  時：position 會依 updatedAt 自動向前推進。
   * playing=false 時：position 固定在最後暫停位置。
   *
   * 新成員加入時直接讀這個時間軸，因此不需要跟某個人對齊。
   */

  function playbackSyncRef() {
    if (!db || !state.roomId) return null;
    return db.ref(`rooms/${state.roomId}/playbackEvent`);
  }


  function getTimelinePosition(event, now = Date.now()) {
    const base = Math.max(0, Number(event?.position) || 0);

    if (!event?.playing) {
      return base;
    }

    const updatedAt = Number(event?.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
      return base;
    }

    const elapsed = Math.max(0, (now - updatedAt) / 1000);
    return base + Math.min(elapsed, 7200);
  }


  function rememberRoomTimeline(event) {
    if (!event || !event.eventId) {
      return;
    }

    state.playbackRemoteEvent = event;
    state.playbackTimeline = {
      videoId: String(event.videoId || ""),
      position: Math.max(0, Number(event.position) || 0),
      playing: event.playing === true,
      updatedAt: Number(event.updatedAt) || Date.now(),
      eventId: String(event.eventId)
    };
  }


  function shouldIgnoreTransientYoutubeState() {
    return Date.now() < Number(state.playbackTransientStateUntil || 0);
  }


  async function publishPlaybackEvent(action, position = null) {
    if (
      !state.uid ||
      !state.roomId ||
      !state.playerReady ||
      !state.player ||
      state.playbackApplyingRemote
    ) {
      return;
    }

    if (
      state.playerType === "bilibili" ||
      state.playerType === "external"
    ) {
      return;
    }

    if (shouldIgnoreTransientYoutubeState()) {
      return;
    }

    const ref = playbackSyncRef();
    if (!ref || !state.currentVideoId) return;

    const normalizedAction =
      action === "pause"
        ? "pause"
        : action === "seek"
          ? "seek"
          : "play";

    let finalPosition = Number(position);

    if (!Number.isFinite(finalPosition)) {
      finalPosition = await asyncCurrentPosition();
    }

    finalPosition = Math.max(0, Number(finalPosition) || 0);

    let playing = true;

    if (normalizedAction === "pause") {
      playing = false;
    } else if (normalizedAction === "seek") {
      playing = await asyncIsPlaying();
    }

    const now = Date.now();
    const localActionKey =
      `${normalizedAction}:${Math.round(finalPosition * 2) / 2}:${playing ? 1 : 0}`;

    if (
      localActionKey === state.playbackLastLocalActionKey &&
      now - Number(state.playbackLastLocalActionAt || 0) < 900
    ) {
      return;
    }

    if (
      normalizedAction === "seek" &&
      now - Number(state.playbackLastLocalSeekWriteAt || 0) < 650
    ) {
      return;
    }

    state.playbackLastLocalActionKey = localActionKey;
    state.playbackLastLocalActionAt = now;

    if (normalizedAction === "seek") {
      state.playbackLastLocalSeekWriteAt = now;
    }

    const event = {
      action: normalizedAction,
      position: finalPosition,
      videoId: String(state.currentVideoId),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid,
      eventId: `${state.uid}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      playing
    };

    try {
      await ref.set(event);

      state.playbackRemoteEvent = {
        ...event,
        updatedAt: now
      };

      state.playbackTimeline = {
        videoId: String(state.currentVideoId),
        position: finalPosition,
        playing,
        updatedAt: now,
        eventId: String(event.eventId)
      };

      state.playbackLastRemoteEventId = String(event.eventId);
      state.playbackLastRemoteUpdatedAt = now;
      state.playbackLastPosition = finalPosition;
      state.playbackLastPlaying = playing;
    } catch (error) {
      console.warn("播放同步寫入失敗:", error);
    }
  }


  async function applyRemotePlaybackEvent(event, force = false) {
    if (
      !event ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId
    ) {
      return;
    }

    if (
      String(event.videoId || "") !==
      String(state.currentVideoId || "")
    ) {
      return;
    }

    if (!["play", "pause", "seek"].includes(event.action)) {
      return;
    }

    if (
      event.updatedBy === state.uid &&
      !force
    ) {
      rememberRoomTimeline(event);
      return;
    }

    if (
      state.playerType === "bilibili" ||
      state.playerType === "external"
    ) {
      return;
    }

    const eventId = String(event.eventId || "");
    if (!eventId) return;

    if (
      !force &&
      state.playbackLastRemoteEventId === eventId
    ) {
      rememberRoomTimeline(event);
      return;
    }

    const remoteUpdatedAt = Number(event.updatedAt || 0);
    const lastRemoteUpdatedAt =
      Number(state.playbackLastRemoteUpdatedAt || 0);

    if (
      !force &&
      remoteUpdatedAt > 0 &&
      lastRemoteUpdatedAt > 0 &&
      remoteUpdatedAt < lastRemoteUpdatedAt
    ) {
      return;
    }

    rememberRoomTimeline(event);

    if (remoteUpdatedAt > 0) {
      state.playbackLastRemoteUpdatedAt = remoteUpdatedAt;
    }

    if (
      state.playbackApplyingRemoteEventId === eventId
    ) {
      return;
    }

    state.playbackLastRemoteEventId = eventId;
    state.playbackApplyingRemoteEventId = eventId;
    state.playbackApplyingRemote = true;
    state.playbackIgnoreStateChanges = 4;
    state.playbackIgnoreStateUntil = Date.now() + 4500;
    state.playbackReadyAt = Date.now() + 1600;

    try {
      const position = getTimelinePosition(event);
      const current = await asyncCurrentPosition();
      const difference = Math.abs(current - position);

      if (difference > 0.35) {
        await applyPlayerPosition(position);
      }

      const wantPlaying =
        event.playing === true ||
        (event.playing === undefined && event.action === "play");

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

      if ($("syncStatus")) {
        $("syncStatus").textContent =
          `已同步 ${formatTime(position)}`;
      }
    } catch (error) {
      console.warn("套用房間播放時間軸失敗:", error);
    } finally {
      state.playbackApplyingRemote = false;
      state.playbackApplyingRemoteEventId = null;
    }
  }


  async function applyLatestRoomPlaybackState(force = false) {
    const ref = playbackSyncRef();

    if (
      !ref ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId
    ) {
      return;
    }

    try {
      const event = (await ref.once("value")).val();

      if (!event || !event.eventId) {
        return;
      }

      rememberRoomTimeline(event);

      if (event.updatedBy === state.uid && !force) {
        return;
      }

      await applyRemotePlaybackEvent(event, force);
    } catch (error) {
      console.warn("讀取最新房間播放時間軸失敗:", error);
    }
  }


  function attachPlaybackSyncListener() {
    if (
      !state.roomRef ||
      state.playbackListenerAttached
    ) {
      return;
    }

    const ref = playbackSyncRef();
    if (!ref) return;

    ref.on("value", handleRemotePlaybackSnapshot);
    state.playbackListenerAttached = true;
  }


  function handleRemotePlaybackSnapshot(snapshot) {
    const event = snapshot?.val?.() || null;

    if (!event || !event.eventId) {
      return;
    }

    rememberRoomTimeline(event);

    if (event.updatedBy === state.uid) {
      return;
    }

    if (
      state.playbackLastRemoteEventId ===
      String(event.eventId)
    ) {
      return;
    }

    void applyRemotePlaybackEvent(event);
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
    ) {
      return;
    }

    const timeline = state.playbackTimeline;

    if (
      !timeline ||
      String(timeline.videoId || "") !==
      String(state.currentVideoId || "")
    ) {
      return;
    }

    const now = Date.now();
    const position = await asyncCurrentPosition();
    const playing = await asyncIsPlaying();
    const expected = getTimelinePosition(timeline, now);

    state.playbackLastObservedPosition = position;

    if (
      state.playerType === "youtube" &&
      now < Number(state.playbackAdGuardUntil || 0)
    ) {
      state.playbackLastPosition = position;
      state.playbackLastPlaying = playing;
      return;
    }

    if (
      now < Number(state.playbackReadyAt || 0) ||
      now < Number(state.playbackIgnoreStateUntil || 0)
    ) {
      state.playbackLastPosition = position;
      state.playbackLastPlaying = playing;
      return;
    }

    const drift = Math.abs(position - expected);

    if (drift > 1.75) {
      state.playbackApplyingRemote = true;
      state.playbackIgnoreStateChanges = 2;
      state.playbackIgnoreStateUntil = Date.now() + 2200;

      try {
        await applyPlayerPosition(expected);
      } finally {
        state.playbackApplyingRemote = false;
        state.playbackLastPosition = await asyncCurrentPosition();
        state.playbackLastPlaying = await asyncIsPlaying();
      }

      if ($("syncStatus")) {
        $("syncStatus").textContent =
          `已校正 ${formatTime(expected)}`;
      }

      return;
    }

    const wantPlaying = timeline.playing === true;

    if (wantPlaying !== playing) {
      state.playbackApplyingRemote = true;
      state.playbackIgnoreStateChanges = 2;
      state.playbackIgnoreStateUntil = Date.now() + 2200;

      try {
        if (wantPlaying) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      } finally {
        state.playbackApplyingRemote = false;
        state.playbackLastPosition = await asyncCurrentPosition();
        state.playbackLastPlaying = await asyncIsPlaying();
      }

      return;
    }

    state.playbackLastPosition = position;
    state.playbackLastPlaying = playing;
  }


  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();
    state.playbackReadyAt = Date.now() + 1000;

    state.playbackSeekTimer = setInterval(async () => {
      try {
        if (
          !state.playerReady ||
          !state.player
        ) {
          return;
        }

        if (state.playerType === "youtube") {
          if (Date.now() < Number(state.playbackAdGuardUntil || 0)) {
            return;
          }
        }

        await reconcileRoomTimeline();

        if (
          state.playbackApplyingRemote ||
          !state.currentVideoId
        ) {
          return;
        }

        const position = await asyncCurrentPosition();
        const playing = await asyncIsPlaying();
        const now = Date.now();

        if (
          now < Number(state.playbackIgnoreStateUntil || 0) ||
          now < Number(state.playbackReadyAt || 0)
        ) {
          state.playbackLastPosition = position;
          state.playbackLastPlaying = playing;
          state.playbackLastPlayerState = playing ? "playing" : "paused";
          state.playbackLastObservedPosition = position;
          return;
        }

        if (
          state.playbackLastPosition === null ||
          state.playbackLastPlaying === null
        ) {
          state.playbackLastPosition = position;
          state.playbackLastPlaying = playing;
          state.playbackLastPlayerState = playing ? "playing" : "paused";
          state.playbackLastObservedPosition = position;
          return;
        }

        const positionDelta = Math.abs(
          position - Number(state.playbackLastPosition)
        );

        const playingChanged =
          playing !== state.playbackLastPlaying;

        const timeline = state.playbackTimeline;
        const roomPlaying =
          timeline &&
          String(timeline.videoId || "") ===
            String(state.currentVideoId || "")
            ? timeline.playing === true
            : null;

        if (
          state.playerType === "youtube" &&
          shouldIgnoreTransientYoutubeState()
        ) {
          state.playbackLastPosition = position;
          state.playbackLastPlaying = playing;
          state.playbackLastPlayerState = playing ? "playing" : "paused";
          state.playbackLastObservedPosition = position;
          return;
        }

        if (
          playingChanged &&
          (roomPlaying === null || playing !== roomPlaying)
        ) {
          void publishPlaybackEvent(
            playing ? "play" : "pause",
            position
          );
        }

        if (
          positionDelta >= 1.35 &&
          !playingChanged
        ) {
          void publishPlaybackEvent("seek", position);
        }

        state.playbackLastPosition = position;
        state.playbackLastPlaying = playing;
        state.playbackLastPlayerState = playing ? "playing" : "paused";
        state.playbackLastObservedPosition = position;
      } catch (error) {
        console.warn("播放時間軸校正失敗:", error);
      }
    }, 650);
  }


  function recoverPlaybackAfterPageResume() {
    if (
      document.visibilityState === "hidden" ||
      !state.roomId ||
      !state.uid ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId
    ) {
      return;
    }

    clearTimeout(state.playbackRecoveryTimer);

    state.playbackRecoveryTimer = setTimeout(async () => {
      state.playbackRecoveryTimer = null;

      if (
        document.visibilityState === "hidden" ||
        !state.roomId ||
        !state.playerReady ||
        !state.player
      ) {
        return;
      }

      try {
        await applyLatestRoomPlaybackState(true);
        await reconcileRoomTimeline();
        startPlaybackSeekDetector();
      } catch (error) {
        console.warn("頁面恢復後播放同步失敗:", error);
      }
    }, 350);
  }


'''

s = s[:start] + new_sync + s[end:]


# ---------------------------------------------------------
# Replace YouTube state handling so player-generated transient
# buffering/ad state never becomes a room-wide play/pause command.
# The room timeline still force-corrects genuine divergence.
# ---------------------------------------------------------
state_start = s.find('              onStateChange:\n                async (event) => {')
error_marker = '\n              onError:\n'
state_end = s.find(error_marker, state_start)
if state_start < 0 or state_end < 0:
    raise SystemExit("YouTube onStateChange block not found")

new_handler = r'''              onStateChange:
                async (event) => {
                  if (
                    state.youtubeBuildToken !== token ||
                    state.player !== event.target
                  ) {
                    return;
                  }

                  forceYoutubeVisible();

                  const now = Date.now();
                  const data = event.data;

                  if (
                    data === YT.PlayerState.BUFFERING
                  ) {
                    state.playbackTransientStateUntil = now + 2200;

                    if (
                      state.playbackTimeline &&
                      state.playbackTimeline.playing
                    ) {
                      state.playbackAdGuardUntil = now + 3200;
                    }

                    state.playbackLastPlayerState = "buffering";
                    return;
                  }

                  if (
                    data === YT.PlayerState.PLAYING ||
                    data === YT.PlayerState.PAUSED
                  ) {
                    const isPlaying =
                      data === YT.PlayerState.PLAYING;

                    const expectedPlaying =
                      state.playbackTimeline &&
                      String(state.playbackTimeline.videoId || "") ===
                        String(state.currentVideoId || "")
                        ? Boolean(state.playbackTimeline.playing)
                        : null;

                    const ignoredByRemote =
                      state.playbackApplyingRemote ||
                      (
                        state.playbackIgnoreStateChanges > 0 &&
                        now < Number(state.playbackIgnoreStateUntil || 0) &&
                        (
                          expectedPlaying === null ||
                          isPlaying === expectedPlaying
                        )
                      );

                    if (ignoredByRemote) {
                      if (!state.playbackApplyingRemote) {
                        state.playbackIgnoreStateChanges -= 1;
                      }
                    } else if (
                      now >= Number(state.playbackIgnoreStateUntil || 0) &&
                      !shouldIgnoreTransientYoutubeState()
                    ) {
                      const position = await asyncCurrentPosition();

                      const roomStateMatches =
                        expectedPlaying !== null &&
                        isPlaying === expectedPlaying;

                      if (!roomStateMatches) {
                        await publishPlaybackEvent(
                          isPlaying ? "play" : "pause",
                          position
                        );
                      }
                    }

                    state.playbackLastPlayerState =
                      isPlaying ? "playing" : "paused";
                    state.playbackLastObservedPosition =
                      await asyncCurrentPosition();
                  }

                  if (
                    data === YT.PlayerState.ENDED
                  ) {
                    if (state.isOwner) {
                      setTimeout(
                        async () => {
                          await playNextQueueItem();
                        },
                        300
                      );
                    }
                  }

                  updateTimeUI();
                },
'''

s = s[:state_start] + new_handler + s[state_end:]


# ---------------------------------------------------------
# Reset shared timeline state whenever a completely new YouTube
# video is loaded, so an old event can never control the new video.
# ---------------------------------------------------------
reset_marker = '      state.playbackLastLocalSeekWriteAt = 0;\n'
reset_add = '''      state.playbackTimeline = null;\n      state.playbackAdGuardUntil = 0;\n      state.playbackTransientStateUntil = 0;\n      state.playbackLastPlayerState = null;\n      state.playbackLastObservedPosition = null;\n'''
if "      state.playbackTimeline = null;" not in s:
    if reset_marker not in s:
        raise SystemExit("new video playback reset marker not found")
    s = s.replace(reset_marker, reset_marker + reset_add, 1)


# ---------------------------------------------------------
# Keep Firebase rules explicit: every current room member may
# publish a room-wide playback command. The room event itself is
# the shared timeline, not a privileged user's playback stream.
# ---------------------------------------------------------
rules = json.loads(RULES.read_text(encoding="utf-8"))
member_uid = rules["rules"]["members"]["$roomId"]["$uid"]
member_uid[".write"] = (
    "auth != null && root.child('rooms').child($roomId).exists() && "
    "((auth.uid === $uid && !root.child('kicked').child($roomId).child(auth.uid).exists()) || "
    "(auth.uid === root.child('rooms').child($roomId).child('owner').val() && auth.uid !== $uid && !newData.exists()))"
)
rules["rules"]["kicked"] = {
    "$roomId": {
        "$uid": {
            ".read": (
                "auth != null && (auth.uid === $uid || "
                "auth.uid === root.child('rooms').child($roomId).child('owner').val())"
            ),
            ".write": (
                "auth != null && "
                "auth.uid === root.child('rooms').child($roomId).child('owner').val()"
            ),
            ".validate": "!newData.exists() || (newData.isBoolean() && newData.val() === true)"
        }
    }
}
RULES.write_text(
    json.dumps(rules, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8"
)

APP.write_text(s, encoding="utf-8")
print("WatchTogether shared room timeline, forced play/pause, late-join sync and YouTube transient-state protection applied")
