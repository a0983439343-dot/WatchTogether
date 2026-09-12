from pathlib import Path
import re

source_path = Path(".github/scripts/patch_playback_sync.py")
source = source_path.read_text(encoding="utf-8")

call_pattern = re.compile(
    r'\n  replace_once\(.*?\n  \)\n',
    re.DOTALL
)

blocks = list(call_pattern.finditer(source))
removed = set()

for label in ("cleanup listeners", "cleanup playback state"):
    matches = [
        match for match in blocks
        if f'"{label}"' in match.group(0) or f"'{label}'" in match.group(0)
    ]

    if len(matches) != 1:
        raise SystemExit(
            f"expected exactly one {label} replace_once block, found {len(matches)}"
        )

    removed.add(matches[0])

for match in sorted(removed, key=lambda item: item.start(), reverse=True):
    source = source[:match.start()] + "\n" + source[match.end():]

namespace = {"__name__": "__main__"}
exec(compile(source, str(source_path), "exec"), namespace, namespace)
