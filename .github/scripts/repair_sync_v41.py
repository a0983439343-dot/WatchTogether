from pathlib import Path

p = Path('app.js')
s = p.read_text(encoding='utf-8')

if 'WATCHTOGETHER_UNIFIED_SYNC_V4_1' in s:
    print('Sync V4.1 already applied')
    raise SystemExit(0)

old_play = '''          const playing = await asyncIsPlaying();
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
'''

new_play = '''          const playing = await asyncIsPlaying();
          const position = await asyncCurrentPosition();

          try {
            if (playing) {
              await pausePlayer();
              await publishPlaybackEvent("pause", position, false);
            } else {
              await publishPlaybackEvent("play", position, true);
              await playPlayer();
            }
          } catch (error) {
            console.warn("播放控制同步失敗:", error);
            toast(error?.message || "播放同步失敗");
          }
'''

if old_play not in s:
    raise SystemExit('custom play block not found')
s = s.replace(old_play, new_play, 1)

onready_start = s.find('              onReady:\n                async (event) => {')
onstate = s.find('              onStateChange:', onready_start)
if onready_start < 0 or onstate < 0:
    raise SystemExit('YouTube onReady block not found')

onready = s[onready_start:onstate]
needle = '                  startLocalTimeUpdate();\n'
insert = '''                  startLocalTimeUpdate();\n\n                  if (\n                    state.isOwner &&\n                    autoplay &&\n                    state.player === event.target\n                  ) {\n                    setTimeout(async () => {\n                      try {\n                        if (\n                          state.playerReady &&\n                          state.player === event.target &&\n                          state.currentVideoId === videoId\n                        ) {\n                          await publishPlaybackEvent(\n                            "play",\n                            await asyncCurrentPosition(),\n                            true\n                          );\n                        }\n                      } catch (error) {\n                        console.warn("新影片播放狀態建立失敗:", error);\n                      }\n                    }, 450);\n                  }\n'''
if needle not in onready:
    raise SystemExit('onReady timer anchor not found')
onready = onready.replace(needle, insert, 1)
s = s[:onready_start] + onready + s[onstate:]

# Do not let the previous run's marker be missing.
marker_pos = s.find('WATCHTOGETHER_UNIFIED_SYNC_V4')
if marker_pos < 0:
    raise SystemExit('V4 marker not found')
s = s[:marker_pos] + 'WATCHTOGETHER_UNIFIED_SYNC_V4_1' + s[marker_pos + len('WATCHTOGETHER_UNIFIED_SYNC_V4'):]

p.write_text(s, encoding='utf-8')
print('Applied WatchTogether unified sync V4.1')
