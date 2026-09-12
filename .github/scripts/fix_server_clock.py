from pathlib import Path

path = Path("app.js")
s = path.read_text(encoding="utf-8")

marker = '  function playbackSyncRef() {'

server_clock = '''  function serverNow() {
    return Date.now() + Number(state.playbackServerTimeOffset || 0);
  }


  function attachServerClockSync() {
    if (!db) {
      return;
    }

    const ref = db.ref(".info/serverTimeOffset");

    if (state.playbackServerClockHandler) {
      try {
        ref.off("value", state.playbackServerClockHandler);
      } catch (_) {}
    }

    state.playbackServerClockHandler = (snapshot) => {
      const offset = Number(snapshot?.val());
      state.playbackServerTimeOffset = Number.isFinite(offset) ? offset : 0;
    };

    ref.on("value", state.playbackServerClockHandler);
  }


'''

if "function attachServerClockSync()" not in s:
    if marker not in s:
        raise SystemExit("playbackSyncRef marker not found")
    s = s.replace(marker, server_clock + marker, 1)

s = s.replace(
    '    const now = Date.now();\n    const key =\n      `${normalized}:${Math.round(finalPosition * 4) / 4}:${playing ? 1 : 0}`;',
    '    const now = serverNow();\n    const key =\n      `${normalized}:${Math.round(finalPosition * 4) / 4}:${playing ? 1 : 0}`;',
    1,
)

s = s.replace(
    '    const now = Date.now();\n    const position = await asyncCurrentPosition();\n    const playing = await asyncIsPlaying();\n    const expected = getTimelinePosition(timeline, now);',
    '    const now = serverNow();\n    const position = await asyncCurrentPosition();\n    const playing = await asyncIsPlaying();\n    const expected = getTimelinePosition(timeline, now);',
    1,
)

s = s.replace(
    '        const now = Date.now();\n        const position = await asyncCurrentPosition();\n        const playing = await asyncIsPlaying();',
    '        const now = serverNow();\n        const position = await asyncCurrentPosition();\n        const playing = await asyncIsPlaying();',
    1,
)

path.write_text(s, encoding="utf-8")
