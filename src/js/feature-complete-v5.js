(() => {
  "use strict";

  const wt = window.WT_ENHANCEMENTS || {};
  const core = window.WT_CORE || null;
  const $ = id => document.getElementById(id);
  const db = wt.db || (window.firebase?.apps?.length ? firebase.database() : null);
  const auth = wt.auth || (window.firebase?.apps?.length ? firebase.auth() : null);

  const LOCAL_CAPTION_ENABLED = "wt_caption_enabled_v1";
  const LOCAL_ERROR_COUNT = "wt_client_error_count_v1";
  const MAX_VTT_BYTES = 250000;
  const MAX_CUES = 5000;
  let captionRef = null;
  let captionRoom = "";
  let captionData = null;
  let captionCues = [];
  let captionEnabled = true;
  let captionAnimation = 0;
  let lastCaptionRoom = "";
  let networkBanner = null;
  let lastOnlineState = navigator.onLine;

  function toast(message) {
    try {
      if (typeof wt.toast === "function") return wt.toast(message);
      if (typeof window.toast === "function") return window.toast(message);
    } catch (_) {}
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }

  function roomState() {
    return core?.state || {};
  }

  function roomId() {
    return String(roomState().roomId || "").trim().toUpperCase();
  }

  function currentUser() {
    return auth?.currentUser || null;
  }

  function isRoomManager() {
    const s = roomState();
    const u = currentUser();
    if (!u || !s.roomId) return false;
    return Boolean(
      s.isOwner ||
      window.WT_ROOM_ACCESS?.isCohost?.(u.uid)
    );
  }

  function readCaptionEnabled() {
    try {
      const value = localStorage.getItem(LOCAL_CAPTION_ENABLED);
      return value == null ? true : value === "1";
    } catch (_) {
      return true;
    }
  }

  function writeCaptionEnabled(value) {
    captionEnabled = value === true;
    try {
      localStorage.setItem(LOCAL_CAPTION_ENABLED, captionEnabled ? "1" : "0");
    } catch (_) {}
    renderCaption();
  }

  function parseTimestamp(value) {
    const raw = String(value || "").trim().replace(",", ".");
    const parts = raw.split(":").map(Number);
    if (parts.some(n => !Number.isFinite(n))) return NaN;
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
    return NaN;
  }

  function parseVtt(text) {
    const source = String(text || "").replace(/^\uFEFF/, "").replace(/\r/g, "");
    const lines = source.split("\n");
    const cues = [];

    for (let i = 0; i < lines.length;) {
      let line = String(lines[i] || "").trim();
      if (!line) {
        i += 1;
        continue;
      }
      if (/^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/i.test(line)) {
        while (i < lines.length && String(lines[i] || "").trim()) i += 1;
        continue;
      }

      let timingIndex = i;
      if (!line.includes("-->") && String(lines[i + 1] || "").includes("-->")) {
        timingIndex = i + 1;
      }
      if (timingIndex >= lines.length || !String(lines[timingIndex] || "").includes("-->")) {
        i += 1;
        continue;
      }

      const timing = String(lines[timingIndex] || "").trim();
      const [startRaw, endRawWithSettings] = timing.split(/\s+-->\s+/);
      const endRaw = String(endRawWithSettings || "").trim().split(/\s+/)[0];
      const start = parseTimestamp(startRaw);
      const end = parseTimestamp(endRaw);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        i = timingIndex + 1;
        continue;
      }

      const textLines = [];
      i = timingIndex + 1;
      while (i < lines.length && String(lines[i] || "").trim()) {
        textLines.push(String(lines[i] || "").trim());
        i += 1;
      }
      const cueText = textLines.join("\n").replace(/<\/?(?:c|i|b|u|ruby|rt)(?:\s[^>]*)?>/gi, "");
      if (cueText) {
        cues.push({start, end, text:cueText.slice(0,1000)});
      }
      if (cues.length >= MAX_CUES) break;
    }

    cues.sort((a,b) => a.start - b.start);
    return cues.slice(0, MAX_CUES);
  }

  function ensureCaptionOverlay() {
    const wrap = $("playerWrap");
    if (!wrap) return null;
    let overlay = $("wtV5CaptionOverlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "wtV5CaptionOverlay";
      overlay.setAttribute("aria-live", "polite");
      overlay.setAttribute("aria-label", "字幕");
      overlay.style.cssText =
        "position:absolute;left:5%;right:5%;bottom:10%;z-index:20;pointer-events:none;" +
        "display:none;text-align:center;font-size:clamp(16px,2.4vw,30px);font-weight:700;" +
        "line-height:1.35;text-shadow:0 2px 5px rgba(0,0,0,.95),0 0 10px rgba(0,0,0,.85);" +
        "white-space:pre-wrap;word-break:break-word;padding:0 8px";
      wrap.appendChild(overlay);
    }
    return overlay;
  }

  function getCaptionTextAt(time) {
    const t = Number(time);
    if (!Number.isFinite(t) || !captionCues.length) return "";
    let lo = 0;
    let hi = captionCues.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const cue = captionCues[mid];
      if (t < cue.start) {
        hi = mid - 1;
      } else {
        found = mid;
        lo = mid + 1;
      }
    }
    if (found < 0) return "";
    const cue = captionCues[found];
    return t <= cue.end ? cue.text : "";
  }

  async function currentPlayerTime() {
    const player = roomState().player;
    if (!player || typeof player.getCurrentTime !== "function") return 0;
    try {
      return Number(await Promise.resolve(player.getCurrentTime())) || 0;
    } catch (_) {
      return 0;
    }
  }

  function renderCaption(text) {
    const overlay = ensureCaptionOverlay();
    if (!overlay) return;
    if (!captionEnabled || !captionCues.length || !text) {
      overlay.textContent = "";
      overlay.style.display = "none";
      return;
    }
    overlay.textContent = text;
    overlay.style.display = "block";
  }

  function captionTick() {
    captionAnimation = 0;
    void currentPlayerTime().then(time => {
      if (!captionRoom || captionRoom !== roomId()) {
        renderCaption("");
        return;
      }
      renderCaption(getCaptionTextAt(time));
    });
    captionAnimation = requestAnimationFrame(captionTick);
  }

  function startCaptionLoop() {
    if (captionAnimation) return;
    ensureCaptionOverlay();
    captionAnimation = requestAnimationFrame(captionTick);
  }

  function stopCaptionLoop() {
    if (!captionAnimation) return;
    cancelAnimationFrame(captionAnimation);
    captionAnimation = 0;
  }

  function detachCaptionListener() {
    try { captionRef?.off(); } catch (_) {}
    captionRef = null;
    captionRoom = "";
  }

  function installCaptionListener() {
    const id = roomId();
    if (!db || !id) {
      detachCaptionListener();
      captionData = null;
      captionCues = [];
      renderCaption("");
      return;
    }
    if (captionRoom === id && captionRef) return;

    detachCaptionListener();
    captionData = null;
    captionCues = [];
    captionRoom = id;
    captionRef = db.ref("roomMeta/" + id + "/captions");
    captionRef.on("value", snapshot => {
      const value = snapshot.val();
      captionData = value && typeof value === "object" ? value : null;
      captionCues = parseVtt(captionData?.text || "");
      lastCaptionRoom = id;
      startCaptionLoop();
      renderCaption("");
      updateCaptionButton();
    });
  }

  async function saveCaptions(text, label, language) {
    const id = roomId();
    if (!id || !db) throw new Error("目前不在房間內");
    if (!isRoomManager()) throw new Error("只有房主或 Co-host 可以管理字幕");
    const source = String(text || "");
    if (!source.trim()) throw new Error("請先選擇或貼上 WebVTT 字幕");
    if (new TextEncoder().encode(source).length > MAX_VTT_BYTES) {
      throw new Error("字幕檔過大，單檔上限約 250 KB");
    }
    const cues = parseVtt(source);
    if (!cues.length) throw new Error("找不到有效的 WebVTT 字幕時間軸");
    await db.ref("roomMeta/" + id + "/captions").set({
      text:source.slice(0, MAX_VTT_BYTES),
      label:String(label || "字幕").trim().slice(0,80) || "字幕",
      language:String(language || "zh-TW").trim().slice(0,20) || "zh-TW",
      cueCount:cues.length,
      updatedAt:firebase.database.ServerValue.TIMESTAMP,
      updatedByUid:currentUser()?.uid || ""
    });
    toast("字幕已更新，房間成員會同步取得");
  }

  async function removeCaptions() {
    const id = roomId();
    if (!id || !db) return;
    if (!isRoomManager()) throw new Error("只有房主或 Co-host 可以刪除字幕");
    if (!window.confirm("確定移除這個房間的字幕嗎？")) return;
    await db.ref("roomMeta/" + id + "/captions").remove();
    captionData = null;
    captionCues = [];
    renderCaption("");
    toast("房間字幕已移除");
  }

  function openCaptionManager() {
    const id = roomId();
    if (!id) return toast("請先進入房間");
    const canManage = isRoomManager();
    const body = document.createElement("div");
    body.className = "wt-v5-caption-body";
    const existing = captionData || {};
    body.innerHTML =
      '<div class="wt-v5-caption-note">字幕格式支援 WebVTT。字幕時間軸會跟著目前房間播放器的同步位置走，因此 YouTube、Vimeo、Dailymotion、Twitch 都能使用本站字幕疊加層。</div>' +
      '<label class="wt-v5-check"><input id="wtV5CaptionEnabled" type="checkbox" ' + (captionEnabled ? "checked" : "") + '> 顯示字幕</label>' +
      '<div class="wt-v5-caption-meta"><span>目前字幕：' + esc(existing.label || "尚未設定") + '</span><span>' + esc(existing.language || "") + ' · ' + esc(existing.cueCount || captionCues.length || 0) + ' cues</span></div>' +
      (canManage ?
        '<label>字幕標籤<input id="wtV5CaptionLabel" maxlength="80" value="' + esc(existing.label || "字幕") + '"></label>' +
        '<label>語言<input id="wtV5CaptionLang" maxlength="20" value="' + esc(existing.language || "zh-TW") + '"></label>' +
        '<label>WebVTT 內容<textarea id="wtV5CaptionText" rows="12" maxlength="' + MAX_VTT_BYTES + '" placeholder="WEBVTT&#10;&#10;00:00:01.000 --> 00:00:03.000&#10;字幕內容"></textarea></label>' +
        '<label>或選擇 .vtt 檔<input id="wtV5CaptionFile" type="file" accept=".vtt,text/vtt"></label>' +
        '<div class="wt-v5-caption-actions"><button id="wtV5CaptionSave" class="primary-btn" type="button">儲存字幕</button><button id="wtV5CaptionDelete" class="tiny-btn danger" type="button">刪除字幕</button></div>'
        : '') +
      '<div class="wt-v5-caption-actions"><button id="wtV5CaptionClose" class="secondary-btn" type="button">關閉</button><button id="wtV5CaptionSync" class="secondary-btn" type="button">立即同步</button></div>';

    const modal = document.createElement("div");
    modal.id = "wtV5CaptionModal";
    modal.className = "modal";
    modal.innerHTML = '<div class="modal-card wt-v5-caption-card"><div class="panel-title">字幕中心</div></div>';
    modal.querySelector(".modal-card").appendChild(body);
    document.body.appendChild(modal);

    if ($("wtV5CaptionText")) $("wtV5CaptionText").value = existing.text || "";
    $("wtV5CaptionEnabled")?.addEventListener("change", e => writeCaptionEnabled(e.target.checked));
    $("wtV5CaptionFile")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_VTT_BYTES) {
        toast("字幕檔過大，單檔上限約 250 KB");
        e.target.value = "";
        return;
      }
      try {
        $("wtV5CaptionText").value = await file.text();
        $("wtV5CaptionLabel").value = file.name.replace(/\.vtt$/i, "").slice(0,80);
      } catch (_) {
        toast("字幕檔讀取失敗");
      }
    });
    $("wtV5CaptionSave")?.addEventListener("click", async () => {
      try {
        await saveCaptions($("wtV5CaptionText").value, $("wtV5CaptionLabel").value, $("wtV5CaptionLang").value);
        modal.remove();
      } catch (error) {
        toast(error?.message || "字幕儲存失敗");
      }
    });
    $("wtV5CaptionDelete")?.addEventListener("click", async () => {
      try {
        await removeCaptions();
        modal.remove();
      } catch (error) {
        toast(error?.message || "字幕刪除失敗");
      }
    });
    $("wtV5CaptionSync")?.addEventListener("click", () => {
      $("manualSyncBtn")?.click();
      toast("已要求立即同步");
    });
    $("wtV5CaptionClose")?.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", e => {
      if (e.target === modal) modal.remove();
    });
    startCaptionLoop();
  }

  function updateCaptionButton() {
    const buttons = document.querySelectorAll("[data-wt-v5-caption-open]");
    buttons.forEach(button => {
      button.textContent = captionCues.length ? "字幕" : "字幕";
      button.title = captionCues.length ? (captionData?.label || "已設定字幕") : "開啟字幕中心";
      button.classList.toggle("is-active", captionEnabled && captionCues.length > 0);
    });
  }

  function ensureCaptionButton() {
    const actions = document.querySelector(".room-actions");
    if (!actions || !roomId() || $("wtV5CaptionBtn")) return;
    const button = document.createElement("button");
    button.id = "wtV5CaptionBtn";
    button.type = "button";
    button.className = "secondary-btn";
    button.dataset.wtV5CaptionOpen = "1";
    button.textContent = "字幕";
    button.addEventListener("click", openCaptionManager);
    actions.appendChild(button);
    updateCaptionButton();
  }

  function ensureOfflineBanner() {
    if (networkBanner) return;
    networkBanner = document.createElement("div");
    networkBanner.id = "wtV5NetworkBanner";
    networkBanner.style.cssText =
      "position:fixed;left:12px;right:12px;bottom:12px;z-index:10000;" +
      "display:none;padding:10px 14px;border-radius:12px;" +
      "background:rgba(127,29,29,.96);color:#fff;text-align:center;" +
      "font-size:12px;font-weight:600;box-shadow:0 10px 28px rgba(0,0,0,.25)";
    networkBanner.textContent = "網路連線中斷，WatchTogether 正在等待重新連線…";
    document.body.appendChild(networkBanner);
  }

  function updateNetworkBanner() {
    ensureOfflineBanner();
    const offline = navigator.onLine === false;
    networkBanner.style.display = offline ? "block" : "none";
    if (offline !== lastOnlineState) {
      lastOnlineState = offline;
      if (!offline && roomState().roomId && $("manualSyncBtn")?.disabled === false) {
        setTimeout(() => $("manualSyncBtn")?.click(), 250);
      }
    }
  }

  function incrementClientError(kind) {
    try {
      const current = Number(localStorage.getItem(LOCAL_ERROR_COUNT) || 0);
      localStorage.setItem(LOCAL_ERROR_COUNT, String(Math.min(999999, current + 1)));
    } catch (_) {}
    const detail = String(kind || "unknown").slice(0,120);
    if (detail && window.reportWatchTogetherBug) {
      try {
        window.reportWatchTogetherBug("other", "前端未處理錯誤：" + detail, {
          source:"feature-complete-v5",
          page:location.href.slice(0,1000),
          roomId:roomId(),
          playerType:String(roomState().playerType || "")
        });
      } catch (_) {}
    }
  }

  function installErrorTelemetry() {
    if (window.__WT_V5_ERROR_TELEMETRY__) return;
    window.__WT_V5_ERROR_TELEMETRY__ = true;
    window.addEventListener("error", event => {
      const message = String(event?.message || "window.error").slice(0,240);
      incrementClientError(message);
    });
    window.addEventListener("unhandledrejection", event => {
      const reason = event?.reason;
      const message = String(reason?.message || reason || "unhandledrejection").slice(0,240);
      incrementClientError(message);
    });
  }

  function installKeyboardShortcuts() {
    if (window.__WT_V5_SHORTCUTS__) return;
    window.__WT_V5_SHORTCUTS__ = true;
    window.addEventListener("keydown", event => {
      const target = event.target;
      if (target && (
        target.matches?.("input,textarea,select") ||
        target.isContentEditable
      )) return;
      const s = roomState();
      if (!s.roomId || s.leavingRoom || !s.playerReady) return;

      const key = String(event.key || "").toLowerCase();
      if (key === " " || key === "k") {
        event.preventDefault();
        $("playPauseBtn")?.click();
      } else if (key === "j") {
        event.preventDefault();
        $("backBtn")?.click();
      } else if (key === "l") {
        event.preventDefault();
        $("forwardBtn")?.click();
      } else if (key === "m") {
        event.preventDefault();
        const input = $("volumeInput");
        if (!input) return;
        if (Number(input.value) > 0) {
          input.dataset.wtV5PreviousVolume = input.value;
          input.value = "0";
        } else {
          input.value = input.dataset.wtV5PreviousVolume || "100";
        }
        input.dispatchEvent(new Event("input", {bubbles:true}));
      } else if (key === "f") {
        event.preventDefault();
        $("fullscreenBtn")?.click();
      } else if (key === "s") {
        event.preventDefault();
        $("wtV5CaptionBtn")?.click();
      }
    });
  }

  function addFeatureHubCaptionEntry() {
    const modal = $("wtSuiteFeatureHubModal");
    if (!modal || modal.dataset.wtV5CaptionBound) return;
    modal.dataset.wtV5CaptionBound = "1";
    const actions = modal.querySelectorAll(".wt-suite-actions");
    const roomActions = Array.from(actions).find(el => /房間設定/.test(el.textContent || ""));
    if (!roomActions) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-btn";
    button.textContent = "💬 字幕";
    button.addEventListener("click", () => {
      modal.classList.add("hidden");
      openCaptionManager();
    });
    roomActions.appendChild(button);
  }

  function installModalObserver() {
    if (window.__WT_V5_MODAL_OBSERVER__) return;
    window.__WT_V5_MODAL_OBSERVER__ = true;
    const observer = new MutationObserver(() => {
      addFeatureHubCaptionEntry();
      ensureCaptionButton();
      updateCaptionButton();
    });
    observer.observe(document.body, {childList:true,subtree:true});
  }

  function init() {
    if (document.documentElement.dataset.wtV5Init) return;
    document.documentElement.dataset.wtV5Init = "1";
    captionEnabled = readCaptionEnabled();
    ensureOfflineBanner();
    installErrorTelemetry();
    installKeyboardShortcuts();
    installModalObserver();
    setInterval(() => {
      ensureCaptionButton();
      installCaptionListener();
      updateNetworkBanner();
      addFeatureHubCaptionEntry();
    }, 1000);
    updateNetworkBanner();
    startCaptionLoop();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {once:true});
  } else {
    init();
  }

  window.WT_FEATURE_COMPLETE_V5 = {
    openCaptionManager,
    saveCaptions,
    removeCaptions,
    getCaptionState:() => ({
      roomId:captionRoom,
      enabled:captionEnabled,
      cueCount:captionCues.length,
      label:String(captionData?.label || ""),
      language:String(captionData?.language || "")
    })
  };
})();