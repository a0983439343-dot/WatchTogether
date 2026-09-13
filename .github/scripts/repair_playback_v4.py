from pathlib import Path
import re

APP = Path("app.js")
s = APP.read_text(encoding="utf-8")

# Add state used by the local-command debounce. The command is accepted only
# when the local player state actually differs from the current room command.
state_marker = '    playbackLocalIntentAt: 0,\n'
state_add = '''    playbackPausePublishTimer: null,\n'''
if "playbackPausePublishTimer: null" not in s:
    if state_marker not in s:
        raise SystemExit("playback local intent state marker not found")
    s = s.replace(state_marker, state_marker + state_add, 1)

# There must be only one initial room-timeline recovery path.
s = s.replace(
    '                  void applyLatestRoomPlaybackState();\n',
    '',
    1,
)

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
   * SHARED ROOM TIMELINE PLAYBACK SYNC V4
   * =========================================================
   *
   * Firebase playbackEvent is the room command/time-axis.
   * There is NO master participant and nobody's player position
   * is used as the room's ongoing progress source.
   *
   * A command stores:
   *   position   = content position at command time
   *   playing    = whether the room should be playing
   *   updatedAt  = Firebase server timestamp
   *
   * Every client reconstructs the same expected position from
   * server time, so network delay does not make the late client
   * permanently lag behind the room.
   */

  function playbackClockNow() {
    if (typeof serverNow === "function") {
      return Number(serverNow());
    }

    return Date.now() + Number(
      state.playbackServerTimeOffset || 0
    );
  }


  function playbackSyncRef() {
    if (!db || !state.roomId) {
      return null;
    }

    return db.ref(
      `rooms/${state.roomId}/playbackEvent`
    );
  }


  function getTimelinePosition(event, now = playbackClockNow()) {
    const base = Math.max(
      0,
      Number(event?.position) || 0
    );

    if (event?.playing !== true) {
      return base;
    }

    const updatedAt = Number(
      event?.updatedAt
    );

    if (
      !Number.isFinite(updatedAt) ||
      updatedAt <= 0
    ) {
      return base;
    }

    const elapsed = Math.max(
      0,
      (now - updatedAt) / 1000
    );

    return base + Math.min(
      elapsed,
      7200
    );
  }


  function rememberRoomTimeline(event) {
    if (!event || !event.eventId) {
      return;
    }

    const incomingUpdatedAt = Number(
      event.updatedAt || 0
    );

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
      videoId: String(
        event.videoId || ""
      ),
      position: Math.max(
        0,
        Number(event.position) || 0
      ),
      playing: event.playing === true,
      updatedAt:
        incomingUpdatedAt || playbackClockNow(),
      eventId: String(event.eventId)
    };
  }


  function cancelPendingPausePublish() {
    clearTimeout(
      state.playbackPausePublishTimer
    );

    state.playbackPausePublishTimer = null;
  }


  function roomTimelinePlaying() {
    const timeline = state.playbackTimeline;

    if (
      !timeline ||
      String(timeline.videoId || "") !==
        String(state.currentVideoId || "")
    ) {
      return null;
    }

    return timeline.playing === true;
  }


  async function writePlaybackCommand(
    normalized,
    finalPosition,
    playing
  ) {
    if (
      !state.uid ||
      !state.roomId ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId ||
      state.playbackApplyingRemote
    ) {
      return;
    }

    const ref = playbackSyncRef();

    if (!ref) {
      return;
    }

    const position = Math.max(
      0,
      Number(finalPosition) || 0
    );

    const serverNowValue = playbackClockNow();
    const eventId =
      `${state.uid}_${Date.now()}_${++state.playbackActionSeq}_${Math.random().toString(36).slice(2)}`;

    const event = {
      action: normalized,
      position,
      videoId: String(
        state.currentVideoId
      ),
      updatedAt:
        firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid,
      eventId,
      playing: Boolean(playing)
    };

    // Optimistic local room state. The timeline is shared room state,
    // not a copy of any participant's playback clock.
    const localTimeline = {
      videoId: String(state.currentVideoId),
      position,
      playing: Boolean(playing),
      updatedAt: serverNowValue,
      eventId
    };

    state.playbackRemoteEvent = {
      ...event,
      updatedAt: serverNowValue
    };

    state.playbackTimeline = localTimeline;
    state.playbackLastRemoteEventId = eventId;
    state.playbackLastRemoteUpdatedAt = serverNowValue;
    state.playbackLastPosition = position;
    state.playbackLastPlaying = Boolean(playing);
    state.playbackLocalIntentAt = Date.now();

    try {
      await ref.set(event);
    } catch (error) {
      console.warn(
        "播放同步寫入失敗:",
        error
      );
    }
  }


  async function publishPlaybackEvent(
    action,
    position = null
  ) {
    if (
      !state.uid ||
      !state.roomId ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId ||
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

    const normalized =
      action === "pause"
        ? "pause"
        : action === "seek"
          ? "seek"
          : "play";

    let finalPosition = Number(position);

    if (!Number.isFinite(finalPosition)) {
      finalPosition =
        await asyncCurrentPosition();
    }

    finalPosition = Math.max(
      0,
      Number(finalPosition) || 0
    );

    let playing;

    if (normalized === "pause") {
      playing = false;
    } else if (normalized === "play") {
      playing = true;
    } else {
      playing = await asyncIsPlaying();
    }

    const currentRoomPlaying =
      roomTimelinePlaying();

    // A player callback created by applying a remote command has the same
    // desired state as the room command. It must NEVER be written back.
    // A genuine local play/pause flips the desired state away from the
    // current room state, so it becomes the new room command.
    if (
      normalized === "play" &&
      currentRoomPlaying === true
    ) {
      return;
    }

    if (
      normalized === "pause" &&
      currentRoomPlaying === false
    ) {
      return;
    }

    if (normalized === "pause") {
      cancelPendingPausePublish();

      // Ignore very short pauses caused by buffering/player transitions.
      // A real user pause remains paused and is then published immediately
      // after the short debounce.
      state.playbackPausePublishTimer =
        setTimeout(async () => {
          state.playbackPausePublishTimer = null;

          try {
            if (
              state.playbackApplyingRemote ||
              !state.playerReady ||
              !state.player
            ) {
              return;
            }

            const stillPaused =
              !(await asyncIsPlaying());

            if (!stillPaused) {
              return;
            }

            const roomPlaying =
              roomTimelinePlaying();

            if (roomPlaying === false) {
              return;
            }

            const nowPosition =
              await asyncCurrentPosition();

            await writePlaybackCommand(
              "pause",
              nowPosition,
              false
            );
          } catch (error) {
            console.warn(
              "本機暫停同步失敗:",
              error
            );
          }
        }, 300);

      return;
    }

    if (normalized === "play") {
      cancelPendingPausePublish();
    }

    if (normalized === "seek") {
      const timeline =
        state.playbackTimeline;

      const expected = timeline
        ? getTimelinePosition(
            timeline
          )
        : null;

      if (
        expected !== null &&
        Math.abs(
          finalPosition - expected
        ) < 0.85
      ) {
        // This is normal playback drift, not a user seek.
        return;
      }
    }

    const now = Date.now();
    const key =
      `${normalized}:${Math.round(finalPosition * 4) / 4}:${playing ? 1 : 0}`;

    if (
      key === state.playbackLastLocalActionKey &&
      now - Number(
        state.playbackLastLocalActionAt || 0
      ) < 700
    ) {
      return;
    }

    if (
      normalized === "seek" &&
      now - Number(
        state.playbackLastLocalSeekWriteAt || 0
      ) < 450
    ) {
      return;
    }

    state.playbackLastLocalActionKey = key;
    state.playbackLastLocalActionAt = now;

    if (normalized === "seek") {
      state.playbackLastLocalSeekWriteAt = now;
    }

    await writePlaybackCommand(
      normalized,
      finalPosition,
      playing
    );
  }


  async function applyRemotePlaybackEvent(
    event,
    force = false
  ) {
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

    if (
      !["play", "pause", "seek"].includes(
        event.action
      )
    ) {
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

    const eventId = String(
      event.eventId || ""
    );

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

    const remoteUpdatedAt = Number(
      event.updatedAt || 0
    );

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
      state.playbackLastRemoteUpdatedAt =
        remoteUpdatedAt;
    }

    if (
      state.playbackApplyingRemoteEventId ===
      eventId
    ) {
      return;
    }

    cancelPendingPausePublish();

    state.playbackLastRemoteEventId =
      eventId;
    state.playbackApplyingRemoteEventId =
      eventId;
    state.playbackApplyingRemote = true;
    state.playbackPendingRecovery = true;
    state.playbackIgnoreStateChanges = 12;
    state.playbackIgnoreStateUntil =
      Date.now() + 8000;
    state.playbackReadyAt =
      Date.now() + 1000;

    try {
      const expected =
        getTimelinePosition(
          event
        );

      const current =
        await asyncCurrentPosition();

      if (
        Math.abs(
          current - expected
        ) > 0.45
      ) {
        await applyPlayerPosition(
          expected
        );
      }

      const wantedPlaying =
        event.playing === true;

      const currentPlaying =
        await asyncIsPlaying();

      // Force the room command. A remote pause must stop this player;
      // a remote play must start it. No participant is the time master.
      if (
        wantedPlaying !== currentPlaying
      ) {
        if (wantedPlaying) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      }

      state.playbackLastPosition =
        await asyncCurrentPosition();
      state.playbackLastPlaying =
        await asyncIsPlaying();
    } catch (error) {
      console.warn(
        "套用房間播放命令失敗:",
        error
      );
    } finally {
      state.playbackApplyingRemote =
        false;
      state.playbackPendingRecovery =
        false;
      state.playbackApplyingRemoteEventId =
        null;
    }
  }


  async function applyLatestRoomPlaybackState(
    force = false
  ) {
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
      const event =
        (await ref.once("value"))
          .val();

      if (
        !event ||
        !event.eventId
      ) {
        return;
      }

      rememberRoomTimeline(
        event
      );

      state.playbackPendingRecovery =
        true;

      await applyRemotePlaybackEvent(
        event,
        force || event.updatedBy !== state.uid
      );
    } catch (error) {
      state.playbackPendingRecovery =
        false;

      console.warn(
        "讀取最新房間播放時間軸失敗:",
        error
      );
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

    ref.on(
      "value",
      handleRemotePlaybackSnapshot
    );

    state.playbackListenerAttached =
      true;
  }


  function handleRemotePlaybackSnapshot(
    snapshot
  ) {
    const event =
      snapshot?.val?.() ||
      null;

    if (
      !event ||
      !event.eventId
    ) {
      return;
    }

    rememberRoomTimeline(
      event
    );

    if (
      String(event.updatedBy || "") ===
      String(state.uid || "")
    ) {
      return;
    }

    if (
      state.playbackLastRemoteEventId ===
      String(event.eventId)
    ) {
      return;
    }

    state.playbackPendingRecovery =
      true;

    void applyRemotePlaybackEvent(
      event
    );
  }


  async function reconcileRoomTimeline() {
    if (
      !state.playbackTimeline ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId ||
      state.playbackApplyingRemote ||
      state.playbackPendingRecovery
    ) {
      return;
    }

    const timeline =
      state.playbackTimeline;

    if (
      String(timeline.videoId || "") !==
      String(state.currentVideoId || "")
    ) {
      return;
    }

    const now =
      playbackClockNow();

    const expected =
      getTimelinePosition(
        timeline,
        now
      );

    const current =
      await asyncCurrentPosition();

    const playing =
      await asyncIsPlaying();

    if (
      now < Number(
        state.playbackReadyAt || 0
      ) ||
      now < Number(
        state.playbackIgnoreStateUntil || 0
      )
    ) {
      return;
    }

    const drift = Math.abs(
      current - expected
    );

    // The expected position is derived from Firebase server time, so this
    // corrects actual network delay instead of adding another client delay.
    if (drift > 1.15) {
      state.playbackApplyingRemote =
        true;
      state.playbackPendingRecovery =
        true;
      state.playbackIgnoreStateChanges =
        4;
      state.playbackIgnoreStateUntil =
        Date.now() + 2500;

      try {
        await applyPlayerPosition(
          expected
        );
      } catch (error) {
        console.warn(
          "房間時間軸校正失敗:",
          error
        );
      } finally {
        state.playbackApplyingRemote =
          false;
        state.playbackPendingRecovery =
          false;
        state.playbackLastPosition =
          await asyncCurrentPosition().catch(
            () => null
          );
        state.playbackLastPlaying =
          await asyncIsPlaying().catch(
            () => null
          );
      }

      return;
    }

    // PLAY/PAUSE is a room command. Keep enforcing it on every client.
    // A paused member cannot silently continue while the room says paused.
    if (
      timeline.playing !== playing
    ) {
      state.playbackApplyingRemote =
        true;
      state.playbackPendingRecovery =
        true;
      state.playbackIgnoreStateChanges =
        4;
      state.playbackIgnoreStateUntil =
        Date.now() + 2500;

      try {
        if (timeline.playing) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      } catch (error) {
        console.warn(
          "房間播放狀態校正失敗:",
          error
        );
      } finally {
        state.playbackApplyingRemote =
          false;
        state.playbackPendingRecovery =
          false;
        state.playbackLastPosition =
          await asyncCurrentPosition().catch(
            () => null
          );
        state.playbackLastPlaying =
          await asyncIsPlaying().catch(
            () => null
          );
      }
    }
  }


  async function inspectLocalPlaybackChange() {
    if (
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId ||
      state.playbackApplyingRemote ||
      state.playbackPendingRecovery
    ) {
      return;
    }

    const timeline =
      state.playbackTimeline;

    if (!timeline) {
      return;
    }

    if (
      String(timeline.videoId || "") !==
      String(state.currentVideoId || "")
    ) {
      return;
    }

    const now =
      playbackClockNow();

    if (
      now < Number(
        state.playbackReadyAt || 0
      ) ||
      now < Number(
        state.playbackIgnoreStateUntil || 0
      )
    ) {
      return;
    }

    const position =
      await asyncCurrentPosition();
    const playing =
      await asyncIsPlaying();
    const expected =
      getTimelinePosition(
        timeline,
        now
      );

    const roomPlaying =
      timeline.playing === true;

    // State change against the room command means local intent. For pause,
    // publishPlaybackEvent adds a small debounce to avoid buffering blips.
    if (
      playing !== roomPlaying
    ) {
      await publishPlaybackEvent(
        playing ? "play" : "pause",
        position
      );

      return;
    }

    // A large position jump while the room play state stays unchanged is a
    // local seek. Normal network drift is ignored here because it is close
    // to the server-time-derived expected position.
    if (
      Math.abs(
        position - expected
      ) > 2.0
    ) {
      await publishPlaybackEvent(
        "seek",
        position
      );
    }
  }


  function stopPlaybackSeekDetector() {
    clearInterval(
      state.playbackSeekTimer
    );

    state.playbackSeekTimer =
      null;

    cancelPendingPausePublish();

    state.playbackLastPosition =
      null;
    state.playbackLastPlaying =
      null;
    state.playbackLastPlayerState =
      null;
    state.playbackLastObservedPosition =
      null;
  }


  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();

    state.playbackReadyAt =
      Date.now() + 700;

    state.playbackSeekTimer =
      setInterval(() => {
        void inspectLocalPlaybackChange();
        void reconcileRoomTimeline();
      }, 300);
  }


  function recoverPlaybackAfterPageResume() {
    clearTimeout(
      state.playbackRecoveryTimer
    );

    state.playbackRecoveryTimer =
      setTimeout(() => {
        state.playbackRecoveryTimer =
          null;

        void applyLatestRoomPlaybackState(
          true
        );
        startPlaybackSeekDetector();
      }, 350);
  }


  function syncPlaybackAfterPlayerReady() {
    state.playbackReadyAt =
      Date.now() + 500;

    void applyLatestRoomPlaybackState(
      true
    );

    startPlaybackSeekDetector();
  }

'''

m = section_re.search(s)
if not m:
    raise SystemExit("playback section not found")

replacement = "\n" + new_sync + "  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */\n"
s = s[:m.start()] + replacement + s[m.end():]

APP.write_text(s, encoding="utf-8")
