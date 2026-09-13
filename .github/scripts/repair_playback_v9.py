from pathlib import Path

BASE = Path('.github/scripts/repair_playback_v8.py').read_text(encoding='utf-8')
exec(compile(BASE, 'repair_playback_v8_embedded.py', 'exec'), {})

APP = Path('app.js')
s = APP.read_text(encoding='utf-8')

marker = '    playbackLocalIntentAt: 0,\n'
state_add = '''    playbackLocalActionTimer: null,\n    playbackLocalActionSerial: 0,\n'''
if 'playbackLocalActionTimer: null' not in s:
    if marker not in s:
        raise SystemExit('playback local intent marker not found')
    s = s.replace(marker, marker + state_add, 1)

# Replace the YouTube state callback so PLAYING/PAUSED are interpreted against
# the shared room timeline instead of a DOM bridge that cannot see inside the
# cross-origin YouTube iframe.
start_marker = '''              onStateChange:\n                async (event) => {'''
end_marker = '''                  if (data === YT.PlayerState.ENDED) {'''
start = s.find(start_marker)
end = s.find(end_marker, start + len(start_marker)) if start >= 0 else -1
if start < 0 or end < 0:
    raise SystemExit('YouTube onStateChange block not found')

new_handler = '''              onStateChange:\n                async (event) => {\n                  if (\n                    state.youtubeBuildToken !== token ||\n                    state.player !== event.target\n                  ) {\n                    return;\n                  }\n\n                  forceYoutubeVisible();\n\n                  const now = Date.now();\n                  const data = event.data;\n\n                  if (data === YT.PlayerState.BUFFERING) {\n                    state.playbackTransientStateUntil = now + 1800;\n                    state.playbackLastPlayerState = \"buffering\";\n                    state.playbackLastObservedPosition =\n                      await asyncCurrentPosition().catch(() => null);\n                    updateTimeUI();\n                    return;\n                  }\n\n                  if (data === YT.PlayerState.PLAYING) {\n                    state.playbackLastPlayerState = \"playing\";\n                    state.playbackLastObservedPosition =\n                      await asyncCurrentPosition().catch(() => null);\n\n                    const timelinePlaying =\n                      typeof roomTimelinePlaying === \"function\"\n                        ? roomTimelinePlaying()\n                        : null;\n\n                    if (\n                      document.visibilityState !== \"hidden\" &&\n                      !state.playbackApplyingRemote &&\n                      !state.playbackPendingRecovery &&\n                      !shouldIgnoreTransientYoutubeState() &&\n                      now >= Number(state.playbackReadyAt || 0) &&\n                      (timelinePlaying === false || timelinePlaying === null)\n                    ) {\n                      const serial = ++state.playbackLocalActionSerial;\n                      clearTimeout(state.playbackLocalActionTimer);\n                      state.playbackLocalActionTimer = setTimeout(async () => {\n                        state.playbackLocalActionTimer = null;\n\n                        if (\n                          serial !== state.playbackLocalActionSerial ||\n                          document.visibilityState === \"hidden\" ||\n                          state.playbackApplyingRemote ||\n                          state.playbackPendingRecovery\n                        ) {\n                          return;\n                        }\n\n                        try {\n                          const currentPlaying = await asyncIsPlaying();\n                          const roomPlaying =\n                            typeof roomTimelinePlaying === \"function\"\n                              ? roomTimelinePlaying()\n                              : null;\n\n                          if (currentPlaying && roomPlaying === false) {\n                            const position = await asyncCurrentPosition();\n                            state.playbackLocalIntentAt = Date.now();\n                            await publishPlaybackEvent(\"play\", position, true);\n                          } else if (currentPlaying && roomPlaying === null) {\n                            const position = await asyncCurrentPosition();\n                            state.playbackLocalIntentAt = Date.now();\n                            await publishPlaybackEvent(\"play\", position, true);\n                          }\n                        } catch (error) {\n                          console.warn(\"本機播放同步失敗:\", error);\n                        }\n                      }, 280);\n                    }\n\n                    updateTimeUI();\n                    return;\n                  }\n\n                  if (data === YT.PlayerState.PAUSED) {\n                    state.playbackLastPlayerState = \"paused\";\n                    state.playbackLastObservedPosition =\n                      await asyncCurrentPosition().catch(() => null);\n\n                    const timelinePlaying =\n                      typeof roomTimelinePlaying === \"function\"\n                        ? roomTimelinePlaying()\n                        : null;\n\n                    if (\n                      document.visibilityState !== \"hidden\" &&\n                      !state.playbackApplyingRemote &&\n                      !state.playbackPendingRecovery &&\n                      !shouldIgnoreTransientYoutubeState() &&\n                      now >= Number(state.playbackReadyAt || 0) &&\n                      timelinePlaying === true\n                    ) {\n                      const serial = ++state.playbackLocalActionSerial;\n                      clearTimeout(state.playbackLocalActionTimer);\n                      state.playbackLocalActionTimer = setTimeout(async () => {\n                        state.playbackLocalActionTimer = null;\n\n                        if (\n                          serial !== state.playbackLocalActionSerial ||\n                          document.visibilityState === \"hidden\" ||\n                          state.playbackApplyingRemote ||\n                          state.playbackPendingRecovery\n                        ) {\n                          return;\n                        }\n\n                        try {\n                          const currentPlaying = await asyncIsPlaying();\n                          const roomPlaying =\n                            typeof roomTimelinePlaying === \"function\"\n                              ? roomTimelinePlaying()\n                              : null;\n\n                          if (!currentPlaying && roomPlaying === true) {\n                            const position = await asyncCurrentPosition();\n                            state.playbackLocalIntentAt = Date.now();\n                            await publishPlaybackEvent(\"pause\", position, false);\n                          }\n                        } catch (error) {\n                          console.warn(\"本機暫停同步失敗:\", error);\n                        }\n                      }, 900);\n                    }\n\n                    updateTimeUI();\n                    return;\n                  }\n\n'''

s = s[:start] + new_handler + s[end:]

# Remove the V9 DOM/iframe bridge entirely. It can see page controls but it
# cannot reliably observe the native YouTube controls inside the iframe, and
# wrapping player methods can create feedback loops.
bridge_start = s.find('  /*\n   * =========================================================\n   * EXPLICIT LOCAL PLAYBACK COMMAND BRIDGE V9')
room_marker = '''  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */\n'''
room_pos = s.find(room_marker)
if bridge_start >= 0 and room_pos > bridge_start:
    s = s[:bridge_start] + '\n' + s[room_pos:]

# Make the generated marker explicit for verification.
s = s.replace('SHARED ROOM TIMELINE PLAYBACK SYNC V8', 'SHARED ROOM TIMELINE PLAYBACK SYNC V10', 1)
s = s.replace('SHARED ROOM TIMELINE PLAYBACK SYNC V9', 'SHARED ROOM TIMELINE PLAYBACK SYNC V10', 1)

APP.write_text(s, encoding='utf-8')
