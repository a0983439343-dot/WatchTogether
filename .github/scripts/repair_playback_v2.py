from pathlib import Path
import json

APP = Path("app.js")
STYLES = Path("styles.css")
RULES = Path("database.rules.json")

s = APP.read_text(encoding="utf-8")


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"{label} not found")
    return text.replace(old, new, 1)


# ---------------------------------------------------------
# Playback recovery state
# ---------------------------------------------------------
if "kickedRef: null" not in s:
    s = replace_once(s, "    membersRef: null,\n", "    membersRef: null,\n\n    kickedRef: null,\n", "kickedRef state")

if "playbackRecoveryTimer: null" not in s:
    s = replace_once(s, "    playbackLastLocalSeekWriteAt: 0,\n", "    playbackLastLocalSeekWriteAt: 0,\n    playbackRecoveryTimer: null,\n", "playback recovery state")

s = replace_once(
    s,
    "    return base + Math.min(elapsed, 30);\n",
    "    return base + Math.min(elapsed, 7200);\n",
    "late playback recovery cap"
)

s = replace_once(
    s,
    "  async function applyRemotePlaybackEvent(event) {\n",
    "  async function applyRemotePlaybackEvent(event, force = false) {\n",
    "remote playback signature"
)

s = replace_once(
    s,
    "    if (state.playbackLastRemoteEventId === eventId) return;\n",
    "    if (!force && state.playbackLastRemoteEventId === eventId) return;\n",
    "remote playback force guard"
)

s = replace_once(
    s,
    "  async function applyLatestRoomPlaybackState() {\n",
    "  async function applyLatestRoomPlaybackState(force = false) {\n",
    "latest playback signature"
)

s = replace_once(
    s,
    '      if (event && event.eventId && event.updatedBy !== state.uid) await applyRemotePlaybackEvent(event);\n',
    '      if (event && event.eventId && event.updatedBy !== state.uid) await applyRemotePlaybackEvent(event, force);\n',
    "latest playback force call"
)

# Prevent unnecessary YouTube rebuilds and recover from background suspension.
resume_marker = "  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */\n"
resume_block = "  function recoverPlaybackAfterPageResume() {\n    if (\n      document.visibilityState === \"hidden\" ||\n      !state.roomId ||\n      !state.uid ||\n      !state.playerReady ||\n      !state.player ||\n      !state.currentVideoId\n    ) {\n      return;\n    }\n\n    clearTimeout(state.playbackRecoveryTimer);\n\n    state.playbackRecoveryTimer = setTimeout(async () => {\n      state.playbackRecoveryTimer = null;\n\n      if (\n        document.visibilityState === \"hidden\" ||\n        !state.roomId ||\n        !state.playerReady ||\n        !state.player\n      ) {\n        return;\n      }\n\n      try {\n        await applyLatestRoomPlaybackState(true);\n        startPlaybackSeekDetector();\n      } catch (error) {\n        console.warn(\"頁面恢復後播放同步失敗:\", error);\n      }\n    }, 350);\n  }\n\n\n"
if "function recoverPlaybackAfterPageResume()" not in s:
    s = replace_once(s, resume_marker, resume_block + resume_marker, "resume recovery insertion")

setup_marker = "  function setupEvents() {\n"
setup_block = "  function setupEvents() {\n\n    document.addEventListener(\n      \"visibilitychange\",\n      () => {\n        if (document.visibilityState === \"visible\") {\n          recoverPlaybackAfterPageResume();\n        }\n      }\n    );\n\n    window.addEventListener(\n      \"pageshow\",\n      () => {\n        recoverPlaybackAfterPageResume();\n      }\n    );\n\n"
if 'document.addEventListener(\n      "visibilitychange"' not in s:
    s = replace_once(s, setup_marker, setup_block, "visibility recovery handlers")

# ---------------------------------------------------------
# Kick protection
# ---------------------------------------------------------
member_marker = "  /*\n   * =========================================================\n   * MEMBERS\n   * =========================================================\n   */\n\n  async function markMemberOnline() {\n"
member_block = "  /*\n   * =========================================================\n   * MEMBERS\n   * =========================================================\n   */\n\n  async function isMemberKicked() {\n    if (!state.kickedRef) {\n      return false;\n    }\n\n    try {\n      const snapshot = await state.kickedRef.once(\"value\");\n      return snapshot.val() === true;\n    } catch (error) {\n      console.warn(\"讀取踢出狀態失敗:\", error);\n      return false;\n    }\n  }\n\n\n  async function handleKickState() {\n    if (!state.kickedRef || !state.roomId || !state.uid) {\n      return false;\n    }\n\n    if (!(await isMemberKicked())) {\n      return false;\n    }\n\n    await leaveRoomLocally(\"你已被房主移出房間\");\n    return true;\n  }\n\n\n  function attachKickListener() {\n    if (!state.kickedRef) {\n      return;\n    }\n\n    state.kickedRef.off();\n    state.kickedRef.on(\"value\", (snapshot) => {\n      if (snapshot.val() === true && state.roomId && state.uid) {\n        void leaveRoomLocally(\"你已被房主移出房間\");\n      }\n    });\n  }\n\n\n  async function markMemberOnline() {\n"
if "async function isMemberKicked()" not in s:
    s = replace_once(s, member_marker, member_block, "kick protection functions")

mark_marker = "    const memberRef =\n      state.membersRef.child(\n        state.uid\n      );\n\n    try {\n"
mark_block = "    const memberRef =\n      state.membersRef.child(\n        state.uid\n      );\n\n    if (await isMemberKicked()) {\n      await leaveRoomLocally(\"你已被房主移出房間\");\n      return;\n    }\n\n    try {\n"
s = replace_once(s, mark_marker, mark_block, "markMemberOnline kick guard")

old_kick = """  async function kickMember(
    targetUid,
    targetName
  ) {
    if (
      !state.isOwner
    ) {
      toast(
        "只有房主可以踢人"
      );

      return;
    }

    if (
      !targetUid ||
      targetUid === state.uid
    ) {
      return;
    }

    if (!state.membersRef) {
      toast(
        "目前不在房間內"
      );

      return;
    }

    const confirmed =
      window.confirm(
        `確定要踢出「${
          targetName ||
          "這名成員"
        }」嗎？`
      );

    if (!confirmed) {
      return;
    }

    try {
      await state.membersRef
        .child(
          targetUid
        )
        .remove();

      toast(
        `已踢出 ${
          targetName ||
          "成員"
        }`
      );
    } catch (error) {
      console.error(
        "踢人失敗:",
        error
      );

      toast(
        error?.message ||
        "踢人失敗，請檢查 Firebase Rules"
      );
    }
  }
"""
new_kick = """  async function kickMember(
    targetUid,
    targetName
  ) {
    if (!state.isOwner) {
      toast("只有房主可以踢人");
      return;
    }

    if (!targetUid || targetUid === state.uid) {
      return;
    }

    if (!state.membersRef || !db || !state.roomId) {
      toast("目前不在房間內");
      return;
    }

    const confirmed = window.confirm(
      `確定要踢出「${targetName || "這名成員"}」嗎？`
    );

    if (!confirmed) {
      return;
    }

    try {
      const updates = {};
      updates[`kicked/${state.roomId}/${targetUid}`] = true;
      updates[`members/${state.roomId}/${targetUid}`] = null;
      await db.ref().update(updates);

      toast(`已踢出 ${targetName || "成員"}`);
    } catch (error) {
      console.error("踢人失敗:", error);
      toast(error?.message || "踢人失敗，請檢查 Firebase Rules");
    }
  }
"""
s = replace_once(s, old_kick, new_kick, "atomic kick function")

room_ref_marker = "    state.membersRef =\n      db.ref(\n        `members/${state.roomId}`\n      );\n\n    state.chatRef =\n"
room_ref_block = "    state.membersRef =\n      db.ref(\n        `members/${state.roomId}`\n      );\n\n    state.kickedRef =\n      db.ref(\n        `kicked/${state.roomId}/${state.uid}`\n      );\n\n    if (await handleKickState()) {\n      return;\n    }\n\n    attachKickListener();\n\n    state.chatRef =\n"
s = replace_once(s, room_ref_marker, room_ref_block, "kick reference setup")

cleanup_listener_marker = "      state.membersRef?.off();\n\n      state.chatRef?.off();\n"
cleanup_listener_block = "      state.membersRef?.off();\n      state.kickedRef?.off();\n\n      state.chatRef?.off();\n"
s = replace_once(s, cleanup_listener_marker, cleanup_listener_block, "kick listener cleanup")

cleanup_timer_marker = "    clearInterval(\n      state.memberHeartbeatTimer\n    );\n\n    disconnectRoomListeners();\n"
cleanup_timer_block = "    clearInterval(\n      state.memberHeartbeatTimer\n    );\n\n    clearTimeout(\n      state.playbackRecoveryTimer\n    );\n\n    state.playbackRecoveryTimer =\n      null;\n\n    disconnectRoomListeners();\n"
s = replace_once(s, cleanup_timer_marker, cleanup_timer_block, "playback recovery cleanup")

cleanup_ref_marker = "    state.roomId =\n      null;\n\n    state.room =\n"
cleanup_ref_block = "    state.roomId =\n      null;\n\n    state.kickedRef =\n      null;\n\n    state.room =\n"
s = replace_once(s, cleanup_ref_marker, cleanup_ref_block, "kick reference reset")

# ---------------------------------------------------------
# Firebase Rules: permanent kick record blocks rejoin.
# ---------------------------------------------------------
rules = json.loads(RULES.read_text(encoding="utf-8"))
member_uid = rules["rules"]["members"]["$roomId"]["$uid"]
member_uid[".write"] = (
    "auth != null && root.child('rooms').child($roomId).exists() && "
    "((auth.uid === $uid && !root.child('kicked').child($roomId).child(auth.uid).exists()) || "
    "(auth.uid === root.child('rooms').child($roomId).child('owner').val() && auth.uid !== $uid && !newData.exists()))"
)
rules["rules"]["kicked"] = {
    "$roomId": {
        "$uid": {
            ".read": (
                "auth != null && (auth.uid === $uid || "
                "auth.uid === root.child('rooms').child($roomId).child('owner').val())"
            ),
            ".write": (
                "auth != null && "
                "auth.uid === root.child('rooms').child($roomId).child('owner').val()"
            ),
            ".validate": "!newData.exists() || (newData.isBoolean() && newData.val() === true)"
        }
    }
}
RULES.write_text(json.dumps(rules, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

APP.write_text(s, encoding="utf-8")
print("WatchTogether playback recovery and permanent kick protection applied")
