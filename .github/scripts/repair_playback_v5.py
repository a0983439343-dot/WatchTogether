from pathlib import Path
import re

APP = Path("app.js")
s = APP.read_text(encoding="utf-8")

# Ensure every state field used by this sync engine exists exactly once.
fields = {
    '    playbackLocalIntentAt: 0,\n': 'playbackLocalIntentAt: 0',
    '    playbackPausePublishTimer: null,\n': 'playbackPausePublishTimer: null',
}
marker = '    playbackPendingRecovery: false,\n'
if marker not in s:
    raise SystemExit("playback pending recovery state marker not found")
for line, key in fields.items():
    if key not in s:
        s = s.replace(marker, marker + line, 1)

# Remove duplicate initial recovery from the YouTube ready callback if present.
s = s.replace(
    '                  void applyLatestRoomPlaybackState();\n',
    '',
    1,
)

section_re = re.compile(
    r"\n  /\*\n   \* =========================================================\n"
    r"   \* (?:EVENT-BASED PLAYBACK SYNC|SHARED ROOM TIMELINE PLAYBACK SYNC(?: V[0-9]+)?)\n"
    r"[\s\S]*?\n  /\*\n   \* =========================================================\n"
    r"   \* ROOM UI\n   \* =========================================================\n   \*/\n",
    re.MULTILINE,
)

new_sync = r'''
  /*
   * =========================================================
   * SHARED ROOM TIMELINE PLAYBACK SYNC V5
   * =========================================================
   *
   * Firebase stores ONE shared room command, not a master player.
   * No participant's continuously changing currentTime is used as
   * the room progress source.
   *
   * Every command has:
   *   position  = content position at command time
   *   playing   = room playback state
   *   updatedAt = Firebase server time
   *
   * While playing, each client reconstructs the same expected position
   * from the room command and server clock.
   *
   * A local app control creates the room command first. Remote commands
   * are applied with a guard so the resulting YouTube callbacks never
   * echo the command back into Firebase.
   */

  function playbackClockNow() {
    if (typeof serverNow === "function") {
      const value = Number(serverNow());
      if (Number.isFinite(value) && value > 0) {
        return value;
      }
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


  function getTimelinePosition(
    timeline,
    now = playbackClockNow()
  ) {
    const base = Math.max(
      0,
      Number(timeline?.position) || 0
    );

    if (timeline?.playing !== true) {
      return base;
    }

    const updatedAt = Number(
      timeline?.updatedAt || 0
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
      return false;
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
      return false;
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

    return true;
  }


  function cancelPendingPausePublish() {
    clearTimeout(
      state.playbackPausePublishTimer
    );

    state.playbackPausePublishTimer = null;
  }


  function roomTimelinePlaying() {
    const timeline =
      state.playbackTimeline;

    if (
      !timeline ||
      String(timeline.videoId || "") !==
        String(state.currentVideoId || "")
    ) {
      return null;
    }

    return timeline.playing === true;
  }


  function markLocalPlaybackIntent() {
    state.playbackLocalIntentAt =
      Date.now();
  }


  async function writePlaybackCommand(
    action,
    position,
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

    const finalPosition = Math.max(
      0,
      Number(position) || 0
    );

    const now = playbackClockNow();
    const eventId =
      `${state.uid}_${Date.now()}_${++state.playbackActionSeq}_${Math.random().toString(36).slice(2)}`;

    const event = {
      action,
      position: finalPosition,
      videoId: String(
        state.currentVideoId
      ),
      updatedAt:
        firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid,
      eventId,
      playing: Boolean(playing)
    };

    state.playbackRemoteEvent = {
      ...event,
      updatedAt: now
    };

    state.playbackTimeline = {
      videoId: String(
        state.currentVideoId
      ),
      position: finalPosition,
      playing: Boolean(playing),
      updatedAt: now,
      eventId
    };

    state.playbackLastRemoteEventId =
      eventId;
    state.playbackLastRemoteUpdatedAt =
      now;
    state.playbackLastPosition =
      finalPosition;
    state.playbackLastPlaying =
      Boolean(playing);

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
    position = null,
    explicitPlaying = undefined
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
    } else if (typeof explicitPlaying === "boolean") {
      playing = explicitPlaying;
    } else {
      playing = await asyncIsPlaying();
    }

    const roomPlaying =
      roomTimelinePlaying();

    /*
     * A YouTube callback produced by our own remote command must not
     * create a new room command. Likewise, a repeated click on a control
     * that already reflects the room state should not create a fake change.
     */
    if (
      (normalized === "play" && roomPlaying === true) ||
      (normalized === "pause" && roomPlaying === false)
    ) {
      return;
    }

    /*
     * Pause callbacks can be produced by transient buffering/player state.
     * Wait briefly and publish only if the player is still actually paused.
     * The app's explicit pause button calls this function directly, so it
     * still becomes the room command immediately after the debounce.
     */
    if (normalized === "pause") {
      cancelPendingPausePublish();
      markLocalPlaybackIntent();

      state.playbackPausePublishTimer =
        setTimeout(async () => {
          state.playbackPausePublishTimer =
            null;

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

            if (
              roomTimelinePlaying() === false
            ) {
              return;
            }

            await writePlaybackCommand(
              "pause",
              await asyncCurrentPosition(),
              false
            );
          } catch (error) {
            console.warn(
              "本機暫停同步失敗:",
              error
            );
          }
        }, 220);

      return;
    }

    if (normalized === "play") {
      cancelPendingPausePublish();
      markLocalPlaybackIntent();
    }

    /*
     * Seek is accepted only when it is a meaningful jump away from the
     * shared timeline. Normal drift correction must never create a new
     * room command.
     */
    if (normalized === "seek") {
      const timeline =
        state.playbackTimeline;

      if (timeline) {
        const expected =
          getTimelinePosition(timeline);

        if (
          Math.abs(
            finalPosition - expected
          ) < 1.2
        ) {
          return;
        }
      }

      markLocalPlaybackIntent();
    }

    const now = Date.now();
    const key =
      `${normalized}:${Math.round(finalPosition * 4) / 4}:${playing ? 1 : 0}`;

    if (
      key === state.playbackLastLocalActionKey &&
      now - Number(
        state.playbackLastLocalActionAt || 0
      ) < 650
    ) {
      return;
    }

    if (
      normalized === "seek" &&
      now - Number(
        state.playbackLastLocalSeekWriteAt || 0
      ) < 400
    ) {
      return;
    }

    state.playbackLastLocalActionKey =
      key;
    state.playbackLastLocalActionAt =
      now;

    if (normalized === "seek") {
      state.playbackLastLocalSeekWriteAt =
        now;
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

    const incomingUpdatedAt = Number(
      event.updatedAt || 0
    );

    const lastUpdatedAt = Number(
      state.playbackLastRemoteUpdatedAt || 0
    );

    if (
      !force &&
      incomingUpdatedAt > 0 &&
      lastUpdatedAt > 0 &&
      incomingUpdatedAt < lastUpdatedAt
    ) {
      return;
    }

    if (
      !force &&
      state.playbackLastRemoteEventId === eventId
    ) {
      rememberRoomTimeline(event);
      return;
    }

    if (
      !force &&
      event.updatedBy === state.uid
    ) {
      rememberRoomTimeline(event);
      return;
    }

    rememberRoomTimeline(event);

    cancelPendingPausePublish();

    state.playbackLastRemoteEventId =
      eventId;

    if (incomingUpdatedAt > 0) {
      state.playbackLastRemoteUpdatedAt =
        incomingUpdatedAt;
    }

    state.playbackApplyingRemoteEventId =
      eventId;
    state.playbackApplyingRemote =
      true;
    state.playbackPendingRecovery =
      true;
    state.playbackIgnoreStateChanges =
      16;
    state.playbackIgnoreStateUntil =
      Date.now() + 9000;
    state.playbackReadyAt =
      Date.now() + 900;

    try {
      const expected =
        getTimelinePosition(event);

      const current =
        await asyncCurrentPosition();

      /*
       * Everyone seeks to the shared room time. There is no participant
       * whose current position is copied into the room.
       */
      if (
        Math.abs(
          current - expected
        ) > 0.35
      ) {
        await applyPlayerPosition(
          expected
        );
      }

      const wantPlaying =
        event.playing === true;

      const currentlyPlaying =
        await asyncIsPlaying();

      /*
       * Force the room state. A pause means every client pauses; a play
       * means every client plays, including a client that was just opened.
       */
      if (
        wantPlaying !== currentlyPlaying
      ) {
        if (wantPlaying) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      }

      state.playbackLastPosition =
        await asyncCurrentPosition();
      state.playbackLastPlaying =
        await asyncIsPlaying();

      if ($("syncStatus")) {
        $("syncStatus").textContent =
          `已同步 ${formatTime(expected)}`;
      }
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

      rememberRoomTimeline(event);

      /*
       * On a new client, applying the latest room command is mandatory.
       * A local copy of the database event is never treated as a reason
       * to skip initial recovery.
       */
      await applyRemotePlaybackEvent(
        event,
        true
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

    /*
     * Initial room state is the source for a late joiner. It is not a
     * participant and it does not depend on another user's player.
     */
    setTimeout(() => {
      void applyLatestRoomPlaybackState(
        true
      );
    }, 180);
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

    if (!state.currentVideoId) {
      rememberRoomTimeline(event);
      return;
    }

    rememberRoomTimeline(event);

    if (
      event.updatedBy === state.uid
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
      event,
      false
    );
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

    const timeline =
      state.playbackTimeline;

    if (
      !timeline ||
      String(timeline.videoId || "") !==
      String(state.currentVideoId || "")
    ) {
      return;
    }

    const now =
      playbackClockNow();

    const position =
      await asyncCurrentPosition();

    const playing =
      await asyncIsPlaying();

    const expected =
      getTimelinePosition(
        timeline,
        now
      );

    state.playbackLastObservedPosition =
      position;

    if (
      now < Number(
        state.playbackReadyAt || 0
      )
    ) {
      return;
    }

    const drift =
      Math.abs(
        position - expected
      );

    /*
     * Strong room state: a room pause/play always wins over local drift.
     * This is how a single pause stops every participant.
     */
    const wantPlaying =
      timeline.playing === true;

    if (
      wantPlaying !== playing
    ) {
      state.playbackApplyingRemote =
        true;
      state.playbackPendingRecovery =
        true;
      state.playbackIgnoreStateChanges =
        8;
      state.playbackIgnoreStateUntil =
        Date.now() + 4000;

      try {
        if (wantPlaying) {
          await playPlayer();
        } else {
          await pausePlayer();
        }
      } finally {
        state.playbackApplyingRemote =
          false;
        state.playbackPendingRecovery =
          false;
      }

      return;
    }

    /*
     * Small natural clock/network drift is ignored. Larger drift is a
     * correction to the room timeline, never an update of that timeline.
     */
    if (
      drift > 1.35
    ) {
      state.playbackApplyingRemote =
        true;
      state.playbackPendingRecovery =
        true;
      state.playbackIgnoreStateChanges =
        8;
      state.playbackIgnoreStateUntil =
        Date.now() + 4000;

      try {
        await applyPlayerPosition(
          expected
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

      if ($("syncStatus")) {
        $("syncStatus").textContent =
          `已校正 ${formatTime(expected)}`;
      }
    }
  }


  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();

    state.playbackReadyAt =
      Date.now() + 700;

    /*
     * The detector is a ROOM-TIMELINE CORRECTOR. It deliberately does not
     * write currentTime into Firebase. The room command is changed only by
     * explicit playback controls/state-intent or a meaningful local seek.
     */
    state.playbackSeekTimer =
      setInterval(async () => {
        try {
          if (
            !state.playerReady ||
            !state.player ||
            !state.currentVideoId
          ) {
            return;
          }

          if (
            state.playbackApplyingRemote ||
            state.playbackPendingRecovery
          ) {
            return;
          }

          await reconcileRoomTimeline();
        } catch (error) {
          console.warn(
            "播放時間軸校正失敗:",
            error
          );
        }
      }, 700);
  }


  function schedulePlaybackRecovery() {
    clearTimeout(
      state.playbackRecoveryTimer
    );

    state.playbackRecoveryTimer =
      setTimeout(() => {
        state.playbackRecoveryTimer =
          null;

        if (
          document.visibilityState ===
            "visible"
        ) {
          void applyLatestRoomPlaybackState(
            true
          );
        }
      }, 350);
  }


  function recoverPlaybackAfterPageResume() {
    if (
      document.visibilityState === "hidden" ||
      !state.roomId ||
      !state.uid ||
      !state.playerReady
    ) {
      return;
    }

    schedulePlaybackRecovery();
  }


  if (!state.__sharedPlaybackLifecycleBound) {
    state.__sharedPlaybackLifecycleBound =
      true;

    document.addEventListener(
      "visibilitychange",
      () => {
        if (
          document.visibilityState ===
            "visible"
        ) {
          recoverPlaybackAfterPageResume();
        }
      }
    );

    window.addEventListener(
      "pageshow",
      () => {
        recoverPlaybackAfterPageResume();
      }
    );
  }


  '''

m = section_re.search(s)
if not m:
    raise SystemExit("playback sync section markers not found")

replacement = "\n" + new_sync + "  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */\n"
s = s[:m.start()] + replacement + s[m.end():]

APP.write_text(s, encoding="utf-8")
print("playback repair v5 applied")
