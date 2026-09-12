from pathlib import Path
import json

APP = Path("app.js")
RULES = Path("database.rules.json")

s = APP.read_text(encoding="utf-8")

# Shared playback state used by the single room timeline.
state_marker = '    playbackRecoveryTimer: null,\n'
state_add = '''
    playbackTimeline: null,
    playbackAdGuardUntil: 0,
    playbackTransientStateUntil: 0,
    playbackLastPlayerState: null,
    playbackLastObservedPosition: null,
    playbackPendingRecovery: false,
    playbackLocalIntentAt: 0,
'''
if "playbackTimeline: null" not in s:
    if state_marker not in s:
        raise SystemExit("shared playback state marker not found")
    s = s.replace(state_marker, state_marker + state_add, 1)

# The room timeline engine owns initial recovery. Do not run a second
# copy from the YouTube ready callback.
s = s.replace(
    '                  void applyLatestRoomPlaybackState();\n',
    '',
    1
)

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
   * 沒有任何「主播放器」。Firebase 中最後一個 room command
   * 就是所有人的共同時間軸：position + updatedAt + playing。
   *
   * playing=true  : position 依 updatedAt 向前推進。
   * playing=false : position 固定。
   * 新加入的成員直接套用最新 command。
   *
   * 非常重要：先偵測本機真正產生的狀態變化，再做房間校正。
   * 這避免「使用者按暫停 -> 校正先把它播起來 -> 舊暫停又被寫回」的循環。
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

    const incomingUpdatedAt = Number(event.updatedAt || 0);
    const currentUpdatedAt = Number(
      state.playbackTimeline?.updatedAt || 0
    );

    if (
      incomingUpdatedAt > 0 &&
      currentUpdatedAt > 0 &&
      incomingUpdatedAt < currentUpdatedAt
    ) {
      return;
    }

    state.playbackRemoteEvent = event;

    state.playbackTimeline = {
      videoId: String(event.videoId || ""),
      position: Math.max(0, Number(event.position) || 0),
      playing: event.playing === true,
      updatedAt: incomingUpdatedAt || Date.now(),
      eventId: String(event.eventId)
    };
  }


  function shouldIgnoreTransientYoutubeState() {
    return Date.now() < Number(
      state.playbackTransientStateUntil || 0
    );
  }


  async function publishPlaybackEvent(action, position = null) {
    if (
      !state.uid ||
      !state.roomId ||
      !state.playerReady ||
      !state.player ||
      state.playbackApplyingRemote ||
      state.playbackPendingRecovery
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

    if (!ref || !state.currentVideoId) {
      return;
    }

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
      `${normalizedAction}:${Math.round(finalPosition * 4) / 4}:${playing ? 1 : 0}`;

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

    state.playbackLocalIntentAt = now;

    const event = {
      action: normalizedAction,
      position: finalPosition,
      videoId: String(state.currentVideoId),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid,
      eventId: `${state.uid}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      playing
    };

    // Update the local room timeline immediately. This is the shared room
    // state; it is not based on any participant being a master.
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

    try {
      await ref.set(event);
    } catch (error) {
      console.warn("播放同步寫入失敗:", error);
      return;
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

    if (!eventId) {
      return;
    }

    if (
      !force &&
      state.playbackLastRemoteEventId === eventId
    ) {
      rememberRoomTimeline(event);
      return;
    }

    const remoteUpdatedAt = Number(event.updatedAt || 0);
    const lastRemoteUpdatedAt = Number(
      state.playbackLastRemoteUpdatedAt || 0
    );

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
    state.playbackPendingRecovery = true;
    state.playbackIgnoreStateChanges = 6;
    state.playbackIgnoreStateUntil = Date.now() + 8000;
    state.playbackReadyAt = Date.now() + 1200;

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
      state.playbackPendingRecovery = false;
      state.playbackApplyingRemoteEventId = null;
      state.playbackLastPosition = await asyncCurrentPosition().catch(() => null);
      state.playbackLastPlaying = await asyncIsPlaying().catch(() => null);
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

      state.playbackPendingRecovery = true;
      await applyRemotePlaybackEvent(event, force);
    } catch (error) {
      state.playbackPendingRecovery = false;
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

    if (!ref) {
      return;
    }

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

    state.playbackPendingRecovery = true;
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
      state.playbackApplyingRemote ||
      state.playbackPendingRecovery
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
      return;
    }

    if (
      now < Number(state.playbackReadyAt || 0) ||
      now < Number(state.playbackIgnoreStateUntil || 0)
    ) {
      return;
    }

    const drift = Math.abs(position - expected);

    if (drift > 1.75) {
      state.playbackApplyingRemote = true;
      state.playbackPendingRecovery = true;
      state.playbackIgnoreStateChanges = 3;
      state.playbackIgnoreStateUntil = Date.now() + 3000;

      try {
        await applyPlayerPosition(expected);
      } finally {
        state.playbackApplyingRemote = false;
        state.playbackPendingRecovery = false;
        state.playbackLastPosition = await asyncCurrentPosition().catch(() => null);
        state.playbackLastPlaying = await asyncIsPlaying().catch(() => null);
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
      state.playbackPendingRecovery = true;
      state.playbackIgnoreStateChanges = 3;
      state.playbackIgnoreStateUntil = Date.now() + 3000;

      try {
        if (wantPlaying) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      } finally {
        state.playbackApplyingRemote = false;
        state.playbackPendingRecovery = false;
        state.playbackLastPosition = await asyncCurrentPosition().catch(() => null);
        state.playbackLastPlaying = await asyncIsPlaying().catch(() => null);
      }
    }
  }


  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();
    state.playbackReadyAt = Date.now() + 700;

    state.playbackSeekTimer = setInterval(async () => {
      try {
        if (
          !state.playerReady ||
          !state.player ||
          !state.currentVideoId
        ) {
          return;
        }

        const now = Date.now();
        const position = await asyncCurrentPosition();
        const playing = await asyncIsPlaying();
        const timeline = state.playbackTimeline;

        if (
          state.playerType === "youtube" &&
          now < Number(state.playbackAdGuardUntil || 0)
        ) {
          state.playbackLastPosition = position;
          state.playbackLastPlaying = playing;
          state.playbackLastPlayerState = playing ? "playing" : "paused";
          return;
        }

        if (
          state.playbackPendingRecovery ||
          state.playbackApplyingRemote
        ) {
          state.playbackLastPosition = position;
          state.playbackLastPlaying = playing;
          state.playbackLastPlayerState = playing ? "playing" : "paused";
          state.playbackLastObservedPosition = position;
          return;
        }

        const roomMatchesVideo =
          timeline &&
          String(timeline.videoId || "") ===
            String(state.currentVideoId || "");

        const roomPlaying =
          roomMatchesVideo
            ? timeline.playing === true
            : null;

        if (
          now >= Number(state.playbackIgnoreStateUntil || 0) &&
          now >= Number(state.playbackReadyAt || 0) &&
          !shouldIgnoreTransientYoutubeState()
        ) {
          // 先判斷真正的本機操作，再做任何房間校正。
          // 遠端套用後即使 YouTube 晚一點才回 callback，房間狀態已經與播放器一致，
          // 因此不會再把 callback 當成新的 pause/play command。
          if (
            state.playbackLastPlaying !== null &&
            playing !== state.playbackLastPlaying &&
            roomPlaying !== null &&
            playing !== roomPlaying
          ) {
            state.playbackLocalIntentAt = now;
            void publishPlaybackEvent(
              playing ? "play" : "pause",
              position
            );

            state.playbackLastPosition = position;
            state.playbackLastPlaying = playing;
            state.playbackLastPlayerState = playing ? "playing" : "paused";
            state.playbackLastObservedPosition = position;
            return;
          }

          const positionDelta =
            state.playbackLastPosition === null
              ? 0
              : Math.abs(
                  position - Number(state.playbackLastPosition)
                );

          if (
            state.playbackLastPlaying === playing &&
            positionDelta >= 1.35 &&
            roomPlaying !== null
          ) {
            const expected = getTimelinePosition(timeline, now);
            const localJumpDiff = Math.abs(position - expected);

            if (localJumpDiff > 1.35) {
              state.playbackLocalIntentAt = now;
              void publishPlaybackEvent("seek", position);

              state.playbackLastPosition = position;
              state.playbackLastPlaying = playing;
              state.playbackLastPlayerState = playing ? "playing" : "paused";
              state.playbackLastObservedPosition = position;
              return;
            }
          }
        }

        state.playbackLastPosition = position;
        state.playbackLastPlaying = playing;
        state.playbackLastPlayerState = playing ? "playing" : "paused";
        state.playbackLastObservedPosition = position;

        // 最後才做房間校正，這樣本機按暫停/播放一定先有機會成為新的 room command。
        await reconcileRoomTimeline();
      } catch (error) {
        console.warn("播放時間軸校正失敗:", error);
      }
    }, 350);
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
        state.playbackPendingRecovery = true;
        await applyLatestRoomPlaybackState(true);
        state.playbackPendingRecovery = false;
        await reconcileRoomTimeline();
        startPlaybackSeekDetector();
      } catch (error) {
        state.playbackPendingRecovery = false;
        console.warn("頁面恢復後播放同步失敗:", error);
      }
    }, 350);
  }


'''

s = s[:start] + new_sync + s[end:]

# YouTube player state callbacks must never publish room-wide play/pause by
# themselves. They are player feedback and can be caused by remote commands,
# buffering and YouTube's own playback transitions.
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
                    state.playbackTransientStateUntil = now + 2600;

                    if (
                      state.playbackTimeline &&
                      state.playbackTimeline.playing
                    ) {
                      state.playbackAdGuardUntil = now + 3500;
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

                    state.playbackLastPlayerState =
                      isPlaying ? "playing" : "paused";

                    state.playbackLastObservedPosition =
                      await asyncCurrentPosition().catch(() => null);
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

# Reset shared timeline state for a newly loaded video.
reset_marker = '      state.playbackLastLocalSeekWriteAt = 0;\n'
reset_add = '''      state.playbackTimeline = null;
      state.playbackAdGuardUntil = 0;
      state.playbackTransientStateUntil = 0;
      state.playbackLastPlayerState = null;
      state.playbackLastObservedPosition = null;
      state.playbackPendingRecovery = false;
      state.playbackLocalIntentAt = 0;
'''
if "      state.playbackTimeline = null;" not in s:
    if reset_marker not in s:
        raise SystemExit("new video playback reset marker not found")
    s = s.replace(reset_marker, reset_marker + reset_add, 1)

# Preserve the current rules, including the kick protection, while keeping
# room playback writable by every current member.
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
print("WatchTogether shared timeline playback ordering repaired")
