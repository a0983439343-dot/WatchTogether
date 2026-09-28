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
  let lastOnlineState = navigator.onLine === false;

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
    captionAnimation = setInterval(captionTick, 120);
    captionTick();
  }

  function stopCaptionLoop() {
    if (!captionAnimation) return;
    clearInterval(captionAnimation);
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
    captionRef = db.ref("roomCaptions/" + id);
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
    await db.ref("roomCaptions/" + id).set({
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
    await db.ref("roomCaptions/" + id).remove();
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
    document.getElementById("wtV5CaptionModal")?.remove();
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

/* =========================================================
 * WatchTogether Social Suite v6
 * Friends + requests + block list + permanent DM
 * read state + typing + stickers + image/GIF + reply/edit/pin/reactions
 * ========================================================= */
(() => {
  "use strict";

  const wt = window.WT_ENHANCEMENTS = window.WT_ENHANCEMENTS || {};
  const core = window.WT_CORE || {};
  const $ = id => document.getElementById(id);
  const auth = wt.auth || (window.firebase && firebase.apps.length ? firebase.auth() : null);
  const db = wt.db || (window.firebase && firebase.apps.length ? firebase.database() : null);
  const REACTIONS = ["❤️","👍","😂","😮","😢","😡","🔥","👏"];
  const STICKERS = ["😊","😂","👍","❤️","🔥","🎉","😍","😎","🤔","🥳","😢","😮","👏","🙏","🍿","🎬"];
  const MAX_TEXT = 2000;
  let activeFriendUid = "";
  let activeConversationId = "";
  let activeMessageRef = null;
  let activeTypingRef = null;
  let activeReadRef = null;
  let activePinnedRef = null;
  let dmMessages = [];
  let dmPins = {};
  let dmOtherProfile = null;
  let dmTypingTimer = null;
  let dmModalObserver = null;
  let unreadBusy = false;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    }[c]));
  }
  function toast(message) {
    try {
      if (typeof wt.toast === "function") return wt.toast(message);
      if (typeof window.toast === "function") return window.toast(message);
    } catch (_) {}
  }
  function currentUser() { return auth && auth.currentUser || null; }
  function uid() { return String(currentUser()?.uid || core.state?.uid || wt.state?.uid || ""); }
  function currentName() {
    return String(
      wt.currentName?.() ||
      wt.state?.memberName ||
      core.state?.memberName ||
      currentUser()?.displayName ||
      "玩家"
    ).slice(0,30);
  }
  function signedIn() {
    const u = currentUser();
    if (!u || u.isAnonymous) { toast("好友與私訊需要 Google 帳號"); return false; }
    if (!db) { toast("Firebase 尚未準備完成"); return false; }
    return true;
  }
  function fmtDate(v) {
    const d = new Date(Number(v || 0));
    return isFinite(d.getTime()) && d.getTime() > 0
      ? d.toLocaleString("zh-TW",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})
      : "—";
  }
  function cidFor(a,b) {
    const arr=[String(a||""),String(b||"")].filter(Boolean).sort();
    return arr.length===2 ? "dm_"+arr[0]+"_"+arr[1] : "";
  }
  function closeModal(id) {
    const m=$(id);
    if(!m)return;
    m.classList.add("hidden");m.hidden=true;
    m.setAttribute("aria-hidden","true");
    m.style.setProperty("display","none","important");
    if(!document.querySelector(".modal:not(.hidden)"))document.body.classList.remove("wt-social-modal-open");
  }
  function modal(id,title,html) {
    let m=$(id);
    if(!m){
      m=document.createElement("div");
      m.id=id;m.className="modal hidden wt-social-v6-modal";m.setAttribute("aria-hidden","true");
      m.innerHTML='<div class="modal-card wt-social-v6-card"><div class="wt-social-v6-head"><div class="panel-title" id="'+id+'Title"></div><button type="button" class="tiny-btn" data-social-v6-close="1">關閉</button></div><div id="'+id+'Body"></div></div>';
      document.body.appendChild(m);
      m.addEventListener("click",e=>{if(e.target===m)closeModal(id);});
      m.querySelector("[data-social-v6-close]").onclick=()=>closeModal(id);
    }
    $(id+"Title").textContent=title;
    $(id+"Body").innerHTML=html;
    m.hidden=false;m.classList.remove("hidden");m.style.removeProperty("display");m.setAttribute("aria-hidden","false");
    document.body.classList.add("wt-social-modal-open");
    return $(id+"Body");
  }
  function ensureCss() {
    if($("wtSocialV6Style"))return;
    const s=document.createElement("style");s.id="wtSocialV6Style";
    s.textContent=
      ".wt-social-v6-modal .wt-social-v6-card{width:min(980px,calc(100vw - 20px));max-height:91vh;overflow:auto}" +
      ".wt-social-v6-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}" +
      ".wt-social-v6-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}" +
      ".wt-social-v6-search{display:grid;grid-template-columns:1fr auto;gap:7px;margin-bottom:9px}" +
      ".wt-social-v6-list{display:grid;gap:7px;max-height:55vh;overflow:auto}" +
      ".wt-social-v6-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px;border:1px solid var(--wt-border);border-radius:12px;background:rgba(255,255,255,.025)}" +
      ".wt-social-v6-user{display:flex;align-items:center;gap:9px;min-width:0}.wt-social-v6-user-main{min-width:0}.wt-social-v6-user-main strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".wt-social-v6-avatar{width:40px;height:40px;flex:none;display:grid;place-items:center;border-radius:50%;background:rgba(124,108,255,.12);font-size:20px}" +
      ".wt-social-v6-meta{font-size:10px;color:#78859e}.wt-social-v6-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}" +
      ".wt-social-v6-empty{padding:18px;text-align:center;color:#7e8ca5;font-size:11px}.wt-social-v6-online{color:#67dfa7}.wt-social-v6-offline{color:#738099}" +
      ".wt-social-v6-unread{display:inline-grid;place-items:center;min-width:17px;height:17px;padding:0 5px;border-radius:999px;background:#ef476f;color:#fff;font-size:9px;font-weight:900}" +
      ".wt-dm-v6{display:grid;grid-template-rows:auto 1fr auto;height:min(72vh,700px);min-height:440px}.wt-dm-v6-head{display:flex;align-items:center;gap:9px;border-bottom:1px solid var(--wt-border);padding:7px 0 11px}" +
      ".wt-dm-v6-messages{min-height:0;overflow:auto;padding:10px 2px}.wt-dm-v6-msg{display:flex;gap:7px;margin:8px 0}.wt-dm-v6-msg.mine{justify-content:flex-end}" +
      ".wt-dm-v6-bubble{max-width:min(78%,630px);padding:8px 10px;border:1px solid var(--wt-border);border-radius:14px;background:rgba(255,255,255,.03)}.wt-dm-v6-msg.mine .wt-dm-v6-bubble{background:rgba(124,108,255,.11);border-color:rgba(124,108,255,.22)}" +
      ".wt-dm-v6-text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.55}.wt-dm-v6-quote{font-size:10px;color:#aab5ca;border-left:3px solid rgba(124,108,255,.55);background:rgba(124,108,255,.06);padding:6px 8px;border-radius:8px;margin-bottom:5px}" +
      ".wt-dm-v6-img{display:block;max-width:min(420px,72vw);max-height:340px;border-radius:12px;background:#05070c;object-fit:contain;cursor:zoom-in}.wt-dm-v6-sticker{font-size:36px;line-height:1}" +
      ".wt-dm-v6-time{font-size:9px;color:#6d7891;margin-top:4px}.wt-dm-v6-actions{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}.wt-dm-v6-action{border:1px solid var(--wt-border);background:rgba(255,255,255,.035);border-radius:8px;padding:4px 7px;font-size:9px}" +
      ".wt-dm-v6-tools{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:7px}.wt-dm-v6-picker{display:grid;grid-template-columns:repeat(8,1fr);gap:5px;padding:7px;border:1px solid var(--wt-border);border-radius:12px;margin-bottom:7px;background:rgba(13,16,26,.98)}.wt-dm-v6-picker button{font-size:20px;padding:6px;border:1px solid transparent;border-radius:9px;background:rgba(255,255,255,.03)}" +
      ".wt-dm-v6-composer{border-top:1px solid var(--wt-border);padding-top:9px}.wt-dm-v6-compose-row{display:grid;grid-template-columns:1fr auto;gap:7px}.wt-dm-v6-reply{margin-bottom:7px}" +
      ".wt-social-v6-nav-wrap{position:relative;display:inline-flex}.wt-social-v6-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#ef476f;color:#fff;font-size:9px;line-height:16px;text-align:center;font-weight:900}" +
      "@media(max-width:700px){.wt-dm-v6{height:72vh;min-height:400px}.wt-dm-v6-bubble{max-width:90%}.wt-social-v6-search,.wt-dm-v6-compose-row{grid-template-columns:1fr}.wt-dm-v6-picker{grid-template-columns:repeat(4,1fr)}}" ;
    document.head.appendChild(s);
  }
  function nav(id,label,title,handler,badge) {
    const r=document.querySelector(".topbar-right"),anchor=$("googleLoginBtn");
    if(!r||$(id))return;
    const wrap=document.createElement("span");wrap.className="wt-social-v6-nav-wrap";
    const b=document.createElement("button");b.id=id;b.className="wt-nav-btn";b.type="button";b.textContent=label;b.title=title;b.onclick=handler;wrap.appendChild(b);
    if(badge){const n=document.createElement("span");n.id=badge;n.className="wt-social-v6-badge";n.style.display="none";wrap.appendChild(n);}
    r.insertBefore(wrap,anchor||null);
  }
  function updateHomeSearch() {
    const b=$("wtFeatureSearchBtn"),room=$("roomView");
    if(!b)return;
    const inRoom=Boolean(room&&!room.classList.contains("hidden")&&!room.hidden);
    b.style.display=inRoom?"":"none";
    b.setAttribute("aria-hidden",inRoom?"false":"true");
  }
  function ensureTopbar() {
    nav("wtSocialV6FriendsBtn","👥 好友","好友中心",()=>openFriends());
    nav("wtSocialV6DmBtn","💬 私訊","私訊中心",()=>openDmList(),"wtSocialV6DmBadge");
    updateHomeSearch();
  }

  async function profile(targetUid) {
    try { const s=await db.ref("publicUsers/"+targetUid).once("value"); if(s.exists())return Object.assign({uid:String(targetUid)},s.val()||{}); } catch(_){}
    try { const s=await db.ref("profiles/"+targetUid).once("value"); if(s.exists())return Object.assign({uid:String(targetUid)},s.val()||{}); } catch(_){}
    return {uid:String(targetUid),displayName:"玩家",publicCode:"",avatarEmoji:"🙂"};
  }
  async function friendEntries() {
    if(!signedIn())return [];
    const me=uid(),snap=await db.ref("friendships/"+me).once("value"),rows=[];
    snap.forEach(c=>{if(c.key!==me&&c.val())rows.push({uid:String(c.key),since:Number(c.val().since||0)});});
    const out=await Promise.all(rows.map(async row=>{
      const p=await profile(row.uid);let presence=null,last=null,readAt=0;
      try{const s=await db.ref("presence/"+row.uid).once("value");presence=s.val()||null;}catch(_){}
      const cid=cidFor(me,row.uid);
      if(cid)try{const s=await db.ref("conversations/"+cid+"/lastMessage").once("value");last=s.val()||null;}catch(_){}
      if(cid)try{const s=await db.ref("conversations/"+cid+"/reads/"+me).once("value");readAt=Number(s.val()||0);}catch(_){}
      const unread=Boolean(last&&Number(last.createdAt||0)>readAt&&String(last.uid||"")!==me);
      return Object.assign(row,{profile:p,presence,unread,lastMessage:last});
    }));
    out.sort((a,b)=>Number(b.lastMessage?.createdAt||b.since||0)-Number(a.lastMessage?.createdAt||a.since||0));
    return out;
  }
  async function requests() {
    if(!signedIn())return [];
    const snap=await db.ref("friendRequests/"+uid()).once("value"),out=[];
    snap.forEach(c=>{const v=c.val();if(v)out.push(Object.assign({requesterUid:String(c.key)},v));});
    return out.sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
  }
  async function searchUsers(query) {
    const q=String(query||"").trim(),me=uid();if(!q||!db)return [];
    if(/^[a-z0-9]{6}$/i.test(q)){
      const s=await db.ref("profileCodes/"+q.toUpperCase()).once("value");
      const target=String(s.val()||"");if(!target||target===me)return [];
      return [await profile(target)];
    }
    const list=[],lower=q.toLowerCase(),end=lower+String.fromCharCode(0xf8ff);
    try{
      const s=await db.ref("publicUsers").orderByChild("searchName").startAt(lower).endAt(end).limitToFirst(40).once("value");
      s.forEach(c=>{if(c.key!==me&&c.val())list.push(Object.assign({uid:String(c.key)},c.val()));});
    }catch(_){}
    return list;
  }
  function userHtml(item,actions) {
    const p=item.profile||item,online=item.presence?.online===true&&Number(item.presence?.lastSeen||0)>=Date.now()-70000;
    return '<div class="wt-social-v6-row"><div class="wt-social-v6-user"><div class="wt-social-v6-avatar">'+esc(p.avatarEmoji||"🙂")+'</div><div class="wt-social-v6-user-main"><strong>'+esc(p.displayName||"玩家")+'</strong><div class="wt-social-v6-meta">'+(p.publicCode?"ID："+esc(p.publicCode)+"｜":"")+(online?'<span class="wt-social-v6-online">● 在線</span>':'<span class="wt-social-v6-offline">● 離線</span>')+'</div></div></div><div class="wt-social-v6-actions">'+(actions||"")+'</div></div>';
  }
  async function sendFriendRequest(target) {
    if(!signedIn())return;
    const me=uid(),other=String(target||"");if(!other||other===me)throw new Error("不能加自己為好友");
    const blockedA=await db.ref("blockedUsers/"+me+"/"+other).once("value").catch(()=>null),blockedB=await db.ref("blockedUsers/"+other+"/"+me).once("value").catch(()=>null);
    if(blockedA?.exists()||blockedB?.exists())throw new Error("這個使用者目前已被封鎖");
    const a=await db.ref("friendships/"+me+"/"+other).once("value"),b=await db.ref("friendships/"+other+"/"+me).once("value");
    if(a.exists()||b.exists())throw new Error("你們已經是好友");
    const reverse=await db.ref("friendRequests/"+me+"/"+other).once("value");
    if(reverse.exists()){await acceptFriendRequest(other);return;}
    const meProfile=await profile(me);
    await db.ref("friendRequests/"+other+"/"+me).set({
      uid:me,name:String(meProfile.displayName||currentName()).slice(0,30),
      fromName:String(meProfile.displayName||currentName()).slice(0,30),
      fromCode:String(meProfile.publicCode||"").slice(0,6).toUpperCase(),
      avatarEmoji:String(meProfile.avatarEmoji||"🙂").slice(0,4),
      createdAt:firebase.database.ServerValue.TIMESTAMP
    });
    toast("好友邀請已送出");
  }
  async function acceptFriendRequest(other) {
    if(!signedIn())return;
    const me=uid(),target=String(other||"");if(!target||target===me)return;
    const req=await db.ref("friendRequests/"+me+"/"+target).once("value");
    if(!req.exists())throw new Error("好友邀請不存在或已經處理");
    const ts=firebase.database.ServerValue.TIMESTAMP,updates={};
    updates["friendships/"+me+"/"+target]={since:ts};
    updates["friendships/"+target+"/"+me]={since:ts};
    updates["friendRequests/"+me+"/"+target]=null;
    await db.ref().update(updates);
    toast("已成為好友");
  }
  async function declineFriendRequest(other) {
    if(!signedIn())return;
    await db.ref("friendRequests/"+uid()+"/"+String(other||"")).remove();
    toast("已忽略好友邀請");
  }
  async function removeFriend(other) {
    if(!signedIn()||!other)return;
    if(!window.confirm("確定要刪除這位好友嗎？"))return;
    const me=uid(),target=String(other),u={};
    u["friendships/"+me+"/"+target]=null;u["friendships/"+target+"/"+me]=null;
    await db.ref().update(u);toast("好友已刪除");
  }
  async function blockUser(other,label) {
    if(!signedIn()||!other)return;
    const target=String(other);if(target===uid())return;
    if(!window.confirm("確定要封鎖「"+String(label||"這位使用者")+"」嗎？"))return;
    await db.ref("blockedUsers/"+uid()+"/"+target).set({uid:target,name:String(label||"玩家").slice(0,30),createdAt:firebase.database.ServerValue.TIMESTAMP});
    const u={};u["friendships/"+uid()+"/"+target]=null;u["friendships/"+target+"/"+uid()]=null;
    await db.ref().update(u).catch(()=>{});
    toast("已封鎖");
  }
  async function unblockUser(other) {
    if(!signedIn()||!other)return;
    await db.ref("blockedUsers/"+uid()+"/"+String(other)).remove();toast("已解除封鎖");
  }
  async function blocked() {
    if(!signedIn())return [];
    const snap=await db.ref("blockedUsers/"+uid()).once("value"),out=[];
    snap.forEach(c=>{if(c.val())out.push(Object.assign({uid:String(c.key)},c.val()));});
    return out;
  }

  async function openFriends(prefillOrTab) {
    if(!signedIn())return;
    closeModal("wtDmModal");
    const body=modal("wtFriendsV6Modal","好友中心",'<div class="wt-social-v6-empty">載入中…</div>');
    const tabs=['<div class="wt-social-v6-tabs"><button class="tiny-btn primary" data-fv-tab="friends">好友</button><button class="tiny-btn" data-fv-tab="requests">邀請</button><button class="tiny-btn" data-fv-tab="search">搜尋</button><button class="tiny-btn" data-fv-tab="blocked">封鎖</button></div><div id="wtFriendsV6Content"></div>'];
    body.innerHTML=tabs.join("");
    const content=body.querySelector("#wtFriendsV6Content");
    const renderFriends=async()=>{
      const list=await friendEntries();
      content.innerHTML='<div class="wt-social-v6-list">'+(list.length?list.map(x=>userHtml(x,
        '<button class="tiny-btn primary" data-fv-dm="'+esc(x.uid)+'">私訊'+(x.unread?' <span class="wt-social-v6-unread">新</span>':'')+'</button>'+
        '<button class="tiny-btn" data-fv-del="'+esc(x.uid)+'">刪除</button>'+
        '<button class="tiny-btn danger" data-fv-block="'+esc(x.uid)+'">封鎖</button>'
      )).join(""):'<div class="wt-social-v6-empty">目前沒有好友。</div>')+'</div>';
      content.querySelectorAll("[data-fv-dm]").forEach(b=>b.onclick=()=>openDm(b.dataset.fvDm));
      content.querySelectorAll("[data-fv-del]").forEach(b=>b.onclick=async()=>{try{await removeFriend(b.dataset.fvDel);await renderFriends();}catch(e){toast(e.message||"刪除好友失敗");}});
      content.querySelectorAll("[data-fv-block]").forEach(b=>b.onclick=async()=>{try{const x=list.find(v=>v.uid===b.dataset.fvBlock);await blockUser(b.dataset.fvBlock,x?.profile?.displayName);await renderFriends();}catch(e){toast(e.message||"封鎖失敗");}});
    };
    const renderRequests=async()=>{
      const list=await requests();
      content.innerHTML='<div class="wt-social-v6-list">'+(list.length?list.map(x=>userHtml({profile:{displayName:x.fromName||x.name||"玩家",publicCode:x.fromCode||"",avatarEmoji:x.avatarEmoji||"🙂"}},
        '<button class="tiny-btn primary" data-fv-accept="'+esc(x.requesterUid)+'">接受</button><button class="tiny-btn" data-fv-decline="'+esc(x.requesterUid)+'">忽略</button>'
      )).join(""):'<div class="wt-social-v6-empty">沒有待處理好友邀請。</div>')+'</div>';
      content.querySelectorAll("[data-fv-accept]").forEach(b=>b.onclick=async()=>{try{await acceptFriendRequest(b.dataset.fvAccept);await renderRequests();}catch(e){toast(e.message||"接受失敗");}});
      content.querySelectorAll("[data-fv-decline]").forEach(b=>b.onclick=async()=>{try{await declineFriendRequest(b.dataset.fvDecline);await renderRequests();}catch(e){toast(e.message||"忽略失敗");}});
    };
    const renderSearch=async initial=>{
      content.innerHTML='<div class="wt-social-v6-search"><input id="wtChatFriendCode" type="search" maxlength="100" placeholder="輸入 6 碼使用者 ID 或名稱…" value="'+esc(initial||"")+'"><button id="wtFriendsV6Search" class="primary-btn">搜尋</button></div><div id="wtFriendsV6Results" class="wt-social-v6-list"><div class="wt-social-v6-empty">搜尋好友或使用者。</div></div>';
      const input=content.querySelector("#wtChatFriendCode"),out=content.querySelector("#wtFriendsV6Results");
      const run=async()=>{
        const q=String(input.value||"").trim();if(!q){out.innerHTML='<div class="wt-social-v6-empty">請輸入搜尋內容。</div>';return;}
        out.innerHTML='<div class="wt-social-v6-empty">搜尋中…</div>';
        try{
          const users=await searchUsers(q),me=uid(),rows=[];
          for(const p of users){
            const a=await db.ref("friendships/"+me+"/"+p.uid).once("value").catch(()=>null),b=await db.ref("friendships/"+p.uid+"/"+me).once("value").catch(()=>null),bl=await db.ref("blockedUsers/"+me+"/"+p.uid).once("value").catch(()=>null);
            rows.push({profile:p,isFriend:Boolean(a?.exists()||b?.exists()),blocked:Boolean(bl?.exists())});
          }
          out.innerHTML=rows.length?rows.map(x=>userHtml({profile:x.profile},
            x.blocked?'<button class="tiny-btn" data-fv-unblock="'+esc(x.profile.uid)+'">解除封鎖</button>':
              (x.isFriend?'<button class="tiny-btn primary" data-fv-search-dm="'+esc(x.profile.uid)+'">私訊</button>':'<button class="tiny-btn primary" data-fv-add="'+esc(x.profile.uid)+'">加好友</button>')+
              '<button class="tiny-btn danger" data-fv-search-block="'+esc(x.profile.uid)+'">封鎖</button>'
          )).join(""):'<div class="wt-social-v6-empty">沒有找到符合的使用者。</div>';
          out.querySelectorAll("[data-fv-add]").forEach(b=>b.onclick=async()=>{try{await sendFriendRequest(b.dataset.fvAdd);await run();}catch(e){toast(e.message||"好友邀請失敗");}});
          out.querySelectorAll("[data-fv-search-dm]").forEach(b=>b.onclick=()=>openDm(b.dataset.fvSearchDm));
          out.querySelectorAll("[data-fv-search-block]").forEach(b=>b.onclick=async()=>{try{const p=users.find(v=>v.uid===b.dataset.fvSearchBlock);await blockUser(b.dataset.fvSearchBlock,p?.displayName);await run();}catch(e){toast(e.message||"封鎖失敗");}});
          out.querySelectorAll("[data-fv-unblock]").forEach(b=>b.onclick=async()=>{try{await unblockUser(b.dataset.fvUnblock);await run();}catch(e){toast(e.message||"解除封鎖失敗");}});
        }catch(e){out.innerHTML='<div class="wt-social-v6-empty">'+esc(e.message||"搜尋失敗")+'</div>';}
      };
      content.querySelector("#wtFriendsV6Search").onclick=run;
      input.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();void run();}};
      if(initial)void run();
      setTimeout(()=>input.focus(),30);
    };
    const renderBlocked=async()=>{
      const list=await blocked();
      content.innerHTML='<div class="wt-social-v6-list">'+(list.length?list.map(x=>userHtml({profile:{displayName:x.name||"玩家",publicCode:"",avatarEmoji:"🚫"}},'<button class="tiny-btn" data-fv-unblock="'+esc(x.uid)+'">解除封鎖</button>')).join(""):'<div class="wt-social-v6-empty">沒有封鎖任何使用者。</div>')+'</div>';
      content.querySelectorAll("[data-fv-unblock]").forEach(b=>b.onclick=async()=>{try{await unblockUser(b.dataset.fvUnblock);await renderBlocked();}catch(e){toast(e.message||"解除封鎖失敗");}});
    };
    body.querySelectorAll("[data-fv-tab]").forEach(b=>b.onclick=()=>{const t=b.dataset.fvTab;if(t==="friends")void renderFriends();else if(t==="requests")void renderRequests();else if(t==="search")void renderSearch("");else void renderBlocked();});
    if(["friends","requests","search","blocked"].includes(String(prefillOrTab||""))) {
      if(prefillOrTab==="requests")void renderRequests();else if(prefillOrTab==="search")void renderSearch("");else if(prefillOrTab==="blocked")void renderBlocked();else void renderFriends();
    } else if(prefillOrTab) {
      void renderSearch(String(prefillOrTab));
    } else {
      void renderFriends();
    }
  }

  function messageHtml(m) {
    const mine=String(m.uid||"")===uid(),type=String(m.type||"text"),pinned=Boolean(dmPins[m.id]),reply=m.replyToText?
      '<div class="wt-dm-v6-quote">回覆 '+esc(m.replyToName||"玩家")+'：'+esc(m.replyToText)+'</div>':"";
    let body="";
    if(type==="sticker")body='<div class="wt-dm-v6-sticker">'+esc(m.sticker||"😊")+'</div>';
    else if(type==="image")body='<img class="wt-dm-v6-img" data-v6-lightbox="'+esc(m.mediaUrl||"")+'" src="'+esc(m.mediaUrl||"")+'" alt="'+esc(m.mediaName||"圖片")+'">';
    else body='<div class="wt-dm-v6-text">'+esc(m.text||"")+'</div>';
    const reactions=REACTIONS.map(e=>'<button type="button" class="wt-dm-v6-action" data-v6-react="'+esc(m.id)+'" data-v6-emoji="'+esc(e)+'">'+e+'</button>').join("");
    const actions='<div class="wt-dm-v6-actions">'+
      ((type==="text"||type==="sticker"||type==="image")?'<button class="wt-dm-v6-action" data-v6-reply="'+esc(m.id)+'">回覆</button>':"")+
      (mine&&type==="text"?'<button class="wt-dm-v6-action" data-v6-edit="'+esc(m.id)+'">編輯</button>':"")+
      (mine?'<button class="wt-dm-v6-action" data-v6-delete="'+esc(m.id)+'">刪除</button>':"")+
      '<button class="wt-dm-v6-action" data-v6-pin="'+esc(m.id)+'">'+(pinned?"取消釘選":"釘選")+'</button></div>';
    return '<div class="wt-dm-v6-msg '+(mine?"mine":"")+'"><div class="wt-dm-v6-bubble">'+reply+body+'<div class="wt-dm-v6-time">'+esc(m.name||"玩家")+'｜'+esc(fmtDate(m.createdAt))+(m.editedAt?" · 已編輯":"")+'</div><div class="wt-dm-v6-actions">'+reactions+'</div>'+actions+'</div></div>';
  }
  function renderDmMessages(body,otherUid) {
    const box=body.querySelector("#wtDmV6Messages");if(!box)return;
    const q=String(body.querySelector("#wtDmV6Search")?.value||"").trim().toLowerCase();
    const rows=dmMessages.filter(m=>!q||String(m.text||m.sticker||m.mediaName||"").toLowerCase().includes(q));
    box.innerHTML=rows.length?rows.map(messageHtml).join(""):'<div class="wt-social-v6-empty">目前沒有私訊。</div>';
    bindDmMessageButtons(body,otherUid);
    box.scrollTop=box.scrollHeight;
  }
  function bindDmMessageButtons(body,otherUid) {
    body.querySelectorAll("[data-v6-reply]").forEach(b=>b.onclick=()=>{
      const m=dmMessages.find(v=>v.id===b.dataset.v6Reply),input=body.querySelector("#wtDmV6Input");
      if(!m||!input)return;
      input.dataset.replyToId=m.id;input.dataset.replyToName=String(m.name||"玩家").slice(0,30);input.dataset.replyToText=String(m.text||m.sticker||"").slice(0,300);
      input.value=String(m.text||m.sticker||"").slice(0,300);input.focus();
    });
    body.querySelectorAll("[data-v6-edit]").forEach(b=>b.onclick=async()=>{
      const m=dmMessages.find(v=>v.id===b.dataset.v6Edit);if(!m)return;
      const next=String(window.prompt("編輯私訊：",m.text||"")||"").trim().slice(0,MAX_TEXT);if(!next||next===m.text)return;
      try{await db.ref("conversations/"+activeConversationId+"/messages/"+m.id).update({text:next,editedAt:firebase.database.ServerValue.TIMESTAMP});}catch(e){toast(e.message||"編輯失敗");}
    });
    body.querySelectorAll("[data-v6-delete]").forEach(b=>b.onclick=async()=>{
      if(!window.confirm("確定刪除這則訊息嗎？"))return;
      try{await db.ref("conversations/"+activeConversationId+"/messages/"+b.dataset.v6Delete).remove();}catch(e){toast(e.message||"刪除失敗");}
    });
    body.querySelectorAll("[data-v6-pin]").forEach(b=>b.onclick=async()=>{
      const m=dmMessages.find(v=>v.id===b.dataset.v6Pin);if(!m)return;
      const path="conversations/"+activeConversationId+"/pinnedMessages/"+m.id;
      try{
        const s=await db.ref(path).once("value");
        if(s.exists())await db.ref(path).remove();else await db.ref(path).set({
          messageId:m.id,uid:String(m.uid||"").slice(0,128),name:String(m.name||"玩家").slice(0,30),type:String(m.type||"text"),
          createdAt:Number(m.createdAt||Date.now()),pinnedAt:firebase.database.ServerValue.TIMESTAMP,pinnedBy:uid(),
          ...(m.text?{text:String(m.text).slice(0,300)}:{}),...(m.sticker?{sticker:String(m.sticker).slice(0,4)}:{}),...(m.mediaName?{mediaName:String(m.mediaName).slice(0,200)}:{})
        });
      }catch(e){toast(e.message||"釘選失敗");}
    });
    body.querySelectorAll("[data-v6-react]").forEach(b=>b.onclick=async()=>{
      const path="conversations/"+activeConversationId+"/messages/"+b.dataset.v6React+"/reactions/"+uid();
      try{const s=await db.ref(path).once("value");if(String(s.val()||"")===b.dataset.v6Emoji)await db.ref(path).remove();else await db.ref(path).set(b.dataset.v6Emoji);}catch(e){toast(e.message||"反應失敗");}
    });
    body.querySelectorAll("[data-v6-lightbox]").forEach(b=>b.onclick=()=>openLightbox(b.dataset.v6Lightbox));
  }

  async function ensureConversation(otherUid) {
    const me=uid(),other=String(otherUid||""),cid=cidFor(me,other);if(!cid)throw new Error("私訊對象無效");
    const ref=db.ref("conversations/"+cid),s=await ref.once("value");
    if(!s.exists())await ref.set({userA:me<other?me:other,userB:me<other?other:me,createdAt:firebase.database.ServerValue.TIMESTAMP});
    return cid;
  }
  function detachDm() {
    try{activeMessageRef?.off();}catch(_){} try{activeTypingRef?.off();}catch(_){} try{activeReadRef?.off();}catch(_){} try{activePinnedRef?.off();}catch(_){}
    activeMessageRef=null;activeTypingRef=null;activeReadRef=null;activePinnedRef=null;activeConversationId="";dmMessages=[];dmPins={};
    if(dmTypingTimer){clearTimeout(dmTypingTimer);dmTypingTimer=null;}
  }
  async function markRead() {
    if(!activeConversationId||!uid()||!db)return;
    try{await db.ref("conversations/"+activeConversationId+"/reads/"+uid()).set(firebase.database.ServerValue.TIMESTAMP);}catch(_){}
  }
  function typing(active) {
    if(!activeConversationId||!uid()||!db)return;
    const ref=db.ref("conversations/"+activeConversationId+"/typing/"+uid());
    if(active){
      ref.set({name:currentName(),at:firebase.database.ServerValue.TIMESTAMP}).catch(()=>{});
      if(dmTypingTimer)clearTimeout(dmTypingTimer);
      dmTypingTimer=setTimeout(()=>{ref.remove().catch(()=>{});dmTypingTimer=null;},1800);
    }else{
      ref.remove().catch(()=>{});if(dmTypingTimer){clearTimeout(dmTypingTimer);dmTypingTimer=null;}
    }
  }
  async function sendMessage(body,type,payload) {
    if(!signedIn()||!activeConversationId)return;
    const me=uid(),input=body.querySelector("#wtDmV6Input"),ref=db.ref("conversations/"+activeConversationId+"/messages").push(),base={
      uid:me,name:currentName(),type:type,createdAt:firebase.database.ServerValue.TIMESTAMP
    };
    if(type==="text"){
      const text=String(payload?.text||"").trim().slice(0,MAX_TEXT);if(!text)return;
      base.text=text;
      if(input?.dataset.replyToId){base.replyToId=String(input.dataset.replyToId).slice(0,120);base.replyToName=String(input.dataset.replyToName||"").slice(0,30);base.replyToText=String(input.dataset.replyToText||"").slice(0,300);base.replyToType="text";}
    }else if(type==="sticker"){base.sticker=String(payload?.sticker||"😊").slice(0,4);}
    else if(type==="image"){base.mediaUrl=String(payload?.mediaUrl||"").slice(0,4000);base.mediaPath=String(payload?.mediaPath||"").slice(0,300);base.mediaName=String(payload?.mediaName||"圖片").slice(0,200);base.mediaSize=Number(payload?.mediaSize||1);}
    await ref.set(base);
    await db.ref("conversations/"+activeConversationId+"/lastMessage").set({
      uid:me,name:currentName(),type:type,
      preview:(type==="text"?String(base.text):type==="sticker"?String(base.sticker||"貼圖"):"圖片/GIF").slice(0,300),
      createdAt:firebase.database.ServerValue.TIMESTAMP,messageId:ref.key
    });
    if(input){input.value="";delete input.dataset.replyToId;delete input.dataset.replyToName;delete input.dataset.replyToText;}
    typing(false);await markRead();
  }
  async function uploadImage(file) {
    if(!file||!signedIn())return null;
    if(!String(file.type||"").startsWith("image/"))throw new Error("只支援圖片或 GIF");
    if(file.size>8*1024*1024)throw new Error("圖片/GIF 不得超過 8 MB");
    const a=[uid(),String(activeFriendUid||"")].sort(),safe=String(file.name||"image").replace(/[^a-zA-Z0-9._-]/g,"_").slice(-120),path="chatMedia/"+a[0]+"/"+a[1]+"/"+Date.now()+"_"+safe,ref=firebase.storage().ref(path);
    await ref.put(file,{contentType:String(file.type||"image/*"),customMetadata:{ownerUid:uid(),otherUid:String(activeFriendUid||"")}});
    return {url:await ref.getDownloadURL(),path,name:safe,size:file.size};
  }
  function shell(profile) {
    return '<div class="wt-dm-v6"><div class="wt-dm-v6-head"><div class="wt-social-v6-avatar">'+esc(profile?.avatarEmoji||"🙂")+'</div><div style="min-width:0;flex:1"><strong>'+esc(profile?.displayName||"玩家")+'</strong><div class="wt-social-v6-meta">ID：'+esc(profile?.publicCode||"—")+' <span id="wtDmV6Typing"></span></div></div><button id="wtDmV6Back" class="tiny-btn" type="button">好友</button><button id="wtDmV6Block" class="tiny-btn danger" type="button">封鎖</button></div><div id="wtDmV6Messages" class="wt-dm-v6-messages"></div><div class="wt-dm-v6-composer"><div class="wt-dm-v6-tools"><input id="wtDmV6Search" type="search" maxlength="80" placeholder="搜尋私訊…" style="flex:1;min-width:140px"><button id="wtDmV6StickerBtn" class="wt-dm-v6-action" type="button">😊 貼圖</button><button id="wtDmV6ImageBtn" class="wt-dm-v6-action" type="button">🖼️ 圖片</button><input id="wtDmV6ImageInput" type="file" accept="image/*" hidden></div><div id="wtDmV6Picker" class="wt-dm-v6-picker hidden">'+STICKERS.map(x=>'<button type="button" data-v6-sticker="'+esc(x)+'">'+esc(x)+'</button>').join("")+'</div><div id="wtDmV6Reply" class="wt-dm-v6-quote hidden"></div><div class="wt-dm-v6-compose-row"><textarea id="wtDmV6Input" rows="2" maxlength="'+MAX_TEXT+'" placeholder="輸入私訊…"></textarea><button id="wtDmV6Send" class="primary-btn" type="button">送出</button></div></div></div>';
  }
  async function openDm(otherUid) {
    if(!signedIn())return;
    const other=String(otherUid||"");if(!other||other===uid())return;
    try{
      const a=await db.ref("friendships/"+uid()+"/"+other).once("value"),b=await db.ref("friendships/"+other+"/"+uid()).once("value");
      if(!a.exists()&&!b.exists())throw new Error("只有好友才能傳送私訊");
      const ba=await db.ref("blockedUsers/"+uid()+"/"+other).once("value"),bb=await db.ref("blockedUsers/"+other+"/"+uid()).once("value");
      if(ba.exists()||bb.exists())throw new Error("目前無法對此使用者傳送私訊");
      closeModal("wtFriendsV6Modal");closeModal("wtDmListV6Modal");detachDm();
      activeFriendUid=other;dmOtherProfile=await profile(other);activeConversationId=await ensureConversation(other);
      const body=modal("wtDmModal","私訊｜"+String(dmOtherProfile.displayName||"玩家"),shell(dmOtherProfile));
      activeMessageRef=db.ref("conversations/"+activeConversationId+"/messages").limitToLast(120);
      activeTypingRef=db.ref("conversations/"+activeConversationId+"/typing");
      activeReadRef=db.ref("conversations/"+activeConversationId+"/reads");
      activePinnedRef=db.ref("conversations/"+activeConversationId+"/pinnedMessages");
      activeMessageRef.on("value",snap=>{const list=[];snap.forEach(c=>list.push(Object.assign({id:String(c.key)},c.val()||{})));dmMessages=list;renderDmMessages(body,other);void markRead();});
      activePinnedRef.on("value",snap=>{dmPins=snap.val()||{};renderDmMessages(body,other);});
      activeTypingRef.on("value",snap=>{const who=[];snap.forEach(c=>{if(c.key!==uid()&&c.val()&&Number(c.val().at||0)>=Date.now()-5000)who.push(String(c.val().name||"對方"));});const n=body.querySelector("#wtDmV6Typing");if(n)n.textContent=who.length?"｜"+who.join("、")+" 正在輸入…":"";});
      const input=body.querySelector("#wtDmV6Input"),send=body.querySelector("#wtDmV6Send"),search=body.querySelector("#wtDmV6Search"),picker=body.querySelector("#wtDmV6Picker"),sticker=body.querySelector("#wtDmV6StickerBtn"),imageBtn=body.querySelector("#wtDmV6ImageBtn"),imageInput=body.querySelector("#wtDmV6ImageInput");
      if(input){
        input.oninput=()=>typing(Boolean(String(input.value||"").trim()));
        input.onblur=()=>typing(false);
        input.onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();void sendMessage(body,"text",{text:input.value}).catch(err=>toast(err.message||"傳送失敗"));}}
      }
      if(send)send.onclick=()=>void sendMessage(body,"text",{text:input?.value||""}).catch(e=>toast(e.message||"傳送失敗"));
      if(search)search.oninput=()=>renderDmMessages(body,other);
      if(sticker&&picker)sticker.onclick=()=>picker.classList.toggle("hidden");
      body.querySelectorAll("[data-v6-sticker]").forEach(b=>b.onclick=()=>{void sendMessage(body,"sticker",{sticker:b.dataset.v6Sticker}).catch(e=>toast(e.message||"貼圖失敗"));picker.classList.add("hidden");});
      if(imageBtn&&imageInput){imageBtn.onclick=()=>imageInput.click();imageInput.onchange=async()=>{const f=imageInput.files?.[0];imageInput.value="";if(!f)return;try{const x=await uploadImage(f);await sendMessage(body,"image",{mediaUrl:x.url,mediaPath:x.path,mediaName:x.name,mediaSize:x.size});}catch(e){toast(e.message||"圖片傳送失敗");}};}
      body.querySelector("#wtDmV6Back").onclick=()=>openFriends("friends");
      body.querySelector("#wtDmV6Block").onclick=async()=>{try{await blockUser(other,dmOtherProfile.displayName);closeModal("wtDmModal");await openFriends("blocked");}catch(e){toast(e.message||"封鎖失敗");}};
      if(!dmModalObserver){
        dmModalObserver=new MutationObserver(()=>{
          const m=$("wtDmModal");
          if(m&&m.classList.contains("hidden")){detachDm();activeFriendUid="";dmOtherProfile=null;}
        });
      }
      if(!dmModalObserver._watching){dmModalObserver.observe(body.parentElement?.parentElement||$("wtDmModal"),{attributes:true,attributeFilter:["class","hidden"]});dmModalObserver._watching=true;}
      void markRead();
    }catch(e){toast(e.message||"開啟私訊失敗");}
  }
  async function openDmList() {
    if(!signedIn())return;
    try{
      const list=await friendEntries();
      const body=modal("wtDmListV6Modal","私訊中心",'<div class="wt-social-v6-list" id="wtDmV6List"></div><div class="wt-social-v6-actions" style="margin-top:10px"><button id="wtDmV6OpenFriends" class="primary-btn" type="button">開啟好友中心</button></div>');
      const box=body.querySelector("#wtDmV6List");
      box.innerHTML=list.length?list.map(x=>'<div class="wt-social-v6-row"><div class="wt-social-v6-user"><div class="wt-social-v6-avatar">'+esc(x.profile?.avatarEmoji||"🙂")+'</div><div class="wt-social-v6-user-main"><strong>'+esc(x.profile?.displayName||"玩家")+(x.unread?' <span class="wt-social-v6-unread">新</span>':"")+'</strong><div class="wt-social-v6-meta">'+esc(x.lastMessage?.preview||"尚未聊天")+'</div></div></div><button class="tiny-btn primary" data-v6-dm-open="'+esc(x.uid)+'">開啟</button></div>').join(""):'<div class="wt-social-v6-empty">目前沒有好友。</div>';
      box.querySelectorAll("[data-v6-dm-open]").forEach(b=>b.onclick=()=>openDm(b.dataset.v6DmOpen));
      body.querySelector("#wtDmV6OpenFriends").onclick=()=>openFriends("friends");
      updateDmBadge(list);
    }catch(e){toast(e.message||"私訊中心載入失敗");}
  }
  function openLightbox(src) {
    if(!src)return;
    const old=$("wtDmV6Lightbox");if(old)old.remove();
    const b=document.createElement("div");b.id="wtDmV6Lightbox";b.className="wt-chat-lightbox";
    b.innerHTML='<div class="wt-chat-lightbox-backdrop"></div><button class="tiny-btn wt-chat-lightbox-close">關閉</button><img alt="圖片" src="'+esc(src)+'">';
    document.body.appendChild(b);const close=()=>b.remove();b.querySelector(".wt-chat-lightbox-backdrop").onclick=close;b.querySelector(".wt-chat-lightbox-close").onclick=close;
  }
  async function updateDmBadge(list) {
    const rows=list||[];
    const n=rows.filter(x=>x.unread).length,b=$("wtSocialV6DmBadge");
    if(b){b.textContent=n>99?"99+":String(n);b.style.display=n?"block":"none";}
  }
  async function pollDm() {
    if(unreadBusy||!currentUser()||currentUser().isAnonymous||!db)return;
    unreadBusy=true;
    try{await updateDmBadge(await friendEntries());}catch(_){}
    unreadBusy=false;
  }
  function initSocialV6() {
    if(document.documentElement.dataset.wtSocialV6)return;
    document.documentElement.dataset.wtSocialV6="1";ensureCss();ensureTopbar();
    setInterval(ensureTopbar,1200);setInterval(updateHomeSearch,1200);setInterval(pollDm,15000);
    if(auth)auth.onAuthStateChanged(()=>{ensureTopbar();void pollDm();});
  }

  wt.openFriends=openFriends;
  wt.openDm=openDm;
  wt.openDmList=openDmList;
  wt.sendFriendRequest=sendFriendRequest;
  wt.acceptFriendRequest=acceptFriendRequest;
  wt.declineFriendRequest=declineFriendRequest;
  wt.removeFriend=removeFriend;
  wt.blockUser=blockUser;
  wt.unblockUser=unblockUser;
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",initSocialV6,{once:true});else initSocialV6();
})();