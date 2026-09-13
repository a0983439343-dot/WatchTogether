from pathlib import Path

BASE = Path('.github/scripts/repair_playback_v8.py').read_text(encoding='utf-8')
exec(compile(BASE, 'repair_playback_v8_embedded.py', 'exec'), {})

APP = Path('app.js')
s = APP.read_text(encoding='utf-8')

marker = '    playbackLocalIntentAt: 0,\n'
if marker in s and 'playbackUserActionUntil: 0' not in s:
    s = s.replace(marker, marker + '    playbackUserActionUntil: 0,\n    playbackUserActionKind: "",\n    playbackUiBridgeBound: false,\n', 1)

old_branch = '''if (\n                    data === YT.PlayerState.PLAYING ||\n                    data === YT.PlayerState.PAUSED\n                  ) {\n                    state.playbackLastPlayerState =\n                      data === YT.PlayerState.PLAYING\n                        ? "playing"\n                        : "paused";\n\n                    state.playbackLastObservedPosition =\n                      await asyncCurrentPosition().catch(() => null);\n\n                    // Do not write Firebase from YouTube state callbacks.\n                    // Explicit WatchTogether controls are the only source\n                    // of room playback commands.\n                    return;\n                  }\n\n'''

new_branch = '''if (\n                    data === YT.PlayerState.PLAYING ||\n                    data === YT.PlayerState.PAUSED\n                  ) {\n                    state.playbackLastPlayerState =\n                      data === YT.PlayerState.PLAYING\n                        ? "playing"\n                        : "paused";\n\n                    state.playbackLastObservedPosition =\n                      await asyncCurrentPosition().catch(() => null);\n\n                    // YouTube can emit these callbacks for ads, buffering,\n                    // lifecycle changes and remote commands. Only a recent\n                    // explicit local interaction is allowed to become a\n                    // Firebase room command.\n                    if (Date.now() <= Number(state.playbackUserActionUntil || 0)) {\n                      const kind = state.playbackUserActionKind;\n                      state.playbackUserActionUntil = 0;\n                      state.playbackUserActionKind = \"\";\n\n                      if (kind === \"pause\" && data === YT.PlayerState.PAUSED) {\n                        void publishPlaybackEvent(\"pause\").catch((error) =>\n                          console.warn(\"本機暫停同步失敗:\", error)\n                        );\n                      } else if (kind === \"play\" && data === YT.PlayerState.PLAYING) {\n                        void publishPlaybackEvent(\"play\").catch((error) =>\n                          console.warn(\"本機播放同步失敗:\", error)\n                        );\n                      }\n                    }\n\n                    return;\n                  }\n\n'''

if old_branch not in s:
    raise SystemExit('V8 YouTube state branch not found')
s = s.replace(old_branch, new_branch, 1)

bridge_marker = '  /*\n   * =========================================================\n   * ROOM UI\n   * =========================================================\n   */\n'
bridge = r'''  /*
   * =========================================================
   * EXPLICIT LOCAL PLAYBACK COMMAND BRIDGE V9
   * =========================================================
   *
   * Firebase is still the only shared timeline. No participant is
   * a master. This bridge only identifies a real local play/pause/
   * seek action so YouTube callbacks from ads/buffering are ignored.
   */

  function markLocalPlayerInteraction(kind = "") {
    state.playbackUserActionUntil = Date.now() + 1400;
    state.playbackUserActionKind = kind;
    state.playbackLocalIntentAt = Date.now();
    state.playbackAdGuardUntil = 0;
    state.playbackTransientStateUntil = 0;
  }

  function isPlaybackControlTarget(target) {
    if (!target || !(target instanceof Element)) return false;

    const playerWrap = $("playerWrap");
    const inPlayer = !!playerWrap && playerWrap.contains(target);
    const text = `${target.id || ""} ${target.className || ""} ${target.getAttribute("aria-label") || ""} ${target.textContent || ""}`.toLowerCase();

    if (inPlayer && /play|pause|播放|暫停|開始|繼續|seek|進度|快轉|快退/.test(text)) {
      return true;
    }

    if (/play|pause|播放|暫停|開始|繼續|seek|進度|快轉|快退/.test(text)) {
      return !!target.closest("button,[role='button'],input[type='range'],[data-playback-action]");
    }

    return false;
  }

  function inferPlaybackControlKind(target) {
    const text = `${target?.id || ""} ${target?.className || ""} ${target?.getAttribute?.("aria-label") || ""} ${target?.textContent || ""}`.toLowerCase();
    if (/pause|暫停/.test(text)) return "pause";
    if (/play|播放|開始|繼續/.test(text)) return "play";
    if (/seek|進度|快轉|快退/.test(text)) return "seek";
    return "";
  }

  async function bindPlaybackUiBridge() {
    if (state.playbackUiBridgeBound) return;
    state.playbackUiBridgeBound = true;

    document.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (!isPlaybackControlTarget(target)) return;
      const kind = inferPlaybackControlKind(target);
      markLocalPlayerInteraction(kind);
    }, true);

    document.addEventListener("touchstart", (event) => {
      const target = event.target;
      if (!isPlaybackControlTarget(target)) return;
      const kind = inferPlaybackControlKind(target);
      markLocalPlayerInteraction(kind);
    }, { capture: true, passive: true });

    document.addEventListener("click", (event) => {
      const target = event.target;
      if (!isPlaybackControlTarget(target)) return;
      const kind = inferPlaybackControlKind(target);
      if (kind) markLocalPlayerInteraction(kind);
    }, true);

    const originalPlayPlayer = playPlayer;
    const originalPausePlayer = pausePlayer;

    playPlayer = async function(...args) {
      const remote = state.playbackApplyingRemote || state.playbackPendingRecovery;
      const result = await originalPlayPlayer.apply(this, args);
      if (!remote) {
        void publishPlaybackEvent("play").catch((error) =>
          console.warn("本機播放同步失敗:", error)
        );
      }
      return result;
    };

    pausePlayer = async function(...args) {
      const remote = state.playbackApplyingRemote || state.playbackPendingRecovery;
      const result = await originalPausePlayer.apply(this, args);
      if (!remote) {
        void publishPlaybackEvent("pause").catch((error) =>
          console.warn("本機暫停同步失敗:", error)
        );
      }
      return result;
    };

    const originalApplyPlayerPosition = applyPlayerPosition;
    applyPlayerPosition = async function(position, ...args) {
      const remote = state.playbackApplyingRemote || state.playbackPendingRecovery;
      const result = await originalApplyPlayerPosition.call(this, position, ...args);
      if (!remote && Date.now() <= Number(state.playbackUserActionUntil || 0)) {
        const kind = state.playbackUserActionKind;
        if (kind === "seek") {
          state.playbackUserActionUntil = 0;
          state.playbackUserActionKind = "";
          void publishPlaybackEvent("seek", position).catch((error) =>
            console.warn("本機拖曳同步失敗:", error)
          );
        }
      }
      return result;
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void bindPlaybackUiBridge();
    }, { once: true });
  } else {
    void bindPlaybackUiBridge();
  }

'''

if bridge_marker not in s:
    raise SystemExit('ROOM UI marker not found')
s = s.replace(bridge_marker, bridge + bridge_marker, 1)

s = s.replace('SHARED ROOM TIMELINE PLAYBACK SYNC V8', 'SHARED ROOM TIMELINE PLAYBACK SYNC V9', 1)
s = s.replace('SHARED ROOM TIMELINE PLAYBACK SYNC V7', 'SHARED ROOM TIMELINE PLAYBACK SYNC V9', 1)
APP.write_text(s, encoding='utf-8')
