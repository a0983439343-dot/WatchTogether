from pathlib import Path

path = Path('app.js')
text = path.read_text(encoding='utf-8')

layer_marker = 'ROOM AUTHORITY PLAYBACK V12'
if layer_marker not in text:
    raise SystemExit('V12 playback layer is not installed')

if 'state.roomAuthorityV12 = true;' not in text:
    text = text.replace(
        layer_marker,
        layer_marker + '\n     Passive YouTube state callbacks never become room commands.',
        1,
    )
    needle = '  function roomAuthorityClock() {'
    if needle not in text:
        raise SystemExit('V12 layer start not found')
    text = text.replace(
        needle,
        '  state.roomAuthorityV12 = true;\n\n' + needle,
        1,
    )

needle = '                  const data = event.data;\n'
guard = '''                  const data = event.data;\n\n                  if (\n                    state.roomAuthorityV12 &&\n                    (data === YT.PlayerState.PLAYING || data === YT.PlayerState.PAUSED)\n                  ) {\n                    updateTimeUI();\n                    return;\n                  }\n'''

if 'state.roomAuthorityV12 &&' not in text:
    if needle not in text:
        raise SystemExit('YouTube state callback marker not found')
    text = text.replace(needle, guard, 1)

path.write_text(text, encoding='utf-8')
print('playback passive-state hardening installed')
