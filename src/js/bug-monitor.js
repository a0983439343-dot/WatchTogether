(() => {
  "use strict";

  const wt = window.WT_ENHANCEMENTS;
  if (!wt || !wt.db || !wt.auth) return;

  const STORAGE_KEY = "wt_auto_bug_state_v1";
  const MAX_RECORDS = 80;
  const ERROR_DEBOUNCE_MS = 15000;
  const AUTO_RESOLVE_AFTER_MS = 180000;
  const STABLE_CHECKS_REQUIRED = 2;
  const AI_RECHECK_INTERVAL_MS = 10 * 60 * 1000;
  const AI_TIMEOUT_MS = 12000;
  const REPORT_WATCH_KEY = "wt_report_watch_v1";
  const VERIFY_TIMEOUT_MS = 12000;
  const BUILD_VERSION = (() => {
    try {
      const script = Array.from(document.scripts).find(s => /src\/js\/app\.js/.test(s.src));
      return new URL(script?.src || location.href, location.href).searchParams.get("v") || "unknown";
    } catch (_) {
      return "unknown";
    }
  })();

  let states = loadState();
  let watchedReports = loadWatchedReports();
  let monitorStarted = false;
  let lastErrorAt = 0;
  let originalConsoleError = null;
  let originalConsoleWarn = null;
  const pendingErrors = [];

  function getAiEndpoint() {
    try {
      const config = window.WATCHTOGETHER_CONFIG || {};
      const explicit = String(config.aiBugDetectorUrl || "").trim();
      if (explicit) return explicit;
      const proxy = String(config.youtubeStreamProxyUrl || config.youtubeSearchProxyUrl || "").trim().replace(/\/+$/, "");
      return proxy ? proxy + "/ai/analyze" : "";
    } catch (_) {
      return "";
    }
  }

  function getVerifyEndpoint() {
    try {
      const config = window.WATCHTOGETHER_CONFIG || {};
      const explicit = String(config.bugVerificationUrl || "").trim();
      if (explicit) return explicit;
      const proxy = String(config.youtubeStreamProxyUrl || config.youtubeSearchProxyUrl || "").trim().replace(/\/+$/, "");
      return proxy ? proxy + "/verify" : "";
    } catch (_) {
      return "";
    }
  }

  function collectHealthEvidence() {
    const checks = [];
    checks.push({name:"firebase_sdk",ok:!!window.firebase});
    checks.push({name:"firebase_database",ok:!!wt.db});
    checks.push({name:"firebase_auth",ok:!!wt.auth});
    checks.push({name:"wt_core",ok:!!window.WT_CORE});
    checks.push({name:"wt_enhancements",ok:!!window.WT_ENHANCEMENTS});
    checks.push({name:"home_search_input",ok:!!document.getElementById("videoSearchInput")});
    checks.push({name:"home_search_button",ok:!!document.getElementById("videoSearchBtn")});
    const functionChecks = [
      {name:"updateAdminButton",ok:typeof wt.updateAdminButton === "function"},
      {name:"syncLatestPlayback",ok:typeof window.WT_CORE?.syncLatestPlayback === "function" || typeof window.syncLatestPlayback === "function"},
      {name:"createRoom",ok:typeof window.WT_CORE?.createRoom === "function" || typeof wt.createRoomWithVideo === "function"}
    ];
    checks.push({name:"critical_functions",ok:functionChecks.every(check => check.ok),checks:functionChecks});
    return checks;
  }

  const AI_STREAM_TIMEOUT_MS = 25000;
  const AI_STREAM_MAX_CHARS = 12000;
  const AI_STREAM_FLUSH_MS = 150;
  const AI_EXTENSION_SOURCE = "SSE_STREAM_EXTENSION";
  const AI_EXTENSION_BRIDGE_SOURCE = "SSE_STREAM_EXTENSION_BRIDGE";
  const AI_EXTENSION_API_ORIGIN = "https://api.openai.com";
  const AI_EXTENSION_MODEL = "gpt-4o-mini";

  function makeAiRequestId() {
    return "wt-ai-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function cleanAiStack(value, max = 5000) {
    return String(value == null ? "" : value)
      .replace(/https?:\/\/[^\s)]+/gi, "[url]")
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uid]")
      .replace(/\b[A-Z0-9]{6}\b/g, "[code]")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
      .slice(0, max);
  }

  function parseAiDiagnosis(text) {
    const source = String(text || "").trim();
    const pick = (label, fallback = "") => {
      const re = new RegExp("【" + label + "】\\s*([\\s\\S]*?)(?=\\n?【[^】]+】|$)");
      const match = source.match(re);
      return cleanText(match?.[1] || fallback, 900);
    };
    const statusRaw = pick("狀態", "無法判定").trim();
    const statusMap = {
      "確認為問題":"confirmed",
      "仍存在":"still_present",
      "已修復候選":"resolved_candidate",
      "無法判定":"inconclusive"
    };
    const confidenceText = pick("信心", "");
    const percent = confidenceText.match(/([0-9]{1,3})\s*%/);
    const numeric = Number(confidenceText);
    const confidence = percent
      ? Math.max(0, Math.min(1, Number(percent[1]) / 100))
      : Number.isFinite(numeric)
        ? Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric))
        : 0;
    return {
      status: statusMap[statusRaw] || (["confirmed","still_present","resolved_candidate","inconclusive"].includes(statusRaw) ? statusRaw : "inconclusive"),
      confidence,
      title: pick("問題", source.slice(0,220)),
      summary: pick("證據", source.slice(0,900)),
      rootCause: pick("根因", "未能從目前證據可靠判定根因。"),
      suggestion: pick("修復建議", "先檢查錯誤堆疊、觸發路徑與最近部署差異，再進行最小範圍修正。")
    };
  }

  function buildAiMessages(report, evidence, current) {
    const details = cleanAiStack(report?.details || "", 5000);
    const evidenceText = cleanAiStack(JSON.stringify(evidence || {}, null, 2), 5500);
    const currentText = cleanAiStack(JSON.stringify(current || {}, null, 2), 3500);
    return [
      {
        role:"system",
        content:[
          "你是 WatchTogether 的即時 Bug 診斷器。",
          "你的任務是根據瀏覽器錯誤、Stack、Firebase/播放器上下文與驗證結果，判斷最可能的問題與修復方向。",
          "不要杜撰不存在的檔案、函式或證據；不確定時明確寫出無法判定。",
          "只診斷，不直接修改程式碼，不提供秘密或憑證。",
          "請用繁體中文回答，而且必須嚴格使用以下六個標記，每個標記各自一行：",
          "【狀態】確認為問題 | 仍存在 | 已修復候選 | 無法判定",
          "【信心】0-100%",
          "【問題】一句話描述主要 Bug",
          "【證據】列出最關鍵的觀察與因果關聯",
          "【根因】最可能的技術根因；若只能推測就標明推測",
          "【修復建議】最小風險、可驗證的修正方向",
          "不要使用 Markdown 表格；避免超長重複 Stack。"
        ].join("\n")
      },
      {
        role:"user",
        content:[
          "以下是 WatchTogether 的即時錯誤回報。",
          "回報資料：",
          details,
          "",
          "驗證證據：",
          evidenceText,
          "",
          "目前頁面上下文：",
          currentText
        ].join("\n")
      }
    ];
  }

  function writeAiStreamToReport(reportId, text, final = false, patch = {}) {
    if (!reportId) return Promise.resolve(false);
    const data = {
      aiProvider:"openai",
      aiModel:AI_EXTENSION_MODEL,
      aiRealtime:true,
      aiStreamText:String(text || "").slice(0, AI_STREAM_MAX_CHARS),
      aiStreamUpdatedAt:firebase.database.ServerValue.TIMESTAMP,
      ...patch
    };
    return wt.db.ref("reports/" + reportId).update(data).then(() => true).catch(error => {
      try { console.warn("AI 即時診斷串流寫入失敗:", error); } catch (_) {}
      return false;
    });
  }

  async function analyzeWithAI(reportId, phase, state, evidence) {
    const user = wt.auth.currentUser;
    if (!user || user.isAnonymous || !reportId) return null;

    const reportSnapshot = await wt.db.ref("reports/" + reportId).once("value").catch(() => null);
    if (!reportSnapshot?.exists()) return null;
    const report = reportSnapshot.val() || {};
    const current = {
      page:reportLocation(),
      roomId:typeof wt.roomIdFromUrl === "function" ? String(wt.roomIdFromUrl() || "").slice(0,20) : "",
      buildVersion:BUILD_VERSION,
      phase:String(phase || "detect").slice(0,40),
      health:collectHealthEvidence(),
      verification:evidence?.verification || evidence || {}
    };

    const now = Date.now();
    const lastAiAt = Number(state?.lastAiAt || 0);
    if (phase === "recheck" && lastAiAt && now - lastAiAt < AI_RECHECK_INTERVAL_MS) return null;

    const requestId = makeAiRequestId();
    const messages = buildAiMessages(report, evidence, current);
    const payload = {
      requestId,
      messages,
      model:AI_EXTENSION_MODEL,
      provider:"openai",
      apiOrigin:AI_EXTENSION_API_ORIGIN,
      reportId,
      phase:String(phase || "detect").slice(0,40)
    };

    await writeAiStreamToReport(reportId, "", false, {
      aiDiagnosisState:"streaming",
      aiStatus:"diagnosing",
      aiError:null,
      aiStartedAt:firebase.database.ServerValue.TIMESTAMP
    });

    return await new Promise(resolve => {
      let settled = false;
      let started = false;
      let accumulated = "";
      let flushTimer = null;
      let timeout = null;

      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        if (flushTimer) clearTimeout(flushTimer);
        if (timeout) clearTimeout(timeout);
      };

      const finish = async (analysis, errorMessage = "") => {
        if (settled) return;
        settled = true;
        cleanup();

        const patch = analysis ? {
          aiStatus:analysis.status,
          aiConfidence:Number(analysis.confidence || 0),
          aiTitle:cleanText(analysis.title || "",220),
          aiSummary:cleanText(analysis.summary || "",900),
          aiRootCause:cleanText(analysis.rootCause || "",900),
          aiSuggestion:cleanText(analysis.suggestion || "",900),
          aiModel:AI_EXTENSION_MODEL,
          aiProvider:"openai",
          aiDiagnosisState:"completed",
          aiCompletedAt:firebase.database.ServerValue.TIMESTAMP,
          aiError:null,
          aiResolvedCandidate:analysis.status === "resolved_candidate",
          status:report.status === "resolved" ? "resolved" : "ai_completed"
        } : {
          aiStatus:"unavailable",
          aiDiagnosisState:"error",
          aiError:cleanText(errorMessage || "AI 擴充功能串流失敗",500)
        };

        await writeAiStreamToReport(reportId, accumulated, true, patch);

        try {
          await writeHistory(
            reportId,
            analysis ? "ai_stream_completed" : "ai_stream_error",
            analysis
              ? "OpenAI 即時串流診斷完成：" + String(analysis.status || "inconclusive")
              : "OpenAI 即時串流診斷失敗：" + String(errorMessage || "unknown")
          );
        } catch (_) {}

        if (state && typeof state === "object") {
          state.lastAiAt = now;
          state.aiStatus = analysis?.status || "unavailable";
          state.aiConfidence = Number(analysis?.confidence || 0);
          state.aiTitle = cleanText(analysis?.title || "",220);
          state.aiSummary = cleanText(analysis?.summary || "",900);
          state.aiRootCause = cleanText(analysis?.rootCause || "",900);
          state.aiSuggestion = cleanText(analysis?.suggestion || "",900);
          state.aiModel = AI_EXTENSION_MODEL;
          saveState();
        }

        resolve(analysis || null);
      };

      const scheduleFlush = () => {
        if (flushTimer || settled) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          void writeAiStreamToReport(reportId, accumulated, false, {
            aiDiagnosisState:"streaming",
            aiStatus:"diagnosing"
          });
        }, AI_STREAM_FLUSH_MS);
      };

      const onMessage = event => {
        if (event.source !== window || event.origin !== location.origin) return;
        const data = event.data;
        if (!data || data.source !== AI_EXTENSION_BRIDGE_SOURCE || String(data.requestId || "") !== requestId) return;

        const type = String(data.type || "");
        if (type === "EXTENSION_READY") return;

        if (type === "STREAM_STARTED") {
          started = true;
          void writeAiStreamToReport(reportId, accumulated, false, {
            aiDiagnosisState:"streaming",
            aiStatus:"diagnosing",
            aiModel:String(data.model || AI_EXTENSION_MODEL).slice(0,100),
            aiProvider:"openai"
          });
          return;
        }

        if (type === "STREAM_EVENT") {
          const chunk = String(data.content || "");
          if (!chunk) return;
          accumulated = (accumulated + chunk).slice(0, AI_STREAM_MAX_CHARS);
          scheduleFlush();
          return;
        }

        if (type === "STREAM_END") {
          void finish(parseAiDiagnosis(accumulated));
          return;
        }

        if (type === "STREAM_ERROR") {
          void finish(null, String(data.error || "OpenAI 串流錯誤").slice(0,500));
        }
      };

      window.addEventListener("message", onMessage);
      timeout = setTimeout(() => {
        void finish(null, started
          ? "AI 串流超時"
          : "Chrome 擴充功能未在期限內回應；請確認擴充功能已載入 WatchTogether 頁面。"
        );
      }, AI_STREAM_TIMEOUT_MS);

      try {
        window.postMessage({
          source:AI_EXTENSION_SOURCE,
          type:"START_STREAM",
          requestId,
          payload
        }, location.origin);
      } catch (error) {
        void finish(null, error?.message || "無法發送 AI 擴充功能請求");
      }
    });
  }

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

  function loadWatchedReports() {
    try {
      const raw = localStorage.getItem(REPORT_WATCH_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveWatchedReports() {
    try {
      const entries = Object.entries(watchedReports)
        .sort((a, b) => Number(b[1]?.lastCheckedAt || b[1]?.registeredAt || 0) - Number(a[1]?.lastCheckedAt || a[1]?.registeredAt || 0))
        .slice(0, 50);
      watchedReports = Object.fromEntries(entries);
      localStorage.setItem(REPORT_WATCH_KEY, JSON.stringify(watchedReports));
    } catch (_) {}
  }

  function forgetWatchedReport(reportId) {
    reportId = String(reportId || "");
    if (!reportId) return;
    delete watchedReports[reportId];
    saveWatchedReports();
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
    const ref = wt.db.ref("reportHistoryEvents/" + reportId).push();
    await ref.set({
      reportId: String(reportId).slice(0, 128),
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
    const payload = {
      uid:user.uid,
      category,
      details:cleanText("[系統自動攔截 - AI 診斷中]\n" + String(details || ""),2000),
      roomId:typeof wt.roomIdFromUrl === "function" ? wt.roomIdFromUrl() : "",
      page:reportLocation(),
      userAgent:cleanText(navigator.userAgent,500),
      status:"open",
      source:"auto",
      autoDetected:true,
      autoVerifyEnabled:true,
      aiRealtime:true,
      aiProvider:"openai",
      aiModel:AI_EXTENSION_MODEL,
      aiDiagnosisState:"streaming",
      aiStatus:"diagnosing",
      aiStreamText:"",
      fingerprint,
      buildVersion:BUILD_VERSION,
      firstSeenAt:firebase.database.ServerValue.TIMESTAMP,
      lastSeenAt:firebase.database.ServerValue.TIMESTAMP,
      occurrences:1,
      createdAt:firebase.database.ServerValue.TIMESTAMP,
      verificationState:"monitoring",
      verificationStableChecks:0
    };
    await reportRef.set(payload);

    try {
      await writeHistory(reportId,"created","系統自動攔截；已送出 OpenAI 即時診斷");
    } catch (_) {}

    void analyzeWithAI(reportId,"detect",null,{
      trigger:source,
      liveErrorPresent:true
    }).catch(() => {});

    return {reportId,now:Date.now()};
  }

  async function updateAutoReport(reportId, state, category, details, source) {
    const user = wt.auth.currentUser;
    if (!user || !reportId) return false;

    const now = Date.now();
    const existing = await wt.db.ref("reports/" + reportId).once("value");
    if (!existing.exists()) {
      const created = await createAutoReport(
        state.fingerprint || "",
        category,
        details,
        source
      );
      if (!created) return false;
      state.reportId = created.reportId;
      state.firstSeenAt = now;
      state.lastSeenAt = now;
      state.occurrences = 1;
      state.status = "open";
      state.stableChecks = 0;
      return true;
    }

    const reopened = state.status === "resolved";
    await wt.db.ref("reports/" + reportId).update({
      status: "open",
      lastSeenAt: firebase.database.ServerValue.TIMESTAMP,
      occurrences: Math.max(1, Number(state.occurrences || 0) + 1),
      buildVersion: BUILD_VERSION,
      autoVerifyEnabled:true,
      verificationState:"monitoring",
      verificationStableChecks:0,
      autoResolvedAt: null,
      autoResolvedBuild: null,
      autoResolveReason: null,
      aiResolvedCandidate: false
    });

    state.status = "open";
    state.lastSeenAt = now;
    state.occurrences = Math.max(1, Number(state.occurrences || 0) + 1);
    state.stableChecks = 0;
    state.lastCategory = category;
    state.lastSource = source;
    if (!state.lastAiAt || now - Number(state.lastAiAt) >= AI_RECHECK_INTERVAL_MS) {
      void analyzeWithAI(reportId,"repeat",state,{
        trigger:source,
        liveErrorPresent:true
      }).catch(() => {});
    }
    saveState();

    try {
      if (reopened) {
        await writeHistory(reportId, "reopened", "相同錯誤再次出現，已自動重新開啟");
      } else {
        await writeHistory(reportId, "seen", "相同錯誤再次發生，第 " + state.occurrences + " 次");
      }
    } catch (historyError) {
      try { console.warn("WatchTogether 自動回報紀錄寫入失敗:", historyError); } catch (_) {}
    }
    return true;
  }

  async function recordError(source, error, extra = "") {
    const user = wt.auth.currentUser;
    if (!user) {
      if (pendingErrors.length < 20) pendingErrors.push({source, error});
      return;
    }
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
          lastSource: source,
          fingerprint
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

  async function runDeploymentVerification(category) {
    const endpoint = getVerifyEndpoint();
    if (!endpoint) {
      return {ok:false,status:"unavailable",checks:[],error:"verification_endpoint_missing"};
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const url = endpoint + (endpoint.includes("?") ? "&" : "?") + "category=" + encodeURIComponent(String(category || "other"));
      const response = await fetch(url,{
        method:"GET",
        cache:"no-store",
        credentials:"omit",
        signal:controller.signal
      });
      const result = await response.json().catch(() => ({}));
      return {
        ok:response.ok && result?.ok === true,
        status:String(result?.status || (response.ok ? "passed" : "failed")),
        buildVersion:String(result?.buildVersion || "").slice(0,100),
        checkedAt:String(result?.checkedAt || "").slice(0,80),
        checks:Array.isArray(result?.checks) ? result.checks : [],
        error:response.ok ? "" : cleanText(result?.error || "deployment_verification_failed",400)
      };
    } catch (error) {
      return {
        ok:false,
        status:"unavailable",
        checks:[],
        error:cleanText(error?.message || "verification_failed",400)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function hasRecentRelevantError(category, sinceAt) {
    const since = Number(sinceAt || 0);
    const wanted = String(category || "other");
    return Object.values(states || {}).some(state => {
      if (!state || Number(state.lastEventAt || 0) < since) return false;
      return String(state.lastCategory || "other") === wanted;
    });
  }

  function localVerification(report) {
    const category = String(report?.category || "other");
    const health = collectHealthEvidence();
    const failedHealth = health.filter(check => check && check.ok !== true);
    let categoryChecks = [];

    if (category === "search") {
      categoryChecks = [
        {name:"search_modal_input",ok:!!document.getElementById("modalVideoSearchInput")},
        {name:"search_modal_button",ok:!!document.getElementById("modalSearchVideoBtn")},
        {name:"search_platform_select",ok:!!document.getElementById("sourceTypeModal")},
        {name:"search_change_video_button",ok:!!document.getElementById("changeSourceBtn")}
      ];
    } else if (category === "room") {
      categoryChecks = [
        {name:"create_room",ok:typeof window.WT_CORE?.createRoom === "function" || typeof wt.createRoomWithVideo === "function"},
        {name:"playback_control_request",ok:typeof window.WT_CORE?.requestPlaybackControl === "function" || typeof window.requestPlaybackControl === "function"},
        {name:"playback_control_listener",ok:typeof window.WT_CORE?.attachPlaybackControlRequestListener === "function" || typeof window.attachPlaybackControlRequestListener === "function"}
      ];
    } else if (category === "playback") {
      categoryChecks = [
        {name:"native_video_element",ok:!!document.getElementById("directVideo") || typeof wt.createYoutubeNativePlayer === "function"},
        {name:"native_youtube_adapter",ok:typeof wt.createYoutubeNativePlayer === "function" || typeof wt.buildYoutubeNativePlayer === "function"}
      ];
    } else if (category === "chat") {
      categoryChecks = [
        {name:"chat_runtime",ok:/chat/i.test(document.body?.innerText || "") || typeof wt.sendPrivateText === "function"}
      ];
    } else if (category === "account") {
      categoryChecks = [
        {name:"auth_runtime",ok:!!wt.auth},
        {name:"profile_runtime",ok:typeof wt.loadProfile === "function"}
      ];
    } else if (category === "ui") {
      categoryChecks = [
        {name:"document_ready",ok:document.readyState !== "loading"},
        {name:"body_visible",ok:!!document.body}
      ];
    }

    const all = health.concat(categoryChecks);
    return {
      ok:failedHealth.length === 0 && all.every(check => check && check.ok === true),
      checks:all,
      failedChecks:all.filter(check => check && check.ok !== true).map(check => check.name)
    };
  }

  async function writeVerification(reportId, data) {
    if (!reportId) return;
    await wt.db.ref("reports/" + reportId + "/verification").update(data);
  }

  async function verifyReport(reportId, mode = "scheduled") {
    const user = wt.auth.currentUser;
    reportId = String(reportId || "");
    if (!user || !reportId) return null;

    const snapshot = await wt.db.ref("reports/" + reportId).once("value");
    if (!snapshot.exists()) {
      forgetWatchedReport(reportId);
      return null;
    }

    const report = snapshot.val() || {};
    if (String(report.uid || "") !== String(user.uid || "")) return null;
    if (report.autoVerifyEnabled !== true) return null;
    if (report.status === "resolved" && !watchedReports[reportId]?.monitorResolved) {
      forgetWatchedReport(reportId);
      return {status:"resolved"};
    }

    const now = Date.now();
    const watch = watchedReports[reportId] || {
      registeredAt:now,
      stableChecks:0
    };
    const local = localVerification(report);
    const deployment = await runDeploymentVerification(report.category);
    const recentRelevantError = hasRecentRelevantError(report.category, Number(report.createdAt || watch.registeredAt || now));
    const deterministicPass = local.ok && deployment.ok && !recentRelevantError;

    watch.lastCheckedAt = now;
    watch.lastDeploymentOk = deployment.ok;
    watch.lastLocalOk = local.ok;
    watch.lastRecentRelevantError = recentRelevantError;
    watch.stableChecks = deterministicPass ? Number(watch.stableChecks || 0) + 1 : 0;

    const verificationPayload = {
      state:deterministicPass ? "passed" : "failed",
      checkedAt:firebase.database.ServerValue.TIMESTAMP,
      buildVersion:deployment.buildVersion || BUILD_VERSION,
      deterministicPassed:deterministicPass,
      stableChecks:watch.stableChecks,
      recentRelevantError,
      localChecks:local.checks,
      deploymentChecks:deployment.checks,
      deploymentStatus:deployment.status,
      deploymentError:deployment.error || "",
      mode:String(mode || "scheduled").slice(0,30)
    };

    watchedReports[reportId] = watch;
    saveWatchedReports();

    try {
      await writeVerification(reportId,verificationPayload);
    } catch (_) {}

    if (!deterministicPass || watch.stableChecks < STABLE_CHECKS_REQUIRED) {
      return {status:"monitoring",deterministicPassed:deterministicPass,stableChecks:watch.stableChecks};
    }

    const ai = await analyzeWithAI(
      reportId,
      mode === "manual" ? "manual_verify" : "recheck",
      {
        lastAiAt:0,
        lastEventAt:recentRelevantError ? now : 0
      },
      {
        verification:verificationPayload,
        stableChecks:watch.stableChecks,
        liveErrorPresent:false,
        sameFingerprintSeen:false,
        connected:true,
        deploymentVerified:deployment.ok
      }
    );

    const aiApproved = !!ai &&
      String(ai.status || "") === "resolved_candidate" &&
      Number(ai.confidence || 0) >= 0.75;

    if (!aiApproved) {
      try {
        await writeVerification(reportId,{
          state:"needs_review",
          aiApproved:false,
          aiStatus:ai?.status || "unavailable",
          aiConfidence:Number(ai?.confidence || 0)
        });
        await writeHistory(reportId,"verification_failed",
          ai
            ? "自動驗證通過，但 AI 未達自動結案條件"
            : "自動驗證通過，但 AI 分析暫時不可用"
        );
      } catch (_) {}
      return {status:"needs_review",ai};
    }

    const reason = "部署版本檢查通過、瀏覽器健康檢查通過、連續穩定檢查通過，且 AI 判定可視為已修復";
    try {
      await writeVerification(reportId,{
        state:"approved",
        approved:true,
        aiApproved:true,
        aiStatus:"resolved_candidate",
        aiConfidence:Number(ai.confidence || 0),
        approvedAt:firebase.database.ServerValue.TIMESTAMP,
        reason
      });
      await writeHistory(reportId,"auto_verified",reason);
      await wt.db.ref("reports/" + reportId).update({
        status:"resolved",
        autoResolvedAt:firebase.database.ServerValue.TIMESTAMP,
        autoResolvedBuild:BUILD_VERSION,
        autoResolveReason:reason
      });
    } catch (error) {
      try { console.warn("WatchTogether 自動結案寫入失敗:",error); } catch (_) {}
      return {status:"write_failed"};
    }

    watch.monitorResolved = true;
    watch.stableChecks = STABLE_CHECKS_REQUIRED;
    saveWatchedReports();
    return {status:"resolved",ai};
  }

  function registerReport(reportId) {
    reportId = String(reportId || "").trim();
    const user = wt.auth.currentUser;
    if (!user || !reportId) return;
    watchedReports[reportId] = {
      registeredAt:Date.now(),
      stableChecks:0,
      monitorResolved:false
    };
    saveWatchedReports();
    void verifyReport(reportId,"manual").catch(() => {});
  }

  async function stableCheck() {
    const user = wt.auth.currentUser;
    if (!user) return;

    let connected = true;
    try {
      const snapshot = await wt.db.ref(".info/connected").once("value");
      connected = snapshot.val() === true;
    } catch (_) {
      connected = false;
    }
    if (!connected) return;

    for (const [fingerprint,state] of Object.entries(states)) {
      if (!state?.reportId || state.status !== "open") continue;
      const lastSeenAt = Number(state.lastSeenAt || 0);
      if (!lastSeenAt || Date.now() - lastSeenAt < AUTO_RESOLVE_AFTER_MS) continue;
      state.stableChecks = Number(state.stableChecks || 0);
      if (state.stableChecks < STABLE_CHECKS_REQUIRED) {
        state.stableChecks += 1;
      }
      if (state.stableChecks < STABLE_CHECKS_REQUIRED) {
        continue;
      }
      try {
        const result = await verifyReport(state.reportId,"auto");
        if (result?.status === "resolved") state.status = "resolved";
        saveState();
      } catch (err) {
        try { console.warn("WatchTogether 自動驗證失敗:",err); } catch (_) {}
      }
    }

    for (const reportId of Object.keys(watchedReports)) {
      try {
        const result = await verifyReport(reportId,"manual");
        if (result?.status === "resolved") forgetWatchedReport(reportId);
      } catch (error) {
        try { console.warn("WatchTogether 手動回報自動驗證失敗:",error); } catch (_) {}
      }
    }
    saveWatchedReports();
    saveState();
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

      let waitTimer = null;
      const clearWait = () => {
        if (waitTimer) clearTimeout(waitTimer);
        waitTimer = null;
      };

      video.addEventListener("error", () => {
        clearWait();
        const mediaError = video.error;
        const message = mediaError
          ? "HTMLVideoElement error code " + mediaError.code + (mediaError.message ? ": " + mediaError.message : "")
          : "HTMLVideoElement error";
        void recordError("video", new Error(message));
      });

      video.addEventListener("stalled", () => {
        clearWait();
        waitTimer = setTimeout(() => {
          if (video.readyState < 3) {
            void recordError("player-sync", new Error("HTMLVideoElement stalled 超過 8 秒，readyState=" + String(video.readyState)));
          }
        }, 8000);
      });

      video.addEventListener("waiting", () => {
        clearWait();
        waitTimer = setTimeout(() => {
          if (!video.ended && video.readyState < 3) {
            void recordError("player-sync", new Error("HTMLVideoElement waiting 超過 8 秒，可能發生播放器或串流同步異常"));
          }
        }, 8000);
      });

      video.addEventListener("playing", clearWait);
      video.addEventListener("canplay", clearWait);
      video.addEventListener("pause", clearWait);
    });
  }

  function installGlobalWatchers() {
    if (monitorStarted) return;
    monitorStarted = true;

    const previousOnError = window.onerror;
    window.onerror = function(message, source, lineno, colno, error) {
      const text = String(message || "Uncaught error");
      const stack = String(error?.stack || "");
      void recordError("window-error", new Error(text + (stack ? "\n" + stack : "")));
      if (typeof previousOnError === "function") {
        return previousOnError.apply(this, arguments);
      }
      return false;
    };

    const previousOnUnhandledRejection = window.onunhandledrejection;
    window.onunhandledrejection = function(event) {
      const parts = getErrorParts(event?.reason);
      void recordError("unhandled-rejection", new Error(parts.message + (parts.stack ? "\n" + parts.stack : "")));
      if (typeof previousOnUnhandledRejection === "function") {
        return previousOnUnhandledRejection.apply(this, arguments);
      }
      return false;
    };

    originalConsoleError=console.error.bind(console);
    console.error=function(...args){
      try{
        const joined=args.map(arg=>getErrorParts(arg).message).filter(Boolean).join(" | ");
        const stack=args.map(arg=>getErrorParts(arg).stack).filter(Boolean).join("\n");
        const text=joined+(stack?" | "+stack:"");
        if(/error|failed|exception|permission_denied|not defined|firebase|network|abort|cors|quota|403|404|500|sync/i.test(text)){
          void recordError("console-error",new Error(text));
        }
      }catch(_){}
      return originalConsoleError(...args);
    };

    originalConsoleWarn=console.warn.bind(console);
    console.warn=function(...args){
      try{
        const joined=args.map(arg=>getErrorParts(arg).message).filter(Boolean).join(" | ");
        const stack=args.map(arg=>getErrorParts(arg).stack).filter(Boolean).join("\n");
        const text=joined+(stack?" | "+stack:"");
        if(/同步.*失敗|sync.*fail|firebase.*(error|fail|denied)|permission_denied|network|abort|cors|quota|mediaerror|player.*(error|fail)/i.test(text)){
          void recordError("console-warning",new Error(text));
        }
      }catch(_){}
      return originalConsoleWarn(...args);
    };

    const early=Array.isArray(window.__WT_EARLY_ERRORS__)?window.__WT_EARLY_ERRORS__.slice():[];
    window.__WT_EARLY_ERRORS__=[];
    early.forEach(item=>{
      pendingErrors.push({
        source:item?.source||"early-error",
        error:new Error(String(item?.message||"Early runtime error")+(item?.stack?"\n"+String(item.stack):""))
      });
    });

    const connectedRef=wt.db.ref(".info/connected");
    let previousConnected=null;
    connectedRef.on("value",snapshot=>{
      const connected=snapshot.val()===true;
      if(previousConnected===true&&connected===false){
        void recordError("firebase-connection",new Error("Firebase Realtime Database 連線中斷"));
      }else if(previousConnected===false&&connected===true){
        try{console.info("[WatchTogether] Firebase Realtime Database 已重新連線");}catch(_){}
      }
      previousConnected=connected;
    },error=>{
      void recordError("firebase-connection",error||new Error("Firebase .info/connected 監聽失敗"));
    });

    attachVideoWatchers();

    const observer=new MutationObserver(()=>{
      attachVideoWatchers();
      const syncStatus=document.getElementById("syncStatus");
      if(syncStatus&&/失敗|錯誤|error|failed|denied|timeout|逾時|不同步/i.test(syncStatus.textContent||"")){
        void recordError("player-sync",new Error("同步狀態顯示異常："+String(syncStatus.textContent||"").slice(0,500)));
      }
    });
    observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true});

    window.addEventListener("load",()=>void stableCheck(),{once:true});
    setInterval(()=>void stableCheck(),60000);
    setInterval(()=>{
      if(document.visibilityState!=="hidden") attachVideoWatchers();
    },10000);

    if(wt.auth?.onAuthStateChanged){
      wt.auth.onAuthStateChanged(user=>{
        if(!user||user.isAnonymous||!pendingErrors.length) return;
        const queue=pendingErrors.splice(0,12);
        queue.forEach(item=>void recordError(item.source,item.error));
      });
    }
  }

  expose();
  installGlobalWatchers();
  Object.keys(watchedReports).forEach(reportId => {
    void verifyReport(reportId,"startup").catch(() => {});
  });
  window.WT_BUG_MONITOR = {
    version: "2",
    buildVersion: BUILD_VERSION,
    recordError,
    stableCheck,
    verifyReport,
    registerReport,
    makeReportFingerprint: function(category, details) {
      return hash(normalizeForFingerprint(String(category || "other") + "|" + String(details || "")));
    }
  };
})();
