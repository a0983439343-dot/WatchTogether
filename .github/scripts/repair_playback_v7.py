from pathlib import Path

base = Path('.github/scripts/repair_playback_v6.py').read_text(encoding='utf-8')
start = base.index('section_re = re.compile(')
end = base.index('\n\nnew_sync =', start)

replacement = r'''class SimpleSectionRe:
    def search(self, text):
        marker = 'SHARED ROOM TIMELINE PLAYBACK SYNC'
        marker_pos = text.find(marker)
        if marker_pos < 0:
            marker_pos = text.find('EVENT-BASED PLAYBACK SYNC')
        if marker_pos < 0:
            return None
        start_pos = text.rfind('\n  /*', 0, marker_pos)
        if start_pos < 0:
            start_pos = text.rfind('  /*', 0, marker_pos)
        if start_pos < 0:
            return None
        end_marker = '\n  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */'
        end_pos = text.find(end_marker, marker_pos)
        if end_pos < 0:
            return None
        class Match:
            def start(self):
                return start_pos
            def end(self):
                return end_pos + 1
        return Match()

section_re = SimpleSectionRe()'''

base = base[:start] + replacement + base[end:]
exec(compile(base, 'repair_playback_v6_embedded.py', 'exec'), {})
