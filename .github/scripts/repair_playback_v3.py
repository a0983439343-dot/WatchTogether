from pathlib import Path
import json
import re

APP = Path("app.js")
RULES = Path("database.rules.json")
s = APP.read_text(encoding="utf-8")

state_marker = "    playbackRecoveryTimer: null,\n"
state_add = """
    playbackTimeline: null,
    playbackAdGuardUntil: 0,
    playbackTransientStateUntil: 0,
    playbackLastPlayerState: null,
    playbackLastObservedPosition: null,
    playbackPendingRecovery: false,
    playbackLocalIntentAt: 0,
"""
if "playbackPendingRecovery: false" not in s:
    if state_marker not in s:
        raise SystemExit("playback state marker not found")
    s = s.replace(state_marker, state_marker + state_add, 1)

# Remove duplicate ready-time application of the room state.
s = s.replace('                  void applyLatestRoomPlaybackState();\n', '', 1)

# Replace whichever playback section is currently installed.
section_re = re.compile(
    r"\n  /\*\n   \* =========================================================\n"
    r"   \* (?:EVENT-BASED PLAYBACK SYNC|SHARED ROOM TIMELINE PLAYBACK SYNC)\n"
    r"[\s\S]*?\n  /\*\n   \* =========================================================\n"
    r"   \* ROOM UI\n   \* =========================================================\n   \*/\n",
    re.MULTILINE,
)

new_sync = r'''
  /*
   * =========================================================
   * SHARED ROOM TIMELINE PLAYBACK SYNC
   * =========================================================
   *
   * Firebase playbackEvent is the room timeline. Nobody is a
   * playback master. The latest command contains videoId,
   * position, playing and updatedAt.
   *
   * Local play/pause/seek is detected before room correction.
   * Remote player callbacks are never written back as commands.
   */

  function playbackSyncRef() {
    if (!db || !state.roomId) return null;
    return db.ref(`rooms/${state.roomId}/playbackEvent`);
  }


  function getTimelinePosition(event, now = Date.now()) {
    const base = Math.max(0, Number(event?.position) || 0);

    if (event?.playing !== true) {
      return base;
    }

    const updatedAt = Number(event?.updatedAt);

    if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
      return base;
    }

    return base + Math.min(
      Math.max(0, (now - updatedAt) / 1000),
      7200
    );
  }


  function rememberRoomTimeline(event) {
    if (!event || !event.eventId) return;

    const incoming = Number(event.updatedAt || 0);
    const current = Number(state.playbackTimeline?.updatedAt || 0);

    if (
      incoming > 0 &&
      current > 0 &&
      incoming < current
    ) {
      return;
    }

    state.playbackRemoteEvent = event;
    state.playbackTimeline = {
      videoId: String(event.videoId || ""),
      position: Math.max(0, Number(event.position) || 0),
      playing: event.playing === true,
      updatedAt: incoming || Date.now(),
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
    if (!ref || !state.currentVideoId) return;

    const normalized =
      action === "pause" ? "pause" :
      action === "seek" ? "seek" : "play";

    let finalPosition = Number(position);

    if (!Number.isFinite(finalPosition)) {
      finalPosition = await asyncCurrentPosition();
    }

    finalPosition = Math.max(0, Number(finalPosition) || 0);

    const playing =
      normalized === "pause"
        ? false
        : normalized === "seek"
          ? await asyncIsPlaying()
          : true;

    const now = Date.now();
    const key =
      `${normalized}:${Math.round(finalPosition * 4) / 4}:${playing ? 1 : 0}`;

    if (
      key === state.playbackLastLocalActionKey &&
      now - Number(state.playbackLastLocalActionAt || 0) < 900
    ) {
      return;
    }

    if (
      normalized === "seek" &&
      now - Number(state.playbackLastLocalSeekWriteAt || 0) < 650
    ) {
      return;
    }

    state.playbackLastLocalActionKey = key;
    state.playbackLastLocalActionAt = now;
    state.playbackLocalIntentAt = now;

    if (normalized === "seek") {
      state.playbackLastLocalSeekWriteAt = now;
    }

    const event = {
      action: normalized,
      position: finalPosition,
      videoId: String(state.currentVideoId),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid,
      eventId: `${state.uid}_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      playing
    };

    // Make every local tab immediately obey the new room command.
    // This is a room state, not a participant master.
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
    const lastUpdatedAt = Number(
      state.playbackLastRemoteUpdatedAt || 0
    );

    if (
      !force &&
      remoteUpdatedAt > 0 &&
      lastUpdatedAt > 0 &&
      remoteUpdatedAt < lastUpdatedAt
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
    state.playbackIgnoreStateChanges = 8;
    state.playbackIgnoreStateUntil = Date.now() + 9000;
    state.playbackReadyAt = Date.now() + 1200;

    try {
      const position = getTimelinePosition(event);
      const current = await asyncCurrentPosition();

      if (Math.abs(current - position) > 0.35) {
        await applyPlayerPosition(position);
      }

      const wantedPlaying = event.playing === true;
      const currentPlaying = await asyncIsPlaying();

      if (wantedPlaying !== currentPlaying) {
        if (wantedPlaying) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
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

      if (!event || !event.eventId) return;

      rememberRoomTimeline(event);

      if (event.updatedBy === state.uid && !force) return;

      state.playbackPendingRecovery = true;
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

    rememberRoomTimeline(event);

    if (event.updatedBy === state.uid) return;

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

    if (
      now < Number(state.playbackReadyAt || 0) ||
      now < Number(state.playbackIgnoreStateUntil || 0)
    ) {
      return;
    }

    if (
      state.playerType === "youtube" &&
      now < Number(state.playbackAdGuardUntil || 0)
    ) {
      return;
    }

    if (Math.abs(position - expected) > 1.75) {
      state.playbackApplyingRemote = true;
      state.playbackPendingRecovery = true;
      state.playbackIgnoreStateUntil = Date.now() + 3000;

      try {
        await applyPlayerPosition(expected);
      } finally {
        state.playbackApplyingRemote = false;
        state.playbackPendingRecovery = false;
        state.playbackLastPosition = await asyncCurrentPosition().catch(() => null);
        state.playbackLastPlaying = await asyncIsPlaying().catch(() => null);
      }

      return;
    }

    if (timeline.playing !== playing) {
      state.playbackApplyingRemote = true;
      state.playbackPendingRecovery = true;
      state.playbackIgnoreStateUntil = Date.now() + 3000;

      try {
        if (timeline.playing) {
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
          return;
        }

        if (
          state.playbackPendingRecovery ||
          state.playbackApplyingRemote
        ) {
          state.playbackLastPosition = position;
          state.playbackLastPlaying = playing;
          return;
        }

        const sameVideo =
          timeline &&
          String(timeline.videoId || "") ===
            String(state.currentVideoId || "");

        const roomPlaying = sameVideo
          ? timeline.playing === true
          : null;

        // IMPORTANT: detect a local command BEFORE reconciling the room.
        // This is what makes a user's pause/play become the new room command
        // instead of being immediately overwritten by the old command.
        if (
          now >= Number(state.playbackReadyAt || 0) &&
          now >= Number(state.playbackIgnoreStateUntil || 0) &&
          !shouldIgnoreTransientYoutubeState()
        ) {
          if (
            state.playbackLastPlaying !== null &&
            playing !== state.playbackLastPlaying &&
            roomPlaying !== null &&
            playing !== roomPlaying
          ) {
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

            if (Math.abs(position - expected) > 1.35) {
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


  /*
   * =========================================================
   * ROOM UI
   * =========================================================
   */
'''

m = section_re.search(s)
if not m:
    raise SystemExit("playback section marker not found")
s = s[:m.start()] + "\n" + new_sync + s[m.end():]

# Never turn YouTube player callbacks into room commands. A remote pause/play
# causes the same callbacks as a local click; polling above handles local intent.
handler_re = re.compile(
    r"              onStateChange:\n"
    r"                async \(event\) => \{[\s\S]*?\n              onError:\n"
)
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

                  if (data === YT.PlayerState.BUFFERING) {
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
                    state.playbackLastPlayerState =
                      data === YT.PlayerState.PLAYING
                        ? "playing"
                        : "paused";

                    state.playbackLastObservedPosition =
                      await asyncCurrentPosition().catch(() => null);
                  }

                  if (data === YT.PlayerState.ENDED) {
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
              onError:
'''

hm = handler_re.search(s)
if not hm:
    raise SystemExit("YouTube onStateChange marker not found")
s = s[:hm.start()] + new_handler + s[hm.end():]

# Reset timeline for a completely new video.
reset_marker = "      state.playbackLastLocalSeekWriteAt = 0;\n"
reset_add = """
      state.playbackTimeline = null;
      state.playbackAdGuardUntil = 0;
      state.playbackTransientStateUntil = 0;
      state.playbackLastPlayerState = null;
      state.playbackLastObservedPosition = null;
      state.playbackPendingRecovery = false;
      state.playbackLocalIntentAt = 0;
"""
if "      state.playbackLocalIntentAt = 0;" not in s:
    if reset_marker not in s:
        raise SystemExit("new video reset marker not found")
    s = s.replace(reset_marker, reset_marker + reset_add, 1)

# Keep the room rules used by the current project, including kick protection.
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
print("WatchTogether final shared timeline pause/play repair applied")
