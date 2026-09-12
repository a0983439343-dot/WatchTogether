from pathlib import Path

APP = Path("app.js")
STYLES = Path("styles.css")
s = APP.read_text(encoding="utf-8")


def require_replace(text, old, new, label, count=1):
    if old not in text:
        raise SystemExit(f"{label} not found")
    return text.replace(old, new, count)


# Add local event de-duplication and remote timestamp tracking.
state_marker = "    playbackApplyingRemoteEventId: null,"
state_add = """    playbackApplyingRemoteEventId: null,
    playbackLastRemoteUpdatedAt: 0,
    playbackLastLocalActionKey: \"\",
    playbackLastLocalActionAt: 0,
    playbackLastLocalSeekWriteAt: 0,"""
if "playbackLastRemoteUpdatedAt" not in s:
    s = require_replace(s, state_marker, state_add, "playback conflict state")

# De-duplicate local state changes before writing to Firebase.
publish_marker = '''    if (normalizedAction === "seek") playing = await asyncIsPlaying();

    try {'''
publish_new = '''    if (normalizedAction === "seek") playing = await asyncIsPlaying();

    const now = Date.now();
    const localActionKey = `${normalizedAction}:${Math.round(finalPosition * 2) / 2}:${playing ? 1 : 0}`;

    if (
      localActionKey === state.playbackLastLocalActionKey &&
      now - Number(state.playbackLastLocalActionAt || 0) < 900
    ) {
      return;
    }

    if (
      normalizedAction === "seek" &&
      now - Number(state.playbackLastLocalSeekWriteAt || 0) < 650
    ) {
      return;
    }

    state.playbackLastLocalActionKey = localActionKey;
    state.playbackLastLocalActionAt = now;
    if (normalizedAction === "seek") {
      state.playbackLastLocalSeekWriteAt = now;
    }

    try {'''
s = require_replace(s, publish_marker, publish_new, "local playback event de-duplication")

# Reject an older remote event even when it has a different eventId.
remote_marker = '''    const eventId = String(event.eventId || "");
    if (!eventId) return;
    if (state.playbackLastRemoteEventId === eventId) return;'''
remote_new = '''    const eventId = String(event.eventId || "");
    if (!eventId) return;
    if (state.playbackLastRemoteEventId === eventId) return;

    const remoteUpdatedAt = Number(event.updatedAt || 0);
    const lastRemoteUpdatedAt = Number(state.playbackLastRemoteUpdatedAt || 0);
    if (
      remoteUpdatedAt > 0 &&
      lastRemoteUpdatedAt > 0 &&
      remoteUpdatedAt < lastRemoteUpdatedAt
    ) {
      return;
    }

    if (remoteUpdatedAt > 0) {
      state.playbackLastRemoteUpdatedAt = remoteUpdatedAt;
    }'''
s = require_replace(s, remote_marker, remote_new, "remote playback timestamp guard")

# Clear conflict state when switching videos.
video_reset = '''      state.playbackIgnoreStateChanges = 0;
      state.playbackIgnoreStateUntil = 0;'''
video_reset_new = '''      state.playbackIgnoreStateChanges = 0;
      state.playbackIgnoreStateUntil = 0;
      state.playbackLastRemoteUpdatedAt = 0;
      state.playbackLastLocalActionKey = "";
      state.playbackLastLocalActionAt = 0;
      state.playbackLastLocalSeekWriteAt = 0;'''
s = require_replace(s, video_reset, video_reset_new, "video playback reset")

# Clear conflict state during room cleanup as well, without touching Firebase Rules.
cleanup_marker = '''    state.playbackIgnoreStateUntil =
      0;'''
cleanup_new = '''    state.playbackIgnoreStateUntil =
      0;
    state.playbackLastRemoteUpdatedAt =
      0;
    state.playbackLastLocalActionKey =
      "";
    state.playbackLastLocalActionAt =
      0;
    state.playbackLastLocalSeekWriteAt =
      0;'''
if "state.playbackLastRemoteUpdatedAt =\n      0;" not in s[s.find(cleanup_marker):s.find(cleanup_marker) + 500]:
    s = require_replace(s, cleanup_marker, cleanup_new, "cleanup playback reset")

APP.write_text(s, encoding="utf-8")

# Mobile member list: prevent flex shrinking/clipping from hiding the kick button.
css = STYLES.read_text(encoding="utf-8")
css_marker = "/* =========================================================\n   WatchTogether mobile search final layout fix\n   ========================================================= */"
mobile_fix = r'''/* =========================================================
   WatchTogether mobile member action layout fix
   ========================================================= */

.member-list {
  min-width: 0;
  width: 100%;
}

.member {
  min-width: 0;
}

.member .member-name {
  min-width: 0;
  flex: 1 1 auto;
}

.member [data-member-kick] {
  flex: 0 0 auto !important;
  width: auto !important;
  min-width: 52px !important;
  min-height: 32px !important;
  margin: 0 !important;
  padding: 0 9px !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  white-space: nowrap !important;
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
  position: relative;
  z-index: 2;
}

@media (max-width: 760px) {
  .members-panel {
    min-width: 0 !important;
    width: 100% !important;
    overflow: visible !important;
  }

  .member-list {
    width: 100% !important;
    max-width: 100% !important;
    overflow-x: visible !important;
    overflow-y: auto !important;
    padding-right: 1px;
  }

  .member {
    width: 100% !important;
    min-width: 0 !important;
    min-height: 50px !important;
    padding: 8px !important;
    gap: 8px !important;
    display: grid !important;
    grid-template-columns: 34px minmax(0, 1fr) auto !important;
    align-items: center !important;
    overflow: visible !important;
  }

  .member .avatar {
    width: 34px !important;
    height: 34px !important;
    min-width: 34px !important;
  }

  .member .member-name {
    min-width: 0 !important;
    width: 100% !important;
    overflow: hidden !important;
  }

  .member .member-name b,
  .member .member-name span {
    max-width: 100% !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
  }

  .member .online {
    width: 8px !important;
    min-width: 8px !important;
  }

  .member [data-member-kick] {
    min-width: 58px !important;
    min-height: 36px !important;
    padding: 0 10px !important;
    font-size: 11px !important;
    justify-self: end !important;
  }
}

@media (max-width: 390px) {
  .member {
    grid-template-columns: 32px minmax(0, 1fr) auto !important;
    gap: 6px !important;
    padding: 7px !important;
  }

  .member .avatar {
    width: 32px !important;
    height: 32px !important;
    min-width: 32px !important;
  }

  .member [data-member-kick] {
    min-width: 54px !important;
    min-height: 34px !important;
    padding: 0 8px !important;
    font-size: 10px !important;
  }
}

'''
if "WatchTogether mobile member action layout fix" not in css:
    if css_marker not in css:
        raise SystemExit("styles insertion marker not found")
    css = css.replace(css_marker, mobile_fix + css_marker, 1)

STYLES.write_text(css, encoding="utf-8")
print("Playback conflict handling and mobile member layout repair applied")
