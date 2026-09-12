from pathlib import Path
import json

APP = Path("app.js")
INDEX = Path("index.html")
RULES = Path("database.rules.json")
README = Path("README.md")

text = APP.read_text(encoding="utf-8")


def replace_once(old, new, name):
    global text
    if old not in text:
        raise SystemExit(f"{name} marker not found")
    text = text.replace(old, new, 1)


replace_once(
    "    kickedLocally: false,\n",
    """    kickedLocally: false,\n
    playbackListenerAttached: false,\n
    playbackApplyingRemote: false,\n
    playbackReadyAt: 0,\n
    playbackRoomEvent: null,\n
    playbackLastPosition: null,\n
    playbackLastPlaying: null,\n
    playbackLastSampleAt: 0,\n
    playbackSeekTimer: null,\n""",
    "state"
)

sync_code = r'''  /*
   * =========================================================
   * ROOM PLAYBACK SYNC
   * =========================================================
   * 每位成員只寫自己的 members/{roomId}/{uid}/playback。
   * 房間內讀取 members/{roomId} 後取最新播放狀態，並持續修正
   * 小幅播放誤差，讓晚加入的成員也能直接追上目前位置。
   */

  function playbackSyncRef() {
    if (!state.membersRef || !state.roomId) {
      return null;
    }

    return state.membersRef;
  }


  function isPlaybackEventValid(event) {
    if (!event) {
      return false;
    }

    if (
      event.action !== "play" &&
      event.action !== "pause" &&
      event.action !== "seek"
    ) {
      return false;
    }

    if (
      typeof event.videoId !== "string" ||
      !event.videoId
    ) {
      return false;
    }

    if (!Number.isFinite(Number(event.position))) {
      return false;
    }

    if (!Number.isFinite(Number(event.updatedAt))) {
      return false;
    }

    if (
      typeof event.updatedBy !== "string" ||
      !event.updatedBy
    ) {
      return false;
    }

    if (
      typeof event.eventId !== "string" ||
      !event.eventId
    ) {
      return false;
    }

    return true;
  }


  function getPlaybackEventTime(event) {
    const time = Number(event?.updatedAt);
    return Number.isFinite(time) ? time : 0;
  }


  function eventShouldBePlaying(event) {
    if (!event) {
      return false;
    }

    if (event.action === "play") {
      return true;
    }

    if (event.action === "pause") {
      return false;
    }

    return event.playing !== false;
  }


  function getExpectedPlaybackPosition(event, now = Date.now()) {
    const base = Math.max(
      0,
      Number(event?.position) || 0
    );

    if (!eventShouldBePlaying(event)) {
      return base;
    }

    const updatedAt = getPlaybackEventTime(event);
    const elapsed = Math.max(
      0,
      now - updatedAt
    ) / 1000;

    return base + elapsed;
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

    if (!state.membersRef) {
      return;
    }

    const playbackRef = state.membersRef
      .child(state.uid)
      .child("playback");

    let finalPosition = Number(position);

    if (!Number.isFinite(finalPosition)) {
      try {
        finalPosition = await asyncCurrentPosition();
      } catch (_) {
        return;
      }
    }

    finalPosition = Math.max(
      0,
      Number(finalPosition) || 0
    );

    let playing = false;

    try {
      playing = await asyncIsPlaying();
    } catch (_) {}

    const normalizedAction =
      action === "pause"
        ? "pause"
        : action === "seek"
          ? "seek"
          : "play";

    if (normalizedAction === "play") {
      playing = true;
    }

    if (normalizedAction === "pause") {
      playing = false;
    }

    const event = {
      action: normalizedAction,
      position: finalPosition,
      videoId: String(state.currentVideoId),
      updatedAt: firebase.database.ServerValue.TIMESTAMP,
      updatedBy: state.uid,
      eventId:
        `${state.uid}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2)}`,
      playing
    };

    state.playbackRoomEvent = {
      ...event,
      updatedAt: Date.now()
    };

    state.lastPlaybackEventId = event.eventId;

    try {
      await playbackRef.set(event);
    } catch (error) {
      console.error(
        "播放同步寫入失敗:",
        error
      );
    }
  }


  async function applyRemotePlaybackEvent(
    event,
    force = false
  ) {
    if (
      !isPlaybackEventValid(event) ||
      !state.playerReady ||
      !state.player ||
      !state.currentVideoId
    ) {
      return;
    }

    if (
      String(event.videoId) !==
      String(state.currentVideoId)
    ) {
      return;
    }

    if (
      !force &&
      event.updatedBy === state.uid
    ) {
      return;
    }

    if (
      !force &&
      event.eventId ===
        state.lastPlaybackEventId
    ) {
      return;
    }

    state.playbackApplyingRemote = true;
    state.playbackReadyAt = Date.now() + 300;

    try {
      const position =
        getExpectedPlaybackPosition(event);

      const shouldPlay =
        eventShouldBePlaying(event);

      await applyPlayerPosition(position);

      if (shouldPlay) {
        await playPlayer();
      } else {
        await pausePlayer();
      }
    } catch (error) {
      console.error(
        "套用遠端播放狀態失敗:",
        error
      );
    } finally {
      state.lastPlaybackEventId =
        event.eventId;

      try {
        state.playbackLastPosition =
          await asyncCurrentPosition();

        state.playbackLastPlaying =
          await asyncIsPlaying();
      } catch (_) {}

      state.playbackLastSampleAt =
        Date.now();

      state.playbackApplyingRemote = false;
    }
  }


  function findLatestPlaybackEvent(
    members
  ) {
    let latest = null;
    let latestTime = -1;
    let latestId = "";

    for (const member of Object.values(members || {})) {
      const event = member?.playback;

      if (!isPlaybackEventValid(event)) {
        continue;
      }

      const time = getPlaybackEventTime(event);
      const id = String(event.eventId || "");

      if (
        time > latestTime ||
        (time === latestTime && id > latestId)
      ) {
        latest = event;
        latestTime = time;
        latestId = id;
      }
    }

    return latest;
  }


  async function handleRemotePlaybackSnapshot(
    snapshot
  ) {
    const members =
      snapshot?.val?.() ||
      {};

    const latest =
      findLatestPlaybackEvent(members);

    if (!latest) {
      return;
    }

    const latestTime =
      getPlaybackEventTime(latest);

    const previousTime =
      getPlaybackEventTime(state.playbackRoomEvent);

    if (
      state.playbackRoomEvent &&
      latestTime < previousTime
    ) {
      return;
    }

    if (
      state.playbackRoomEvent &&
      latestTime === previousTime &&
      String(latest.eventId || "") ===
        String(state.playbackRoomEvent.eventId || "")
    ) {
      return;
    }

    state.playbackRoomEvent = latest;

    if (latest.updatedBy === state.uid) {
      state.lastPlaybackEventId =
        latest.eventId;
      return;
    }

    await applyRemotePlaybackEvent(latest);
  }


  async function applyLatestRoomPlaybackState() {
    if (!state.playbackRoomEvent) {
      return;
    }

    await applyRemotePlaybackEvent(
      state.playbackRoomEvent,
      true
    );
  }


  function attachPlaybackSyncListener() {
    if (
      !state.membersRef ||
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

    state.playbackListenerAttached = true;
  }


  function detachPlaybackSyncListener() {
    if (!state.playbackListenerAttached) {
      return;
    }

    const ref = playbackSyncRef();

    if (ref) {
      ref.off(
        "value",
        handleRemotePlaybackSnapshot
      );
    }

    state.playbackListenerAttached = false;
  }


  function stopPlaybackSeekDetector() {
    clearInterval(
      state.playbackSeekTimer
    );

    state.playbackSeekTimer = null;
    state.playbackLastPosition = null;
    state.playbackLastPlaying = null;
    state.playbackLastSampleAt = 0;
  }


  function startPlaybackSeekDetector() {
    stopPlaybackSeekDetector();

    state.playbackReadyAt =
      Date.now() + 500;

    state.playbackLastSampleAt =
      Date.now();

    state.playbackSeekTimer =
      setInterval(
        async () => {
          if (
            !state.playerReady ||
            !state.player ||
            state.playbackApplyingRemote
          ) {
            return;
          }

          const event =
            state.playbackRoomEvent;

          if (
            !isPlaybackEventValid(event) ||
            String(event.videoId || "") !==
              String(state.currentVideoId || "")
          ) {
            return;
          }

          let current = 0;
          let playing = false;

          try {
            current = await asyncCurrentPosition();
            playing = await asyncIsPlaying();
          } catch (_) {
            return;
          }

          const now = Date.now();
          const expected =
            getExpectedPlaybackPosition(
              event,
              now
            );

          const shouldPlay =
            eventShouldBePlaying(event);

          if (
            shouldPlay &&
            !playing
          ) {
            state.playbackApplyingRemote = true;

            try {
              await applyPlayerPosition(expected);
              await playPlayer();
            } catch (_) {
            } finally {
              state.playbackApplyingRemote = false;
            }

            return;
          }

          if (
            !shouldPlay &&
            playing
          ) {
            state.playbackApplyingRemote = true;

            try {
              await applyPlayerPosition(expected);
              await pausePlayer();
            } catch (_) {
            } finally {
              state.playbackApplyingRemote = false;
            }

            return;
          }

          const drift =
            Math.abs(
              current - expected
            );

          if (drift >= 0.85) {
            state.playbackApplyingRemote = true;

            try {
              await applyPlayerPosition(expected);
            } catch (_) {
            } finally {
              state.playbackApplyingRemote = false;
            }
          }

          state.playbackLastPosition =
            current;

          state.playbackLastPlaying =
            playing;

          state.playbackLastSampleAt =
            now;
        },
        750
      );
  }


'''

room_ui_marker = "  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */"
room_ui_pos = text.find(room_ui_marker)
if room_ui_pos < 0:
    raise SystemExit("ROOM UI marker not found")
text = text[:room_ui_pos] + sync_code + text[room_ui_pos:]

replace_once(
    '''      await buildYoutubePlayer(
        videoId,
        true
      );

      return;
''',
    '''      await buildYoutubePlayer(
        videoId,
        state.isOwner
      );

      void applyLatestRoomPlaybackState();
      startPlaybackSeekDetector();

      return;
''',
    "youtube room playback"
)

replace_once(
    '''    await buildPlatformPlayer(
      normalized
    );
  }
''',
    '''    await buildPlatformPlayer(
      normalized
    );

    void applyLatestRoomPlaybackState();
    startPlaybackSeekDetector();
  }
''',
    "platform room playback"
)

replace_once(
    '''    if (
      !state.chatListenerAttached
    ) {
''',
    '''    attachPlaybackSyncListener();

    if (
      !state.chatListenerAttached
    ) {
''',
    "playback listener attach"
)

replace_once(
    '''          if (
            await asyncIsPlaying()
          ) {
            await pausePlayer();
          } else {
            await playPlayer();
          }

          updateTimeUI();
''',
    '''          const position =
            await asyncCurrentPosition();

          if (
            await asyncIsPlaying()
          ) {
            await pausePlayer();
            void publishPlaybackEvent(
              "pause",
              position
            );
          } else {
            await playPlayer();
            void publishPlaybackEvent(
              "play",
              position
            );
          }

          updateTimeUI();
''',
    "play pause control"
)

replace_once(
    '''          await applyPlayerPosition(
            target
          );
        }
      );''',
    '''          await applyPlayerPosition(
            target
          );

          void publishPlaybackEvent(
            "seek",
            target
          );
        }
      );''',
    "back control"
)

replace_once(
    '''          await applyPlayerPosition(
            target
          );
        }
      );''',
    '''          await applyPlayerPosition(
            target
          );

          void publishPlaybackEvent(
            "seek",
            target
          );
        }
      );''',
    "forward control"
)

replace_once(
    '''                  forceYoutubeVisible();

                  if (
                    event.data ===
                    YT.PlayerState.ENDED
                  ) {''',
    '''                  forceYoutubeVisible();

                  if (
                    event.data ===
                    YT.PlayerState.PLAYING
                  ) {
                    void publishPlaybackEvent(
                      "play"
                    );
                  }

                  if (
                    event.data ===
                    YT.PlayerState.PAUSED
                  ) {
                    void publishPlaybackEvent(
                      "pause"
                    );
                  }

                  if (
                    event.data ===
                    YT.PlayerState.ENDED
                  ) {''',
    "youtube playback events"
)

replace_once(
    '''          void buildYoutubePlayer(
            id,
            true
          );
''',
    '''          void buildYoutubePlayer(
            id,
            state.isOwner
          );
''',
    "youtube ready autoplay"
)

replace_once(
    '''      clearInterval(
        state.memberHeartbeatTimer
      );

      unlockPageScroll();
''',
    '''      clearInterval(
        state.memberHeartbeatTimer
      );

      stopPlaybackSeekDetector();

      unlockPageScroll();
''',
    "unload playback detector"
)

replace_once(
    '''    state.roomRef
        ?.child("video")
        .off();

    } catch (_) {}
''',
    '''    state.roomRef
        ?.child("video")
        .off();

      detachPlaybackSyncListener();

      stopPlaybackSeekDetector();

    } catch (_) {}
''',
    "cleanup listeners"
)

replace_once(
    '''    state.playbackApplyingRemote =
      false;

    state.membersListenerAttached =
''',
    '''    state.playbackApplyingRemote =
      false;

    state.playbackRoomEvent =
      null;

    state.lastPlaybackEventId =
      null;

    state.membersListenerAttached =
''',
    "cleanup playback state"
)

index_text = INDEX.read_text(encoding="utf-8")
index_text = index_text.replace("\n              allowfullscreen", "")
INDEX.write_text(index_text, encoding="utf-8")

rules = json.loads(RULES.read_text(encoding="utf-8"))
room = rules["rules"]["rooms"]["$roomId"]
room["sourceType"][".write"] = (
    "auth != null && root.child('members').child($roomId).child(auth.uid).exists()"
)
room["video"][".write"] = (
    "auth != null && root.child('members').child($roomId).child(auth.uid).exists()"
)
room.pop("playbackEvent", None)

members_uid = rules["rules"]["members"]["$roomId"]["$uid"]
members_uid["playback"] = {
    ".validate": (
        "!newData.exists() || ("
        "newData.hasChildren(['action','position','videoId','updatedAt','updatedBy','eventId','playing']) && "
        "newData.child('action').isString() && "
        "(newData.child('action').val() === 'play' || "
        "newData.child('action').val() === 'pause' || "
        "newData.child('action').val() === 'seek') && "
        "newData.child('position').isNumber() && "
        "newData.child('position').val() >= 0 && "
        "newData.child('videoId').isString() && "
        "newData.child('videoId').val().length > 0 && "
        "newData.child('videoId').val().length <= 200 && "
        "newData.child('updatedAt').isNumber() && "
        "newData.child('updatedBy').val() === $uid && "
        "newData.child('eventId').isString() && "
        "newData.child('eventId').val().length > 0 && "
        "newData.child('eventId').val().length <= 200 && "
        "newData.child('playing').isBoolean()"
        ")"
    )
}

RULES.write_text(
    json.dumps(
        rules,
        ensure_ascii=False,
        indent=2
    ) + "\n",
    encoding="utf-8"
)

README.write_text(
    """# WatchTogether

WatchTogether 是一個 Firebase + GitHub Pages 的多人同步觀看網站。

目前包含：
- YouTube 搜尋與播放
- Vimeo、Dailymotion、Bilibili、Twitch 與外部平台入口
- 房間、成員、踢人、聊天室、待播放清單
- Firebase Realtime Database 播放、暫停、跳轉同步
- 晚加入追趕與播放中 drift correction
- 每位成員只寫入自己的 `members/{roomId}/{uid}/playback`
- Firebase Storage 房間媒體檔案權限限制

Firebase Web App 設定位於 `firebase-config.js`。
""",
    encoding="utf-8"
)

APP.write_text(text, encoding="utf-8")
print("WatchTogether complete repair generated successfully")
