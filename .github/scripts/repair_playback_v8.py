from pathlib import Path
import re

BASE = Path('.github/scripts/repair_playback_v7.py').read_text(encoding='utf-8')

# Run the existing shared-timeline repair first.
exec(compile(BASE, 'repair_playback_v7_embedded.py', 'exec'), {})

APP = Path('app.js')
s = APP.read_text(encoding='utf-8')

# YouTube can emit PLAYING/PAUSED for ads, buffering, and lifecycle events.
# These callbacks must not create room commands by themselves.
state_re = re.compile(
    r'''if \(\s*\n\s*data === YT\.PlayerState\.PLAYING \|\|\s*\n\s*data === YT\.PlayerState\.PAUSED\s*\n\s*\) \{\s*\n\s*state\.playbackLastPlayerState\s*=\s*\n\s*data === YT\.PlayerState\.PLAYING\s*\n\s*\? "playing"\s*\n\s*:\s*"paused";\s*\n\s*state\.playbackLastObservedPosition\s*=\s*\n\s*await asyncCurrentPosition\(\)\.catch\(\(\) => null\);\s*\n\s*[^\n]*\n\s*\}''',
    re.MULTILINE,
)

new_state_branch = '''if (\n                    data === YT.PlayerState.PLAYING ||\n                    data === YT.PlayerState.PAUSED\n                  ) {\n                    state.playbackLastPlayerState =\n                      data === YT.PlayerState.PLAYING\n                        ? "playing"\n                        : "paused";\n\n                    state.playbackLastObservedPosition =\n                      await asyncCurrentPosition().catch(() => null);\n\n                    // Never publish room commands from this callback.\n                    // The shared Firebase timeline is updated only by\n                    // explicit WatchTogether playback commands.\n                    return;\n                  }'''

match = state_re.search(s)
if match:
    s = s[:match.start()] + new_state_branch + s[match.end():]
else:
    raise SystemExit('YouTube PLAYING/PAUSED callback block not found')

# Keep ad/transient protection active until the local content position
# reaches the shared timeline instead of using a fixed long timeout.
ad_re = re.compile(
    r'''if \(timeline\.playing === true && Number\.isFinite\(previousObserved\) &&\s*\n\s*position < previousObserved - 3 &&\s*\n\s*now - Number\(state\.playbackLocalIntentAt \|\| 0\) > 1200\) \{\s*\n\s*state\.playbackAdGuardUntil = Date\.now\(\) \+ 7500;\s*\n\s*state\.playbackTransientStateUntil = Date\.now\(\) \+ 7500;\s*\n\s*state\.playbackLastObservedPosition = position;\s*\n\s*return;\s*\n\s*\}''',
    re.MULTILINE,
)

new_ad_block = '''if (\n      timeline.playing === true &&\n      Number.isFinite(previousObserved) &&\n      position < previousObserved - 3 &&\n      now - Number(state.playbackLocalIntentAt || 0) > 1200\n    ) {\n      state.playbackAdGuardUntil = Date.now() + 3000;\n      state.playbackTransientStateUntil = Date.now() + 3000;\n      state.playbackLastObservedPosition = position;\n      return;\n    }\n\n    if (\n      Number(state.playbackAdGuardUntil || 0) > Date.now() &&\n      Math.abs(position - expected) <= 3.0\n    ) {\n      state.playbackAdGuardUntil = 0;\n      state.playbackTransientStateUntil = 0;\n    }'''

match = ad_re.search(s)
if match:
    s = s[:match.start()] + new_ad_block + s[match.end():]
else:
    raise SystemExit('ad protection block not found')

s = s.replace(
    'SHARED ROOM TIMELINE PLAYBACK SYNC V6',
    'SHARED ROOM TIMELINE PLAYBACK SYNC V8',
    1,
)

APP.write_text(s, encoding='utf-8')
