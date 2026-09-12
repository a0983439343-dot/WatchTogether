from pathlib import Path
import re

source_path = Path(".github/scripts/patch_playback_sync.py")
source = source_path.read_text(encoding="utf-8")

for label in ("cleanup listeners", "cleanup playback state"):
    pattern = re.compile(
        r'\nreplace_once\(.*?^[ \t]*["\']' + re.escape(label) + r'["\']\s*\)\n',
        re.DOTALL | re.MULTILINE
    )
    source, count = pattern.subn("\n", source, count=1)
    if count != 1:
        raise SystemExit(f"could not remove {label} patch block")

namespace = {"__name__": "__main__"}
exec(compile(source, str(source_path), "exec"), namespace, namespace)
