from pathlib import Path
import re

path = Path("app.js")
text = path.read_text(encoding="utf-8")

pattern = re.compile(
    r'    state\.roomRef\s*\n\s*\?\.child\("video"\)\s*\n\s*\.off\(\);'
)

replacement = '''    state.roomRef
        ?.child("video")
        .off();'''

text, count = pattern.subn(replacement, text, count=1)

if count != 1:
    raise SystemExit(f"playback cleanup marker normalization failed: {count}")

path.write_text(text, encoding="utf-8")
print("playback cleanup marker normalized")
