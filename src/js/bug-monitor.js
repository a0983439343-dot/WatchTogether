(() => {
  "use strict";

  const wt = window.WT_ENHANCEMENTS;
  if (!wt || !wt.db || !wt.auth) return;

  const STORAGE_KEY = "wt_auto_bug_state_v1";
  const MAX_RECORDS = 80;
  const ERROR_DEBOUNCE_MS = 15000;
  const AUTO_RESOLVE_AFTER_MS = 180000;
  const STABLE_CHECKS_REQUIRED = 2;
  const BUILD_VERSION = (() => {
    try {
      const script = Array.from(document.scripts).find(s => /src\/js\/app\.js/.test(s.src));
      return new URL(script?.src || location.href, location.href).searchParams.get("v") || "unknown";
    } catch (_) {
      return "unknown";
    }
  })();

  let states = loadState();
  let monitorStarted = false;
  let lastErrorAt = 0;
  let originalConsoleError = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveState() {
    try {
      const entries = Object.entries(states)
        .sort((a, b) => Number(b[1]?.lastSeenAt || 0) - Number(a[1]?.lastSeenAt || 0))
        .slice(0, MAX_RECORDS);
      states = Object.fromEntries(entries);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(states));
    } catch (_) {}
  }

  function cleanText(value, max = 1500) {
    return String(value == null ? "" : value)
      .replace(/https?:\/\/[^\s)]+/gi, "[url]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uid]")
      .replace(/\b[A-Z0-9]{6}\b/g, "[room]")
      .replace(/\b\d{5,}\b/g, "[number]")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);
  }

  function normalizeForFingerprint(value) {
    return cleanText(value, 2000)
      .toLowerCase()
      .replace(/\bline\s+\d+\b/g, "line")
      .replace(/:\d+(?::\d+)?/g, ":n")
      .replace(/\d+/g, "n");
  }

  function hash(value) {
    let h1 = 2166136261;
    let h2 = 16777619;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 16777619);
      h2 ^= code + i;
      h2 = Math.imul(h2, 2246822519);
    }
    return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
  }

  function getCategory(message, source) {
    const text = String(message || "").toLowerCase();
    if (source === "video" || /directvideo|htmlmediaelement|play\(|video playback|mediaerror|sourcebuffer|dailymotion|vimeo|twitch/.test(text)) return "playback";
    if (/firebase|permission_denied|database|auth|authentication|unauthenticated|token/.test(text)) return "account";
    if (/search|youtube|dailymotion|vimeo|twitch|api/.test(text)) return "search";
    if (/room|member|queue|kicked|controlrequest|playback sync/.test(text)) return "room";
    if (/chat|message|friend|conversation/.test(text)) return "chat";
    if (/ui|element|modal|button|undefined|stylesheet|css/.test(text)) return "ui";
    return "other";
  }

  function getErrorParts(error) {
    if (error instanceof Error) {
      return {
        message: cleanText(error.message || error.name || "Unknown error"),
        stack: cleanText(error.stack || "", 2200)
      };
    }
    if (error && typeof error === "object") {
      return {
        message: cleanText(error.message || error.reason || error.code || JSON.stringify(error)),
        stack: cleanText(error.stack || "", 2200)
      };
    }
    return { message: cleanText(error), stack: "" };
  }

  function shouldIgnore(message, stack = "") {
    const text = (String(message || "") + " " + String(stack || "")).toLowerCase();
    if (!text.trim()) return true;
    if (/script error\.?$/i.test(text.trim())) return true;
    if (/chrome-extension:\/\//.test(text) || /moz-extension:\/\//.test(text)) return true;
    if (/the play\(\) request was interrupted by a call to pause\(\)/.test(text)) return true;
    if (/notallowederror.*play\(\)/.test(text) && !/autoplay|permission/.test(text)) return true;
    return false;
  }

  function reportLocation() {
    try {
      return location.href.slice(0, 1000);
    } catch (_) {
      return "";
    }
  }

  async function writeHistory(reportId, event, details) {
    if (!reportId) return;
    const user = wt.auth.currentUser;
    if (!user) return;
    const ref = wt.db.ref("reportHistory/" + reportId).push();
    await ref.set({
      event: String(event || "seen").slice(0, 40),
      createdAt: firebase.database.ServerValue.TIMESTAMP,
      actorUid: String(user.uid || "").slice(0, 128),
      actorEmail: String(user.email || "").slice(0, 320),
      source: "watchdog",
      details: cleanText(details, 500)
    });
  }

  async function createAutoReport(fingerprint, category, details, source) {
    const user = wt.auth.currentUser;
    if (!user) return null;

    const reportRef = wt.db.ref("reports").push();
    const reportId = reportRef.key;
    const now = Date.now();
    const payload = {
      uid: user.uid,
      category,
      details: cleanText(details, 2000),
      roomId: typeof wt.roomIdFromUrl === "function" ? wt.roomIdFromUrl() : "",
      page: reportLocation(),
      userAgent: cleanText(navigator.userAgent, 500),
      status: "open",
      source: "auto",
      autoDetected: true,
      fingerprint,
      buildVersion: BUILD_VERSION,
      firstSeenAt: firebase.database.ServerValue.TIMESTAMP,
      lastSeenAt: firebase.database.ServerValue.TIMESTAMP,
      occurrences: 1,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };
    await reportRef.set(payload);
    await writeHistory(reportId, "created", source + " 自動偵測到新的錯誤");
    return { reportId, now };
  }

  async function updateAutoReport(reportId, state, category, details, source) {
    const user = wt.auth.currentUser;
    if (!user || !reportId) return false;

    const now = Date.now();
    const reopened = state.status === "resolved";
    await wt.db.ref("reports/" + reportId).update({
      status: "open",
      lastSeenAt: firebase.database.ServerValue.TIMESTAMP,
      occurrences: Math.max(1, Number(state.occurrences || 0) + 1),
      buildVersion: BUILD_VERSION,
      autoResolvedAt: null,
      autoResolvedBuild: null,
      autoResolveReason: null
    });

    state.status = "open";
    state.lastSeenAt = now;
    state.occurrences = Math.max(1, Number(state.occurrences || 0) + 1);
    state.stableChecks = 0;
    state.lastCategory = category;
    state.lastSource = source;
    saveState();

    if (reopened) {
      await writeHistory(reportId, "reopened", "相同錯誤再次出現，已自動重新開啟");
    } else {
      await writeHistory(reportId, "seen", "相同錯誤再次發生，第 " + state.occurrences + " 次");
    }
    return true;
  }

  async function recordError(source, error, extra = "") {
    const user = wt.auth.currentUser;
    if (!user) return;
    const now = Date.now();
    if (now - lastErrorAt < 1000) return;
    lastErrorAt = now;

    const parts = getErrorParts(error);
    const rawMessage = [parts.message, extra, parts.stack].filter(Boolean).join(" | ");
    if (shouldIgnore(rawMessage, parts.stack)) return;

    const normalized = normalizeForFingerprint(source + "|" + rawMessage);
    const fingerprint = hash(normalized);
    const category = getCategory(rawMessage, source);
    const details = [
      "自動偵測來源：" + source,
      "錯誤：" + parts.message,
      parts.stack ? "堆疊：" + parts.stack.slice(0, 1000) : ""
    ].filter(Boolean).join("\n");

    const current = states[fingerprint];
    if (current && now - Number(current.lastEventAt || 0) < ERROR_DEBOUNCE_MS) {
      return;
    }

    try {
      if (!current?.reportId) {
        const created = await createAutoReport(fingerprint, category, details, source);
        if (!created) return;
        states[fingerprint] = {
          reportId: created.reportId,
          firstSeenAt: now,
          lastSeenAt: now,
          lastEventAt: now,
          occurrences: 1,
          status: "open",
          stableChecks: 0,
          lastCategory: category,
          lastSource: source
        };
        saveState();
        return;
      }

      const next = {
        ...current,
        lastEventAt: now
      };
      await updateAutoReport(current.reportId, next, category, details, source);
      states[fingerprint] = next;
      states[fingerprint].lastEventAt = now;
      saveState();
    } catch (err) {
      try { console.warn("WatchTogether 自動錯誤回報失敗:", err); } catch (_) {}
    }
  }

  async function stableCheck() {
    const user = wt.auth.currentUser;
    if (!user || !Object.keys(states).length) return;

    let connected = true;
    try {
      const snapshot = await wt.db.ref(".info/connected").once("value");
      connected = snapshot.val() === true;
    } catch (_) {
      connected = false;
    }
    if (!connected) return;

    const now = Date.now();
    let changed = false;

    for (const [fingerprint, state] of Object.entries(states)) {
      if (!state?.reportId || state.status !== "open") continue;
      const lastSeenAt = Number(state.lastSeenAt || 0);
      if (!lastSeenAt || now - lastSeenAt < AUTO_RESOLVE_AFTER_MS) continue;

      state.stableChecks = Number(state.stableChecks || 0) + 1;
      if (state.stableChecks < STABLE_CHECKS_REQUIRED) {
        changed = true;
        continue;
      }

      try {
        await wt.db.ref("reports/" + state.reportId).update({
          status: "resolved",
          autoResolvedAt: firebase.database.ServerValue.TIMESTAMP,
          autoResolvedBuild: BUILD_VERSION,
          autoResolveReason: "連續健康檢查未再次發現相同錯誤"
        });
        await writeHistory(state.reportId, "auto_resolved", "連續健康檢查未再次發現相同錯誤，已自動標記為已處理");
        state.status = "resolved";
        state.stableChecks = STABLE_CHECKS_REQUIRED;
        state.autoResolvedAt = now;
        state.autoResolvedBuild = BUILD_VERSION;
        changed = true;
      } catch (err) {
        try { console.warn("WatchTogether 自動處理回報失敗:", err); } catch (_) {}
      }
    }

    if (changed) saveState();
  }

  function expose() {
    wt.reportAutoBug = function(category, message, extra) {
      return recordError("manual-hook:" + String(category || "other"), message, extra || "");
    };
    window.reportWatchTogetherBug = wt.reportAutoBug;
  }

  function attachVideoWatchers() {
    document.querySelectorAll("video").forEach(video => {
      if (video.dataset.wtBugMonitorAttached === "1") return;
      video.dataset.wtBugMonitorAttached = "1";
      video.addEventListener("error", () => {
        const mediaError = video.error;
        const message = mediaError
          ? "HTMLVideoElement error code " + mediaError.code + (mediaError.message ? ": " + mediaError.message : "")
          : "HTMLVideoElement error";
        void recordError("video", new Error(message));
      });
    });
  }

  function installGlobalWatchers() {
    if (monitorStarted) return;
    monitorStarted = true;

    window.addEventListener("error", event => {
      const message = event?.message || "Uncaught error";
      const stack = event?.error?.stack || "";
      void recordError("window-error", new Error(message + (stack ? "\n" + stack : "")));
    });

    window.addEventListener("unhandledrejection", event => {
      const reason = event?.reason;
      const parts = getErrorParts(reason);
      void recordError("unhandled-rejection", new Error(parts.message + (parts.stack ? "\n" + parts.stack : "")));
    });

    originalConsoleError = console.error.bind(console);
    console.error = function(...args) {
      try {
        const joined = args.map(arg => getErrorParts(arg).message).filter(Boolean).join(" | ");
        const stack = args.map(arg => getErrorParts(arg).stack).filter(Boolean).join("\n");
        const text = joined + (stack ? " | " + stack : "");
        if (/error|failed|exception|permission_denied|not defined|firebase|network|abort|cors|quota|403|404|500/i.test(text)) {
          void recordError("console-error", new Error(text));
        }
      } catch (_) {}
      return originalConsoleError(...args);
    };

    const early = Array.isArray(window.__WT_EARLY_ERRORS__) ? window.__WT_EARLY_ERRORS__.slice() : [];
    window.__WT_EARLY_ERRORS__ = [];
    early.forEach(item => {
      const message = item?.message || "Early runtime error";
      const stack = item?.stack || "";
      void recordError(item?.source || "early-error", new Error(message + (stack ? "\n" + stack : "")));
    });

    attachVideoWatchers();

    const observer = new MutationObserver(() => attachVideoWatchers());
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("load", () => void stableCheck(), { once: true });
    setInterval(() => void stableCheck(), 60000);
    setInterval(() => {
      if (document.visibilityState !== "hidden") attachVideoWatchers();
    }, 10000);
  }

  expose();
  installGlobalWatchers();
  window.WT_BUG_MONITOR = {
    version: "1",
    buildVersion: BUILD_VERSION,
    recordError,
    stableCheck
  };
})();
